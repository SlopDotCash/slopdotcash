# Points periods and settlement freezes

PRD sections 6 and 7 assign every award and penalty to the UTC month of its
occurrence, and keep approved, funded, scheduled and paid reward periods
unchanged. This library holds the instant encoding, the policy boundaries and
the settlement freeze evidence that the [Points journal](./journal.md), [work
units](./workUnits.md), the [scoring policy](./scoringPolicy.md), [reward
weights](./rewardWeights.md) and [historical corrections](./corrections.md)
share. The freeze record is produced by the monthly settlement lifecycle
([monthly settlement](../settlement/monthly.md)) from its own phase and
obligation rows; consuming it here is composition obligation C1.

## Story: Place every Points record in its UTC month

### An instant is a UTC month and day, and a period is the month of occurrence

An instant is `month * 100 + day`, with `month` counted from year 0 and `day`
from 0. The adapter converts exact UTC timestamps without loss of order.

```quint
pure val monthSpan = 100
pure def periodOf(at: int): int = at / monthSpan
pure val september2026 = 24320
pure val october2026 = 24321
pure val november2026 = 24322
pure val september2026Start = 2432000
pure val november2026Start = 2432200
pure val participationEnd = 2432123
pure val maxSafe = 9007199254740991
pure def lawPeriodOrdered(first: int, second: int): bool = (first >= 0 and first <= second) implies periodOf(first) <= periodOf(second)
```

### A period freezes only when settlement has frozen, reserved or completed it, or an obligation exists

The monthly settlement phase `Collecting` or `Proposed` without an approved,
funded, scheduled or paid obligation never freezes a period.

```quint
type SettlementPhase = Collecting | Proposed | Frozen | Reserved | Completed
type FreezeEvidence = { project: str, period: int, phase: SettlementPhase, obligationExists: bool }
pure def freezes(f: FreezeEvidence): bool =
  f.project != "" and f.period >= 0 and
  (f.phase == Frozen or f.phase == Reserved or f.phase == Completed or f.obligationExists)
pure def lawOpenProposalNeverFreezes(project: str, period: int): bool =
  not(freezes({ project: project, period: period, phase: Proposed, obligationExists: false })) and
  not(freezes({ project: project, period: period, phase: Collecting, obligationExists: false }))
pure val projectValues = Set("", "p")
pure val periodValues = Set(-1, 24320)
```
