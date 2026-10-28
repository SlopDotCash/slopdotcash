import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const directory = await mkdtemp(join(tmpdir(), "slop-backup-workflow-"));
let runtime;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const options = (bytes) => ({
  customMetadata: { sha256: digest(bytes) },
  httpMetadata: { contentType: "application/octet-stream" },
});
try {
  const bundle = join(directory, "worker.mjs");
  const build = spawnSync(
    "bun",
    [
      "build",
      "workers/vetting-backup/core.ts",
      "--target=browser",
      `--outfile=${bundle}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const {
    default: worker,
    startDailyBackup,
    backupPage,
    restoreCheck,
    pruneAccessAudit,
    cleanupEvidence,
  } = await import(pathToFileURL(bundle).href);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "backup-workflow",
      modules: true,
      script: await readFile(bundle, "utf8"),
      compatibilityDate: "2026-07-30",
      bindings: { EVIDENCE_BACKUP_MODE: "enabled" },
      r2Buckets: ["EVIDENCE_SOURCE", "EVIDENCE_BACKUPS", "RESTORED"],
      d1Databases: ["EVIDENCE_DATABASE"],
      queueProducers: {
        EVIDENCE_BACKUP_QUEUE: { queueName: "evidence-backup" },
      },
      queueConsumers: {
        "evidence-backup": {
          maxBatchSize: 1,
          maxBatchTimeout: 0,
          maxRetries: 1,
        },
      },
    }),
  );
  await runtime.ready;
  const source = await runtime.getR2Bucket("EVIDENCE_SOURCE");
  const backups = await runtime.getR2Bucket("EVIDENCE_BACKUPS");
  const restored = await runtime.getR2Bucket("RESTORED");
  const queue = await runtime.getQueueProducer("EVIDENCE_BACKUP_QUEUE");
  const db = await runtime.getD1Database("EVIDENCE_DATABASE");
  await db
    .prepare(
      "CREATE TABLE vetting_assessments(id TEXT PRIMARY KEY,state TEXT,completed_at TEXT,result TEXT)",
    )
    .run();
  for (const migration of [
    "0034_vetting_private_evidence.sql",
    "0035_vetting_evidence_chunks.sql",
    "0036_vetting_evidence_assembly.sql",
    "0066_vetting_case_retention.sql",
    "0067_vetting_audit_retention.sql",
    "0068_vetting_storage_cycles.sql",
    "0107_vetting_content_addressed_evidence.sql",
  ])
    for (const query of splitSqlQuery(
      await readFile(`migrations/${migration}`, "utf8"),
    ))
      await db.prepare(query).run();
  await db
    .prepare(
      "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,created_at) VALUES('old','fixture','read','fixture',strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 year','-1 day')),('recent','fixture','read','fixture',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .run();
  await assert.rejects(
    db.prepare("DELETE FROM vetting_evidence_audit WHERE id='recent'").run(),
    /one year/,
  );
  const env = {
    EVIDENCE_DATABASE: db,
    EVIDENCE_SOURCE: source,
    EVIDENCE_BACKUPS: backups,
    EVIDENCE_BACKUP_QUEUE: queue,
    EVIDENCE_BACKUP_MODE: "enabled",
  };
  const fixtures = Array.from({ length: 65 }, (_, index) => ({
    key: `vetting/case-${String(index).padStart(3, "0")}/run/evidence`,
    bytes: Buffer.from(`harmless scanner fixture ${index}`),
  }));
  for (const object of fixtures)
    await source.put(object.key, object.bytes, options(object.bytes));
  await source.put("permanent-contributor-trace", "outside scanner scope");
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  await startDailyBackup({ ...env, EVIDENCE_BACKUP_MODE: "off" }, now);
  assert.equal((await backups.list()).objects.length, 0);
  await pruneAccessAudit({ ...env, EVIDENCE_BACKUP_MODE: "off" });
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM vetting_evidence_audit")
        .first()
    ).count,
    2,
  );
  await worker.scheduled({ scheduledTime: now }, env);
  assert.deepEqual(
    (await db.prepare("SELECT id FROM vetting_evidence_audit").all()).results,
    [{ id: "recent" }],
  );
  const completionKey = `daily/${day}/complete.json`;
  const deadline = Date.now() + 30_000;
  let complete = await backups.get(completionKey);
  while (!complete) {
    assert.ok(
      Date.now() < deadline,
      "real queue worker did not finish the snapshot",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    complete = await backups.get(completionKey);
  }
  while (
    (
      await db
        .prepare("SELECT phase FROM vetting_storage_cycles WHERE day=?")
        .bind(day)
        .first()
    ).phase !== "complete"
  ) {
    assert.ok(Date.now() < deadline, "storage cycle did not finish");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const receipt = await complete.json();
  assert.equal(receipt.objects, fixtures.length);
  assert.equal(receipt.pages, 3);
  assert.equal(
    receipt.bytes,
    fixtures.reduce((sum, item) => sum + item.bytes.length, 0),
  );
  assert.equal(
    await backups.get(`daily/${day}/objects/permanent-contributor-trace`),
    null,
  );
  const completeDigest = complete.customMetadata.sha256;
  await startDailyBackup(env, now + 1000);
  assert.equal(
    (await backups.head(completionKey)).customMetadata.sha256,
    completeDigest,
  );

  const original = fixtures[37];
  const result = await restoreCheck(
    backups,
    restored,
    day,
    original.key,
    "before-activation",
  );
  assert.equal(result.sha256, digest(original.bytes));
  assert.deepEqual(
    Buffer.from(await (await restored.get(result.key)).arrayBuffer()),
    original.bytes,
  );
  assert.deepEqual(
    Buffer.from(await (await source.get(original.key)).arrayBuffer()),
    original.bytes,
  );
  assert.equal(
    (await runtime.dispatchFetch("https://backup.invalid/")).status,
    404,
  );

  // A corrupt copy cannot pass recovery, even with the original metadata.
  const corruptKey = `daily/${day}/objects/${original.key}`;
  await backups.put(
    corruptKey,
    Buffer.alloc(original.bytes.length),
    options(original.bytes),
  );
  await assert.rejects(
    restoreCheck(backups, restored, day, original.key, "corrupt-copy"),
    /changed/,
  );
  assert.equal(
    await restored.get(`restore-checks/corrupt-copy/${original.key}`),
    null,
  );

  // Retention uses real D1 closure records and raw R2 bytes. Keep open and
  // recently closed cases, delete only expired cases, including chunked files.
  const retainedCases = [];
  for (const [id, age, chunked] of [
    ["vet_expired_chunks", 91, true],
    ["vet_expired_single", 91, false],
    ...Array.from({ length: 18 }, (_, i) => [
      `vet_missing_${String(i).padStart(2, "0")}`,
      91,
      false,
    ]),
    ["vet_partial_upload", 91, true],
    ["vet_recent_case", 89, false],
    ["vet_open_case", null, false],
    ["vet_permanent_admission", 91, false],
  ]) {
    await db
      .prepare(
        "INSERT INTO vetting_assessments(id,state,completed_at) VALUES(?,'incomplete',?)",
      )
      .bind(id, new Date(now).toISOString())
      .run();
    if (id === "vet_permanent_admission")
      await db
        .prepare(
          "UPDATE vetting_assessments SET state='clean',result=?,completed_at=? WHERE id=?",
        )
        .bind(
          JSON.stringify({
            schemaVersion: "slop-vetting-result-v2",
            disposition: "clean",
          }),
          new Date(now - age * 86400_000).toISOString(),
          id,
        )
        .run();
    if (age !== null && id !== "vet_permanent_admission")
      await db
        .prepare(
          "INSERT INTO vetting_evidence_case_closures VALUES(?,?, 'fixture', 'fixture closure')",
        )
        .bind(id, new Date(now - age * 86400_000).toISOString())
        .run();
    const data = Buffer.alloc(chunked ? 9 * 1024 * 1024 : 10, 7);
    const sha = digest(data),
      key = `vetting/${id}/run/${sha}`;
    const chunks = chunked
      ? [data.subarray(0, 8 * 1024 * 1024), data.subarray(8 * 1024 * 1024)].map(
          (part, index) => ({
            index,
            sha256: digest(part),
            sizeBytes: part.length,
          }),
        )
      : null;
    await db
      .prepare(
        "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'run',?,?,?,'{}',?,?)",
      )
      .bind(
        id,
        sha,
        sha,
        "{}",
        new Date(now).toISOString(),
        new Date(now).toISOString(),
      )
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks) VALUES(?,'run',?,?,'trace','fixture','application/octet-stream',?,?)",
      )
      .bind(id, sha, data.length, key, chunks ? JSON.stringify(chunks) : null)
      .run();
    const keys = chunks
      ? chunks.map((part) => `${key}/chunks/${part.index}/${part.sha256}`)
      : [key];
    if (chunks)
      for (const part of chunks) {
        if (id === "vet_partial_upload" && part.index === 1) continue;
        const bytes = data.subarray(
          part.index * 8 * 1024 * 1024,
          part.index * 8 * 1024 * 1024 + part.sizeBytes,
        );
        await source.put(keys[part.index], bytes, options(bytes));
      }
    else if (!id.startsWith("vet_missing_"))
      await source.put(key, data, options(data));
    retainedCases.push({ id, age, keys });
  }
  // Content-addressed objects (migration 0107): one stored copy serves every
  // run that declares its digest. An expired reference gets its receipt, but
  // the bytes stay while permanent admission evidence still references them;
  // an object no other reference needs is deleted.
  const sharedData = Buffer.alloc(12, 5),
    soleData = Buffer.alloc(13, 6);
  const contentKey = (bytes) => `vetting/objects/${digest(bytes)}`;
  for (const [id, bytes, permanent] of [
    ["vet_shared_expired", sharedData, false],
    ["vet_shared_permanent", sharedData, true],
    ["vet_content_expired", soleData, false],
  ]) {
    const sha = digest(bytes);
    await db
      .prepare(
        "INSERT INTO vetting_assessments(id,state,completed_at,result) VALUES(?,?,?,?)",
      )
      .bind(
        id,
        permanent ? "clean" : "incomplete",
        new Date(now - 91 * 86400_000).toISOString(),
        permanent
          ? JSON.stringify({
              schemaVersion: "slop-vetting-result-v2",
              disposition: "clean",
            })
          : null,
      )
      .run();
    if (!permanent)
      await db
        .prepare(
          "INSERT INTO vetting_evidence_case_closures VALUES(?,?, 'fixture', 'fixture closure')",
        )
        .bind(id, new Date(now - 91 * 86400_000).toISOString())
        .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'run',?,?,?,'{}',?,?)",
      )
      .bind(
        id,
        sha,
        sha,
        "{}",
        new Date(now).toISOString(),
        new Date(now).toISOString(),
      )
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks,storage) VALUES(?,'run',?,?,'trace','fixture','application/octet-stream',?,NULL,'content')",
      )
      .bind(id, sha, bytes.length, `vetting/${id}/run/${sha}`)
      .run();
    await source.put(contentKey(bytes), bytes, options(bytes));
  }
  const cleanupJobs = [];
  const retentionEnv = {
    ...env,
    EVIDENCE_RETENTION_MODE: "enabled",
    EVIDENCE_BACKUP_QUEUE: { send: async (job) => cleanupJobs.push(job) },
  };
  const retentionTime = now + 86400_000,
    retentionDay = new Date(retentionTime).toISOString().slice(0, 10);
  await startDailyBackup(retentionEnv, retentionTime);
  await assert.rejects(
    cleanupEvidence(retentionEnv, retentionDay),
    /Snapshot is not complete/,
  );
  // A later cron cannot start a concurrent snapshot or steal the active cycle.
  await startDailyBackup(retentionEnv, retentionTime + 86400_000);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM vetting_storage_cycles WHERE phase <> 'complete'",
        )
        .first()
    ).count,
    1,
  );
  let injectedFailure = false;
  while (cleanupJobs.length) {
    const job = cleanupJobs.shift();
    if (job.kind !== "cleanup") {
      await backupPage(retentionEnv, job);
      continue;
    }
    if (!injectedFailure) {
      injectedFailure = true;
      const firstKey = retainedCases[0].keys[0];
      const savedPart = Buffer.from(
        await (await source.get(firstKey)).arrayBuffer(),
      );
      const copyKey = `daily/${retentionDay}/objects/${firstKey}`;
      await backups.delete(copyKey);
      await assert.rejects(cleanupEvidence(retentionEnv, retentionDay));
      assert.ok(
        await source.head(firstKey),
        "missing backup must prevent source deletion",
      );
      await backups.put(copyKey, savedPart, options(savedPart));
      let deletes = 0;
      const interruptSource = new Proxy(source, {
        get(target, property) {
          if (property === "delete")
            return async (key) => {
              if (++deletes === 2)
                throw new Error("injected deletion interruption");
              return target.delete(key);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        cleanupEvidence(
          { ...retentionEnv, EVIDENCE_SOURCE: interruptSource },
          retentionDay,
        ),
        /injected deletion interruption/,
      );
    }
    await cleanupEvidence(retentionEnv, job.day);
  }
  for (const item of retainedCases)
    for (const key of item.keys) {
      assert.equal(
        Boolean(await source.head(key)),
        item.age !== 91 || item.id === "vet_permanent_admission",
      );
      assert.equal(
        Boolean(await backups.head(`daily/${retentionDay}/objects/${key}`)),
        !item.id.startsWith("vet_missing_") &&
          !(item.id === "vet_partial_upload" && key === item.keys[1]),
        "only uploaded bytes have verified backup copies",
      );
    }
  assert.ok(
    await source.head(contentKey(sharedData)),
    "bytes a retained reference still needs are kept",
  );
  assert.equal(await source.head(contentKey(soleData)), null);
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT assessment_id FROM vetting_evidence_deletions ORDER BY assessment_id",
        )
        .all()
    ).results.map((row) => row.assessment_id),
    [
      "vet_content_expired",
      "vet_expired_chunks",
      "vet_expired_single",
      "vet_shared_expired",
    ],
  );
  assert.ok(await source.head("permanent-contributor-trace"));
  assert.equal(
    (
      await db
        .prepare("SELECT phase FROM vetting_storage_cycles WHERE day=?")
        .bind(retentionDay)
        .first()
    ).phase,
    "complete",
  );

  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM vetting_evidence_audit WHERE action='retention-missing'",
        )
        .first()
    ).count,
    19,
  );
  // Missing inventory spans more than one cleanup page. It is audited, never
  // marked deleted, and does not keep the next day's backup from running.
  const nextTime = now + 2 * 86400_000;
  const nextDay = new Date(nextTime).toISOString().slice(0, 10);
  await startDailyBackup(retentionEnv, nextTime);
  while (cleanupJobs.length) {
    const job = cleanupJobs.shift();
    if (job.kind === "cleanup") await cleanupEvidence(retentionEnv, job.day);
    else await backupPage(retentionEnv, job);
  }
  assert.equal(
    (
      await db
        .prepare("SELECT phase FROM vetting_storage_cycles WHERE day=?")
        .bind(nextDay)
        .first()
    ).phase,
    "complete",
  );
  assert.ok(await backups.head(`daily/${nextDay}/complete.json`));
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM vetting_evidence_audit WHERE action='retention-missing'",
        )
        .first()
    ).count,
    38,
  );
  assert.ok(
    await source.head(contentKey(sharedData)),
    "bytes a retained reference still needs are kept",
  );
  assert.equal(await source.head(contentKey(soleData)), null);
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT assessment_id FROM vetting_evidence_deletions ORDER BY assessment_id",
        )
        .all()
    ).results.map((row) => row.assessment_id),
    [
      "vet_content_expired",
      "vet_expired_chunks",
      "vet_expired_single",
      "vet_shared_expired",
    ],
  );

  // Exercise the real registration implementation against the same D1/R2
  // while cleanup is paused at both sides of the deletion claim.
  const evidenceBundle = join(directory, "evidence.mjs");
  const evidenceBuild = spawnSync(
    "bun",
    [
      "build",
      "backend/vetting/evidence.ts",
      "--target=browser",
      `--outfile=${evidenceBundle}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(evidenceBuild.status, 0, evidenceBuild.stderr);
  const { VettingEvidence } = await import(pathToFileURL(evidenceBundle).href);
  const evidence = new VettingEvidence({
    db,
    bucket: source,
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    signed: async (request) => ({
      body: new Uint8Array(await request.arrayBuffer()),
      keySha256: "a".repeat(64),
    }),
  });
  const beforeBytes = Buffer.from(
      "registration wins before the deletion claim",
    ),
    duringBytes = Buffer.from("deletion claim blocks registration");
  const assessment = async (id, permanent = false) =>
    db
      .prepare(
        "INSERT INTO vetting_assessments(id,state,completed_at,result) VALUES(?,?,?,?)",
      )
      .bind(
        id,
        permanent ? "clean" : "incomplete",
        new Date(now).toISOString(),
        permanent
          ? JSON.stringify({
              schemaVersion: "slop-vetting-result-v2",
              disposition: "clean",
            })
          : null,
      )
      .run();
  const register = async (id, bytes) =>
    evidence.register(
      new Request("https://slop.test/evidence", {
        method: "POST",
        body: JSON.stringify({
          traceSha256: digest(bytes),
          objects: [
            {
              sha256: digest(bytes),
              sizeBytes: bytes.length,
              kind: "trace",
              label: "race evidence",
              contentType: "application/octet-stream",
            },
          ],
        }),
      }),
      id,
      "new",
    );
  for (const [id, bytes] of [
    ["race_before_old", beforeBytes],
    ["race_during_old", duringBytes],
  ]) {
    await assessment(id);
    await db
      .prepare(
        "INSERT INTO vetting_evidence_case_closures VALUES(?,?, 'fixture', 'race fixture')",
      )
      .bind(id, new Date(now - 91 * 86400_000).toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'old',?,?,?,'{}',?,?)",
      )
      .bind(
        id,
        digest(bytes),
        digest(bytes),
        "{}",
        new Date(now).toISOString(),
        new Date(now).toISOString(),
      )
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks,storage) VALUES(?,'old',?,?,'trace','race','application/octet-stream',?,NULL,'content')",
      )
      .bind(
        id,
        digest(bytes),
        bytes.length,
        `vetting/${id}/old/${digest(bytes)}`,
      )
      .run();
    await source.put(contentKey(bytes), bytes, options(bytes));
  }
  await assessment("race_before_new", true);
  await assessment("race_during_new", true);
  let registeredBeforeClaim = false,
    refusedDuringDelete = false;
  const beforeClaim = async (sha) => {
    if (sha !== digest(beforeBytes) || registeredBeforeClaim) return;
    registeredBeforeClaim = true;
    const response = await register("race_before_new", beforeBytes);
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).stored, [digest(beforeBytes)]);
    await evidence.verify(
      await evidence.object("race_before_new", "new", digest(beforeBytes)),
      await evidence.run("race_before_new", "new"),
    );
  };
  const raceDb = new Proxy(db, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql) => {
        const statement = target.prepare(sql);
        const claim = sql.includes(
          "INSERT OR IGNORE INTO vetting_evidence_cleanup_claims",
        );
        const oldQuery = sql.includes(
          "SELECT 1 FROM vetting_evidence_objects o",
        );
        if (!claim && !oldQuery) return statement;
        return {
          bind(...values) {
            const bound = statement.bind(...values);
            return claim
              ? {
                  async run() {
                    await beforeClaim(values[0]);
                    return bound.run();
                  },
                }
              : {
                  async first() {
                    const found = await bound.first();
                    await beforeClaim(values[0]);
                    return found;
                  },
                };
          },
        };
      };
    },
  });
  const raceSource = new Proxy(source, {
    get(target, property) {
      if (property === "delete")
        return async (key) => {
          if (key === contentKey(duringBytes) && !refusedDuringDelete) {
            refusedDuringDelete = true;
            await assert.rejects(
              register("race_during_new", duringBytes),
              (error) =>
                error.status === 409 && error.code === "evidence_cleanup",
            );
            assert.equal(
              await db
                .prepare(
                  "SELECT 1 FROM vetting_evidence_runs WHERE assessment_id='race_during_new'",
                )
                .first(),
              null,
              "refusal rolls back the complete registration",
            );
          }
          return target.delete(key);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const raceEnv = {
    ...retentionEnv,
    EVIDENCE_DATABASE: raceDb,
    EVIDENCE_SOURCE: raceSource,
  };
  await startDailyBackup(raceEnv, now + 3 * 86400_000);
  while (cleanupJobs.length) {
    const job = cleanupJobs.shift();
    if (job.kind === "cleanup") await cleanupEvidence(raceEnv, job.day);
    else await backupPage(raceEnv, job);
  }
  assert.equal(registeredBeforeClaim, true);
  assert.equal(refusedDuringDelete, true);
  assert.ok(
    await source.head(contentKey(beforeBytes)),
    "a new permanent reference keeps its verified bytes",
  );
  assert.equal(await source.head(contentKey(duringBytes)), null);
  const retry = await register("race_during_new", duringBytes);
  assert.equal(retry.status, 201);
  assert.deepEqual(
    (await retry.json()).stored,
    [],
    "retry must upload deleted bytes instead of claiming reuse",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM vetting_evidence_cleanup_claims")
        .first()
    ).n,
    0,
  );

  // Storage corruption prevents completion; it is never a skipped object.
  const bad = Buffer.from("bad source");
  await source.put("vetting/000-corrupt/run/evidence", bad, {
    customMetadata: { sha256: "0".repeat(64) },
  });
  const jobs = [];
  const later = now + 4 * 86_400_000;
  const failureEnv = {
    ...env,
    EVIDENCE_BACKUP_QUEUE: {
      send: async (job) => {
        jobs.push(job);
      },
    },
  };
  await startDailyBackup(failureEnv, later);
  await assert.rejects(backupPage(failureEnv, jobs[0]), /changed/);
  assert.equal(
    await backups.get(
      `daily/${new Date(later).toISOString().slice(0, 10)}/complete.json`,
    ),
    null,
  );
  console.log(
    "PASS: real queue/R2 pagination, independent grant-free backup, verified restore, source preservation, scope isolation, interruption-safe expired-case deletion, atomic registration/cleanup handoff and corruption refusal",
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
