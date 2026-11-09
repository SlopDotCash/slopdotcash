/** Copied production module with isolated filesystem failures. */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function publicationCase(name: string, body: string) {
  test.skipIf(process.platform === "win32")(name, () => {
    const root = mkdtempSync(join(tmpdir(), "slop-lock-publication-"));
    try {
      const scripts = join(root, "scripts");
      const bin = join(root, "bin");
      mkdirSync(scripts);
      mkdirSync(bin);
      for (const file of ["live-report.mjs", "run-receipt.mjs"]) {
        copyFileSync(
          resolve("skills/project-contributor-template/scripts", file),
          join(scripts, file),
        );
      }
      writeFileSync(
        join(root, "project.json"),
        JSON.stringify({ repositoryId: "example/project" }),
      );
      const launched = join(root, "launched");
      writeFileSync(
        join(bin, "gh"),
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(launched)}, 'unexpected launch');\n`,
        { mode: 0o700 },
      );
      const runner = join(root, "case.mjs");
      writeFileSync(
        runner,
        `
          import assert from 'node:assert/strict';
          import fs from 'node:fs';
          import { createHash } from 'node:crypto';
          import { join } from 'node:path';
          import { syncBuiltinESMExports } from 'node:module';
          const original = {
            rm: fs.rmSync, rename: fs.renameSync, rmdir: fs.rmdirSync,
            write: fs.writeFileSync,
          };
          const locks = ${JSON.stringify(join(root, "locks"))};
          const launched = ${JSON.stringify(launched)};
          const key = createHash('sha256').update('github.com:42').digest('hex');
          const lockPath = join(locks, key + '.lock');
          const guard = lockPath + '.transition';
          const identity = { id: 42, login: 'fixture', host: 'github.com' };
          const load = () => import(${JSON.stringify(pathToFileURL(join(scripts, "live-report.mjs")).href)});
          const captured = (operation) => {
            try { operation(); } catch (error) { return error; }
            throw new Error('Expected a fixture failure');
          };
          const candidates = () => fs.readdirSync(locks).filter(name => name.includes('.candidate-'));
          const stale = () => fs.readdirSync(locks).filter(name => name.includes('.stale-'));
          const seedStale = () => {
            fs.mkdirSync(locks, { mode: 0o700 });
            fs.mkdirSync(lockPath, { mode: 0o700 });
            fs.mkdirSync(join(lockPath, 'commands'), { mode: 0o700 });
            original.write(join(lockPath, 'owner.json'), JSON.stringify({
              schemaVersion: 2, pid: process.pid,
              processIdentity: '0'.repeat(64), ownerToken: 'a'.repeat(32),
            }), { mode: 0o600 });
          };
          ${body}
          assert.equal(fs.existsSync(launched), false);
          process.stdout.write('fixture passed');
        `,
      );
      const result = spawnSync("node", [runner], {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("fixture passed");
    } finally {
      // The isolated synchronous child has exited before its owned paths are removed.
      rmSync(root, { recursive: true, force: true });
    }
  });
}

publicationCase(
  "a published candidate is not removed through its former path",
  String.raw`
  let absentCandidateRemovals = 0;
  fs.rmSync = (path, options) => {
    if (String(path).includes('.candidate-') && !fs.existsSync(path)) {
      absentCandidateRemovals += 1;
      throw new Error('The moved candidate must not be cleaned again');
    }
    return original.rm(path, options);
  };
  syncBuiltinESMExports();
  const { acquireLiveReportLock } = await load();
  const lock = acquireLiveReportLock(identity, { rootPath: locks });
  assert.equal(fs.existsSync(lockPath), true);
  lock.release();
  assert.equal(absentCandidateRemovals, 0);
  assert.deepEqual(fs.readdirSync(locks), []);
`,
);

publicationCase(
  "candidate preparation preserves its first failure when cleanup also fails",
  String.raw`
  const primary = new Error('fixture owner write failed');
  fs.writeFileSync = (path, ...args) => {
    if (String(path).includes('.candidate-') && String(path).endsWith('/owner.json')) throw primary;
    return original.write(path, ...args);
  };
  fs.rmSync = (path, options) => {
    if (String(path).includes('.candidate-')) throw new Error('fixture candidate cleanup failed');
    return original.rm(path, options);
  };
  syncBuiltinESMExports();
  const { acquireLiveReportLock } = await load();
  assert.equal(captured(() => acquireLiveReportLock(identity, { rootPath: locks })), primary);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(guard), false);
  assert.equal(candidates().length, 1);
  fs.writeFileSync = original.write;
  fs.rmSync = original.rm;
  syncBuiltinESMExports();
  const retry = acquireLiveReportLock(identity, { rootPath: locks });
  retry.release();
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(candidates().length, 1);
`,
);

publicationCase(
  "candidate cleanup cannot replace live-owner contention",
  String.raw`
  const { acquireLiveReportLock, LiveReportLockContentionError } = await load();
  const owner = acquireLiveReportLock(identity, { rootPath: locks });
  const before = fs.readFileSync(join(lockPath, 'owner.json'), 'utf8');
  fs.rmSync = (path, options) => {
    if (String(path).includes('.candidate-')) throw new Error('fixture contended candidate cleanup failed');
    return original.rm(path, options);
  };
  syncBuiltinESMExports();
  const error = captured(() => acquireLiveReportLock(identity, { rootPath: locks }));
  assert.ok(error instanceof LiveReportLockContentionError);
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), before);
  assert.equal(fs.existsSync(guard), false);
  fs.rmSync = original.rm;
  syncBuiltinESMExports();
  owner.release();
`,
);

publicationCase(
  "a failed publication leaves the dead quarantine separate and permits retry",
  String.raw`
  seedStale();
  const primary = new Error('fixture new owner rename failed');
  fs.renameSync = (source, target) => {
    if (String(source).includes('.candidate-') && target === lockPath) throw primary;
    return original.rename(source, target);
  };
  fs.rmSync = (path, options) => {
    if (String(path).includes('.candidate-')) throw new Error('fixture failed publication cleanup');
    return original.rm(path, options);
  };
  syncBuiltinESMExports();
  const { acquireLiveReportLock, readLiveReportProcessIdentity } = await load();
  assert.notEqual(readLiveReportProcessIdentity(process.pid), '0'.repeat(64));
  assert.equal(captured(() => acquireLiveReportLock(identity, { rootPath: locks })), primary);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(guard), false);
  assert.equal(stale().length, 1);
  fs.renameSync = original.rename;
  fs.rmSync = original.rm;
  syncBuiltinESMExports();
  const retry = acquireLiveReportLock(identity, { rootPath: locks });
  retry.release();
  assert.equal(stale().length, 1);
`,
);

for (const failCandidateCleanup of [false, true]) {
  publicationCase(
    `failed stale cleanup rolls back before same-process retry${failCandidateCleanup ? " even when candidate cleanup fails" : ""}`,
    String.raw`
      seedStale();
      const primary = new Error('fixture partial stale cleanup failed');
      let rolledBack = false;
      fs.renameSync = (source, target) => {
        const result = original.rename(source, target);
        if (source === lockPath && String(target).includes('.candidate-')) rolledBack = true;
        return result;
      };
      fs.rmSync = (path, options) => {
        if (String(path).includes('.stale-')) {
          original.rm(join(path, 'owner.json'), { force: true });
          throw primary;
        }
        if (${failCandidateCleanup} && String(path).includes('.candidate-')) {
          throw new Error('fixture rollback candidate cleanup failed');
        }
        return original.rm(path, options);
      };
      syncBuiltinESMExports();
      const { acquireLiveReportLock } = await load();
      let returned;
      const error = captured(() => { returned = acquireLiveReportLock(identity, { rootPath: locks }); });
      assert.equal(error, primary);
      assert.equal(returned, undefined);
      assert.equal(rolledBack, true);
      assert.equal(fs.existsSync(lockPath), false);
      assert.equal(fs.existsSync(guard), false);
      assert.equal(stale().length, 1);
      assert.equal(fs.existsSync(join(locks, stale()[0], 'owner.json')), false);
      assert.equal(candidates().length, ${failCandidateCleanup ? 1 : 0});
      fs.renameSync = original.rename;
      fs.rmSync = original.rm;
      syncBuiltinESMExports();
      const retry = acquireLiveReportLock(identity, { rootPath: locks });
      assert.equal(fs.existsSync(lockPath), true);
      retry.release();
      assert.equal(fs.existsSync(lockPath), false);
      assert.equal(stale().length, 1);
    `,
  );
}

publicationCase(
  "failed rollback reports committed ownership and retains both failure identities",
  String.raw`
  seedStale();
  const primary = new Error('fixture stale removal failed');
  const rollback = new Error('fixture rollback rename failed');
  fs.rmSync = (path, options) => {
    if (String(path).includes('.stale-')) throw primary;
    return original.rm(path, options);
  };
  fs.renameSync = (source, target) => {
    if (source === lockPath && String(target).includes('.candidate-')) throw rollback;
    return original.rename(source, target);
  };
  syncBuiltinESMExports();
  const { acquireLiveReportLock, LiveReportLockContentionError } = await load();
  const error = captured(() => acquireLiveReportLock(identity, { rootPath: locks }));
  assert.match(error.message, /ownership was acquired/);
  assert.match(error.message, /manual recovery/);
  assert.match(error.message, /fixture stale removal failed/);
  assert.match(error.message, /fixture rollback rename failed/);
  assert.ok(error.cause instanceof AggregateError);
  assert.equal(error.cause.errors[0], primary);
  assert.equal(error.cause.errors[1], rollback);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(guard), false);
  assert.equal(JSON.parse(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8')).pid, process.pid);
  assert.ok(captured(() => acquireLiveReportLock(identity, { rootPath: locks })) instanceof LiveReportLockContentionError);
`,
);

publicationCase(
  "acquisition guard cleanup failure retains the committed owner without a handle",
  String.raw`
  const primary = new Error('fixture acquisition guard cleanup failed');
  fs.rmdirSync = (path, ...args) => {
    if (path === guard) throw primary;
    return original.rmdir(path, ...args);
  };
  syncBuiltinESMExports();
  const { acquireLiveReportLock, LiveReportLockContentionError } = await load();
  let returned;
  const error = captured(() => { returned = acquireLiveReportLock(identity, { rootPath: locks }); });
  assert.equal(returned, undefined);
  assert.match(error.message, /ownership was acquired/);
  assert.match(error.message, /manual recovery/);
  assert.equal(error.cause, primary);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(guard), true);
  const retry = captured(() => acquireLiveReportLock(identity, { rootPath: locks }));
  assert.ok(retry instanceof LiveReportLockContentionError);
  assert.match(retry.message, /transition guard/);
  assert.equal(fs.existsSync(guard), true);
`,
);

publicationCase(
  "release cleanup retries touch only the saved tombstone after a successor acquires",
  String.raw`
  const { acquireLiveReportLock } = await load();
  const first = acquireLiveReportLock(identity, { rootPath: locks });
  let failRemoval = true;
  let savedPath;
  fs.rmSync = (path, options) => {
    if (String(path).includes('.released-')) {
      savedPath ??= path;
      if (path === savedPath && failRemoval) throw new Error('fixture released tombstone cleanup failed');
    }
    return original.rm(path, options);
  };
  syncBuiltinESMExports();
  assert.match(captured(() => first.release()).message, /ownership was released/);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(savedPath), true);
  assert.match(captured(() => first.spawn('gh', ['api', 'fixture'])).message, /already released/);
  const successor = acquireLiveReportLock(identity, { rootPath: locks });
  const successorBytes = fs.readFileSync(join(lockPath, 'owner.json'), 'utf8');
  assert.match(captured(() => first.release()).message, /ownership was released/);
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), successorBytes);
  failRemoval = false;
  first.release();
  assert.equal(fs.existsSync(savedPath), false);
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), successorBytes);
  // A completed old release is a no-op even while the successor still owns it.
  first.release();
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), successorBytes);
  successor.release();
  assert.deepEqual(fs.readdirSync(locks), []);
`,
);

publicationCase(
  "release guard cleanup failure remains blocked on every retry",
  String.raw`
  const { acquireLiveReportLock, LiveReportLockContentionError } = await load();
  const owner = acquireLiveReportLock(identity, { rootPath: locks });
  const primary = new Error('fixture release guard cleanup failed');
  fs.rmdirSync = (path, ...args) => {
    if (path === guard) throw primary;
    return original.rmdir(path, ...args);
  };
  syncBuiltinESMExports();
  const error = captured(() => owner.release());
  assert.match(error.message, /ownership was released/);
  assert.equal(error.cause, primary);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(guard), true);
  assert.match(captured(() => owner.spawn('gh', ['api', 'fixture'])).message, /already released/);
  assert.match(captured(() => owner.release()).message, /transition guard/);
  assert.ok(captured(() => acquireLiveReportLock(identity, { rootPath: locks })) instanceof LiveReportLockContentionError);
  assert.equal(fs.existsSync(guard), true);
`,
);

publicationCase(
  "a failed release rename keeps its owner and permits a later release",
  String.raw`
  const { acquireLiveReportLock } = await load();
  const owner = acquireLiveReportLock(identity, { rootPath: locks });
  const before = fs.readFileSync(join(lockPath, 'owner.json'), 'utf8');
  const primary = new Error('fixture release rename failed');
  fs.renameSync = (source, target) => {
    if (source === lockPath && String(target).includes('.released-')) throw primary;
    return original.rename(source, target);
  };
  syncBuiltinESMExports();
  assert.equal(captured(() => owner.release()), primary);
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), before);
  assert.equal(fs.existsSync(guard), false);
  fs.renameSync = original.rename;
  syncBuiltinESMExports();
  owner.release();
  assert.deepEqual(fs.readdirSync(locks), []);
`,
);
