// spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"; spec/settlement/monthlySettings.md, "The journal is append-only and the current value is its last entry"; spec/settlement/monthlySettings.md, "Turning the default on is refused while an open cut notice crosses an unfrozen month's cutoff"
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
import type { CutNotice, Event, Settings } from "../../gen/settlement__monthlySettings.ts";
import { type Period, formatPeriod } from "../../src/kernels/calendar.ts";
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
  fence: () => Effect.succeed(sql`1`),
});
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, factsLayer, registry));

let generation = 0;
let variant = 0;
let project = "";
let cuts = "[]";

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const seedCut = async (projectId: string, notice: CutNotice) => {
  const period = formatPeriod(notice.period as Period);
  await db.prepare("INSERT INTO monthly_reward_bases (project_id, period, manifest, manifest_sha256, source_snapshot_sha256, cap_base, recipient_count, created_at) VALUES (?, ?, '{}', ?, ?, '100', 1, ?)").bind(projectId, period, sha("{}"), sha(projectId), iso(notice.latestCutAt)).run();
  await db.prepare("INSERT INTO monthly_reward_base_rows (project_id, period, github_user_id, github_login, gross_base, source_digest) VALUES (?, ?, '7', 'cut-recipient', '100', ?)").bind(projectId, period, sha(`${projectId}:${period}`)).run();
  await db.prepare("INSERT INTO monthly_allocation_changes (project_id, period, sequence, github_user_id, gross_base, actor_id, created_at) VALUES (?, ?, 1, '7', '50', '9', ?)").bind(projectId, period, iso(notice.latestCutAt)).run();
  await db.prepare("INSERT INTO monthly_allocation_cut_reasons (project_id, period, sequence, github_user_id, proposed_gross_base, gross_base, reason, actor_id, created_at) VALUES (?, ?, 1, '7', '100', '50', 'A cut with a public reason', '9', ?)").bind(projectId, period, iso(notice.latestCutAt)).run();
};

const withCuts = async (openCuts: ReadonlyArray<CutNotice>) => {
  const wanted = JSON.stringify(openCuts.map((notice) => [notice.period, notice.latestCutAt]));
  if (wanted === cuts && project !== "") return project;
  const next = `settings-g${generation}-v${variant++}`;
  if (project !== "") await db.prepare("INSERT INTO monthly_payment_settings (project_id, sequence, automatic, actor_id, created_at) SELECT ?, sequence, automatic, actor_id, created_at FROM monthly_payment_settings WHERE project_id = ? ORDER BY sequence").bind(next, project).run();
  for (const notice of openCuts) await seedCut(next, notice);
  project = next;
  cuts = wanted;
  return project;
};

const observed = async (): Promise<Settings> => {
  const loaded = await runtime.runPromise(loadSettings(project === "" ? await withCuts([]) : project));
  return { ...loaded.state, project: MODEL_PROJECT };
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    generation++;
    variant = 0;
    project = "";
    cuts = "[]";
    facts.revision = 1;
    clock.set(START * 1000);
    await withCuts([]);
  },
  dispatch: async (_key, event: Event) => {
    if (event.type === "observeRevision") {
      const verdict = await outcome(observeRevision(project, event.revision), runtime);
      if (verdict === "accepted") facts.revision = event.revision;
      return verdict;
    }
    clock.set(event.now * 1000);
    const projectId = await withCuts(event.openCuts);
    return outcome(setAutomatic(projectId, { automatic: event.automatic, expectedSequence: event.expectedSequence, authority: event.authority }), runtime);
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["eliza"], walks: 5, steps: 10 };
