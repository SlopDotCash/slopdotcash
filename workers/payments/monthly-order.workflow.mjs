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

// Real dispatcher/migrations/native D1. The executor binding is a transport
// fixture; the compiled EVM suite separately proves the root/leaf ordering.
const folder = await mkdtemp(join(tmpdir(), "slop-monthly-order-"));
const time = "2027-01-05T00:00:00.000Z";
const requests = [];
let failCurrent = false;
let runtime;
try {
  const entry = join(folder, "worker.ts");
  const output = join(folder, "worker.mjs");
  await writeFile(
    entry,
    `import {runMonthlyCommitments} from ${JSON.stringify(resolve("workers/payments/index.ts"))};
export default {async fetch(request,env){try {
await runMonthlyCommitments({PAYMENTS_DB:env.DB,REGISTRY_DB:env.DB,PAYMENT_NETWORKS:'["base-sepolia"]',PAYMENT_RPC_URLS:'{}',MONTHLY_PAYMENT_SCHEDULE:JSON.stringify({firstPeriod:'2026-11',cutoffSecondsAfterPeriodEnd:259200}),EVM_PAYMENT_EXECUTOR:env.EXECUTOR},new Date(${JSON.stringify(time)}));
return new Response(null,{status:204});}catch{return new Response(null,{status:503});}}};`,
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
      d1Databases: { DB: "monthly-order" },
      serviceBindings: {
        EXECUTOR: async (request) => {
          const { plan } = await request.json();
          const { projectId, period, network } = plan.request;
          const admit = new URL(request.url).searchParams.get("admit");
          requests.push({ projectId, period, network, admit });
          if (failCurrent && projectId === "batch-25" && period === "2026-12")
            return new Response(null, { status: 503 });
          return Response.json({
            transactionId:
              period === "2026-12" ? "fixture-root" : "fixture-leaf",
            alreadyCommitted: period !== "2026-12",
            complete: false,
          });
        },
      },
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
  const fk = await db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(fk.results.length, 0);
  console.log(
    JSON.stringify({
      nativeD1: true,
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
  await runtime?.dispose();
  await rm(folder, { recursive: true, force: true });
}
