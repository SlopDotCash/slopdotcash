// spec/points/ingestion.md, "Story: Read GitHub without retrying writes or inventing success"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/points__ingestion.conformance.ts";
import type { Machine } from "../../gen/points__ingestion.effect.vibe";
import type { Event, Read } from "../../gen/points__ingestion.ts";
import { ingestionRun } from "../../src/ingestion/read.vibe";

const deadline = 1_000_000;

let reads = new Map<string, Machine.Shape>();

function readOf(key: string): Machine.Shape {
  const found = reads.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(Effect.flatMap(ingestionRun(deadline), (run) => run.next(0)));
  reads.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<Read, { readonly _tag: string }>) {
  const decided = Effect.catch(Effect.as(sent, "accepted" as const), (error) =>
    error._tag === "Rejected" || error._tag === "NotAnEvent" ? Effect.succeed("refused" as const) : Effect.die(error));
  return Effect.runSync(decided);
}

export const driver: Driver = {
  reset: () => {
    reads = new Map();
  },
  dispatch: (key, event: Event) => outcome(readOf(key).send(event)),
  receive: (key, raw) => outcome(readOf(key).receive(raw)),
  observe: (key) => Effect.runSync(readOf(key).get()),
};

export const options: Options = { keys: ["read", "other"], walks: 25, steps: 14 };
