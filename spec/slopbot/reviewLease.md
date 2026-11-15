# Slopbot review claim and completion authority

PRD sections 5, 7 and 12 and the retained `bot_review_lease` model require
exclusive, expiring review claims on a single immutable review key. Source is
`workers/slopbot/persistence.ts`, `migrations/0013_slopbot.sql` and
`migrations/0045_slopbot_review_leases.sql` at
`6b3b9d0b979f0608d87941f1146056a98513ffcf`. The provider review state owns
classification and provider routing. This state owns the durable D1 token,
its expiry, and the single authority to record completion for a review key.
The [author slots](./routing.md) decide the new-author capacity that a
claim consumes, and the closure composition owns close attempts. A claim
reads the author slots' own state and the routing decision: a reviewing
route of a new author needs fewer than three slots occupied by the
author's other reviews. `ownSlot` names this review key's slot in them.
Close attempts are read as a typed observation, and
a claim made while a close attempt is unresolved may only reconcile that
attempt. Claim expiry never clears a possibly effective action.

## Story: Claim a review and allow only its current owner to finish

### An expired claim can be replaced and cannot finalize while waiting for takeover

The source row binds review key, installation, repository and revision. The
shell checks that identity before entry and atomically compares lease and
status. A missed claim preserves the open review and records neither a
fresh attempt nor a completed verdict. A usable author slot is a separate
admission fact. The service generates a distinct token and stores its lease
expiry before inference. The positive integer token below orders successive
generations for a single review key. Actual opaque tokens remain in the shell.

```quint
import routing as R from "./routing"
type ClaimStatus = NoReview | Running | Skipped | Failed | Completed
type PriorStart = First | Retry | Reconcile
type CloseAttempt = NoCloseAttempt | PendingClose | ConfirmedClose | RejectedClose
type ReviewLease = { status: ClaimStatus, token: int, now: int, expires: int,
  completedToken: int, callRecorded: bool, currentCalled: bool, kind: PriorStart, close: CloseAttempt }
pure val leaseSeconds = 1200
pure val initial: ReviewLease = { status: NoReview, token: 0, now: 0, expires: 0,
  completedToken: 0, callRecorded: false, currentCalled: false, kind: First, close: NoCloseAttempt }
pure val ownSlot = 9
pure def admitted(slots: R::AuthorSlots, key: int, route: R::Route): bool =
  not(R::reviews(route)) or slots.established or R::occupiedByOthers(slots, key) < R::authorDailyCap
pure def canObserveTime(s: ReviewLease, time: int): bool = time >= s.now
pure def observeTime(s: ReviewLease, time: int): ReviewLease = { ...s, now: time }
pure def ownsClaim(s: ReviewLease, token: int): bool =
  s.status == Running and token > 0 and token == s.token and s.now < s.expires
pure def canClaim(s: ReviewLease, token: int, expires: int, slots: R::AuthorSlots, route: R::Route): bool =
  token > s.token and token > 0 and expires > s.now and expires <= s.now + leaseSeconds
    and (admitted(slots, ownSlot, route) or s.close == PendingClose) and
    (s.status == NoReview or s.status == Skipped or s.status == Failed or (s.status == Running and s.now >= s.expires))
pure def claim(s: ReviewLease, token: int, expires: int, slots: R::AuthorSlots, route: R::Route): ReviewLease =
  { ...s, status: Running, token: token, expires: expires, currentCalled: false,
    kind: if (s.close == PendingClose) Reconcile
      else if (s.callRecorded or s.status == Failed or s.status == Running) Retry else First }
pure def canObserveClose(s: ReviewLease, observed: CloseAttempt): bool =
  (observed == PendingClose and s.close != PendingClose and s.status == Running and s.kind != Reconcile)
    or (s.close == PendingClose and (observed == ConfirmedClose or observed == RejectedClose))
pure def observeClose(s: ReviewLease, observed: CloseAttempt): ReviewLease = { ...s, close: observed }
pure def canRecordCall(s: ReviewLease, token: int): bool = ownsClaim(s, token) and s.kind != Reconcile
pure def recordCall(s: ReviewLease, token: int): ReviewLease = { ...s, callRecorded: true, currentCalled: true }
```

### A late worker cannot publish a failed, skipped or complete review

A claim is required immediately before a side effect and again for the final
write. It does not retroactively undo an already-started call. The durable
provider journal retains verified observations about any real provider call.
A skipped review can be reconsidered. If no cost observation indicates a
provider call, a skipped review can start as a first attempt. Retrying a
failed or interrupted review preserves its history and charges no project.
A claim taken while a close attempt is pending reconciles that attempt
from GitHub's immutable evidence and never sends another close or calls a
provider. It completes only after the attempt is confirmed or rejected.
Otherwise it fails and the pending attempt keeps its author slot.

```quint
pure def canFinish(s: ReviewLease, token: int, status: ClaimStatus): bool =
  ownsClaim(s, token) and (status == Completed or status == Failed or status == Skipped)
    and (status == Completed implies s.close != PendingClose) and (s.kind == Reconcile implies status != Skipped)
pure def finish(s: ReviewLease, token: int, status: ClaimStatus): ReviewLease =
  { ...s, status: status, expires: 0, completedToken: token }
pure def alwaysHistory(s: ReviewLease): bool = 0 <= s.completedToken and s.completedToken <= s.token and s.now >= 0
pure def alwaysComplete(s: ReviewLease): bool = s.status == Completed implies s.completedToken == s.token and s.token > 0
pure def alwaysExpiryIdentity(s: ReviewLease): bool =
  (s.status == Running implies s.token > 0 and s.expires > 0) and (s.status != Running implies s.expires == 0)
pure def alwaysKnownCall(s: ReviewLease): bool = s.currentCalled implies s.callRecorded
pure def stepNoRewind(before: ReviewLease, after: ReviewLease): bool = before.token <= after.token and before.now <= after.now
pure def stepCompleteRetainsVerdict(before: ReviewLease, after: ReviewLease): bool = before.status == Completed
  implies after.status == Completed and before.completedToken == after.completedToken
pure def alwaysReconcileNeverCalls(s: ReviewLease): bool = (s.status == Running and s.kind == Reconcile) implies not(s.currentCalled)
pure def alwaysCompletionSettledItsClose(s: ReviewLease): bool = s.status == Completed implies s.close != PendingClose
pure def sometimesExpired(s: ReviewLease): bool = s.status == Running and s.now >= s.expires
pure def sometimesReconciled(s: ReviewLease): bool = s.status == Completed and s.kind == Reconcile
pure def sometimesRetryCompleted(s: ReviewLease): bool = s.status == Completed and s.kind == Retry
pure def sometimesSkippedRetryIsFirst(s: ReviewLease): bool = s.status == Running and s.kind == First and s.completedToken > 0
pure val timeValues = Set(1, 2, 3, 4, 5)
pure val tokenValues = Set(0, 1, 2, 3)
pure val expiresValues = Set(1, 2, 3, 4, 5)
pure val busySlot: R::Slot = { key: 1, status: R::SlotRunning, leaseUntil: 3000, completedAt: 0, close: R::NoClose,
  closedAt: 0, limited: true }
pure val fullSlots: R::AuthorSlots = { ...R::initial, slots: List(busySlot, { ...busySlot, key: 2 }, { ...busySlot, key: 3 }) }
pure val slotsValues = Set(R::initial, fullSlots, { ...fullSlots, established: true })
pure val routeValues = Set(R::AdvisoryReview, R::SkipDraft)
pure val weight_claim = 7
pure val weight_finish = 8
```
