// spec/fees/submissionFeeDeposits.md, "A deposit is recorded once confirmed and final once finalized, and a reorganised one stops paying"
import { Layer, ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/fees__submissionFeeDeposits.conformance.ts";
import type { Event, FeeDeposit, Party } from "../../gen/fees__submissionFeeDeposits.ts";
import { depositModel } from "../../src/submissionFee/store.vibe";

const parties: ReadonlyArray<Party> = ["Chain", "Slopbot", "Security", "Worker"];
const runtime = ManagedRuntime.make(Layer.empty);
let model = await runtime.runPromise(depositModel());

function partyOf(by: unknown): Party {
  return parties.find((party) => party === by) ?? "Chain";
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    model = await runtime.runPromise(depositModel());
  },
  dispatch: (_key, event: Event, by) => outcome(model.send(event, partyOf(by)), runtime),
  receive: (_key, raw, by) => outcome(model.receive(raw, partyOf(by)), runtime),
  observe: (): Promise<FeeDeposit> => runtime.runPromise(model.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["deposit"], walks: 10, steps: 16 };
