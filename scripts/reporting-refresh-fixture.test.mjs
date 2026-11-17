import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProject } from "../src/lib/projects.mjs";
import { runReportingFixtureRefresh } from "../tests/reporting-refresh-fixture.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";
import { refreshRegisteredReporting } from "../workers/slopbot/reporting-readiness";

const busy = (cause) =>
  new Error("D1_ERROR: database is locked: SQLITE_BUSY", { cause });

test("a successful reporting refresh returns its result without retry", async () => {
  const result = { checked: 2, failed: 1 };
  let attempts = 0;
  expect(
    await runReportingFixtureRefresh(
      async () => {
        attempts++;
        return result;
      },
      async () => {
        throw new Error("Unexpected retry");
      },
    ),
  ).toBe(result);
  expect(attempts).toBe(1);
});

test("reporting refresh replays committed observations after a real SQLite write lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-reporting-lock-"));
  const file = join(directory, "registry.sqlite");
  const { db, sqlite } = sqliteD1(undefined, file);
  const locker = new Database(file);
  const waits = [];
  let locked = false;
  let interrupted = false;
  let lockErrors = 0;
  let attempts = 0;
  try {
    for (const id of ["asi", "eliza"]) {
      const project = findProject(id);
      if (!project) throw new Error("Missing registry fixture");
      const manifest = JSON.stringify({ ...project, status: "active" });
      const digest = createHash("sha256").update(manifest).digest("hex");
      sqlite
        .query(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'fixture','2026-11-17T00:00:00.000Z')",
        )
        .run(id, manifest, digest);
      sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
        )
        .run(
          id,
          manifest,
          digest,
          "2026-11-17T00:00:00.000Z",
          "2026-11-17T00:00:00.000Z",
        );
    }
    const statement = (sql, values = []) => {
      const prepared = db.prepare(sql).bind(...values);
      return {
        bind: (...next) => statement(sql, next),
        all: () => prepared.all(),
        first: () => prepared.first(),
        async run() {
          if (
            !interrupted &&
            sql.startsWith("INSERT INTO repository_reporting_status") &&
            values[0] === "eliza"
          ) {
            locker.exec("BEGIN IMMEDIATE");
            locked = true;
            interrupted = true;
          }
          try {
            return await prepared.run();
          } catch (error) {
            if (error.code !== "SQLITE_BUSY") throw error;
            lockErrors++;
            // Match the D1 API's typed wrapper around the native SQLite error.
            throw busy(error);
          }
        },
      };
    };
    const env = {
      SLOPBOT_DB: { prepare: statement },
      SLOPBOT_APP_ID: "1",
      SLOPBOT_APP_PRIVATE_KEY: "unused",
    };
    const result = await runReportingFixtureRefresh(
      async () => {
        attempts++;
        return refreshRegisteredReporting(env, async () => ({
          kind: "app-not-installed",
        }));
      },
      async (milliseconds) => {
        waits.push(milliseconds);
        expect(
          sqlite
            .query(
              "SELECT project_id, failure FROM repository_reporting_status",
            )
            .all(),
        ).toEqual([{ project_id: "asi", failure: "app-not-installed" }]);
        locker.exec("ROLLBACK");
        locked = false;
      },
    );
    const response = Response.json(result);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checked: 2, failed: 2 });
    expect(attempts).toBe(2);
    expect(lockErrors).toBe(1);
    expect(waits).toEqual([100]);
    expect(
      sqlite
        .query(
          "SELECT project_id, failure FROM repository_reporting_status ORDER BY project_id",
        )
        .all(),
    ).toEqual([
      { project_id: "asi", failure: "app-not-installed" },
      { project_id: "eliza", failure: "app-not-installed" },
    ]);
  } finally {
    if (locked) locker.exec("ROLLBACK");
    locker.close();
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("four busy attempts preserve the last original error", async () => {
  const failures = Array.from({ length: 4 }, () => busy());
  const waits = [];
  let attempts = 0;
  await expect(
    runReportingFixtureRefresh(
      async () => {
        throw failures[attempts++];
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    ),
  ).rejects.toBe(failures[3]);
  expect(attempts).toBe(4);
  expect(waits).toEqual([100, 200, 400]);
});

for (const failure of [
  new Error("D1_ERROR: UNIQUE constraint failed"),
  new Error("database is locked: SQLITE_BUSY"),
  new Error("Unrelated failure", { cause: busy() }),
  { message: "D1_ERROR: database is locked: SQLITE_BUSY" },
  "D1_ERROR: database is locked: SQLITE_BUSY",
])
  test(`nonmatching reporting failure is not retried (${typeof failure === "string" ? "string" : failure instanceof Error ? failure.message : "object"})`, async () => {
    let attempts = 0;
    await expect(
      runReportingFixtureRefresh(
        async () => {
          attempts++;
          throw failure;
        },
        async () => {
          throw new Error("Unexpected retry");
        },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
