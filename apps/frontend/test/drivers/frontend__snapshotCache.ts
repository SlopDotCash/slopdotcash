import { Effect } from "effect";
import type { Driver, Options } from "../../gen/frontend__snapshotCache.conformance.ts";
import type { Event } from "../../gen/frontend__snapshotCache.ts";
import { type SharedSnapshot, sharedSnapshot } from "../../src/reads/snapshotCache.vibe";

const fresh = () => Effect.runPromise(sharedSnapshot((key: string) => Effect.succeed(key)));
let current: SharedSnapshot<string, string, never> = await fresh();

export const driver: Driver = {
  reset: async () => {
    current = await fresh();
  },
  dispatch: async (_key, event: Event) => ((await Effect.runPromise(current.dispatch(event))) ? "accepted" : "refused"),
  observe: () => Effect.runPromise(current.machine.get()),
};

export const options: Options = { keys: ["cache"] };
