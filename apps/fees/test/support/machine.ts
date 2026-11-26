import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver } from "../../gen/_conformance.ts";

export interface MachineModel<E, V, S> {
  get(): Effect.Effect<V>;
  send(event: E, by: S): Effect.Effect<V, unknown>;
  receive(input: unknown, by: S): Effect.Effect<V, unknown>;
}

export interface Senders<S> {
  readonly known: ReadonlyArray<S>;
  readonly otherwise: S;
}

export async function machineDriver<E, V, S>(make: () => Effect.Effect<MachineModel<E, V, S>>, senders: Senders<S>): Promise<Driver<E, V> & AsyncDisposable> {
  const senderOf = (by: unknown) => senders.known.find((sender) => sender === by) ?? senders.otherwise;
  let model = await Effect.runPromise(make());
  return {
    reset: async () => {
      model = await Effect.runPromise(make());
    },
    dispatch: (_key, event, by) => outcome(model.send(event, senderOf(by))),
    receive: (_key, raw, by) => outcome(model.receive(raw, senderOf(by))),
    observe: () => Effect.runPromise(model.get()),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
}
