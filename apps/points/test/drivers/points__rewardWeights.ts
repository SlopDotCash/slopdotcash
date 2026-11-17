// spec/points/rewardWeights.md, "Story: Derive each month's reward weights from accepted work only"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__rewardWeights.conformance.ts";
import type { Machine } from "../../gen/points__rewardWeights.effect.vibe";
import type { Event, MonthlyWeights } from "../../gen/points__rewardWeights.ts";
import { weightsLayer, weightsReceive, weightsSend, weightsState } from "../../src/rewardWeights/weights.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, MonthlyWeights, Machine, never>(weightsLayer(), {
  dispatch: (_key, event) => outcome(weightsSend(event)),
  receive: (_key, raw) => outcome(weightsReceive(raw)),
  observe: () => weightsState(),
});

export const options: Options = { keys: ["month"] };
