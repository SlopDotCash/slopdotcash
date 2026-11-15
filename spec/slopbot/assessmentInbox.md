# Incomplete assessments in the private Inbox

PRD section 9 requires one private Inbox item per incomplete ordinary pull
request assessment, visible to current maintainers and administrators. The
item shows the public pull request and its retry state, survives retries,
and disappears on completion. Each read rechecks authority, and an
unavailable check is a retryable failure. Former or unrelated maintainers
never see it. Source is `backend/notifications/incomplete-assessments.ts`,
`backend/notifications/incomplete-assessments.workflow.mjs`,
`workers/slopbot/value-processing.ts` and
`migrations/0115_incomplete_value_inbox.sql` at the pinned development
revision. The preserved draft `formal/drafts/assessment-inbox.md` supplied
these rules. Its earlier partial report replayed 24 generated traces of an
earlier revision.

This unit owns the read projection and one read's lifecycle. The
[value request rows](./valueRequests.md) own the durable gap, retry time
and outcome that it projects. The browser view retires a departed read.

## Story: Show one unresolved assessment and its retry status

### Only a matching accepted final outcome at or after the gap resolves it

Several deliveries can exist for one pull request. A source gap belongs to
the delivery that recorded it, and it stays through claims, retries and
exhausted attempts. An outcome for another repository or pull request, an
outcome completed before the gap began, or exhausted attempts cannot resolve
it. The projection yields at most one item per pull request. It shows the
earliest surviving gap, the earliest scheduled retry and whether any
delivery of that pull request is running.

```quint
import valueRequests as VR from "./valueRequests"
import installation as I from "./installation"
import repositoryScope as RS from "./repositoryScope"
type PrKey = { repository: int, pullRequest: int }
type RetryStatus = Retrying | ScheduledRetry | AwaitingAssessment
type AssessmentItem = NoAssessment | Unresolved({ key: PrKey, since: int, retryAt: int, retryStatus: RetryStatus })
pure def present(i: AssessmentItem): bool = match i { | Unresolved(u) => true | NoAssessment => false }
type AssessmentSummary = { since: int, retryAt: int, running: bool }
pure def keyOf(d: VR::Delivery): PrKey = { repository: d.key.repository, pullRequest: d.key.pull }
pure def resolvesGap(candidate: VR::Delivery, gap: VR::Delivery): bool =
  keyOf(candidate) == keyOf(gap) and candidate.state == VR::Completed and VR::resolving(candidate.code)
    and candidate.updatedAt >= gap.incompleteSince
pure def openGap(rows: List[VR::Delivery], row: VR::Delivery): bool =
  row.incompleteSince > 0 and not(rows.some(candidate => resolvesGap(candidate, row)))
pure def earlierKnown(left: int, right: int): int = if (right <= 0 or (left > 0 and left <= right)) left else right
pure def accumulateAssessment(rows: List[VR::Delivery], key: PrKey, summary: AssessmentSummary, row: VR::Delivery): AssessmentSummary =
  if (keyOf(row) != key) summary
  else if (openGap(rows, row)) { since: earlierKnown(summary.since, row.incompleteSince),
    retryAt: earlierKnown(summary.retryAt, row.retryAt), running: summary.running or row.state == VR::Running }
  else { ...summary, running: summary.running or row.state == VR::Running }
pure def assessmentFor(rows: List[VR::Delivery], key: PrKey): AssessmentItem =
  val summary = rows.foldl({ since: 0, retryAt: 0, running: false }, (prior, row) => accumulateAssessment(rows, key, prior, row))
  if (summary.since <= 0) NoAssessment else Unresolved({ key: key, since: summary.since, retryAt: summary.retryAt,
    retryStatus: if (summary.running) Retrying else if (summary.retryAt > 0) ScheduledRetry else AwaitingAssessment })
pure def lawExhaustionCannotResolve(candidate: VR::Delivery, gap: VR::Delivery): bool =
  candidate.code == VR::AttemptsExhausted implies not(resolvesGap(candidate, gap))
pure def lawEarlierFinalOutcomeCannotResolve(candidate: VR::Delivery, gap: VR::Delivery): bool =
  candidate.updatedAt < gap.incompleteSince implies not(resolvesGap(candidate, gap))
pure def lawOtherPullCannotResolve(candidate: VR::Delivery, gap: VR::Delivery): bool =
  keyOf(candidate) != keyOf(gap) implies not(resolvesGap(candidate, gap))
pure def lawEmptyRowsHaveNoAssessment(key: PrKey): bool = not(present(assessmentFor(List(), key)))
```

## Story: Keep a private assessment read bound to the current authority

### A read captures its actor, exact registry binding and response route

A read starts after the session is observed. The browser supplies its
expected actor. A request without that header is still bound to the
authenticated session. The server captures the project and its exact
manifest before checking repository access. The numeric manifest identity
stands for byte equality of the manifest, including a changed or removed
binding. The repository path is the current canonical GitHub path. Cursor
parsing and the ordered page of up to 25 results lie outside this
single-pull-request projection. A valid query and a current registry match
are required before an item is published. The first context read projects
the value request rows themselves; when it finds no open gap for this
pull request, the read returns empty without consulting GitHub.

```quint
type QueueRoute = BundledInbox | DirectQueue
type QueuePhase = Idle | Checking | Refused | Unavailable | Ready
type RepoPermission = CurrentWriter | DeniedPermission | AuthorityUnavailable
type RegistryBinding = { project: int, repository: int, path: str, manifest: int }
type QueueRequest = { actor: int, expected: int, requestId: int, lifetime: int, route: QueueRoute,
  binding: RegistryBinding, key: PrKey, validCursor: bool }
type AccessCheck = { actor: int, configuredAdmin: bool, permission: RepoPermission, repository: int, path: str,
  install: I::Installation, visibility: RS::Visibility }
type QueueRead = { phase: QueuePhase, request: QueueRequest, contextGap: bool, item: AssessmentItem, status: int,
  seenOutcomes: List[VR::Outcome] }
pure val emptyBinding: RegistryBinding = { project: 0, repository: 0, path: "", manifest: 0 }
pure val initial: QueueRead = { phase: Idle, request: { actor: 0, expected: 0, requestId: 0, lifetime: 0,
  route: DirectQueue, binding: emptyBinding, key: { repository: 0, pullRequest: 0 }, validCursor: false },
  contextGap: false, item: NoAssessment, status: 0, seenOutcomes: List() }
pure def validScope(binding: RegistryBinding, key: PrKey): bool =
  key.repository > 0 and key.pullRequest > 0 and binding.project > 0 and binding.repository == key.repository
    and binding.path != "" and binding.manifest > 0
pure def authenticated(request: QueueRequest): bool =
  request.actor > 0 and (request.expected == 0 or request.expected == request.actor)
pure def failureStatus(route: QueueRoute, code: int): int = if (route == BundledInbox) 200 else code
pure def canRead(q: QueueRead, request: QueueRequest, by: int, rows: List[VR::Delivery]): bool =
  by >= 0 and request.actor == by and request.requestId > q.request.requestId and request.lifetime > 0
pure def read(q: QueueRead, request: QueueRequest, by: int, rows: List[VR::Delivery]): QueueRead =
  val gap = present(assessmentFor(rows, request.key))
  if (not(authenticated(request))) { phase: Refused, request: request, contextGap: gap, item: NoAssessment,
    status: if (request.actor == 0) 401 else 403, seenOutcomes: List() }
  else if (not(request.validCursor)) { phase: Unavailable, request: request, contextGap: gap, item: NoAssessment,
    status: failureStatus(request.route, 400), seenOutcomes: List() }
  else if (not(validScope(request.binding, request.key)) or not(gap))
    { phase: Ready, request: request, contextGap: gap, item: NoAssessment, status: 200, seenOutcomes: List() }
  else { phase: Checking, request: request, contextGap: gap, item: NoAssessment, status: 0, seenOutcomes: List() }
pure def lawMissingContextReturnsEmpty(q: QueueRead, request: QueueRequest, by: int, rows: List[VR::Delivery]): bool =
  (authenticated(request) and request.validCursor and not(present(assessmentFor(rows, request.key)))) implies
    (read(q, request, by, rows).phase == Ready and not(present(read(q, request, by, rows).item)))
```

### Denial clears the item and uncertain authority is retryable

A configured administrator, from the deployment's administrator list, may
read the currently bound repository without a GitHub permission lookup.
A maintainer needs the installed public repository with the exact numeric
ID and current path, and current write or admin permission. The GitHub
authority observation must belong to the requesting actor. A verified
denial returns an empty result for that scope. An unavailable check, a
mismatched GitHub repository or a changed captured manifest returns an
unavailable result rather than an empty one. The bundled Inbox keeps its
ordinary notices and reports the assessment queue as separately
unavailable. A direct queue failure returns its own HTTP error.

```quint
pure def exactInstallation(binding: RegistryBinding, access: AccessCheck): bool =
  access.repository == binding.repository and access.path == binding.path and I::active(access.install)
pure def assessable(binding: RegistryBinding, access: AccessCheck): bool =
  access.configuredAdmin or (exactInstallation(binding, access) and access.visibility == RS::PublicRepo
    and access.permission == CurrentWriter)
pure def accessUnavailable(binding: RegistryBinding, access: AccessCheck): bool =
  not(access.configuredAdmin) and (access.permission == AuthorityUnavailable or not(exactInstallation(binding, access)))
pure def canComplete(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[VR::Delivery]): bool =
  q.phase == Checking and requestId == q.request.requestId
pure def complete(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[VR::Delivery]): QueueRead =
  if (access.actor != q.request.actor or accessUnavailable(q.request.binding, access)
    or (assessable(q.request.binding, access) and currentBinding != q.request.binding))
    { ...q, phase: Unavailable, item: NoAssessment, status: failureStatus(q.request.route, 503) }
  else { ...q, phase: Ready, status: 200, seenOutcomes: VR::outcomesOf(rows), item:
    if (assessable(q.request.binding, access)) assessmentFor(rows, q.request.key) else NoAssessment }
pure def alwaysPrivateItemsRequireAdmittedRead(q: QueueRead): bool =
  present(q.item) implies (q.phase == Ready and authenticated(q.request) and validScope(q.request.binding, q.request.key)
    and q.request.validCursor and q.contextGap)
pure def alwaysCheckingRequiresAdmittedScope(q: QueueRead): bool =
  q.phase == Checking implies (authenticated(q.request) and validScope(q.request.binding, q.request.key)
    and q.request.validCursor and q.contextGap)
pure def alwaysFailedReadHasNoItem(q: QueueRead): bool = (q.phase == Unavailable or q.phase == Refused) implies not(present(q.item))
pure def stepOnlyCurrentOwnedResponsePublishes(before: QueueRead, via: str, after: QueueRead): bool =
  present(after.item) implies (via == "complete" and before.phase == Checking and after.request == before.request)
pure def lawDeniedOrUncertainAuthorityHasNoItem(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[VR::Delivery]): bool =
  (access.actor != q.request.actor or not(assessable(q.request.binding, access)) or accessUnavailable(q.request.binding, access))
    implies not(present(complete(q, requestId, currentBinding, access, rows).item))
pure def lawBundledUnavailableKeepsOrdinaryInbox(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[VR::Delivery]): bool =
  (q.request.route == BundledInbox and complete(q, requestId, currentBinding, access, rows).phase == Unavailable)
    implies complete(q, requestId, currentBinding, access, rows).status == 200
pure def lawDifferentManifestNeverPublishes(q: QueueRead, requestId: int, currentBinding: RegistryBinding, access: AccessCheck, rows: List[VR::Delivery]): bool =
  currentBinding != q.request.binding implies not(present(complete(q, requestId, currentBinding, access, rows).item))
```

### A departed page or changed actor cannot display a late queue response

The browser retires the old read when the committed page, cursor, refresh
or actor changes. It checks the session after the response and the
response's recipient before it uses a live page. An unavailable check shows
generic retry feedback. A changed actor suppresses the queue from the
departed view. Reading the queue never claims a worker attempt.

```quint
type BrowserRead = { actor: int, requestId: int, lifetime: int, sessionAvailable: bool, currentActor: int, recipient: int }
type BrowserQueue = Suppressed | QueueRetry | RefreshInbox | QueueReady({ item: AssessmentItem })
pure def suppressed(b: BrowserQueue): bool = match b { | Suppressed => true | QueueRetry => false | RefreshInbox => false | QueueReady(x) => false }
pure def browserQueue(q: QueueRead, browser: BrowserRead): BrowserQueue =
  if (browser.actor <= 0 or browser.actor != q.request.actor or browser.requestId != q.request.requestId
    or browser.lifetime != q.request.lifetime) Suppressed
  else if (not(browser.sessionAvailable)) RefreshInbox
  else if (browser.currentActor != browser.actor) Suppressed
  else if (q.phase == Refused) RefreshInbox
  else if (q.phase == Unavailable) QueueRetry
  else if (q.phase == Ready) (if (browser.recipient == browser.actor) QueueReady({ item: q.item }) else RefreshInbox)
  else Suppressed
pure def lawDepartedViewCannotDisplay(q: QueueRead, browser: BrowserRead): bool =
  (browser.lifetime != q.request.lifetime or browser.requestId != q.request.requestId) implies suppressed(browserQueue(q, browser))
pure def lawChangedActorCannotDisplay(q: QueueRead, browser: BrowserRead): bool =
  (browser.sessionAvailable and browser.currentActor != browser.actor) implies suppressed(browserQueue(q, browser))
pure def sometimesQueueVisible(q: QueueRead): bool = q.phase == Ready and present(q.item)
pure def sometimesQueueEmpty(q: QueueRead): bool = q.phase == Ready and not(present(q.item))
pure def sometimesQueueRefused(q: QueueRead): bool = q.phase == Refused
pure def sometimesDirectUnavailable(q: QueueRead): bool = q.phase == Unavailable and q.request.route == DirectQueue and q.status == 503
pure def sometimesOrdinaryInboxSurvivesQueueFailure(q: QueueRead): bool =
  q.phase == Unavailable and q.request.route == BundledInbox and q.status == 200 and q.request.validCursor
pure def sometimesExhaustedGapVisible(q: QueueRead): bool =
  present(q.item) and q.seenOutcomes.length() > 0 and q.seenOutcomes.every(c => c == VR::AttemptsExhausted)
```

### Simulation exercises coincident and conflicting observations

These values bound simulation and do not limit accepted IDs or times.

```quint
pure val sampleBinding: RegistryBinding = { project: 1, repository: 1, path: "org/repo", manifest: 1 }
pure val sampleKey: PrKey = { repository: 1, pullRequest: 1 }
pure val sampleRequest: QueueRequest = { actor: 1, expected: 1, requestId: 1, lifetime: 1, route: DirectQueue,
  binding: sampleBinding, key: sampleKey, validCursor: true }
pure val activeInstall: I::Installation = { ...I::initial, known: true, sourceTime: 1 }
pure val sampleAccess: AccessCheck = { actor: 1, configuredAdmin: false, permission: CurrentWriter, repository: 1,
  path: "org/repo", install: activeInstall, visibility: RS::PublicRepo }
pure val prKey: VR::PrKey = { installation: 1, repository: 1, owner: "org", repo: "repo", pull: 1 }
pure val sampleGap: VR::Delivery = { ...VR::noDelivery, id: 1, key: prKey, receivedAt: 1, state: VR::Waiting,
  code: VR::SourceIncomplete, retryAt: 4, attempts: 1, incompleteSince: 2, updatedAt: 2 }
pure val sampleExhausted: VR::Delivery = { ...sampleGap, state: VR::Completed, code: VR::AttemptsExhausted, retryAt: 0, updatedAt: 3 }
pure val sampleRunning: VR::Delivery = { ...VR::noDelivery, id: 2, key: prKey, receivedAt: 2, state: VR::Running,
  token: 1, claimedAt: 3, leaseUntil: 603, updatedAt: 3 }
pure val sampleComplete: VR::Delivery = { ...sampleRunning, state: VR::Completed, code: VR::Published, leaseUntil: 0, updatedAt: 4 }
pure val sampleEarlyComplete: VR::Delivery = { ...sampleComplete, updatedAt: 1 }
pure val requestValues = Set(sampleRequest, { ...sampleRequest, requestId: 2, route: BundledInbox },
  { ...sampleRequest, requestId: 3, expected: 2 }, { ...sampleRequest, requestId: 4, validCursor: false },
  { ...sampleRequest, requestId: 5, actor: 0, expected: 0 }, { ...sampleRequest, requestId: 6, key: { repository: 1, pullRequest: 2 } })
pure val currentBindingValues = Set(sampleBinding, { ...sampleBinding, manifest: 2 }, emptyBinding)
pure val accessValues = Set(sampleAccess, { ...sampleAccess, configuredAdmin: true },
  { ...sampleAccess, permission: AuthorityUnavailable }, { ...sampleAccess, permission: DeniedPermission },
  { ...sampleAccess, actor: 2 }, { ...sampleAccess, install: { ...activeInstall, suspended: true } },
  { ...sampleAccess, visibility: RS::VisibilityUnknown })
pure val rowsValues = Set(List(), List(sampleGap), List(sampleGap, sampleRunning), List(sampleGap, sampleComplete),
  List(sampleExhausted), List(sampleGap, sampleEarlyComplete))
pure val candidateValues = Set(sampleGap, sampleRunning, sampleComplete, sampleExhausted, sampleEarlyComplete)
pure val gapValues = candidateValues
pure val keyValues = Set(sampleKey, { ...sampleKey, repository: 2 })
pure val qValues = Set(initial)
pure val browserValues = Set({ actor: 1, requestId: 1, lifetime: 1, sessionAvailable: true, currentActor: 1, recipient: 1 },
  { actor: 1, requestId: 1, lifetime: 2, sessionAvailable: true, currentActor: 1, recipient: 1 },
  { actor: 1, requestId: 1, lifetime: 1, sessionAvailable: true, currentActor: 2, recipient: 1 })
pure val byValues = Set(0, 1, 2)
pure val requestIdValues = Set(1, 2, 3, 4, 5, 6)
pure val weight_read = 4
pure val weight_complete = 10
```
