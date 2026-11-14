# Public and private projections

PRD sections 2, 3, 6, 7, 8 and 9. Public pages derive from the registry and
validated journals. They retain source-count integrity and explicit freshness.
These pure projections form contracts for eventual view components.

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

```quint
type PaymentView = { privateCase: bool, closedAccount: bool, finalized: bool, exact: bool, contributionMonth: int, net: int }
pure def publicPayment(payment: PaymentView): bool = not(payment.privateCase) and not(payment.closedAccount) and payment.finalized and payment.exact and payment.net >= 0
pure def knownContributionMonth(payment: PaymentView): bool = payment.contributionMonth > 0
pure def lawPrivatePaymentNeverPublic(payment: PaymentView): bool = payment.privateCase implies not(publicPayment(payment))
pure def lawPublicPaymentHasFinality(payment: PaymentView): bool = publicPayment(payment) implies payment.finalized and payment.exact and not(payment.closedAccount)
pure val paymentValues = Set(
  { privateCase: true, closedAccount: false, finalized: true, exact: true, contributionMonth: 202611, net: 98 },
  { privateCase: false, closedAccount: false, finalized: true, exact: true, contributionMonth: 0, net: 98 },
  { privateCase: false, closedAccount: true, finalized: false, exact: false, contributionMonth: 0, net: 0 }
)
```

### Removed public evidence pages and downloads stay unavailable

The boundary maps these routes to HTTP 404. Ordinary APIs and retained records
keep their separate contracts. Private trace bodies have no readable route.

```quint
pure def removedRoute(path: str): bool = Set("/models", "/receipts", "/data/cycles/eliza/2026-09/proposal.json", "/downloads/contribute-to-eliza.skill").contains(path)
pure def publicRouteAllowed(path: str): bool = not(removedRoute(path))
pure def traceBodyReadable(viewer: int): bool = false
pure def lawRemovedRoutesStayClosed(path: str): bool = removedRoute(path) implies not(publicRouteAllowed(path))
pure def lawTraceBodiesStayPrivate(viewer: int): bool = not(traceBodyReadable(viewer))
pure val pathValues = Set("/models", "/receipts", "/projects")
```

### Interface capability requirements survive responsive and accessibility modes

The shell must preserve visible consent, amounts, restrictions and evidence,
field-linked errors, announcements and recovery actions at mobile widths and
200% zoom. Keyboard and screen-reader access, WCAG AA, stable headings and
reduced-motion behavior require real browser acceptance. A formal predicate
records those obligations without claiming a rendered page meets them.

```quint
type InterfaceEvidence = { keyboard: bool, screenReader: bool, mobile: bool, zoom200: bool, contrastAA: bool, reducedMotion: bool, visibleConsent: bool, exactAmounts: bool, recovery: bool, links: bool, console: bool, network: bool }
pure def acceptedInterface(e: InterfaceEvidence): bool = e.keyboard and e.screenReader and e.mobile and e.zoom200 and
  e.contrastAA and e.reducedMotion and e.visibleConsent and e.exactAmounts and e.recovery and e.links and e.console and e.network
pure def lawAcceptanceRequiresKeyboard(e: InterfaceEvidence): bool = acceptedInterface(e) implies e.keyboard and e.mobile and e.zoom200
pure val eValues = Set(
  { keyboard: true, screenReader: true, mobile: true, zoom200: true, contrastAA: true, reducedMotion: true, visibleConsent: true, exactAmounts: true, recovery: true, links: true, console: true, network: true },
  { keyboard: false, screenReader: true, mobile: true, zoom200: true, contrastAA: true, reducedMotion: true, visibleConsent: true, exactAmounts: true, recovery: true, links: true, console: true, network: true }
)
```

## Story: Distinguish an award decision from its funding and payment

### Award, funding and settlement status are independent facts

The account and case services supply these facts from their owning records.
An approved award can remain underfunded or await a wallet. A scheduled or
submitted payment keeps its financial obligation until exact finality is
reconciled. A missing funding observation remains unavailable. The separate
contributor token allocation owns its Unclaimed state.

```quint
type AwardDecision = Projected | UnderReview | ApprovedAward | ExcludedAward
type FundingObservation = FundingUnavailable | Underfunded | Funded
type PaymentDisplay = PaymentUnavailable | PaymentUnderfunded | AwaitingWallet | ReadyToPay | ScheduledPayment | HeldPayment | SubmittedPayment | PaidPayment
type AwardFacts = { decision: AwardDecision, funding: FundingObservation, wallet: bool,
  scheduled: bool, held: bool, submitted: bool, exactFinality: bool }
pure def paymentDisplay(facts: AwardFacts): PaymentDisplay =
  if (facts.exactFinality) PaidPayment
  else if (facts.submitted) SubmittedPayment
  else if (facts.held) HeldPayment
  else if (facts.funding == FundingUnavailable) PaymentUnavailable
  else if (facts.funding == Underfunded) PaymentUnderfunded
  else if (not(facts.wallet)) AwaitingWallet
  else if (facts.scheduled) ScheduledPayment
  else ReadyToPay
pure def lawPaidNeedsFinality(facts: AwardFacts): bool =
  paymentDisplay(facts) == PaidPayment implies facts.exactFinality
pure def lawApprovalIsNotPayment(facts: AwardFacts): bool =
  facts.decision == ApprovedAward and not(facts.exactFinality) implies paymentDisplay(facts) != PaidPayment
pure def lawMissingFundingIsUnavailable(facts: AwardFacts): bool =
  facts.funding == FundingUnavailable and not(facts.exactFinality) and not(facts.submitted) and not(facts.held)
    implies paymentDisplay(facts) == PaymentUnavailable
pure val factsValues = Set(
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
pure def lawLifetimeIncludesEveryPeriod(entries: List[StandingEntry], actor: int): bool =
  pointsFor(entries, actor, 0) == entries.foldl(0, (total, entry) => total +
    (if (entry.actor == actor) entry.points else 0))
pure val entriesValues = Set(
  List(),
  List({ actor: 1, period: 1, points: 10 }, { actor: 1, period: 2, points: 30 }, { actor: 2, period: 1, points: 30 })
)
pure val totalsValues = Set(List(), List(10, 30, 30))
pure val leftValues = Set(10, 30)
pure val rightValues = Set(10, 30)
pure val actorValues = Set(1, 2)
pure val periodValues = Set(0, 1, 2)
pure val pointsValues = Set(10, 30)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val viewerValues = Set(0, 1, 2)
```
