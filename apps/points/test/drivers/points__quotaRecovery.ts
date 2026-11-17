import { Effect } from "effect";
import type { Driver, Options } from "../../gen/points__quotaRecovery.conformance.ts";
import type { Machine } from "../../gen/points__quotaRecovery.effect.vibe";
import type { Event, Run } from "../../gen/points__quotaRecovery.ts";
import { invocationMachine } from "../../src/quotaRecovery/run.vibe";

const limits = { started: 1_000, budget: 4, durationMs: 180_000 };

let invocations = new Map<string, Machine.Shape>();

function invocationOf(key: string): Machine.Shape {
  const found = invocations.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(invocationMachine(limits));
  invocations.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<Run, { readonly _tag: string }>) {
  const decided = Effect.catch(Effect.as(sent, "accepted" as const), (error) =>
    error._tag === "Rejected" || error._tag === "NotAnEvent" ? Effect.succeed("refused" as const) : Effect.die(error));
  return Effect.runSync(decided);
}

export const driver: Driver = {
  reset: () => {
    invocations = new Map();
  },
  dispatch: (key, event: Event) => outcome(invocationOf(key).send(event)),
  receive: (key, raw) => outcome(invocationOf(key).receive(raw)),
  observe: (key) => Effect.runSync(invocationOf(key).get()),
};

export const options: Options = { keys: ["campaign", "other"], walks: 25, steps: 16 };
