# Slopbot review routing and the new-author review cap

PRD section 5 makes Slopbot review registered repositories, preserves
repository opt-outs and exemptions and maintainer reopen decisions, and
requires caps. A copied marker or footer proves no closure fact. Source is
`workers/slopbot/routing.ts`, `workers/slopbot/review.ts` (`reviewItem`),
`workers/slopbot/persistence.ts` (`startReview`, `authorCapacity`),
`workers/slopbot/contracts.ts` (`AUTHOR_DAILY_CAP = 3`) and
`workers/slopbot/github.ts` (`authorExemption`) at the pinned development
revision. The retained `bot_review_admission` and `bot_author_admission`
models cover the same precedence and slots.

The consumer observes the current GitHub item and the repository file
through the installation token. The scope is derived here from the typed
[registry observation](./repositoryScope.md), the installation row is the
[installation](./installation.md) machine's state, and the new-author cap
is read from this unit's own author slots, so none of them is a flag the
caller sets. The closure composition owns `closureEligible`, derived from
membership, the author's own authenticated run and the exact
`pull_request_opened` node; it is an input this unit cannot check and is a
composition obligation. This unit owns the routing decision and one
author's review slots in one repository.

## Story: Route each item by the published precedence

### The first failing condition decides, and advisory review stays broad

The order is: active installation, public repository, registered review
scope, the issue or pull request switch, open and unmerged, not a draft,
not a bot or Slopbot itself, no human reopen of this revision, the
exemption, the audience, the new-author daily cap, and then the review
kind. An exempt author is skipped unless the repository asks to review
exempt authors, and then the review is advisory only. An exemption lookup
that fails is not an exemption, and it also makes the author ineligible
for closure. The `participants` audience admits a submission with the
marker or by a Slop participant. The marker is an audience filter only.
Security scope reviews only for security. Only a pull request whose
author the closure composition found eligible may proceed to the closure
gates, which apply their own consent, category, confirmation, cap and
activation checks.

```quint
import repositoryScope as RS from "./repositoryScope"
import installation as I from "./installation"
type ItemKind = IssueItem | PullItem
type Audience = Protection | Participants
type Exemption = Exempt | NotExempt | ExemptionUnknown
type RouteInput = { install: I::Installation, visibility: RS::Visibility, registry: RS::RegistryObservation,
  repository: int, author: int, kind: ItemKind, issuesOn: bool, pullsOn: bool, open: bool, merged: bool,
  draft: bool, authorBot: bool, authorSelf: bool, humanReopenedThisRevision: bool, exemption: Exemption,
  reviewExempt: bool, audience: Audience, marker: bool, participant: bool, closureEligible: bool }
type Route = SkipInstallation | SkipPrivate | SkipUnregistered | SkipIssuesOff | SkipPullsOff | SkipNotOpen
  | SkipDraft | SkipBotAuthor | SkipHumanReopened | SkipExempt | SkipAudience | SkipAuthorCap
  | SecurityReviewOnly | AdvisoryReview | MayCloseReview
pure def scopeOf(i: RouteInput): RS::Scope =
  if (i.registry.observedId == i.repository) RS::slopbotScope(i.registry) else RS::Unregistered
pure def route(i: RouteInput, a: AuthorSlots, key: int): Route =
  if (not(I::active(i.install))) SkipInstallation
  else if (i.visibility != RS::PublicRepo) SkipPrivate
  else if (not(RS::mayReview(scopeOf(i)))) SkipUnregistered
  else if (i.kind == IssueItem and not(i.issuesOn)) SkipIssuesOff
  else if (i.kind == PullItem and not(i.pullsOn)) SkipPullsOff
  else if (not(i.open) or i.merged) SkipNotOpen
  else if (i.draft) SkipDraft
  else if (i.authorSelf or i.authorBot) SkipBotAuthor
  else if (i.humanReopenedThisRevision) SkipHumanReopened
  else if (i.exemption == Exempt and not(i.reviewExempt)) SkipExempt
  else if (i.audience == Participants and not(i.marker) and not(i.participant)) SkipAudience
  else if (capReached(a, i, key)) SkipAuthorCap
  else if (scopeOf(i) == RS::SecurityOnly) SecurityReviewOnly
  else if (i.exemption == NotExempt and i.kind == PullItem and i.closureEligible) MayCloseReview
  else AdvisoryReview
pure def reviews(r: Route): bool = r == SecurityReviewOnly or r == AdvisoryReview or r == MayCloseReview
pure def lawMarkerNeverEnablesClosure(i: RouteInput, a: AuthorSlots): bool =
  route(i, a, 9) == MayCloseReview implies i.closureEligible
    and route({ ...i, marker: false, participant: true }, a, 9) == MayCloseReview
pure def lawClosureNeedsEligiblePullFromNonExemptAuthor(i: RouteInput, a: AuthorSlots): bool =
  route(i, a, 9) == MayCloseReview implies (i.closureEligible and i.kind == PullItem and i.exemption == NotExempt
    and scopeOf(i) == RS::Contributor)
pure def lawExemptReviewIsAdvisory(i: RouteInput, a: AuthorSlots): bool =
  i.exemption == Exempt implies route(i, a, 9) != MayCloseReview
pure def lawDraftIsNotReviewed(i: RouteInput, a: AuthorSlots): bool = i.draft implies not(reviews(route(i, a, 9)))
pure def lawHumanReopenStopsReview(i: RouteInput, a: AuthorSlots): bool =
  i.humanReopenedThisRevision implies not(reviews(route(i, a, 9)))
pure def lawSecurityScopeNeverCloses(i: RouteInput, a: AuthorSlots): bool =
  scopeOf(i) == RS::SecurityOnly implies route(i, a, 9) != MayCloseReview
pure def lawInactiveInstallationDecidesFirst(i: RouteInput, a: AuthorSlots): bool =
  not(I::active(i.install)) implies route(i, a, 9) == SkipInstallation
pure def lawUnknownVisibilityIsNotReviewed(i: RouteInput, a: AuthorSlots): bool =
  i.visibility == RS::VisibilityUnknown implies not(reviews(route(i, a, 9)))
pure def lawOtherRepositoryRegistrationIsUnregistered(i: RouteInput, a: AuthorSlots): bool =
  i.registry.observedId != i.repository implies not(reviews(route(i, a, 9)))
pure def lawFullSlotsStopNewAuthorReview(i: RouteInput, a: AuthorSlots): bool =
  (a.repository == i.repository and a.author == i.author and not(a.established)
    and occupiedByOthers(a, 9) >= authorDailyCap) implies not(reviews(route(i, a, 9)))
pure def lawRetiredGetsNoReview(i: RouteInput, a: AuthorSlots): bool =
  scopeOf(i) == RS::ReversalOnly implies not(reviews(route(i, a, 9)))
```

## Story: Limit reviews of a new author without a verified merge

### Live claims, recent completions and unresolved closes occupy the author's three slots

For one author in one repository, another review occupies a slot while
its claim is running and unexpired, for a day after it completed, while
it has a pending close attempt, and for a day after a confirmed close.
A new review of an author with no verified merge in the repository may
claim only while fewer than three other reviews occupy slots. The check
and the claim are one conditional write. An established author, proven by
a verified merged pull request in the repository, is not limited, but
their reviews still occupy slots. The merge history is GitHub's search of
merged pull requests by this author in this repository, read through the
installation token by the shell, and it must name this unit's repository
and author. A skipped routing decision is not limited. A failed review frees its slot unless a close attempt remains
pending. An expired claim frees its slot unless a close attempt remains
pending. A definitive close refusal frees it. Elapsed time never frees a
pending close.

```quint
type SlotStatus = SlotRunning | SlotCompleted | SlotFailed | SlotSkipped
type CloseMark = NoClose | ClosePending | CloseConfirmed | CloseRejected
type Slot = { key: int, status: SlotStatus, leaseUntil: int, completedAt: int, close: CloseMark,
  closedAt: int, limited: bool }
type MergeHistory = { repository: int, author: int, mergedPulls: Set[int] }
type AuthorSlots = { now: int, repository: int, author: int, established: bool, slots: List[Slot] }
pure val authorDailyCap = 3
pure val day = 86400
pure val initial: AuthorSlots = { now: 1, repository: 1, author: 1, established: false, slots: List() }
pure val noSlot: Slot = { key: 0, status: SlotSkipped, leaseUntil: 0, completedAt: 0, close: NoClose,
  closedAt: 0, limited: false }
pure def slotOf(a: AuthorSlots, key: int): Slot = a.slots.select(s => s.key == key).nthOr(0, noSlot)
pure def putSlot(s: Slot, a: AuthorSlots): AuthorSlots =
  { ...a, slots: if (slotOf(a, s.key).key == 0) a.slots.append(s) else a.slots.listMap(old => if (old.key == s.key) s else old) }
pure def occupies(s: Slot, now: int): bool =
  (s.status == SlotRunning and s.leaseUntil > now) or (s.status == SlotCompleted and s.completedAt + day > now)
    or s.close == ClosePending or (s.close == CloseConfirmed and s.closedAt + day > now)
pure def occupiedByOthers(a: AuthorSlots, key: int): int = a.slots.select(s => s.key != key and occupies(s, a.now)).length()
pure def canElapse(a: AuthorSlots, seconds: int): bool = seconds > 0
pure def elapse(a: AuthorSlots, seconds: int): AuthorSlots = { ...a, now: a.now + seconds }
pure def canObserveMerges(a: AuthorSlots, history: MergeHistory): bool =
  history.repository == a.repository and history.author == a.author
pure def observeMerges(a: AuthorSlots, history: MergeHistory): AuthorSlots =
  { ...a, established: history.mergedPulls.size() > 0 }
pure def capReached(a: AuthorSlots, i: RouteInput, key: int): bool =
  a.repository == i.repository and a.author == i.author and not(a.established)
    and occupiedByOthers(a, key) >= authorDailyCap
pure def restartable(s: Slot, now: int): bool =
  s.key == 0 or s.status == SlotSkipped or s.status == SlotFailed or (s.status == SlotRunning and s.leaseUntil <= now)
pure def canStart(a: AuthorSlots, key: int, leaseUntil: int, reviewing: bool): bool =
  key > 0 and leaseUntil > a.now and restartable(slotOf(a, key), a.now) and slotOf(a, key).close != ClosePending
    and (not(reviewing) or a.established or occupiedByOthers(a, key) < authorDailyCap)
pure def start(a: AuthorSlots, key: int, leaseUntil: int, reviewing: bool): AuthorSlots =
  val prior = slotOf(a, key)
  putSlot({ ...prior, key: key, status: SlotRunning, leaseUntil: leaseUntil, completedAt: 0,
    limited: reviewing and not(a.established) }, a)
pure def live(a: AuthorSlots, key: int): bool = slotOf(a, key).status == SlotRunning and slotOf(a, key).leaseUntil > a.now
pure def canFinish(a: AuthorSlots, key: int, status: SlotStatus): bool = live(a, key) and status != SlotRunning
pure def finish(a: AuthorSlots, key: int, status: SlotStatus): AuthorSlots =
  putSlot({ ...slotOf(a, key), status: status, leaseUntil: 0, completedAt: if (status == SlotCompleted) a.now else 0 }, a)
pure def canReserveClose(a: AuthorSlots, key: int): bool =
  live(a, key) and (slotOf(a, key).close == NoClose or slotOf(a, key).close == CloseRejected)
pure def reserveClose(a: AuthorSlots, key: int): AuthorSlots = putSlot({ ...slotOf(a, key), close: ClosePending }, a)
pure def canSettleClose(a: AuthorSlots, key: int, confirmed: bool): bool = slotOf(a, key).close == ClosePending
pure def settleClose(a: AuthorSlots, key: int, confirmed: bool): AuthorSlots =
  putSlot({ ...slotOf(a, key), close: if (confirmed) CloseConfirmed else CloseRejected,
    closedAt: if (confirmed) a.now else 0 }, a)
pure def alwaysLimitedClaimsWithinCap(a: AuthorSlots): bool =
  a.slots.select(s => s.limited and occupies(s, a.now)).length() <= authorDailyCap
pure def alwaysSlotsWellFormed(a: AuthorSlots): bool =
  a.slots.every(s => s.key > 0 and a.slots.select(o => o.key == s.key).length() == 1
    and (s.status == SlotRunning implies s.leaseUntil > 0) and (s.status != SlotRunning implies s.leaseUntil == 0)
    and (s.status == SlotCompleted implies s.completedAt > 0) and (s.close == CloseConfirmed implies s.closedAt > 0))
pure def stepPendingCloseNeverExpires(before: AuthorSlots, after: AuthorSlots): bool =
  before.slots.every(s => s.close == ClosePending implies after.slots.some(o => o.key == s.key and o.close != NoClose))
pure def sometimesCapReached(a: AuthorSlots): bool = not(a.established) and occupiedByOthers(a, 9) >= authorDailyCap
pure def sometimesEstablishedPastCap(a: AuthorSlots): bool =
  a.established and a.slots.select(s => occupies(s, a.now)).length() > authorDailyCap
pure def sometimesPendingCloseHoldsExpiredSlot(a: AuthorSlots): bool =
  a.slots.some(s => s.close == ClosePending and s.status == SlotFailed)
pure val keyValues = Set(1, 2, 3, 4)
pure val leaseUntilValues = Set(1300, 3000)
pure val secondsValues = Set(100, 1200, 86400)
pure val historyValues = Set({ repository: 1, author: 1, mergedPulls: Set(7) }, { repository: 1, author: 1, mergedPulls: Set() },
  { repository: 1, author: 2, mergedPulls: Set(7) })
pure val statusValues = Set(SlotCompleted, SlotFailed, SlotSkipped)
pure val activeInstall: I::Installation = { ...I::initial, known: true, sourceTime: 1 }
pure val activeRegistry: RS::RegistryObservation = { lookup: RS::CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged }
pure val baseInput: RouteInput = { install: activeInstall, visibility: RS::PublicRepo, registry: activeRegistry,
  repository: 1, author: 1, kind: PullItem, issuesOn: true, pullsOn: true, open: true, merged: false, draft: false,
  authorBot: false, authorSelf: false, humanReopenedThisRevision: false, exemption: NotExempt, reviewExempt: false,
  audience: Protection, marker: false, participant: false, closureEligible: true }
pure val iValues = Set(baseInput, { ...baseInput, install: { ...activeInstall, suspended: true } },
  { ...baseInput, visibility: RS::PrivateRepo }, { ...baseInput, visibility: RS::VisibilityUnknown },
  { ...baseInput, registry: { ...activeRegistry, rowActive: false } },
  { ...baseInput, registry: { ...activeRegistry, retirement: RS::OwnerRetired } }, { ...baseInput, repository: 2 },
  { ...baseInput, kind: IssueItem }, { ...baseInput, draft: true }, { ...baseInput, authorBot: true },
  { ...baseInput, humanReopenedThisRevision: true }, { ...baseInput, exemption: Exempt },
  { ...baseInput, exemption: Exempt, reviewExempt: true }, { ...baseInput, exemption: ExemptionUnknown },
  { ...baseInput, audience: Participants }, { ...baseInput, audience: Participants, marker: true, closureEligible: false },
  { ...baseInput, closureEligible: false }, { ...baseInput, merged: true })
pure val fullSlot: Slot = { key: 1, status: SlotRunning, leaseUntil: 3000, completedAt: 0, close: NoClose,
  closedAt: 0, limited: true }
pure val aValues = Set(initial, { ...initial, slots: List(fullSlot, { ...fullSlot, key: 2 }, { ...fullSlot, key: 3 }) },
  { ...initial, established: true, slots: List(fullSlot, { ...fullSlot, key: 2 }, { ...fullSlot, key: 3 }) })
pure val weight_start = 5
pure val weight_reserveClose = 3
```
