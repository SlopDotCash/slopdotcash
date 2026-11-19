// spec/contributor/discoveryLock.md, "Process deaths keep the lock until the command is provably gone"; spec/contributor/lockPublication.md, "Acquisition prepares a candidate, quarantines a dead owner, and publishes by rename"
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { type Discovery, type Owned, type ScriptRoot, fakeGh, identity, node, onPath, preloading, removeRoot, scriptRoot, stopIdentity, stopProcess, until, writeModule } from "./fixture.ts";

async function discoveryOf(f: ScriptRoot): Promise<Discovery> {
  const loaded: Discovery = await import(f.url);
  return loaded;
}

function contenderOf(f: ScriptRoot): string {
  return writeModule(f.root, "contender.mjs", `
    import {acquireLiveReportLock,LiveReportLockContentionError} from ${JSON.stringify(f.url)};
    try {
      const lock = acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
      lock.release();
    } catch(error) { process.stderr.write(error.message); process.exitCode=error instanceof LiveReportLockContentionError?2:1; }
  `);
}

function holdAtLeasePublication(f: ScriptRoot, started: string, barrier: string): string {
  return writeModule(f.root, "lease-barrier.mjs", `
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
        ${barrier}
      }
      return rename(source, target);
    };
    syncBuiltinESMExports();
  `);
}

function lockDirectory(locks: string): string {
  return join(locks, readdirSync(locks).find((name) => name.endsWith(".lock")) ?? "missing");
}

/** @throws {Error} */
export async function aLaunchedChildStaysLeasedThroughBookkeepingFailureAndParentLoss(): Promise<void> {
  const f = scriptRoot("discovery-lifetime");
  const started = join(f.root, "child-started");
  const terminate = join(f.root, "termination-requested");
  const failed = join(f.root, "bookkeeping-failed");
  const stop = join(f.root, "stop-owned-child");
  const discovery = await discoveryOf(f);
  fakeGh(f.bin, `
    const fs = require('node:fs');
    process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(terminate)}, 'requested'));
    import(${JSON.stringify(f.url)}).then(({readLiveReportProcessIdentity}) => {
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(stop)})) { clearInterval(timer); process.exit(0); }
      }, 20);
      fs.writeFileSync(${JSON.stringify(started)}, JSON.stringify({
        pid: process.pid, processIdentity: readLiveReportProcessIdentity(process.pid),
      }));
    });
  `);
  const preload = holdAtLeasePublication(f, started, `
        fs.writeFileSync(${JSON.stringify(failed)}, 'failed');
        throw new Error('synthetic lease publication failure');`);
  const runner = writeModule(f.root, "owner.mjs", `
    import { acquireLiveReportLock } from ${JSON.stringify(f.url)};
    const lock = acquireLiveReportLock(${identity}, {rootPath: ${JSON.stringify(f.locks)}});
    const result = lock.spawn('gh', ['api', 'repos/example/project/issues']);
    lock.release();
    process.exitCode = result.status ?? 1;
  `);
  const contender = contenderOf(f);
  const owner = spawn(process.execPath, [runner], { cwd: f.root, env: { ...process.env, PATH: onPath(f.bin), NODE_OPTIONS: preloading(preload) }, stdio: "ignore" });
  const ownerExited = once(owner, "exit");
  let helper: Owned | null = null;
  try {
    await until(() => existsSync(failed));
    const commands = join(lockDirectory(f.locks), "commands");
    const leases = () => readdirSync(commands).filter((name) => /^lease-[a-f0-9]{32}\.json$/u.test(name));
    expect(leases()).toHaveLength(1);
    helper = JSON.parse(readFileSync(join(commands, leases()[0] ?? "missing"), "utf8")).helper;
    await until(() => existsSync(terminate));
    owner.kill("SIGKILL");
    await ownerExited;
    const blocked = node([contender]);
    expect(blocked.status, blocked.stderr).toBe(2);
    writeFileSync(stop, "stop");
    await until(() => leases().length === 0);
    const recovered = node([contender]);
    expect(recovered.status, recovered.stderr).toBe(0);
  } finally {
    writeFileSync(stop, "stop");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    await ownerExited;
    const descendants: Owned[] = [];
    if (existsSync(started)) descendants.push(JSON.parse(readFileSync(started, "utf8")));
    if (helper !== null) descendants.push(helper);
    if (existsSync(f.locks)) {
      for (const name of readdirSync(f.locks)) {
        const commands = join(f.locks, name, "commands");
        if (!name.endsWith(".lock") || !existsSync(commands)) continue;
        for (const entry of readdirSync(commands)) {
          if (!entry.startsWith("lease-")) continue;
          const text = existsSync(join(commands, entry)) ? readFileSync(join(commands, entry), "utf8") : undefined;
          if (text !== undefined) descendants.push(JSON.parse(text).helper);
        }
      }
    }
    for (const owned of descendants) await stopIdentity(discovery, owned);
    if (existsSync(failed)) removeRoot(f.root);
  }
}

/** @throws {Error} */
export function aFailedCommandRetainsItsOutputWhenCleanupFails(): void {
  for (const record of ["lease", "request"] as const) {
    const f = scriptRoot("discovery-exit");
    try {
      fakeGh(f.bin, "process.stdout.write('fixture output\\n'); process.stderr.write('fixture failure\\n'); process.exitCode = 7;");
      const preload = writeModule(f.root, "cleanup-failure.mjs", `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        const remove = fs.rmSync;
        fs.rmSync = (path, options) => {
          if (String(path).includes('/${record}-') && String(path).endsWith('.json'))
            throw new Error('synthetic ${record} cleanup failure');
          return remove(path, options);
        };
        syncBuiltinESMExports();
      `);
      const runner = writeModule(f.root, "owner.mjs", `
        import { acquireLiveReportLock } from ${JSON.stringify(f.url)};
        const lock = acquireLiveReportLock(${identity}, {rootPath:${JSON.stringify(f.locks)}});
        const result = lock.spawn('gh', ['api', 'repos/example/project/issues']);
        lock.release();
        process.stdout.write(JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr}));
      `);
      const result = node([runner], { PATH: onPath(f.bin), NODE_OPTIONS: preloading(preload) });
      expect(result.status, result.stderr).toBe(0);
      const command = JSON.parse(result.stdout);
      expect(command.status).toBe(7);
      expect(command.stdout).toContain("fixture output");
      expect(command.stderr).toContain("fixture failure");
      expect(command.stderr).toContain(`synthetic ${record} cleanup failure`);
    } finally {
      removeRoot(f.root);
    }
  }
}

/** @throws {Error} */
export async function anUnpublishedChildStaysProtectedAfterHelperDeath(): Promise<void> {
  const f = scriptRoot("startup");
  const discovery = await discoveryOf(f);
  const started = join(f.root, "child.json");
  const publishing = join(f.root, "publishing.json");
  const stop = join(f.root, "stop");
  fakeGh(f.bin, `
    const fs = require('node:fs');
    import(${JSON.stringify(f.url)}).then(({readLiveReportProcessIdentity}) => {
      fs.writeFileSync(${JSON.stringify(started)}, JSON.stringify({pid:process.pid, processIdentity:readLiveReportProcessIdentity(process.pid)}));
      setInterval(() => { if (fs.existsSync(${JSON.stringify(stop)})) process.exit(0); }, 20);
    });
  `);
  const hold = holdAtLeasePublication(f, started, `
        fs.writeFileSync(${JSON.stringify(publishing)}, JSON.stringify({pid:process.pid}));
        while (!fs.existsSync(${JSON.stringify(stop)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        throw new Error('fixture startup stopped');`);
  const ownerScript = writeModule(f.root, "owner.mjs", `
    import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
    const lock = acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
    lock.spawn('gh',['api','repos/example/project/issues']);
    lock.release();
  `);
  const contender = contenderOf(f);
  const owner = spawn(process.execPath, [ownerScript], { env: { ...process.env, PATH: onPath(f.bin), NODE_OPTIONS: preloading(hold) }, stdio: "ignore" });
  let child: Owned | undefined;
  let helper: Owned | undefined;
  try {
    await until(() => existsSync(publishing));
    const runningChild: Owned = JSON.parse(readFileSync(started, "utf8"));
    child = runningChild;
    const helperPid: number = JSON.parse(readFileSync(publishing, "utf8")).pid;
    const helperIdentity = discovery.readLiveReportProcessIdentity(helperPid);
    expect(helperIdentity).not.toBeNull();
    helper = { pid: helperPid, processIdentity: helperIdentity ?? "" };
    const lockPath = lockDirectory(f.locks);
    const guard = `${lockPath}.transition`;
    expect(existsSync(guard)).toBe(true);
    await stopProcess(owner);
    await stopIdentity(discovery, helper);
    const commands = join(lockPath, "commands");
    const leasePath = join(commands, readdirSync(commands).find((name) => /^lease-.*\.json$/u.test(name)) ?? "missing");
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    expect(lease.child).toBeNull();
    lease.startedAtMs = Date.now() - 24 * 60 * 60 * 1_000;
    writeFileSync(leasePath, JSON.stringify(lease));
    const guarded = node([contender]);
    expect(guarded.status, guarded.stderr).toBe(2);
    expect(guarded.stderr).toContain("transition guard");
    expect(discovery.readLiveReportProcessIdentity(runningChild.pid)).toBe(runningChild.processIdentity);
    rmSync(guard, { recursive: true });
    const legacy = node([contender]);
    expect(legacy.status, legacy.stderr).toBe(2);
    expect(legacy.stderr).toContain("unpublished GitHub child identity");
    expect(readFileSync(leasePath, "utf8")).toBe(JSON.stringify(lease));
    await stopIdentity(discovery, runningChild);
    const stillUnknown = node([contender]);
    expect(stillUnknown.status, stillUnknown.stderr).toBe(2);
    rmSync(lockPath, { recursive: true });
    const recovered = node([contender]);
    expect(recovered.status, recovered.stderr).toBe(0);
  } finally {
    writeFileSync(stop, "stop");
    await stopProcess(owner);
    if (child === undefined && existsSync(started)) child = JSON.parse(readFileSync(started, "utf8"));
    if (helper === undefined && existsSync(publishing)) {
      const pid: number = JSON.parse(readFileSync(publishing, "utf8")).pid;
      const found = discovery.readLiveReportProcessIdentity(pid);
      if (found !== null) helper = { pid, processIdentity: found };
    }
    if (helper !== undefined) await stopIdentity(discovery, helper);
    if (child !== undefined) await stopIdentity(discovery, child);
    if (existsSync(publishing)) removeRoot(f.root);
  }
}

/** @throws {Error} */
export async function aStaleHelperCannotLaunchWhileASuccessorScans(): Promise<void> {
  const f = scriptRoot("startup");
  const ready = join(f.root, "owner-ready.json");
  const scanned = join(f.root, "scanned");
  const proceed = join(f.root, "proceed");
  const launched = join(f.root, "launched");
  const commandToken = "a".repeat(32);
  fakeGh(f.bin, `require('node:fs').writeFileSync(${JSON.stringify(launched)}, 'launched');`);
  const ownerScript = writeModule(f.root, "owner.mjs", `
    import fs from 'node:fs'; import {join} from 'node:path';
    import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
    acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
    const path = join(${JSON.stringify(f.locks)},fs.readdirSync(${JSON.stringify(f.locks)}).find(x=>x.endsWith('.lock')));
    const owner = JSON.parse(fs.readFileSync(join(path,'owner.json'),'utf8'));
    fs.writeFileSync(join(path,'commands','request-${commandToken}.json'),JSON.stringify({schemaVersion:1,ownerToken:owner.ownerToken,maxBuffer:4096,args:['api','fixture']}),{mode:0o600});
    fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({path,token:owner.ownerToken}));
    setInterval(()=>{},1000);
  `);
  const reclaimerScript = writeModule(f.root, "reclaimer.mjs", `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const read=fs.readdirSync;
    fs.readdirSync=(path,options)=>{
      const entries=read(path,options);
      if (String(path).endsWith('/commands')) {
        fs.writeFileSync(${JSON.stringify(scanned)},'scanned');
        const deadline=Date.now()+10000;
        while(!fs.existsSync(${JSON.stringify(proceed)})) {
          if(Date.now()>deadline) throw new Error('fixture reclaim not released');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        }
      }
      return entries;
    };
    syncBuiltinESMExports();
    const {acquireLiveReportLock}=await import(${JSON.stringify(f.url)});
    const lock=acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
    lock.release();
  `);
  const owner = spawn(process.execPath, [ownerScript], { stdio: "ignore" });
  let reclaimer: ReturnType<typeof spawn> | undefined;
  try {
    await until(() => existsSync(ready));
    const saved = JSON.parse(readFileSync(ready, "utf8"));
    await stopProcess(owner);
    reclaimer = spawn(process.execPath, [reclaimerScript], { stdio: "ignore" });
    const reclaimed = once(reclaimer, "exit");
    await until(() => existsSync(scanned));
    const helper = node([f.entry, "--slop-internal-locked-gh-v1", saved.path, saved.token, commandToken], { PATH: onPath(f.bin) });
    expect(helper.status, helper.stderr).not.toBe(0);
    expect(helper.stderr).toContain("transition guard");
    expect(existsSync(launched)).toBe(false);
    writeFileSync(proceed, "go");
    const [code] = await reclaimed;
    expect(code).toBe(0);
  } finally {
    writeFileSync(proceed, "go");
    await stopProcess(owner);
    if (reclaimer !== undefined) await stopProcess(reclaimer);
    removeRoot(f.root);
  }
}

/** @throws {Error} */
export function aReleasedHandleRefusesBeforeLaunching(): void {
  const f = scriptRoot("startup");
  try {
    const launched = join(f.root, "launched");
    fakeGh(f.bin, `require('node:fs').writeFileSync(${JSON.stringify(launched)},'launched');`);
    const runner = writeModule(f.root, "released.mjs", `
      import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
      const lock=acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
      lock.release();
      lock.spawn('gh',['api','fixture']);
    `);
    const result = node([runner], { PATH: onPath(f.bin) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already released");
    expect(existsSync(launched)).toBe(false);
    expect(readdirSync(f.locks)).toEqual([]);
  } finally {
    removeRoot(f.root);
  }
}

/** @throws {Error} */
export function theReportKeepsItsDiscoveryErrorWhenReleaseFails(): void {
  const f = scriptRoot("startup");
  const actorId = 42;
  const key = createHash("sha256").update(`github.com:${actorId}`).digest("hex");
  const homeKey = createHash("sha256").update(`fixture\0${f.root}`).digest("hex").slice(0, 16);
  const ownedLock = join(f.root, `.slop-live-report-locks-v2-${homeKey}`, `${key}.lock`);
  try {
    fakeGh(f.bin, `
      if(process.argv.at(-1)==='user') process.stdout.write(JSON.stringify({id:${actorId},login:'fixture'}));
      else { process.stderr.write('fixture primary discovery failure'); process.exitCode=9; }
    `);
    const preload = writeModule(f.root, "release-failure.mjs", `
      import fs from 'node:fs'; import os from 'node:os';
      import {syncBuiltinESMExports} from 'node:module';
      process.getuid=undefined;
      const info=os.userInfo();
      os.userInfo=()=>({...info,username:'fixture',homedir:${JSON.stringify(f.root)}});
      const rename=fs.renameSync;
      fs.renameSync=(source,target)=>{
        if(String(source)===${JSON.stringify(ownedLock)} && String(target).includes('.released-')) throw new Error('fixture release failure');
        return rename(source,target);
      };
      syncBuiltinESMExports();
    `);
    const result = node([f.entry, "--json"], { PATH: onPath(f.bin), NODE_OPTIONS: preloading(preload) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture primary discovery failure");
    expect(result.stderr).toContain("fixture release failure");
    expect(result.stdout).toBe("");
  } finally {
    rmSync(ownedLock, { recursive: true, force: true });
    rmSync(`${ownedLock}.transition`, { recursive: true, force: true });
    removeRoot(f.root);
  }
}

/** @throws {Error} */
export function aMissingGhClosesStartupAndRetainsTheSpawnError(): void {
  const f = scriptRoot("startup");
  try {
    const runner = writeModule(f.root, "missing-gh.mjs", `
      import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
      const lock=acquireLiveReportLock(${identity},{rootPath:${JSON.stringify(f.locks)}});
      const result=lock.spawn('gh',['api','fixture']);
      lock.release();
      process.stdout.write(JSON.stringify({status:result.status,stderr:result.stderr}));
    `);
    const result = node([runner], { PATH: f.bin });
    expect(result.status, result.stderr).toBe(0);
    const command = JSON.parse(result.stdout);
    expect(command.status).not.toBe(0);
    expect(command.stderr).toMatch(/\bENOENT\b|Executable not found in \$PATH/u);
    expect(readdirSync(f.locks)).toEqual([]);
  } finally {
    removeRoot(f.root);
  }
}

function publicationCase(body: string): void {
  const f = scriptRoot("lock-publication");
  try {
    const launched = join(f.root, "launched");
    fakeGh(f.bin, `require('node:fs').writeFileSync(${JSON.stringify(launched)}, 'unexpected launch');`);
    const runner = writeModule(f.root, "case.mjs", `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { createHash } from 'node:crypto';
      import { join } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      const original = {
        rm: fs.rmSync, rename: fs.renameSync, rmdir: fs.rmdirSync,
        write: fs.writeFileSync,
      };
      const locks = ${JSON.stringify(f.locks)};
      const launched = ${JSON.stringify(launched)};
      const key = createHash('sha256').update('github.com:42').digest('hex');
      const lockPath = join(locks, key + '.lock');
      const guard = lockPath + '.transition';
      const identity = ${identity};
      const load = () => import(${JSON.stringify(f.url)});
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
    `);
    const result = node([runner], { PATH: onPath(f.bin) }, { timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("fixture passed");
  } finally {
    removeRoot(f.root);
  }
}

const staleCleanupRollsBack = (failCandidateCleanup: boolean) => String.raw`
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
`;

/** @throws {Error} */
export function acquisitionPublishesByRenameAndKeepsTheFirstFailure(): void {
  publicationCase(String.raw`
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
`);
  publicationCase(String.raw`
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
`);
  publicationCase(String.raw`
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
`);
  publicationCase(String.raw`
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
`);
}

/** @throws {Error} */
export function aFailedStaleCleanupRollsBackOrNeedsManualRecovery(): void {
  publicationCase(staleCleanupRollsBack(false));
  publicationCase(staleCleanupRollsBack(true));
  publicationCase(String.raw`
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
`);
  publicationCase(String.raw`
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
`);
}

/** @throws {Error} */
export function releaseUsesOnlyTheSavedTombstone(): void {
  publicationCase(String.raw`
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
  first.release();
  assert.equal(fs.readFileSync(join(lockPath, 'owner.json'), 'utf8'), successorBytes);
  successor.release();
  assert.deepEqual(fs.readdirSync(locks), []);
`);
  publicationCase(String.raw`
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
`);
  publicationCase(String.raw`
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
`);
}
