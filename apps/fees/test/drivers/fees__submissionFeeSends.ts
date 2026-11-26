// spec/fees/submissionFeeSends.md, "A signed send is recorded before broadcast and one send per network is in flight"
import { Layer, ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/fees__submissionFeeSends.conformance.ts";
import type { Actor, Event, Sends } from "../../gen/fees__submissionFeeSends.ts";
import { sendsModel } from "../../src/submissionFee/sends.vibe";

const actors: ReadonlyArray<Actor> = ["Release", "Chain", "Worker"];
const runtime = ManagedRuntime.make(Layer.empty);
let model = await runtime.runPromise(sendsModel());

function actorOf(by: unknown): Actor {
  return actors.find((actor) => actor === by) ?? "Worker";
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    model = await runtime.runPromise(sendsModel());
  },
  dispatch: (_key, event: Event, by) => outcome(model.send(event, actorOf(by)), runtime),
  receive: (_key, raw, by) => outcome(model.receive(raw, actorOf(by)), runtime),
  observe: (): Promise<Sends> => runtime.runPromise(model.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["network"], walks: 10, steps: 16 };
