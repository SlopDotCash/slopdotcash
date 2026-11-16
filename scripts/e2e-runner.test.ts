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
  const options = {
    label: "timeout-regression",
    command: "node",
    args: ["-e", launcher],
    cwd: directory,
    // Windows keeps the full cold-start budget; POSIX launchers are ready in
    // well under a second, so the deadline path is reached quickly.
    timeoutMs: process.platform === "win32" ? 15_000 : 4000,
    cleanupGraceMs: 1000,
  };
  // Run the phase in Node, the runtime of `bun run test:e2e`. Bun 1.3.14 on
  // Windows starts a spawnSync timeout from its previous spawnSync call, so
  // in the full suite the taskkill cleanup fails at once with ETIMEDOUT.
  const runner = pathToFileURL(
    join(process.cwd(), "scripts/run-e2e-phase.mjs"),
  ).href;
  const script = `import { runE2ePhase } from ${JSON.stringify(runner)}; process.exitCode = await runE2ePhase({ ...${JSON.stringify(options)}, env: process.env });`;
  const phase = Bun.spawn(["node", "--input-type=module", "-e", script], {
    stdout: "inherit",
    stderr: "inherit",
  }).exited.then((status) => {
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

for (const trigger of ["cancellation", "deadline"]) {
  test.skipIf(process.platform === "win32")(
    `a ${trigger} stops a detached managed server without signaling a sibling`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "slop-phase-detached-"));
      const ready = join(directory, "ready");
      const sibling = createServer();
      await new Promise<void>((resolve) =>
        sibling.listen(0, "127.0.0.1", resolve),
      );
      const descendant = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, port: server.address().port })); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); });`;
      // This is Playwright's relevant process shape: a separately detached
      // managed server, and a launcher whose graceful teardown does not finish.
      const launcher = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { detached: true, stdio: "ignore" }); process.on("SIGINT", () => {}); setInterval(() => {}, 1000);`;
      const runner = pathToFileURL(
        join(process.cwd(), "scripts/run-e2e-phase.mjs"),
      ).href;
      const options = {
        label: `detached-${trigger}`,
        args: ["-e", launcher],
        cwd: directory,
        timeoutMs: trigger === "deadline" ? 3000 : 20_000,
        interruptSignal: "SIGINT",
        // The launcher ignores SIGINT, so the grace elapses before group cleanup.
        interruptGraceMs: 500,
        cleanupGraceMs: 1000,
      };
      const script = `import { existsSync } from "node:fs"; import { runE2ePhase } from ${JSON.stringify(runner)}; const controller = new AbortController(); const timer = ${trigger === "cancellation" ? `setInterval(() => { if (existsSync(${JSON.stringify(ready)})) controller.abort(); }, 25)` : "null"}; process.exitCode = await runE2ePhase({ ...${JSON.stringify(options)}, command: process.execPath, env: process.env, signal: controller.signal }); clearInterval(timer);`;
      const phase = Bun.spawn(["node", "--input-type=module", "-e", script], {
        stdout: "inherit",
        stderr: "inherit",
      });
      let pid: number | undefined;
      try {
        const deadline = Date.now() + 10_000;
        while (!existsSync(ready) && Date.now() < deadline) await pause(25);
        expect(existsSync(ready)).toBe(true);
        const server = JSON.parse(readFileSync(ready, "utf8"));
        pid = server.pid;
        await expect(expectPortReusable(server.port)).rejects.toHaveProperty(
          "code",
          "EADDRINUSE",
        );
        expect(await phase.exited).toBe(1);
        await expectPortReusable(server.port);
        expect(sibling.listening).toBe(true);
        pid = undefined;
      } finally {
        if (pid !== undefined) stopDescendant(pid);
        await phase.exited;
        await new Promise<void>((resolve) => sibling.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
}

for (const exitStatus of [0, 7]) {
  for (const intermediate of [false, true]) {
    test.skipIf(process.platform === "win32")(
      `a browser launcher exiting ${exitStatus} cleans its ${intermediate ? "reparented" : "direct"} detached server`,
      async () => {
        const directory = mkdtempSync(join(tmpdir(), "slop-browser-exit-"));
        const ready = join(directory, "ready");
        const sibling = createServer();
        await new Promise<void>((resolve) =>
          sibling.listen(0, "127.0.0.1", resolve),
        );
        const server = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, port: server.address().port })); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); });`;
        // No grace delay after readiness: process.exit exercises the last
        // ownership handshake, including an intermediate that exits first.
        const launcher = `const fs = require("node:fs"); const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(server)}], { detached: true, stdio: "ignore", env: { ...process.env, NODE_OPTIONS: "" } }); child.unref(); const deadline = Date.now() + 10000; const wait = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(${JSON.stringify(ready)})) { if (Date.now() >= deadline) process.exit(9); Atomics.wait(wait, 0, 0, 5); } process.exit(${exitStatus});`;
        const outer = intermediate
          ? `const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(launcher)}], { stdio: "ignore" }); child.on("exit", status => process.exit(status));`
          : launcher;
        const runner = pathToFileURL(
          join(process.cwd(), "scripts/run-e2e-phase.mjs"),
        ).href;
        const options = {
          label: "browser-normal-exit",
          args: ["-e", outer],
          cwd: directory,
          timeoutMs: 15_000,
          browserOwnership: true,
          cleanupGraceMs: 1000,
        };
        const script = `import { runE2ePhase } from ${JSON.stringify(runner)}; process.exitCode = await runE2ePhase({ ...${JSON.stringify(options)}, command: process.execPath, env: process.env });`;
        const phase = Bun.spawn(["node", "--input-type=module", "-e", script], {
          stdout: "inherit",
          stderr: "pipe",
        });
        const diagnostics = new Response(phase.stderr).text();
        let pid: number | undefined;
        let serverStopped = false;
        try {
          const deadline = Date.now() + 12_000;
          while (!existsSync(ready) && Date.now() < deadline) await pause(10);
          if (!existsSync(ready))
            throw new Error(
              `Browser server did not become ready; exit ${await phase.exited}: ${await diagnostics}`,
            );
          const observed = JSON.parse(readFileSync(ready, "utf8"));
          pid = observed.pid;
          const status = await phase.exited;
          const stderr = await diagnostics;
          // A platform may retain an un-reaped group: refusal is safe, but it
          // must not conceal a live server or lose an earlier failure code.
          if (exitStatus === 0 && status === 1)
            expect(stderr).toContain("process cleanup");
          else expect(status).toBe(exitStatus);
          await expectPortReusable(observed.port);
          serverStopped = true;
          expect(sibling.listening).toBe(true);
          pid = undefined;
        } finally {
          await phase.exited;
          if (!serverStopped && pid === undefined && existsSync(ready))
            pid = JSON.parse(readFileSync(ready, "utf8")).pid;
          if (pid !== undefined) stopDescendant(pid);
          await new Promise<void>((resolve) => sibling.close(() => resolve()));
          rmSync(directory, { recursive: true, force: true });
        }
      },
      25_000,
    );
  }
}

test.skipIf(process.platform === "win32")(
  "a browser command without its final ownership handshake cannot pass",
  async () => {
    let diagnostics = "";
    expect(
      await runE2ePhase({
        label: "missing-browser-handshake",
        command: "/bin/sh",
        args: ["-c", "exit 0"],
        cwd: process.cwd(),
        env: process.env,
        browserOwnership: true,
        onStderr: (text) => {
          diagnostics += text;
        },
      }),
    ).toBe(1);
    expect(diagnostics).toContain("without ownership acknowledgement");
  },
);

test.skipIf(process.platform === "win32")(
  "browser Node workers share the main process ownership registration",
  async () => {
    const script = `const { Worker } = require("node:worker_threads"); const worker = new Worker('require("node:worker_threads").parentPort.postMessage("ready")', { eval: true }); let ready = false; worker.on("message", value => { ready = value === "ready"; }); worker.on("error", () => process.exit(2)); worker.on("exit", code => process.exit(code || (ready ? 0 : 3)));`;
    expect(
      await runE2ePhase({
        label: "browser-worker-ownership",
        command: "node",
        args: ["-e", script],
        cwd: process.cwd(),
        env: process.env,
        browserOwnership: true,
      }),
    ).toBe(0);
  },
);

test.skipIf(process.platform === "win32")(
  "a browser checkpoint cannot claim an unrelated process group",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "slop-browser-foreign-"));
    const ready = join(directory, "ready");
    const server = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, port: server.address().port })));`;
    const sibling = Bun.spawn(["node", "-e", server], {
      stdout: "ignore",
      stderr: "ignore",
    });
    let diagnostics = "";
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(ready) && Date.now() < deadline) await pause(10);
      expect(existsSync(ready)).toBe(true);
      const unrelated = JSON.parse(readFileSync(ready, "utf8"));
      const script = `const fs = require("node:fs"); const path = require("node:path"); fs.writeFileSync(path.join(process.env.SLOP_BROWSER_OWNERSHIP_DIRECTORY, "${unrelated.pid}-exit.request"), ""); process.exit(0);`;
      expect(
        await runE2ePhase({
          label: "foreign-browser-checkpoint",
          command: "node",
          args: ["-e", script],
          cwd: directory,
          env: process.env,
          browserOwnership: true,
          onStderr: (text) => {
            diagnostics += text;
          },
        }),
      ).toBe(1);
      expect(diagnostics).toContain(
        "Could not confirm browser checkpoint owner",
      );
      await expect(expectPortReusable(unrelated.port)).rejects.toHaveProperty(
        "code",
        "EADDRINUSE",
      );
    } finally {
      sibling.kill();
      await sibling.exited;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

for (const exitStatus of [0, 7])
  for (const stdio of ["inherit", "ignore"]) {
    test.skipIf(process.platform === "win32")(
      `a launcher exiting ${exitStatus} stops its descendant server with ${stdio} stdio`,
      async () => {
        const directory = mkdtempSync(join(tmpdir(), "slop-phase-failure-"));
        const ready = join(directory, "ready");
        const descendant = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, port: server.address().port })); fs.renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)}); });`;
        // A launcher can fail after starting a server. Inherited pipes must not
        // keep the phase alive until its full deadline, and ignored pipes must
        // not let the phase return while the server is still running.
        let pid: number | undefined;
        try {
          const launcher = `const fs = require("node:fs"); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: ${JSON.stringify(stdio)} }); const poll = setInterval(() => { if (fs.existsSync(${JSON.stringify(ready)})) { clearInterval(poll); process.exit(${exitStatus}); } }, 10);`;
          const options = {
            label: `failed-launcher-${stdio}`,
            args: ["-e", launcher],
            cwd: directory,
            timeoutMs: 5000,
            cleanupGraceMs: 1000,
          };
          // Exercise the production Node runtime, including its POSIX process
          // group signaling, rather than Bun's node:child_process emulation.
          const runner = pathToFileURL(
            join(process.cwd(), "scripts/run-e2e-phase.mjs"),
          ).href;
          const script = `import { runE2ePhase } from ${JSON.stringify(runner)}; process.exitCode = await runE2ePhase({ ...${JSON.stringify(options)}, command: process.execPath, env: process.env });`;
          const child = Bun.spawn(
            ["node", "--input-type=module", "-e", script],
            {
              stdout: "inherit",
              stderr: "pipe",
            },
          );
          const diagnostics = new Response(child.stderr).text();
          const deadline = Date.now() + 5000;
          while (!existsSync(ready) && Date.now() < deadline) await pause(25);
          expect(existsSync(ready)).toBe(true);
          const { pid: serverPid, port } = JSON.parse(
            readFileSync(ready, "utf8"),
          );
          pid = serverPid;
          const status = await child.exited;
          const stderr = await diagnostics;
          // Non-Linux POSIX systems may retain a dead process-group member.
          // An unverifiable cleanup must refuse success even after exit zero.
          if (exitStatus === 0 && process.platform !== "linux" && status === 1)
            expect(stderr).toContain("process cleanup did not finish");
          else expect(status).toBe(exitStatus);
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
