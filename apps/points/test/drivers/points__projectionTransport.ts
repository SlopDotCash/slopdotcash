// spec/points/projectionTransport.md, "Story: Read the published projection without mistaking a reset for a refusal"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__projectionTransport.conformance.ts";
import type { Event, Machine, ProjectionRead } from "../../gen/points__projectionTransport.effect.vibe";
import { transportLayer, transportReceive, transportSend, transportState } from "../../src/recovery/published.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, ProjectionRead, Machine, never>(transportLayer(), {
  dispatch: (_key, event) => outcome(transportSend(event)),
  receive: (_key, raw) => outcome(transportReceive(raw)),
  observe: () => transportState(),
});

export const options: Options = { keys: ["transport"] };
