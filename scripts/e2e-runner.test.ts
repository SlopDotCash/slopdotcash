/** Actual subprocess lifecycle: failed browser phases must not leave servers running. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a timed-out launcher stops its descendant server before returning failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-phase-tree-"));
  const heartbeat = join(directory, "heartbeat");
  // SIGKILL can interrupt a truncate-and-write, leaving an empty heartbeat.
  // Rename a complete sample so the test observes process liveness rather
  // than which filesystem syscall was interrupted at the deadline.
  const descendant = `const fs = require("node:fs"); const heartbeat = ${JSON.stringify(heartbeat)}; let count = 0; setInterval(() => { fs.writeFileSync(heartbeat + ".next", String(++count)); fs.renameSync(heartbeat + ".next", heartbeat); }, 25);`;
  const launcher = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  try {
    expect(
      await runE2ePhase({
        label: "timeout-regression",
        command: "node",
        args: ["-e", launcher],
        cwd: directory,
        env: process.env,
        // Hosted Windows starts two Node processes through its antivirus.
        // Give them time to run; the same post-timeout liveness checks apply.
        timeoutMs: process.platform === "win32" ? 5000 : 1500,
      }),
    ).toBe(1);
    const stoppedAt = readFileSync(heartbeat, "utf8");
    expect(Number(stoppedAt)).toBeGreaterThan(0);
    await pause(150);
    expect(readFileSync(heartbeat, "utf8")).toBe(stoppedAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a completed phase preserves successful and failed child exit codes", async () => {
  for (const status of [0, 7]) {
    expect(
      await runE2ePhase({
        label: `exit-${status}`,
        command: "node",
        args: ["-e", `process.exit(${status})`],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 5000,
      }),
    ).toBe(status);
  }
});
