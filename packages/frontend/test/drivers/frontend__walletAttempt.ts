// spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import { Effect } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__walletAttempt.conformance.ts";
import type { Event } from "../../gen/frontend__walletAttempt.ts";
import { type AttemptJournal, type SlotStorage, attemptJournal } from "../../src/wallets/core/attempt.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const slot = { name: "conformance", key: (account: number) => `slop:wallet-attempt-conformance:v1:${account}` };
const fresh = () => Effect.runPromise(Effect.provide(attemptJournal(slot, memoryStorage()), webCrypto));
let journal: AttemptJournal = await fresh();

export const driver: Driver = {
  reset: async () => {
    journal = await fresh();
  },
  dispatch: (_key, event: Event) => outcome(journal.machine.send(event)),
  receive: (_key, raw) => outcome(journal.machine.receive(raw)),
  observe: () => Effect.runPromise(journal.machine.get()),
};

export const options: Options = { keys: ["attempts"], walks: 10, steps: 16 };
