// spec/security/remediation.md, "Remediation acts under the case's current roles"; spec/security/remediation.md, "The exact patch is reviewed independently before it resolves, and mitigation is verified separately"; spec/security/remediation.md, "Only separately approved exact redacted content is disclosed, with embargo history"
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
import { ProjectParticipationLive, SubmissionFeeRatesLive } from "@repo/backend/ports";
import { Authority as RepositoryAuthority, type ProjectView, Registry, Restrictions } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/security__remediation.conformance.ts";
import type { Authority } from "../../gen/security__cases.ts";
import type { Event, Remediation } from "../../gen/security__remediation.ts";
import type { ReceiptTerms } from "../../gen/security__terms.ts";
import { privateRoute } from "../../src/analysis/route.vibe";
import { awardClearancesLive } from "../../src/bounty/store.vibe";
import { caseRecord } from "../../src/cases/rows.vibe";
import { reportDepositSettings } from "../../src/deposit/settings.vibe";
import { performed } from "../../src/cases/routes.vibe";
import { reportBucket } from "../../src/privacy/reads.vibe";
import { ReportingPrograms } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { caseActionHandlersLive } from "../../src/cases/handlers.vibe";
import { journalOf } from "../../src/remediation/store.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

type Outcome = "accepted" | "refused";

const project = "remediation-conformance";
const repository = "slop-test/remediation";
const mf = startWorker({ d1: { SLOP_DB: "remediation-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const staff: Authority = { epoch: 1, technical: [2, 3], financial: [5], moderators: [4, 7], banned: [], relatedParties: [], programRestricted: false };
const standard: ReceiptTerms = { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, scoped: true, fundingPolicy: "AfterApproval", eligibility: "InScopeSecurity", offeredGross: [100], split: "StandardSplit", asset: "USDC", excludedFindings: [] };

let generation = 0;
let snapshot: Authority = staff;
let caseId = "";
let keys = 0;

const base = () => epoch + generation * span;
const githubId = (actor: number) => String(6_000_000 + generation * 100 + actor);
const actorOf = (by: unknown) => ({ githubId: githubId(Number(by ?? 0)), login: `member-${githubId(Number(by ?? 0))}`, actorId: `actor-${githubId(Number(by ?? 0))}` });
const ids = (actors: ReadonlyArray<number>) => actors.map(githubId);
const hex = (digest: number) => digest.toString(16).padStart(64, "0");
const key = () => `remediation-driver-${generation}-${++keys}`.padEnd(24, "0");

const fixture: ProjectView = {
  projectId: project, revision: 1, manifestSha256: "a".repeat(64), rowStatus: "Active", manifestStatus: "Active", listingTier: "Community",
  retirement: "NotRetired", stewardGithubId: "1", stewardAccount: "UserSteward", listing: { fromApplication: false }, repositories: [{ id: "3001", nodeId: "R_remediation", fullName: repository, integrationBranch: "main", aliases: [] }], closureConsent: false,
};

const ports = Layer.mergeAll(
  Layer.succeed(Registry, { project: () => Effect.succeed(fixture), byRepository: () => Effect.succeed(undefined), byPath: () => Effect.succeed(undefined), active: () => Effect.succeed([fixture]), pausedProjects: () => Effect.succeed([]), appendVaultRegistration: () => Effect.die(new Error("this test registers no vault")), fence: () => Effect.succeed(sql`1`) }),
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
);

await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Remediation conformance',?)").bind(project, JSON.stringify({ id: project }), "a".repeat(64), new Date(epoch).toISOString()),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, JSON.stringify({ id: project }), "a".repeat(64), new Date(epoch).toISOString(), new Date(epoch).toISOString()),
]);

const pending: Array<Promise<unknown>> = [];
const execution: ExecutionContext = { waitUntil: (work) => { pending.push(work); } };
const services = Layer.mergeAll(d1(db), webCrypto, reportBucket(await storage(mf, "PRIVATE_TRACES")), clock.layer, receiptNotices, ports, Layer.provide(privateRoute({ apiKey: undefined }), Layer.merge(outbound, webCrypto)), Layer.succeed(Execution, { context: execution }), reportDepositSettings("off"));
const runtime = ManagedRuntime.make(Layer.provideMerge(Layer.mergeAll(caseActionHandlersLive, awardClearancesLive, SubmissionFeeRatesLive, ProjectParticipationLive), services));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<Outcome> {
  const exit = await runtime.runPromiseExit(program);
  await Promise.allSettled(pending.splice(0));
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (error instanceof Refused) return "refused";
  throw error;
}

function batched(statements: ReadonlyArray<Statement>) {
  return Effect.gen(function* () {
    const found = yield* D1;
    return yield* found.batch(statements);
  });
}

async function received() {
  caseId = `sc_remediation_g${generation}`;
  const submissionId = `ss_remediation_g${generation}`;
  const digest = "b".repeat(64);
  const receivedAt = new Date(base() + standard.receivedAt).toISOString();
  const terms = { grossMinor: "100", researcherMinor: "75", slopMinor: "25", currency: "USDC", decimals: 6, network: "base", capacityAwards: 3, eligibility: "in-scope-security", fundingPolicy: "after-approval" };
  await runtime.runPromise(Effect.flatMap(slopReceipt({
    caseId, submissionId, projectId: project, repository, reporter: { githubId: githubId(1), login: `member-${githubId(1)}` }, idempotencyKey: key(), marker: "d".repeat(32), receivedAt,
    policyRevision: 1, terms, receiptTerms: { ...standard, receivedAt: base() + standard.receivedAt, publishedAt: base() + standard.publishedAt },
    report: { key: `security-reports/${submissionId}/1-${digest}.json`, digest, bytes: 64 }, ownerGithubId: null, unbanned: sql`1`,
  }), batched));
}

async function act(by: unknown, action: string, fields: Readonly<Record<string, unknown>>): Promise<Outcome> {
  const revision = (await runtime.runPromise(caseRecord(caseId)))?.row.revision ?? 0;
  return outcome(performed(actorOf(by), caseId, { action, expectedRevision: revision, idempotencyKey: key(), ...fields }));
}

const evidence = { evidenceReference: "private exact-head test record" };
const disclosureTexts = { Embargoed: "embargoed", RedactionApproved: "redaction-approved", Disclosed: "disclosed" } as const;
const stageTexts = { Investigating: "investigating", Fixing: "fixing" } as const;
const choiceTexts = { PrivateRecognition: "private", OptIn: "opt-in" } as const;

async function send(event: Event, by: unknown): Promise<Outcome> {
  if (event.type === "observeAuthority") {
    if (event.snapshot.epoch <= snapshot.epoch) return "refused";
    snapshot = event.snapshot;
    return "accepted";
  }
  if ("checkedEpoch" in event && event.checkedEpoch !== snapshot.epoch) return "refused";
  const patch = (digest: number) => digest > 0 ? { patchDigest: hex(digest) } : {};
  switch (event.type) {
    case "assignTriager": return act(by, "assign-triager", { githubId: githubId(event.actor), githubLogin: `member-${githubId(event.actor)}` });
    case "revokeTriager": return act(by, "revoke-triager", { githubId: githubId(event.actor) });
    case "progressRemediation": return event.stage === "Investigating" || event.stage === "Fixing" ? act(by, "remediation", { remediationState: stageTexts[event.stage] }) : "refused";
    case "recordPatch": return act(by, "remediation", { remediationState: "retest", ...patch(event.digest) });
    case "resolveRemediation": return act(by, "remediation", { remediationState: "resolved", ...patch(event.testedDigest), ...evidence });
    case "verifyMitigation": return act(by, "remediation", { remediationState: "mitigation-verified", ...patch(event.deployedDigest), ...evidence });
    case "reopenRemediation": return act(by, "remediation", { remediationState: "reopened" });
    case "decideDisclosure": return act(by, "disclosure", {
      disclosureState: disclosureTexts[event.target], reason: "Conformance disclosure decision.", evidenceReference: "private redaction review",
      ...event.digest > 0 ? { redactedContentDigest: hex(event.digest) } : {},
      ...event.embargoChange > 0 ? { embargoChange: "The embargo date moved." } : {},
    });
    case "setRecognition": return act(by, "recognition", { recognition: choiceTexts[event.choice] });
  }
}

function shape(state: Remediation) {
  return {
    stage: state.stage,
    disclosure: state.disclosure,
    recognition: state.recognition,
    patched: state.patchDigest > 0,
    verified: state.verifiedPatches.length,
    approved: state.approvedDigest > 0,
    published: state.publishedDigest > 0,
    embargoes: state.embargoHistory.length,
    triagers: state.privateCase.triagers.length,
  };
}

async function observed() {
  const record = await runtime.runPromise(caseRecord(caseId));
  if (record === undefined) throw new Error(`case ${caseId} is missing`);
  const journal = await runtime.runPromise(journalOf(record, record.model));
  if (journal === undefined) throw new Error(`case ${caseId} holds no remediation state`);
  return shape(journal.state);
}

export const driver: Driver<ReturnType<typeof shape>> & AsyncDisposable = {
  reset: async () => {
    generation += 1;
    snapshot = staff;
    clock.set(base() + 3);
    await received();
  },
  dispatch: (_key, event, by) => send(event, by),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof shape>> = { view: shape, keys: ["case"], walks: 3, steps: 10 };
