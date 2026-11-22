// spec/operations/dailyCollection.md, "Story: Keep published contribution data fresh without a person watching it"; spec/operations/dailyCollection.md, "A daily tick starts one fresh collection only when none runs"; spec/operations/dailyCollection.md, "A superseded collection is published by a retained-data release at most three times and never replaces newer data"; spec/operations/dailyCollection.md, "A failed collection with a checkpoint is resumed once, never a resume of a resume"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__dailyCollection.conformance.ts";
import type { DailyCollection, Event } from "../../gen/operations__dailyCollection.ts";
import { dailyMachine } from "../../src/release/daily/controller.vibe";

type Daily = Effect.Success<ReturnType<typeof dailyMachine>>;

const machines = new Map<string, Daily>();

async function machineFor(key: string): Promise<Daily> {
  const found = machines.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(dailyMachine());
  machines.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const daily = await machineFor(key);
  return Effect.runPromise(daily.send(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<DailyCollection> = {
  reset: () => { machines.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await machineFor(key)).get()),
};

export const options: Options<DailyCollection> = { keys: ["daily"], walks: 5, steps: 12 };
