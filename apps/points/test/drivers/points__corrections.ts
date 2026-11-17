// spec/points/corrections.md, "Story: Reassign the existing pool while preserving funded history"; spec/points/corrections.md, "Story: Apply a reviewed private packet only in full and only under its reviewed digest"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__corrections.conformance.ts";
import type { Machine } from "../../gen/points__corrections.effect.vibe";
import type { Actor, Correction, Event } from "../../gen/points__corrections.ts";
import { correctionLayer, correctionReceive, correctionSend, correctionState } from "../../src/corrections/apply/apply.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Correction, Machine, never>(correctionLayer(), {
  dispatch: (_key, event, by) => outcome(correctionSend(event, by as Actor)),
  receive: (_key, raw, by) => outcome(correctionReceive(raw, by as Actor)),
  observe: () => correctionState(),
});

export const options: Options = { keys: ["correction"] };
