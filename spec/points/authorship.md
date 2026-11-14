# Accepted-commit authorship and retained copies

PRD section 7 determines implementation recipients from GitHub-linked
primary authors of accepted, unique, non-merge commits on every integration
branch. Opening, recreating, updating or merging a PR alone earns no share.
A commit without an eligible linked author falls back to the source PR
creator, or to the original PR creator when verified retained-copy evidence
binds the commit to that PR. A PR description reference alone is never such
evidence. Maintainers are not excluded from implementation credit; bots and
vendor agents are. The owner decision of 13 November 2026 weights recipients
by additions plus deletions in their accepted commits.

This machine represents one immutable accepted commit, following
`scripts/generate-leaderboard.ts` (commit line cache, late author links) and
the legacy `commit_line_cache`, `implementation_credit` and
`implementation_credit_gate` models. Each observation is a record from the
GitHub ingestion adapter, bound to the commit ID it names. An observation is
recorded once per kind: an absent observation changes nothing, an identical
repeat is a no-op, and a conflicting one holds the commit for review.

## Story: Credit the implementation author without rewarding a carrier PR

### Commit identity, observations and line evidence remain bound together

```quint
import allocation as A from "./allocation"
type ActorKind = User | Bot | VendorAgent
type AttributionPhase = Gathering | Attributed | Credited | ConflictHeld | Repaired
type Observed = Unknown | Seen({ actor: int, kind: ActorKind, linked: bool })
type Lines = NoLines | CompleteLines({ additions: int, deletions: int })
type Acceptance = NotObserved | AcceptedCommit({ merge: bool, earlierSource: bool }) | Unaccepted
type CopyBinding = NoCopy | VerifiedCopy({ actor: int, kind: ActorKind }) | DescriptionOnly
type CommitAttribution = { phase: AttributionPhase, commitId: str, primary: Observed, source: Observed,
  copy: CopyBinding, acceptance: Acceptance, lines: Lines, recipient: int, repairedFrom: int }
pure val initial: CommitAttribution = { phase: Gathering, commitId: "accepted-commit", primary: Unknown,
  source: Unknown, copy: NoCopy, acceptance: NotObserved, lines: NoLines, recipient: 0, repairedFrom: 0 }
pure def eligibleKind(kind: ActorKind): bool = kind == User
pure def alwaysCommitIdentity(a: CommitAttribution): bool = a.commitId == "accepted-commit"
pure def linesValid(lines: Lines): bool = match lines { | CompleteLines(x) => x.additions >= 0 and x.deletions >= 0 | NoLines => true }
pure def alwaysLineEvidence(a: CommitAttribution): bool = linesValid(a.lines)
```

### Primary authorship takes precedence over retained-copy and PR-opener fallbacks

The absence of an eligible recipient holds attribution.

```quint
pure def primaryRecipient(o: Observed): int = match o { | Seen(x) => if (x.linked and eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | Unknown => 0 }
pure def copyRecipient(c: CopyBinding): int = match c { | VerifiedCopy(x) => if (eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | _ => 0 }
pure def sourceRecipient(o: Observed): int = match o { | Seen(x) => if (eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | Unknown => 0 }
pure def recipientFor(a: CommitAttribution): int =
  if (primaryRecipient(a.primary) > 0) primaryRecipient(a.primary)
  else if (copyRecipient(a.copy) > 0) copyRecipient(a.copy)
  else sourceRecipient(a.source)
pure def isUnknown(o: Observed): bool = match o { | Unknown => true | _ => false }
pure def sameSeen(o: Observed, actor: int, kind: ActorKind, linked: bool): bool =
  match o { | Seen(x) => x.actor == actor and x.kind == kind and x.linked == linked | Unknown => false }
pure def isNoCopy(c: CopyBinding): bool = match c { | NoCopy => true | _ => false }
pure def isDescriptionOnly(c: CopyBinding): bool = match c { | DescriptionOnly => true | _ => false }
pure def verifiedAs(c: CopyBinding, actor: int, kind: ActorKind): bool =
  match c { | VerifiedCopy(y) => y.actor == actor and y.kind == kind | _ => false }
pure def sameCopy(first: CopyBinding, second: CopyBinding): bool =
  match first { | VerifiedCopy(x) => verifiedAs(second, x.actor, x.kind) | NoCopy => isNoCopy(second) | DescriptionOnly => isDescriptionOnly(second) }
pure def notObserved(acceptance: Acceptance): bool = match acceptance { | NotObserved => true | _ => false }
pure def acceptedAs(acceptance: Acceptance, merge: bool, earlierSource: bool): bool =
  match acceptance { | AcceptedCommit(x) => x.merge == merge and x.earlierSource == earlierSource | _ => false }
pure def hasLines(lines: Lines): bool = match lines { | CompleteLines(x) => true | NoLines => false }
pure def openForEvidence(a: CommitAttribution): bool = a.phase == Gathering or a.phase == Attributed
pure def canObservePrimary(a: CommitAttribution, actor: int, kind: ActorKind, linked: bool): bool =
  openForEvidence(a) and actor > 0 and linked
pure def observePrimary(a: CommitAttribution, actor: int, kind: ActorKind, linked: bool): CommitAttribution =
  if (isUnknown(a.primary)) { ...a, primary: Seen({ actor: actor, kind: kind, linked: linked }), phase: Gathering, recipient: 0 }
  else if (sameSeen(a.primary, actor, kind, linked)) a
  else { ...a, phase: ConflictHeld, recipient: 0 }
pure def canObserveSource(a: CommitAttribution, actor: int, kind: ActorKind): bool = a.phase == Gathering and actor > 0
pure def observeSource(a: CommitAttribution, actor: int, kind: ActorKind): CommitAttribution =
  if (isUnknown(a.source)) { ...a, source: Seen({ actor: actor, kind: kind, linked: false }) }
  else if (sameSeen(a.source, actor, kind, false)) a
  else { ...a, phase: ConflictHeld }
pure def canObserveCopy(a: CommitAttribution, copy: CopyBinding): bool = a.phase == Gathering and not(isNoCopy(copy))
pure def observeCopy(a: CommitAttribution, copy: CopyBinding): CommitAttribution =
  if (isNoCopy(a.copy) or isDescriptionOnly(a.copy)) { ...a, copy: copy }
  else if (sameCopy(a.copy, copy) or isDescriptionOnly(copy)) a
  else { ...a, phase: ConflictHeld }
pure def lawDescriptionIsNoEvidence(actor: int, kind: ActorKind): bool =
  copyRecipient(DescriptionOnly) == 0
pure def lawMaintainerStillCredited(actor: int): bool =
  actor > 0 implies primaryRecipient(Seen({ actor: actor, kind: User, linked: true })) == actor
pure def lawBotsAndAgentsExcluded(actor: int, kind: ActorKind): bool =
  kind != User implies (primaryRecipient(Seen({ actor: actor, kind: kind, linked: true })) == 0 and
    sourceRecipient(Seen({ actor: actor, kind: kind, linked: false })) == 0)
```

### Only accepted unique non-merge commits contribute line weight

A synchronization merge and a commit already credited in an earlier accepted
source contribute nothing. For a retained copy the line counts are the
accepted copy's. Complete zero-line evidence stays explicit; missing line
evidence holds a multiple-recipient allocation.

```quint
pure def canObserveAcceptance(a: CommitAttribution, merge: bool, earlierSource: bool): bool =
  a.phase == Gathering and notObserved(a.acceptance)
pure def observeAcceptance(a: CommitAttribution, merge: bool, earlierSource: bool): CommitAttribution =
  { ...a, acceptance: AcceptedCommit({ merge: merge, earlierSource: earlierSource }) }
pure def canRecordLines(a: CommitAttribution, additions: int, deletions: int): bool =
  a.phase == Gathering and additions >= 0 and deletions >= 0 and not(hasLines(a.lines))
pure def recordLines(a: CommitAttribution, additions: int, deletions: int): CommitAttribution =
  { ...a, lines: CompleteLines({ additions: additions, deletions: deletions }) }
pure def contributes(a: CommitAttribution): bool = acceptedAs(a.acceptance, false, false)
pure def canAttribute(a: CommitAttribution): bool = a.phase == Gathering and contributes(a) and recipientFor(a) > 0
pure def attribute(a: CommitAttribution): CommitAttribution = { ...a, phase: Attributed, recipient: recipientFor(a) }
pure def canCreditCommit(a: CommitAttribution): bool = a.phase == Attributed and hasLines(a.lines)
pure def creditCommit(a: CommitAttribution): CommitAttribution = { ...a, phase: Credited }
```

### A late author link repairs a credited fallback by an appended correction

A GitHub author link observed after credit changes the recipient only
through a journal correction with basis `Reallocation` that preserves the
unit's complete total. The earlier recipient is retained as the repaired
predecessor.

```quint
pure def canRepair(a: CommitAttribution, actor: int, kind: ActorKind): bool =
  a.phase == Credited and isUnknown(a.primary) and actor > 0 and eligibleKind(kind) and actor != a.recipient
pure def repair(a: CommitAttribution, actor: int, kind: ActorKind): CommitAttribution =
  { ...a, phase: Repaired, primary: Seen({ actor: actor, kind: kind, linked: true }), repairedFrom: a.recipient, recipient: actor }
pure def alwaysAttributedEligibility(a: CommitAttribution): bool =
  (a.phase == Attributed or a.phase == Credited or a.phase == Repaired) implies
    (contributes(a) and a.recipient == recipientFor(a) and a.recipient > 0)
pure def alwaysCreditedHasLines(a: CommitAttribution): bool = (a.phase == Credited or a.phase == Repaired) implies hasLines(a.lines)
pure def alwaysRepairKeepsPredecessor(a: CommitAttribution): bool = a.phase == Repaired implies (a.repairedFrom > 0 and a.repairedFrom != a.recipient)
pure def stepCreditedNeverRewritten(before: CommitAttribution, after: CommitAttribution): bool =
  (before.phase == Credited or before.phase == Repaired) implies (after.lines == before.lines and after.acceptance == before.acceptance)
pure def stepConflictHolds(before: CommitAttribution, after: CommitAttribution): bool =
  before.phase == ConflictHeld implies after == before
pure def sometimesPrimary(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == a.recipient
pure def sometimesCopyFallback(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == 0 and copyRecipient(a.copy) == a.recipient
pure def sometimesSourceFallback(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == 0 and copyRecipient(a.copy) == 0 and a.recipient > 0
pure def sometimesConflictHeld(a: CommitAttribution): bool = a.phase == ConflictHeld
pure def sometimesRepaired(a: CommitAttribution): bool = a.phase == Repaired
pure def sometimesMergeHeld(a: CommitAttribution): bool = acceptedAs(a.acceptance, true, false)
```

### Recipient line weights sum additions plus deletions over contributing commits

The allocation receives one recipient per actor. Merge commits, commits
credited in an earlier source, unattributed commits and commits without
complete line evidence contribute no lines; any such missing evidence keeps
the allocation's complete-lines input false.

```quint
type CommitLines = { recipient: int, additions: int, deletions: int, merge: bool, earlierSource: bool, complete: bool }
pure def commitWeight(c: CommitLines): int = if (c.merge or c.earlierSource or not(c.complete)) 0 else c.additions + c.deletions
pure def linesFor(commits: List[CommitLines], actor: int): int =
  commits.foldl(0, (acc, c) => if (c.recipient == actor) acc + commitWeight(c) else acc)
pure def recipientLines(commits: List[CommitLines], actors: List[int]): List[A::Recipient] =
  actors.listMap(actor => { actor: actor, lines: linesFor(commits, actor) })
pure def completeLines(commits: List[CommitLines]): bool =
  commits.every(c => c.merge or c.earlierSource or (c.complete and c.recipient > 0))
pure def lawLinesAreAdditionsPlusDeletions(additions: int, deletions: int): bool =
  commitWeight({ recipient: 1, additions: additions, deletions: deletions, merge: false, earlierSource: false, complete: true }) == additions + deletions
pure def lawMergeCommitsContributeZero(additions: int, deletions: int): bool =
  commitWeight({ recipient: 1, additions: additions, deletions: deletions, merge: true, earlierSource: false, complete: true }) == 0
pure def lawEarlierSourceContributesZero(additions: int, deletions: int): bool =
  commitWeight({ recipient: 1, additions: additions, deletions: deletions, merge: false, earlierSource: true, complete: true }) == 0
```

### Simulation samples exercise linked, unlinked, conflicting and ineligible evidence

These input sets bound simulation only.

```quint
pure val actorValues = Set(0, 1, 2)
pure val kindValues = Set(User, Bot, VendorAgent)
pure val linkedValues = Set(true, false)
pure val additionsValues = Set(0, 1, 2)
pure val deletionsValues = Set(0, 1, 2)
pure val copyValues = Set(VerifiedCopy({ actor: 2, kind: User }), VerifiedCopy({ actor: 1, kind: User }), DescriptionOnly)
```
