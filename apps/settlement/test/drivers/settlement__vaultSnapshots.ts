// spec/settlement/vaultSnapshots.md, "The write compares the latest row atomically"; spec/settlement/vaultSnapshots.md, "The first finalized read of each UTC month is recorded once per vault and never changes"; spec/settlement/vaultSnapshots.md, "Retry recognizes the exact creation transaction before checking a revision"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__vaultSnapshots.conformance.ts";
import type { Event, Snapshots } from "../../gen/settlement__vaultSnapshots.ts";
import { type VaultSession, openSession, unregistered } from "../../src/vault/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "vault-snapshots-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto));

const ASSET = "asset-";
const ASSET_WIDTH = 32;

let generation = 0;
const sessions = new Map<string, VaultSession>();

const session = async (key: string) => {
  const known = sessions.get(key);
  if (known !== undefined) return known;
  const opened = await runtime.runPromise(openSession({ projectId: `vault-snapshots-${generation}-${key}` }, unregistered));
  sessions.set(key, opened);
  return opened;
};

type Value = unknown;

const record = (value: Value): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const identityShaped = (value: Record<string, unknown>) =>
  ["chain", "network", "vault", "readVault", "asset", "decimals", "rules"].every((field) => Object.hasOwn(value, field));

const storedAsset = (asset: unknown) => typeof asset === "string" && asset !== "" ? `${ASSET}${asset}`.padEnd(ASSET_WIDTH, "_") : asset;

const forStorage = (value: Value): Value => {
  if (Array.isArray(value)) return value.map(forStorage);
  const fields = record(value);
  if (fields === undefined) return value;
  if (identityShaped(fields)) return { ...fields, asset: storedAsset(fields.asset) };
  return Object.fromEntries(Object.entries(fields).map(([field, item]) => [field, forStorage(item)]));
};

const fromStorage = (value: Value): Value => {
  if (Array.isArray(value)) return value.map(fromStorage);
  if (typeof value === "string") return value.startsWith(ASSET) ? value.slice(ASSET.length).replace(/_+$/u, "") : value;
  const fields = record(value);
  return fields === undefined ? value : Object.fromEntries(Object.entries(fields).map(([field, item]) => [field, fromStorage(item)]));
};

const outcome = (sent: Effect.Effect<Snapshots, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    sessions.clear();
  },
  dispatch: async (key, event: Event) => outcome((await session(key)).send(forStorage(event) as Event)),
  receive: async (key, raw) => outcome((await session(key)).receive(forStorage(raw))),
  observe: async (key) => fromStorage(await runtime.runPromise((await session(key)).current())) as Snapshots,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["a", "b"], walks: 2, steps: 14 };
