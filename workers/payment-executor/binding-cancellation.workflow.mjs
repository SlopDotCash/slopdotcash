import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { keccak256, parseTransaction } from "viem";
import { childEnvironment } from "../../scripts/child-environment.mjs";

// Invoked only by the actual Anvil/SQLite account workflow with disposable keys.
const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(fixture.schema, "local-binding-cancellation:v1");
assert.equal(
  fixture.env.SIGNER_PRIVATE_KEY,
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const endpoints = Object.values(JSON.parse(fixture.env.PAYMENT_RPC_URLS));
assert.equal(endpoints.length, 1);
assert.match(endpoints[0], /^http:\/\/127\.0\.0\.1:\d+$/);
const rpcUrl = endpoints[0];
const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  assert.equal(body.error, undefined);
  return body.result;
};
const directory = await mkdtemp(join(tmpdir(), "slop-native-binding-cancel-"));
let runtime;
let drop = true;
const sends = [];
try {
  const entry = join(directory, "entry.ts");
  await writeFile(
    entry,
    `import {PaymentSignerJournal} from ${JSON.stringify(resolve("workers/payment-executor/index.ts"))};
export class FixtureJournal extends PaymentSignerJournal {
  constructor(state,env){super(state,env);this.fixtureState=state;}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==="/_fixture/seed") { for(const [key,value] of await request.json()) await this.fixtureState.storage.put(key,value); return new Response("seeded"); }
    if(path==="/_fixture/read") return Response.json([...await this.fixtureState.storage.list()]);
    return super.fetch(request);
  }
}
export default {fetch(request,env){return env.JOURNAL.get(env.JOURNAL.idFromName("fixture")).fetch(request);}};`,
  );
  const bundle = join(directory, "entry.mjs");
  const built = spawnSync(
    "bun",
    [
      "--no-env-file",
      "build",
      entry,
      "--target=browser",
      "--external=cloudflare:workers",
      `--outfile=${bundle}`,
    ],
    {
      encoding: "utf8",
      env: childEnvironment(process.env, { CI: "true" }),
      timeout: 20000,
    },
  );
  assert.equal(built.status, 0, built.stderr);
  const options = convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: 0,
    resourcePersistencePath: join(directory, "persist"),
    workers: [
      {
        name: "attester",
        modules: true,
        compatibilityDate: "2026-09-14",
        compatibilityFlags: ["nodejs_compat"],
        script: await readFile(bundle, "utf8"),
        bindings: fixture.env,
        d1Databases: { PAYMENTS_DB: "fixture", REGISTRY_DB: "fixture" },
        durableObjects: {
          JOURNAL: { className: "FixtureJournal", useSQLite: true },
        },
        outboundService: async (request) => {
          assert.equal(request.url, `${rpcUrl}/`);
          const text = await request.text(),
            body = JSON.parse(text);
          if (body.method === "eth_sendRawTransaction") {
            sends.push(keccak256(body.params[0]));
            if (drop)
              return new Response("Controlled lost send", { status: 502 });
          }
          return fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: text,
          });
        },
      },
    ],
  });
  const start = async () => {
    runtime = new Miniflare(options);
    await runtime.ready;
    return runtime.getWorker("attester");
  };
  let worker = await start();
  const database = await runtime.getD1Database("PAYMENTS_DB", "attester");
  await database.batch(
    fixture.database.map(({ sql, args }) =>
      database.prepare(sql).bind(...args),
    ),
  );
  const call = async (path, body) => {
    const response = await worker.fetch(`https://fixture.invalid${path}`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const seeded = await worker.fetch("https://fixture.invalid/_fixture/seed", {
    method: "POST",
    body: JSON.stringify(fixture.journal),
  });
  assert.equal(seeded.status, 200);
  const read = async () => new Map(await call("/_fixture/read"));
  const original = new Map(fixture.journal).get(fixture.originalKey);
  const cancelKey = `security:binding-cancel:${original.transactionId}`;
  assert((await call("/v1/security/bind-destinations")).failed > 0);
  let state = await read(),
    cancel = state.get(cancelKey);
  assert(cancel);
  assert.deepEqual(cancel.original, original);
  assert.equal(keccak256(cancel.rawTransaction), cancel.transactionId);
  const signed = parseTransaction(cancel.rawTransaction);
  assert.equal(signed.nonce, 1);
  assert.equal(signed.gas, 21000n);
  assert.equal(signed.value ?? 0n, 0n);
  assert.equal(signed.data ?? "0x", "0x");
  assert.equal(signed.to.toLowerCase(), fixture.authority);
  assert.deepEqual(sends, [cancel.transactionId]);
  assert.deepEqual(state.get(fixture.originalKey), original);
  assert.equal(state.get(fixture.nonceKey), 3);
  // Restart native Workerd and reopen the actual persisted SQLite DO/D1.
  await runtime.dispose();
  worker = await start();
  state = await read();
  assert.deepEqual(state.get(cancelKey), cancel);
  drop = false;
  assert.deepEqual((await call("/v1/security/bind-destinations")).submitted, [
    cancel.transactionId,
  ]);
  const count = sends.length;
  assert((await call("/v1/security/bind-destinations")).failed > 0);
  assert.equal(sends.length, count);
  assert.deepEqual((await read()).get(fixture.originalKey), original);
  await rpc("anvil_mine", ["0x40"]);
  await call("/v1/security/bind-destinations");
  await call("/v1/bind-destinations");
  await call("/v1/security/bind-destinations");
  state = await read();
  assert.equal(sends.length, count);
  assert.deepEqual(state.get(cancelKey), cancel);
  assert.deepEqual(state.get("security:pending-stored-bindings"), []);
  assert.deepEqual(state.get("pending-stored-bindings"), []);
  assert.equal(state.get(fixture.originalKey), null);
  assert.equal(state.get(fixture.nonceKey), 3);
  const proof = state.get(
    `security:binding-observed:${original.transactionId}`,
  );
  assert.deepEqual(proof.attempt, original);
  assert.equal(proof.proof.outcome, "superseded");
  assert.equal(
    await rpc("eth_getTransactionCount", [fixture.authority, "latest"]),
    "0x3",
  );
  console.log(
    JSON.stringify({
      proof: "native-workerd-d1-do-cancellation",
      result: "passed",
      original: original.transactionId,
      cancellation: cancel.transactionId,
      winner: proof.proof.outcome,
      chainNonce: 3,
      journalNonce: 3,
      persistedRestart: true,
      lossBeforeSendRetained: true,
      nonfinalHeld: true,
      replayNoBroadcast: true,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
