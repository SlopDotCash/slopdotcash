// spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Cause, type Effect, Exit, type Fiber, type ManagedRuntime } from "effect";
import { useRef, useState, useSyncExternalStore } from "react";

export type Settled<A> =
  | { readonly status: "running" }
  | { readonly status: "done"; readonly value: A }
  | { readonly status: "failed"; readonly message: string };

export type Done<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string };

const defaultFallback = "The request failed. Try again.";
const MAX_CACHE_ENTRIES = 64;

export function messageOf(cause: Cause.Cause<unknown>, fallback = defaultFallback): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== ""
    ? error.message
    : fallback;
}

export async function run<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  work: Effect.Effect<A, E, R>,
  fallback = defaultFallback,
): Promise<Done<A>> {
  const exit = await runtime.runPromiseExit(work);
  return Exit.isSuccess(exit) ? { ok: true, value: exit.value } : { ok: false, message: messageOf(exit.cause, fallback) };
}

interface Entry {
  shown: Settled<unknown>;
  started: boolean;
  fiber: Fiber.Fiber<unknown, unknown> | undefined;
  readonly listeners: Set<() => void>;
  readonly subscribe: (notify: () => void) => () => void;
  readonly restart: () => void;
}

const entries = new WeakMap<object, Map<string, Entry>>();

function newEntry<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  work: () => Effect.Effect<A, E, R>,
  interruptOnUnsubscribe: boolean,
): Entry {
  const notifyAll = () => {
    for (const listener of entry.listeners) listener();
  };

  const start = () => {
    entry.started = true;
    const fiber = runtime.runFork(work());
    entry.fiber = fiber;
    fiber.addObserver((exit) => {
      if (entry.fiber !== fiber) return;
      entry.fiber = undefined;
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return;
      entry.shown = Exit.isSuccess(exit)
        ? { status: "done", value: exit.value }
        : { status: "failed", message: messageOf(exit.cause) };
      notifyAll();
    });
  };

  const entry: Entry = {
    shown: { status: "running" },
    started: false,
    fiber: undefined,
    listeners: new Set(),
    subscribe: (notify) => {
      entry.listeners.add(notify);
      if (!entry.started) start();
      return () => {
        entry.listeners.delete(notify);
        if (interruptOnUnsubscribe && entry.listeners.size === 0 && entry.fiber !== undefined) {
          const active = entry.fiber;
          entry.fiber = undefined;
          entry.started = false;
          active.interruptUnsafe();
        }
      };
    },
    restart: () => {
      if (entry.fiber !== undefined) {
        const active = entry.fiber;
        entry.fiber = undefined;
        active.interruptUnsafe();
      }
      entry.shown = { status: "running" };
      entry.started = false;
      notifyAll();
      if (entry.listeners.size > 0) start();
    },
  };
  return entry;
}

function entryOf<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  key: string,
  work: () => Effect.Effect<A, E, R>,
): Entry {
  let keyed = entries.get(runtime);
  if (keyed === undefined) {
    keyed = new Map<string, Entry>();
    entries.set(runtime, keyed);
  }
  const known = keyed.get(key);
  if (known !== undefined) {
    keyed.delete(key);
    keyed.set(key, known);
    return known;
  }
  if (keyed.size >= MAX_CACHE_ENTRIES) {
    const oldest = keyed.keys().next().value;
    if (oldest !== undefined) {
      const evicted = keyed.get(oldest);
      evicted?.fiber?.interruptUnsafe();
      keyed.delete(oldest);
    }
  }
  const entry = newEntry(runtime, work, false);
  keyed.set(key, entry);
  return entry;
}

function useShown<A>(entry: Entry): Settled<A> {
  return useSyncExternalStore(entry.subscribe, () => entry.shown, () => entry.shown) as Settled<A>;
}

export function useOnce<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  key: string,
  work: () => Effect.Effect<A, E, R>,
): Settled<A> {
  return useShown(entryOf(runtime, key, work));
}

export function retryOnce(runtime: object, key: string): void {
  entries.get(runtime)?.get(key)?.restart();
}

export function useMounted<A, E, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  work: () => Effect.Effect<A, E, R>,
): Settled<A> {
  const [entry] = useState(() => newEntry(runtime, work, true));
  return useShown(entry);
}

export function useAction<R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, fallback = defaultFallback) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const running = useRef(false);

  const act = async <A, E>(work: Effect.Effect<A, E, R>, then?: (value: A) => void) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const done = await run(runtime, work, fallback);
    running.current = false;
    setBusy(false);
    if (done.ok) then?.(done.value);
    else setError(done.message);
  };

  return { busy, error, notice, setNotice, act };
}

export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
