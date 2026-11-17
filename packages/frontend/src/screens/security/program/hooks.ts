// spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Cause, type Effect, Exit, type ManagedRuntime } from "effect";
import { useState, useSyncExternalStore } from "react";

export type Settled<A> = { readonly status: "running" } | { readonly status: "done"; readonly value: A } | { readonly status: "failed"; readonly message: string };

export type Done<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string };

const fallback = "The request failed. Try again.";

function messageOf(cause: Cause.Cause<unknown>): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== "" ? error.message : fallback;
}

/** Runs `work` on `runtime` and answers its value or the message of what stopped it. @throws {never} */
export async function run<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, work: Effect.Effect<A, E, R>): Promise<Done<A>> {
  const exit = await runtime.runPromiseExit(work);
  return Exit.isSuccess(exit) ? { ok: true, value: exit.value } : { ok: false, message: messageOf(exit.cause) };
}

interface Entry {
  shown: Settled<unknown>;
  started: boolean;
  readonly listeners: Set<() => void>;
  readonly subscribe: (notify: () => void) => () => void;
}

const entries = new WeakMap<object, Map<string, Entry>>();

function entryOf<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, work: () => Effect.Effect<A, E, R>): Entry {
  const keyed = entries.get(runtime) ?? new Map<string, Entry>();
  entries.set(runtime, keyed);
  const known = keyed.get(key);
  if (known) return known;
  const entry = newEntry(runtime, work);
  keyed.set(key, entry);
  return entry;
}

function newEntry<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, work: () => Effect.Effect<A, E, R>): Entry {
  const entry: Entry = {
    shown: { status: "running" },
    started: false,
    listeners: new Set(),
    subscribe: (notify) => {
      entry.listeners.add(notify);
      if (!entry.started) {
        entry.started = true;
        void run(runtime, work()).then((done) => {
          entry.shown = done.ok ? { status: "done", value: done.value } : { status: "failed", message: done.message };
          for (const listener of entry.listeners) listener();
        });
      }
      return () => entry.listeners.delete(notify);
    },
  };
  return entry;
}

function useShown<A>(entry: Entry): Settled<A> {
  return useSyncExternalStore(entry.subscribe, () => entry.shown, () => entry.shown) as Settled<A>;
}

/** The answer of `work`, run once on `runtime` for each `key` the first time a component shows it. */
export function useOnce<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, work: () => Effect.Effect<A, E, R>): Settled<A> {
  return useShown(entryOf(runtime, key, work));
}

/** The answer of `work`, run afresh for each mounted component and kept by nothing that outlives it. */
export function useMounted<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, work: () => Effect.Effect<A, E, R>): Settled<A> {
  const [entry] = useState(() => newEntry(runtime, work));
  return useShown(entry);
}
