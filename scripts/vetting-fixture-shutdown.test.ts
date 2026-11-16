import { expect, test } from "bun:test";
import { stopVettingEvidence } from "../tests/vetting-evidence-fixture";

test("fixture shutdown terminates a child that ignores EOF and SIGTERM", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{});setInterval(()=>{},1000);console.log('ready');`,
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const reader = child.stdout.getReader();
  try {
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain("ready");
  } finally {
    reader.releaseLock();
  }
  const started = Date.now();
  const result = await stopVettingEvidence(child, 20);
  expect(result).not.toBe(0);
  expect(Date.now() - started).toBeLessThan(2500);
  expect(child.signalCode).toBe("SIGKILL");
}, 5000);

test("fixture shutdown preserves a clean exit without waiting for escalation", async () => {
  const child = Bun.spawn([process.execPath, "-e", `process.stdin.resume();`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await stopVettingEvidence(child, 1000)).toBe(0);
  expect(await stopVettingEvidence(child, 1000)).toBe(0);
});

test("fixture shutdown always settles when termination cannot reap a child", async () => {
  const signals: (string | number | undefined)[] = [];
  const child = {
    stdin: { end() {} },
    kill(signal?: string | number) {
      signals.push(signal);
      return true;
    },
    exited: new Promise<number>(() => {}),
  };
  await expect(stopVettingEvidence(child as never, 0)).rejects.toThrow(
    "shutdown timed out",
  );
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
}, 3000);
