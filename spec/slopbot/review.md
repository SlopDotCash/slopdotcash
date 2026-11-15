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

The routing decision must allow review. The shell also binds the exact
source revision and the approved base-branch rules, and runs untrusted
code only in approved isolation without secrets or posting credentials.
A routing decision that does not review records a skipped review, which
GitHub's next event for the item can reconsider. It is never left queued.

```quint
import routing as R from "./routing"
type Provider = OrbioSonnet | SurplusSonnet | SurplusTerra
type CallKind = Triage | Confirm
type CallOutcome = CallOk | CallFailed | CallBudgetDenied
type ReviewStatus = Queued | Skipped | InFlight | Answered | BudgetBlocked | RetryableFailure | Limited | Complete
type RetryCause = QueueRedelivery | NewEvent | BudgetResume | OperatorRequeue
type CallRecord = { kind: CallKind, provider: Provider, outcome: CallOutcome, servedModel: str, known: bool,
  amount: int, customerCharge: int }
type Coverage = { full: bool, unreviewed: int }
type Review = { status: ReviewStatus, bound: bool, kind: CallKind, provider: Provider, calls: List[CallRecord],
  attempts: int, unreviewed: int, finding: bool, confirmed: bool, now: int, retryAt: int }
pure val initial: Review = { status: Queued, bound: false, kind: Triage, provider: OrbioSonnet, calls: List(),
  attempts: 0, unreviewed: 0, finding: false, confirmed: false, now: 1, retryAt: 0 }
pure def canBindSource(r: Review, route: R::Route, isolated: bool, sourceBound: bool): bool =
  r.status == Queued and not(r.bound)
pure def bindSource(r: Review, route: R::Route, isolated: bool, sourceBound: bool): Review =
  if (R::reviews(route) and isolated and sourceBound) { ...r, bound: true } else { ...r, status: Skipped }
pure def canStart(r: Review): bool = r.status == Queued and r.bound
pure def start(r: Review): Review =
  { ...r, status: InFlight, kind: Triage, provider: OrbioSonnet, attempts: r.attempts + 1, finding: false,
    confirmed: false, unreviewed: 0 }
pure def canElapse(r: Review, seconds: int): bool = seconds > 0
pure def elapse(r: Review, seconds: int): Review = { ...r, now: r.now + seconds }
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
step requested.

```quint
pure val noCall: CallRecord = { kind: Triage, provider: OrbioSonnet, outcome: CallFailed, servedModel: "",
  known: false, amount: 0, customerCharge: 0 }
pure def expectedModel(provider: Provider): str =
  if (provider == SurplusTerra) "gpt-6.1-terra"
  else if (provider == OrbioSonnet) "anthropic/claude-sonnet-5.5" else "claude-sonnet-5.5"
pure def nextProvider(p: Provider): Provider = if (p == OrbioSonnet) SurplusSonnet else SurplusTerra
pure def canSkipMissingCredential(r: Review): bool = r.status == InFlight
pure def skipMissingCredential(r: Review): Review =
  if (r.provider == SurplusTerra) { ...r, status: RetryableFailure } else { ...r, provider: nextProvider(r.provider) }
pure def canRecordCall(r: Review, call: CallRecord, resetAt: int): bool =
  r.status == InFlight and call.kind == r.kind and call.provider == r.provider and call.customerCharge == 0
    and call.amount >= 0 and (call.outcome != CallOk or call.servedModel == expectedModel(call.provider))
pure def recordCall(r: Review, call: CallRecord, resetAt: int): Review =
  val calls = r.calls.append(call)
  val denied = call.outcome == CallBudgetDenied and call.provider != OrbioSonnet
  if (call.outcome == CallOk) { ...r, calls: calls, status: Answered }
  else if (denied and resetAt > r.now) { ...r, calls: calls, status: BudgetBlocked, retryAt: resetAt }
  else if (r.provider == SurplusTerra) { ...r, calls: calls, status: RetryableFailure }
  else { ...r, calls: calls, provider: nextProvider(r.provider) }
```

### A possible closure needs a confirming second call, and limited coverage stays advisory

A triage answer with a finding that could close starts a separate
confirmation route from Orbio. A limited answer cannot label, close,
penalize or claim full verification, and it names the content it did not
review. Missing binary or large patches, the text budget and the 300-file
comparison limit produce a limited result from a successful call. They
never become a failed attempt, so they cannot exhaust retries. A full
answer with no finding is a no-findings outcome, distinct from limited
coverage and from a provider failure.

```quint
pure def canStartConfirm(r: Review): bool = r.status == Answered and r.kind == Triage and r.finding
pure def startConfirm(r: Review): Review = { ...r, status: InFlight, kind: Confirm, provider: OrbioSonnet }
pure def canNoteFinding(r: Review, finding: bool): bool = r.status == Answered and r.kind == Triage and not(r.finding)
pure def noteFinding(r: Review, finding: bool): Review = { ...r, finding: finding }
pure def canFinish(r: Review, coverage: Coverage): bool =
  r.status == Answered and coverage.unreviewed >= 0 and (coverage.full iff coverage.unreviewed == 0)
pure def finish(r: Review, coverage: Coverage): Review =
  { ...r, status: if (coverage.full) Complete else Limited, unreviewed: coverage.unreviewed,
    confirmed: r.kind == Confirm }
pure def mayEnforce(r: Review): bool = r.status == Complete and r.unreviewed == 0 and r.finding and r.confirmed
pure def alwaysLimitedNamesUnreviewedContent(r: Review): bool =
  (r.status == Limited implies r.unreviewed > 0) and (r.status == Complete implies r.unreviewed == 0)
pure def alwaysOutcomeFollowsAValidAnswer(r: Review): bool =
  (r.status == Answered or r.status == Limited or r.status == Complete) implies
    (r.calls.length() > 0 and r.calls.nthOr(r.calls.length() - 1, noCall).outcome == CallOk)
pure def alwaysConfirmedNeedsConfirmCall(r: Review): bool =
  r.confirmed implies r.calls.some(c => c.kind == Confirm and c.outcome == CallOk) and r.finding
pure def alwaysEnforcementNeedsFullConfirmedReview(r: Review): bool =
  mayEnforce(r) implies r.calls.some(c => c.kind == Triage and c.outcome == CallOk)
    and r.calls.some(c => c.kind == Confirm and c.outcome == CallOk)
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
    or r.status == BudgetBlocked or r.status == RetryableFailure) implies (r.bound and r.attempts > 0)
pure def alwaysSkippedNeverCalls(r: Review): bool = r.status == Skipped implies (not(r.bound) and r.calls.length() == 0)
pure def stepCallsAreAppendOnly(before: Review, after: Review): bool =
  before.calls.every(c => after.calls.includes(c)) and after.calls.length() >= before.calls.length()
    and after.attempts >= before.attempts
```

### A failed or blocked review restarts only from a recorded cause

A retryable failure restarts on a queue redelivery, a later GitHub event
for the item or an administrator's requeue of a dead letter. A budget block
restarts only through its own resume after the reset time. A restart
begins again at Orbio and keeps every earlier call row. Limited and
complete reviews are final for their revision and policy.

```quint
pure def canRetry(r: Review, cause: RetryCause): bool =
  (r.status == RetryableFailure and cause != BudgetResume)
    or (r.status == BudgetBlocked and cause == BudgetResume and r.now >= r.retryAt)
pure def retry(r: Review, cause: RetryCause): Review =
  { ...r, status: Queued, provider: OrbioSonnet, kind: Triage, retryAt: 0, finding: false, confirmed: false }
pure def sometimesComplete(r: Review): bool = r.status == Complete and not(r.finding)
pure def sometimesEnforceable(r: Review): bool = mayEnforce(r)
pure def sometimesLimited(r: Review): bool = r.status == Limited
pure def sometimesSkipped(r: Review): bool = r.status == Skipped
pure def sometimesBackup(r: Review): bool = r.provider == SurplusSonnet and r.status == InFlight
pure def sometimesProviderFailure(r: Review): bool = r.status == RetryableFailure
pure def sometimesBudgetBlocked(r: Review): bool = r.status == BudgetBlocked
pure def sometimesRetriedAfterBlock(r: Review): bool = r.status == Complete and r.calls.some(c => c.outcome == CallBudgetDenied)
```

### Simulation samples exercise each call outcome and coverage

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val okOrbio: CallRecord = { kind: Triage, provider: OrbioSonnet, outcome: CallOk,
  servedModel: "anthropic/claude-sonnet-5.5", known: true, amount: 3, customerCharge: 0 }
pure val callValues = Set(okOrbio, { ...okOrbio, outcome: CallFailed, servedModel: "", known: false, amount: 0 },
  { ...okOrbio, outcome: CallBudgetDenied, servedModel: "", amount: 0 },
  { ...okOrbio, provider: SurplusSonnet, servedModel: "claude-sonnet-5.5" },
  { ...okOrbio, provider: SurplusSonnet, outcome: CallBudgetDenied, servedModel: "", amount: 0 },
  { ...okOrbio, provider: SurplusSonnet, outcome: CallFailed, servedModel: "" },
  { ...okOrbio, provider: SurplusTerra, servedModel: "gpt-6.1-terra" },
  { ...okOrbio, provider: SurplusTerra, outcome: CallFailed, servedModel: "" },
  { ...okOrbio, kind: Confirm }, { ...okOrbio, kind: Confirm, provider: SurplusSonnet, servedModel: "claude-sonnet-5.5" },
  { ...okOrbio, kind: Confirm, outcome: CallFailed, servedModel: "" })
pure val coverageValues = Set({ full: true, unreviewed: 0 }, { full: false, unreviewed: 2 })
pure val routeValues = Set(R::MayCloseReview, R::AdvisoryReview, R::SkipDraft)
pure val resetAtValues = Set(0, 50)
pure val secondsValues = Set(10, 60)
pure val weight_recordCall = 6
pure val weight_start = 3
```
