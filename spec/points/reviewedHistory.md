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
refuses the whole packet: a reviewed source is validated, and the journal
appends a recipient correction or a duplicate retirement, only with a packet
that applies.

```quint
type PacketRun = { baselineMatches: bool, reviewedAt: int, baselineAt: int, now: int, valueKeysExact: bool,
  deltaInScope: bool, occurrencesKept: bool, candidateMatches: bool }
pure def packetApplies(r: PacketRun): bool =
  r.baselineMatches and r.now >= r.reviewedAt and r.now >= r.baselineAt and r.valueKeysExact and r.deltaInScope and
  r.occurrencesKept and r.candidateMatches
pure def canValidate(b: Binding, packetRun: PacketRun): bool = not(b.validated) and packetApplies(packetRun)
pure def validate(b: Binding, packetRun: PacketRun): Binding = { ...b, validated: true }
pure def lawChangedBaselineRefused(r: PacketRun): bool = not(r.baselineMatches) implies not(packetApplies(r))
pure def lawChangedCandidateRefused(r: PacketRun): bool = not(r.candidateMatches) implies not(packetApplies(r))
pure val readyRun: PacketRun = { baselineMatches: true, reviewedAt: 2432150, baselineAt: 2432140, now: 2432160,
  valueKeysExact: true, deltaInScope: true, occurrencesKept: true, candidateMatches: true }
pure val rValues = Set(readyRun, { ...readyRun, baselineMatches: false }, { ...readyRun, now: 2432100 },
  { ...readyRun, candidateMatches: false })
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
`owner_october_<dossier digest>` with the October original-contributor
reason.

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
dossier, and every accepted squash covers a claim. The runner supplies each
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
  bots), or by a positive award of the earlier source.

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
type Retirement = { source: int, occurredAt: int, sourceComplete: bool, poolUnchanged: bool, octoberPool: bool,
  dossierBound: bool, claimedPaths: int, promotion: AcceptedPromotion, unchanged: List[UnchangedPromotion],
  squashes: List[AcceptedSquash], covers: List[NativeCover], earlier: List[EarlierBasis], claims: List[ClaimCover] }
pure def coveringSource(retirement: Retirement, owner: int): bool =
  owner != retirement.source and (retirement.earlier.some(e => e.source == owner) or retirement.squashes.some(s => s.source == owner))
pure def retirementApplies(retirement: Retirement): bool =
  retirement.source > 0 and retirement.sourceComplete and retirement.poolUnchanged and retirement.octoberPool and retirement.dossierBound and
  retirement.unchanged.length() <= 1 and retirement.unchanged.every(u => unchangedPromotion(u)) and
  ((retirement.squashes.length() > 0 or retirement.covers.length() > 0) implies promotionKeepsContent(retirement.promotion)) and
  retirement.squashes.every(s => squashCovers(s, retirement.source, retirement.occurredAt)) and
  retirement.covers.every(c => nativeCovers(c, retirement.occurredAt)) and
  retirement.earlier.every(e => earlierAccepted(e, retirement.source, retirement.occurredAt)) and
  retirement.claims.length() > 0 and retirement.claims.length() == retirement.claimedPaths and
  retirement.claims.every(c => claimRetained(c) and coveringSource(retirement, c.owner)) and
  retirement.squashes.every(s => retirement.claims.some(c => c.owner == s.source))
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
pure val readyRetirement: Retirement = { source: 1, occurredAt: 2432120, sourceComplete: true, poolUnchanged: true,
  octoberPool: true, dossierBound: true, claimedPaths: 1, promotion: promotion, unchanged: List(), squashes: List(squash),
  covers: List(), earlier: List({ ...earlier, rewarded: true }), claims: List(claimCover) }
pure def lawUncoveredClaimRefused(retirement: Retirement): bool =
  retirement.claims.length() != retirement.claimedPaths implies not(retirementApplies(retirement))
pure def lawSquashNeedsKeptPromotion(retirement: Retirement): bool =
  (retirement.squashes.length() > 0 and not(promotionKeepsContent(retirement.promotion))) implies
    not(retirementApplies(retirement))
pure val retirementValues = Set(readyRetirement, { ...readyRetirement, claimedPaths: 2 },
  { ...readyRetirement, promotion: { ...promotion, mergeTree: 6 } },
  { ...readyRetirement, claims: List({ ...claimCover, owner: 1 }) },
  { ...readyRetirement, earlier: List({ ...earlier, acceptedAt: 2432130, rewarded: true }) })
```
