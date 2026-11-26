// spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"; spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"; spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { webCrypto } from "@repo/platform/crypto";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__feePages.conformance.ts";
import type { Event } from "../../gen/frontend__feePages.ts";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";
import { type FeePay, feeDesk, publishedSetup } from "../../src/screens/fee/payFlow.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key) };
}

const unreachable: typeof globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));
const services = Layer.mergeAll(publishedSetup, webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, unreachable));
const fresh = () => Effect.runPromise(Effect.provide(feeDesk({ kind: "report", caseId: "sc_conformance01" }, memoryStorage()), services));
let pay: FeePay = await fresh();

export const driver: Driver = {
  reset: async () => {
    pay = await fresh();
  },
  dispatch: (_key, event: Event, by) => outcome(pay.machine.send(event, Number(by))),
  receive: (_key, raw, by) => outcome(pay.machine.receive(raw, Number(by))),
  observe: () => Effect.runPromise(pay.machine.get()),
};

export const options: Options = { keys: ["pay"], walks: 10, steps: 24 };
