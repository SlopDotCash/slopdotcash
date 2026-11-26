// spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";

export type Watch<A, R> = (show: (value: A) => Effect.Effect<void>) => Effect.Effect<void, never, R>;

interface Snapshot<A> {
  readonly value?: A;
  readonly cause?: Cause.Cause<unknown>;
}

interface Store<A> {
  readonly get: () => Snapshot<A>;
  readonly subscribe: (notify: () => void) => () => void;
}

const stores = new WeakMap<object, Map<unknown, Store<unknown>>>();

function storeFor<A, R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>, watch: Watch<A, R>): Store<A> {
  const byWatch = stores.get(runtime) ?? new Map<unknown, Store<unknown>>();
  stores.set(runtime, byWatch);
  const known = byWatch.get(watch);
  if (known) return known as Store<A>;
  let seen: Snapshot<A> = {};
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot<A>) => {
    seen = next;
    for (const listener of listeners) listener();
  };
  const store: Store<A> = {
    get: () => seen,
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop) {
        const fiber = runtime.runFork(watch((value) => Effect.sync(() => publish({ value }))));
        fiber.addObserver((exit) => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) publish({ ...seen, cause: exit.cause });
        });
        stop = () => fiber.interruptUnsafe();
      }
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
  };
  byWatch.set(watch, store);
  return store;
}

/** The latest value a service publishes through `watch` in `runtime`; a failure that stops it reaches the error boundary. */
export function useView<A, R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>, watch: Watch<A, R>): A | undefined {
  const store = storeFor(runtime, watch);
  const { value, cause } = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (cause) throw Cause.squash(cause);
  return value;
}
