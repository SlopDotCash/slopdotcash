# Private maintainer assessment

PRD section 8 keeps screening advisory and separate from severity,
acceptance, award, payment and disclosure. After a report qualifies for
owner review, Slop runs one private maintainer assessment of the exact
retained report version (`security_case_analyses`, migrations `0061` and
`0110`; Slop development `backend/security/analysis.ts`, prompt
`slop-security-case-analysis-1`). Its proposed severity, potential loss,
duplicate candidates and root cause are advice: no field of the
[case](./cases.md) reads them, so a human decision always wins.

## Story: Assess the current qualified report version once at a time

### Attempts are permanent, version-bound and finish once

The automatic attempt runs once per qualified report version with a 25 s
provider budget. A current technical approver may run another attempt with a
120 s budget after a failed or unavailable attempt, or after a running one is
lost (no result for 15 minutes). A result after its budget is unavailable. A
finished attempt is immutable. Only a complete attempt for the current report
version is shown; a newer version hides every older result. Each attempt
records the exclusion context it was asked with: Slop's default exclusions
and the owner's lines ([terms](./terms.md)), advice that nothing here reads.

```quint
import terms as T from "./terms"
import cases as C from "./cases"
type AttemptState = AttemptRunning | AttemptComplete | AttemptFailed | AttemptUnavailable
type Mode = Automatic | OwnerRun
type Attempt = { version: int, mode: Mode, state: AttemptState, startedAt: int, budgetMs: int, exclusions: T::ExclusionContext }
type Assessment = { reportVersion: int, qualifiedVersion: int, authority: C::Authority, attempts: int -> Attempt, count: int, shown: int }
pure val noAttempt: Attempt = { version: 0, mode: Automatic, state: AttemptFailed, startedAt: 0, budgetMs: 0, exclusions: T::noExclusions }
pure val initial: Assessment = { reportVersion: 1, qualifiedVersion: 0, authority: C::noAuthority, attempts: Map(), count: 0, shown: 0 }
pure def latest(a: Assessment): Attempt = a.attempts.getOr(a.count, noAttempt)
pure def retryable(a: Assessment, nowMs: int): bool = a.count == 0 or latest(a).version != a.reportVersion
  or latest(a).state == AttemptFailed or latest(a).state == AttemptUnavailable
  or (latest(a).state == AttemptRunning and nowMs >= latest(a).startedAt and nowMs - latest(a).startedAt > 900000)
pure def automaticRan(a: Assessment): bool = a.count > 0 and latest(a).version == a.reportVersion
pure def canStartAutomatic(a: Assessment, nowMs: int, exclusions: T::ExclusionContext): bool = a.qualifiedVersion == a.reportVersion
  and nowMs > 0 and not(automaticRan(a)) and T::validExclusions(exclusions)
pure def runningAttempt(version: int, mode: Mode, startedAt: int, budgetMs: int, exclusions: T::ExclusionContext): Attempt =
  { version: version, mode: mode, state: AttemptRunning, startedAt: startedAt, budgetMs: budgetMs, exclusions: exclusions }
pure def startAutomatic(a: Assessment, nowMs: int, exclusions: T::ExclusionContext): Assessment =
  { ...a, count: a.count + 1, attempts: a.attempts.put(a.count + 1, runningAttempt(a.reportVersion, Automatic, nowMs, 25000, exclusions)) }
pure def canStartOwnerRun(a: Assessment, by: int, checkedEpoch: int, nowMs: int, exclusions: T::ExclusionContext): bool =
  a.qualifiedVersion == a.reportVersion and nowMs > 0 and T::validExclusions(exclusions)
  and checkedEpoch == a.authority.epoch and checkedEpoch > 0 and a.authority.technical.includes(by) and by != 1 and retryable(a, nowMs)
pure def startOwnerRun(a: Assessment, by: int, checkedEpoch: int, nowMs: int, exclusions: T::ExclusionContext): Assessment =
  { ...a, count: a.count + 1, attempts: a.attempts.put(a.count + 1, runningAttempt(a.reportVersion, OwnerRun, nowMs, 120000, exclusions)) }
pure def canFinish(a: Assessment, attempt: int, complete: bool, elapsedMs: int): bool = attempt > 0 and attempt <= a.count
  and a.attempts.getOr(attempt, noAttempt).state == AttemptRunning and elapsedMs >= 0
pure def finish(a: Assessment, attempt: int, complete: bool, elapsedMs: int): Assessment =
  val prior = a.attempts.getOr(attempt, noAttempt)
  val finalState = if (elapsedMs > prior.budgetMs) AttemptUnavailable else if (complete) AttemptComplete else AttemptFailed
  { ...a, attempts: a.attempts.put(attempt, { ...prior, state: finalState }),
    shown: if (finalState == AttemptComplete and prior.version == a.reportVersion) attempt else a.shown }
pure def canFailUnavailable(a: Assessment, attempt: int): bool = canFinish(a, attempt, false, 0)
pure def failUnavailable(a: Assessment, attempt: int): Assessment =
  { ...a, attempts: a.attempts.put(attempt, { ...a.attempts.getOr(attempt, noAttempt), state: AttemptUnavailable }) }
```

### A new report version and screening qualification come from the screening record

The [screening machine](./screening.md) supplies each saved version and its
qualification; a revision hides the shown result until the new version is
assessed. Authority comes from the case's verified snapshot.

```quint
pure def canObserveVersion(a: Assessment, version: int): bool = version == a.reportVersion + 1
pure def observeVersion(a: Assessment, version: int): Assessment = { ...a, reportVersion: version, shown: 0 }
pure def canObserveQualified(a: Assessment, version: int): bool = version == a.reportVersion and a.qualifiedVersion != version
pure def observeQualified(a: Assessment, version: int): Assessment = { ...a, qualifiedVersion: version }
pure def canObserveAuthority(a: Assessment, snapshot: C::Authority): bool = snapshot.epoch > a.authority.epoch
pure def observeAuthority(a: Assessment, snapshot: C::Authority): Assessment = { ...a, authority: snapshot }
pure def alwaysShownIsCurrent(a: Assessment): bool = a.shown >= 0 and a.shown <= a.count and (a.shown > 0 implies
  a.attempts.getOr(a.shown, noAttempt).version == a.reportVersion and a.attempts.getOr(a.shown, noAttempt).state == AttemptComplete)
pure def alwaysAttemptsBound(a: Assessment): bool = a.count >= 0 and a.qualifiedVersion <= a.reportVersion
  and (a.count > 0 implies T::validExclusions(latest(a).exclusions))
pure def stepAttemptCountAndShownResultKept(before: Assessment, after: Assessment): bool = after.count >= before.count
  and (before.shown > 0 and after.reportVersion == before.reportVersion implies after.shown > 0)
pure def sometimesShown(a: Assessment): bool = a.shown > 0
pure def sometimesOwnerRetry(a: Assessment): bool = latest(a).mode == OwnerRun and latest(a).state == AttemptComplete
pure def sometimesLateBudget(a: Assessment): bool = latest(a).state == AttemptUnavailable and a.count > 0
pure def sometimesStaleResultHidden(a: Assessment): bool = a.shown == 0 and a.count > 0 and a.attempts.getOr(1, noAttempt).state == AttemptComplete
```

### A case received without Slop intake is qualified at its receipt version

A case received without a Slop intake (GitHub-verified, imported or
maintainer-attested, so its source is not `SlopReceived`) needs no
screening: development admits its analysis claim when the case has no intake
row and reads the report from the GitHub advisory (the claim `INSERT … WHERE
(? IS NULL AND NOT EXISTS(intake)) OR EXISTS(qualified intake)` in
`backend/security/analysis.ts`). Its receipt version is qualified at once.
The shell passes the case's own stored receipt source, never a request's
claim; a case with a Slop intake still needs screening.

```quint
pure def canObserveReceiptQualified(a: Assessment, source: C::ReceiptSource): bool =
  (source == C::GithubVerified or source == C::MaintainerAttested) and a.reportVersion == 1 and a.qualifiedVersion == 0
pure def observeReceiptQualified(a: Assessment, source: C::ReceiptSource): Assessment = { ...a, qualifiedVersion: a.reportVersion }
```

### Simulation samples

```quint
pure val nowMsValues = Set(1, 900002)
pure val sourceValues = Set(C::SlopReceived, C::GithubVerified, C::MaintainerAttested)
pure val byValues = Set(1, 2)
pure val checkedEpochValues = Set(1)
pure val snapshotValues = Set(C::staff)
pure val attemptValues = Set(1, 2, 3)
pure val elapsedMsValues = Set(1000, 30000, 130000)
pure val versionValues = Set(1, 2, 3)
pure val exclusionsValues = Set({ defaults: T::slopDefaultExclusionCount, owner: List() }, { defaults: T::slopDefaultExclusionCount, owner: List(3) },
  { defaults: 0, owner: List() })
pure val weight_startOwnerRun = 6
pure val weight_finish = 6
pure val weight_observeQualified = 4
pure val weight_observeAuthority = 4
```
