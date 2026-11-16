/** Private scanner backup and retention. No HTTP access. */
import type { ProjectD1Database } from "../../backend/projects/cloudflare-persistence";
import type { R2Bucket } from "../../backend/trace/cloudflare-persistence";
import {
  chunkLayout,
  EVIDENCE_CHUNK_BYTES,
  observedPart,
  verifiedPart,
} from "../../backend/vetting/evidence-chunks";
import { PERMANENT_ADMISSION_EVIDENCE_SQL } from "../../backend/vetting/evidence-retention";
import {
  EVIDENCE_RETIREMENT_METADATA_KEY,
  EVIDENCE_RETIREMENT_METADATA_VALUE,
  evidenceRetirementBytes,
} from "../../backend/vetting/evidence-storage";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";

type ListedObject = { key: string; size: number; uploaded: Date };
type ArchivePutOptions = Omit<Parameters<R2Bucket["put"]>[2], "onlyIf"> & {
  onlyIf?: Parameters<R2Bucket["put"]>[2]["onlyIf"];
};
export type ArchiveBucket = Omit<R2Bucket, "put"> & {
  put(
    key: string,
    bytes: Uint8Array,
    options: ArchivePutOptions,
  ): Promise<unknown>;
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
type Complete = {
  pages: number;
  lastPageSha256: string;
  objects: number;
  bytes: number;
};
type GenerationTarget = {
  target_key: string;
  generation_id: string;
  part_index: number;
  sha256: string;
  size_bytes: number;
};
type RetirementReceipt = {
  schemaVersion: "slop-evidence-retirement-backup-v1";
  day: string;
  snapshotSha256: string;
  generationId: string;
  targetKey: string;
  partIndex: number;
  sha256: string;
  sizeBytes: number;
  outcome: "backed" | "changed" | "missing";
  backupKey: string | null;
  observedSha256: string | null;
  observedSizeBytes: number | null;
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
const generationKey =
  /^vetting\/generations\/([A-Za-z0-9_-]{1,100})\/[A-Za-z0-9_-]{1,100}$/u;
const retirementKey = async (day: string, key: string) =>
  `${root(day)}/retirement/${await sha256Hex(encoder.encode(key))}.json`;

function markerHead(head: Awaited<ReturnType<R2Bucket["head"]>>) {
  return (
    head?.customMetadata?.[EVIDENCE_RETIREMENT_METADATA_KEY] ===
    EVIDENCE_RETIREMENT_METADATA_VALUE
  );
}

async function verifyMarker(
  bucket: R2Bucket,
  key: string,
  outcome?: RetirementReceipt["outcome"],
) {
  const bytes = evidenceRetirementBytes(key);
  const head = await bucket.head(key);
  if (!markerHead(head))
    throw new Error("Evidence retirement marker is absent");
  if (
    outcome !== undefined &&
    head?.customMetadata?.retirementOutcome !== outcome
  )
    throw new Error("Evidence retirement marker outcome differs");
  await verifiedPart(
    bucket,
    key,
    await sha256Hex(bytes),
    bytes.byteLength,
    true,
  );
}

async function writeMarker(
  env: BackupEnvironment,
  key: string,
  outcome: RetirementReceipt["outcome"],
  createOnly: boolean,
) {
  const bytes = evidenceRetirementBytes(key);
  try {
    await env.EVIDENCE_SOURCE.put(key, bytes, {
      customMetadata: {
        sha256: await sha256Hex(bytes),
        [EVIDENCE_RETIREMENT_METADATA_KEY]: EVIDENCE_RETIREMENT_METADATA_VALUE,
        retirementOutcome: outcome,
      },
      httpMetadata: { contentType: "application/octet-stream" },
      ...(createOnly ? { onlyIf: { etagDoesNotMatch: "*" as const } } : {}),
    });
  } catch (error) {
    try {
      await verifyMarker(env.EVIDENCE_SOURCE, key, outcome);
    } catch {
      throw error;
    }
  }
  await verifyMarker(env.EVIDENCE_SOURCE, key, outcome);
}

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
      if (markerHead(head)) {
        if (!generationKey.test(source.key))
          throw new Error("Retirement marker has an invalid target key");
        await verifyMarker(env.EVIDENCE_SOURCE, source.key);
        continue;
      }
      if (!head || head.size !== source.size)
        throw new Error("Scanner evidence changed during backup");
      const observed = await observedPart(env.EVIDENCE_SOURCE, source.key);
      if (observed.sizeBytes !== source.size)
        throw new Error("Scanner evidence changed during backup");
      const backupKey = `${root(job.day)}/objects/${source.key}`;
      await immutable(
        env.EVIDENCE_BACKUPS,
        backupKey,
        observed.bytes,
        "application/octet-stream",
      );
      objects.push({
        key: source.key,
        backupKey,
        sha256: observed.sha256,
        sizeBytes: observed.sizeBytes,
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

async function snapshotCopies(
  backups: R2Bucket,
  day: string,
  complete: { value: Complete; digest: string },
  wanted: Set<string>,
) {
  if (!Number.isSafeInteger(complete.value.pages) || complete.value.pages < 1)
    throw new Error("Backup is incomplete");
  const found = new Map<string, Copy>();
  let previous: string | null = null;
  let objects = 0;
  let bytes = 0;
  for (let page = 0; page < complete.value.pages; page++) {
    const record = await jsonRecord<Page>(backups, pageKey(day, page));
    if (!record || record.value.previous !== previous)
      throw new Error("Backup receipt chain is incomplete");
    previous = record.digest;
    for (const object of record.value.objects) {
      objects++;
      bytes += object.sizeBytes;
      if (!wanted.has(object.key)) continue;
      if (
        found.has(object.key) ||
        object.backupKey !== `${root(day)}/objects/${object.key}` ||
        !/^[a-f0-9]{64}$/u.test(object.sha256) ||
        !Number.isSafeInteger(object.sizeBytes) ||
        object.sizeBytes < 0 ||
        object.sizeBytes > EVIDENCE_CHUNK_BYTES
      )
        throw new Error("Invalid snapshot object receipt");
      found.set(object.key, object);
    }
  }
  if (
    previous !== complete.value.lastPageSha256 ||
    objects !== complete.value.objects ||
    bytes !== complete.value.bytes
  )
    throw new Error("Backup completion does not match its receipts");
  return found;
}

function validateRetirement(
  value: RetirementReceipt,
  day: string,
  key: string,
  snapshotSha256: string,
) {
  const generation = generationKey.exec(key)?.[1];
  if (
    value === null ||
    typeof value !== "object" ||
    value.schemaVersion !== "slop-evidence-retirement-backup-v1" ||
    value.day !== day ||
    value.snapshotSha256 !== snapshotSha256 ||
    value.targetKey !== key ||
    value.generationId !== generation ||
    !Number.isSafeInteger(value.partIndex) ||
    value.partIndex < -1 ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    value.sizeBytes > EVIDENCE_CHUNK_BYTES ||
    !["backed", "changed", "missing"].includes(value.outcome) ||
    (value.outcome === "missing"
      ? value.backupKey !== null ||
        value.observedSha256 !== null ||
        value.observedSizeBytes !== null
      : value.backupKey !== `${root(day)}/objects/${key}` &&
        value.backupKey !== `${root(day)}/retirement/objects/${key}`) ||
    (value.outcome !== "missing" &&
      (!/^[a-f0-9]{64}$/u.test(value.observedSha256 ?? "") ||
        !Number.isSafeInteger(value.observedSizeBytes) ||
        value.observedSizeBytes! < 0 ||
        value.observedSizeBytes! > EVIDENCE_CHUNK_BYTES ||
        (value.observedSha256 === value.sha256 &&
          value.observedSizeBytes === value.sizeBytes) !==
          (value.outcome === "backed")))
  )
    throw new Error("Invalid retirement backup receipt");
}

/** Backup and fence one reserved target, including candidates never published. */
async function retireTarget(
  env: BackupEnvironment,
  day: string,
  snapshotSha256: string,
  target: GenerationTarget,
  primary: Copy | undefined,
) {
  if (
    generationKey.exec(target.target_key)?.[1] !== target.generation_id ||
    !/^[a-f0-9]{64}$/u.test(target.sha256) ||
    !Number.isSafeInteger(target.part_index) ||
    target.part_index < -1 ||
    !Number.isSafeInteger(target.size_bytes) ||
    target.size_bytes < 0 ||
    target.size_bytes > EVIDENCE_CHUNK_BYTES
  )
    throw new Error("Invalid reserved evidence target");
  const key = await retirementKey(day, target.target_key);
  let receipt = await jsonRecord<RetirementReceipt>(env.EVIDENCE_BACKUPS, key);
  if (!receipt) {
    const supplementalKey = `${root(day)}/retirement/objects/${target.target_key}`;
    // An unbound orphan backup is not authority. Without a receipt, read the
    // source again and require any previous create-only copy to match it.
    let copy = primary;
    if (copy) {
      await verifiedPart(
        env.EVIDENCE_BACKUPS,
        copy.backupKey,
        copy.sha256,
        copy.sizeBytes,
      );
    } else {
      let head = await env.EVIDENCE_SOURCE.head(target.target_key);
      if (!head) {
        // Absence alone does not settle an older PUT. Compete atomically:
        // either this marker wins or the late body must be backed first.
        try {
          await writeMarker(env, target.target_key, "missing", true);
        } catch (error) {
          head = await env.EVIDENCE_SOURCE.head(target.target_key);
          if (!head) throw error;
        }
        head = await env.EVIDENCE_SOURCE.head(target.target_key);
      }
      if (markerHead(head)) {
        await verifyMarker(env.EVIDENCE_SOURCE, target.target_key, "missing");
      } else {
        const observed = await observedPart(
          env.EVIDENCE_SOURCE,
          target.target_key,
        );
        await immutable(
          env.EVIDENCE_BACKUPS,
          supplementalKey,
          observed.bytes,
          "application/octet-stream",
        );
        copy = {
          key: target.target_key,
          backupKey: supplementalKey,
          sha256: observed.sha256,
          sizeBytes: observed.sizeBytes,
        };
      }
    }
    const value: RetirementReceipt = {
      schemaVersion: "slop-evidence-retirement-backup-v1",
      day,
      snapshotSha256,
      generationId: target.generation_id,
      targetKey: target.target_key,
      partIndex: target.part_index,
      sha256: target.sha256,
      sizeBytes: target.size_bytes,
      outcome:
        copy === undefined
          ? "missing"
          : copy.sha256 === target.sha256 &&
              copy.sizeBytes === target.size_bytes
            ? "backed"
            : "changed",
      backupKey: copy?.backupKey ?? null,
      observedSha256: copy?.sha256 ?? null,
      observedSizeBytes: copy?.sizeBytes ?? null,
    };
    const bytes = encoder.encode(JSON.stringify(value));
    const digest = await immutable(
      env.EVIDENCE_BACKUPS,
      key,
      bytes,
      "application/json",
    );
    receipt = { value, digest };
  }
  validateRetirement(receipt.value, day, target.target_key, snapshotSha256);
  if (
    receipt.value.partIndex !== target.part_index ||
    receipt.value.sha256 !== target.sha256 ||
    receipt.value.sizeBytes !== target.size_bytes
  )
    throw new Error("Retirement target differs from its receipt");
  if (receipt.value.backupKey !== null)
    await verifiedPart(
      env.EVIDENCE_BACKUPS,
      receipt.value.backupKey,
      receipt.value.observedSha256!,
      receipt.value.observedSizeBytes!,
    );
  if (receipt.value.outcome === "missing") {
    // A missing receipt is published only after its create-only fence wins.
    // Never replace a later raw object on the strength of that old receipt.
    await verifyMarker(env.EVIDENCE_SOURCE, target.target_key, "missing");
  } else {
    await writeMarker(env, target.target_key, receipt.value.outcome, false);
  }
  await env.EVIDENCE_DATABASE.prepare(
    `INSERT OR IGNORE INTO vetting_evidence_target_retirements
     (target_key,outcome,backup_day,backup_key,observed_sha256,observed_size_bytes,observed_at)
     VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(
      target.target_key,
      receipt.value.outcome,
      day,
      receipt.value.backupKey,
      receipt.value.observedSha256,
      receipt.value.observedSizeBytes,
    )
    .run();
  const recorded = await env.EVIDENCE_DATABASE.prepare(
    "SELECT outcome,backup_day,backup_key,observed_sha256,observed_size_bytes FROM vetting_evidence_target_retirements WHERE target_key=?",
  )
    .bind(target.target_key)
    .first<{
      outcome: string;
      backup_day: string;
      backup_key: string | null;
      observed_sha256: string | null;
      observed_size_bytes: number | null;
    }>();
  if (
    !recorded ||
    recorded.outcome !== receipt.value.outcome ||
    recorded.backup_day !== day ||
    recorded.backup_key !== receipt.value.backupKey ||
    recorded.observed_sha256 !== receipt.value.observedSha256 ||
    recorded.observed_size_bytes !== receipt.value.observedSizeBytes
  )
    throw new Error("Target retirement was not recorded exactly");
}

/** Pending keeps the frozen inventory on this cursor for another queue turn. */
async function retireGeneration(
  env: BackupEnvironment,
  day: string,
  snapshot: { value: Complete; digest: string },
  generation: string,
) {
  await env.EVIDENCE_DATABASE.prepare(
    `UPDATE vetting_evidence_generations SET state='retiring'
     WHERE id=? AND state='active' AND NOT EXISTS (
       SELECT 1 FROM vetting_evidence_objects o
       JOIN vetting_assessments a ON a.id=o.assessment_id
       LEFT JOIN vetting_evidence_case_closures c ON c.assessment_id=o.assessment_id
       WHERE o.storage_generation=vetting_evidence_generations.id
         AND NOT EXISTS (SELECT 1 FROM vetting_evidence_deletions d WHERE d.assessment_id=o.assessment_id AND d.run_id=o.run_id AND d.sha256=o.sha256)
         AND (c.closed_at IS NULL OR julianday(c.closed_at,'+90 days') IS NULL OR julianday(c.closed_at,'+90 days') > julianday('now') OR COALESCE((${PERMANENT_ADMISSION_EVIDENCE_SQL}),0)=1)
     )`,
  )
    .bind(generation)
    .run();
  const current = await env.EVIDENCE_DATABASE.prepare(
    "SELECT state FROM vetting_evidence_generations WHERE id=?",
  )
    .bind(generation)
    .first<{ state: string }>();
  if (!current) throw new Error("Evidence generation is missing");
  if (current.state === "active") return "held" as const;
  if (current.state === "retired") return "retired" as const;
  if (current.state !== "retiring")
    throw new Error("Invalid evidence generation state");
  const targets = (
    await env.EVIDENCE_DATABASE.prepare(
      `SELECT t.target_key,t.generation_id,t.part_index,t.sha256,t.size_bytes
     FROM vetting_evidence_targets t WHERE t.generation_id=?
       AND NOT EXISTS (SELECT 1 FROM vetting_evidence_target_retirements r WHERE r.target_key=t.target_key)
     ORDER BY t.target_key LIMIT 16`,
    )
      .bind(generation)
      .all<GenerationTarget>()
  ).results;
  const copies = await snapshotCopies(
    env.EVIDENCE_BACKUPS,
    day,
    snapshot,
    new Set(targets.map((target) => target.target_key)),
  );
  for (const target of targets)
    await retireTarget(
      env,
      day,
      snapshot.digest,
      target,
      copies.get(target.target_key),
    );
  await env.EVIDENCE_DATABASE.prepare(
    `UPDATE vetting_evidence_generations SET state='retired',retired_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=? AND state='retiring' AND NOT EXISTS (
       SELECT 1 FROM vetting_evidence_targets t WHERE t.generation_id=vetting_evidence_generations.id
         AND NOT EXISTS (SELECT 1 FROM vetting_evidence_target_retirements r WHERE r.target_key=t.target_key)
     )`,
  )
    .bind(generation)
    .run();
  const finished = await env.EVIDENCE_DATABASE.prepare(
    "SELECT state FROM vetting_evidence_generations WHERE id=?",
  )
    .bind(generation)
    .first<{ state: string }>();
  return finished?.state === "retired"
    ? ("retired" as const)
    : ("pending" as const);
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
  const snapshot = await jsonRecord<Complete>(
    env.EVIDENCE_BACKUPS,
    `${root(day)}/complete.json`,
  );
  if (!snapshot) throw new Error("Snapshot completion receipt is missing");
  if (env.EVIDENCE_RETENTION_MODE === "enabled") {
    const rows =
      (
        await env.EVIDENCE_DATABASE.prepare(
          `SELECT o.assessment_id,o.run_id,o.sha256,o.object_key,o.chunks,o.size_bytes,o.storage,o.storage_generation
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
            storage_generation: string | null;
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
      if (row.storage_generation === null) {
        // Old admitted writers could still overwrite or recreate these keys.
        // Keep the bytes and record the unresolved migration boundary.
        await env.EVIDENCE_DATABASE.batch([
          env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,'storage-retention','retention-held',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(
            `retention-held:legacy:${row.object_key}`,
            row.assessment_id,
            row.run_id,
            row.sha256,
            "Legacy storage has no generation fence; bytes remain retained without a deletion receipt.",
          ),
          env.EVIDENCE_DATABASE.prepare(
            "UPDATE vetting_storage_cycles SET cleanup_after=? WHERE day=? AND phase='cleanup'",
          ).bind(row.object_key, day),
        ]);
        continue;
      }
      if (
        row.storage !== "content" ||
        !/^[A-Za-z0-9_-]{1,100}$/u.test(row.storage_generation)
      )
        throw new Error("Invalid evidence storage generation");
      const retired = await retireGeneration(
        env,
        day,
        snapshot,
        row.storage_generation,
      );
      if (retired === "pending") {
        await enqueueCleanup(env, day);
        return;
      }
      if (retired === "held") {
        await env.EVIDENCE_DATABASE.batch([
          env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,'storage-retention','retention-held',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(
            `retention-held:shared:${row.object_key}`,
            row.assessment_id,
            row.run_id,
            row.sha256,
            "A current reference keeps this storage generation active.",
          ),
          env.EVIDENCE_DATABASE.prepare(
            "UPDATE vetting_storage_cycles SET cleanup_after=? WHERE day=? AND phase='cleanup'",
          ).bind(row.object_key, day),
        ]);
        continue;
      }
      const slots =
        row.chunks === null
          ? [{ index: -1, sha256: row.sha256, sizeBytes: row.size_bytes }]
          : chunkLayout(JSON.parse(row.chunks), row.size_bytes);
      const missing = await env.EVIDENCE_DATABASE.prepare(
        `SELECT count(*) AS count FROM json_each(?1) slot WHERE NOT EXISTS (
           SELECT 1 FROM vetting_evidence_heads h
           JOIN vetting_evidence_target_retirements r ON r.target_key=h.target_key
           WHERE h.generation_id=?2 AND h.part_index=json_extract(slot.value,'$.index')
             AND h.sha256=json_extract(slot.value,'$.sha256') AND h.size_bytes=json_extract(slot.value,'$.sizeBytes')
             AND r.outcome='backed'
         )`,
      )
        .bind(JSON.stringify(slots), row.storage_generation)
        .first<{ count: number }>();
      if (!missing || !Number.isSafeInteger(missing.count) || missing.count < 0)
        throw new Error("Generation retirement slots could not be read");
      const missingParts = missing.count;
      const receipt = missingParts
        ? env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,'storage-retention','retention-missing',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(
            `retention-missing:${day}:${row.object_key}`,
            row.assessment_id,
            row.run_id,
            row.sha256,
            `${missingParts} declared slots have no backed current head. Targets are fenced, but no complete deletion receipt was recorded.`,
          )
        : env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO vetting_evidence_deletions(assessment_id,run_id,sha256,deleted_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          ).bind(row.assessment_id, row.run_id, row.sha256);
      // Fencing every reserved target does not fabricate a backed head for a
      // never-completed slot. Keep those missing histories explicitly separate.
      await env.EVIDENCE_DATABASE.batch([
        receipt,
        env.EVIDENCE_DATABASE.prepare(
          "UPDATE vetting_storage_cycles SET cleanup_after=? WHERE day=? AND phase='cleanup'",
        ).bind(row.object_key, day),
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
  const complete = await jsonRecord<Complete>(
    backups,
    `${root(day)}/complete.json`,
  );
  if (!complete) throw new Error("Backup is incomplete");
  let found = (
    await snapshotCopies(backups, day, complete, new Set([sourceKey]))
  ).get(sourceKey);
  const supplemental = await jsonRecord<RetirementReceipt>(
    backups,
    await retirementKey(day, sourceKey),
  );
  if (supplemental) {
    validateRetirement(supplemental.value, day, sourceKey, complete.digest);
    const value = supplemental.value;
    if (value.outcome !== "missing" && value.backupKey !== null) {
      if (
        found &&
        (found.sha256 !== value.observedSha256 ||
          found.sizeBytes !== value.observedSizeBytes ||
          found.backupKey !== value.backupKey)
      )
        throw new Error("Snapshot and retirement backup disagree");
      found = {
        key: sourceKey,
        backupKey: value.backupKey,
        sha256: value.observedSha256!,
        sizeBytes: value.observedSizeBytes!,
      };
    } else if (found) {
      throw new Error("Missing retirement conflicts with snapshot backup");
    }
  }
  if (!found) throw new Error("Object has no verified backup receipt");
  const data = await verifiedPart(
    backups,
    found.backupKey,
    found.sha256,
    found.sizeBytes,
  );
  const key = `restore-checks/${checkId}/${sourceKey}`;
  await immutable(destination, key, data, "application/octet-stream");
  return {
    key,
    sha256: found.sha256,
    sizeBytes: found.sizeBytes,
    retirementOutcome: supplemental?.value.outcome ?? null,
  };
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
