/** Real helper/child lifetime, with one controlled lease-publication failure. */
import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test.skipIf(process.platform === "win32")(
  "a launched GitHub child stays leased through a bookkeeping failure and parent loss",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "slop-discovery-lifetime-"));
    const scripts = join(root, "scripts");
    const bin = join(root, "bin");
    const lockRoot = join(root, "locks");
    mkdirSync(scripts);
    mkdirSync(bin);
    for (const name of ["live-report.mjs", "run-receipt.mjs"])
      copyFileSync(
        resolve("skills/project-contributor-template/scripts", name),
        join(scripts, name),
      );
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({ repositoryId: "example/project" }),
    );
    const started = join(root, "child-started");
    const terminate = join(root, "termination-requested");
    const failed = join(root, "bookkeeping-failed");
    const stop = join(root, "stop-owned-child");
    const moduleUrl = pathToFileURL(join(scripts, "live-report.mjs")).href;
    const liveModule: {
      readLiveReportProcessIdentity(pid: number): string | null;
    } = await import(moduleUrl);
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
      const fs = require('node:fs');
      process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(terminate)}, 'requested'));
      import(${JSON.stringify(moduleUrl)}).then(({readLiveReportProcessIdentity}) => {
        const timer = setInterval(() => {
          if (fs.existsSync(${JSON.stringify(stop)})) { clearInterval(timer); process.exit(0); }
        }, 20);
        fs.writeFileSync(${JSON.stringify(started)}, JSON.stringify({
          pid: process.pid, processIdentity: readLiveReportProcessIdentity(process.pid),
        }));
      });
    `,
      { mode: 0o700 },
    );
    const preload = join(root, "lease-failure.mjs");
    writeFileSync(
      preload,
      `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (String(source).includes('/lease-') && String(source).includes('.next-')) {
        const deadline = Date.now() + 10_000;
        while (!fs.existsSync(${JSON.stringify(started)})) {
          if (Date.now() > deadline) throw new Error('fixture child did not start');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        fs.writeFileSync(${JSON.stringify(failed)}, 'failed');
        throw new Error('synthetic lease publication failure');
      }
      return rename(source, target);
    };
    syncBuiltinESMExports();
  `,
    );
    const runner = join(root, "owner.mjs");
    writeFileSync(
      runner,
      `
    import { acquireLiveReportLock } from ${JSON.stringify(moduleUrl)};
    const lock = acquireLiveReportLock({id: 42, login: 'fixture', host: 'github.com'},
      {rootPath: ${JSON.stringify(lockRoot)}});
    const result = lock.spawn('gh', ['api', 'repos/example/project/issues']);
    lock.release();
    process.exitCode = result.status ?? 1;
  `,
    );
    const contender = join(root, "contender.mjs");
    writeFileSync(
      contender,
      `
    import { acquireLiveReportLock, LiveReportLockContentionError } from ${JSON.stringify(moduleUrl)};
    try {
      const lock = acquireLiveReportLock({id: 42, login: 'fixture', host: 'github.com'},
        {rootPath: ${JSON.stringify(lockRoot)}});
      lock.release();
    } catch (error) {
      process.stderr.write(error.message);
      process.exitCode = error instanceof LiveReportLockContentionError ? 2 : 1;
    }
  `,
    );
    const owner = spawn("node", [runner], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      },
      stdio: "ignore",
    });
    const ownerExited = once(owner, "exit");
    const waitUntil = async (condition: () => boolean) => {
      const deadline = Date.now() + 10_000;
      while (!condition()) {
        if (Date.now() > deadline)
          throw new Error("owned fixture transition timed out");
        await Bun.sleep(20);
      }
    };
    let helper: { pid: number; processIdentity: string } | null = null;
    try {
      await waitUntil(() => existsSync(failed));
      const lockDirectory = join(
        lockRoot,
        readdirSync(lockRoot).find((name) => name.endsWith(".lock")) ??
          "missing",
      );
      const commands = join(lockDirectory, "commands");
      // A failed replacement can still have its .next staging file here.
      // Count the published lease names used by the production lock reader.
      const leases = () =>
        readdirSync(commands).filter((name) =>
          /^lease-[a-f0-9]{32}\.json$/u.test(name),
        );
      expect(leases()).toHaveLength(1);
      helper = JSON.parse(
        readFileSync(join(commands, leases()[0]), "utf8"),
      ).helper;
      await waitUntil(() => existsSync(terminate));
      owner.kill("SIGKILL");
      await ownerExited;
      const blocked = spawnSync("node", [contender], {
        encoding: "utf8",
        cwd: root,
      });
      expect(blocked.status, blocked.stderr).toBe(2);
      writeFileSync(stop, "stop");
      await waitUntil(() => leases().length === 0);
      const recovered = spawnSync("node", [contender], {
        encoding: "utf8",
        cwd: root,
      });
      expect(recovered.status, recovered.stderr).toBe(0);
    } finally {
      writeFileSync(stop, "stop");
      if (owner.exitCode === null && owner.signalCode === null)
        owner.kill("SIGKILL");
      await ownerExited;
      const descendants: { pid: number; processIdentity: string }[] = [];
      if (existsSync(started))
        descendants.push(JSON.parse(readFileSync(started, "utf8")));
      if (helper) descendants.push(helper);
      if (existsSync(lockRoot)) {
        for (const name of readdirSync(lockRoot)) {
          if (!name.endsWith(".lock")) continue;
          const commands = join(lockRoot, name, "commands");
          if (!existsSync(commands)) continue;
          for (const entry of readdirSync(commands)) {
            if (!entry.startsWith("lease-")) continue;
            try {
              descendants.push(
                JSON.parse(readFileSync(join(commands, entry), "utf8")).helper,
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                // biome-ignore lint/correctness/noUnsafeFinally: corrupt fixture lease data must fail cleanup; only an exited child may remove it.
                throw error;
            }
          }
        }
      }
      for (const owned of descendants) {
        const stopped = () =>
          liveModule.readLiveReportProcessIdentity(owned.pid) !==
          owned.processIdentity;
        try {
          await waitUntil(stopped);
        } catch {
          if (!stopped()) process.kill(owned.pid, "SIGKILL");
          await waitUntil(stopped);
        }
      }
      // Before the observed bookkeeping boundary an interrupted helper may
      // still be starting. Keep its stop marker available rather than deleting
      // the only instruction that makes a late fixture child exit immediately.
      if (existsSync(failed)) rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);

for (const record of ["lease", "request"] as const) {
  test.skipIf(process.platform === "win32")(
    `a failed GitHub command retains its output and exit status when ${record} cleanup also fails`,
    () => {
      const root = mkdtempSync(join(tmpdir(), "slop-discovery-exit-"));
      try {
        const scripts = join(root, "scripts");
        const bin = join(root, "bin");
        mkdirSync(scripts);
        mkdirSync(bin);
        for (const name of ["live-report.mjs", "run-receipt.mjs"])
          copyFileSync(
            resolve("skills/project-contributor-template/scripts", name),
            join(scripts, name),
          );
        writeFileSync(
          join(root, "project.json"),
          JSON.stringify({ repositoryId: "example/project" }),
        );
        writeFileSync(
          join(bin, "gh"),
          "#!/usr/bin/env node\nprocess.stdout.write('fixture output\\n'); process.stderr.write('fixture failure\\n'); process.exitCode = 7;\n",
          { mode: 0o700 },
        );
        const preload = join(root, "cleanup-failure.mjs");
        writeFileSync(
          preload,
          `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        const remove = fs.rmSync;
        fs.rmSync = (path, options) => {
          if (String(path).includes('/${record}-') && String(path).endsWith('.json'))
            throw new Error('synthetic ${record} cleanup failure');
          return remove(path, options);
        };
        syncBuiltinESMExports();
      `,
        );
        const runner = join(root, "owner.mjs");
        writeFileSync(
          runner,
          `
        import { acquireLiveReportLock } from ${JSON.stringify(pathToFileURL(join(scripts, "live-report.mjs")).href)};
        const lock = acquireLiveReportLock({id:42,login:'fixture',host:'github.com'}, {rootPath:${JSON.stringify(join(root, "locks"))}});
        const result = lock.spawn('gh', ['api', 'repos/example/project/issues']);
        lock.release();
        process.stdout.write(JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr}));
      `,
        );
        const result = spawnSync("node", [runner], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          },
        });
        expect(result.status, result.stderr).toBe(0);
        const command = JSON.parse(result.stdout);
        expect(command.status).toBe(7);
        expect(command.stdout).toContain("fixture output");
        expect(command.stderr).toContain("fixture failure");
        expect(command.stderr).toContain(`synthetic ${record} cleanup failure`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
