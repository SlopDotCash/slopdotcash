// spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
import { Effect } from "effect";
import { useState, useSyncExternalStore } from "react";
import { run, type Settled } from "../vault/hooks.ts";
import { type AwardsRuntime, type AwardsServices, followAwards, type MonthlyOwnerView, type WalletOffer, watchAwardOffers, watchMonth } from "./awards.vibe";

interface Store<A> {
  shown: A;
  readonly subscribe: (notify: () => void) => () => void;
}

function streamed<A>(initial: A, start: (publish: (value: A) => void) => () => void): Store<A> {
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  const store: Store<A> = {
    shown: initial,
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop)
        stop = start((value) => {
          store.shown = value;
          for (const listener of listeners) listener();
        });
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
  };
  return store;
}

const views = new WeakMap<AwardsRuntime, Store<MonthlyOwnerView | undefined>>();
const offers = new WeakMap<AwardsRuntime, Store<ReadonlyArray<WalletOffer>>>();

/** The month's owner view as the last read, save or finalization returned it; the clock that opens and closes its windows runs while it is shown. */
export function useMonthView(runtime: AwardsRuntime): MonthlyOwnerView | undefined {
  const store =
    views.get(runtime) ??
    streamed<MonthlyOwnerView | undefined>(undefined, (publish) => {
      const fiber = runtime.runFork(watchMonth((view) => Effect.sync(() => publish(view))));
      return () => fiber.interruptUnsafe();
    });
  views.set(runtime, store);
  return useSyncExternalStore(store.subscribe, () => store.shown, () => store.shown);
}

/** The wallets the browser offers now, in discovery order. */
export function useAwardOffers(runtime: AwardsRuntime): ReadonlyArray<WalletOffer> {
  const store =
    offers.get(runtime) ??
    streamed<ReadonlyArray<WalletOffer>>([], (publish) => {
      const fiber = runtime.runFork(watchAwardOffers((seen) => Effect.sync(() => publish(seen))));
      return () => fiber.interruptUnsafe();
    });
  offers.set(runtime, store);
  return useSyncExternalStore(store.subscribe, () => store.shown, () => store.shown);
}

interface Following {
  account: number | undefined;
  shown: Settled<MonthlyOwnerView | undefined>;
  readonly listeners: Set<() => void>;
  readonly subscribers: Map<number, (notify: () => void) => () => void>;
}

const following = new WeakMap<AwardsRuntime, Following>();

function followingOf(runtime: AwardsRuntime): Following {
  const known = following.get(runtime);
  if (known) return known;
  const made: Following = { account: undefined, shown: { status: "running" }, listeners: new Set(), subscribers: new Map() };
  following.set(runtime, made);
  return made;
}

function publish(entry: Following, shown: Settled<MonthlyOwnerView | undefined>) {
  entry.shown = shown;
  for (const listener of entry.listeners) listener();
}

function subscriberFor(runtime: AwardsRuntime, entry: Following, account: number, githubId: string) {
  const known = entry.subscribers.get(account);
  if (known) return known;
  const subscribe = (notify: () => void) => {
    entry.listeners.add(notify);
    if (entry.account !== account) {
      entry.account = account;
      publish(entry, { status: "running" });
      void run(runtime, followAwards(account, githubId)).then((done) => {
        if (entry.account === account) publish(entry, done.ok ? { status: "done", value: done.value } : { status: "failed", message: done.message });
      });
    }
    return () => entry.listeners.delete(notify);
  };
  entry.subscribers.set(account, subscribe);
  return subscribe;
}

/** Follows the signed-in account on this month's page: each change of account starts a new page lifetime and reads the month again. */
export function useFollowedMonth(runtime: AwardsRuntime, account: number, githubId: string): Settled<MonthlyOwnerView | undefined> {
  const entry = followingOf(runtime);
  return useSyncExternalStore(subscriberFor(runtime, entry, account, githubId), () => entry.shown, () => entry.shown);
}

/** One owner action at a time on the month: busy while it runs, then its error or notice. */
export function useAwardAction(runtime: AwardsRuntime) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const act = async <A, E>(work: Effect.Effect<A, E, AwardsServices>, then?: (value: A) => void): Promise<boolean> => {
    setBusy(true);
    setError("");
    setNotice("");
    const done = await run(runtime, work);
    setBusy(false);
    if (done.ok) then?.(done.value);
    else setError(done.message);
    return done.ok;
  };
  return { busy, error, notice, setNotice, act };
}
