// spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"
import { Effect } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__ownerVault.conformance.ts";
import type { Event } from "../../gen/frontend__ownerVault.ts";
import { type OwnerVaultPage, ownerVaultPage } from "../../src/wallets/owner/ownerVault.vibe";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key) };
}

const keys = { creation: "slop:vault-setup:v1:conformance", transfer: "slop:vault-action:v1:base-mainnet:0xvault:0xasset" };
const fresh = () => Effect.runPromise(Effect.provide(ownerVaultPage(memoryStorage(), keys, false), webCrypto));
let page: OwnerVaultPage = await fresh();

export const driver: Driver = {
  reset: async () => {
    page = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(page.machine.send(event, Number(by))),
  receive: (_key, raw, by) => outcome(page.machine.receive(raw, Number(by))),
  observe: () => Effect.runPromise(page.machine.get()),
};

export const options: Options = { keys: ["vault"], walks: 10, steps: 20 };
