// spec/points/reviews.md, "Story: Credit the first five distinct useful reviewers"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__reviews.conformance.ts";
import type { Event, Reviews } from "../../gen/points__reviews.ts";
import { ReviewRecords, reviewRecords } from "../../src/score/book.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, ReviewRecords>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Reviews, ReviewRecords, never>(reviewRecords, {
  dispatch: (key, event) => outcome(ReviewRecords.use((book) => book.send(key, event))),
  receive: (key, raw) => outcome(ReviewRecords.use((book) => book.receive(key, raw))),
  observe: (key) => ReviewRecords.use((book) => book.get(key)),
});

export const options: Options = { keys: ["pull request one", "pull request two"] };
