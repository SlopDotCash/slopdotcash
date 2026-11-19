// spec/slopbot/intakeHistory.md, "Story: Report a bounded, unsampled and stable projection of retained intake failures"
import { Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/slopbot__intakeHistory.conformance.ts";
import type { Event } from "../../gen/slopbot__intakeHistory.ts";
import { type HistoryRun, historyState, openHistoryRun, receiveHistory, sendHistory } from "../../src/programs/inspectValueIntakeHistory.vibe";
import { settled } from "../support/settled.ts";

const runtime = ManagedRuntime.make(Layer.empty);

let run: HistoryRun = await runtime.runPromise(openHistoryRun());

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    run = await runtime.runPromise(openHistoryRun());
  },
  dispatch: (_key, event: Event) => settled(sendHistory(run, event), runtime),
  receive: (_key, raw) => settled(receiveHistory(run, raw), runtime),
  observe: () => runtime.runPromise(historyState(run)),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["inspection"], walks: 10, steps: 20 };
