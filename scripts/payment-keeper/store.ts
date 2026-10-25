import { Database } from "bun:sqlite";
import { chmodSync, readFileSync } from "node:fs";
import {
  initializeKeeperSchema,
  type KeeperDatabase,
  type KeeperValue,
  keeperStorage,
} from "./storage";

export type { KeeperStore } from "./storage";

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
