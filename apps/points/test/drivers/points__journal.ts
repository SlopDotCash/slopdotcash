// spec/points/journal.md, "Story: Preserve accepted work and correct unpaid attribution"
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/points__journal.conformance.ts";
import type { Machine } from "../../gen/points__journal.effect.vibe";
import type { Event, Ledger } from "../../gen/points__journal.ts";
import { ledgerLayer, ledgerReceive, ledgerSend, ledgerState } from "../../src/journal/ledger.vibe";

const refused = () => Effect.succeed("refused" as const);
const outcome = <A, E extends { readonly _tag: string }>(sent: Effect.Effect<A, E, Machine>) =>
  sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: refused, NotAnEvent: refused }));

export const driver = effectDriver<Event, Ledger, Machine, never>(ledgerLayer(), {
  dispatch: (_key, event) => outcome(ledgerSend(event)),
  receive: (_key, raw) => outcome(ledgerReceive(raw)),
  observe: () => ledgerState(),
});

export const options: Options = { keys: ["journal"] };
