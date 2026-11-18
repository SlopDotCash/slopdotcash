# Payout recognition

PRD section 7 fixes payout recognition per recipient, project and cycle,
never per dollar or transfer, and never lets it change a payment share. This
library follows `src/lib/payout-points.ts` (`PAYOUT_POINTS = 25`, one award
per recipient, project and paid monthly-pool cycle) and the journal check in
`src/lib/points.ts` (`verified-payout-v1`, source `payout:<cycle>:<actor>`).

The cycle record comes from the published cycle index, which the settlement
publication produces only from finalized evidence
([monthly settlement](../settlement/monthly.md)). A cycle is a calendar
month (`payout:<YYYY-MM>:<actor>`). Ordinary finalized monthly vault
payments are a second source (`scripts/vault-payout-points.ts`, the public
`PublicVaultPayment` projection of each recipient's finalized ordinary
payments). The [Points journal](./journal.md) appends the recognition once
per project, month and numeric GitHub ID, whichever source supplies it
first.

## Story: Recognize a verified payout once per recipient, project and cycle

### Only a paid recipient of a paid, settled monthly-pool cycle is recognized

Every other cycle kind, an unpaid recipient, a cycle without a settlement
record and a zero payment earn nothing (`src/lib/payout-points.ts` keys on a
paid monthly-pool cycle with a settlement record and a positive `paidMinor`).
The number of transfers, including none recorded, and the paid amount never
change the 25 Points.

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
  p.paidMinor > 0
pure def recognitionAmount(p: PaidRecipient): int = if (eligible(p)) recognitionPoints else 0
pure def lawFixedPerCycle(paid: PaidRecipient, paidMinor: int, transfers: int): bool =
  (eligible(paid) and paidMinor > 0 and transfers >= 0) implies
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

### A finalized ordinary monthly vault payment earns recognition once per recipient, project and month

A payment counts when it is finalized and ordinary (the public projection
lists no reserved, unfinalized or security-bounty payment), on a known
escrow network that is not a testnet, with a proven contribution month and
a positive net amount, for a recipient whose numeric GitHub ID resolves (an
unresolvable identity fails the run). It earns exactly 25 Points at the
instant its finalized evidence was indexed, never its block time; the
amount, the number of transfers and the network never change the 25. A
testnet, unproven-month or zero payment earns nothing. Payments are read in
order of indexing time, then payment ID, and only the first recognition of
a month is kept, so a second network or a second node-ID spelling of the
same GitHub account recognizes nothing more.

```quint
type VaultPayment = { project: str, actor: int, month: int, knownNetwork: bool, testnet: bool, finalized: bool,
  ordinary: bool, netBase: int, indexedAt: int, digest: str }
pure def vaultEligible(v: VaultPayment): bool =
  v.project != "" and v.actor > 0 and v.month > 0 and v.knownNetwork and not(v.testnet) and v.finalized and
  v.ordinary and v.netBase > 0 and v.indexedAt > 0 and v.digest != ""
pure def vaultRecognitionAmount(v: VaultPayment): int = if (vaultEligible(v)) recognitionPoints else 0
pure def lawVaultFixedPerMonth(v: VaultPayment, netBase: int): bool =
  (vaultEligible(v) and netBase > 0) implies vaultRecognitionAmount({ ...v, netBase: netBase }) == recognitionPoints
pure def lawTestnetOrUnprovenEarnsNothing(v: VaultPayment): bool =
  (v.testnet or v.month <= 0 or v.netBase <= 0 or not(v.finalized) or not(v.ordinary)) implies vaultRecognitionAmount(v) == 0
pure val vaultSample: VaultPayment = { project: "p", actor: 1, month: 24320, knownNetwork: true, testnet: false, finalized: true,
  ordinary: true, netBase: 5000000, indexedAt: 2432120, digest: "vault" }
pure val vValues = Set(vaultSample, { ...vaultSample, testnet: true }, { ...vaultSample, month: 0 },
  { ...vaultSample, netBase: 0 }, { ...vaultSample, ordinary: false }, { ...vaultSample, digest: "vault2", indexedAt: 2432130 })
pure val netBaseValues = Set(0, 1, 5000000)
```
