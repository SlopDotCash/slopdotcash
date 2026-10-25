/** Actual local Workerd/D1/R2/queue proof for the hosted qualification entry. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const directory = await mkdtemp(join(tmpdir(), "slop-vetting-recovery-"));
let runtime;
try {
  const file = join(directory, "worker.mjs");
  const build = spawnSync(
    "bun",
    [
      "build",
      "workers/vetting-backup/qualification.ts",
      "--target=browser",
      `--outfile=${file}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const { qualificationSchema, qualificationMigrations } = await import(
    pathToFileURL(file).href
  );
  const entry = join(directory, "entry.mjs");
  const entryBuild = spawnSync(
    "bun",
    [
      "build",
      "workers/vetting-backup/qualification-entry.ts",
      "--target=browser",
      `--outfile=${entry}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(entryBuild.status, 0, entryBuild.stderr);
  const identity = "slop-vet-q-12345-1";
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "recovery-qualification",
      modules: true,
      script: await readFile(entry, "utf8"),
      compatibilityDate: "2026-07-30",
      bindings: {
        QUALIFICATION_RUN: identity,
        EVIDENCE_BACKUP_MODE: "enabled",
        EVIDENCE_RETENTION_MODE: "off",
      },
      r2Buckets: ["EVIDENCE_SOURCE", "EVIDENCE_BACKUPS", "RESTORED"],
      d1Databases: ["EVIDENCE_DATABASE", "RESTORED_DB"],
      queueProducers: { EVIDENCE_BACKUP_QUEUE: { queueName: "qualification" } },
      queueConsumers: {
        qualification: { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 1 },
      },
    }),
  );
  await runtime.ready;
  const db = await runtime.getD1Database("EVIDENCE_DATABASE"),
    recovered = await runtime.getD1Database("RESTORED_DB");
  for (const database of [db, recovered]) {
    for (const query of splitSqlQuery(qualificationSchema))
      await database.prepare(query).run();
    for (const migration of qualificationMigrations)
      for (const query of splitSqlQuery(
        await readFile(`migrations/${migration}`, "utf8"),
      ))
        await database.prepare(query).run();
  }
  const queue = await runtime.getQueueProducer("EVIDENCE_BACKUP_QUEUE");
  const send = (action) => queue.send({ qualification: identity, action });
  async function wait(name) {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const { results } = await db
        .prepare("SELECT phase,result FROM qualification_results")
        .all();
      assert.ok(
        !results.some((r) => r.phase.startsWith("failed-")),
        JSON.stringify(results),
      );
      const row = results.find((r) => r.phase === name);
      if (row) return JSON.parse(row.result);
      assert.ok(Date.now() < deadline, `No ${name} result`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(
    (await runtime.dispatchFetch("https://qualification.invalid/")).status,
    404,
  );
  await send("seed");
  await wait("seed");
  const deadline = Date.now() + 120_000;
  while (
    (await db.prepare("SELECT phase FROM vetting_storage_cycles").first())
      ?.phase !== "complete"
  ) {
    assert.ok(Date.now() < deadline, "Actual backup queue did not finish");
    await new Promise((r) => setTimeout(r, 100));
  }
  await send("verify");
  const proof = await wait("verify");
  assert.equal(proof.objects, 68);
  assert.equal(proof.replayUnchanged, true);
  assert.equal(proof.foreignKeysValid, true);
  assert.equal(proof.immutablePolicy, true);
  await send("verify");
  await send("corrupt");
  const corruption = await wait("corrupt");
  assert.deepEqual(corruption, {
    changedBytesRefused: true,
    missingPageRefused: true,
    sourceUnchanged: true,
  });
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM qualification_results WHERE phase='verify'",
        )
        .first()
    ).n,
    1,
  );
  // Replay keeps the recovered rows and source audit unchanged; this
  // workflow does not claim to restore the shared production application DB.
  assert.equal(
    (
      await recovered
        .prepare("SELECT consumed_at FROM vetting_evidence_grants")
        .first()
    ).consumed_at,
    "2026-10-25T00:00:00.000Z",
  );
  await send("empty");
  await wait("empty");
  for (const binding of ["EVIDENCE_SOURCE", "EVIDENCE_BACKUPS", "RESTORED"])
    assert.equal(
      (await (await runtime.getR2Bucket(binding)).list()).objects.length,
      0,
    );
  console.log(
    JSON.stringify({
      localWorkerd: true,
      publicRoute: 404,
      proof,
      corruption,
      ownedFixtureBucketsEmpty: true,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
