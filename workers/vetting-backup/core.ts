/** Private scanner backup and retention. No HTTP access. */
import type { ProjectD1Database } from "../../backend/projects/cloudflare-persistence";
import type { R2Bucket } from "../../backend/trace/cloudflare-persistence";
import {
  chunkKey,
  chunkLayout,
  EVIDENCE_CHUNK_BYTES,
  evidenceLocation,
  verifiedPart,
} from "../../backend/vetting/evidence-chunks";
import { PERMANENT_ADMISSION_EVIDENCE_SQL } from "../../backend/vetting/evidence-retention";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";

type ListedObject = { key: string; size: number; uploaded: Date };
export type ArchiveBucket = R2Bucket & {
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: ListedObject[];
    truncated: boolean;
    cursor?: string;
  }>;
};
type BackupJob = {
  kind?: "backup" | "cleanup";
  day: string;
  page: number;
  cursor?: string;
  previous: string | null;
  objects: number;
  bytes: number;
};
export type BackupEnvironment = {
  EVIDENCE_DATABASE: ProjectD1Database;
  EVIDENCE_SOURCE: ArchiveBucket;
  EVIDENCE_BACKUPS: ArchiveBucket;
  EVIDENCE_BACKUP_QUEUE: { send(job: BackupJob): Promise<void> };
  EVIDENCE_BACKUP_MODE?: string;
  EVIDENCE_RETENTION_MODE?: string;
};
type Copy = {
  key: string;
  backupKey: string;
  sha256: string;
  sizeBytes: number;
};
type Page = {
  previous: string | null;
  cursor: string | null;
  next: string | null;
  objects: Copy[];
};
const encoder = new TextEncoder();
const root = (day: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day
  )
    throw new Error("Invalid backup day");
  return `daily/${day}`;
};
const pageKey = (day: string, page: number) =>
  `${root(day)}/pages/${page}.json`;

async function immutable(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const digest = await sha256Hex(bytes);
  await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { sha256: digest },
    httpMetadata: { contentType },
  });
  await verifiedPart(bucket, key, digest, bytes.byteLength);
  return digest;
}
async function jsonRecord<T>(
  bucket: R2Bucket,
  key: string,
): Promise<{ value: T; digest: string } | null> {
  const object = await bucket.head(key);
  if (!object) return null;
  const digest = object.customMetadata?.sha256;
  if (!digest || !/^[0-9a-f]{64}$/.test(digest))
    throw new Error("Invalid backup receipt");
  const bytes = await verifiedPart(bucket, key, digest, object.size);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, digest };
}

export async function startDailyBackup(
  env: BackupEnvironment,
  scheduledTime: number,
) {
  if (env.EVIDENCE_BACKUP_MODE !== "enabled") return;
  const requestedDay = new Date(scheduledTime).toISOString().slice(0, 10);
  await env.EVIDENCE_DATABASE.prepare(
    "INSERT OR IGNORE INTO vetting_storage_cycles(day,started_at,phase) VALUES(?,?,'backup')",
  )
    .bind(requestedDay, new Date(scheduledTime).toISOString())
    .run();
  const cycle = await env.EVIDENCE_DATABASE.prepare(
    "SELECT day,started_at,phase FROM vetting_storage_cycles WHERE phase <> 'complete' LIMIT 1",
  ).first<{ day: string; started_at: string; phase: string }>();
  if (!cycle) return;
  const day = cycle.day;
  if (cycle.phase === "cleanup") {
    await enqueueCleanup(env, day);
    return;
  }
  const startKey = `${root(day)}/start.json`;
  if (!(await jsonRecord(env.EVIDENCE_BACKUPS, startKey))) {
    await immutable(
      env.EVIDENCE_BACKUPS,
      startKey,
      encoder.encode(
        JSON.stringify({
          day,
          startedAt: cycle.started_at,
        }),
      ),
      "application/json",
    );
  }
  if (await jsonRecord(env.EVIDENCE_BACKUPS, `${root(day)}/complete.json`)) {
    await finishBackup(env, day);
    return;
  }
  await env.EVIDENCE_BACKUP_QUEUE.send({
    day,
    page: 0,
    previous: null,
    objects: 0,
    bytes: 0,
  });
}

export async function backupPage(env: BackupEnvironment, job: BackupJob) {
  if (env.EVIDENCE_BACKUP_MODE !== "enabled")
    throw new Error("Evidence backup is disabled");
  const cycle = await env.EVIDENCE_DATABASE.prepare(
    "SELECT phase FROM vetting_storage_cycles WHERE day=?",
  )
    .bind(job.day)
    .first<{ phase: string }>();
  if (!cycle) throw new Error("Unknown storage cycle");
  if (cycle.phase === "complete") return;
  if (cycle.phase === "cleanup") {
    await enqueueCleanup(env, job.day);
    return;
  }
  if (!Number.isSafeInteger(job.page) || job.page < 0)
    throw new Error("Invalid backup page");
  const start = await jsonRecord<{ day: string; startedAt: string }>(
    env.EVIDENCE_BACKUPS,
    `${root(job.day)}/start.json`,
  );
  if (
    !start ||
    start.value.day !== job.day ||
    !Number.isFinite(Date.parse(start.value.startedAt))
  )
    throw new Error("Missing backup start receipt");
  const key = pageKey(job.day, job.page);
  let receipt = await jsonRecord<Page>(env.EVIDENCE_BACKUPS, key);
  if (!receipt) {
    const listed = await env.EVIDENCE_SOURCE.list({
      prefix: "vetting/",
      limit: 32,
      cursor: job.cursor,
    });
    if (listed.truncated && (!listed.cursor || listed.cursor === job.cursor))
      throw new Error("Backup listing did not advance");
    const objects: Copy[] = [];
    for (const source of listed.objects) {
      if (source.uploaded.getTime() > Date.parse(start.value.startedAt))
        continue;
      if (
        !source.key.startsWith("vetting/") ||
        source.size > EVIDENCE_CHUNK_BYTES
      )
        throw new Error("Invalid scanner evidence object");
      const head = await env.EVIDENCE_SOURCE.head(source.key);
      const digest = head?.customMetadata?.sha256;
      if (
        !head ||
        head.size !== source.size ||
        !digest ||
        !/^[0-9a-f]{64}$/.test(digest)
      )
        throw new Error("Scanner evidence changed during backup");
      const bytes = await verifiedPart(
        env.EVIDENCE_SOURCE,
        source.key,
        digest,
        source.size,
      );
      const backupKey = `${root(job.day)}/objects/${source.key}`;
      await immutable(
        env.EVIDENCE_BACKUPS,
        backupKey,
        bytes,
        "application/octet-stream",
      );
      objects.push({
        key: source.key,
        backupKey,
        sha256: digest,
        sizeBytes: source.size,
      });
    }
    const value: Page = {
      previous: job.previous,
      cursor: job.cursor ?? null,
      next: listed.truncated ? (listed.cursor ?? null) : null,
      objects,
    };
    const digest = await immutable(
      env.EVIDENCE_BACKUPS,
      key,
      encoder.encode(JSON.stringify(value)),
      "application/json",
    );
    receipt = { value, digest };
  }
  if (
    receipt.value.previous !== job.previous ||
    receipt.value.cursor !== (job.cursor ?? null)
  )
    throw new Error("Backup receipt chain changed");
  const objects = job.objects + receipt.value.objects.length;
  const bytes =
    job.bytes +
    receipt.value.objects.reduce((sum, object) => sum + object.sizeBytes, 0);
  if (receipt.value.next !== null) {
    await env.EVIDENCE_BACKUP_QUEUE.send({
      day: job.day,
      page: job.page + 1,
      cursor: receipt.value.next,
      previous: receipt.digest,
      objects,
      bytes,
    });
    return;
  }
  await immutable(
    env.EVIDENCE_BACKUPS,
    `${root(job.day)}/complete.json`,
    encoder.encode(
      JSON.stringify({
        day: job.day,
        startedAt: start.value.startedAt,
        pages: job.page + 1,
        lastPageSha256: receipt.digest,
        objects,
        bytes,
      }),
    ),
    "application/json",
  );
  await finishBackup(env, job.day);
}

async function enqueueCleanup(env: BackupEnvironment, day: string) {
  await env.EVIDENCE_BACKUP_QUEUE.send({
    kind: "cleanup",
    day,
    page: 0,
    previous: null,
    objects: 0,
    bytes: 0,
  });
}
async function finishBackup(env: BackupEnvironment, day: string) {
  await env.EVIDENCE_DATABASE.prepare(
    "UPDATE vetting_storage_cycles SET phase='cleanup' WHERE day=? AND phase='backup'",
  )
    .bind(day)
    .run();
  await enqueueCleanup(env, day);
}

/** Called only by the same single-consumer queue after a complete snapshot. */
export async function cleanupEvidence(env: BackupEnvironment, day: string) {
  if (env.EVIDENCE_BACKUP_MODE !== "enabled")
    throw new Error("Evidence backup is disabled");
  const cycle = await env.EVIDENCE_DATABASE.prepare(
    "SELECT phase,cleanup_after FROM vetting_storage_cycles WHERE day=?",
  )
    .bind(day)
    .first<{ phase: string; cleanup_after: string | null }>();
  if (cycle?.phase === "complete") return;
  if (cycle?.phase !== "cleanup") throw new Error("Snapshot is not complete");
  if (!(await jsonRecord(env.EVIDENCE_BACKUPS, `${root(day)}/complete.json`)))
    throw new Error("Snapshot completion receipt is missing");
  if (env.EVIDENCE_RETENTION_MODE === "enabled") {
    const rows =
      (
        await env.EVIDENCE_DATABASE.prepare(
          `SELECT o.assessment_id,o.run_id,o.sha256,o.object_key,o.chunks,o.size_bytes,o.storage
       FROM vetting_evidence_objects o JOIN vetting_evidence_case_closures c ON c.assessment_id=o.assessment_id
       JOIN vetting_assessments a ON a.id=o.assessment_id
       WHERE julianday(c.closed_at,'+90 days') <= julianday('now')
         AND COALESCE((${PERMANENT_ADMISSION_EVIDENCE_SQL}),0)=0
         AND o.object_key > ?
         AND NOT EXISTS (SELECT 1 FROM vetting_evidence_deletions d WHERE d.assessment_id=o.assessment_id AND d.run_id=o.run_id AND d.sha256=o.sha256)
       ORDER BY o.object_key LIMIT 16`,
        )
          .bind(cycle.cleanup_after ?? "")
          .all<{
            assessment_id: string;
            run_id: string;
            sha256: string;
            object_key: string;
            chunks: string | null;
            size_bytes: number;
            storage: string;
          }>()
      ).results ?? [];
    for (const row of rows) {
      if (
        !/^[a-zA-Z0-9_-]{1,100}$/.test(row.assessment_id) ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(row.run_id) ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        row.object_key !==
          `vetting/${row.assessment_id}/${row.run_id}/${row.sha256}` ||
        (row.storage !== "run" && row.storage !== "content")
      )
        throw new Error("Invalid retained evidence key");
      const location = evidenceLocation(row);
      // Atomically compete with registration for the shared digest. The
      // insertion trigger refuses new references while this durable claim
      // exists. No expiry can let a delayed R2 delete race a new reference.
      // This worker has one queue consumer; a retry resumes its own claim.
      let shared = false;
      if (row.storage === "content") {
        await env.EVIDENCE_DATABASE.prepare(
          `INSERT OR IGNORE INTO vetting_evidence_cleanup_claims(sha256,object_key)
           SELECT ?1,?2 WHERE NOT EXISTS (
             SELECT 1 FROM vetting_evidence_objects o
             WHERE o.storage='content' AND o.sha256=?1
               AND NOT (o.assessment_id=?3 AND o.run_id=?4)
               AND NOT EXISTS (SELECT 1 FROM vetting_evidence_deletions d
                 WHERE d.assessment_id=o.assessment_id AND d.run_id=o.run_id AND d.sha256=o.sha256)
           )`,
        )
          .bind(row.sha256, row.object_key, row.assessment_id, row.run_id)
          .run();
        const claim = await env.EVIDENCE_DATABASE.prepare(
          "SELECT object_key FROM vetting_evidence_cleanup_claims WHERE sha256=?",
        )
          .bind(row.sha256)
          .first<{ object_key: string }>();
        shared = claim?.object_key !== row.object_key;
      }
      if (shared) {
        await env.EVIDENCE_DATABASE.batch([
          env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_deletions(assessment_id,run_id,sha256,deleted_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(row.assessment_id, row.run_id, row.sha256),
          env.EVIDENCE_DATABASE.prepare(
            "UPDATE vetting_storage_cycles SET cleanup_after=? WHERE day=? AND phase='cleanup'",
          ).bind(row.object_key, day),
        ]);
        continue;
      }
      const parts =
        row.chunks === null
          ? [
              {
                key: location,
                sha256: row.sha256,
                sizeBytes: row.size_bytes,
              },
            ]
          : chunkLayout(JSON.parse(row.chunks), row.size_bytes).map((part) => ({
              ...part,
              key: chunkKey(location, part),
            }));
      if (row.chunks !== null && (await env.EVIDENCE_SOURCE.head(location)))
        throw new Error("Unexpected object at chunked evidence root");
      // A complete snapshot alone does not prove this exact inventory was copied.
      // Check each saved part before deleting any part of the source object.
      const backedParts = [];
      let missingParts = 0;
      for (const part of parts) {
        const backupKey = `${root(day)}/objects/${part.key}`;
        if (!(await env.EVIDENCE_BACKUPS.head(backupKey))) {
          // Inventory can exist before an upload finishes. An absent part
          // needs no deletion, but it is not proof of a complete backup.
          if (await env.EVIDENCE_SOURCE.head(part.key))
            throw new Error("Existing evidence has no verified backup");
          missingParts++;
          continue;
        }
        await verifiedPart(
          env.EVIDENCE_BACKUPS,
          backupKey,
          part.sha256,
          part.sizeBytes,
        );
        backedParts.push(part);
      }
      for (const part of backedParts) {
        await env.EVIDENCE_SOURCE.delete(part.key);
        if (await env.EVIDENCE_SOURCE.head(part.key))
          throw new Error("Evidence deletion was not confirmed");
      }
      const receipt = missingParts
        ? env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,'storage-retention','retention-missing',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(
            `retention-missing:${day}:${row.object_key}`,
            row.assessment_id,
            row.run_id,
            row.sha256,
            `${missingParts} declared parts were absent from both source and backup. No complete deletion receipt was recorded.`,
          )
        : env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_deletions(assessment_id,run_id,sha256,deleted_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(row.assessment_id, row.run_id, row.sha256);
      // Gaps remain visible and are checked again next day. This cursor lets
      // this cycle finish without treating missing evidence as deleted.
      await env.EVIDENCE_DATABASE.batch([
        receipt,
        env.EVIDENCE_DATABASE.prepare(
          "UPDATE vetting_storage_cycles SET cleanup_after=? WHERE day=? AND phase='cleanup'",
        ).bind(row.object_key, day),
        env.EVIDENCE_DATABASE.prepare(
          "DELETE FROM vetting_evidence_cleanup_claims WHERE sha256=? AND object_key=?",
        ).bind(row.sha256, row.object_key),
      ]);
    }
    if (rows.length) {
      await enqueueCleanup(env, day);
      return;
    }
  }
  await env.EVIDENCE_DATABASE.prepare(
    "UPDATE vetting_storage_cycles SET phase='complete',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE day=? AND phase='cleanup'",
  )
    .bind(day)
    .run();
}

/** Restore into a separate check prefix; never overwrite a live evidence object. */
export async function restoreCheck(
  backups: ArchiveBucket,
  destination: R2Bucket,
  day: string,
  sourceKey: string,
  checkId: string,
) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(checkId))
    throw new Error("Invalid restore check identity");
  const complete = await jsonRecord<{
    pages: number;
    lastPageSha256: string;
    objects: number;
    bytes: number;
  }>(backups, `${root(day)}/complete.json`);
  if (
    !complete ||
    !Number.isSafeInteger(complete.value.pages) ||
    complete.value.pages < 1
  )
    throw new Error("Backup is incomplete");
  let previous: string | null = null;
  let found: Copy | undefined;
  let objects = 0,
    bytes = 0;
  for (let page = 0; page < complete.value.pages; page++) {
    const record = await jsonRecord<Page>(backups, pageKey(day, page));
    if (!record || record.value.previous !== previous)
      throw new Error("Backup receipt chain is incomplete");
    previous = record.digest;
    for (const object of record.value.objects) {
      objects++;
      bytes += object.sizeBytes;
      if (object.key === sourceKey) {
        if (found) throw new Error("Backup contains a duplicate object");
        found = object;
      }
    }
  }
  if (
    previous !== complete.value.lastPageSha256 ||
    objects !== complete.value.objects ||
    bytes !== complete.value.bytes ||
    !found
  )
    throw new Error("Backup completion does not match its receipts");
  const data = await verifiedPart(
    backups,
    found.backupKey,
    found.sha256,
    found.sizeBytes,
  );
  const key = `restore-checks/${checkId}/${sourceKey}`;
  await immutable(destination, key, data, "application/octet-stream");
  return { key, sha256: found.sha256, sizeBytes: found.sizeBytes };
}

/** Calendar-year retention uses the database clock, not a caller-supplied date. */
export async function pruneAccessAudit(env: BackupEnvironment) {
  if (env.EVIDENCE_BACKUP_MODE !== "enabled") return;
  await env.EVIDENCE_DATABASE.prepare(
    "DELETE FROM vetting_evidence_audit WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 year')",
  ).run();
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
  async scheduled(event: { scheduledTime: number }, env: BackupEnvironment) {
    await startDailyBackup(env, event.scheduledTime);
    await pruneAccessAudit(env);
  },
  async queue(
    batch: { messages: { body: BackupJob; ack(): void; retry(): void }[] },
    env: BackupEnvironment,
  ) {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "cleanup")
          await cleanupEvidence(env, message.body.day);
        else await backupPage(env, message.body);
        message.ack();
      } catch {
        message.retry();
        console.error("Scanner evidence backup page failed");
      }
    }
  },
};
