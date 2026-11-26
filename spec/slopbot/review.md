# Review attempts and provider recovery

PRD section 5 (operator decision of 16 November 2026, replacing the
Orbio-first order of 11 November) selects Surplus Claude Sonnet 5.5, then
Surplus GPT-6.1 Terra, then Orbio Claude Sonnet 5.5 as the backstop. A
Surplus spending denial skips the remaining Surplus model and goes directly
to Orbio; the review waits for the Surplus reset only when Orbio does not
serve. Every Orbio failure, including exhausted credits, is an ordinary
failure. Free advisory reviews are capped per repository and UTC month
([monthly cap](./reviewCap.md)). Exact attribution and known or unknown actual cost
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
import reviewCap as C from "./reviewCap"
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
  confirmed: bool, uncertain: bool, now: int, retryAt: int, capAdmitted: bool, blocks: int }
pure val closeConfidence = 90
pure val noVerdict: Verdict = { category: NoFinding, confidence: 0, limitations: 0, grounded: false }
pure val initial: Review = { status: Queued, bound: false, scope: RS::Unregistered, kind: Triage, provider: SurplusSonnet,
  calls: List(), attempts: 0, unreviewed: 0, rechecked: false, triage: noVerdict, second: noVerdict,
  confirmed: false, uncertain: false, now: 1, retryAt: 0, capAdmitted: false, blocks: 0 }
pure def routeScope(route: R::Route): RS::Scope = if (route == R::SecurityReviewOnly) RS::SecurityOnly else RS::Contributor
pure def canBindSource(r: Review, route: R::Route, source: SourceBinding): bool = r.status == Queued and not(r.bound)
pure def bindSource(r: Review, route: R::Route, source: SourceBinding): Review =
  if (R::reviews(route) and source.requested != "" and source.fetched == source.requested
    and source.isolation == ApprovedIsolation) { ...r, bound: true, scope: routeScope(route), capAdmitted: false }
  else { ...r, status: Skipped, capAdmitted: false }
pure def canStart(r: Review): bool = r.status == Queued and r.bound and r.capAdmitted
pure def start(r: Review): Review =
  { ...r, status: InFlight, kind: Triage, provider: SurplusSonnet, attempts: r.attempts + 1, triage: noVerdict,
    second: noVerdict, confirmed: false, uncertain: false, unreviewed: 0, rechecked: false }
pure def canElapse(r: Review, seconds: int): bool = seconds > 0
pure def elapse(r: Review, seconds: int): Review = { ...r, now: r.now + seconds }
```

### A bound review of a paused project's new outside pull request, or one whose submission fee is unpaid, is skipped before the monthly cap

Source `runReview` in `review.ts`, lines 1488-1575, and `intake-cap.ts`
(development `e126f2419`, #2986; `8008b4617`, #3058). For a pull request in
contributor scope the checks after binding run in this order: an exempt
author's standing unpaid fee ask is released first
([submission fee gate](./submissionFeeGate.md)); a routing decision that
does not review is the skip of the rule above; a pull request of a
not-exempt author that Slopbot has not completed a review of is skipped with
the reason `intake-cap` while the project is paused at its intake cap (the
pause is [backend's intake cap](../backend/intakeCap.md), read as a fact);
a pull request whose fee gate waits (`feeStep` asks or waits) is skipped with
the reason `fee-needed`; only then comes the monthly cap below. Each skip
makes no model call, writes no review label, comment or close and uses no
monthly admission. A later delivery reviews the pull request once the pause
ends or the fee is paid or released. A failure of the fee step is not a
review attempt: the attempt's row is finished failed with no
review-failure comment, and the queue's retry runs the review again.

```quint
pure def canSkipForIntake(r: Review, paused: bool, outsidePull: bool, reviewedBefore: bool): bool =
  r.status == Queued and r.bound and not(r.capAdmitted) and r.scope == RS::Contributor and
  outsidePull and paused and not(reviewedBefore)
pure def skipForIntake(r: Review, paused: bool, outsidePull: bool, reviewedBefore: bool): Review =
  { ...r, status: Skipped, bound: false, capAdmitted: false }
pure def canSkipForFee(r: Review, feeWaits: bool): bool =
  r.status == Queued and r.bound and not(r.capAdmitted) and r.scope == RS::Contributor and feeWaits
pure def skipForFee(r: Review, feeWaits: bool): Review = { ...r, status: Skipped, bound: false, capAdmitted: false }
pure def stepIntakeAndFeeSkipBeforeAdmission(before: Review, via: str, after: Review): bool =
  (via == "skipForIntake" or via == "skipForFee") implies
    (not(before.capAdmitted) and before.scope == RS::Contributor and after.calls == before.calls)
pure def sometimesSkippedBeforeAdmissionWithoutCalls(r: Review): bool =
  r.status == Skipped and r.scope == RS::Contributor and r.calls.length() == 0
```

### A bound review of a new item over the month's free-review cap is skipped before any call

The worker admits the item to the repository's month
([monthly cap](./reviewCap.md)) after binding and before `start`, on every
run of the review, a restart included: before the deterministic
pre-filter, any model call or any GitHub write. Admission is part of the
review's state: binding, a restart and a refusal clear it, and a review
starts, and so calls a model, only once admitted in this run, as
development's own model requires (`reviews > 0 implies admittedItem`). An
item already admitted that month is always admitted again and starts
normally, and a review admitted in this run is never refused in it. A new
item that meets a full month finishes skipped with the
reason `monthly-review-cap`, with no call in this run. Development refuses a
restarted review the same way, even one whose earlier attempt already made
calls (`runReview` in `review.ts`, lines 1434-1446, admits before every run),
when the restart lands in a new, full month: that review finishes skipped and
keeps the calls of its earlier, admitted attempts.

```quint
pure def canAdmitMonthly(r: Review, alreadyAdmitted: bool, usedThisMonth: int): bool =
  r.status == Queued and r.bound and usedThisMonth >= 0 and C::admitsReview(alreadyAdmitted, usedThisMonth)
pure def admitMonthly(r: Review, alreadyAdmitted: bool, usedThisMonth: int): Review = { ...r, capAdmitted: true }
pure def canRefuseMonthlyCap(r: Review, alreadyAdmitted: bool, usedThisMonth: int): bool =
  r.status == Queued and r.bound and not(r.capAdmitted) and usedThisMonth >= 0
    and not(C::admitsReview(alreadyAdmitted, usedThisMonth))
pure def refuseMonthlyCap(r: Review, alreadyAdmitted: bool, usedThisMonth: int): Review =
  { ...r, status: Skipped, bound: false, capAdmitted: false }
pure def lawAdmittedItemIsNeverRefused(r: Review, usedThisMonth: int): bool =
  not(canRefuseMonthlyCap(r, true, usedThisMonth))
pure def stepAdmittedReviewIsNeverRefused(before: Review, via: str, after: Review): bool =
  via == "refuseMonthlyCap" implies not(before.capAdmitted)
pure def alwaysCallsNeedAdmission(r: Review): bool =
  (r.status == InFlight or r.status == Answered or r.status == Limited or r.status == Complete
    or r.status == BudgetBlocked or r.status == RetryableFailure) implies r.capAdmitted
pure def sometimesMonthlyCapSkipped(r: Review): bool = r.status == Skipped and r.scope != RS::Unregistered
pure def sometimesRestartSkippedByMonthlyCap(r: Review): bool = r.status == Skipped and r.calls.length() > 0
pure val usedThisMonthValues = Set(0, 1999, 2000)
```

### Each provider step first rechecks the live registry

Before each step of a route, including the first, the worker reads the live
project registry. A step whose provider has no key is skipped before that
read (`runStructuredRoute` in `models.ts`, lines 143-147), so it never
reaches the registry or a call. A step runs only while the derived scope is still the one
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
never becomes zero. The route is Surplus Sonnet, Surplus Terra, then
Orbio Sonnet. A missing Surplus key skips both Surplus steps, and a
missing Orbio key skips Orbio, without a call row and before the step's
registry recheck. A failed call goes to
the next step. A structured Surplus spending denial is recorded as a call
that served nothing; it skips the remaining Surplus step, which shares the
denied budget, and asks Orbio in the same attempt, and the review
remembers its reset (`retryAt`) while it waits for Orbio. A Surplus answer
is a spending denial only with a valid reset time; any valid reset is
remembered, one already past included, and a later denial's reset replaces
an earlier one. A valid Orbio
answer is used normally and leaves no block. When Orbio fails or has no
key, a remembered reset blocks the review until that reset, and without
one the exhausted route is a retryable failure that the queue redelivers.
An Orbio failure, including an Orbio denial, is never a spending denial. A
valid answer must come from the model the
step requested. Its validated verdict, with the worker's grounding check
against the bound source and the published rule, is kept with the call.

```quint
pure val noCall: CallRecord = { kind: Triage, provider: OrbioSonnet, outcome: CallFailed, servedModel: "",
  known: false, amount: 0, customerCharge: 0, verdict: noVerdict }
pure def expectedModel(provider: Provider): str =
  if (provider == SurplusTerra) "gpt-6.1-terra"
  else if (provider == OrbioSonnet) "anthropic/claude-sonnet-5.5" else "claude-sonnet-5.5"
pure def nextProvider(p: Provider): Provider = if (p == SurplusSonnet) SurplusTerra else OrbioSonnet
pure def routeEnd(retryAt: int): ReviewStatus = if (retryAt > 0) BudgetBlocked else RetryableFailure
pure def blocksAfter(r: Review): int = r.blocks + (if (routeEnd(r.retryAt) == BudgetBlocked) 1 else 0)
pure def validVerdict(v: Verdict): bool = v.confidence >= 0 and v.confidence <= 100 and v.limitations >= 0
pure def canSkipMissingCredential(r: Review): bool = r.status == InFlight and not(r.rechecked)
pure def skipMissingCredential(r: Review): Review =
  if (r.provider == OrbioSonnet) { ...r, status: routeEnd(r.retryAt), blocks: blocksAfter(r), rechecked: false }
  else { ...r, provider: OrbioSonnet, rechecked: false }
pure def canRecordCall(r: Review, call: CallRecord, resetAt: int): bool =
  r.status == InFlight and r.rechecked and call.kind == r.kind and call.provider == r.provider
    and call.customerCharge == 0 and call.amount >= 0 and validVerdict(call.verdict)
    and (call.outcome != CallOk or call.servedModel == expectedModel(call.provider))
    and (call.outcome == CallOk or call.verdict == noVerdict)
    and ((call.outcome == CallBudgetDenied and call.provider != OrbioSonnet) implies resetAt > 0)
pure def recordCall(r: Review, call: CallRecord, resetAt: int): Review =
  val calls = r.calls.append(call)
  val denied = call.outcome == CallBudgetDenied and call.provider != OrbioSonnet
  val after = { ...r, calls: calls, rechecked: false }
  if (call.outcome == CallOk)
    (if (call.kind == Triage) { ...after, status: Answered, triage: call.verdict, retryAt: 0 }
     else { ...after, status: Answered, second: call.verdict, retryAt: 0 })
  else if (denied) { ...after, provider: OrbioSonnet, retryAt: if (resetAt > 0) resetAt else r.retryAt }
  else if (r.provider == OrbioSonnet) { ...after, status: routeEnd(r.retryAt), blocks: blocksAfter(r) }
  else { ...after, provider: nextProvider(r.provider) }
pure def stepEveryCallFollowsARecheck(before: Review, after: Review): bool =
  after.calls.length() > before.calls.length() implies before.rechecked
pure def alwaysRememberedResetHasItsDenial(r: Review): bool =
  r.retryAt > 0 implies r.calls.some(c => c.outcome == CallBudgetDenied and c.provider != OrbioSonnet)
pure def sometimesOrbioAfterADenial(r: Review): bool = r.status == InFlight and r.provider == OrbioSonnet and r.retryAt > 0
pure def sometimesOrbioServesAfterADenial(r: Review): bool =
  r.status == Answered and r.provider == OrbioSonnet
    and r.calls.some(c => c.outcome == CallBudgetDenied and c.provider != OrbioSonnet)
```

### A closure needs a second, agreeing review, and limited coverage stays advisory

A triage answer with a finding starts a separate confirmation route, the
same route as triage from Surplus Sonnet. The review is confirmed only when both verdicts name the same
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
pure def startConfirm(r: Review): Review = { ...r, status: InFlight, kind: Confirm, provider: SurplusSonnet, rechecked: false }
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
pure def alwaysSkippedNeverCalls(r: Review): bool =
  r.status == Skipped implies (not(r.bound) and (r.calls.length() == 0 or r.attempts > 0))
pure def alwaysCallsFollowAnAttempt(r: Review): bool = r.calls.length() > 0 implies r.attempts > 0
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
again at Surplus Sonnet and keeps every earlier call row. The review counts
the budget blocks it has met, so a review completed after a blocked
attempt is told apart from one Orbio served after a denial. Limited and complete
reviews are final for their revision and policy. A dead-lettered job has no
recovery route yet: the review stays a visible retryable failure until
GitHub's next event.

```quint
pure def canRetry(r: Review): bool =
  r.status == RetryableFailure or (r.status == BudgetBlocked and r.now >= r.retryAt)
pure def retry(r: Review): Review =
  { ...r, status: Queued, provider: SurplusSonnet, kind: Triage, retryAt: 0, rechecked: false, capAdmitted: false }
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
pure def sometimesRetriedAfterBlock(r: Review): bool = r.status == Complete and r.blocks > 0
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
  { ...failed, provider: SurplusTerra, outcome: CallBudgetDenied },
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

## Story: Read the whole bounded input and keep one disclosed review comment

> As a maintainer, I want to know exactly what Slopbot read before it acted,
> and to see one Slopbot review comment per item that hostile text cannot
> turn into links or mentions.

### Coverage is complete only when the whole compared diff fits in 120,000 characters and under 300 files, and guidance only when every policy file found is within 64 KiB

Source `loadPolicy`, `pullDiff` and `loadContext` in
`workers/slopbot/review.ts` and `fileText` in `github.ts`. Guidance is read
at the commit the review compares against: for a pull request the current
target branch tip that GitHub selected and the comparison with the head
used, so a pull request into another branch is held to that branch's
guides; for an issue the default branch tip. It is the first present file
of each group `AGENTS.md`/`agents.md`; `CONTRIBUTING.md`/`contributing.md`/
`.github/CONTRIBUTING.md`/`docs/CONTRIBUTING.md`; `README.md`/`readme.md`. A
present file over 64 KiB, or one GitHub returns without base64 file
content, is truncated: guidance with any truncated file is incomplete, and
no file at all is missing. The shell passes the reading to closure as its
policy read (`GuidanceMissing` as `PolicyMissing`, `GuidanceTruncated` as
`PolicyTruncated`, `GuidanceComplete` as `PolicyComplete`), so truncated or
missing guidance grounds no quoted-rule category ([closure](./closure.md)). The diff compares the
current target branch tip with the head commit. The files are taken in
GitHub's order, at most 300; each contributes the chunk
`--- <name> (<status>)` with its patch, and is included only when GitHub
supplied a patch and the running total stays within 120,000 characters.
Each omitted file is one named limitation, and a comparison of 300 or more
files adds one more. Coverage is complete only when nothing was omitted,
and `unreviewedContent` is the `unreviewed` count `finish` receives, so a
limited result can never label, close or penalize. An issue has no diff
and its coverage is its text. The policy digest is SHA-256 of the default
branch tip, the repository file and the guides read; when the compared
target commit is not the default branch tip, `digestTargetSha` adds it as
`targetSha`, and when the two are one commit the digest keeps the form of
reviews recorded before guides were read at the target, so their stored
digests stay valid. A target tip that moves after the review therefore
changes the digest, and the current-source check refuses the close.

```quint
type ComparedFile = { chunkChars: int, patched: bool }
type DiffTally = { includedChars: int, omitted: int, considered: int }
type GuidanceRead = { found: bool, bytes: int, readable: bool }
type GuidanceStatus = GuidanceMissing | GuidanceTruncated | GuidanceComplete
pure val maxDiffChars = 120000
pure val comparisonFileLimit = 300
pure val maxGuidanceBytes = 65536
pure def tallyFile(t: DiffTally, f: ComparedFile): DiffTally =
  if (t.considered >= comparisonFileLimit) t
  else if (f.patched and t.includedChars + f.chunkChars <= maxDiffChars)
    { ...t, includedChars: t.includedChars + f.chunkChars, considered: t.considered + 1 }
  else { ...t, omitted: t.omitted + 1, considered: t.considered + 1 }
pure def diffTally(files: List[ComparedFile]): DiffTally =
  files.foldl({ includedChars: 0, omitted: 0, considered: 0 }, (t, f) => tallyFile(t, f))
pure def unreviewedContent(files: List[ComparedFile]): int =
  diffTally(files).omitted + (if (files.length() >= comparisonFileLimit) 1 else 0)
pure def diffChars(files: List[ComparedFile]): int = files.foldl(0, (n, f) => n + f.chunkChars)
pure def coverageComplete(files: List[ComparedFile]): bool =
  files.length() < comparisonFileLimit and files.every(f => f.patched and f.chunkChars > 0) and
  diffChars(files) <= maxDiffChars
pure def guidanceTruncated(g: GuidanceRead): bool = not(g.readable) or g.bytes > maxGuidanceBytes
pure def guidanceOf(reads: List[GuidanceRead]): GuidanceStatus =
  if (reads.every(g => not(g.found))) GuidanceMissing
  else if (reads.some(g => g.found and guidanceTruncated(g))) GuidanceTruncated
  else GuidanceComplete
pure def digestTargetSha(defaultTip: str, targetTip: str): str = if (targetTip == defaultTip) "" else targetTip
pure def lawOneCommitKeepsTheDigest(sampleTip: str): bool = digestTargetSha(sampleTip, sampleTip) == ""
pure def lawAnotherTargetIsBound(sampleTip: str, sampleTarget: str): bool =
  sampleTarget != sampleTip implies digestTargetSha(sampleTip, sampleTarget) == sampleTarget
pure def lawFileLimitNeverComplete(sampleDiff: List[ComparedFile]): bool =
  sampleDiff.length() >= comparisonFileLimit implies not(coverageComplete(sampleDiff))
pure def lawMissingPatchNeverComplete(sampleDiff: List[ComparedFile]): bool =
  sampleDiff.some(f => not(f.patched)) implies not(coverageComplete(sampleDiff))
pure def lawOverBudgetNeverComplete(sampleDiff: List[ComparedFile]): bool =
  diffChars(sampleDiff) > maxDiffChars implies not(coverageComplete(sampleDiff))
pure def lawTruncatedGuidanceIncomplete(sampleGuidance: List[GuidanceRead]): bool =
  sampleGuidance.some(g => g.found and guidanceTruncated(g)) implies guidanceOf(sampleGuidance) == GuidanceTruncated
pure def lawNoGuidanceIsMissing(sampleGuidance: List[GuidanceRead]): bool =
  sampleGuidance.every(g => not(g.found)) implies guidanceOf(sampleGuidance) == GuidanceMissing
pure val smallPatch: ComparedFile = { chunkChars: 40, patched: true }
pure val sampleDiffValues = Set(List(), List(smallPatch), List(smallPatch, { chunkChars: 40, patched: false }),
  List({ chunkChars: 120001, patched: true }), List({ chunkChars: 119990, patched: true }, smallPatch))
pure val sampleGuidanceValues = Set(List(), List({ found: false, bytes: 0, readable: false }),
  List({ found: true, bytes: 900, readable: true }, { found: true, bytes: 65537, readable: true }),
  List({ found: true, bytes: 0, readable: false }), List({ found: true, bytes: 65536, readable: true }))
pure val sampleTipValues = Set("main-tip", "release-tip")
pure val sampleTargetValues = Set("main-tip", "release-tip", "moved-tip")
```

### Each item carries one Slopbot review comment, found again only through the App's own actor, and echoed text is neutralized

Source `upsertComment`, `commentBody`, `disclosure` and `neutralize` in
`review.ts`, `findReviewComment` in `github.ts`, and the table
`slopbot_item_comments`. The comment ID is kept per item node. Without a
kept ID, the item's comment history is read in pages of 100, at most 100
pages: a comment is Slopbot's only when its author is a `Bot` whose ID is
the configured App user ID and its body is the marker
`<!-- slopbot:review -->` or starts with that marker and a newline. Two
different such comments, an unreadable page or a history longer than 100
pages refuse the write for reconciliation. A found comment's ID is kept
before it is edited; with none, one is created and GitHub must answer 201
with a positive ID, which is then kept. An edit answered 404 forgets the
kept ID and looks again, at most twice; any other answer than 200 with the
same ID refuses. Each write first rechecks the review claim and the
registered scope. The body discloses the provider, the requested model and
the route step (or "deterministic pre-filter (no model)"), and names the
served model as unverified. Every piece of model or repository text echoed
into it is neutralized: each `@` is followed by a zero-width space, `<`
becomes `&lt;`, `](` and `]:` gain a space after the bracket, `://`
becomes `:` with a zero-width space before `//`, and the result is cut to
1,500 characters.

```quint
type IssueComment = { commentId: int, botAuthor: bool, authorId: int, startsWithMarker: bool }
type CommentHistory = { comments: List[IssueComment], pagesRead: int, historyComplete: bool }
type CommentLookup = CommentNotFound | CommentFound | CommentConflict | HistoryUnavailable
type CommentPlan = UpdateKept | UpdateFound | CreateComment | RefuseComment
type EchoedText = { neutralized: bool, echoChars: int }
pure val reviewCommentMarker = "<!-- slopbot:review -->"
pure val commentHistoryPageLimit = 100
pure val echoLimitChars = 1500
pure def ownReviewComment(c: IssueComment, appUser: int): bool =
  appUser > 0 and c.commentId > 0 and c.botAuthor and c.authorId == appUser and c.startsWithMarker
pure def lookupOutcome(h: CommentHistory, appUser: int): CommentLookup =
  if (not(h.historyComplete) or h.pagesRead > commentHistoryPageLimit) HistoryUnavailable
  else if (h.comments.some(a => ownReviewComment(a, appUser) and
    h.comments.some(b => ownReviewComment(b, appUser) and b.commentId != a.commentId))) CommentConflict
  else if (h.comments.some(c => ownReviewComment(c, appUser))) CommentFound
  else CommentNotFound
pure def commentPlan(keptCommentId: int, h: CommentHistory, appUser: int): CommentPlan =
  val found = lookupOutcome(h, appUser)
  if (keptCommentId > 0) UpdateKept
  else if (found == CommentFound) UpdateFound
  else if (found == CommentNotFound) CreateComment
  else RefuseComment
pure def publishableEcho(echoed: List[EchoedText]): bool =
  echoed.every(e => e.neutralized and e.echoChars >= 0 and e.echoChars <= echoLimitChars)
pure def lawOtherActorsCommentNeverFound(sampleHistory: CommentHistory, appUser: int): bool =
  sampleHistory.comments.every(c => not(c.botAuthor) or c.authorId != appUser) implies
    lookupOutcome(sampleHistory, appUser) != CommentFound
pure def lawConflictNeverWrites(sampleHistory: CommentHistory, appUser: int): bool =
  lookupOutcome(sampleHistory, appUser) == CommentConflict implies commentPlan(0, sampleHistory, appUser) == RefuseComment
pure def lawIncompleteHistoryNeverCreates(sampleHistory: CommentHistory, appUser: int): bool =
  not(sampleHistory.historyComplete) implies commentPlan(0, sampleHistory, appUser) == RefuseComment
pure def lawRawEchoNeverPublished(sampleEcho: List[EchoedText]): bool =
  sampleEcho.some(e => not(e.neutralized)) implies not(publishableEcho(sampleEcho))
pure val ownComment: IssueComment = { commentId: 11, botAuthor: true, authorId: 4, startsWithMarker: true }
pure val appUserValues = Set(4, 5)
pure val sampleHistoryValues = Set({ comments: List(), pagesRead: 1, historyComplete: true },
  { comments: List(ownComment), pagesRead: 1, historyComplete: true },
  { comments: List(ownComment, { ...ownComment, commentId: 12 }), pagesRead: 1, historyComplete: true },
  { comments: List({ ...ownComment, botAuthor: false }), pagesRead: 1, historyComplete: true },
  { comments: List({ ...ownComment, authorId: 9 }), pagesRead: 1, historyComplete: true },
  { comments: List(ownComment), pagesRead: 101, historyComplete: false })
pure val sampleEchoValues = Set(List(), List({ neutralized: true, echoChars: 1500 }),
  List({ neutralized: false, echoChars: 10 }), List({ neutralized: true, echoChars: 1501 }))
```
