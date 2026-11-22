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

### Direct transfers, owner allocation changes and unmapped legacy obligations also freeze their project-months

The settlement adapter derives `obligationExists` with the predicate of
`scripts/points-protection-sql.ts` (`protectedPointAwardSql`,
`pointProtectionQuery`). A project-month is protected when a monthly
payment run or a monthly allocation change exists for that project and
month, when a direct transfer of the project names that month as its
contribution month, or when the project has any payment obligation, of any
month, that no monthly payment obligation maps (same project, network,
vault and source digest). The one reviewed Base qualification payment
(PRD section 11, issue 904) is pinned data outside this predicate: its
finalized, paid obligation and its matching `paid` event never protect a
month. This is stricter than the settlement phase alone, which never freezes
an open proposal. Operator decision, 20 November 2026 (PRD section 7): the
Points of a project-month with a recorded payment are frozen by exactly this
predicate; the generator holds a candidate revision that would change them
and the import refuses a batch that changes one
([protected months](./protectedMonths.md)).

The individual records are private to the settlement adapter
(`pointProtectionQuery` is a private, read-only preflight): whether a
project-month has a payment run, an allocation change, a direct transfer or
an unmapped obligation never becomes a public source status. They stay in
the trusted runner, and only the combined freeze bit, through
`declassifyProtected`, reaches the freeze evidence.

```quint
type SecretProtectionRecords = { paymentRun: bool, allocationChange: bool, directTransfer: bool,
  unmappedObligation: bool }
pure def declassifyProtected(protection: SecretProtectionRecords): bool =
  protection.paymentRun or protection.allocationChange or protection.directTransfer or protection.unmappedObligation
pure def freezeEvidenceOf(project: str, period: int, phase: SettlementPhase, monthlyObligation: bool,
  protectedMonth: bool): FreezeEvidence =
  { project: project, period: period, phase: phase, obligationExists: monthlyObligation or protectedMonth }
pure def lawLegacyRecordsFreeze(project: str, period: int, phase: SettlementPhase,
  protection: SecretProtectionRecords): bool =
  (project != "" and period >= 0 and declassifyProtected(protection)) implies
    freezes(freezeEvidenceOf(project, period, phase, false, declassifyProtected(protection)))
pure def lawNoRecordKeepsOpenProposalOpen(project: str, period: int, protection: SecretProtectionRecords): bool =
  not(declassifyProtected(protection)) implies
    (not(freezes(freezeEvidenceOf(project, period, Proposed, false, declassifyProtected(protection)))) and
      not(freezes(freezeEvidenceOf(project, period, Collecting, false, declassifyProtected(protection)))))
pure val unprotected: SecretProtectionRecords = { paymentRun: false, allocationChange: false, directTransfer: false,
  unmappedObligation: false }
pure val protectionValues = Set(unprotected, { ...unprotected, paymentRun: true }, { ...unprotected, allocationChange: true },
  { ...unprotected, directTransfer: true }, { ...unprotected, unmappedObligation: true })
```
