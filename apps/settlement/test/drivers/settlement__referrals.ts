// spec/settlement/referrals.md, "Program configuration starts off and posting requires independent activation"; spec/settlement/referrals.md, "Posting requires every recorded activation fact"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/settlement__referrals.conformance.ts";
import type { Event } from "../../gen/settlement__referrals.ts";
import { type ControlStep, controlled, receiveControl } from "../../src/referrals/config.vibe";

let history: ReadonlyArray<ControlStep> = [];

const sender = (by: unknown) => (typeof by === "string" ? by : "");

export const driver: Driver = {
  reset: () => {
    history = [];
  },
  dispatch: async (_key, event: Event, by) => {
    const step: ControlStep = { event, by: sender(by) };
    const result = await outcome(controlled([...history, step]));
    if (result === "accepted") history = [...history, step];
    return result;
  },
  receive: async (_key, raw, by) => {
    const result = await outcome(receiveControl(history, raw, sender(by)));
    if (result === "accepted") history = [...history, (await Effect.runPromise(receiveControl(history, raw, sender(by)))).step];
    return result;
  },
  observe: () => Effect.runPromise(controlled(history)),
};

export const options: Options = { keys: ["program"] };
