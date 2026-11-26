// spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"; spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"
import { type Effect, Layer, ManagedRuntime } from "effect";
import { useState, useSyncExternalStore } from "react";
import { Machine } from "../../../gen/frontend__feePages.effect.vibe";
import { useMachine } from "../../../gen/frontend__feePages.react.ts";
import { run, useAction, useOnce } from "../../app/hooks.ts";
import { useView } from "../account/useView.ts";
import { pageHidden } from "../funding/vault/pageVisibility.ts";
import type { FeePay, FeeShown, PayAddress } from "./payFlow.vibe";
import { type FeeRuntime, type FeeServices, followFeePage, openFeePage } from "./runtime.vibe";

export function useOpened(runtime: FeeRuntime, address: PayAddress) {
  return useOnce(runtime, JSON.stringify(address), () => openFeePage(address));
}

interface Bound {
  readonly machine: ManagedRuntime.ManagedRuntime<Machine, never>;
  readonly watch: (show: (shown: FeeShown) => Effect.Effect<void>) => Effect.Effect<void, never, FeeServices>;
  readonly subscribe: (notify: () => void) => () => void;
}

function bind(runtime: FeeRuntime, pay: FeePay): Bound {
  const told = () => void run(runtime, pay.tabHidden(pageHidden()));
  return {
    machine: ManagedRuntime.make(Layer.succeed(Machine, pay.machine)),
    watch: (show) => followFeePage(pay, show),
    subscribe: (notify) => {
      if (typeof document === "undefined") return () => {};
      const changed = () => {
        told();
        notify();
      };
      document.addEventListener("visibilitychange", changed);
      told();
      return () => document.removeEventListener("visibilitychange", changed);
    },
  };
}

export function usePay(runtime: FeeRuntime, pay: FeePay) {
  const [bound] = useState(() => bind(runtime, pay));
  const { state } = useMachine(bound.machine);
  const shown = useView(runtime, bound.watch);
  useSyncExternalStore(bound.subscribe, pageHidden, () => false);
  return { state, shown };
}

export function useAct(runtime: FeeRuntime) {
  const { busy, error, act } = useAction<FeeServices>(runtime);
  return { busy, error, act };
}
