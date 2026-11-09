/** Real cycle validation and publication in isolated fixture checkouts. */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCheckout } from "../tests/fixture-checkout";

function publicationCase(name: string, setup: string, body: string) {
  test(name, () => {
    const root = fixtureCheckout("cycle-publication-");
    try {
      // The fixture already owns its frozen registry; isolate builtin mocks
      // from every other repository test and from the parent's module cache.
      writeFileSync(join(root, "fixture-preload.ts"), "export {};\n");
      writeFileSync(
        join(root, "bunfig.toml"),
        '[test]\npreload = ["./fixture-preload.ts"]\n',
      );
      const probe = join(root, "cycle-publication-probe.test.ts");
      writeFileSync(
        probe,
        `
        import { test, mock } from 'bun:test';
        import assert from 'node:assert/strict';
        import * as fs from 'node:fs/promises';
        import { join, basename } from 'node:path';
        import { CYCLE_INDEX_SCHEMA_VERSION, assertCycleIndex } from './src/lib/cycle-index';
        const native = {...fs};
        const overrides = {};
        const publicRoot = join(import.meta.dir,'public/data/cycles');
        const promotionPath = join(import.meta.dir,'src/lib/project-promotion.generated.json');
        const guard = publicRoot + '.publication-lock';
        const oldIndex = {schemaVersion:CYCLE_INDEX_SCHEMA_VERSION,generatedAt:'2026-10-01T00:00:00.000Z',cycles:[]};
        assertCycleIndex(oldIndex);
        const oldBytes = JSON.stringify(oldIndex);
        const oldPromotion = '[]\\n';
        let sync;
        const failure = async () => {
          try { await sync({generatedAt:'2026-11-01T00:00:00.000Z'}); }
          catch(error) { return error; }
          throw new Error('Expected publication to fail');
        };
        const oldPair = async () => {
          assert.equal(await native.readFile(join(publicRoot,'index.json'),'utf8'),oldBytes);
          assert.equal(await native.readFile(join(publicRoot,'previous-only.txt'),'utf8'),'old');
          assert.equal(await native.readFile(promotionPath,'utf8'),oldPromotion);
        };
        const newPair = async () => {
          const index=JSON.parse(await native.readFile(join(publicRoot,'index.json'),'utf8'));
          assertCycleIndex(index);
          assert.equal(index.generatedAt,'2026-11-01T00:00:00.000Z');
          assert.ok(index.cycles.length>0);
          const promotion=JSON.parse(await native.readFile(promotionPath,'utf8'));
          assert.equal(promotion.length,index.cycles.length);
          assert.equal(promotion[0].cycleId,index.cycles[0].cycleId);
          await assert.rejects(native.readFile(join(publicRoot,'previous-only.txt')));
        };
        test('isolated actual cycle publication', async () => {
          await native.rm(publicRoot,{force:true,recursive:true});
          await native.mkdir(publicRoot,{recursive:true});
          await native.writeFile(join(publicRoot,'index.json'),oldBytes);
          await native.writeFile(join(publicRoot,'previous-only.txt'),'old');
          await native.writeFile(promotionPath,oldPromotion);
          ${setup}
          mock.module('node:fs/promises',()=>({...native,...overrides}));
          ({syncCycleIndex:sync}=await import('./scripts/sync-cycle-index'));
          ${body}
        },60000);
      `,
      );
      const result = spawnSync(
        process.execPath,
        ["test", probe, "--timeout", "60000"],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 70_000,
          env: { ...process.env, TMPDIR: join(root, ".bun-tmp") },
        },
      );
      expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
}

publicationCase(
  "failed promotion staging keeps the prior outputs and releases the guard",
  String.raw`
  let fail=true;
  overrides.mkdtemp=async(prefix,...args)=>{
    if(fail && String(prefix).includes('.cycle-promotion-')) throw new Error('fixture promotion staging failure');
    return native.mkdtemp(prefix,...args);
  };
`,
  String.raw`
  assert.match((await failure()).message,/promotion staging failure/);
  await oldPair();
  await assert.rejects(native.stat(guard));
  fail=false;
  await sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  await newPair();
`,
);

publicationCase(
  "failed cycle writes drain siblings and preserve both prior outputs",
  String.raw`
  let fail=true, delayed=false, delayedSettled=false, cleanedTooSoon=false;
  overrides.writeFile=async(path,...args)=>{
    if(fail && String(path).includes('.staging-') && basename(String(path))==='proposal.json') {
      throw new Error('fixture proposal write failure');
    }
    if(fail && String(path).includes('.staging-') && basename(String(path))==='source-snapshot.json') {
      delayed=true;
      await new Promise(resolve=>setTimeout(resolve,40));
      try { return await native.writeFile(path,...args); }
      finally { delayedSettled=true; }
    }
    return native.writeFile(path,...args);
  };
  overrides.rm=async(path,options)=>{
    if(String(path).includes('.staging-') && delayed && !delayedSettled) cleanedTooSoon=true;
    return native.rm(path,options);
  };
`,
  String.raw`
  const error=await failure();
  assert.match(error.message,/proposal write failure/);
  assert.equal(delayed,true);
  assert.equal(delayedSettled,true);
  assert.equal(cleanedTooSoon,false);
  await oldPair();
  await assert.rejects(native.stat(guard));
  fail=false;
  await sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  await newPair();
`,
);

publicationCase(
  "failed public-tree activation restores the prior tree and promotion",
  String.raw`
  let fail=true;
  overrides.rename=async(from,to)=>{
    if(fail && to===publicRoot && String(from).includes('.staging-') && !String(from).endsWith('.previous')) {
      throw new Error('fixture tree activation failure');
    }
    return native.rename(from,to);
  };
`,
  String.raw`
  assert.match((await failure()).message,/tree activation failure/);
  await oldPair();
  await assert.rejects(native.stat(guard));
  fail=false;
  await sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  await newPair();
`,
);

publicationCase(
  "failed promotion activation retracts the new tree and restores the old pair",
  String.raw`
  let fail=true;
  overrides.rename=async(from,to)=>{
    if(fail && to===promotionPath && basename(String(from))==='next.json') {
      throw new Error('fixture promotion activation failure');
    }
    return native.rename(from,to);
  };
`,
  String.raw`
  assert.match((await failure()).message,/promotion activation failure/);
  await oldPair();
  await assert.rejects(native.stat(guard));
  fail=false;
  await sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  await newPair();
`,
);

publicationCase(
  "failed cycle restoration retains recovery paths and blocks another writer",
  String.raw`
  overrides.rename=async(from,to)=>{
    if(to===promotionPath && basename(String(from))==='next.json') throw new Error('fixture primary promotion failure');
    if(to===publicRoot && String(from).endsWith('.previous')) throw new Error('fixture tree restoration failure');
    return native.rename(from,to);
  };
`,
  String.raw`
  const error=await failure();
  assert.match(error.message,/primary promotion failure/);
  assert.match(error.message,/tree restoration failure/);
  assert.match(error.message,/recovery is incomplete/);
  await native.stat(guard);
  const retained=(await native.readdir(join(import.meta.dir,'public/data'))).filter(name=>name.includes('.staging-'));
  assert.ok(retained.some(name=>name.endsWith('.previous')));
  assert.ok(retained.some(name=>!name.endsWith('.previous')));
  assert.equal(await native.readFile(promotionPath,'utf8'),oldPromotion);
  const retry=await failure();
  assert.match(retry.message,/could not acquire/);
  assert.deepEqual((await native.readdir(join(import.meta.dir,'public/data'))).filter(name=>name.includes('.staging-')),retained);
`,
);

publicationCase(
  "backup cleanup failure reports a committed cycle pair",
  String.raw`
  let fail=true;
  overrides.rm=async(path,options)=>{
    if(fail && String(path).endsWith('.previous')) throw new Error('fixture previous-tree cleanup failure');
    return native.rm(path,options);
  };
`,
  String.raw`
  const error=await failure();
  assert.match(error.message,/were published, but cleanup failed/);
  assert.match(error.message,/previous-tree cleanup failure/);
  await newPair();
  await assert.rejects(native.stat(guard));
  fail=false;
  await sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  await newPair();
`,
);

publicationCase(
  "concurrent cycle publication refuses without touching the in-flight pair",
  String.raw`
  let release;
  let signal;
  const entered=new Promise(resolve=>{signal=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  let first=true;
  overrides.writeFile=async(path,...args)=>{
    if(first && String(path).includes('.staging-') && basename(String(path))==='proposal.json') {
      first=false; signal(); await held;
    }
    return native.writeFile(path,...args);
  };
`,
  String.raw`
  const publishing=sync({generatedAt:'2026-11-01T00:00:00.000Z'});
  let failed=false;
  try {
    await Promise.race([entered,publishing]);
    assert.equal(first,false);
    const refused=await failure();
    assert.match(refused.message,/could not acquire/);
    await oldPair();
  } catch(error) { failed=true; throw error; }
  finally {
    release();
    try { await publishing; }
    catch(error) { if(!failed) throw error; }
  }
  await newPair();
`,
);

publicationCase(
  "failed guard cleanup retains committed outputs and refuses an automatic retry",
  String.raw`
  overrides.rmdir=async(path,...args)=>{
    if(path===guard) throw new Error('fixture publication guard cleanup failure');
    return native.rmdir(path,...args);
  };
`,
  String.raw`
  const error=await failure();
  assert.match(error.message,/were published, but cleanup failed/);
  await newPair();
  await native.stat(guard);
  assert.match((await failure()).message,/could not acquire/);
  await newPair();
`,
);
