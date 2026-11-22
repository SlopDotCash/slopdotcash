// spec/frontend/monthLock.md, "A review runs the lock refusals against the card's own read, and only the owner's accepted review can be sent"; spec/frontend/monthLock.md, "A declined or unclear wallet request sends nothing new, and a sent one is checked every five seconds at most 720 times"; spec/frontend/monthLock.md, "A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__monthLock.conformance.ts";
import type { Event } from "../../gen/frontend__monthLock.ts";
import { lockDesk, lockMachine } from "../../src/screens/funding/vault/monthLock.vibe";

const fresh = () => Effect.runPromise(Effect.provide(lockMachine(), lockDesk({ owner: "0x00000000000000000000000000000000000000aa", evm: undefined, solana: undefined })));
let lock = await fresh();

export const driver: Driver = {
  reset: async () => {
    lock = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(lock.send(event, Number(by))),
  receive: (_key, raw, by) => outcome(lock.receive(raw, Number(by))),
  observe: () => Effect.runPromise(lock.get()),
};

export const options: Options = { keys: ["card"], walks: 10, steps: 24 };
