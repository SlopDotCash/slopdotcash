// spec/fees/submissionFeeReportDeposits.md, "The security area writes and decides the row; the Worker pays it and follows the chain"
import { Layer, ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/fees__submissionFeeReportDeposits.conformance.ts";
import type { Party } from "../../gen/fees__submissionFeeDeposits.ts";
import type { Event, ReportDeposit } from "../../gen/fees__submissionFeeReportDeposits.ts";
import { reportDepositModel } from "../../src/submissionFee/store.vibe";

const parties: ReadonlyArray<Party> = ["Chain", "Slopbot", "Security", "Worker"];
const runtime = ManagedRuntime.make(Layer.empty);
let model = await runtime.runPromise(reportDepositModel());

function partyOf(by: unknown): Party {
  return parties.find((party) => party === by) ?? "Chain";
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    model = await runtime.runPromise(reportDepositModel());
  },
  dispatch: (_key, event: Event, by) => outcome(model.send(event, partyOf(by)), runtime),
  receive: (_key, raw, by) => outcome(model.receive(raw, partyOf(by)), runtime),
  observe: (): Promise<ReportDeposit> => runtime.runPromise(model.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["report"], walks: 10, steps: 16 };
