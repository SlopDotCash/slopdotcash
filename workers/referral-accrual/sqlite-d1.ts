// Test and local-harness D1 stand-in backed by bun:sqlite with every migration applied.
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { ReferralD1Database } from "./store";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

export function sqliteD1(
  filename = ":memory:",
  migrate = true,
): { db: ReferralD1Database; sqlite: Database } {
  const sqlite = new Database(filename);
  if (migrate)
    for (const file of readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  const executions = new WeakMap<object, () => { meta: { changes: number } }>();
  const db: ReferralD1Database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values: (string | number | null)[] = [];
      const execute = () => ({
        meta: { changes: statement.run(...values).changes },
      });
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
          return execute();
        },
      };
      executions.set(bound, execute);
      return bound;
    },
    async batch(statements) {
      return sqlite.transaction(() =>
        statements.map((statement) => {
          const execute = executions.get(statement);
          if (!execute) throw new Error("Unknown D1 fixture statement");
          return execute();
        }),
      )();
    },
  };
  return { db, sqlite };
}
