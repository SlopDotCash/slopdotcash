// spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"
import { Effect } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__ownerMonthly.conformance.ts";
import type { Event } from "../../gen/frontend__ownerMonthly.ts";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";
import { ownerMonthlyPage } from "../../src/wallets/owner/ownerMonthly.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key) };
}

const keys = { commitment: "slop:award-commitment:v2:conformance:2026-10", setting: "slop:vault-monthly:v1:base-mainnet:0xvault", release: "slop:monthly-release:v1:conformance:2026-10" };
const fresh = () => Effect.runPromise(Effect.provide(ownerMonthlyPage(memoryStorage(), keys, "conformance", "2026-10"), webCrypto));
let page = await fresh();

export const driver: Driver = {
  reset: async () => {
    page = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(page.machine.send(event, Number(by))),
  receive: (_key, raw, by) => outcome(page.machine.receive(raw, Number(by))),
  observe: () => Effect.runPromise(page.machine.get()),
};

export const options: Options = { keys: ["month"], walks: 10, steps: 20 };
