/** Copied-module filesystem/finalizer regressions; no browser or capture acceptance. */
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
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), "slop-evidence-publication-"));
    try {
      const scripts = join(root, "scripts");
      mkdirSync(scripts);
      for (const file of ["evidence-bundle.mjs", "sha256.mjs"]) {
        copyFileSync(resolve("scripts", file), join(scripts, file));
      }
      const runner = join(root, "case.mjs");
      writeFileSync(
        runner,
        `
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import { join, basename } from 'node:path';
        import { syncBuiltinESMExports } from 'node:module';
        const native = { rename: fs.renameSync, rm: fs.rmSync, mkdir: fs.mkdirSync };
        const root = ${JSON.stringify(root)};
        const finalRoot = join(root, 'evidence');
        native.mkdir(finalRoot);
        fs.writeFileSync(join(finalRoot, 'marker'), 'old');
        const marker = path => fs.readFileSync(join(path, 'marker'), 'utf8');
        const backups = () => fs.readdirSync(root).filter(name => name.startsWith('.evidence-backup-'));
        const captured = operation => {
          try { operation(); } catch (error) { return error; }
          throw new Error('Expected synchronous fixture failure');
        };
        const rejected = async operation => {
          try { await operation(); } catch (error) { return error; }
          throw new Error('Expected asynchronous fixture failure');
        };
        const { beginEvidenceTransaction, withEvidenceCleanup } = await import(${JSON.stringify(pathToFileURL(join(scripts, "evidence-bundle.mjs")).href)});
        const candidate = () => {
          const tx = beginEvidenceTransaction(finalRoot);
          fs.writeFileSync(join(tx.stagingRoot, 'marker'), 'new');
          return tx;
        };
        ${body}
        process.stdout.write('fixture passed');
      `,
      );
      const result = spawnSync("node", [runner], {
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("fixture passed");
    } finally {
      // The child finishes before its isolated retained recovery inputs are removed.
      rmSync(root, { recursive: true, force: true });
    }
  });
}

publicationCase(
  "clean evidence publication closes staging and preserves the new bundle",
  String.raw`
  const tx = candidate();
  tx.publish();
  assert.equal(marker(finalRoot), 'new');
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.deepEqual(backups(), []);
  tx.abort();
  assert.equal(marker(finalRoot), 'new');
  assert.match(captured(() => tx.publish()).message, /already published/);
`,
);

publicationCase(
  "first evidence publication needs no previous bundle",
  String.raw`
  native.rm(finalRoot, { recursive: true });
  const tx = candidate();
  tx.publish();
  tx.abort();
  assert.equal(marker(finalRoot), 'new');
  assert.deepEqual(backups(), []);
`,
);

publicationCase(
  "failure moving the old bundle preserves its original error and contents",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture previous move failed');
  fs.renameSync = (from, to) => {
    if (from === finalRoot) throw primary;
    return native.rename(from, to);
  };
  syncBuiltinESMExports();
  const error = captured(() => tx.publish());
  assert.equal(error.cause, primary);
  assert.match(error.message, /before commit/);
  assert.equal(marker(finalRoot), 'old');
  assert.equal(marker(tx.stagingRoot), 'new');
  tx.abort();
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.equal(marker(finalRoot), 'old');
`,
);

publicationCase(
  "failed activation restores the old bundle before staging abort",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture activation failed');
  fs.renameSync = (from, to) => {
    if (from === tx.stagingRoot && to === finalRoot) throw primary;
    return native.rename(from, to);
  };
  syncBuiltinESMExports();
  const error = captured(() => tx.publish());
  assert.equal(error.cause, primary);
  assert.equal(marker(finalRoot), 'old');
  assert.equal(marker(tx.stagingRoot), 'new');
  assert.deepEqual(backups(), []);
  tx.abort();
  assert.equal(fs.existsSync(tx.stagingRoot), false);
`,
);

publicationCase(
  "backup cleanup failure truthfully retains a committed new bundle",
  String.raw`
  const tx = candidate();
  const cleanup = new Error('fixture backup cleanup failed');
  fs.rmSync = (path, options) => {
    if (basename(String(path)).startsWith('.evidence-backup-')) throw cleanup;
    return native.rm(path, options);
  };
  syncBuiltinESMExports();
  const error = captured(() => tx.publish());
  assert.equal(error.cause, cleanup);
  assert.match(error.message, /evidence bundle was published/);
  assert.equal(marker(finalRoot), 'new');
  assert.equal(backups().length, 1);
  assert.equal(marker(join(root, backups()[0])), 'old');
  tx.abort();
  assert.equal(marker(finalRoot), 'new');
  assert.equal(backups().length, 1);
  assert.match(captured(() => tx.publish()).message, /already published/);
`,
);

publicationCase(
  "failed restoration preserves the primary error and both recovery inputs",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture activation failure');
  const recovery = new Error('fixture restoration failure');
  fs.renameSync = (from, to) => {
    if (from === tx.stagingRoot && to === finalRoot) throw primary;
    if (basename(String(from)).startsWith('.evidence-backup-')) throw recovery;
    return native.rename(from, to);
  };
  syncBuiltinESMExports();
  const error = captured(() => tx.publish());
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, primary);
  assert.deepEqual(error.errors, [primary, recovery]);
  assert.match(error.message, /Preserve/);
  assert.equal(fs.existsSync(finalRoot), false);
  assert.equal(marker(tx.stagingRoot), 'new');
  assert.equal(backups().length, 1);
  assert.equal(marker(join(root, backups()[0])), 'old');
  tx.abort();
  assert.equal(marker(tx.stagingRoot), 'new');
  assert.equal(backups().length, 1);
  assert.match(captured(() => tx.publish()).message, /already recovery-required/);
`,
);

publicationCase(
  "a competing published directory is preserved with both recovery candidates",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture competing activation');
  fs.renameSync = (from, to) => {
    if (from === tx.stagingRoot && to === finalRoot) {
      native.mkdir(finalRoot);
      fs.writeFileSync(join(finalRoot, 'marker'), 'winner');
      throw primary;
    }
    return native.rename(from, to);
  };
  syncBuiltinESMExports();
  const error = captured(() => tx.publish());
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, primary);
  assert.match(error.message, /another directory occupies/);
  tx.abort();
  assert.equal(marker(finalRoot), 'winner');
  assert.equal(marker(tx.stagingRoot), 'new');
  assert.equal(marker(join(root, backups()[0])), 'old');
  assert.match(captured(() => tx.publish()).message, /already recovery-required/);
`,
);

publicationCase(
  "failed staging abort stays retryable without touching the old bundle",
  String.raw`
  const tx = candidate();
  const cleanup = new Error('fixture abort failed');
  fs.rmSync = (path, options) => {
    if (path === tx.stagingRoot) throw cleanup;
    return native.rm(path, options);
  };
  syncBuiltinESMExports();
  assert.equal(captured(() => tx.abort()), cleanup);
  assert.equal(marker(tx.stagingRoot), 'new');
  assert.equal(marker(finalRoot), 'old');
  fs.rmSync = native.rm;
  syncBuiltinESMExports();
  tx.abort();
  tx.abort();
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.equal(marker(finalRoot), 'old');
  assert.match(captured(() => tx.publish()).message, /already aborted/);
`,
);

publicationCase(
  "successful finalization returns the operation value after both cleanups",
  String.raw`
  const order = [];
  const value = { captured: true };
  const result = await withEvidenceCleanup(async () => { order.push('operation'); return value; }, [
    { label: 'preview', run: async () => { await Promise.resolve(); order.push('preview'); } },
    { label: 'abort', run: () => { order.push('abort'); } },
  ]);
  assert.equal(result, value);
  assert.deepEqual(order, ['operation', 'preview', 'abort']);
`,
);

publicationCase(
  "clean finalizers preserve the original thrown operation identity",
  String.raw`
  const primary = new Error('fixture capture failure');
  const order = [];
  const error = await rejected(() => withEvidenceCleanup(async () => { throw primary; }, [
    { label: 'preview', run: () => { order.push('preview'); } },
    { label: 'abort', run: () => { order.push('abort'); } },
  ]));
  assert.equal(error, primary);
  assert.deepEqual(order, ['preview', 'abort']);
`,
);

publicationCase(
  "preview and abort failures are retained after the primary capture failure",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture capture failure');
  const preview = new Error('fixture preview shutdown failure');
  const abort = new Error('fixture abort failure');
  const order = [];
  fs.rmSync = (path, options) => {
    if (path === tx.stagingRoot) throw abort;
    return native.rm(path, options);
  };
  syncBuiltinESMExports();
  const error = await rejected(() => withEvidenceCleanup(async () => { throw primary; }, [
    { label: 'preview shutdown', run: () => { order.push('preview'); throw preview; } },
    { label: 'evidence staging cleanup', run: () => { order.push('abort'); tx.abort(); } },
  ]));
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, primary);
  assert.deepEqual(error.errors, [primary, preview, abort]);
  assert.deepEqual(order, ['preview', 'abort']);
  assert.match(error.message, /preview shutdown: fixture preview shutdown failure/);
  assert.match(error.message, /evidence staging cleanup: fixture abort failure/);
  assert.equal(marker(finalRoot), 'old');
  assert.equal(marker(tx.stagingRoot), 'new');
  fs.rmSync = native.rm;
  syncBuiltinESMExports();
  tx.abort();
`,
);

publicationCase(
  "preview shutdown failure cannot skip a successful staging abort",
  String.raw`
  const tx = candidate();
  const preview = new Error('fixture preview shutdown failure');
  const error = await rejected(() => withEvidenceCleanup(async () => 'capture completed', [
    { label: 'preview shutdown', run: () => { throw preview; } },
    { label: 'evidence staging cleanup', run: () => tx.abort() },
  ]));
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [preview]);
  assert.match(error.message, /operation completed, but cleanup failed/);
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.equal(marker(finalRoot), 'old');
`,
);

publicationCase(
  "nested browser cleanup preserves capture failure through outer cleanup",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture browser capture failed');
  const browser = new Error('fixture browser close failed');
  const preview = new Error('fixture preview close failed');
  let inner;
  const error = await rejected(() => withEvidenceCleanup(async () => {
    try {
      await withEvidenceCleanup(async () => { throw primary; }, [
        { label: 'browser close', run: () => { throw browser; } },
      ]);
    } catch (failure) { inner = failure; throw failure; }
  }, [
    { label: 'preview shutdown', run: () => { throw preview; } },
    { label: 'evidence staging cleanup', run: () => tx.abort() },
  ]));
  assert.ok(inner instanceof AggregateError);
  assert.equal(inner.cause, primary);
  assert.deepEqual(inner.errors, [primary, browser]);
  assert.equal(error.cause, inner);
  assert.deepEqual(error.errors, [inner, preview]);
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.equal(marker(finalRoot), 'old');
`,
);

publicationCase(
  "video-directory setup failure still reaches both owned finalizers",
  String.raw`
  const tx = candidate();
  const primary = new Error('fixture video directory failed');
  const order = [];
  fs.mkdirSync = (path, options) => {
    if (path === join(tx.stagingRoot, '.video')) throw primary;
    return native.mkdir(path, options);
  };
  syncBuiltinESMExports();
  const error = await rejected(() => withEvidenceCleanup(async () => {
    fs.mkdirSync(join(tx.stagingRoot, '.video'), { recursive: true });
  }, [
    { label: 'preview shutdown', run: () => { order.push('preview'); } },
    { label: 'evidence staging cleanup', run: () => { order.push('abort'); tx.abort(); } },
  ]));
  assert.equal(error, primary);
  assert.deepEqual(order, ['preview', 'abort']);
  assert.equal(fs.existsSync(tx.stagingRoot), false);
  assert.equal(marker(finalRoot), 'old');
`,
);

publicationCase(
  "post-publication preview failure keeps committed evidence and reports failure",
  String.raw`
  const tx = candidate();
  const preview = new Error('fixture final preview shutdown failed');
  let reported = false;
  const error = await rejected(async () => {
    await withEvidenceCleanup(async () => tx.publish(), [
      { label: 'preview shutdown', run: () => { throw preview; } },
      { label: 'evidence staging cleanup', run: () => tx.abort() },
    ]);
    reported = true;
  });
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [preview]);
  assert.equal(reported, false);
  assert.equal(marker(finalRoot), 'new');
  assert.equal(fs.existsSync(tx.stagingRoot), false);
`,
);
