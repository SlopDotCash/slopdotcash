/** Actual subprocess lifecycle: failed browser phases must not leave servers running. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
        // Hosted Windows needs more time to start two Node processes.
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
}, 15_000);

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

test("an occupied fixture port rejects startup and lets the caller release and reuse it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-fixture-startup-"));
  const result = join(directory, "result.json");
  const fixture = pathToFileURL(
    join(process.cwd(), "tests/github-api-fixture.mjs"),
  ).href;
  const script = `
    import assert from "node:assert/strict";
    import { writeFileSync } from "node:fs";
    import { createServer } from "node:http";
    import { startGitHubApiFixture } from ${JSON.stringify(fixture)};
    const owned = createServer();
    await new Promise(resolve => owned.listen(0, "127.0.0.1", resolve));
    const port = owned.address().port;
    let refusal;
    try {
      await startGitHubApiFixture(port);
      throw new Error("Occupied port unexpectedly started");
    } catch (error) {
      assert.equal(error.code, "EADDRINUSE");
      refusal = error.code;
    } finally {
      await new Promise((resolve, reject) => owned.close(error => error ? reject(error) : resolve()));
    }
    const recovered = await startGitHubApiFixture(port);
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/missing");
      assert.equal(response.status, 404);
      writeFileSync(${JSON.stringify(result)}, JSON.stringify({ refusal, rebound: response.status }));
    } finally {
      await new Promise((resolve, reject) => recovered.close(error => error ? reject(error) : resolve()));
    }
  `;
  try {
    expect(
      await runE2ePhase({
        label: "fixture-startup-regression",
        command: "node",
        args: ["--input-type=module", "-e", script],
        cwd: directory,
        env: process.env,
        timeoutMs: 5000,
      }),
    ).toBe(0);
    expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
      refusal: "EADDRINUSE",
      rebound: 404,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
