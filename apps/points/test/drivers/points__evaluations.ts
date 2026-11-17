// spec/points/evaluations.md, "Story: Import reviewed evaluation awards once and recover the retirement incident"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__evaluations.conformance.ts";
import type { Machine } from "../../gen/points__evaluations.effect.vibe";
import type { Event, RetiredAwards } from "../../gen/points__evaluations.ts";
import { retirementLayer, retirementReceive, retirementSend, retirementState } from "../../src/evaluations/retired.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, RetiredAwards, Machine, never>(retirementLayer(), {
  dispatch: (_key, event) => outcome(retirementSend(event)),
  receive: (_key, raw) => outcome(retirementReceive(raw)),
  observe: () => retirementState(),
});

export const options: Options = { keys: ["evaluations"] };
