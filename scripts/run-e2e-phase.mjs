import { spawn, spawnSync } from "node:child_process";

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
}) {
  return new Promise((resolvePhase) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let timedOut = false;
    let cleaningUp = false;
    let cleanupTimer;
    let cleanupPoll;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      clearTimeout(cleanupPoll);
      resolvePhase(status);
    };
    const stopProcessTree = (failureStatus) => {
      if (cleaningUp || settled) return;
      cleaningUp = true;
      clearTimeout(timer);
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
            process.stderr.write(
              `[${label}] process cleanup failed: ${result.error?.message ?? `taskkill exited ${result.status}`}\n`,
            );
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if (error.code !== "ESRCH")
              process.stderr.write(
                `[${label}] process cleanup failed: ${error.message}\n`,
              );
          }
        }
      }
      // Sending SIGKILL is asynchronous. Wait for close (including inherited
      // pipes) and for the POSIX process group to disappear before reporting
      // cleanup complete. Closed pipes alone do not prove descendants exited.
      // Keep this wait bounded if a descendant escaped the process group.
      cleanupTimer = setTimeout(() => {
        process.stderr.write(`[${label}] process cleanup did not finish\n`);
        child.stdout.destroy();
        child.stderr.destroy();
        finish(failureStatus);
      }, 5000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(
        `[${label}] exceeded the ${timeoutMs}ms phase deadline\n`,
      );
      stopProcessTree(1);
    }, timeoutMs);
    prefixLines(child.stdout, label, process.stdout);
    prefixLines(child.stderr, label, process.stderr);
    child.on("error", (error) => {
      process.stderr.write(`[${label}] ${error.message}\n`);
      finish(1);
    });
    child.on("exit", (status, signal) => {
      // Exit precedes close: a failed launcher can leave a server holding its
      // output pipes open. The POSIX group remains addressable after its
      // leader exits, so stop it now and preserve the launcher's failure.
      if (process.platform !== "win32" && (status !== 0 || signal))
        stopProcessTree(timedOut ? 1 : (status ?? 1));
    });
    child.on("close", (status, signal) => {
      if (signal) process.stderr.write(`[${label}] terminated by ${signal}\n`);
      if (cleaningUp && process.platform !== "win32" && child.pid) {
        const waitForGroupExit = () => {
          if (settled) return;
          try {
            process.kill(-child.pid, 0);
          } catch (error) {
            if (error.code === "ESRCH") finish(timedOut ? 1 : (status ?? 1));
            else
              process.stderr.write(
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
  });
}
