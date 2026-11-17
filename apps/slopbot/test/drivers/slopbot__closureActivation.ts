// spec/slopbot/closureActivation.md, "Only a reviewed production release switches closure on, with a qualified category, and any later release may switch it off"
import { Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/slopbot__closureActivation.conformance.ts";
import type { Event } from "../../gen/slopbot__closureActivation.ts";
import { activationLedger } from "../../src/activation/config.vibe";
import { settled } from "../support/settled.ts";

const runtime = ManagedRuntime.make(Layer.empty);

let ledger = await runtime.runPromise(activationLedger());

function sender(by: unknown) {
  return typeof by === "number" ? by : 0;
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    ledger = await runtime.runPromise(activationLedger());
  },
  dispatch: (_key, event: Event, by) => settled(ledger.send(event, sender(by)), runtime),
  receive: (_key, raw, by) => settled(ledger.receive(raw, sender(by)), runtime),
  observe: () => runtime.runPromise(ledger.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["activation"], walks: 10, steps: 20 };
