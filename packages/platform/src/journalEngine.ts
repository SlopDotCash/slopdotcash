// spec/settlement/signer.md, "Both possible winners stay retained"
import { Exit } from "effect";
import type { DurableObjectStorage, SqlValue } from "./bindings.ts";

export type Row = Record<string, unknown>;

export type TransactionalStorage = Pick<DurableObjectStorage, "sql" | "transactionSync">;

export type Settled<A, E> = { readonly kind: "settled"; readonly exit: Exit.Exit<A, E> } | { readonly kind: "unavailable"; readonly message: string };

export interface SqlEngine {
  /** @throws {Error} */
  all(text: string, params: ReadonlyArray<SqlValue>): Row[];
  /** @throws {Error} */
  run(text: string, params: ReadonlyArray<SqlValue>): number;
  /** @throws {never} */
  atomically<A, E>(work: () => Exit.Exit<A, E>): Settled<A, E>;
  /** @throws {never} */
  close(): void;
}

/** @throws {never} */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const rollback = new Error("rollback");

/** @throws {never} */
export function durableEngine(storage: TransactionalStorage): SqlEngine {
  return {
    all: (text, params) => storage.sql.exec(text, ...params).toArray(),
    run: (text, params) => {
      const cursor = storage.sql.exec(text, ...params);
      cursor.toArray();
      return cursor.rowsWritten;
    },
    atomically: <A, E>(work: () => Exit.Exit<A, E>): Settled<A, E> => {
      let exit: Exit.Exit<A, E> | undefined;
      try {
        storage.transactionSync(() => {
          exit = work();
          if (Exit.isFailure(exit)) throw rollback;
        });
      } catch (error) {
        if (error !== rollback) return { kind: "unavailable", message: messageOf(error) };
      }
      return exit === undefined ? { kind: "unavailable", message: "transaction did not run" } : { kind: "settled", exit };
    },
    close: () => undefined,
  };
}

/** @throws {Error} */
export function fileEngine(path: string): SqlEngine {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const { chmodSync } = process.getBuiltinModule("node:fs");
  const lock = new DatabaseSync(`${path}.lock`);
  try {
    lock.exec("CREATE TABLE IF NOT EXISTS lock(id INTEGER)");
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    throw error;
  }
  const database = new DatabaseSync(path);
  const close = () => {
    database.close();
    lock.close();
  };
  const attempt = (statement: string): string | undefined => {
    try {
      database.exec(statement);
      return undefined;
    } catch (error) {
      return messageOf(error);
    }
  };
  try {
    chmodSync(path, 0o600);
    chmodSync(`${path}.lock`, 0o600);
    database.exec("PRAGMA synchronous=FULL");
  } catch (error) {
    close();
    throw error;
  }
  return {
    all: (text, params) => database.prepare(text).all(...params),
    run: (text, params) => Number(database.prepare(text).run(...params).changes),
    atomically: <A, E>(work: () => Exit.Exit<A, E>): Settled<A, E> => {
      const begun = attempt("BEGIN IMMEDIATE");
      if (begun !== undefined) return { kind: "unavailable", message: begun };
      const exit = work();
      const ended = attempt(Exit.isSuccess(exit) ? "COMMIT" : "ROLLBACK");
      if (ended === undefined) return { kind: "settled", exit };
      if (database.isTransaction) attempt("ROLLBACK");
      return { kind: "unavailable", message: ended };
    },
    close,
  };
}
