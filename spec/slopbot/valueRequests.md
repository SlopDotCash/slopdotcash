# Slopbot value request outcomes, retries and source contention

PRD sections 5 and 7 require recoverable assessments of accepted pull
requests, with incomplete evidence, budget and authority blocks kept
retryable instead of scored as zero. PRD section 9 requires the incomplete
ones to stay visible. Source is `workers/slopbot/value-requests.ts`,
`workers/slopbot/value-processing.ts`, `workers/slopbot/value-consumer.ts`
(`consumeValueRequest`, `nextValueRequest`,
`consumePendingValueRequests`), `workers/slopbot/value-source-leases.ts`
and migrations `0050`, `0052`, `0053`, `0103`, `0105`, `0106` and `0115` at
the pinned development revision. The retained `bot_value_request` model
covers the same outcomes. The preserved draft
`formal/drafts/value-group-leases.md` supplied the group lease rules.

This unit owns the durable value request rows of every delivery, their
processing claim, outcome, retry time, blocked attempt count and first
source gap, and the source group leases of running claims. The
[webhook](./webhookDelivery.md) records each request with its immutable
source. The [value inference](./valueInference.md) unit owns provider
attempts, retained results and publication for one inference key.
The [incomplete-assessment Inbox](./assessmentInbox.md) reads these rows.

## Story: Claim each due request alone for its pull request

### A ten-minute claim needs a due row and no other live claim on the same pull request

A request names the installation, the permanent repository ID, the
repository owner and name as received, and the pull request number.
A new request, a waiting request whose retry time has come and a running
request whose claim expired are due. A completed request is never claimed
again. A parked request has no retry time and is not due. Two deliveries
of the same repository ID and pull request number never hold live claims
at once, even under different installations or names. Every claim gets a
fresh token and a ten-minute lease, and clears the earlier outcome.

```quint
import repositoryScope as RS from "./repositoryScope"
type PrKey = { installation: int, repository: int, owner: str, repo: str, pull: int }
type Outcome = NoOutcome | Published | Current | StillOpen | Historical | Missing | AttemptsExhausted
  | SourceIncomplete | AuthorityWait | Parked | BudgetWait | Retry
type ProcState = Unread | Running | Waiting | Completed
type Delivery = { id: int, key: PrKey, receivedAt: int, state: ProcState, token: int, claimedAt: int,
  leaseUntil: int, code: Outcome, retryAt: int, attempts: int, incompleteSince: int, updatedAt: int }
type GroupLease = { token: int, sources: Set[int] }
type ValueRequests = { now: int, lastToken: int, deliveries: List[Delivery], groups: List[GroupLease] }
pure val leaseSeconds = 600
pure val apiStart = 1793491200
pure val initial: ValueRequests = { now: 1793491300, lastToken: 0, deliveries: List(), groups: List() }
pure val noDelivery: Delivery = { id: 0, key: { installation: 0, repository: 0, owner: "", repo: "", pull: 0 },
  receivedAt: 0, state: Unread, token: 0, claimedAt: 0, leaseUntil: 0, code: NoOutcome, retryAt: 0,
  attempts: 0, incompleteSince: 0, updatedAt: 0 }
pure def deliveryOf(v: ValueRequests, deliveryId: int): Delivery =
  v.deliveries.select(d => d.id == deliveryId).nthOr(0, noDelivery)
pure def samePull(a: PrKey, b: PrKey): bool = a.repository == b.repository and a.pull == b.pull
pure def validKey(k: PrKey): bool =
  k.installation > 0 and k.repository > 0 and k.pull > 0 and k.owner != "" and k.repo != ""
pure def liveClaim(d: Delivery, now: int): bool = d.state == Running and d.leaseUntil > now
pure def canElapse(v: ValueRequests, seconds: int): bool = seconds > 0
pure def elapse(v: ValueRequests, seconds: int): ValueRequests = { ...v, now: v.now + seconds }
pure def canRecord(v: ValueRequests, deliveryId: int, key: PrKey): bool =
  deliveryId > 0 and deliveryOf(v, deliveryId).id == 0 and validKey(key)
pure def record(v: ValueRequests, deliveryId: int, key: PrKey): ValueRequests =
  { ...v, deliveries: v.deliveries.append({ ...noDelivery, id: deliveryId, key: key, receivedAt: v.now }) }
pure def due(d: Delivery, now: int): bool =
  d.state == Unread or (d.state == Running and d.leaseUntil <= now)
    or (d.state == Waiting and d.retryAt > 0 and d.retryAt <= now)
pure def canClaim(v: ValueRequests, deliveryId: int): bool =
  val d = deliveryOf(v, deliveryId)
  d.id > 0 and due(d, v.now) and v.deliveries.every(o => o.id == d.id or not(samePull(o.key, d.key)) or not(liveClaim(o, v.now)))
pure def claim(v: ValueRequests, deliveryId: int): ValueRequests =
  val token = v.lastToken + 1
  { ...v, lastToken: token, deliveries: v.deliveries.listMap(d => if (d.id == deliveryId)
    { ...d, state: Running, token: token, claimedAt: v.now, leaseUntil: v.now + leaseSeconds,
      code: NoOutcome, retryAt: 0, updatedAt: v.now } else d) }
```

## Story: Decide one fixed outcome from current evidence

### The outcome follows the consumer's checks in order

Each claim reads the live registry, the value settings, GitHub through
the installation and the durable assessment history, in that order. A
thrown failure is a transient retry. A paused, retired or unregistered
project parks the request. Missing settings, producer revision or provider
keys wait as a budget block. A repository that GitHub no longer identifies
by the registered ID waits for authority. A pull request GitHub reports as
absent from a repository the installation still reads is missing. An
unreadable pull request, an invalid close time and an incomplete source or
group are incomplete. An open pull request stays open. Work accepted
before 1 November 2026 UTC is historical and belongs to the
[subscription import](./historicalImport.md). Source lease contention is a
transient retry. A reusable current assessment is current. The
[inference admission](./valueInference.md) then decides between exhausted
attempts, pending attempts, a budget block and a call. A provider failure is
a transient retry. Authority lost before the call or publication waits for
authority. Every fact comes from the named service through the consumer,
never from the webhook payload. Outcomes are fixed codes, never model
output or exception text.

```quint
type PullRead = PullMissing | PullUnreadable | PullOpen | PullClosed
type Admission = AdmitEligible | AdmitRetained | AdmitBudget | AdmitPending | AdmitExhausted
type Observation = { threw: bool, registry: RS::RegistryObservation, configured: bool, repositoryMatches: bool,
  pull: PullRead, occurredAt: int, evidenceComplete: bool, groupComplete: bool, leasesTaken: bool,
  alreadyCurrent: bool, admission: Admission, providerResult: bool, authorityHeld: bool }
pure def decide(o: Observation): Outcome =
  if (o.threw) Retry
  else if (not(RS::mayAssessValue(RS::slopbotScope(o.registry)))) Parked
  else if (not(o.configured)) BudgetWait
  else if (not(o.repositoryMatches)) AuthorityWait
  else if (o.pull == PullMissing) Missing
  else if (o.pull == PullUnreadable) SourceIncomplete
  else if (o.pull == PullOpen) StillOpen
  else if (o.occurredAt <= 0) SourceIncomplete
  else if (o.occurredAt < apiStart) Historical
  else if (not(o.evidenceComplete) or not(o.groupComplete)) SourceIncomplete
  else if (not(o.leasesTaken)) Retry
  else if (o.alreadyCurrent) Current
  else if (o.admission == AdmitExhausted) AttemptsExhausted
  else if (o.admission == AdmitPending) Retry
  else if (o.admission == AdmitBudget) BudgetWait
  else if (o.admission == AdmitEligible and not(o.providerResult)) Retry
  else if (not(o.authorityHeld)) AuthorityWait
  else Published
pure def terminal(code: Outcome): bool =
  code == Published or code == Current or code == StillOpen or code == Historical
    or code == Missing or code == AttemptsExhausted
pure def resolving(code: Outcome): bool = terminal(code) and code != AttemptsExhausted
pure def blocked(code: Outcome): bool =
  code == SourceIncomplete or code == AuthorityWait or code == BudgetWait
pure def lawPausedNeverAssesses(o: Observation): bool =
  not(RS::mayAssessValue(RS::slopbotScope(o.registry))) implies (decide(o) == Parked or decide(o) == Retry)
pure def lawPreStartWorkIsHistorical(o: Observation): bool =
  decide(o) == Historical implies o.occurredAt > 0 and o.occurredAt < apiStart
pure def lawIncompleteIsNeverAScore(o: Observation): bool =
  (not(o.evidenceComplete) or not(o.groupComplete)) implies decide(o) != Published and decide(o) != Current
pure def lawExhaustionNeedsAdmission(o: Observation): bool =
  decide(o) == AttemptsExhausted implies o.admission == AdmitExhausted
```

### Blocked outcomes back off, transient ones wait an hour, final ones stop

A final outcome completes the request with no retry time. A parked request
waits with no retry time. A transient retry waits one hour and does not
count as an attempt. A blocked outcome counts one attempt for the claimed
delivery and waits one hour doubled per earlier attempt, at most one day.
The first incomplete outcome records when the source gap started. Later
non-resolving outcomes keep it. Only an accepted final outcome other than
exhausted attempts clears it. The outcome also settles every unread or
waiting delivery for the identical installation, repository ID, owner,
name and pull request received by the claim time, without counting an
attempt for them. Completion needs the current claim and an unexpired lease.

```quint
pure def backoff(attempts: int): int =
  if (attempts <= 0) 3600 else if (attempts == 1) 7200 else if (attempts == 2) 14400
  else if (attempts == 3) 28800 else if (attempts == 4) 57600 else 86400
pure def retryTime(code: Outcome, attempts: int, now: int): int =
  if (terminal(code) or code == Parked) 0
  else if (code == Retry) now + 3600 else now + backoff(attempts)
pure def gapSince(prior: int, code: Outcome, now: int): int =
  if (resolving(code)) 0 else if (prior > 0) prior else if (code == SourceIncomplete) now else 0
pure def settleDelivery(d: Delivery, owner: Delivery, code: Outcome, now: int): Delivery =
  if (d.id == owner.id)
    { ...d, state: if (terminal(code)) Completed else Waiting, code: code, leaseUntil: 0,
      retryAt: retryTime(code, d.attempts, now), attempts: d.attempts + (if (blocked(code)) 1 else 0),
      incompleteSince: gapSince(d.incompleteSince, code, now), updatedAt: now }
  else if (d.key == owner.key and d.receivedAt <= owner.claimedAt and (d.state == Unread or d.state == Waiting))
    { ...d, state: if (terminal(code)) Completed else Waiting, code: code, leaseUntil: 0,
      retryAt: retryTime(code, owner.attempts, now),
      incompleteSince: gapSince(d.incompleteSince, code, now), updatedAt: now }
  else d
pure def canFinish(v: ValueRequests, deliveryId: int, token: int, observation: Observation): bool =
  val d = deliveryOf(v, deliveryId)
  d.id > 0 and liveClaim(d, v.now) and token > 0 and d.token == token
pure def finish(v: ValueRequests, deliveryId: int, token: int, observation: Observation): ValueRequests =
  val owner = deliveryOf(v, deliveryId)
  val code = decide(observation)
  { ...v, deliveries: v.deliveries.listMap(d => settleDelivery(d, owner, code, v.now)),
    groups: v.groups.select(g => g.token != token) }
pure def lawBackoffIsBounded(attempts: int): bool = backoff(attempts) >= 3600 and backoff(attempts) <= 86400
pure def lawTransientRetryWaitsOneHour(attempts: int, now: int): bool = retryTime(Retry, attempts, now) == now + 3600
```

### A parked request resumes when its repository is active again

Each run rechecks parked repositories in rotation from the live registry
and gives every parked request of an active one a retry time of now.
A registry read failure propagates and resumes nothing.

```quint
pure def canResumeParked(v: ValueRequests, repository: int, registry: RS::RegistryObservation): bool =
  repository > 0 and RS::mayAssessValue(RS::slopbotScope(registry)) and registry.observedId == repository
    and v.deliveries.some(d => d.key.repository == repository and d.state == Waiting and d.code == Parked and d.retryAt == 0)
pure def resumeParked(v: ValueRequests, repository: int, registry: RS::RegistryObservation): ValueRequests =
  { ...v, deliveries: v.deliveries.listMap(d =>
    if (d.key.repository == repository and d.state == Waiting and d.code == Parked and d.retryAt == 0)
      { ...d, retryAt: v.now, updatedAt: v.now } else d) }
```

## Story: Lease every source of a group or none

### Overlapping groups contend by permanent source ID

A running claim leases its complete source group in one conditional write.
A source ID stands for the permanent repository and pull request pair, so
changed content and different inference keys still contend. If any wanted
source belongs to another live claim's group, nothing is written. An
expired or finished claim no longer blocks. Every provider call and
publication rechecks both the request claim and the exact group.

```quint
pure def tokenLive(v: ValueRequests, token: int): bool =
  token > 0 and v.deliveries.some(d => d.token == token and liveClaim(d, v.now))
pure def canClaimGroup(v: ValueRequests, token: int, sources: Set[int]): bool =
  tokenLive(v, token) and sources.size() > 0 and not(v.groups.some(g => g.token == token))
    and v.groups.every(g => not(tokenLive(v, g.token)) or g.sources.intersect(sources).size() == 0)
pure def claimGroup(v: ValueRequests, token: int, sources: Set[int]): ValueRequests =
  { ...v, groups: v.groups.select(g => tokenLive(v, g.token)).append({ token: token, sources: sources }) }
pure def mayUseGroup(v: ValueRequests, token: int, sources: Set[int]): bool =
  tokenLive(v, token) and v.groups.some(g => g.token == token and g.sources.subseteq(sources) and sources.subseteq(g.sources))
pure def alwaysExclusiveLiveGroups(v: ValueRequests): bool =
  v.groups.every(a => v.groups.every(b => a.token == b.token or not(tokenLive(v, a.token))
    or not(tokenLive(v, b.token)) or a.sources.intersect(b.sources).size() == 0))
pure def alwaysOneGroupPerToken(v: ValueRequests): bool =
  v.groups.every(g => g.token > 0 and g.token <= v.lastToken and v.groups.select(o => o.token == g.token).length() == 1)
pure def alwaysOneLiveClaimPerPull(v: ValueRequests): bool =
  v.deliveries.every(a => v.deliveries.every(b => a.id == b.id or not(samePull(a.key, b.key))
    or not(liveClaim(a, v.now)) or not(liveClaim(b, v.now))))
pure def alwaysRowsMatchState(v: ValueRequests): bool =
  v.deliveries.every(d => d.id > 0 and validKey(d.key) and d.attempts >= 0 and d.incompleteSince >= 0
    and v.deliveries.select(o => o.id == d.id).length() == 1 and d.token <= v.lastToken
    and (d.state == Running implies d.token > 0 and d.leaseUntil > 0 and d.code == NoOutcome and d.retryAt == 0)
    and (d.state == Completed implies terminal(d.code) and d.retryAt == 0 and d.leaseUntil == 0)
    and (d.state == Waiting implies not(terminal(d.code)) and d.code != NoOutcome and d.leaseUntil == 0
      and (d.code != Parked implies d.retryAt > 0))
    and (d.state == Unread implies d.code == NoOutcome and d.token == 0 and d.attempts == 0 and d.incompleteSince == 0)
    and (resolving(d.code) implies d.incompleteSince == 0))
pure def stepCompletedIsFinal(before: ValueRequests, after: ValueRequests): bool =
  before.deliveries.every(d => d.state == Completed implies after.deliveries.includes(d))
pure def stepSourcesImmutable(before: ValueRequests, after: ValueRequests): bool =
  before.deliveries.every(d => deliveryOf(after, d.id).key == d.key and deliveryOf(after, d.id).receivedAt == d.receivedAt
    and deliveryOf(after, d.id).attempts >= d.attempts and deliveryOf(after, d.id).attempts <= d.attempts + 1)
pure def sometimesPublished(v: ValueRequests): bool = v.deliveries.some(d => d.code == Published)
pure def sometimesSiblingSettled(v: ValueRequests): bool =
  v.deliveries.some(d => d.state == Completed and d.claimedAt == 0)
pure def sometimesParkedResumed(v: ValueRequests): bool =
  v.deliveries.some(d => d.state == Waiting and d.code == Parked and d.retryAt > 0)
pure def sometimesBackedOff(v: ValueRequests): bool = v.deliveries.some(d => d.attempts >= 2 and d.state == Waiting)
pure def sometimesGapKeptThroughRetry(v: ValueRequests): bool =
  v.deliveries.some(d => d.incompleteSince > 0 and d.code != SourceIncomplete)
pure def sometimesExhausted(v: ValueRequests): bool = v.deliveries.some(d => d.code == AttemptsExhausted and d.incompleteSince > 0)
pure def sometimesContendedGroup(v: ValueRequests): bool = v.groups.length() > 1
```

### Samples cover siblings, renamed sources, contention and every outcome

```quint
pure val keyA: PrKey = { installation: 1, repository: 1, owner: "org", repo: "repo", pull: 1 }
pure val keyValues = Set(keyA, { ...keyA, owner: "renamed" }, { ...keyA, pull: 2 })
pure val deliveryIdValues = Set(1, 2, 3)
pure val tokenValues = Set(1, 2, 3, 4)
pure val secondsValues = Set(300, 3600, 86400)
pure val repositoryValues = Set(1)
pure val sourcesValues = Set(Set(1), Set(1, 2), Set(3))
pure val activeRegistry: RS::RegistryObservation = { lookup: RS::CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged }
pure val registryValues = Set(activeRegistry, { ...activeRegistry, rowActive: false })
pure val publishable: Observation = { threw: false, registry: activeRegistry, configured: true, repositoryMatches: true,
  pull: PullClosed, occurredAt: 1793491300, evidenceComplete: true, groupComplete: true, leasesTaken: true,
  alreadyCurrent: false, admission: AdmitEligible, providerResult: true, authorityHeld: true }
pure val observationValues = Set(publishable, { ...publishable, threw: true },
  { ...publishable, registry: { ...activeRegistry, rowActive: false } }, { ...publishable, configured: false },
  { ...publishable, pull: PullMissing }, { ...publishable, pull: PullOpen }, { ...publishable, occurredAt: 1790000000 },
  { ...publishable, evidenceComplete: false }, { ...publishable, admission: AdmitExhausted },
  { ...publishable, admission: AdmitBudget }, { ...publishable, alreadyCurrent: true })
pure val oValues = observationValues
pure val weight_claim = 6
pure val weight_finish = 8
pure val weight_record = 3
```
