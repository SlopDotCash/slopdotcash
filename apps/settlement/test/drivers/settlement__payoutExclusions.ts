// spec/settlement/payoutExclusions.md, "A project's exclusion list starts empty and is revised only for later months"; spec/settlement/payoutExclusions.md, "Who is excluded in the open month or earlier never changes"
import { createHash } from "node:crypto";
import { Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { type StartedWorker, database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__payoutExclusions.conformance.ts";
import type { Event, Exclusion, ExclusionRegistry } from "../../gen/settlement__payoutExclusions.ts";
import { type Period, formatPeriod } from "../../src/kernels/calendar.ts";
import { admitExclusions, exclusionRegistry } from "../../src/monthly/exclusions.vibe";
import { manifestRelationships } from "../../src/monthly/store.vibe";

const PROJECT = "eliza";
const START = 1793491200;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const manifestOf = (entries: ReadonlyArray<Exclusion>) => JSON.stringify({
  id: PROJECT,
  status: "active",
  reward: {
    kind: "monthly-pool",
    monthlyCapMinor: "0",
    payoutExclusions: entries.map((entry) => ({
      actorId: String(entry.actor),
      relationship: manifestRelationships[entry.relationship],
      fromCycle: formatPeriod(entry.fromPeriod as Period),
      untilCycle: entry.untilPeriod === 0 ? null : formatPeriod(entry.untilPeriod as Period),
    })),
  },
});

const runtimeOver = (db: Awaited<ReturnType<typeof database>>, clock: ReturnType<typeof settableClock>) => ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

interface World {
  readonly mf: StartedWorker;
  readonly db: Awaited<ReturnType<typeof database>>;
  readonly runtime: ReturnType<typeof runtimeOver>;
  readonly clock: ReturnType<typeof settableClock>;
  revision: number;
}

let world: World | undefined;

const append = async (w: World, entries: ReadonlyArray<Exclusion>) => {
  const manifest = manifestOf(entries);
  w.revision += 1;
  await w.db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(PROJECT, w.revision, manifest, sha(manifest), "payout exclusions", new Date(w.clock.now()).toISOString()).run();
};

const open = async (): Promise<World> => {
  const mf = startWorker({ d1: { SLOP_DB: `payout-exclusions-conformance-${Date.now()}` } });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const clock = settableClock(START * 1000);
  const runtime = runtimeOver(db, clock);
  const made: World = { mf, db, runtime, clock, revision: 0 };
  await append(made, []);
  return made;
};

const current = async () => world ??= await open();

const dispatch = async (event: Event, by: string) => {
  const w = await current();
  const verdict = await outcome(admitExclusions(PROJECT, event, by), w.runtime);
  if (verdict !== "accepted") return verdict;
  if (event.type === "observeClock") w.clock.set(event.now * 1000);
  if (event.type === "revise") await append(w, event.entries);
  return verdict;
};

const observed = async (): Promise<ExclusionRegistry> => {
  const w = await current();
  return w.runtime.runPromise(exclusionRegistry(PROJECT));
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    const previous = world;
    world = undefined;
    if (previous !== undefined) {
      await previous.runtime.dispose();
      await previous.mf.dispose();
    }
  },
  dispatch: (_key, event: Event, by) => dispatch(event, String(by ?? "")),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    if (world !== undefined) {
      await world.runtime.dispose();
      await world.mf.dispose();
    }
  },
};

export const options: Options = { keys: ["eliza"], walks: 0 };
