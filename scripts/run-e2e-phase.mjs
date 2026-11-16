import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Playwright starts its browsers and web servers in separate POSIX groups.
// Capture numeric ownership while the launcher is alive, before interrupting
// it. Never infer ownership from a port, command name, or a reparented process.
function processTable() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Could not read process ownership for cleanup");
  const rows = new Map();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/u.exec(line);
    if (!match) throw new Error("Invalid process ownership record");
    const [, pid, parent, group, state, started] = match;
    rows.set(Number(pid), {
      pid: Number(pid),
      parent: Number(parent),
      group: Number(group),
      state,
      started,
    });
  }
  return rows;
}

function descendantGroups(root) {
  const rows = processTable();
  if (!rows.has(root) || /^[ZX]/u.test(rows.get(root).state))
    throw new Error("Launcher exited before ownership capture");
  const owned = new Set([root]);
  let size;
  do {
    size = owned.size;
    for (const row of rows.values())
      if (owned.has(row.parent)) owned.add(row.pid);
  } while (owned.size !== size);
  return new Map(
    [...rows.values()]
      .filter(
        (row) =>
          row.pid !== root && row.group === row.pid && owned.has(row.pid),
      )
      .map((row) => [
        row.group,
        [...rows.values()].filter(
          (member) => member.group === row.group && owned.has(member.pid),
        ),
      ]),
  );
}

function stopDescendantGroups(groups) {
  if (!groups.size) return [];
  const rows = processTable();
  const failures = [];
  for (const [group, captured] of groups) {
    const members = [...rows.values()].filter((row) => row.group === group);
    if (!members.length) continue;
    const leader = rows.get(group);
    const capturedLeader = captured.find((row) => row.pid === group);
    // A reused leader or no surviving captured member does not authorize a
    // signal. This also excludes a group inherited from an unrelated parent.
    if (
      (leader && leader.started !== capturedLeader.started) ||
      !captured.some((before) =>
        members.some(
          (after) =>
            before.pid === after.pid && before.started === after.started,
        ),
      )
    ) {
      failures.push(`Could not confirm ownership of process group ${group}`);
      continue;
    }
    try {
      process.kill(-group, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") failures.push(error.message);
    }
  }
  return failures;
}

/** A killed Linux process can remain in its group until its parent reaps it. */
function hasRunningGroupMembers(group) {
  try {
    process.kill(-group, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  if (process.platform !== "linux") return true;
  // Container PID 1 may not reap orphaned descendants. Zombies cannot execute
  // code or retain server sockets, so their continued PID existence does not
  // mean the phase still has a running descendant.
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/u.test(pid)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue;
      throw error;
    }
    // comm is parenthesized and may itself contain spaces or parentheses.
    const [state, , processGroup] = stat
      .slice(stat.lastIndexOf(")") + 2)
      .split(" ");
    if (Number(processGroup) === group && state !== "Z" && state !== "X")
      return true;
  }
  return false;
}

function prefixLines(stream, label, output) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) output.write(`[${label}] ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) output.write(`[${label}] ${pending}\n`);
  });
}

export function runE2ePhase({
  label,
  command,
  args,
  cwd,
  env,
  timeoutMs = 40 * 60_000,
  // Bounded waits for a graceful interrupt and for verified group exit. Tests
  // shorten them; the production runner keeps the defaults.
  interruptGraceMs = 5000,
  cleanupGraceMs = 5000,
  signal,
  interruptSignal,
  browserOwnership = false,
  onStdout,
  onStderr,
  onExit,
}) {
  return new Promise((resolvePhase) => {
    const stdout = onStdout ? { write: onStdout } : process.stdout;
    const stderr = onStderr ? { write: onStderr } : process.stderr;
    const ownershipDirectory =
      browserOwnership && process.platform !== "win32"
        ? mkdtempSync(join(tmpdir(), "slop-browser-ownership-"))
        : null;
    const childEnv = ownershipDirectory
      ? {
          ...env,
          SLOP_BROWSER_OWNERSHIP_DIRECTORY: ownershipDirectory,
          NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${new URL("./browser-process-ownership.mjs", import.meta.url).href}`,
        }
      : env;
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let cleaningUp = false;
    let cleanupTimer;
    let cleanupPoll;
    let interruptTimer;
    let ownershipPoll;
    let ownershipFailed = false;
    let launcherExited = false;
    let launcherAcknowledged = false;
    const knownProcesses = new Map();
    const handledRequests = new Set();
    const detachedGroups = new Map();
    const cleanupError = (message) => {
      ownershipFailed = true;
      stderr.write(`[${label}] process cleanup failed: ${message}\n`);
    };
    const captureOwnership = () => {
      if (!ownershipDirectory || settled || cleaningUp) return;
      try {
        const requests = readdirSync(ownershipDirectory).filter(
          (name) => name.endsWith(".request") && !handledRequests.has(name),
        );
        if (!requests.length) return;
        const rows = processTable();
        const owned = new Set();
        const launcher = rows.get(child.pid);
        if (launcher && !launcherExited && !/^[ZX]/u.test(launcher.state)) {
          const known = knownProcesses.get(child.pid);
          if (!known || known.started === launcher.started)
            owned.add(child.pid);
        }
        for (const before of knownProcesses.values()) {
          const current = rows.get(before.pid);
          if (
            current &&
            current.started === before.started &&
            !/^[ZX]/u.test(current.state)
          )
            owned.add(current.pid);
        }
        let size;
        do {
          size = owned.size;
          for (const row of rows.values())
            if (owned.has(row.parent)) owned.add(row.pid);
        } while (owned.size !== size);
        for (const pid of owned) knownProcesses.set(pid, rows.get(pid));
        for (const row of rows.values())
          if (
            row.pid !== child.pid &&
            row.group === row.pid &&
            owned.has(row.pid)
          )
            detachedGroups.set(
              row.group,
              [...rows.values()].filter(
                (member) => member.group === row.group && owned.has(member.pid),
              ),
            );
        for (const name of requests) {
          const match = /^(\d+)-(start|exit)\.request$/u.exec(name);
          const valid = match && owned.has(Number(match[1]));
          if (!valid)
            cleanupError("Could not confirm browser checkpoint owner");
          if (valid && Number(match[1]) === child.pid && match[2] === "exit")
            launcherAcknowledged = true;
          const acknowledgement = join(
            ownershipDirectory,
            name.replace(/\.request$/u, ".ack"),
          );
          // File creation alone is observable before writeFileSync fills it.
          // Publish complete acknowledgement bytes in one rename.
          writeFileSync(`${acknowledgement}.next`, valid ? "ok" : "refused", {
            flag: "wx",
          });
          renameSync(`${acknowledgement}.next`, acknowledgement);
          handledRequests.add(name);
        }
      } catch (error) {
        cleanupError(error.message);
        // The protocol directory can fail while the launcher is still alive.
        // Capture its current descendants before stopping it; do not abandon
        // owned servers merely because the filesystem checkpoint failed.
        if (child.pid && !launcherExited) {
          try {
            for (const [group, members] of descendantGroups(child.pid))
              detachedGroups.set(group, members);
          } catch (captureError) {
            cleanupError(captureError.message);
          }
        }
        stopProcessTree(1);
      }
    };
    if (ownershipDirectory) ownershipPoll = setInterval(captureOwnership, 10);
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      clearTimeout(cleanupPoll);
      clearTimeout(interruptTimer);
      clearInterval(ownershipPoll);
      signal?.removeEventListener("abort", onAbort);
      try {
        if (ownershipDirectory)
          rmSync(ownershipDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupError(error.message);
      }
      resolvePhase(
        timedOut || aborted ? 1 : ownershipFailed ? status || 1 : status,
      );
    };
    const stopProcessTree = (failureStatus) => {
      if (cleaningUp || settled) return;
      cleaningUp = true;
      clearTimeout(timer);
      clearTimeout(interruptTimer);
      clearInterval(ownershipPoll);
      if (child.pid) {
        if (process.platform === "win32") {
          const result = spawnSync(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            {
              stdio: "ignore",
              timeout: 5000,
            },
          );
          if (result.error || result.status !== 0)
            cleanupError(
              result.error?.message ?? `taskkill exited ${result.status}`,
            );
        } else {
          try {
            for (const failure of stopDescendantGroups(detachedGroups))
              cleanupError(failure);
          } catch (error) {
            cleanupError(error.message);
          }
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if (error.code !== "ESRCH") cleanupError(error.message);
          }
        }
      }
      // Sending SIGKILL is asynchronous. Wait for close (including inherited
      // pipes) and for the POSIX group to have no live members before reporting
      // cleanup complete. Closed pipes alone do not prove descendants exited.
      // Keep this wait bounded if a descendant escaped the process group.
      cleanupTimer = setTimeout(() => {
        stderr.write(`[${label}] process cleanup did not finish\n`);
        child.stdout.destroy();
        child.stderr.destroy();
        finish(failureStatus || 1);
      }, cleanupGraceMs);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stderr.write(`[${label}] exceeded the ${timeoutMs}ms phase deadline\n`);
      interruptOrStop();
    }, timeoutMs);
    function onAbort() {
      aborted = true;
      stderr.write(`[${label}] canceled\n`);
      interruptOrStop();
    }
    function interruptOrStop() {
      if (settled || cleaningUp || interruptTimer) return;
      clearTimeout(timer);
      if (interruptSignal && process.platform !== "win32" && child.pid) {
        // Playwright owns web servers in separate process groups. Let its
        // interrupt handler close them before falling back to group cleanup.
        try {
          for (const [group, members] of descendantGroups(child.pid))
            detachedGroups.set(group, members);
        } catch (error) {
          stderr.write(
            `[${label}] process ownership capture failed: ${error.message}\n`,
          );
        }
        try {
          process.kill(child.pid, interruptSignal);
          interruptTimer = setTimeout(
            () => stopProcessTree(1),
            interruptGraceMs,
          );
          return;
        } catch (error) {
          if (error.code !== "ESRCH")
            stderr.write(`[${label}] interrupt failed: ${error.message}\n`);
        }
      }
      stopProcessTree(1);
    }
    if (onStdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", onStdout);
    } else prefixLines(child.stdout, label, stdout);
    if (onStderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", onStderr);
    } else prefixLines(child.stderr, label, stderr);
    child.on("error", (error) => {
      stderr.write(`[${label}] ${error.message}\n`);
      finish(1);
    });
    child.on("exit", (status, signal) => {
      launcherExited = true;
      if (ownershipDirectory && status === 0 && !launcherAcknowledged)
        cleanupError(
          "Browser launcher exited without ownership acknowledgement",
        );
      onExit?.(status, signal);
      // Exit precedes close: even a successful launcher can leave a server
      // holding inherited pipes or sockets. Stop remaining POSIX group members
      // on every exit; close and group checks still precede returning status.
      if (process.platform !== "win32")
        stopProcessTree(timedOut ? 1 : (status ?? 1));
    });
    child.on("close", (status, signal) => {
      if (signal) stderr.write(`[${label}] terminated by ${signal}\n`);
      if (cleaningUp && process.platform !== "win32" && child.pid) {
        const waitForGroupExit = () => {
          if (settled) return;
          try {
            if (
              !hasRunningGroupMembers(child.pid) &&
              [...detachedGroups.keys()].every(
                (group) => !hasRunningGroupMembers(group),
              )
            ) {
              finish(timedOut ? 1 : (status ?? 1));
              return;
            }
          } catch (error) {
            if (error.code === "ESRCH") finish(timedOut ? 1 : (status ?? 1));
            else
              stderr.write(
                `[${label}] process cleanup could not verify exit: ${error.message}\n`,
              );
            return;
          }
          cleanupPoll = setTimeout(waitForGroupExit, 25);
        };
        waitForGroupExit();
        return;
      }
      finish(timedOut ? 1 : (status ?? 1));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
