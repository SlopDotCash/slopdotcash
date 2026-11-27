# Admission results into project clearance

PRD section 8 and `backend/vetting/README.md` ("Clearance"). The
[assessment machine](./admission.md) produces one recorded scan per
assessment; the [enforcement machine](./enforcement.md) keeps the latest
controlling assessment of each repository. This machine joins them: the
signed result intake (`backend/vetting/handler.ts`, `scan-result.ts`) records
a scan only for the pending assessment of the same repository, identity
epoch and revision, and the retained-evidence read (`evidence-retention.ts`)
decides whether a clean result is verified. The scanner's publication
journal (intent, single send, receipt and reconciliation) is the assessment
machine's. A malicious result also retires the registry listing, so it is
recorded through the [project composition](../backend/projectComposition.md), not
here.

## Story: Only a qualified clean scan of the exact repository identity clears it

### A recorded scan feeds enforcement only for its own pending assessment and identity

The intake accepts a recorded clean or incomplete scan whose assignment names
the repository's pending assessment, its current identity epoch and the
revision the request was made at. A clean scan feeds clearance only when it
passes: recorded clean, evidence retained and no explicit investigation of it
open. Its evidence is read in the same request; missing, corrupt or expired
evidence leaves it unverified. Each delivered scan's record is kept, and each
repository's latest assessment matches its repository and never carries a
future identity epoch.

```quint
import admission as A from "./admission"
import enforcement as E from "./enforcement"
type Vetting = { security: E::Enforcement, records: List[A::AssessmentRecord] }
pure val initial: Vetting = { security: E::initial, records: List() }
pure def recordedScan(scan: A::Scan): bool =
  A::isRecorded(scan) and A::alwaysRecordedMatchesDisposition(scan) and A::alwaysPublishingDecided(scan) and
  A::alwaysAssignmentValid(scan) and A::alwaysMaliceConfirmed(scan)
pure def forPending(e: E::Enforcement, scan: A::Scan): bool =
  val pending = E::latestOf(e, scan.assignment.repository)
  pending.state == E::APending and pending.id == scan.assignment.assessment and pending.revision == scan.assignment.revision and
  pending.identity == scan.assignment.identityEpoch and scan.assignment.identityEpoch == E::identityOf(e, scan.assignment.repository)
pure def canDeliver(v: Vetting, by: int, scan: A::Scan, readable: bool): bool =
  recordedScan(scan) and scan.recorded != A::DMalicious and (scan.recorded == A::DClean implies A::passes(scan)) and
  forPending(v.security, scan) and not(v.records.some(r => r.assessment == scan.assignment.assessment)) and E::canRecordResult(v.security, by, A::outcomeOf(scan), E::RevisionNotNeeded)
pure def deliver(v: Vetting, by: int, scan: A::Scan, readable: bool): Vetting =
  val record = A::recordOf(scan, readable)
  val recorded = E::recordResult(v.security, by, A::outcomeOf(scan), E::RevisionNotNeeded)
  { security: if (scan.recorded == A::DClean)
      E::observeEvidence(recorded, E::platform, record.repository, { assessment: record.assessment, present: record.evidenceAvailable })
    else recorded,
    records: v.records.append(record) }
pure def recordFor(v: Vetting, assessment: int): A::AssessmentRecord =
  v.records.select(r => r.assessment == assessment).nthOr(0,
    { assessment: 0, repository: 0, identityEpoch: 0, requestedAt: 0, result: A::NoDisposition, reused: false,
      evidenceAvailable: false, investigationOpen: false })
pure def alwaysCleanFedOnlyByQualifiedRecord(v: Vetting): bool =
  v.security.repositories.every(r =>
    (E::latestOf(v.security, r).state == E::NotAssessed or E::latestOf(v.security, r).repository == r) and
    E::latestOf(v.security, r).identity <= E::identityOf(v.security, r) and
    (E::assessedClean(v.security, r) implies
      (recordFor(v, E::latestOf(v.security, r).id).result == A::DClean and
       recordFor(v, E::latestOf(v.security, r).id).evidenceAvailable and
       not(recordFor(v, E::latestOf(v.security, r).id).investigationOpen) and
       recordFor(v, E::latestOf(v.security, r).id).repository == r and
       recordFor(v, E::latestOf(v.security, r).id).identityEpoch == E::identityOf(v.security, r) and
       recordFor(v, E::latestOf(v.security, r).id).reused == E::latestOf(v.security, r).reused)))
pure def alwaysRecordsUnique(v: Vetting): bool =
  v.records.every(r => r.assessment > 0 and v.records.select(o => o.assessment == r.assessment).length() == 1)
pure def stepRecordsRetained(before: Vetting, after: Vetting): bool =
  after.records.length() >= before.records.length() and before.records.every(r => after.records.includes(r))
```

### A reused clean scan never lifts a flag pause

The signed refresh lifts a flag-only pause only when the assessment that
decides each repository, the newest completed one at its live pin
([enforcement](./enforcement.md)), is a fresh clean scan of its own: the
record of every assessment the reinstatement names lifts a flag pause
(clean, not reused, evidence available, no open investigation). A pending
investigation is never that assessment. Each completed clean assessment keeps
a delivered record that qualified it, unless its evidence was last read
missing.

```quint
pure def canReinstateFlagPause(v: Vetting, by: int, pins: List[E::PinRead]): bool =
  E::canReinstateFlagPause(v.security, by, pins)
pure def reinstateFlagPause(v: Vetting, by: int, pins: List[E::PinRead]): Vetting =
  { ...v, security: E::reinstateFlagPause(v.security, by, pins) }
pure def alwaysCompletedCleanHasQualifiedRecord(v: Vetting): bool =
  v.security.recorded.every(a => a.state == E::AClean implies
    (recordFor(v, a.id).result == A::DClean and recordFor(v, a.id).repository == a.repository and
     recordFor(v, a.id).reused == a.reused and not(recordFor(v, a.id).investigationOpen) and
     (recordFor(v, a.id).evidenceAvailable or v.security.unverified.contains(a.id))))
pure def stepFlagPauseLiftsOnlyOnFreshRecords(before: Vetting, via: str, after: Vetting): bool =
  via == "reinstateFlagPause" implies
    before.security.repositories.every(r => E::provenanceOf(after.security).some(id =>
      recordFor(before, id).repository == r and A::liftsFlagPause(recordFor(before, id))))
```

### Requests, flags and the registry mirror run under enforcement's own guards

```quint
pure def canObserveRevision(v: Vetting, by: int, revision: int, steward: int, creator: int): bool =
  E::canObserveRevision(v.security, by, revision, steward, creator)
pure def observeRevision(v: Vetting, by: int, revision: int, steward: int, creator: int): Vetting =
  { ...v, security: E::observeRevision(v.security, by, revision, steward, creator) }
pure def canRequestAssessment(v: Vetting, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int): bool =
  E::canRequestAssessment(v.security, by, repository, requestOrigin, assessmentId) and
  not(v.records.some(r => r.assessment == assessmentId))
pure def requestAssessment(v: Vetting, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int): Vetting =
  { ...v, security: E::requestAssessment(v.security, by, repository, requestOrigin, assessmentId) }
pure def canFlag(v: Vetting, by: int, receipt: int, standing: E::FlagStanding): bool = E::canFlag(v.security, by, receipt, standing)
pure def flag(v: Vetting, by: int, receipt: int, standing: E::FlagStanding): Vetting =
  { ...v, security: E::flag(v.security, by, receipt, standing) }
pure def canObserveIdentity(v: Vetting, by: int, repository: int, identity: int): bool =
  E::canObserveIdentity(v.security, by, repository, identity)
pure def observeIdentity(v: Vetting, by: int, repository: int, identity: int): Vetting =
  { ...v, security: E::observeIdentity(v.security, by, repository, identity) }
```

### Reachable outcomes

```quint
pure def sometimesClearedByScan(v: Vetting): bool = E::cleared(v.security) and E::basis(v.security, 1) == E::Scanned
pure def sometimesUnreadableEvidenceUnverified(v: Vetting): bool =
  E::latestOf(v.security, 1).state == E::AClean and E::clearanceState(v.security, 1) == E::Unverified
pure def sometimesReusedCleanKeepsFlagPause(v: Vetting): bool =
  v.security.restriction == E::FlagQuarantine and E::latestOf(v.security, 1).state == E::AClean and E::latestOf(v.security, 1).reused
pure def sometimesFlagPauseLiftedByFreshScan(v: Vetting): bool =
  v.security.restriction == E::Clear and v.security.journal.some(j => j.kind == E::RecordReinstate)
pure def sometimesEarlierIdentityIgnored(v: Vetting): bool =
  v.records.some(r => r.result == A::DClean and r.identityEpoch == 1) and E::identityOf(v.security, 1) == 2 and
  not(E::repositoryCleared(v.security, 1))
pure val cleanScan: A::Scan = { ...A::initial, phase: A::Recorded, disposition: A::DClean, recorded: A::DClean, retained: true,
  digest: 5, acceptedDigest: 5, sends: 1 }
pure val reusedScan: A::Scan = { ...cleanScan, reused: true, originPermanent: true,
  reuseOrigin: { assessment: 9, repository: 1, identityEpoch: 1, commit: 1 } }
pure val scanValues = Set(cleanScan, reusedScan, { ...cleanScan, assignment: { ...A::queuedAssignment, assessment: 2 } },
  { ...cleanScan, assignment: { ...A::queuedAssignment, assessment: 3 } },
  { ...reusedScan, assignment: { ...A::queuedAssignment, assessment: 2 }, reuseOrigin: { assessment: 9, repository: 1, identityEpoch: 1, commit: 1 } },
  { ...cleanScan, assignment: { ...A::queuedAssignment, assessment: 2, identityEpoch: 2 } },
  { ...cleanScan, investigation: A::InvestigationPending, investigationId: 2 },
  { ...cleanScan, disposition: A::DIncomplete, recorded: A::DIncomplete, retained: false })
pure val readableValues = Set(true, false)
pure val byValues = Set(-1, 0, 1, 2, 3, 5)
pure val revisionValues = Set(1)
pure val stewardValues = Set(1)
pure val creatorValues = Set(1)
pure val repositoryValues = Set(1)
pure val assessmentIdValues = Set(1, 2, 3)
pure val requestOriginValues = Set(E::SetupCheck, E::AdminInvestigation, E::FlagRecovery)
pure val receiptValues = Set(1, 2)
pure val goodStanding: E::FlagStanding = { actor: 2, revision: 1, accountAgeDays: 30, acceptedContributions: 1, maintainer: E::ReadNo, banned: E::ReadNo }
pure val standingValues = Set(goodStanding, { ...goodStanding, actor: 3 })
pure val pinsValues = tuples(0.to(1), 0.to(1), 0.to(1))
  .map(x => List({ repository: x._1, assessment: 1, pin: E::PinMatches }, { repository: x._2, assessment: 2, pin: E::PinMatches },
    { repository: x._3, assessment: 3, pin: E::PinMatches }).select(p => p.repository > 0))
  .union(tuples(1.to(3), 1.to(3)).filter(x => x._1 != x._2)
    .map(x => List({ repository: 1, assessment: x._1, pin: E::PinMatches }, { repository: 1, assessment: x._2, pin: E::PinChanged })))
pure val identityValues = Set(2)
pure val weight_deliver = 6
pure val weight_requestAssessment = 6
pure val weight_flag = 4
pure val weight_reinstateFlagPause = 4
pure val vValues = Set(initial)
```
