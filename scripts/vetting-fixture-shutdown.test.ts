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
    pid: 0,
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

test.skipIf(process.platform === "win32")(
  "fixture process group stops inherited-pipe descendants and preserves unrelated children",
  async () => {
    const unrelated = Bun.spawn(
      [process.execPath, "-e", "setInterval(()=>{},1000)"],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit']});process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{});console.log(child.pid);setInterval(()=>{},1000);`;
    const owned = Bun.spawn([process.execPath, "-e", script], {
      detached: true,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = owned.stdout.getReader();
    let descendant = 0;
    try {
      try {
        const ready = await reader.read();
        descendant = Number(new TextDecoder().decode(ready.value).trim());
      } finally {
        reader.releaseLock();
      }
      expect(descendant).toBeGreaterThan(0);
      await stopVettingEvidence(owned, 20, true);
      expect(owned.signalCode).toBe("SIGKILL");
      let alive = true;
      for (let i = 0; i < 20; i++) {
        try {
          process.kill(descendant, 0);
        } catch {
          alive = false;
          break;
        }
        await Bun.sleep(20);
      }
      // An orphaned Linux zombie has no running code or inherited pipe handle.
      if (alive && process.platform === "linux") {
        const { readFileSync } = await import("node:fs");
        const stat = readFileSync(`/proc/${descendant}/stat`, "utf8");
        alive = !/^[ZX] /.test(stat.slice(stat.lastIndexOf(")") + 2));
      }
      expect(alive).toBe(false);
      expect(unrelated.signalCode).toBeNull();
      process.kill(unrelated.pid, 0);
    } finally {
      try {
        process.kill(-owned.pid, "SIGKILL");
      } catch {}
      unrelated.kill("SIGKILL");
      await unrelated.exited;
    }
  },
  5000,
);
