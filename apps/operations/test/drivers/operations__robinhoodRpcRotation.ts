// spec/operations/robinhoodRpcRotation.md, "Story: Rotate the fee converter's Robinhood RPC only to a qualified, independent endpoint from the pinned version"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__robinhoodRpcRotation.conformance.ts";
import type { Event, RobinhoodRotation } from "../../gen/operations__robinhoodRpcRotation.ts";
import { type RotationRun, startRotation } from "../../src/release/rpc/rotate.vibe";

const runs = new Map<string, RotationRun>();

async function runFor(key: string): Promise<RotationRun> {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(startRotation());
  runs.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const run = await runFor(key);
  return Effect.runPromise(run.send(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("RotationRejected", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<RobinhoodRotation> = {
  reset: () => { runs.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await runFor(key)).state()),
};

export const options: Options<RobinhoodRotation> = { keys: ["rotation"], walks: 5, steps: 12 };
