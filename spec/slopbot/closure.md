# Qualified automatic closure

PRD section 5 governs closure. A new draft starts unchecked, as the user
confirmed for this migration. Existing saved consent remains effective.
A missing saved value is false.

## Story: Apply a current review under the registered repository's policy

### Review actions require the exact current source and effective repository scope

Each instance represents one reviewed PR revision. The verified adapter binds
the project, repository, PR node, head and reviewed content digest. It checks
the current installation, registration, item state and policy before an
action. Unknown source or role information leaves the item recoverable for a
later check. A limited or incomplete review cannot label or close. The stored
review keeps the scope where it was performed, so a security-only result cannot
later become a full-review decision if the project is reinstated.

A paused, flagged or quarantined project permits only authorized security
comments and the confirmed scam label. A retired or unregistered repository
permits neither action. The registry and restriction records supply scope.

```quint
type ClosureCategory = Spam | Scam | RuleViolation | LowQuality | Duplicate | OutOfScope
type RepositoryScope = Unregistered | FullReview | SecurityOnly | Retired
type SourceStatus = SourceUnknown | SourceCurrent | SourceSuperseded
type HoldStatus = NoHold | WaitingForMaintainer | MaintainerActed | HoldSuperseded | HoldLabeled | HoldLabelRemoved
type MaintainerTimeline = TimelineUnknown | NoMaintainerAction | MaintainerAction
type ReviewIdentity = { project: int, repository: int, prNode: str, revision: str, contentDigest: str }
type TimelineObservation = { identity: ReviewIdentity, heldAt: int, checkedAt: int,
  timeline: MaintainerTimeline, upheldAppeal: bool }
type RemovalEvidence = { identity: ReviewIdentity, upheldAppeal: bool, confirmedRemoval: bool }
type ReviewContext = { identity: ReviewIdentity, scope: RepositoryScope, source: SourceStatus,
  activeInstallation: bool, openItem: bool, completeCoverage: bool, reviewAllowed: bool,
  securityAuthorized: bool, closurePolicyAllows: bool, unassigned: bool }
type ClosureEvidence = { member: bool, authenticatedRun: bool, exactPr: bool,
  knownNonMaintainer: bool, qualified: bool, independent: bool, withinCap: bool, production: bool }
type Closure = { identity: ReviewIdentity, context: ReviewContext, evidence: ClosureEvidence,
  consent: bool, verdictRecorded: bool, verdictScope: RepositoryScope, uncertain: bool, category: ClosureCategory,
  now: int, heldAt: int, hold: HoldStatus, closed: bool, labelApplied: bool,
  securityCommented: bool, reopened: bool, moderatorNotice: bool }
pure val reviewedItem: ReviewIdentity = { project: 1, repository: 1, prNode: "pr", revision: "head", contentDigest: "review" }
pure val initialContext: ReviewContext = { identity: reviewedItem, scope: Unregistered,
  source: SourceUnknown, activeInstallation: false, openItem: false, completeCoverage: false,
  reviewAllowed: false, securityAuthorized: false, closurePolicyAllows: false, unassigned: false }
pure val initialEvidence: ClosureEvidence = { member: false, authenticatedRun: false, exactPr: false,
  knownNonMaintainer: false, qualified: false, independent: false, withinCap: false, production: false }
pure val initial: Closure = { identity: reviewedItem, context: initialContext, evidence: initialEvidence,
  consent: false, verdictRecorded: false, verdictScope: Unregistered, uncertain: false, category: OutOfScope,
  now: 0, heldAt: 0, hold: NoHold, closed: false, labelApplied: false,
  securityCommented: false, reopened: false, moderatorNotice: false }
pure def canObserveContext(c: Closure, context: ReviewContext): bool =
  not(c.closed) and context.identity == c.identity
pure def observeContext(c: Closure, context: ReviewContext): Closure = { ...c, context: context }
pure def mayPostReview(c: Closure): bool = c.context.identity == c.identity and
  c.context.source == SourceCurrent and c.context.activeInstallation and c.context.openItem and
  c.context.completeCoverage and c.context.reviewAllowed and not(c.closed) and not(c.reopened)
pure def mayPostOrdinary(c: Closure): bool = c.context.scope == FullReview and mayPostReview(c)
pure def mayPostSecurity(c: Closure): bool = c.context.scope == SecurityOnly and
  c.context.securityAuthorized and mayPostReview(c)
pure def canRecordVerdict(c: Closure, reviewScope: RepositoryScope): bool = not(c.verdictRecorded) and
  reviewScope == c.context.scope and (mayPostOrdinary(c) or mayPostSecurity(c))
pure def recordVerdict(c: Closure, reviewScope: RepositoryScope, uncertain: bool, category: ClosureCategory): Closure =
  { ...c, verdictRecorded: true, verdictScope: reviewScope, uncertain: uncertain, category: category }
pure def canCommentSecurity(c: Closure): bool = mayPostSecurity(c) and c.verdictRecorded and
  c.verdictScope == SecurityOnly and not(c.securityCommented)
pure def commentSecurity(c: Closure): Closure = { ...c, securityCommented: true }
pure def canLabelSecurityScam(c: Closure): bool = mayPostSecurity(c) and c.verdictRecorded and
  c.verdictScope == SecurityOnly and not(c.uncertain) and c.category == Scam and not(c.labelApplied)
pure def labelSecurityScam(c: Closure): Closure = { ...c, labelApplied: true }
```

### Closing requires saved consent, an exact participant and every independent gate

Only the author's active Slop membership and own authenticated run with a
matching `pull_request_opened` event supply participation authority. A copied
footer or marker supplies none. Unknown maintainer status and an assigned PR
refuse closure. The effective repository close policy preserves
`.github/slopbot.json` opt-outs and category restrictions independently of the
saved project setting. Current real-case qualification, independent confirmation,
caps and explicit production activation remain necessary. Objective categories
also require their approved qualified verifier.

Confirmed spam, scam, quoted-rule violations, qualified low quality and duplicate
findings may close. Out-of-scope is label-only. A confirmed scam closure creates
one moderator Inbox notice for the item. Closing does not itself issue a debit.

```quint
pure def canSaveConsent(c: Closure, currentOwner: bool): bool = currentOwner and not(c.closed)
pure def saveConsent(c: Closure, currentOwner: bool, consent: bool): Closure = { ...c, consent: consent }
pure def canRecordEvidence(c: Closure): bool = not(c.closed)
pure def recordEvidence(c: Closure, evidence: ClosureEvidence): Closure = { ...c, evidence: evidence }
pure def eligible(c: Closure): bool = c.context.scope == FullReview and c.context.identity == c.identity and
  c.context.source == SourceCurrent and c.context.activeInstallation and c.context.openItem and
  c.context.completeCoverage and c.context.reviewAllowed and c.context.closurePolicyAllows and c.context.unassigned and
  c.consent and c.evidence.member and c.evidence.authenticatedRun and c.evidence.exactPr and
  c.evidence.knownNonMaintainer and c.evidence.qualified and c.evidence.independent and
  c.evidence.withinCap and c.evidence.production and c.verdictRecorded and c.verdictScope == FullReview and not(c.uncertain) and
  not(c.reopened) and c.category != OutOfScope
pure def canClose(c: Closure): bool = not(c.closed) and eligible(c)
pure def close(c: Closure): Closure = { ...c, closed: true, moderatorNotice: c.category == Scam }
pure def canLabelOutOfScope(c: Closure): bool = mayPostOrdinary(c) and c.verdictRecorded and
  c.verdictScope == FullReview and c.category == OutOfScope and not(c.uncertain) and not(c.labelApplied)
pure def labelOutOfScope(c: Closure): Closure = { ...c, labelApplied: true }
pure def alwaysCloseEligible(c: Closure): bool = c.closed implies eligible(c)
pure def alwaysScamNotice(c: Closure): bool = c.closed and c.category == Scam implies c.moderatorNotice
pure def alwaysOutOfScopeStaysOpen(c: Closure): bool = c.category == OutOfScope implies not(c.closed)
pure def sometimesClosed(c: Closure): bool = c.closed
pure def sometimesRestrictedScamLabel(c: Closure): bool = c.context.scope == SecurityOnly and
  c.verdictScope == SecurityOnly and c.category == Scam and c.securityCommented and c.labelApplied and not(c.closed)
```

## Story: Give the maintainer seven days to decide an uncertain finding

### The first durable maintainer notice starts the window once

Source `maintainer-holds.ts` derives the deadline from the stored hold
timestamp and preserves it on retry. The hold starts when the maintainer
comment is confirmed and the durable hold is recorded. The adapter supplies
an absolute trusted time in seconds. A notification retry cannot restart the
window. A security-only finding leaves the restricted-project comment without
starting an ordinary hold.

```quint
pure val holdSeconds = 604800
pure def canObserveTime(c: Closure, observedAt: int): bool = observedAt >= c.now
pure def observeTime(c: Closure, observedAt: int): Closure = { ...c, now: observedAt }
pure def canNotifyMaintainer(c: Closure, durableNotice: bool): bool = mayPostOrdinary(c) and
  c.verdictRecorded and c.verdictScope == FullReview and c.uncertain and c.hold == NoHold and durableNotice
pure def notifyMaintainer(c: Closure, durableNotice: bool): Closure =
  { ...c, heldAt: c.now, hold: WaitingForMaintainer }
pure def holdDue(c: Closure): bool = c.hold == WaitingForMaintainer and c.now - c.heldAt >= holdSeconds
pure def alwaysHoldTime(c: Closure): bool = c.now >= 0 and c.heldAt >= 0 and c.heldAt <= c.now
pure def alwaysHoldHasUncertainFinding(c: Closure): bool =
  c.hold != NoHold implies c.verdictRecorded and c.verdictScope == FullReview and c.uncertain and not(c.closed)
pure def stepHoldStartRetained(before: Closure, after: Closure): bool =
  before.hold != NoHold implies after.heldAt == before.heldAt
```

### The due hold labels only when current evidence proves no maintainer acted

Current maintainer comments, reviews, labels, assignments and state changes
since the hold began count once attributed to the maintainer. Passive mentions
and subscriptions do not. The adapter verifies the exact item and inspected
timeline, refuses unknown maintainer roles, and rechecks source and authorization
before writing. Its observation binds the reviewed revision, first notice
timestamp and current decision time. A known changed source, changed
registration, upheld appeal or verified reopen supersedes the hold. An
unknown source or timeline refuses labeling and leaves the hold retryable
unless a separate, verified superseding fact applies. The only automatic
hold output is the once-only `slopbot:uncertain` label.

```quint
pure def matchesHoldObservation(c: Closure, observation: TimelineObservation): bool =
  observation.identity == c.identity and observation.heldAt == c.heldAt and observation.checkedAt == c.now
pure def canResolveMaintainerAction(c: Closure, observation: TimelineObservation): bool =
  holdDue(c) and mayPostOrdinary(c) and matchesHoldObservation(c, observation) and
  not(observation.upheldAppeal) and observation.timeline == MaintainerAction
pure def resolveMaintainerAction(c: Closure, observation: TimelineObservation): Closure =
  { ...c, hold: MaintainerActed }
pure def canSupersedeHold(c: Closure, observation: TimelineObservation): bool =
  holdDue(c) and matchesHoldObservation(c, observation) and
  (c.context.source == SourceSuperseded or c.context.scope != FullReview or
    not(c.context.activeInstallation) or not(c.context.openItem) or not(c.context.completeCoverage) or
    not(c.context.reviewAllowed) or c.reopened or observation.upheldAppeal)
pure def supersedeHold(c: Closure, observation: TimelineObservation): Closure = { ...c, hold: HoldSuperseded }
pure def canLabelUncertain(c: Closure, observation: TimelineObservation): bool = mayPostOrdinary(c) and
  holdDue(c) and matchesHoldObservation(c, observation) and not(observation.upheldAppeal) and
  observation.timeline == NoMaintainerAction and not(c.labelApplied)
pure def labelUncertain(c: Closure, observation: TimelineObservation): Closure =
  { ...c, hold: HoldLabeled, labelApplied: true }
pure def alwaysDueLabel(c: Closure): bool =
  c.hold == HoldLabeled implies c.labelApplied and c.now - c.heldAt >= holdSeconds
pure def alwaysUncertainNeverCloses(c: Closure): bool = c.uncertain implies not(c.closed)
pure def sometimesUncertainLabel(c: Closure): bool = c.hold == HoldLabeled
pure def sometimesMaintainerActed(c: Closure): bool = c.hold == MaintainerActed
pure def sometimesSuperseded(c: Closure): bool = c.hold == HoldSuperseded
```

### A confirmed maintainer reopen or upheld appeal prevents further automatic action

A confirmed GitHub reopen binds the current maintainer and exact reviewed
revision. The original decision and moderator notice remain in history. The
adapter checks for reopen and upheld appeal before and after the label write
and retries until GitHub verifies removal of a racing uncertain label. For
removal it rechecks the exact item, its label and authority to remove the
label, then verifies removal or absence on GitHub. The effect receipt binds
that reviewed item. The appeal and debit journals own their respective
resolutions.

```quint
pure def canReopen(c: Closure, verifiedMaintainer: bool, exactReopen: bool): bool =
  verifiedMaintainer and exactReopen and not(c.reopened) and c.verdictRecorded
pure def reopen(c: Closure, verifiedMaintainer: bool, exactReopen: bool): Closure =
  { ...c, reopened: true, closed: false,
    hold: if (c.hold == WaitingForMaintainer) HoldSuperseded else c.hold }
pure def canRemoveUncertainLabel(c: Closure, removal: RemovalEvidence): bool =
  c.hold == HoldLabeled and removal.identity == c.identity and
  (c.reopened or removal.upheldAppeal) and removal.confirmedRemoval
pure def removeUncertainLabel(c: Closure, removal: RemovalEvidence): Closure =
  { ...c, hold: HoldLabelRemoved, labelApplied: false }
pure def alwaysReopenedStaysOpen(c: Closure): bool = c.reopened implies not(c.closed)
pure def sometimesReopened(c: Closure): bool = c.reopened and not(c.closed)
pure def sometimesRemovedUncertainLabel(c: Closure): bool = c.hold == HoldLabelRemoved and not(c.labelApplied)
```

### Simulation samples include allowed and refused repository and timeline observations

The finite samples exercise changes after a review, closure opt-outs, and the
exact hold boundary. They do not bound production timestamps or identities.

```quint
pure val verifiedContext: ReviewContext = { identity: reviewedItem, scope: FullReview,
  source: SourceCurrent, activeInstallation: true, openItem: true, completeCoverage: true,
  reviewAllowed: true, securityAuthorized: false, closurePolicyAllows: true, unassigned: true }
pure val exactEligibleEvidence: ClosureEvidence = { member: true, authenticatedRun: true, exactPr: true,
  knownNonMaintainer: true, qualified: true, independent: true, withinCap: true, production: true }
pure val contextValues = Set(verifiedContext,
  { ...verifiedContext, scope: SecurityOnly, securityAuthorized: true },
  { ...verifiedContext, scope: Retired },
  { ...verifiedContext, scope: Unregistered },
  { ...verifiedContext, closurePolicyAllows: false },
  { ...verifiedContext, completeCoverage: false },
  { ...verifiedContext, source: SourceUnknown },
  { ...verifiedContext, source: SourceSuperseded },
  { ...verifiedContext, identity: { ...reviewedItem, revision: "changed" } })
pure val evidenceValues = Set(exactEligibleEvidence, initialEvidence,
  { ...exactEligibleEvidence, knownNonMaintainer: false },
  { ...exactEligibleEvidence, production: false })
pure val reviewScopeValues = Set(FullReview, SecurityOnly, Retired)
pure val observedAtValues = Set(0, 604799, 604800, 1209600)
pure val dueObservation: TimelineObservation = { identity: reviewedItem, heldAt: 0, checkedAt: 604800,
  timeline: NoMaintainerAction, upheldAppeal: false }
pure val observationValues = Set(dueObservation,
  { ...dueObservation, timeline: MaintainerAction },
  { ...dueObservation, timeline: TimelineUnknown },
  { ...dueObservation, upheldAppeal: true },
  { ...dueObservation, checkedAt: 1209600 },
  { ...dueObservation, heldAt: 604800, checkedAt: 1209600 },
  { ...dueObservation, identity: { ...reviewedItem, revision: "changed" } })
pure val directRemoval: RemovalEvidence = { identity: reviewedItem, upheldAppeal: true, confirmedRemoval: true }
pure val removalValues = Set(directRemoval,
  { ...directRemoval, upheldAppeal: false },
  { ...directRemoval, confirmedRemoval: false },
  { ...directRemoval, identity: { ...reviewedItem, revision: "changed" } })
pure val weight_observeContext = 12
pure val weight_recordVerdict = 15
pure val weight_saveConsent = 5
pure val weight_recordEvidence = 8
pure val weight_notifyMaintainer = 10
pure val weight_observeTime = 5
pure val weight_labelUncertain = 10
pure val weight_labelOutOfScope = 8
pure val weight_resolveMaintainerAction = 5
pure val weight_supersedeHold = 5
pure val weight_close = 8
pure val weight_commentSecurity = 6
pure val weight_labelSecurityScam = 6
pure val weight_removeUncertainLabel = 8
```
