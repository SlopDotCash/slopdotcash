/** Native control-plane test only. It seeds synthetic journal rows, never pays. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const directory = await mkdtemp(join(tmpdir(), "hosted-keeper-control-"));
const token = "a".repeat(64);
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const config = {
  apiOrigin: "https://staging.slop.cash",
  network: "ethereum-sepolia",
  projectIds: ["hosted-eth-keeper"],
  signer: account.address.toLowerCase(),
  rpcUrl: "https://testnet.invalid",
  perRun: 1,
  gas: {
    perTransaction: "100000",
    perDay: "100000",
    additionalFeeReserve: "0",
  },
};
const raw = await account.signTransaction({
  chainId: 11155111,
  type: "eip1559",
  nonce: 0,
  gas: 21000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 0n,
  to: `0x${"2".repeat(40)}`,
  value: 0n,
});
const id = keccak256(raw);
const obligationId = `0x${"3".repeat(64)}`;
const { outputFiles } = await build({
  stdin: {
    resolveDir: resolve("."),
    sourcefile: "control-fixture.ts",
    contents: `
    import worker, {QualificationKeeper} from './tests/hosted-keeper/worker';
    export class LocalKeeper extends QualificationKeeper {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/seed') {
          const {raw,id}=await request.json();
          this.store.db.query('INSERT INTO journal VALUES(?,?)').run('attempt:synthetic', JSON.stringify({transactionId:id,rawTransaction:raw,obligationId:${JSON.stringify(obligationId)}}));
          this.store.db.query('INSERT INTO journal VALUES(?,?)').run(${JSON.stringify(`nonce:11155111:${config.signer}`)}, JSON.stringify(1));
          this.store.db.query('INSERT INTO gas(id,day,maximum,transaction_id) VALUES(?,?,?,?)').run(id,'2026-10-30','100000',id);
          return new Response(null,{status:204});
        }
        if(path === '/hold' || path === '/probe') {
          const selected = path === '/hold' ? ${JSON.stringify(raw)} : (await request.json()).raw;
          await this.beforeRpc(new Request('https://testnet.invalid',{method:'POST',body:JSON.stringify({method:'eth_sendRawTransaction',params:[selected]})}));
          return new Response(null,{status:204});
        }
        return super.fetch(request);
      }
    }
    export default {
      async fetch(request,env) {
        const path=new URL(request.url).pathname;
        if(path==='/seed'||path==='/hold'||path==='/probe') {
          const config=JSON.parse(env.KEEPER_CONFIG);
          const id=env.KEEPER.idFromName(JSON.stringify([config.network,config.signer]));
          return env.KEEPER.get(id).fetch(new Request('https://internal'+path,request));
        }
        return worker.fetch(request,env);
      }
    }`,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  external: ["node:*"],
  loader: { ".sql": "text" },
  write: false,
  logLevel: "silent",
});
const options = convertV4MiniflareOptions({
  modules: true,
  script: outputFiles[0].text,
  compatibilityDate: "2026-09-07",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    KEEPER_CONFIG: JSON.stringify(config),
    KEEPER_MODE: "execute",
    QUALIFICATION_RUN: "keeper-control-local-20261030",
    QUALIFICATION_SOURCE: "b".repeat(40),
    QUALIFICATION_CONTROL_TOKEN: token,
    QUALIFICATION_AWARD_ID: obligationId,
  },
  durableObjects: { KEEPER: { className: "LocalKeeper", useSQLite: true } },
});
options.resourcePersistencePath = directory;
const mf = new Miniflare(options);
const call = (command, extra = {}, authorization = token) =>
  mf.dispatchFetch("http://fixture/qualification", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authorization}`,
    },
    body: JSON.stringify({ command, ...extra }),
  });
try {
  await mf.ready;
  assert.equal((await call("status", {}, "x".repeat(64))).status, 404);
  assert.equal((await call("sql")).status, 400);
  assert.equal(
    (await call("status", { sql: "SELECT * FROM journal" })).status,
    400,
  );
  const initial = await (await call("status")).json();
  assert.equal(initial.phase, "idle");
  assert.equal((await call("abort")).status, 409);
  assert.equal(
    (
      await mf.dispatchFetch("http://fixture/seed", {
        method: "POST",
        body: JSON.stringify({ raw, id }),
      })
    ).status,
    204,
  );
  assert.equal((await call("arm")).status, 204);
  assert.equal((await call("arm")).status, 409);
  const hold = mf.dispatchFetch("http://fixture/hold", { method: "POST" }).then(
    (r) => r.status,
    () => 500,
  );
  let paused;
  for (let i = 0; i < 100; i++) {
    paused = await (await call("status")).json();
    if (paused.phase === "paused") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(paused.phase, "paused");
  assert.equal(paused.transactionId, id);
  assert.equal(paused.gasMaximum, "100000");
  assert.equal(paused.nonceSha256.length, 64);
  const aborted = await call("abort").then(
    (r) => r.status,
    () => 500,
  );
  assert(aborted >= 500);
  assert((await hold) >= 500);
  const resumed = await (await call("status")).json();
  assert.equal(resumed.phase, "resume");
  assert.equal(resumed.transactionId, id);
  assert.equal(resumed.rawSha256, paused.rawSha256);
  assert.equal(resumed.nonceSha256, paused.nonceSha256);
  assert.notEqual(resumed.instance, paused.instance);
  assert.equal((await call("abort")).status, 409);
  // No node is called: probe only checks which signed bytes may reach it.
  assert.equal(
    (
      await mf.dispatchFetch("http://fixture/probe", {
        method: "POST",
        body: JSON.stringify({ raw: "0x00" }),
      })
    ).status,
    500,
  );
  assert.equal(
    (
      await mf.dispatchFetch("http://fixture/probe", {
        method: "POST",
        body: JSON.stringify({ raw }),
      })
    ).status,
    204,
  );
  console.log(
    JSON.stringify({
      passed: true,
      nativeWorkerd: true,
      controlOnly: true,
      authorization: true,
      noSqlOrAmounts: true,
      preBroadcastHold: true,
      actualAbort: true,
      sameNamespace: true,
      retainedHashes: true,
      exactRetainedTransactionOnly: true,
      transactionsSent: 0,
      hosted: false,
    }),
  );
} finally {
  await mf.dispose();
  await rm(directory, { recursive: true, force: true });
}
