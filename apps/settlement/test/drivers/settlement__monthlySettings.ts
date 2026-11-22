// spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"; spec/settlement/monthlySettings.md, "The journal is append-only and the current value is its last entry"
import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Registry } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/settlement__monthlySettings.conformance.ts";
import type { Event, Settings } from "../../gen/settlement__monthlySettings.ts";
import { MonthlyFacts } from "../../src/monthly/store.vibe";
import { loadSettings, observeRevision, setAutomatic } from "../../src/monthly/settingsStore.vibe";

const MODEL_PROJECT = "eliza";
const START = 1796300000;

const mf = startWorker({ d1: { SLOP_DB: "monthly-settings-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const clock = settableClock(START * 1000);
const facts = { revision: 1 };
const factsLayer = Layer.succeed(MonthlyFacts, {
  of: () => Effect.sync(() => ({
    eligibility: { revision: facts.revision, active: true, verifiedPool: true, paused: false, restricted: false, retired: false, vaultRegistered: true, networkServed: true, receiptPolicyActive: true, monthlyPoolReward: true },
    current: { number: facts.revision, manifest: "{}", manifestSha256: sha("{}") },
    served: new Set<string>(),
  })),
});
const registry = Layer.succeed(Registry, {
  project: () => Effect.succeed(undefined),
  byRepository: () => Effect.succeed(undefined),
  byPath: () => Effect.succeed(undefined),
  active: () => Effect.succeed([]),
  pausedProjects: () => Effect.succeed([]),
  appendVaultRegistration: () => Effect.die(new Error("this test registers no vault")),
  fence: () => Effect.succeed(sql`1`),
});
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, factsLayer, registry));

let generation = 0;
let project = "";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const observed = async (): Promise<Settings> => {
  const loaded = await runtime.runPromise(loadSettings(project));
  return { ...loaded.state, project: MODEL_PROJECT };
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    generation++;
    project = `settings-g${generation}`;
    facts.revision = 1;
    clock.set(START * 1000);
  },
  dispatch: async (_key, event: Event) => {
    if (event.type === "observeRevision") {
      const verdict = await outcome(observeRevision(project, event.revision), runtime);
      if (verdict === "accepted") facts.revision = event.revision;
      return verdict;
    }
    return outcome(setAutomatic(project, { automatic: event.automatic, expectedSequence: event.expectedSequence, authority: event.authority, lateCutNotice: event.lateCutNotice }), runtime);
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["eliza"], walks: 5, steps: 10 };
