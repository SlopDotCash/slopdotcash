/** Actual subprocess lifecycle: failed browser phases must not leave servers running. */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a timed-out launcher stops its descendant server before returning failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-phase-tree-"));
  const ready = join(directory, "ready");
  const heartbeat = join(directory, "heartbeat");
  // Publish complete heartbeat samples so termination cannot leave a torn write.
  const descendant = `const fs = require("node:fs"); let count = 0; fs.writeFileSync(${JSON.stringify(heartbeat)}, "0"); fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, String(process.pid)); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); setInterval(() => { fs.writeFileSync(${JSON.stringify(heartbeat)} + ".next", String(++count)); fs.renameSync(${JSON.stringify(heartbeat)} + ".next", ${JSON.stringify(heartbeat)}); }, 25);`;
  const launcher = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  let completed = false;
  // Both Node processes must start before the cleanup deadline is exercised.
  const phase = runE2ePhase({
    label: "timeout-regression",
    command: "node",
    args: ["-e", launcher],
    cwd: directory,
    env: process.env,
    timeoutMs: 5000,
  }).then((status) => {
    completed = true;
    return status;
  });
  let failed = false;
  let failure: unknown;
  try {
    while (!existsSync(ready) && !completed) await pause(25);
    if (!existsSync(ready))
      throw new Error("The descendant did not start before the phase deadline");
    const pid = Number(readFileSync(ready, "utf8"));
    process.kill(pid, 0);
    expect(await phase).toBe(1);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      alive = false;
    }
    expect(alive).toBe(false);
    const stoppedAt = readFileSync(heartbeat, "utf8");
    expect(Number(stoppedAt)).toBeGreaterThan(0);
    await pause(150);
    expect(readFileSync(heartbeat, "utf8")).toBe(stoppedAt);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    await phase;
    try {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      failure = failed
        ? new AggregateError(
            [failure, error],
            "Phase regression failed and its directory could not be removed",
          )
        : error;
      failed = true;
    }
  }
  if (failed) throw failure;
}, 20_000);

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

test("registry fixture writes survive idle-socket closure without replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-fixture-idle-"));
  const result = join(directory, "result.json");
  const fixture = pathToFileURL(
    join(process.cwd(), "tests/github-api-fixture.mjs"),
  ).href;
  const client = `
    import assert from "node:assert/strict";
    import { writeFileSync } from "node:fs";
    import { setTimeout } from "node:timers/promises";
    const origin = process.argv[1];
    for (let index = 0; index < 64; index++) {
      const login = "fixture-writer-" + index;
      const response = await fetch(origin + "/__fixture/github-users/900000002?login=" + login + "&createdAt=2020-01-01T00:00:00Z&merged=2", { method: "PUT" });
      assert.equal(response.status, 204);
      await response.text();
      await setTimeout(1);
      const read = await fetch(origin + "/user/900000002");
      assert.equal(read.status, 200);
      assert.equal((await read.json()).login, login);
      await setTimeout(1);
    }
    writeFileSync(${JSON.stringify(result)}, "64 writes read back without retry");
  `;
  const script = `
    import assert from "node:assert/strict";
    import { spawn } from "node:child_process";
    import { startGitHubApiFixture } from ${JSON.stringify(fixture)};
    const server = await startGitHubApiFixture(0);
    // Reproduce a server retiring idle sockets while the independent test
    // client starts its next request. Never interrupt an active request.
    const closeIdle = setInterval(() => server.closeIdleConnections(), 1);
    try {
      const child = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(client)}, "http://127.0.0.1:" + server.address().port], { stdio: "inherit" });
      const status = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      assert.equal(status, 0);
    } finally {
      clearInterval(closeIdle);
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  `;
  try {
    expect(
      await runE2ePhase({
        label: "fixture-idle-socket-regression",
        command: "node",
        args: ["--input-type=module", "-e", script],
        cwd: directory,
        env: process.env,
        timeoutMs: 10_000,
      }),
    ).toBe(0);
    expect(readFileSync(result, "utf8")).toBe(
      "64 writes read back without retry",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
