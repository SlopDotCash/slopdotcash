import { Database } from "bun:sqlite";
import { chmodSync, readFileSync } from "node:fs";
import type { JournalStore } from "../../workers/payment-executor/binding-shared";
import {
  initializeKeeperSchema,
  type KeeperDatabase,
  type KeeperValue,
  keeperStorage,
} from "./storage";

/** One process owns this signer journal. SQLite releases the lock after a crash. */
export function openKeeperStore(file: string) {
  const lock = new Database(`${file}.lock`, { create: true });
  lock.exec("CREATE TABLE IF NOT EXISTS lock(id INTEGER)");
  lock.exec("BEGIN EXCLUSIVE");
  const sqlite = new Database(file, { create: true });
  const db: KeeperDatabase = {
    exec: (sql) => sqlite.exec(sql),
    query<Row, Params extends KeeperValue[]>(sql: string) {
      const statement = sqlite.query<Row, KeeperValue[]>(sql);
      return {
        all: (...values: Params) => statement.all(...values),
        get: (...values: Params) => statement.get(...values),
        run: (...values: Params) => statement.run(...values),
      };
    },
  };
  chmodSync(file, 0o600);
  chmodSync(`${file}.lock`, 0o600);
  db.exec("PRAGMA synchronous=FULL");
  initializeKeeperSchema(
    db,
    readFileSync(
      new URL("../../migrations/0012_solana_scan_backlog.sql", import.meta.url),
      "utf8",
    ),
  );
  let tail = Promise.resolve();
  return keeperStorage(
    db,
    async (callback) => {
      const previous = tail;
      let done!: () => void;
      tail = new Promise<void>((resolve) => {
        done = resolve;
      });
      await previous;
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        done();
      }
    },
    (callback) => sqlite.transaction(callback)(),
    () => {
      sqlite.close();
      lock.close();
    },
  );
}

/**
 * A durable executor journal in one SQLite file, as the hosted Durable Object
 * storage keeps it. Transactions run one at a time.
 */
export function sqliteJournalStore(database: Database): JournalStore {
  database.exec(
    "CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  let gate = Promise.resolve();
  const store: JournalStore = {
    async get<T>(key: string) {
      const row = database
        .query<{ value: string }, [string]>(
          "SELECT value FROM journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      database
        .prepare(
          "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    async transaction<T>(callback: (txn: JournalStore) => Promise<T>) {
      const previous = gate;
      let unlock!: () => void;
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(store);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        unlock();
      }
    },
  };
  return store;
}
