// spec/slopbot/historyReadAhead.md, "Story: Save waiting on the first history pages without changing a decision"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/slopbot__historyReadAhead.conformance.ts";
import type { Machine } from "../../gen/slopbot__historyReadAhead.effect.vibe";
import type { Event, ReadAhead } from "../../gen/slopbot__historyReadAhead.ts";
import { readAheadRun } from "../../src/value/collect/warmup.vibe";

let runs = new Map<string, Machine.Shape>();

function runOf(key: string): Machine.Shape {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(readAheadRun());
  runs.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<ReadAhead, { readonly _tag: string }>) {
  const decided = Effect.catch(Effect.as(sent, "accepted" as const), (error) =>
    error._tag === "Rejected" || error._tag === "NotAnEvent" ? Effect.succeed("refused" as const) : Effect.die(error));
  return Effect.runSync(decided);
}

export const driver: Driver = {
  reset: () => {
    runs = new Map();
  },
  dispatch: (key, event: Event) => outcome(runOf(key).send(event)),
  receive: (key, raw) => outcome(runOf(key).receive(raw)),
  observe: (key) => Effect.runSync(runOf(key).get()),
};

export const options: Options = { keys: ["first", "second"], walks: 25, steps: 16 };
