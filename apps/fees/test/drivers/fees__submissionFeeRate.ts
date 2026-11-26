// spec/fees/submissionFeeRate.md, "The rate pass stores readings and rates only as the rule allows"
import { Effect, Layer, ManagedRuntime } from "effect";
import { SubmissionFeeRatesLive } from "@repo/backend/live";
import { d1 } from "@repo/platform/d1";
import type { Driver, Options } from "../../gen/fees__submissionFeeRate.conformance.ts";
import type { Sender } from "../../gen/fees__runtime.ts";
import type { Event, RateLedger } from "../../gen/fees__submissionFeeRate.ts";
import { officialPool } from "../../src/submissionFee/config.vibe";
import { type RateFact, ledgerAt, send, unstarted } from "../../src/submissionFee/rate.vibe";
import { journalDatabase } from "../support/journal.ts";

interface View {
  readonly mode: RateLedger["mode"];
  readonly clock: number;
  readonly sampledHours: ReadonlyArray<number>;
  readonly rates: ReadonlyArray<number>;
}

const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];

function view(ledger: RateLedger): View {
  return { mode: ledger.mode, clock: ledger.clock, sampledHours: ledger.sampledHours, rates: ledger.rates.map((rate) => rate.effectiveAt) };
}

function factOf(event: Event): RateFact {
  switch (event.type) {
    case "storeReading":
      return { type: "storeReading", slopPerUsd: "75", blockNumber: 1000 };
    case "setRate":
      return { type: "setRate", window: event.window, slopPerUsd: "75" };
    default:
      return event;
  }
}

let opened = 0;

async function fresh() {
  opened += 1;
  const database = await journalDatabase(`fees-submission-fee-rate-driver-${opened}`);
  return { database, runtime: ManagedRuntime.make(Layer.provideMerge(SubmissionFeeRatesLive, d1(database.db))) };
}

let world = await fresh();
let held: RateLedger = unstarted;

async function closed(): Promise<void> {
  await world.runtime.dispose();
  await world.database[Symbol.asyncDispose]();
}

function loaded(): Promise<RateLedger> {
  return world.runtime.runPromise(Effect.map(ledgerAt(held.mode, held.clock), (book) => book.ledger));
}

export const driver: Driver<View> & AsyncDisposable = {
  reset: async () => {
    await closed();
    world = await fresh();
    held = unstarted;
  },
  dispatch: async (_key, event, by) => {
    const sender = senders.find((candidate) => candidate === by) ?? "Other";
    const current = await loaded();
    return world.runtime.runPromise(
      send(current, factOf(event), sender, officialPool.label).pipe(
        Effect.map((sent) => {
          held = sent.ledger;
          return "accepted" as const;
        }),
        Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
      ),
    );
  },
  observe: async () => view(await loaded()),
  [Symbol.asyncDispose]: closed,
};

export const options: Options<View> = { view, keys: ["ledger"], walks: 3, steps: 12 };
