# Accepted-commit authorship and retained copies

PRD section 7 determines implementation recipients from GitHub-linked
primary authors of accepted, unique, non-merge commits on every integration
branch, and from the resolution work of a merge commit with exactly one
reviewed merge resolution. Opening, recreating, updating or merging a PR
alone earns no share.
A commit without an eligible linked author falls back to the source PR
creator, or to the original PR creator when verified retained-copy evidence
binds the commit to that PR. A PR description reference alone is never such
evidence. Maintainers are not excluded from implementation credit; bots and
vendor agents are. The owner decision of 13 November 2026 weights recipients
by additions plus deletions; development counts them per canonical
commit-path claim (`workUnitLineWeights`). The owner decision of
14 November 2026 redirects, for October 2026 sources of the five named
projects only, a verified replacement PR's carried commits and its carrier's
verified follow-up commits to the verified original contributor (the
[correction manifest](./corrections.md) applies it to recorded history).

This machine represents one immutable accepted commit of one accepted
source, following
`scripts/generate-leaderboard.ts` (commit line cache, late author links) and
the legacy `commit_line_cache`, `implementation_credit` and
`implementation_credit_gate` models. Each observation is a record from the
GitHub ingestion adapter, bound to the commit ID it names. An observation is
recorded once per kind: an absent observation changes nothing, an identical
repeat is a no-op, and a conflicting one holds the commit until a fresh
complete re-read from GitHub replaces the observations. Whether the commit
was already credited in an earlier accepted source is derived from the
[work units](./workUnits.md) the [Points journal](./journal.md) owns, not
asserted by the caller; passing the journal's current units is composition
obligation C8.

## Story: Credit the implementation author without rewarding a carrier PR

### Commit identity, observations and line evidence remain bound together

```quint
import allocation as A from "./allocation"
import workUnits as W from "./workUnits"
import corrections as CO from "./corrections"
import referenceDiscussion as RD from "./referenceDiscussion"
type ActorKind = User | Bot | VendorAgent
type AttributionPhase = Gathering | Attributed | Credited | ConflictHeld | ClaimHeld | Repaired
type CarryBinding = NoCarry | VerifiedCarry({ original: int, followup: bool, parentEdges: bool }) | AmbiguousCarry
type Observed = Unknown | Seen({ actor: int, kind: ActorKind, linked: bool })
type Lines = NoLines | CompleteLines({ additions: int, deletions: int })
type Acceptance = NotObserved | AcceptedCommit({ merge: bool, earlierSource: bool, resolutions: int }) | Unaccepted
type CopyBinding = NoCopy | VerifiedCopy({ actor: int, kind: ActorKind }) | DescriptionOnly
type CommitAttribution = { phase: AttributionPhase, commitId: int, sourceId: int, project: str, occurredAt: int,
  primary: Observed, source: Observed, copy: CopyBinding, carry: CarryBinding, acceptance: Acceptance, lines: Lines,
  recipient: int, repairedFrom: int }
pure val initial: CommitAttribution = { phase: Gathering, commitId: 11, sourceId: 2, project: "eliza", occurredAt: 2432110,
  primary: Unknown, source: Unknown, copy: NoCopy, carry: NoCarry, acceptance: NotObserved, lines: NoLines, recipient: 0, repairedFrom: 0 }
pure def eligibleKind(kind: ActorKind): bool = kind == User
pure def alwaysCommitIdentity(a: CommitAttribution): bool = a.commitId == 11 and a.sourceId == 2
  and a.project == "eliza" and a.occurredAt == 2432110
pure def linesValid(lines: Lines): bool = match lines { | CompleteLines(x) => x.additions >= 0 and x.deletions >= 0 | NoLines => true }
pure def alwaysLineEvidence(a: CommitAttribution): bool = linesValid(a.lines)
```

### A verified October carry goes to the original contributor; otherwise primary authorship precedes the fallbacks

In scope, a carried commit, or a carrier commit whose authenticated Git
parent edges descend from an original contributor's commit, is credited to
the verified original contributor; an unproved carrier commit keeps the
ordinary rule. Outside October 2026 or the five projects the carry binding
changes nothing. An ambiguous claim holds the commit for review. The absence
of an eligible recipient holds attribution. A retained-copy binding is
observed only from a [reference discussion](./referenceDiscussion.md) read
from the census source with complete comment counts.

```quint
pure def primaryRecipient(o: Observed): int = match o { | Seen(x) => if (x.linked and eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | Unknown => 0 }
pure def copyRecipient(c: CopyBinding): int = match c { | VerifiedCopy(x) => if (eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | _ => 0 }
pure def sourceRecipient(o: Observed): int = match o { | Seen(x) => if (eligibleKind(x.kind) and x.actor > 0) x.actor else 0 | Unknown => 0 }
pure def carryTarget(carry: CarryBinding, inScope: bool): int = match carry {
  | VerifiedCarry(x) => if (inScope and x.original > 0 and (not(x.followup) or x.parentEdges)) x.original else 0
  | _ => 0 }
pure def carriedRecipient(a: CommitAttribution): int = carryTarget(a.carry, CO::octoberReplacementScope(a.project, a.occurredAt))
pure def recipientFor(a: CommitAttribution): int =
  if (carriedRecipient(a) > 0) carriedRecipient(a)
  else if (primaryRecipient(a.primary) > 0) primaryRecipient(a.primary)
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
pure def canObserveCopy(a: CommitAttribution, copy: CopyBinding, discussion: RD::ReferenceDiscussion): bool =
  a.phase == Gathering and not(isNoCopy(copy)) and RD::discussionVerdict(discussion) == RD::DiscussionComplete
pure def observeCopy(a: CommitAttribution, copy: CopyBinding, discussion: RD::ReferenceDiscussion): CommitAttribution =
  if (isNoCopy(a.copy) or isDescriptionOnly(a.copy)) { ...a, copy: copy }
  else if (sameCopy(a.copy, copy) or isDescriptionOnly(copy)) a
  else { ...a, phase: ConflictHeld }
pure def isNoCarry(c: CarryBinding): bool = match c { | NoCarry => true | _ => false }
pure def isAmbiguous(c: CarryBinding): bool = match c { | AmbiguousCarry => true | _ => false }
pure def canObserveCarry(a: CommitAttribution, carry: CarryBinding): bool = a.phase == Gathering and isNoCarry(a.carry)
  and not(isNoCarry(carry))
pure def observeCarry(a: CommitAttribution, carry: CarryBinding): CommitAttribution =
  if (isAmbiguous(carry)) { ...a, carry: carry, phase: ClaimHeld } else { ...a, carry: carry }
pure def lawCarrierNeverGainsVerifiedFollowup(a: CommitAttribution, actor: int): bool =
  (CO::octoberReplacementScope(a.project, a.occurredAt) and actor > 0 and actor != 1
    and primaryRecipient(a.primary) == actor) implies
      recipientFor({ ...a, carry: VerifiedCarry({ original: 1, followup: true, parentEdges: true }) }) != actor
pure def lawOtherScopesKeepOrdinaryRule(a: CommitAttribution, carry: CarryBinding): bool =
  not(CO::octoberReplacementScope(a.project, a.occurredAt)) implies recipientFor({ ...a, carry: carry }) == recipientFor({ ...a, carry: NoCarry })
pure def lawUnprovedFollowupKeepsOrdinaryRule(a: CommitAttribution, original: int): bool =
  recipientFor({ ...a, carry: VerifiedCarry({ original: original, followup: true, parentEdges: false }) }) == recipientFor({ ...a, carry: NoCarry })
pure def lawDescriptionIsNoEvidence(actor: int, kind: ActorKind): bool =
  copyRecipient(DescriptionOnly) == 0
pure def lawMaintainerStillCredited(actor: int): bool =
  actor > 0 implies primaryRecipient(Seen({ actor: actor, kind: User, linked: true })) == actor
pure def lawBotsAndAgentsExcluded(actor: int, kind: ActorKind): bool =
  kind != User implies (primaryRecipient(Seen({ actor: actor, kind: kind, linked: true })) == 0 and
    sourceRecipient(Seen({ actor: actor, kind: kind, linked: false })) == 0)
```

### Only accepted unique commits contribute line weight, a merge only through its one merge resolution

A commit already credited in an earlier accepted source contributes nothing.
A merge commit contributes only when exactly one merge resolution is
recorded for it, and then only the resolution's own work; a synchronization
merge with none, or with several, contributes nothing. The commit is already credited when an accepted
work unit that does not contain this source contains the commit. For a retained copy the line counts are the
accepted copy's. Complete zero-line evidence stays explicit; missing line
evidence holds a multiple-recipient allocation.

```quint
pure def creditedElsewhere(a: CommitAttribution, units: W::Units): bool =
  units.units.some(u => u.accepted and u.commits.contains(a.commitId) and not(u.sources.contains(a.sourceId)))
pure def canObserveAcceptance(a: CommitAttribution, merge: bool, resolutions: int, units: W::Units): bool =
  a.phase == Gathering and notObserved(a.acceptance) and resolutions >= 0
pure def observeAcceptance(a: CommitAttribution, merge: bool, resolutions: int, units: W::Units): CommitAttribution =
  { ...a, acceptance: AcceptedCommit({ merge: merge, earlierSource: creditedElsewhere(a, units), resolutions: resolutions }) }
pure def canRecordLines(a: CommitAttribution, additions: int, deletions: int): bool =
  a.phase == Gathering and additions >= 0 and deletions >= 0 and not(hasLines(a.lines))
pure def recordLines(a: CommitAttribution, additions: int, deletions: int): CommitAttribution =
  { ...a, lines: CompleteLines({ additions: additions, deletions: deletions }) }
pure def contributes(a: CommitAttribution): bool =
  val acceptance = a.acceptance
  match acceptance {
  | AcceptedCommit(x) => not(x.earlierSource) and (not(x.merge) or x.resolutions == 1)
  | _ => false }
pure def canAttribute(a: CommitAttribution): bool = a.phase == Gathering and contributes(a) and recipientFor(a) > 0
pure def attribute(a: CommitAttribution): CommitAttribution = { ...a, phase: Attributed, recipient: recipientFor(a) }
pure def canCreditCommit(a: CommitAttribution): bool = a.phase == Attributed and hasLines(a.lines)
pure def creditCommit(a: CommitAttribution): CommitAttribution = { ...a, phase: Credited }
```

### A late author link repairs a credited fallback by an appended correction

A GitHub author link observed after credit changes the recipient only
through a journal correction with basis `Reallocation` that preserves the
unit's complete total. A commit credited to its verified original contributor
is not repaired by a later author link. The earlier recipient is retained as the repaired
predecessor.

```quint
pure def canRepair(a: CommitAttribution, actor: int, kind: ActorKind): bool =
  a.phase == Credited and isUnknown(a.primary) and carriedRecipient(a) == 0 and actor > 0 and eligibleKind(kind) and actor != a.recipient
pure def repair(a: CommitAttribution, actor: int, kind: ActorKind): CommitAttribution =
  { ...a, phase: Repaired, primary: Seen({ actor: actor, kind: kind, linked: true }), repairedFrom: a.recipient, recipient: actor }
pure def alwaysAttributedEligibility(a: CommitAttribution): bool =
  (a.phase == Attributed or a.phase == Credited or a.phase == Repaired) implies
    (contributes(a) and a.recipient == recipientFor(a) and a.recipient > 0)
pure def alwaysCreditedHasLines(a: CommitAttribution): bool = (a.phase == Credited or a.phase == Repaired) implies hasLines(a.lines)
pure def alwaysRepairKeepsPredecessor(a: CommitAttribution): bool = a.phase == Repaired implies (a.repairedFrom > 0 and a.repairedFrom != a.recipient)
pure def stepCreditedNeverRewritten(before: CommitAttribution, after: CommitAttribution): bool =
  (before.phase == Credited or before.phase == Repaired) implies (after.lines == before.lines and after.acceptance == before.acceptance)
pure def stepConflictHolds(before: CommitAttribution, via: str, after: CommitAttribution): bool =
  (before.phase == ConflictHeld and via != "reread") implies after == before
pure def sometimesPrimary(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == a.recipient
pure def sometimesCopyFallback(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == 0 and copyRecipient(a.copy) == a.recipient
pure def sometimesSourceFallback(a: CommitAttribution): bool = a.phase == Credited and primaryRecipient(a.primary) == 0 and copyRecipient(a.copy) == 0 and a.recipient > 0
pure def sometimesConflictHeld(a: CommitAttribution): bool = a.phase == ConflictHeld
pure def sometimesRepaired(a: CommitAttribution): bool = a.phase == Repaired
pure def sometimesMergeHeld(a: CommitAttribution): bool = acceptedAs(a.acceptance, true, false) and not(contributes(a))
pure def sometimesMergeResolutionCredited(a: CommitAttribution): bool = a.phase == Credited and acceptedAs(a.acceptance, true, false)
pure def sometimesCreditedElsewhere(a: CommitAttribution): bool = acceptedAs(a.acceptance, false, true)
pure def sometimesConflictResolved(a: CommitAttribution): bool = a.phase == Credited and a.repairedFrom == 0 and sameSeen(a.primary, 2, User, true)
pure def sometimesFollowupRedirected(a: CommitAttribution): bool = a.phase == Credited and carriedRecipient(a) > 0
  and primaryRecipient(a.primary) > 0 and a.recipient != primaryRecipient(a.primary)
pure def sometimesAmbiguousHeld(a: CommitAttribution): bool = a.phase == ClaimHeld
```

### A fresh complete re-read resolves a held conflict

A held commit returns to gathering only with a fresh, complete re-read of its
primary author from GitHub. The earlier conflicting source and copy
observations are discarded and must be observed again; acceptance and line
evidence, which are immutable commit facts, are kept.

```quint
pure def canReread(a: CommitAttribution, actor: int, kind: ActorKind, linked: bool): bool =
  a.phase == ConflictHeld and actor > 0
pure def reread(a: CommitAttribution, actor: int, kind: ActorKind, linked: bool): CommitAttribution =
  { ...a, phase: Gathering, primary: Seen({ actor: actor, kind: kind, linked: linked }), source: Unknown, copy: NoCopy, recipient: 0 }
```

### Recipient line weights sum additions plus deletions over claimed commit paths

The allocation receives one recipient per actor credited by a canonical
commit-path claim of the unit, derived from the claims themselves, so no
credited actor can be omitted. A claim adds the additions plus deletions of
its claimed file in its commit; for a retained copy, the accepted copy's
commit and file. A renamed file claimed under both its new and its previous
path counts once per source, commit and file. A merge commit's claim counts
the claimed file of its one merge resolution, without that de-duplication.
A claim with no credited actor adds nothing. A repeated claim, a claim with
more than one credited actor or an unknown actor set, a merge commit
without exactly one resolution or without the claimed file, and a
non-merge commit whose attribution is missing, repeated, limited or lacks
exactly one matching file, make the unit's weights incomplete, which holds
its allocation.

```quint
type PathClaim = { claim: int, actor: int, creditedActors: int, actorsKnown: bool, file: int, merge: bool,
  resolutions: int, attributed: bool, limited: bool, fileFound: bool, additions: int, deletions: int }
type LineTally = { counted: List[int], lines: int }
pure def claimUsable(c: PathClaim): bool =
  c.actorsKnown and c.creditedActors <= 1 and c.additions >= 0 and c.deletions >= 0 and
  (c.creditedActors == 0 or
    (if (c.merge) c.resolutions == 1 and c.fileFound else c.attributed and not(c.limited) and c.fileFound))
pure def claimsComplete(claims: List[PathClaim]): bool =
  claims.every(c => claimUsable(c) and claims.select(o => o.claim == c.claim).length() == 1)
pure def tallyClaim(t: LineTally, c: PathClaim, actor: int): LineTally =
  if (c.creditedActors != 1) t
  else if (c.merge) (if (c.actor == actor) { ...t, lines: t.lines + c.additions + c.deletions } else t)
  else { counted: if (t.counted.includes(c.file)) t.counted else t.counted.append(c.file),
    lines: if (c.actor == actor and not(t.counted.includes(c.file))) t.lines + c.additions + c.deletions else t.lines }
pure def linesFor(claims: List[PathClaim], actor: int): int =
  claims.foldl({ counted: List(), lines: 0 }, (t, c) => tallyClaim(t, c, actor)).lines
pure def addActor(xs: List[int], c: PathClaim): List[int] =
  if (c.creditedActors == 1 and c.actor > 0 and not(xs.includes(c.actor))) xs.append(c.actor) else xs
pure def actorsOf(claims: List[PathClaim]): List[int] = claims.foldl(List(), (acc, c) => addActor(acc, c))
pure def recipientLines(claims: List[PathClaim]): List[A::Recipient] =
  actorsOf(claims).listMap(actor => { actor: actor, lines: linesFor(claims, actor) })
pure def completeLines(claims: List[PathClaim]): bool = claimsComplete(claims)
pure val plainClaim: PathClaim = { claim: 1, actor: 1, creditedActors: 1, actorsKnown: true, file: 7, merge: false,
  resolutions: 0, attributed: true, limited: false, fileFound: true, additions: 2, deletions: 1 }
pure def lawLinesAreAdditionsPlusDeletions(additions: int, deletions: int): bool =
  linesFor(List({ ...plainClaim, additions: additions, deletions: deletions }), 1) == additions + deletions
pure def lawRenamedFileCountsOnce(additions: int, deletions: int): bool =
  linesFor(List({ ...plainClaim, additions: additions, deletions: deletions },
    { ...plainClaim, claim: 2, additions: additions, deletions: deletions }), 1) == additions + deletions
pure def lawMergeResolutionCounted(additions: int, deletions: int): bool =
  linesFor(List({ ...plainClaim, merge: true, resolutions: 1, attributed: false, additions: additions, deletions: deletions }), 1) ==
    additions + deletions
pure def lawUnresolvedMergeHolds(resolutions: int): bool =
  resolutions != 1 implies not(completeLines(List({ ...plainClaim, merge: true, resolutions: resolutions })))
pure def lawSharedClaimHolds(creditedActors: int): bool =
  creditedActors > 1 implies not(completeLines(List({ ...plainClaim, creditedActors: creditedActors })))
pure def lawRepeatedClaimHolds(additions: int): bool = not(completeLines(List(plainClaim, { ...plainClaim, additions: additions })))
pure val creditedActorsValues = Set(0, 1, 2)
pure val resolutionsValues = Set(0, 1, 2)
```

### A joint assessment credits a retained copy to its original author, a verified repair to its accepted author, and holds an unverified repair

A claim that a retained copy carries into a joint assessment is credited by
the commit its evidence names, never by the carrier as such. An ordinary
copy credits the original commit's recipient, chosen by the rule above: its
linked primary author, else the original pull request's creator. An
original merge commit credits only when it has exactly one recorded merge
resolution and that resolution names the claimed path. A verified
original-contributor repair credits the accepted copy's commit the same way:
its linked author, else the accepted pull request's creator. An unverified
repair, or an original merge without that one resolution, leaves the
claim's actor set unknown, which holds the whole joint assessment. In every
case the claim's lines are counted from the accepted copy's commit and file
(the line rule above): when the accepted copy is a merge commit without
exactly one resolution naming the claimed path, its actor stays known and
only the unit's lines are incomplete, which holds the joint assessment
when the unit has several recipients and leaves a sole recipient the whole
score ([allocation](./allocation.md)). Development:
`workUnitCreditActorIds`, `workUnitLineWeights`.

```quint
type RetainedCopy = OrdinaryCopy | VerifiedRepair | UnverifiedRepair
type CopyCredit = CreditsOriginal | CreditsAccepted | CopyCreditUnknown
pure def copyCredit(retained: RetainedCopy, merge: bool, resolutions: int, namesPath: bool): CopyCredit =
  match retained {
  | OrdinaryCopy => if (not(merge) or (resolutions == 1 and namesPath)) CreditsOriginal else CopyCreditUnknown
  | VerifiedRepair => CreditsAccepted
  | UnverifiedRepair => CopyCreditUnknown }
pure def copyClaimRecipient(credit: CopyCredit, original: CommitAttribution, accepted: CommitAttribution): int =
  match credit { | CreditsOriginal => recipientFor(original) | CreditsAccepted => recipientFor(accepted) | CopyCreditUnknown => 0 }
pure val carrierCommit: CommitAttribution = { ...initial, primary: Seen({ actor: 1, kind: User, linked: true }) }
pure def lawOrdinaryCopyCreditsOriginal(resolutions: int, namesPath: bool): bool =
  copyCredit(OrdinaryCopy, false, resolutions, namesPath) == CreditsOriginal
pure def lawMergedOriginalNeedsOneResolutionNamingPath(resolutions: int, namesPath: bool): bool =
  (copyCredit(OrdinaryCopy, true, resolutions, namesPath) == CreditsOriginal) iff (resolutions == 1 and namesPath)
pure def lawVerifiedRepairCreditsAccepted(merge: bool, resolutions: int, namesPath: bool): bool =
  copyCredit(VerifiedRepair, merge, resolutions, namesPath) == CreditsAccepted
pure def lawUnverifiedRepairHolds(merge: bool, resolutions: int, namesPath: bool): bool =
  copyCredit(UnverifiedRepair, merge, resolutions, namesPath) == CopyCreditUnknown
pure def lawCarrierCreditedOnlyThroughRepair(retained: RetainedCopy, merge: bool, resolutions: int, namesPath: bool): bool =
  copyCredit(retained, merge, resolutions, namesPath) == CreditsAccepted implies retained == VerifiedRepair
pure def sometimesCopyCreditsOriginal(a: CommitAttribution): bool = a.phase == Credited and acceptedAs(a.acceptance, false, false)
  and copyClaimRecipient(copyCredit(OrdinaryCopy, false, 0, true), a, carrierCommit) == a.recipient
  and a.recipient != recipientFor(carrierCommit)
pure def sometimesMergedOriginalCopyCredited(a: CommitAttribution): bool = a.phase == Credited and acceptedAs(a.acceptance, true, false)
  and copyClaimRecipient(copyCredit(OrdinaryCopy, true, 1, true), a, carrierCommit) == a.recipient
  and a.recipient != recipientFor(carrierCommit)
pure def sometimesRepairCreditsAccepted(a: CommitAttribution): bool = a.phase == Credited
  and copyClaimRecipient(copyCredit(VerifiedRepair, false, 0, true), carrierCommit, a) == a.recipient
  and a.recipient != recipientFor(carrierCommit)
pure val retainedValues = Set(OrdinaryCopy, VerifiedRepair, UnverifiedRepair)
pure val namesPathValues = Set(true, false)
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
pure val mergeValues = Set(true, false)
pure val carryValues = Set(VerifiedCarry({ original: 1, followup: true, parentEdges: true }),
  VerifiedCarry({ original: 1, followup: true, parentEdges: false }), VerifiedCarry({ original: 2, followup: false, parentEdges: false }),
  AmbiguousCarry)
pure val originalValues = Set(0, 1, 2)
pure val aValues = Set(initial, { ...initial, primary: Seen({ actor: 2, kind: User, linked: true }) },
  { ...initial, project: "p", primary: Seen({ actor: 2, kind: User, linked: true }) },
  { ...initial, occurredAt: 2432210, primary: Seen({ actor: 2, kind: User, linked: true }), copy: VerifiedCopy({ actor: 1, kind: User }) })
pure val unitsValues = Set(W::initial,
  { ...W::initial, nextId: 2, units: List({ id: 1, project: "p", sources: Set(1), commits: Set(11), band: 0, value: 10,
    accepted: true, acceptedPeriod: 24320, superseded: false, frozen: false, supersededBy: 0 }) },
  { ...W::initial, nextId: 2, units: List({ id: 1, project: "p", sources: Set(2), commits: Set(11), band: 0, value: 10,
    accepted: true, acceptedPeriod: 24320, superseded: false, frozen: false, supersededBy: 0 }) })
```

## Story: Hold fresh implementation credit the census cannot prove

> As a maintainer, I want a merged pull request that the census cannot show
> did new work to keep its earlier Points without earning new implementation
> credit, so that an empty marker, a promotion or a repeat of rewarded work is
> never paid twice.

### A fresh unassessed implementation is held when its acceptance repeats rewarded work or has no commit census

Under the value policy (the scorer received value decisions) a merged pull
request accepted at or after the v2 score with no human ratification and no
assessed value record earns no new implementation credit, keeps every
earlier award and reports `incomplete` coverage with no record digest when:
rolling scoring sees an empty commit census for a merge under the value
policy; it carries an empty acceptance marker; it is an unproved zero-line
promotion (`CO::unprovedZeroLinePromotion` of its census commits, a commit
owned when the implementation owners give it to this source); it is an
unresolved implementation source; or its accepted-implementation digest
(repository and native delta digest) was already scored in this or an
earlier window. For a changed two-parent merge without a joint decision,
a difference between the bound pull request totals and the line counts of
its accepted first-parent change makes the implementation source unresolved.
Every credited source records its digest, so a later exact repeat is held. Legacy scoring without value decisions is unchanged
(development `src/lib/leaderboard.ts` implementation hold,
`implementation_credit_gate` `selectCommitCensus`, `selectZeroLineWork`,
`selectPreviousSubmission`). A source held as unavailable reports
`unresolved` and keeps its digest; that hold is not this one.

```quint
type CreditSelection = { v2: bool, valueInput: bool, underValuePolicy: bool, rolling: bool, ratified: bool,
  valueRecord: bool, jointAssessed: bool, commits: List[CO::CensusCommit], emptyMarker: bool, unresolved: bool,
  digestScored: bool, earlierOverlap: bool }
pure def freshCreditHeld(selection: CreditSelection): bool =
  selection.v2 and selection.valueInput and not(selection.ratified) and not(selection.valueRecord) and
  ((selection.rolling and selection.underValuePolicy and selection.commits.length() == 0) or selection.emptyMarker or
    CO::unprovedZeroLinePromotion(selection.commits) or selection.unresolved or selection.digestScored)
pure def scoredDigestsAfter(scored: Set[str], digest: str, credited: bool): Set[str] =
  if (credited and digest != "") scored.union(Set(digest)) else scored
pure def lawLegacyScoringNeverHeld(selection: CreditSelection): bool =
  (not(selection.valueInput) or not(selection.v2)) implies not(freshCreditHeld(selection))
pure def lawAssessedOrRatifiedSourceNotFreshHeld(selection: CreditSelection): bool =
  (selection.ratified or selection.valueRecord) implies not(freshCreditHeld(selection))
pure def lawEmptyRollingCensusHeld(selection: CreditSelection): bool =
  (selection.v2 and selection.valueInput and selection.rolling and selection.underValuePolicy and not(selection.ratified) and
    not(selection.valueRecord)) implies freshCreditHeld({ ...selection, commits: List() })
pure def lawScoredDigestHoldsItsRepeat(selection: CreditSelection, digest: str): bool =
  (selection.v2 and selection.valueInput and not(selection.ratified) and not(selection.valueRecord) and digest != "") implies
    freshCreditHeld({ ...selection, digestScored: scoredDigestsAfter(Set(), digest, true).contains(digest) })
```

### Earlier accepted work owns its commits across windows, and a standalone assessment that overlaps it waits for joint review

Rolling scoring also gives a source its accepted ordinary commit (the
native accepted output, when every census commit has a known parent count
and one has a single parent), and, for unassessed implementation credit (no
ratification, no assessed value record, no assessed joint decision), the
commits of earlier windows' positively rewarded sources, read from the
validated Points journal (`previousAcceptedOrdinaryOwners`,
`accepted-implementation-history.ts` `previousPositiveImplementationSources`:
a positive latest ordinary merged-work award recorded no later than the
cutoff, merged before it, not a duplicate-retirement zero). A standalone
value assessment whose commits an earlier accepted source of another pull
request owns is held for joint review: its implementation earns nothing,
its coverage is `incomplete` with no record digest, and its reviews keep
their own assessment binding through `reviewAssessmentDigest`. Review
exclusions keep the full current actor census. Historical scoring uses none
of these rolling-only owners or holds.

```quint
pure def ownsAcceptedOrdinaryCommit(rolling: bool, acceptedCommit: bool, parentsKnown: bool, singleParent: bool): bool =
  rolling and acceptedCommit and parentsKnown and singleParent
pure def usesEarlierOwners(selection: CreditSelection): bool =
  selection.rolling and not(selection.ratified) and not(selection.valueRecord) and not(selection.jointAssessed)
pure def standaloneOverlapHeld(selection: CreditSelection): bool =
  selection.rolling and selection.valueRecord and not(selection.ratified) and selection.earlierOverlap
pure def implementationHeld(selection: CreditSelection): bool = freshCreditHeld(selection) or standaloneOverlapHeld(selection)
pure def heldRecordDigest(selection: CreditSelection, latestDigest: str): str =
  if (implementationHeld(selection)) "" else latestDigest
pure def reviewAssessmentDigestOf(selection: CreditSelection, latestDigest: str): str =
  if (standaloneOverlapHeld(selection)) latestDigest else ""
pure val ownedChangeRow: CO::CensusCommit = { parentsKnown: true, parents: 1, owned: true, linesKnown: true, additions: 2,
  deletions: 0, files: 1 }
pure def lawHeldCoverageHasNoRecordDigest(selection: CreditSelection, digest: str): bool =
  implementationHeld(selection) implies heldRecordDigest(selection, digest) == ""
pure def lawStandaloneHoldKeepsReviewBinding(selection: CreditSelection, digest: str): bool =
  (standaloneOverlapHeld(selection) implies reviewAssessmentDigestOf(selection, digest) == digest) and
  (not(standaloneOverlapHeld(selection)) implies reviewAssessmentDigestOf(selection, digest) == "")
pure def lawHistoricalScoringHasNoRollingHolds(selection: CreditSelection): bool =
  not(selection.rolling) implies (not(standaloneOverlapHeld(selection)) and not(usesEarlierOwners(selection)) and
    freshCreditHeld({ ...selection, commits: List() }) == freshCreditHeld({ ...selection, commits: List(ownedChangeRow) }))
pure def lawHistoricalOwnsNoAcceptedCommit(acceptedCommit: bool, parentsKnown: bool, singleParent: bool): bool =
  not(ownsAcceptedOrdinaryCommit(false, acceptedCommit, parentsKnown, singleParent))
pure val freshSelection: CreditSelection = { v2: true, valueInput: true, underValuePolicy: true, rolling: true,
  ratified: false, valueRecord: false, jointAssessed: false, commits: List(ownedChangeRow), emptyMarker: false,
  unresolved: false, digestScored: false, earlierOverlap: false }
pure val selectionValues = Set(freshSelection, { ...freshSelection, commits: List() },
  { ...freshSelection, commits: List(CO::emptyMarkerRow, CO::carriedChangeRow) }, { ...freshSelection, emptyMarker: true },
  { ...freshSelection, unresolved: true, rolling: false }, { ...freshSelection, digestScored: true },
  { ...freshSelection, valueRecord: true, earlierOverlap: true }, { ...freshSelection, valueRecord: true, earlierOverlap: true, rolling: false },
  { ...freshSelection, ratified: true, commits: List() }, { ...freshSelection, valueInput: false, emptyMarker: true })
pure val digestValues = Set("", "d1")
pure val acceptedCommitValues = Set(true, false)
pure val parentsKnownValues = Set(true, false)
pure val singleParentValues = Set(true, false)
```
