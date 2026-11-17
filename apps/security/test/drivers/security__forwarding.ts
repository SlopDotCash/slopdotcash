// spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"; spec/security/forwarding.md, "The atomic claim and exact readback precede any GitHub POST"; spec/security/forwarding.md, "Only recognized throttling reopens the same draft without a listing"; spec/security/forwarding.md, "A complete matching listing chooses the earliest copy or permits retry after the quiet window"; spec/security/forwarding.md, "A separate exact advisory read links one verified receipt to the saved case"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Ref } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import type { Driver, Options } from "../../gen/security__forwarding.conformance.ts";
import type { AdvisoryRead, Copy, Event, Forwarding, Listing, SendClaim, SendGate } from "../../gen/security__forwarding.ts";
import type { Screening } from "../../gen/security__screening.ts";
import { type AdvisoryFacts, ghsaOfRank } from "../../src/forwarding/advisories.vibe";
import { type Shell, type Volatile, forwarded, loaded, noVolatile } from "../../src/forwarding/store.vibe";
import { objectKey } from "../../src/intake/attempt.vibe";
import { receiptTermsOf } from "../../src/receipt/program.vibe";
import { slopReceipt } from "../../src/receipt/statements.vibe";

const project = "forwarding-conformance";
const mf = startWorker({ d1: { SLOP_DB: "forwarding-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const seededAt = "2030-01-01T00:00:00.000Z";
const manifest = JSON.stringify({ id: project, status: "active" });
await db.batch([
  db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Forwarding conformance',?)").bind(project, manifest, "a".repeat(64), seededAt),
  db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), seededAt, seededAt),
]);

const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, noticePorts));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

interface Entry {
  readonly submissionId: string;
  readonly repository: string;
  readonly reporterGithubId: string;
  readonly ledger: Ref.Ref<Volatile>;
}

const names = ["original", "early", "late"];
const hexes = new Map(names.map((name, index) => [name, String(index + 1).repeat(64)]));
const named = new Map([...hexes].map(([name, hex]) => [hex, name]));
const hexOf = (digest: string) => hexes.get(digest) ?? digest;
const nameOf = (hex: string) => named.get(hex) ?? hex;

let generation = 0;
const entries = new Map<string, Entry>();

async function entryOf(key: string): Promise<Entry> {
  const found = entries.get(key);
  if (found !== undefined) return found;
  const index = entries.size + 1;
  const caseId = `sc_forwarding_g${generation}_${key}`;
  const submissionId = `ss_forwarding_g${generation}_${key}`;
  const repository = `slop-test/forwarding-g${generation}-${key}`;
  const reporterGithubId = String(7_100_000_000 + generation * 100 + index);
  const digest = hexOf("original");
  await runtime.runPromise(Effect.flatMap(
    slopReceipt({
      caseId,
      submissionId,
      projectId: project,
      repository,
      reporter: { githubId: reporterGithubId, login: `member-${reporterGithubId}` },
      idempotencyKey: `forwarding-g${generation}-${key}`.padEnd(16, "0"),
      marker: "d".repeat(32),
      receivedAt: seededAt,
      policyRevision: 1,
      terms: undefined,
      receiptTerms: receiptTermsOf({ revision: 1, publishedAt: seededAt, terms: undefined }, Date.parse(seededAt), Date.parse(seededAt)),
      report: { key: objectKey(submissionId, 1, digest), digest, bytes: 64 },
      ownerGithubId: null,
      unbanned: sql`1`,
    }),
    (statements) => Effect.gen(function* () {
      const database = yield* D1;
      return yield* database.batch(statements);
    }),
  ));
  const entry: Entry = { submissionId, repository, reporterGithubId, ledger: Effect.runSync(Ref.make(noVolatile)) };
  entries.set(key, entry);
  return entry;
}

function claimIn(claim: SendClaim): SendClaim {
  return { ...claim, digest: hexOf(claim.digest) };
}

function claimOut(claim: SendClaim): SendClaim {
  return { ...claim, digest: nameOf(claim.digest) };
}

function copyIn(copy: Copy): Copy {
  return { ...copy, digest: hexOf(copy.digest) };
}

function copyOut(copy: Copy): Copy {
  return { ...copy, digest: nameOf(copy.digest) };
}

function screeningIn(screening: Screening): Screening {
  return { ...screening, digest: hexOf(screening.digest), reportDigests: screening.reportDigests.map(hexOf) };
}

function listingIn(listing: Listing): Listing {
  return { ...listing, copies: listing.copies.map(copyIn) };
}

function gateIn(gate: SendGate): SendGate {
  return { ...gate, digest: hexOf(gate.digest), screening: screeningIn(gate.screening) };
}

function readIn(read: AdvisoryRead): AdvisoryRead {
  return { ...read, facts: copyIn(read.facts) };
}

function translated(event: Event): Event {
  switch (event.type) {
    case "claimSend": return { ...event, gate: gateIn(event.gate) };
    case "startPost": return { ...event, claim: claimIn(event.claim) };
    case "recordPostResult": return { ...event, claim: claimIn(event.claim) };
    case "holdLateCopy": return { ...event, claim: claimIn(event.claim), accepted: copyIn(event.accepted) };
    case "recordCreated": return { ...event, claim: claimIn(event.claim), accepted: copyIn(event.accepted), listing: listingIn(event.listing) };
    case "reconcile": return { ...event, listing: listingIn(event.listing) };
    case "readReceipt": return { ...event, advisoryRead: readIn(event.advisoryRead) };
    default: return event;
  }
}

function shellOf(entry: Entry, event: Event): Shell {
  return {
    factsOf: (copy: Copy): AdvisoryFacts => ({
      ghsa: ghsaOfRank(copy.ghsa),
      repository: entry.repository,
      authorId: copy.author === 1 ? entry.reporterGithubId : null,
      privateReport: true,
      state: "triage",
      createdAt: new Date(copy.createdAtMs).toISOString(),
      markerFound: copy.marker === 1,
      evidenceDigest: copy.digest,
    }),
    code: event.type === "recordPostResult" && event.result === "DefiniteTerminal" ? "author-mismatch" : "forbidden",
    retryAfterSeconds: null,
    actorGithubId: entry.reporterGithubId,
    claimGuard: sql`1`,
  };
}

async function outcome(program: Effect.Effect<unknown, unknown, Services>): Promise<"accepted" | "refused"> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return "refused";
  throw error;
}

async function current(entry: Entry) {
  const found = await runtime.runPromise(loaded(entry.submissionId, entry.ledger));
  if (found === undefined) throw new Error(`submission ${entry.submissionId} left the forwarding model`);
  return found;
}

async function dispatched(key: string, event: Event): Promise<"accepted" | "refused"> {
  const entry = await entryOf(key);
  const translatedEvent = translated(event);
  return outcome(forwarded(await current(entry), translatedEvent, shellOf(entry, translatedEvent), entry.ledger));
}

function shown(state: Forwarding): Forwarding {
  return {
    ...state,
    activeClaim: claimOut(state.activeClaim),
    readyClaims: state.readyClaims.map(claimOut),
    canonical: copyOut(state.canonical),
    bindingCopies: state.bindingCopies.map(copyOut),
    receiptDigest: nameOf(state.receiptDigest),
  };
}

async function observed(key: string): Promise<Forwarding> {
  return shown((await current(await entryOf(key))).state);
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation += 1;
    entries.clear();
  },
  dispatch: (key, event) => dispatched(key, event),
  observe: (key) => observed(key),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["first", "second"], walks: 4, steps: 12 };
