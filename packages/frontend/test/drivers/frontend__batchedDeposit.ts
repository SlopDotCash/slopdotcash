// spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Wallet references identify later lookups and uncertainty preserves the intent"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__batchedDeposit.conformance.ts";
import type { Event } from "../../gen/frontend__batchedDeposit.ts";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";
import { batchFlow } from "../../src/wallets/owner/batchedDeposit.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key) };
}

const fresh = () => Effect.runPromise(batchFlow(memoryStorage(), "slop:vault-action:v1:base-mainnet:0xvault:0xasset"));
let flow = await fresh();

export const driver: Driver = {
  reset: async () => {
    flow = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(flow.machine.send(event, Number(by ?? 0))),
  receive: (_key, raw, by) => outcome(flow.machine.receive(raw, Number(by ?? 0))),
  observe: () => Effect.runPromise(flow.machine.get()),
};

export const options: Options = { keys: ["batch"], walks: 10, steps: 16 };
