// spec/settlement/monthly.md, "A month opens with no proposal, pool amount or obligation"; spec/settlement/monthly.md, "The allocation is conserved within the month's pool"; spec/settlement/monthly.md, "Frozen amounts, recorded triggers and obligation progress never move backwards"; spec/settlement/monthly.md, "A stored pledge in the vault that pays the month freezes it at the cutoff, never for a retired project"; spec/settlement/monthly.md, "The reviewed ASI closeout proposes its month from the cutoff with its fixed pool and no change"
import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { type StartedWorker, database, migrate, startWorker } from "@repo/platform/testing";
import { outcome as verdict } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { Registry } from "@repo/ports/backend";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__monthly.conformance.ts";
import type { AwardFact, BanExclusion, Eligibility, Event, Monthly, RevisionFact, SkipReason } from "../../gen/settlement__monthly.ts";
import { fromAmount, toAmount } from "../../src/kernels/amounts.ts";
import { type Period, formatPeriod, isPeriod } from "../../src/kernels/calendar.ts";
import { ordinaryFeeBase } from "../../src/kernels/fees.ts";
import { type MonthFacts, MonthlyFacts, awardSource, loadMonth, manifestRelationships, sendMonth, withoutProposal } from "../../src/monthly/store.vibe";

const PROJECT = "eliza";
const NETWORK = "base-sepolia";
const SERVED: ReadonlySet<string> = new Set([NETWORK]);
const START = 1793491200;
const noEligibility: Eligibility = { revision: 0, active: false, verifiedPool: false, paused: false, restricted: false, retired: false, vaultRegistered: false, networkServed: false, receiptPolicyActive: false, monthlyPoolReward: false };
const u128 = 340282366920938463463374607431768211455n;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const chainOf = (revision: RevisionFact) => fromAmount(revision.maximum) === u128 ? "base" : "solana";
const policyOf = (revision: RevisionFact) => JSON.stringify([chainOf(revision), formatPeriod(revision.effectivePeriod as Period), revision.feePolicy, 200, 200]);

const manifestOf = (project: string, revision: RevisionFact) => JSON.stringify({
  id: project,
  status: "active",
  reward: {
    kind: "monthly-pool",
    monthlyCapMinor: fromAmount(revision.monthlyAmount).toString(),
    rewardStartAt: new Date(revision.rewardStartAt * 1000).toISOString(),
    payoutExclusions: revision.exclusions.map((entry) => ({
      actorId: String(entry.actor),
      relationship: manifestRelationships[entry.relationship],
      fromCycle: formatPeriod(entry.fromPeriod as Period),
      untilCycle: entry.untilPeriod === 0 ? null : formatPeriod(entry.untilPeriod as Period),
    })),
  },
  escrow: {
    chain: chainOf(revision),
    effectiveCycle: formatPeriod(revision.effectivePeriod as Period),
    feeMode: revision.feePolicy,
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    deployments: [{ network: NETWORK, vault: revision.vault, asset: revision.asset }],
  },
});

const stored = (revision: RevisionFact): RevisionFact => ({ ...revision, feePolicy: policyOf(revision) });
const modelled = (revision: RevisionFact): RevisionFact => {
  if (revision.feePolicy === "") return revision;
  const policy = JSON.parse(revision.feePolicy) as unknown[];
  return { ...revision, feePolicy: String(policy[2]) };
};

const registry = Layer.succeed(Registry, {
  project: () => Effect.succeed(undefined),
  byRepository: () => Effect.succeed(undefined),
  byPath: () => Effect.succeed(undefined),
  active: () => Effect.succeed([]),
  pausedProjects: () => Effect.succeed([]),
  fence: () => Effect.succeed(sql`1`),
  appendVaultRegistration: () => Effect.die(new Error("The monthly driver registers no vaults")),
});

const runtimeOver = (db: Awaited<ReturnType<typeof database>>, clock: ReturnType<typeof settableClock>, facts: { eligibility: Eligibility; current: RevisionFact | undefined }) =>
  ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, registry, Layer.succeed(MonthlyFacts, { of: (projectId: string) => Effect.sync(() => factsOf(facts, projectId)) })));

interface World {
  readonly mf: StartedWorker;
  readonly db: Awaited<ReturnType<typeof database>>;
  readonly runtime: ReturnType<typeof runtimeOver>;
  readonly clock: ReturnType<typeof settableClock>;
  readonly facts: { eligibility: Eligibility; current: RevisionFact | undefined };
  readonly numbers: Map<number, number>;
  readonly digests: Map<string, string>;
  project: string;
  period: number | undefined;
  closedSkip: SkipReason | undefined;
}

let world: World | undefined;

const factsOf = (facts: World["facts"], project: string): MonthFacts => {
  const current = facts.current;
  if (current === undefined || current.number === 0) return { eligibility: facts.eligibility, current: undefined, served: SERVED };
  const manifest = manifestOf(project, current);
  return { eligibility: facts.eligibility, current: { number: current.number, manifest, manifestSha256: sha(manifest) }, served: SERVED };
};

const open = async (): Promise<World> => {
  const mf = startWorker({ d1: { SLOP_DB: `monthly-conformance-${Date.now()}` } });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const clock = settableClock(START * 1000);
  const facts: World["facts"] = { eligibility: noEligibility, current: undefined };
  const runtime = runtimeOver(db, clock, facts);
  return { mf, db, runtime, clock, facts, numbers: new Map(), digests: new Map(), project: PROJECT, period: undefined, closedSkip: undefined };
};

const current = async () => world ??= await open();

const outcome = (w: World, program: Effect.Effect<unknown, unknown, ManagedRuntime.ManagedRuntime.Services<World["runtime"]>>) => verdict(program, w.runtime);

const registerRevision = async (w: World, revision: RevisionFact) => {
  const manifest = manifestOf(w.project, revision);
  const digest = sha(manifest);
  const known = await w.db.prepare("SELECT revision FROM project_revisions WHERE project_id = ? AND manifest_sha256 = ?").bind(w.project, digest).all();
  if (known.results.length > 0) return;
  const taken = await w.db.prepare("SELECT 1 FROM project_revisions WHERE project_id = ? AND revision = ?").bind(w.project, revision.number).all();
  const number = taken.results.length === 0 && revision.number > 0 ? revision.number : 1000 + w.numbers.size;
  w.numbers.set(number, revision.number);
  await w.db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(w.project, number, manifest, digest, "conformance revision", new Date(START * 1000).toISOString()).run();
};

const hexDigest = (w: World, digest: string) => {
  const hex = sha(`snapshot:${digest}`);
  w.digests.set(hex, digest);
  return hex;
};

const forStore = (w: World, event: Event): Event => {
  if (event.type === "observeRevision") return { ...event, revision: stored(event.revision) };
  if (event.type === "propose" || event.type === "proposeCloseout") return { ...event, snapshot: { ...event.snapshot, digest: event.snapshot.digest === "" ? "" : hexDigest(w, event.snapshot.digest) }, revision: stored(event.revision) };
  return event;
};

const importCloseout = async (w: World, snapshotDigest: string, next: Monthly, digests: readonly string[]) => {
  const period = formatPeriod(w.period as Period);
  const manifest = manifestOf(w.project, w.facts.current ?? next.currentRevision);
  const at = new Date(w.clock.now()).toISOString();
  await w.db.batch([
    w.db.prepare("INSERT INTO monthly_reward_bases (project_id, period, manifest, manifest_sha256, source_snapshot_sha256, cap_base, recipient_count, created_at, early_close_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(w.project, period, manifest, sha(manifest), snapshotDigest, fromAmount(next.cap).toString(), next.proposedShares.length, at, new Date(next.earlyCloseAt * 1000).toISOString()),
    ...next.proposedShares.map((share, index) => w.db.prepare("INSERT INTO monthly_reward_base_rows (project_id, period, github_user_id, github_login, gross_base, source_digest) VALUES (?, ?, ?, ?, ?, ?)").bind(w.project, period, String(share.actor), `user${share.actor}`, fromAmount(share.amount).toString(), digests[index] ?? "")),
  ]);
};

const reasonOf = (event: Event) => event.type === "cut" ? "c".repeat(Math.max(event.reasonLength, 0)) : undefined;

const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;

const recordInLedger = async (w: World, event: Event & { readonly award: AwardFact }) => {
  const runRow = await w.db.prepare("SELECT network, vault, json_extract(snapshot, '$.asset') AS asset FROM monthly_payment_runs WHERE project_id = ? AND period = ?").bind(w.project, formatPeriod(w.period as Period)).all();
  const obligation = await w.db.prepare("SELECT source_digest FROM monthly_payment_obligations WHERE project_id = ? AND period = ? AND github_user_id = ?").bind(w.project, formatPeriod(w.period as Period), String(event.award.source.actor)).all();
  const network = text(runRow.results[0]?.network, NETWORK);
  const vault = text(runRow.results[0]?.vault);
  const source = text(obligation.results[0]?.source_digest);
  const asset = `0x${sha(`asset:${text(runRow.results[0]?.asset)}`).slice(0, 40)}`;
  const gross = fromAmount(event.award.gross);
  if (event.type === "recordPaid") {
    await w.db.prepare("UPDATE payment_obligations SET state = 'paid', paid_transaction = ? WHERE network = ? AND vault = ? AND source_digest = ?").bind(`tx-${source}`, network, vault, source).run();
    return;
  }
  await w.db.prepare("INSERT INTO payment_obligations (id, project_id, github_user_id, network, chain, vault, asset_address, asset_decimals, gross_base, fee_base, source_digest, state, created_at) VALUES (?, ?, ?, ?, 'base', ?, ?, 6, ?, ?, ?, 'reserved', ?)").bind(`obligation-${source}`, w.project, String(event.award.actor), network, vault, asset, gross.toString(), ordinaryFeeBase(gross).toString(), source, new Date(w.clock.now()).toISOString()).run();
};

const syncBans = async (w: World, bans: ReadonlyArray<BanExclusion>) => {
  await w.db.prepare("DELETE FROM project_maintainer_bans").run();
  const valid = bans.filter((entry) => entry.actor > 0 && entry.ban > 0);
  if (valid.length === 0) return;
  const latest = await w.db.prepare("SELECT revision, manifest, manifest_sha256, created_at FROM project_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1").bind(w.project).all();
  const row = latest.results[0];
  if (row === undefined) return;
  const manifest = text(row.manifest);
  const manifestSha = text(row.manifest_sha256);
  const createdAt = text(row.created_at, new Date(START * 1000).toISOString());
  const revision = Number(row.revision);
  await w.db.prepare("INSERT OR IGNORE INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', ?, ?, ?, ?, ?)").bind(w.project, revision, manifest, manifestSha, createdAt, createdAt).run();
  const issuer = JSON.stringify({ kind: "vetting-service", keySha256: "c".repeat(64), assessmentId: "assessment-1", policyVersion: "1", rule: "confirmed-malice" });
  const vettingId = `enf_${w.project}_vetting`;
  const enforcementId = `enf_${w.project}_moderator`;
  await w.db.prepare("INSERT OR IGNORE INTO project_enforcements (id, project_id, sequence, action, state_after, appeal_after, reason, evidence_reference, repository_github_id, repository_keys, actor_github_id, actor_github_login, system_issuer, actor_role, decision_source, before_revision, before_manifest_sha256, after_revision, after_manifest_sha256, result, created_at) VALUES (?, ?, 1, 'ban', 'banned', 'none', 'confirmed malice', 'scan-1', '9001', '[\"github:9001\"]', NULL, NULL, ?, 'vetting-service', 'standing-rule', ?, ?, NULL, NULL, 'no_revision_needed', ?)").bind(vettingId, w.project, issuer, revision, manifestSha, createdAt).run();
  await w.db.prepare("INSERT OR IGNORE INTO project_enforcements (id, project_id, sequence, action, state_after, appeal_after, reason, evidence_reference, repository_github_id, repository_keys, actor_github_id, actor_github_login, system_issuer, actor_role, decision_source, before_revision, before_manifest_sha256, after_revision, after_manifest_sha256, result, created_at) VALUES (?, ?, 2, 'ban', 'banned', 'none', 'moderator decision', 'scan-1', '9001', '[\"github:9001\"]', '7', 'moderator', NULL, 'project-moderator', 'admin-panel', ?, ?, NULL, NULL, 'no_revision_needed', ?)").bind(enforcementId, w.project, revision, manifestSha, createdAt).run();
  for (const entry of valid) {
    await w.db.prepare("INSERT OR IGNORE INTO project_maintainer_bans (rowid, enforcement_id, github_id, github_login) VALUES (?, ?, ?, ?)").bind(entry.ban, enforcementId, String(entry.actor), `user${entry.actor}`).run();
  }
};

const fundingOf = async (w: World) => {
  const counts = await w.db.prepare("SELECT (SELECT count(*) FROM monthly_payment_obligations o WHERE o.network = r.network AND o.vault = r.vault) AS outstanding, (SELECT count(*) FROM payment_obligations p WHERE p.network = r.network AND p.vault = r.vault) AS reserved FROM monthly_payment_runs r WHERE r.project_id = ? AND r.period = ?").bind(w.project, formatPeriod(w.period as Period)).all();
  const row = counts.results[0];
  return { outstanding: Number(row?.outstanding ?? 0), reserved: Number(row?.reserved ?? 0) };
};

const settingsTo = async (w: World, automatic: boolean, sequence: number) => {
  const found = await w.db.prepare("SELECT coalesce(max(sequence), 0) AS latest FROM monthly_payment_settings WHERE project_id = ?").bind(w.project).all();
  for (let next = Number(found.results[0]?.latest ?? 0) + 1; next <= sequence; next++) await w.db.prepare("INSERT INTO monthly_payment_settings (project_id, sequence, automatic, actor_id, created_at) VALUES (?, ?, ?, '1', ?)").bind(w.project, next, automatic ? 1 : 0, new Date(w.clock.now()).toISOString()).run();
};

const initialView = (w: World): Monthly => ({
  project: w.project, period: 0, phase: "Unopened", skip: "NoSkip", now: Math.floor(w.clock.now() / 1000), automatic: true, settingsSequence: 0,
  eligibility: w.facts.eligibility, revision: { number: 0, effectivePeriod: 0, monthlyAmount: [0], maximum: [0], rewardStartAt: 0, vault: "", asset: "", feePolicy: "", exclusions: [] },
  currentRevision: w.facts.current ?? { number: 0, effectivePeriod: 0, monthlyAmount: [0], maximum: [0], rewardStartAt: 0, vault: "", asset: "", feePolicy: "", exclusions: [] },
  cap: [0], snapshotDigest: "", exclusions: [], shares: [], proposedShares: [], total: [0], sequence: 0, changes: [], cuts: [], publicCuts: [], notices: [], latestCutAt: 0, frozenAt: 0, trigger: "NoTrigger",
  frozenSequence: 0, frozenBy: 0, obligations: [], banned: [], underfundedNotice: false, coordinatorRetries: 0, pledgedVault: "", earlyCloseAt: 0, reviewedOctober: false,
});

const canonicalAmount = (amount: ReadonlyArray<number>) => toAmount(fromAmount([...amount]));
const canonicalRevision = (revision: RevisionFact): RevisionFact => ({
  ...revision,
  monthlyAmount: canonicalAmount(revision.monthlyAmount),
  maximum: canonicalAmount(revision.maximum),
});

const view = (state: Monthly): Monthly => ({
  ...state,
  revision: canonicalRevision(state.revision),
  currentRevision: canonicalRevision(state.currentRevision),
  cap: canonicalAmount(state.cap),
  shares: state.shares.map((share) => ({ ...share, amount: canonicalAmount(share.amount) })),
  proposedShares: state.proposedShares.map((share) => ({ ...share, amount: canonicalAmount(share.amount) })),
  total: canonicalAmount(state.total),
  changes: state.changes.map((change) => ({ ...change, amount: canonicalAmount(change.amount) })),
  cuts: state.cuts.map((cut) => ({ ...cut, proposed: canonicalAmount(cut.proposed), amount: canonicalAmount(cut.amount) })),
  publicCuts: state.publicCuts.map((cut) => ({ ...cut, proposed: canonicalAmount(cut.proposed), amount: canonicalAmount(cut.amount) })),
  obligations: state.obligations.map((obligation) => ({ ...obligation, amount: canonicalAmount(obligation.amount) })),
  underfundedNotice: false,
  coordinatorRetries: 0,
  pledgedVault: state.pledgedVault === state.currentRevision.vault ? state.pledgedVault : "",
});

const storePledge = async (w: World, vault: string) => {
  await w.db.prepare("INSERT INTO vault_month_pledges (project_id, network, vault, period, amount, open, block_number, observed_at) VALUES (?, ?, ?, ?, '1000000', 1, '1', ?) ON CONFLICT (project_id, network, vault, period) DO UPDATE SET amount = excluded.amount, open = 1").bind(w.project, NETWORK, vault, formatPeriod(w.period as Period), new Date(w.clock.now()).toISOString()).run();
};

const observed = async (w: World): Promise<Monthly> => {
  if (w.period === undefined) return view(initialView(w));
  const loaded = await w.runtime.runPromise(loadMonth({ projectId: w.project, period: w.period as Period }));
  const state: Monthly = w.closedSkip !== undefined && loaded.state.phase === "Collecting" ? { ...loaded.state, phase: "NoProposal", skip: w.closedSkip } : loaded.state;
  return view({
    ...state,
    snapshotDigest: w.digests.get(state.snapshotDigest) ?? state.snapshotDigest,
    revision: { ...modelled(state.revision), number: w.numbers.get(state.revision.number) ?? state.revision.number },
    currentRevision: modelled(state.currentRevision),
  });
};

const dispatch = async (event: Event): Promise<"accepted" | "refused"> => {
  const w = await current();
  if (event.type === "openMonth") {
    if (w.period !== undefined || event.project === "" || !isPeriod(event.period)) return "refused";
    w.project = event.project;
    w.period = event.period;
    return "accepted";
  }
  if (w.period === undefined) return "refused";
  if (w.closedSkip !== undefined && (event.type === "propose" || event.type === "proposeCloseout" || event.type === "closeProposalWindow")) return "refused";
  const key = { projectId: w.project, period: w.period as Period };
  if (event.type === "observeClock") {
    const verdict = await outcome(w, sendMonth(key, event));
    if (verdict === "accepted") w.clock.set(event.now * 1000);
    return verdict;
  }
  const sent = forStore(w, event);
  if (sent.type === "proposeCloseout") return outcome(w, Effect.tap(sendMonth(key, sent), (next) => Effect.flatMap(Effect.forEach(next.proposedShares, (share) => awardSource(w.project, key.period, share.actor)), (digests) => Effect.promise(() => importCloseout(w, sent.snapshot.digest, next, digests)))));
  if (sent.type === "createObligations") await syncBans(w, sent.bans);
  const next = await w.runtime.runPromise(sendMonth(key, sent, { logins: new Map([1, 2, 3, 4, 5].map((actor) => [actor, `user${actor}`])), funding: await fundingOf(w), reason: reasonOf(event) }).pipe(
    Effect.catchTags({ Rejected: () => Effect.succeed(undefined) }),
  ));
  if (next === undefined) return "refused";
  if (event.type === "observeEligibility") w.facts.eligibility = event.eligibility;
  if (event.type === "observeRevision") {
    w.facts.current = event.revision;
    await registerRevision(w, event.revision);
  }
  if (event.type === "observeSettings") await settingsTo(w, event.automatic, event.settingsSequence);
  if (event.type === "closeProposalWindow") w.closedSkip = withoutProposal(next).skip;
  if (event.type === "observePledge") await storePledge(w, event.pledgeVault);
  if (event.type === "recordReserved" || event.type === "recordConflict" || event.type === "recordPaid") await recordInLedger(w, event);
  return "accepted";
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
  dispatch: (_key, event: Event) => dispatch(event),
  observe: async () => observed(await current()),
  [Symbol.asyncDispose]: async () => {
    if (world !== undefined) {
      await world.runtime.dispose();
      await world.mf.dispose();
    }
  },
};

export const options: Options = { keys: ["eliza"], walks: 3, steps: 12, view };
