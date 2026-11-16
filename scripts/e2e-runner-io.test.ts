import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function killOwned(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function portReusable(port: number) {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } finally {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const scenario of ["ownership-read", "remove-zero", "remove-seven"]) {
  test.skipIf(
    process.platform === "win32" ||
      (scenario !== "ownership-read" && process.getuid?.() === 0),
  )(
    `browser ${scenario} I/O failure settles after owned cleanup`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "slop-browser-io-"));
      const entered = join(directory, "entered.json");
      const ready = join(directory, "server.json");
      const result = join(directory, "result.json");
      const exitStatus = scenario === "remove-seven" ? 7 : 0;
      const server = `const fs = require("node:fs"); const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, port: server.address().port })));`;
      const failure =
        scenario === "ownership-read"
          ? `const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(server)}], { detached: true, stdio: "ignore", env: { ...process.env, NODE_OPTIONS: "" } }); child.unref(); const wait = new Int32Array(new SharedArrayBuffer(4)); const deadline = Date.now() + 5000; while (!fs.existsSync(${JSON.stringify(ready)})) { if (Date.now() >= deadline) process.exit(9); Atomics.wait(wait, 0, 0, 5); } fs.writeFileSync(${JSON.stringify(entered)}, JSON.stringify({ directory, pid: process.pid })); fs.rmSync(directory, { recursive: true }); fs.writeFileSync(directory, "directory unavailable"); setInterval(() => {}, 1000);`
          : `const blocked = path.join(directory, "blocked"); fs.mkdirSync(blocked); fs.writeFileSync(path.join(blocked, "retained"), "retain until permissions restored"); fs.chmodSync(blocked, 0); fs.writeFileSync(${JSON.stringify(entered)}, JSON.stringify({ directory, blocked, pid: process.pid })); process.exit(${exitStatus});`;
      const launcher = `const fs = require("node:fs"); const path = require("node:path"); const directory = process.env.SLOP_BROWSER_OWNERSHIP_DIRECTORY; ${failure}`;
      const runner = pathToFileURL(
        join(process.cwd(), "scripts/run-e2e-phase.mjs"),
      ).href;
      const options = {
        label: `browser-io-${scenario}`,
        args: ["-e", launcher],
        cwd: directory,
        browserOwnership: true,
        timeoutMs: 8000,
      };
      const script = `import { writeFileSync } from "node:fs"; import { runE2ePhase } from ${JSON.stringify(runner)}; let exits = 0; const status = await runE2ePhase({ ...${JSON.stringify(options)}, command: process.execPath, env: process.env, onExit: () => { exits += 1; } }); writeFileSync(${JSON.stringify(result)}, JSON.stringify({ status, exits }));`;
      const supervisor = Bun.spawn(
        ["node", "--input-type=module", "-e", script],
        { stdout: "ignore", stderr: "pipe" },
      );
      const diagnostics = new Response(supervisor.stderr).text();
      let stopped = false;
      try {
        const status = await supervisor.exited;
        const stderr = await diagnostics;
        if (status !== 0)
          throw new Error(`Supervisor exited ${status}: ${stderr}`);
        expect(existsSync(result)).toBe(true);
        expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
          status: exitStatus || 1,
          exits: 1,
        });
        expect(stderr).toContain("process cleanup failed");
        expect(stderr).toMatch(
          // Cleanup may read the path after removal and before replacement.
          scenario === "ownership-read" ? /ENOTDIR|ENOENT/ : /EACCES|ENOTEMPTY/,
        );
        if (scenario === "ownership-read") {
          const observed = JSON.parse(readFileSync(ready, "utf8"));
          await portReusable(observed.port);
        }
        stopped = true;
      } finally {
        await supervisor.exited;
        if (existsSync(entered)) {
          const observed = JSON.parse(readFileSync(entered, "utf8"));
          if (!stopped) {
            killOwned(observed.pid);
            if (existsSync(ready))
              killOwned(JSON.parse(readFileSync(ready, "utf8")).pid);
          }
          if (observed.blocked && existsSync(observed.blocked))
            chmodSync(observed.blocked, 0o700);
          rmSync(observed.directory, { recursive: true, force: true });
        }
        rmSync(directory, { recursive: true, force: true });
      }
    },
    25_000,
  );
}
