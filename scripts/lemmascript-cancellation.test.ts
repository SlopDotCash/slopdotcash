/** Real Node checker/descendant lifecycle; the controlled command proves no theorem. */
import { expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function portIsReusable(port: number) {
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

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  test.skipIf(process.platform === "win32")(
    `LemmaScript checker ${signal} stops its owned descendant and records cancellation`,
    async () => {
      const root = process.cwd();
      const fixture = mkdtempSync(join(tmpdir(), "slop-proof-cancel-"));
      const ready = join(fixture, "ready.json");
      for (const path of [
        "scripts/check-lemmascript.mjs",
        "scripts/run-e2e-phase.mjs",
        "scripts/lemmascript-integrity.mjs",
        "scripts/lemmascript-source-directories.mjs",
        "package.json",
        "bun.lock",
        "lemmascript.json",
        "biome.json",
        ".gitignore",
      ]) {
        mkdirSync(dirname(join(fixture, path)), { recursive: true });
        copyFileSync(join(root, path), join(fixture, path));
      }
      mkdirSync(join(fixture, "src"));
      writeFileSync(
        join(fixture, "src/fixture.ts"),
        "export const fixture = 1;\n",
      );
      writeFileSync(join(fixture, "LemmaScript-files.txt"), "src/fixture.ts\n");
      mkdirSync(join(fixture, "node_modules/.bin"), { recursive: true });
      symlinkSync(
        join(root, "node_modules/lemmascript"),
        join(fixture, "node_modules/lemmascript"),
        "dir",
      );
      const command = join(fixture, "fake-lsc.cjs");
      const descendant = `const fs=require("node:fs"); const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{fs.writeFileSync(${JSON.stringify(`${ready}.tmp`)},JSON.stringify({launcher:process.ppid,descendant:process.pid,port:server.address().port}));fs.renameSync(${JSON.stringify(`${ready}.tmp`)},${JSON.stringify(ready)});});`;
      writeFileSync(
        command,
        `#!/usr/bin/env node\nrequire("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"inherit"}); console.log("0.6.6"); setInterval(()=>{},1000);\n`,
      );
      chmodSync(command, 0o755);
      symlinkSync(command, join(fixture, "node_modules/.bin/lsc"));
      const checker = Bun.spawn(["node", "scripts/check-lemmascript.mjs"], {
        cwd: fixture,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = Promise.all([
        new Response(checker.stdout).text(),
        new Response(checker.stderr).text(),
      ]);
      let ended = false;
      const exited = checker.exited.then((status) => {
        ended = true;
        return status;
      });
      let owned: {
        launcher: number;
        descendant: number;
        port: number;
      } | null = null;
      try {
        const deadline = Date.now() + 10_000;
        while (!existsSync(ready) && !ended && Date.now() < deadline)
          await pause(25);
        if (!existsSync(ready)) {
          if (ended) throw new Error((await output).join("\n"));
          throw new Error("Controlled proof command did not start");
        }
        owned = JSON.parse(readFileSync(ready, "utf8"));
        if (!owned) throw new Error("Missing owned process record");
        await expect(portIsReusable(owned.port)).rejects.toHaveProperty(
          "code",
          "EADDRINUSE",
        );
        checker.kill(signal);
        const status = await Promise.race([
          exited,
          pause(10_000).then(() => {
            throw new Error("Checker cancellation did not finish");
          }),
        ]);
        expect(status).toBe(1);
        await portIsReusable(owned.port);
        const evidence = join(fixture, "evidence/lemmascript");
        const runs = readdirSync(evidence);
        expect(runs).toHaveLength(1);
        const result = JSON.parse(
          readFileSync(join(evidence, runs[0], "result.json"), "utf8"),
        );
        expect(result.passed).toBe(false);
        expect(result.canceled).toBe(true);
        expect(result.requestedSignal).toBe(signal);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].label).toBe("lemmascript-version");
        expect(result.results[0].phaseExitCode).toBe(1);
        expect(result.obligations).toEqual([]);
      } finally {
        if (!ended) checker.kill("SIGKILL");
        if (owned) {
          try {
            process.kill(-owned.launcher, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        await exited;
        await output;
        rmSync(fixture, { recursive: true, force: true });
      }
    },
    30_000,
  );
}
