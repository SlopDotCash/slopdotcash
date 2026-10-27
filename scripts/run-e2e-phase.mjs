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
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePhase(status);
    };
    const timer = setTimeout(() => {
      process.stderr.write(
        `[${label}] exceeded the ${timeoutMs}ms phase deadline\n`,
      );
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
      // A descendant can retain an inherited pipe after the launcher exits.
      // Do not wait for close to enforce the failed phase's deadline.
      child.stdout.destroy();
      child.stderr.destroy();
      finish(1);
    }, timeoutMs);
    prefixLines(child.stdout, label, process.stdout);
    prefixLines(child.stderr, label, process.stderr);
    child.on("error", (error) => {
      process.stderr.write(`[${label}] ${error.message}\n`);
      finish(1);
    });
    child.on("close", (status, signal) => {
      if (signal) process.stderr.write(`[${label}] terminated by ${signal}\n`);
      finish(status ?? 1);
    });
  });
}
