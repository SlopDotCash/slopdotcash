// spec/security/bounty.md, "Cases of one project share holds, funds and the route observation"; spec/security/bounty.md, "The earliest human-confirmed eligible report of a root cause qualifies first"; spec/security/bounty.md, "A vault reservation needs a fresh finalized snapshot that still covers the award"; spec/security/bounty.md, "A finalized vault payout settles its hold and keeps the record"; spec/security/bounty.md, "One root cause holds at most one proposal or award obligation"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, type Statement, d1, sql } from "@repo/platform/d1";
import { Refused, outbound } from "@repo/platform/http";
import { Roles } from "@repo/platform/roles";
import { database, migrate, startWorker, storage } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Authority as RepositoryAuthority, type ProjectView, Registry, Restrictions } from "@repo/ports/backend";
import { VaultTotals, type VaultTotalsView } from "@repo/ports/settlement";
import type { Driver, Options } from "../../gen/security__bounty.conformance.ts";
import type { Bounty, Event, HoldKind, RouteObservation } from "../../gen/security__bounty.ts";
import type { Authority, PrivateCase } from "../../gen/security__cases.ts";
import type { ReceiptTerms } from "../../gen/security__terms.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { type DirectRoute, DirectRoutes, awardClearancesLive } from "../../src/bounty/store.vibe";
import { caseRecord } from "../../src/cases/rows.vibe";
import { performed } from "../../src/cases/routes.vibe";
import { reportBucket } from "../../src/privacy/reads.vibe";
import { ReportingPrograms } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

type Outcome = "accepted" | "refused";

const project = "bounty-conformance";
const repository = "slop-test/bounty";
const usdcBase = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const foreignAsset = "0x00000000000000000000000000000000000000ff";
const bountyVault = "0x00000000000000000000000000000000000000aa";
const mf = startWorker({ d1: { SLOP_DB: "bounty-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const noAuthority: Authority = { epoch: 0, technical: [], financial: [], moderators: [], banned: [], relatedParties: [], programRestricted: false };

let generation = 0;
let snapshot: Authority = noAuthority;
let clockMs = 3;
let funds: { readonly view: VaultTotalsView | undefined; readonly observedAt: number } = { view: undefined, observedAt: 0 };
let route: { readonly direct: DirectRoute | undefined; readonly observedAt: number } = { direct: undefined, observedAt: 0 };
const cases = new Map<number, string>();
let keys = 0;

const base = () => epoch + generation * span;
const at = (ms: number) => new Date(base() + ms).toISOString();
const githubId = (actor: number) => String(7_000_000 + generation * 100 + actor);
const actorOf = (by: unknown) => ({ githubId: githubId(Number(by ?? 0)), login: `member-${githubId(Number(by ?? 0))}`, actorId: `actor-${githubId(Number(by ?? 0))}` });
const ids = (actors: ReadonlyArray<number>) => actors.map(githubId);
const key = () => `bounty-driver-${generation}-${++keys}`.padEnd(24, "0");
const minor = (amount: ReadonlyArray<number>) => BigInt(amount.reduceRight((text, limb) => `${text}${String(limb).padStart(3, "0")}`, "")).toString();

const fixture: ProjectView = {
  projectId: project, revision: 1, manifestSha256: "a".repeat(64), rowStatus: "Active", manifestStatus: "Active", listingTier: "Community",
  retirement: "NotRetired", stewardGithubId: "1", repositories: [{ id: "4001", nodeId: "R_bounty", fullName: repository, integrationBranch: "main", aliases: [] }], closureConsent: false,
};

const ports = Layer.mergeAll(
  Layer.succeed(Registry, { project: () => Effect.succeed(fixture), byRepository: () => Effect.succeed(undefined), byPath: () => Effect.succeed(undefined), active: () => Effect.succeed([fixture]), fence: () => Effect.succeed(sql`1`) }),
  Layer.succeed(RepositoryAuthority, { repository: (read) => Effect.succeed({ ...read, permission: "PermissionDenied" as const, installation: "Installed" as const }) }),
  Layer.succeed(Restrictions, {
    account: (id) => Effect.succeed({ banned: ids(snapshot.banned).includes(id) }),
    project: () => Effect.succeed({ restricted: snapshot.programRestricted }),
    fence: () => Effect.succeed(sql`SELECT 1`),
    unbanned: (id) => Effect.succeed(ids(snapshot.banned).includes(id) ? sql`0` : sql`1`),
  }),
  Layer.succeed(Roles, {
    has: (id, role) => Effect.succeed(role === "moderator" && ids(snapshot.moderators).includes(id)),
    isTeam: (id) => Effect.succeed(ids(snapshot.moderators).includes(id)),
    snapshot: (role) => Effect.succeed(role === "moderator" ? ids(snapshot.moderators) : []),
  }),
  Layer.succeed(ReportingPrograms, {
    current: () => Effect.succeed({ repository, approvers: { technical: ids(snapshot.technical), financial: ids(snapshot.financial), dispute: [], sponsor: [] }, status: "open", closesAt: undefined, acknowledgeHours: 0 }),
    atReceipt: () => Effect.succeed(undefined),
    unbanned: (id) => Effect.succeed(ids(snapshot.banned).includes(id) ? sql`0` : sql`1`),
  }),
  Layer.succeed(VaultTotals, { of: () => Effect.succeed(funds.view) }),
  Layer.succeed(DirectRoutes, { route: () => Effect.succeed(route.direct) }),
);

await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Bounty conformance',?)").bind(project, JSON.stringify({ id: project }), "a".repeat(64), new Date(epoch).toISOString()),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, JSON.stringify({ id: project }), "a".repeat(64), new Date(epoch).toISOString(), new Date(epoch).toISOString()),
]);

const services = Layer.mergeAll(d1(db), webCrypto, reportBucket(await storage(mf, "PRIVATE_TRACES")), clock.layer, receiptNotices, ports, Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto)));
const runtime = ManagedRuntime.make(Layer.provideMerge(awardClearancesLive, services));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<Outcome> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (error instanceof Refused) return "refused";
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return "refused";
  throw error;
}

function batched(statements: ReadonlyArray<Statement>) {
  return Effect.gen(function* () {
    const found = yield* D1;
    return yield* found.batch(statements);
  });
}

function frozenOf(terms: ReceiptTerms) {
  if (!terms.paidTerms) return undefined;
  const gross = minor(terms.offeredGross);
  const full = terms.split === "FullAward";
  const value = BigInt(gross);
  return {
    grossMinor: gross, researcherMinor: full ? gross : ((value / 4n) * 3n).toString(), slopMinor: full ? "0" : (value / 4n).toString(),
    ...(full ? { split: { researcherBasisPoints: 10000, slopBasisPoints: 0 } } : {}),
    currency: "USDC", decimals: 6, network: "base", capacityAwards: 3,
    ...(terms.eligibility === "InScopeSecurity" ? { eligibility: "in-scope-security" } : {}),
    ...(terms.fundingPolicy === "AfterApproval" ? { fundingPolicy: "after-approval" } : {}),
  };
}

const shellAsset = (asset: string) => asset === "usdc" ? "USDC" : asset;

async function receive(id: number, event: Extract<Event, { type: "receive" }>): Promise<Outcome> {
  if (cases.has(id) || (id !== 1 && id !== 2)) return "refused";
  const caseId = `sc_bounty_g${generation}_${id}`;
  const submissionId = `ss_bounty_g${generation}_${id}`;
  const digest = "b".repeat(64);
  const terms: ReceiptTerms = { ...event.terms, asset: shellAsset(event.terms.asset), receivedAt: base() + event.terms.receivedAt, publishedAt: base() + event.terms.publishedAt };
  const result = await outcome(Effect.flatMap(slopReceipt({
    caseId, submissionId, projectId: project, repository, reporter: { githubId: githubId(1), login: `member-${githubId(1)}` }, idempotencyKey: key(), marker: "d".repeat(32), receivedAt: at(Math.max(event.terms.receivedAt, 1)),
    policyRevision: event.terms.revision, terms: frozenOf(event.terms), receiptTerms: terms,
    report: { key: `security-reports/${submissionId}/1-${digest}.json`, digest, bytes: 64 }, ownerGithubId: null, unbanned: sql`1`,
  }), batched));
  if (result === "accepted") cases.set(id, caseId);
  return result;
}

async function act(id: number, by: unknown, action: string, fields: Readonly<Record<string, unknown>> = {}): Promise<Outcome> {
  const caseId = cases.get(id);
  if (caseId === undefined) return "refused";
  const revision = (await runtime.runPromise(caseRecord(caseId)))?.row.revision ?? 0;
  return outcome(performed(actorOf(by), caseId, { action, expectedRevision: revision, idempotencyKey: key(), ...fields }));
}

const severityText = { Critical: "critical", High: "high", Medium: "medium", Low: "low", Informational: "informational", SeverityUnresolved: "unresolved", SeverityUnset: "unresolved" } as const;
const lossText = { VerifiedPotential: "verified-potential", VerifiedActual: "verified-actual", NotVerified: "not-verified", LossUnresolved: "unresolved", LossUnset: "unresolved" } as const;
const findingText = { Confirmed: "confirmed", Duplicate: "duplicate", OutOfScope: "out-of-scope", Rejected: "rejected" } as const;

async function settle(id: number, receipt: Extract<Event, { type: "settleVaultHold" }>["receipt"]): Promise<Outcome> {
  const caseId = cases.get(id);
  if (caseId === undefined || !receipt.finalized || receipt.receipt <= 0 || funds.view?.freeBaseUnits === undefined) return "refused";
  const [held] = (await db.prepare("SELECT r.gross_minor FROM security_award_reservations r WHERE r.case_id = ? AND NOT EXISTS (SELECT 1 FROM security_settlements s WHERE s.case_id = r.case_id)").bind(caseId).all()).results;
  if (held?.gross_minor !== minor(receipt.gross)) return "refused";
  const obligation = `so_bounty_g${generation}_${id}`;
  const source = String(generation * 1000 + receipt.receipt).padStart(64, "0");
  await db.batch([
    db.prepare("INSERT INTO security_payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,'base',?,?,6,?,'0',?,'paid',?,?)")
      .bind(obligation, project, githubId(1), "base-mainnet", bountyVault, usdcBase, minor(receipt.gross), source, at(funds.observedAt), `0x${source}`),
    db.prepare("INSERT INTO security_settlements(case_id,obligation_id,source_digest,network,vault,asset,asset_decimals,gross_base,fee_base,reporter_github_id,approved_by,approved_at,case_revision,deployment) VALUES(?,?,?,?,?,?,6,?,'0',?,?,?,1,'{}')")
      .bind(caseId, obligation, source, "base-mainnet", bountyVault, usdcBase, minor(receipt.gross), githubId(1), githubId(2), at(funds.observedAt)),
  ]);
  const free = BigInt(funds.view.freeBaseUnits);
  const paid = BigInt(minor(receipt.gross));
  funds = { ...funds, view: { ...funds.view, freeBaseUnits: (free >= paid ? free - paid : 0n).toString() } };
  return "accepted";
}

async function send(event: Event, by: unknown): Promise<Outcome> {
  switch (event.type) {
    case "observeAuthority": {
      if (event.snapshot.epoch <= snapshot.epoch) return "refused";
      snapshot = event.snapshot;
      return "accepted";
    }
    case "advanceClock": {
      if (event.nowMs <= clockMs) return "refused";
      clockMs = event.nowMs;
      clock.set(base() + event.nowMs);
      return "accepted";
    }
    case "observeFunds": {
      if (event.funds.observedAt <= funds.observedAt || event.funds.observedAt > clockMs) return "refused";
      funds = {
        observedAt: event.funds.observedAt,
        view: { network: "Base", vault: bountyVault, asset: event.funds.asset === "usdc" ? usdcBase : foreignAsset, freeBaseUnits: minor(event.funds.free), observedAt: at(event.funds.observedAt), stale: !event.funds.finalized },
      };
      return "accepted";
    }
    case "observeRoute": {
      const next: RouteObservation = event.route;
      if (next.observedAt <= route.observedAt || next.observedAt > clockMs) return "refused";
      route = { observedAt: next.observedAt, direct: next.asset === "usdc" ? { qualified: next.qualified, observedAt: at(next.observedAt) } : undefined };
      return "accepted";
    }
    case "receive": return receive(event.id, event);
    case "settleVaultHold": return settle(event.id, event.receipt);
    case "appeal": return act(event.id, by, "appeal", { reason: "The decision overlooks the attached evidence." });
    default: break;
  }
  if (event.checkedEpoch !== snapshot.epoch) return "refused";
  switch (event.type) {
    case "decide": {
      const decision = event.decision;
      if (!(decision.finding in findingText)) return "refused";
      const original = cases.get(event.id === 1 ? 2 : 1);
      return act(event.id, by, "decide", {
        outcome: findingText[decision.finding as keyof typeof findingText], severity: severityText[decision.severity], loss: lossText[decision.loss], inScope: decision.inScope,
        reason: "Conformance decision.", relatedParty: decision.declareRelated,
        ...(decision.rootCause > 0 ? { rootCauseKey: `root-cause-g${generation}-${decision.rootCause}` } : {}),
        ...(decision.duplicateOf > 0 && original !== undefined ? { duplicateOf: original } : {}),
      });
    }
    case "declineAward": return act(event.id, by, "award", { decision: "none", reason: "No award under these terms." });
    case "decideAward": return act(event.id, by, "award", { decision: "amount", reason: "Conformance award.", grossMinor: minor(event.amount), paymentDeadline: at(span), confirmation: true });
    case "reviewRelated": return act(event.id, by, "decide-related-party", { outcome: event.approve ? "approve" : "refuse", reason: "Independent review." });
    case "decideAppeal": return act(event.id, by, "decide-appeal", { outcome: event.uphold ? "uphold" : "return", reason: "Independent appeal decision." });
  }
}

function caseShape(state: PrivateCase) {
  return { submission: state.submission, receipt: state.receipt, award: state.award, commitment: state.commitment, relatedReview: state.relatedReview, appeal: state.appeal };
}

function shape(state: Bounty) {
  return {
    first: caseShape(state.first),
    second: caseShape(state.second),
    holds: state.holds.map((hold) => `${hold.caseId}:${hold.kind}`).sort(),
  };
}

const emptyCase = {
  submission: "NotReceived", receipt: "Received", award: "NotApplicable", commitment: "NoCommitment", relatedReview: "ReviewNotApplicable", appeal: "NoAppeal",
} as const;

async function observedCase(id: number) {
  const caseId = cases.get(id);
  const record = caseId === undefined ? undefined : await runtime.runPromise(caseRecord(caseId));
  if (record === undefined || caseId === undefined) return { view: emptyCase, holds: [] as string[] };
  const model = record.model;
  const kinds: HoldKind[] = [];
  if (record.row.reserved === 1) kinds.push("VaultHold");
  if (record.row.direct === 1) kinds.push("DirectHold");
  if (model.commitment === "FullAwardHeld") kinds.push("FullAwardHold");
  if (model.relatedReview === "ReviewPending") kinds.push("ProposalHold");
  return { view: caseShape(model), holds: kinds.map((kind) => `${id}:${kind}`) };
}

async function observed() {
  const first = await observedCase(1);
  const second = await observedCase(2);
  return { first: first.view, second: second.view, holds: [...first.holds, ...second.holds].sort() };
}

export const driver: Driver<ReturnType<typeof shape>> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    snapshot = noAuthority;
    clockMs = 3;
    funds = { view: undefined, observedAt: 0 };
    route = { direct: undefined, observedAt: 0 };
    cases.clear();
    clock.set(base() + clockMs);
  },
  dispatch: (_key, event, by) => send(event, by),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof shape>> = { view: shape, keys: ["project"], walks: 3, steps: 10 };
