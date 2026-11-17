// spec/points/journal.md, "Revisions bind a key, a recorded rule and a reconciling decision"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { keyText, revisionText } from "./canonical.ts";
import { PointRevision } from "./records.schema.ts";

const KeyInput = Schema.Struct({
  projectId: Schema.String,
  actorId: Schema.String,
  category: Schema.String,
  sourceId: Schema.String,
  workUnitId: Schema.optionalKey(Schema.String),
});

const legacyKey = (parts: typeof KeyInput.Type) =>
  JSON.stringify([parts.projectId, parts.actorId, parts.category, parts.sourceId, ...(parts.workUnitId === undefined ? [] : [parts.workUnitId])]);

const legacyRevision = (r: PointRevision) => JSON.stringify({
  id: r.id,
  previous: r.previous,
  recordedAt: r.recordedAt,
  sourceDigest: r.sourceDigest,
  sourceRule: r.sourceRule,
  award: {
    key: r.award.key,
    actor: { id: r.award.actor.id, login: r.award.actor.login },
    projectId: r.award.projectId,
    category: r.award.category,
    amount: r.award.amount,
    occurredAt: r.award.occurredAt,
    sourceId: r.award.sourceId,
    sourceUrl: r.award.sourceUrl,
    workUnitId: r.award.workUnitId,
    provisional: r.award.provisional,
  },
  ...(r.penalty === undefined ? {} : { penalty: { category: r.penalty.category, debit: r.penalty.debit, reversedAt: r.penalty.reversedAt, reversal: r.penalty.reversal } }),
  ...(r.decision === undefined ? {} : { decision: { sourceId: r.decision.sourceId, effectiveAt: r.decision.effectiveAt, reason: r.decision.reason, delta: r.decision.delta } }),
});

export const aKeyIsTheLegacyArray = contract({ input: KeyInput, run: keyText, deterministic: true, invariant: (parts, text) => text === legacyKey(parts) });

export const aRevisionIsItsLegacyBytes = contract({ input: PointRevision, run: revisionText, invariant: (revision, text) => text === legacyRevision(revision) });
