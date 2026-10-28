/**
 * Runs D1 statements against a SQLite database with the real migrations, so
 * registry tests exercise the actual tables and triggers. The database is in
 * memory unless `file` names one; a caller reopening a file passes no
 * migrations. Each process applies one migration list once and gives every
 * in-memory caller its own copy of that image.
 */
import { Database, type Statement as SQLiteStatement } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectD1Database } from "../backend/projects/cloudflare-persistence";

type Statement = ReturnType<ProjectD1Database["prepare"]> & {
  runSync(): { success: boolean; meta: { changes: number } };
};

const root = resolve(import.meta.dir, "..", "migrations");

/** Every repository migration in apply order. */
export const MIGRATIONS = readdirSync(root)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function migrate(sqlite: Database, migrations: string[]) {
  for (const migration of migrations)
    sqlite.exec(readFileSync(join(root, migration), "utf8"));
}

// Migrations leave the connection with foreign keys on; a deserialized copy
// starts with them off, so each copy restores the migrated connection's value.
const images = new Map<string, { bytes: Uint8Array; foreignKeys: number }>();

function migratedCopy(migrations: string[]): Database {
  const key = migrations.join("\n");
  let image = images.get(key);
  if (!image) {
    const source = new Database(":memory:");
    migrate(source, migrations);
    const { foreign_keys } = source.query("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    image = { bytes: source.serialize(), foreignKeys: foreign_keys };
    source.close();
    images.set(key, image);
  }
  const sqlite = Database.deserialize(image.bytes);
  sqlite.exec(`PRAGMA foreign_keys = ${image.foreignKeys}`);
  return sqlite;
}

export function sqliteD1(
  migrations: string[] = MIGRATIONS,
  file = ":memory:",
): {
  db: ProjectD1Database;
  sqlite: Database;
} {
  let sqlite: Database;
  if (file === ":memory:" && migrations.length > 0)
    sqlite = migratedCopy(migrations);
  else {
    sqlite = new Database(file);
    migrate(sqlite, migrations);
  }
  // Finalize each statement after its one use. An unfinalized statement keeps
  // a file database open after close() until garbage collection, and Windows
  // then refuses to delete the file. query() does not prevent this: Bun
  // caches only 20 statements and leaves later ones unfinalized.
  const once = <R>(sql: string, use: (prepared: SQLiteStatement) => R): R => {
    const prepared = sqlite.prepare(sql);
    try {
      return use(prepared);
    } finally {
      prepared.finalize();
    }
  };
  const statement = (sql: string, values: unknown[] = []): Statement => {
    const params = values as never[];
    const runSync = () => ({
      success: true,
      meta: {
        changes: once(sql, (prepared) => prepared.run(...params).changes),
      },
    });
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async <T>() =>
        (once(sql, (prepared) => prepared.get(...params)) as T | undefined) ??
        null,
      all: async <T>() => ({
        success: true,
        results: once(sql, (prepared) => prepared.all(...params)) as T[],
      }),
      run: async () => runSync(),
      runSync,
    };
  };
  const db: ProjectD1Database = {
    prepare: (sql) => statement(sql),
    batch: async (statements) =>
      sqlite.transaction(() =>
        (statements as Statement[]).map((entry) => entry.runSync()),
      )(),
  };
  return { db, sqlite };
}
