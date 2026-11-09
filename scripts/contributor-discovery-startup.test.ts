/** Real copied CLI, process identities and filesystem startup barriers. */
import { expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

type Identity = { pid: number; processIdentity: string };
type Discovery = { readLiveReportProcessIdentity(pid: number): string | null };

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-startup-"));
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  const locks = join(root, "locks");
  mkdirSync(scripts);
  mkdirSync(bin);
  for (const name of ["live-report.mjs", "run-receipt.mjs"]) {
    copyFileSync(
      resolve("skills/project-contributor-template/scripts", name),
      join(scripts, name),
    );
  }
  writeFileSync(
    join(root, "project.json"),
    JSON.stringify({ repositoryId: "example/project" }),
  );
  const entry = join(scripts, "live-report.mjs");
  const url = pathToFileURL(entry).href;
  const discovery: Discovery = await import(url);
  return { root, bin, locks, entry, url, discovery };
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error("fixture transition did not complete");
    await Bun.sleep(20);
  }
}

async function stopIdentity(discovery: Discovery, identity: Identity) {
  const stopped = () =>
    discovery.readLiveReportProcessIdentity(identity.pid) !==
    identity.processIdentity;
  if (!stopped()) process.kill(identity.pid, "SIGKILL");
  await until(stopped);
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, "exit");
  child.kill("SIGKILL");
  await stopped;
}

test.skipIf(process.platform === "win32")(
  "an unpublished child remains protected after helper death and the old grace period",
  async () => {
    const f = await fixture();
    const started = join(f.root, "child.json");
    const publishing = join(f.root, "publishing.json");
    const stop = join(f.root, "stop");
    const hold = join(f.root, "hold.mjs");
    writeFileSync(
      join(f.bin, "gh"),
      `#!/usr/bin/env node
    const fs = require('node:fs');
    import(${JSON.stringify(f.url)}).then(({readLiveReportProcessIdentity}) => {
      fs.writeFileSync(${JSON.stringify(started)}, JSON.stringify({pid:process.pid, processIdentity:readLiveReportProcessIdentity(process.pid)}));
      setInterval(() => { if (fs.existsSync(${JSON.stringify(stop)})) process.exit(0); }, 20);
    });
  `,
      { mode: 0o700 },
    );
    writeFileSync(
      hold,
      `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (String(source).includes('/lease-') && String(source).includes('.next-')) {
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(${JSON.stringify(started)})) {
          if (Date.now() > deadline) throw new Error('child did not start');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        }
        fs.writeFileSync(${JSON.stringify(publishing)}, JSON.stringify({pid:process.pid}));
        while (!fs.existsSync(${JSON.stringify(stop)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        throw new Error('fixture startup stopped');
      }
      return rename(source,target);
    };
    syncBuiltinESMExports();
  `,
    );
    const ownerScript = join(f.root, "owner.mjs");
    writeFileSync(
      ownerScript,
      `
    import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
    const lock = acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
    lock.spawn('gh',['api','repos/example/project/issues']);
    lock.release();
  `,
    );
    const contenderScript = join(f.root, "contender.mjs");
    writeFileSync(
      contenderScript,
      `
    import {acquireLiveReportLock,LiveReportLockContentionError} from ${JSON.stringify(f.url)};
    try {
      const lock = acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
      lock.release();
    } catch(error) { process.stderr.write(error.message); process.exitCode=error instanceof LiveReportLockContentionError?2:1; }
  `,
    );
    const owner = spawn("node", [ownerScript], {
      env: {
        ...process.env,
        PATH: `${f.bin}:${process.env.PATH ?? ""}`,
        NODE_OPTIONS: `--import=${pathToFileURL(hold).href}`,
      },
      stdio: "ignore",
    });
    let child: Identity | undefined;
    let helper: Identity | undefined;
    try {
      await until(() => existsSync(publishing));
      const runningChild = JSON.parse(
        readFileSync(started, "utf8"),
      ) as Identity;
      child = runningChild;
      const helperPid = JSON.parse(readFileSync(publishing, "utf8")).pid;
      const identity = f.discovery.readLiveReportProcessIdentity(helperPid);
      expect(identity).not.toBeNull();
      helper = { pid: helperPid, processIdentity: identity as string };
      const lockPath = join(
        f.locks,
        readdirSync(f.locks).find((name) => name.endsWith(".lock")) as string,
      );
      const guard = `${lockPath}.transition`;
      expect(existsSync(guard)).toBe(true);
      await stopProcess(owner);
      await stopIdentity(f.discovery, helper);
      const commands = join(lockPath, "commands");
      const leasePath = join(
        commands,
        readdirSync(commands).find((name) =>
          /^lease-.*\.json$/u.test(name),
        ) as string,
      );
      const lease = JSON.parse(readFileSync(leasePath, "utf8"));
      expect(lease.child).toBeNull();
      lease.startedAtMs = Date.now() - 24 * 60 * 60 * 1_000;
      writeFileSync(leasePath, JSON.stringify(lease));
      const guarded = spawnSync("node", [contenderScript], {
        encoding: "utf8",
      });
      expect(guarded.status, guarded.stderr).toBe(2);
      expect(guarded.stderr).toContain("transition guard");
      expect(f.discovery.readLiveReportProcessIdentity(runningChild.pid)).toBe(
        runningChild.processIdentity,
      );
      // Emulate an older installed version's existing ambiguous lease: it had
      // no persistent startup guard. This is fixture construction, not recovery.
      rmSync(guard, { recursive: true });
      const legacy = spawnSync("node", [contenderScript], { encoding: "utf8" });
      expect(legacy.status, legacy.stderr).toBe(2);
      expect(legacy.stderr).toContain("unpublished GitHub child identity");
      expect(readFileSync(leasePath, "utf8")).toBe(JSON.stringify(lease));
      await stopIdentity(f.discovery, runningChild);
      const stillUnknown = spawnSync("node", [contenderScript], {
        encoding: "utf8",
      });
      expect(stillUnknown.status, stillUnknown.stderr).toBe(2);
      // Explicit recovery occurs only after all three owned processes stopped.
      rmSync(lockPath, { recursive: true });
      const recovered = spawnSync("node", [contenderScript], {
        encoding: "utf8",
      });
      expect(recovered.status, recovered.stderr).toBe(0);
    } finally {
      writeFileSync(stop, "stop");
      await stopProcess(owner);
      if (!child && existsSync(started))
        child = JSON.parse(readFileSync(started, "utf8"));
      if (!helper && existsSync(publishing)) {
        const pid = JSON.parse(readFileSync(publishing, "utf8")).pid;
        const identity = f.discovery.readLiveReportProcessIdentity(pid);
        if (identity) helper = { pid, processIdentity: identity };
      }
      if (helper) await stopIdentity(f.discovery, helper);
      if (child) await stopIdentity(f.discovery, child);
      // Before the barrier is observed, retain the stop marker for a late child.
      if (existsSync(publishing))
        rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.skipIf(process.platform === "win32")(
  "a stale helper cannot launch while a successor holds the reclaim scan",
  async () => {
    const f = await fixture();
    const ready = join(f.root, "owner-ready.json");
    const scanned = join(f.root, "scanned");
    const proceed = join(f.root, "proceed");
    const launched = join(f.root, "launched");
    const commandToken = "a".repeat(32);
    writeFileSync(
      join(f.bin, "gh"),
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(launched)}, 'launched');\n`,
      { mode: 0o700 },
    );
    const ownerScript = join(f.root, "owner.mjs");
    writeFileSync(
      ownerScript,
      `
    import fs from 'node:fs'; import {join} from 'node:path';
    import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
    acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
    const path = join(${JSON.stringify(f.locks)},fs.readdirSync(${JSON.stringify(f.locks)}).find(x=>x.endsWith('.lock')));
    const owner = JSON.parse(fs.readFileSync(join(path,'owner.json'),'utf8'));
    fs.writeFileSync(join(path,'commands','request-${commandToken}.json'),JSON.stringify({schemaVersion:1,ownerToken:owner.ownerToken,maxBuffer:4096,args:['api','fixture']}),{mode:0o600});
    fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({path,token:owner.ownerToken}));
    setInterval(()=>{},1000);
  `,
    );
    const reclaimerScript = join(f.root, "reclaimer.mjs");
    writeFileSync(
      reclaimerScript,
      `
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
    const lock=acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
    lock.release();
  `,
    );
    const owner = spawn("node", [ownerScript], { stdio: "ignore" });
    let reclaimer: ChildProcess | undefined;
    try {
      await until(() => existsSync(ready));
      const saved = JSON.parse(readFileSync(ready, "utf8"));
      await stopProcess(owner);
      reclaimer = spawn("node", [reclaimerScript], { stdio: "ignore" });
      const reclaimed = once(reclaimer, "exit");
      await until(() => existsSync(scanned));
      const helper = spawnSync(
        "node",
        [
          f.entry,
          "--slop-internal-locked-gh-v1",
          saved.path,
          saved.token,
          commandToken,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: `${f.bin}:${process.env.PATH ?? ""}` },
        },
      );
      expect(helper.status, helper.stderr).not.toBe(0);
      expect(helper.stderr).toContain("transition guard");
      expect(existsSync(launched)).toBe(false);
      writeFileSync(proceed, "go");
      const [code] = await reclaimed;
      expect(code).toBe(0);
    } finally {
      writeFileSync(proceed, "go");
      await stopProcess(owner);
      if (reclaimer) await stopProcess(reclaimer);
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  30_000,
);

test.skipIf(process.platform === "win32")(
  "a released handle refuses before writing a command or launching GitHub",
  async () => {
    const f = await fixture();
    try {
      const runner = join(f.root, "released.mjs");
      const launched = join(f.root, "launched");
      writeFileSync(
        join(f.bin, "gh"),
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(launched)},'launched');\n`,
        { mode: 0o700 },
      );
      writeFileSync(
        runner,
        `
      import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
      const lock=acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
      lock.release();
      lock.spawn('gh',['api','fixture']);
    `,
      );
      const result = spawnSync("node", [runner], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${f.bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("already released");
      expect(existsSync(launched)).toBe(false);
      expect(readdirSync(f.locks)).toEqual([]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "the real report keeps its discovery error when lock release also fails",
  async () => {
    const f = await fixture();
    const actorId = 42;
    const key = createHash("sha256")
      .update(`github.com:${actorId}`)
      .digest("hex");
    const homeKey = createHash("sha256")
      .update(`fixture\0${f.root}`)
      .digest("hex")
      .slice(0, 16);
    const ownedLock = join(
      f.root,
      `.slop-live-report-locks-v2-${homeKey}`,
      `${key}.lock`,
    );
    try {
      writeFileSync(
        join(f.bin, "gh"),
        `#!/usr/bin/env node
      if(process.argv.at(-1)==='user') process.stdout.write(JSON.stringify({id:${actorId},login:'fixture'}));
      else { process.stderr.write('fixture primary discovery failure'); process.exitCode=9; }
    `,
        { mode: 0o700 },
      );
      const preload = join(f.root, "release-failure.mjs");
      writeFileSync(
        preload,
        `
      import fs from 'node:fs'; import os from 'node:os';
      import {syncBuiltinESMExports} from 'node:module';
      // Exercise the real fallback root in an isolated child-local home.
      process.getuid=undefined;
      const info=os.userInfo();
      os.userInfo=()=>({...info,username:'fixture',homedir:${JSON.stringify(f.root)}});
      const rename=fs.renameSync;
      fs.renameSync=(source,target)=>{
        if(String(source)===${JSON.stringify(ownedLock)} && String(target).includes('.released-')) throw new Error('fixture release failure');
        return rename(source,target);
      };
      syncBuiltinESMExports();
    `,
      );
      const result = spawnSync("node", [f.entry, "--json"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${f.bin}:${process.env.PATH ?? ""}`,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("fixture primary discovery failure");
      expect(result.stderr).toContain("fixture release failure");
      expect(result.stdout).toBe("");
    } finally {
      // The default lock root was isolated inside this fixture's home.
      rmSync(ownedLock, { recursive: true, force: true });
      rmSync(`${ownedLock}.transition`, { recursive: true, force: true });
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a missing GitHub executable closes startup and retains the spawn error",
  async () => {
    const f = await fixture();
    try {
      const runner = join(f.root, "missing-gh.mjs");
      writeFileSync(
        runner,
        `
      import {acquireLiveReportLock} from ${JSON.stringify(f.url)};
      const lock=acquireLiveReportLock({id:42,login:'fixture',host:'github.com'},{rootPath:${JSON.stringify(f.locks)}});
      const result=lock.spawn('gh',['api','fixture']);
      lock.release();
      process.stdout.write(JSON.stringify({status:result.status,stderr:result.stderr}));
    `,
      );
      const result = spawnSync(process.execPath, [runner], {
        encoding: "utf8",
        env: { ...process.env, PATH: f.bin },
      });
      expect(result.status, result.stderr).toBe(0);
      const command = JSON.parse(result.stdout);
      expect(command.status).not.toBe(0);
      expect(command.stderr).toMatch(
        /\bENOENT\b|Executable not found in \$PATH/u,
      );
      expect(readdirSync(f.locks)).toEqual([]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);
