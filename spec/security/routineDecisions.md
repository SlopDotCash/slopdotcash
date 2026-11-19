# Routine decisions on private reports

PRD section 8, operator decision of 17 November 2026, development commit
`e836c892c` (`backend/security/routine-decisions.ts`, migration
`0133_security_routine_decisions.sql`, legacy models
`formal/models/api/api_security_routine_decisions.qnt` and
`formal/models/vetting/qualification_routine_budget.qnt`). The screening
agent decides routine reports; a person still decides every finding it leaves
open, every appeal of a person's decision and every award. This machine holds
one report's [case](./cases.md) and [screening](./screening.md) and supplies
every fact the pass reads from their state. The per-pass and per-day limits,
the run lease, the ranking of the owner's Inbox list across reports and the
release qualification of the routine call with the real provider bound work
and cost; they need adapters and are not modelled here.

## Story: Decide routine reports with an audit record and leave the rest to the owner

> As a program owner, I want duplicates, reports matching the published
> "Does not qualify" list and reports without proof closed with a plain
> reason, so that my Inbox leads with the reports that need me.

### The pass reads only an unappealed undecided report once per case revision and mode

`SECURITY_ROUTINE_DECISIONS` is `off`, `dry_run` or `live`; any other value
is off (`routineMode`). Production starts in `dry_run` and staging `off`;
`live` needs its own reviewed change. The pass reads a case the
[case rule](./cases.md) allows: still received, or with its own request for
proof due or answered by a newer version. A report version still being
screened is not read until 15 minutes after it was saved. Each case revision
gets one final decision per mode, also under overlapping passes. A failed
attempt waits six hours before the next one, three at most. A live decision
applies only to the case revision it read, so a person's action that lands
first wins.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import screening as S from "./screening"
import cases as C from "./cases"
type Mode = Off | DryRun | Live
type Hold = NoHold | LossPlausible | CallsDisagreed | AnalysisUnavailable | GithubAdvisory | ReportNotStored | ProofStillMissing
type Basis = ByDigest | ByTwoCalls | ByClock | ByHold
type Decision = { outcome: C::RoutineOutcome, basis: Basis, hold: Hold, duplicateOf: int, line: int, severity: int }
type RoutineRecord = { mode: Mode, caseRevision: int, reportVersion: int, at: int, decision: Decision, applied: bool }
type FailedAttempt = { mode: Mode, caseRevision: int, at: int }
type Routine = { mode: Mode, privateCase: C::PrivateCase, screening: S::Screening, onGithub: bool, nowMs: int, savedAt: int,
  records: List[RoutineRecord], failures: List[FailedAttempt] }
pure val screeningWaitMs = 900000
pure val unavailableRetryMs = 21600000
pure val maxUnavailableAttempts = 3
pure val receivedCase: C::PrivateCase =
  { ...C::receive(C::initial, C::SlopReceived, T::standardTerms, C::NewReceipt, M::zero, 1), authority: C::staff }
pure val initial: Routine = { mode: DryRun, privateCase: receivedCase, screening: S::initial, onGithub: false,
  nowMs: T::standardTerms.receivedAt, savedAt: T::standardTerms.receivedAt, records: List(), failures: List() }
pure def screeningSettled(r: Routine): bool = (r.screening.phase != S::Queued and r.screening.phase != S::Running)
  or r.nowMs >= r.savedAt + screeningWaitMs
pure def ownsRevision(r: Routine, mode: Mode, caseRevision: int): bool = mode == r.mode and caseRevision == r.privateCase.revision
pure def failuresNow(r: Routine): int = r.failures.select(f => ownsRevision(r, f.mode, f.caseRevision)).length()
pure def readable(r: Routine): bool = r.mode != Off and C::routineReadable(r.privateCase, r.nowMs) and screeningSettled(r)
  and not(r.records.some(d => ownsRevision(r, d.mode, d.caseRevision)))
  and r.failures.every(f => not(ownsRevision(r, f.mode, f.caseRevision)) or r.nowMs - f.at >= unavailableRetryMs)
pure def canSetMode(r: Routine, mode: Mode): bool = mode != r.mode
pure def setMode(r: Routine, mode: Mode): Routine = { ...r, mode: mode }
pure def canAdvance(r: Routine, ms: int): bool = ms > 0
pure def advance(r: Routine, ms: int): Routine = { ...r, nowMs: r.nowMs + ms }
pure def stepOneFinalDecisionPerRevisionAndMode(before: Routine, via: str, after: Routine): bool =
  after.records.length() > before.records.length() implies via == "decideReport"
    and not(before.records.some(d => ownsRevision(before, d.mode, d.caseRevision)))
pure def stepAttemptsBounded(before: Routine, via: str, after: Routine): bool =
  after.failures.length() > before.failures.length() implies via == "failCalls" and failuresNow(before) < maxUnavailableAttempts
pure def stepAuditRecordsRetained(before: Routine, after: Routine): bool =
  before.records.every(d => after.records.includes(d)) and before.failures.every(f => after.failures.includes(f))
```

### Two independent calls must agree before a close, and a plausible loss of funds closes nothing

The two calls are separate requests with the prompt label
`slop-security-routine-decision-1`; the second lists the published lines and
earlier reports in the opposite order. Each names at most an earlier case of
the program, a closing line, whether theft or permanent freezing of funds is
plausible, whether proof is present and a severity. The closing lines are the
receipt-time "Does not qualify" list without its two proof lines and its
duplicate line, which have their own rules (`routineClosingExclusions`); a
receipt without published terms has none. A case or line that was not
supplied makes the answer invalid, which counts as a failed call. In order:
a plausible loss in either call acknowledges; a duplicate or a line named by
one call only is a disagreement; differing proof readings disagree; missing
proof asks once per report, and a later version still without proof goes to
the owner. The ranked severity is the higher of the two.

```quint
type Reading = { lossPlausible: bool, duplicateOf: int, line: int, proofPresent: bool, severity: int }
pure val routineSeparateRuleCount = 3
pure val earlierCases = Set(7, 9)
pure def closingLines(context: T::ExclusionContext): int =
  if (context.defaults == 0) 0 else context.defaults - routineSeparateRuleCount + context.owner.length()
pure def validReading(context: T::ExclusionContext, reading: Reading): bool =
  (reading.duplicateOf == 0 or earlierCases.contains(reading.duplicateOf))
  and reading.line >= 0 and reading.line <= closingLines(context) and reading.severity >= 0 and reading.severity <= 5
pure def held(hold: Hold, basis: Basis, severity: int): Decision =
  { outcome: C::RoutineAcknowledged, basis: basis, hold: hold, duplicateOf: 0, line: 0, severity: severity }
pure def combine(first: Reading, second: Reading, askedBefore: bool): Decision =
  val severity = if (first.severity >= second.severity) first.severity else second.severity
  val agreed = { outcome: C::RoutineAcknowledged, basis: ByTwoCalls, hold: NoHold, duplicateOf: 0, line: 0, severity: severity }
  if (first.lossPlausible or second.lossPlausible) held(LossPlausible, ByHold, severity)
  else if (first.duplicateOf > 0 or second.duplicateOf > 0)
    (if (first.duplicateOf == second.duplicateOf) { ...agreed, outcome: C::RoutineDuplicate, duplicateOf: first.duplicateOf }
      else held(CallsDisagreed, ByHold, severity))
  else if (first.line > 0 or second.line > 0)
    (if (first.line == second.line) { ...agreed, outcome: C::RoutineOutOfScope, line: first.line }
      else held(CallsDisagreed, ByHold, severity))
  else if (first.proofPresent != second.proofPresent) held(CallsDisagreed, ByHold, severity)
  else if (not(first.proofPresent)) (if (askedBefore) held(ProofStillMissing, ByHold, severity) else { ...agreed, outcome: C::RoutineNeedsProof })
  else agreed
pure def lawLossNeverCloses(first: Reading, second: Reading, askedBefore: bool): bool =
  (first.lossPlausible or second.lossPlausible) implies combine(first, second, askedBefore).outcome == C::RoutineAcknowledged
pure def lawCloseNeedsBothCalls(first: Reading, second: Reading, askedBefore: bool): bool =
  val d = combine(first, second, askedBefore)
  (d.outcome == C::RoutineDuplicate implies first.duplicateOf == second.duplicateOf and first.duplicateOf > 0 and d.duplicateOf == first.duplicateOf)
  and (d.outcome == C::RoutineOutOfScope implies first.line == second.line and first.line > 0 and d.line == first.line)
  and (d.outcome == C::RoutineNeedsProof implies not(first.proofPresent) and not(second.proofPresent) and not(askedBefore))
  and d.outcome != C::RoutineNoProof
pure def lawRankNeverUnderstates(first: Reading, second: Reading, askedBefore: bool): bool =
  val d = combine(first, second, askedBefore)
  d.severity >= first.severity and d.severity >= second.severity
pure def lawUnscopedReceiptHasNoClosingLine(t: T::ReceiptTerms): bool = not(t.scoped) implies closingLines(T::receiptExclusions(t)) == 0
```

### Duplicates, published lines and the proof clock close; a report on GitHub and every hold go to the owner

Without a call: an ended clock with no new version closes as no proof
received; a report on GitHub, where Slop cannot read a maintainer's
discussion, is acknowledged even when its clock ended; a report with no
retained version is acknowledged; the same report digest as an earlier case
of the program closes as its duplicate; three failed attempts are
acknowledged. Otherwise the two calls decide. `dry_run` runs every rule,
model calls included, and stores the decision unapplied: no case change, no
event and no notice. `live` applies it to the case, whose reporter reads the
fixed reason and any published line, never model text or another report.

```quint
type Observation = NoCallNeeded | NotStored | SameDigest({ earlier: int }) | Calls({ first: Reading, second: Reading })
pure def withoutCalls(r: Routine): bool = C::routineClockPending(r.privateCase) or r.onGithub
pure def accepts(r: Routine, found: Observation): bool =
  val context = T::receiptExclusions(r.privateCase.terms)
  match found {
    | NoCallNeeded => withoutCalls(r) or failuresNow(r) >= maxUnavailableAttempts
    | NotStored => not(withoutCalls(r))
    | SameDigest(x) => not(withoutCalls(r)) and earlierCases.contains(x.earlier)
    | Calls(x) => not(withoutCalls(r)) and failuresNow(r) < maxUnavailableAttempts and validReading(context, x.first) and validReading(context, x.second)
  }
pure def verdict(r: Routine, found: Observation): Decision =
  if (r.onGithub) held(GithubAdvisory, ByHold, 0)
  else if (C::routineClockPending(r.privateCase))
    { outcome: C::RoutineNoProof, basis: ByClock, hold: NoHold, duplicateOf: 0, line: 0, severity: 0 }
  else match found {
    | NoCallNeeded => held(AnalysisUnavailable, ByHold, 0)
    | NotStored => held(ReportNotStored, ByHold, 0)
    | SameDigest(x) => { outcome: C::RoutineDuplicate, basis: ByDigest, hold: NoHold, duplicateOf: x.earlier, line: 0, severity: 0 }
    | Calls(x) => combine(x.first, x.second, r.privateCase.routine.proofAsked > 0)
  }
pure def canDecideReport(r: Routine, found: Observation): bool = readable(r) and accepts(r, found)
  and (r.mode != Live or C::routineOutcomeAllowed(r.privateCase, verdict(r, found).outcome,
    verdict(r, found).duplicateOf, r.nowMs))
pure def decideReport(r: Routine, found: Observation): Routine =
  val d = verdict(r, found)
  { ...r, records: r.records.append({ mode: r.mode, caseRevision: r.privateCase.revision, reportVersion: r.privateCase.reportVersion,
      at: r.nowMs, decision: d, applied: r.mode == Live }),
    privateCase: if (r.mode == Live) C::routineDecided(d.outcome, r.privateCase, d.duplicateOf, r.nowMs) else r.privateCase }
pure def canFailCalls(r: Routine): bool = readable(r) and not(withoutCalls(r)) and failuresNow(r) < maxUnavailableAttempts
pure def failCalls(r: Routine): Routine =
  { ...r, failures: r.failures.append({ mode: r.mode, caseRevision: r.privateCase.revision, at: r.nowMs }) }
pure def closedNow(c: C::PrivateCase): bool = c.routine.closed
pure def alwaysCaseRoutineMarks(r: Routine): bool = C::alwaysRoutineCloseIsUnappealedRefusal(r.privateCase)
  and C::alwaysRoutineClockOnItsRequest(r.privateCase) and C::alwaysRoutineReturnRecorded(r.privateCase)
pure def alwaysOnlyLiveApplies(r: Routine): bool = r.records.every(d => d.applied == (d.mode == Live))
pure def stepOnlyLiveChangesTheCase(before: Routine, via: str, after: Routine): bool =
  (via == "failCalls" or (via == "decideReport" and before.mode != Live)) implies after.privateCase == before.privateCase
pure def stepRoutineCloseConditions(before: Routine, via: str, after: Routine): bool =
  (closedNow(after.privateCase) and not(closedNow(before.privateCase))) implies via == "decideReport" and before.mode == Live
    and not(before.onGithub) and before.privateCase.appeal == C::NoAppeal and before.privateCase.appealHistory.length() == 0
pure def stepNoProofOnlyAfterTheClock(before: Routine, via: str, after: Routine): bool =
  (via == "decideReport" and after.privateCase.receipt == C::Rejected and before.privateCase.receipt != C::Rejected) implies
    C::routineClockPending(before.privateCase) and before.nowMs >= before.privateCase.routine.proofDueAt
pure def stepRoutineNeverConfirmsOrCommits(before: Routine, via: str, after: Routine): bool =
  (via == "decideReport" or via == "failCalls") implies after.privateCase.receipt != C::Confirmed
    and after.privateCase.deciders == before.privateCase.deciders and not(C::committed(after.privateCase))
    and after.privateCase.grossChosen == before.privateCase.grossChosen
pure def sometimesDryRunRecorded(r: Routine): bool = r.privateCase.receipt == C::Received
  and r.records.some(d => d.mode == DryRun and d.decision.outcome == C::RoutineDuplicate)
pure def sometimesDigestDuplicateClosed(r: Routine): bool = r.privateCase.receipt == C::Duplicate and closedNow(r.privateCase)
  and r.records.some(d => d.applied and d.decision.basis == ByDigest)
pure def sometimesTwoCallDuplicateClosed(r: Routine): bool = r.privateCase.receipt == C::Duplicate
  and r.records.some(d => d.applied and d.decision.basis == ByTwoCalls and d.decision.outcome == C::RoutineDuplicate)
pure def sometimesPublishedLineClosed(r: Routine): bool = r.privateCase.receipt == C::OutOfScope and closedNow(r.privateCase)
pure def sometimesProofRequested(r: Routine): bool = r.privateCase.routine.proofDueAt > 0
pure def sometimesNoProofClosed(r: Routine): bool = r.privateCase.receipt == C::Rejected and closedNow(r.privateCase)
pure def sometimesProofStillMissing(r: Routine): bool = r.records.some(d => d.applied and d.decision.hold == ProofStillMissing)
pure def sometimesLossAcknowledged(r: Routine): bool = r.privateCase.receipt == C::Triaging
  and r.records.some(d => d.applied and d.decision.hold == LossPlausible)
pure def sometimesDisagreementAcknowledged(r: Routine): bool = r.records.some(d => d.applied and d.decision.hold == CallsDisagreed)
pure def sometimesGithubAcknowledged(r: Routine): bool = r.records.some(d => d.applied and d.decision.hold == GithubAdvisory)
pure def sometimesUnavailableAcknowledged(r: Routine): bool = r.records.some(d => d.applied and d.decision.hold == AnalysisUnavailable)
```

### The reporter appeals a routine close once, to the owner, and the pass never reads the report again

A routine close names its plain reason and one appeal. That appeal returns
the report to the program owner untriaged; the owner decides with the
ordinary decision. An appeal of the owner's later decision opens the
moderator path. People act on the composed case as in the
[case machine](./cases.md); the reporter saves a new version as in the
[screening machine](./screening.md) while no copy exists on GitHub. A report
reaches GitHub by forwarding or import ([forwarding](./forwarding.md)).

```quint
pure def epoch(r: Routine): int = r.privateCase.authority.epoch
pure def canRequestInformation(r: Routine, by: int): bool = C::canRequestInformation(r.privateCase, by, epoch(r))
pure def requestInformation(r: Routine, by: int): Routine = { ...r, privateCase: C::requestInformation(r.privateCase, by, epoch(r)) }
pure def canDecide(r: Routine, by: int, decision: C::Decision): bool =
  C::canDecide(r.privateCase, by, epoch(r), r.privateCase.reportVersion, decision)
pure def decide(r: Routine, by: int, decision: C::Decision): Routine =
  { ...r, privateCase: C::decide(r.privateCase, by, epoch(r), r.privateCase.reportVersion, decision) }
pure def canAppeal(r: Routine, by: int): bool = C::routineAppealable(r.privateCase, by) or C::canAppeal(r.privateCase, by)
pure def appeal(r: Routine, by: int): Routine =
  { ...r, privateCase: if (C::routineAppealable(r.privateCase, by)) C::routineReturned(by, r.privateCase) else C::appeal(r.privateCase, by) }
pure def canDecideAppeal(r: Routine, by: int, uphold: bool): bool = C::canDecideAppeal(r.privateCase, by, epoch(r), uphold)
pure def decideAppeal(r: Routine, by: int, uphold: bool): Routine =
  { ...r, privateCase: C::decideAppeal(r.privateCase, by, epoch(r), uphold) }
pure def revisionEvidence(r: Routine, by: int): S::RevisionEvidence = { isReporter: by == r.privateCase.reporter,
  draftOrFailed: not(r.onGithub), noAdvisory: not(r.onGithub), caseNeedsInformation: r.privateCase.receipt == C::NeedsInformation,
  exactCaseCas: true, allowedCaseState: C::canReviseReport(r.privateCase, by, r.screening.version + 1),
  exactObjectStored: true, admitted: true }
pure def canSaveVersion(r: Routine, by: int, digest: str): bool =
  S::canReplace(r.screening, r.screening.revision, digest, revisionEvidence(r, by))
pure def saveVersion(r: Routine, by: int, digest: str): Routine =
  { ...r, screening: S::replace(r.screening, r.screening.revision, digest, revisionEvidence(r, by)),
    privateCase: C::reviseReport(r.privateCase, by, r.screening.version + 1), savedAt: r.nowMs }
pure def canClaimScreening(r: Routine): bool = S::canClaim(r.screening, r.screening.revision, r.nowMs, true)
pure def claimScreening(r: Routine): Routine = { ...r, screening: S::claim(r.screening, r.screening.revision, r.nowMs, true) }
pure def screeningInput(r: Routine, duplicate: bool): S::Input = { exactVersionLoaded: true,
  duplicateEvidence: duplicate, route: S::Surplus, exclusions: T::receiptExclusions(r.privateCase.terms) }
pure def screeningClaim(r: Routine): S::Claim = { revision: r.screening.revision, version: r.screening.version, digest: r.screening.digest }
pure def canFinishScreening(r: Routine, screened: S::Observation, duplicate: bool): bool =
  S::canFinish(r.screening, screeningClaim(r), screeningInput(r, duplicate), screened)
pure def finishScreening(r: Routine, screened: S::Observation, duplicate: bool): Routine =
  { ...r, screening: S::finish(r.screening, screeningClaim(r), screeningInput(r, duplicate), screened) }
pure def canReachGithub(r: Routine): bool = not(r.onGithub)
pure def reachGithub(r: Routine): Routine = { ...r, onGithub: true }
pure def alwaysVersionsAligned(r: Routine): bool = r.privateCase.reportVersion == r.screening.version
pure def stepRoutineAppealReturnsToOwner(before: Routine, via: str, after: Routine): bool =
  (via == "appeal" and closedNow(before.privateCase)) implies after.privateCase.appeal == C::Returned
    and after.privateCase.receipt == C::Triaging and after.privateCase.triage == before.privateCase.triage
    and after.privateCase.routine.returned and not(before.privateCase.routine.returned)
pure def sometimesRoutineAppealReturned(r: Routine): bool = r.privateCase.routine.returned and r.privateCase.appeal == C::Returned
pure def sometimesOwnerDecidedAfterReturn(r: Routine): bool = r.privateCase.routine.returned
  and r.privateCase.appealHistory.length() == 1 and r.privateCase.deciders.length() > 0
pure def sometimesModeratorAfterReturn(r: Routine): bool = r.privateCase.routine.returned and r.privateCase.appeal == C::AppealOpen
```

### Simulation samples

Actor 1 is the reporter, 2 a technical approver and 4 a moderator. The
readings cover clean, loss, duplicate, line and missing-proof answers.

```quint
pure val clean: Reading = { lossPlausible: false, duplicateOf: 0, line: 0, proofPresent: true, severity: 3 }
pure val readingValues = Set(clean, { ...clean, lossPlausible: true, line: 1, severity: 5 }, { ...clean, duplicateOf: 7 },
  { ...clean, duplicateOf: 9 }, { ...clean, line: 1 }, { ...clean, line: 2, severity: 1 }, { ...clean, proofPresent: false, severity: 2 })
pure val foundValues = readingValues.fold(Set(NoCallNeeded, NotStored, SameDigest({ earlier: 7 })), (acc, a) =>
  acc.union(readingValues.map(b => Calls({ first: a, second: b }))))
pure val screenedValues = S::observationValues
pure val firstValues = readingValues
pure val secondValues = readingValues
pure val askedBeforeValues = Set(true, false)
pure val modeValues = Set(Off, DryRun, Live)
pure val msValues = Set(900000, 21600000, 1209600000)
pure val byValues = Set(1, 2, 4)
pure val digestValues = Set("revised", "again")
pure val upholdValues = Set(true, false)
pure val decisionValues = Set(
  { finding: C::Rejected, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0, duplicateOf: 0, declareRelated: false },
  { finding: C::Confirmed, severity: T::High, loss: T::NotVerified, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false })
pure val weight_decideReport = 30
pure val weight_failCalls = 4
pure val weight_setMode = 6
pure val weight_advance = 6
pure val weight_appeal = 8
pure val weight_decide = 4
pure val weight_finishScreening = 8
pure val weight_claimScreening = 8
```
