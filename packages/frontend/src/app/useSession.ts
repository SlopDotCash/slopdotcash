// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out"
import { Cause, Effect, Exit } from "effect";
import { useSyncExternalStore } from "react";
import type { SessionView } from "../session/session.vibe";
import { type PageRuntime, type SessionShown, watchSession } from "./runtime.vibe";
import { keepsShownSession } from "./sessionView.ts";

interface Snapshot {
  readonly shown?: SessionShown;
  readonly cause?: Cause.Cause<unknown>;
}

interface Store {
  readonly get: () => Snapshot;
  readonly subscribe: (notify: () => void) => () => void;
}

const stores = new WeakMap<PageRuntime, Store>();

const settled = (prior: SessionView | undefined, next: SessionView) => (prior !== undefined && keepsShownSession(prior.status, next.status) ? prior : next);

function storeFor(runtime: PageRuntime): Store {
  const known = stores.get(runtime);
  if (known) return known;
  let seen: Snapshot = {};
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    seen = next;
    for (const listener of listeners) listener();
  };
  const show = (shown: SessionShown) => Effect.sync(() => publish({ shown: { ...shown, view: settled(seen.shown?.view, shown.view) } }));
  const store: Store = {
    get: () => seen,
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop) {
        const fiber = runtime.runFork(watchSession(show));
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
  stores.set(runtime, store);
  return store;
}

export function useSession(runtime: PageRuntime): SessionShown | undefined {
  const store = storeFor(runtime);
  const { shown, cause } = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (cause) throw Cause.squash(cause);
  return shown;
}

export function loginHrefFor(shown: SessionShown, next: string): string {
  return Effect.runSync(shown.deployment.loginHref(next));
}
