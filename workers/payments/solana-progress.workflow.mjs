import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { base58 } from "@scure/base";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { assertEscrowPolicy } from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Actual scheduled payments entrypoint, migrations and persistent native D1.
// RPC responses are transport fixtures for finalized non-escrow transactions.
// The executor returns a submission fixture; no payment or finality is claimed.
const folder = await mkdtemp(join(tmpdir(), "slop-solana-progress-"));
const key = (byte) => base58.encode(new Uint8Array(32).fill(byte));
const signatures = Array.from({ length: 103 }, (_, i) =>
  base58.encode(new Uint8Array(64).fill(i + 1)),
);
const stamp = "2026-10-29T00:00:00.000Z";
const submittedId = base58.encode(new Uint8Array(64).fill(250));
const calls = [];
let hold = true;
let pauseSignature = signatures[1];
let failedSignature = null;
let signalBlocked;
let release;
let blocked = new Promise((resolve) => {
  signalBlocked = resolve;
});
let gate = new Promise((resolve) => {
  release = resolve;
});
const rpc = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  if (input.method !== "getTransaction") {
    response.writeHead(503).end("Unrelated fixture RPC unavailable");
    return;
  }
  calls.push(input.params[0]);
  assert.equal(input.params[1].commitment, "finalized");
  if (input.params[0] === failedSignature) {
    response.writeHead(503).end("Current transaction unavailable");
    return;
  }
  if (hold && input.params[0] === pauseSignature) {
    hold = false;
    signalBlocked();
    await gate;
  }
  response.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        meta: { err: null, innerInstructions: [] },
        transaction: { message: { instructions: [] } },
      },
    }),
  );
});
await new Promise((resolve) => rpc.listen(0, "127.0.0.1", resolve));
const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
let runtime;
try {
  const entry = join(folder, "worker.ts");
  const output = join(folder, "worker.mjs");
  await writeFile(
    entry,
    `import payments from ${JSON.stringify(resolve("workers/payments/index.ts"))};
export default {async fetch(request,env){
  let queries=0,batches=0;
  const wrap=(statement)=>({
    native:statement,bind(...values){return wrap(statement.bind(...values));},
    first(...values){queries++;return statement.first(...values);},
    run(...values){queries++;return statement.run(...values);}
  });
  const db={prepare(sql){return wrap(env.DB.prepare(sql));},batch(statements){queries++;batches++;return env.DB.batch(statements.map(statement=>statement.native));}};
  try {await payments.scheduled(null,{
    PAYMENTS_DB:db,REGISTRY_DB:db,PAYMENT_NETWORKS:'["solana-devnet"]',
    PAYMENT_RPC_URLS:${JSON.stringify(JSON.stringify({ "solana-devnet": rpcUrl }))},
    SOLANA_PAYMENT_EXECUTOR:{async fetch(request){return Response.json({transactionId:${JSON.stringify(submittedId)},submitted:true});}}
  });return Response.json({complete:true,queries,batches});}
  catch(error){return Response.json({error:String(error),queries,batches},{status:503});}
}};`,
  );
  const build = spawnSync(
    "bun",
    ["--no-env-file", "build", entry, "--target=browser", "--outfile", output],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const script = await readFile(output, "utf8");
  const startRuntime = () =>
    new Miniflare(
      convertV4MiniflareOptions({
        host: "127.0.0.1",
        port: 0,
        modules: true,
        compatibilityDate: "2026-09-14",
        script,
        d1Databases: { DB: "solana-progress" },
        resourcePersistencePath: join(folder, "storage"),
      }),
    );
  runtime = startRuntime();
  let db = await runtime.getD1Database("DB");
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlQuery(
      await readFile(join("migrations", name), "utf8"),
    ))
      await db.prepare(sql).run();
  const deployment = {
    network: "solana-devnet",
    vault: key(10),
    projectPda: key(11),
    programId: key(12),
    upgradeAuthority: key(17),
    networkDomain: "a".repeat(64),
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    owner: key(13),
    identityAuthority: key(14),
    feeRecipient: key(15),
    rotationAuthority: key(16),
    deploymentTransaction: submittedId,
    sourceCommit: "b".repeat(40),
    codeSha256: "c".repeat(64),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
    factory: null,
    factoryCodeSha256: null,
    registrar: null,
  };
  const escrow = assertEscrowPolicy({
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [deployment],
  });
  const base = applicationManifest("progress", "example/progress");
  const text = JSON.stringify(
    assertProjectDefinition({
      ...base,
      escrow,
      reward: { ...base.reward, chain: "solana", feeBasisPoints: 200 },
      rewardAsset: {
        network: "solana",
        kind: "stablecoin",
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        chainId: null,
        cluster: "mainnet-beta",
        decimals: 6,
        verifiedAt: stamp,
      },
    }),
  );
  const hash = createHash("sha256").update(text).digest("hex");
  const obligation = `0x${"d".repeat(64)}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('progress',1,?,?,'Fixture',?)",
      )
      .bind(text, hash, stamp),
    db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('progress','paused',1,?,?,?,?)",
      )
      .bind(text, hash, stamp, stamp),
    db
      .prepare(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES('claim','101','fixture',?,'d1_registry',?,?,?,NULL,?,'solana')",
      )
      .bind(key(18), hash, stamp, hash, stamp),
    db
      .prepare(
        "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge','claim','101','fixture','2027-01-01T00:00:00.000Z',?)",
      )
      .bind(stamp),
    db
      .prepare(
        "INSERT INTO payment_wallet_authorizations VALUES('claim','101',?,'challenge','fixture')",
      )
      .bind(stamp),
    db
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,'progress','101','solana-devnet','solana',?,?,6,'100','2',?,'reserved',?,NULL)",
      )
      .bind(
        obligation,
        deployment.vault,
        deployment.asset,
        "e".repeat(64),
        stamp,
      ),
    db
      .prepare("INSERT INTO payment_outbox VALUES(?,'ready',NULL,NULL,?)")
      .bind(obligation, stamp),
    db
      .prepare(
        "INSERT INTO payment_chain_cursors VALUES('progress','solana-devnet','preceding-cursor',?)",
      )
      .bind(stamp),
    db.prepare(
      "INSERT INTO payment_solana_scans(project_id,network,generation,until_signature,ready) VALUES('progress','solana-devnet','fixture-generation','preceding-cursor',1)",
    ),
    db
      .prepare(
        "INSERT INTO payment_solana_scan_pages VALUES('progress','solana-devnet','fixture-generation',0,?)",
      )
      .bind(
        JSON.stringify(
          signatures.map((signature) => ({ signature, err: null })),
        ),
      ),
  ]);
  const state = async () => ({
    cursor: (
      await db.prepare("SELECT position FROM payment_chain_cursors").first()
    ).position,
    remaining:
      (
        await db
          .prepare(
            "SELECT json_array_length(signatures_json) n FROM payment_solana_scan_pages",
          )
          .first()
      )?.n ?? 0,
    outbox: (await db.prepare("SELECT state FROM payment_outbox").first())
      .state,
  });
  const running = runtime
    .dispatchFetch("http://local/scheduled")
    .then((r) => r.text())
    .catch(String);
  await blocked;
  const interrupted = await state();
  console.log(JSON.stringify({ interrupted, calls: calls.length }));
  await runtime.dispose();
  await running;
  hold = false;
  release();
  runtime = startRuntime();
  db = await runtime.getD1Database("DB");
  const persisted = await state();
  const first = calls.length;
  const resumedResponse = await runtime.dispatchFetch(
    "http://local/resumed-scheduled",
  );
  const resumedBody = await resumedResponse.text();
  const resumedCalls = calls.slice(first);
  const resumed = await state();
  console.log(
    JSON.stringify({
      persisted,
      resumed,
      resumedFirst: resumedCalls[0],
      resumedRequests: resumedCalls.length,
      scheduledResponse: resumedBody,
    }),
  );
  assert.equal(
    interrupted.cursor,
    signatures[0],
    "A verified prefix must survive an interrupted scheduled scan",
  );
  assert.equal(interrupted.remaining, 102);
  assert.equal(
    interrupted.outbox,
    "ready",
    "The gated scan still precedes downstream dispatch",
  );
  assert.deepEqual(persisted, interrupted);
  assert.deepEqual(
    resumedCalls,
    signatures.slice(1, 101),
    "Resume oldest first and retain the original 100-transaction bound",
  );
  assert.equal(resumed.cursor, signatures[100]);
  assert.equal(resumed.remaining, 2);
  assert.equal(
    resumed.outbox,
    "submitted",
    "The actual scheduled entrypoint reaches the dispatcher after resuming",
  );
  // A failed current transaction stays pending; earlier fully verified work
  // persists even when the invocation reports a provider failure.
  failedSignature = signatures[102];
  await (await runtime.dispatchFetch("http://local/provider-failure")).text();
  const failed = await state();
  assert.equal(failed.cursor, signatures[101]);
  assert.equal(failed.remaining, 1);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT json_extract(signatures_json,'$[0].signature') signature FROM payment_solana_scan_pages",
        )
        .first()
    ).signature,
    failedSignature,
  );
  failedSignature = null;
  await (await runtime.dispatchFetch("http://local/provider-recovery")).text();
  assert.equal((await state()).cursor, signatures[102]);
  assert.equal((await state()).remaining, 0);
  await (await runtime.dispatchFetch("http://local/interval-complete")).text();
  assert.equal(
    await db.prepare("SELECT 1 FROM payment_solana_scans").first(),
    null,
  );

  // A newer run wins while the old run is blocked on its first transaction.
  // Releasing that old read must not rewind or overwrite the interval, and
  // losing the fence must stop it before any additional stale RPC work.
  const race = [201, 202, 203].map((byte) =>
    base58.encode(new Uint8Array(64).fill(byte)),
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO payment_solana_scans(project_id,network,generation,until_signature,ready) VALUES('progress','solana-devnet','race-generation',?,1)",
      )
      .bind(signatures[102]),
    db
      .prepare(
        "INSERT INTO payment_solana_scan_pages VALUES('progress','solana-devnet','race-generation',0,?)",
      )
      .bind(
        JSON.stringify(race.map((signature) => ({ signature, err: null }))),
      ),
  ]);
  pauseSignature = race[0];
  hold = true;
  blocked = new Promise((resolve) => {
    signalBlocked = resolve;
  });
  gate = new Promise((resolve) => {
    release = resolve;
  });
  const oldRun = runtime
    .dispatchFetch("http://local/stale-run")
    .then((r) => r.text());
  await blocked;
  await (await runtime.dispatchFetch("http://local/winning-run")).text();
  const advanced = await state();
  const advancedScan = await db
    .prepare("SELECT generation,revision FROM payment_solana_scans")
    .first();
  const priorCalls = calls.length;
  release();
  await oldRun;
  assert.deepEqual(await state(), advanced);
  assert.equal(advanced.cursor, race[2]);
  assert.deepEqual(
    await db
      .prepare("SELECT generation,revision FROM payment_solana_scans")
      .first(),
    advancedScan,
  );
  assert.equal(
    calls.length,
    priorCalls,
    "A lost fence stops stale work immediately",
  );
  const payment = await db
    .prepare("SELECT state,paid_transaction FROM payment_obligations")
    .first();
  assert.deepEqual(
    payment,
    { state: "reserved", paid_transaction: null },
    "No finalized payment was fabricated",
  );
  console.log(
    "PASS native scheduled Solana prefix restart, failure isolation, ordering and stale-fence recovery",
  );
} finally {
  release();
  await runtime?.dispose();
  rpc.closeAllConnections();
  await new Promise((resolve) => rpc.close(resolve));
}
