// spec/fees/conversion.md, "A recorded send without a reservation is imported at its own worst case"; spec/fees/conversion.md, "A token is converted from the wallet's observed balance; native fees only from finalized receipts, and gas top-ups never are"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Options } from "../../gen/fees__conversion.conformance.ts";
import type { Event, Fee } from "../../gen/fees__conversion.ts";
import type { Instance } from "../../src/journal/codec.vibe";
import { journal, send } from "../../src/journal/store.vibe";
import { type GenerationNames, factsFor, generationInstance, generationNames, journalDriver, journalHarness, seedRecorded, senderOf } from "../support/journal.ts";

const harness = await journalHarness("fee-conversion-conformance");
const { clock, runtime } = harness;

let generation = 0;
let instance: Instance = generationInstance(generation);
let names: GenerationNames = generationNames(generation);
let elapsed = 0;

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
  await seedRecorded({ db: harness.db, instance, names, runId, token, recorded: event.recorded, now: new Date(instance.epoch + elapsed).toISOString() });
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

export const driver = journalDriver<Event, Fee>(harness, { reset: begin, dispatch, observe });

export const options: Options = { keys: ["journal"], walks: 5, steps: 12 };
