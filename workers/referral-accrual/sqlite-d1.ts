// Test and local-harness D1 stand-in backed by bun:sqlite with every migration applied.
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { ReferralD1Database } from "./store";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

export function sqliteD1(): { db: ReferralD1Database; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  const db: ReferralD1Database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values: (string | number | null)[] = [];
      const bound = {
        bind(...next: (string | number | null)[]) {
          values = next;
          return bound;
        },
        async first<T>() {
          return (statement.get(...values) as T | null) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: result.changes } };
        },
      };
      return bound;
    },
  };
  return { db, sqlite };
}
