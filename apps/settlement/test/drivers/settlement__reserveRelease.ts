import { Effect, Layer, ManagedRuntime } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { webCrypto } from "@repo/platform/crypto";
import type { Driver, Options } from "../../gen/settlement__reserveRelease.conformance.ts";
import type { Event, ReserveRelease } from "../../gen/settlement__reserveRelease.ts";
import { type ReleaseScope, receive, release, send } from "../../src/reserveRelease/store.vibe";

const runtime = ManagedRuntime.make(Layer.mergeAll(KeyValueStore.layerMemory, webCrypto));

let generation = 0;
const scopeOf = (key: string): ReleaseScope => ({ network: "base-mainnet", vault: `0x${key}-g${generation}`, period: "2026-11" });

const outcome = (sent: Effect.Effect<ReserveRelease, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
  },
  dispatch: (key, event: Event, by) => outcome(send(scopeOf(key), event, String(by))),
  receive: (key, raw, by) => outcome(receive(scopeOf(key), raw, String(by))),
  observe: (key) => runtime.runPromise(release(scopeOf(key))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
  },
};

export const options: Options = { keys: ["march", "april"], walks: 20, steps: 16 };
