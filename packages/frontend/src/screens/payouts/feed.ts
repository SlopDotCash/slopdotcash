// spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";

export interface Fed<A> {
  readonly value: A | undefined;
  readonly settled: boolean;
  readonly failed: boolean;
}

export type Follow<A, E, R> = (publish: (value: A) => Effect.Effect<void>, current: () => A | undefined) => Effect.Effect<void, E, R>;

interface Feed<A> {
  shown: Fed<A>;
  readonly subscribe: (notify: () => void) => () => void;
  readonly restart: () => void;
  readonly publish: (value: A) => void;
}

const feeds = new WeakMap<object, Map<string, Feed<unknown>>>();

function feedOf<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, follow: Follow<A, E, R>): Feed<A> {
  const keyed = feeds.get(runtime) ?? new Map<string, Feed<unknown>>();
  feeds.set(runtime, keyed);
  const known = keyed.get(key) as Feed<A> | undefined;
  if (known) return known;
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  let held = false;
  const show = (next: Fed<A>) => {
    feed.shown = next;
    for (const listener of listeners) listener();
  };
  const start = () => {
    const fiber = runtime.runFork(follow((value) => Effect.sync(() => show({ value, settled: true, failed: false })), () => feed.shown.value));
    fiber.addObserver((exit) => {
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) show({ ...feed.shown, settled: true, failed: true });
    });
    stop = () => fiber.interruptUnsafe();
  };
  const feed: Feed<A> = {
    shown: { value: undefined, settled: false, failed: false },
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop && !held) start();
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
          held = false;
        }
      };
    },
    restart: () => {
      stop?.();
      stop = undefined;
      held = false;
      show({ ...feed.shown, settled: false, failed: false });
      if (listeners.size > 0) start();
    },
    publish: (value) => {
      stop?.();
      stop = undefined;
      held = true;
      show({ value, settled: true, failed: false });
    },
  };
  keyed.set(key, feed as Feed<unknown>);
  return feed;
}

/** What `follow` last published on `runtime` for `key`, kept across a restart until it publishes again; it runs while a component shows it, and `publish` replaces it until the next restart. */
export function useFeed<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, follow: Follow<A, E, R>): Fed<A> & Pick<Feed<A>, "restart" | "publish"> {
  const feed = feedOf(runtime, key, follow);
  const shown = useSyncExternalStore(feed.subscribe, () => feed.shown, () => feed.shown);
  return { ...shown, restart: feed.restart, publish: feed.publish };
}
