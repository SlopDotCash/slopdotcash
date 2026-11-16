# Ranked snapshot hydration and payment-basis validation

PRD sections 3, 6 and 7 require exact source coverage and published payment
weights. This unit provides the early structural validation shared by
fresh snapshot construction, archived score views and payment projection.
The [source census](../points/census.md) owns collection completeness,
[standings](./projections.md) owns ordering and equal ranks, and the
[cache](./snapshotCache.md) owns fetch and consumer lifetimes. This unit
does not recompute Points, change a committed payment, or publish a
replacement snapshot.

Pinned `src/lib/leaderboard.ts` at
`78eed5564d796119d82ae541c36b0c770263dc5f` defines builder validation in
`createSnapshotWithReviewCutoff`, browser validation in
`assertLeaderboardSnapshot`, and the production payment projection in
`paymentReviewSnapshot`. The retained `ui_snapshot_contract` model combines
these boundaries. Here a structural failure is exposed before invoking the
next owner. The model receives normalized immutable source IDs and parsed UTC
milliseconds. Raw JSON parsing, exact repository and actor verification,
full score arithmetic, and event ID prefix decoding remain adapter
conformance.

## Story: Hydrate details only for real outcomes within the collected verification window

### First occurrences are retained per class and hydration classes are disjoint

A source class uses immutable GitHub node IDs. An empty ID refuses input.
Repeated records in one class resolve to the first occurrence. The merged
outcome census can cover more sources than the hydrated subsets. Each
detailed or review-only row requires a corresponding merged outcome and
an observed merge time in the half-open verification interval. Each
detail-eligible source requires full-detail hydration. An ID appearing in
both hydration classes refuses the build. This unit validates class
membership and dates. The census owns factual authentication and completeness.

```quint
type Hydrated = { node: str, mergedAt: int, knownTime: bool }
type BuildInput = { outcomes: List[str], detail: List[Hydrated], reviewOnly: List[Hydrated],
  detailEligible: List[str], verificationFrom: int, to: int, generatedAt: int }
pure def firstHydration(records: List[Hydrated]): List[Hydrated] =
  records.foldl(List(), (kept, row) => if (kept.some(prior => prior.node == row.node)) kept else kept.append(row))
pure def validHydration(input: BuildInput): bool =
  val detailRows = firstHydration(input.detail)
  val reviewedRows = firstHydration(input.reviewOnly)
  input.verificationFrom < input.to and input.generatedAt >= input.to
    and input.outcomes.every(id => id != "") and input.detail.every(row => row.node != "")
    and input.reviewOnly.every(row => row.node != "")
    and detailRows.every(row => not(reviewedRows.some(other => other.node == row.node)))
    and input.detailEligible.every(id => detailRows.some(row => row.node == id))
    and detailRows.concat(reviewedRows).every(row => input.outcomes.includes(row.node)
      and row.knownTime and input.verificationFrom <= row.mergedAt and row.mergedAt < input.to)
```

## Story: Refuse a public artifact that contradicts its published coverage

### Open counts are exact and processed counts are maximum distinct source counts

Open issues and open pull requests keep separate exact queue counts. Queue counts match the number of published rows. A shared accepted merge
can emit several actor rows without increasing the number of merged
sources. Count distinct directly merged sources, distinct indirect accepted
sources, distinct detailed sources, and distinct parent PRs of
non-continuity review rows. Direct and indirect accepted source IDs
cannot overlap. Count resolved issue ledger rows, one per distinct event.
An absent legacy closed-unmerged count supplies zero. The 35-day
verification interval ends at the same scoring cutoff and cannot begin before
the scoring window. Source timestamps match the artifact and scoring cutoff.

```quint
type EventKind = DirectMerge | IndirectMerge | MaterialChange | Evidence | Review | ResolvedIssue | OtherCredit
type LedgerRow = { id: str, kind: EventKind, source: str, parentPr: str, occurred: int, continuity: bool }
type Counts = { openIssues: int, openPulls: int, merged: int, closedUnmerged: int, detailed: int, resolved: int }
type Window = { scoringFrom: int, from: int, to: int, generatedAt: int, fetchedAt: int, cutoff: int }
type Marker = { exactFields: bool, policy: str, cutoff: int, reason: str }
type Change = { id: str, digest: str }
type PaymentBasis = { policy: str, cutoff: int, ledger: List[LedgerRow], removedEvents: List[str],
  attribution: List[Change], removedAttribution: List[str], attributionOrder: List[str] }
type Snapshot = { window: Window, counts: Counts, issues: List[str], pulls: List[str],
  ledger: List[LedgerRow], attribution: List[Change], basisPresent: bool, omittedPresent: bool,
  basis: PaymentBasis, omitted: Marker }
pure val verificationMillis = 3024000000
pure val paymentCutoff = 1791588095388
pure val paymentPolicy = "scr-05-payments-production-v1"
pure val omissionReason = "no-pre-policy-reviews"
pure def uniqueIds(ids: List[str]): bool =
  ids.every(id => id != "" and ids.select(other => other == id).length() == 1)
pure def distinctIds(ids: List[str]): List[str] =
  ids.foldl(List(), (seen, id) => if (seen.includes(id)) seen else seen.append(id))
pure def sourceIds(rows: List[LedgerRow], kind: EventKind): List[str] =
  distinctIds(rows.select(row => row.kind == kind).listMap(row => row.source))
pure def detailedIds(rows: List[LedgerRow]): List[str] =
  distinctIds(rows.select(row => row.kind == MaterialChange or row.kind == Evidence).listMap(row => row.source))
pure def reviewedIds(rows: List[LedgerRow]): List[str] =
  distinctIds(rows.select(row => row.kind == Review and not(row.continuity)).listMap(row => row.parentPr))
pure def validWindow(window: Window): bool =
  window.cutoff == window.to and window.fetchedAt == window.generatedAt and window.generatedAt >= window.to
    and window.to - window.from == verificationMillis and window.to - window.scoringFrom == verificationMillis
pure def nonnegativeCounts(c: Counts): bool =
  c.openIssues >= 0 and c.openPulls >= 0 and c.merged >= 0 and c.closedUnmerged >= 0 and c.detailed >= 0 and c.resolved >= 0
pure def validCoverage(s: Snapshot): bool =
  val direct = sourceIds(s.ledger, DirectMerge)
  val indirect = sourceIds(s.ledger, IndirectMerge)
  val resolved = s.ledger.select(row => row.kind == ResolvedIssue)
  validWindow(s.window) and nonnegativeCounts(s.counts)
    and s.issues.every(id => id != "") and s.pulls.every(id => id != "") and s.counts.openIssues == s.issues.length()
    and s.counts.openPulls == s.pulls.length()
    and uniqueIds(s.ledger.listMap(row => row.id))
    and s.ledger.every(row => row.source != "" and (row.kind != Review or row.parentPr != ""))
    and direct.length() <= s.counts.merged and indirect.length() <= s.counts.closedUnmerged
    and indirect.every(id => not(direct.includes(id))) and detailedIds(s.ledger).length() <= s.counts.detailed
    and reviewedIds(s.ledger).length() <= s.counts.merged + s.counts.closedUnmerged
    and resolved.length() <= s.counts.resolved
```

### Explicit payment differences and an omission marker are exclusive

The exact production rule is `scr-05-payments-production-v1` at
`2026-10-09T23:21:35.388Z`. At the producer, any formal review in the
input submitted before that instant calls for an explicit alternate basis
after the score-policy start. At the consumer, an omission marker contains
exactly policy, cutoff and `no-pre-policy-reviews`. Any score-ledger
substantive review dated strictly before the payment cutoff contradicts
omission, including continuity rows and score-zero rows. A score reader
allows an archived snapshot without either field. A payment reader refuses
that artifact. Rows exactly at the cutoff permit omission.

An explicit basis reconstructs the score ledger and attributions by
replacement or insertion, with unique changed and removed IDs. An absent
removal target or a change and removal for the same ID refuses. The
attribution order must cover every resulting ID exactly once. The alternate
ledger is checked against the same published coverage and cutoff. The
complete shell then validates the existing ranking, identity and scoring
contracts before exposing the payment view. This model validates membership,
leaving ledger sort order and attribution display to existing owners.

```quint
pure def hasPreCutoffReview(rows: List[LedgerRow]): bool =
  rows.some(row => row.kind == Review and row.occurred < paymentCutoff)
pure def validOmission(s: Snapshot): bool = s.omitted.exactFields and s.omitted.policy == paymentPolicy
  and s.omitted.cutoff == paymentCutoff and s.omitted.reason == omissionReason and not(hasPreCutoffReview(s.ledger))
pure def validDelta(original: List[str], changes: List[str], removed: List[str]): bool =
  uniqueIds(changes) and uniqueIds(removed)
    and removed.every(id => original.includes(id) and not(changes.includes(id)))
pure def reconstructLedger(s: Snapshot): List[LedgerRow] =
  val changedIds = s.basis.ledger.listMap(row => row.id)
  s.ledger.select(row => not(s.basis.removedEvents.includes(row.id)) and not(changedIds.includes(row.id))).concat(s.basis.ledger)
pure def reconstructAttributionIds(s: Snapshot): List[str] =
  val changedIds = s.basis.attribution.listMap(row => row.id)
  s.attribution.listMap(row => row.id)
    .select(id => not(s.basis.removedAttribution.includes(id)) and not(changedIds.includes(id))).concat(changedIds)
pure def validExplicit(s: Snapshot): bool =
  val actualIds = reconstructAttributionIds(s)
  val ordered = s.basis.attributionOrder
  s.basis.policy == paymentPolicy and s.basis.cutoff == paymentCutoff
    and validDelta(s.ledger.listMap(row => row.id), s.basis.ledger.listMap(row => row.id), s.basis.removedEvents)
    and validDelta(s.attribution.listMap(row => row.id), s.basis.attribution.listMap(row => row.id), s.basis.removedAttribution)
    and ordered.length() == distinctIds(actualIds).length() and uniqueIds(ordered) and ordered.every(id => actualIds.includes(id))
    and validCoverage({ ...s, ledger: reconstructLedger(s) })
pure def scoreAcceptable(s: Snapshot): bool =
  validCoverage(s) and uniqueIds(s.attribution.listMap(row => row.id))
    and not(s.basisPresent and s.omittedPresent)
    and (not(s.basisPresent) or validExplicit(s)) and (not(s.omittedPresent) or validOmission(s))
pure def paymentAcceptable(s: Snapshot): bool = scoreAcceptable(s) and (s.basisPresent or s.omittedPresent)
pure def paymentView(s: Snapshot): Snapshot =
  if (s.basisPresent) { ...s, ledger: reconstructLedger(s), attribution: reconstructedAttributions(s),
    basisPresent: false, omittedPresent: false, basis: noBasis, omitted: noMarker }
  else { ...s, omittedPresent: false, omitted: noMarker }
pure def attributionById(id: str, changes: List[Change], sources: List[Change]): Change =
  changes.concat(sources).select(row => row.id == id).nthOr(0, {id: "", digest: ""})
pure def reconstructedAttributions(s: Snapshot): List[Change] =
  s.basis.attributionOrder.listMap(id => attributionById(id, s.basis.attribution, s.attribution))
```

## Story: Preserve the last structurally accepted view after a refusal

### A candidate check records score and payment results separately

A score response and a payment response can both succeed for an explicit or
properly omitted basis. A score-only archive cannot replace payment input.
A rejected build or invalid artifact cannot replace either retained record.
The retained payment record is the validated source envelope. The payment
caller reads its reconstructed projection through `paymentView`. A cached request must still pass its independent ownership check before
the view receives this result.

```quint
type Result = AwaitingInput | BuildRefused | SnapshotRefused | ScoreOnly | ScoreAndPayment
type RankedSnapshot = { result: Result, scoreDigest: str, paymentDigest: str, score: Snapshot, payment: Snapshot }
pure val noMarker: Marker = { exactFields: false, policy: "", cutoff: 0, reason: "" }
pure val noBasis: PaymentBasis = { policy: "", cutoff: 0, ledger: List(), removedEvents: List(),
  attribution: List(), removedAttribution: List(), attributionOrder: List() }
pure val emptyWindow: Window = { scoringFrom: 0, from: 0, to: verificationMillis, generatedAt: verificationMillis,
  fetchedAt: verificationMillis, cutoff: verificationMillis }
pure val emptyCounts: Counts = { openIssues: 0, openPulls: 0, merged: 0, closedUnmerged: 0, detailed: 0, resolved: 0 }
pure val emptySnapshot: Snapshot = { window: emptyWindow, counts: emptyCounts, issues: List(), pulls: List(),
  ledger: List(), attribution: List(), basisPresent: false, omittedPresent: false, basis: noBasis, omitted: noMarker }
pure val initial: RankedSnapshot = { result: AwaitingInput, scoreDigest: "", paymentDigest: "", score: emptySnapshot, payment: emptySnapshot }
pure def canInspect(r: RankedSnapshot, digest: str): bool = digest != ""
pure def inspect(r: RankedSnapshot, digest: str, sample: Snapshot): RankedSnapshot =
  if (not(scoreAcceptable(sample))) { ...r, result: SnapshotRefused }
  else if (not(paymentAcceptable(sample))) { ...r, result: ScoreOnly, scoreDigest: digest, score: sample }
  else { ...r, result: ScoreAndPayment, scoreDigest: digest, score: sample, paymentDigest: digest, payment: sample }
pure def canValidateBuild(r: RankedSnapshot, digest: str): bool = canInspect(r, digest)
pure def validateBuild(r: RankedSnapshot, digest: str, input: BuildInput, sample: Snapshot): RankedSnapshot =
  if (validHydration(input)) inspect(r, digest, sample) else { ...r, result: BuildRefused }
pure def alwaysRetainedScoreValidated(r: RankedSnapshot): bool = r.scoreDigest != "" implies scoreAcceptable(r.score)
pure def alwaysRetainedPaymentValidated(r: RankedSnapshot): bool = r.paymentDigest != "" implies paymentAcceptable(r.payment)
pure def stepRefusalPreservesViews(before: RankedSnapshot, after: RankedSnapshot): bool =
  (after.result == BuildRefused or after.result == SnapshotRefused) implies
    after.score == before.score and after.payment == before.payment
      and after.scoreDigest == before.scoreDigest and after.paymentDigest == before.paymentDigest
pure def stepScoreOnlyPreservesPayment(before: RankedSnapshot, after: RankedSnapshot): bool =
  after.result == ScoreOnly implies after.paymentDigest == before.paymentDigest and after.payment == before.payment
pure def sometimesRefused(r: RankedSnapshot): bool = r.result == SnapshotRefused or r.result == BuildRefused
pure def sometimesScoreOnly(r: RankedSnapshot): bool = r.result == ScoreOnly
pure def sometimesPayment(r: RankedSnapshot): bool = r.result == ScoreAndPayment
pure val exactMarker: Marker = { exactFields: true, policy: paymentPolicy, cutoff: paymentCutoff, reason: omissionReason }
pure val exactBasis: PaymentBasis = { ...noBasis, policy: paymentPolicy, cutoff: paymentCutoff }
pure val omittedSample: Snapshot = { ...emptySnapshot, omittedPresent: true, omitted: exactMarker }
pure val explicitSample: Snapshot = { ...emptySnapshot, basisPresent: true, basis: exactBasis }
pure val directSample: LedgerRow = { id: "accepted-actor-a", kind: DirectMerge, source: "accepted-pr",
  parentPr: "accepted-pr", occurred: paymentCutoff, continuity: false }
pure val reviewSample: LedgerRow = { ...directSample, id: "review", kind: Review, occurred: paymentCutoff - 1 }
pure val sampleValues = Set(emptySnapshot, omittedSample, explicitSample,
  { ...omittedSample, basisPresent: true, basis: exactBasis },
  { ...omittedSample, counts: { ...emptyCounts, merged: 1 }, ledger: List(reviewSample) },
  { ...emptySnapshot, counts: { ...emptyCounts, merged: 1 }, ledger: List(directSample) },
  { ...emptySnapshot, counts: { ...emptyCounts, openIssues: 1 } })
pure val detailSample: Hydrated = { node: "pr", mergedAt: 3, knownTime: true }
pure val buildSample: BuildInput = { outcomes: List("pr"), detail: List(detailSample), reviewOnly: List(),
  detailEligible: List("pr"), verificationFrom: 1, to: 5, generatedAt: 5 }
pure val inputValues = Set(buildSample, { ...buildSample, outcomes: List() },
  { ...buildSample, reviewOnly: List(detailSample) })
pure val digestValues = Set("snapshot-one", "snapshot-two")
```
