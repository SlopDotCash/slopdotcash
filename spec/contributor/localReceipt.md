# Durable local contributor receipt completion

PRD sections 4, 9 and 12 and `skill_run_local` at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` require exact immutable completion,
including validation and failures before or after publication. Source is
`skills/project-contributor-template/scripts/run-receipt.mjs` and
`src/lib/run-receipts.ts`. This component owns one local measured run and the
completion file's first writer. The optional [private trace](./evidence.md)
and ordinary PR event are independent records. The installed skill adapter
checks repository root, exact active provenance, client, provider, model,
lane, signed schema and optional trace identity before reporting completion.
Actual filesystem and cryptography remain shell conformance.

## Story: Publish the first valid receipt and recover a lost completion reply

### Prepare and validate the candidate before moving any durable completion

Start establishes local run identity, start time and the exact declared
provider, model, client and lane. It requires the recorded local
authorization of the active verified installation
([installation](./installation.md) `authorizeLocal`): a local checkout or a
version other than the active verified one is refused. Consent and an
available adapter permit usage capture. An absent capture never prevents
finishing. A backward clock and invalid candidate refuse before the hard-link
publication. A failed validation preserves the active run for diagnosis and
retry.

```quint
import installation as I from "./installation"
type Lane = ContributionLane | ReviewLane
type Declared = { provider: str, model: str, client: str, lane: Lane }
type Capture = Unavailable | Capturing
type Finish = Idle | Preparing | Validated | Staged | Published
type Exit = NoExit | Working | Succeeded | Failed
type ReceiptFile = { digest: str, completionAt: int, valid: bool }
type LocalReceipt = { started: bool, active: bool, startedAt: int, consent: bool, capture: Capture, declared: Declared,
  installed: I::Version, finish: Finish, candidate: ReceiptFile, temporary: bool, completed: ReceiptFile, result: Exit }
pure val noCandidate: ReceiptFile = { digest: "", completionAt: 0, valid: false }
pure val noDeclared: Declared = { provider: "", model: "", client: "", lane: ContributionLane }
pure val initial: LocalReceipt = { started: false, active: false, startedAt: 0, consent: false, capture: Unavailable,
  declared: noDeclared, installed: I::noVersion, finish: Idle, candidate: noCandidate, temporary: false, completed: noCandidate, result: NoExit }
pure def declaredExactly(d: Declared): bool = d.provider != "" and d.model != "" and d.client != ""
pure def canStart(s: LocalReceipt, startedAt: int, declared: Declared, install: I::Installation): bool =
  not(s.started) and startedAt > 0 and declaredExactly(declared) and install.local == I::LocalAuthorized
    and I::validVersion(install.active)
pure def start(s: LocalReceipt, startedAt: int, consent: bool, available: bool, declared: Declared, install: I::Installation): LocalReceipt =
  { ...s, started: true, active: true, startedAt: startedAt, consent: consent, declared: declared, installed: install.active,
    capture: if (consent and available) Capturing else Unavailable }
pure def canPrepareFinish(s: LocalReceipt): bool = s.active and s.finish == Idle and s.completed.digest == ""
pure def prepareFinish(s: LocalReceipt, candidate: ReceiptFile): LocalReceipt =
  { ...s, finish: Preparing, candidate: candidate, result: Working }
pure def validCandidate(s: LocalReceipt): bool = s.candidate.valid and s.candidate.digest != ""
  and s.candidate.completionAt >= s.startedAt
pure def canValidate(s: LocalReceipt): bool = s.finish == Preparing and validCandidate(s)
pure def validate(s: LocalReceipt): LocalReceipt = { ...s, finish: Validated }
pure def canReject(s: LocalReceipt): bool = s.finish == Preparing and not(validCandidate(s))
pure def reject(s: LocalReceipt): LocalReceipt = { ...s, finish: Idle, result: Failed }
```

### Publication, temporary cleanup and active-file removal are separate outcomes

The staged candidate lives in an exclusive per-invocation pending file. An
atomic hard link publishes it only if no completed record exists. The winner
is permanent. Another racing invocation can publish its own exact candidate,
which later replay reads instead of overwriting it. A failed cleanup keeps the
completed file and may leave the owned temporary file. A replay checks the
stored current or historical file and the exact requested repository, run and
proof identities. A malformed historical record stays an explicit error. It
cannot be silently repaired or displaced. Active-file deletion may fail after
publication and can later be retried. Output is successful only after verified
readback and required active-file cleanup.

```quint
pure def canStage(s: LocalReceipt): bool = s.finish == Validated
pure def stage(s: LocalReceipt): LocalReceipt = { ...s, finish: Staged, temporary: true }
pure def canPublish(s: LocalReceipt): bool = s.finish == Staged and s.temporary and s.completed.digest == ""
pure def publish(s: LocalReceipt): LocalReceipt = { ...s, finish: Published,
  completed: { digest: s.candidate.digest, completionAt: s.candidate.completionAt, valid: true } }
pure def canCompetingWriter(s: LocalReceipt, contender: ReceiptFile): bool =
  (s.finish == Staged or s.finish == Validated) and s.completed.digest == "" and contender.digest != ""
    and contender.valid and contender.completionAt >= s.startedAt
pure def competingWriter(s: LocalReceipt, contender: ReceiptFile): LocalReceipt = { ...s,
  completed: { digest: contender.digest, completionAt: contender.completionAt, valid: true } }
pure def canCleanupTemporary(s: LocalReceipt): bool = s.temporary and (s.finish == Published or s.result == Failed)
pure def cleanupTemporary(s: LocalReceipt, succeeds: bool): LocalReceipt =
  if (succeeds) { ...s, temporary: false } else { ...s, finish: Idle, result: Failed }
pure def canRemoveActive(s: LocalReceipt): bool = s.finish == Published and not(s.temporary)
pure def removeActive(s: LocalReceipt, succeeds: bool): LocalReceipt =
  { ...s, finish: Idle, active: not(succeeds), result: if (succeeds) Succeeded else Failed }
pure def canFailBeforeCommit(s: LocalReceipt): bool = s.completed.digest == "" and
  (s.finish == Preparing or s.finish == Validated or s.finish == Staged)
pure def failBeforeCommit(s: LocalReceipt): LocalReceipt = { ...s, finish: Idle, result: Failed }
pure def canReplayCompleted(s: LocalReceipt): bool = s.completed.digest != "" and s.finish != Published
pure def replayCompleted(s: LocalReceipt, identityMatches: bool, cleanupWorks: bool): LocalReceipt =
  if (s.completed.valid and identityMatches and (not(s.active) or cleanupWorks))
    { ...s, active: false, finish: Idle, result: Succeeded }
  else { ...s, finish: Idle, result: Failed }
pure def canObserveInvalidHistory(s: LocalReceipt, digest: str): bool = s.active and s.finish == Idle
  and s.completed.digest == "" and digest != ""
pure def observeInvalidHistory(s: LocalReceipt, digest: str): LocalReceipt =
  { ...s, completed: { digest: digest, completionAt: -1, valid: false } }
pure def alwaysState(s: LocalReceipt): bool =
  (s.started implies s.startedAt > 0) and (s.active implies s.started) and
  (s.finish != Idle implies s.active) and (s.started and not(s.active) implies s.completed.valid)
  and (s.started implies declaredExactly(s.declared) and I::validVersion(s.installed))
pure def alwaysCandidate(s: LocalReceipt): bool =
  (s.finish == Validated or s.finish == Staged or s.finish == Published) implies validCandidate(s)
pure def alwaysCompleted(s: LocalReceipt): bool =
  (s.completed.valid implies s.started and s.completed.digest != "" and s.completed.completionAt >= s.startedAt) and
  (s.finish == Published implies s.completed.valid and s.completed.digest == s.candidate.digest)
pure def alwaysOptional(s: LocalReceipt): bool = not(s.consent) implies s.capture == Unavailable
pure def alwaysSuccess(s: LocalReceipt): bool = s.result == Succeeded implies s.completed.valid and not(s.active)
pure def stepFirstWriter(before: LocalReceipt, after: LocalReceipt): bool = before.completed.digest != ""
  implies before.completed == after.completed
pure def sometimesFinishedWithoutCapture(s: LocalReceipt): bool = s.result == Succeeded and s.capture == Unavailable
pure def sometimesTemporaryCleanupFailed(s: LocalReceipt): bool = s.completed.valid and s.active and s.result == Failed and s.temporary
pure def sometimesInvalidHistory(s: LocalReceipt): bool = s.completed.digest != "" and not(s.completed.valid) and s.result == Failed
pure def sometimesRace(s: LocalReceipt): bool = s.result == Succeeded and s.candidate.digest != "" and s.completed.digest != s.candidate.digest
```

### Samples exercise missing, matching and conflicting evidence

```quint
pure val declaredValues = Set({ provider: "p", model: "m", client: "c", lane: ContributionLane },
  { provider: "", model: "m", client: "c", lane: ReviewLane })
pure val installedVersion: I::Version = { template: "0123456789abcdef0123456789abcdef01234567", revision: 1, digest: "m1" }
pure val installValues = Set({ ...I::initial, active: installedVersion, versions: List(installedVersion), local: I::LocalAuthorized },
  { ...I::initial, active: installedVersion, versions: List(installedVersion), local: I::LocalRefused })
pure val startedAtValues = Set(1, 2)
pure val digestValues = Set("run-a", "run-b")
pure val validFinish: ReceiptFile = { digest: "run-a", completionAt: 2, valid: true }
pure val candidateValues = Set(validFinish, { ...validFinish, valid: false }, { ...validFinish, completionAt: -1 })
pure val contenderValues = Set({ ...validFinish, digest: "run-b" })
pure val weight_prepareFinish = 7
pure val weight_replayCompleted = 7
pure val weight_competingWriter = 4
pure val weight_validate = 6
pure val weight_stage = 6
pure val weight_publish = 6
```
