// spec/frontend/composition.md, "The active draft and navigation share one authenticated actor"; spec/frontend/composition.md, "Account changes erase drafts and preserve every child invariant"
import { ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__composition.conformance.ts";
import type { Event } from "../../gen/frontend__composition.ts";
import { compositionMachine, compositionState, receiveComposition, sendComposition } from "../../src/session/browserSession.vibe";

let runtime = ManagedRuntime.make(compositionMachine);

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(compositionMachine);
  },
  dispatch: (_key, event: Event) => outcome(sendComposition(event), runtime),
  receive: (_key, raw) => outcome(receiveComposition(raw), runtime),
  observe: () => runtime.runPromise(compositionState()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["browser"], walks: 10, steps: 16 };
