// spec/security/intake.md, "Upload and receipt creation have separate durable states"; spec/security/intake.md, "Only verified exact object bytes permit an atomic case and Inbox receipt"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker, storage } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/security__intake.conformance.ts";
import type { Event, Intake } from "../../gen/security__intake.ts";
import type { ReceiptTerms } from "../../gen/security__terms.ts";
import { type Attempt, admissions, availabilityObserved, banObserved, begin, committed, interrupted, modelNumber, opened, reconciled, retried, upload, verified } from "../../src/intake/attempt.vibe";
import { reportBucket } from "../../src/privacy/reads.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";
import { receiptNotices } from "../support/intake/notices.vibe";

const project = "intake-conformance";
const mf = startWorker({ d1: { SLOP_DB: "intake-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const seededAt = "2030-01-01T00:00:00.000Z";
const manifest = JSON.stringify({ id: project, status: "active" });
await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Intake conformance',?)").bind(project, manifest, "a".repeat(64), seededAt),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), seededAt, seededAt),
]);

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, reportBucket(await storage(mf, "PRIVATE_TRACES")), receiptNotices));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

interface Entry {
  attempt: Attempt;
  idempotencyKey: string;
  readonly githubId: string;
  readonly model: Map<string, number>;
}

let generation = 0;
const entries = new Map<string, Entry>();

const base = () => epoch + generation * span;
const time = (value: number) => value === 0 ? 0 : base() + value;
const untime = (value: number) => value === 0 ? 0 : value - base();
const keyText = (key: number) => `conformance-g${generation}-k${key}`.padEnd(16, "0");
const bytesFor = (digest: number) => new TextEncoder().encode(JSON.stringify({ summary: `Conformance report ${generation}`, description: `Report bytes for model digest ${digest} in generation ${generation}.` }));
const hex = (value: string | Uint8Array) => runtime.runPromise(sha256Hex(value));
const modelOf = (entry: Entry, field: string, shell: number) => shell === 0 ? 0 : entry.model.get(`${field}:${shell}`) ?? -1;

async function entryOf(key: string): Promise<Entry> {
  const found = entries.get(key);
  if (found !== undefined) return found;
  const githubId = String(5_000_000_000 + generation * 100 + entries.size + 1);
  const attempt = await runtime.runPromise(opened({ reporterGithubId: githubId, idempotencyKey: keyText(0), bytes: bytesFor(0), repository: 1, projectRevision: 1, availability: "Enabled", banned: false }));
  const entry: Entry = { attempt, idempotencyKey: keyText(0), githubId, model: new Map() };
  entries.set(key, entry);
  return entry;
}

async function outcome(entry: Entry, program: Effect.Effect<Attempt, unknown, Services>): Promise<"accepted" | "refused"> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) {
    entry.attempt = exit.value;
    return "accepted";
  }
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && (error._tag === "Rejected" || error._tag === "NotAnEvent")) return "refused";
  throw error;
}

function limbsText(limbs: ReadonlyArray<number>): string {
  const text = [...limbs].reverse().map((limb, index) => index === 0 ? String(limb) : String(limb).padStart(3, "0")).join("");
  return text === "" ? "0" : text;
}

function shellTerms(terms: ReceiptTerms): ReceiptTerms {
  return { ...terms, publishedAt: time(terms.publishedAt), receivedAt: time(terms.receivedAt) };
}

function frozen(terms: ReceiptTerms) {
  if (!terms.paidTerms) return undefined;
  return {
    grossMinor: limbsText(terms.offeredGross),
    currency: terms.asset,
    ...(terms.split === "FullAward" ? { split: { researcherBasisPoints: 10000, slopBasisPoints: 0 } } : {}),
    ...(terms.eligibility === "InScopeSecurity" ? { eligibility: "in-scope-security" } : {}),
    ...(terms.fundingPolicy === "AfterApproval" ? { fundingPolicy: "after-approval" } : {}),
  };
}

async function reopened(entry: Entry, event: Extract<Event, { type: "begin" }>): Promise<Attempt> {
  if (entry.attempt.state.phase !== "Editing") return entry.attempt;
  const bytes = bytesFor(event.digest);
  const attempt = await runtime.runPromise(opened({ reporterGithubId: entry.githubId, idempotencyKey: keyText(event.key), bytes, repository: event.repository, projectRevision: event.projectRevision, availability: entry.attempt.state.availability, banned: entry.attempt.state.banned }));
  entry.idempotencyKey = keyText(event.key);
  entry.model.set(`key:${attempt.identity.key}`, event.key);
  entry.model.set(`digest:${attempt.identity.digest}`, event.digest);
  entry.model.set(`reporter:${attempt.identity.reporter}`, event.reporter);
  return attempt;
}

async function shellNumber(value: string): Promise<number> {
  return modelNumber(await hex(value));
}

async function send(key: string, event: Event): Promise<"accepted" | "refused"> {
  const entry = await entryOf(key);
  const attempt = entry.attempt;
  switch (event.type) {
    case "observeAvailability": return outcome(entry, availabilityObserved(attempt, event.availability));
    case "observeBan": return outcome(entry, banObserved(attempt, event.banned));
    case "begin": {
      clock.set(time(event.nowMs));
      const ready = await reopened(entry, event);
      return outcome(entry, begin(ready, time(event.nowMs)));
    }
    case "interruptUpload": return outcome(entry, interrupted(attempt));
    case "retryUpload": return outcome(entry, retried(attempt, await shellNumber(keyText(event.key))));
    case "verifyObject": {
      const observed = await hex(bytesFor(event.digest));
      if (observed !== attempt.digest) return outcome(entry, verified(attempt, observed));
      return outcome(entry, Effect.flatMap(upload(attempt), (stored) => stored.kind === "verified" ? Effect.succeed(stored.attempt) : Effect.die(new Error("R2 lost a conformance upload"))));
    }
    case "commitReceipt": {
      clock.set(time(event.receivedAt));
      const receivedAt = new Date(time(event.receivedAt)).toISOString();
      const statements = await runtime.runPromise(slopReceipt({
        caseId: `sc_conformance_g${generation}_${key}`,
        submissionId: attempt.submissionId,
        projectId: project,
        repository: "slop-test/intake",
        reporter: { githubId: entry.githubId, login: `member-${entry.githubId}` },
        idempotencyKey: entry.idempotencyKey,
        marker: "c".repeat(32),
        receivedAt,
        policyRevision: event.terms.revision,
        terms: frozen(event.terms),
        report: { key: attempt.objectKey, digest: attempt.digest, bytes: attempt.bytes.length },
        ownerGithubId: null,
        unbanned: sql`1`,
      }));
      return outcome(entry, committed(attempt, time(event.receivedAt), shellTerms(event.terms), statements));
    }
    case "reconcileReceipt": return outcome(entry, reconciled(attempt, await shellNumber(keyText(event.key)), modelNumber(await hex(bytesFor(event.digest)))));
  }
}

async function observed(key: string): Promise<Intake> {
  const entry = await entryOf(key);
  const state = entry.attempt.state;
  const window = await runtime.runPromise(admissions(entry.githubId, clock.now()));
  const [found] = (await db.prepare("SELECT (SELECT COUNT(*) FROM security_submissions s JOIN security_cases c ON c.id=s.case_id WHERE s.id=?1) AS cases, (SELECT COUNT(*) FROM security_submissions s JOIN notifications n ON n.event_key='security-receipt:' || s.case_id AND n.recipient_github_id=s.reporter_github_id WHERE s.id=?1) AS inbox").bind(entry.attempt.submissionId).all()).results;
  return {
    ...state,
    key: modelOf(entry, "key", state.key),
    digest: modelOf(entry, "digest", state.digest),
    reporter: modelOf(entry, "reporter", state.reporter),
    receivedAt: untime(state.receivedAt),
    terms: { ...state.terms, publishedAt: untime(state.terms.publishedAt), receivedAt: untime(state.terms.receivedAt) },
    admissions: window.times.map(untime),
    caseExists: Number(found?.cases ?? 0) > 0,
    inboxExists: Number(found?.inbox ?? 0) > 0,
  };
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation += 1;
    entries.clear();
    clock.set(base());
  },
  dispatch: (key, event) => send(key, event),
  observe: (key) => observed(key),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["first", "second"], walks: 4, steps: 10 };
