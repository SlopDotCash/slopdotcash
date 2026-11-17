// spec/settlement/solanaScan.md, "Store one page per invocation and keep the old cursor as the interval boundary"; spec/settlement/solanaScan.md, "Stale or partial work leaves the authoritative prefix intact"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__solanaScan.conformance.ts";
import type { Event, Scan } from "../../gen/settlement__solanaScan.ts";
import { receiveSolanaScan, sendSolanaScan, storedScan } from "../../src/scan/solanaStore.vibe";

const mf = startWorker({ d1: { SLOP_DB: "solana-scan-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto));

let generation = 0;
const scope = (key: string) => ({ projectId: `solana-scan-${generation}-${key}`, network: "solana-mainnet" });

const outcome = (sent: Effect.Effect<Scan, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
  },
  dispatch: (key, event: Event) => outcome(sendSolanaScan(scope(key), event)),
  receive: (key, raw) => outcome(receiveSolanaScan(scope(key), raw)),
  observe: async (key) => (await runtime.runPromise(storedScan(scope(key)))).scan,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["a", "b"], walks: 3, steps: 12 };
