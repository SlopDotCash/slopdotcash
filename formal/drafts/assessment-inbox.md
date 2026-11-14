# Incomplete assessments in the private Inbox

PRD section 9 requires one private Inbox item per unresolved ordinary PR
assessment, visible to current maintainers and administrators. The item
survives a retry or exhausted attempt and disappears after an accepted terminal
outcome resolves its gap. This specification owns the read projection over
durable worker rows. The [value inference](../slopbot/valueInference.md)
model owns admission and attempt accounting.

## Story: See one unresolved assessment and its retry status

### A delivery keeps its first gap through claims, retries and exhaustion

A durable observation names an immutable repository ID and PR number, and a
single delivery ID. At the worker boundary a claim or completion input comes
from the committed processing row, after the owning lease and database write
have succeeded. A waiting delivery can be parked without a retry time. An
exhausted attempt is terminal for that delivery while its unresolved gap
remains visible. An accepted missing-PR outcome requires GitHub's missing
response from a repository the installation can still read.

```quint
type PrKey = { repository: int, pullRequest: int }
type DeliveryPhase = Unstarted | Waiting | Running | Completed
type AssessmentOutcome = Published | AlreadyCurrent | StillOpen | Historical | ConfirmedMissing | AttemptsExhausted | SourceIncomplete | AuthorityWait | Parked | BudgetWait | Retry
type Delivery = { key: PrKey, delivery: int, phase: DeliveryPhase, resultKind: AssessmentOutcome, firstGap: int, updated: int, retryAt: int }

pure def validatedKey(key: PrKey): bool = key.repository > 0 and key.pullRequest > 0
pure def resolves(resultKind: AssessmentOutcome): bool =
  resultKind == Published or resultKind == AlreadyCurrent or resultKind == StillOpen or resultKind == Historical or resultKind == ConfirmedMissing
pure def terminal(resultKind: AssessmentOutcome): bool = resolves(resultKind) or resultKind == AttemptsExhausted
pure def newDelivery(key: PrKey, delivery: int): Delivery =
  { key: key, delivery: delivery, phase: Unstarted, resultKind: Retry, firstGap: -1, updated: -1, retryAt: -1 }
pure def claimDelivery(row: Delivery, at: int): Delivery =
  { ...row, phase: Running, updated: at, retryAt: -1 }
pure def finishDelivery(row: Delivery, resultKind: AssessmentOutcome, at: int, retryAt: int): Delivery =
  { ...row, phase: if (terminal(resultKind)) Completed else Waiting, resultKind: resultKind, updated: at,
    firstGap: if (resolves(resultKind)) -1 else if (row.firstGap >= 0) row.firstGap else if (resultKind == SourceIncomplete) at else -1,
    retryAt: if (terminal(resultKind) or resultKind == Parked) -1 else retryAt }
pure def validDelivery(row: Delivery): bool =
  validatedKey(row.key) and row.delivery > 0 and row.updated >= -1 and row.firstGap >= -1 and
  row.firstGap <= row.updated and row.retryAt >= -1 and
  (if (row.phase == Waiting) not(terminal(row.resultKind)) and
     (if (row.resultKind == Parked) row.retryAt == -1 else row.retryAt > row.updated)
   else row.retryAt == -1) and
  (row.phase == Completed implies terminal(row.resultKind) and (resolves(row.resultKind) implies row.firstGap == -1)) and
  (row.phase == Unstarted implies row.updated == -1 and row.firstGap == -1)
pure def lawClaimRetainsGap(row: Delivery, at: int): bool =
  claimDelivery(row, at).key == row.key and claimDelivery(row, at).delivery == row.delivery and
  claimDelivery(row, at).firstGap == row.firstGap and claimDelivery(row, at).retryAt == -1
pure def lawNonresolvingFinishRetainsFirstGap(row: Delivery, resultKind: AssessmentOutcome, at: int, retryAt: int): bool =
  row.firstGap >= 0 and not(resolves(resultKind)) implies finishDelivery(row, resultKind, at, retryAt).firstGap == row.firstGap
pure def lawFirstIncompleteRecordsTime(row: Delivery, at: int, retryAt: int): bool =
  row.firstGap == -1 and at >= 0 implies finishDelivery(row, SourceIncomplete, at, retryAt).firstGap == at
pure def lawOnlyAcceptedCompletionClearsRecordedGap(row: Delivery, resultKind: AssessmentOutcome, at: int, retryAt: int): bool =
  row.firstGap >= 0 implies ((finishDelivery(row, resultKind, at, retryAt).firstGap == -1) iff resolves(resultKind))
```

### Only a matching accepted terminal outcome at or after the gap resolves it

Current processing rows may include several deliveries for one PR. An outcome
for a different repository, a different PR, an earlier time, or an exhausted
attempt cannot resolve a retained gap. The projection produces at most one
item per PR key. It uses the earliest surviving gap and earliest available
retry time, and reports a running sibling even when the gap or scheduled
retry belongs to a different delivery of that PR.

```quint
type RetryStatus = Retrying | ScheduledRetry | AwaitingAssessment
type AssessmentItem = NoAssessment | Unresolved({ key: PrKey, since: int, retryAt: int, retryStatus: RetryStatus })
type AssessmentSummary = { since: int, retryAt: int, running: bool }

pure def resolvesGap(candidate: Delivery, gap: Delivery): bool =
  candidate.key == gap.key and candidate.phase == Completed and resolves(candidate.resultKind) and
  candidate.updated >= gap.firstGap
pure def openGap(rows: List[Delivery], row: Delivery): bool =
  row.firstGap >= 0 and not(rows.some(candidate => resolvesGap(candidate, row)))
pure def earlierKnown(left: int, right: int): int =
  if (right < 0 or (left >= 0 and left <= right)) left else right
pure def accumulateAssessment(rows: List[Delivery], key: PrKey, summary: AssessmentSummary, row: Delivery): AssessmentSummary =
  if (row.key != key) summary else
    if (openGap(rows, row)) { since: earlierKnown(summary.since, row.firstGap),
      retryAt: earlierKnown(summary.retryAt, row.retryAt), running: summary.running or row.phase == Running }
    else { ...summary, running: summary.running or row.phase == Running }
pure def assessmentFor(rows: List[Delivery], key: PrKey): AssessmentItem =
  val summary = rows.foldl({ since: -1, retryAt: -1, running: false },
    (prior, row) => accumulateAssessment(rows, key, prior, row))
  if (summary.since < 0) NoAssessment else Unresolved({ key: key, since: summary.since,
    retryAt: summary.retryAt, retryStatus: if (summary.running) Retrying else
      if (summary.retryAt >= 0) ScheduledRetry else AwaitingAssessment })
pure def lawResolutionMatchesKeyAndTime(candidate: Delivery, gap: Delivery): bool =
  resolvesGap(candidate, gap) implies candidate.key == gap.key and candidate.updated >= gap.firstGap
pure def lawExhaustionCannotResolve(candidate: Delivery, gap: Delivery): bool =
  candidate.resultKind == AttemptsExhausted implies not(resolvesGap(candidate, gap))
pure def lawLaterGapSurvivesEarlierTerminal(candidate: Delivery, gap: Delivery): bool =
  candidate.updated < gap.firstGap implies not(resolvesGap(candidate, gap))
pure def lawEmptyRowsHaveNoAssessment(key: PrKey): bool = assessmentFor(List(), key) == NoAssessment
```

## Story: Keep a private assessment read bound to the current authority

### A read captures its actor, exact registry binding and response route

A read starts after session observation. The browser supplies its expected
actor. A standalone request without that header is still subject to the
authenticated session. The server captures the project and exact manifest
bytes before checking repository access. A numeric manifest identity here
abstracts exact byte equality, including a changed or removed binding.
The repository path is the canonicalized current GitHub path. Cursor parsing
and the ordered keyset of up to 25 results are outside this single-PR
projection. A valid query and a current registry match are required before
publishing an item. When the initial context read has no unresolved gap for
this binding, it returns an empty result without consulting GitHub. A captured
gap may resolve before the final row read.

```quint
type QueueRoute = BundledInbox | DirectQueue
type QueuePhase = Idle | Checking | Refused | Unavailable | Ready
type RepoPermission = CurrentWriter | DeniedPermission | AuthorityUnavailable
type RegistryBinding = { project: int, repository: int, path: str, manifest: int }
type QueueRequest = { actor: int, expected: int, requestId: int, lifetime: int, route: QueueRoute, binding: RegistryBinding, key: PrKey, validCursor: bool, contextHasGap: bool }
type AccessCheck = { actor: int, configuredAdmin: bool, permission: RepoPermission, repository: int, path: str, installation: bool, publicRepo: bool }
type QueueRead = { phase: QueuePhase, request: QueueRequest, item: AssessmentItem, status: int }

pure val emptyBinding: RegistryBinding = { project: 0, repository: 0, path: "", manifest: 0 }
pure val initial: QueueRead = { phase: Idle, request: { actor: 0, expected: 0, requestId: 0,
  lifetime: 0, route: DirectQueue, binding: emptyBinding, key: { repository: 0, pullRequest: 0 }, validCursor: false, contextHasGap: false },
  item: NoAssessment, status: 0 }
pure def validScope(binding: RegistryBinding, key: PrKey): bool =
  validatedKey(key) and binding.project > 0 and binding.repository == key.repository and binding.path != "" and binding.manifest > 0
pure def authenticated(request: QueueRequest): bool =
  request.actor > 0 and (request.expected == 0 or request.expected == request.actor)
pure def failureStatus(route: QueueRoute, code: int): int = if (route == BundledInbox) 200 else code
pure def canRead(q: QueueRead, request: QueueRequest, by: int): bool =
  by >= 0 and request.actor == by and request.requestId > q.request.requestId and request.lifetime > 0
pure def read(q: QueueRead, request: QueueRequest, by: int): QueueRead =
  if (not(authenticated(request))) { phase: Refused, request: request, item: NoAssessment,
    status: if (request.actor == 0) 401 else 403 }
  else if (not(request.validCursor)) { phase: Unavailable, request: request, item: NoAssessment,
    status: failureStatus(request.route, 400) }
  else if (not(validScope(request.binding, request.key)) or not(request.contextHasGap)) { phase: Ready, request: request, item: NoAssessment, status: 200 }
  else { phase: Checking, request: request, item: NoAssessment, status: 0 }
```

### Denial clears the item and uncertain authority is retryable

Configured administrators can read the currently bound repository without a
GitHub permission lookup. Maintainer access requires the installed public
repository with the exact numeric ID and current path plus current write or
admin permission. The authority observation must belong to the requesting actor. A verified denial returns an empty result for that scope.
An unavailable check, mismatched GitHub repository or changed captured
manifest returns an unavailable result rather than an empty one. The bundled
Inbox preserves its ordinary notices and reports a separately unavailable
assessment queue. Direct queue failure returns its own HTTP error.

```quint
pure def exactInstallation(binding: RegistryBinding, access: AccessCheck): bool =
  access.repository == binding.repository and access.path == binding.path and access.installation
pure def assessable(binding: RegistryBinding, access: AccessCheck): bool =
  access.configuredAdmin or (exactInstallation(binding, access) and access.publicRepo and access.permission == CurrentWriter)
pure def accessUnavailable(binding: RegistryBinding, access: AccessCheck): bool =
  not(access.configuredAdmin) and
  (access.permission == AuthorityUnavailable or not(exactInstallation(binding, access)))
pure def canComplete(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[Delivery]): bool =
  q.phase == Checking and requestId == q.request.requestId and rows.every(row => validDelivery(row))
pure def complete(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[Delivery]): QueueRead =
  if (access.actor != q.request.actor or accessUnavailable(q.request.binding, access) or (assessable(q.request.binding, access) and currentBinding != q.request.binding))
    { ...q, phase: Unavailable, item: NoAssessment, status: failureStatus(q.request.route, 503) }
  else { ...q, phase: Ready, status: 200, item:
    if (assessable(q.request.binding, access)) assessmentFor(rows, q.request.key) else NoAssessment }
pure def alwaysPrivateItemsRequireAdmittedRead(q: QueueRead): bool =
  q.item != NoAssessment implies q.phase == Ready and authenticated(q.request) and
  validScope(q.request.binding, q.request.key) and q.request.validCursor and q.request.contextHasGap
pure def alwaysCheckingRequiresAdmittedScope(q: QueueRead): bool =
  q.phase == Checking implies authenticated(q.request) and validScope(q.request.binding, q.request.key) and q.request.validCursor and q.request.contextHasGap
pure def alwaysIncompleteQueueUnavailableHasNoItem(q: QueueRead): bool =
  (q.phase == Unavailable or q.phase == Refused) implies q.item == NoAssessment
pure def stepOnlyCurrentOwnedResponsePublishes(before: QueueRead, via: str, after: QueueRead): bool =
  after.item != NoAssessment implies via == "complete" and before.phase == Checking and after.request == before.request
pure def lawMissingContextReturnsEmpty(q: QueueRead, request: QueueRequest, by: int): bool =
  authenticated(request) and request.validCursor and not(request.contextHasGap) implies
  read(q, request, by).phase == Ready and read(q, request, by).item == NoAssessment
pure def lawDeniedOrUncertainAuthorityHasNoItem(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[Delivery]): bool =
  access.actor != q.request.actor or not(assessable(q.request.binding, access)) or accessUnavailable(q.request.binding, access) implies
  complete(q, requestId, currentBinding, access, rows).item == NoAssessment
pure def ordinaryInboxPreserved(q: QueueRead): bool =
  q.request.route == BundledInbox and q.status == 200
pure def lawBundledUnavailableKeepsOrdinaryInbox(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[Delivery]): bool =
  q.request.route == BundledInbox and complete(q, requestId, currentBinding, access, rows).phase == Unavailable implies
  ordinaryInboxPreserved(complete(q, requestId, currentBinding, access, rows))
pure def lawDifferentManifestNeverPublishes(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[Delivery]): bool =
  currentBinding != q.request.binding implies complete(q, requestId, currentBinding, access, rows).item == NoAssessment
```

### A departed page or changed actor cannot display a late queue response

The browser retires the old read when the committed page, cursor, refresh or
actor changes. It checks the post-response session and the response recipient
before consuming a live page. An unavailable check exposes generic retry
feedback. A changed actor suppresses the queue from the departed view.
Reading a queue never claims a worker attempt.

```quint
type BrowserRead = { actor: int, requestId: int, lifetime: int, sessionAvailable: bool, currentActor: int, recipient: int }
type BrowserQueue = Suppressed | QueueRetry | RefreshInbox | QueueReady({ item: AssessmentItem })
pure def browserQueue(q: QueueRead, browser: BrowserRead): BrowserQueue =
  if (browser.actor <= 0 or browser.actor != q.request.actor or browser.requestId != q.request.requestId or browser.lifetime != q.request.lifetime)
    Suppressed
  else if (not(browser.sessionAvailable)) RefreshInbox
  else if (browser.currentActor != browser.actor) Suppressed
  else if (q.phase == Refused) RefreshInbox
  else if (q.phase == Unavailable) QueueRetry
  else if (q.phase == Ready)
    if (browser.recipient == browser.actor) QueueReady({ item: q.item }) else RefreshInbox
  else Suppressed
pure def lawDepartedViewCannotDisplay(q: QueueRead, browser: BrowserRead): bool =
  browser.lifetime != q.request.lifetime or browser.requestId != q.request.requestId implies browserQueue(q, browser) == Suppressed
pure def lawChangedActorCannotDisplay(q: QueueRead, browser: BrowserRead): bool =
  browser.sessionAvailable and browser.currentActor != browser.actor implies browserQueue(q, browser) == Suppressed
pure def sometimesQueueVisible(q: QueueRead): bool = q.phase == Ready and q.item != NoAssessment
pure def sometimesQueueEmpty(q: QueueRead): bool = q.phase == Ready and q.item == NoAssessment
pure def sometimesQueueRefused(q: QueueRead): bool = q.phase == Refused
pure def sometimesDirectUnavailable(q: QueueRead): bool =
  q.phase == Unavailable and q.request.route == DirectQueue and q.status == 503
pure def sometimesOrdinaryInboxSurvivesQueueFailure(q: QueueRead): bool =
  q.phase == Unavailable and q.request.route == BundledInbox and q.status == 200 and q.request.validCursor
```

### Simulation exercises coincident and conflicting observations

These values bound simulation and do not limit accepted IDs or times.

```quint
pure val sampleBinding: RegistryBinding = { project: 1, repository: 1, path: "org/repo", manifest: 1 }
pure val sampleKey: PrKey = { repository: 1, pullRequest: 1 }
pure val sampleRequest: QueueRequest = { actor: 1, expected: 1, requestId: 1, lifetime: 1,
  route: DirectQueue, binding: sampleBinding, key: sampleKey, validCursor: true, contextHasGap: true }
pure val sampleAccess: AccessCheck = { actor: 1, configuredAdmin: false, permission: CurrentWriter,
  repository: 1, path: "org/repo", installation: true, publicRepo: true }
pure val sampleGap: Delivery = finishDelivery(newDelivery(sampleKey, 1), SourceIncomplete, 1, 4)
pure val sampleRunning: Delivery = claimDelivery(newDelivery(sampleKey, 2), 2)
pure val sampleComplete: Delivery = finishDelivery(sampleRunning, Published, 2, -1)
pure val requestValues = Set(sampleRequest).union(Set(
  { ...sampleRequest, requestId: 2, route: BundledInbox })).union(Set(
  { ...sampleRequest, requestId: 3, expected: 2 })).union(Set(
  { ...sampleRequest, requestId: 4, validCursor: false })).union(Set(
  { ...sampleRequest, requestId: 5, actor: 0, expected: 0 })).union(Set(
  { ...sampleRequest, requestId: 6, contextHasGap: false }))
pure val currentBindingValues = Set(sampleBinding).union(Set({ ...sampleBinding, manifest: 2 })).union(Set(emptyBinding))
pure val accessValues = Set(sampleAccess).union(Set({ ...sampleAccess, configuredAdmin: true })).union(Set(
  { ...sampleAccess, permission: AuthorityUnavailable })).union(Set({ ...sampleAccess, permission: DeniedPermission }))
pure val rowsValues = Set(List()).union(Set(List(sampleGap))).union(Set(List(sampleGap, sampleRunning))).union(Set(List(sampleGap, sampleComplete)))
pure val rowValues = Set(sampleGap).union(Set(sampleRunning)).union(Set(sampleComplete))
pure val candidateValues = rowValues
pure val gapValues = rowValues
pure val keyValues = Set(sampleKey).union(Set({ ...sampleKey, repository: 2 }))
pure val qValues = Set(initial)
pure val browserValues = Set({ actor: 1, requestId: 1, lifetime: 1, sessionAvailable: true, currentActor: 1, recipient: 1 })
pure val atValues = Set(0, 1, 2)
pure val retryAtValues = Set(-1, 2, 4)
pure val byValues = Set(0, 1, 2)
pure val requestIdValues = Set(0, 1, 2, 3, 4, 5, 6)
pure val weight_read = 4
pure val weight_complete = 10
```
