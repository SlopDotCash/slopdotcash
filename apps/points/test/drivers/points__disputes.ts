// spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"; spec/points/disputes.md, "Triage runs under an expiring lease, a saved draft is reused, and every outcome escalates"; spec/points/disputes.md, "A dispute still unresolved seven days after filing escalates without a lease"; spec/points/disputes.md, "Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason"
import { Cause, Exit, Layer, ManagedRuntime } from "effect";
import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import type { Driver, Options } from "../../gen/points__disputes.conformance.ts";
import type { Dispute, Event, RecordView } from "../../gen/points__disputes.ts";
import type { RevisionBody } from "../../src/kernels/records/canonical.ts";
import { pointRevisionId } from "../../src/kernels/records/ids.vibe";
import { type Intent, type Lease, type Triage, heldDispute, send } from "../../src/disputes/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "points-disputes-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const epoch = Date.UTC(2031, 0, 1);
const span = 10_000_000_000;
const clock = settableClock(epoch);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, noticePorts));

const recordedAt = "2030-12-01T00:00:00.000Z";

function nodeOf(githubId: number): string {
  return btoa(`04:User${githubId}`);
}

function body(githubId: number, keyDigit: string, amount: number, previous: string | null): RevisionBody {
  return {
    previous,
    recordedAt,
    sourceDigest: "b".repeat(64),
    sourceRule: "slop-score-v2",
    award: {
      key: keyDigit.repeat(64),
      actor: { id: nodeOf(githubId), login: `member-${githubId}` },
      projectId: "conformance",
      category: "evaluated-contribution",
      amount,
      occurredAt: recordedAt,
      sourceId: `conformance-${keyDigit}`,
      sourceUrl: "https://example.com/conformance",
      workUnitId: `conformance-${keyDigit}`,
      provisional: false,
    },
  };
}

async function retain(revision: RevisionBody, id?: string): Promise<string> {
  const stored = id ?? await runtime.runPromise(pointRevisionId(revision));
  await db.prepare("INSERT INTO points_revisions (id, source_key, previous, recorded_at, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(stored, revision.award.key, revision.previous, revision.recordedAt, JSON.stringify({ id: stored, ...revision })).run();
  return stored;
}

const ofFive = await retain(body(5, "1", 10, null));
const ofSix = await retain(body(6, "2", 10, null));
const superseded = await retain(body(5, "3", 10, null));
await retain(body(5, "3", 20, superseded));
const tampered = await retain(body(5, "4", 10, null), "d".repeat(64));

const revisions: ReadonlyMap<string, string> = new Map([
  ["r1|5|true|true", ofFive],
  ["r1|6|true|true", ofSix],
  ["r0|5|false|true", superseded],
  ["r1|5|true|false", tampered],
]);
const labels: ReadonlyMap<string, string> = new Map([[ofFive, "r1"], [ofSix, "r1"], [superseded, "r0"], [tampered, "r1"]]);

interface Entry {
  readonly appealKey: string;
  readonly tokens: Map<number, string>;
  readonly digests: Map<string, string>;
  lastToken: number;
  inFlight: boolean;
  now: number;
}

let generation = 0;
let entries = new Map<string, Entry>();

const millisAt = (now: number) => epoch + generation * span + now * 1000;
const secondsBase = () => (epoch + generation * span) / 1000;

async function entryOf(key: string): Promise<Entry> {
  const found = entries.get(key);
  if (found !== undefined) return found;
  const appealKey = `points-dispute:${await runtime.runPromise(sha256Hex(`conformance:${generation}:${key}`))}`;
  const made: Entry = { appealKey, tokens: new Map(), digests: new Map(), lastToken: 0, inFlight: false, now: 0 };
  entries.set(key, made);
  return made;
}

function revisionOf(record: RecordView): string {
  const id = revisions.get(`${record.revision}|${record.recipient}|${record.current}|${record.integrityVerified}`);
  if (id === undefined) throw new Error(`no seeded revision for ${JSON.stringify(record)}`);
  return id;
}

function statementOf(length: number, label: string): string {
  return `${label}${"x".repeat(Math.max(length, label.length))}`.slice(0, length);
}

function leaseOf(entry: Entry, token: number): Lease {
  return { token: entry.tokens.get(token) ?? `unknown-${generation}-${token}`, callsInFlight: entry.inFlight };
}

async function sent(entry: Entry, intent: Intent, by: number): Promise<{ readonly outcome: "accepted" | "refused"; readonly token: string | undefined }> {
  clock.set(millisAt(entry.now));
  const exit = await runtime.runPromiseExit(send(entry.appealKey, intent, by));
  if (Exit.isSuccess(exit)) return { outcome: "accepted", token: exit.value.token };
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && (error._tag === "Rejected" || error._tag === "NotAnEvent")) return { outcome: "refused", token: undefined };
  throw error;
}

async function triaged(entry: Entry, triage: Triage, by: number, clears: boolean): Promise<"accepted" | "refused"> {
  const { outcome } = await sent(entry, { kind: "triage", triage }, by);
  if (outcome === "accepted" && clears) entry.inFlight = false;
  return outcome;
}

async function dispatch(key: string, event: Event, by: number): Promise<"accepted" | "refused"> {
  const entry = await entryOf(key);
  switch (event.type) {
    case "file": {
      const statement = statementOf(event.statementLength, event.statementDigest);
      entry.digests.set(await runtime.runPromise(sha256Hex(statement)), event.statementDigest);
      return (await sent(entry, { kind: "file", revisionId: revisionOf(event.record), statement }, by)).outcome;
    }
    case "decide": {
      const { outcome } = await sent(entry, { kind: "decide", uphold: event.uphold, reason: "r".repeat(event.reasonLength) }, by);
      if (outcome === "accepted") entry.inFlight = false;
      return outcome;
    }
    case "observeTime": {
      if (by !== -1 || event.observedAt < entry.now) return "refused";
      entry.now = event.observedAt;
      return "accepted";
    }
    case "claim": {
      const claimed = await sent(entry, { kind: "triage", triage: { type: "claim" } }, by);
      if (claimed.outcome === "accepted" && claimed.token !== undefined) {
        entry.lastToken += 1;
        entry.tokens.set(entry.lastToken, claimed.token);
        entry.inFlight = false;
      }
      return claimed.outcome;
    }
    case "startCall": {
      const outcome = await triaged(entry, { type: "startCall", lease: leaseOf(entry, event.token) }, by, false);
      if (outcome === "accepted") entry.inFlight = true;
      return outcome;
    }
    case "release": return triaged(entry, { type: "release", lease: leaseOf(entry, event.token) }, by, true);
    case "draft": return triaged(entry, { type: "draft", lease: leaseOf(entry, event.token), uphold: event.uphold, confidenceHundredths: event.confidenceHundredths }, by, true);
    case "failTriage": return triaged(entry, { type: "failTriage", lease: leaseOf(entry, event.token) }, by, true);
    case "escalateDrafted": return triaged(entry, { type: "escalateDrafted", lease: leaseOf(entry, event.token) }, by, false);
    case "escalateUnavailable": return triaged(entry, { type: "escalateUnavailable", lease: leaseOf(entry, event.token), availability: event.availability }, by, false);
    case "escalateOverdue": return triaged(entry, { type: "escalateOverdue" }, by, false);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function view(state: Dispute) {
  return {
    filed: state.filed,
    revision: state.revision,
    recipient: state.recipient,
    statementLength: state.statementLength,
    statementDigest: state.statementDigest,
    openedAt: state.openedAt,
    claimed: state.claimToken > 0,
    claimUntil: state.claimUntil,
    draft: state.draft,
    draftConfidence: state.draftConfidence,
    escalation: state.escalation,
    resolution: state.resolution,
    resolver: state.resolver,
    reasonLength: state.reasonLength,
    notices: state.notices,
  };
}

type View = ReturnType<typeof view>;

async function observe(key: string): Promise<View> {
  const entry = await entryOf(key);
  clock.set(millisAt(entry.now));
  const { dispute } = await runtime.runPromise(heldDispute(entry.appealKey));
  const shown = view(dispute);
  const base = secondsBase();
  return {
    ...shown,
    revision: dispute.filed ? labels.get(dispute.revision) ?? dispute.revision : dispute.revision,
    statementDigest: dispute.filed ? entry.digests.get(dispute.statementDigest) ?? dispute.statementDigest : dispute.statementDigest,
    openedAt: dispute.filed ? dispute.openedAt - base : dispute.openedAt,
    claimUntil: dispute.claimUntil === 0 ? 0 : dispute.claimUntil - base,
  };
}

export const driver: Driver<View> & AsyncDisposable = {
  reset: () => {
    generation += 1;
    entries = new Map();
  },
  dispatch: (key, event, by) => dispatch(key, event, Number(by)),
  observe,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { view, keys: ["first", "second"], walks: 6, steps: 12 };
