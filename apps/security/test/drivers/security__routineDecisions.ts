// spec/security/routineDecisions.md, "The pass reads only an unappealed undecided report once per case revision and mode"; spec/security/routineDecisions.md, "Two independent calls must agree before a close, and a plausible loss of funds closes nothing"; spec/security/routineDecisions.md, "Duplicates, published lines and the proof clock close; a report on GitHub and every hold go to the owner"; spec/security/routineDecisions.md, "The reporter appeals a routine close once, to the owner, and the pass never reads the report again"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import type { ExecutionContext } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { D1, type Statement, d1, sql } from "@repo/platform/d1";
import { Refused, outbound } from "@repo/platform/http";
import { Roles } from "@repo/platform/roles";
import { database, migrate, startWorker, storage } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Execution } from "@repo/platform/worker";
import { Authority as RepositoryAuthority, ProjectParticipation, type ProjectView, Registry, Restrictions, SubmissionFeeRates } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/security__routineDecisions.conformance.ts";
import type { Event, Observation, Routine } from "../../gen/security__routineDecisions.ts";
import type { ReceiptTerms } from "../../gen/security__terms.ts";
import { routinePromptRevision } from "../../src/analysis/prompts.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { caseExclusions } from "../../src/assessment/store.vibe";
import { AwardClearances } from "../../src/cases/clearance.vibe";
import { caseRecord } from "../../src/cases/rows.vibe";
import { performed } from "../../src/cases/routes.vibe";
import { reportDepositSettings } from "../../src/deposit/settings.vibe";
import { objectKey } from "../../src/intake/attempt.vibe";
import { revisionEvidence } from "../../src/intake/revision.vibe";
import { caseOf, caseStanding, submission } from "../../src/intake/rows.vibe";
import { githubNumber, reportBucket } from "../../src/privacy/reads.vibe";
import { ReportingPrograms } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { type CallAudit, type DecisionFacts, recorded, routineAt } from "../../src/routine/store.vibe";
import { type ActiveMode, severityOfRank } from "../../src/routine/tables.ts";
import { screeningReason } from "../../src/screening/run.vibe";
import { claimOf, claimed, finished, replaced, screeningAt } from "../../src/screening/store.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

type Outcome = "accepted" | "refused";

const repository = "slop-test/routine";
const mf = startWorker({ d1: { SLOP_DB: "routine-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const staff = { technical: [2, 3], financial: [5], moderators: [4, 7] } as const;
const standard: ReceiptTerms = { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, scoped: true, fundingPolicy: "AfterApproval", eligibility: "InScopeSecurity", offeredGross: [100], split: "StandardSplit", asset: "usdc", excludedFindings: [3] };
const closingLine = "Conformance published line.";
const frozen = { grossMinor: "100", researcherMinor: "75", slopMinor: "25", currency: "usdc", decimals: 6, capacityAwards: 3, eligibility: "in-scope-security", fundingPolicy: "after-approval" };
const proposedReason = "Conformance screening proposal.";

let generation = 0;
let mode: Routine["mode"] = "DryRun";
let nowMs = standard.receivedAt;
let proofFile = false;
let runId = 0;
let keys = 0;
let entry: { readonly caseId: string; readonly submissionId: string; readonly earlierId: string } | undefined;

const base = () => epoch + generation * span;
const time = (value: number) => base() + value;
const untime = (value: number) => (value > 0 ? value - base() : value);
const githubId = (actor: number) => String(8_000_000 + generation * 100 + actor);
const ids = (actors: ReadonlyArray<number>) => actors.map(githubId);
const actorOf = (by: unknown) => ({ githubId: githubId(Number(by ?? 0)), login: `member-${githubId(Number(by ?? 0))}`, actorId: `actor-${githubId(Number(by ?? 0))}` });
const key = () => `routine-driver-${generation}-${++keys}`.padEnd(24, "0");
const projectOf = () => `routine-conformance-g${generation}`;
const hexOf = (digest: string) => [...new TextEncoder().encode(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64);

const fixture: ProjectView = {
  projectId: "routine-conformance", revision: 1, manifestSha256: "a".repeat(64), rowStatus: "Active", manifestStatus: "Active", listingTier: "Community",
  retirement: "NotRetired", stewardGithubId: "1", stewardAccount: "UserSteward", listing: { fromApplication: false }, repositories: [{ id: "5001", nodeId: "R_routine", fullName: repository, integrationBranch: "main", aliases: [] }], closureConsent: false,
};

const ports = Layer.mergeAll(
  Layer.succeed(Registry, { project: (projectId) => Effect.succeed({ ...fixture, projectId }), byRepository: () => Effect.succeed(undefined), byPath: () => Effect.succeed(undefined), active: () => Effect.succeed([fixture]), pausedProjects: () => Effect.succeed([]), appendVaultRegistration: () => Effect.die(new Error("this driver registers no vault")), fence: () => Effect.succeed(sql`1`) }),
  Layer.succeed(RepositoryAuthority, { repository: (read) => Effect.succeed({ ...read, permission: "PermissionDenied" as const, installation: "Installed" as const }) }),
  Layer.succeed(Restrictions, { account: () => Effect.succeed({ banned: false }), project: () => Effect.succeed({ restricted: false }), fence: () => Effect.succeed(sql`SELECT 1`), unbanned: () => Effect.succeed(sql`1`) }),
  Layer.succeed(Roles, {
    has: (id, role) => Effect.succeed(role === "moderator" && ids(staff.moderators).includes(id)),
    isTeam: (id) => Effect.succeed(ids(staff.moderators).includes(id)),
    snapshot: (role) => Effect.succeed(role === "moderator" ? ids(staff.moderators) : []),
    ownerSession: () => Effect.succeed(undefined),
  }),
  Layer.succeed(ReportingPrograms, {
    current: () => Effect.succeed({ repository, approvers: { technical: ids(staff.technical), financial: ids(staff.financial), dispute: [], sponsor: [] }, status: "open", closesAt: undefined, acknowledgeHours: 0 }),
    atReceipt: () => Effect.succeed({ revision: standard.revision, publishedAt: new Date(time(standard.publishedAt)).toISOString(), terms: frozen, scoped: standard.scoped, excludedFindings: standard.excludedFindings }),
    unbanned: () => Effect.succeed(sql`1`),
  }),
  Layer.succeed(AwardClearances, {
    commitment: () => Effect.succeed({
      clearance: { caseRevision: 0, firstQualifying: false, rootCauseFree: false, rail: "NoRail" },
      before: [],
      require: sql`1`,
      unmet: { status: 409, error: "award_changed", message: "The award can no longer be approved. Reload the case." },
    }),
  }),
  Layer.succeed(SubmissionFeeRates, { all: () => Effect.succeed([]), newest: () => Effect.succeed(null), append: () => Effect.die(new Error("this driver appends no rate")) }),
  Layer.succeed(ProjectParticipation, { participated: () => Effect.succeed(false) }),
  reportDepositSettings(undefined),
);

const pending: Array<Promise<unknown>> = [];
const execution: ExecutionContext = { waitUntil: (work) => { pending.push(work); } };
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, reportBucket(await storage(mf, "PRIVATE_TRACES")), clock.layer, receiptNotices, ports, Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto)), Layer.succeed(Execution, { context: execution })));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<Outcome> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (error instanceof Refused) return "refused";
  if (typeof error === "object" && error !== null && "_tag" in error && ["Rejected", "NotAnEvent", "ReplacementLost", "ScreeningMissing", "Conflict"].includes(String(error._tag))) return "refused";
  throw error;
}

function batched(statements: ReadonlyArray<Statement>) {
  return Effect.gen(function* () {
    const found = yield* D1;
    return yield* found.batch(statements);
  });
}

function manifestOf(projectId: string) {
  const scope = { includedAssets: [repository], severityRubric: "Conformance severity rubric.", lossDefinition: "Conformance loss definition.", excludedFindings: standard.excludedFindings.map((length, index) => String(index).padEnd(length, "x")) };
  return JSON.stringify({ id: projectId, status: "active", securityBounty: { scope } });
}

async function received(caseId: string, submissionId: string, reporter: string, digest: string) {
  await runtime.runPromise(Effect.flatMap(slopReceipt({
    caseId, submissionId, projectId: projectOf(), repository, reporter: { githubId: reporter, login: `member-${reporter}` }, idempotencyKey: key(), marker: "e".repeat(32),
    receivedAt: new Date(time(standard.receivedAt)).toISOString(), policyRevision: standard.revision, terms: frozen,
    receiptTerms: { ...standard, publishedAt: time(standard.publishedAt), receivedAt: time(standard.receivedAt) },
    report: { key: objectKey(submissionId, 1, digest), digest, bytes: 64 }, ownerGithubId: null, unbanned: sql`1`,
  }), batched));
}

async function entryOf() {
  if (entry !== undefined) return entry;
  const projectId = projectOf();
  const publishedAt = new Date(time(standard.publishedAt)).toISOString();
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Routine conformance',?)").bind(projectId, manifestOf(projectId), "a".repeat(64), publishedAt),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(projectId, manifestOf(projectId), "a".repeat(64), publishedAt, publishedAt),
  ]);
  clock.set(time(standard.receivedAt));
  const earlierId = `sc_routine_g${generation}_earlier`;
  await received(earlierId, `ss_routine_g${generation}_earlier`, githubId(9), hexOf("earlier"));
  const caseId = `sc_routine_g${generation}_report`;
  const submissionId = `ss_routine_g${generation}_report`;
  await received(caseId, submissionId, githubId(1), hexOf("original"));
  await db.prepare("INSERT INTO security_routine_runs(mode, source, started_at) VALUES('dry_run', 'admin', ?)").bind(new Date(time(standard.receivedAt)).toISOString()).run();
  const [run] = (await db.prepare("SELECT MAX(id) AS id FROM security_routine_runs").all()).results;
  runId = Number(run?.id ?? 0);
  entry = { caseId, submissionId, earlierId };
  return entry;
}

const activeMode = (): ActiveMode => (mode === "Live" ? "live" : "dry_run");

const answered: ReadonlyArray<CallAudit> = [
  { provider: "surplus", model: "conformance-first", promptRevision: routinePromptRevision, state: "answered" },
  { provider: "surplus", model: "conformance-second", promptRevision: routinePromptRevision, state: "answered" },
];

function factsOf(earlierId: string, found: Observation | undefined): DecisionFacts {
  const facts = { runId, duplicateOf: earlierId, exclusionLine: closingLine, missing: [], promptRevision: routinePromptRevision };
  if (found === undefined) return { ...facts, rank: { lossPlausible: null, severity: null, proofPresent: null }, calls: answered.map((call) => ({ ...call, state: "failed" as const })) };
  if (found.tag !== "Calls") return { ...facts, rank: { lossPlausible: null, severity: null, proofPresent: null }, calls: [] };
  const { first, second } = found;
  return {
    ...facts,
    rank: { lossPlausible: first.lossPlausible || second.lossPlausible, severity: severityOfRank(Math.max(first.severity, second.severity)), proofPresent: proofFile || (first.proofPresent && second.proofPresent) },
    calls: answered,
  };
}

async function pass(event: Extract<Event, { type: "decideReport" | "failCalls" }>): Promise<Outcome> {
  if (mode === "Off") return "refused";
  const { caseId, earlierId } = await entryOf();
  const current = await runtime.runPromise(routineAt(caseId, activeMode(), time(nowMs)));
  clock.set(time(nowMs));
  const facts = factsOf(earlierId, event.type === "decideReport" ? event.found : undefined);
  const done = await runtime.runPromise(recorded(caseId, activeMode(), { revision: current.routine.privateCase.revision, nowMs: time(nowMs), proofFile }, event, facts));
  return done ? "accepted" : "refused";
}

async function act(by: unknown, action: string, fields: Readonly<Record<string, unknown>> = {}): Promise<Outcome> {
  const { caseId } = await entryOf();
  clock.set(time(nowMs));
  const revision = (await runtime.runPromise(caseRecord(caseId)))?.row.revision ?? 0;
  return outcome(performed(actorOf(by), caseId, { action, expectedRevision: revision, idempotencyKey: key(), ...fields }));
}

const severityText = { Critical: "critical", High: "high", Medium: "medium", Low: "low", Informational: "informational", SeverityUnresolved: "unresolved", SeverityUnset: "unresolved" } as const;
const lossText = { VerifiedPotential: "verified-potential", VerifiedActual: "verified-actual", NotVerified: "not-verified", LossUnresolved: "unresolved", LossUnset: "unresolved" } as const;
const findingText = { Confirmed: "confirmed", Duplicate: "duplicate", OutOfScope: "out-of-scope", Rejected: "rejected" } as const;

async function saved(by: unknown, digest: string, file: boolean): Promise<Outcome> {
  const { caseId, submissionId } = await entryOf();
  const actorGithubId = githubId(Number(by ?? 0));
  clock.set(time(nowMs));
  const result = await outcome(Effect.gen(function* () {
    const row = yield* submission(submissionId);
    const record = yield* caseStanding(caseId);
    const { screening } = yield* screeningAt(submissionId);
    if (row === undefined || record === undefined) return yield* Effect.fail(new Refused({ status: 404, code: "not_found", message: "not found" }));
    const version = screening.version + 1;
    const hex = hexOf(digest);
    const evidence = revisionEvidence(row, caseOf(record, screening.version), actorGithubId, { object: true, admitted: true });
    const change = { record, actorGithubId, key: objectKey(submissionId, version, hex), digest: hex, bytes: 64, eventKey: `routine-revise-${caseId}-${version}`, at: new Date(clock.now()).toISOString() };
    yield* replaced(submissionId, { seenRevision: screening.revision, by: githubNumber(actorGithubId), evidence, change });
  }));
  if (result === "accepted") proofFile = file;
  return result;
}

async function onGithub(): Promise<Outcome> {
  const { submissionId } = await entryOf();
  const at = new Date(time(nowMs)).toISOString();
  const ghsa = `GHSA-${String(2345 + (generation % 7000)).padStart(4, "2")}-cfgh-jmpq`;
  const changed = await db.prepare("UPDATE security_submissions SET state='submitted', advisory_ghsa=?, github_created_at=?, revision=revision+1, updated_at=? WHERE id=? AND advisory_ghsa IS NULL").bind(ghsa, at, at, submissionId).run();
  return changed.meta.changes === 1 ? "accepted" : "refused";
}

async function send(event: Event, by: unknown): Promise<Outcome> {
  switch (event.type) {
    case "setMode": {
      if (event.mode === mode) return "refused";
      mode = event.mode;
      return "accepted";
    }
    case "advance": {
      if (event.ms <= 0) return "refused";
      nowMs += event.ms;
      clock.set(time(nowMs));
      return "accepted";
    }
    case "failCalls":
    case "decideReport": return pass(event);
    case "reachGithub": return onGithub();
    case "appeal": return act(by, "appeal", { reason: "The decision overlooks the attached evidence." });
    case "requestInformation": return act(by, "request-information", { reason: "Show the affected amount." });
    case "decideAppeal": return act(by, "decide-appeal", { outcome: event.uphold ? "uphold" : "return", reason: "Independent appeal decision." });
    case "decide": {
      const { decision } = event;
      if (!(decision.finding in findingText)) return "refused";
      const { earlierId } = await entryOf();
      return act(by, "decide", {
        outcome: findingText[decision.finding as keyof typeof findingText], severity: severityText[decision.severity], loss: lossText[decision.loss], inScope: decision.inScope,
        reason: "Conformance decision.", relatedParty: decision.declareRelated, spam: decision.spam,
        ...(decision.rootCause > 0 ? { rootCauseKey: `root-cause-g${generation}` } : {}),
        ...(decision.duplicateOf > 0 ? { duplicateOf: earlierId } : {}),
      });
    }
    case "saveVersion": return saved(by, event.digest, event.proofFile);
    case "claimScreening": {
      const { submissionId } = await entryOf();
      const { screening } = await runtime.runPromise(screeningAt(submissionId));
      return outcome(claimed(submissionId, { seenRevision: screening.revision, nowMs: time(nowMs), admitted: true }, undefined));
    }
    case "finishScreening": {
      const { caseId, submissionId } = await entryOf();
      clock.set(time(nowMs));
      const { screening } = await runtime.runPromise(screeningAt(submissionId));
      const exclusions = await runtime.runPromise(caseExclusions(caseId));
      const input = { exactVersionLoaded: true, duplicateEvidence: event.duplicate, route: "Surplus" as const, exclusions };
      return outcome(finished(submissionId, claimOf(screening), input, event.screened, screeningReason({ observation: event.screened, proposedReason })));
    }
  }
}

function shape(state: Routine, at: (value: number) => number) {
  const { privateCase, screening } = state;
  return {
    mode: state.mode,
    onGithub: state.onGithub,
    proofFile: state.proofFile,
    privateCase: {
      submission: privateCase.submission,
      receipt: privateCase.receipt,
      appeal: privateCase.appeal,
      reportVersion: privateCase.reportVersion,
      duplicate: privateCase.duplicateOf > 0,
      decided: privateCase.deciders.length > 0,
      appeals: privateCase.appealHistory.map((entry) => entry.resolution),
      routine: { closed: privateCase.routine.closed, returned: privateCase.routine.returned, proofAsked: privateCase.routine.proofAsked, proofDueAt: at(privateCase.routine.proofDueAt) },
    },
    screening: { phase: screening.phase, review: screening.review, version: screening.version },
    records: state.records.map((record) => ({
      mode: record.mode,
      reportVersion: record.reportVersion,
      at: at(record.at),
      outcome: record.decision.outcome,
      basis: record.decision.basis,
      hold: record.decision.hold,
      duplicate: record.decision.duplicateOf > 0,
      line: record.decision.line > 0,
      severity: record.decision.severity,
      applied: record.applied,
    })),
    failures: state.failures.map((failure) => ({ mode: failure.mode, at: at(failure.at) })),
  };
}

async function observed() {
  const { caseId } = await entryOf();
  const loaded = await runtime.runPromise(routineAt(caseId, activeMode(), time(nowMs)));
  return shape({ ...loaded.routine, mode, proofFile }, untime);
}

export const driver: Driver<ReturnType<typeof shape>> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    mode = "DryRun";
    nowMs = standard.receivedAt;
    proofFile = false;
    entry = undefined;
    clock.set(time(nowMs));
  },
  dispatch: (_key, event, by) => send(event, by),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await Promise.allSettled(pending);
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof shape>> = { view: (state) => shape(state, (value) => value), keys: ["report"], walks: 3, steps: 10 };
