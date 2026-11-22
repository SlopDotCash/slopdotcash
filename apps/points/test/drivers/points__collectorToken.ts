// spec/points/collectorToken.md, "Story: Collect with a read-only App token that outlives its one-hour grant"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/points__collectorToken.conformance.ts";
import type { Machine } from "../../gen/points__collectorToken.effect.vibe";
import type { CollectorRun, Event } from "../../gen/points__collectorToken.ts";
import { collectorRun } from "../../src/ingestion/appToken.vibe";

let runs = new Map<string, Machine.Shape>();

function runOf(key: string): Machine.Shape {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(collectorRun());
  runs.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<CollectorRun, { readonly _tag: string }>) {
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

export const options: Options = { keys: ["release collection", "profile collection"], walks: 25, steps: 16 };
