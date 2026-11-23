// spec/frontend/requestedRepos.md, "A board read keeps a ready board on screen and a failed one offers Try again"; spec/frontend/requestedRepos.md, "One flag, renew or withdraw is in flight per lifetime, a success reloads the board and a refusal changes nothing else"
import { ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__requestedRepos.conformance.ts";
import type { Event } from "../../gen/frontend__requestedRepos.ts";
import { receiveRequested, requestedMachine, requestedState, sendRequested } from "../../src/screens/requested/flow.vibe";

let runtime = ManagedRuntime.make(requestedMachine);

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(requestedMachine);
  },
  dispatch: (_key, event: Event) => outcome(sendRequested(event), runtime),
  receive: (_key, raw) => outcome(receiveRequested(raw), runtime),
  observe: () => runtime.runPromise(requestedState()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["requested"] };
