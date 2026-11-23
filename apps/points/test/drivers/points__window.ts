// spec/points/window.md, "Story: Publish one complete window with exact counts"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/points__window.conformance.ts";
import type { Machine } from "../../gen/points__window.effect.vibe";
import type { Event, Window } from "../../gen/points__window.ts";
import { windowRun } from "../../src/window/window.vibe";

let runs = new Map<string, Machine.Shape>();

function runOf(key: string): Machine.Shape {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(windowRun());
  runs.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<Window, { readonly _tag: string }>) {
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

export const options: Options = { keys: ["window", "other"], walks: 25, steps: 14 };
