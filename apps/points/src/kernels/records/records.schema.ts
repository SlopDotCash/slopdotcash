// spec/points/journal.md, "Revisions bind a key, a recorded rule and a reconciling decision"; spec/points/periods.md, "An instant is a UTC month and day, and a period is the month of occurrence"
import { Schema } from "effect";
import { instantOf } from "./instants.ts";

const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const commonDay = "(?:[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8])))";
const leapDay = "(?:(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)";
const timestamp = Schema.String.check(
  Schema.isPattern(new RegExp(`^(?:${commonDay}|${leapDay})T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$`, "u")),
  Schema.makeFilter((text: string) => instantOf(text) !== null),
);
const text = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));
const amount = Schema.Int;

export const Category = Schema.Literals([
  "merged-pull-request",
  "resolved-issue",
  "material-test-change",
  "evidence",
  "substantive-review",
  "evaluated-contribution",
  "payout-received",
  "slopbot-penalty",
]);

export const SourceRule = Schema.Union([
  Schema.Literals(["slop-score-v1", "slop-score-v2", "github-merged-history-v1", "verified-payout-v1"]),
  Schema.String.check(Schema.isPattern(/^slopbot-penalties-v[1-9][0-9]*$/u)),
]);

export const Award = Schema.Struct({
  key: digest,
  actor: Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_=-]{4,256}$/u)),
    login: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u)),
  }),
  projectId: Schema.String.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u)),
  category: Category,
  amount,
  occurredAt: timestamp,
  sourceId: text(256),
  sourceUrl: Schema.String.check(Schema.isPattern(/^https:\/\//u), Schema.isMaxLength(2048)),
  workUnitId: text(300),
  provisional: Schema.Boolean,
});

export const Penalty = Schema.Struct({
  category: Schema.String.check(Schema.isPattern(/^[a-z_]{1,40}$/u)),
  debit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  reversedAt: Schema.NullOr(timestamp),
  reversal: Schema.NullOr(Schema.Literals(["appeal_upheld", "maintainer_reopen"])),
});

export const Decision = Schema.Struct({
  sourceId: Schema.String.check(Schema.isPattern(/^(?:[A-Za-z0-9_=-]{4,256}|value:[a-f0-9]{64})$/u)),
  effectiveAt: timestamp,
  reason: Schema.String.check(Schema.isPattern(/\S/u)),
  delta: amount,
});

export const PointRevision = Schema.Struct({
  id: digest,
  previous: Schema.NullOr(digest),
  recordedAt: timestamp,
  sourceDigest: digest,
  sourceRule: SourceRule,
  award: Award,
  penalty: Schema.optionalKey(Penalty),
  decision: Schema.optionalKey(Decision),
});
export type PointRevision = typeof PointRevision.Type;

export const Coverage = Schema.Struct({
  repository: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)),
  from: timestamp,
  to: timestamp,
  digest,
});

export const PointsJournal = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  ruleVersion: Schema.Literal("slop-points-v1"),
  generatedAt: timestamp,
  coverage: Schema.Array(Coverage),
  revisions: Schema.Array(PointRevision).check(Schema.isMaxLength(250000)),
});
export type PointsJournal = typeof PointsJournal.Type;
