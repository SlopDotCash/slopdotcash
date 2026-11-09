// Loaded only by the controlled browser launcher and its Node descendants.
// Keep a Node parent alive until the supervisor records its current children.
// Native programs and code that removes this preload are outside this protocol.
import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isMainThread } from "node:worker_threads";

const directory = process.env.SLOP_BROWSER_OWNERSHIP_DIRECTORY;
const waiting = new Int32Array(new SharedArrayBuffer(4));

function checkpoint(stage) {
  const request = join(directory, `${process.pid}-${stage}`);
  try {
    writeFileSync(`${request}.request`, "", { flag: "wx" });
    const deadline = Date.now() + 10_000;
    while (!existsSync(`${request}.ack`)) {
      if (Date.now() >= deadline)
        throw new Error("Browser process ownership acknowledgement timed out");
      Atomics.wait(waiting, 0, 0, 10);
    }
    if (readFileSync(`${request}.ack`, "utf8") !== "ok")
      throw new Error("Browser process ownership acknowledgement refused");
  } catch (error) {
    writeSync(2, `${error.message}\n`);
    process.exitCode ||= 1;
    return false;
  }
  return true;
}

// Worker threads share the process PID; only its main thread owns checkpoints.
if (isMainThread) {
  if (!directory)
    throw new Error("Browser process ownership directory missing");
  if (!checkpoint("start")) process.exit(process.exitCode);
  process.on("exit", () => checkpoint("exit"));
}
