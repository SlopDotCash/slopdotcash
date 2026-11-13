# Accepted-commit authorship and retained copies

PRD section 7 determines implementation recipients from accepted, unique,
non-merge commits on every integration branch. This machine represents one
immutable accepted commit candidate. GitHub author links, actor eligibility,
source trees, and retained-copy bindings are externally verified evidence.
A PR description reference alone supplies no retained-copy proof.

## Story: Credit the implementation author without rewarding a carrier PR

An eligible primary commit author receives the implementation share. An
unlinked or ineligible commit falls back to the source PR creator, except when
verified retained-copy evidence identifies the original PR creator.

### Commit identity and accepted-copy line evidence remain bound together

```quint
type AttributionPhase = Gathering | Attributed | Credited
type CommitAttribution = { phase: AttributionPhase, commitId: str,
  sourcePrActor: int, sourceActorEligible: bool, primaryActor: int,
  primaryLinked: bool, primaryEligible: bool, originalPrActor: int,
  originalActorEligible: bool, retainedCopyVerified: bool, descriptionReference: bool,
  accepted: bool, mergeCommit: bool, alreadyCredited: bool, recipient: int,
  additions: int, deletions: int, lineEvidenceComplete: bool }
pure val initial: CommitAttribution = { phase: Gathering, commitId: "accepted-commit",
  sourcePrActor: 1, sourceActorEligible: true, primaryActor: 0,
  primaryLinked: false, primaryEligible: false, originalPrActor: 0,
  originalActorEligible: false, retainedCopyVerified: false, descriptionReference: false,
  accepted: false, mergeCommit: false, alreadyCredited: false, recipient: 0,
  additions: 0, deletions: 0, lineEvidenceComplete: false }
pure def alwaysCommitIdentity(a: CommitAttribution): bool = a.commitId == "accepted-commit"
pure def alwaysLineEvidence(a: CommitAttribution): bool = a.additions >= 0 and a.deletions >= 0
```

### Primary authorship takes precedence over the PR opener and retained-copy fallback

The absence of an eligible recipient holds attribution. Opening, updating,
recreating, or merging the PR cannot add an implementation recipient.

```quint
pure def recipientFor(a: CommitAttribution): int =
  if (a.primaryLinked and a.primaryEligible and a.primaryActor > 0) a.primaryActor
  else if (a.retainedCopyVerified and a.originalActorEligible and a.originalPrActor > 0) a.originalPrActor
  else if (a.sourceActorEligible) a.sourcePrActor else 0
pure def canObservePrimary(a: CommitAttribution, actor: int, linked: bool, eligible: bool): bool =
  a.phase == Gathering and actor >= 0
pure def observePrimary(a: CommitAttribution, actor: int, linked: bool, eligible: bool): CommitAttribution =
  { ...a, primaryActor: actor, primaryLinked: linked, primaryEligible: eligible }
pure def canObserveOriginal(a: CommitAttribution, actor: int, eligible: bool,
  immutableCopyBinding: bool, descriptionReference: bool): bool = a.phase == Gathering and actor >= 0
pure def observeOriginal(a: CommitAttribution, actor: int, eligible: bool,
  immutableCopyBinding: bool, descriptionReference: bool): CommitAttribution =
  { ...a, originalPrActor: actor, originalActorEligible: eligible,
    retainedCopyVerified: immutableCopyBinding, descriptionReference: descriptionReference }
pure def canObserveSource(a: CommitAttribution, actor: int, eligible: bool, exactSourcePr: bool): bool = a.phase == Gathering and actor > 0 and exactSourcePr
pure def observeSource(a: CommitAttribution, actor: int, eligible: bool, exactSourcePr: bool): CommitAttribution =
  { ...a, sourcePrActor: actor, sourceActorEligible: eligible }
```

### Only accepted unique non-merge commits can contribute line weight

For retained copies the line counts are those of this accepted copy. Complete
zero-line evidence is kept explicitly so it can use equal allocation. Missing
line evidence stays distinct and the allocation module holds multiple recipients.

```quint
pure def canObserveAcceptance(a: CommitAttribution, accepted: bool, mergeCommit: bool, alreadyCredited: bool): bool = a.phase == Gathering
pure def observeAcceptance(a: CommitAttribution, accepted: bool, mergeCommit: bool, alreadyCredited: bool): CommitAttribution =
  { ...a, accepted: accepted, mergeCommit: mergeCommit, alreadyCredited: alreadyCredited }
pure def canRecordLines(a: CommitAttribution, additions: int, deletions: int, exactAcceptedCopy: bool): bool =
  a.phase == Gathering and additions >= 0 and deletions >= 0 and exactAcceptedCopy
pure def recordLines(a: CommitAttribution, additions: int, deletions: int, exactAcceptedCopy: bool): CommitAttribution =
  { ...a, additions: additions, deletions: deletions, lineEvidenceComplete: true }
pure def canAttribute(a: CommitAttribution): bool = a.phase == Gathering and
  a.accepted and not(a.mergeCommit) and not(a.alreadyCredited) and recipientFor(a) > 0
pure def attribute(a: CommitAttribution): CommitAttribution =
  { ...a, phase: Attributed, recipient: recipientFor(a) }
pure def canCreditCommit(a: CommitAttribution, completeSource: bool): bool =
  a.phase == Attributed and completeSource and not(a.alreadyCredited)
pure def creditCommit(a: CommitAttribution, completeSource: bool): CommitAttribution =
  { ...a, phase: Credited, alreadyCredited: true }
pure def alwaysAttributedEligibility(a: CommitAttribution): bool = a.phase != Gathering implies
  a.accepted and not(a.mergeCommit) and a.recipient == recipientFor(a) and a.recipient > 0
pure def alwaysCreditOnce(a: CommitAttribution): bool = a.phase == Credited implies a.alreadyCredited
pure def sometimesPrimary(a: CommitAttribution): bool = a.phase == Attributed and a.primaryLinked and a.primaryEligible and a.recipient == a.primaryActor
pure def sometimesOriginalFallback(a: CommitAttribution): bool = a.phase == Attributed and not(a.primaryLinked) and a.retainedCopyVerified and a.recipient == a.originalPrActor
pure def sometimesSourceFallback(a: CommitAttribution): bool = a.phase == Attributed and not(a.primaryLinked) and not(a.retainedCopyVerified) and a.recipient == a.sourcePrActor
pure def sometimesCredited(a: CommitAttribution): bool = a.phase == Credited
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val additionsValues = Set(0, 1, 2)
pure val deletionsValues = Set(0, 1, 2)
```
