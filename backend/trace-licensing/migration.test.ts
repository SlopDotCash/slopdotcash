import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";

const NEW = "0148_trace_licensing.sql";

describe("trace licensing migration", () => {
  test("migration backfills v1 on uploaded runs and guards history", () => {
    const { sqlite } = sqliteD1(MIGRATIONS.filter((m) => m !== NEW));
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id, repository, project_policy_revision, provider, model, client, client_version, state, created_at, create_idempotency_key)
         VALUES ('r1','c1','1','a','p','o/r','rev','prov','m','cl','1','awaiting_trace','2026-11-22T00:00:00Z','k1')`,
      )
      .run();
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id, repository, project_policy_revision, provider, model, client, client_version, state, trace_sha256, created_at, create_idempotency_key)
         VALUES ('r0','c0','1','a','p','o/r','rev','prov','m','cl','1','trace_uploaded','${"a".repeat(64)}','2026-11-22T00:00:00Z','k0')`,
      )
      .run();
    sqlite.exec(
      readFileSync(join(import.meta.dir, "../../migrations", NEW), "utf8"),
    );
    const version = (id: string) =>
      (
        sqlite
          .query("SELECT terms_version FROM trace_runs WHERE id = ?")
          .get(id) as { terms_version: string | null }
      ).terms_version;
    // A run holding a trace was uploaded under v1; a run still awaiting its
    // trace stays unstamped so its first intent sets the version.
    expect(version("r0")).toBe("private-trace-v1");
    expect(version("r1")).toBeNull();
    sqlite
      .query(
        `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id, repository, project_policy_revision, provider, model, client, client_version, state, created_at, create_idempotency_key)
         VALUES ('r2','c2','1','a','p','o/r','rev','prov','m','cl','1','awaiting_trace','2026-11-22T00:00:00Z','k2')`,
      )
      .run();
    expect(
      (
        sqlite
          .query("SELECT terms_version FROM trace_runs WHERE id='r2'")
          .get() as { terms_version: string | null }
      ).terms_version,
    ).toBeNull();

    sqlite
      .query(
        `INSERT INTO trace_licence_events (run_id, github_id, kind, reason, at) VALUES ('r1','1','granted','upload','2026-11-22T00:00:00Z')`,
      )
      .run();
    sqlite
      .query(
        `INSERT INTO trace_licensing_events (github_id, kind, terms_version, at) VALUES ('1','enabled','private-trace-v2','2026-11-22T00:00:00Z')`,
      )
      .run();
    expect(() =>
      sqlite.exec("UPDATE trace_licence_events SET reason='opt_in'"),
    ).toThrow();
    expect(() => sqlite.exec("DELETE FROM trace_licensing_events")).toThrow();

    sqlite
      .query(
        `INSERT INTO notifications (event_key, recipient_github_id, kind, subject, action_path, source_at, created_at)
         VALUES ('trace-licensing:available-2026-11','1','trace_licensing_available','Trace licensing','/account#trace-licensing','2026-11-22T00:00:00Z','2026-11-22T00:00:00Z')`,
      )
      .run();
  });
});
