import { Database } from "bun:sqlite";
import { chmodSync, readFileSync } from "node:fs";
import type { D1Statement, D1TransactionalDatabase } from "../../backend/d1";
import type { JournalStore } from "../../workers/payment-executor/core";

/** One process owns this signer journal. SQLite releases the lock after a crash. */
export function openKeeperStore(file: string) {
  const lock = new Database(`${file}.lock`, { create: true });
  lock.exec("CREATE TABLE IF NOT EXISTS lock(id INTEGER)");
  lock.exec("BEGIN EXCLUSIVE");
  const db = new Database(file, { create: true });
  chmodSync(file, 0o600);
  chmodSync(`${file}.lock`, 0o600);
  db.exec("PRAGMA synchronous=FULL");
  db.exec(`CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS awards(scope TEXT NOT NULL,id TEXT NOT NULL,actor TEXT NOT NULL,reserve TEXT NOT NULL,payment TEXT,checked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,id)) STRICT;
    CREATE TABLE IF NOT EXISTS gas(id TEXT PRIMARY KEY,day TEXT NOT NULL,maximum TEXT NOT NULL,transaction_id TEXT NOT NULL,actual TEXT,settled_day TEXT,expiry_evidence TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS payment_chain_cursors(project_id TEXT NOT NULL,network TEXT NOT NULL,position TEXT NOT NULL,synced_at TEXT NOT NULL,PRIMARY KEY(project_id,network)) STRICT;`);
  if (
    !db
      .query<{ name: string }, []>("PRAGMA table_info(gas)")
      .all()
      .some((column) => column.name === "expiry_evidence")
  ) {
    db.exec("ALTER TABLE gas ADD COLUMN expiry_evidence TEXT");
  }
  if (
    !db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='payment_solana_scans'",
      )
      .get()
  ) {
    db.exec(
      readFileSync(
        new URL(
          "../../migrations/0012_solana_scan_backlog.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  const raw: JournalStore = {
    async get<T>(key: string) {
      const row = db
        .query<{ value: string }, [string]>(
          "SELECT value FROM journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      db.query(
        "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, JSON.stringify(value));
    },
    async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
      return callback(raw);
    },
  };
  let tail = Promise.resolve();
  const journal: JournalStore = {
    ...raw,
    async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
      const previous = tail;
      let done!: () => void;
      tail = new Promise<void>((resolve) => {
        done = resolve;
      });
      await previous;
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(raw);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        done();
      }
    },
  };
  type Statement = D1Statement & {
    execute(): { success: boolean; meta: { changes: number } };
  };
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() =>
      (db.query(sql).get(...(values as never[])) as T | null) ?? null,
    execute: () => ({
      success: true,
      meta: { changes: db.query(sql).run(...(values as never[])).changes },
    }),
    run: async () => statement(sql, values).execute(),
  });
  const scanner: D1TransactionalDatabase = {
    prepare: (sql) => statement(sql),
    batch: async (items) =>
      db.transaction(() =>
        items.map((item) => (item as Statement).execute()),
      )(),
  };
  return {
    db,
    journal,
    scanner,
    close() {
      db.close();
      lock.close();
    },
  };
}
export type KeeperStore = ReturnType<typeof openKeeperStore>;
