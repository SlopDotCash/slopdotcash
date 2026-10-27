/** Fixed harmless retention controls in the disposable qualification Worker. */

import {
  chunkKey,
  EVIDENCE_CHUNK_BYTES,
  type EvidenceChunk,
  verifiedPart,
  verifyParts,
} from "../../backend/vetting/evidence-chunks";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import backup, {
  type ArchiveBucket,
  type BackupEnvironment,
  backupPage,
  cleanupEvidence,
  restoreCheck,
  startDailyBackup,
} from "./core";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => Promise<unknown>, message: string) {
  let refused = false;
  try {
    await action();
  } catch {
    refused = true;
  }
  check(refused, message);
}
export async function qualifyRetention(
  env: BackupEnvironment & { RESTORED: ArchiveBucket },
) {
  const db = env.EVIDENCE_DATABASE;
  const source = env.EVIDENCE_SOURCE;
  const copies = env.EVIDENCE_BACKUPS;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const prefix = "vet_000_retention_";
  const fixtures: {
    id: string;
    age: number | null;
    key: string;
    keys: string[];
    sha: string;
    chunks: EvidenceChunk[] | null;
    data: Uint8Array;
    missing: boolean;
    partial: boolean;
  }[] = [];
  async function put(bucket: ArchiveBucket, key: string, data: Uint8Array) {
    const sha256 = await sha256Hex(data);
    await bucket.put(key, data, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256 },
      httpMetadata: { contentType: "application/octet-stream" },
    });
    await verifiedPart(bucket, key, sha256, data.length);
  }
  const cases: [string, number | null, boolean][] = [
    ["chunks", 91, true],
    ["single", 91, false],
    ...Array.from({ length: 18 }, (_, i): [string, number, boolean] => [
      `missing_${String(i).padStart(2, "0")}`,
      91,
      false,
    ]),
    ["partial", 91, true],
    ["recent", 89, false],
    ["open", null, false],
    ["permanent_admission", 91, false],
  ];
  for (const [name, age, chunked] of cases) {
    const id = `${prefix}${name}`;
    const missing = name.startsWith("missing_");
    const partial = name === "partial";
    const data = new Uint8Array(chunked ? EVIDENCE_CHUNK_BYTES + 17 : 10).fill(
      13,
    );
    const sha = await sha256Hex(data);
    const key = `vetting/${id}/run/${sha}`;
    const chunks: EvidenceChunk[] | null = chunked ? [] : null;
    if (chunks)
      for (
        let offset = 0;
        offset < data.length;
        offset += EVIDENCE_CHUNK_BYTES
      ) {
        const part = data.slice(offset, offset + EVIDENCE_CHUNK_BYTES);
        chunks.push({
          index: chunks.length,
          sha256: await sha256Hex(part),
          sizeBytes: part.length,
        });
      }
    const keys = chunks ? chunks.map((part) => chunkKey(key, part)) : [key];
    await db
      .prepare(
        "INSERT INTO vetting_assessments(id,state,completed_at) VALUES(?,'incomplete',?)",
      )
      .bind(id, at)
      .run();
    if (name === "permanent_admission" && age !== null)
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
    await db
      .prepare(
        "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'run',?,?,'{}','{}',?,?)",
      )
      .bind(id, sha, sha, at, at)
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_objects VALUES(?,'run',?,?,'trace','Harmless retention fixture','application/octet-stream',?,?)",
      )
      .bind(id, sha, data.length, key, chunks ? JSON.stringify(chunks) : null)
      .run();
    if (age !== null && name !== "permanent_admission")
      await db
        .prepare(
          "INSERT INTO vetting_evidence_case_closures VALUES(?,?,'qualification','Synthetic aged closure')",
        )
        .bind(id, new Date(now - age * 86400_000).toISOString())
        .run();
    if (chunks) {
      for (const part of chunks) {
        if (partial && part.index === 1) continue;
        await put(
          source,
          keys[part.index],
          data.slice(
            part.index * EVIDENCE_CHUNK_BYTES,
            part.index * EVIDENCE_CHUNK_BYTES + part.sizeBytes,
          ),
        );
      }
    } else if (!missing) await put(source, key, data);
    fixtures.push({ id, age, key, keys, sha, chunks, data, missing, partial });
  }
  console.log("Qualification retention: fixtures ready");
  // The outer command is a real queue delivery. These sequential subjobs reuse
  // the existing storage core and real D1/R2, with controlled fault insertion.
  // They do not claim provider queue retry behavior (the baseline does that).
  type Job = Parameters<BackupEnvironment["EVIDENCE_BACKUP_QUEUE"]["send"]>[0];
  const jobs: Job[] = [];
  const controlled: BackupEnvironment = {
    ...env,
    EVIDENCE_RETENTION_MODE: "enabled",
    EVIDENCE_BACKUP_QUEUE: {
      send: async (job) => {
        jobs.push(job);
      },
    },
  };
  const time = now + 86400_000;
  const day = new Date(time).toISOString().slice(0, 10);
  await startDailyBackup(controlled, time);
  await refuses(
    () => cleanupEvidence(controlled, day),
    "Incomplete snapshot allowed deletion",
  );
  await startDailyBackup(controlled, time + 86400_000);
  check(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM vetting_storage_cycles WHERE phase<>'complete'",
        )
        .first<{ n: number }>()
    )?.n === 1,
    "Concurrent snapshot started",
  );
  console.log("Qualification retention: premature cleanup refused");
  const target = fixtures[0];
  check(target.chunks, "Chunked retention fixture missing");
  const first = target.chunks[0];
  const copyKey = `daily/${day}/objects/${target.keys[0]}`;
  const firstBytes = target.data.slice(0, first.sizeBytes);
  let faults = false;
  let cleanupPages = 0;
  while (jobs.length) {
    check(cleanupPages < 20, "Unbounded fixture cleanup");
    const job = jobs.shift();
    check(job, "Controlled subjob missing");
    if (job.kind !== "cleanup") {
      await backupPage(controlled, job);
      continue;
    }
    cleanupPages++;
    if (!faults) {
      faults = true;
      console.log("Qualification retention: snapshot complete");
      await copies.delete(copyKey);
      await refuses(
        () => cleanupEvidence(controlled, day),
        "Missing backup allowed deletion",
      );
      check(await source.head(target.keys[0]), "Missing backup lost source");
      await copies.put(copyKey, new Uint8Array(firstBytes.length), {
        onlyIf: { etagDoesNotMatch: "*" },
        customMetadata: { sha256: first.sha256 },
        httpMetadata: { contentType: "application/octet-stream" },
      });
      await refuses(
        () => cleanupEvidence(controlled, day),
        "Corrupt backup allowed deletion",
      );
      check(await source.head(target.keys[0]), "Corrupt backup lost source");
      await copies.delete(copyKey);
      await put(copies, copyKey, firstBytes);
      console.log("Qualification retention: backup fault controls refused");
      let deletes = 0;
      const interrupted = new Proxy(source, {
        get(bucket, property) {
          if (property === "delete")
            return async (key: string) => {
              if (++deletes === 2)
                throw new Error("Controlled partial deletion");
              await bucket.delete(key);
            };
          const value = Reflect.get(bucket, property);
          return typeof value === "function" ? value.bind(bucket) : value;
        },
      });
      await refuses(
        () =>
          cleanupEvidence({ ...controlled, EVIDENCE_SOURCE: interrupted }, day),
        "Partial deletion control did not interrupt",
      );
      check(
        !(await source.head(target.keys[0])) &&
          (await source.head(target.keys[1])),
        "Partial deletion state differs",
      );
      check(
        !(await db
          .prepare(
            "SELECT sha256 FROM vetting_evidence_deletions WHERE assessment_id=?",
          )
          .bind(target.id)
          .first()),
        "Interrupted object received completion",
      );
    }
    await cleanupEvidence(controlled, job.day);
    console.log("Qualification retention: cleanup page complete");
  }
  check(faults && cleanupPages >= 3, "Retention pagination not exercised");
  for (const item of fixtures)
    for (const [index, key] of item.keys.entries()) {
      check(
        Boolean(await source.head(key)) ===
          (item.age !== 91 || item.id.endsWith("permanent_admission")),
        "Source retention differs",
      );
      check(
        Boolean(await copies.head(`daily/${day}/objects/${key}`)) ===
          (!item.missing && !(item.partial && index === 1)),
        "Backup inventory differs",
      );
    }
  async function deletionCount() {
    return (
      await db
        .prepare(
          "SELECT count(*) n FROM vetting_evidence_deletions WHERE assessment_id LIKE ?",
        )
        .bind(`${prefix}%`)
        .first<{ n: number }>()
    )?.n;
  }
  check((await deletionCount()) === 2, "Incomplete inventory became deleted");
  check(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM vetting_evidence_audit WHERE action='retention-missing' AND assessment_id LIKE ?",
        )
        .bind(`${prefix}%`)
        .first<{ n: number }>()
    )?.n === 19,
    "Missing inventory audit differs",
  );
  const receipt = await db
    .prepare("SELECT * FROM vetting_evidence_deletions WHERE assessment_id=?")
    .bind(target.id)
    .first();
  await cleanupEvidence(controlled, day);
  check(
    JSON.stringify(
      await db
        .prepare(
          "SELECT * FROM vetting_evidence_deletions WHERE assessment_id=?",
        )
        .bind(target.id)
        .first(),
    ) === JSON.stringify(receipt) && (await deletionCount()) === 2,
    "Replay changed deletion receipt",
  );
  await refuses(
    () =>
      db
        .prepare("DELETE FROM vetting_evidence_deletions WHERE assessment_id=?")
        .bind(target.id)
        .run(),
    "Deletion receipt was removable",
  );
  await refuses(
    () =>
      db
        .prepare(
          "UPDATE vetting_evidence_deletions SET deleted_at='changed' WHERE assessment_id=?",
        )
        .bind(target.id)
        .run(),
    "Deletion receipt was mutable",
  );
  for (const key of target.keys)
    await restoreCheck(copies, env.RESTORED, day, key, "retention");
  await verifyParts(
    env.RESTORED,
    `restore-checks/retention/${target.key}`,
    target.chunks,
    target.sha,
  );
  check(
    await source.head("contributor-trace-outside-scope"),
    "Permanent trace sentinel deleted",
  );
  console.log("Qualification retention: deletion and restoration verified");
  // Scheduled audit pruning uses D1's clock and the actual migration guards.
  for (const [id, date] of [
    ["old", new Date(now - 400 * 86400_000).toISOString()],
    ["current", at],
    ["invalid", "z-invalid-date"],
  ])
    await db
      .prepare(
        "INSERT INTO vetting_evidence_audit VALUES(?,'qualification','fixture',?,NULL,NULL,'Harmless audit fixture',?)",
      )
      .bind(`qualification-audit-${id}`, target.id, date)
      .run();
  const auditCount = async () =>
    (
      await db
        .prepare(
          "SELECT count(*) n FROM vetting_evidence_audit WHERE id LIKE 'qualification-audit-%'",
        )
        .first<{ n: number }>()
    )?.n;
  await backup.scheduled(
    { scheduledTime: time },
    { ...controlled, EVIDENCE_BACKUP_MODE: "off" },
  );
  check((await auditCount()) === 3, "Disabled backup pruned audit");
  await backup.scheduled({ scheduledTime: time }, controlled);
  check(
    jobs.length === 0 && (await auditCount()) === 2,
    "Scheduled audit pruning differs",
  );
  check(
    !(await db
      .prepare(
        "SELECT id FROM vetting_evidence_audit WHERE id='qualification-audit-old'",
      )
      .first()),
    "Old audit retained",
  );
  for (const id of ["current", "invalid"])
    await refuses(
      () =>
        db
          .prepare("DELETE FROM vetting_evidence_audit WHERE id=?")
          .bind(`qualification-audit-${id}`)
          .run(),
      "Protected audit deleted",
    );
  await refuses(
    () =>
      db
        .prepare(
          "UPDATE vetting_evidence_audit SET reason='changed' WHERE id='qualification-audit-current'",
        )
        .run(),
    "Audit mutated",
  );
  check(
    (await auditCount()) === 2 && (await deletionCount()) === 2,
    "Scheduled pruning changed protected records",
  );
  console.log("Qualification retention: scheduled audit verified");
  return {
    actualStorageCore: true,
    actualScheduledCore: true,
    controlledSequentialSubjobs: true,
    fixtureOnlyRetentionEnabled: true,
    fixtureCaseCount: fixtures.length,
    agedDays: [89, 91],
    incompleteMissingAndCorruptBackupsRefused: true,
    partialDeletionRecovered: true,
    cleanupPages,
    deletedCompleteObjects: 2,
    missingInventoryAudits: 19,
    openRecentAndPermanentTraceRetained: true,
    permanentAdmissionEvidenceRetained: true,
    immutableDeletionReceipts: true,
    deletionReplayUnchanged: true,
    restoredDeletedSha256: target.sha,
    restoredDeletedBytes: target.data.length,
    scheduledOldAuditRemoved: true,
    disabledAndProtectedAuditRetained: true,
    elapsedRetentionObservation: false,
  };
}
