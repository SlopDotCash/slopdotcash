# Public and private projections

PRD sections 2, 3, 6, 7, 8 and 9. Public pages derive from the registry and
validated journals. They retain source-count integrity and explicit freshness.
These pure projections form contracts for eventual view components. Loading,
empty, stale, invalid and error states stay distinct, and stale or loading
data never shows money or a zero.

## Story: Show only the records a viewer may read

### Project visibility, collection and installation have separate predicates

Paused projects remain listed. Retired and legacy projects resolve history but
leave discovery and collection. Installation additionally requires skill fields
and security clearance.

```quint
type ProjectView = { registered: bool, retired: bool, legacy: bool, paused: bool, flagged: bool, quarantined: bool, cleared: bool, skillFields: bool }
pure def listed(p: ProjectView): bool = p.registered and not(p.retired) and not(p.legacy)
pure def collected(p: ProjectView): bool = listed(p) and not(p.paused) and not(p.flagged) and not(p.quarantined)
pure def installable(p: ProjectView): bool = collected(p) and p.cleared and p.skillFields
pure def lawPausedRemainsListed(p: ProjectView): bool =
  p.registered and p.paused and not(p.retired) and not(p.legacy) implies listed(p) and not(collected(p))
pure def lawInstallationRequiresClearance(p: ProjectView): bool = installable(p) implies p.cleared and p.skillFields
pure val pValues = Set(
  { registered: true, retired: false, legacy: false, paused: false, flagged: false, quarantined: false, cleared: true, skillFields: true },
  { registered: true, retired: false, legacy: false, paused: true, flagged: false, quarantined: false, cleared: true, skillFields: true },
  { registered: true, retired: true, legacy: false, paused: true, flagged: false, quarantined: false, cleared: true, skillFields: true }
)
```

### Ordinary public payment rows require finalized evidence and a public account

Private-case amounts, counts and revealing totals never enter ordinary pages.
Missing contribution month stays unavailable rather than using indexing time.
Net amounts preserve the exact full-width asset base units from settlement;
public rendering must never coerce them to a JavaScript number.

```quint
import money as M from "../settlement/money"
type PaymentView = { privateCase: bool, closedAccount: bool, finalized: bool, exact: bool, contributionMonth: int, net: M::Amount }
pure def publicPayment(payment: PaymentView): bool = not(payment.privateCase) and not(payment.closedAccount) and payment.finalized and payment.exact and M::validAmount(payment.net)
pure def knownContributionMonth(payment: PaymentView): bool = payment.contributionMonth > 0
pure def lawPrivatePaymentNeverPublic(payment: PaymentView): bool = payment.privateCase implies not(publicPayment(payment))
pure def lawPublicPaymentHasFinality(payment: PaymentView): bool = publicPayment(payment) implies payment.finalized and payment.exact and not(payment.closedAccount)
pure val paymentValues = Set(
  { privateCase: true, closedAccount: false, finalized: true, exact: true, contributionMonth: 202611, net: List(98) },
  { privateCase: false, closedAccount: false, finalized: true, exact: true, contributionMonth: 0, net: List(98) },
  { privateCase: false, closedAccount: true, finalized: false, exact: false, contributionMonth: 0, net: List(0) }
)
```

### Removed public evidence pages and downloads stay unavailable

The boundary maps these routes to HTTP 404. Ordinary APIs and retained records
keep their separate contracts. Private trace bodies have no readable route
([the trace server](../contributor/traceServer.md) owns that contract).

```quint
pure def removedRoute(path: str): bool = Set("/models", "/receipts", "/data/cycles/eliza/2026-09/proposal.json", "/downloads/contribute-to-eliza.skill").contains(path)
```

### Interface capability requirements survive responsive and accessibility modes

The shell must preserve visible consent, amounts, restrictions and evidence,
field-linked errors, announcements and recovery actions at mobile widths and
200% zoom. Keyboard and screen-reader access, WCAG AA, stable headings and
reduced-motion behavior require real browser acceptance. A formal predicate
records those obligations without claiming a rendered page meets them; the
browser tests are the evidence.

```quint
type InterfaceEvidence = { keyboard: bool, screenReader: bool, mobile: bool, zoom200: bool, contrastAA: bool, reducedMotion: bool, visibleConsent: bool, exactAmounts: bool, recovery: bool, links: bool, console: bool, network: bool }
pure def acceptedInterface(e: InterfaceEvidence): bool = e.keyboard and e.screenReader and e.mobile and e.zoom200 and
  e.contrastAA and e.reducedMotion and e.visibleConsent and e.exactAmounts and e.recovery and e.links and e.console and e.network
```

### An exemption is never displayed as a passed scan

The repository's admission basis comes from
[enforcement](../security/enforcement.md) (`basis`): a clean verified scan,
the frozen migration-0075 existing-project exemption, an owner-approved
exemption, or not cleared. Each has its own label; an exemption keeps its
label whatever the repository's later content, and a repository that is not
cleared says so.

```quint
type AdmissionBasis = ScanPassed | ExistingProjectExemption | OwnerApprovedExemption | NoClearance
pure val passedScanLabel = "Passed admission scan"
pure def admissionLabel(admissionBasis: AdmissionBasis): str =
  if (admissionBasis == ScanPassed) passedScanLabel
  else if (admissionBasis == ExistingProjectExemption) "Existing-project exemption"
  else if (admissionBasis == OwnerApprovedExemption) "Owner-approved exemption"
  else "Not cleared"
pure def lawExemptionNeverShownAsPassedScan(admissionBasis: AdmissionBasis): bool =
  (admissionBasis == ExistingProjectExemption or admissionBasis == OwnerApprovedExemption)
    implies admissionLabel(admissionBasis) != passedScanLabel
pure def lawUnclearedNeverShownAsCleared(admissionBasis: AdmissionBasis): bool =
  admissionBasis == NoClearance implies admissionLabel(admissionBasis) == "Not cleared"
```

## Story: Distinguish an award decision from its funding and payment

### Award, funding and settlement status are independent facts

The account and case services supply these facts from their owning records.
Only an approved award shows a payment state: a projected, under-review or
excluded award shows its decision, whatever the funding or wallet. An
approved award can remain underfunded or await a wallet. A scheduled or
submitted payment keeps its financial obligation until exact finality is
reconciled. A missing funding observation remains unavailable. A submitted
or finalized payment beside an award that is not approved contradicts the
award journal and is shown as invalid, never as paid. The separate
contributor token allocation owns its Unclaimed state.

```quint
type AwardDecision = Projected | UnderReview | ApprovedAward | ExcludedAward
type FundingObservation = FundingUnavailable | Underfunded | Funded
type PaymentDisplay = PaymentUnavailable | PaymentUnderfunded | AwaitingWallet | ReadyToPay | ScheduledPayment | HeldPayment | SubmittedPayment | PaidPayment
type AwardDisplay = DecisionState({ decision: AwardDecision }) | PaymentState({ payment: PaymentDisplay }) | InvalidAward
type AwardFacts = { decision: AwardDecision, funding: FundingObservation, wallet: bool,
  scheduled: bool, held: bool, submitted: bool, exactFinality: bool }
pure def paymentDisplay(facts: AwardFacts): AwardDisplay =
  if (facts.decision != ApprovedAward)
    (if (facts.exactFinality or facts.submitted) InvalidAward else DecisionState({ decision: facts.decision }))
  else PaymentState({ payment: settlementDisplay(facts) })
pure def showsPayment(display: AwardDisplay): bool = match display { | PaymentState(p) => true | _ => false }
pure def showsPaymentState(display: AwardDisplay, shown: PaymentDisplay): bool =
  match display { | PaymentState(p) => p.payment == shown | _ => false }
pure def invalidAward(display: AwardDisplay): bool = match display { | InvalidAward => true | _ => false }
pure def settlementDisplay(facts: AwardFacts): PaymentDisplay =
  if (facts.exactFinality) PaidPayment
  else if (facts.submitted) SubmittedPayment
  else if (facts.held) HeldPayment
  else if (facts.funding == FundingUnavailable) PaymentUnavailable
  else if (facts.funding == Underfunded) PaymentUnderfunded
  else if (not(facts.wallet)) AwaitingWallet
  else if (facts.scheduled) ScheduledPayment
  else ReadyToPay
pure def lawPaidNeedsFinality(facts: AwardFacts): bool =
  showsPaymentState(paymentDisplay(facts), PaidPayment) implies facts.exactFinality and facts.decision == ApprovedAward
pure def lawOnlyApprovedAwardsShowPaymentStates(facts: AwardFacts): bool =
  showsPayment(paymentDisplay(facts)) iff facts.decision == ApprovedAward
pure def lawUnapprovedMoneyIsInvalid(facts: AwardFacts): bool =
  (facts.decision != ApprovedAward and facts.exactFinality) implies invalidAward(paymentDisplay(facts))
pure def lawApprovalIsNotPayment(facts: AwardFacts): bool =
  facts.decision == ApprovedAward and not(facts.exactFinality) implies not(showsPaymentState(paymentDisplay(facts), PaidPayment))
pure def lawMissingFundingIsUnavailable(facts: AwardFacts): bool =
  facts.decision == ApprovedAward and facts.funding == FundingUnavailable and not(facts.exactFinality) and not(facts.submitted)
    and not(facts.held) implies showsPaymentState(paymentDisplay(facts), PaymentUnavailable)
pure val factsValues = Set(
  { decision: Projected, funding: Funded, wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false },
  { decision: ExcludedAward, funding: Funded, wallet: true, scheduled: false, held: false, submitted: true, exactFinality: true },
  { decision: ApprovedAward, funding: FundingUnavailable, wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false },
  { decision: ApprovedAward, funding: Underfunded, wallet: false, scheduled: false, held: false, submitted: false, exactFinality: false },
  { decision: ApprovedAward, funding: Funded, wallet: false, scheduled: false, held: false, submitted: false, exactFinality: false },
  { decision: ApprovedAward, funding: Funded, wallet: true, scheduled: true, held: false, submitted: false, exactFinality: false },
  { decision: ApprovedAward, funding: Funded, wallet: true, scheduled: false, held: false, submitted: true, exactFinality: true },
  { decision: UnderReview, funding: FundingUnavailable, wallet: false, scheduled: false, held: false, submitted: false, exactFinality: false }
)
```

## Story: Read Points standings with equal ranks for equal totals

### Monthly and lifetime standings sum the same accepted-work history

The journal supplies already validated public accepted-work rows. Participation,
private-case money, token use and Slopbot activity are excluded before this
projection. A zero period selects lifetime history. A positive period selects
that exact UTC contribution period, without changing its occurrence date.

```quint
type StandingEntry = { actor: int, period: int, points: int }
pure def lifetimePoints(entries: List[StandingEntry], actor: int): int =
  entries.foldl(0, (total, entry) => total +
    (if (entry.actor == actor) entry.points else 0))
pure def pointsFor(entries: List[StandingEntry], actor: int, period: int): int =
  if (period == 0) lifetimePoints(entries, actor)
  else entries.foldl(0, (total, entry) => total +
    (if (entry.actor == actor and entry.period == period) entry.points else 0))
pure def higherCount(totals: List[int], points: int): int =
  totals.foldl(0, (count, total) => count + (if (total > points) 1 else 0))
pure def rankAt(totals: List[int], points: int): int = 1 + higherCount(totals, points)
pure def lawEqualPointsHaveEqualRank(totals: List[int], left: int, right: int): bool =
  left == right implies rankAt(totals, left) == rankAt(totals, right)
pure val totalsValues = Set(List(), List(10, 30, 30))
pure val leftValues = Set(10, 30)
pure val rightValues = Set(10, 30)
```

## Story: Show a monthly amount only while the vault holds it

### Pool funding is Funded, Withdrawn or points only

The operator decision of 15 November 2026 (PRD section 6) shows a monthly
pool's amount on cards, lists, project and funding pages only when the
project's recorded vaults on paying networks hold it, from cached finalized
counters (`src/lib/pool-funding.ts:156–217`, `GET /api/v1/pool-funding`).
Owed now is this month's amount plus last month's until last month's cutoff
72 hours into this month. From December 2026 a month is promised only if it
was funded on the 1st: the vaults' first finalized read of the month, within
an hour of 00:00 UTC, held this month's amount plus last month's. It then
stays Funded while the current free balance covers what is owed, and becomes
Withdrawn when a withdrawal during the month left it short. Everything else,
and any read that is loading, stale or failed, shows points only: never an
amount and never zero. The month-start read itself is retained once by the
[vault snapshots](../settlement/vaultSnapshots.md).

```quint
type PoolRead = PoolLoading | PoolCurrent | PoolStale | PoolFailed
type PoolDisplay = PoolFunded | PoolWithdrawn | PointsOnly
type PoolFacts = { read: PoolRead, monthlyPool: bool, period: int, amount: M::Amount, priorAmount: M::Amount,
  priorPending: bool, freeNow: M::Amount, monthStartRead: bool, freeAtStart: M::Amount, withdrawnSince: bool }
pure val fundedOnFirstFrom = 202612
pure def owedNow(pool: PoolFacts): M::Amount =
  if (pool.priorPending) M::addAmounts(pool.amount, pool.priorAmount) else pool.amount
pure def promisedAtStart(pool: PoolFacts): bool = pool.monthStartRead
  and M::compareAmounts(pool.freeAtStart, M::addAmounts(pool.amount, pool.priorAmount)) >= 0
pure def poolDisplay(pool: PoolFacts): PoolDisplay =
  val coversNow = M::compareAmounts(pool.freeNow, owedNow(pool)) >= 0
  if (pool.read != PoolCurrent or not(pool.monthlyPool) or not(M::positiveAmount(pool.amount))) PointsOnly
  else if (pool.period < fundedOnFirstFrom) (if (coversNow) PoolFunded else PointsOnly)
  else if (not(promisedAtStart(pool))) PointsOnly
  else if (coversNow) PoolFunded
  else if (pool.withdrawnSince) PoolWithdrawn else PointsOnly
pure def lawOnlyCurrentReadsShowMoney(pool: PoolFacts): bool =
  pool.read != PoolCurrent implies poolDisplay(pool) == PointsOnly
pure def lawFundedIsCovered(pool: PoolFacts): bool =
  poolDisplay(pool) == PoolFunded implies M::compareAmounts(pool.freeNow, owedNow(pool)) >= 0
pure def lawPromiseNeedsTheFirst(pool: PoolFacts): bool =
  (pool.period >= fundedOnFirstFrom and poolDisplay(pool) != PointsOnly) implies promisedAtStart(pool)
pure def lawWithdrawnNeedsWithdrawal(pool: PoolFacts): bool =
  poolDisplay(pool) == PoolWithdrawn implies pool.withdrawnSince and promisedAtStart(pool)
```

### Slop's pages refuse a withdrawal below the promised amount

While the month is Funded, the owner withdrawal form on Slop's pages refuses
an amount that would leave the free balance below what is owed now
(`src/VaultActions.tsx:123–130,263–269`). The contract does not enforce
this; it is a promise of Slop's pages only.

```quint
pure def withdrawalAllowedOnSlopPages(pool: PoolFacts, withdrawal: M::Amount): bool =
  poolDisplay(pool) != PoolFunded
    or M::compareAmounts(pool.freeNow, M::addAmounts(owedNow(pool), withdrawal)) >= 0
pure def lawWithdrawalKeepsPromise(pool: PoolFacts, withdrawal: M::Amount): bool =
  (poolDisplay(pool) == PoolFunded and withdrawalAllowedOnSlopPages(pool, withdrawal))
    implies M::compareAmounts(pool.freeNow, M::addAmounts(owedNow(pool), withdrawal)) >= 0
pure def lawUnpromisedMonthNeverRefuses(pool: PoolFacts, withdrawal: M::Amount): bool =
  poolDisplay(pool) != PoolFunded implies withdrawalAllowedOnSlopPages(pool, withdrawal)
pure val fundedPool: PoolFacts = { read: PoolCurrent, monthlyPool: true, period: 202612, amount: List(10),
  priorAmount: List(10), priorPending: true, freeNow: List(25), monthStartRead: true, freeAtStart: List(20), withdrawnSince: false }
pure val poolValues = Set(fundedPool, { ...fundedPool, read: PoolStale }, { ...fundedPool, freeNow: List(15), withdrawnSince: true },
  { ...fundedPool, freeAtStart: List(15) }, { ...fundedPool, period: 202611, monthStartRead: false })
pure val withdrawalValues = Set(List(0), List(5), List(6))
```

## Story: Show public cuts, merge activity and their freshness

### The cycle page lists public cuts with distinct loading, error, empty and list states

Each public cut of the [month](../settlement/monthly.md) shows the proposed
amount, the new amount, the reason and the time (`src/CyclePages.tsx`
`OwnerCuts`, `src/lib/use-monthly-cuts.ts`). The read follows the shared
[read lifecycle](./requests.md): while it loads the section says so; a
failed, invalid or unavailable read shows an error with Retry; an empty
current read says "No cuts."; a stale read keeps its retained list with the
stale notice.

```quint
import requests as R from "./requests"
type CutListView = CutsLoading | CutsError | NoCuts | CutsListed | CutsStale
pure val noCutsText = "No cuts."
pure def cutListView(status: R::ReadStatus): CutListView =
  if (status == R::Idle or status == R::Loading) CutsLoading
  else if (status == R::Current) CutsListed
  else if (status == R::Empty) NoCuts
  else if (status == R::Stale) CutsStale
  else CutsError
pure def offersRetry(view: CutListView): bool = view == CutsError
pure def lawOnlyCurrentEmptySaysNoCuts(status: R::ReadStatus): bool = cutListView(status) == NoCuts iff status == R::Empty
pure def lawFailuresOfferRetry(status: R::ReadStatus): bool =
  (status == R::Failed or status == R::Invalid or status == R::Unavailable) implies offersRetry(cutListView(status))
```

### The merge line stays hidden until a repository is read, and a failed read shows its date

The merge line (`src/App.tsx` `ProjectMergeActivity`, `src/lib/merge-activity.ts`)
reads the stored [merge activity](../backend/mergeActivity.md) rows. No row
hides the line. A row whose latest attempt failed shows the last values as
stale with their observed date. A row with an invalid date, a negative or
unsafe count, or a median without a merged pull request is refused, and the
line shows nothing from it. A null median or last merge stays absent, never
zero.

```quint
type MergeRow = { present: bool, observedAt: int, lastAttemptFailed: bool, lastMergedAt: int,
  waitingOutside: int, mergedOutside30d: int, medianDoubled: int }
type MergeLine = MergeHidden | MergeRefused | MergeCurrent({ observedAt: int }) | MergeStale({ observedAt: int })
pure def validMergeRow(row: MergeRow): bool = row.observedAt > 0 and row.lastMergedAt >= 0 and row.waitingOutside >= 0
  and row.mergedOutside30d >= 0 and row.medianDoubled >= -1 and (row.mergedOutside30d == 0 implies row.medianDoubled == -1)
pure def mergeLine(row: MergeRow): MergeLine =
  if (not(row.present)) MergeHidden
  else if (not(validMergeRow(row))) MergeRefused
  else if (row.lastAttemptFailed) MergeStale({ observedAt: row.observedAt })
  else MergeCurrent({ observedAt: row.observedAt })
pure def lineHidden(line: MergeLine): bool = match line { | MergeHidden => true | _ => false }
pure def lineRefused(line: MergeLine): bool = match line { | MergeRefused => true | _ => false }
pure def staleSince(line: MergeLine, observedAt: int): bool = match line { | MergeStale(s) => s.observedAt == observedAt | _ => false }
pure def lawNoRowHidesTheLine(row: MergeRow): bool = not(row.present) implies lineHidden(mergeLine(row))
pure def lawFailedAttemptIsStale(row: MergeRow): bool = (row.present and validMergeRow(row) and row.lastAttemptFailed)
  implies staleSince(mergeLine(row), row.observedAt)
pure def lawInvalidRowRefused(row: MergeRow): bool = (row.present and not(validMergeRow(row))) implies lineRefused(mergeLine(row))
pure val rowValues = Set(
  { present: false, observedAt: 0, lastAttemptFailed: false, lastMergedAt: 0, waitingOutside: 0, mergedOutside30d: 0, medianDoubled: -1 },
  { present: true, observedAt: 5, lastAttemptFailed: true, lastMergedAt: 3, waitingOutside: 2, mergedOutside30d: 1, medianDoubled: 4 },
  { present: true, observedAt: 5, lastAttemptFailed: false, lastMergedAt: 0, waitingOutside: 0, mergedOutside30d: 0, medianDoubled: 3 }
)
```
