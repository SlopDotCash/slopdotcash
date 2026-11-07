import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";

const AT = "2026-11-07T12:00:00.000Z";
function before(migration: string) {
  return sqliteD1(MIGRATIONS.filter((name) => name < migration)).sqlite;
}
function apply(sqlite: ReturnType<typeof before>, migration: string) {
  sqlite.exec(
    `BEGIN;\n${readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), "utf8")}\nCOMMIT;`,
  );
}

for (const migration of [
  "0008_points.sql",
  "0108_identity_failed_callback.sql",
]) {
  test(`${migration} preserves populated OAuth rows and their one-time status`, () => {
    const sqlite = before(migration);
    try {
      sqlite
        .query(
          "INSERT INTO identity_oauth_flows(id,state_hash,poll_capability_hash,audience,status,github_actor_id,github_login,created_at,expires_at,callback_completed_at,assertion_issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "existing-flow",
          "a".repeat(64),
          "b".repeat(64),
          "private-trace-api",
          "assertion_issued",
          "1",
          "tester",
          AT,
          "2026-11-07T12:05:00.000Z",
          AT,
          AT,
        );
      const original = sqlite
        .prepare("SELECT * FROM identity_oauth_flows")
        .get() as Record<string, unknown>;
      apply(sqlite, migration);
      const upgraded = sqlite
        .prepare("SELECT * FROM identity_oauth_flows")
        .get() as Record<string, unknown>;
      for (const [key, value] of Object.entries(original))
        expect(upgraded[key], key).toEqual(value);
      expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      if (migration.startsWith("0108")) {
        sqlite.exec("UPDATE identity_oauth_flows SET status='callback_failed'");
        expect(() =>
          sqlite.exec("UPDATE identity_oauth_flows SET status='pending'"),
        ).toThrow(/terminal/);
      }
    } finally {
      sqlite.close();
    }
  });
}

test("wallet schema upgrades preserve observations and do not manufacture possession", () => {
  const sqlite = before("0003_wallet_claim_registry.sql");
  try {
    sqlite
      .query("INSERT INTO wallet_claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        "historical",
        "1",
        "tester",
        "11111111111111111111111111111111",
        "d1_fallback",
        null,
        null,
        "a".repeat(64),
        AT,
        "b".repeat(64),
        null,
        AT,
      );
    apply(sqlite, "0003_wallet_claim_registry.sql");
    const migrated = sqlite
      .query("SELECT * FROM wallet_claims")
      .get() as Record<string, unknown>;
    expect(migrated.source).toBe("d1_registry");
    expect(migrated.record_sha256).toBe("b".repeat(64));
    for (const migration of MIGRATIONS.filter(
      (name) =>
        name > "0003_wallet_claim_registry.sql" &&
        name <= "0010_wallet_claim_chain.sql",
    ))
      apply(sqlite, migration);
    expect(
      sqlite.query("SELECT chain,record_sha256 FROM wallet_claims").get(),
    ).toEqual({ chain: "solana", record_sha256: "b".repeat(64) });
    expect(
      sqlite
        .query("SELECT count(*) AS n FROM wallet_possession_attestations")
        .get(),
    ).toEqual({ n: 0 });
    expect(() =>
      sqlite.query("UPDATE wallet_claims SET wallet_address=?").run("changed"),
    ).toThrow(/immutable/);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("inbox widening preserves populated read markers without replaying queued mail", () => {
  const sqlite = before("0063_account_closure_notification_events.sql");
  try {
    sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "wallet:existing",
        "1",
        "wallet_changed",
        "Wallet changed",
        "/settings",
        AT,
        AT,
      );
    sqlite
      .query("UPDATE notifications SET read_at=? WHERE event_key=?")
      .run(AT, "wallet:existing");
    const old = sqlite.query("SELECT * FROM notifications").all();
    const queued = sqlite
      .query("SELECT * FROM activity_notification_outbox")
      .all();
    for (const migration of MIGRATIONS.filter(
      (name) =>
        name >= "0063_account_closure_notification_events.sql" &&
        name <= "0079_slopbot_scam_review_notifications.sql",
    ))
      apply(sqlite, migration);
    expect(sqlite.query("SELECT * FROM notifications").all()).toEqual(old);
    expect(
      sqlite.query("SELECT * FROM activity_notification_outbox").all(),
    ).toEqual(queued);
    expect(() => sqlite.exec("UPDATE notifications SET read_at=NULL")).toThrow(
      /unread to read/,
    );
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("email enrollment upgrade preserves consent and repeating opt-out advances its revision", () => {
  const sqlite = before("0111_verified_notification_email.sql");
  try {
    sqlite
      .query(
        "INSERT INTO notification_email_preferences(github_id,enabled,destination_version,updated_at) VALUES(?,?,?,?)",
      )
      .run("1", 1, "a".repeat(64), AT);
    apply(sqlite, "0111_verified_notification_email.sql");
    expect(
      sqlite
        .query(
          "SELECT enabled,security_enabled,destination_version FROM notification_email_preferences",
        )
        .get(),
    ).toEqual({
      enabled: 1,
      security_enabled: null,
      destination_version: "a".repeat(64),
    });
    for (const migration of MIGRATIONS.filter(
      (name) =>
        name > "0111_verified_notification_email.sql" &&
        name <= "0116_email_preference_revision.sql",
    ))
      apply(sqlite, migration);
    sqlite
      .query(
        "UPDATE notification_email_preferences SET enabled=0,security_enabled=0,updated_at=?",
      )
      .run(AT);
    expect(
      sqlite.query("SELECT revision FROM notification_email_preferences").get(),
    ).toEqual({ revision: 1 });
    sqlite
      .query(
        "UPDATE notification_email_preferences SET enabled=0,security_enabled=0,updated_at=?",
      )
      .run(AT);
    expect(
      sqlite.query("SELECT revision FROM notification_email_preferences").get(),
    ).toEqual({ revision: 2 });
    expect(
      sqlite
        .query("SELECT count(*) AS n FROM notification_email_destinations")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    sqlite.close();
  }
});

test("enforcement rebuilds preserve a populated journal and its rowid cache generation", () => {
  const sqlite = before("0027_project_enforcement_owner_appeals.sql");
  try {
    const manifest = JSON.stringify({ id: "migration-test", status: "paused" });
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
      )
      .run("migration-test", manifest, "a".repeat(64), "migration fixture", AT);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
      )
      .run("migration-test", manifest, "a".repeat(64), AT, AT);
    const row = {
      id: "enf_migration0001",
      project_id: "migration-test",
      sequence: 1,
      action: "quarantine",
      state_after: "quarantined",
      appeal_after: "none",
      reason: "A preserved reviewed reason",
      evidence_reference: "evidence:test",
      repository_github_id: "123",
      repository_keys: '["test/repository"]',
      actor_github_id: "1",
      actor_github_login: "moderator",
      actor_role: "project-moderator",
      decision_source: "admin-panel",
      before_revision: 1,
      before_manifest_sha256: "a".repeat(64),
      after_revision: null,
      after_manifest_sha256: null,
      result: "revision_pending",
      created_at: AT,
    };
    sqlite
      .query(
        `INSERT INTO project_enforcements(${Object.keys(row).join(",")}) VALUES(${Object.keys(
          row,
        )
          .map(() => "?")
          .join(",")})`,
      )
      .run(...Object.values(row));
    const beforeRow = sqlite
      .prepare("SELECT rowid AS row_id,* FROM project_enforcements")
      .get() as Record<string, unknown>;
    for (const migration of MIGRATIONS.filter(
      (name) =>
        name >= "0027_project_enforcement_owner_appeals.sql" &&
        name <= "0072_account_reinstatements.sql",
    ))
      apply(sqlite, migration);
    const afterRow = sqlite
      .prepare("SELECT rowid AS row_id,* FROM project_enforcements")
      .get() as Record<string, unknown>;
    for (const [key, value] of Object.entries(beforeRow))
      expect(afterRow[key], key).toEqual(value);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => sqlite.exec("DELETE FROM project_enforcements")).toThrow(
      /permanent/,
    );
  } finally {
    sqlite.close();
  }
});
