// spec/operations/stagingOrder.md, "Story: Allow staging publication only from one complete, fresh history read"; spec/operations/stagingOrder.md, "A quota refusal is retried once, from scratch, only when the wait ends inside the shared deadline"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__stagingOrder.conformance.ts";
import type { Event, StagingOrder } from "../../gen/operations__stagingOrder.ts";
import { type StagingOrderRecord, startStagingOrder } from "../../src/release/run/stagingOrder.vibe";

const checks = new Map<string, StagingOrderRecord>();

async function checkFor(key: string): Promise<StagingOrderRecord> {
  const found = checks.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(startStagingOrder());
  checks.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const check = await checkFor(key);
  return Effect.runPromise(check.send(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("StagingOrderRefused", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<StagingOrder> = {
  reset: () => { checks.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await checkFor(key)).state()),
};

export const options: Options<StagingOrder> = { keys: ["check"], walks: 5, steps: 12 };
