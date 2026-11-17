//@ backend dafny
// spec/points/journal.md, "History is append-only, chained and never moves an occurrence time"; spec/points/journal.md, "Revisions bind a key, a recorded rule and a reconciling decision"

interface Award { actor: { id: string }; projectId: string; category: string; amount: number; occurredAt: string; sourceId: string; sourceUrl: string; workUnitId: string; provisional: boolean }
interface Penalty { category: string; debit: number; reversedAt: string | null; reversal: string | null }
interface Decision { sourceId: string; effectiveAt: string; delta: number }
interface Revision { id: string; previous: string | null; recordedAt: string; sourceRule: string; award: Award; penalty?: Penalty; decision?: Decision }
interface Coverage { from: string; to: string }

const penaltyRulePrefix = "slopbot-penalties-v";

function before(a: string, b: string): boolean {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) {
    //@ invariant 0 <= i && i <= a.length && i <= b.length
    //@ decreases a.length - i
    i = i + 1;
  }
  if (i < a.length && i < b.length) return a.charCodeAt(i) < b.charCodeAt(i);
  return a.length < b.length;
}

function digitAt(text: string, at: number): boolean {
  //@ requires 0 <= at && at < text.length
  const code = text.charCodeAt(at);
  return 48 <= code && code <= 57;
}

function cycleValid(cycle: string): boolean {
  if (cycle.length !== 7) return false;
  const tens = cycle.charCodeAt(5);
  const units = cycle.charCodeAt(6);
  const month = (tens === 48 && 49 <= units && units <= 57) || (tens === 49 && 48 <= units && units <= 50);
  return digitAt(cycle, 0) && digitAt(cycle, 1) && digitAt(cycle, 2) && digitAt(cycle, 3) && cycle.charCodeAt(4) === 45 && month;
}

function ruleFits(revision: Revision): boolean {
  const rule = revision.sourceRule;
  const category = revision.award.category;
  if (category === "slopbot-penalty") return rule.length > penaltyRulePrefix.length && rule.slice(0, penaltyRulePrefix.length) === penaltyRulePrefix;
  if (category === "payout-received") return rule === "verified-payout-v1";
  return rule === "slop-score-v1" || rule === "slop-score-v2" || rule === "github-merged-history-v1";
}

function awardFits(revision: Revision, generatedAt: string): boolean {
  const award = revision.award;
  const signed = award.category === "slopbot-penalty" ? award.amount <= 0 : award.amount >= 0;
  return signed && !before(generatedAt, revision.recordedAt) && ruleFits(revision);
}

function reversalFits(revision: Revision, penalty: Penalty): boolean {
  const reversedAt = penalty.reversedAt;
  if (reversedAt === null) return penalty.reversal === null;
  return penalty.reversal !== null && revision.award.amount === 0
    && !before(reversedAt, revision.award.occurredAt) && !before(revision.recordedAt, reversedAt);
}

function penaltyFits(revision: Revision): boolean {
  const award = revision.award;
  const penalty = revision.penalty;
  const decision = revision.decision;
  if (award.category !== "slopbot-penalty") return penalty === undefined;
  if (penalty === undefined || decision === undefined) return false;
  return !award.provisional && decision.sourceId === award.sourceId && -award.amount <= penalty.debit
    && award.workUnitId === award.sourceId + ":penalty" && reversalFits(revision, penalty);
}

function payoutFits(award: Award): boolean {
  if (award.category !== "payout-received") return true;
  if (award.sourceId.length < 14) return false;
  const cycle = award.sourceId.slice(7, 14);
  return (award.amount === 0 || award.amount === 25) && !award.provisional && cycleValid(cycle)
    && award.sourceId === "payout:" + cycle + ":" + award.actor.id
    && award.workUnitId === award.sourceId
    && award.sourceUrl === "https://slop.cash/cycles/" + award.projectId + "/" + cycle;
}

function linked(revision: Revision, prior: Revision | null): boolean {
  if (prior === null) return revision.previous === null;
  return revision.previous === prior.id;
}

function decisionFits(revision: Revision, prior: Revision | null): boolean {
  const decision = revision.decision;
  if (decision === undefined) return true;
  const base = prior === null ? 0 : prior.award.amount;
  return (revision.sourceRule === "slop-score-v2" || revision.award.category === "slopbot-penalty")
    && !before(revision.recordedAt, decision.effectiveAt)
    && decision.delta === revision.award.amount - base;
}

function occurrenceKept(revision: Revision, prior: Revision | null): boolean {
  if (prior === null) return true;
  return prior.award.occurredAt === revision.award.occurredAt && !before(revision.recordedAt, prior.recordedAt);
}

function penaltyKept(revision: Revision, prior: Revision | null): boolean {
  if (prior === null) return true;
  const kept = prior.penalty;
  if (kept === undefined) return true;
  const next = revision.penalty;
  if (next === undefined) return false;
  if (kept.category !== next.category || kept.debit !== next.debit || prior.sourceRule !== revision.sourceRule) return false;
  return kept.reversedAt === null || (kept.reversedAt === next.reversedAt && kept.reversal === next.reversal);
}

/** @throws {never} */
export function revisionFault(revision: Revision, prior: Revision | null, generatedAt: string): string {
  if (!awardFits(revision, generatedAt)) return "award";
  if (!penaltyFits(revision)) return "penalty";
  if (!payoutFits(revision.award)) return "payout";
  if (!linked(revision, prior)) return "previous";
  if (!decisionFits(revision, prior)) return "decision";
  if (!occurrenceKept(revision, prior)) return "moved";
  if (!penaltyKept(revision, prior)) return "penalty-moved";
  return "";
}

/** @throws {never} */
export function coverageOrdered(entry: Coverage): boolean {
  return before(entry.from, entry.to);
}
