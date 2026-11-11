import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Real dispatcher/migrations/native D1. The executor binding is a transport
// fixture; the compiled EVM suite separately proves the root/leaf ordering.
const time = "2027-01-05T00:00:00.000Z";
const cutoffNow = new Date();
const cutoffPeriod = new Date(
  Date.UTC(cutoffNow.getUTCFullYear(), cutoffNow.getUTCMonth() - 1, 1),
)
  .toISOString()
  .slice(0, 7);
const requests = [];
let failCurrent = false;
let worker;
try {
  worker = await startHandlerWorker({
    d1: "monthly-order",
    serviceBindings: {
      EXECUTOR: async (request) => {
        const { plan } = await request.json();
        const { projectId, period, network } = plan.request;
        const admit = new URL(request.url).searchParams.get("admit");
        requests.push({ projectId, period, network, admit });
        if (failCurrent && projectId === "batch-25" && period === "2026-12")
          return new Response(null, { status: 503 });
        return Response.json({
          transactionId: period === "2026-12" ? "fixture-root" : "fixture-leaf",
          alreadyCommitted: period !== "2026-12",
          complete: false,
        });
      },
    },
    outbound() {
      throw new Error("Unexpected external request");
    },
    entrySource: `import {runMonthlyCommitments} from ${JSON.stringify(resolve("workers/payments/index.ts"))};
import {monthlyOwnerService} from ${JSON.stringify(resolve("backend/payments/monthly.ts"))};
import {CloudflareProjectPersistence} from ${JSON.stringify(resolve("backend/projects/cloudflare-persistence.ts"))};
export default {async fetch(request,env){try {
if(new URL(request.url).pathname==='/cutoff') {
  const mode=new URL(request.url).searchParams.get('mode');
  const period=${JSON.stringify(cutoffPeriod)};
  const [year,month]=period.split('-').map(Number);
  const deadline=Math.ceil(Date.now()/1000)*1000+2000;
  const wrapped={
    prepare(query){
      const statement=env.DB.prepare(query);
      if(!query.startsWith('INSERT INTO monthly_allocation_changes') || mode==='early') return statement;
      return {bind(...values){const bound=statement.bind(...values);return {async run(){
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now()+100)));
        return bound.run();
      }}}};
    },
    batch(statements){return env.DB.batch(statements);}
  };
  const service=monthlyOwnerService({db:wrapped,
    getProject:(id)=>new CloudflareProjectPersistence(env.DB).getProject(id),
    restricted:async()=>false,networks:()=>['base-sepolia'],verifyAuthority:async()=>true,
    schedule:()=>({firstPeriod:period,cutoffSecondsAfterPeriodEnd:(deadline-Date.UTC(year,month,1))/1000}),
    now:()=>new Date()});
  try {
    const view=await service.changeAllocation('eliza',period,{githubId:'900000071',githubLogin:'owner'},
      {githubUserId:'101',grossBase:mode==='early'?'0':'1',expectedSequence:mode==='early'?0:1});
    return Response.json({sequence:view.proposal.allocationSequence});
  } catch(error) { return Response.json({code:error.code,diagnostic:error.message},{status:error.status??500}); }
}
await runMonthlyCommitments({PAYMENTS_DB:env.DB,REGISTRY_DB:env.DB,PAYMENT_NETWORKS:'["base-sepolia"]',PAYMENT_RPC_URLS:'{}',MONTHLY_PAYMENT_SCHEDULE:JSON.stringify({firstPeriod:'2026-11',cutoffSecondsAfterPeriodEnd:259200}),EVM_PAYMENT_EXECUTOR:env.EXECUTOR},new Date(${JSON.stringify(time)}));
return new Response(null,{status:204});}catch{return new Response(null,{status:503});}}};`,
  });
  const { runtime, db } = worker;
  for (let index = 0; index < 27; index++) {
    const id =
      index === 26 ? "zz-unrelated" : `batch-${String(index).padStart(2, "0")}`;
    const deployment = {
      network: "base-sepolia",
      vault: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      programId: null,
      upgradeAuthority: null,
      projectPda: null,
      networkDomain: null,
      asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      owner: `0x${"1".repeat(40)}`,
      identityAuthority: `0x${"2".repeat(40)}`,
      feeRecipient: `0x${"3".repeat(40)}`,
      deploymentTransaction: `0x${"a".repeat(64)}`,
      sourceCommit: "a".repeat(40),
      codeSha256: "b".repeat(64),
      bindingDelaySeconds: "60",
      rotationDelaySeconds: null,
      factory: `0x${"4".repeat(40)}`,
      factoryCodeSha256: "c".repeat(64),
      registrar: `0x${"5".repeat(40)}`,
    };
    const manifest = applicationManifest(id, `example/${id}`, {
      escrow: {
        schemaVersion: "1",
        effectiveCycle: "2026-11",
        chain: "base",
        feeBasisPoints: 200,
        withdrawalFeeBasisPoints: 200,
        feeMode: "deduct-from-gross",
        deployments: [deployment],
      },
    });
    const text = JSON.stringify(manifest);
    const hash = createHash("sha256").update(text).digest("hex");
    await db.batch([
      db
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture',?)",
        )
        .bind(id, text, hash, time),
      db
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
        )
        .bind(id, text, hash, time, time),
      db
        .prepare("INSERT INTO project_repositories VALUES(?,?)")
        .bind(`example/${id}`, id),
    ]);
    for (const period of index === 26 ? ["2026-12"] : ["2026-11", "2026-12"]) {
      const authorization = JSON.stringify({
        plan: {
          family: "evm",
          request: { projectId: id, period, network: "base-sepolia" },
          deployment,
          evmReservation: { version: 2 },
        },
      });
      await db.batch([
        db
          .prepare("INSERT INTO monthly_reward_bases VALUES(?,?,?,?,?,'1',0,?)")
          .bind(id, period, text, hash, "d".repeat(64), time),
        db
          .prepare(
            "INSERT INTO monthly_payment_runs VALUES(?,?,'automatic',NULL,0,'{}',?,'base-sepolia',?,'1',?,NULL)",
          )
          .bind(id, period, "d".repeat(64), deployment.vault, time),
        db
          .prepare(
            "INSERT INTO monthly_payment_authorizations VALUES(?,?,'base-sepolia',?,?,?)",
          )
          .bind(id, period, "d".repeat(64), authorization, time),
      ]);
    }
  }
  const run = () => runtime.dispatchFetch("https://slop.cash/dispatch");
  assert.equal((await run()).status, 204);
  const target = requests.filter((row) => row.projectId === "batch-25");
  assert.deepEqual(
    target.map((row) => `${row.period}:${row.admit}`),
    ["2026-12:true", "2026-11:false"],
  );
  assert.equal(requests.length, 52);
  assert.equal(
    new Set(
      requests.map((row) => `${row.projectId}/${row.period}/${row.network}`),
    ).size,
    52,
  );
  assert.ok(
    requests.every(
      (row) =>
        row.projectId !== "zz-unrelated" && row.network === "base-sepolia",
    ),
  );
  // Preserve the original LRU work and failure isolation: a root outage does
  // not hold already funded older leaves or block another project's work.
  await db.prepare("DELETE FROM monthly_payment_execution").run();
  requests.length = 0;
  failCurrent = true;
  assert.equal((await run()).status, 503);
  assert.deepEqual(
    requests
      .filter((row) => row.projectId === "batch-25")
      .map((row) => row.period),
    ["2026-12", "2026-11"],
  );
  assert.equal(requests.length, 52);
  // A historical authorization from a replaced vault has no ordering
  // dependency on this project's new vault. The old deployment is refused by
  // the existing dispatcher guard; do not pull in its unrelated current root.
  await db.batch([
    db.prepare(
      "INSERT INTO monthly_reward_bases SELECT project_id,'2026-11',manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,created_at FROM monthly_reward_bases WHERE project_id='zz-unrelated' AND period='2026-12'",
    ),
    db
      .prepare(
        "INSERT INTO monthly_payment_runs SELECT project_id,'2026-11',trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,?,total_gross_base,frozen_at,obligations_created_at FROM monthly_payment_runs WHERE project_id='zz-unrelated' AND period='2026-12'",
      )
      .bind(`0x${"9".repeat(40)}`),
    db
      .prepare(
        "INSERT INTO monthly_payment_authorizations SELECT project_id,'2026-11',network,snapshot_sha256,json_set(authorization,'$.plan.request.period','2026-11','$.plan.deployment.vault',?),published_at FROM monthly_payment_authorizations WHERE project_id='zz-unrelated' AND period='2026-12'",
      )
      .bind(`0x${"9".repeat(40)}`),
  ]);
  await db.prepare("DELETE FROM monthly_payment_execution").run();
  requests.length = 0;
  failCurrent = false;
  assert.equal((await run()).status, 503);
  assert.equal(requests.length, 52);
  assert.ok(requests.every((row) => row.projectId !== "zz-unrelated"));
  // Actual D1 execution crosses the cutoff after JavaScript has bound an
  // otherwise valid edit. The early and opted-out cases must still work.
  const template = JSON.parse(
    (
      await db
        .prepare("SELECT manifest FROM projects WHERE id='zz-unrelated'")
        .first()
    ).manifest,
  );
  const fixture = fixtureProject("eliza");
  const cutoffManifest = {
    ...fixture,
    reward: { ...fixture.reward, feeBasisPoints: 200, chain: "base" },
    escrow: { ...template.escrow, effectiveCycle: cutoffPeriod },
  };
  const cutoffText = JSON.stringify(cutoffManifest);
  const cutoffHash = createHash("sha256").update(cutoffText).digest("hex");
  const cutoffStamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('eliza',1,?,?,'Fixture',?)",
      )
      .bind(cutoffText, cutoffHash, cutoffStamp),
    db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('eliza',?,1,?,?,?,?)",
      )
      .bind(
        cutoffManifest.status,
        cutoffText,
        cutoffHash,
        cutoffStamp,
        cutoffStamp,
      ),
    db.prepare(
      "INSERT INTO project_repositories VALUES('elizaos/eliza','eliza')",
    ),
    db
      .prepare(
        "INSERT INTO monthly_reward_bases VALUES('eliza',?,?,?,?, '1',1,?)",
      )
      .bind(cutoffPeriod, cutoffText, cutoffHash, "e".repeat(64), cutoffStamp),
    db
      .prepare(
        "INSERT INTO monthly_reward_base_rows VALUES('eliza',?,'101','recipient','1',?)",
      )
      .bind(cutoffPeriod, "f".repeat(64)),
  ]);
  const early = await runtime.dispatchFetch(
    "https://slop.cash/cutoff?mode=early",
  );
  assert.equal(early.status, 200, await early.clone().text());
  assert.deepEqual(await early.json(), { sequence: 1 });
  const late = await runtime.dispatchFetch(
    "https://slop.cash/cutoff?mode=late",
  );
  assert.equal(late.status, 409, await late.clone().text());
  assert.equal((await late.json()).code, "cutoff_passed");
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM monthly_allocation_changes WHERE project_id='eliza'",
        )
        .first()
    ).n,
    1,
  );
  await db
    .prepare(
      "INSERT INTO monthly_payment_settings VALUES('eliza',1,0,'900000071',?)",
    )
    .bind(cutoffStamp)
    .run();
  const off = await runtime.dispatchFetch("https://slop.cash/cutoff?mode=off");
  assert.equal(off.status, 200, await off.clone().text());
  assert.deepEqual(await off.json(), { sequence: 2 });
  const fk = await db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(fk.results.length, 0);
  console.log(
    JSON.stringify({
      nativeD1: true,
      queuedCutoffRefused: true,
      beforeCutoffAndOptOutEditsPreserved: true,
      initialPending: 53,
      replacedVaultScenarioPending: 54,
      originalLruCandidates: 50,
      initialSelectedWithPrerequisites: 52,
      duplicateCalls: 0,
      unrelatedProjectIncluded: false,
      replacedVaultRootIncluded: false,
      rootBeforeOlderLeaves: true,
      olderLeavesContinueAfterRootFailure: true,
      foreignKeysValid: true,
      liveChain: false,
    }),
  );
} finally {
  await worker?.dispose();
}
