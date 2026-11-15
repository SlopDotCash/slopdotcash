# Review attempts and provider recovery

PRD section 5 selects Orbio Claude Sonnet 5.5, then Surplus Claude Sonnet 5.5,
then Surplus GPT-6.1 Terra. Every Orbio failure, including exhausted credits,
goes directly to Surplus. Exact attribution and known or unknown actual cost
remain in the journal. Slopbot is free and never charges a project vault.
PRD section 5 also requires no-findings, limited-coverage and
retryable-failure outcomes, identified unreviewed content, and evidence
that cannot silently exhaust attempts. Source is `workers/slopbot/review.ts`
(`reviewItem`, `runReview`, `callModel`), `workers/slopbot/models.ts` and
`workers/slopbot/persistence.ts` (`recordCalls`) at the pinned development
revision.

This unit owns one review attempt's route through the providers and its
outcome. [Routing](./routing.md) decides whether the item is reviewed.
[Review claims](./reviewLease.md) own the claim token and expiry.
[Budget blocks](./budgetBlocks.md) own a block's resume, and the
[job queue](./jobQueue.md) owns redelivery. Every call row also enters the
global [cost ledger](./spendAlerts.md).

## Story: Review registered work and preserve incomplete outcomes

### A routed item is reviewed only with isolation and an exact bound source

The routing decision must allow review. The worker fetches the source at
the revision the job names and binds it only when the fetched revision is
that one. Untrusted code runs only in the approved isolation without
secrets or posting credentials. The fetch and the isolation are shell
operations whose results are compared here. A routing decision that does
not review, a changed revision or a missing isolation records a skipped
review, which GitHub's next event for the item can reconsider. It is never
left queued. The bound scope is the one the routing decision derived.

```quint
import routing as R from "./routing"
import repositoryScope as RS from "./repositoryScope"
type Provider = OrbioSonnet | SurplusSonnet | SurplusTerra
type CallKind = Triage | Confirm
type CallOutcome = CallOk | CallFailed | CallBudgetDenied
type Category = NoFinding | Spam | Scam | LowQuality | OtherFinding
type Isolation = ApprovedIsolation | NoIsolation
type ReviewStatus = Queued | Skipped | InFlight | Answered | BudgetBlocked | RetryableFailure | Limited | Complete
type Verdict = { category: Category, confidence: int, limitations: int, grounded: bool }
type CallRecord = { kind: CallKind, provider: Provider, outcome: CallOutcome, servedModel: str, known: bool,
  amount: int, customerCharge: int, verdict: Verdict }
type SourceBinding = { requested: str, fetched: str, isolation: Isolation }
type Review = { status: ReviewStatus, bound: bool, scope: RS::Scope, kind: CallKind, provider: Provider,
  calls: List[CallRecord], attempts: int, unreviewed: int, rechecked: bool, triage: Verdict, second: Verdict,
  confirmed: bool, uncertain: bool, now: int, retryAt: int }
pure val closeConfidence = 90
pure val noVerdict: Verdict = { category: NoFinding, confidence: 0, limitations: 0, grounded: false }
pure val initial: Review = { status: Queued, bound: false, scope: RS::Unregistered, kind: Triage, provider: OrbioSonnet,
  calls: List(), attempts: 0, unreviewed: 0, rechecked: false, triage: noVerdict, second: noVerdict,
  confirmed: false, uncertain: false, now: 1, retryAt: 0 }
pure def routeScope(route: R::Route): RS::Scope = if (route == R::SecurityReviewOnly) RS::SecurityOnly else RS::Contributor
pure def canBindSource(r: Review, route: R::Route, source: SourceBinding): bool = r.status == Queued and not(r.bound)
pure def bindSource(r: Review, route: R::Route, source: SourceBinding): Review =
  if (R::reviews(route) and source.requested != "" and source.fetched == source.requested
    and source.isolation == ApprovedIsolation) { ...r, bound: true, scope: routeScope(route) }
  else { ...r, status: Skipped }
pure def canStart(r: Review): bool = r.status == Queued and r.bound
pure def start(r: Review): Review =
  { ...r, status: InFlight, kind: Triage, provider: OrbioSonnet, attempts: r.attempts + 1, triage: noVerdict,
    second: noVerdict, confirmed: false, uncertain: false, unreviewed: 0, rechecked: false }
pure def canElapse(r: Review, seconds: int): bool = seconds > 0
pure def elapse(r: Review, seconds: int): Review = { ...r, now: r.now + seconds }
```

### Each provider step first rechecks the live registry

Before each step of a route, including the first, the worker reads the live
project registry. A step runs only while the derived scope is still the one
the review was bound under. Otherwise no call is made, the calls already
made are recorded, and the job fails so that the queue retries it. A
registry read that fails behaves the same way.

```quint
pure def canRecheckRegistry(r: Review, registry: RS::RegistryObservation): bool = r.status == InFlight and not(r.rechecked)
pure def recheckRegistry(r: Review, registry: RS::RegistryObservation): Review =
  if (RS::slopbotScope(registry) == r.scope) { ...r, rechecked: true } else { ...r, status: RetryableFailure }
pure def lawChangedScopeStopsTheRoute(r: Review, registry: RS::RegistryObservation): bool =
  (canRecheckRegistry(r, registry) and RS::slopbotScope(registry) != r.scope)
    implies recheckRegistry(r, registry).status == RetryableFailure
```

### Each call is recorded free, and only a Surplus spending denial blocks the route

The call row is written with the call kind, route step, provider, the
model GitHub-visible attribution requires, the served model, the internal
cost and a zero customer charge. A provider-reported amount is known. A
missing or fractional receipt keeps the cost unknown, and an unknown cost
never becomes zero. A missing provider key skips that step without a call
row. A failed call goes to the next step. Exhausting the route is a
retryable failure that the queue redelivers. A Surplus spending denial
blocks the review until its reset. An Orbio denial is an ordinary Orbio
failure and goes to Surplus. A valid answer must come from the model the
step requested. Its validated verdict, with the worker's grounding check
against the bound source and the published rule, is kept with the call.

```quint
pure val noCall: CallRecord = { kind: Triage, provider: OrbioSonnet, outcome: CallFailed, servedModel: "",
  known: false, amount: 0, customerCharge: 0, verdict: noVerdict }
pure def expectedModel(provider: Provider): str =
  if (provider == SurplusTerra) "gpt-6.1-terra"
  else if (provider == OrbioSonnet) "anthropic/claude-sonnet-5.5" else "claude-sonnet-5.5"
pure def nextProvider(p: Provider): Provider = if (p == OrbioSonnet) SurplusSonnet else SurplusTerra
pure def validVerdict(v: Verdict): bool = v.confidence >= 0 and v.confidence <= 100 and v.limitations >= 0
pure def canSkipMissingCredential(r: Review): bool = r.status == InFlight and r.rechecked
pure def skipMissingCredential(r: Review): Review =
  if (r.provider == SurplusTerra) { ...r, status: RetryableFailure, rechecked: false }
  else { ...r, provider: nextProvider(r.provider), rechecked: false }
pure def canRecordCall(r: Review, call: CallRecord, resetAt: int): bool =
  r.status == InFlight and r.rechecked and call.kind == r.kind and call.provider == r.provider
    and call.customerCharge == 0 and call.amount >= 0 and validVerdict(call.verdict)
    and (call.outcome != CallOk or call.servedModel == expectedModel(call.provider))
    and (call.outcome == CallOk or call.verdict == noVerdict)
pure def recordCall(r: Review, call: CallRecord, resetAt: int): Review =
  val calls = r.calls.append(call)
  val denied = call.outcome == CallBudgetDenied and call.provider != OrbioSonnet
  val after = { ...r, calls: calls, rechecked: false }
  if (call.outcome == CallOk)
    (if (call.kind == Triage) { ...after, status: Answered, triage: call.verdict }
     else { ...after, status: Answered, second: call.verdict })
  else if (denied and resetAt > r.now) { ...after, status: BudgetBlocked, retryAt: resetAt }
  else if (r.provider == SurplusTerra) { ...after, status: RetryableFailure }
  else { ...after, provider: nextProvider(r.provider) }
pure def stepEveryCallFollowsARecheck(before: Review, after: Review): bool =
  after.calls.length() > before.calls.length() implies before.rechecked
```

### A closure needs a second, agreeing review, and limited coverage stays advisory

A triage answer with a finding starts a separate confirmation route from
Orbio. The review is confirmed only when both verdicts name the same
finding, each has confidence of at least 90, neither reports a limitation
and both are grounded. A confirmation that disagrees, is unsure or is
ungrounded leaves the review uncertain: it goes to the maintainer first and
can never close. For a low-quality finding the closure composition also
requires the same objective defect and trusted verification of it. A
limited answer cannot label, close, penalize or claim full verification,
and it names the content it did not review. Missing binary or large
patches, the text budget and the 300-file comparison limit produce a
limited result from a successful call. They never become a failed attempt,
so they cannot exhaust retries. A full answer with no finding is a
no-findings outcome, distinct from limited coverage and from a provider
failure.

```quint
pure def hasFinding(r: Review): bool = r.triage.category != NoFinding
pure def agrees(first: Verdict, second: Verdict): bool =
  first.category != NoFinding and first.category == second.category
    and first.confidence >= closeConfidence and second.confidence >= closeConfidence
    and first.limitations == 0 and second.limitations == 0 and first.grounded and second.grounded
pure def canStartConfirm(r: Review): bool = r.status == Answered and r.kind == Triage and hasFinding(r)
pure def startConfirm(r: Review): Review = { ...r, status: InFlight, kind: Confirm, provider: OrbioSonnet, rechecked: false }
pure def canFinish(r: Review, unreviewed: int): bool = r.status == Answered and unreviewed >= 0
pure def finish(r: Review, unreviewed: int): Review =
  val confirmed = r.kind == Confirm and agrees(r.triage, r.second)
  { ...r, status: if (unreviewed == 0) Complete else Limited, unreviewed: unreviewed, confirmed: confirmed,
    uncertain: r.kind == Confirm and not(confirmed) }
pure def mayEnforce(r: Review): bool = r.status == Complete and r.unreviewed == 0 and hasFinding(r) and r.confirmed
pure def lawDisagreeingConfirmNeverEnforces(r: Review, unreviewed: int): bool =
  (canFinish(r, unreviewed) and not(agrees(r.triage, r.second))) implies not(mayEnforce(finish(r, unreviewed)))
pure def lawLimitedNeverEnforces(r: Review, unreviewed: int): bool =
  (canFinish(r, unreviewed) and unreviewed > 0) implies not(mayEnforce(finish(r, unreviewed)))
pure def alwaysLimitedNamesUnreviewedContent(r: Review): bool =
  (r.status == Limited implies r.unreviewed > 0) and (r.status == Complete implies r.unreviewed == 0)
pure def alwaysOutcomeFollowsAValidAnswer(r: Review): bool =
  (r.status == Answered or r.status == Limited or r.status == Complete) implies
    (r.calls.length() > 0 and r.calls.nthOr(r.calls.length() - 1, noCall).outcome == CallOk)
pure def alwaysConfirmedMeansAgreement(r: Review): bool =
  r.confirmed implies (agrees(r.triage, r.second) and r.kind == Confirm
    and r.calls.some(c => c.kind == Confirm and c.outcome == CallOk and c.verdict == r.second)
    and r.calls.some(c => c.kind == Triage and c.outcome == CallOk and c.verdict == r.triage))
pure def alwaysUncertainNeverEnforces(r: Review): bool = r.uncertain implies not(mayEnforce(r)) and not(r.confirmed)
```

### Every call is free, attributed and accounted

```quint
pure def alwaysFreeAndAttributed(r: Review): bool =
  r.calls.every(c => c.customerCharge == 0 and c.amount >= 0
    and (c.outcome == CallOk implies c.servedModel == expectedModel(c.provider)))
pure def alwaysOnlySurplusBlocks(r: Review): bool =
  r.status == BudgetBlocked implies (r.retryAt > 0 and r.calls.some(c => c.outcome == CallBudgetDenied and c.provider != OrbioSonnet))
pure def alwaysAdmittedReview(r: Review): bool =
  (r.status == InFlight or r.status == Answered or r.status == Limited or r.status == Complete
    or r.status == BudgetBlocked or r.status == RetryableFailure) implies (r.bound and r.attempts > 0
      and r.scope != RS::Unregistered)
pure def alwaysSkippedNeverCalls(r: Review): bool = r.status == Skipped implies (not(r.bound) and r.calls.length() == 0)
pure def stepCallsAreAppendOnly(before: Review, after: Review): bool =
  before.calls.every(c => after.calls.includes(c)) and after.calls.length() >= before.calls.length()
    and after.attempts >= before.attempts
```

### A failed review restarts on a new delivery, and a blocked one only after its reset

A retryable failure restarts when any job for the item is delivered again:
a queue retry, a duplicate copy, or GitHub's next event for the item. The
[job queue](./jobQueue.md), the webhook and the
[budget block resume](./budgetBlocks.md) own those deliveries; this unit
only decides whether a delivery may restart the review. While a budget
block's reset time has not come, every delivery is refused without a
claim. After the reset any delivery may restart it, and the block's resume
is the delivery that does so when GitHub sends nothing. A restart begins
again at Orbio and keeps every earlier call row. Limited and complete
reviews are final for their revision and policy. A dead-lettered job has no
recovery route yet: the review stays a visible retryable failure until
GitHub's next event.

```quint
pure def canRetry(r: Review): bool =
  r.status == RetryableFailure or (r.status == BudgetBlocked and r.now >= r.retryAt)
pure def retry(r: Review): Review =
  { ...r, status: Queued, provider: OrbioSonnet, kind: Triage, retryAt: 0, rechecked: false }
pure def stepBlockWaitsForReset(before: Review, after: Review): bool =
  (before.status == BudgetBlocked and after.status != BudgetBlocked) implies before.now >= before.retryAt
pure def sometimesComplete(r: Review): bool = r.status == Complete and not(hasFinding(r))
pure def sometimesEnforceable(r: Review): bool = mayEnforce(r)
pure def sometimesUncertain(r: Review): bool = r.status == Complete and r.uncertain and hasFinding(r)
pure def sometimesLimited(r: Review): bool = r.status == Limited
pure def sometimesSkipped(r: Review): bool = r.status == Skipped
pure def sometimesBackup(r: Review): bool = r.provider == SurplusSonnet and r.status == InFlight
pure def sometimesProviderFailure(r: Review): bool = r.status == RetryableFailure and r.calls.length() > 0
pure def sometimesRegistryStopped(r: Review): bool = r.status == RetryableFailure and r.calls.length() == 0
pure def sometimesBudgetBlocked(r: Review): bool = r.status == BudgetBlocked
pure def sometimesRetriedAfterBlock(r: Review): bool = r.status == Complete and r.calls.some(c => c.outcome == CallBudgetDenied)
```

### Simulation samples exercise each call outcome, verdict and coverage

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val sure: Verdict = { category: Spam, confidence: 95, limitations: 0, grounded: true }
pure val okOrbio: CallRecord = { kind: Triage, provider: OrbioSonnet, outcome: CallOk,
  servedModel: "anthropic/claude-sonnet-5.5", known: true, amount: 3, customerCharge: 0, verdict: sure }
pure val failed: CallRecord = { ...okOrbio, outcome: CallFailed, servedModel: "", known: false, amount: 0, verdict: noVerdict }
pure val callValues = Set(okOrbio, { ...okOrbio, verdict: noVerdict }, failed,
  { ...failed, outcome: CallBudgetDenied },
  { ...okOrbio, provider: SurplusSonnet, servedModel: "claude-sonnet-5.5" },
  { ...failed, provider: SurplusSonnet, outcome: CallBudgetDenied }, { ...failed, provider: SurplusSonnet },
  { ...okOrbio, provider: SurplusTerra, servedModel: "gpt-6.1-terra" }, { ...failed, provider: SurplusTerra },
  { ...okOrbio, kind: Confirm }, { ...okOrbio, kind: Confirm, verdict: { ...sure, confidence: 60 } },
  { ...okOrbio, kind: Confirm, verdict: { ...sure, category: Scam } },
  { ...okOrbio, kind: Confirm, provider: SurplusSonnet, servedModel: "claude-sonnet-5.5" },
  { ...failed, kind: Confirm })
pure val unreviewedValues = Set(0, 2)
pure val activeRegistry: RS::RegistryObservation = { lookup: RS::CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged }
pure val registryValues = Set(activeRegistry, { ...activeRegistry, flags: RS::Flagged })
pure val sourceValues = Set({ requested: "r1", fetched: "r1", isolation: ApprovedIsolation },
  { requested: "r1", fetched: "r2", isolation: ApprovedIsolation }, { requested: "r1", fetched: "r1", isolation: NoIsolation })
pure val routeValues = Set(R::MayCloseReview, R::AdvisoryReview, R::SkipDraft)
pure val resetAtValues = Set(0, 50)
pure val secondsValues = Set(10, 60)
pure val weight_recordCall = 6
pure val weight_recheckRegistry = 6
pure val weight_start = 3
```
