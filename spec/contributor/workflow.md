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
actor (`by`); merges, closures, reopenings and review requests are GitHub
observations delivered by the shell.

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
import traceServer as TS from "./traceServer"
type Blocker = Clear | Assigned | MaintainerClaim | DraftPR | ActiveReview | Approved | ChangesRequested
  | SecurityLabel | HumanGate | Epic | LinkedOpenPR | OutsideScope
type ContributionPhase = Browsing | Selected | Working | Tested | Submitted | Accepted | Closed | Stopped
type StopCause = NoStop | RiskFound | ProjectUnavailable
type Closer = NoCloser | MaintainerClose | SlopbotClose | AuthorClose
type PolicyCheck = { approvedScope: bool, instructionsFollowed: bool, privateReportingRoute: bool }
type Observation = { itemId: int, blocker: Blocker, view: F::ProjectView, policy: PolicyCheck, bounded: bool }
type GitHubWrite = OpenIssue | DraftIssue | ClaimIssue | PushBranch | StarRepository | ForkRepository
  | MergePullRequest | ClosePullRequest | ApprovePullRequest
type Tools = BrowserOrComputerUse | ShellWithUserApproval | ShellOnly
type Disclosure = { provider: str, model: str, client: str }
type Contribution = { contributor: int, project: int, repository: str, phase: ContributionPhase, stop: StopCause,
  itemId: int, blocker: Blocker, available: bool, policyPermits: bool, bounded: bool,
  liveEpoch: int, selectedEpoch: int, submissionEpoch: int, prNode: str, head: int,
  agentAssisted: bool, provider: str, model: str, client: str, attributionLine: bool,
  usefulResult: bool, testEvidence: bool, banned: bool, credited: bool, closedBy: Closer,
  maintainerReopened: bool, appealed: bool, changesRequested: bool, runRecorded: bool,
  writes: List[GitHubWrite], refusedWrites: List[GitHubWrite],
  reviewer: int, reviewerRecommendation: str, reviewCredit: bool }
pure val initial: Contribution = { contributor: 1, project: 1, repository: "o/r", phase: Browsing, stop: NoStop,
  itemId: 0, blocker: Clear, available: false, policyPermits: false, bounded: false,
  liveEpoch: 0, selectedEpoch: -1, submissionEpoch: -1, prNode: "", head: 0,
  agentAssisted: false, provider: "", model: "", client: "", attributionLine: false,
  usefulResult: false, testEvidence: false, banned: false, credited: false, closedBy: NoCloser,
  maintainerReopened: false, appealed: false, changesRequested: false, runRecorded: false,
  writes: List(), refusedWrites: List(), reviewer: 0, reviewerRecommendation: "", reviewCredit: false }
pure def policyPermits(policy: PolicyCheck): bool = policy.approvedScope and policy.instructionsFollowed and policy.privateReportingRoute
pure def active(c: Contribution): bool = c.phase == Selected or c.phase == Working or c.phase == Tested
```

### Every observation is current, and an unavailable project stops active work

An observation advances the live epoch and replaces the item's blocker, the
project projection, the policy check and the boundedness decision together,
so no earlier eligibility can outlive a later read. A paused, flagged,
quarantined, retired or unlisted project stops selected, in-progress and
tested work. Abandoning an unsubmitted or stopped attempt clears its selected
item, result and test evidence before another work item can be selected.

```quint
pure def canObserve(c: Contribution, by: int, observation: Observation): bool = by == c.contributor and observation.itemId > 0
  and (c.phase == Browsing or (active(c) and observation.itemId == c.itemId))
pure def observe(c: Contribution, by: int, observation: Observation): Contribution =
  val available = F::collected(observation.view)
  { ...c, itemId: observation.itemId, blocker: observation.blocker, available: available,
    policyPermits: policyPermits(observation.policy), bounded: observation.bounded, liveEpoch: c.liveEpoch + 1,
    phase: if (active(c) and not(available)) Stopped else c.phase,
    stop: if (active(c) and not(available)) ProjectUnavailable else c.stop }
pure def eligible(c: Contribution): bool = c.blocker == Clear and c.available and c.policyPermits and c.bounded
pure def canSelectWork(c: Contribution, by: int): bool = by == c.contributor and c.phase == Browsing and c.itemId > 0
  and c.liveEpoch > 0 and eligible(c)
pure def selectWork(c: Contribution, by: int): Contribution = { ...c, phase: Selected, selectedEpoch: c.liveEpoch }
pure def canBeginWork(c: Contribution, by: int): bool = by == c.contributor and c.phase == Selected
  and c.selectedEpoch == c.liveEpoch and eligible(c)
pure def beginWork(c: Contribution, by: int): Contribution = { ...c, phase: Working }
pure def canRecordTests(c: Contribution, by: int, usefulResult: bool, testEvidence: bool): bool =
  by == c.contributor and c.phase == Working and c.available and usefulResult and testEvidence
pure def recordTests(c: Contribution, by: int, usefulResult: bool, testEvidence: bool): Contribution =
  { ...c, phase: Tested, usefulResult: true, testEvidence: true }
pure def canAbandon(c: Contribution, by: int): bool = by == c.contributor and (active(c) or c.phase == Stopped)
pure def abandon(c: Contribution, by: int): Contribution =
  { ...initial, contributor: c.contributor, project: c.project, repository: c.repository, banned: c.banned,
    writes: c.writes, refusedWrites: c.refusedWrites, liveEpoch: c.liveEpoch }
pure def alwaysStoppedHasCause(c: Contribution): bool = (c.phase == Stopped) iff (c.stop != NoStop)
pure def alwaysActiveSelection(c: Contribution): bool = (active(c) or c.phase == Stopped) implies c.itemId > 0 and c.selectedEpoch >= 0
```

### Suspected malicious code or prompt injection stops the local workflow

The contributor reads manifests, lockfiles, hooks, download commands and
agent instruction files before running them. A wallet drainer, credential
theft, secret exfiltration, a remote download piped into a shell, executed
obfuscated code or an instruction that tries to redirect the agent stops the
local workflow: nothing is installed, run, worked around or fixed. Flagging
the project with that evidence is the contributor's own action on the
website (`security/enforcement.md`).

```quint
pure def canReportRisk(c: Contribution, by: int): bool = by == c.contributor and active(c)
pure def reportRisk(c: Contribution, by: int): Contribution = { ...c, phase: Stopped, stop: RiskFound }
pure def stepStoppedDoesNotProgress(before: Contribution, after: Contribution): bool =
  before.phase == Stopped implies (after.phase == Stopped or after.phase == Browsing)
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

The Slop attribution line occurs once in an agent submission. The exact
provider, model and client name remain attached to the contribution.
Attribution can be prepared before submission and stays immutable after the
PR exists. A human who did not use an agent declares a human-only
contribution and uploads no agent trace (`evidence.md` `HumanOnly`).

```quint
pure def canSetAttribution(c: Contribution, by: int, provider: str, model: str, client: str, agentAssisted: bool, lineOnce: bool): bool =
  by == c.contributor and (active(c) or c.phase == Browsing) and
  (not(agentAssisted) or (provider != "" and model != "" and client != "" and lineOnce))
pure def setAttribution(c: Contribution, by: int, provider: str, model: str, client: str, agentAssisted: bool, lineOnce: bool): Contribution =
  { ...c, provider: provider, model: model, client: client, agentAssisted: agentAssisted, attributionLine: lineOnce }
pure def canConfirmSubmissionRead(c: Contribution, by: int): bool = by == c.contributor and
  c.phase == Tested and c.liveEpoch > c.selectedEpoch and eligible(c)
pure def confirmSubmissionRead(c: Contribution, by: int): Contribution = { ...c, submissionEpoch: c.liveEpoch }
pure def attributed(c: Contribution): bool = not(c.agentAssisted) or (c.provider != "" and c.model != "" and c.client != "" and c.attributionLine)
pure def canSubmit(c: Contribution, by: int, prNode: str): bool = by == c.contributor and c.phase == Tested and prNode != "" and
  c.submissionEpoch == c.liveEpoch and c.submissionEpoch > c.selectedEpoch and eligible(c)
  and c.usefulResult and c.testEvidence and attributed(c)
pure def submit(c: Contribution, by: int, prNode: str): Contribution = { ...c, phase: Submitted, prNode: prNode, head: 1 }
pure def submitted(c: Contribution): bool = c.phase == Submitted or c.phase == Accepted or c.phase == Closed
pure def alwaysSubmissionEvidence(c: Contribution): bool =
  submitted(c) implies c.prNode != "" and c.usefulResult and c.testEvidence and attributed(c) and c.head > 0
pure def stepSubmittedAttributionStable(before: Contribution, after: Contribution): bool =
  submitted(before) implies
    before.provider == after.provider and before.model == after.model and before.client == after.client
    and before.agentAssisted == after.agentAssisted and before.attributionLine == after.attributionLine
    and before.prNode == after.prNode
pure def lawSubmissionIgnoresStarsForksAndRuns(c: Contribution, by: int, prNode: str): bool =
  canSubmit(c, by, prNode) == canSubmit({ ...c, writes: List(), runRecorded: false }, by, prNode)
```

### The submitted PR is merged, closed, reopened or revised, and credit needs clear standing

Changes requested on the current head are answered by a pushed update.
Maintainers decide acceptance; Slopbot closes only under
`slopbot/closure.md`, and the author may appeal a Slopbot closure
(`slopbot/appeals.md`). A maintainer reopening stands. A banned account earns
no new contribution or review credit: the standing mirrors the
[access area](../access.md) ban fact for the contributor (composition
obligation). The PR-opened record is the author's own server run
(`traceServer.md` `recordedSkillRun`), never a marker.

```quint
pure def observeStanding(c: Contribution, banned: bool): Contribution = { ...c, banned: banned }
pure def canRequestChanges(c: Contribution): bool = c.phase == Submitted and not(c.changesRequested)
pure def requestChanges(c: Contribution): Contribution = { ...c, changesRequested: true }
pure def canPushUpdate(c: Contribution, by: int, testEvidence: bool): bool = by == c.contributor and c.phase == Submitted
  and c.changesRequested and testEvidence and c.head < 9007199254740000
pure def pushUpdate(c: Contribution, by: int, testEvidence: bool): Contribution = { ...c, head: c.head + 1, changesRequested: false }
pure def canRecordMerge(c: Contribution): bool = c.phase == Submitted and not(c.changesRequested)
pure def recordMerge(c: Contribution): Contribution = { ...c, phase: Accepted, credited: not(c.banned) }
pure def canRecordClose(c: Contribution, closer: Closer): bool = c.phase == Submitted and closer != NoCloser
pure def recordClose(c: Contribution, closer: Closer): Contribution = { ...c, phase: Closed, closedBy: closer }
pure def canReopen(c: Contribution): bool = c.phase == Closed and c.closedBy != AuthorClose
pure def reopen(c: Contribution): Contribution = { ...c, phase: Submitted, closedBy: NoCloser, maintainerReopened: true }
pure def canAppeal(c: Contribution, by: int): bool = by == c.contributor and c.phase == Closed and c.closedBy == SlopbotClose and not(c.appealed)
pure def appeal(c: Contribution, by: int): Contribution = { ...c, appealed: true }
pure def canRecordRun(c: Contribution, traceRun: TS::TraceServer): bool = submitted(c)
  and TS::recordedSkillRun(traceRun, c.contributor, c.project, c.repository, c.prNode)
pure def recordRun(c: Contribution, traceRun: TS::TraceServer): Contribution = { ...c, runRecorded: true }
pure def alwaysCreditNeedsMerge(c: Contribution): bool = c.credited implies c.phase == Accepted
pure def alwaysClosedHasCloser(c: Contribution): bool = (c.phase == Closed) iff (c.closedBy != NoCloser)
pure def stepCreditNeedsClearStanding(before: Contribution, after: Contribution): bool =
  (not(before.credited) and after.credited) implies not(after.banned)
pure def stepAcceptedFinal(before: Contribution, after: Contribution): bool = before.phase == Accepted implies after.phase == Accepted
```

### Reviewer advice records a recommendation without merge or platform authority

The actual reviewer provider, model and client are disclosed in the review
footer, and the recommendation precedes it. The reviewer adapter inspects
correctness, tests, security, evidence, duplication, abuse, scope and
usefulness. A self-review earns no review credit, and neither does a banned
reviewer (points area, composition obligation).

```quint
pure def canReview(c: Contribution, by: int, recommendation: str, checksComplete: bool, footer: Disclosure): bool =
  c.phase == Submitted and by > 0 and recommendation != "" and checksComplete
    and footer.provider != "" and footer.model != "" and footer.client != ""
pure def review(c: Contribution, by: int, recommendation: str, checksComplete: bool, footer: Disclosure): Contribution =
  { ...c, reviewer: by, reviewerRecommendation: recommendation, reviewCredit: by != c.contributor }
pure def alwaysNoSelfReviewCredit(c: Contribution): bool = c.reviewCredit implies c.reviewer != c.contributor and c.reviewer > 0
pure def sometimesSubmittedWithoutRun(c: Contribution): bool = c.phase == Submitted and not(c.runRecorded)
pure def sometimesAccepted(c: Contribution): bool = c.phase == Accepted and c.credited
pure def sometimesAcceptedWithoutCredit(c: Contribution): bool = c.phase == Accepted and not(c.credited)
pure def sometimesAppealed(c: Contribution): bool = c.appealed and c.phase == Closed
pure def sometimesReopened(c: Contribution): bool = c.phase == Submitted and c.maintainerReopened
pure def sometimesStoppedForRisk(c: Contribution): bool = c.stop == RiskFound
pure def sometimesStoppedByProject(c: Contribution): bool = c.stop == ProjectUnavailable
pure def sometimesIssueRefused(c: Contribution): bool = c.refusedWrites.includes(OpenIssue)
pure def sometimesStarred(c: Contribution): bool = c.writes.includes(StarRepository)
pure def sometimesSelfReviewUncredited(c: Contribution): bool = c.reviewerRecommendation != "" and not(c.reviewCredit)
pure def sometimesRevised(c: Contribution): bool = c.head > 1
pure def sometimesRunRecorded(c: Contribution): bool = c.runRecorded
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val goodPolicy: PolicyCheck = { approvedScope: true, instructionsFollowed: true, privateReportingRoute: true }
pure val clearObservation: Observation = { itemId: 1, blocker: Clear, view: openView, policy: goodPolicy, bounded: true }
pure val observationValues = Set(clearObservation, { ...clearObservation, blocker: LinkedOpenPR },
  { ...clearObservation, view: { ...openView, paused: true } }, { ...clearObservation, view: { ...openView, flagged: true } },
  { ...clearObservation, policy: { ...goodPolicy, approvedScope: false } }, { ...clearObservation, itemId: 2 })
pure val byValues = Set(1, 2)
pure val testedState: Contribution = { ...initial, phase: Tested, itemId: 1, available: true, policyPermits: true, bounded: true,
  liveEpoch: 2, selectedEpoch: 1, submissionEpoch: 2, usefulResult: true, testEvidence: true }
pure val cValues = Set(initial, testedState, { ...testedState, writes: List(StarRepository), runRecorded: true })
pure val clientValues = Set("", "a")
pure val modelValues = Set("", "a")
pure val providerValues = Set("", "a")
pure val prNodeValues = Set("", "PR_a")
pure val recommendationValues = Set("", "a")
pure val footerValues = Set({ provider: "p", model: "m", client: "c" }, { provider: "", model: "m", client: "c" })
pure val runA: TS::TraceServer = { ...TS::initial, owner: 1, createKey: "k", state: TS::AwaitingTrace,
  request: { ...TS::requestA, project: 1, repository: "o/r" },
  events: List({ key: "e", kind: TS::PullRequestOpened, source: TS::AgentSource, occurredAt: 0, githubObject: "PR_a", recordedAt: 0 }) }
pure val traceRunValues = Set(runA, { ...runA, owner: 2 }, { ...runA, events: List() })
pure val weight_observe = 6
pure val weight_selectWork = 15
pure val weight_beginWork = 15
pure val weight_recordTests = 10
pure val weight_setAttribution = 6
pure val weight_confirmSubmissionRead = 10
pure val weight_submit = 10
pure val weight_recordRun = 5
pure val weight_recordMerge = 5
pure val weight_review = 5
```
