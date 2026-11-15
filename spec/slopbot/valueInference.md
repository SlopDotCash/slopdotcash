# Durable work-unit value assessment

PRD sections 5 and 7 require exact registered sources, separate usage
accounting and a recoverable assessment before Points publication. This unit
owns one inference key with potentially competing deliveries, scoped source
leases, append-only attempt and provider observations, the retained validated
result and its assessment journal boundary. [Review](./review.md) owns ordinary
PR findings, [value requests](./valueRequests.md) own each delivery's
claim, outcome and retry schedule, [Points census](../points/census.md) owns source collection, and the
[Points journal](../points/journal.md) owns awarded Points. An assessment does
not merge work, alter a vote, close a PR, authorize a payout or assign Points
on its own.

Source at `e96069ce2a403588ca2129b1ebb943f7bb0972a6` includes
`workers/slopbot/{value-consumer,value-processing,value-source-leases,value-inference,value-budget,value-publication-fence,models}.ts`.
The retained models `bot_value_precall_authority`, `bot_value_pipeline`,
`bot_value_attempt_recovery` and `bot_value_budget` cover the same coordination.
GitHub membership and tree integrity, canonical hashes, SQL conditional writes,
provider usage, and validated structured results remain shell evidence.

## Story: Claim a complete immutable source group

### Take all source leases or none

A request captures its immutable installation and inference input identities.
The input binds the collected source group and normalized prompt, policy,
schema and provider route. The key represents their canonical digest. A
delivery with incomplete collection or a different key obtains no source lease
for this unit. Exact source IDs are distinct permanent repository/PR pairs.
Two active deliveries may be represented independently. A lease is valid
strictly before its deadline. Claimed source leases track the owner request's
deadline, and any overlapping live source owner refuses the entire group.

```quint
type RequestPhase = Absent | Reading | Owned | Published
type Mode = MissingConfig | AlertsOnly | Capped
type Provider = OrbioSonnet | SurplusSonnet | SurplusTerra
type AttemptPhase = Admitted | HeldBudget | Calling | RouteDone | Completed
type CallResult = ValidResult | FailedCall | BudgetDenial
type ReadPhase = NoCheck | RemoteRead | FinalChecks | Observed
type Decision = Eligible | RetainedResult | BudgetBlocked | PendingCapacity | AttemptsExhausted
type Source = { repository: int, pull: int, digest: str }
type Authority = { revision: int, generation: int, manifest: str, installation: int, active: bool }
type Request = { token: int, deadline: int, inputDigest: str, group: List[Source], phase: RequestPhase,
  check: ReadPhase, checked: Authority, observedSource: str, remoteExact: bool, fence: Authority }
type Charge = { provider: Provider, seenModel: str, result: CallResult, known: bool, actual: int, estimate: int,
  output: str, sizeBand: int, customerCharge: int }
type Attempt = { id: int, token: int, month: int, stage: AttemptPhase, limited: bool, maximum: int, routeStep: int,
  allCalls: List[Charge], usageSaved: bool, resultStored: bool, reconciled: bool }
type Retained = { attempt: int, key: str, result: str, sizeBand: int }
type ValueInference = { now: int, month: int, key: str, group: List[Source], authority: Authority,
  config: Mode, monthlyCap: int, maximum: int, requests: List[Request], attempts: List[Attempt],
  retained: Retained, published: Retained, occupied: Set[int] }
type ReleaseSettings = { mode: Mode, cap: int, maximum: int }
pure val emptyAuthority: Authority = { revision: 0, generation: 0, manifest: "", installation: 0, active: false }
pure val reviewedAuthority: Authority = { revision: 1, generation: 1, manifest: "manifest-one", installation: 1, active: true }
pure val noRequest: Request = { token: 0, deadline: 0, inputDigest: "", group: List(),
  phase: Absent, check: NoCheck, checked: emptyAuthority, observedSource: "", remoteExact: false, fence: emptyAuthority }
pure val noAttempt: Attempt = { id: 0, token: 0, month: 0, stage: Admitted, limited: false, maximum: 0, routeStep: 0,
  allCalls: List(), usageSaved: false, resultStored: false, reconciled: false }
pure val noRetained: Retained = { attempt: 0, key: "", result: "", sizeBand: 0 }
pure val initial: ValueInference = { now: 0, month: 1, key: "", group: List(), authority: emptyAuthority,
  config: MissingConfig, monthlyCap: 0, maximum: 0, requests: List(), attempts: List(),
  retained: noRetained, published: noRetained, occupied: Set() }
pure def validSource(s: Source): bool = s.repository > 0 and s.pull > 0 and s.digest != ""
pure def sameScope(a: Source, b: Source): bool = a.repository == b.repository and a.pull == b.pull
pure def validGroup(group: List[Source]): bool = group.length() > 0 and group.every(s => validSource(s)
  and group.select(other => sameScope(s, other)).length() == 1)
pure def request(v: ValueInference, token: int): Request = v.requests.select(r => r.token == token).nthOr(0, noRequest)
pure def attempt(v: ValueInference, attemptId: int): Attempt = v.attempts.select(a => a.id == attemptId).nthOr(0, noAttempt)
pure def putRequest(r: Request, v: ValueInference): ValueInference =
  { ...v, requests: v.requests.listMap(old => if (old.token == r.token) r else old) }
pure def putAttempt(a: Attempt, v: ValueInference): ValueInference =
  { ...v, attempts: v.attempts.listMap(old => if (old.id == a.id) a else old) }
pure def live(r: Request, now: int): bool = r.token > 0 and now < r.deadline and (r.phase == Reading or r.phase == Owned)
pure def owns(r: Request, v: ValueInference): bool = live(r, v.now) and r.phase == Owned and r.group == v.group
pure def canSetSource(v: ValueInference, key: str, group: List[Source], authority: Authority): bool =
  v.key == "" and key != "" and validGroup(group) and authority.installation > 0
pure def setSource(v: ValueInference, key: str, group: List[Source], authority: Authority): ValueInference =
  { ...v, key: key, group: group, authority: authority }
pure def canObserve(v: ValueInference, now: int, month: int, authority: Authority): bool =
  v.key != "" and now >= v.now and month >= v.month and authority.installation == v.authority.installation
    and authority.revision >= v.authority.revision and authority.generation >= v.authority.generation
pure def observe(v: ValueInference, now: int, month: int, authority: Authority): ValueInference =
  { ...v, now: now, authority: authority, month: month }
pure def canClaim(v: ValueInference, token: int, deadline: int): bool =
  v.key != "" and token > 0 and request(v, token).token == 0 and deadline > v.now and v.published == noRetained
pure def claim(v: ValueInference, token: int, deadline: int, inputDigest: str): ValueInference =
  { ...v, requests: v.requests.append({ ...noRequest, token: token, deadline: deadline, inputDigest: inputDigest, phase: Reading }) }
pure def canOwnGroup(v: ValueInference, token: int, sources: List[Source]): bool =
  val r = request(v, token)
  live(r, v.now) and r.phase == Reading and r.inputDigest == v.key and sources == v.group
    and v.requests.every(other => other.token == token or not(owns(other, v)))
pure def ownGroup(v: ValueInference, token: int, sources: List[Source]): ValueInference =
  putRequest({ ...request(v, token), phase: Owned, group: sources }, v)
```

### A remote membership lookup is followed by current local authority and lease checks

The running request and all source leases must be owned both before and
after the remote membership lookup. The returned membership must cover
exactly the requested group. Local registry revision, implementation
restriction generation and installation authority are reread. A source drift,
restricted project, failed membership read or expired lease refuses the
provider request. Every fallback starts a new check. A provider call already
started may record its charge after the owner's lease expires.

```quint
pure def locallyAuthorized(v: ValueInference): bool =
  v.authority.active and v.authority.revision > 0 and v.authority.manifest != "" and v.authority.installation > 0
pure def canBeginCheck(v: ValueInference, token: int): bool =
  owns(request(v, token), v) and locallyAuthorized(v) and request(v, token).check != RemoteRead
pure def beginCheck(v: ValueInference, token: int): ValueInference =
  putRequest({ ...request(v, token), check: RemoteRead, checked: v.authority, observedSource: "", remoteExact: false }, v)
pure def canRemoteReply(v: ValueInference, token: int): bool = request(v, token).check == RemoteRead
pure def remoteReply(v: ValueInference, token: int, observedSource: str, members: List[Source]): ValueInference =
  putRequest({ ...request(v, token), check: FinalChecks, observedSource: observedSource,
    remoteExact: members == v.group }, v)
pure def candidateCurrent(r: Request, v: ValueInference): bool =
  owns(r, v) and locallyAuthorized(v) and r.checked == v.authority and r.remoteExact and r.observedSource == v.key
pure def canFinishCheck(v: ValueInference, token: int): bool = request(v, token).check == FinalChecks
pure def finishCheck(v: ValueInference, token: int): ValueInference =
  val r = request(v, token)
  putRequest({ ...r, check: if (candidateCurrent(r, v)) Observed else NoCheck }, v)
pure def checkedCurrent(r: Request, v: ValueInference): bool = r.check == Observed and candidateCurrent(r, v)
```

## Story: Hold paid attempts until exact usage reconciles

### Admit at most three unresolved or non-free attempts for the same key

The route orders Orbio Sonnet, Surplus Sonnet and Surplus Terra. A missing
credential skips its route step. A failed provider advances to its successor.
Only a recognized Surplus spending denial stops the route early as a provider
budget block. Its receipt may still carry unknown or actual usage. Wholly free denial and
completed zero-call reconciliation do not consume a paid slot. An incomplete
attempt occupies a slot and may still produce the first retained result.
Three completed non-free attempts without a retained result are terminal for
this source key. A retained result always wins over terminal classification.
Alerts-only holds no numeric amount. Capped mode requires the explicit
operator cap and route maximum, includes current-month usage and outstanding
reservations, and refuses while any uncapped attempt remains outstanding.
External usage of the same global budget enters admission as trusted amounts.
The budget settings are read from the deployed Worker's environment at
each run, never from a request. That the environment is the reviewed
release's configuration is a deployment obligation of the release
workflow, not something this unit can check.

```quint
pure def hasReservation(a: Attempt): bool = a.stage != Admitted
pure def chargeFree(a: Attempt): bool =
  a.allCalls.length() > 0 and a.allCalls.every(c => c.result == BudgetDenial) and a.usageSaved
pure def counted(v: ValueInference): int = v.occupied.size()
pure def terminal(v: ValueInference): int =
  v.attempts.select(a => a.stage == Completed and a.allCalls.some(c => c.result != BudgetDenial)).length()
pure def chargeTotal(calls: List[Charge], actualOnly: bool): int =
  calls.foldl(0, (sum, c) => sum + (if (c.known) c.actual else if (actualOnly) 0 else c.estimate))
pure def localUsedAt(month: int, v: ValueInference): int =
  v.attempts.foldl(0, (sum, a) => sum + (if (a.month == month and a.usageSaved) chargeTotal(a.allCalls, false) else 0))
pure def heldCap(v: ValueInference): int =
  v.attempts.foldl(0, (sum, a) => sum + (if (a.limited and hasReservation(a) and not(a.reconciled)) a.maximum else 0))
pure def unboundedHold(v: ValueInference): bool =
  v.attempts.some(a => not(a.limited) and hasReservation(a) and not(a.reconciled))
pure def validBudget(mode: Mode, cap: int, maximum: int): bool =
  mode == AlertsOnly or (mode == Capped and cap > 0 and maximum > 0 and maximum <= cap)
pure def configure(v: ValueInference, settings: ReleaseSettings): ValueInference =
  { ...v, config: if (validBudget(settings.mode, settings.cap, settings.maximum)) settings.mode else MissingConfig,
    monthlyCap: settings.cap, maximum: settings.maximum }
pure def lawMalformedSettingsStopInference(v: ValueInference, settings: ReleaseSettings): bool =
  not(validBudget(settings.mode, settings.cap, settings.maximum)) implies configure(v, settings).config == MissingConfig
pure def budgetAllows(v: ValueInference, otherUsed: int, otherHeld: int, otherUnbounded: bool): bool =
  v.config == AlertsOnly or (v.config == Capped and not(otherUnbounded) and not(unboundedHold(v))
    and otherUsed >= 0 and otherHeld >= 0 and localUsedAt(v.month, v) + otherUsed + heldCap(v) + otherHeld + v.maximum <= v.monthlyCap)
pure def admission(v: ValueInference, otherUsed: int, otherHeld: int, otherUnbounded: bool): Decision =
  if (v.retained != noRetained) RetainedResult
  else if (counted(v) >= 3) if (terminal(v) >= 3) AttemptsExhausted else PendingCapacity
  else if (budgetAllows(v, otherUsed, otherHeld, otherUnbounded)) Eligible else BudgetBlocked
pure def canAdmit(v: ValueInference, token: int, attemptId: int): bool =
  checkedCurrent(request(v, token), v) and v.retained == noRetained and v.config != MissingConfig
    and counted(v) < 3 and attemptId > 0 and attempt(v, attemptId).id == 0
pure def admit(v: ValueInference, token: int, attemptId: int): ValueInference =
  { ...v, attempts: v.attempts.append({ ...noAttempt, id: attemptId, token: token, month: v.month }) }
pure def canReserve(v: ValueInference, attemptId: int, otherUsed: int, otherHeld: int, otherUnbounded: bool): bool =
  val a = attempt(v, attemptId)
  a.id > 0 and a.stage == Admitted and checkedCurrent(request(v, a.token), v)
    and admission(v, otherUsed, otherHeld, otherUnbounded) == Eligible
pure def reserve(v: ValueInference, attemptId: int, otherUsed: int, otherHeld: int, otherUnbounded: bool): ValueInference =
  putAttempt({ ...attempt(v, attemptId), stage: HeldBudget, month: v.month,
    limited: v.config == Capped, maximum: if (v.config == Capped) v.maximum else 0 },
    { ...v, occupied: v.occupied.union(Set(attemptId)) })
pure def providerFor(n: int): Provider = if (n == 0) OrbioSonnet else if (n == 1) SurplusSonnet else SurplusTerra
pure def canCall(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == HeldBudget and checkedCurrent(request(v, a.token), v) and v.retained == noRetained
    and a.routeStep < 3
pure def call(v: ValueInference, attemptId: int): ValueInference =
  val a = attempt(v, attemptId)
  putAttempt({ ...a, stage: Calling }, putRequest({ ...request(v, a.token), check: NoCheck }, v))
pure def expectedModel(provider: Provider): str =
  if (provider == SurplusTerra) "gpt-6.1-terra"
  else if (provider == OrbioSonnet) "anthropic/claude-sonnet-5.5" else "claude-sonnet-5.5"
pure def canRecordCall(v: ValueInference, attemptId: int, charge: Charge): bool =
  val a = attempt(v, attemptId)
  a.stage == Calling and charge.provider == providerFor(a.routeStep)
    and charge.actual >= 0 and charge.estimate >= 0 and charge.customerCharge == 0 and (charge.result != ValidResult or
      (charge.output != "" and charge.seenModel == expectedModel(charge.provider) and charge.sizeBand >= 0 and charge.sizeBand <= 5))
    and (charge.result != BudgetDenial or charge.provider != OrbioSonnet)
pure def recordCall(v: ValueInference, attemptId: int, charge: Charge): ValueInference =
  val a = attempt(v, attemptId)
  val routeFinished = charge.result != FailedCall or a.routeStep >= 2
  putAttempt({ ...a, routeStep: a.routeStep + 1, allCalls: a.allCalls.append(charge), stage: if (routeFinished) RouteDone else HeldBudget }, v)
pure def canSkipUnavailable(v: ValueInference, attemptId: int, unavailableProvider: Provider, credentialMissing: bool): bool =
  val a = attempt(v, attemptId)
  a.stage == HeldBudget and a.routeStep < 3 and unavailableProvider == providerFor(a.routeStep) and credentialMissing
pure def skipUnavailable(v: ValueInference, attemptId: int, unavailableProvider: Provider, credentialMissing: bool): ValueInference =
  val a = attempt(v, attemptId)
  putAttempt({ ...a, routeStep: a.routeStep + 1, stage: if (a.routeStep < 2) HeldBudget else RouteDone }, v)
pure def canEndWithoutCall(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == HeldBudget and (not(owns(request(v, a.token), v)) or not(locallyAuthorized(v)) or v.retained != noRetained)
pure def endWithoutCall(v: ValueInference, attemptId: int): ValueInference =
  putAttempt({ ...attempt(v, attemptId), stage: RouteDone }, v)
```

### Usage precedes retained output and explicit completion

Each charged, budget-denied or unknown call remains tied to its attempt. Saved usage
precedes result retention, and the earliest valid retained result wins.
A completed failed result and an unfinished charged attempt remain distinct.
Only all-known actual usage can settle a numeric hold. A provider charge
above the reserved maximum stays unresolved. Unknown costs retain the
estimate for spending and an unresolved reservation. No age-based action
releases a hold. Every call row also enters the global
[cost ledger](./spendAlerts.md), which owns the $500 milestones and provider
failure notices. A provider call interrupted after it started stays in
`Calling` and keeps its slot: no timer releases it and no later call may
reuse the attempt. Neither the PRD nor the development worker defines how
such an attempt is reconciled. A provider receipt service or an operator
decision would each be new policy, so recovery of an interrupted call is
an owner decision; until it is recorded, the attempt stays occupied and
the request stays visible in the
[incomplete-assessment Inbox](./assessmentInbox.md).

```quint
pure def canSaveUsage(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == RouteDone and not(a.usageSaved)
pure def saveUsage(v: ValueInference, attemptId: int): ValueInference =
  val saved = { ...attempt(v, attemptId), usageSaved: true }
  val occupied = if (chargeFree(saved)) v.occupied.exclude(Set(attemptId)) else v.occupied
  putAttempt(saved, { ...v, occupied: occupied })
pure def lastCharge(a: Attempt): Charge =
  a.allCalls.nthOr(a.allCalls.length() - 1, { provider: OrbioSonnet, seenModel: "", result: FailedCall,
    known: false, actual: 0, estimate: 0, output: "", sizeBand: 0, customerCharge: 0 })
pure def canRetain(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == RouteDone and a.usageSaved and lastCharge(a).result == ValidResult and v.retained == noRetained
pure def retain(v: ValueInference, attemptId: int): ValueInference =
  val a = attempt(v, attemptId)
  putAttempt({ ...a, resultStored: true }, { ...v, retained: { attempt: attemptId, key: v.key, result: lastCharge(a).output,
    sizeBand: lastCharge(a).sizeBand } })
pure def canComplete(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == RouteDone and a.usageSaved and (lastCharge(a).result != ValidResult or v.retained != noRetained)
pure def complete(v: ValueInference, attemptId: int): ValueInference =
  putAttempt({ ...attempt(v, attemptId), stage: Completed }, v)
pure def canReconcile(v: ValueInference, attemptId: int): bool =
  val a = attempt(v, attemptId)
  a.stage == Completed and not(a.reconciled) and a.allCalls.every(c => c.known)
    and (not(a.limited) or chargeTotal(a.allCalls, true) <= a.maximum)
pure def reconcile(v: ValueInference, attemptId: int): ValueInference =
  val a = attempt(v, attemptId)
  val occupied = if (a.allCalls.length() == 0) v.occupied.exclude(Set(attemptId)) else v.occupied
  putAttempt({ ...a, reconciled: true }, { ...v, occupied: occupied })
pure def alwaysInterruptedCallKeepsItsSlot(v: ValueInference): bool =
  v.attempts.every(a => (a.stage == HeldBudget or a.stage == Calling) implies v.occupied.contains(a.id))
pure def alwaysCallsAreFree(v: ValueInference): bool =
  v.attempts.every(a => a.allCalls.every(c => c.customerCharge == 0))
pure def alwaysRetainedBandIsValid(v: ValueInference): bool =
  v.retained != noRetained implies v.retained.sizeBand >= 0 and v.retained.sizeBand <= 5
```

## Story: Publish under the current exact authority

### A retained inference survives stale publication without another charge

Capture registry revision, manifest and enforcement generation before
asynchronous collection and recheck. Append only with the same current
registered source and entire owned group, a current final source observation,
and the exact immutable result. A changed authority or expired lease makes
the publication refuse. The original attempt may still retain metering and
result evidence. A later owner reuses that validated result under a fresh
fence. Publication appends one assessment identity and the underlying Points
journal separately verifies it. The published size band, from 0 to 5,
is the input of the Points journal's size points; the Points domain credits
one publication once.

```quint
pure def canCaptureFence(v: ValueInference, token: int): bool =
  owns(request(v, token), v) and locallyAuthorized(v) and v.published == noRetained
pure def captureFence(v: ValueInference, token: int): ValueInference =
  putRequest({ ...request(v, token), fence: v.authority }, v)
pure def canPublish(v: ValueInference, token: int, resultDigest: str): bool =
  val r = request(v, token)
  v.retained != noRetained and resultDigest == v.retained.result and v.retained.key == v.key
    and v.published == noRetained and checkedCurrent(r, v) and r.fence == v.authority
pure def publish(v: ValueInference, token: int, resultDigest: str): ValueInference =
  putRequest({ ...request(v, token), phase: Published }, { ...v, published: v.retained })
pure def stepRetainResult(before: ValueInference, after: ValueInference): bool =
  before.retained != noRetained implies after.retained == before.retained
pure def stepRetainPublication(before: ValueInference, after: ValueInference): bool =
  before.published != noRetained implies after.published == before.published
pure def alwaysPublicationUsesRetained(v: ValueInference): bool = v.published != noRetained implies v.published == v.retained
pure def alwaysAttemptLimit(v: ValueInference): bool = counted(v) <= 3
pure def sometimesHeld(v: ValueInference): bool = counted(v) > 0
pure def sometimesRetained(v: ValueInference): bool = v.retained != noRetained
pure def sometimesPublished(v: ValueInference): bool = v.published != noRetained
pure val sourceOne: Source = { repository: 1, pull: 1, digest: "source-one" }
pure val sourceTwo: Source = { repository: 1, pull: 2, digest: "source-two" }
pure val completeGroup = List(sourceOne, sourceTwo)
pure val groupValues = Set(completeGroup)
pure val sourcesValues = Set(completeGroup, List(sourceOne))
pure val membersValues = sourcesValues
pure val keyValues = Set("inference")
pure val inputDigestValues = keyValues
pure val observedSourceValues = Set("inference", "drift")
pure val authorityValues = Set(reviewedAuthority, { ...reviewedAuthority, revision: 2, manifest: "manifest-two" },
  { ...reviewedAuthority, generation: 2, active: false })
pure val deadlineValues = Set(1, 2, 4)
pure val tokenValues = Set(1, 2)
pure val attemptIdValues = Set(1, 2, 3, 4)
pure val nowValues = Set(0, 1, 2, 3)
pure val monthValues = Set(1, 2)
pure val capValues = Set(0, 5)
pure val maximumValues = Set(0, 2)
pure val otherUsedValues = Set(0, 2)
pure val otherHeldValues = Set(0, 2)
pure val settingsValues = Set({ mode: AlertsOnly, cap: 0, maximum: 0 },
  { mode: Capped, cap: 5, maximum: 2 }, { mode: Capped, cap: 0, maximum: 2 })
pure val resultDigestValues = Set("result")
pure val sampleCharge: Charge = { provider: OrbioSonnet, seenModel: "anthropic/claude-sonnet-5.5", result: ValidResult,
  known: true, actual: 1, estimate: 1, output: "result", sizeBand: 2, customerCharge: 0 }
pure val chargeValues = Set(sampleCharge, { ...sampleCharge, result: FailedCall, known: false },
  { ...sampleCharge, provider: SurplusSonnet, seenModel: "claude-sonnet-5.5", result: BudgetDenial, actual: 0, estimate: 0 },
  { ...sampleCharge, provider: SurplusSonnet, seenModel: "claude-sonnet-5.5" })
pure val weight_setSource = 3
pure val weight_claim = 3
pure val weight_ownGroup = 4
pure val weight_beginCheck = 4
pure val weight_remoteReply = 4
pure val weight_finishCheck = 5
pure val weight_admit = 4
pure val weight_reserve = 4
pure val weight_call = 4
pure val weight_recordCall = 4
pure val weight_saveUsage = 4
pure val weight_retain = 5
pure val weight_publish = 4
pure val weight_captureFence = 4
pure val weight_configure = 3
```
