// spec/settlement/evmScan.md, "Completion advances the cursor monotonically, even when runs finish out of order"; spec/settlement/evmScan.md, "Every recognized event of a page must index before the page verifies"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__evmScan.conformance.ts";
import type { Event, EvmScan } from "../../gen/settlement__evmScan.ts";
import { type EvmScanSession, openEvmScan, receiveEvmScan } from "../../src/scan/evmStore.vibe";

const mf = startWorker({ d1: { SLOP_DB: "evm-scan-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto));

let generation = 0;
const sessions = new Map<string, EvmScanSession>();

const session = async (key: string) => {
  const known = sessions.get(key);
  if (known !== undefined) return known;
  const opened = await runtime.runPromise(openEvmScan({ projectId: `evm-scan-${generation}-${key}`, network: "base-mainnet" }));
  sessions.set(key, opened);
  return opened;
};

const outcome = (sent: Effect.Effect<EvmScan, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    sessions.clear();
  },
  dispatch: async (key, event: Event) => outcome((await session(key)).send(event)),
  receive: async (key, raw) => outcome(receiveEvmScan(await session(key), raw)),
  observe: async (key) => runtime.runPromise((await session(key)).current()),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["a", "b"], walks: 4, steps: 16 };
