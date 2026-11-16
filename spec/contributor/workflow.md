# Live work selection and attributed submission

This model covers PRD sections 1, 4, 5 and 7 and CLAUDE.md "Scope and
contribution rules" and "Installer and attribution", following
`skills/project-contributor-template/SKILL.md`. A selected item is re-read
from GitHub before work and again before submission. Every observation
carries the project's current projection (`frontend/projections.md`
`collected`: listed, not paused, flagged or quarantined) and the repository
policy check: approved MVP scope, the project's contribution instructions and
a private security reporting route. A snapshot alone cannot authorize a
contributor's work. Every contributor event carries the authenticated GitHub
actor (`by`). Merges, closures, reopenings and change requests are GitHub
facts: only the GitHub collector (sender `githubCollector`) delivers them, and
this model never refuses one that GitHub reports for the submitted pull
request. The participation standing comes only from the standing service
(sender `standingService`).

## Story: Ship useful work through the project's repository

A contributor selects bounded unblocked work, proves the result, and opens an
attributed PR. Ordinary submission works independently of skills, wallets,
measured runs, receipts, traces, stars and forks.

### Work selection records blockers, the project projection and live observation epochs

The blockers are the deterministic selection decisions: assigned, maintainer
claim, draft, active review request, approval, changes requested, security
label, human gate, epic, an issue that already has an open closing pull
request, and an item outside approved scope.

```quint
import projections as F from "../frontend/projections"
import prOpened as PO from "./prOpened"
import evidence as E from "./evidence"
import intakeHealth as IH from "../operations/intakeHealth"
type Blocker = Clear | Assigned | MaintainerClaim | DraftPR | ActiveReview | Approved | ChangesRequested
  | SecurityLabel | HumanGate | Epic | LinkedOpenPR | OutsideScope
type ContributionPhase = Browsing | Selected | Working | Tested | Submitted | Accepted | Closed | Stopped
type StopCause = NoStop | RiskFound | ProjectUnavailable
type Inspection = NotInspected | InspectClear | RiskReported | InspectUnavailable
type Closer = NoCloser | MaintainerClose | SlopbotClose | AuthorClose
type PolicyCheck = { approvedScope: bool, instructionsFollowed: bool, privateReportingRoute: bool }
type Observation = { itemId: int, blocker: Blocker, view: F::ProjectView, policy: PolicyCheck, bounded: bool, cleanScan: int }
type GitHubWrite = OpenIssue | DraftIssue | ClaimIssue | PushBranch | StarRepository | ForkRepository
  | MergePullRequest | ClosePullRequest | ApprovePullRequest
type Tools = BrowserOrComputerUse | ShellWithUserApproval | ShellOnly
type Disclosure = { provider: str, model: str, client: str }
type Contribution = { contributor: int, project: int, repository: str, phase: ContributionPhase, stop: StopCause,
  itemId: int, blocker: Blocker, available: bool, policyPermits: bool, bounded: bool,
  liveEpoch: int, selectedEpoch: int, submissionEpoch: int, prNode: str, head: int,
  inspection: Inspection, riskReported: bool, cleanScan: int, riskAtScan: int, provider: str, model: str, client: str, attributionLine: bool,
  usefulResult: bool, testEvidence: bool, banned: bool, credited: bool, closedBy: Closer,
  standingEpoch: int, closures: int, reopenedByMaintainer: bool, appeals: int, changesRequested: bool, runRecorded: bool,
  evidence: E::EvidencePhase, traceReady: bool, writes: List[GitHubWrite], refusedWrites: List[GitHubWrite],
  reviewer: int, reviewerRecommendation: str, reviewCreditable: bool }
pure val githubCollector = -1
pure val standingService = -2
pure val slopServer = -3
pure val initial: Contribution = { contributor: 1, project: 1, repository: "o/r", phase: Browsing, stop: NoStop,
  itemId: 0, blocker: Clear, available: false, policyPermits: false, bounded: false,
  liveEpoch: 0, selectedEpoch: -1, submissionEpoch: -1, prNode: "", head: 0,
  inspection: NotInspected, riskReported: false, cleanScan: 0, riskAtScan: -1, provider: "", model: "", client: "", attributionLine: false,
  usefulResult: false, testEvidence: false, banned: false, credited: false, closedBy: NoCloser,
  standingEpoch: 0, closures: 0, reopenedByMaintainer: false, appeals: 0, changesRequested: false, runRecorded: false,
  evidence: E::Undecided, traceReady: false, writes: List(), refusedWrites: List(), reviewer: 0, reviewerRecommendation: "", reviewCreditable: false }
pure def policyPermits(policy: PolicyCheck): bool = policy.approvedScope and policy.instructionsFollowed and policy.privateReportingRoute
pure def active(c: Contribution): bool = c.phase == Selected or c.phase == Working or c.phase == Tested
```

### Every observation is current, and an unavailable project stops active work

An observation advances the live epoch and replaces the item's blocker, the
project projection, the policy check and the boundedness decision together,
so no earlier eligibility can outlive a later read. A paused, flagged,
quarantined, retired or unlisted project stops selected, in-progress and
tested work. Abandoning an unsubmitted or stopped attempt clears its selected
item, result and test evidence before another work item can be selected. A
banned account cannot start participation (PRD section 8): selecting and
beginning work need clear standing.

```quint
pure def canObserve(c: Contribution, by: int, observation: Observation): bool = by == c.contributor and observation.itemId > 0
  and (c.phase == Browsing or (active(c) and observation.itemId == c.itemId))
pure def observe(c: Contribution, by: int, observation: Observation): Contribution =
  val available = F::collected(observation.view)
  { ...c, itemId: observation.itemId, blocker: observation.blocker, available: available,
    policyPermits: policyPermits(observation.policy), bounded: observation.bounded, liveEpoch: c.liveEpoch + 1,
    cleanScan: if (observation.cleanScan > c.cleanScan) observation.cleanScan else c.cleanScan,
    riskReported: c.riskReported and observation.cleanScan <= c.riskAtScan,
    phase: if (active(c) and not(available)) Stopped else c.phase,
    stop: if (active(c) and not(available)) ProjectUnavailable else c.stop }
pure def eligible(c: Contribution): bool = c.blocker == Clear and c.available and c.policyPermits and c.bounded
pure def canSelectWork(c: Contribution, by: int): bool = by == c.contributor and c.phase == Browsing and c.itemId > 0
  and c.liveEpoch > 0 and eligible(c) and not(c.banned) and not(c.riskReported)
pure def selectWork(c: Contribution, by: int): Contribution = { ...c, phase: Selected, selectedEpoch: c.liveEpoch, inspection: NotInspected }
pure def permitted(c: Contribution): bool = eligible(c) and c.inspection == InspectClear and not(c.riskReported)
pure def canBeginWork(c: Contribution, by: int): bool = by == c.contributor and c.phase == Selected
  and c.selectedEpoch == c.liveEpoch and permitted(c) and not(c.banned)
pure def beginWork(c: Contribution, by: int): Contribution = { ...c, phase: Working }
pure def canRecordTests(c: Contribution, by: int, usefulResult: bool, testEvidence: bool): bool =
  by == c.contributor and c.phase == Working and c.available and usefulResult and testEvidence
pure def recordTests(c: Contribution, by: int, usefulResult: bool, testEvidence: bool): Contribution =
  { ...c, phase: Tested, usefulResult: true, testEvidence: true }
pure def canAbandon(c: Contribution, by: int): bool = by == c.contributor and (active(c) or c.phase == Stopped)
pure def abandon(c: Contribution, by: int): Contribution =
  { ...initial, contributor: c.contributor, project: c.project, repository: c.repository, banned: c.banned,
    standingEpoch: c.standingEpoch, writes: c.writes, refusedWrites: c.refusedWrites, liveEpoch: c.liveEpoch,
    riskReported: c.riskReported, cleanScan: c.cleanScan, riskAtScan: c.riskAtScan }
pure def alwaysStoppedHasCause(c: Contribution): bool = (c.phase == Stopped) iff (c.stop != NoStop)
pure def alwaysActiveSelection(c: Contribution): bool = (active(c) or c.phase == Stopped) implies c.itemId > 0 and c.selectedEpoch >= 0
```

### Suspected malicious code or prompt injection stops the local workflow

PRD section 4 "Skill source and installation": the contributor inspects
malicious-code and prompt-injection risks before execution. After selecting
an item and before beginning work, the contributor reads manifests,
lockfiles, hooks, download commands and agent instruction files. The
inspection is clear, reports a risk, or could not be completed. Only a clear
inspection of the current selection permits work; an unavailable inspection
leaves the item selected and unstarted until it is inspected again or
abandoned. A wallet drainer, credential theft, secret exfiltration, a remote
download piped into a shell, executed obfuscated code or an instruction that
tries to redirect the agent reports a risk, found before or during work. A
reported risk stops the local workflow: nothing is installed, run, worked
around, fixed or submitted. Flagging the project with that evidence is the
contributor's own action on the website (`security/enforcement.md`). The stop
is scoped to the project content inspected: no further work on this project
is selected by this contributor until an observation shows a clean fresh
scan completed after the report (CLAUDE.md "A clean fresh scan reinstates a
project"; the observation's `cleanScan` is the sequence number of the
project's latest clean scan, and that it mirrors the security area is a
composition obligation). Elapsed time, abandoning the attempt or another
observation without a newer clean scan never lifts it.

```quint
pure def canInspectRisk(c: Contribution, by: int, finding: Inspection): bool = by == c.contributor and c.phase == Selected
  and finding != NotInspected
pure def inspectRisk(c: Contribution, by: int, finding: Inspection): Contribution =
  if (finding == RiskReported)
    { ...c, phase: Stopped, stop: RiskFound, inspection: RiskReported, riskReported: true, riskAtScan: c.cleanScan }
  else { ...c, inspection: finding }
pure def canReportRisk(c: Contribution, by: int): bool = by == c.contributor and active(c)
pure def reportRisk(c: Contribution, by: int): Contribution =
  { ...c, phase: Stopped, stop: RiskFound, inspection: RiskReported, riskReported: true, riskAtScan: c.cleanScan }
pure def alwaysWorkFollowsClearInspection(c: Contribution): bool =
  ((c.phase == Working or c.phase == Tested or submitted(c)) implies c.inspection == InspectClear)
  and (c.stop == RiskFound implies c.riskReported) and (c.riskReported implies not(active(c)) and not(submitted(c)))
  and (c.riskReported implies c.riskAtScan >= 0 and c.cleanScan <= c.riskAtScan) and c.cleanScan >= 0
pure def stepStoppedDoesNotProgress(before: Contribution, after: Contribution): bool =
  before.phase == Stopped implies (after.phase == Stopped or after.phase == Browsing)
pure def stepRiskLiftedOnlyByFreshScan(before: Contribution, via: str, after: Contribution): bool =
  (before.riskReported and not(after.riskReported)) implies via == "observe" and after.cleanScan > before.riskAtScan
pure def stepCleanScanMonotone(before: Contribution, after: Contribution): bool = before.cleanScan <= after.cleanScan
```

### The agent never opens, drafts or claims an issue, and never merges, closes or approves

Only owners and maintainers write issues; a defect is reported with a fixing
pull request. A star and a fork use the contributor's own account; a star
needs computer or browser use, and a fork needs it or the user's explicit
approval. Stars and forks never block the work and are never scored or paid.
Every refused write request is recorded as refused.

```quint
pure def permittedWrite(kind: GitHubWrite, tools: Tools): bool = kind == PushBranch
  or (kind == StarRepository and tools == BrowserOrComputerUse)
  or (kind == ForkRepository and (tools == BrowserOrComputerUse or tools == ShellWithUserApproval))
pure def canAgentWrite(c: Contribution, by: int, kind: GitHubWrite, tools: Tools): bool = by == c.contributor
pure def agentWrite(c: Contribution, by: int, kind: GitHubWrite, tools: Tools): Contribution =
  if (permittedWrite(kind, tools)) { ...c, writes: c.writes.append(kind) } else { ...c, refusedWrites: c.refusedWrites.append(kind) }
pure def alwaysNoForbiddenWrite(c: Contribution): bool =
  c.writes.every(w => w == PushBranch or w == StarRepository or w == ForkRepository)
pure def lawIssuesAlwaysRefused(kind: GitHubWrite, tools: Tools): bool =
  (kind == OpenIssue or kind == DraftIssue or kind == ClaimIssue or kind == MergePullRequest
    or kind == ClosePullRequest or kind == ApprovePullRequest) implies not(permittedWrite(kind, tools))
```

### Submission requires exact attribution and a fresh pre-submission read

This machine is a run of the Slop contributor skill, so every submission it
makes is agent work. PRD section 4 "Submission": the pull request includes
`Made via @slopdotcash` once and the exact provider, model and client, and
CLAUDE.md requires every contribution to disclose them. There is no
exemption inside the skill workflow. Manual work without the skill is also
permitted (PRD section 1 "Boundaries"); it is an ordinary GitHub pull request
outside this machine. Attribution can be prepared before submission and stays
immutable after the PR exists.

```quint
pure def canSetAttribution(c: Contribution, by: int, provider: str, model: str, client: str, lineOnce: bool): bool =
  by == c.contributor and (active(c) or c.phase == Browsing) and provider != "" and model != "" and client != "" and lineOnce
pure def setAttribution(c: Contribution, by: int, provider: str, model: str, client: str, lineOnce: bool): Contribution =
  { ...c, provider: provider, model: model, client: client, attributionLine: lineOnce }
pure def canConfirmSubmissionRead(c: Contribution, by: int): bool = by == c.contributor and
  c.phase == Tested and c.liveEpoch > c.selectedEpoch and permitted(c)
pure def confirmSubmissionRead(c: Contribution, by: int): Contribution = { ...c, submissionEpoch: c.liveEpoch }
pure def attributed(c: Contribution): bool = c.provider != "" and c.model != "" and c.client != "" and c.attributionLine
pure def canSubmit(c: Contribution, by: int, prNode: str): bool = by == c.contributor and c.phase == Tested and prNode != "" and
  c.submissionEpoch == c.liveEpoch and c.submissionEpoch > c.selectedEpoch and permitted(c)
  and c.usefulResult and c.testEvidence and attributed(c)
pure def submit(c: Contribution, by: int, prNode: str): Contribution = { ...c, phase: Submitted, prNode: prNode, head: 1 }
pure def submitted(c: Contribution): bool = c.phase == Submitted or c.phase == Accepted or c.phase == Closed
pure def alwaysSubmissionEvidence(c: Contribution): bool =
  submitted(c) implies c.prNode != "" and c.usefulResult and c.testEvidence and c.head > 0
pure def alwaysSubmittedDisclosed(c: Contribution): bool =
  submitted(c) implies c.provider != "" and c.model != "" and c.client != "" and c.attributionLine
pure def stepSubmittedAttributionStable(before: Contribution, after: Contribution): bool =
  submitted(before) implies
    before.provider == after.provider and before.model == after.model and before.client == after.client
    and before.attributionLine == after.attributionLine
    and before.prNode == after.prNode
pure def lawSubmissionIgnoresStarsForksAndRuns(c: Contribution, by: int, prNode: str): bool =
  canSubmit(c, by, prNode) == canSubmit({ ...c, writes: List(), runRecorded: false }, by, prNode)
```

### Trace evidence and private-intake health never block submission

CLAUDE.md "Private traces": declining or failing a trace upload never blocks
submission, and only optional trace collection depends on the renewed
[private-intake observation](../operations/intakeHealth.md). The contributor's
own [evidence decision](./evidence.md) and the intake readiness it last saw
are recorded beside the contribution only to state that independence.

```quint
pure def canObserveEvidence(c: Contribution, by: int, decision: E::EvidencePhase, intake: IH::Observation, checkedAt: int): bool =
  by == c.contributor and checkedAt >= 0
pure def observeEvidence(c: Contribution, by: int, decision: E::EvidencePhase, intake: IH::Observation, checkedAt: int): Contribution =
  { ...c, evidence: decision, traceReady: IH::traceCollectionReadyAt(intake, checkedAt) }
pure def lawSubmissionIgnoresEvidenceAndIntake(c: Contribution, by: int, prNode: str, decision: E::EvidencePhase, ready: bool): bool =
  canSubmit(c, by, prNode) == canSubmit({ ...c, evidence: decision, traceReady: ready }, by, prNode)
pure def sometimesSubmittedWithFailedEvidenceAndStaleIntake(c: Contribution): bool = submitted(c) and not(c.traceReady)
  and (c.evidence == E::Declined or c.evidence == E::UploadFailed)
pure def sometimesSubmittedHumanOnly(c: Contribution): bool = submitted(c) and c.evidence == E::HumanOnly
```

### The submitted PR is merged, closed, reopened or revised, and credit needs clear standing and collection

A change request and a merge are recorded whenever GitHub reports them: a
maintainer may merge while changes are requested, and branch protection is
not a Slop requirement. The contributor may push an update to a submitted
pull request at any time with test evidence; an update answers any open
change request. Any closer, including the author, may see the pull request
reopened; a maintainer reopening stands against Slopbot re-closure
(`slopbot/closure.md`, composition obligation). The author may appeal each
Slopbot closure (`slopbot/appeals.md` triages and bounds appeals). Slopbot
closes only under `slopbot/closure.md`. A merge earns contribution credit only
when the contributor's standing is clear and the collector collected the
project at that merge (`frontend/projections.md` `collected`): a paused,
flagged or quarantined project's repositories are not collected, so nothing
on them reaches the ledger. The standing mirrors the
[access area](../access.md) ban fact for the contributor, ordered by an
increasing epoch (composition obligation). The PR-opened record is the
author's own server run, read only through the
[PR-opened record](./prOpened.md) `participationProof` for this contributor,
project, repository and node, never a marker; the Slop server (sender
`slopServer`) reports it. That the shell supplies the actual stored record
is a composition obligation.

```quint
pure def canObserveStanding(c: Contribution, by: int, actor: int, epoch: int): bool =
  by == standingService and actor == c.contributor and epoch > c.standingEpoch
pure def observeStanding(c: Contribution, by: int, actor: int, epoch: int, banned: bool): Contribution =
  { ...c, banned: banned, standingEpoch: epoch }
pure def canRequestChanges(c: Contribution, by: int): bool = by == githubCollector and c.phase == Submitted
pure def requestChanges(c: Contribution, by: int): Contribution = { ...c, changesRequested: true }
pure def canPushUpdate(c: Contribution, by: int, testEvidence: bool): bool = by == c.contributor and c.phase == Submitted
  and testEvidence and c.head < 9007199254740000
pure def pushUpdate(c: Contribution, by: int, testEvidence: bool): Contribution = { ...c, head: c.head + 1, changesRequested: false }
pure def canRecordMerge(c: Contribution, by: int, view: F::ProjectView): bool = by == githubCollector and c.phase == Submitted
pure def recordMerge(c: Contribution, by: int, view: F::ProjectView): Contribution =
  { ...c, phase: Accepted, credited: not(c.banned) and F::collected(view) }
pure def canRecordClose(c: Contribution, by: int, closer: Closer): bool = by == githubCollector and c.phase == Submitted and closer != NoCloser
  and c.closures < 9007199254740000
pure def recordClose(c: Contribution, by: int, closer: Closer): Contribution =
  { ...c, phase: Closed, closedBy: closer, closures: c.closures + 1, reopenedByMaintainer: false }
pure def canReopen(c: Contribution, by: int, byMaintainer: bool): bool = by == githubCollector and c.phase == Closed
pure def reopen(c: Contribution, by: int, byMaintainer: bool): Contribution =
  { ...c, phase: Submitted, closedBy: NoCloser, reopenedByMaintainer: byMaintainer }
pure def canAppeal(c: Contribution, by: int): bool = by == c.contributor and c.phase == Closed and c.closedBy == SlopbotClose
  and c.appeals < 9007199254740000
pure def appeal(c: Contribution, by: int): Contribution = { ...c, appeals: c.appeals + 1 }
pure def canRecordRun(c: Contribution, by: int, opened: PO::OpenedRun): bool = by == slopServer and submitted(c)
  and PO::alwaysRegisteredIdentity(opened) and PO::alwaysEventsDistinct(opened)
  and PO::participationProof(opened, c.contributor, c.project, c.repository, c.prNode)
pure def recordRun(c: Contribution, by: int, opened: PO::OpenedRun): Contribution = { ...c, runRecorded: true }
pure def alwaysCreditNeedsMerge(c: Contribution): bool = c.credited implies c.phase == Accepted
pure def alwaysClosedHasCloser(c: Contribution): bool = ((c.phase == Closed) iff (c.closedBy != NoCloser))
  and (c.phase == Closed implies c.closures > 0) and c.closures >= 0 and c.appeals >= 0 and c.standingEpoch >= 0
pure def stepCreditNeedsClearStanding(before: Contribution, after: Contribution): bool =
  (not(before.credited) and after.credited) implies not(after.banned)
pure def stepAcceptedFinal(before: Contribution, after: Contribution): bool = before.phase == Accepted implies after.phase == Accepted
  and after.credited == before.credited
pure def stepGitHubFactsFromCollector(before: Contribution, via: str, after: Contribution): bool =
  (before.phase == Submitted and (after.phase == Accepted or after.phase == Closed)) implies via == "recordMerge" or via == "recordClose"
pure def stepStandingFromService(before: Contribution, via: str, after: Contribution): bool =
  before.standingEpoch <= after.standingEpoch and (before.banned != after.banned implies via == "observeStanding")
```

### Reviewer advice records a recommendation without merge or platform authority

The actual reviewer provider, model and client are disclosed in the review
footer, and the recommendation precedes it. The reviewer adapter inspects
correctness, tests, security, evidence, duplication, abuse, scope and
usefulness. A self-review is never creditable. `reviewCreditable` records
only that the reviewer is not the author; the reviewer is another actor whose
standing this machine does not hold, so the points ledger grants review credit
only when that reviewer's standing is also clear at credit time (composition
obligation on the points area).

```quint
pure def canReview(c: Contribution, by: int, recommendation: str, checksComplete: bool, footer: Disclosure): bool =
  c.phase == Submitted and by > 0 and recommendation != "" and checksComplete
    and footer.provider != "" and footer.model != "" and footer.client != ""
pure def review(c: Contribution, by: int, recommendation: str, checksComplete: bool, footer: Disclosure): Contribution =
  { ...c, reviewer: by, reviewerRecommendation: recommendation, reviewCreditable: by != c.contributor }
pure def alwaysNoSelfReviewCredit(c: Contribution): bool = c.reviewCreditable implies c.reviewer != c.contributor and c.reviewer > 0
pure def sometimesSubmittedWithoutRun(c: Contribution): bool = c.phase == Submitted and not(c.runRecorded)
pure def sometimesAccepted(c: Contribution): bool = c.phase == Accepted and c.credited
pure def sometimesAcceptedWithoutCredit(c: Contribution): bool = c.phase == Accepted and not(c.credited)
pure def sometimesAppealed(c: Contribution): bool = c.appeals > 0 and c.phase == Closed
pure def sometimesAppealedAfterSecondClosure(c: Contribution): bool = c.appeals >= 2 and c.closures >= 2 and c.phase == Closed
pure def sometimesReopened(c: Contribution): bool = c.phase == Submitted and c.reopenedByMaintainer
pure def sometimesAuthorCloseReopened(c: Contribution): bool = c.phase == Submitted and c.closures > 0 and not(c.reopenedByMaintainer)
pure def sometimesMergedWhileChangesRequested(c: Contribution): bool = c.phase == Accepted and c.changesRequested
pure def sometimesUncollectedMergeUncredited(c: Contribution): bool = c.phase == Accepted and not(c.credited) and not(c.banned)
pure def sometimesBannedCannotStart(c: Contribution): bool = c.banned and c.phase == Browsing and eligible(c) and c.itemId > 0
pure def sometimesStoppedForRisk(c: Contribution): bool = c.stop == RiskFound
pure def sometimesRiskBlocksReselection(c: Contribution): bool = c.riskReported and c.phase == Browsing and eligible(c)
pure def sometimesReselectedAfterFreshScan(c: Contribution): bool = not(c.riskReported) and c.riskAtScan >= 0
  and c.phase == Selected
pure def sometimesInspectionUnavailable(c: Contribution): bool = c.phase == Selected and c.inspection == InspectUnavailable
pure def sometimesStoppedByProject(c: Contribution): bool = c.stop == ProjectUnavailable
pure def sometimesIssueRefused(c: Contribution): bool = c.refusedWrites.some(w => w == OpenIssue)
pure def sometimesStarred(c: Contribution): bool = c.writes.some(w => w == StarRepository)
pure def sometimesSelfReviewUncredited(c: Contribution): bool = c.reviewerRecommendation != "" and not(c.reviewCreditable)
pure def sometimesRevised(c: Contribution): bool = c.head > 1
pure def sometimesRunRecorded(c: Contribution): bool = c.runRecorded
```

### Samples cover open, paused, flagged and rescanned projects, every sender and each disclosure

```quint
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val goodPolicy: PolicyCheck = { approvedScope: true, instructionsFollowed: true, privateReportingRoute: true }
pure val clearObservation: Observation = { itemId: 1, blocker: Clear, view: openView, policy: goodPolicy, bounded: true,
  cleanScan: 0 }
pure val observationValues = Set(clearObservation, { ...clearObservation, cleanScan: 1 }, { ...clearObservation, blocker: LinkedOpenPR },
  { ...clearObservation, view: { ...openView, paused: true } }, { ...clearObservation, view: { ...openView, flagged: true } },
  { ...clearObservation, policy: { ...goodPolicy, approvedScope: false } }, { ...clearObservation, itemId: 2 })
pure val byValues = Set(1, 2, githubCollector, standingService, slopServer)
pure val actorValues = Set(1, 2)
pure val epochValues = Set(1, 2)
pure val byMaintainerValues = Set(true, false)
pure val viewValues = Set(openView, { ...openView, paused: true })
pure val testedState: Contribution = { ...initial, phase: Tested, itemId: 1, available: true, policyPermits: true, bounded: true,
  liveEpoch: 2, selectedEpoch: 1, submissionEpoch: 2, usefulResult: true, testEvidence: true, inspection: InspectClear,
  provider: "a", model: "a", client: "a", attributionLine: true }
pure val cValues = Set(initial, testedState, { ...testedState, writes: List(StarRepository), runRecorded: true })
pure val clientValues = Set("", "a")
pure val modelValues = Set("", "a")
pure val providerValues = Set("", "a")
pure val prNodeValues = Set("", "PR_a")
pure val recommendationValues = Set("", "a")
pure val footerValues = Set({ provider: "p", model: "m", client: "c" }, { provider: "", model: "m", client: "c" })
pure val openedA: PO::OpenedRun = { ...PO::noOpenedRun, actor: 1, project: 1, repository: "o/r", prNode: "PR_a",
  serverRun: "run-a", events: List(1) }
pure val openedValues = Set(openedA, { ...openedA, actor: 2 }, { ...openedA, events: List() })
pure val decisionValues = Set(E::Declined, E::UploadFailed, E::HumanOnly, E::Stored)
pure val intakeValues = Set(IH::Observed({ enabled: true, verifiedAt: 1 }), IH::NoObservation)
pure val checkedAtValues = Set(2, 86400003)
pure val readyValues = Set(true, false)
pure val weight_observe = 12
pure val weight_selectWork = 40
pure val weight_beginWork = 40
pure val weight_inspectRisk = 40
pure val findingValues = Set(InspectClear, RiskReported, InspectUnavailable)
pure val weight_recordTests = 40
pure val weight_setAttribution = 30
pure val weight_confirmSubmissionRead = 40
pure val weight_submit = 40
pure val weight_recordRun = 5
pure val weight_recordMerge = 20
pure val weight_observeStanding = 2
pure val weight_recordClose = 50
pure val weight_reopen = 50
pure val weight_appeal = 50
pure val weight_review = 20
pure val weight_observeEvidence = 2
pure val weight_requestChanges = 30
pure val weight_pushUpdate = 20
```
