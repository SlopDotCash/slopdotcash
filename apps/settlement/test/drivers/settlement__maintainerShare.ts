// spec/settlement/maintainerShare.md, "Story: Take the maintainer share out of the monthly amount"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/settlement__maintainerShare.conformance.ts";
import type { Machine } from "../../gen/settlement__maintainerShare.effect.vibe";
import type { Event, ShareMonth } from "../../gen/settlement__maintainerShare.ts";
import { shareMonth } from "../../src/monthly/maintainerShare.vibe";

let months = new Map<string, Machine.Shape>();

function monthOf(key: string): Machine.Shape {
  const found = months.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(shareMonth());
  months.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<ShareMonth, { readonly _tag: string }>) {
  const decided = Effect.catch(Effect.as(sent, "accepted" as const), (error) =>
    error._tag === "Rejected" || error._tag === "NotAnEvent" ? Effect.succeed("refused" as const) : Effect.die(error));
  return Effect.runSync(decided);
}

export const driver: Driver = {
  reset: () => {
    months = new Map();
  },
  dispatch: (key, event: Event, by) => outcome(monthOf(key).send(event, String(by ?? ""))),
  receive: (key, raw, by) => outcome(monthOf(key).receive(raw, String(by ?? ""))),
  observe: (key) => Effect.runSync(monthOf(key).get()),
};

export const options: Options = { keys: ["eliza", "babylon"], walks: 25, steps: 16 };
