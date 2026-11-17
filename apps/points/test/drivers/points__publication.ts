// spec/points/publication.md, "Story: Keep published history stable when imports race or fail"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__publication.conformance.ts";
import type { Machine } from "../../gen/points__publication.effect.vibe";
import type { Event, Publication } from "../../gen/points__publication.ts";
import { publicationLayer, publicationReceive, publicationSend, publicationState } from "../../src/publication/publish.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Publication, Machine, never>(publicationLayer(), {
  dispatch: (_key, event) => outcome(publicationSend(event)),
  receive: (_key, raw) => outcome(publicationReceive(raw)),
  observe: () => publicationState(),
});

export const options: Options = { keys: ["publication"] };
