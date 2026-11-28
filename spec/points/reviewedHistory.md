# Reviewed historical Points packets

The owner-reviewed historical Points runner of `development`
(`scripts/reviewed-historical-points.ts`, `scripts/run-reviewed-historical-points.ts`,
the `reviewed-historical-points` workflow and its tests) reconstructs one
project's audited history from a private packet and appends it to the
published [Points journal](./journal.md). The packet's transport (chunks,
assembly and the owner-reviewed digest) is the
[correction import](./corrections.md) rule "Chunks are verified by digest,
assembled only when complete, and applied only under the owner-reviewed
digest". The runner itself verifies every Git object it relies on; the
evidence records below are its own verified results, never a request's.
Source, commit and tree identities are integers here; times are the
journal's.

This machine binds one reviewed source whose pull request has both submitted
commits and a separate accepted squash output (`source_import`
`bindMixed`). The libraries below decide whether a packet, an owner
recipient correction or a duplicate retirement may be appended.

## Story: Apply a reviewed historical packet only as the owner reviewed it

> As the repository owner, I want a reviewed historical packet to change only
> the October awards I reviewed, exactly as reviewed, so that a later change
> to the published history refuses it instead of rewriting it.

### A reviewed source's submitted commits and accepted squash bind one live source

The earlier acceptance context must name the squash output as the source's
accepted merge, the submitted and squash views must be the same live source
(repository, URL, head, occurrence and author), and the squash output is
not one of the submitted commits. A path claim takes the squash role only
when its commit is the squash output; otherwise its commit must be one of
the submitted commits. Bound evidence never changes once the packet is
validated.

```quint
import allocation as A from "./allocation"
import periods as P from "./periods"
type MixedProof = { context: bool, submittedIdentity: int, squashIdentity: int, contextAcceptedOutput: int,
  squashOutput: int, submitted: List[int], pathCommit: int }
type PathRole = NoRole | SubmittedRole | SquashRole
type Binding = { proof: MixedProof, role: PathRole, validated: bool }
pure val noProof: MixedProof = { context: false, submittedIdentity: 0, squashIdentity: 0, contextAcceptedOutput: 0,
  squashOutput: 0, submitted: List(), pathCommit: 0 }
pure val initial: Binding = { proof: noProof, role: NoRole, validated: false }
pure def mixedBound(p: MixedProof): bool =
  p.context and p.submittedIdentity == p.squashIdentity and p.contextAcceptedOutput == p.squashOutput and
  not(p.submitted.includes(p.squashOutput)) and (p.pathCommit == p.squashOutput or p.submitted.includes(p.pathCommit))
pure def pathRole(p: MixedProof): PathRole = if (p.pathCommit == p.squashOutput) SquashRole else SubmittedRole
pure def canBindMixed(b: Binding, p: MixedProof): bool = not(b.validated) and mixedBound(p)
pure def bindMixed(b: Binding, p: MixedProof): Binding = { ...b, proof: p, role: pathRole(p) }
pure def alwaysRoleBound(b: Binding): bool =
  (b.role != NoRole implies mixedBound(b.proof)) and
  (b.role == SquashRole implies b.proof.pathCommit == b.proof.squashOutput) and
  (b.role == SubmittedRole implies b.proof.pathCommit != b.proof.squashOutput)
pure def stepValidatedBindingFixed(before: Binding, after: Binding): bool =
  before.validated implies (after.validated and after.proof == before.proof and after.role == before.role)
pure def sometimesSquashRoleValidated(b: Binding): bool = b.validated and b.role == SquashRole
pure def sometimesSubmittedRoleValidated(b: Binding): bool = b.validated and b.role == SubmittedRole
pure val mixed: MixedProof = { context: true, submittedIdentity: 1, squashIdentity: 1, contextAcceptedOutput: 20,
  squashOutput: 20, submitted: List(10), pathCommit: 20 }
pure val pValues = Set(mixed, { ...mixed, pathCommit: 10 }, { ...mixed, squashIdentity: 2 }, { ...mixed, contextAcceptedOutput: 30 },
  { ...mixed, submitted: List(10, 20) }, { ...mixed, pathCommit: 30 }, { ...mixed, context: false })
```

### A reviewed packet applies only to the baseline it was reviewed on and only as reviewed

The published journal's digest and revision count must equal the packet's
baseline, and the run happens no earlier than the review and the baseline.
The reviewed value keys must be exactly the value-decided changes the value
snapshot makes inside the project and the audited window. Every appended
revision lies in the project and the window `[from, through)`, is never
payout recognition and keeps its key's occurrence time, and the digest of
the resulting journal must equal the reviewed candidate's. Any difference
refuses the whole packet: a reviewed source is validated only with a packet
that previews, and the journal appends a recipient correction or a duplicate
retirement only with a packet it admits. A preview run (no
`HISTORICAL_POINTS_APPLY`) builds the whole candidate, its recipient
corrections and duplicate retirements included, and is admitted when the
packet previews; an apply run is admitted only when the packet applies. A
preview writes the import statements but never imports them: only an apply
run whose packet applies reaches the protected import.

Applying, unlike a preview, also needs the packet's replay qualification:
the trusted receipt of the canonical main `replay-assessments` run at the
same source commit (job `publish`, a receipt of at most 16 KiB in an
archive of at most 32 KiB, exact field sets) whose journals, read again at
the receipt's cutoffs, classify the same, and whose rebuilt value
projection's digest equals the packet's qualification; without one apply is
refused ("Applying historical Points requires a reviewed replay
qualification") and a preview still runs. The runner captures both
assessment journal heads before it checks the value records, and the final
batch insert itself requires the exact prior Points checkpoint (the latest
batch digest and revision count still the reviewed baseline) and no joint
or legacy assessment appended in the project or repository after the
captured heads (development `pointsSql` recording conditions,
`source_import` `qualifyReplay`, `appendAssessment`, `advanceBaseline`,
`publishHistorical`); an assessment appended elsewhere changes nothing.

```quint
type PacketRun = { baselineMatches: bool, reviewedAt: int, baselineAt: int, now: int, valueKeysExact: bool,
  deltaInScope: bool, occurrencesKept: bool, candidateMatches: bool, qualifiedReplay: bool, assessmentCurrent: bool,
  baselineCurrent: bool, preview: bool }
pure def packetPreviews(r: PacketRun): bool =
  r.baselineMatches and r.now >= r.reviewedAt and r.now >= r.baselineAt and r.valueKeysExact and r.deltaInScope and
  r.occurrencesKept and r.candidateMatches
pure def packetApplies(r: PacketRun): bool =
  packetPreviews(r) and r.qualifiedReplay and r.assessmentCurrent and r.baselineCurrent
pure def packetAdmits(r: PacketRun): bool = if (r.preview) packetPreviews(r) else packetApplies(r)
pure def packetImports(r: PacketRun): bool = not(r.preview) and packetApplies(r)
pure def canValidate(b: Binding, packetRun: PacketRun): bool = not(b.validated) and packetPreviews(packetRun)
pure def validate(b: Binding, packetRun: PacketRun): Binding = { ...b, validated: true }
pure def lawChangedBaselineRefused(r: PacketRun): bool = not(r.baselineMatches) implies not(packetApplies(r))
pure def lawChangedCandidateRefused(r: PacketRun): bool = not(r.candidateMatches) implies not(packetApplies(r))
pure def lawRelevantAppendRefused(r: PacketRun): bool = not(r.assessmentCurrent) implies not(packetApplies(r))
pure def lawChangedCheckpointRefused(r: PacketRun): bool = not(r.baselineCurrent) implies not(packetApplies(r))
pure def lawUnqualifiedApplyRefused(r: PacketRun): bool = not(r.qualifiedReplay) implies not(packetApplies(r))
pure def lawPreviewNeedsNoQualification(r: PacketRun): bool =
  packetPreviews({ ...r, qualifiedReplay: false, assessmentCurrent: false, baselineCurrent: false }) == packetPreviews(r)
pure def lawPreviewNeverImported(r: PacketRun): bool = r.preview implies not(packetImports(r))
pure def lawPreviewAdmitsWithoutQualification(r: PacketRun): bool =
  r.preview implies (packetAdmits({ ...r, qualifiedReplay: false, assessmentCurrent: false, baselineCurrent: false }) == packetAdmits(r))
pure def lawApplyAdmitsOnlyWhatApplies(r: PacketRun): bool = not(r.preview) implies (packetAdmits(r) == packetApplies(r))
pure def lawImportedPacketApplies(r: PacketRun): bool = packetImports(r) implies (packetApplies(r) and packetAdmits(r))
pure val readyRun: PacketRun = { baselineMatches: true, reviewedAt: 2432150, baselineAt: 2432140, now: 2432160,
  valueKeysExact: true, deltaInScope: true, occurrencesKept: true, candidateMatches: true, qualifiedReplay: true,
  assessmentCurrent: true, baselineCurrent: true, preview: false }
pure val rValues = Set(readyRun, { ...readyRun, baselineMatches: false }, { ...readyRun, now: 2432100 },
  { ...readyRun, candidateMatches: false }, { ...readyRun, qualifiedReplay: false }, { ...readyRun, assessmentCurrent: false },
  { ...readyRun, baselineCurrent: false }, { ...readyRun, preview: true },
  { ...readyRun, preview: true, qualifiedReplay: false, assessmentCurrent: false, baselineCurrent: false },
  { ...readyRun, preview: true, candidateMatches: false })
pure val packetRunValues = rValues
```

### An owner recipient correction redistributes an unchanged October pool by the reviewed weights

Each correction names one source and work unit once, binds its reviewed
dossier by digest and lists every accepted claim of the canonical proof. The
recorded pool must be the source's October implementation awards, unchanged
since the owner's review (the same latest revision for every key) and of
one source identity. No recipient may be banned at or before the award's
occurrence. The whole pool, a positive safe total, is divided by the
reviewed positive weights through the [allocation](./allocation.md)
largest remainder; a key that loses its share records zero, and the result
must equal the reviewed one. Each revision carries the decision
`owner_october_<dossier digest>` with the October reviewed accepted-lines
reason. The reason reflects the reviewed shares and applies when one or
several recipients receive credit. A later routine historical reallocation
holds the reviewed pool, including older reviewed records with the
`owner_october_<dossier digest>` decision ID and the original-contributor
reason. The rolling snapshot also preserves the reviewed pool. Atomic import
refuses to append the decision once the reward period is protected, even
when the reviewed shares already match the recorded amounts.

```quint
type RecipientCorrection = { uniqueUnit: bool, dossierBound: bool, claimsMatchProof: bool, octoberPool: bool,
  poolUnchanged: bool, oneIdentity: bool, bannedByOccurrence: bool, pool: int, recipients: List[A::Recipient],
  reviewedShares: List[A::PointShare] }
pure def positiveWeights(recipients: List[A::Recipient]): bool = recipients.every(r => r.lines > 0)
pure def correctedShares(c: RecipientCorrection): List[A::PointShare] = A::allocatePoints(c.pool, c.recipients)
pure def recipientCorrectionApplies(c: RecipientCorrection): bool =
  c.uniqueUnit and c.dossierBound and c.claimsMatchProof and c.octoberPool and c.poolUnchanged and c.oneIdentity and
  not(c.bannedByOccurrence) and c.pool > 0 and c.pool <= P::maxSafe and A::validRecipients(c.recipients) and
  positiveWeights(c.recipients) and correctedShares(c) == c.reviewedShares
pure def lawChangedPoolRefused(correction: RecipientCorrection): bool =
  not(correction.poolUnchanged) implies not(recipientCorrectionApplies(correction))
pure def lawBannedRecipientRefused(correction: RecipientCorrection): bool =
  correction.bannedByOccurrence implies not(recipientCorrectionApplies(correction))
pure val readyCorrection: RecipientCorrection = { uniqueUnit: true, dossierBound: true, claimsMatchProof: true, octoberPool: true,
  poolUnchanged: true, oneIdentity: true, bannedByOccurrence: false, pool: 30,
  recipients: List({ actor: 1, lines: 1 }, { actor: 2, lines: 2 }),
  reviewedShares: List({ actor: 1, points: 10 }, { actor: 2, points: 20 }) }
pure def lawUnreviewedResultRefused(correction: RecipientCorrection): bool =
  correctedShares(correction) != correction.reviewedShares implies not(recipientCorrectionApplies(correction))
pure val correctionValues = Set(readyCorrection, { ...readyCorrection, poolUnchanged: false },
  { ...readyCorrection, bannedByOccurrence: true }, { ...readyCorrection, recipients: List({ actor: 1, lines: 0 }) },
  { ...readyCorrection, reviewedShares: List({ actor: 1, points: 15 }, { actor: 2, points: 15 }) })
```

### A duplicate retirement zeroes only an October pool whose every claim an earlier accepted source already covers

The retired source and each earlier source must be complete and audited,
each earlier source accepted no later than the retired one. The retirement
zeroes the source's October pool, unchanged since review, with the decision
`owner_duplicate_<dossier digest>`, only when every claimed commit path is
covered exactly once, by an earlier source or an accepted squash of the
dossier, and every accepted squash covers a claim. A retirement with no
claimed path rests on an earlier native acceptance instead: it applies only
when the earlier acceptance proof covers at least one commit of the source
(development: `identical || expected.length > 0 || acceptedCommits.size > 0`);
with no claim, no covered commit, no identical accepted change and no net
outcome it is refused ("Duplicate retirement has extra or empty coverage"). The runner supplies each
verified record below, and the retirement applies only when every one of them
meets its condition:

- an accepted promotion keeps the submitted content: its merge has two
  parents, the second is the source head and the first is not, and the
  merge tree equals the head tree; this is required whenever the
  retirement relies on an accepted squash or an earlier acceptance;
- an owner-reviewed unchanged promotion: the head tree equals its base
  tree, the accepted tree equals its first parent's tree, and the merge
  changes no file and no line;
- an accepted squash is another source, accepted earlier, its own first
  accepted source, with one parent and a non-empty set of distinct paths
  whose counts sum to its totals;
- an earlier native acceptance retires only its repeated promotion: each
  commit it covers is that exact commit of the source, first accepted by
  the earlier source, with the same author and parents, and an earlier
  source that is itself being retired was accepted earlier and already
  validated in this packet;
- every earlier acceptance still holds a reward, or is an earlier validated
  retirement, a reviewed bot follow-up before October, a reviewed historical
  award zeroed without decision, or wholly bot-authored;
- a covered claim stays rewarded: by a canonical joint unit (assessed with a
  positive tier, whose completion source is the last of its acceptance
  sources ordered by acceptance time and then GitHub node ID in code-unit
  order), by a canonical bot exclusion (a unit whose every claim names no
  implementation actor, or a squash whose author and commit author are
  bots), or by a positive award of the earlier source;
- an earlier GitHub acceptance carried as a submitted merge of the promotion
  covers that merge only when its earlier source, accepted before the
  retired one and not itself retiring, names it as its accepted merge, the
  merge has two parents with the earlier head second, the promotion's
  member is that two-parent merge, the promotion's complete range and
  ordered parents were read from its actual first parent (an automatic
  merge proof must reproduce the accepted tree), and the earlier source
  holds a positive ordinary award of its own single-source candidate;
- for every earlier source and accepted squash whose accepted merge differs
  from the retired one's, GitHub's comparison must show the retired merge is
  not already contained in the earlier source's head or merge: an
  unavailable or inconsistent ancestry, or an earlier source that already
  carries the retiring merge, refuses ("Earlier source already carries the
  retiring PR's merge"; development
  `verifyHistoricalDuplicateAcceptanceOrder`, `source_import`
  `retireDistinctDuplicate`).

Instead of claim coverage, a retirement may rest on one identical accepted
change (`identicalAcceptedChange`): exactly one earlier source, accepted
strictly earlier and not itself retiring, whose complete accepted
first-parent diff the runner verified the retired source repeats, with no
other proof (no promotion, unchanged promotion, earlier acceptance proof,
squash or claim coverage), a pool keyed by the source's own record, and a
positive ordinary award of the earlier source. Its kinds: a shared accepted
commit (both sources record the same accepted merge and the same head, and
the earlier award was already positive at the baseline: `bindSharedAcceptance`);
a carried acceptance (the later head is the exact earlier accepted merge and
adds no members, the earlier award was positive at the baseline and the
packet leaves the earlier ordinary pool unchanged, or only confirms it with
the verified allocation decision); an empty squash (the later squash is
empty, its parent already holds the change, its one commit is its head with
one parent, and the earlier award was positive at the baseline); an empty
merge (both acceptances have two parents with their submitted head second,
both complete submitted changes match the earlier accepted first-parent
change, and that change remains on the later first-parent history with every
changed path intact. The later acceptance leaves its first-parent tree
unchanged. Both ordinary pools retain their exact baseline revisions through
review and have identical positive shares by contributor. Existing zero shares
retain their revisions. The earlier source cannot carry the later accepted merge in its submitted or accepted history);
a surviving carrier (two distinct merges with one result, the source's one
commit its head with one parent and authored by the original human author,
who holds the one positive ordinary award of each source with the same
amount in October, and a carrier tip refreshed at most once along the
first-parent chain without the retiring merge and pinned until the import:
`refreshCarrierTip`, `retireSurvivingCarrier`); or a distinct squash (its
one commit is its head with one parent). The claim-coverage ancestry check
does not apply to an identical accepted change, which has its own native
acceptance checks.

Instead of claim coverage or an identical accepted change, a retirement may
rest on a net outcome (`netOutcome`, main): the retired source's whole
accepted first-parent diff is an ordered composition of earlier rewarded
path changes. It is exclusive of every other proof: no earlier source,
coverage, identical accepted change, earlier acceptance proof, unchanged
promotion, accepted squash or accepted promotion. The protected runner
reads in one GraphQL read before verification, and finds unchanged again
after it and just before import, the retired pull request and every named
earlier pull request in the same public repository (merged, same number, URL, merge time and merge commit,
the retired one with its audited head and commit count); acquires the
retired merge's objects in pinned Git; requires the merge's parents to be
exactly the reviewed first parent and the source head; requires the
source's complete submitted range (head back to the first parent) to be
exactly the reviewed commits with their ordered parents; requires each
earlier source's accepted merge to lie in that submitted range; and derives
every first-parent raw path transition (no renames; modes 000000, 100644,
100755, 120000, 160000) of the retired merge and of each earlier merge. The
proof must name every path of the retired merge's diff exactly once and
bind the raw diff bytes by SHA-256; for each path the named earlier sources,
in strictly increasing acceptance time, must carry the path from the
retired merge's preimage through each intermediate mode and object identity
to its postimage, and every named earlier source is used by some path. Each
earlier source is accepted strictly before the retired one, named once,
with a distinct merge, and is not itself retiring; its ordinary award
revision (category merged-pull-request, keyed by its project, actor,
category and source, with the pull URL and merge time of the earlier source
and a positive amount, recorded no later than the review) is the same
revision at the baseline and in the reviewed result. The retired pool is
the single-source pull-request candidate keyed by the source's own record,
has a positive row, and every row is the baseline's latest revision. The
dossier binds the proof's digest (`netOutcomeSha256`). The ancestry check
does not apply to a net outcome either.

```quint
type AcceptedPromotion = { headTree: int, mergeTree: int, mergeParents: List[int], sourceHead: int }
pure def promotionKeepsContent(a: AcceptedPromotion): bool =
  a.headTree == a.mergeTree and a.mergeParents.length() == 2 and a.mergeParents.nthOr(1, 0) == a.sourceHead and
  a.mergeParents.nthOr(0, 0) != a.sourceHead
type UnchangedPromotion = { headTree: int, baseTree: int, acceptedTree: int, firstParentTree: int, mergeParents: List[int],
  sourceHead: int, changedFiles: int, changedLines: int, proofComplete: bool }
pure def unchangedPromotion(u: UnchangedPromotion): bool =
  u.proofComplete and u.headTree == u.baseTree and u.acceptedTree == u.firstParentTree and u.mergeParents.length() == 2 and
  u.mergeParents.nthOr(1, 0) == u.sourceHead and u.mergeParents.nthOr(0, 0) != u.sourceHead and
  u.changedFiles == 0 and u.changedLines == 0
type AcceptedSquash = { source: int, occurredAt: int, firstAccepted: int, parents: int, paths: int, distinctPaths: bool,
  countsMatch: bool, authorKnown: bool }
pure def squashCovers(s: AcceptedSquash, retired: int, retiredAt: int): bool =
  s.source != retired and s.occurredAt < retiredAt and s.firstAccepted == s.source and s.parents == 1 and
  s.paths > 0 and s.distinctPaths and s.countsMatch and s.authorKnown
type NativeCover = { inSource: bool, owner: int, ownerAt: int, ownerRetiring: bool, ownerValidated: bool,
  commitFirstAccepted: int, retainedFirstAccepted: int, sameAuthor: bool, sameParents: bool }
pure def nativeCovers(c: NativeCover, retiredAt: int): bool =
  c.inSource and c.owner > 0 and (not(c.ownerRetiring) or (c.ownerAt < retiredAt and c.ownerValidated)) and
  c.commitFirstAccepted == c.owner and c.retainedFirstAccepted == c.owner and c.sameAuthor and c.sameParents
type EarlierBasis = { source: int, acceptedAt: int, complete: bool, coversCommits: bool, rewarded: bool,
  validatedEarlierRetirement: bool, reviewedBotFollowups: bool, reviewedHistoricalAward: bool, allBot: bool }
pure def earlierJustified(e: EarlierBasis): bool =
  not(e.coversCommits) or e.rewarded or e.validatedEarlierRetirement or e.reviewedBotFollowups or
  e.reviewedHistoricalAward or e.allBot
pure def earlierAccepted(e: EarlierBasis, retired: int, retiredAt: int): bool =
  e.source > 0 and e.source != retired and e.complete and e.acceptedAt >= 0 and e.acceptedAt <= retiredAt and earlierJustified(e)
type AcceptanceSource = { source: int, acceptedAt: int, nodeRank: int }
pure def laterAcceptance(newer: AcceptanceSource, kept: AcceptanceSource): bool =
  newer.acceptedAt > kept.acceptedAt or (newer.acceptedAt == kept.acceptedAt and newer.nodeRank > kept.nodeRank)
pure val noAcceptance: AcceptanceSource = { source: 0, acceptedAt: -1, nodeRank: -1 }
pure def completionSource(sources: List[AcceptanceSource]): int =
  sources.foldl(noAcceptance, (acc, a) => if (laterAcceptance(a, acc)) a else acc).source
pure def jointCompletes(sources: List[AcceptanceSource], awardSource: int): bool =
  sources.length() > 0 and completionSource(sources) == awardSource
type ClaimCover = { owner: int, coverings: int, ownerRetiring: bool, sameCounts: bool, jointUnit: bool, jointAssessed: bool,
  jointSources: List[AcceptanceSource], awardSource: int, botUnit: bool, botSquash: bool, ownerRewarded: bool }
pure def claimRetained(c: ClaimCover): bool =
  c.coverings == 1 and not(c.ownerRetiring) and c.sameCounts and
  (not(c.jointUnit) or (c.jointAssessed and jointCompletes(c.jointSources, c.awardSource))) and
  (c.botUnit or c.botSquash or c.ownerRewarded)
type CarriedMergeEdge = { origin: int, originAt: int, originRetiring: bool, namedAcceptedMerge: bool, twoParents: bool,
  originHeadSecond: bool, memberIsMerge: bool, rangeFromFirstParent: bool, ordinaryRewarded: bool, repeated: bool }
pure def mergeEdgeCovers(edge: CarriedMergeEdge, retiredAt: int): bool =
  not(edge.repeated) and edge.origin > 0 and edge.originAt < retiredAt and not(edge.originRetiring) and edge.namedAcceptedMerge and
  edge.twoParents and edge.originHeadSecond and edge.memberIsMerge and edge.rangeFromFirstParent and edge.ordinaryRewarded
type AcceptanceOrder = { sameMerge: bool, ancestryKnown: bool, carriesRetiringMerge: bool }
pure def orderAllows(o: AcceptanceOrder): bool = o.sameMerge or (o.ancestryKnown and not(o.carriesRetiringMerge))
type IdenticalKind = NoIdenticalChange | SharedMerge | CarriedAcceptance | EmptySquash | EmptyMerge | SurvivingCarrier | DistinctSquash
type IdenticalChange = { kind: IdenticalKind, earlierSources: int, ownerAt: int, ownerRetiring: bool, diffVerified: bool,
  ownRecordPool: bool, ownerPositive: bool, ownerPositiveAtBaseline: bool, sameHead: bool, singleOwnCommit: bool,
  carriedMatches: bool, ownerPoolKept: bool, originalAuthorPair: bool, carrierTipPinned: bool, sameRecipientShares: bool }
pure def identicalChangeApplies(i: IdenticalChange, retiredAt: int): bool =
  i.kind != NoIdenticalChange and i.earlierSources == 1 and i.ownerAt >= 0 and i.ownerAt < retiredAt and not(i.ownerRetiring) and
  i.diffVerified and i.ownRecordPool and i.ownerPositive and
  (if (i.kind == SharedMerge) i.sameHead and i.ownerPositiveAtBaseline
   else if (i.kind == CarriedAcceptance) i.carriedMatches and i.ownerPoolKept and i.ownerPositiveAtBaseline
   else if (i.kind == EmptySquash) i.singleOwnCommit and i.ownerPositiveAtBaseline
   else if (i.kind == EmptyMerge) i.ownerPositiveAtBaseline and i.ownerPoolKept and i.sameRecipientShares
   else if (i.kind == SurvivingCarrier) i.singleOwnCommit and i.originalAuthorPair and i.carrierTipPinned
   else i.singleOwnCommit)
type NetOutcome = { present: bool, sources: int, earlierBefore: bool, inSubmittedRange: bool, completeRange: bool,
  allPaths: bool, composes: bool, trustedVerification: bool, earlierAwardsRetained: bool, ownRecordPool: bool }
pure def netOutcomeApplies(n: NetOutcome): bool =
  n.present and n.sources > 0 and n.earlierBefore and n.inSubmittedRange and n.completeRange and n.allPaths and n.composes and
  n.trustedVerification and n.earlierAwardsRetained and n.ownRecordPool
pure val noNetOutcome: NetOutcome = { present: false, sources: 0, earlierBefore: false, inSubmittedRange: false,
  completeRange: false, allPaths: false, composes: false, trustedVerification: false, earlierAwardsRetained: false,
  ownRecordPool: false }
type Retirement = { source: int, occurredAt: int, sourceComplete: bool, poolUnchanged: bool, octoberPool: bool,
  dossierBound: bool, claimedPaths: int, promotion: AcceptedPromotion, unchanged: List[UnchangedPromotion],
  squashes: List[AcceptedSquash], covers: List[NativeCover], earlier: List[EarlierBasis], claims: List[ClaimCover],
  mergeEdges: List[CarriedMergeEdge], order: List[AcceptanceOrder], identical: IdenticalChange, net: NetOutcome }
pure def coveringSource(retirement: Retirement, owner: int): bool =
  owner != retirement.source and (retirement.earlier.some(e => e.source == owner) or retirement.squashes.some(s => s.source == owner))
pure def claimCoverageApplies(retirement: Retirement): bool =
  retirement.unchanged.length() <= 1 and retirement.unchanged.every(u => unchangedPromotion(u)) and
  ((retirement.squashes.length() > 0 or retirement.covers.length() > 0 or retirement.mergeEdges.length() > 0) implies
    promotionKeepsContent(retirement.promotion)) and
  (retirement.mergeEdges.length() > 0 implies retirement.covers.length() > 0) and
  retirement.squashes.every(s => squashCovers(s, retirement.source, retirement.occurredAt)) and
  retirement.covers.every(c => nativeCovers(c, retirement.occurredAt)) and
  retirement.mergeEdges.every(e => mergeEdgeCovers(e, retirement.occurredAt)) and
  retirement.order.length() == retirement.earlier.length() + retirement.squashes.length() and
  retirement.order.every(o => orderAllows(o)) and
  (retirement.claims.length() > 0 or retirement.covers.length() > 0) and retirement.claims.length() == retirement.claimedPaths and
  retirement.claims.every(c => claimRetained(c) and coveringSource(retirement, c.owner)) and
  retirement.squashes.every(s => retirement.claims.some(c => c.owner == s.source))
pure def identicalRetirementApplies(retirement: Retirement): bool =
  identicalChangeApplies(retirement.identical, retirement.occurredAt) and retirement.earlier.length() == 1 and
  retirement.unchanged.length() == 0 and retirement.squashes.length() == 0 and retirement.covers.length() == 0 and
  retirement.mergeEdges.length() == 0 and retirement.claims.length() == 0 and retirement.claimedPaths == 0
pure def netRetirementApplies(retirement: Retirement): bool =
  netOutcomeApplies(retirement.net) and retirement.identical.kind == NoIdenticalChange and retirement.earlier.length() == 0 and
  retirement.unchanged.length() == 0 and retirement.squashes.length() == 0 and retirement.covers.length() == 0 and
  retirement.mergeEdges.length() == 0 and retirement.claims.length() == 0 and retirement.claimedPaths == 0 and
  retirement.order.length() == 0
pure def retirementApplies(retirement: Retirement): bool =
  retirement.source > 0 and retirement.sourceComplete and retirement.poolUnchanged and retirement.octoberPool and retirement.dossierBound and
  retirement.earlier.every(e => earlierAccepted(e, retirement.source, retirement.occurredAt)) and
  (if (retirement.net.present) netRetirementApplies(retirement)
   else if (retirement.identical.kind == NoIdenticalChange) claimCoverageApplies(retirement)
   else identicalRetirementApplies(retirement))
pure def lawNetOutcomeIsExclusive(retirement: Retirement): bool =
  (retirement.net.present and (retirement.identical.kind != NoIdenticalChange or retirement.earlier.length() > 0 or
    retirement.claims.length() > 0 or retirement.squashes.length() > 0)) implies not(retirementApplies(retirement))
pure def lawNetOutcomeNeedsEveryPath(retirement: Retirement): bool =
  (retirement.net.present and not(retirement.net.allPaths and retirement.net.composes)) implies not(retirementApplies(retirement))
pure def lawNetOutcomeNeedsTheSubmittedRange(retirement: Retirement): bool =
  (retirement.net.present and not(retirement.net.inSubmittedRange and retirement.net.completeRange)) implies
    not(retirementApplies(retirement))
pure def lawNetOutcomeNeedsRetainedEarlierAwards(retirement: Retirement): bool =
  (retirement.net.present and not(retirement.net.earlierAwardsRetained)) implies not(retirementApplies(retirement))
pure def lawNetOutcomeNeedsTrustedVerification(retirement: Retirement): bool =
  (retirement.net.present and not(retirement.net.trustedVerification)) implies not(retirementApplies(retirement))
pure def lawNetOutcomeNeedsEarlierAcceptance(retirement: Retirement): bool =
  (retirement.net.present and not(retirement.net.earlierBefore)) implies not(retirementApplies(retirement))
pure def lawPromotionMustKeepContent(a: AcceptedPromotion): bool = a.headTree != a.mergeTree implies not(promotionKeepsContent(a))
pure def lawChangedPromotionIsNotUnchanged(u: UnchangedPromotion): bool =
  (u.changedLines > 0 or u.headTree != u.baseTree) implies not(unchangedPromotion(u))
pure def lawLaterSquashNeverCovers(s: AcceptedSquash, retired: int, retiredAt: int): bool =
  s.occurredAt >= retiredAt implies not(squashCovers(s, retired, retiredAt))
pure def lawRetiringOwnerMustBeEarlierAndValidated(cover: NativeCover, retiredAt: int): bool =
  (cover.ownerRetiring and not(cover.ownerValidated)) implies not(nativeCovers(cover, retiredAt))
pure def lawUnrewardedHumanEarlierRefused(e: EarlierBasis): bool =
  (e.coversCommits and not(e.rewarded or e.validatedEarlierRetirement or e.reviewedBotFollowups or
    e.reviewedHistoricalAward or e.allBot)) implies not(earlierJustified(e))
pure def lawCompletionByTimeThenNodeId(first: AcceptanceSource, second: AcceptanceSource): bool =
  (first.source != second.source and first.acceptedAt == second.acceptedAt and first.nodeRank < second.nodeRank and
    first.acceptedAt >= 0 and first.nodeRank >= 0) implies
    completionSource(List(first, second)) == second.source and completionSource(List(second, first)) == second.source
pure def lawRepeatedCoverageRefused(claim: ClaimCover): bool = claim.coverings != 1 implies not(claimRetained(claim))
pure val promotion: AcceptedPromotion = { headTree: 5, mergeTree: 5, mergeParents: List(3, 4), sourceHead: 4 }
pure val aValues = Set(promotion, { ...promotion, mergeTree: 6 }, { ...promotion, mergeParents: List(4, 4) })
pure val unchanged: UnchangedPromotion = { headTree: 5, baseTree: 5, acceptedTree: 7, firstParentTree: 7,
  mergeParents: List(3, 4), sourceHead: 4, changedFiles: 0, changedLines: 0, proofComplete: true }
pure val uValues = Set(unchanged, { ...unchanged, changedLines: 2 }, { ...unchanged, baseTree: 6 })
pure val squash: AcceptedSquash = { source: 2, occurredAt: 2432110, firstAccepted: 2, parents: 1, paths: 1,
  distinctPaths: true, countsMatch: true, authorKnown: true }
pure val sValues = Set(squash, { ...squash, occurredAt: 2432130 }, { ...squash, parents: 2 }, { ...squash, source: 1 })
pure val retiredValues = Set(1)
pure val retiredAtValues = Set(2432120)
pure val nativeCover: NativeCover = { inSource: true, owner: 2, ownerAt: 2432110, ownerRetiring: false, ownerValidated: false,
  commitFirstAccepted: 2, retainedFirstAccepted: 2, sameAuthor: true, sameParents: true }
pure val coverValues = Set(nativeCover, { ...nativeCover, ownerRetiring: true }, { ...nativeCover, ownerRetiring: true, ownerValidated: true },
  { ...nativeCover, sameAuthor: false })
pure val earlier: EarlierBasis = { source: 2, acceptedAt: 2432110, complete: true, coversCommits: true, rewarded: false,
  validatedEarlierRetirement: false, reviewedBotFollowups: false, reviewedHistoricalAward: false, allBot: false }
pure val eValues = Set(earlier, { ...earlier, rewarded: true }, { ...earlier, allBot: true }, { ...earlier, coversCommits: false })
pure val firstValues = Set({ source: 1, acceptedAt: 2432110, nodeRank: 1 }, { source: 2, acceptedAt: 2432110, nodeRank: 2 })
pure val secondValues = Set({ source: 2, acceptedAt: 2432110, nodeRank: 2 }, { source: 3, acceptedAt: 2432111, nodeRank: 0 })
pure val claimCover: ClaimCover = { owner: 2, coverings: 1, ownerRetiring: false, sameCounts: true, jointUnit: false,
  jointAssessed: false, jointSources: List(), awardSource: 0, botUnit: false, botSquash: false, ownerRewarded: true }
pure val claimValues = Set(claimCover, { ...claimCover, coverings: 2 }, { ...claimCover, ownerRewarded: false, botUnit: true },
  { ...claimCover, jointUnit: true, jointAssessed: true, jointSources: List({ source: 2, acceptedAt: 2432110, nodeRank: 1 },
    { source: 3, acceptedAt: 2432110, nodeRank: 2 }), awardSource: 2 })
pure val noIdentical: IdenticalChange = { kind: NoIdenticalChange, earlierSources: 0, ownerAt: -1, ownerRetiring: false,
  diffVerified: false, ownRecordPool: false, ownerPositive: false, ownerPositiveAtBaseline: false, sameHead: false,
  singleOwnCommit: false, carriedMatches: false, ownerPoolKept: false, originalAuthorPair: false, carrierTipPinned: false, sameRecipientShares: false }
pure val distinctOrder: AcceptanceOrder = { sameMerge: false, ancestryKnown: true, carriesRetiringMerge: false }
pure val readyRetirement: Retirement = { source: 1, occurredAt: 2432120, sourceComplete: true, poolUnchanged: true,
  octoberPool: true, dossierBound: true, claimedPaths: 1, promotion: promotion, unchanged: List(), squashes: List(squash),
  covers: List(), earlier: List({ ...earlier, rewarded: true }), claims: List(claimCover), mergeEdges: List(),
  order: List(distinctOrder, distinctOrder), identical: noIdentical, net: noNetOutcome }
pure val sharedChange: IdenticalChange = { ...noIdentical, kind: SharedMerge, earlierSources: 1, ownerAt: 2432110,
  diffVerified: true, ownRecordPool: true, ownerPositive: true, ownerPositiveAtBaseline: true, sameHead: true }
pure val identicalRetirement: Retirement = { ...readyRetirement, claimedPaths: 0, squashes: List(), claims: List(), order: List(),
  identical: sharedChange }
pure val netChange: NetOutcome = { present: true, sources: 2, earlierBefore: true, inSubmittedRange: true, completeRange: true,
  allPaths: true, composes: true, trustedVerification: true, earlierAwardsRetained: true, ownRecordPool: true }
pure val netRetirement: Retirement = { ...readyRetirement, claimedPaths: 0, squashes: List(), claims: List(), order: List(),
  earlier: List(), net: netChange }
pure val carriedEdge: CarriedMergeEdge = { origin: 2, originAt: 2432110, originRetiring: false, namedAcceptedMerge: true,
  twoParents: true, originHeadSecond: true, memberIsMerge: true, rangeFromFirstParent: true, ordinaryRewarded: true, repeated: false }
pure def lawEarlierCarrierOfTheMergeRefused(retirement: Retirement): bool =
  (retirement.identical.kind == NoIdenticalChange and retirement.order.some(o => not(o.sameMerge) and o.carriesRetiringMerge)) implies
    not(retirementApplies(retirement))
pure def lawUnknownAncestryRefused(retirement: Retirement): bool =
  (retirement.identical.kind == NoIdenticalChange and retirement.order.some(o => not(o.sameMerge) and not(o.ancestryKnown))) implies
    not(retirementApplies(retirement))
pure def lawIdenticalChangeNeedsOneEarlierRewardedSource(change: IdenticalChange, retiredAt: int): bool =
  (change.earlierSources != 1 or not(change.ownerPositive) or change.ownerAt >= retiredAt) implies
    not(identicalChangeApplies(change, retiredAt))
pure def lawSurvivingCarrierNeedsPinnedTip(change: IdenticalChange, retiredAt: int): bool =
  (change.kind == SurvivingCarrier and not(change.carrierTipPinned)) implies not(identicalChangeApplies(change, retiredAt))
pure def lawCarriedMergeEdgeNeedsTheEarlierHeadSecond(edge: CarriedMergeEdge, retiredAt: int): bool =
  not(edge.originHeadSecond) implies not(mergeEdgeCovers(edge, retiredAt))
pure def lawEmptyMergePreservesEarlierRecipientShares(change: IdenticalChange, retiredAt: int): bool =
  (change.kind == EmptyMerge and not(change.ownerPoolKept and change.sameRecipientShares and change.ownerPositiveAtBaseline)) implies
    not(identicalChangeApplies(change, retiredAt))
pure val changeValues = Set(sharedChange, { ...sharedChange, sameHead: false },
  { ...sharedChange, kind: CarriedAcceptance, carriedMatches: true, ownerPoolKept: true },
  { ...sharedChange, kind: CarriedAcceptance, carriedMatches: true, ownerPoolKept: false },
  { ...sharedChange, kind: EmptySquash, singleOwnCommit: true },
  { ...sharedChange, kind: EmptyMerge, ownerPoolKept: true, sameRecipientShares: true },
  { ...sharedChange, kind: EmptyMerge, ownerPoolKept: true, sameRecipientShares: false },
  { ...sharedChange, kind: EmptyMerge, ownerPoolKept: false, sameRecipientShares: true },
  { ...sharedChange, kind: SurvivingCarrier, singleOwnCommit: true, originalAuthorPair: true, carrierTipPinned: true },
  { ...sharedChange, kind: SurvivingCarrier, singleOwnCommit: true, originalAuthorPair: true },
  { ...sharedChange, kind: DistinctSquash, singleOwnCommit: true, ownerPositiveAtBaseline: false },
  { ...sharedChange, earlierSources: 2 }, { ...sharedChange, ownerAt: 2432130 })
pure val edgeValues = Set(carriedEdge, { ...carriedEdge, originHeadSecond: false }, { ...carriedEdge, originAt: 2432130 },
  { ...carriedEdge, rangeFromFirstParent: false })
pure def lawUncoveredClaimRefused(retirement: Retirement): bool =
  retirement.claims.length() != retirement.claimedPaths implies not(retirementApplies(retirement))
pure def lawEmptyRetirementRefused(retirement: Retirement): bool =
  (retirement.claims.length() == 0 and retirement.covers.length() == 0 and retirement.identical.kind == NoIdenticalChange and
    not(retirement.net.present)) implies not(retirementApplies(retirement))
pure val nativeRetirement: Retirement = { ...readyRetirement, claimedPaths: 0, squashes: List(), covers: List(nativeCover),
  claims: List(), mergeEdges: List(carriedEdge), order: List(distinctOrder) }
pure def lawSquashNeedsKeptPromotion(retirement: Retirement): bool =
  (retirement.squashes.length() > 0 and not(promotionKeepsContent(retirement.promotion))) implies
    not(retirementApplies(retirement))
pure val retirementValues = Set(readyRetirement, { ...readyRetirement, claimedPaths: 2 },
  { ...readyRetirement, promotion: { ...promotion, mergeTree: 6 } },
  { ...readyRetirement, claims: List({ ...claimCover, owner: 1 }) },
  { ...readyRetirement, earlier: List({ ...earlier, acceptedAt: 2432130, rewarded: true }) },
  { ...readyRetirement, order: List(distinctOrder, { ...distinctOrder, carriesRetiringMerge: true }) },
  { ...readyRetirement, order: List(distinctOrder, { ...distinctOrder, ancestryKnown: false }) },
  { ...readyRetirement, order: List(distinctOrder, { ...distinctOrder, sameMerge: true, ancestryKnown: false }) },
  nativeRetirement, { ...nativeRetirement, covers: List(), mergeEdges: List() },
  identicalRetirement, { ...identicalRetirement, identical: { ...sharedChange, sameHead: false } },
  { ...identicalRetirement, squashes: List(squash) },
  netRetirement, { ...netRetirement, net: { ...netChange, allPaths: false } },
  { ...netRetirement, net: { ...netChange, inSubmittedRange: false } },
  { ...netRetirement, net: { ...netChange, earlierAwardsRetained: false } },
  { ...netRetirement, net: { ...netChange, trustedVerification: false } },
  { ...netRetirement, net: { ...netChange, earlierBefore: false } },
  { ...netRetirement, identical: sharedChange }, { ...netRetirement, earlier: List({ ...earlier, rewarded: true }) })
```

### A historical replay scores only the pinned project's one repository

The historical scorer (`createHistoricalLeaderboardSnapshot`) needs the
pinned scope: an active project with exactly one repository whose project
id, repository node id and manifest digest equal the pinned ones, or it
refuses ("Historical leaderboard requires the pinned active project and
repository"). Every input source, retained review or evaluation, retained
attribution and penalty must lie in that repository and project, and the
census must list that one repository ("Historical leaderboard input is
outside the pinned repository"); an assessed joint record naming any source
outside it refuses ("Historical joint assessment is outside the pinned
repository"). It scores in historical mode, so the rolling-only owners and
holds of [authorship](./authorship.md) are off. A retained replay is
validated against that repository only, and it is never published to the
site.

```quint
type HistoricalScope = { projectActive: bool, projectMatches: bool, repositories: int, nodeIdMatches: bool,
  manifestMatches: bool }
type HistoricalInput = { censusRepository: bool, listedRepositories: int, sourcesInside: bool, eventsInside: bool,
  penaltiesInside: bool, jointInside: bool }
type ScoringMode = RollingScoring | HistoricalScoring
pure def historicalScopePinned(scope: HistoricalScope): bool =
  scope.projectActive and scope.projectMatches and scope.repositories == 1 and scope.nodeIdMatches and scope.manifestMatches
pure def historicalInputAdmitted(scope: HistoricalScope, input: HistoricalInput): bool =
  historicalScopePinned(scope) and input.censusRepository and input.listedRepositories == 1 and input.sourcesInside and
  input.eventsInside and input.penaltiesInside and input.jointInside
pure def sitePublishable(mode: ScoringMode): bool = mode == RollingScoring
pure def lawSecondRepositoryRefused(scope: HistoricalScope, input: HistoricalInput): bool =
  (scope.repositories != 1 or input.listedRepositories != 1) implies not(historicalInputAdmitted(scope, input))
pure def lawOutsideJointRecordRefused(scope: HistoricalScope, input: HistoricalInput): bool =
  not(input.jointInside) implies not(historicalInputAdmitted(scope, input))
pure def lawHistoricalReplayNeverPublished(mode: ScoringMode): bool = mode == HistoricalScoring implies not(sitePublishable(mode))
pure val pinnedScope: HistoricalScope = { projectActive: true, projectMatches: true, repositories: 1, nodeIdMatches: true,
  manifestMatches: true }
pure val pinnedInput: HistoricalInput = { censusRepository: true, listedRepositories: 1, sourcesInside: true, eventsInside: true,
  penaltiesInside: true, jointInside: true }
pure val scopeValues = Set(pinnedScope, { ...pinnedScope, repositories: 2 }, { ...pinnedScope, manifestMatches: false },
  { ...pinnedScope, projectActive: false })
pure val inputValues = Set(pinnedInput, { ...pinnedInput, listedRepositories: 2 }, { ...pinnedInput, jointInside: false },
  { ...pinnedInput, penaltiesInside: false })
```
