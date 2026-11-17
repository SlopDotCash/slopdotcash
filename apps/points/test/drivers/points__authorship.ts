// spec/points/authorship.md, "Story: Credit the implementation author without rewarding a carrier PR"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__authorship.conformance.ts";
import type { Event, CommitAttribution } from "../../gen/points__authorship.ts";
import { Commits, commits } from "../../src/score/book.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Commits>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, CommitAttribution, Commits, never>(commits, {
  dispatch: (key, event) => outcome(Commits.use((book) => book.send(key, event))),
  receive: (key, raw) => outcome(Commits.use((book) => book.receive(key, raw))),
  observe: (key) => Commits.use((book) => book.get(key)),
});

export const options: Options = { keys: ["commit one", "commit two"] };
