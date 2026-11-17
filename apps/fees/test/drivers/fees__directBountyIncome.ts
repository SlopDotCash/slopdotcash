// spec/fees/directBountyIncome.md, "Story: Distinguish funds received from income booked for a completed direct award"
import { Layer, ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/fees__directBountyIncome.conformance.ts";
import type { Event, FeeJournal, Reader } from "../../gen/fees__directBountyIncome.ts";
import { feeJournal } from "../../src/directIncome/store.vibe";

const readers: ReadonlyArray<Reader> = ["SettlementJournal", "OtherReader"];
const runtime = ManagedRuntime.make(Layer.empty);
let journal = await runtime.runPromise(feeJournal());

function readerOf(by: unknown): Reader {
  return readers.find((reader) => reader === by) ?? "OtherReader";
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    journal = await runtime.runPromise(feeJournal());
  },
  dispatch: (_key, event: Event, by) => outcome(journal.send(event, readerOf(by)), runtime),
  receive: (_key, raw, by) => outcome(journal.receive(raw, readerOf(by)), runtime),
  observe: (): Promise<FeeJournal> => runtime.runPromise(journal.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["journal"], walks: 10, steps: 12 };
