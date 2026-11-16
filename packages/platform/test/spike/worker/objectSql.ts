// Durable Object SQLite: one synchronous transaction around an Effect program's Exit.
import { Exit } from "effect";
import type { SqlValue } from "../../../src/bindings.ts";
import type { DurableObjectStorage } from "../bindings.ts";

const rollback = Symbol("rollback");

/** Runs `run` inside `transactionSync`; a failed Exit throws inside the callback, so SQLite rolls every write back. */
/** @throws {never} */
export function transactionally<A, E>(storage: DurableObjectStorage, run: () => Exit.Exit<A, E>): Exit.Exit<A, E> {
  let outcome: Exit.Exit<A, E> = Exit.die(new Error("transaction did not run"));
  try {
    storage.transactionSync(() => {
      outcome = run();
      if (Exit.isFailure(outcome)) throw rollback;
    });
  } catch (error) {
    if (error !== rollback) return Exit.die(error);
  }
  return outcome;
}

/** @throws {Error} */
export function execute(storage: DurableObjectStorage, text: string, params: ReadonlyArray<SqlValue>): Array<Record<string, unknown>> {
  return storage.sql.exec(text, ...params).toArray();
}
