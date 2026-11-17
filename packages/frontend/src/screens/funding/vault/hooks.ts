// spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import { useState, useSyncExternalStore } from "react";
import { type TotalsRuntime, type VaultRuntime, type VaultServices, type VaultTotals, type WalletOffer, followTotals, reloadTotals, watchOffers } from "./funding.vibe";

export type Settled<A> = { readonly status: "running" } | { readonly status: "done"; readonly value: A } | { readonly status: "failed"; readonly message: string };

export type Done<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string };

const fallback = "The wallet request failed.";

/** @throws {never} */
export function messageOf(cause: Cause.Cause<unknown>): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== "" ? error.message : fallback;
}

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
  keyed.set(key, entry);
  return entry;
}

/** The answer of `work`, run once on `runtime` for each `key` the first time a component shows it. */
export function useSettled<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, key: string, work: () => Effect.Effect<A, E, R>): Settled<A> {
  const entry = entryOf(runtime, key, work);
  return useSyncExternalStore(entry.subscribe, () => entry.shown, () => entry.shown) as Settled<A>;
}

/** One owner action at a time on a vault: busy while it runs, then its error or its result. */
export function useAction(runtime: VaultRuntime) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const act = async <A, E>(work: Effect.Effect<A, E, VaultServices>, then?: (value: A) => void) => {
    setBusy(true);
    setError("");
    setNotice("");
    const done = await run(runtime, work);
    setBusy(false);
    if (done.ok) then?.(done.value);
    else setError(done.message);
  };
  return { busy, error, notice, setNotice, act };
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

/** The wallets the browser offers now, in discovery order. */
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

/** A project's vault totals, read now and again whenever the oldest one turns stale or the reader returns, keeping the last ones shown while a refresh runs. */
export function useTotals(runtime: TotalsRuntime, projectId: string): VaultTotals | undefined {
  const store = totalsOf(runtime, projectId);
  return useSyncExternalStore(store.subscribe, () => store.shown, () => store.shown);
}

/** Reads a project's vault totals again now. */
export function reloadTotalsOf(runtime: TotalsRuntime, projectId: string): void {
  totalsOf(runtime, projectId).reload();
}
