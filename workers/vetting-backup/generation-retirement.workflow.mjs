/** Source-authored real D1/R2/API workflow; not executed for this change. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const directory = await mkdtemp(join(tmpdir(), "slop-generation-retirement-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const options = (bytes) => ({
  onlyIf: { etagDoesNotMatch: "*" },
  customMetadata: { sha256: digest(bytes) },
  httpMetadata: { contentType: "application/octet-stream" },
});
let runtime;
try {
  const coreFile = join(directory, "core.mjs");
  const evidenceFile = join(directory, "evidence.mjs");
  for (const [source, destination] of [
    ["workers/vetting-backup/core.ts", coreFile],
    ["backend/vetting/evidence.ts", evidenceFile],
  ]) {
    const built = spawnSync(
      "bun",
      ["build", source, "--target=browser", `--outfile=${destination}`],
      { encoding: "utf8" },
    );
    assert.equal(built.status, 0, built.stderr);
  }
  const { startDailyBackup, backupPage, cleanupEvidence, restoreCheck } =
    await import(pathToFileURL(coreFile).href);
  const { VettingEvidence } = await import(pathToFileURL(evidenceFile).href);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await readFile(coreFile, "utf8"),
      compatibilityDate: "2026-07-30",
      r2Buckets: ["SOURCE", "BACKUPS", "RESTORED"],
      d1Databases: ["DB"],
    }),
  );
  await runtime.ready;
  const db = await runtime.getD1Database("DB");
  const source = await runtime.getR2Bucket("SOURCE");
  const backups = await runtime.getR2Bucket("BACKUPS");
  const restored = await runtime.getR2Bucket("RESTORED");
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
    "0119_vetting_storage_generations.sql",
  ]) {
    for (const sql of splitSqlQuery(
      await readFile(`migrations/${migration}`, "utf8"),
    ))
      await db.prepare(sql).run();
  }
  let nextFixtureId = 0;
  const evidence = new VettingEvidence({
    db,
    bucket: source,
    now: () => new Date(),
    // Keep original targets before the later injected-failure targets in key order.
    randomId: () =>
      `00000000-0000-4000-8000-${String(++nextFixtureId).padStart(12, "0")}`,
    signed: async (request) => ({
      body: new Uint8Array(await request.arrayBuffer()),
      keySha256: "a".repeat(64),
    }),
  });
  const data = Buffer.from("harmless generation retirement evidence");
  const sha = digest(data);
  const register = async (id, bytes = data) => {
    const objectSha = digest(bytes);
    await db
      .prepare(
        "INSERT INTO vetting_assessments(id,state) VALUES(?,'incomplete')",
      )
      .bind(id)
      .run();
    const response = await evidence.handle(
      new Request(`https://slop.test/api/v1/vetting/evidence/${id}/run`, {
        method: "POST",
        body: JSON.stringify({
          traceSha256: objectSha,
          objects: [
            {
              sha256: objectSha,
              sizeBytes: bytes.length,
              kind: "trace",
              label: "harmless",
              contentType: "application/octet-stream",
            },
          ],
        }),
      }),
    );
    assert.equal(response.status, 201);
    return (
      await db
        .prepare(
          "SELECT storage_generation FROM vetting_evidence_objects WHERE assessment_id=?",
        )
        .bind(id)
        .first()
    ).storage_generation;
  };
  const upload = (id) =>
    evidence.handle(
      new Request(
        `https://slop.test/api/v1/vetting/evidence/${id}/run/${sha}`,
        { method: "PUT", body: data },
      ),
    );
  const close = (id) =>
    db
      .prepare(
        "INSERT INTO vetting_evidence_case_closures VALUES(?,datetime('now','-91 days'),'fixture','aged fixture')",
      )
      .bind(id)
      .run();
  const jobs = [];
  const env = {
    EVIDENCE_DATABASE: db,
    EVIDENCE_SOURCE: source,
    EVIDENCE_BACKUPS: backups,
    EVIDENCE_BACKUP_QUEUE: { send: async (job) => jobs.push(job) },
    EVIDENCE_BACKUP_MODE: "enabled",
    EVIDENCE_RETENTION_MODE: "enabled",
  };
  const drain = async (current = env, stopAtCleanup = false) => {
    while (jobs.length) {
      if (stopAtCleanup && jobs[0].kind === "cleanup") return;
      const job = jobs.shift();
      try {
        if (job.kind === "cleanup") await cleanupEvidence(current, job.day);
        else await backupPage(current, job);
      } catch (error) {
        jobs.unshift(job);
        throw error;
      }
    }
  };
  const generation = await register("generation_first");
  assert.equal((await upload("generation_first")).status, 200);
  assert.equal(await register("generation_live_sibling"), generation);
  let head = await db
    .prepare(
      "SELECT target_key FROM vetting_evidence_heads WHERE generation_id=? AND part_index=-1 AND sha256=? AND size_bytes=?",
    )
    .bind(generation, sha, data.length)
    .first();
  const historicalHead = head.target_key;
  const changedBytes = Buffer.from(
    "changed source bytes retained for recovery",
  );
  await source.put(historicalHead, changedBytes, {
    customMetadata: { sha256: sha },
  });
  assert.equal((await upload("generation_first")).status, 200);
  head = await db
    .prepare(
      "SELECT target_key FROM vetting_evidence_heads WHERE generation_id=? AND part_index=-1 AND sha256=? AND size_bytes=?",
    )
    .bind(generation, sha, data.length)
    .first();
  assert.notEqual(head.target_key, historicalHead);
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO vetting_evidence_deletions VALUES('generation_first','run',?,datetime('now'))",
      )
      .bind(sha)
      .run(),
    /backed and retired/,
  );
  await close("generation_first");
  const baseTime = Date.now() + 60_000;
  await startDailyBackup(env, baseTime);
  await drain();
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM vetting_evidence_generations WHERE id=?")
        .bind(generation)
        .first()
    ).state,
    "active",
  );
  assert.equal(
    (await source.head(head.target_key)).customMetadata.evidenceRetirement,
    undefined,
  );
  assert.equal(
    await db
      .prepare(
        "SELECT 1 FROM vetting_evidence_deletions WHERE assessment_id='generation_first'",
      )
      .first(),
    null,
  );

  // Legacy rows are held, including bytes written before the new protocol.
  const legacy = "vetting/legacy_hold/run/" + sha;
  await db
    .prepare(
      "INSERT INTO vetting_assessments(id,state) VALUES('legacy_hold','incomplete')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO vetting_evidence_runs VALUES('legacy_hold','run',?,?,?,'{}',datetime('now'),datetime('now'),NULL)",
    )
    .bind(sha, sha, "{}")
    .run();
  await db
    .prepare(
      "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key) VALUES('legacy_hold','run',?,?,'trace','legacy','application/octet-stream',?)",
    )
    .bind(sha, data.length, legacy)
    .run();
  await source.put(legacy, data, options(data));
  await close("legacy_hold");
  const incomplete = await register(
    "generation_missing_slot",
    Buffer.from("never uploaded"),
  );
  await close("generation_missing_slot");
  await close("generation_live_sibling");
  const time = baseTime + 86400_000;
  const day = new Date(time).toISOString().slice(0, 10);
  await startDailyBackup(env, time);
  await drain(env, true);
  // Targets reserved after the snapshot exercise supplemental backup. They
  // include unpublished repairs, a missing candidate, and enough for two pages.
  const reserve = async (id, present = true, bytes = data) => {
    const key = `vetting/generations/${generation}/${id}`;
    await db
      .prepare(
        "INSERT INTO vetting_evidence_targets VALUES(?,?,-1,?,?,datetime('now'))",
      )
      .bind(key, generation, digest(bytes), bytes.length)
      .run();
    if (present) await source.put(key, bytes, options(bytes));
    return key;
  };
  const extra = [];
  for (let index = 0; index < 18; index++)
    extra.push(await reserve(`unpublished_${index}`));
  const missing = await reserve("missing_candidate", false);
  const raced = await reserve("raced_candidate", false);
  const empty = await reserve("zero_original", true, Buffer.alloc(0));
  const orphan = await reserve("aaa_unbound_backup");
  // Corrupt an exact daily copy in this disposable bucket. Retirement must
  // stop without replacing the source merely because a backup key exists.
  const copiedKey = `daily/${day}/objects/${head.target_key}`;
  const copiedBytes = Buffer.from(
    await (await backups.get(copiedKey)).arrayBuffer(),
  );
  const corruptCopy = Buffer.from("wrong copied evidence");
  await backups.put(copiedKey, corruptCopy, {
    customMetadata: { sha256: digest(corruptCopy) },
  });
  await assert.rejects(drain(), /integrity|digest|metadata|size|length/i);
  assert.equal(
    (await source.head(head.target_key)).customMetadata.evidenceRetirement,
    undefined,
  );
  await backups.put(copiedKey, copiedBytes, {
    customMetadata: { sha256: digest(copiedBytes) },
  });
  const orphanCopy = `daily/${day}/retirement/objects/${orphan}`;
  const unrelated = Buffer.from("unbound copy must not authorize deletion");
  await backups.put(orphanCopy, unrelated, {
    customMetadata: { sha256: digest(unrelated) },
  });
  await assert.rejects(drain(), /integrity|digest|metadata|size|length/i);
  assert.equal(
    (await source.head(orphan)).customMetadata.evidenceRetirement,
    undefined,
  );
  await backups.delete(orphanCopy);
  let bodyWon = false,
    lostMarker = false,
    interrupted = false;
  const controlled = new Proxy(source, {
    get(target, property) {
      if (property !== "put") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (key, bytes, settings) => {
        if (settings.customMetadata?.evidenceRetirement === "v1") {
          if (key === raced && settings.onlyIf && !bodyWon) {
            bodyWon = true;
            await target.put(key, data, options(data));
          }
          if (key === extra[0] && !lostMarker) {
            lostMarker = true;
            await target.put(key, bytes, settings);
            throw new Error("marker reply lost after commit");
          }
          if (key === extra[1] && !interrupted) {
            interrupted = true;
            throw new Error("marker interrupted before commit");
          }
        }
        return target.put(key, bytes, settings);
      };
    },
  });
  await assert.rejects(
    drain({ ...env, EVIDENCE_SOURCE: controlled }),
    /marker interrupted/,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM vetting_evidence_generations WHERE id=?")
        .bind(generation)
        .first()
    ).state,
    "retiring",
  );
  await assert.rejects(reserve("too_late"), /not active/);
  await drain({ ...env, EVIDENCE_SOURCE: controlled });
  assert.equal(bodyWon, true);
  assert.equal(lostMarker, true);
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM vetting_evidence_generations WHERE id=?")
        .bind(generation)
        .first()
    ).state,
    "retired",
  );
  for (const key of [
    head.target_key,
    historicalHead,
    ...extra,
    missing,
    raced,
    empty,
    orphan,
  ]) {
    const object = await source.get(key);
    assert.equal(object.customMetadata.evidenceRetirement, "v1");
    assert.equal(JSON.parse(await object.text()).targetKey, key);
    assert.equal(await source.put(key, data, options(data)), null);
  }
  assert.equal(
    (
      await db
        .prepare(
          "SELECT outcome FROM vetting_evidence_target_retirements WHERE target_key=?",
        )
        .bind(missing)
        .first()
    ).outcome,
    "missing",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT outcome FROM vetting_evidence_target_retirements WHERE target_key=?",
        )
        .bind(raced)
        .first()
    ).outcome,
    "backed",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT outcome FROM vetting_evidence_target_retirements WHERE target_key=?",
        )
        .bind(empty)
        .first()
    ).outcome,
    "backed",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT outcome FROM vetting_evidence_target_retirements WHERE target_key=?",
        )
        .bind(historicalHead)
        .first()
    ).outcome,
    "changed",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM vetting_evidence_generations WHERE id=?")
        .bind(incomplete)
        .first()
    ).state,
    "retired",
  );
  assert.equal(
    await db
      .prepare(
        "SELECT 1 FROM vetting_evidence_deletions WHERE assessment_id='generation_missing_slot'",
      )
      .first(),
    null,
  );
  assert.ok(
    await db
      .prepare(
        "SELECT 1 FROM vetting_evidence_audit WHERE assessment_id='generation_missing_slot' AND action='retention-missing'",
      )
      .first(),
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM vetting_evidence_deletions WHERE assessment_id LIKE 'generation_%'",
        )
        .first()
    ).n,
    2,
  );
  assert.equal(
    await db
      .prepare(
        "SELECT 1 FROM vetting_evidence_deletions WHERE assessment_id='legacy_hold'",
      )
      .first(),
    null,
  );
  assert.deepEqual(
    Buffer.from(await (await source.get(legacy)).arrayBuffer()),
    data,
  );
  assert.ok(
    await db
      .prepare(
        "SELECT 1 FROM vetting_evidence_audit WHERE assessment_id='legacy_hold' AND action='retention-held'",
      )
      .first(),
  );
  const recovered = await restoreCheck(
    backups,
    restored,
    day,
    raced,
    "supplemental",
  );
  assert.deepEqual(
    Buffer.from(await (await restored.get(recovered.key)).arrayBuffer()),
    data,
  );
  const recoveredChanged = await restoreCheck(
    backups,
    restored,
    day,
    historicalHead,
    "changed",
  );
  assert.equal(recoveredChanged.retirementOutcome, "changed");
  assert.deepEqual(
    Buffer.from(await (await restored.get(recoveredChanged.key)).arrayBuffer()),
    changedBytes,
  );
  const receiptKey = `daily/${day}/retirement/${digest(Buffer.from(raced))}.json`;
  const receipt = await (await backups.get(receiptKey)).json();
  // Corrupt explicitly in the disposable bucket to test chain refusal.
  const wrong = Buffer.from(
    JSON.stringify({ ...receipt, snapshotSha256: "0".repeat(64) }),
  );
  await backups.put(receiptKey, wrong, {
    customMetadata: { sha256: digest(wrong) },
  });
  await assert.rejects(
    restoreCheck(backups, restored, day, raced, "wrong-chain"),
    /retirement backup/,
  );
  const recoveredEmpty = await restoreCheck(
    backups,
    restored,
    day,
    empty,
    "empty",
  );
  assert.equal((await restored.head(recoveredEmpty.key)).size, 0);
  const nextGeneration = await register("generation_after_retirement");
  assert.notEqual(nextGeneration, generation);
  assert.equal((await upload("generation_after_retirement")).status, 200);
  assert.equal(
    (await source.head(head.target_key)).customMetadata.evidenceRetirement,
    "v1",
  );
  console.log(
    "PASS: generation freeze, all reserved targets, missing/write race, marker retry, supplemental restore, legacy hold and fresh generation",
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
