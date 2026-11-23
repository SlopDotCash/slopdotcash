// spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"; spec/frontend/provisionalVault.md, "Only a finalized deposit in a registered vault is eligible for accounting"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__provisionalVault.conformance.ts";
import type { Event } from "../../gen/frontend__provisionalVault.ts";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";
import { provisionalVault } from "../../src/wallets/owner/provisionalVault.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key) };
}

const review = { codeSha256: "0".repeat(64), implementation: undefined, factory: "0x00000000000000000000000000000000000000fa", feeRecipient: "0x00000000000000000000000000000000000000fe", bindingDelaySeconds: 0n, purpose: "OrdinaryPurpose" as const };
const vault = { network: "base-mainnet", chainId: 8453n, vault: "0x00000000000000000000000000000000000000aa", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", owner: "0x00000000000000000000000000000000000000bb", review };
const fresh = () => Effect.runPromise(provisionalVault(memoryStorage(), "slop:vault-action:v1:base-mainnet:provisional", vault, vault.owner, 1));
let setup = await fresh();

export const driver: Driver = {
  reset: async () => {
    setup = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(setup.machine.send(event, String(by ?? ""))),
  receive: (_key, raw, by) => outcome(setup.machine.receive(raw, String(by ?? ""))),
  observe: () => Effect.runPromise(setup.machine.get()),
};

export const options: Options = { keys: ["setup"], walks: 10, steps: 16 };
