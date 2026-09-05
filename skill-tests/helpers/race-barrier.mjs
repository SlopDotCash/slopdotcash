import { existsSync } from "node:fs";

/** Test-only synchronous barrier: never outlive a lost coordinator indefinitely. */
export function waitForRaceRelease(
  release,
  { parentPid = process.ppid, timeoutMs = 15_000 } = {},
) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1)
    throw new Error("Race coordinator is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
    throw new Error("Race barrier requires a bounded timeout");
  const deadline = performance.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(release)) {
    if (process.ppid !== parentPid)
      throw new Error("Race coordinator exited before release");
    if (performance.now() >= deadline)
      throw new Error("Race barrier timed out before release");
    Atomics.wait(sleeper, 0, 0, Math.min(10, deadline - performance.now()));
  }
}
