import { Effect } from "effect";
import type { Driver, Options } from "../../gen/frontend__rankedSnapshot.conformance.ts";
import type { Event } from "../../gen/frontend__rankedSnapshot.ts";
import { rankedChecks } from "../../src/reads/snapshot.vibe";

type Checks = Effect.Success<ReturnType<typeof rankedChecks>>;
const fresh = () => Effect.runPromise(rankedChecks());
let current: Checks = await fresh();

export const driver: Driver = {
  reset: async () => {
    current = await fresh();
  },
  dispatch: async (_key, event: Event) => (await Effect.runPromise(Effect.match(current.send(event), { onFailure: () => "refused" as const, onSuccess: () => "accepted" as const }))),
  observe: () => Effect.runPromise(current.get()),
};

export const options: Options = { keys: ["leaderboard"] };
