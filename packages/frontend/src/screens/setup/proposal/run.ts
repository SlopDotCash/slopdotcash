// spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
import { Cause, type Effect, Exit, type Fiber, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";

export type Settled<A> = { readonly status: "running" } | { readonly status: "done"; readonly value: A } | { readonly status: "failed"; readonly message: string };

interface Entry {
  shown: Settled<unknown>;
  fiber: Fiber.Fiber<unknown, unknown> | undefined;
  readonly listeners: Set<() => void>;
  readonly subscribe: (notify: () => void) => () => void;
  readonly get: () => Settled<unknown>;
}

const running: Settled<never> = { status: "running" };
const idle = { subscribe: () => () => undefined, get: () => undefined };
const entries = new WeakMap<object, Map<string, Entry>>();

/** @throws {never} */
export function failureMessage(cause: Cause.Cause<unknown>, fallback: string): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== "" ? error.message : fallback;
}

interface Outcome<A> {
  readonly settle?: (value: A) => void;
  readonly fail?: (message: string) => void;
}

function entryOf<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, work: () => Effect.Effect<A, E, R>, fallback: string, { settle, fail }: Outcome<A>): Entry {
  const keyed = entries.get(runtime) ?? new Map<string, Entry>();
  entries.set(runtime, keyed);
  const known = keyed.get(key);
  if (known) return known;
  const publish = (next: Settled<unknown>) => {
    entry.shown = next;
    for (const listener of entry.listeners) listener();
  };
  const entry: Entry = {
    shown: running,
    fiber: undefined,
    listeners: new Set(),
    get: () => entry.shown,
    subscribe: (notify) => {
      if (!keyed.has(key)) keyed.set(key, entry);
      entry.listeners.add(notify);
      if (entry.fiber === undefined && entry.shown.status === "running") {
        const fiber = runtime.runFork(work());
        entry.fiber = fiber;
        fiber.addObserver((exit) => {
          if (entry.fiber !== fiber) return;
          if (Exit.isSuccess(exit)) {
            settle?.(exit.value);
            publish({ status: "done", value: exit.value });
          } else if (!Cause.hasInterruptsOnly(exit.cause)) {
            const message = failureMessage(exit.cause, fallback);
            fail?.(message);
            publish({ status: "failed", message });
          }
        });
      }
      return () => {
        entry.listeners.delete(notify);
        if (entry.listeners.size > 0) return;
        if (entry.shown.status === "running") {
          entry.fiber?.interruptUnsafe();
          entry.fiber = undefined;
        }
        if (keyed.get(key) === entry) keyed.delete(key);
      };
    },
  };
  keyed.set(key, entry);
  return entry;
}

/** The answer of `work` for `key`, run on `runtime` while a component shows it and interrupted, to run again on the next watch, when none does before it settles; `settle` sees each success and `fail` each failure. No key, no work. */
export function useRun<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string | undefined, work: () => Effect.Effect<A, E, R>, fallback: string, outcome: Outcome<A> = {}): Settled<A> | undefined {
  const store = key === undefined ? idle : entryOf(runtime, key, work, fallback, outcome);
  return useSyncExternalStore(store.subscribe, store.get, store.get) as Settled<A> | undefined;
}
