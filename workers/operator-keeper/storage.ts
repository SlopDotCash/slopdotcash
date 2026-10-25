import solanaScanSchema from "../../migrations/0012_solana_scan_backlog.sql" with {
  type: "text",
};
import {
  initializeKeeperSchema,
  type KeeperDatabase,
  type KeeperValue,
  keeperStorage,
} from "../../scripts/payment-keeper/storage";

export interface OperatorStorage {
  sql: {
    exec<Row = Record<string, unknown>>(
      sql: string,
      ...values: unknown[]
    ): { toArray(): Row[]; rowsWritten: number };
  };
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  transactionSync<T>(callback: () => T): T;
}
function bindings(values: KeeperValue[]) {
  return values.map((value) =>
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "boolean"
        ? Number(value)
        : value,
  );
}
/** One SQLite-backed object owns both the signed attempt and its native-fee liability. */
export function openOperatorKeeperStore(storage: OperatorStorage) {
  const db: KeeperDatabase = {
    exec(sql) {
      storage.sql.exec(sql).toArray();
    },
    query<Row, Params extends KeeperValue[]>(sql: string) {
      return {
        all: (...values: Params) =>
          storage.sql.exec<Row>(sql, ...bindings(values)).toArray(),
        get: (...values: Params) =>
          storage.sql.exec<Row>(sql, ...bindings(values)).toArray()[0] ?? null,
        run(...values: Params) {
          const cursor = storage.sql.exec(sql, ...bindings(values));
          cursor.toArray();
          return { changes: cursor.rowsWritten };
        },
      };
    },
  };
  storage.transactionSync(() => initializeKeeperSchema(db, solanaScanSchema));
  return keeperStorage(
    db,
    (callback) => storage.transaction(callback),
    (callback) => storage.transactionSync(callback),
    () => {},
  );
}
