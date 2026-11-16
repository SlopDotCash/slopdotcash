# Recover published Points history without losing source coverage

PRD sections 2 and 7 preserve the append-only journal and its source coverage.
Recovery reads that public history before preparing another Points projection.
The [publication model](./publication.md) owns publication authority and the
exact revision-prefix check. This model owns a generator's recovery decision
for one requested environment.

This contract follows `scripts/generate-points.ts:201–240`,
`src/lib/points.ts:328–372` and `scripts/points-history-recovery.test.ts` at
main commit `78eed5564d796119d82ae541c36b0c770263dc5f`. The read adapter
supplies checkpoint pages and Pages shards after verifying complete canonical
bytes, immutable revision hashes, journal schema and coverage records. It
binds each verified copy to the actual source environment. Date values are
normalized instants that preserve the order of the canonical UTC timestamps.

## Story: Resume generation from the complete published journal

### Recovery requires both verified public copies from the requested environment

The protected D1 checkpoint and the Pages projection can be at different
stages of publication. Both histories must be valid, and the shorter revision
list must match the exact prefix of the longer. A mismatched environment,
unverified copy or divergent prefix refuses recovery. The generator receives
an explicit refusal and retains existing external history. This decision alone
has no authority to write either public source.

```quint
import publication as P from "./publication"
type Environment = Production | Staging
type SourceCoverage = { repository: str, fromTime: int, throughTime: int, digest: str }
type PublicHistory = { origin: Environment, generatedAt: int, revisions: List[P::PublishedRecord], coverage: List[SourceCoverage] }
type CopyState = CopyPresent | CopyAbsent | CopyUnavailable
type CopyEvidence = { state: CopyState, history: PublicHistory, verified: bool }
type RecoveryEvidence = { requested: Environment, explicitBootstrap: bool, checkpoint: CopyEvidence, pages: CopyEvidence }
type RecoveryOutcome = Pending | Recovered(PublicHistory) | Bootstrapped | BootstrapRefused | MissingHistory | SourceUnavailable |
  WrongEnvironment | UnverifiedCopy | DivergingHistory
type Recovery = { outcome: RecoveryOutcome }
pure val initial: Recovery = { outcome: Pending }
pure def originMatches(evidence: RecoveryEvidence): bool = evidence.checkpoint.history.origin == evidence.requested and evidence.pages.history.origin == evidence.requested
pure def verifiedCopies(evidence: RecoveryEvidence): bool = evidence.checkpoint.verified and evidence.pages.verified
pure def checkpointIsLater(evidence: RecoveryEvidence): bool = evidence.checkpoint.history.revisions.length() > evidence.pages.history.revisions.length()
pure def laterCopy(evidence: RecoveryEvidence): PublicHistory =
  if (checkpointIsLater(evidence)) evidence.checkpoint.history else evidence.pages.history
pure def earlierCopy(evidence: RecoveryEvidence): PublicHistory =
  if (checkpointIsLater(evidence)) evidence.pages.history else evidence.checkpoint.history
pure def historiesAgree(evidence: RecoveryEvidence): bool = P::exactPrefix(earlierCopy(evidence).revisions, laterCopy(evidence).revisions)
pure def bothPresent(evidence: RecoveryEvidence): bool = evidence.checkpoint.state == CopyPresent and evidence.pages.state == CopyPresent
pure def admissibleRecovery(evidence: RecoveryEvidence): bool = bothPresent(evidence) and originMatches(evidence) and verifiedCopies(evidence) and historiesAgree(evidence)
pure def pendingResult(r: Recovery): bool =
  val decision = r.outcome
  match decision { | Pending => true | _ => false }
pure def canRecover(r: Recovery, evidence: RecoveryEvidence): bool = pendingResult(r) and admissibleRecovery(evidence)
pure def canRefuse(r: Recovery, evidence: RecoveryEvidence): bool = pendingResult(r) and not(admissibleRecovery(evidence)) and
  not(bootstrapAllowed(evidence)) and not(stagingPagesOnly(evidence))
pure def refuse(r: Recovery, evidence: RecoveryEvidence): Recovery = { outcome:
  if (evidence.checkpoint.state == CopyUnavailable or evidence.pages.state == CopyUnavailable) SourceUnavailable
  else if (evidence.explicitBootstrap and evidence.checkpoint.state == CopyAbsent) BootstrapRefused
  else if (not(bothPresent(evidence))) MissingHistory
  else if (not(originMatches(evidence))) WrongEnvironment else if (not(verifiedCopies(evidence))) UnverifiedCopy else DivergingHistory }
pure def stepTerminalResult(before: Recovery, after: Recovery): bool = not(pendingResult(before)) implies after.outcome == before.outcome
```

### Bootstrap starts an empty journal only when no public copy exists

An explicit bootstrap is the release workflow's input. It succeeds only when
both the protected checkpoint and the Pages projection are absent; when any
published copy may exist it is refused. Without it, an absent copy refuses
recovery. A copy that cannot be read refuses recovery without discarding
history. Staging historically published only its Pages journal: when its
checkpoint is not published, the verified staging Pages copy is recovered
alone.

```quint
pure def bootstrapAllowed(evidence: RecoveryEvidence): bool =
  evidence.explicitBootstrap and evidence.checkpoint.state == CopyAbsent and evidence.pages.state == CopyAbsent
pure def stagingPagesOnly(evidence: RecoveryEvidence): bool =
  evidence.requested == Staging and evidence.checkpoint.state == CopyAbsent and evidence.pages.state == CopyPresent and
  evidence.pages.verified and evidence.pages.history.origin == Staging
pure def canBootstrap(r: Recovery, evidence: RecoveryEvidence): bool = pendingResult(r) and bootstrapAllowed(evidence)
pure def bootstrap(r: Recovery, evidence: RecoveryEvidence): Recovery = { outcome: Bootstrapped }
pure def canRecoverStagingPages(r: Recovery, evidence: RecoveryEvidence): bool = pendingResult(r) and stagingPagesOnly(evidence)
pure def recoverStagingPages(r: Recovery, evidence: RecoveryEvidence): Recovery = { outcome: Recovered({ origin: evidence.pages.history.origin,
  generatedAt: evidence.pages.history.generatedAt, revisions: evidence.pages.history.revisions, coverage: evidence.pages.history.coverage }) }
pure def lawBootstrapNeedsBothAbsent(evidence: RecoveryEvidence): bool =
  bootstrapAllowed(evidence) implies (evidence.checkpoint.state == CopyAbsent and evidence.pages.state == CopyAbsent)
pure def lawProductionNeverPagesOnly(evidence: RecoveryEvidence): bool = evidence.requested == Production implies not(stagingPagesOnly(evidence))
```

### Recovery retains exact coverage even when no award revision changes

The output keeps the longer ordered revision list. Pages supplies the base
ordering on a tie. Coverage keeps the base copy's order and appends each row
from the other copy absent from the base. Row identity is the complete tuple
of repository, source-window bounds and digest. The recovered generation time
is the later instant across both copies, including a refresh that recorded
coverage without making a new award. A later publication must pass the public
journal extension contract independently.

```quint
pure def unionCoverage(base: List[SourceCoverage], otherCoverage: List[SourceCoverage]): List[SourceCoverage] =
  base.concat(otherCoverage.select(row => not(base.includes(row))))
pure def recoveredHistory(evidence: RecoveryEvidence): PublicHistory =
  val base = laterCopy(evidence)
  val earlier = earlierCopy(evidence)
  { ...base, coverage: unionCoverage(base.coverage, earlier.coverage),
    generatedAt: if (base.generatedAt > earlier.generatedAt) base.generatedAt else earlier.generatedAt }
pure def recover(r: Recovery, evidence: RecoveryEvidence): Recovery =
  val recovered = recoveredHistory(evidence)
  { outcome: Recovered({ origin: recovered.origin, generatedAt: recovered.generatedAt,
    revisions: recovered.revisions, coverage: recovered.coverage }) }
pure def lawCoverageRetained(base: List[SourceCoverage], otherCoverage: List[SourceCoverage], row: SourceCoverage): bool =
  (base.includes(row) or otherCoverage.includes(row)) implies unionCoverage(base, otherCoverage).includes(row)
pure def lawOnlyObservedCoverage(base: List[SourceCoverage], otherCoverage: List[SourceCoverage], row: SourceCoverage): bool =
  unionCoverage(base, otherCoverage).includes(row) implies (base.includes(row) or otherCoverage.includes(row))
pure def lawRecoveryStaysInEnvironment(evidence: RecoveryEvidence): bool = admissibleRecovery(evidence) implies recoveredHistory(evidence).origin == evidence.requested
pure def lawRecoveryKeepsNewerTime(evidence: RecoveryEvidence): bool =
  recoveredHistory(evidence).generatedAt >= evidence.checkpoint.history.generatedAt and recoveredHistory(evidence).generatedAt >= evidence.pages.history.generatedAt
pure def lawRecoveryKeepsCompleteRevisions(evidence: RecoveryEvidence): bool =
  if (checkpointIsLater(evidence)) recoveredHistory(evidence).revisions == evidence.checkpoint.history.revisions
  else recoveredHistory(evidence).revisions == evidence.pages.history.revisions
```

### Coverage-only recovery and all refusal reasons can occur

The witnesses exercise refreshes in either copy, divergent public branches,
an unreadable copy and an observation from another environment. Refusal
never becomes an empty recovered journal.

```quint
pure val firstCoverage: SourceCoverage = { repository: "repo", fromTime: 1, throughTime: 2, digest: "first coverage" }
pure val refreshedCoverage: SourceCoverage = { repository: "repo", fromTime: 1, throughTime: 3, digest: "refreshed coverage" }
pure val otherCoverageRow: SourceCoverage = { repository: "other", fromTime: 1, throughTime: 3, digest: "refreshed coverage" }
pure val firstHistory: PublicHistory = { origin: Production, generatedAt: 2, revisions: List(P::firstRecord), coverage: List(firstCoverage) }
pure val refreshedHistory: PublicHistory = { ...firstHistory, generatedAt: 3, coverage: List(firstCoverage, refreshedCoverage) }
pure def evidenceFor(checkpoint: PublicHistory, pages: PublicHistory): RecoveryEvidence =
  { requested: Production, explicitBootstrap: false, checkpoint: { state: CopyPresent, history: checkpoint, verified: true },
    pages: { state: CopyPresent, history: pages, verified: true } }
pure val checkedBoth = evidenceFor(firstHistory, refreshedHistory)
pure val verifiedCheckpointRefresh = evidenceFor(refreshedHistory, firstHistory)
pure val extendedCheckpoint = evidenceFor({ ...firstHistory, revisions: List(P::firstRecord, P::secondRecord) }, refreshedHistory)
pure val forkedCopies = evidenceFor({ ...firstHistory, revisions: List(P::secondRecord) }, firstHistory)
pure val differentEnvironment = evidenceFor(firstHistory, { ...refreshedHistory, origin: Staging })
pure val unverifiedPages = { ...checkedBoth, pages: { state: CopyPresent, history: refreshedHistory, verified: false } }
pure val absentCopy: CopyEvidence = { state: CopyAbsent, history: { ...firstHistory, revisions: List(), coverage: List() }, verified: false }
pure val emptyBoth = { ...checkedBoth, explicitBootstrap: true, checkpoint: absentCopy, pages: absentCopy }
pure val bootstrapOverExisting = { ...checkedBoth, explicitBootstrap: true, checkpoint: absentCopy }
pure val stagingPages = { ...checkedBoth, requested: Staging, checkpoint: absentCopy,
  pages: { state: CopyPresent, history: { ...firstHistory, origin: Staging }, verified: true } }
pure val unreadable = { ...checkedBoth, pages: { state: CopyUnavailable, history: firstHistory, verified: false } }
pure val evidenceValues = Set(checkedBoth, verifiedCheckpointRefresh, extendedCheckpoint, forkedCopies, differentEnvironment, unverifiedPages,
  emptyBoth, bootstrapOverExisting, stagingPages, unreadable)
pure val baseValues = Set(List(), List(firstCoverage), List(refreshedCoverage), List(firstCoverage, refreshedCoverage))
pure val otherCoverageValues = Set(List(), List(refreshedCoverage), List(otherCoverageRow), List(firstCoverage, refreshedCoverage))
pure val rowValues = Set(firstCoverage, refreshedCoverage, otherCoverageRow)
pure def sometimesCoverageOnlyRecovered(r: Recovery): bool =
  val decision = r.outcome
  match decision {
  | Recovered(history) => history.revisions == firstHistory.revisions and history.coverage.includes(refreshedCoverage) and history.generatedAt == 3
  | _ => false
}
pure def sometimesWrongEnvironment(r: Recovery): bool =
  val decision = r.outcome
  match decision { | WrongEnvironment => true | _ => false }
pure def sometimesUnverified(r: Recovery): bool =
  val decision = r.outcome
  match decision { | UnverifiedCopy => true | _ => false }
pure def sometimesBootstrapped(r: Recovery): bool =
  val decision = r.outcome
  match decision { | Bootstrapped => true | _ => false }
pure def sometimesBootstrapRefused(r: Recovery): bool =
  val decision = r.outcome
  match decision { | BootstrapRefused => true | _ => false }
pure def sometimesUnavailable(r: Recovery): bool =
  val decision = r.outcome
  match decision { | SourceUnavailable => true | _ => false }
pure def sometimesStagingPagesOnly(r: Recovery): bool =
  val decision = r.outcome
  match decision { | Recovered(history) => history.origin == Staging | _ => false }
pure def sometimesDiverged(r: Recovery): bool =
  val decision = r.outcome
  match decision { | DivergingHistory => true | _ => false }
```
