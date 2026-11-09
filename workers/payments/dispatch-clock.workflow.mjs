import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Actual worker dispatcher, leases, attempts and native D1. A controlled clock
// represents a 61-second first executor call; no wall-clock wait or live send.
const stamp = "2026-10-29T00:00:02.000Z";
const ids = [`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`];
const retirementId = `0x${"d".repeat(64)}`;
let worker;
try {
  worker = await startHandlerWorker({
    d1: "dispatch-clock",
    outbound() {
      throw new Error("Unexpected external request");
    },
    entrySource: `import {runPaymentDispatch,recoverUncertainAttempts} from ${JSON.stringify(resolve("workers/payments/index.ts"))};
import {dispatchPayment} from ${JSON.stringify(resolve("backend/payments/dispatch.ts"))};
const NativeDate=Date;
let clock=NativeDate.parse(${JSON.stringify(stamp)});
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/retirement'){
    const held=await dispatchPayment(env.DB,{async submit(){throw new Error('Old wallet must stay held');}},${JSON.stringify(retirementId)},new Date());
    const initialOutbox=(await env.DB.prepare('SELECT state FROM payment_outbox WHERE obligation_id=?').bind(${JSON.stringify(retirementId)}).first()).state;
    let first=true,cancelCalls=0,notify,resume;
    const reached=new Promise(resolve=>notify=resolve);
    const gate=new Promise(resolve=>resume=resolve);
    const service={async fetch(request){
      const input=await request.json();
      if(input.idempotencyKey!=='retirement-old') throw new Error('Unexpected retirement attempt');
      if(new URL(request.url).pathname==='/v1/attempt-status') return Response.json({transactionId:null});
      cancelCalls++;
      if(first){first=false;notify();await gate;}
      return Response.json({retired:true,transactionId:null});
    }};
    const recovery={PAYMENTS_DB:env.DB,PAYMENT_NETWORKS:'["base-sepolia"]',EVM_PAYMENT_EXECUTOR:service};
    const pending=recoverUncertainAttempts(recovery);
    await reached;
    try{
      await recoverUncertainAttempts(recovery);
      const submitted=await dispatchPayment(env.DB,{async submit(){return {transactionId:'native-successor'};}},${JSON.stringify(retirementId)},new Date());
      const query=()=>env.DB.prepare('SELECT id,state,transaction_id FROM payment_attempts WHERE obligation_id=? ORDER BY rowid').bind(${JSON.stringify(retirementId)}).all();
      const before=await query();
      resume();await pending;
      const after=await query();
      const outbox=await env.DB.prepare('SELECT state FROM payment_outbox WHERE obligation_id=?').bind(${JSON.stringify(retirementId)}).first();
      return Response.json({held,initialOutbox,submitted,cancelCalls,before:before.results,after:after.results,outbox:outbox.state});
    } finally {resume();await pending.catch(()=>{});}
  }
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
  });
  const { runtime, db } = worker;
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
  // A shared ledger can retain awards for networks this Worker does not serve.
  // They must not consume its 50-row dispatch page or acquire its leases.
  const servedId = `0x${"c".repeat(64)}`;
  await db.batch(
    Array.from({ length: 51 }, (_, index) => {
      const served = index === 50;
      const id = served
        ? servedId
        : `0x${(100 + index).toString(16).padStart(64, "0")}`;
      return db
        .prepare(
          "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,'101',?,'base',?,?,6,'100','2',?,'reserved',?,NULL)",
        )
        .bind(
          id,
          served ? "clock" : "other",
          served ? "base-sepolia" : "base-mainnet",
          vault,
          deployment.asset,
          (100 + index).toString(16).padStart(64, "0"),
          stamp,
        );
    }),
  );
  await db.batch(
    Array.from({ length: 51 }, (_, index) => {
      const id =
        index === 50
          ? servedId
          : `0x${(100 + index).toString(16).padStart(64, "0")}`;
      return db
        .prepare("INSERT INTO payment_outbox VALUES(?,'ready',NULL,NULL,?)")
        .bind(id, index === 50 ? stamp : "2026-10-28T00:00:00.000Z");
    }),
  );
  const scoped = await runtime.dispatchFetch("https://slop.cash/dispatch");
  assert.equal(scoped.status, 200, await scoped.text());
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM payment_outbox WHERE obligation_id=?")
        .bind(servedId)
        .first()
    ).state,
    "submitted",
  );
  const untouched = await db
    .prepare(
      "SELECT COUNT(*) total FROM payment_outbox b JOIN payment_obligations o ON o.id=b.obligation_id WHERE o.network='base-mainnet' AND b.state='ready' AND b.lease_token IS NULL",
    )
    .first();
  assert.equal(untouched.total, 50);
  const foreignAttempts = await db
    .prepare(
      "SELECT COUNT(*) total FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE o.network='base-mainnet'",
    )
    .first();
  assert.equal(foreignAttempts.total, 0);
  // Native workerd D1 must preserve SQLite's immediately preceding UPDATE
  // count across prepared statements in the same batch. Exercise that through
  // the actual recovery function, with two idempotent cancellation responses.
  await db.batch([
    db
      .prepare(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES('claim-retirement','101','fixture',?,'d1_registry',?,?,?,'claim',?,'base')",
      )
      .bind(`0x${"8".repeat(40)}`, hash, stamp, "e".repeat(64), stamp),
    db
      .prepare(
        "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-retirement','claim-retirement','101','fixture','2027-01-01T00:00:00.000Z',?)",
      )
      .bind(stamp),
    db
      .prepare(
        "INSERT INTO payment_wallet_authorizations VALUES('claim-retirement','101',?,'challenge-retirement','fixture')",
      )
      .bind(stamp),
    db
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,'clock','101','base-sepolia','base',?,?,6,'100','2',?,'reserved',?,NULL)",
      )
      .bind(retirementId, vault, deployment.asset, "d".repeat(64), stamp),
    db
      .prepare(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('retirement-old',?,'claim',?,'prepared')",
      )
      .bind(retirementId, stamp),
    db
      .prepare("INSERT INTO payment_outbox VALUES(?,'ready',NULL,NULL,?)")
      .bind(retirementId, stamp),
  ]);
  const retirementResponse = await runtime.dispatchFetch(
    "https://slop.cash/retirement",
  );
  assert.equal(retirementResponse.status, 200);
  const retirement = await retirementResponse.json();
  assert.equal(retirement.held, "unavailable");
  assert.equal(retirement.initialOutbox, "held");
  assert.equal(retirement.submitted, "submitted");
  assert.equal(retirement.cancelCalls, 2);
  assert.equal(retirement.outbox, "submitted");
  assert.deepEqual(retirement.after, retirement.before);
  assert.equal(retirement.after.length, 2);
  assert.deepEqual(
    retirement.after.map((row) => row.state),
    ["failed", "submitted"],
  );
  assert.equal(retirement.after[1].transaction_id, "native-successor");
  console.log(
    JSON.stringify({
      nativeD1: true,
      ...result,
      outboxStates: rows.results.map((row) => row.state),
      paymentAttempts: attempts.total,
      duplicateRetirementPreservesSuccessor: retirement.outbox === "submitted",
      liveChain: false,
    }),
  );
} finally {
  await worker?.dispose();
}
