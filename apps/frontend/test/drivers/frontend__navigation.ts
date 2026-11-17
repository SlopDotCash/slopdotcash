// spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import { ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__navigation.conformance.ts";
import type { Event } from "../../gen/frontend__navigation.ts";
import { navigationMachine, navigationState, receiveNavigation, sendNavigation } from "../../src/session/browserSession.vibe";

let runtime = ManagedRuntime.make(navigationMachine);

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(navigationMachine);
  },
  dispatch: (_key, event: Event) => outcome(sendNavigation(event), runtime),
  receive: (_key, raw) => outcome(receiveNavigation(raw), runtime),
  observe: () => runtime.runPromise(navigationState()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["navigation"], walks: 10, steps: 16 };
