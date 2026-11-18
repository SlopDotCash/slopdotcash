# Repository private-reporting readiness

PRD sections 8 and 10. The hourly identity schedule refreshes whether GitHub
private vulnerability reporting is enabled on each registered repository
(`workers/slopbot/reporting-readiness.ts`, `backend/security/reporting-readiness.ts`).
[Forwarding](./forwarding.md) reads the cached observation; no request reads
GitHub live for it.

## Story: Keep one current observation per project revision and repository

### A refresh writes only a newer attempt and keeps the repository identity

Retired projects are skipped; paused and unfunded projects are included. A
failed read keeps the last enabled state and verification time and records
the failure. A read of another repository id or node id is an identity
mismatch: it records the failure and keeps the prior identity, enabled state
and verification time. Times are milliseconds.

```quint
type ProjectListing = Active | Paused | Unfunded | Retired
type ReadKind = Verified | AppNotInstalled | ReadUnavailable
type ReadFailure = NoFailure | ReadFailed | IdentityMismatch
type Target = { revision: int, repository: int, repositoryId: int, repositoryNodeId: int, listing: ProjectListing }
type Read = { kind: ReadKind, repositoryId: int, repositoryNodeId: int, enabled: bool }
type ReadinessObservation = { revision: int, repository: int, repositoryId: int, repositoryNodeId: int, enabled: bool,
  verifiedAt: int, attemptedAt: int, failure: ReadFailure }
type Readiness = { observations: List[ReadinessObservation] }
pure val initial: Readiness = { observations: List() }
pure val maxAgeMs = 3600000
pure def sameKey(o: ReadinessObservation, revision: int, repository: int): bool = o.revision == revision and o.repository == repository
pure val noObservation: ReadinessObservation = { revision: 0, repository: 0, repositoryId: 0, repositoryNodeId: 0, enabled: false,
  verifiedAt: 0, attemptedAt: 0, failure: NoFailure }
pure def newerThanStored(r: Readiness, revision: int, repository: int, attemptedAt: int): bool =
  r.observations.every(o => not(sameKey(o, revision, repository)) or attemptedAt > o.attemptedAt)
pure def observed(r: Readiness, revision: int, repository: int): bool = r.observations.some(o => sameKey(o, revision, repository))
pure def written(prior: ReadinessObservation, target: Target, read: Read, attemptedAt: int): ReadinessObservation =
  val known = prior.repositoryId > 0
  val verified = read.kind == Verified and read.repositoryId > 0 and read.repositoryNodeId > 0
    and (target.repositoryId == 0 or read.repositoryId == target.repositoryId)
    and (target.repositoryNodeId == 0 or read.repositoryNodeId == target.repositoryNodeId)
    and (not(known) or (read.repositoryId == prior.repositoryId and read.repositoryNodeId == prior.repositoryNodeId))
  val mismatch = read.kind == Verified and not(verified)
  { revision: target.revision, repository: target.repository,
    repositoryId: if (known) prior.repositoryId else if (verified) read.repositoryId else 0,
    repositoryNodeId: if (known) prior.repositoryNodeId else if (verified) read.repositoryNodeId else 0,
    enabled: if (verified) read.enabled else prior.enabled,
    verifiedAt: if (verified) attemptedAt else prior.verifiedAt,
    attemptedAt: attemptedAt,
    failure: if (verified) NoFailure else if (mismatch) IdentityMismatch else ReadFailed }
pure def canRefresh(r: Readiness, target: Target, read: Read, attemptedAt: int): bool =
  target.listing != Retired and target.revision > 0 and target.repository > 0 and attemptedAt > 0
    and newerThanStored(r, target.revision, target.repository, attemptedAt)
pure def refresh(r: Readiness, target: Target, read: Read, attemptedAt: int): Readiness =
  if (observed(r, target.revision, target.repository))
    { observations: r.observations.listMap(o => if (sameKey(o, target.revision, target.repository)) written(o, target, read, attemptedAt) else o) }
  else { observations: r.observations.append(written(noObservation, target, read, attemptedAt)) }
pure def lawRetiredSkipped(r: Readiness, target: Target, read: Read, attemptedAt: int): bool =
  target.listing == Retired implies not(canRefresh(r, target, read, attemptedAt))
pure def lawIdentityMismatchKeepsPrior(prior: ReadinessObservation, target: Target, read: Read, attemptedAt: int): bool =
  written(prior, target, read, attemptedAt).failure == IdentityMismatch implies
    written(prior, target, read, attemptedAt).enabled == prior.enabled and written(prior, target, read, attemptedAt).verifiedAt == prior.verifiedAt
pure def lawFailedReadKeepsPrior(prior: ReadinessObservation, target: Target, read: Read, attemptedAt: int): bool =
  read.kind != Verified implies written(prior, target, read, attemptedAt).enabled == prior.enabled
    and written(prior, target, read, attemptedAt).verifiedAt == prior.verifiedAt
pure def stepAttemptsOnlyAdvance(before: Readiness, after: Readiness): bool =
  before.observations.every(b => after.observations.some(a => a.revision == b.revision and a.repository == b.repository
    and a.attemptedAt >= b.attemptedAt
    and (b.repositoryId > 0 implies a.repositoryId == b.repositoryId and a.repositoryNodeId == b.repositoryNodeId)))
pure def alwaysVerifiedNotAfterAttempt(r: Readiness): bool = r.observations.every(o => o.verifiedAt >= 0 and o.verifiedAt <= o.attemptedAt)
pure val registered: Target = { revision: 1, repository: 1, repositoryId: 11, repositoryNodeId: 21, listing: Active }
pure val targetValues = Set(registered, { ...registered, listing: Paused }, { ...registered, listing: Retired },
  { ...registered, revision: 2, repositoryId: 0, repositoryNodeId: 0, listing: Unfunded })
pure val readValues = Set(
  { kind: Verified, repositoryId: 11, repositoryNodeId: 21, enabled: true },
  { kind: Verified, repositoryId: 12, repositoryNodeId: 21, enabled: false },
  { kind: Verified, repositoryId: 11, repositoryNodeId: 22, enabled: false },
  { kind: AppNotInstalled, repositoryId: 0, repositoryNodeId: 0, enabled: false },
  { kind: ReadUnavailable, repositoryId: 0, repositoryNodeId: 0, enabled: false })
pure val attemptedAtValues = Set(1000, 2000, 3601000, 5000000)
```

### Only a fresh, enabled, verified observation is ready

An observation is stale without a verification time, after a failed refresh,
or once its age reaches one hour. A future verification time establishes no
readiness. The stored repository id and node id must match the target's
registered identity when it is known (`cachedReportingReadiness`).

```quint
pure def fresh(o: ReadinessObservation, nowMs: int): bool =
  o.verifiedAt > 0 and o.failure == NoFailure and nowMs >= o.verifiedAt and nowMs - o.verifiedAt < maxAgeMs
pure def identityMatches(o: ReadinessObservation, target: Target): bool =
  (target.repositoryId == 0 or o.repositoryId == target.repositoryId)
    and (target.repositoryNodeId == 0 or o.repositoryNodeId == target.repositoryNodeId)
pure def readyFor(r: Readiness, target: Target, nowMs: int): bool =
  r.observations.some(o => sameKey(o, target.revision, target.repository) and identityMatches(o, target) and o.enabled and fresh(o, nowMs))
pure def lawStaleNeverReady(o: ReadinessObservation, nowMs: int): bool = nowMs - o.verifiedAt >= maxAgeMs implies not(fresh(o, nowMs))
pure def sometimesReady(r: Readiness): bool = readyFor(r, registered, 3601000)
pure def sometimesMismatchKeptEnabled(r: Readiness): bool =
  r.observations.some(o => o.failure == IdentityMismatch and o.enabled and o.verifiedAt > 0)
pure val oValues = Set(
  { revision: 1, repository: 1, repositoryId: 11, repositoryNodeId: 21, enabled: true, verifiedAt: 1000, attemptedAt: 1000, failure: NoFailure },
  { revision: 1, repository: 1, repositoryId: 11, repositoryNodeId: 21, enabled: true, verifiedAt: 1000, attemptedAt: 3601000, failure: ReadFailed })
pure val priorValues = oValues
pure val nowMsValues = Set(1000, 3600999, 3601000, 5000000)
```

### The GitHub handoff link follows the last verified enabled observation

The public intake readiness read returns the GitHub private-reporting handoff
link while the cached observation is `ready`: the identity matches, the last
verified value is enabled, and its verification time is known and not in the
future (`cachedReportingReadiness`, `handoffUrl` in
`backend/security/handler.ts`). Staleness and a failed later refresh do not
hide it; they are reported beside it. Readiness for automatic intake and
forwarding still needs `readyFor`.

```quint
pure def handoffShown(r: Readiness, target: Target, nowMs: int): bool =
  r.observations.some(o => sameKey(o, target.revision, target.repository) and identityMatches(o, target) and o.enabled
    and o.verifiedAt > 0 and nowMs >= o.verifiedAt)
pure def lawReadyShowsHandoff(r: Readiness, target: Target, nowMs: int): bool = readyFor(r, target, nowMs) implies handoffShown(r, target, nowMs)
pure def sometimesHandoffShownWhileStale(r: Readiness): bool = handoffShown(r, registered, 5000000) and not(readyFor(r, registered, 5000000))
pure val rValues = Set(initial, { observations: List({ revision: 1, repository: 1, repositoryId: 11, repositoryNodeId: 21, enabled: true,
  verifiedAt: 1000, attemptedAt: 1000, failure: NoFailure }) }, { observations: List({ revision: 1, repository: 1, repositoryId: 11,
  repositoryNodeId: 21, enabled: true, verifiedAt: 1000, attemptedAt: 3601000, failure: ReadFailed }) })
```
