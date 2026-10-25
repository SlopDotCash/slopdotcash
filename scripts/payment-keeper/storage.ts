import type { D1Statement, D1TransactionalDatabase } from "../../backend/d1";
import type { JournalStore } from "../../workers/payment-executor/core";

export type KeeperValue =
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | null;
export interface KeeperDatabase {
  exec(sql: string): unknown;
  query<Row = unknown, Params extends KeeperValue[] = KeeperValue[]>(
    sql: string,
  ): {
    all(...values: Params): Row[];
    get(...values: Params): Row | null;
    run(...values: Params): { changes: number };
  };
}
export interface KeeperStore {
  db: KeeperDatabase;
  journal: JournalStore;
  scanner: D1TransactionalDatabase;
  close(): void;
}

/** Both operator runtimes retain the same journal, budget and scanner schema. */
export function initializeKeeperSchema(
  db: KeeperDatabase,
  solanaScanSchema: string,
) {
  db.exec(`CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS awards(scope TEXT NOT NULL,id TEXT NOT NULL,actor TEXT NOT NULL,reserve TEXT NOT NULL,payment TEXT,checked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,id)) STRICT;
    CREATE TABLE IF NOT EXISTS gas(id TEXT PRIMARY KEY,day TEXT NOT NULL,maximum TEXT NOT NULL,transaction_id TEXT NOT NULL,actual TEXT,settled_day TEXT,expiry_evidence TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS payment_chain_cursors(project_id TEXT NOT NULL,network TEXT NOT NULL,position TEXT NOT NULL,synced_at TEXT NOT NULL,PRIMARY KEY(project_id,network)) STRICT;`);
  if (
    !db
      .query<{ name: string }, []>("PRAGMA table_info(gas)")
      .all()
      .some((column) => column.name === "expiry_evidence")
  )
    db.exec("ALTER TABLE gas ADD COLUMN expiry_evidence TEXT");
  if (
    !db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='payment_solana_scans'",
      )
      .get()
  )
    db.exec(solanaScanSchema);
}

/** The host must include every db write in the async journal transaction, including gas reserves. */
export function keeperStorage(
  db: KeeperDatabase,
  transaction: <T>(callback: () => Promise<T>) => Promise<T>,
  atomic: <T>(callback: () => T) => T,
  close: () => void,
): KeeperStore {
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
  const journal: JournalStore = {
    ...raw,
    transaction: (callback) => transaction(() => callback(raw)),
  };
  type Statement = D1Statement & {
    execute(): { success: boolean; meta: { changes: number } };
  };
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...next) => statement(sql, next),
    first: async <T>() =>
      db.query(sql).get(...(values as KeeperValue[])) as T | null,
    execute: () => ({
      success: true,
      meta: {
        changes: db.query(sql).run(...(values as KeeperValue[])).changes,
      },
    }),
    run: async () => statement(sql, values).execute(),
  });
  const scanner: D1TransactionalDatabase = {
    prepare: (sql) => statement(sql),
    batch: async (items) =>
      atomic(() => items.map((item) => (item as Statement).execute())),
  };
  return { db, journal, scanner, close };
}
