// spec/security/assessment.md, "Attempts are permanent, version-bound and finish once"; spec/security/assessment.md, "A new report version and screening qualification come from the screening record"; spec/security/assessment.md, "A case received without Slop intake is qualified at its receipt version"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import type { D1PreparedStatement } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { outbound } from "@repo/platform/http";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/security__assessment.conformance.ts";
import type { Assessment, Event } from "../../gen/security__assessment.ts";
import type { Authority } from "../../gen/security__cases.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { type Run, assessmentAt, authorityAfter, concluded, started } from "../../src/assessment/store.vibe";
import { receiptTermsOf } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

const project = "assessment-conformance";
const mf = startWorker({ d1: { SLOP_DB: "assessment-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const seededAt = "2030-01-01T00:00:00.000Z";
const manifest = JSON.stringify({ id: project, status: "active" });
await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Assessment conformance',?)").bind(project, manifest, "a".repeat(64), seededAt),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), seededAt, seededAt),
]);

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const runtime = ManagedRuntime.make(Layer.mergeAll(
  d1(db),
  webCrypto,
  clock.layer,
  receiptNotices,
  Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto)),
));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

interface Entry {
  readonly caseId: string;
  readonly submissionId: string;
  authority: Authority;
  readonly runs: Map<number, Run>;
  readonly intake: boolean;
  screened: boolean;
}

const noAuthority: Authority = { epoch: 0, technical: [], financial: [], moderators: [], banned: [], relatedParties: [], programRestricted: false };
const proposal = { summary: "Conformance assessment summary.", severity: "high", potentialLoss: "unclear", duplicateCaseIds: [], rootCauseKey: null, remediation: "Conformance remediation." } as const;
const digest = "a".repeat(64);

let generation = 0;
let finishes = 0;
const entries = new Map<string, Entry>();

const base = () => epoch + generation * span;
const time = (value: number) => base() + value;
const untime = (value: number) => value - base();

async function entryOf(key: string): Promise<Entry> {
  const found = entries.get(key);
  if (found !== undefined) return found;
  const caseId = `sc_assessment_g${generation}_${key}`;
  const submissionId = `ss_assessment_g${generation}_${key}`;
  const githubId = String(6_000_000_000 + generation * 100 + entries.size + 1);
  const receivedAtMs = base();
  const receivedAt = new Date(receivedAtMs).toISOString();
  await runtime.runPromise(Effect.flatMap(
    slopReceipt({
      caseId,
      submissionId,
      projectId: project,
      repository: "slop-test/assessment",
      reporter: { githubId, login: `member-${githubId}` },
      idempotencyKey: `assessment-g${generation}-${key}`.padEnd(16, "0"),
      marker: "c".repeat(32),
      receivedAt,
      policyRevision: 1,
      terms: undefined,
      receiptTerms: receiptTermsOf({ revision: 1, publishedAt: seededAt, terms: undefined }, Date.parse(seededAt), receivedAtMs),
      report: { key: `security-reports/${submissionId}/1-${digest}.json`, digest, bytes: 64 },
      ownerGithubId: null,
      unbanned: sql`1`,
    }),
    (statements) => Effect.gen(function* () {
      const database = yield* D1;
      return yield* database.batch(statements);
    }),
  ));
  const entry: Entry = { caseId, submissionId, authority: noAuthority, runs: new Map(), intake: true, screened: false };
  entries.set(key, entry);
  return entry;
}

async function receivedWithout(key: string, entry: Entry, source: "GithubVerified" | "MaintainerAttested"): Promise<Entry> {
  const caseId = `sc_assessment_g${generation}_${key}_receipt`;
  const githubId = String(6_100_000_000 + generation * 100 + entries.size + 1);
  const receivedAt = new Date(base()).toISOString();
  await db.prepare(`INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, received_at_source, revision, created_at, updated_at)
    VALUES (?1, ?2, 'slop-test/assessment', NULL, ?3, ?4, 'verified', ?5, ?5, '7000000001', 1, NULL, 'received', 'not-started', 'not-applicable', 'not-applicable', 'embargoed', 'private', 'none', ?6, 1, ?5, ?5)`)
    .bind(caseId, project, githubId, `member-${githubId}`, receivedAt, source === "GithubVerified" ? "github-verified" : null).run();
  const replaced: Entry = { caseId, submissionId: "", authority: entry.authority, runs: new Map(), intake: false, screened: false };
  entries.set(key, replaced);
  return replaced;
}

async function receiptQualified(key: string, entry: Entry, source: string): Promise<"accepted" | "refused"> {
  if (source !== "GithubVerified" && source !== "MaintainerAttested") return "refused";
  if (entry.intake && entry.screened) return "refused";
  const target = entry.intake ? await receivedWithout(key, entry, source) : entry;
  const before = entry.intake ? undefined : (await runtime.runPromise(assessmentAt(target.caseId, target.authority))).assessment;
  if (before !== undefined) return "refused";
  const loaded = await runtime.runPromise(assessmentAt(target.caseId, target.authority));
  return loaded.assessment.qualifiedVersion === 1 ? "accepted" : "refused";
}

async function outcome<A>(program: Effect.Effect<A, unknown, Services>, accepted: (value: A) => void = () => undefined): Promise<"accepted" | "refused"> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) {
    accepted(exit.value);
    return "accepted";
  }
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && (error._tag === "Rejected" || error._tag === "NotAnEvent")) return "refused";
  throw error;
}

async function changed(statements: ReadonlyArray<D1PreparedStatement>): Promise<"accepted" | "refused"> {
  const [first] = await db.batch(statements);
  return first?.meta.changes === 1 ? "accepted" : "refused";
}

function versionObserved(entry: Entry, version: number) {
  const at = new Date(clock.now()).toISOString();
  return changed([
    db.prepare("UPDATE security_submission_intake SET report_version=?1,screening_state='queued',routed_at=NULL,screening_reason=NULL,screening_started_at=NULL,screening_finished_at=NULL,review_decision=NULL,review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,revision=revision+1 WHERE case_id=?2 AND report_version=?1-1").bind(version, entry.caseId),
    db.prepare("INSERT INTO security_intake_reports(submission_id,version,object_key,content_sha256,byte_count,created_at) SELECT ?1,?2,?3,?4,64,?5 WHERE changes()=1").bind(entry.submissionId, version, `security-reports/${entry.submissionId}/${version}-${digest}.json`, digest, at),
  ]);
}

function qualifiedObserved(entry: Entry, version: number) {
  return changed([
    db.prepare("UPDATE security_submission_intake SET screening_state='legitimate',screening_finished_at=?3,revision=revision+1 WHERE case_id=?1 AND report_version=?2 AND NOT (review_decision IS 'forward' OR (review_decision IS NULL AND screening_state='legitimate'))").bind(entry.caseId, version, new Date(clock.now()).toISOString()),
  ]);
}

async function runOf(entry: Entry, attempt: number): Promise<Run> {
  return entry.runs.get(attempt) ?? { current: await runtime.runPromise(assessmentAt(entry.caseId)), attempt };
}

function finishing() {
  finishes += 1;
  clock.set(base() + span / 2 + finishes);
}

async function send(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const entry = await entryOf(key);
  const sender = Number(by ?? 0);
  const begun = (run: Run) => { entry.runs.set(run.attempt, run); };
  switch (event.type) {
    case "startAutomatic":
      return outcome(started(entry.caseId, { type: "startAutomatic", nowMs: time(event.nowMs), exclusions: event.exclusions }, sender, entry.authority), begun);
    case "startOwnerRun":
      return outcome(started(entry.caseId, { type: "startOwnerRun", checkedEpoch: event.checkedEpoch, nowMs: time(event.nowMs), exclusions: event.exclusions }, sender, entry.authority), begun);
    case "finish": {
      const run = await runOf(entry, event.attempt);
      finishing();
      return outcome(concluded(run, { kind: "answered", digest, proposal: event.complete ? proposal : undefined, elapsedMs: event.elapsedMs }));
    }
    case "failUnavailable": {
      const run = await runOf(entry, event.attempt);
      finishing();
      return outcome(concluded(run, { kind: "unavailable", digest: null }));
    }
    case "observeVersion": {
      const answered = await versionObserved(entry, event.version);
      if (answered === "accepted") entry.screened = true;
      return answered;
    }
    case "observeQualified": {
      const answered = await qualifiedObserved(entry, event.version);
      if (answered === "accepted") entry.screened = true;
      return answered;
    }
    case "observeAuthority":
      return outcome(authorityAfter(entry.caseId, entry.authority, event.snapshot), (authority) => { entry.authority = authority; });
    case "observeReceiptQualified":
      return receiptQualified(key, entry, event.source);
  }
}

function shape(state: Assessment, startedAt: (value: number) => number) {
  return {
    reportVersion: state.reportVersion,
    qualified: state.qualifiedVersion === state.reportVersion,
    count: state.count,
    shown: state.shown,
    attempts: Object.entries(state.attempts)
      .map(([attempt, found]) => ({ attempt: Number(attempt), version: found.version, state: found.state, startedAt: startedAt(found.startedAt) }))
      .sort((left, right) => left.attempt - right.attempt),
  };
}

async function observed(key: string) {
  const entry = await entryOf(key);
  const current = await runtime.runPromise(assessmentAt(entry.caseId, entry.authority));
  return shape(current.assessment, untime);
}

export const driver: Driver<ReturnType<typeof shape>> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    finishes = 0;
    entries.clear();
    clock.set(base());
  },
  dispatch: (key, event, by) => send(key, event, by),
  observe: (key) => observed(key),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof shape>> = { view: (state) => shape(state, (value) => value), keys: ["first", "second"], walks: 4, steps: 10 };
