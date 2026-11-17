// spec/points/historicalImport.md, "Story: Release historical rescoring only after it reconciles"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__historicalImport.conformance.ts";
import type { Machine } from "../../gen/points__historicalImport.effect.vibe";
import type { Event, Imports } from "../../gen/points__historicalImport.ts";
import { importsLayer, importsReceive, importsSend, importsState } from "../../src/historicalImport/hold.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Imports, Machine, never>(importsLayer(), {
  dispatch: (_key, event) => outcome(importsSend(event)),
  receive: (_key, raw) => outcome(importsReceive(raw)),
  observe: () => importsState(),
});

export const options: Options = { keys: ["imports"] };
