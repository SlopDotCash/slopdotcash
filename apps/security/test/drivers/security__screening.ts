// spec/security/screening.md, "Claim queued, unavailable or expired work for the current revision"; spec/security/screening.md, "A late result cannot replace human review or a newly saved version"; spec/security/screening.md, "Routing writes only private references for the current qualified version"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import type { Driver, Options } from "../../gen/security__screening.conformance.ts";
import type { Claim, Event, Screening } from "../../gen/security__screening.ts";
import { objectKey } from "../../src/intake/attempt.vibe";
import { caseStanding } from "../../src/intake/rows.vibe";
import { receiptTermsOf } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { screeningReason } from "../../src/screening/run.vibe";
import { claimed, finished, replaced, reviewed, routed, screeningAt } from "../../src/screening/store.vibe";

const project = "screening-conformance";
const mf = startWorker({ d1: { SLOP_DB: "screening-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const seededAt = "2030-01-01T00:00:00.000Z";
const manifest = JSON.stringify({ id: project, status: "active" });
await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Screening conformance',?)").bind(project, manifest, "a".repeat(64), seededAt),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), seededAt, seededAt),
]);

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, noticePorts));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

interface Entry {
  readonly caseId: string;
  readonly submissionId: string;
  readonly reporterGithubId: string;
  readonly ownerGithubId: string;
}

const digests: Readonly<Record<string, string>> = { original: "a".repeat(64), revised: "b".repeat(64), new: "c".repeat(64) };
const named = new Map(Object.entries(digests).map(([name, hex]) => [hex, name]));
const reason = "Conformance routing review.";
const proposedReason = "Conformance screening proposal.";

let generation = 0;
let sent = 0;
const entries = new Map<string, Entry>();

const base = () => epoch + generation * span;
const time = (value: number) => (value > 0 ? base() + value : value);
const untime = (value: number) => (value > 0 ? value - base() : value);
const hexOf = (digest: string) => digests[digest] ?? digest;
const nameOf = (hex: string) => named.get(hex) ?? hex;

async function entryOf(key: string): Promise<Entry> {
  const found = entries.get(key);
  if (found !== undefined) return found;
  const index = entries.size + 1;
  const caseId = `sc_screening_g${generation}_${key}`;
  const submissionId = `ss_screening_g${generation}_${key}`;
  const reporterGithubId = String(6_100_000_000 + generation * 100 + index);
  const ownerGithubId = String(6_200_000_000 + generation * 100 + index);
  const receivedAtMs = base();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const digest = hexOf("original");
  await runtime.runPromise(Effect.flatMap(
    slopReceipt({
      caseId,
      submissionId,
      projectId: project,
      repository: "slop-test/screening",
      reporter: { githubId: reporterGithubId, login: `member-${reporterGithubId}` },
      idempotencyKey: `screening-g${generation}-${key}`.padEnd(16, "0"),
      marker: "d".repeat(32),
      receivedAt,
      policyRevision: 1,
      terms: undefined,
      receiptTerms: receiptTermsOf({ revision: 1, publishedAt: seededAt, terms: undefined }, Date.parse(seededAt), receivedAtMs),
      report: { key: objectKey(submissionId, 1, digest), digest, bytes: 64 },
      ownerGithubId: null,
      unbanned: sql`1`,
    }),
    (statements) => Effect.gen(function* () {
      const database = yield* D1;
      return yield* database.batch(statements);
    }),
  ));
  const entry: Entry = { caseId, submissionId, reporterGithubId, ownerGithubId };
  entries.set(key, entry);
  return entry;
}

async function outcome<A>(program: Effect.Effect<A, unknown, Services>): Promise<"accepted" | "refused"> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return "refused";
  throw error;
}

function actorOf(entry: Entry, by: number): string {
  return by === 1 ? entry.reporterGithubId : String(6_300_000_000 + by);
}

function tokenOf(token: Claim): Claim {
  return { ...token, digest: hexOf(token.digest) };
}

async function send(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const entry = await entryOf(key);
  const id = entry.submissionId;
  sent += 1;
  clock.set(base() + span / 2 + sent);
  switch (event.type) {
    case "claim":
      return outcome(claimed(id, { seenRevision: event.seenRevision, nowMs: time(event.nowMs), admitted: event.admitted }, undefined));
    case "finish":
      return outcome(finished(id, tokenOf(event.token), event.input, event.observation, screeningReason({ observation: event.observation, proposedReason })));
    case "reviewReport": {
      const { decision } = event;
      if (decision === "PendingReview") return "refused";
      return outcome(reviewed(id, { seenRevision: event.seenRevision, decision, currentMaintainer: event.currentMaintainer, checkedReason: event.checkedReason }, actorOf(entry, Number(by ?? 0)), reason));
    }
    case "replace": {
      const current = await runtime.runPromise(screeningAt(id));
      const record = await runtime.runPromise(caseStanding(entry.caseId));
      if (record === undefined) throw new Error(`case ${entry.caseId} is missing`);
      const digest = hexOf(event.digest);
      return outcome(replaced(id, {
        seenRevision: event.seenRevision,
        by: Number(by ?? 0),
        evidence: event.evidence,
        change: {
          record,
          actorGithubId: entry.reporterGithubId,
          key: objectKey(id, current.screening.version + 1, digest),
          digest,
          bytes: 64,
          eventKey: `screening-replace-g${generation}-${key}-${sent}`,
          at: new Date(clock.now()).toISOString(),
        },
      }));
    }
    case "route":
      return outcome(routed(id, event.seenRevision, {
        checked: event.routing.checkedContext,
        recipients: event.routing.eligibleRecipients ? [entry.ownerGithubId] : [],
        actingTechnicalApprover: event.routing.actingTechnicalApprover,
      }));
  }
}

type Stored = Omit<Screening, "exclusions">;

function stored({ exclusions: _context, ...kept }: Screening): Stored {
  return kept;
}

function shape(entry: Entry, state: Screening): Stored {
  return {
    ...stored(state),
    reporter: state.reporter === Number(entry.reporterGithubId) ? 1 : state.reporter,
    digest: nameOf(state.digest),
    startedAt: untime(state.startedAt),
    reportDigests: state.reportDigests.map(nameOf),
  };
}

async function observed(key: string): Promise<Stored> {
  const entry = await entryOf(key);
  const current = await runtime.runPromise(screeningAt(entry.submissionId));
  return shape(entry, current.screening);
}

export const driver: Driver<Stored> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    sent = 0;
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

export const options: Options<Stored> = { view: stored, keys: ["first", "second"], walks: 4, steps: 10 };
