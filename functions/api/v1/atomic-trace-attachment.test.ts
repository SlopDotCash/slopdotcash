import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const tokenHash = "a".repeat(64);
const traceSha256 = "b".repeat(64);
const now = "2026-08-15T12:00:00.000Z";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "migrations/0001_private_trace_backend.sql",
    "migrations/0005_atomic_trace_attachment.sql",
  ]) {
    db.exec(readFileSync(migration, "utf8"));
  }
  db.prepare(
    `INSERT INTO trace_runs (
      id, client_run_id, github_user_id, github_login, project_id, repository,
      project_policy_revision, provider, model, client, client_version, state,
      trace_sha256, created_at, finalized_at, create_idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_trace', NULL, ?, NULL, ?)`,
  ).run(
    "run-1",
    "client-run-1",
    "42",
    "octocat",
    "eliza",
    "elizaOS/eliza",
    "c".repeat(40),
    "openai",
    "gpt-5",
    "codex",
    "1.0.0",
    now,
    "create-run-key-0001",
  );
  db.prepare(
    `INSERT INTO trace_upload_intents (
      token_hash, run_id, github_user_id, trace_sha256, size_bytes,
      content_type, idempotency_key, created_at, expires_at, consumed_at
    ) VALUES (?, 'run-1', '42', ?, 5, 'text/plain', ?, ?, ?, NULL)`,
  ).run(
    tokenHash,
    traceSha256,
    "intent-key-0001",
    now,
    "2026-08-15T12:05:00.000Z",
  );
  return db;
}

function attemptAttachment(db: DatabaseSync, updateRun: boolean): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE trace_upload_intents SET consumed_at = ? WHERE token_hash = ?",
    ).run(now, tokenHash);
    db.prepare(
      "INSERT INTO trace_objects VALUES (?, ?, 5, 'text/plain', '42', ?)",
    ).run(traceSha256, `traces/sha256/bb/${traceSha256}`, now);
    db.prepare("INSERT INTO trace_uploads VALUES ('42', ?, 'run-1', ?, ?)").run(
      tokenHash,
      traceSha256,
      now,
    );
    if (updateRun) {
      db.prepare(
        "UPDATE trace_runs SET trace_sha256 = ?, state = 'trace_uploaded' WHERE id = 'run-1'",
      ).run(traceSha256);
    }
    db.prepare(
      "INSERT INTO trace_attachment_commits VALUES (?, 'run-1', '42', ?, ?)",
    ).run(tokenHash, traceSha256, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

describe("atomic trace attachment migration", () => {
  it("keeps every migration compatible with the remote D1 trigger parser", () => {
    const incompatibleCaseTerminator =
      /\bCASE\b(?:(?!\bEND\b)[\s\S])*?\bEND\s*;/iu;
    expect(
      incompatibleCaseTerminator.test(
        "CREATE TRIGGER example BEGIN SELECT CASE WHEN 1 THEN 1 END; END;",
      ),
    ).toBe(true);
    const incompatible = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => {
        const migration = readFileSync(`migrations/${name}`, "utf8");
        // Remote D1 rejects a CASE whose own END is statement-terminating
        // inside a trigger, even though local SQLite accepts it.
        return incompatibleCaseTerminator.test(migration);
      });
    expect(incompatible).toEqual([]);

    const migration = readFileSync(
      "migrations/0005_atomic_trace_attachment.sql",
      "utf8",
    );
    expect(migration.match(/^END;$/gmu)).toHaveLength(3);
  });

  it("rolls back intent consumption when a later attachment invariant fails", () => {
    const db = database();
    expect(() => attemptAttachment(db, false)).toThrow(
      /incomplete trace attachment/u,
    );
    expect(
      db.prepare("SELECT consumed_at FROM trace_upload_intents").get(),
    ).toEqual({ consumed_at: null });
    expect(
      db.prepare("SELECT count(*) AS count FROM trace_objects").get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT count(*) AS count FROM trace_uploads").get(),
    ).toEqual({ count: 0 });
  });

  it("commits exactly one complete attachment and rejects replay", () => {
    const db = database();
    expect(() => attemptAttachment(db, true)).not.toThrow();
    expect(
      db
        .prepare("SELECT count(*) AS count FROM trace_attachment_commits")
        .get(),
    ).toEqual({ count: 1 });
    expect(() => attemptAttachment(db, true)).toThrow();
  });
});
