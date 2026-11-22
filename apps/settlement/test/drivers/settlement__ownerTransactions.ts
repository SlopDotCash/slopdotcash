import { Effect, ManagedRuntime, Layer } from "effect";
import type { Driver, Options } from "../../gen/settlement__ownerTransactions.conformance.ts";
import type { Event, OwnerRequest } from "../../gen/settlement__ownerTransactions.ts";
import { draft, receive, send } from "../../src/owner/store.vibe";

const runtime = ManagedRuntime.make(Layer.empty);
const held = new Map<string, OwnerRequest>();
const start = draft({ revision: 1, snapshotDigest: "d" });
const current = (key: string) => held.get(key) ?? start;

const outcome = async (key: string, sent: Effect.Effect<OwnerRequest, unknown>) => runtime.runPromise(sent.pipe(
  Effect.tap((next) => Effect.sync(() => held.set(key, next))),
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    held.clear();
  },
  dispatch: (key, event: Event) => outcome(key, send(current(key), event)),
  receive: (key, raw) => outcome(key, receive(current(key), raw)),
  observe: (key) => current(key),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
  },
};

export const options: Options = { keys: ["deposit", "withdrawal", "lock", "release"], walks: 20, steps: 12 };
