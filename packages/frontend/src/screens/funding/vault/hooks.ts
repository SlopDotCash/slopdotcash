// spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"
import { Effect, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";
import { type Done, messageOf as baseMessageOf, run as baseRun, type Settled, useAction as useBaseAction, useOnce } from "../../../app/hooks.ts";
import { type TotalsRuntime, type VaultRuntime, type VaultServices, type VaultTotals, type WalletOffer, followTotals, reloadTotals, watchOffers } from "./funding.vibe";
import { pageHidden } from "./pageVisibility.ts";

export type { Done, Settled };

const fallback = "The wallet request failed.";

/** @throws {never} */
export function messageOf(cause: Parameters<typeof baseMessageOf>[0]): string {
  return baseMessageOf(cause, fallback);
}

export function run<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, work: Effect.Effect<A, E, R>): Promise<Done<A>> {
  return baseRun(runtime, work, fallback);
}

export function useSettled<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, work: () => Effect.Effect<A, E, R>): Settled<A> {
  return useOnce(runtime, key, work);
}

export function useAction(runtime: VaultRuntime) {
  return useBaseAction<VaultServices>(runtime, fallback);
}

interface Offers {
  seen: ReadonlyArray<WalletOffer>;
  readonly subscribe: (notify: () => void) => () => void;
}

const offerStores = new WeakMap<VaultRuntime, Offers>();

function offersOf(runtime: VaultRuntime): Offers {
  const known = offerStores.get(runtime);
  if (known) return known;
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const store: Offers = {
    seen: [],
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop) {
        const fiber = runtime.runFork(
          watchOffers((offers) =>
            Effect.sync(() => {
              store.seen = offers;
              for (const listener of listeners) listener();
            }),
          ),
        );
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
  offerStores.set(runtime, store);
  return store;
}

export function useWalletOffers(runtime: VaultRuntime): ReadonlyArray<WalletOffer> {
  const store = offersOf(runtime);
  return useSyncExternalStore(store.subscribe, () => store.seen, () => store.seen);
}

interface Totals {
  shown: VaultTotals | undefined;
  readonly subscribe: (notify: () => void) => () => void;
  readonly reload: () => void;
}

const totalStores = new WeakMap<TotalsRuntime, Totals>();

function totalsOf(runtime: TotalsRuntime, projectId: string): Totals {
  const known = totalStores.get(runtime);
  if (known) return known;
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const publish = (totals: VaultTotals | undefined) => {
    store.shown = totals;
    for (const listener of listeners) listener();
  };
  const store: Totals = {
    shown: undefined,
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop) {
        const fiber = runtime.runFork(followTotals(projectId, (totals) => Effect.sync(() => publish(totals))));
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
    reload: () => {
      void run(runtime, reloadTotals()).then((done) => {
        if (done.ok) publish(done.value);
      });
    },
  };
  totalStores.set(runtime, store);
  return store;
}

export function useTotals(runtime: TotalsRuntime, projectId: string): VaultTotals | undefined {
  const store = totalsOf(runtime, projectId);
  return useSyncExternalStore(store.subscribe, () => store.shown, () => store.shown);
}

export function reloadTotalsOf(runtime: TotalsRuntime, projectId: string): void {
  totalsOf(runtime, projectId).reload();
}

interface Visibility {
  readonly subscribe: (notify: () => void) => () => void;
}

const visibilityStores = new WeakMap<object, Visibility>();

function visibilityOf<E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, tell: (hidden: boolean) => Effect.Effect<unknown, E, R>): Visibility {
  const known = visibilityStores.get(runtime);
  if (known) return known;
  const listeners = new Set<() => void>();
  const changed = () => {
    void run(runtime, tell(pageHidden()));
    for (const listener of listeners) listener();
  };
  const store: Visibility = {
    subscribe: (notify) => {
      if (listeners.size === 0 && typeof document !== "undefined") {
        document.addEventListener("visibilitychange", changed);
        void run(runtime, tell(pageHidden()));
      }
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0 && typeof document !== "undefined") document.removeEventListener("visibilitychange", changed);
      };
    },
  };
  visibilityStores.set(runtime, store);
  return store;
}

export function useTabHidden<E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, tell: (hidden: boolean) => Effect.Effect<unknown, E, R>): boolean {
  const store = visibilityOf(runtime, tell);
  return useSyncExternalStore(store.subscribe, pageHidden, () => false);
}
