# Maintainer agent workflow

PRD section 3 "Maintainer agent entry" (owner request, 13 November 2026, at
development `7acb6d13c`) adds one canonical global maintainer skill beside
the contributor skill, introduced by development `52fc7cd79`
(`skills/slop/SKILL.md` and `skills/slop-maintainer/SKILL.md`). Their
publication, digests and discovery entries are the [global skill
story](./publication.md) ("Publish the three global skills and agent
discovery files from one source"); the Home switch that offers
`/maintain/SKILL.md` is the [presentation](../frontend/presentation.md)
story "Choose the contributor or maintainer journey on Home". This spec
owns what the entry skill routes and what one maintainer skill session may
do. Choosing Maintainer is an intent, never proof of authority. The skill adds
no terminal login, API token, background service or payment signer.

## Story: The entry skill routes by the requested task

> As an agent user, I want `/SKILL.md` to load the workflow my task needs, so
> that write access alone never turns contribution into maintenance.

### An explicit task selects its skill, a researcher's finding stays with the contributor, and only a missing intent asks

Finding work, contributing a fix, earning review credit, installing a
project skill and reporting a security finding privately load the
contributor skill. Adding or resuming a project, maintaining its rules,
reviewing incoming work, repairing CI, managing authorized private cases or
rewards, removing a project and cancelling a pending application load the
maintainer skill. A maintainer reporting a finding as a researcher still uses
the contributor workflow. When the request names neither journey, the skill
asks once, "Contribute or maintain a project?", unless the user already chose
one. The route reads no repository permission, so write access cannot change
it. The skills it loads are the published `slop-contributor` and
`slop-maintainer` roles at `/contribute/SKILL.md` and `/maintain/SKILL.md`,
the addresses the Home switch offers.

```quint
type MaintainerTask = NoTask | AddOrResume | MaintainRules | ReviewIncoming | RepairCI | ManageCases
  | ManageRewards | RemoveProject | CancelApplication
type ContributorTask = NoContribution | FindWork | ContributeFix | EarnReviewCredit | InstallProjectSkill | ReportFinding
type Chosen = NoneChosen | ChoseContributor | ChoseMaintainer
type EntryRoute = ToContributor | ToMaintainer | AskOnce
pure def route(contribution: ContributorTask, maintenance: MaintainerTask, chosen: Chosen): EntryRoute =
  if (contribution != NoContribution) ToContributor
  else if (maintenance != NoTask) ToMaintainer
  else if (chosen == ChoseContributor) ToContributor
  else if (chosen == ChoseMaintainer) ToMaintainer
  else AskOnce
pure def lawFindingStaysWithContributor(maintenance: MaintainerTask, chosen: Chosen): bool =
  route(ReportFinding, maintenance, chosen) == ToContributor
pure def lawOnlyMissingIntentAsks(contribution: ContributorTask, maintenance: MaintainerTask, chosen: Chosen): bool =
  (route(contribution, maintenance, chosen) == AskOnce)
    iff (contribution == NoContribution and maintenance == NoTask and chosen == NoneChosen)
pure def lawMaintenanceTaskLoadsTheMaintainerSkill(maintenance: MaintainerTask, chosen: Chosen): bool =
  maintenance != NoTask implies route(NoContribution, maintenance, chosen) == ToMaintainer
```

## Story: Carry out the maintainer's task under current authority

> As a maintainer, I want my agent to do the task I asked for through GitHub
> and the Slop website, so that nothing it does exceeds what my account may
> do now.

### The session works on one requested task and one repository matched by its permanent ID

The agent uses the repository the user named or the current checkout's
remote and matches its permanent numeric ID to the public project registry,
since names change; an ambiguous target is asked about, never guessed, and a
renamed repository never becomes a second project. Every action must serve
the requested task: a review or CI request is not a full audit, unrelated
maintenance or a new registration. The user (sender `user`) states the task;
the agent (sender `agent`) acts; current GitHub and Slop answers come only
from the authority service (sender `authorityService`).

```quint
type Permission = RepoWrite | Steward | CaseAccess | Applicant
type SiteAction = RunSetupCheck | PublishRevision | ReadCase | RecordDecision | AdjustAllocation
  | FinalizeAllocation | RemoveListing | CancelPending | ClearRestriction | ChangeClosureConsent
  | ChangeFundingRequirement | ChangePaymentPolicy | ActivateProduction | SignTransfer
type RepoAction = PushFix | PostReview | FileIssue | MergePR | ReleaseOrDeploy | SelfApprove
type Decision = NoDecision | TechnicalAcceptance | BountyAward | FinancialApproval | EscalatedDispute | Ban | Disclosure
type SessionSource = SlopBrowserSession | GitHubCli | PastedToken | CopiedCookie
type Outcome = Applied | Uncertain | Refused
type MaintainerPhase = Idle | Resolving | Working | Finished
type MaintainerSession = { phase: MaintainerPhase, task: MaintainerTask, repositoryId: int, browser: bool,
  accountEpoch: int, verified: Permission -> int, slopSession: bool, privateView: bool, restricted: bool,
  decisions: List[Decision], authorizedWrites: List[RepoAction], pending: SiteAction, uncertain: bool, readBacks: int,
  applied: List[SiteAction], prepared: List[SiteAction], repoWrites: List[RepoAction], refused: int }
pure val user = 1
pure val agent = 2
pure val authorityService = -1
pure val initial: MaintainerSession = { phase: Idle, task: NoTask, repositoryId: 0, browser: false,
  accountEpoch: 0, verified: Map(), slopSession: false, privateView: false, restricted: false,
  decisions: List(), authorizedWrites: List(), pending: RunSetupCheck, uncertain: false, readBacks: 0,
  applied: List(), prepared: List(), repoWrites: List(), refused: 0 }
pure def canRequestTask(s: MaintainerSession, by: int, task: MaintainerTask, browser: bool): bool =
  by == user and s.phase == Idle and task != NoTask
pure def requestTask(s: MaintainerSession, by: int, task: MaintainerTask, browser: bool): MaintainerSession =
  { ...s, phase: Resolving, task: task, browser: browser, slopSession: s.slopSession and browser,
    privateView: s.privateView and browser }
pure def canResolveRepository(s: MaintainerSession, by: int, repositoryId: int, ambiguous: bool): bool =
  by == agent and s.phase == Resolving
pure def resolveRepository(s: MaintainerSession, by: int, repositoryId: int, ambiguous: bool): MaintainerSession =
  if (ambiguous or repositoryId <= 0) { ...s, phase: Idle, task: NoTask }
  else { ...s, phase: Working, repositoryId: repositoryId }
pure def siteServes(task: MaintainerTask, act: SiteAction): bool =
  if (task == AddOrResume) Set(RunSetupCheck, PublishRevision).contains(act)
  else if (task == MaintainRules) act == PublishRevision
  else if (task == ManageCases) Set(ReadCase, RecordDecision).contains(act)
  else if (task == ManageRewards) Set(AdjustAllocation, FinalizeAllocation, RecordDecision).contains(act)
  else if (task == RemoveProject) act == RemoveListing
  else if (task == CancelApplication) act == CancelPending
  else false
pure def repoServes(task: MaintainerTask, act: RepoAction): bool =
  act != SelfApprove and Set(ReviewIncoming, RepairCI, MaintainRules).contains(task)
pure def lawEntryFlowServesNoPolicyChange(task: MaintainerTask): bool =
  Set(ClearRestriction, ChangeClosureConsent, ChangeFundingRequirement, ChangePaymentPolicy, ActivateProduction, SignTransfer)
    .forall(a => not(siteServes(task, a)))
pure def alwaysWorkHasOneMatchedRepository(s: MaintainerSession): bool =
  (s.phase == Working or s.phase == Finished) implies (s.repositoryId > 0 and s.task != NoTask)
pure def sometimesAmbiguousTargetAsked(s: MaintainerSession): bool = s.phase == Idle and s.browser
```

### Each sensitive action needs its own permission, freshly checked for the current account

Repository write access, project stewardship (the steward or repository
admin), private-case access and applicant standing are different
permissions; unavailable proof is not permission. Each check is recorded
with the account epoch it was made under, and an action needs its permission
verified under the current one. An account change advances the epoch, ends
the Slop session and discards any private case view. Only the existing
authenticated Slop website, in a browser, is a Slop session: GitHub CLI
authentication, a pasted token or a copied cookie never is. Write or maintain
permission may read a month and prepare its commitment; changing or
finalizing an allocation needs stewardship, and nobody changes their own
allocation. A restriction (pause, quarantine or ban) is set only by the
authority service; no maintainer action clears it.

```quint
pure def required(act: SiteAction): Permission =
  if (act == ReadCase or act == RecordDecision) CaseAccess
  else if (act == CancelPending) Applicant
  else Steward
pure def holds(s: MaintainerSession, p: Permission): bool = s.verified.getOr(p, -1) == s.accountEpoch
pure def countsAsSlopSession(via: SessionSource): bool = via == SlopBrowserSession
pure def canCheckPermission(s: MaintainerSession, by: int, p: Permission, granted: bool): bool = by == authorityService
pure def checkPermission(s: MaintainerSession, by: int, p: Permission, granted: bool): MaintainerSession =
  { ...s, verified: s.verified.put(p, if (granted) s.accountEpoch else -1),
    privateView: s.privateView and (p != CaseAccess or granted) }
pure def canConfirmSession(s: MaintainerSession, by: int, via: SessionSource): bool = by == authorityService
pure def confirmSession(s: MaintainerSession, by: int, via: SessionSource): MaintainerSession =
  { ...s, slopSession: countsAsSlopSession(via) and s.browser, privateView: s.privateView and countsAsSlopSession(via) and s.browser }
pure def canChangeAccount(s: MaintainerSession, by: int): bool = by == authorityService
pure def changeAccount(s: MaintainerSession, by: int): MaintainerSession =
  { ...s, accountEpoch: s.accountEpoch + 1, slopSession: false, privateView: false }
pure def canObserveRestriction(s: MaintainerSession, by: int, restricted: bool): bool = by == authorityService
pure def observeRestriction(s: MaintainerSession, by: int, restricted: bool): MaintainerSession = { ...s, restricted: restricted }
pure def lawOnlyTheWebsiteIsASlopSession(via: SessionSource): bool = countsAsSlopSession(via) iff via == SlopBrowserSession
pure def alwaysPrivateViewIsCurrent(s: MaintainerSession): bool =
  s.privateView implies (holds(s, CaseAccess) and s.slopSession)
pure def alwaysSessionNeedsBrowser(s: MaintainerSession): bool = s.slopSession implies s.browser
pure def stepRestrictionClearedOnlyByAuthority(before: MaintainerSession, via: str, after: MaintainerSession): bool =
  (before.restricted and not(after.restricted)) implies via == "observeRestriction"
pure def sometimesAccountChangeDiscardedCase(s: MaintainerSession): bool =
  s.accountEpoch > 0 and s.applied.includes(ReadCase) and not(s.privateView)
```

### Website actions run through existing controls; without a browser they are only prepared

A website action needs the browser, a current Slop session, the action's
permission under the current account, a task it serves and, for a recorded
decision, the human decision itself. Technical acceptance, bounty awards,
financial approval, escalated disputes, bans and disclosure are decisions
only a human (sender `user`) gives; the agent records a given one and never
makes one from a model recommendation. A setup check may queue a scan or
activate the project, so it is a write like any other. An action whose
outcome is unknown blocks every further website action until the agent reads
the resulting record, so a missing response never repeats a create, decision
or payment. Without browser tools the agent prepares the exact remaining
step and never reports it as published. Signing, transfers, restriction
removal, closure consent, funding requirements, payment policy and
production activation are never actions of this flow.

```quint
pure def canGiveDecision(s: MaintainerSession, by: int, d: Decision): bool = by == user and d != NoDecision
pure def giveDecision(s: MaintainerSession, by: int, d: Decision): MaintainerSession =
  { ...s, decisions: s.decisions.append(d) }
pure def mayAct(s: MaintainerSession, act: SiteAction, decision: Decision, ownRecord: bool): bool =
  siteServes(s.task, act) and holds(s, required(act)) and s.slopSession and s.browser
    and (act != RecordDecision or s.decisions.includes(decision))
    and not(ownRecord and (act == AdjustAllocation or act == FinalizeAllocation))
pure def canSiteAct(s: MaintainerSession, by: int, act: SiteAction, decision: Decision, ownRecord: bool, answer: Outcome): bool =
  by == agent and s.phase == Working and not(s.uncertain) and s.browser
pure def siteAct(s: MaintainerSession, by: int, act: SiteAction, decision: Decision, ownRecord: bool, answer: Outcome): MaintainerSession =
  if (not(mayAct(s, act, decision, ownRecord)) or answer == Refused) { ...s, refused: s.refused + 1 }
  else if (answer == Uncertain) { ...s, uncertain: true, pending: act }
  else { ...s, applied: s.applied.append(act), privateView: s.privateView or act == ReadCase }
pure def canReadBack(s: MaintainerSession, by: int, wasApplied: bool): bool = by == agent and s.uncertain
pure def readBack(s: MaintainerSession, by: int, wasApplied: bool): MaintainerSession =
  { ...s, uncertain: false, readBacks: s.readBacks + 1, applied: if (wasApplied) s.applied.append(s.pending) else s.applied,
    privateView: s.privateView or (wasApplied and s.pending == ReadCase and holds(s, CaseAccess) and s.slopSession) }
pure def canPrepare(s: MaintainerSession, by: int, act: SiteAction): bool =
  by == agent and s.phase == Working and not(s.browser) and siteServes(s.task, act)
pure def prepare(s: MaintainerSession, by: int, act: SiteAction): MaintainerSession =
  { ...s, prepared: s.prepared.append(act) }
pure def alwaysNoPolicyActionApplied(s: MaintainerSession): bool =
  s.applied.every(a => not(Set(ClearRestriction, ChangeClosureConsent, ChangeFundingRequirement, ChangePaymentPolicy,
    ActivateProduction, SignTransfer).contains(a)))
pure def alwaysAppliedServesTheTask(s: MaintainerSession): bool = s.applied.every(a => siteServes(s.task, a))
pure def alwaysWithoutBrowserNothingApplied(s: MaintainerSession): bool = not(s.browser) implies s.applied == List()
pure def stepDecisionRecordedOnlyWhenGiven(before: MaintainerSession, after: MaintainerSession): bool =
  (after.applied.length() > before.applied.length() and after.applied.nthOr(after.applied.length() - 1, ReadCase) == RecordDecision)
    implies before.decisions.length() > 0
pure def stepNoActionWhileUncertain(before: MaintainerSession, via: str, after: MaintainerSession): bool =
  (before.uncertain and via == "siteAct") implies after == before
pure def sometimesSetupCheckApplied(s: MaintainerSession): bool = s.applied.includes(RunSetupCheck)
pure def sometimesUncertainReadBackApplied(s: MaintainerSession): bool = s.readBacks > 0 and s.applied.length() > 0
pure def sometimesDecisionRecorded(s: MaintainerSession): bool = s.applied.includes(RecordDecision)
pure def sometimesPreparedWithoutBrowser(s: MaintainerSession): bool = s.prepared.length() > 0 and s.applied == List()
pure def sometimesRefusedWithoutHumanDecision(s: MaintainerSession): bool =
  s.task == ManageCases and s.refused > 0 and s.decisions == List()
```

### Repository work needs current write access, and a review or CI request never authorizes a merge or release

Pushing a scoped fix, posting a review and filing an issue need repository
write access under the current account; only owners and maintainers file
issues. A merge, release or deployment also needs the user's explicit
authorization (sender `user`). The agent never approves its own work. Every
refused repository write is counted.

```quint
pure def canAuthorizeWrite(s: MaintainerSession, by: int, act: RepoAction): bool =
  by == user and (act == MergePR or act == ReleaseOrDeploy)
pure def authorizeWrite(s: MaintainerSession, by: int, act: RepoAction): MaintainerSession =
  { ...s, authorizedWrites: s.authorizedWrites.append(act) }
pure def repoPermitted(s: MaintainerSession, act: RepoAction): bool =
  repoServes(s.task, act) and holds(s, RepoWrite)
    and ((act != MergePR and act != ReleaseOrDeploy) or s.authorizedWrites.includes(act))
pure def canRepoWrite(s: MaintainerSession, by: int, act: RepoAction): bool = by == agent and s.phase == Working
pure def repoWrite(s: MaintainerSession, by: int, act: RepoAction): MaintainerSession =
  if (repoPermitted(s, act)) { ...s, repoWrites: s.repoWrites.append(act) } else { ...s, refused: s.refused + 1 }
pure def alwaysNoSelfApproval(s: MaintainerSession): bool = not(s.repoWrites.includes(SelfApprove))
pure def alwaysMergeAndReleaseAuthorized(s: MaintainerSession): bool =
  (s.repoWrites.includes(MergePR) implies s.authorizedWrites.includes(MergePR))
    and (s.repoWrites.includes(ReleaseOrDeploy) implies s.authorizedWrites.includes(ReleaseOrDeploy))
pure def sometimesReviewedWithoutMerge(s: MaintainerSession): bool =
  s.repoWrites.includes(PostReview) and not(s.repoWrites.includes(MergePR)) and s.refused > 0
pure def sometimesAuthorizedMerge(s: MaintainerSession): bool = s.repoWrites.includes(MergePR)
```

### The session finishes with its actual results and nothing uncertain left unread

The agent finishes only after every uncertain attempt has been read back,
reporting what was applied, what was prepared and what remains for the user.
A finished session takes no further action.

```quint
pure def canFinish(s: MaintainerSession, by: int): bool = by == agent and s.phase == Working and not(s.uncertain)
pure def finish(s: MaintainerSession, by: int): MaintainerSession = { ...s, phase: Finished, privateView: false }
pure def alwaysFinishedHasNoUnreadAttempt(s: MaintainerSession): bool =
  s.phase == Finished implies (not(s.uncertain) and not(s.privateView))
pure def stepFinishedIsFinal(before: MaintainerSession, via: str, after: MaintainerSession): bool =
  (before.phase == Finished and (via == "siteAct" or via == "repoWrite" or via == "prepare"))
    implies after == before
pure def sometimesFinishedAfterPreparing(s: MaintainerSession): bool = s.phase == Finished and s.prepared.length() > 0
pure val byValues = Set(user, agent, authorityService)
pure val repositoryIdValues = Set(0, 7)
```
