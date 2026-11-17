import { Effect } from "effect";
import type { Driver, Options } from "../../gen/frontend__requests.conformance.ts";
import type { Event } from "../../gen/frontend__requests.ts";
import { type Resource, resource } from "../../src/reads/resource.vibe";

const fresh = () => Effect.runPromise(resource((key: string) => Effect.succeed(key), (value: string) => value.length));
let current: Resource<string> = await fresh();

export const driver: Driver = {
  reset: async () => {
    current = await fresh();
  },
  dispatch: async (_key, event: Event) => ((await Effect.runPromise(current.dispatch(event))) ? "accepted" : "refused"),
  observe: () => Effect.runPromise(current.machine.get()),
};

export const options: Options = { keys: ["resource"] };
