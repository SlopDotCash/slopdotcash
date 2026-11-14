# Payout recognition

PRD section 7 fixes payout recognition per recipient, project and cycle,
never per dollar or transfer, and never lets it change a payment share. This
library follows `src/lib/payout-points.ts` (`PAYOUT_POINTS = 25`, one award
per recipient, project and paid monthly-pool cycle) and the journal check in
`src/lib/points.ts` (`verified-payout-v1`, source `payout:<cycle>:<actor>`).

The cycle record comes from the published cycle index, which the settlement
publication produces only from finalized evidence
([monthly settlement](../settlement/monthly.md)). The [Points
journal](./journal.md) appends the recognition once per key.

## Story: Recognize a verified payout once per recipient, project and cycle

### Only a paid recipient of a paid, settled monthly-pool cycle is recognized

Every other cycle kind, an unpaid recipient, a cycle without a settlement
record and a zero payment earn nothing. The number of transfers and the paid
amount never change the 25 Points.

```quint
type CycleKind = MonthlyPool | LegacyCycle
type CycleState = CycleOpen | CycleProposed | CyclePaid | CycleHeld
type RecipientState = RecipientPaid | RecipientUnclaimed | RecipientHeld | RecipientExcluded
type PaidRecipient = { project: str, cycle: int, actor: int, kind: CycleKind, state: CycleState,
  settledAt: int, settlementDigest: str, recipientState: RecipientState, paidMinor: int, transfers: int }
pure val recognitionPoints = 25
pure def eligible(p: PaidRecipient): bool =
  p.project != "" and p.cycle > 0 and p.actor > 0 and p.kind == MonthlyPool and p.state == CyclePaid and
  p.settledAt > 0 and p.settlementDigest != "" and p.recipientState == RecipientPaid and
  p.paidMinor > 0 and p.transfers > 0
pure def recognitionAmount(p: PaidRecipient): int = if (eligible(p)) recognitionPoints else 0
pure def lawFixedPerCycle(paid: PaidRecipient, paidMinor: int, transfers: int): bool =
  (eligible(paid) and paidMinor > 0 and transfers > 0) implies
    recognitionAmount({ ...paid, paidMinor: paidMinor, transfers: transfers }) == recognitionPoints
pure def lawOnlyPaidRecognized(paid: PaidRecipient): bool =
  (paid.state != CyclePaid or paid.recipientState != RecipientPaid or paid.kind != MonthlyPool) implies recognitionAmount(paid) == 0
pure val paidSample: PaidRecipient = { project: "p", cycle: 24320, actor: 1, kind: MonthlyPool, state: CyclePaid,
  settledAt: 2432110, settlementDigest: "settled", recipientState: RecipientPaid, paidMinor: 5000000, transfers: 1 }
pure val paidValues = Set(paidSample, { ...paidSample, actor: 2, transfers: 2 }, { ...paidSample, state: CycleProposed },
  { ...paidSample, recipientState: RecipientUnclaimed }, { ...paidSample, kind: LegacyCycle }, { ...paidSample, settlementDigest: "" })
pure val paidMinorValues = Set(0, 1, 5000000)
pure val transfersValues = Set(0, 1, 3)
```
