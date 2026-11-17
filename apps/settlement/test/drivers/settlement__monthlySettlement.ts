// spec/settlement/monthlySettlement.md, "The month and the vault start independently"; spec/settlement/monthlySettlement.md, "Obligations are created only when the vault's finalized free balance covers the month"; spec/settlement/monthlySettlement.md, "An obligation is reserved, paid or conflicted only as the vault's finalized award shows"
import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { type StartedWorker, database, migrate, startWorker } from "@repo/platform/testing";
import { outcome as verdict } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { type ProjectView, Registry, Restrictions } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { Driver, Options } from "../../gen/settlement__monthlySettlement.conformance.ts";
import type { Award, Escrow } from "../../gen/settlement__escrow.ts";
import type { Eligibility, RevisionFact } from "../../gen/settlement__monthly.ts";
import type { Event, MonthlySettlement } from "../../gen/settlement__monthlySettlement.ts";
import { fromAmount } from "../../src/kernels/amounts.ts";
import { type Period, formatPeriod, isPeriod } from "../../src/kernels/calendar.ts";
import { type MonthFacts, MonthlyFacts, manifestRelationships, sendMonth } from "../../src/monthly/store.vibe";
import { underfundedNotice } from "../../src/monthly/coordinator.vibe";
import { type ChainView, type Decided, type VaultPlace, loadSettlement, observeChain, settle } from "../../src/monthlySettlement/store.vibe";

const PROJECT = "eliza";
const STEWARD = "1";
const NETWORK = "base-sepolia";
const SERVED: ReadonlySet<string> = new Set([NETWORK]);
const START = 1793491200;
const ZERO_REVISION: RevisionFact = { number: 0, effectivePeriod: 0, monthlyAmount: [0], maximum: [0], rewardStartAt: 0, vault: "", asset: "", feePolicy: "", exclusions: [] };
const NO_ELIGIBILITY: Eligibility = { revision: 0, active: false, verifiedPool: false, paused: false, restricted: false, retired: false, vaultRegistered: false, networkServed: false, receiptPolicyActive: false, monthlyPoolReward: false };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const tokens = new Map<string, string>();
const assetHex = (token: string) => {
  const hex = `0x${sha(`asset:${token}`).slice(0, 40)}`;
  tokens.set(hex, token);
  return hex;
};
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const policyOf = (revision: RevisionFact) => JSON.stringify(["base", formatPeriod(revision.effectivePeriod as Period), revision.feePolicy, 200, 200]);

const manifestOf = (revision: RevisionFact) => JSON.stringify({
  id: PROJECT,
  status: "active",
  reward: {
    kind: "monthly-pool",
    monthlyCapMinor: fromAmount(revision.monthlyAmount).toString(),
    rewardStartAt: iso(revision.rewardStartAt),
    payoutExclusions: revision.exclusions.map((entry) => ({ actorId: String(entry.actor), relationship: manifestRelationships[entry.relationship], fromCycle: formatPeriod(entry.fromPeriod as Period), untilCycle: entry.untilPeriod === 0 ? null : formatPeriod(entry.untilPeriod as Period) })),
  },
  escrow: { chain: "base", effectiveCycle: formatPeriod(revision.effectivePeriod as Period), feeMode: revision.feePolicy, feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, deployments: [{ network: NETWORK, vault: revision.vault, asset: revision.asset === "" ? "" : assetHex(revision.asset) }] },
});

const stored = (revision: RevisionFact): RevisionFact => ({ ...revision, feePolicy: policyOf(revision) });
const modelled = (revision: RevisionFact): RevisionFact => ({
  ...revision,
  asset: tokens.get(revision.asset) ?? revision.asset,
  feePolicy: revision.feePolicy === "" ? "" : String((JSON.parse(revision.feePolicy) as unknown[])[2]),
});

const ports = Layer.mergeAll(
  Layer.succeed(Registry, {
    project: () => Effect.succeed({ projectId: PROJECT, revision: 1, manifestSha256: "", rowStatus: "Active", manifestStatus: "Active", listingTier: "Community", retirement: "NotRetired", stewardGithubId: STEWARD, repositories: [], closureConsent: false } satisfies ProjectView),
    byRepository: () => Effect.succeed(undefined), byPath: () => Effect.succeed(undefined), active: () => Effect.succeed([]), fence: () => Effect.succeed(sql`1`) }),
  Layer.succeed(Restrictions, { account: () => Effect.succeed({ banned: false }), project: () => Effect.succeed({ restricted: false }), fence: () => Effect.succeed(sql`SELECT 1`), unbanned: () => Effect.succeed(sql`1`) }),
  Layer.succeed(Notices, {
    statements: (batch) => Effect.succeed(batch.notices.map((notice) => sql`INSERT INTO notifications (event_key, recipient_github_id, kind, subject, detail, action_path, source_at, created_at) SELECT ${notice.eventKey}, ${notice.recipientGithubId}, 'payout_exception', ${notice.subject}, ${notice.detail ?? null}, ${notice.actionPath}, ${notice.sourceAt}, ${notice.sourceAt} WHERE (${batch.onlyIf ?? sql`1`}) ON CONFLICT (event_key, recipient_github_id) DO NOTHING`)),
    fanout: () => Effect.succeed([]),
  }),
);

const runtimeOver = (db: Awaited<ReturnType<typeof database>>, clock: ReturnType<typeof settableClock>, facts: { eligibility: Eligibility; current: RevisionFact | undefined }) =>
  ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, ports, Layer.succeed(MonthlyFacts, { of: () => Effect.sync(() => factsOf(facts)) })));

type Services = ManagedRuntime.ManagedRuntime.Services<ReturnType<typeof runtimeOver>>;

interface World {
  readonly mf: StartedWorker;
  readonly db: Awaited<ReturnType<typeof database>>;
  readonly runtime: ReturnType<typeof runtimeOver>;
  readonly clock: ReturnType<typeof settableClock>;
  readonly facts: { eligibility: Eligibility; current: RevisionFact | undefined };
  readonly numbers: Map<number, number>;
  readonly digests: Map<string, string>;
  chain: ChainView;
  period: number | undefined;
}

let world: World | undefined;

const factsOf = (facts: World["facts"]): MonthFacts => {
  const current = facts.current;
  if (current === undefined || current.number === 0) return { eligibility: facts.eligibility, current: undefined, served: SERVED };
  const manifest = manifestOf(current);
  return { eligibility: facts.eligibility, current: { number: current.number, manifest, manifestSha256: sha(manifest) }, served: SERVED };
};


const open = async (): Promise<World> => {
  const mf = startWorker({ d1: { SLOP_DB: `monthly-settlement-conformance-${Date.now()}` } });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const clock = settableClock(START * 1000);
  const facts: World["facts"] = { eligibility: NO_ELIGIBILITY, current: undefined };
  const runtime = runtimeOver(db, clock, facts);
  return { mf, db, runtime, clock, facts, numbers: new Map(), digests: new Map(), chain: { escrow: initialEscrow(), headTime: 0 }, period: undefined };
};

function initialEscrow(): Escrow {
  return {
    deployed: false, vault: "vault", asset: { network: "Base", token: "usdc", decimals: 6, native: false, kind: "Classic" }, purpose: "OrdinaryPurpose", owner: "owner", feeRecipient: "fees", authority: "attester",
    bindingDelay: 0, implementation: "PreRelease", at: { block: 0, index: 0, time: START, transaction: "" }, clock: START, monthlyEnabled: false, monthlyCap: [0], sourceSequence: 0,
    deposited: [0], held: [0], committed: [0], spent: [0], free: [0], pending: [0], reserved: [0], reservedPrincipal: [0], reservedFees: [0], paid: [0], paidNet: [0], payoutFees: [0],
    grossWithdrawn: [0], withdrawalFees: [0], accruedFees: [0], claimedFees: [0], months: [], awards: [], releasedLeaves: [], withdrawals: [], depositsWhilePending: 0,
  };
}

const current = async () => world ??= await open();
const run = <A>(w: World, program: Effect.Effect<A, unknown, Services>) => w.runtime.runPromise(program);
const outcome = (w: World, program: Effect.Effect<unknown, unknown, Services>) => verdict(program, w.runtime);
const keyOf = (w: World) => ({ projectId: PROJECT, period: w.period as Period });

const registerRevision = async (w: World, revision: RevisionFact) => {
  const manifest = manifestOf(revision);
  const digest = sha(manifest);
  const known = await w.db.prepare("SELECT revision FROM project_revisions WHERE project_id = ? AND manifest_sha256 = ?").bind(PROJECT, digest).all();
  if (known.results.length > 0) return;
  const taken = await w.db.prepare("SELECT 1 FROM project_revisions WHERE project_id = ? AND revision = ?").bind(PROJECT, revision.number).all();
  const number = taken.results.length === 0 && revision.number > 0 ? revision.number : 1000 + w.numbers.size;
  w.numbers.set(number, revision.number);
  await w.db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, ?, ?, ?, 'conformance revision', ?)").bind(PROJECT, number, manifest, digest, iso(START)).run();
};

const settingsTo = async (w: World, automatic: boolean, sequence: number) => {
  const found = await w.db.prepare("SELECT coalesce(max(sequence), 0) AS latest FROM monthly_payment_settings WHERE project_id = ?").bind(PROJECT).all();
  for (let next = Number(found.results[0]?.latest ?? 0) + 1; next <= sequence; next++) await w.db.prepare("INSERT INTO monthly_payment_settings (project_id, sequence, automatic, actor_id, created_at) VALUES (?, ?, ?, '1', ?)").bind(PROJECT, next, automatic ? 1 : 0, iso(Math.floor(w.clock.now() / 1000))).run();
};

const syncSnapshot = async (w: World) => {
  const { escrow, headTime } = w.chain;
  if (!escrow.deployed) return;
  const free = fromAmount(escrow.free).toString();
  await w.db.prepare("INSERT INTO vault_snapshots (project_id, network, chain, vault, asset_address, asset_decimals, total_deposited, total_paid, total_payout_fees, total_gross_withdrawn, total_withdrawal_fees, total_service_fees, free_balance, block_number, block_time, observed_at) VALUES (?, ?, 'base', ?, ?, 6, ?, '0', '0', '0', '0', '0', ?, '1', ?, ?) ON CONFLICT (project_id, network, vault) DO UPDATE SET free_balance = excluded.free_balance, total_deposited = excluded.total_deposited, observed_at = excluded.observed_at")
    .bind(PROJECT, NETWORK, escrow.vault, assetHex(escrow.asset.token), fromAmount(escrow.deposited).toString(), free, iso(escrow.clock), iso(headTime)).run();
};

const sourceOf = async (w: World, actor: number) => {
  const found = await w.db.prepare("SELECT source_digest FROM monthly_reward_base_rows WHERE project_id = ? AND period = ? AND github_user_id = ?").bind(PROJECT, formatPeriod(w.period as Period), String(actor)).all();
  return found.results[0]?.source_digest as string | undefined;
};

const recordAward = async (w: World, sourceActor: number, paid: boolean) => {
  const award = w.chain.escrow.awards.find((entry) => entry.source.actor === sourceActor && entry.source.origin === PROJECT && entry.source.period === w.period);
  const digest = await sourceOf(w, sourceActor);
  if (award === undefined || digest === undefined) return;
  if (paid) {
    await w.db.prepare("UPDATE payment_obligations SET state = 'paid', paid_transaction = ? WHERE network = ? AND vault = ? AND source_digest = ?").bind(`tx-${digest}`, NETWORK, w.chain.escrow.vault, digest).run();
    return;
  }
  await w.db.prepare("INSERT INTO payment_obligations (id, project_id, github_user_id, network, chain, vault, asset_address, asset_decimals, gross_base, fee_base, source_digest, state, created_at) VALUES (?, ?, ?, ?, 'base', ?, ?, 6, ?, ?, ?, 'reserved', ?) ON CONFLICT DO NOTHING")
    .bind(`obligation-${digest}`, PROJECT, String(award.actor), NETWORK, w.chain.escrow.vault, assetHex(w.chain.escrow.asset.token), fromAmount(award.gross).toString(), fromAmount(award.fee).toString(), digest, iso(Math.floor(w.clock.now() / 1000))).run();
};

const forStore = (w: World, event: Event): Event => {
  if (event.type === "observeRevision") return { ...event, revision: stored(event.revision) };
  if (event.type === "propose") {
    const hex = sha(`snapshot:${event.snapshot.digest}`);
    w.digests.set(hex, event.snapshot.digest);
    return { ...event, snapshot: { ...event.snapshot, digest: hex }, revision: stored(event.revision) };
  }
  return event;
};

const monthOnly = new Set(["observeClock", "observeEligibility", "observeRevision", "observeSettings", "propose"]);
const decided = new Set(["adjust", "finalize", "autoFreeze", "createObligations", "noteUnderfunded"]);

const chainStep = async (w: World, event: Event, by: string) => {
  const next = await run(w, observeChain(keyOf(w), event, by, w.chain).pipe(Effect.option));
  if (next._tag === "None") return "refused" as const;
  const before = w.chain;
  w.chain = { escrow: next.value.escrow, headTime: next.value.headTime };
  if (event.type === "commitObligation") await recordAward(w, event.actor, false);
  if (event.type === "commitManualAward") await recordAward(w, event.source.actor, false);
  if (event.type === "materialize") await recordAward(w, event.proof.actor, false);
  if (event.type === "observeExistingAward" || event.type === "observeConflict") await recordAward(w, event.actor, false);
  if (event.type === "observePaid") await recordAward(w, event.actor, true);
  if (event.type === "deploy" || event.type === "deposit" || event.type === "withdraw" || event.type === "observeHead" || before.escrow.free !== next.value.escrow.free) await syncSnapshot(w);
  return "accepted" as const;
};

const dispatch = async (event: Event, by: string): Promise<"accepted" | "refused"> => {
  const w = await current();
  if (event.type === "openMonth") {
    if (w.period !== undefined || !isPeriod(event.period)) return "refused";
    w.period = event.period;
    return "accepted";
  }
  if (w.period === undefined) return "refused";
  const key = keyOf(w);
  if (monthOnly.has(event.type)) {
    const sent = forStore(w, event) as Parameters<typeof sendMonth>[1];
    const result = await outcome(w, sendMonth(key, sent, { logins: new Map([1, 2, 3, 4, 5].map((actor) => [actor, `user${actor}`])) }));
    if (result !== "accepted") return result;
    if (event.type === "observeClock") w.clock.set(event.now * 1000);
    if (event.type === "observeEligibility") w.facts.eligibility = event.eligibility;
    if (event.type === "observeRevision") {
      w.facts.current = event.revision;
      await registerRevision(w, event.revision);
    }
    if (event.type === "observeSettings") await settingsTo(w, event.automatic, event.settingsSequence);
    return result;
  }
  if (decided.has(event.type)) {
    const chosen = event as Decided;
    return outcome(w, Effect.gen(function* () {
      const settlement = yield* loadSettlement(key);
      const alongside = chosen.type === "noteUnderfunded" ? yield* underfundedNotice(settlement) : [];
      return yield* settle(settlement, chosen, by, { alongside });
    }));
  }
  return chainStep(w, event, by);
};

const indexedAward = (award: Award): Award => ({ ...award, origin: "ManualAward", period: 0, index: -1, committedAt: 0, destination: "", bindingVersion: 0, paidIn: "" });

const view = (state: MonthlySettlement): MonthlySettlement => ({
  ...state,
  month: { ...state.month, coordinatorRetries: 0 },
  escrow: { ...state.escrow, awards: state.escrow.awards.filter((award) => !award.paid).map(indexedAward), months: [], releasedLeaves: [], withdrawals: [] },
});

const noticeSent = async (w: World) => {
  const found = await w.db.prepare("SELECT count(*) AS n FROM notifications WHERE event_key = ? AND recipient_github_id = ?").bind(`monthly-underfunded:${PROJECT}:${formatPeriod(w.period as Period)}`, STEWARD).all();
  return Number(found.results[0]?.n ?? 0) > 0;
};

const projected = (chain: Escrow, place: VaultPlace | undefined, escrow: Escrow): Escrow =>
  place === undefined || !chain.deployed ? chain : { ...chain, free: escrow.free, reserved: escrow.reserved, paid: escrow.paid, awards: escrow.awards };

const observed = async (w: World): Promise<MonthlySettlement> => {
  if (w.period === undefined) {
    return view({ month: { project: PROJECT, period: 0, phase: "Unopened", skip: "NoSkip", now: Math.floor(w.clock.now() / 1000), automatic: true, settingsSequence: 0, eligibility: w.facts.eligibility, revision: ZERO_REVISION,
      currentRevision: w.facts.current ?? ZERO_REVISION, cap: [0], snapshotDigest: "", exclusions: [], shares: [], proposedShares: [], total: [0], sequence: 0, changes: [], cuts: [], publicCuts: [], notices: [], latestCutAt: 0, frozenAt: 0,
      trigger: "NoTrigger", frozenSequence: 0, frozenBy: 0, obligations: [], banned: [], underfundedNotice: false, coordinatorRetries: 0 }, escrow: w.chain.escrow, headTime: w.chain.headTime });
  }
  const settlement = await run(w, loadSettlement(keyOf(w)));
  const month = settlement.state.month;
  return view({
    escrow: projected(w.chain.escrow, settlement.place, settlement.state.escrow),
    headTime: w.chain.headTime,
    month: {
      ...month,
      underfundedNotice: await noticeSent(w),
      snapshotDigest: w.digests.get(month.snapshotDigest) ?? month.snapshotDigest,
      revision: { ...modelled(month.revision), number: w.numbers.get(month.revision.number) ?? month.revision.number },
      currentRevision: modelled(month.currentRevision),
    },
  });
};

const close = async (previous: World | undefined) => {
  if (previous === undefined) return;
  await previous.runtime.dispose();
  await previous.mf.dispose();
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    const previous = world;
    world = undefined;
    await close(previous);
  },
  dispatch: (_key, event: Event, by) => dispatch(event, typeof by === "string" ? by : ""),
  observe: async () => observed(await current()),
  [Symbol.asyncDispose]: () => close(world),
};

export const options: Options = { keys: ["eliza"], walks: 0, view };
