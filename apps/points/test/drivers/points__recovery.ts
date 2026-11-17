// spec/points/recovery.md, "Story: Resume generation from the complete published journal"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__recovery.conformance.ts";
import type { Machine } from "../../gen/points__recovery.effect.vibe";
import type { Event, Recovery } from "../../gen/points__recovery.ts";
import { recoveryLayer, recoveryReceive, recoverySend, recoveryState } from "../../src/recovery/published.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Recovery, Machine, never>(recoveryLayer(), {
  dispatch: (_key, event) => outcome(recoverySend(event)),
  receive: (_key, raw) => outcome(recoveryReceive(raw)),
  observe: () => recoveryState(),
});

export const options: Options = { keys: ["recovery"] };
