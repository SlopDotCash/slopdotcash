# Aggregate monthly Points and penalties

PRD section 7 applies a penalty to the author's accepted-work Points for its
UTC month. The debit is bounded by that month's balance across all accepted
sources. Source-level values and the frozen reward snapshot remain separate.
Each penalty receipt and upheld-appeal reversal is recorded once.

## Story: Apply a published penalty without erasing accepted work or funded rewards

A qualified decision affects the relevant month, including a month with work
from several sources. A successful appeal restores the applied debit once.

### Monthly totals aggregate immutable accepted sources

```quint
type Finding = Spam | Scam | RuleViolation | LowQuality | Duplicate | OutOfScope
type MonthSource = { source: int, points: int }
type AppliedPenalty = { receipt: int, requested: int, applied: int, reversed: bool }
type MonthlyPoints = { period: int, sources: List[MonthSource], penalties: List[AppliedPenalty],
  financialFrozen: bool, frozenWeight: int }
pure val initial: MonthlyPoints = { period: 1, sources: List(), penalties: List(),
  financialFrozen: false, frozenWeight: 0 }
pure def earnedPoints(m: MonthlyPoints): int = m.sources.foldl(0, (acc, s) => acc + s.points)
pure def appliedDebits(m: MonthlyPoints): int = m.penalties.foldl(0, (acc, p) =>
  acc + (if (p.reversed) 0 else p.applied))
pure def standingPoints(m: MonthlyPoints): int =
  if (appliedDebits(m) > earnedPoints(m)) 0 else earnedPoints(m) - appliedDebits(m)
pure def rewardWeight(m: MonthlyPoints): int = if (m.financialFrozen) m.frozenWeight else standingPoints(m)
pure def alwaysPositiveSources(m: MonthlyPoints): bool = m.sources.every(s => s.source > 0 and s.points >= 10)
pure def alwaysUniqueSources(m: MonthlyPoints): bool = m.sources.every(s =>
  m.sources.select(other => other.source == s.source).length() == 1)
pure def alwaysNonnegativeStanding(m: MonthlyPoints): bool = standingPoints(m) >= 0 and m.frozenWeight >= 0
pure def canAddAccepted(m: MonthlyPoints, sourceId: int, points: int, period: int): bool =
  sourceId > 0 and points >= 10 and period == m.period and not(m.financialFrozen) and
  not(m.sources.some(s => s.source == sourceId))
pure def addAccepted(m: MonthlyPoints, sourceId: int, points: int, period: int): MonthlyPoints =
  { ...m, sources: m.sources.append({ source: sourceId, points: points }) }
pure val pointsValues = Set(10, 30, 90, 240, 450, 750)
```

### The published category determines the requested debit

A current member's authenticated run must name the exact PR, and the author
must be outside the maintainer exemption. A copied marker never supplies any
of these facts. Zero-debit categories still retain an idempotent decision.

```quint
pure def requestedDebit(finding: Finding): int =
  if (finding == Spam) 30 else if (finding == Scam) 240 else if (finding == RuleViolation) 10 else 0
pure def canApplyPenalty(m: MonthlyPoints, receipt: int, period: int, finding: Finding,
  authenticatedMember: bool, exactOwnRun: bool, nonMaintainer: bool, qualifiedDecision: bool): bool =
  receipt > 0 and period == m.period and not(m.financialFrozen) and authenticatedMember and exactOwnRun and
  nonMaintainer and qualifiedDecision and not(m.penalties.some(p => p.receipt == receipt))
pure def applyPenalty(m: MonthlyPoints, receipt: int, period: int, finding: Finding,
  authenticatedMember: bool, exactOwnRun: bool, nonMaintainer: bool, qualifiedDecision: bool): MonthlyPoints = {
  val requested = requestedDebit(finding)
  val applied = if (requested > standingPoints(m)) standingPoints(m) else requested
  { ...m, penalties: m.penalties.append({ receipt: receipt, requested: requested, applied: applied, reversed: false }) }
}
pure def alwaysDebitsBounded(m: MonthlyPoints): bool = m.penalties.every(p =>
  p.applied >= 0 and p.applied <= p.requested and
  (p.requested == 0 or p.requested == 10 or p.requested == 30 or p.requested == 240))
pure def alwaysUniqueDecisions(m: MonthlyPoints): bool = m.penalties.every(p =>
  m.penalties.select(other => other.receipt == p.receipt).length() == 1)
```

### Reversals restore the applied debit once and leave frozen rewards unchanged

The moderator decision is separate from Slopbot's appeal triage. A freeze
captures the actual accepted-work reward weight. Later appeal history can
change standings while preserving the approved, scheduled, or paid reward.

```quint
pure def canReversePenalty(m: MonthlyPoints, receipt: int, moderatorUpheld: bool): bool =
  moderatorUpheld and m.penalties.some(p => p.receipt == receipt and not(p.reversed))
pure def reversePenalty(m: MonthlyPoints, receipt: int, moderatorUpheld: bool): MonthlyPoints =
  { ...m, penalties: m.penalties.listMap(p => if (p.receipt == receipt) { ...p, reversed: true } else p) }
pure def canFreezeRewards(m: MonthlyPoints): bool = not(m.financialFrozen)
pure def freezeRewards(m: MonthlyPoints): MonthlyPoints =
  { ...m, financialFrozen: true, frozenWeight: standingPoints(m) }
pure def stepFrozenRewardStable(before: MonthlyPoints, after: MonthlyPoints): bool =
  before.financialFrozen implies after.financialFrozen and rewardWeight(after) == rewardWeight(before)
pure def stepSourcesRetained(before: MonthlyPoints, after: MonthlyPoints): bool =
  after.sources.length() >= before.sources.length() and before.sources.every(s => after.sources.includes(s))
pure def sometimesSeveralSources(m: MonthlyPoints): bool = m.sources.length() >= 2
pure def sometimesCappedPenalty(m: MonthlyPoints): bool = m.penalties.some(p => p.requested > p.applied and p.applied > 0)
pure def sometimesReversedPenalty(m: MonthlyPoints): bool = m.penalties.some(p => p.reversed and p.applied > 0)
pure def sometimesFrozen(m: MonthlyPoints): bool = m.financialFrozen
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val periodValues = Set(0, 1, 2)
pure val receiptValues = Set(0, 1, 2)
pure val sourceIdValues = Set(0, 1, 2)
```
