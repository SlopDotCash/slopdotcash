/** Actual subprocess lifecycle: failed browser phases must not leave servers running. */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stopDescendant(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function expectPortReusable(port: number) {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}

test("a timed-out launcher stops its descendant server before returning failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-phase-tree-"));
  const ready = join(directory, "ready");
  const heartbeat = join(directory, "heartbeat");
  // Publish complete heartbeat samples so termination cannot leave a torn write.
  const descendant = `const fs = require("node:fs"); let count = 0; fs.writeFileSync(${JSON.stringify(heartbeat)}, "0"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, port: server.address().port })); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); }); setInterval(() => { fs.writeFileSync(${JSON.stringify(heartbeat)} + ".next", String(++count)); fs.renameSync(${JSON.stringify(heartbeat)} + ".next", ${JSON.stringify(heartbeat)}); }, 25);`;
  const launcher = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  let completed = false;
  // Include cold launcher startup before exercising descendant termination.
  // Native Windows CI can spend the former five-second budget before ready.
  const phase = runE2ePhase({
    label: "timeout-regression",
    command: "node",
    args: ["-e", launcher],
    cwd: directory,
    env: process.env,
    timeoutMs: 15_000,
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
    const { pid, port } = JSON.parse(readFileSync(ready, "utf8"));
    process.kill(pid, 0);
    // Prove the descendant owns a real server before exercising cleanup.
    await expect(expectPortReusable(port)).rejects.toHaveProperty(
      "code",
      "EADDRINUSE",
    );
    expect(await phase).toBe(1);
    await expectPortReusable(port);
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
}, 30_000);

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

for (const stdio of ["inherit", "ignore"]) {
  test.skipIf(process.platform === "win32")(
    `a failed launcher stops its descendant server with ${stdio} stdio`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "slop-phase-failure-"));
      const ready = join(directory, "ready");
      const descendant = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, port: server.address().port })); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); });`;
      // A launcher can fail after starting a server. Inherited pipes must not
      // keep the phase alive until its full deadline, and ignored pipes must
      // not let the phase return while the server is still running.
      let pid: number | undefined;
      try {
        const launcher = `const fs = require("node:fs"); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: ${JSON.stringify(stdio)} }); const poll = setInterval(() => { if (fs.existsSync(${JSON.stringify(ready)})) { clearInterval(poll); process.exit(7); } }, 10);`;
        const options = {
          label: `failed-launcher-${stdio}`,
          args: ["-e", launcher],
          cwd: directory,
          timeoutMs: 5000,
        };
        // Exercise the production Node runtime, including its POSIX process
        // group signaling, rather than Bun's node:child_process emulation.
        const runner = pathToFileURL(
          join(process.cwd(), "scripts/run-e2e-phase.mjs"),
        ).href;
        const script = `import { runE2ePhase } from ${JSON.stringify(runner)}; process.exitCode = await runE2ePhase({ ...${JSON.stringify(options)}, command: process.execPath, env: process.env });`;
        const child = Bun.spawn(["node", "--input-type=module", "-e", script], {
          stdout: "inherit",
          stderr: "pipe",
        });
        const diagnostics = new Response(child.stderr).text();
        const deadline = Date.now() + 5000;
        while (!existsSync(ready) && Date.now() < deadline) await pause(25);
        expect(existsSync(ready)).toBe(true);
        const { pid: serverPid, port } = JSON.parse(
          readFileSync(ready, "utf8"),
        );
        pid = serverPid;
        expect(await child.exited).toBe(7);
        const stderr = await diagnostics;
        // The member-state check targets Linux; other platforms keep the
        // bounded fallback and still prove cleanup through port reuse.
        if (process.platform === "linux")
          expect(stderr).not.toContain("process cleanup did not finish");
        await expectPortReusable(port);
        pid = undefined;
      } finally {
        if (pid !== undefined) stopDescendant(pid);
        rmSync(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
}

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
