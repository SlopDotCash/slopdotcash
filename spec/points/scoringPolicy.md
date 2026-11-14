# Scoring policy versions and historical rescoring

PRD sections 5 and 7 and the owner decisions of 24 and 25 October 2026
(`src/lib/scoring-policy.ts`). Work accepted before 1 September 2026 keeps
the Slop Score v2 rules. Eligible unpaid work accepted from 1 September
through 31 October 2026 takes the current size bands once its historical
import is released. Work accepted from 1 November 2026 is scored from
Slopbot's source-bound value assessment. A valid maintainer ratification is
the exception that takes precedence. Approved, funded, scheduled and paid
awards keep their original Points. Held or unassessed pre-November sources
keep their earlier Points. Every accepted merge keeps at least 10 Points.

Paid API assessment begins on 1 November 2026. September and October
assessments come from subscription subagents, and a subscription declaration
is never an API receipt or billing proof. This machine represents one
accepted merged PR or grouped work unit. Its evidence records come from the
Slopbot value journal ([value inference](../slopbot/valueInference.md)) and
the ratification record verified against the maintainer's current GitHub
authority. The [historical import](./historicalImport.md) releases a
September–October rescoring. Each change of `points` is a [Points
journal](./journal.md) correction with basis `Reassessment` or
`Ratification`.

## Story: Score each accepted source under the policy of its acceptance time

### The acceptance instant selects the policy

```quint
import journal as J from "./journal"
import allocation as A from "./allocation"
type Policy = LegacyV2 | HistoricalValue | ValueV1
pure def policyFor(acceptedAt: int): Policy =
  if (acceptedAt < J::september2026Start) LegacyV2
  else if (acceptedAt < J::november2026Start) HistoricalValue
  else ValueV1
pure def lawPolicyBoundaries(acceptedAt: int): bool =
  (acceptedAt >= J::november2026Start implies policyFor(acceptedAt) == ValueV1) and
  (acceptedAt < J::september2026Start implies policyFor(acceptedAt) == LegacyV2)
pure val acceptedAtValues = Set(2431915, 2432000, 2432130, 2432200, 2432210)
```

### A scored source records its provenance and keeps the 10-Point minimum

A legacy-scored source keeps the amount the v2 rules gave it (including its
legacy category caps), supplied by the frozen v2 scorer. A new merge without
a current assessment is provisional at 10 Points.

```quint
type Provenance = Unscored | LegacyScored | Provisional | Assessed | Ratified
type AssessmentSource = SubscriptionDeclared | PaidApiReceipt
type Assessment = { band: int, source: AssessmentSource, sourceDigest: str, rubric: str, model: str, exactHead: bool }
type Ratification = { band: int, maintainer: int, currentAuthority: bool, exactHead: bool, record: str }
type Scored = { phase: Provenance, acceptedAt: int, policy: Policy, legacyPoints: int, points: int,
  frozen: bool, frozenPoints: int, held: bool, pendingBand: int, rubric: str, model: str, billingProven: bool }
pure val initial: Scored = { phase: Unscored, acceptedAt: 0, policy: LegacyV2, legacyPoints: 0, points: 0,
  frozen: false, frozenPoints: 0, held: false, pendingBand: -1, rubric: "", model: "", billingProven: false }
pure def canAccept(s: Scored, acceptedAt: int, legacyPoints: int): bool =
  s.phase == Unscored and acceptedAt > 0 and legacyPoints >= 10
pure def accept(s: Scored, acceptedAt: int, legacyPoints: int): Scored =
  if (policyFor(acceptedAt) == ValueV1)
    { ...s, phase: Provisional, acceptedAt: acceptedAt, policy: ValueV1, legacyPoints: legacyPoints, points: 10 }
  else { ...s, phase: LegacyScored, acceptedAt: acceptedAt, policy: policyFor(acceptedAt), legacyPoints: legacyPoints, points: legacyPoints }
pure def alwaysMinimum(s: Scored): bool = s.phase != Unscored implies s.points >= 10
pure def alwaysUnscoredUntouched(s: Scored): bool = s.phase == Unscored implies
  (not(s.frozen) and not(s.held) and not(s.billingProven) and s.points == 0 and s.frozenPoints == 0)
pure def alwaysLegacyScoredKeepsLegacyPoints(s: Scored): bool = s.phase == LegacyScored implies s.points == s.legacyPoints
pure def alwaysPolicyMatchesAcceptance(s: Scored): bool = s.phase != Unscored implies s.policy == policyFor(s.acceptedAt)
```

### A November assessment needs a paid API receipt; a historical one needs a subscription declaration

A November assessment applies at once unless ratified or frozen. A
September–October assessment waits for the historical import release. A
v2-era source is never rescored by assessment.

```quint
pure def validAssessment(s: Scored, x: Assessment): bool =
  x.band >= 0 and x.band <= 5 and x.sourceDigest != "" and x.rubric != "" and x.model != "" and x.exactHead and
  (if (s.policy == ValueV1) x.source == PaidApiReceipt else x.source == SubscriptionDeclared)
pure def canAssess(s: Scored, x: Assessment): bool =
  (s.phase == Provisional or s.phase == Assessed or s.phase == LegacyScored) and s.policy != LegacyV2 and
  not(s.frozen) and not(s.held) and validAssessment(s, x)
pure def assess(s: Scored, x: Assessment): Scored =
  if (s.policy == ValueV1)
    { ...s, phase: Assessed, points: A::sizePoints(x.band), rubric: x.rubric, model: x.model,
      billingProven: x.source == PaidApiReceipt }
  else { ...s, pendingBand: x.band, rubric: x.rubric, model: x.model, billingProven: false }
```

### A released historical import applies the current band to eligible unpaid work

```quint
type Release = { importId: int, released: bool, includesSource: bool }
pure def canApplyHistorical(s: Scored, r: Release): bool =
  s.policy == HistoricalValue and s.phase == LegacyScored and s.pendingBand >= 0 and
  r.importId > 0 and r.released and r.includesSource and not(s.frozen) and not(s.held)
pure def applyHistorical(s: Scored, r: Release): Scored =
  { ...s, phase: Assessed, points: A::sizePoints(s.pendingBand), pendingBand: -1 }
```

### A valid ratification takes precedence and a later assessment cannot replace it

The maintainer's current GitHub authority is rechecked when the
ratification record is read. Neither a ratification nor an assessment
changes a frozen source.

```quint
pure def canRatify(s: Scored, rat: Ratification): bool =
  s.phase != Unscored and not(s.frozen) and rat.band >= 0 and rat.band <= 5 and rat.maintainer > 0 and
  rat.currentAuthority and rat.exactHead and rat.record != ""
pure def ratify(s: Scored, rat: Ratification): Scored = { ...s, phase: Ratified, points: A::sizePoints(rat.band), pendingBand: -1 }
pure def canHold(s: Scored): bool = s.phase != Unscored and s.phase != Ratified and not(s.held)
pure def hold(s: Scored): Scored = { ...s, held: true }
pure def canFreeze(s: Scored): bool = s.phase != Unscored and not(s.frozen)
pure def freeze(s: Scored): Scored = { ...s, frozen: true, frozenPoints: s.points }
pure def alwaysFrozenPointsKept(s: Scored): bool = s.frozen implies s.points == s.frozenPoints
pure def alwaysHeldPreNovemberKeepsEarlier(s: Scored): bool =
  (s.held and s.policy != ValueV1 and s.phase == LegacyScored) implies s.points == s.legacyPoints
pure def alwaysLegacyNeverAssessed(s: Scored): bool = s.policy == LegacyV2 implies (s.phase == LegacyScored or s.phase == Ratified or s.phase == Unscored)
pure def alwaysSubscriptionIsNotBilling(s: Scored): bool = s.policy != ValueV1 implies not(s.billingProven)
pure def stepRatificationPrecedes(before: Scored, after: Scored): bool =
  before.phase == Ratified implies after.phase == Ratified
pure def stepFrozenNeverChanges(before: Scored, after: Scored): bool =
  before.frozen implies (after.frozen and after.points == before.points)
pure def sometimesValueAssessed(s: Scored): bool = s.phase == Assessed and s.policy == ValueV1 and s.points > 10
pure def sometimesHistoricalRescored(s: Scored): bool = s.phase == Assessed and s.policy == HistoricalValue
pure def sometimesRatifiedOverValue(s: Scored): bool = s.phase == Ratified and s.policy == ValueV1
pure def sometimesHeldKeepsLegacy(s: Scored): bool = s.held and s.policy == HistoricalValue and s.pendingBand >= 0
pure def sometimesZeroSizeKeepsMinimum(s: Scored): bool = s.phase == Assessed and s.points == 10
```

### Simulation samples include receipts, declarations and stale authority

```quint
pure val legacyPointsValues = Set(10, 30)
pure val xValues = Set(
  { band: 2, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", exactHead: true },
  { band: 0, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", exactHead: true },
  { band: 3, source: SubscriptionDeclared, sourceDigest: "d", rubric: "value-v1", model: "m", exactHead: true },
  { band: 3, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", exactHead: false })
pure val ratValues = Set({ band: 1, maintainer: 3, currentAuthority: true, exactHead: true, record: "slop-score" },
  { band: 4, maintainer: 3, currentAuthority: false, exactHead: true, record: "slop-score" })
pure val rValues = Set({ importId: 1, released: true, includesSource: true }, { importId: 1, released: false, includesSource: true })
```
