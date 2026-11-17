// spec/points/scoringPolicy.md, "Story: Score each accepted source under the policy of its acceptance time"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__scoringPolicy.conformance.ts";
import type { Event, Scored } from "../../gen/points__scoringPolicy.ts";
import { Sources, sources } from "../../src/score/book.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Sources>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Scored, Sources, never>(sources, {
  dispatch: (key, event) => outcome(Sources.use((book) => book.send(key, event))),
  receive: (key, raw) => outcome(Sources.use((book) => book.receive(key, raw))),
  observe: (key) => Sources.use((book) => book.get(key)),
});

export const options: Options = { keys: ["source one", "source two"] };
