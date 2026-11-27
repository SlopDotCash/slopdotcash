# Incremental collection memo

PRD section 9, operator decision 19 November 2026: a trusted main collection
keeps a memo of what it read, so the next one reaches the same collection
with fewer GitHub reads (`scripts/collection-memo.ts`,
`scripts/attribution-memo.ts`, the commit attribution loop of
`scripts/value-ingestion.ts` and `collectionMemoFromEnv` of
`scripts/generate-leaderboard.ts`; main 2c23afd1e and 1dfaaf8d4, development
7f71c6ce9; the legacy `incremental_collection` model). This machine is one
collection's memo session, from opening the previous memo to writing the
next. The memo only saves reads: every reused answer is the answer a full
collection would compute from the same inputs, and failing to keep the memo
never fails the release.

The memo (`slop-collection-memo-v2`, with `slop-collection-memo-v1` accepted
on read as rules version 1 dated at `lastFullAt`) holds `producedAt`,
`cutoffAt`, `lastFullAt`, the attribution code digest, the semantic
`attributionRulesVersion`, immutable commit line statistics and fenced commit
attributions with per-answer `computedAt` timestamps. The shell parses it
strictly (exact keys, at most 512 MiB, 2,000,000 commit lines and 200,000
attributions, no commit or outcome twice, `lastFullAt` and every `computedAt`
at or before `producedAt`, a 64-hex digest, a positive integer rules version);
a missing or unparseable memo is not usable and the collection runs in full.
Each attribution records its fence (pull request number, URL, head commit,
merge and update times, repository node and eligible commit list) and every
pull, incoming cross-reference list and text reference its answer read; the
model abstracts them into one `version` of the outcome's inputs, which the
shell compares exactly (equal fence, every recorded dependency re-read and
equal: pulls 100 per batch, incoming cross-references 20 per batch and
complete only without a next page, references 25 per batch; a failed batch
only makes its own entries not reusable). Times are integer milliseconds.

## Story: Reach the same collection with fewer reads

> As the operator, I want a trusted main collection to reuse what an
> earlier one read only while every input it was derived from is unchanged,
> so that a release collects faster and never publishes a different answer.

### Only a trusted main collection may use a collection memo, and a memo produced after now fails the collection

In GitHub Actions a memo is used only by a collection of `refs/heads/main`
started by `push`, `workflow_dispatch` or `schedule`; any other run that names
a memo to read or write fails with `Only a trusted main collection may use a
collection memo`. Outside GitHub Actions the check does not apply. Before
it, a `SLOP_COLLECTION_FULL` other than `true` or `false` (unset is `false`)
fails the run with `SLOP_COLLECTION_FULL must be true or false`. A usable
memo whose `producedAt` is after now fails the collection with `Invalid
collection memo: memo was produced in the future`; it is never taken for a
full collection. A run that names no memo has no session.

```quint
pure val auditOneIn = 50
pure val changedCodeAuditOneIn = 10
pure val fullIntervalMs = 604800000
pure val maxMemoBytes = 536870912
pure val maxCommitLines = 2000000
pure val maxAttributions = 200000
type CollectionMode = FullCollection | IncrementalCollection
type ModeReason = NoPreviousMemo | FullRequested | RulesChanged | CodeChanged | MemoMatches
type MemoPhase = Unopened | Auditing | Answering | SnapshotWritten | MemoWritten | MemoNotWritten | MemoRefused
type MemoRefusal = NotRefused | UntrustedRun | FutureMemo
type RunContext = { actions: bool, gitRef: str, eventName: str }
type PriorAnswer = { outcomeId: int, version: int, result: int, expired: bool }
type MemoFile = { usable: bool, producedAt: int, lastFullAt: int, sameRules: bool, sameCode: bool, attributions: List[PriorAnswer] }
type Answer = { outcomeId: int, version: int, result: int, held: bool, reused: bool, audited: bool, recorded: bool }
type MemoRun = { phase: MemoPhase, refusal: MemoRefusal, mode: CollectionMode, reason: ModeReason, now: int,
  lastFullAt: int, auditRate: int, prior: List[PriorAnswer], answers: List[Answer], nextMemo: List[PriorAnswer],
  mismatch: bool, producedAt: int, writtenLastFullAt: int }
pure val initial: MemoRun = { phase: Unopened, refusal: NotRefused, mode: FullCollection, reason: NoPreviousMemo, now: 0,
  lastFullAt: 0, auditRate: auditOneIn, prior: List(), answers: List(), nextMemo: List(), mismatch: false, producedAt: 0,
  writtenLastFullAt: 0 }
pure def trustedMemoUse(context: RunContext): bool =
  not(context.actions) or
    (context.gitRef == "refs/heads/main" and
      (context.eventName == "push" or context.eventName == "workflow_dispatch" or context.eventName == "schedule"))
pure def memoWithinBounds(bytes: int, commitLines: int, attributions: int): bool =
  bytes >= 0 and bytes <= maxMemoBytes and commitLines >= 0 and commitLines <= maxCommitLines and
  attributions >= 0 and attributions <= maxAttributions
pure def memoWellFormed(memo: MemoFile): bool =
  not(memo.usable) or
    (memo.lastFullAt <= memo.producedAt and memo.attributions.length() <= maxAttributions and
      memo.attributions.every(p => p.outcomeId > 0 and p.result >= 0 and
        memo.attributions.select(o => o.outcomeId == p.outcomeId).length() == 1))
pure def lawUntrustedActionsRunNeverUsesMemo(context: RunContext): bool =
  (context.actions and (context.gitRef != "refs/heads/main" or context.eventName == "pull_request")) implies
    not(trustedMemoUse(context))
pure def lawOversizedMemoUnusable(bytes: int): bool = bytes > maxMemoBytes implies not(memoWithinBounds(bytes, 0, 0))
```

### A collection runs in full without a usable memo, when forced or when the attribution rules changed

The mode is decided once, when the memo is opened, from the first reason
that applies, in this order: no usable memo (`no previous memo`), the
`full_collection` input (`SLOP_COLLECTION_FULL=true`, `full collection
requested`), or a different semantic `attributionRulesVersion` (`attribution
rules changed`). Otherwise the collection is incremental: when the code digest
changed since the previous memo without a rules version bump (`code changed
since the previous memo; auditing 1 in 10`), the audit sample grows from 1 in
50 to 1 in 10; when the code digest matches (`previous memo matches`), the
audit sample stays 1 in 50. Answers past their per-outcome refresh age (between
half and all of 604,800,000 ms since `computedAt`) are left out and recomputed
live instead of triggering a weekly full run. The shell logs
`collection mode: <mode> (<reason>)`. A full collection reuses no attribution.
Commit statistics of a usable memo are reused in either mode.

```quint
pure def modeReason(memo: MemoFile, forced: bool): ModeReason =
  if (not(memo.usable)) NoPreviousMemo
  else if (forced) FullRequested
  else if (not(memo.sameRules)) RulesChanged
  else if (not(memo.sameCode)) CodeChanged
  else MemoMatches
pure def modeFor(reason: ModeReason): CollectionMode =
  if (reason == MemoMatches or reason == CodeChanged) IncrementalCollection else FullCollection
pure def auditRateFor(reason: ModeReason): int =
  if (reason == CodeChanged) changedCodeAuditOneIn else auditOneIn
pure def canOpenMemo(r: MemoRun, memo: MemoFile, context: RunContext, forced: bool, now: int): bool =
  r.phase == Unopened and now >= 0 and memoWellFormed(memo)
pure def openMemo(r: MemoRun, memo: MemoFile, context: RunContext, forced: bool, now: int): MemoRun =
  val reason = modeReason(memo, forced)
  val mode = modeFor(reason)
  if (not(trustedMemoUse(context))) { ...r, phase: MemoRefused, refusal: UntrustedRun }
  else if (memo.usable and memo.producedAt > now) { ...r, phase: MemoRefused, refusal: FutureMemo }
  else { ...r, phase: Auditing, mode: mode, reason: reason, now: now,
    lastFullAt: if (memo.usable) memo.lastFullAt else now,
    auditRate: auditRateFor(reason),
    prior: if (mode == IncrementalCollection) memo.attributions else List() }
pure def lawForcedRunIsFull(memo: MemoFile): bool = modeFor(modeReason(memo, true)) == FullCollection
pure def lawChangedRulesIsFull(memo: MemoFile, forced: bool): bool =
  not(memo.sameRules) implies modeFor(modeReason(memo, forced)) == FullCollection
pure def lawChangedCodeStaysIncremental(memo: MemoFile): bool =
  (memo.usable and memo.sameRules and not(memo.sameCode)) implies
    (modeFor(modeReason(memo, false)) == IncrementalCollection and auditRateFor(modeReason(memo, false)) == changedCodeAuditOneIn)
pure def lawIncrementalNeedsMatchingMemo(memo: MemoFile, forced: bool): bool =
  modeFor(modeReason(memo, forced)) == IncrementalCollection implies
    (memo.usable and not(forced) and memo.sameRules)
pure def alwaysRefusedOnlyWithReason(r: MemoRun): bool = (r.phase == MemoRefused) iff (r.refusal != NotRefused)
pure def alwaysFullNeverReuses(r: MemoRun): bool =
  r.mode == FullCollection implies (r.prior == List() and r.answers.every(a => not(a.reused)))
pure def stepRefusalIsFinal(before: MemoRun, after: MemoRun): bool = before.phase == MemoRefused implies after == before
pure def sometimesRulesChangedFull(r: MemoRun): bool = r.phase == Auditing and r.reason == RulesChanged and r.mode == FullCollection
pure def sometimesChangedCodeIncremental(r: MemoRun): bool =
  r.phase == Auditing and r.reason == CodeChanged and r.mode == IncrementalCollection and r.auditRate == changedCodeAuditOneIn
pure def sometimesFutureMemoFails(r: MemoRun): bool = r.refusal == FutureMemo
pure def sometimesUntrustedRunFails(r: MemoRun): bool = r.refusal == UntrustedRun
```

### Commit statistics are reused only for the same repository node, commit node and object id

A commit's additions and deletions are immutable: the memo answers them only
for a row with the same repository node, commit node and object id; another
object id under the same node is not this commit and is read live. Every row
answered or read in this pass, and no other, is kept in the next memo.

```quint
type CommitLine = { repositoryNodeId: str, commitNodeId: str, oid: str, additions: int, deletions: int }
pure def commitLineFor(row: CommitLine, repositoryNodeId: str, commitNodeId: str, oid: str): bool =
  row.repositoryNodeId == repositoryNodeId and row.commitNodeId == commitNodeId and row.oid == oid
pure def lawOtherObjectReadLive(row: CommitLine, repositoryNodeId: str, commitNodeId: str, oid: str): bool =
  row.oid != oid implies not(commitLineFor(row, repositoryNodeId, commitNodeId, oid))
pure val rowValues = Set({ repositoryNodeId: "R", commitNodeId: "C", oid: "a", additions: 3, deletions: 1 },
  { repositoryNodeId: "R", commitNodeId: "C", oid: "b", additions: 3, deletions: 1 })
pure val repositoryNodeIdValues = Set("R", "S")
pure val commitNodeIdValues = Set("C", "D")
pure val oidValues = Set("a", "b")
```

### A collection reuses an earlier answer only while every input it was derived from is unchanged

An earlier answer is a candidate only in incremental mode, only when it is
younger than its refresh age (`not(expired)`), its recorded fence equals the
live census fence and every recorded input re-read is unchanged (the same
`version`). Before any answer is reused, a deterministic sample of the
candidates, those whose `sample` (the first 32 bits, big-endian, of sha256 of
`<cutoffAt>` NUL `<outcome id>`) is a multiple of the session's `auditRate`
(50 when code matches, 10 when code changed without a rules change), is
recomputed live; one difference, a hold included, discards every reuse of the
run. A sampled candidate is never reused. A reused answer's authors are read
live again, and an author no longer eligible for commit credit makes the answer
live. Every other outcome is computed live.

```quint
pure def audited(sample: int): bool = sample % auditOneIn == 0
pure def auditedAt(sample: int, rate: int): bool = rate > 0 and sample % rate == 0
pure def answered(r: MemoRun, outcomeId: int): bool = r.answers.some(a => a.outcomeId == outcomeId)
pure def candidate(r: MemoRun, outcomeId: int, version: int): bool =
  r.mode == IncrementalCollection and r.prior.some(p => p.outcomeId == outcomeId and p.version == version and not(p.expired))
pure def priorResult(r: MemoRun, outcomeId: int): int =
  r.prior.foldl(-1, (acc, p) => if (p.outcomeId == outcomeId) p.result else acc)
pure def recordedOf(answers: List[Answer]): List[PriorAnswer] =
  answers.select(a => a.recorded).listMap(a => { outcomeId: a.outcomeId, version: a.version, result: a.result, expired: false })
pure def withAnswer(a: Answer, r: MemoRun): MemoRun =
  { ...r, answers: r.answers.append(a),
    nextMemo: if (a.recorded) r.nextMemo.append({ outcomeId: a.outcomeId, version: a.version, result: a.result, expired: false }) else r.nextMemo }
pure def canAudit(r: MemoRun, outcomeId: int, version: int, sample: int, result: int, held: bool, fenced: bool): bool =
  r.phase == Auditing and not(r.mismatch) and auditedAt(sample, r.auditRate) and candidate(r, outcomeId, version) and
  not(answered(r, outcomeId)) and result >= 0
pure def audit(r: MemoRun, outcomeId: int, version: int, sample: int, result: int, held: bool, fenced: bool): MemoRun =
  val differs = held or result != priorResult(r, outcomeId)
  val updated = withAnswer({ outcomeId: outcomeId, version: version, result: result, held: held, reused: false,
    audited: true, recorded: fenced and not(held) }, r)
  { ...updated, mismatch: r.mismatch or differs }
pure def canFinishAudit(r: MemoRun): bool = r.phase == Auditing
pure def finishAudit(r: MemoRun): MemoRun = { ...r, phase: Answering }
pure def canReuse(r: MemoRun, outcomeId: int, version: int, sample: int): bool =
  r.phase == Answering and not(r.mismatch) and not(auditedAt(sample, r.auditRate)) and candidate(r, outcomeId, version) and
  not(answered(r, outcomeId))
pure def reuse(r: MemoRun, outcomeId: int, version: int, sample: int): MemoRun =
  withAnswer({ outcomeId: outcomeId, version: version, result: priorResult(r, outcomeId), held: false, reused: true,
    audited: false, recorded: true }, r)
pure def alwaysPriorDistinct(r: MemoRun): bool =
  r.prior.every(p => p.outcomeId > 0 and p.result >= 0 and r.prior.select(o => o.outcomeId == p.outcomeId).length() == 1)
pure def alwaysAnswersDistinct(r: MemoRun): bool =
  r.answers.every(a => a.outcomeId > 0 and r.answers.select(o => o.outcomeId == a.outcomeId).length() == 1)
pure def alwaysReuseWithinFence(r: MemoRun): bool =
  r.answers.every(a => a.reused implies r.prior.some(p => p.outcomeId == a.outcomeId and p.version == a.version and p.result == a.result and not(p.expired)))
pure def alwaysAuditsPrecedeReuse(r: MemoRun): bool =
  (r.phase == Auditing or r.mismatch) implies r.answers.every(a => not(a.reused))
pure def alwaysAuditedIsRecomputed(r: MemoRun): bool = r.answers.every(a => not(a.audited and a.reused))
pure def lawSampledEveryFiftieth(sample: int): bool = (sample >= 0 and sample < auditOneIn) implies (audited(sample) iff sample == 0)
pure def sometimesAuditMismatchDiscardsReuse(r: MemoRun): bool = r.phase == Answering and r.mismatch and r.answers.length() > 1
pure def sometimesReusedAfterCleanAudit(r: MemoRun): bool =
  r.answers.some(a => a.audited) and r.answers.some(a => a.reused)
pure def sometimesExpiredNotReused(r: MemoRun): bool =
  r.mode == IncrementalCollection and r.prior.some(p => p.expired) and
  r.answers.some(a => not(a.reused) and r.prior.some(p => p.outcomeId == a.outcomeId and p.expired))
```

### The next memo records exactly the live version of every fenced answer and is written only after the snapshot

The next memo holds, for each outcome answered in this pass, the version it
was answered for: a reused answer as it was recorded, and a live
computation only when every read it made was fenced (pull objects by node,
update time, state and URL; their reviews, comments, files and commits;
exact-commit reads; file reads at a 40-hex ref; public reference queries;
the one-page incoming timeline) and it is not a hold. A hold, including the
deferred retained attribution, and an unfenced computation are never
recorded; the shell counts why (`attributions not recorded for reuse`).
After a full run `lastFullAt` is the memo's `producedAt`; after an
incremental run it is the previous one. The memo is written to
`SLOP_COLLECTION_MEMO_OUT` only after the snapshot itself was written, and a
failure to write it is logged (`collection memo not written`) and never fails
the release: the next collection then runs in full.

```quint
pure def canComputeLive(r: MemoRun, outcomeId: int, version: int, result: int, held: bool, fenced: bool): bool =
  r.phase == Answering and outcomeId > 0 and not(answered(r, outcomeId)) and result >= 0
pure def computeLive(r: MemoRun, outcomeId: int, version: int, result: int, held: bool, fenced: bool): MemoRun =
  withAnswer({ outcomeId: outcomeId, version: version, result: result, held: held, reused: false, audited: false,
    recorded: fenced and not(held) }, r)
pure def canWriteSnapshot(r: MemoRun): bool = r.phase == Answering
pure def writeSnapshot(r: MemoRun): MemoRun = { ...r, phase: SnapshotWritten }
pure def canWriteMemo(r: MemoRun, producedAt: int): bool = r.phase == SnapshotWritten and producedAt >= r.now
pure def writeMemo(r: MemoRun, producedAt: int): MemoRun =
  { ...r, phase: MemoWritten, producedAt: producedAt,
    writtenLastFullAt: if (r.mode == FullCollection) producedAt else r.lastFullAt }
pure def canFailMemoWrite(r: MemoRun): bool = r.phase == SnapshotWritten
pure def failMemoWrite(r: MemoRun): MemoRun = { ...r, phase: MemoNotWritten }
pure def alwaysNextMemoIsRecorded(r: MemoRun): bool = r.nextMemo == recordedOf(r.answers)
pure def alwaysHoldNeverRecorded(r: MemoRun): bool =
  r.answers.every(a => (a.recorded implies not(a.held)) and (a.reused implies a.recorded))
pure def alwaysFullRunRestartsWeek(r: MemoRun): bool =
  r.phase == MemoWritten implies
    (r.writtenLastFullAt == (if (r.mode == FullCollection) r.producedAt else r.lastFullAt) and r.writtenLastFullAt <= r.producedAt)
pure def alwaysLastFullNotAfterOpen(r: MemoRun): bool = r.lastFullAt <= r.now
pure def alwaysNothingAnsweredUnopened(r: MemoRun): bool =
  (r.phase == Unopened or r.phase == MemoRefused) implies (r.answers == List() and r.nextMemo == List())
pure def stepMemoOnlyAfterSnapshot(before: MemoRun, after: MemoRun): bool =
  (after.phase == MemoWritten and before.phase != MemoWritten) implies before.phase == SnapshotWritten
pure def sometimesReusedAndWritten(r: MemoRun): bool =
  r.phase == MemoWritten and r.mode == IncrementalCollection and r.answers.some(a => a.reused)
pure def sometimesHoldNotRecorded(r: MemoRun): bool = r.answers.some(a => a.held) and r.phase == MemoWritten
pure def sometimesMemoNotWritten(r: MemoRun): bool = r.phase == MemoNotWritten
```

### Simulation samples include a matching, a changed-rules, a changed-code, an expired and a future memo

```quint
pure val matchingMemo: MemoFile = { usable: true, producedAt: 1000, lastFullAt: 500, sameRules: true, sameCode: true,
  attributions: List({ outcomeId: 1, version: 0, result: 1, expired: false }, { outcomeId: 2, version: 1, result: 11, expired: false }) }
pure val expiredMemo: MemoFile = { ...matchingMemo,
  attributions: List({ outcomeId: 1, version: 0, result: 1, expired: true }, { outcomeId: 2, version: 1, result: 11, expired: false }) }
pure val trustedRun: RunContext = { actions: true, gitRef: "refs/heads/main", eventName: "push" }
pure val memoValues = Set(matchingMemo, { ...matchingMemo, sameCode: false }, { ...matchingMemo, sameRules: false },
  expiredMemo, { ...matchingMemo, usable: false, attributions: List() }, { ...matchingMemo, producedAt: 2000 })
pure val contextValues = Set(trustedRun, { ...trustedRun, eventName: "pull_request" },
  { ...trustedRun, gitRef: "refs/heads/development", eventName: "schedule" },
  { actions: false, gitRef: "refs/heads/feature", eventName: "pull_request" })
pure val nowValues = Set(1000, 1500, 604801000)
pure val outcomeIdValues = Set(1, 2)
pure val versionValues = Set(0, 1)
pure val sampleValues = Set(0, 10, 50, 7)
pure val resultValues = Set(1, 11, 99)
pure val producedAtValues = Set(1500, 604801000)
pure val bytesValues = Set(0, 536870912, 536870913)
pure val eval_witness_sometimesReusedAndWritten = (("openMemo", matchingMemo, trustedRun, false, 1000), "finishAudit",
  ("reuse", 1, 0, 7), "writeSnapshot", ("writeMemo", 1500))
pure val eval_witness_sometimesReusedAfterCleanAudit = (("openMemo", matchingMemo, trustedRun, false, 1000),
  ("audit", 2, 1, 0, 11, false, true), "finishAudit", ("reuse", 1, 0, 7))
pure val eval_witness_sometimesAuditMismatchDiscardsReuse = (("openMemo", matchingMemo, trustedRun, false, 1000),
  ("audit", 2, 1, 50, 99, false, true), "finishAudit", ("computeLive", 1, 0, 1, false, true))
pure val eval_witness_sometimesFutureMemoFails = ("openMemo", { ...matchingMemo, producedAt: 2000 }, trustedRun, false, 1500)
pure val eval_witness_sometimesRulesChangedFull = ("openMemo", { ...matchingMemo, sameRules: false }, trustedRun, false, 1000)
pure val eval_witness_sometimesChangedCodeIncremental = ("openMemo", { ...matchingMemo, sameCode: false }, trustedRun, false, 1000)
pure val eval_witness_sometimesExpiredNotReused = (("openMemo", expiredMemo, trustedRun, false, 1000), "finishAudit",
  ("computeLive", 1, 0, 1, false, true))
pure val eval_witness_sometimesUntrustedRunFails = ("openMemo", matchingMemo, { ...trustedRun, eventName: "pull_request" }, false, 1000)
pure val eval_witness_sometimesHoldNotRecorded = (("openMemo", matchingMemo, trustedRun, false, 1000), "finishAudit",
  ("computeLive", 1, 0, 1, true, true), "writeSnapshot", ("writeMemo", 1500))
pure val eval_witness_sometimesMemoNotWritten = (("openMemo", matchingMemo, trustedRun, false, 1000), "finishAudit",
  "writeSnapshot", "failMemoWrite")
```
