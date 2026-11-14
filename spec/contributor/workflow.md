# Live work selection and attributed submission

This model covers PRD sections 4, 5, and 7. A selected item is re-read from
GitHub before work and again before submission. The repository policy check
includes approved MVP scope, contribution instructions, and private security
reporting. A snapshot alone cannot authorize a contributor's work.

## Story: Ship useful work through the project's repository

A contributor selects bounded unblocked work, proves the result, and opens an
attributed PR. Ordinary submission works independently of skills, wallets,
measured runs, receipts, and traces.

### Work selection records blockers and live observation epochs

```quint
type Blocker = Clear | Assigned | MaintainerClaim | DraftPR | ActiveReview | Approved | ChangesRequested | SecurityLabel | HumanGate | Epic | ProjectRestriction
type ContributionPhase = Browsing | Selected | Working | Tested | Submitted | Accepted
type Contribution = { phase: ContributionPhase, itemId: int, blocker: Blocker,
  projectAvailable: bool, policyPermits: bool, bounded: bool, snapshotEpoch: int,
  liveEpoch: int, selectedEpoch: int, submissionEpoch: int, prNode: str,
  agentAssisted: bool, provider: str, model: str, client: str, attributionLine: bool,
  authenticatedRunRecorded: bool, usefulResult: bool, testEvidence: bool,
  reviewerRecommendation: str }
pure val initial: Contribution = { phase: Browsing, itemId: 0, blocker: Clear,
  projectAvailable: false, policyPermits: false, bounded: false,
  snapshotEpoch: 0, liveEpoch: 0, selectedEpoch: -1, submissionEpoch: -1,
  prNode: "", agentAssisted: false, provider: "", model: "", client: "",
  attributionLine: false, authenticatedRunRecorded: false, usefulResult: false,
  testEvidence: false, reviewerRecommendation: "" }
pure def alwaysContributionEpochs(c: Contribution): bool = c.snapshotEpoch >= 0 and c.liveEpoch >= 0
```

### A current unblocked observation is required to select and begin work

After selection, refreshed evidence names the same work item. Abandoning an
unsubmitted attempt clears its selected item, result and test evidence before
another work item can be selected.

```quint
pure def canObserve(c: Contribution, itemId: int, blocker: Blocker): bool = itemId > 0 and c.phase != Accepted and (c.phase == Browsing or itemId == c.itemId)
pure def observe(c: Contribution, itemId: int, blocker: Blocker): Contribution =
  { ...c, itemId: itemId, blocker: blocker, liveEpoch: c.liveEpoch + 1 }
pure def setEligibility(c: Contribution, projectAvailable: bool, policyPermits: bool, bounded: bool): Contribution =
  { ...c, projectAvailable: projectAvailable, policyPermits: policyPermits, bounded: bounded }
pure def canSelectWork(c: Contribution): bool = c.phase == Browsing and c.itemId > 0 and c.liveEpoch > 0 and
  c.blocker == Clear and c.projectAvailable and c.policyPermits and c.bounded
pure def selectWork(c: Contribution): Contribution = { ...c, phase: Selected, selectedEpoch: c.liveEpoch }
pure def canBeginWork(c: Contribution): bool = c.phase == Selected and c.selectedEpoch == c.liveEpoch and
  c.blocker == Clear and c.projectAvailable and c.policyPermits and c.bounded
pure def beginWork(c: Contribution): Contribution = { ...c, phase: Working }
pure def canAbandon(c: Contribution): bool = c.phase == Selected or c.phase == Working or c.phase == Tested
pure def abandon(c: Contribution): Contribution = initial
pure def canRecordTests(c: Contribution, usefulResult: bool, testEvidence: bool): bool =
  c.phase == Working and usefulResult and testEvidence
pure def recordTests(c: Contribution, usefulResult: bool, testEvidence: bool): Contribution =
  { ...c, phase: Tested, usefulResult: true, testEvidence: true }
```

### Submission requires exact attribution and a fresh pre-submission read

The Slop attribution line occurs once in an agent submission. The exact
provider, model, and client name remain attached to the contribution. Attribution
can be prepared before submission and stays immutable after the PR exists.

```quint
pure def canSetAttribution(c: Contribution, provider: str, model: str, client: str, agentAssisted: bool, lineOnce: bool): bool =
  c.phase != Submitted and c.phase != Accepted and
  (not(agentAssisted) or (provider != "" and model != "" and client != "" and lineOnce))
pure def setAttribution(c: Contribution, provider: str, model: str, client: str, agentAssisted: bool, lineOnce: bool): Contribution =
  { ...c, provider: provider, model: model, client: client,
    agentAssisted: agentAssisted, attributionLine: lineOnce }
pure def canConfirmSubmissionRead(c: Contribution): bool =
  c.phase == Tested and c.liveEpoch > c.selectedEpoch and c.blocker == Clear and
  c.projectAvailable and c.policyPermits
pure def confirmSubmissionRead(c: Contribution): Contribution = { ...c, submissionEpoch: c.liveEpoch }
pure def canSubmit(c: Contribution, prNode: str): bool = c.phase == Tested and prNode != "" and
  c.submissionEpoch == c.liveEpoch and c.submissionEpoch > c.selectedEpoch and c.blocker == Clear and
  c.projectAvailable and c.policyPermits and c.usefulResult and c.testEvidence and
  (not(c.agentAssisted) or (c.provider != "" and c.model != "" and c.client != "" and c.attributionLine))
pure def submit(c: Contribution, prNode: str): Contribution = { ...c, phase: Submitted, prNode: prNode }
pure def canRecordRun(c: Contribution, prNode: str, authorSessionVerified: bool, exactProject: bool): bool =
  (c.phase == Submitted or c.phase == Accepted) and prNode == c.prNode and authorSessionVerified and exactProject
pure def recordRun(c: Contribution, prNode: str, authorSessionVerified: bool, exactProject: bool): Contribution =
  { ...c, authenticatedRunRecorded: true }
pure def canRecordMerge(c: Contribution, exactAcceptedMerge: bool): bool = c.phase == Submitted and exactAcceptedMerge
pure def recordMerge(c: Contribution, exactAcceptedMerge: bool): Contribution = { ...c, phase: Accepted }
pure def alwaysSubmissionEvidence(c: Contribution): bool =
  (c.phase == Submitted or c.phase == Accepted) implies c.prNode != "" and c.usefulResult and c.testEvidence
pure def stepSubmittedAttributionStable(before: Contribution, after: Contribution): bool =
  (before.phase == Submitted or before.phase == Accepted) implies
    before.provider == after.provider and before.model == after.model and
    before.client == after.client and before.agentAssisted == after.agentAssisted and
    before.attributionLine == after.attributionLine
```

### Reviewer advice records a recommendation without merge or platform authority

The actual reviewer provider, model, and client are disclosed in the review
footer. The recommendation precedes that footer. The future GitHub adapter
must preserve this order and inspect correctness, tests, security, evidence,
duplication, abuse, scope, and usefulness.

```quint
pure def canReview(c: Contribution, recommendation: str, checksComplete: bool, footerExact: bool): bool =
  c.phase == Submitted and recommendation != "" and checksComplete and footerExact
pure def review(c: Contribution, recommendation: str, checksComplete: bool, footerExact: bool): Contribution =
  { ...c, reviewerRecommendation: recommendation }
pure def sometimesSubmittedWithoutRun(c: Contribution): bool = c.phase == Submitted and not(c.authenticatedRunRecorded)
pure def sometimesAccepted(c: Contribution): bool = c.phase == Accepted
pure def sometimesAdvised(c: Contribution): bool = c.reviewerRecommendation != ""
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val weight_selectWork = 15
pure val weight_beginWork = 15
pure val weight_recordTests = 10
pure val weight_confirmSubmissionRead = 10
pure val weight_submit = 10
pure val weight_recordRun = 5
pure val weight_recordMerge = 5
pure val weight_review = 5
pure val weight_observe = 2
pure val clientValues = Set("", "a", "b")
pure val itemIdValues = Set(0, 1, 2)
pure val modelValues = Set("", "a", "b")
pure val prNodeValues = Set("", "a", "b")
pure val providerValues = Set("", "a", "b")
pure val recommendationValues = Set("", "a", "b")
```
