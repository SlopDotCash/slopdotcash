import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../tests/sqlite-d1";
import { applyDevMigrations } from "./dev-migrations";

const source = (name: string) => ({
  name,
  sql: readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
});
function count(sqlite: Database) {
  return (
    sqlite.query("SELECT count(*) AS n FROM dev_migrations").get() as {
      n: number;
    }
  ).n;
}

test("the entire checked-in migration chain commits once and restarts cleanly", () => {
  const sqlite = new Database(":memory:");
  try {
    const migrations = MIGRATIONS.map(source);
    applyDevMigrations(sqlite, migrations);
    expect(count(sqlite)).toBe(MIGRATIONS.length);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    applyDevMigrations(sqlite, migrations);
    expect(count(sqlite)).toBe(MIGRATIONS.length);
  } finally {
    sqlite.close();
  }
});

test("mid-migration failure rolls back schema and marker, then the same name retries", () => {
  const sqlite = new Database(":memory:");
  try {
    expect(() =>
      applyDevMigrations(sqlite, [
        {
          name: "failure.sql",
          sql: "CREATE TABLE retry_me(id INTEGER); INSERT INTO missing_table VALUES(1);",
        },
      ]),
    ).toThrow();
    expect(
      sqlite
        .query("SELECT name FROM sqlite_master WHERE name='retry_me'")
        .get(),
    ).toBe(null);
    expect(count(sqlite)).toBe(0);
    applyDevMigrations(sqlite, [
      {
        name: "failure.sql",
        sql: "CREATE TABLE retry_me(id INTEGER); INSERT INTO retry_me VALUES(1);",
      },
    ]);
    expect(count(sqlite)).toBe(1);
    expect(sqlite.query("SELECT id FROM retry_me").get()).toEqual({ id: 1 });
  } finally {
    sqlite.close();
  }
});

test("foreign-key rebuild preserves populated children and rejects invalid committed state", () => {
  const sqlite = new Database(":memory:");
  try {
    applyDevMigrations(sqlite, [
      {
        name: "initial.sql",
        sql: "CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO parent VALUES(1); INSERT INTO child VALUES(1);",
      },
    ]);
    applyDevMigrations(sqlite, [
      {
        name: "rebuild.sql",
        sql: "PRAGMA foreign_keys=OFF; PRAGMA defer_foreign_keys=ON; CREATE TABLE saved AS SELECT * FROM parent; DROP TABLE parent; CREATE TABLE parent(id INTEGER PRIMARY KEY, label TEXT); INSERT INTO parent(id) SELECT id FROM saved; DROP TABLE saved; PRAGMA foreign_keys=ON;",
      },
    ]);
    expect(sqlite.query("SELECT * FROM child").all()).toEqual([
      { parent_id: 1 },
    ]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() =>
      applyDevMigrations(sqlite, [
        {
          name: "invalid.sql",
          sql: "PRAGMA foreign_keys=OFF; DELETE FROM parent;",
        },
      ]),
    ).toThrow(/foreign keys/);
    expect(count(sqlite)).toBe(2);
    expect(sqlite.query("SELECT id FROM parent").get()).toEqual({ id: 1 });
    expect(() => sqlite.exec("INSERT INTO child VALUES(2)")).toThrow(
      /FOREIGN KEY/,
    );
  } finally {
    sqlite.close();
  }
});

test("a process death after SQL but before the marker leaves a retryable database", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-migration-crash-"));
  const database = join(directory, "local.sqlite");
  const child = join(directory, "crash.ts");
  try {
    writeFileSync(
      child,
      `import { Database } from "bun:sqlite";
import { applyDevMigrations } from ${JSON.stringify(new URL("./dev-migrations.ts", import.meta.url).pathname)};
const sqlite = new Database(${JSON.stringify(database)});
const original = sqlite.exec.bind(sqlite);
sqlite.exec = (sql) => { const value = original(sql); if (sql.includes("CREATE TABLE crash_table")) process.exit(29); return value; };
applyDevMigrations(sqlite, [{ name: "crash.sql", sql: "CREATE TABLE crash_table(id INTEGER);" }]);`,
    );
    const result = Bun.spawnSync([process.execPath, child]);
    expect(result.exitCode).toBe(29);
    const sqlite = new Database(database);
    try {
      expect(
        sqlite
          .query("SELECT name FROM sqlite_master WHERE name='crash_table'")
          .get(),
      ).toBe(null);
      expect(count(sqlite)).toBe(0);
      applyDevMigrations(sqlite, [
        { name: "crash.sql", sql: "CREATE TABLE crash_table(id INTEGER);" },
      ]);
      expect(count(sqlite)).toBe(1);
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed completion-marker write rolls the migrated schema back too", () => {
  const sqlite = new Database(":memory:");
  try {
    applyDevMigrations(sqlite, []);
    sqlite.exec(
      "CREATE TRIGGER fail_marker BEFORE INSERT ON dev_migrations BEGIN SELECT RAISE(ABORT,'marker unavailable'); END;",
    );
    expect(() =>
      applyDevMigrations(sqlite, [
        {
          name: "marker.sql",
          sql: "CREATE TABLE marker_must_match(id INTEGER);",
        },
      ]),
    ).toThrow(/marker unavailable/);
    expect(
      sqlite
        .query("SELECT name FROM sqlite_master WHERE name='marker_must_match'")
        .get(),
    ).toBe(null);
    sqlite.exec("DROP TRIGGER fail_marker");
    applyDevMigrations(sqlite, [
      {
        name: "marker.sql",
        sql: "CREATE TABLE marker_must_match(id INTEGER);",
      },
    ]);
    expect(count(sqlite)).toBe(1);
  } finally {
    sqlite.close();
  }
});

test("the populated 0084 deferred-FK migration retains budget evidence and reconciliations", () => {
  const sqlite = new Database(":memory:");
  try {
    const cutoff = "0084_slopbot_attempt_accounting.sql";
    applyDevMigrations(
      sqlite,
      MIGRATIONS.filter((name) => name < cutoff).map(source),
    );
    sqlite
      .query("INSERT INTO slopbot_value_budget_reservations VALUES(?,?,?,?,?)")
      .run("attempt-1", "2026-11", 10, 100, "2026-11-07T00:00:00.000Z");
    sqlite
      .query("INSERT INTO slopbot_value_budget_reconciliations VALUES(?,?,?,?)")
      .run("attempt-1", 1, 5, "2026-11-07T00:00:00.000Z");
    sqlite
      .query("INSERT INTO slopbot_value_inference_results VALUES(?,?,?,?,?)")
      .run(
        "a".repeat(64),
        "attempt-1",
        "{}",
        "b".repeat(64),
        "2026-11-07T00:00:00.000Z",
      );
    const tables = [
      "slopbot_value_budget_reservations",
      "slopbot_value_budget_reconciliations",
      "slopbot_value_inference_results",
    ];
    const original = tables.map((table) =>
      sqlite.prepare(`SELECT * FROM ${table}`).all(),
    );
    applyDevMigrations(sqlite, [source(cutoff)]);
    expect(
      tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all()),
    ).toEqual(original);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(sqlite.query("PRAGMA defer_foreign_keys").get()).toEqual({
      defer_foreign_keys: 0,
    });
  } finally {
    sqlite.close();
  }
});
