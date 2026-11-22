// spec/fees/conversion.md, "A recorded send without a reservation is imported at its own worst case"; spec/fees/conversion.md, "A token is converted from the wallet's observed balance; native fees only from finalized receipts, and gas top-ups never are"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import type { Driver, Options } from "../../gen/fees__conversion.conformance.ts";
import type { Event, Fee } from "../../gen/fees__conversion.ts";
import type { Sender } from "../../gen/fees__runtime.ts";
import type { Instance } from "../../src/journal/codec.vibe";
import { journal, send } from "../../src/journal/store.vibe";
import { type GenerationNames, factsFor, generationInstance, generationNames, journalDatabase, seedRecorded } from "../support/journal.ts";

const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];
const started = await journalDatabase("fee-conversion-conformance");
const clock = settableClock(0);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(started.db), webCrypto, clock.layer));

let generation = 0;
let instance: Instance = generationInstance(generation);
let names: GenerationNames = generationNames(generation);
let elapsed = 0;

function senderOf(by: unknown): Sender {
  return senders.find((sender) => sender === by) ?? "Other";
}

function begin() {
  generation += 1;
  instance = generationInstance(generation);
  names = generationNames(generation);
  elapsed = 0;
  clock.set(instance.epoch);
}

async function recordedHistory(event: Extract<Event, { type: "importRecorded" }>) {
  const book = await runtime.runPromise(journal(instance, names));
  const runId = book.runs.get(event.runId);
  const token = book.tokens[event.recorded.token - 1];
  if (runId === undefined || token === undefined) return;
  await seedRecorded({ db: started.db, instance, names, runId, token, recorded: event.recorded, now: new Date(instance.epoch + elapsed).toISOString() });
}

async function dispatch(event: Event, by: unknown) {
  if (event.type === "importRecorded") await recordedHistory(event);
  const facts = await factsFor(event, names, instance, event.type === "replace" ? await observe() : undefined);
  const sent = send(instance, names, event, senderOf(by), facts).pipe(
    Effect.tap((done) => Effect.sync(() => {
      instance = done.instance;
      if (event.type === "advanceClock") {
        elapsed += event.elapsed;
        clock.set(instance.epoch + elapsed);
      }
    })),
  );
  return outcome(sent, runtime);
}

async function observe(): Promise<Fee> {
  return runtime.runPromise(journal(instance, names).pipe(Effect.map((loaded) => loaded.state)));
}

begin();

export const driver: Driver & AsyncDisposable = {
  reset: () => begin(),
  dispatch: (_key, event, by) => dispatch(event, by),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await started[Symbol.asyncDispose]();
  },
};

export const options: Options = { keys: ["journal"], walks: 5, steps: 12 };
