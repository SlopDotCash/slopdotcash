// spec/settlement/contributorAllocation.md, "An unpublished distribution exposes no recipient row"; spec/settlement/contributorAllocation.md, "A timely first wallet confirmation survives replacement"; spec/settlement/contributorAllocation.md, "Only the owner sender records the single transaction"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/settlement__contributorAllocation.conformance.ts";
import type { Event } from "../../gen/settlement__contributorAllocation.ts";
import { type AllocationStep, receivedStep, replayed } from "../../src/client/contributorAllocation.vibe";

const histories = new Map<string, ReadonlyArray<AllocationStep>>();
const historyOf = (key: string) => histories.get(key) ?? [];
const sender = (by: unknown) => (typeof by === "string" ? by : "");

export const driver: Driver = {
  reset: () => {
    histories.clear();
  },
  dispatch: async (key, event: Event, by) => {
    const step: AllocationStep = { event, by: sender(by) };
    const result = await outcome(replayed([...historyOf(key), step]));
    if (result === "accepted") histories.set(key, [...historyOf(key), step]);
    return result;
  },
  receive: async (key, raw, by) => {
    const result = await outcome(receivedStep(historyOf(key), raw, sender(by)));
    if (result === "accepted") histories.set(key, [...historyOf(key), (await Effect.runPromise(receivedStep(historyOf(key), raw, sender(by)))).step]);
    return result;
  },
  observe: (key) => Effect.runPromise(replayed(historyOf(key))),
};

export const options: Options = { keys: ["recipient", "other"] };
