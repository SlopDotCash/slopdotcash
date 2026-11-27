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

Each five-minute run processes due requests until none remain, ten have
been claimed or four minutes have passed. A request names the
installation, the permanent repository ID, the
repository owner and name as received, and the pull request number.
A new request, a waiting request whose retry time has come and a running
request whose claim expired are due. A completed request is never claimed
again. A parked request has no retry time and is not due. Two deliveries
of the same repository ID and pull request number never hold live claims
at once, even under different installations or names. Every claim gets a
fresh token and a ten-minute lease, and clears the earlier outcome.

```quint
import repositoryScope as RS from "./repositoryScope"
import installation as I from "./installation"
type PrKey = { installation: int, repository: int, owner: str, repo: str, pull: int }
type Outcome = NoOutcome | Published | Current | StillOpen | Historical | Missing | AttemptsExhausted
  | SourceIncomplete | AuthorityWait | Parked | BudgetWait | Retry
type ProcState = Unread | Running | Waiting | Completed
type Delivery = { id: int, key: PrKey, receivedAt: int, state: ProcState, token: int, claimedAt: int,
  leaseUntil: int, code: Outcome, retryAt: int, attempts: int, incompleteSince: int, updatedAt: int }
type GroupLease = { token: int, sources: Set[int] }
type ParkedTarget = { repository: int, owner: str, repo: str }
type ParkedCheck = { target: ParkedTarget, checkedAt: int }
type ValueRequests = { now: int, lastToken: int, deliveries: List[Delivery], groups: List[GroupLease],
  install: I::Installation, runStartedAt: int, runClaims: int, parkedChecks: List[ParkedCheck] }
pure val leaseSeconds = 600
pure val apiStart = 1793491200
pure val runRequests = 10
pure val runSeconds = 240
pure val runInterval = 300
pure val initial: ValueRequests = { now: 1793491300, lastToken: 0, deliveries: List(), groups: List(),
  install: I::initial, runStartedAt: 0, runClaims: 0, parkedChecks: List() }
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
pure def canApplyInstallation(v: ValueRequests, e: I::InstallEvent): bool = I::canDeliver(v.install, e)
pure def applyInstallation(v: ValueRequests, e: I::InstallEvent): ValueRequests = { ...v, install: I::deliver(v.install, e) }
pure def canStartRun(v: ValueRequests): bool = v.runStartedAt == 0 or v.now >= v.runStartedAt + runInterval
pure def startRun(v: ValueRequests): ValueRequests = { ...v, runStartedAt: v.now, runClaims: 0 }
pure def runOpen(v: ValueRequests): bool =
  v.runStartedAt > 0 and v.runClaims < runRequests and v.now < v.runStartedAt + runSeconds
pure def canRecord(v: ValueRequests, deliveryId: int, key: PrKey): bool =
  deliveryId > 0 and deliveryOf(v, deliveryId).id == 0 and validKey(key)
pure def record(v: ValueRequests, deliveryId: int, key: PrKey): ValueRequests =
  { ...v, deliveries: v.deliveries.append({ ...noDelivery, id: deliveryId, key: key, receivedAt: v.now }) }
pure def due(d: Delivery, now: int): bool =
  d.state == Unread or (d.state == Running and d.leaseUntil <= now)
    or (d.state == Waiting and d.retryAt > 0 and d.retryAt <= now)
pure def canClaim(v: ValueRequests, deliveryId: int): bool =
  val d = deliveryOf(v, deliveryId)
  d.id > 0 and due(d, v.now) and runOpen(v)
    and v.deliveries.every(o => o.id == d.id or not(samePull(o.key, d.key)) or not(liveClaim(o, v.now)))
pure def claim(v: ValueRequests, deliveryId: int): ValueRequests =
  val token = v.lastToken + 1
  { ...v, lastToken: token, runClaims: v.runClaims + 1, deliveries: v.deliveries.listMap(d => if (d.id == deliveryId)
    { ...d, state: Running, token: token, claimedAt: v.now, leaseUntil: v.now + leaseSeconds,
      code: NoOutcome, retryAt: 0, updatedAt: v.now } else d) }
```

## Story: Decide one fixed outcome from current evidence

### The outcome follows the consumer's checks in order

Each claim reads the live registry, the installation, the value
settings, GitHub through the installation and the durable assessment
history, in that order. A thrown failure is a transient retry. A paused,
retired or unregistered project parks the request. An inactive
installation throws and so retries. Missing or invalid settings, producer
revision or provider keys wait as a budget block; the settings include the
consumer's start (`valueStart`), an exact time never before 1 November 2026
UTC, which alerts-only mode sets to that date (`valueSettings` in
`value-settings.ts`). A repository that GitHub no
longer identifies by the registered ID waits for authority. A pull request
GitHub reports as absent from a repository the installation still reads is
missing. An unreadable pull request, an invalid close time and an
incomplete source or group are incomplete. An open pull request stays
open. Work accepted before the configured start is historical and belongs
to the [subscription import](./historicalImport.md), whose cutoff is the
same start (`subscriptionCutoff`). The claim then leases
the whole source group below; a group it does not hold is a transient
retry. A reusable current assessment is current. The
[inference admission](./valueInference.md) then decides between exhausted
attempts, pending attempts, a budget block and a call. A provider failure
is a transient retry. Authority lost before the call or publication waits
for authority. Outcomes are fixed codes, never model output or exception
text.

The registry observation, the installation and the group lease are this
unit's own typed state or the typed registry record. The GitHub reads,
the group collection, the admission decision and the publication result
are facts other units own, recorded in one `Observation` per claim. Their
binding to the [inference](./valueInference.md) machine is a composition
obligation: `admission` must be `valueInference.admission` for the key and
`Published` must coincide with that machine's `publish` under the same
fence. Until that composition exists, the Quint here proves the order of
the checks, not the truth of those facts.

```quint
type PullRead = PullMissing | PullUnreadable | PullOpen | PullClosed
type Admission = AdmitEligible | AdmitRetained | AdmitBudget | AdmitPending | AdmitExhausted
type Observation = { threw: bool, registry: RS::RegistryObservation, configured: bool, repositoryMatches: bool,
  valueStart: int, pull: PullRead, occurredAt: int, evidenceComplete: bool, groupComplete: bool, sources: Set[int],
  alreadyCurrent: bool, admission: Admission, providerResult: bool, authorityHeld: bool }
pure def decide(o: Observation, installed: bool, leased: bool): Outcome =
  if (o.threw) Retry
  else if (not(RS::mayAssessValue(RS::slopbotScope(o.registry)))) Parked
  else if (not(installed)) Retry
  else if (not(o.configured) or o.valueStart < apiStart) BudgetWait
  else if (not(o.repositoryMatches)) AuthorityWait
  else if (o.pull == PullMissing) Missing
  else if (o.pull == PullUnreadable) SourceIncomplete
  else if (o.pull == PullOpen) StillOpen
  else if (o.occurredAt <= 0) SourceIncomplete
  else if (o.occurredAt < o.valueStart) Historical
  else if (not(o.evidenceComplete) or not(o.groupComplete)) SourceIncomplete
  else if (not(leased)) Retry
  else if (o.alreadyCurrent) Current
  else if (o.admission == AdmitExhausted) AttemptsExhausted
  else if (o.admission == AdmitPending) Retry
  else if (o.admission == AdmitBudget) BudgetWait
  else if (o.admission == AdmitEligible and not(o.providerResult)) Retry
  else if (not(o.authorityHeld)) AuthorityWait
  else Published
pure def outcomeFor(v: ValueRequests, token: int, o: Observation): Outcome =
  decide(o, I::active(v.install), mayUseGroup(v, token, o.sources))
pure def terminal(code: Outcome): bool =
  code == Published or code == Current or code == StillOpen or code == Historical
    or code == Missing or code == AttemptsExhausted
pure def outcomesOf(rows: List[Delivery]): List[Outcome] = rows.listMap(d => d.code)
pure def resolving(code: Outcome): bool = terminal(code) and code != AttemptsExhausted
pure def blocked(code: Outcome): bool =
  code == SourceIncomplete or code == AuthorityWait or code == BudgetWait
pure def lawPausedNeverAssesses(o: Observation, installed: bool, leased: bool): bool =
  not(RS::mayAssessValue(RS::slopbotScope(o.registry))) implies
    (decide(o, installed, leased) == Parked or decide(o, installed, leased) == Retry)
pure def lawInactiveInstallationOnlyParksOrRetries(v: ValueRequests, token: int, o: Observation): bool =
  not(I::active(v.install)) implies (outcomeFor(v, token, o) == Retry or outcomeFor(v, token, o) == Parked)
pure def lawUnleasedGroupNeverScores(v: ValueRequests, token: int, o: Observation): bool =
  not(mayUseGroup(v, token, o.sources)) implies
    (outcomeFor(v, token, o) != Published and outcomeFor(v, token, o) != Current
      and outcomeFor(v, token, o) != AttemptsExhausted)
pure def lawPreStartWorkIsHistorical(o: Observation, installed: bool, leased: bool): bool =
  decide(o, installed, leased) == Historical implies
    o.occurredAt > 0 and o.occurredAt < o.valueStart and o.valueStart >= apiStart
pure def lawIncompleteIsNeverAScore(o: Observation, installed: bool, leased: bool): bool =
  (not(o.evidenceComplete) or not(o.groupComplete)) implies
    (decide(o, installed, leased) != Published and decide(o, installed, leased) != Current)
```

### Blocked outcomes back off, transient ones wait an hour, final ones stop

A final outcome completes the request with no retry time. A parked request
waits with no retry time. A transient retry waits one hour and does not
count as an attempt. A blocked outcome counts one attempt for the claimed
delivery and waits one hour doubled per earlier attempt, at most one day.
The first incomplete outcome records when the source gap started, and so
does an exhausted-attempts end, which is final yet not an assessment, so
that the pull request enters the maintainer's Inbox when its paid attempts
run out (`value-processing.ts` lines 199-211, development `6dc34ed89`,
#3172). Later non-resolving outcomes keep it. Only an accepted final outcome
other than exhausted attempts clears it. The outcome also settles every unread or
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
  if (resolving(code)) 0 else if (prior > 0) prior else if (code == SourceIncomplete or code == AttemptsExhausted) now else 0
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
  val code = outcomeFor(v, token, observation)
  { ...v, deliveries: v.deliveries.listMap(d => settleDelivery(d, owner, code, v.now)),
    groups: v.groups.select(g => g.token != token) }
pure def lawBackoffIsBounded(attempts: int): bool = backoff(attempts) >= 3600 and backoff(attempts) <= 86400
pure def lawTransientRetryWaitsOneHour(attempts: int, now: int): bool = retryTime(Retry, attempts, now) == now + 3600
```

### A parked request resumes when its repository is active again, checked in rotation

Each run checks up to 20 parked repositories, each named by its permanent
ID and the owner and name its requests were received under. A repository
never checked comes first, then the one checked longest ago. The check
reads the live registry and records its time only after the registry
answered, so a failed read records nothing and resumes nothing. An active
repository gives every parked request under that name a retry time of now.
An inactive one keeps them parked and moves to the back of the rotation.

```quint
pure def targetOf(d: Delivery): ParkedTarget = { repository: d.key.repository, owner: d.key.owner, repo: d.key.repo }
pure def parked(d: Delivery): bool = d.state == Waiting and d.code == Parked and d.retryAt == 0
pure def lastChecked(v: ValueRequests, t: ParkedTarget): int =
  v.parkedChecks.select(c => c.target == t).nthOr(0, { target: t, checkedAt: 0 }).checkedAt
pure def nextInRotation(v: ValueRequests, t: ParkedTarget): bool =
  v.deliveries.some(d => parked(d) and targetOf(d) == t)
    and v.deliveries.every(d => not(parked(d)) or lastChecked(v, targetOf(d)) >= lastChecked(v, t))
pure def canCheckParked(v: ValueRequests, target: ParkedTarget, registry: RS::RegistryObservation): bool =
  target.repository > 0 and nextInRotation(v, target)
pure def checkParked(v: ValueRequests, target: ParkedTarget, registry: RS::RegistryObservation): ValueRequests =
  val active = RS::mayAssessValue(RS::slopbotScope(registry)) and registry.observedId == target.repository
  val checks = v.parkedChecks.select(c => c.target != target).append({ target: target, checkedAt: v.now })
  { ...v, parkedChecks: checks, deliveries: v.deliveries.listMap(d =>
    if (active and parked(d) and targetOf(d) == target) { ...d, retryAt: v.now, updatedAt: v.now } else d) }
pure def lawInactiveCheckResumesNothing(v: ValueRequests, target: ParkedTarget, registry: RS::RegistryObservation): bool =
  not(RS::mayAssessValue(RS::slopbotScope(registry))) implies
    checkParked(v, target, registry).deliveries == v.deliveries
```

## Story: Lease every source of a group or none

### Overlapping groups contend by permanent source ID

A running claim leases its complete source group in one conditional write.
A source ID stands for the permanent repository and pull request pair, so
changed content and different inference keys still contend. If any wanted
source belongs to another live claim's group, nothing is written. An
expired or finished claim no longer blocks. Every provider call and
publication rechecks both the request claim and the exact group. The clock
stays positive and the monotonic claim token counter stays non-negative.

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
pure def alwaysRunWithinLimits(v: ValueRequests): bool =
  v.now > 0 and v.lastToken >= 0 and v.runClaims >= 0 and v.runClaims <= runRequests and v.runStartedAt >= 0 and v.runStartedAt <= v.now
pure def alwaysParkedChecksAreUnique(v: ValueRequests): bool =
  v.parkedChecks.every(c => c.checkedAt > 0 and c.checkedAt <= v.now
    and v.parkedChecks.select(o => o.target == c.target).length() == 1)
pure def stepPublishNeedsLiveGroupAndInstallation(before: ValueRequests, after: ValueRequests): bool =
  after.deliveries.some(d => d.code == Published and deliveryOf(before, d.id).code != Published) implies
    (I::active(before.install) and before.groups.some(g => tokenLive(before, g.token)))
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
pure def sometimesParkedRotated(v: ValueRequests): bool =
  v.parkedChecks.length() > 0 and v.deliveries.some(d => parked(d))
pure def sometimesRunExhausted(v: ValueRequests): bool =
  v.runClaims == runRequests or (v.runStartedAt > 0 and v.now >= v.runStartedAt + runSeconds
    and v.deliveries.some(d => d.state == Unread))
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
pure val targetValues = Set({ repository: 1, owner: "org", repo: "repo" }, { repository: 1, owner: "renamed", repo: "repo" })
pure val eValues = Set({ delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: I::Suspend, sourceTime: 2, hasAccount: true, validTime: true })
pure val sourcesValues = Set(Set(1), Set(1, 2), Set(3))
pure val activeRegistry: RS::RegistryObservation = { lookup: RS::CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged }
pure val registryValues = Set(activeRegistry, { ...activeRegistry, rowActive: false })
pure val publishable: Observation = { threw: false, registry: activeRegistry, configured: true, repositoryMatches: true,
  valueStart: apiStart, pull: PullClosed, occurredAt: 1793491300, evidenceComplete: true, groupComplete: true, sources: Set(1),
  alreadyCurrent: false, admission: AdmitEligible, providerResult: true, authorityHeld: true }
pure val observationValues = Set(publishable, { ...publishable, threw: true },
  { ...publishable, registry: { ...activeRegistry, rowActive: false } }, { ...publishable, configured: false },
  { ...publishable, pull: PullMissing }, { ...publishable, pull: PullOpen }, { ...publishable, occurredAt: 1790000000 },
  { ...publishable, evidenceComplete: false }, { ...publishable, admission: AdmitExhausted },
  { ...publishable, admission: AdmitBudget }, { ...publishable, alreadyCurrent: true },
  { ...publishable, sources: Set(1, 2) }, { ...publishable, valueStart: 1793577600 },
  { ...publishable, valueStart: 1790000000 })
pure val installedValues = Set(true, false)
pure val leasedValues = Set(true, false)
pure val oValues = observationValues
pure val weight_claim = 2
pure val weight_finish = 2
pure val weight_record = 1
pure val weight_claimGroup = 2
pure val weight_startRun = 1
pure val eval_witness_sometimesPublished = (
  ("applyInstallation", { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true }),
  "startRun",
  ("record", 1, keyA),
  ("claim", 1),
  ("claimGroup", 1, Set(1)),
  ("finish", 1, 1, publishable)
)
pure val eval_witness_sometimesBackedOff = (
  ("applyInstallation", { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true }),
  "startRun",
  ("record", 1, keyA),
  ("claim", 1),
  ("finish", 1, 1, { ...publishable, evidenceComplete: false }),
  ("elapse", 3600),
  "startRun",
  ("claim", 1),
  ("finish", 1, 2, { ...publishable, evidenceComplete: false })
)
pure val eval_witness_sometimesGapKeptThroughRetry = (
  ("applyInstallation", { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true }),
  "startRun",
  ("record", 1, keyA),
  ("claim", 1),
  ("finish", 1, 1, { ...publishable, evidenceComplete: false }),
  ("elapse", 3600),
  "startRun",
  ("claim", 1),
  ("finish", 1, 2, { ...publishable, threw: true })
)
pure val eval_witness_sometimesExhausted = (
  ("applyInstallation", { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true }),
  "startRun",
  ("record", 1, keyA),
  ("claim", 1),
  ("claimGroup", 1, Set(1)),
  ("finish", 1, 1, { ...publishable, admission: AdmitExhausted })
)
```
