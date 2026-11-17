// spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"; spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"
import { ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__referralSettings.conformance.ts";
import type { Event } from "../../gen/frontend__referralSettings.ts";
import { receiveReferral, referralMachine, referralState, sendReferral } from "../../src/flows/account/referral.vibe";

let runtime = ManagedRuntime.make(referralMachine);

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(referralMachine);
  },
  dispatch: (_key, event: Event) => outcome(sendReferral(event), runtime),
  receive: (_key, raw) => outcome(receiveReferral(raw), runtime),
  observe: () => runtime.runPromise(referralState()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["referral"] };
