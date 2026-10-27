/** Queue-only, disposable hosted qualification. Never bind application stores. */

import type { ProjectD1Database } from "../../backend/projects/cloudflare-persistence";
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
  restoreCheck,
  startDailyBackup,
} from "./core";
import { qualifyAccess } from "./qualification-access";
import { qualifyRetention } from "./qualification-retention";

export const qualificationMigrations = [
  "0002_slop_identity.sql",
  "0008_points.sql",
  "0034_vetting_private_evidence.sql",
  "0035_vetting_evidence_chunks.sql",
  "0036_vetting_evidence_assembly.sql",
  "0066_vetting_case_retention.sql",
  "0067_vetting_audit_retention.sql",
  "0068_vetting_storage_cycles.sql",
];
// The assessment is synthetic; all evidence tables and their guards use the
// real migrations. No project, scan result or operational attestation is made.
export const qualificationSchema = `
CREATE TABLE vetting_assessments(id TEXT PRIMARY KEY, state TEXT, completed_at TEXT, result TEXT);
CREATE TABLE qualification_results(phase TEXT PRIMARY KEY, result TEXT NOT NULL CHECK(json_valid(result)));
CREATE TABLE qualification_deliveries(id TEXT PRIMARY KEY, action TEXT NOT NULL);
`;
const tables = [
  "vetting_assessments",
  "vetting_evidence_runs",
  "vetting_evidence_objects",
  "vetting_evidence_completions",
  "vetting_evidence_case_closures",
  "vetting_evidence_grants",
  "vetting_evidence_audit",
] as const;
type Environment = BackupEnvironment & {
  RESTORED: ArchiveBucket;
  RESTORED_DB: ProjectD1Database;
  QUALIFICATION_RUN: string;
};
type Command = {
  qualification: string;
  action: "access" | "seed" | "verify" | "corrupt" | "retention" | "empty";
  delivery: string;
};
type Rows = Record<string, string | number | null>[];
const encoder = new TextEncoder();
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const smallKey = (index: number) =>
  `vetting/qualification-${String(index).padStart(3, "0")}/run/evidence`;
const smallBytes = (index: number) =>
  encoder.encode(`Harmless scanner recovery fixture ${index}.`);
const snapshotKey = "vetting/qualification-database.json";
const largeKey = "vetting/qualification-chunks/run/evidence";
const largeBytes = () => new Uint8Array(EVIDENCE_CHUNK_BYTES + 17).fill(7);

async function put(bucket: ArchiveBucket, key: string, bytes: Uint8Array) {
  const sha256 = await sha256Hex(bytes);
  await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { sha256 },
    httpMetadata: { contentType: "application/octet-stream" },
  });
  await verifiedPart(bucket, key, sha256, bytes.length);
  return sha256;
}
async function snapshot(db: ProjectD1Database) {
  const result: Record<string, Rows> = {};
  for (const table of tables)
    result[table] = (
      await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    ).results as Rows;
  return encoder.encode(JSON.stringify(result));
}
async function record(env: Environment, phase: string, result: unknown) {
  await env.EVIDENCE_DATABASE.prepare(
    "INSERT OR IGNORE INTO qualification_results VALUES(?,?)",
  )
    .bind(phase, JSON.stringify(result))
    .run();
}
async function phase(env: Environment, name: string) {
  return env.EVIDENCE_DATABASE.prepare(
    "SELECT result FROM qualification_results WHERE phase=?",
  )
    .bind(name)
    .first<{ result: string }>();
}
async function access(env: Environment) {
  if (await phase(env, "access")) return;
  await record(env, "access", await qualifyAccess(env));
}
async function seed(env: Environment) {
  if (await phase(env, "seed")) return;
  const accessRecord = await phase(env, "access");
  check(accessRecord, "Access control qualification is absent");
  const accessResult = JSON.parse(accessRecord.result) as {
    objects: number;
    bytes: number;
  };
  for (let i = 0; i < 65; i++)
    await put(env.EVIDENCE_SOURCE, smallKey(i), smallBytes(i));
  await put(
    env.EVIDENCE_SOURCE,
    "contributor-trace-outside-scope",
    encoder.encode("Harmless non-scanner sentinel"),
  );
  const bytes = largeBytes(),
    sha = await sha256Hex(bytes);
  const chunks: EvidenceChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += EVIDENCE_CHUNK_BYTES) {
    const part = bytes.slice(offset, offset + EVIDENCE_CHUNK_BYTES);
    const chunk = {
      index: chunks.length,
      sha256: await sha256Hex(part),
      sizeBytes: part.length,
    };
    chunks.push(chunk);
    await put(env.EVIDENCE_SOURCE, chunkKey(largeKey, chunk), part);
  }
  const db = env.EVIDENCE_DATABASE,
    assessment = "vet_qualification_case",
    run = env.QUALIFICATION_RUN;
  const now = new Date().toISOString();
  const policy = JSON.stringify({
    fixture: true,
    readGrantDurationSeconds: 900,
    postClosureRetentionSeconds: 7776000,
    projectId: "qualification-only",
    revision: 1,
  });
  const manifest = JSON.stringify({ fixture: true, sha256: sha, chunks });
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_assessments(id,state,completed_at) VALUES(?,'incomplete',?)",
    )
    .bind(assessment, now)
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      assessment,
      run,
      sha,
      await sha256Hex(encoder.encode(manifest)),
      manifest,
      policy,
      now,
      "2027-01-23T00:00:00.000Z",
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_objects VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      assessment,
      run,
      sha,
      bytes.length,
      "artifact",
      "harmless chunk fixture",
      "application/octet-stream",
      largeKey,
      JSON.stringify(chunks),
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_completions VALUES(?,?,?,?)",
    )
    .bind(assessment, run, sha, now)
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_case_closures VALUES(?,?,?,?)",
    )
    .bind(
      assessment,
      now,
      "qualification-only",
      "Synthetic closed case; not an operational decision",
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_grants VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      "0".repeat(64),
      assessment,
      run,
      sha,
      "91",
      "Synthetic consumed grant",
      now,
      now,
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO vetting_evidence_audit VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      "qualification-audit",
      "91",
      "read",
      assessment,
      run,
      sha,
      "Synthetic recovery audit",
      now,
    )
    .run();
  const rows = await snapshot(db),
    rowsSha = await put(env.EVIDENCE_SOURCE, snapshotKey, rows);
  const at = Date.now(),
    day = new Date(at).toISOString().slice(0, 10);
  // Two real queue starts deliberately deliver duplicate first-page work.
  await startDailyBackup(env, at);
  await startDailyBackup(env, at);
  await record(env, "seed", {
    day,
    fixtureAt: now,
    snapshotSha256: rowsSha,
    snapshotBytes: rows.length,
    objectSha256: sha,
    objects: 68 + accessResult.objects,
    accessBytes: accessResult.bytes,
  });
}
async function verify(env: Environment) {
  if (await phase(env, "verify")) return;
  const initial = await phase(env, "seed");
  check(initial, "Seed is absent");
  const seeded = JSON.parse(initial.result) as {
    day: string;
    snapshotSha256: string;
    snapshotBytes: number;
    objectSha256: string;
    objects: number;
    accessBytes: number;
  };
  const cycle = await env.EVIDENCE_DATABASE.prepare(
    "SELECT phase FROM vetting_storage_cycles WHERE day=?",
  )
    .bind(seeded.day)
    .first<{ phase: string }>();
  check(cycle?.phase === "complete", "Backup is not complete");
  const completionKey = `daily/${seeded.day}/complete.json`;
  const before = await env.EVIDENCE_BACKUPS.head(completionKey);
  check(before?.customMetadata?.sha256, "Completion has no digest");
  const completion = JSON.parse(
    new TextDecoder().decode(
      await verifiedPart(
        env.EVIDENCE_BACKUPS,
        completionKey,
        before.customMetadata.sha256,
        before.size,
      ),
    ),
  ) as { objects: number; pages: number; bytes: number };
  const expectedBytes =
    Array.from({ length: 65 }, (_, i) => smallBytes(i).length).reduce(
      (a, b) => a + b,
      0,
    ) +
    EVIDENCE_CHUNK_BYTES +
    17 +
    seeded.snapshotBytes +
    seeded.accessBytes;
  check(
    completion.objects === seeded.objects &&
      completion.pages === 3 &&
      completion.bytes === expectedBytes,
    "Backup omitted fixture bytes",
  );
  await startDailyBackup(env, Date.parse(`${seeded.day}T23:59:59Z`));
  check(
    (await env.EVIDENCE_BACKUPS.head(completionKey))?.customMetadata?.sha256 ===
      before.customMetadata.sha256,
    "Replay changed completion",
  );
  check(
    (await env.EVIDENCE_BACKUPS.head(
      `daily/${seeded.day}/objects/contributor-trace-outside-scope`,
    )) === null,
    "Non-scanner object copied",
  );
  const result = await restoreCheck(
    env.EVIDENCE_BACKUPS,
    env.RESTORED,
    seeded.day,
    smallKey(37),
    "small",
  );
  check(
    result.sha256 === (await sha256Hex(smallBytes(37))),
    "Restored bytes differ",
  );
  const restoredSnapshot = await restoreCheck(
    env.EVIDENCE_BACKUPS,
    env.RESTORED,
    seeded.day,
    snapshotKey,
    "database",
  );
  check(
    restoredSnapshot.sha256 === seeded.snapshotSha256,
    "Snapshot identity differs",
  );
  const rows = JSON.parse(
    new TextDecoder().decode(
      await verifiedPart(
        env.RESTORED,
        restoredSnapshot.key,
        seeded.snapshotSha256,
        seeded.snapshotBytes,
      ),
    ),
  ) as Record<string, Rows>;
  for (const table of tables)
    for (const row of rows[table]) {
      const columns = Object.keys(row);
      await env.RESTORED_DB.prepare(
        `INSERT OR IGNORE INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      )
        .bind(...columns.map((c) => row[c]))
        .run();
    }
  check(
    (await sha256Hex(await snapshot(env.RESTORED_DB))) ===
      seeded.snapshotSha256,
    "Recovered database differs",
  );
  check(
    (await sha256Hex(await snapshot(env.EVIDENCE_DATABASE))) ===
      seeded.snapshotSha256,
    "Source database changed",
  );
  const row = await env.RESTORED_DB.prepare(
    "SELECT * FROM vetting_evidence_objects WHERE assessment_id='vet_qualification_case'",
  ).first<{ object_key: string; chunks: string; sha256: string }>();
  check(row, "Recovered object missing");
  const chunks = JSON.parse(row.chunks);
  for (const chunk of chunks)
    await restoreCheck(
      env.EVIDENCE_BACKUPS,
      env.RESTORED,
      seeded.day,
      chunkKey(row.object_key, chunk),
      "parts",
    );
  await verifyParts(
    env.RESTORED,
    `restore-checks/parts/${row.object_key}`,
    chunks,
    seeded.objectSha256,
  );
  await verifyParts(
    env.EVIDENCE_SOURCE,
    row.object_key,
    chunks,
    seeded.objectSha256,
  );
  check(
    (await env.RESTORED_DB.prepare("PRAGMA foreign_key_check").all()).results
      ?.length === 0,
    "Recovered foreign keys differ",
  );
  // The real immutable-table guard remains in force after recovery.
  let rejected = false;
  try {
    await env.RESTORED_DB.prepare(
      "UPDATE vetting_evidence_runs SET policy='{}'",
    ).run();
  } catch {
    rejected = true;
  }
  check(rejected, "Recovered policy became mutable");
  await record(env, "verify", {
    objects: completion.objects,
    pages: completion.pages,
    bytes: completion.bytes,
    completionSha256: before.customMetadata.sha256,
    restoredSha256: result.sha256,
    recoveredSnapshotSha256: seeded.snapshotSha256,
    chunkedSha256: seeded.objectSha256,
    replayUnchanged: true,
    sourceUnchanged: true,
    foreignKeysValid: true,
    immutablePolicy: true,
  });
}
async function corrupt(env: Environment) {
  if (await phase(env, "corrupt")) return;
  check(
    await phase(env, "verify"),
    "Successful recovery required before fault",
  );
  const initial = await phase(env, "seed");
  check(initial, "Seed is absent");
  const seeded = JSON.parse(initial.result) as {
    day: string;
  };
  const key = `daily/${seeded.day}/objects/${smallKey(37)}`;
  // Only this disposable backup is damaged. Keep its original metadata so the
  // exact core must detect changed bytes, not merely changed metadata.
  await env.EVIDENCE_BACKUPS.delete(key);
  await env.EVIDENCE_BACKUPS.put(key, new Uint8Array(smallBytes(37).length), {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { sha256: await sha256Hex(smallBytes(37)) },
    httpMetadata: { contentType: "application/octet-stream" },
  });
  let corruptRefused = false;
  try {
    await restoreCheck(
      env.EVIDENCE_BACKUPS,
      env.RESTORED,
      seeded.day,
      smallKey(37),
      "corrupt",
    );
  } catch {
    corruptRefused = true;
  }
  check(
    corruptRefused &&
      (await env.RESTORED.head(`restore-checks/corrupt/${smallKey(37)}`)) ===
        null,
    "Corruption accepted",
  );
  await env.EVIDENCE_BACKUPS.delete(`daily/${seeded.day}/pages/0.json`);
  let missingRefused = false;
  try {
    await restoreCheck(
      env.EVIDENCE_BACKUPS,
      env.RESTORED,
      seeded.day,
      smallKey(38),
      "incomplete",
    );
  } catch {
    missingRefused = true;
  }
  check(
    missingRefused &&
      (await env.RESTORED.head(`restore-checks/incomplete/${smallKey(38)}`)) ===
        null,
    "Missing page accepted",
  );
  await verifiedPart(
    env.EVIDENCE_SOURCE,
    smallKey(37),
    await sha256Hex(smallBytes(37)),
    smallBytes(37).length,
  );
  await record(env, "corrupt", {
    changedBytesRefused: true,
    missingPageRefused: true,
    sourceUnchanged: true,
  });
}
async function retention(env: Environment) {
  if (await phase(env, "retention")) return;
  check(
    await phase(env, "corrupt"),
    "Intact recovery and corruption checks required",
  );
  await record(env, "retention", await qualifyRetention(env));
}
async function empty(env: Environment) {
  for (const bucket of [
    env.EVIDENCE_SOURCE,
    env.EVIDENCE_BACKUPS,
    env.RESTORED,
  ]) {
    for (;;) {
      const page = await bucket.list({ prefix: "", limit: 100 });
      if (!page.objects.length) break;
      for (const object of page.objects) await bucket.delete(object.key);
    }
  }
  await record(env, "empty", { empty: true });
}
export default {
  fetch: backup.fetch,
  async queue(
    batch: {
      messages: { id: string; body: unknown; ack(): void; retry(): void }[];
    },
    env: Environment,
  ) {
    check(
      /^slop-vet-q-[0-9]+-[0-9]+$/.test(env.QUALIFICATION_RUN),
      "Not a qualification environment",
    );
    for (const message of batch.messages) {
      const command = message.body as Partial<Command>;
      if (!command.qualification) {
        let acknowledged = false;
        await backup.queue(
          {
            messages: [
              {
                body: message.body as Parameters<
                  typeof backup.queue
                >[0]["messages"][number]["body"],
                ack() {
                  acknowledged = true;
                  message.ack();
                },
                retry() {
                  message.retry();
                },
              },
            ],
          },
          env,
        );
        if (acknowledged) {
          const job = message.body as { page?: number; kind?: string };
          await env.EVIDENCE_DATABASE.prepare(
            "INSERT OR IGNORE INTO qualification_deliveries VALUES(?,?)",
          )
            .bind(
              `queue:${message.id}`,
              job.kind === "cleanup" ? "cleanup" : `backup-page-${job.page}`,
            )
            .run();
        }
        continue;
      }
      check(
        command.qualification === env.QUALIFICATION_RUN,
        "Wrong qualification identity",
      );
      check(
        typeof command.delivery === "string" &&
          new RegExp(`^${command.action}-[0-9]+$`).test(command.delivery),
        "Missing command delivery identity",
      );
      try {
        if (command.action === "access") await access(env);
        else if (command.action === "seed") await seed(env);
        else if (command.action === "verify") await verify(env);
        else if (command.action === "corrupt") await corrupt(env);
        else if (command.action === "retention") await retention(env);
        else if (command.action === "empty") await empty(env);
        else throw new Error("Unknown qualification action");
        await env.EVIDENCE_DATABASE.prepare(
          "INSERT OR IGNORE INTO qualification_deliveries VALUES(?,?)",
        )
          .bind(`command:${command.delivery}`, command.action)
          .run();
        message.ack();
      } catch (error) {
        await record(env, `failed-${command.action}`, {
          failed: true,
          category: error instanceof Error ? error.message : "fixture-failed",
        });
        message.ack();
      }
    }
  },
};
