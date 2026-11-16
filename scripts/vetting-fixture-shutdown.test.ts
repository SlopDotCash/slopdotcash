import { expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { stopVettingEvidence } from "../tests/vetting-evidence-fixture";

function ready(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stdout) return reject(new Error("Missing fixture stdout"));
    child.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
    child.once("error", reject);
  });
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return true;
}

async function stopped(pid: number) {
  for (let i = 0; i < 20; i++) {
    if (!running(pid)) return true;
    await Bun.sleep(20);
  }
  // An orphaned Linux zombie has no running code or inherited pipe handle.
  if (process.platform === "linux") {
    const { readFileSync } = await import("node:fs");
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return /^[ZX] /.test(stat.slice(stat.lastIndexOf(")") + 2));
  }
  return false;
}

test("fixture shutdown terminates a child that ignores EOF and SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{});setInterval(()=>{},1000);console.log('ready');`,
    ],
    { stdio: "pipe" },
  );
  expect(await ready(child)).toBe("ready");
  const started = Date.now();
  expect(await stopVettingEvidence(child, 20)).toBeNull();
  expect(Date.now() - started).toBeLessThan(2500);
  expect(child.signalCode).toBe("SIGKILL");
}, 5000);

test("fixture shutdown preserves a clean exit without waiting for escalation", async () => {
  const child = spawn(process.execPath, ["-e", `process.stdin.resume();`], {
    stdio: "pipe",
  });
  expect(await stopVettingEvidence(child, 1000)).toBe(0);
  expect(await stopVettingEvidence(child, 1000)).toBe(0);
});

test("fixture shutdown always settles when termination cannot reap a child", async () => {
  const signals: (string | number | undefined)[] = [];
  const child = new (
    await import("node:events")
  ).EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 0,
    exitCode: null,
    signalCode: null,
    stdin: { end() {}, destroy() {} },
    kill(signal?: string | number) {
      signals.push(signal);
      return true;
    },
  });
  await expect(stopVettingEvidence(child, 0)).rejects.toThrow(
    "shutdown timed out",
  );
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
}, 3000);

for (const parentExits of [false, true]) {
  test.skipIf(process.platform === "win32")(
    `fixture group stops inherited-pipe descendants when parent ${parentExits ? "already exited" : "ignores TERM"}`,
    async () => {
      const unrelated = spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { stdio: "ignore" },
      );
      const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit']});console.log(child.pid);${parentExits ? "child.unref();process.exit(0);" : "process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{});setInterval(()=>{},1000);"}`;
      const owned = spawn(process.execPath, ["-e", script], {
        detached: true,
        stdio: "pipe",
      });
      const exited = once(owned, "exit");
      let descendant = 0;
      try {
        descendant = Number(await ready(owned));
        expect(descendant).toBeGreaterThan(0);
        if (parentExits) await exited;
        expect(await stopVettingEvidence(owned, 20, true)).toBe(
          parentExits ? 0 : null,
        );
        expect(await stopped(descendant)).toBe(true);
        expect(unrelated.exitCode).toBeNull();
        expect(unrelated.signalCode).toBeNull();
        expect(unrelated.pid && running(unrelated.pid)).toBe(true);
      } finally {
        try {
          if (owned.pid) process.kill(-owned.pid, "SIGKILL");
        } catch {}
        const unrelatedExit = once(unrelated, "exit");
        unrelated.kill("SIGKILL");
        await unrelatedExit;
      }
    },
    5000,
  );
}

test.skipIf(process.platform === "win32")(
  "a completed runtime with no exit notification verifies its exact acknowledgement and dead process group",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "r2-ack-test-"));
    const path = join(directory, "done.json");
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid;
    if (!pid) throw new Error("Missing child pid");
    await once(child, "exit");
    await writeFile(path, JSON.stringify({ pid, completed: true }));
    const missingNotification = Object.assign(new EventEmitter(), {
      pid,
      exitCode: null,
      signalCode: null,
    });
    try {
      expect(
        await stopVettingEvidence(
          missingNotification as ChildProcess,
          1000,
          true,
          path,
        ),
      ).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a shutdown acknowledgement cannot pass while its process group is alive",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "r2-live-ack-test-"));
    const path = join(directory, "done.json");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready');",
      ],
      { detached: true, stdio: "pipe" },
    );
    await ready(child);
    const pid = child.pid;
    if (!pid) throw new Error("Missing child pid");
    await writeFile(path, JSON.stringify({ pid, completed: true }));
    const missingNotification = Object.assign(new EventEmitter(), {
      pid,
      exitCode: null,
      signalCode: null,
    });
    const exited = once(child, "exit");
    try {
      await expect(
        stopVettingEvidence(missingNotification as ChildProcess, 0, true, path),
      ).rejects.toThrow("shutdown timed out");
      await exited;
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
      child.stdout?.destroy();
      child.stderr?.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  },
  5000,
);
