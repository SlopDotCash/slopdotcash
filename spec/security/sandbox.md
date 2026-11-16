# Disposable artifact sandbox

PRD sections 8 and 11. `workers/vetting-sandbox/README.md`: the private
runner executes one exact risky artifact for the
[admission scanner](./admission.md) in a new sandbox with internet disabled,
no secrets, no storage binding and no user session. It runs a fixed Python,
Node.js or native command as an unprivileged user under CPU, process, file and
output limits. The response is private execution evidence that the scanner
retains before relying on it.

## Story: Execute one verified artifact in isolation and always destroy the sandbox

### The digest check and the isolation profile precede execution

A mismatched digest fails the request before a sandbox exists, so no bytes
reach one. A seccomp filter that cannot load, enabled egress or a supplied
secret fails isolation, and the service request fails.

```quint
type SandboxPhase = Requested | DigestRefused | DigestVerified | Isolated | Executed | NotExecutable | IsolationFailed
  | LimitReached | Destroyed | CleanupFailed
type Profile = { filterLoaded: bool, internetDisabled: bool, secretsProvided: bool }
type Sandbox = { phase: SandboxPhase, artifact: int, result: SandboxPhase, coverageGap: bool, quarantined: bool }
pure val initial: Sandbox = { phase: Requested, artifact: 1, result: Requested, coverageGap: false, quarantined: true }
pure def canVerifyDigest(s: Sandbox, digest: int): bool = s.phase == Requested
pure def verifyDigest(s: Sandbox, digest: int): Sandbox =
  if (digest == s.artifact) { ...s, phase: DigestVerified } else { ...s, phase: DigestRefused, result: DigestRefused }
pure def isolated(profile: Profile): bool = profile.filterLoaded and profile.internetDisabled and not(profile.secretsProvided)
pure def canIsolate(s: Sandbox, profile: Profile): bool = s.phase == DigestVerified
pure def isolate(s: Sandbox, profile: Profile): Sandbox =
  if (isolated(profile)) { ...s, phase: Isolated } else { ...s, phase: IsolationFailed, result: IsolationFailed }
pure val profileValues = Set({ filterLoaded: true, internetDisabled: true, secretsProvided: false },
  { filterLoaded: false, internetDisabled: true, secretsProvided: false }, { filterLoaded: true, internetDisabled: false, secretsProvided: false },
  { filterLoaded: true, internetDisabled: true, secretsProvided: true })
pure val digestValues = Set(1, 2)
pure def sometimesDigestRefused(s: Sandbox): bool = s.phase == DigestRefused
```

### An execution ends executed, not executable or at a limit

An unsupported executable or unavailable loader is `not-executable`, a result
distinct from a retryable isolation failure. An output limit or timeout is
explicit. Both establish a coverage gap, never complete coverage.

```quint
type Execution = Ran | Unsupported | OutputLimit | Timeout
pure def canExecute(s: Sandbox, execution: Execution): bool = s.phase == Isolated
pure def execute(s: Sandbox, execution: Execution): Sandbox =
  val phase = if (execution == Ran) Executed else if (execution == Unsupported) NotExecutable else LimitReached
  { ...s, phase: phase, result: phase, coverageGap: phase != Executed }
pure def alwaysGapUnlessExecuted(s: Sandbox): bool =
  (s.result == NotExecutable or s.result == LimitReached) iff s.coverageGap
```

### Every request destroys its sandbox, and a cleanup failure never completes

The sandbox is destroyed after each request that created one, including
failed ones. No response declares an artifact safe, releases quarantine,
grants clearance or makes a moderator decision.

```quint
pure def canDestroy(s: Sandbox, ok: bool): bool =
  s.phase == Executed or s.phase == NotExecutable or s.phase == IsolationFailed or s.phase == LimitReached
pure def destroy(s: Sandbox, ok: bool): Sandbox = { ...s, phase: if (ok) Destroyed else CleanupFailed }
pure def completed(s: Sandbox): bool = s.phase == Destroyed and s.result != IsolationFailed
pure def stepNeverReleasesQuarantine(before: Sandbox, after: Sandbox): bool = before.quarantined implies after.quarantined
pure def alwaysExecutionNeedsIsolation(s: Sandbox): bool =
  (s.phase == Requested or s.phase == DigestVerified or s.phase == Isolated) implies s.result == Requested
pure def sometimesCompleted(s: Sandbox): bool = completed(s) and s.result == Executed
pure def sometimesNotExecutable(s: Sandbox): bool = completed(s) and s.result == NotExecutable
pure def sometimesLimitGap(s: Sandbox): bool = completed(s) and s.coverageGap and s.result == LimitReached
pure def sometimesIsolationFailed(s: Sandbox): bool = s.phase == Destroyed and s.result == IsolationFailed
pure def sometimesCleanupFailed(s: Sandbox): bool = s.phase == CleanupFailed and s.result == Executed
```
