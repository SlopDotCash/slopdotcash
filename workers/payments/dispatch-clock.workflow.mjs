import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Actual worker dispatcher, leases, attempts and native D1. A controlled clock
// represents a 61-second first executor call; no wall-clock wait or live send.
const folder = await mkdtemp(join(tmpdir(), "slop-dispatch-clock-"));
const stamp = "2026-10-29T00:00:02.000Z";
const ids = [`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`];
let runtime;
try {
  const entry = join(folder, "worker.ts");
  const output = join(folder, "worker.mjs");
  await writeFile(
    entry,
    `import {runPaymentDispatch} from ${JSON.stringify(resolve("workers/payments/index.ts"))};
import {dispatchPayment} from ${JSON.stringify(resolve("backend/payments/dispatch.ts"))};
const NativeDate=Date;
let clock=NativeDate.parse(${JSON.stringify(stamp)});
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
export default {async fetch(request,env){
  let probeCalls=0,probeOutcome,leaseUntil;
  const service={async fetch(request){
    const payment=await request.json();
    if(payment.obligationId===${JSON.stringify(ids[0])}) clock+=61000;
    else {
      leaseUntil=(await env.DB.prepare('SELECT lease_until FROM payment_outbox WHERE obligation_id=?').bind(payment.obligationId).first()).lease_until;
      probeOutcome=await dispatchPayment(env.DB,{async submit(input){probeCalls++;return {transactionId:'fixture-second'};}},payment.obligationId,new Date());
    }
    return Response.json({transactionId:payment.obligationId===${JSON.stringify(ids[0])}?'fixture-first':'fixture-second'});
  }};
  await runPaymentDispatch({PAYMENTS_DB:env.DB,REGISTRY_DB:env.DB,PAYMENT_NETWORKS:'["base-sepolia"]',PAYMENT_RPC_URLS:'{}',EVM_PAYMENT_EXECUTOR:service});
  return Response.json({probeCalls,probeOutcome,leaseUntil,now:new Date().toISOString()});
}};`,
  );
  const build = spawnSync(
    "bun",
    ["--no-env-file", "build", entry, "--target=browser", "--outfile", output],
    { encoding: "utf8", env: childEnvironment(), timeout: 30_000 },
  );
  assert.equal(build.status, 0, build.stderr);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      modules: true,
      compatibilityDate: "2026-09-14",
      script: await readFile(output, "utf8"),
      d1Databases: { DB: "dispatch-clock" },
      outboundService() {
        throw new Error("Unexpected external request");
      },
    }),
  );
  const db = await runtime.getD1Database("DB");
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.batch(
      splitSqlQuery(await readFile(`migrations/${name}`, "utf8")).map((sql) =>
        db.prepare(sql),
      ),
    );
  const vault = `0x${"2".repeat(40)}`;
  const deployment = {
    network: "base-sepolia",
    vault,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    owner: `0x${"1".repeat(40)}`,
    identityAuthority: `0x${"3".repeat(40)}`,
    feeRecipient: `0x${"4".repeat(40)}`,
    deploymentTransaction: `0x${"a".repeat(64)}`,
    sourceCommit: "a".repeat(40),
    codeSha256: "b".repeat(64),
    bindingDelaySeconds: "60",
    rotationDelaySeconds: null,
    factory: `0x${"5".repeat(40)}`,
    factoryCodeSha256: "c".repeat(64),
    registrar: `0x${"6".repeat(40)}`,
  };
  const text = JSON.stringify(
    applicationManifest("clock", "example/clock", {
      escrow: {
        schemaVersion: "1",
        effectiveCycle: "2026-11",
        chain: "base",
        feeBasisPoints: 200,
        withdrawalFeeBasisPoints: 200,
        feeMode: "deduct-from-gross",
        deployments: [deployment],
      },
    }),
  );
  const hash = createHash("sha256").update(text).digest("hex");
  await db.batch([
    db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('clock',1,?,?,'Fixture',?)",
      )
      .bind(text, hash, stamp),
    db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('clock','paused',1,?,?,?,?)",
      )
      .bind(text, hash, stamp, stamp),
    db
      .prepare(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES('claim','101','fixture',?,'d1_registry',?,?,?,NULL,?,'base')",
      )
      .bind(`0x${"7".repeat(40)}`, hash, stamp, hash, stamp),
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
    ...ids.flatMap((id, index) => [
      db
        .prepare(
          "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,'clock','101','base-sepolia','base',?, ?,6,'100','2',?,'reserved',?,NULL)",
        )
        .bind(
          id,
          vault,
          deployment.asset,
          (index ? "b" : "a").repeat(64),
          stamp,
        ),
      db
        .prepare("INSERT INTO payment_outbox VALUES(?,'ready',NULL,NULL,?)")
        .bind(id, `2026-10-29T00:00:0${index}.000Z`),
    ]),
  ]);
  const response = await runtime.dispatchFetch("https://slop.cash/dispatch");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.probeOutcome, "unavailable", JSON.stringify(result));
  assert.equal(result.probeCalls, 0);
  assert.ok(Date.parse(result.leaseUntil) > Date.parse(result.now));
  const rows = await db
    .prepare("SELECT state FROM payment_outbox ORDER BY obligation_id")
    .all();
  assert.deepEqual(
    rows.results.map((row) => row.state),
    ["submitted", "submitted"],
  );
  const attempts = await db
    .prepare("SELECT COUNT(*) total FROM payment_attempts")
    .first();
  assert.equal(attempts.total, 2);
  console.log(
    JSON.stringify({
      nativeD1: true,
      ...result,
      outboxStates: rows.results.map((row) => row.state),
      paymentAttempts: attempts.total,
      liveChain: false,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(folder, { recursive: true, force: true });
}
