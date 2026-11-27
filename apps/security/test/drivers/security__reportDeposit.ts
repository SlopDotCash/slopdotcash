// spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"; spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"; spec/security/reportDeposit.md, "Unpaid asks are released when the switch or the project turns the deposit off"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
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
import { ReportDeposits } from "@repo/ports/security";
import type { RoutineOutcome } from "../../gen/security__cases.ts";
import type { Driver, Options } from "../../gen/security__reportDeposit.conformance.ts";
import type { DepositOutcome, DepositReason, Event, ReportDeposit } from "../../gen/security__reportDeposit.ts";
import type { Observation, Reading } from "../../gen/security__routineDecisions.ts";
import type { ReceiptTerms } from "../../gen/security__terms.ts";
import { routinePromptRevision } from "../../src/analysis/prompts.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { AwardClearances } from "../../src/cases/clearance.vibe";
import { caseRecord } from "../../src/cases/rows.vibe";
import { performed } from "../../src/cases/routes.vibe";
import { reportDepositOnManifest } from "../../src/client/reportDeposit.ts";
import { depositAsk } from "../../src/deposit/ask.vibe";
import { ReportDepositsLive } from "../../src/deposit/port.vibe";
import { ReportDepositSettings, type ReportDepositMode } from "../../src/deposit/settings.vibe";
import { decideOutcomes, releaseUnpaid } from "../../src/deposit/sweep.vibe";
import { objectKey } from "../../src/intake/attempt.vibe";
import { revisionEvidence } from "../../src/intake/revision.vibe";
import { caseOf, caseStanding, submission } from "../../src/intake/rows.vibe";
import { githubNumber, reportBucket } from "../../src/privacy/reads.vibe";
import { ReportingPrograms } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { recorded, routineAt } from "../../src/routine/store.vibe";
import { severityOfRank } from "../../src/routine/tables.ts";
import { claimed, replaced, reviewed, screeningAt } from "../../src/screening/store.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

type Outcome = "accepted" | "refused";

const repository = "slop-test/deposit";
const network = "robinhood-mainnet";
const mf = startWorker({ d1: { SLOP_DB: "deposit-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const depositService = -3;
const feeRecorder = -4;
const routineService = -2;
const staff = { technical: [2, 3], financial: [5], moderators: [4, 7] } as const;
const standard: ReceiptTerms = { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, scoped: true, fundingPolicy: "AfterApproval", eligibility: "InScopeSecurity", offeredGross: [100], split: "StandardSplit", asset: "usdc", excludedFindings: [3] };
const frozen = { grossMinor: "100", researcherMinor: "75", slopMinor: "25", currency: "usdc", decimals: 6, capacityAwards: 3, eligibility: "in-scope-security", fundingPolicy: "after-approval" };
const modeNames: Readonly<Record<ReportDeposit["mode"], ReportDepositMode>> = { DepositOff: "off", DepositDryRun: "dry_run", DepositLive: "live" };
const outcomes: Readonly<Record<string, DepositOutcome>> = { refund_due: "RefundDue", kept_due: "KeptDue", refunded: "Refunded", kept: "Kept" };
const reasons: Readonly<Record<string, DepositReason>> = { responded: "Responded", silent: "Silent", "turned-off": "TurnedOff", spam: "SpamClose", duplicate: "DuplicateClose", "out-of-scope": "OutOfScopeClose" };
const clean: Reading = { lossPlausible: false, duplicateOf: 0, line: 0, proofPresent: true, severity: 3 };

let generation = 0;
let mode: ReportDeposit["mode"] = "DepositLive";
let nowMs = standard.receivedAt;
let exempt = false;
let rated = true;
let deposits = 0;
let keys = 0;
let runId = 0;
let paidWith: { readonly network: string; readonly depositId: number } | undefined;
let entry: { readonly caseId: string; readonly submissionId: string; readonly earlierId: string } | undefined;

const base = () => epoch + generation * span;
const time = (value: number) => base() + value;
const iso = (value: number) => new Date(time(value)).toISOString();
const githubId = (actor: number) => String(8_500_000 + generation * 100 + actor);
const ids = (actors: ReadonlyArray<number>) => actors.map(githubId);
const actorOf = (by: unknown) => ({ githubId: githubId(Number(by ?? 0)), login: `member-${githubId(Number(by ?? 0))}`, actorId: `actor-${githubId(Number(by ?? 0))}` });
const key = () => `deposit-driver-${generation}-${String(++keys).padStart(8, "0")}`;
const projectOf = () => `deposit-conformance-g${generation}`;
const caseIdOf = (name: string) => `sc_deposit_g${generation}_${name}`;
const submissionIdOf = (name: string) => `ss_deposit_g${generation}_${name}`;
const hexOf = (digest: string) => [...new TextEncoder().encode(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64);

const fixture: ProjectView = {
  projectId: "deposit-conformance", revision: 1, manifestSha256: "a".repeat(64), rowStatus: "Active", manifestStatus: "Active", listingTier: "Community",
  retirement: "NotRetired", stewardGithubId: "1", stewardAccount: "UserSteward", listing: { fromApplication: false }, repositories: [{ id: "5101", nodeId: "R_deposit", fullName: repository, integrationBranch: "main", aliases: [] }], closureConsent: false,
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
    atReceipt: () => Effect.succeed({ revision: standard.revision, publishedAt: iso(standard.publishedAt), terms: frozen, scoped: standard.scoped, excludedFindings: standard.excludedFindings }),
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
  Layer.succeed(SubmissionFeeRates, {
    all: () => Effect.succeed(rated ? [{ effectiveAt: new Date(base() - 3_600_000).toISOString(), slopPerUsd: "395" }] : []),
    newest: () => Effect.succeed(rated ? { effectiveAt: new Date(base() - 3_600_000).toISOString(), slopPerUsd: "395" } : null),
    append: () => Effect.die(new Error("this driver appends no rate")),
  }),
  Layer.succeed(ProjectParticipation, { participated: (_projectId, id) => Effect.succeed(exempt && id === githubId(1)) }),
  Layer.succeed(ReportDepositSettings, { get mode() { return modeNames[mode]; } }),
);

const pending: Array<Promise<unknown>> = [];
const execution: ExecutionContext = { waitUntil: (work) => { pending.push(work); } };
const services = Layer.mergeAll(d1(db), webCrypto, reportBucket(await storage(mf, "PRIVATE_TRACES")), clock.layer, receiptNotices, ports, Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto)), Layer.succeed(Execution, { context: execution }));
const runtime = ManagedRuntime.make(Layer.provideMerge(ReportDepositsLive, services));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<Outcome> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (error instanceof Refused) return "refused";
  if (typeof error === "object" && error !== null && "_tag" in error && ["Rejected", "NotAnEvent", "ReplacementLost", "ScreeningMissing", "Conflict", "CaseRejected"].includes(String(error._tag))) return "refused";
  throw error;
}

function batched(statements: ReadonlyArray<Statement>) {
  return Effect.gen(function* () {
    const found = yield* D1;
    return yield* found.batch(statements);
  });
}

async function feeSide(statement: Effect.Effect<Statement, never, Services>): Promise<number> {
  return runtime.runPromise(Effect.gen(function* () {
    const written = yield* statement;
    const database = yield* D1;
    return yield* database.run(written);
  }));
}

function manifestOf(projectId: string, on: boolean) {
  const scope = { includedAssets: [repository], severityRubric: "Conformance severity rubric.", lossDefinition: "Conformance loss definition.", excludedFindings: standard.excludedFindings.map((length, index) => String(index).padEnd(length, "x")) };
  return JSON.stringify({ id: projectId, status: "active", securityBounty: { scope }, ...(on ? {} : { security: { reportDeposit: false } }) });
}

function receiptOf(name: string, reporter: string, digest: string, deposit: ReadonlyArray<Statement> = []) {
  const submissionId = submissionIdOf(name);
  return slopReceipt({
    caseId: caseIdOf(name), submissionId, projectId: projectOf(), repository, reporter: { githubId: reporter, login: `member-${reporter}` }, idempotencyKey: key(), marker: "f".repeat(32),
    receivedAt: iso(standard.receivedAt), policyRevision: standard.revision, terms: frozen,
    receiptTerms: { ...standard, publishedAt: time(standard.publishedAt), receivedAt: time(standard.receivedAt) },
    report: { key: objectKey(submissionId, 1, digest), digest, bytes: 64 }, ownerGithubId: null, unbanned: sql`1`, deposit,
  });
}

async function seeded() {
  const projectId = projectOf();
  const publishedAt = iso(standard.publishedAt);
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Deposit conformance',?)").bind(projectId, manifestOf(projectId, true), "a".repeat(64), publishedAt),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(projectId, manifestOf(projectId, true), "a".repeat(64), publishedAt, publishedAt),
  ]);
  clock.set(time(standard.receivedAt));
  await runtime.runPromise(Effect.flatMap(receiptOf("earlier", githubId(9), hexOf("earlier")), batched));
  await db.prepare("INSERT INTO security_routine_runs(mode, source, started_at) VALUES('live', 'admin', ?)").bind(iso(standard.receivedAt)).run();
  const [run] = (await db.prepare("SELECT MAX(id) AS id FROM security_routine_runs").all()).results;
  runId = Number(run?.id ?? 0);
}

async function receive(by: unknown, event: Extract<Event, { type: "receive" }>): Promise<Outcome> {
  if (Number(by ?? 0) !== depositService || entry !== undefined) return "refused";
  exempt = event.exempt;
  rated = event.rated;
  clock.set(time(standard.receivedAt));
  const caseId = caseIdOf("report");
  const program = Effect.gen(function* () {
    const asked = yield* depositAsk({ caseId, projectId: projectOf(), reporterGithubId: githubId(1), at: iso(standard.receivedAt) });
    yield* batched(yield* receiptOf("report", githubId(1), hexOf("original"), asked.statements));
  });
  const result = await outcome(program);
  if (result === "accepted") entry = { caseId, submissionId: submissionIdOf("report"), earlierId: caseIdOf("earlier") };
  return result;
}

function routineObservation(ruling: RoutineOutcome): Observation {
  switch (ruling) {
    case "RoutineDuplicate": return { tag: "SameDigest", earlier: 7 };
    case "RoutineOutOfScope": return { tag: "Calls", first: { ...clean, line: 1 }, second: { ...clean, line: 1 } };
    case "RoutineNeedsProof": return { tag: "Calls", first: { ...clean, proofPresent: false, severity: 2 }, second: { ...clean, proofPresent: false, severity: 2 } };
    case "RoutineNoProof": return { tag: "NoCallNeeded" };
    case "RoutineAcknowledged": return { tag: "Calls", first: clean, second: clean };
  }
}

async function routine(by: unknown, ruling: RoutineOutcome): Promise<Outcome> {
  if (Number(by ?? 0) !== routineService || entry === undefined) return "refused";
  const found = routineObservation(ruling);
  const loaded = await runtime.runPromise(routineAt(entry.caseId, "live", time(nowMs)));
  clock.set(time(nowMs));
  const calls = found.tag === "Calls" ? ["first", "second"].map((name) => ({ provider: "surplus", model: `conformance-${name}`, promptRevision: routinePromptRevision, state: "answered" as const })) : [];
  const rank = found.tag === "Calls"
    ? { lossPlausible: false, severity: severityOfRank(Math.max(found.first.severity, found.second.severity)), proofPresent: found.first.proofPresent && found.second.proofPresent }
    : { lossPlausible: null, severity: null, proofPresent: null };
  const facts = { runId, duplicateOf: entry.earlierId, exclusionLine: "Conformance published line.", missing: [], rank, calls, promptRevision: routinePromptRevision };
  const done = await runtime.runPromise(recorded(entry.caseId, "live", { revision: loaded.routine.privateCase.revision, nowMs: time(nowMs), proofFile: false }, { type: "decideReport", found }, facts));
  return done ? "accepted" : "refused";
}

async function act(by: unknown, action: string, fields: Readonly<Record<string, unknown>> = {}): Promise<Outcome> {
  if (entry === undefined) return "refused";
  clock.set(time(nowMs));
  const revision = (await runtime.runPromise(caseRecord(entry.caseId)))?.row.revision ?? 0;
  return outcome(performed(actorOf(by), entry.caseId, { action, expectedRevision: revision, idempotencyKey: key(), ...fields }));
}

const severityText = { Critical: "critical", High: "high", Medium: "medium", Low: "low", Informational: "informational", SeverityUnresolved: "unresolved", SeverityUnset: "unresolved" } as const;
const lossText = { VerifiedPotential: "verified-potential", VerifiedActual: "verified-actual", NotVerified: "not-verified", LossUnresolved: "unresolved", LossUnset: "unresolved" } as const;
const findingText = { Confirmed: "confirmed", Duplicate: "duplicate", OutOfScope: "out-of-scope", Rejected: "rejected" } as const;

async function saved(by: unknown, digest: string): Promise<Outcome> {
  if (entry === undefined) return "refused";
  const { caseId, submissionId } = entry;
  const actorGithubId = githubId(Number(by ?? 0));
  clock.set(time(nowMs));
  return outcome(Effect.gen(function* () {
    const row = yield* submission(submissionId);
    const record = yield* caseStanding(caseId);
    const { screening } = yield* screeningAt(submissionId);
    if (row === undefined || record === undefined) return yield* Effect.fail(new Refused({ status: 404, code: "not_found", message: "not found" }));
    const version = screening.version + 1;
    const hex = hexOf(digest);
    const evidence = revisionEvidence(row, caseOf(record, screening.version), actorGithubId, { object: true, admitted: true });
    const change = { record, actorGithubId, key: objectKey(submissionId, version, hex), digest: hex, bytes: 64, eventKey: `deposit-revise-${caseId}-${version}`, at: new Date(clock.now()).toISOString() };
    yield* replaced(submissionId, { seenRevision: screening.revision, by: githubNumber(actorGithubId), evidence, change });
  }));
}

async function pay(by: unknown): Promise<Outcome> {
  if (Number(by ?? 0) !== feeRecorder || entry === undefined) return "refused";
  deposits += 1;
  const deposit = { network, depositId: generation * 1000 + deposits };
  const at = iso(nowMs);
  await db.prepare("INSERT INTO submission_fee_deposits(network,deposit_id,item,payer,token,amount,kept_to,tx_hash,block_number,block_time,state) VALUES(?,?,?,?,?,?,?,?,?,?,'open')")
    .bind(network, deposit.depositId, `0x${"0".repeat(64)}`, `0x${"1".repeat(40)}`, `0x${"2".repeat(40)}`, "1", `0x${"3".repeat(40)}`, `0x${String(deposit.depositId).padStart(64, "0")}`, deposit.depositId, at).run();
  const { caseId } = entry;
  const changed = await feeSide(Effect.gen(function* () {
    return yield* (yield* ReportDeposits).markPaid(deposit, caseId, at);
  }));
  if (changed !== 1) return "refused";
  paidWith = deposit;
  return "accepted";
}

async function unpay(by: unknown): Promise<Outcome> {
  if (Number(by ?? 0) !== feeRecorder || paidWith === undefined) return "refused";
  const gone = { kind: "Missing" as const, network: paidWith.network, fromBlock: paidWith.depositId, toBlock: paidWith.depositId, seen: [] };
  const changed = await feeSide(Effect.gen(function* () {
    return yield* (yield* ReportDeposits).unpayWhereGone(gone);
  }));
  if (changed !== 1) return "refused";
  paidWith = undefined;
  return "accepted";
}

async function sent(by: unknown, burned: boolean): Promise<Outcome> {
  if (Number(by ?? 0) !== feeRecorder || paidWith === undefined) return "refused";
  const deposit = paidWith;
  const changed = await feeSide(Effect.gen(function* () {
    return yield* (yield* ReportDeposits).finalOutcome(deposit, burned ? "kept" : "refunded", iso(nowMs));
  }));
  return changed === 1 ? "accepted" : "refused";
}

async function swept(by: unknown, step: "release" | "decide"): Promise<Outcome> {
  if (Number(by ?? 0) !== depositService || entry === undefined) return "refused";
  clock.set(time(nowMs));
  const before = await depositOf(entry.caseId);
  await runtime.runPromise(step === "release" ? releaseUnpaid(modeNames[mode], iso(nowMs)) : decideOutcomes(modeNames[mode], time(nowMs), iso(nowMs)));
  const after = await depositOf(entry.caseId);
  return JSON.stringify(after) === JSON.stringify(before) ? "refused" : "accepted";
}

async function projectSetting(by: unknown, on: boolean): Promise<Outcome> {
  if (Number(by ?? 0) !== depositService) return "refused";
  const projectId = projectOf();
  const nextManifest = manifestOf(projectId, on);
  const [current] = (await db.prepare("SELECT revision, manifest FROM projects WHERE id=?").bind(projectId).all()).results;
  if (current === undefined || current.manifest === nextManifest) return "refused";
  const nextRevision = Number(current.revision) + 1;
  const sha = hexOf(`deposit-setting-${generation}-${nextRevision}-${on}`);
  const at = iso(nowMs);
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,'Deposit conformance setting',?)").bind(projectId, nextRevision, nextManifest, sha, at),
    db.prepare("UPDATE projects SET revision=?, manifest=?, manifest_sha256=?, updated_at=? WHERE id=?").bind(nextRevision, nextManifest, sha, at, projectId),
  ]);
  return "accepted";
}

async function send(event: Event, by: unknown): Promise<Outcome> {
  switch (event.type) {
    case "setMode": {
      if (Number(by ?? 0) !== depositService || event.mode === mode) return "refused";
      mode = event.mode;
      return "accepted";
    }
    case "observeProjectSetting": return projectSetting(by, event.on);
    case "advance": {
      if (event.ms <= 0) return "refused";
      nowMs += event.ms;
      clock.set(time(nowMs));
      return "accepted";
    }
    case "receive": return receive(by, event);
    case "routineDecide": return routine(by, event.ruling);
    case "appeal": return act(by, "appeal", { reason: "The decision overlooks the attached evidence." });
    case "requestInformation": return act(by, "request-information", { reason: "Show the affected amount." });
    case "decideAppeal": return act(by, "decide-appeal", { outcome: event.uphold ? "uphold" : "return", reason: "Independent appeal decision." });
    case "decide": {
      const { decision } = event;
      if (!(decision.finding in findingText) || entry === undefined) return "refused";
      return act(by, "decide", {
        outcome: findingText[decision.finding as keyof typeof findingText], severity: severityText[decision.severity], loss: lossText[decision.loss], inScope: decision.inScope,
        reason: "Conformance decision.", relatedParty: decision.declareRelated, spam: decision.spam,
        ...(decision.rootCause > 0 ? { rootCauseKey: `root-cause-g${generation}` } : {}),
        ...(decision.duplicateOf > 0 ? { duplicateOf: entry.earlierId } : {}),
      });
    }
    case "claimScreening": {
      if (entry === undefined) return "refused";
      const { submissionId } = entry;
      const { screening } = await runtime.runPromise(screeningAt(submissionId));
      return outcome(claimed(submissionId, { seenRevision: screening.revision, nowMs: time(nowMs), admitted: true }, undefined));
    }
    case "reviewReport": {
      const decision = event.review;
      if (entry === undefined || decision === "PendingReview") return "refused";
      const { submissionId } = entry;
      clock.set(time(nowMs));
      const { screening } = await runtime.runPromise(screeningAt(submissionId));
      const actor = Number(by ?? 0);
      return outcome(reviewed(submissionId, { seenRevision: screening.revision, decision, currentMaintainer: (staff.technical as ReadonlyArray<number>).includes(actor), checkedReason: true }, githubId(actor), "Conformance routing review."));
    }
    case "saveVersion": return saved(by, event.digest);
    case "pay": return pay(by);
    case "unpay": return unpay(by);
    case "release": return swept(by, "release");
    case "recordSent": return sent(by, event.burned);
    case "decideOutcome": return swept(by, "decide");
  }
}

function shape(state: ReportDeposit) {
  const { privateCase, screening, deposit } = state;
  return {
    mode: state.mode,
    projectOn: state.projectOn,
    deposit: { row: deposit.row, paid: deposit.paid, outcome: deposit.outcome, reason: deposit.reason },
    privateCase: { submission: privateCase.submission, receipt: privateCase.receipt, appeal: privateCase.appeal, reportVersion: privateCase.reportVersion, depositHeld: privateCase.depositHeld, closed: privateCase.routine.closed, spamMarked: privateCase.spamMarked },
    screening: { phase: screening.phase, review: screening.review, version: screening.version, depositHeld: screening.depositHeld },
  };
}

type Shown = ReturnType<typeof shape>;

const unreceived: Pick<Shown, "privateCase" | "screening"> = {
  privateCase: { submission: "NotReceived", receipt: "Received", appeal: "NoAppeal", reportVersion: 0, depositHeld: false, closed: false, spamMarked: false },
  screening: { phase: "Queued", review: "PendingReview", version: 1, depositHeld: false },
};

async function depositOf(caseId: string | undefined): Promise<Shown["deposit"]> {
  const [row] = caseId === undefined ? [] : (await db.prepare("SELECT mode, paid_at, outcome, outcome_reason FROM security_report_deposits WHERE case_id=?").bind(caseId).all()).results;
  if (row === undefined) return { row: "NoRow", paid: false, outcome: "NoOutcome", reason: "NoReason" };
  return {
    row: row.mode === "asked" ? "Asked" : "Recorded",
    paid: row.paid_at !== null,
    outcome: outcomes[String(row.outcome)] ?? "NoOutcome",
    reason: reasons[String(row.outcome_reason)] ?? "NoReason",
  };
}

async function observed(): Promise<Shown> {
  const [project] = (await db.prepare("SELECT manifest FROM projects WHERE id=?").bind(projectOf()).all()).results;
  const settings = { mode, projectOn: reportDepositOnManifest(typeof project?.manifest === "string" ? project.manifest : "{}"), deposit: await depositOf(entry?.caseId) };
  if (entry === undefined) return { ...settings, ...unreceived };
  const record = await runtime.runPromise(caseRecord(entry.caseId));
  const { screening } = await runtime.runPromise(screeningAt(entry.submissionId));
  if (record === undefined) return { ...settings, ...unreceived };
  const { model } = record;
  return {
    ...settings,
    privateCase: { submission: model.submission, receipt: model.receipt, appeal: model.appeal, reportVersion: model.reportVersion, depositHeld: model.depositHeld, closed: model.routine.closed, spamMarked: model.spamMarked },
    screening: { phase: screening.phase, review: screening.review, version: screening.version, depositHeld: screening.depositHeld },
  };
}

export const driver: Driver<Shown> & AsyncDisposable = {
  reset: async () => {
    generation += 1;
    mode = "DepositLive";
    nowMs = standard.receivedAt;
    exempt = false;
    rated = true;
    deposits = 0;
    paidWith = undefined;
    entry = undefined;
    await seeded();
  },
  dispatch: (_key, event, by) => send(event, by),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await Promise.allSettled(pending);
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Shown> = { view: shape, keys: ["report"], walks: 3, steps: 12 };
