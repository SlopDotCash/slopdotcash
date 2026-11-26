# Resume historical Points collection across GitHub quota windows

PRD sections 2, 7 and 12 require exact historical attribution before
correction and publication. Main `5ba316a6719a9857ad9c3f64fc417e660e84ecfa`
promoted in-process recovery in `scripts/collect-implementation-corrections.ts`
and `.github/workflows/points-implementation-corrections.yml` through
`0806f95fb159f146ff0df137eda6eae1cfe3143d`.

This model owns a collection invocation and the handoff of its public evidence.
The [census](./census.md) owns the completeness of each source inventory.
[Corrections](./corrections.md) owns the subsequent append and its private
financial eligibility check. [Recovery](./recovery.md) owns the reconciliation
of already-published history. Neither a retained checkpoint nor a completed
collection can itself append Points.

## Story: Preserve the same campaign while live quota recovers

### Only trusted production runs can restore the original campaign

The workflow accepts manual dispatch only on main. A restored artifact must
come from that same repository, workflow and manual main run at the current
commit or a verified ancestor. The original journal baseline must still be a
prefix of the current journal. The collector verifies saved baseline
bytes, frozen project order, canonical registry digest, original collection
time and cutoff, and reconstructs the repository scope and month partitions
from retained preflight evidence. An omitted cutoff reuses the frozen cutoff.
A legacy checkpoint without a saved page size keeps its original size of 100.
New campaigns use 50. Completed month checkpoints reconstruct from raw reads
before their identity and digest are accepted. Existing scope and completed
month replays cannot fetch substitutions.

The adapter verifies workflow, GitHub, journal and cache bytes and supplies
the resulting identities. The model uses opaque identities for the frozen
ordered set and source proof. Those identities bind exact verified bytes.

```quint
type RunAuthority = { manual: bool, onMain: bool, repository: int, head: int }
type Artifact = { repository: int, head: int, main: bool, manual: bool, collectorWorkflow: bool,
  ancestorVerified: bool, exactBytesVerified: bool }
type Scope = { baseline: int, projects: int, registry: int, through: int, before: int, months: int, pageSize: int }
type Replay = { saved: Scope, reconstructed: Scope, verifiedBaseline: int, journalPrefix: int,
  cutoffSupplied: bool, requestedCutoff: int }
pure def mayCollect(authority: RunAuthority): bool = authority.manual and authority.onMain and authority.repository > 0 and authority.head > 0
pure def mayRestore(authority: RunAuthority, artifact: Artifact): bool = mayCollect(authority)
  and artifact.repository == authority.repository and artifact.head > 0 and artifact.main and artifact.manual
  and artifact.collectorWorkflow and artifact.exactBytesVerified and
    (artifact.head == authority.head or artifact.ancestorVerified)
pure val unboundScope: Scope = { baseline: 0, projects: 0, registry: 0, through: 0, before: 0, months: 0, pageSize: 0 }
pure def frozenSearchPageSize(saved: int): int = if (saved == 0) 100 else saved
pure def validScope(scope: Scope): bool = scope.baseline > 0 and scope.projects > 0 and scope.registry > 0
  and scope.through > 0 and scope.before > 0 and scope.months > 0
pure def scopeValid(replay: Replay): bool = replay.saved.baseline > 0 and replay.verifiedBaseline == replay.saved.baseline
  and replay.journalPrefix == replay.saved.baseline and replay.reconstructed == replay.saved
  and (not(replay.cutoffSupplied) or replay.requestedCutoff == replay.saved.before)
  and Set(50, 100).contains(frozenSearchPageSize(replay.saved.pageSize))
pure def lawCrossRepositoryArtifactRefused(authority: RunAuthority, artifact: Artifact): bool =
  artifact.repository != authority.repository implies not(mayRestore(authority, artifact))
pure def lawDifferentCutoffRefused(replay: Replay): bool =
  (replay.cutoffSupplied and replay.requestedCutoff != replay.saved.before) implies not(scopeValid(replay))
pure def lawLegacyKeepsPageSize(saved: int): bool = saved == 0 implies frozenSearchPageSize(saved) == 100
```

### Quota waits use the strictest safe observation from the drained pass

A primary 403 or 429 requires a usable reset header. A 429, secondary
403 or GraphQL RATE_LIMITED result can use a verified future Retry-After or
reset. When no such hint exists, the latter responses wait one minute.
For compatible hints use the largest plus two seconds. An ordinary
403 stays an ordinary failure. Times below are integer UTC milliseconds
from a verified clock. A zero retry time means no safe reset. The adapter
checks numeric parsing and safe timestamp arithmetic before supplying hints.

```quint
type Stop = None | Quota | RequestBudget
type Hint = { status: int, graphql: bool, graphqlLimited: bool, remainingZero: bool,
  secondaryMessage: bool, retryAt: int, headerReset: int, graphReset: int }
type Refusal = { kind: Stop, retryAt: int }
pure val noRefusal: Refusal = { kind: None, retryAt: 0 }
pure def later(a: int, b: int): int = if (a >= b) a else b
pure def futureHint(time: int, now: int): int = if (time > 0 and time >= now) time else 0
pure def isPrimary(h: Hint): bool = Set(403, 429).contains(h.status) and h.remainingZero
pure def isGraphLimit(h: Hint): bool = h.status == 200 and h.graphql and h.graphqlLimited
pure def isSecondary(h: Hint): bool = h.status == 403 and (h.retryAt > 0 or h.secondaryMessage)
pure def quotaRefusal(h: Hint, now: int): Refusal =
  val primary = isPrimary(h)
  val graph = isGraphLimit(h)
  val header = if (primary or graph) futureHint(h.headerReset, now) else 0
  val graphReset = if (graph) futureHint(h.graphReset, now) else 0
  val safe = later(later(futureHint(h.retryAt, now), header), graphReset)
  if (not(primary or graph or isSecondary(h) or h.status == 429)) noRefusal
  else if (primary and header == 0) { kind: Quota, retryAt: 0 }
  else { kind: Quota, retryAt: if (safe > 0) safe + 2000 else now + 60000 }
pure def combineRefusal(old: Refusal, seen: Refusal): Refusal =
  if (old.kind == RequestBudget or seen.kind == RequestBudget) { kind: RequestBudget, retryAt: 0 }
  else if (old.kind == None) seen
  else if (seen.kind == None) old
  else { kind: Quota, retryAt: if (old.retryAt == 0 or seen.retryAt == 0) 0 else later(old.retryAt, seen.retryAt) }
pure def lawUnsafeResetDoesNotAuthorizeWait(old: Refusal, seen: Refusal): bool =
  (old.kind == Quota and seen.kind == Quota and (old.retryAt == 0 or seen.retryAt == 0)) implies
    combineRefusal(old, seen).retryAt == 0
pure def lawParallelResetUsesLatest(old: Refusal, seen: Refusal): bool =
  (old.kind == Quota and seen.kind == Quota and old.retryAt > 0 and seen.retryAt > 0) implies
    combineRefusal(old, seen).retryAt == later(old.retryAt, seen.retryAt)
```

### Each new request spends the invocation budget once and each response is retained

Use the read-only canonical transport. Every returned response retains its
immutable attempt identity and body digest. A rate failure remains raw
evidence, without entering the request index. The index accepts a complete
successful reply, the recognized recoverable GraphQL statistics response,
or an exact REST 404 or 422 for the linked accepted Git object. The adapter
recognizes that absence only for the request it made to verify that object.
This preserves the original held disposition when replaying the census.
Indexing verifies exact request identity and bytes. Retained reads do not
spend the live budget or update the current GitHub quota from an old
rate snapshot. Retry scope and the invocation-wide request and reported
GraphQL cost counters survive pass boundaries. In-flight reads can still
record a response after another read has interrupted the pass.

```quint
type Phase = Unbound | Collecting | Draining | Waiting | Checkpoint | Collected | Failed
type RequestKind = FrozenScope | FrozenCensus | NewEvidence
type Request = { key: int, kind: RequestKind, canonicalRead: bool }
type Attempt = { number: int, key: int }
type Reply = { attempt: Attempt, digest: int, cost: int, recoverableStatistics: bool, acceptableSuccess: bool, hint: Hint }
type Run = { phase: Phase, scope: Scope, now: int, deadline: int, budget: int, requests: int, cost: int,
  refusedPasses: int, passSaved: Set[int], outstanding: List[Attempt], retained: List[Reply], indexed: Set[int],
  refusal: Refusal, wakeAt: int, manifest: int, receipt: int, reused: int }
pure def newInvocation(started: int, budget: int, duration: int): Run =
  { phase: Unbound, scope: unboundScope, now: started, deadline: started + duration, budget: budget,
    requests: 0, cost: 0, refusedPasses: 0, passSaved: Set(), outstanding: List(), retained: List(),
    indexed: Set(), refusal: noRefusal, wakeAt: 0, manifest: 0, receipt: 0, reused: 0 }
pure val productionBudget = 50000
pure val productionDuration = 18000000
pure val initial = newInvocation(1000, 4, 180000)
type Admission = { authority: RunAuthority, original: Scope, restoring: bool, artifact: Artifact,
  replay: Replay, retainedIndex: Set[int] }
pure def canAdmit(r: Run, entry: Admission): bool = r.phase == Unbound and r.now < r.deadline and r.indexed.size() == 0
  and mayCollect(entry.authority) and validScope(entry.original) and
    (if (entry.restoring) mayRestore(entry.authority, entry.artifact) and scopeValid(entry.replay)
      and entry.original == entry.replay.saved
     else entry.original.pageSize == 50 and entry.retainedIndex.size() == 0)
pure def admit(r: Run, entry: Admission): Run =
  { ...r, phase: Collecting, scope: { ...entry.original, pageSize: frozenSearchPageSize(entry.original.pageSize) },
    indexed: entry.retainedIndex }
pure def canRequest(r: Run, read: Request): bool = r.phase == Collecting and r.requests < r.budget
  and r.now < r.deadline and read.key > 0 and read.kind == NewEvidence and read.canonicalRead
  and not(r.indexed.contains(read.key))
pure def request(r: Run, read: Request): Run =
  { ...r, requests: r.requests + 1, outstanding: r.outstanding.append({ number: r.requests + 1, key: read.key }) }
pure def canReuse(r: Run, cachedKey: int, exactBytes: bool): bool =
  r.phase == Collecting and r.indexed.contains(cachedKey) and exactBytes
pure def reuse(r: Run, cachedKey: int, exactBytes: bool): Run = { ...r, reused: r.reused + 1 }
pure def lawFrozenRequestsRefused(r: Run, read: Request): bool = read.kind != NewEvidence implies not(canRequest(r, read))
pure def alwaysScopePageSizeFrozen(r: Run): bool = r.phase != Unbound implies Set(50, 100).contains(r.scope.pageSize)
pure def canObserve(r: Run, reply: Reply): bool = (r.phase == Collecting or r.phase == Draining)
  and r.outstanding.includes(reply.attempt) and reply.digest > 0 and reply.cost >= 0
pure def observe(r: Run, reply: Reply): Run =
  val refusal = quotaRefusal(reply.hint, r.now)
  val success = reply.hint.status >= 200 and reply.hint.status < 300
    and (reply.acceptableSuccess or (reply.hint.graphql and reply.recoverableStatistics))
  val acceptedObjectUnavailable = not(reply.hint.graphql) and Set(404, 422).contains(reply.hint.status)
    and reply.acceptableSuccess
  val save = refusal.kind == None and (success or acceptedObjectUnavailable)
  { ...r, phase: if (refusal.kind == None) r.phase else Draining,
    cost: r.cost + reply.cost, refusal: combineRefusal(r.refusal, refusal), retained: r.retained.append(reply),
    outstanding: r.outstanding.select(attempt => attempt != reply.attempt),
    passSaved: if (save) r.passSaved.union(Set(reply.attempt.key)) else r.passSaved,
    indexed: if (save) r.indexed.union(Set(reply.attempt.key)) else r.indexed }
pure def canReachBudget(r: Run, read: Request): bool = r.phase == Collecting and r.requests >= r.budget
  and read.key > 0 and read.kind == NewEvidence and read.canonicalRead and not(r.indexed.contains(read.key))
pure def reachBudget(r: Run, read: Request): Run = { ...r, phase: Draining, refusal: { kind: RequestBudget, retryAt: 0 } }
pure def canFailRead(r: Run, attempt: Attempt): bool = (r.phase == Collecting or r.phase == Draining) and r.outstanding.includes(attempt)
pure def failRead(r: Run, attempt: Attempt): Run =
  { ...r, phase: if (r.refusal.kind == None) Failed else Draining, outstanding: r.outstanding.select(active => active != attempt) }
pure def canTick(r: Run, time: int): bool = time > r.now and (r.phase == Collecting or r.phase == Draining or r.phase == Waiting)
pure def tick(r: Run, time: int): Run = { ...r, now: time }
```

### Resume requires progress or a bounded number of refusals before the deadline

After interruption drain the entire pass, then use the combined stop. A pass
that indexed any success resets the consecutive refusal count. The third
quota interruption without an indexed success checkpoints. Request-budget
stops, unsafe resets, elapsed waits outside the deadline and hard timeouts
also prevent reconciliation. The manual production runner uses 50,000 live
requests and a five-hour wait window, inside the workflow command timeout.
Exit 75 is the incomplete quota or budget result. Other failures and the
workflow timeout also block the next job. Logs and evidence can still upload.

```quint
pure def canDrain(r: Run): bool = r.phase == Draining and r.outstanding.length() == 0
pure def drain(r: Run): Run =
  val nextWake = later(r.now + 2000, r.refusal.retryAt)
  val refusals = if (r.passSaved.size() == 0) r.refusedPasses + 1 else 0
  val retry = r.refusal.kind == Quota and r.refusal.retryAt > 0 and r.requests < r.budget
    and refusals < 3 and nextWake < r.deadline
  { ...r, phase: if (retry) Waiting else Checkpoint, wakeAt: if (retry) nextWake else 0,
    refusedPasses: refusals }
pure def canResume(r: Run): bool = r.phase == Waiting and r.now >= r.wakeAt and r.now < r.deadline
pure def resume(r: Run): Run = { ...r, phase: Collecting, refusal: noRefusal, passSaved: Set(), wakeAt: 0 }
pure def canTimeout(r: Run): bool = (r.phase == Collecting or r.phase == Draining or r.phase == Waiting) and r.now >= r.deadline
pure def timeout(r: Run): Run = { ...r, phase: if (r.phase == Waiting) Checkpoint else Failed }
pure def lawBudgetStopsWithoutWait(r: Run): bool =
  (canDrain(r) and r.refusal.kind == RequestBudget) implies drain(r).phase == Checkpoint
pure def lawThirdNoProgressCheckpoints(r: Run): bool =
  (canDrain(r) and r.refusal.kind == Quota and r.refusedPasses >= 2 and r.passSaved.size() == 0)
    implies drain(r).phase == Checkpoint
pure def lawCannotWakeAtDeadline(r: Run): bool = r.now >= r.deadline implies not(canResume(r))
```

### Only exact manifest and receipt from an uninterrupted pass allow reconciliation

A completed collector has all in-flight work settled and retains the exact
manifest and matching collection receipt. Reconciliation verifies the run is
still at the exact main head and the current registry binds the frozen scope.
Bounded workflows can preview and
cannot request apply. Apply also requires complete ownership, no missing
months and an exact independently verified manifest. The adapter validates
raw attribution, retained evidence and the receipt digest. A completed
campaign can retain individual held candidates for subsequent policy review.
Private eligibility remains a separate check in the correction transaction.

```quint
type Output = { manifest: int, receipt: int, boundManifest: int, scope: Scope, checkedExact: bool, ownershipComplete: bool, missingMonths: int }
type Choice = { monthly: bool, candidateMonth: bool, apply: bool, authority: RunAuthority, observedMain: int, registry: int }
pure def matchesOutput(output: Output): bool = output.manifest > 0 and output.receipt > 0
  and output.boundManifest == output.manifest and output.checkedExact
pure def canFinish(r: Run, output: Output): bool = r.phase == Collecting and r.refusal.kind == None
  and r.outstanding.length() == 0 and r.now < r.deadline and matchesOutput(output) and output.scope == r.scope
pure def finish(r: Run, output: Output): Run = { ...r, phase: Collected, manifest: output.manifest, receipt: output.receipt }
pure def mayReconcile(r: Run, output: Output, choice: Choice): bool = r.phase == Collected and matchesOutput(output)
  and r.manifest == output.manifest and r.receipt == output.receipt and output.scope == r.scope
  and mayCollect(choice.authority) and choice.authority.head == choice.observedMain and choice.registry == r.scope.registry
  and (not(choice.apply) or (not(choice.monthly) and not(choice.candidateMonth)
    and output.ownershipComplete and output.missingMonths == 0))
pure def stepCampaignStaysFrozen(before: Run, after: Run): bool =
  before.phase != Unbound implies before.scope == after.scope
pure def alwaysBudget(r: Run): bool = r.requests >= 0 and r.requests <= r.budget and r.cost >= 0
pure def alwaysManifestOnlyAfterCollection(r: Run): bool =
  r.phase != Collected implies r.manifest == 0 and r.receipt == 0
pure def stepUsageNeverDecreases(before: Run, after: Run): bool =
  after.requests >= before.requests and after.cost >= before.cost
pure def stepRawEvidenceRetained(before: Run, after: Run): bool =
  before.retained.every(reply => after.retained.includes(reply)) and before.indexed.subseteq(after.indexed)
pure def lawInterruptedCannotFinish(r: Run, output: Output): bool =
  (r.refusal.kind != None or r.phase != Collecting) implies not(canFinish(r, output))
pure def lawStaleAuthorityCannotReconcile(r: Run, output: Output, choice: Choice): bool =
  (choice.authority.head != choice.observedMain or choice.registry != r.scope.registry) implies
    not(mayReconcile(r, output, choice))
pure def lawIncompleteCannotApply(r: Run, output: Output, choice: Choice): bool =
  (choice.apply and (choice.monthly or choice.candidateMonth or not(output.ownershipComplete) or output.missingMonths != 0))
    implies not(mayReconcile(r, output, choice))
pure def sometimesWaiting(r: Run): bool = r.phase == Waiting
pure def sometimesResumed(r: Run): bool = r.phase == Collecting and r.refusedPasses > 0
pure def sometimesCheckpoint(r: Run): bool = r.phase == Checkpoint
pure def sometimesCollected(r: Run): bool = r.phase == Collected
pure def sometimesLegacyPageSizeRestored(r: Run): bool = r.phase == Collecting and r.scope.pageSize == 100
```

### Simulation samples include successful reads, quota windows and budget refusal

```quint
pure val authorityValues = Set({ manual: true, onMain: true, repository: 1, head: 2 })
pure val artifactValues = Set({ repository: 1, head: 1, main: true, manual: true, collectorWorkflow: true,
  ancestorVerified: true, exactBytesVerified: true })
pure val scopeSample: Scope = { baseline: 1, projects: 1, registry: 1, through: 1000, before: 500, months: 1, pageSize: 50 }
pure val replayValues = Set({ saved: scopeSample, reconstructed: scopeSample, verifiedBaseline: 1, journalPrefix: 1,
  cutoffSupplied: true, requestedCutoff: 501 },
  { saved: { ...scopeSample, pageSize: 0 }, reconstructed: { ...scopeSample, pageSize: 0 }, verifiedBaseline: 1, journalPrefix: 1,
    cutoffSupplied: false, requestedCutoff: 0 })
pure val entryValues = Set({ authority: { manual: true, onMain: true, repository: 1, head: 2 },
  original: scopeSample, restoring: false, artifact: { repository: 1, head: 1, main: true,
    manual: true, collectorWorkflow: true, ancestorVerified: true, exactBytesVerified: true },
  replay: { saved: scopeSample, reconstructed: scopeSample, verifiedBaseline: 1, journalPrefix: 1,
    cutoffSupplied: false, requestedCutoff: 0 }, retainedIndex: Set(1).exclude(Set(1)) },
  { authority: { manual: true, onMain: true, repository: 1, head: 2 },
  original: { ...scopeSample, pageSize: 0 }, restoring: true, artifact: { repository: 1, head: 1, main: true,
    manual: true, collectorWorkflow: true, ancestorVerified: true, exactBytesVerified: true },
  replay: { saved: { ...scopeSample, pageSize: 0 }, reconstructed: { ...scopeSample, pageSize: 0 }, verifiedBaseline: 1, journalPrefix: 1,
    cutoffSupplied: false, requestedCutoff: 0 }, retainedIndex: Set(1) })
pure val savedValues = Set(0, 50, 100)
pure val oldValues = Set(noRefusal, { kind: Quota, retryAt: 2500 })
pure val seenValues = Set({ kind: Quota, retryAt: 0 }, { kind: Quota, retryAt: 5000 })
pure val readValues = Set({ key: 1, kind: NewEvidence, canonicalRead: true }, { key: 2, kind: NewEvidence, canonicalRead: true },
  { key: 2, kind: FrozenScope, canonicalRead: true }, { key: 1, kind: FrozenCensus, canonicalRead: true })
pure val cachedKeyValues = Set(1, 2)
pure val exactBytesValues = Set(true, false)
pure val noHint: Hint = { status: 200, graphql: false, graphqlLimited: false, remainingZero: false,
  secondaryMessage: false, retryAt: 0, headerReset: 0, graphReset: 0 }
pure val attemptValues = tuples(1.to(4), Set(1, 2)).map(t => { number: t._1, key: t._2 })
pure val replyValues = tuples(1.to(4), Set(1, 2)).map(t => {
  val attempt = { number: t._1, key: t._2 };
  Set(
  { attempt: attempt, digest: 1, cost: 1, acceptableSuccess: true, recoverableStatistics: false, hint: noHint },
  { attempt: attempt, digest: 2, cost: 2, acceptableSuccess: false, recoverableStatistics: false,
    hint: { ...noHint, status: 429, retryAt: 10000 } },
  { attempt: attempt, digest: 3, cost: 0, acceptableSuccess: false, recoverableStatistics: false,
    hint: { ...noHint, status: 403, remainingZero: true } },
  { attempt: attempt, digest: 4, cost: 1, acceptableSuccess: true, recoverableStatistics: false,
    hint: { ...noHint, status: 404 } })
}).flatten()
pure val timeValues = Set(4000, 12000, 16000, 75000, 175000, 181000)
pure val outputValues = Set({ manifest: 1, receipt: 2, boundManifest: 1, scope: scopeSample, checkedExact: true, ownershipComplete: true, missingMonths: 0 })
pure val choiceValues = Set({ monthly: false, candidateMonth: false, apply: true,
  authority: { manual: true, onMain: true, repository: 1, head: 2 }, observedMain: 2, registry: 1 })
```
