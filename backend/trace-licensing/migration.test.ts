import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";

const NEW = "0148_trace_licensing.sql";

describe("trace licensing migration", () => {
  test("migration backfills v1 on uploaded runs and guards history", () => {
    const { sqlite } = sqliteD1(MIGRATIONS.filter((m) => m < NEW));
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

describe("trace terms v3 migration", () => {
  const V3 = "0151_trace_terms_v3.sql";

  test("rebuild keeps every row, id, index and trigger and accepts v3", () => {
    const { sqlite } = sqliteD1(MIGRATIONS.filter((m) => m < V3));
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(
      `INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id, repository, project_policy_revision, provider, model, client, client_version, state, trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version)
       VALUES ('r0','c0','1','a','p','o/r','rev','prov','m','cl','1','finalized','${"a".repeat(64)}','2026-11-22T00:00:00Z','2026-11-22T00:01:00Z','k0','private-trace-v2'),
              ('r1','c1','1','a','p','o/r','rev','prov','m','cl','1','awaiting_trace',NULL,'2026-11-22T00:00:00Z',NULL,'k1',NULL);
       INSERT INTO run_progress_events (id, run_id, github_user_id, kind, occurred_at, source, created_at, idempotency_key)
       VALUES ('e0','r0','1','pull_request_opened','2026-11-22T00:00:00Z','agent','2026-11-22T00:00:00Z','ik0');
       INSERT INTO trace_licensing_events (github_id, kind, terms_version, at) VALUES ('1','enabled','private-trace-v2','2026-11-22T00:00:00Z');
       INSERT INTO trace_licensing_events (github_id, kind, terms_version, at) VALUES ('1','disabled','private-trace-v2','2026-11-22T00:02:00Z');
       INSERT INTO trace_licences (run_id, github_id, state, basis, updated_at) VALUES ('r0','1','withdrawn','upload','2026-11-22T00:02:00Z');
       INSERT INTO trace_licence_events (run_id, github_id, kind, reason, account_event_id, at) VALUES ('r0','1','granted','upload',1,'2026-11-22T00:01:00Z');`,
    );
    const dump = (table: string) =>
      sqlite.query(`SELECT * FROM ${table} ORDER BY 1`).all();
    const schema = () =>
      sqlite
        .query(
          "SELECT type, name FROM sqlite_master WHERE tbl_name IN ('trace_runs','trace_licensing_events') ORDER BY type, name",
        )
        .all();
    const tables = [
      "trace_runs",
      "trace_licensing_events",
      "trace_licences",
      "trace_licence_events",
      "run_progress_events",
    ];
    const before = Object.fromEntries(tables.map((t) => [t, dump(t)]));
    const objects = schema();
    sqlite.exec(
      readFileSync(join(import.meta.dir, "../../migrations", V3), "utf8"),
    );
    for (const table of tables) expect(dump(table)).toEqual(before[table]);
    expect(schema()).toEqual(objects);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      (sqlite.query("PRAGMA foreign_keys").get() as { foreign_keys: number })
        .foreign_keys,
    ).toBe(1);

    sqlite.exec(
      "UPDATE trace_runs SET terms_version = 'private-trace-v3' WHERE id = 'r1'",
    );
    // The sequence continues past the kept ids.
    const id = (
      sqlite
        .query(
          `INSERT INTO trace_licensing_events (github_id, kind, terms_version, at)
           VALUES ('1','enabled','private-trace-v3','2026-11-23T00:00:00Z') RETURNING id`,
        )
        .get() as { id: number }
    ).id;
    expect(id).toBe(3);
    expect(() =>
      sqlite.exec(
        "UPDATE trace_runs SET terms_version = 'private-trace-v4' WHERE id = 'r1'",
      ),
    ).toThrow();
    expect(() =>
      sqlite.exec(
        `INSERT INTO trace_licensing_events (github_id, kind, terms_version, at) VALUES ('1','enabled','private-trace-v4','x')`,
      ),
    ).toThrow();
    expect(() => sqlite.exec("DELETE FROM trace_licensing_events")).toThrow();
    expect(() =>
      sqlite.exec("UPDATE trace_licensing_events SET kind = 'disabled'"),
    ).toThrow();
  });
});
