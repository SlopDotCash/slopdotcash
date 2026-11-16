import type { Database } from "bun:sqlite";

export type DevMigration = { name: string; sql: string };

/**
 * A local migration and its completion marker commit together. A failed or
 * interrupted migration leaves both absent, so the same migration can retry.
 *
 * SQLite ignores foreign_keys changes inside a transaction. Honor the
 * repository's explicit OFF directives before BEGIN for table rebuilds, then
 * check every foreign key before COMMIT and restore enforcement afterward.
 * defer_foreign_keys directives execute inside the transaction as intended.
 */
export function applyDevMigrations(
  sqlite: Database,
  migrations: readonly DevMigration[],
): void {
  if (sqlite.inTransaction)
    throw new Error("Local migrations require their own transaction");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS dev_migrations (name TEXT PRIMARY KEY) STRICT",
  );
  for (const migration of migrations) {
    // These are checked-in SQL directives, not request-supplied SQL.
    const foreignKeysOff =
      /^\s*PRAGMA\s+foreign_keys\s*=\s*(?:OFF|0|FALSE)\s*;/imu.test(
        migration.sql,
      );
    if (foreignKeysOff) sqlite.exec("PRAGMA foreign_keys = OFF");
    try {
      sqlite
        .transaction(() => {
          // Recheck under the write lock: another startup may have applied it.
          const marker = sqlite.prepare(
            "SELECT name FROM dev_migrations WHERE name = ?",
          );
          try {
            if (marker.get(migration.name)) return;
          } finally {
            marker.finalize();
          }
          sqlite.exec(migration.sql);
          const check = sqlite.prepare("PRAGMA foreign_key_check");
          try {
            if (check.get())
              throw new Error(
                `Local migration ${migration.name} violates foreign keys`,
              );
          } finally {
            check.finalize();
          }
          const complete = sqlite.prepare(
            "INSERT INTO dev_migrations(name) VALUES (?)",
          );
          try {
            complete.run(migration.name);
          } finally {
            complete.finalize();
          }
        })
        .immediate();
    } finally {
      sqlite.exec("PRAGMA foreign_keys = ON");
    }
  }
}
