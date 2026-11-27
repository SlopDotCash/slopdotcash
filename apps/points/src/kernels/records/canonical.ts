//@ backend dafny
// spec/points/journal.md, "Revisions bind a key, a recorded rule and a reconciling decision"; spec/points/journal.md, "History is append-only, chained and never moves an occurrence time"

export interface Actor { id: string; login: string }
export interface Award { key: string; actor: Actor; projectId: string; category: string; amount: number; occurredAt: string; sourceId: string; sourceUrl: string; workUnitId: string; provisional: boolean }
export interface Penalty { category: string; debit: number; reversedAt: string | null; reversal: string | null }
export interface Decision { sourceId: string; effectiveAt: string; reason: string; delta: number }
export interface RevisionBody { previous: string | null; recordedAt: string; sourceDigest: string; sourceRule: string; award: Award; penalty?: Penalty; decision?: Decision }
export interface Revision extends RevisionBody { id: string }
export interface Coverage { repository: string; from: string; to: string; digest: string }
export interface Journal { schemaVersion: string; ruleVersion: string; generatedAt: string; coverage: readonly Coverage[]; revisions: readonly Revision[] }
export interface KeyParts { projectId: string; actorId: string; category: string; sourceId: string; workUnitId?: string }

const hexDigits = "0123456789abcdef";

function hexDigit(value: number): string {
  //@ requires 0 <= value && value < 16
  //@ ensures \result.length === 1
  return hexDigits.slice(value, value + 1);
}

function hex4(unit: number): string {
  //@ requires 0 <= unit && unit < 65536
  //@ ensures \result.length === 4
  return hexDigit(Math.floor(unit / 4096)) + hexDigit(Math.floor(unit / 256) % 16) + hexDigit(Math.floor(unit / 16) % 16) + hexDigit(unit % 16);
}

function digits(value: number): string {
  //@ requires value >= 0
  //@ ensures \result.length >= 1
  //@ decreases value
  const last = hexDigit(value % 10);
  if (value < 10) return last;
  return digits(Math.floor(value / 10)) + last;
}

function shortEscape(unit: number): string {
  if (unit === 34) return "\\\"";
  if (unit === 92) return "\\\\";
  if (unit === 8) return "\\b";
  if (unit === 9) return "\\t";
  if (unit === 10) return "\\n";
  if (unit === 12) return "\\f";
  if (unit === 13) return "\\r";
  return "";
}

function escapeOf(unit: number, lone: boolean): string {
  //@ requires 0 <= unit && unit < 65536
  if (lone || (unit < 32 && shortEscape(unit) === "")) return "\\u" + hex4(unit);
  return shortEscape(unit);
}

function highSurrogate(unit: number): boolean {
  return 55296 <= unit && unit <= 56319;
}

function lowSurrogate(unit: number): boolean {
  return 56320 <= unit && unit <= 57343;
}

function quoted(text: string): string {
  //@ ensures \result.length >= 2
  let out = "\"";
  let start = 0;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= start && start <= i && i <= text.length
    //@ invariant out.length >= 1
    //@ decreases text.length - i
    const unit = text.charCodeAt(i);
    const paired = highSurrogate(unit) && i + 1 < text.length && lowSurrogate(text.charCodeAt(i + 1));
    const lone = !paired && (highSurrogate(unit) || lowSurrogate(unit));
    const escape = unit < 65536 ? escapeOf(unit, lone) : "";
    if (escape !== "") {
      out = out + text.slice(start, i) + escape;
      i = i + 1;
      start = i;
    } else {
      i = paired ? i + 2 : i + 1;
    }
  }
  return out + text.slice(start, text.length) + "\"";
}

function numberText(value: number): string {
  //@ ensures \result.length >= 1
  return value < 0 ? "-" + digits(-value) : digits(value);
}

function nullableText(value: string | null): string {
  if (value === null) return "null";
  return quoted(value);
}

function flagText(value: boolean): string {
  return value ? "true" : "false";
}

function awardText(award: Award): string {
  return "{\"key\":" + quoted(award.key)
    + ",\"actor\":{\"id\":" + quoted(award.actor.id) + ",\"login\":" + quoted(award.actor.login)
    + "},\"projectId\":" + quoted(award.projectId)
    + ",\"category\":" + quoted(award.category)
    + ",\"amount\":" + numberText(award.amount)
    + ",\"occurredAt\":" + quoted(award.occurredAt)
    + ",\"sourceId\":" + quoted(award.sourceId)
    + ",\"sourceUrl\":" + quoted(award.sourceUrl)
    + ",\"workUnitId\":" + quoted(award.workUnitId)
    + ",\"provisional\":" + flagText(award.provisional) + "}";
}

function penaltyText(penalty: Penalty): string {
  return "{\"category\":" + quoted(penalty.category)
    + ",\"debit\":" + numberText(penalty.debit)
    + ",\"reversedAt\":" + nullableText(penalty.reversedAt)
    + ",\"reversal\":" + nullableText(penalty.reversal) + "}";
}

function decisionText(decision: Decision): string {
  return "{\"sourceId\":" + quoted(decision.sourceId)
    + ",\"effectiveAt\":" + quoted(decision.effectiveAt)
    + ",\"reason\":" + quoted(decision.reason)
    + ",\"delta\":" + numberText(decision.delta) + "}";
}

function bodyFields(previous: string | null, recordedAt: string, sourceDigest: string, sourceRule: string, award: Award, penalty: Penalty | undefined, decision: Decision | undefined): string {
  let text = "\"previous\":" + nullableText(previous)
    + ",\"recordedAt\":" + quoted(recordedAt)
    + ",\"sourceDigest\":" + quoted(sourceDigest)
    + ",\"sourceRule\":" + quoted(sourceRule)
    + ",\"award\":" + awardText(award);
  if (penalty !== undefined) text = text + ",\"penalty\":" + penaltyText(penalty);
  if (decision !== undefined) text = text + ",\"decision\":" + decisionText(decision);
  return text;
}

/** @throws {never} */
export function revisionBodyText(body: RevisionBody): string {
  return "{" + bodyFields(body.previous, body.recordedAt, body.sourceDigest, body.sourceRule, body.award, body.penalty, body.decision) + "}";
}

/** @throws {never} */
export function revisionText(revision: Revision): string {
  return "{\"id\":" + quoted(revision.id) + "," + bodyFields(revision.previous, revision.recordedAt, revision.sourceDigest, revision.sourceRule, revision.award, revision.penalty, revision.decision) + "}";
}

/** @throws {never} */
export function coverageText(entry: Coverage): string {
  return "{\"repository\":" + quoted(entry.repository)
    + ",\"from\":" + quoted(entry.from)
    + ",\"to\":" + quoted(entry.to)
    + ",\"digest\":" + quoted(entry.digest) + "}";
}

function coverageListText(entries: readonly Coverage[]): string {
  let out = "";
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ decreases entries.length - i
    if (i > 0) out = out + ",";
    out = out + coverageText(entries[i]);
    i = i + 1;
  }
  return out;
}

function revisionListText(revisions: readonly Revision[]): string {
  let out = "";
  let i = 0;
  while (i < revisions.length) {
    //@ invariant 0 <= i && i <= revisions.length
    //@ decreases revisions.length - i
    if (i > 0) out = out + ",";
    out = out + revisionText(revisions[i]);
    i = i + 1;
  }
  return out;
}

/** @throws {never} */
export function journalText(journal: Journal): string {
  return "{\"schemaVersion\":" + quoted(journal.schemaVersion)
    + ",\"ruleVersion\":" + quoted(journal.ruleVersion)
    + ",\"generatedAt\":" + quoted(journal.generatedAt)
    + ",\"coverage\":[" + coverageListText(journal.coverage)
    + "],\"revisions\":[" + revisionListText(journal.revisions) + "]}";
}

/** @throws {never} */
export function keyText(parts: KeyParts): string {
  const unit = parts.workUnitId;
  let tail = "";
  if (unit !== undefined) tail = "," + quoted(unit);
  return "[" + quoted(parts.projectId) + "," + quoted(parts.actorId) + "," + quoted(parts.category) + "," + quoted(parts.sourceId) + tail + "]";
}
