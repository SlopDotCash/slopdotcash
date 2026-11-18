// spec/security/cases.md, "A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, type Statement, d1, sql } from "@repo/platform/d1";
import { Refused, outbound } from "@repo/platform/http";
import { Roles } from "@repo/platform/roles";
import { database, migrate, startWorker, storage } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Authority as RepositoryAuthority, type ProjectView, Registry, Restrictions } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/security__cases.conformance.ts";
import type { Authority, Award, Event, PrivateCase, ProjectClearance } from "../../gen/security__cases.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { AwardClearances } from "../../src/cases/clearance.vibe";
import { caseRecord } from "../../src/cases/rows.vibe";
import { claimed, performed } from "../../src/cases/routes.vibe";
import { type Starter, triageFinished, triageStarted } from "../../src/cases/triage.vibe";
import { reportBucket } from "../../src/privacy/reads.vibe";
import { ReportingPrograms } from "../../src/receipt/program.vibe";
import { caseInsert, slopReceipt } from "../../src/receipt/statements.vibe";
import { allowedAmount } from "../../src/terms/receipt.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

type Outcome = "accepted" | "refused";

const project = "cases-conformance";
const repository = "slop-test/cases";
const mf = startWorker({ d1: { SLOP_DB: "cases-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const noAuthority: Authority = { epoch: 0, technical: [], financial: [], moderators: [], banned: [], relatedParties: [], programRestricted: false };

let generation = 0;
let snapshot: Authority = noAuthority;
let clearance: ProjectClearance = { caseRevision: 0, firstQualifying: false, rootCauseFree: false, rail: "NoRail" };
let terms: Receive["terms"] | undefined;
const cases = new Map<string, string>();
const starters = new Map<string, Starter>();

const base = () => epoch + generation * span;
const githubId = (actor: number) => String(5_000_000 + generation * 100 + actor);
const actorOf = (by: unknown) => ({ githubId: githubId(Number(by ?? 0)), login: `member-${githubId(Number(by ?? 0))}`, actorId: `actor-${githubId(Number(by ?? 0))}` });
const ids = (actors: ReadonlyArray<number>) => actors.map(githubId);

const fixture: ProjectView = {
  projectId: project, revision: 1, manifestSha256: "a".repeat(64), rowStatus: "Active", manifestStatus: "Active", listingTier: "Community",
  retirement: "NotRetired", stewardGithubId: "1", stewardAccount: "UserSteward", listing: { fromApplication: false }, repositories: [{ id: "2001", nodeId: "R_cases", fullName: repository, integrationBranch: "main", aliases: [] }], closureConsent: false,
};

const ports = Layer.mergeAll(
  Layer.succeed(Registry, { project: (projectId) => Effect.succeed({ ...fixture, projectId }), byRepository: () => Effect.succeed(undefined), byPath: () => Effect.succeed(undefined), active: () => Effect.succeed([fixture]), fence: () => Effect.succeed(sql`1`) }),
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
    current: () => Effect.succeed({
      repository,
      approvers: { technical: ids(snapshot.technical), financial: ids(snapshot.financial), dispute: ids(snapshot.relatedParties.filter((id) => !snapshot.technical.includes(id) && !snapshot.financial.includes(id))), sponsor: [] },
      status: "open", closesAt: undefined, acknowledgeHours: 0,
    }),
    atReceipt: () => Effect.succeed(terms === undefined ? undefined : { revision: terms.revision, publishedAt: new Date(base() + terms.publishedAt).toISOString(), terms: frozenOf(terms), excludedFindings: terms.excludedFindings }),
    unbanned: (id) => Effect.succeed(ids(snapshot.banned).includes(id) ? sql`0` : sql`1`),
  }),
  Layer.succeed(AwardClearances, {
    commitment: (request) => Effect.succeed({
      clearance,
      before: request.proposal || clearance.rail !== "DirectRail" ? [] : [sql`INSERT INTO security_direct_awards (case_id, project_id, root_cause_key, terms, gross_base, approved_at) VALUES (${request.caseId}, ${request.projectId}, ${request.rootCauseKey}, ${JSON.stringify(request.terms)}, ${request.grossMinor}, ${request.at})`],
      require: sql`1`,
      unmet: { status: 409, error: "award_changed", message: "The award can no longer be approved. Reload the case." },
    }),
  }),
);

const pointerRevision = 1000;
const projectOf = () => `${project}-g${generation}`;

function manifestOf(projectId: string, lines: ReadonlyArray<string>) {
  const scope = { includedAssets: [repository], severityRubric: "Conformance severity rubric.", lossDefinition: "Conformance loss definition.", excludedFindings: lines };
  return JSON.stringify({ id: projectId, status: "active", ...(lines.length === 0 ? {} : { securityBounty: { scope } }) });
}

const storedRevisions = new Map<string, number>();

function storedTerms(receipt: Receive["terms"]): Receive["terms"] {
  if (receipt.revision <= 0) return receipt;
  const lengths = receipt.paidTerms ? receipt.excludedFindings : [];
  const variant = `${receipt.revision}:${receipt.publishedAt}:${lengths.join(",")}`;
  const revision = storedRevisions.get(variant) ?? storedRevisions.size + 1;
  storedRevisions.set(variant, revision);
  return { ...receipt, revision };
}

async function seeded(receipt?: Receive["terms"]): Promise<string> {
  const projectId = projectOf();
  const at = new Date(epoch).toISOString();
  const pointer = manifestOf(projectId, []);
  const lines = receipt?.paidTerms ? receipt.excludedFindings.map((length, index) => String(index).padEnd(length, "x")) : [];
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,'Cases conformance',?)").bind(projectId, pointerRevision, pointer, "a".repeat(64), at),
    db.prepare("INSERT OR IGNORE INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',?,?,?,?,?)").bind(projectId, pointerRevision, pointer, "a".repeat(64), at, at),
    ...(receipt === undefined || receipt.revision <= 0 ? [] : [
      db.prepare("INSERT OR IGNORE INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,'Cases conformance terms',?)").bind(projectId, receipt.revision, manifestOf(projectId, lines), "b".repeat(64), new Date(base() + receipt.publishedAt).toISOString()),
    ]),
  ]);
  return projectId;
}

const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, reportBucket(await storage(mf, "PRIVATE_TRACES")), clock.layer, receiptNotices, ports, Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto))));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<Outcome> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (error instanceof Refused) return "refused";
  if (typeof error === "object" && error !== null && "_tag" in error && (error._tag === "Rejected" || error._tag === "NotAnEvent" || error._tag === "TriageClosed")) return "refused";
  throw error;
}

type Receive = Extract<Event, { type: "receive" }>;

const minor = (amount: ReadonlyArray<number>) => BigInt(amount.reduceRight((text, limb) => `${text}${String(limb).padStart(3, "0")}`, "")).toString();

function frozenOf(terms: Extract<Event, { type: "receive" }>["terms"]) {
  if (!terms.paidTerms) return undefined;
  const gross = minor(terms.offeredGross);
  const full = terms.split === "FullAward";
  const value = BigInt(gross);
  return {
    grossMinor: gross, researcherMinor: full ? gross : ((value / 4n) * 3n).toString(), slopMinor: full ? "0" : (value / 4n).toString(),
    ...(full ? { split: { researcherBasisPoints: 10000, slopBasisPoints: 0 } } : {}),
    currency: terms.asset, decimals: 6, capacityAwards: 3,
    ...(terms.eligibility === "InScopeSecurity" ? { eligibility: "in-scope-security" } : {}),
    ...(terms.fundingPolicy === "AfterApproval" ? { fundingPolicy: "after-approval" } : {}),
  };
}

let idempotency = 0;
const key = () => `cases-driver-${generation}-${++idempotency}`.padEnd(20, "0");

async function revisionOf(caseId: string) {
  return (await runtime.runPromise(caseRecord(caseId)))?.row.revision ?? 0;
}

async function act(caseKey: string, caseId: string, by: unknown, action: string, fields: Readonly<Record<string, unknown>> = {}): Promise<Outcome> {
  const done = performed(actorOf(by), caseId, { action, expectedRevision: await revisionOf(caseId), idempotencyKey: key(), ...fields });
  return outcome(Effect.map(done, (result) => {
    if (result.kind === "triage") starters.set(caseKey, result.starter);
  }));
}

async function priorAttempts(caseId: string, appealRevision: number) {
  const [found] = (await db.prepare("SELECT COUNT(*) AS attempts FROM security_appeal_triages WHERE case_id=? AND appeal_revision<?").bind(caseId, appealRevision).all()).results;
  return Number(found?.attempts ?? 0);
}

const severityText = { Critical: "critical", High: "high", Medium: "medium", Low: "low", Informational: "informational", SeverityUnresolved: "unresolved", SeverityUnset: "unresolved" } as const;
const lossText = { VerifiedPotential: "verified-potential", VerifiedActual: "verified-actual", NotVerified: "not-verified", LossUnresolved: "unresolved", LossUnset: "unresolved" } as const;
const findingText = { Confirmed: "confirmed", Duplicate: "duplicate", OutOfScope: "out-of-scope", Rejected: "rejected" } as const;


function batched(statements: ReadonlyArray<Statement>) {
  return Effect.gen(function* () {
    const found = yield* D1;
    return yield* found.batch(statements);
  });
}

function existingAward(event: Receive): Award {
  if (!event.terms.paidTerms) return "NotApplicable";
  return event.history === "ImportedReservation" ? "Reserved" : event.history === "ImportedCapacityWait" ? "CapacityExhausted" : "Pending";
}

function historicalAllowed(event: Receive) {
  return event.history === "NewReceipt" || (event.terms.paidTerms && event.terms.fundingPolicy === "Prefunded"
    && (event.history === "ImportedCapacityWait" || allowedAmount(event.terms, minor(event.gross))));
}

async function existing(caseId: string, projectId: string, event: Receive, receivedAt: string): Promise<Outcome> {
  if (!historicalAllowed(event)) return "refused";
  const terms = frozenOf(event.terms);
  const award = existingAward(event);
  const reporter = { githubId: githubId(1), login: `member-${githubId(1)}` };
  const statements = [
    caseInsert({ id: caseId, projectId, repository, advisory: null, reporter, ownerGithubId: null, at: receivedAt,
      verified: { receivedAt, verifiedBy: event.source === "GithubVerified" ? "github" : "migration", policyRevision: event.terms.revision, terms, award, source: "github-verified" } }),
    ...(award === "Reserved"
      ? [sql`INSERT INTO security_award_reservations (case_id, project_id, root_cause_key, policy_revision, gross_minor, currency, reserved_at) VALUES (${caseId}, ${projectId}, ${`legacy-${caseId.replaceAll("_", "-")}`}, ${event.terms.revision}, ${minor(event.gross)}, ${event.terms.asset}, ${receivedAt})`]
      : []),
  ];
  await runtime.runPromise(batched(statements));
  return "accepted";
}

async function receive(caseKey: string, event: Receive): Promise<Outcome> {
  const caseId = `sc_cases_g${generation}_${caseKey}`;
  const submissionId = `ss_cases_g${generation}_${caseKey}`;
  const receivedAt = new Date(base() + Math.max(event.terms.receivedAt, 1)).toISOString();
  const digest = "b".repeat(64);
  const stored = { ...event, terms: storedTerms(event.terms) };
  const projectId = await seeded(stored.terms);
  const prepared = slopReceipt({
    caseId, submissionId, projectId, repository, reporter: { githubId: githubId(1), login: `member-${githubId(1)}` }, idempotencyKey: key(), marker: "d".repeat(32), receivedAt,
    policyRevision: stored.terms.revision, terms: frozenOf(stored.terms), receiptTerms: stored.terms,
    report: { key: `security-reports/${submissionId}/1-${digest}.json`, digest, bytes: 64 }, ownerGithubId: null, unbanned: sql`1`,
  });
  const fresh = event.source === "SlopReceived" && event.history === "NewReceipt";
  const result = fresh
    ? await outcome(Effect.flatMap(prepared, batched))
    : await outcome(prepared).then((valid) => valid === "accepted" ? existing(caseId, projectId, stored, receivedAt) : valid);
  if (result === "accepted") cases.set(caseKey, caseId);
  return result;
}

async function claim(caseKey: string, by: unknown): Promise<Outcome> {
  if (Number(by ?? 0) !== 1) return "refused";
  const advisory = `GHSA-${"2345"}-${String(generation % 10).replace(/[01]/u, "2").repeat(4)}-${caseKey === "first" ? "cfgh" : "jmpq"}`;
  const projectId = await seeded();
  const result = await outcome(claimed(actorOf(by), { mode: "claim", projectId, advisory, idempotencyKey: key() }));
  const [found] = (await db.prepare("SELECT id FROM security_cases WHERE project_id=? AND advisory_ghsa=? AND reporter_github_id=?").bind(projectId, advisory, githubId(1)).all()).results;
  if (result === "accepted" && typeof found?.id === "string") cases.set(caseKey, found.id);
  return result;
}

async function send(caseKey: string, event: Event, by: unknown): Promise<Outcome> {
  if (event.type === "observeAuthority") {
    if (event.snapshot.epoch <= snapshot.epoch) return "refused";
    snapshot = event.snapshot;
    return "accepted";
  }
  if ("checkedEpoch" in event && event.checkedEpoch !== snapshot.epoch) return "refused";
  if (event.type === "receive") return cases.has(caseKey) ? "refused" : receive(caseKey, event);
  if (event.type === "claim") return cases.has(caseKey) ? "refused" : claim(caseKey, by);
  const caseId = cases.get(caseKey);
  if (caseId === undefined) return "refused";
  switch (event.type) {
    case "verifyLink": {
      terms = storedTerms(event.terms);
      await seeded(terms);
      clock.set(Math.max(clock.now(), base() + event.terms.receivedAt));
      return act(caseKey, caseId, by, "verify-link", { receivedAt: new Date(base() + event.terms.receivedAt).toISOString(), confirmation: true });
    }
    case "rejectLink": return act(caseKey, caseId, by, "reject-link", { reason: "The advisory names another account." });
    case "assignTriager": return act(caseKey, caseId, by, "assign-triager", { githubId: githubId(event.actor), githubLogin: `member-${githubId(event.actor)}` });
    case "revokeTriager": return act(caseKey, caseId, by, "revoke-triager", { githubId: githubId(event.actor) });
    case "requestInformation": return act(caseKey, caseId, by, "request-information", { reason: "Show the affected amount." });
    case "reviseReport": return "refused";
    case "decide": {
      const decision = event.decision;
      if (!(decision.finding in findingText)) return "refused";
      const original = cases.get(caseKey === "first" ? "second" : "first");
      return act(caseKey, caseId, by, "decide", {
        outcome: findingText[decision.finding as keyof typeof findingText], severity: severityText[decision.severity], loss: lossText[decision.loss], inScope: decision.inScope,
        reason: "Conformance decision.", relatedParty: decision.declareRelated,
        ...(decision.rootCause > 0 ? { rootCauseKey: `root-cause-g${generation}-${caseKey}` } : {}),
        ...(decision.duplicateOf > 0 && original !== undefined ? { duplicateOf: original } : {}),
      });
    }
    case "declineAward": return act(caseKey, caseId, by, "award", { decision: "none", reason: "No award under these terms." });
    case "approveReservedAward":
    case "decideAward": {
      if (event.type === "decideAward") clearance = event.clearance;
      return act(caseKey, caseId, by, "award", { decision: "amount", reason: "Conformance award.", grossMinor: minor(event.amount), paymentDeadline: new Date(base() + span).toISOString(), confirmation: true });
    }
    case "reviewRelated": {
      clearance = event.clearance;
      return act(caseKey, caseId, by, "decide-related-party", { outcome: event.approve ? "approve" : "refuse", reason: "Independent review." });
    }
    case "appeal": return act(caseKey, caseId, by, "appeal", { reason: "The decision overlooks the attached evidence." });
    case "decideAppeal": return act(caseKey, caseId, by, "decide-appeal", { outcome: event.uphold ? "uphold" : "return", reason: "Independent appeal decision." });
    case "startTriage": {
      clock.set(base() + event.nowMs);
      const result = await outcome(triageStarted(caseId, starters.get(caseKey) ?? { kind: "automatic" }));
      if (result === "accepted") starters.delete(caseKey);
      return result;
    }
    case "finishTriage": {
      const drafted = event.result.tag === "Drafted" ? { proposedOutcome: event.result.returnCase ? "return" : "uphold", rationale: "Conformance draft.", confidence: event.result.confidencePercent / 100 } : undefined;
      const attempt = event.attempt - await priorAttempts(caseId, event.appealRevision);
      return outcome(Effect.flatMap(triageFinished({ caseId, appealRevision: event.appealRevision, attempt }, event.result, drafted), (finished) => finished ? Effect.void : Effect.fail(new Refused({ status: 409, code: "late_triage", message: "late" }))));
    }
    case "retryTriage": {
      clock.set(base() + event.nowMs);
      if ((await runtime.runPromise(caseRecord(caseId)))?.model.triage.state === "TriageQueued") return "refused";
      return act(caseKey, caseId, by, "triage-appeal");
    }
  }
}

function shape(state: PrivateCase) {
  return {
    submission: state.submission,
    receipt: state.receipt,
    award: state.award,
    appeal: state.appeal,
    related: state.related,
    relatedReview: state.relatedReview,
    triage: state.triage.state,
    appeals: state.appealHistory.map((entry) => entry.resolution),
  };
}

async function observed(caseKey: string) {
  const caseId = cases.get(caseKey);
  const record = caseId === undefined ? undefined : await runtime.runPromise(caseRecord(caseId));
  const model = record?.model;
  if (model === undefined) return shape({ ...emptyCase });
  const view = shape(model);
  return starters.get(caseKey)?.kind === "moderator" ? { ...view, triage: "TriageQueued" as const } : view;
}

const emptyCase = {
  reporter: 1, submission: "NotReceived", source: "NoSource", revision: 0, reportVersion: 0, authority: noAuthority, triagers: [], revokedTriagers: [], memberEvents: 0,
  receipt: "Received", severity: "SeverityUnset", loss: "LossUnset", inScope: false, rootCause: 0, duplicateOf: 0, award: "NotApplicable", grossChosen: [0], commitment: "NoCommitment",
  payment: "PaymentNotApplicable", related: "NotAssessed", relatedReview: "ReviewNotApplicable", deciders: [], appeal: "NoAppeal", appealFrom: "Received", appealHistory: [],
  triage: { state: "NoTriage", appealRevision: 0, attempt: 0, startedAt: 0, escalated: false, belowFloor: false, returnDraft: false },
} as unknown as PrivateCase;

export const driver: Driver<ReturnType<typeof shape>> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    snapshot = noAuthority;
    terms = undefined;
    storedRevisions.clear();
    cases.clear();
    starters.clear();
    clock.set(base());
  },
  dispatch: (caseKey, event, by) => send(caseKey, event, by),
  observe: (caseKey) => observed(caseKey),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof shape>> = { view: shape, keys: ["first", "second"], walks: 3, steps: 10 };
