# Import historical implementation Points corrections atomically

PRD sections 2, 7 and 12 require historical reallocation to preserve the
accepted source's full prior pool, original identity and occurrence time. This
model includes `historical_implementation_allocation` at legacy main commit
`8d14a9692b998ee3f4479725b6323125f11f11be`, the reviewed-packet workflows
`.github/workflows/{points-implementation-corrections,reviewed-historical-points,private-payout-packet}.yml`
with `scripts/{prepare-implementation-corrections,run-reviewed-historical-points,private-payout-packet}.ts`,
and the October replacement rule of `scripts/collect-implementation-corrections.ts`
and `src/lib/points-implementation-corrections.ts`.

The collector binds a complete connected source and claim proof, allocation
manifest digest, and expected current predecessor. A recorded source that the
historical search omitted is verified through a census supplement before
preparation. Project-private financial protection is rechecked in the same
database statement as the append; participation bans are read again
immediately before the import, which is refused when they differ from those
read for the plan. The view contains no private award amount. Database
atomicity, evidence authenticity and the authenticated Git parent edges are
adapter conformance. The machine is instantiated per accepted source.

Each applied history row is to be written to the canonical [Points
journal](./journal.md) as one `reallocateUnit` revision of the source's work
unit (basis `Reallocation`), in the same database transaction. Both this
machine and the journal require the new shares to sum to the unchanged pool.
That the two writes happen together is composition obligation C11; nothing
here composes them. `applied` tracks the digests of those canonical corrections.
Publication consumes the resulting journal snapshot through the [publication
model](./publication.md). No correction is ever revoked: a later change is an
ordinary appended journal revision, and replaying an applied manifest
appends nothing. The `by` sender is the trusted main workflow run or the
repository owner.

## Story: Reassign the existing pool while preserving funded history

### A historical source retains its original carrier and every successor

An unproved zero-line promotion has no connected proof, so its allocation is
held as incomplete evidence: a pull-request candidate without a proved
original contributor whose accepted one-parent commits first accepted by
this source are all empty markers (no additions, no deletions, no files)
while a commit it carries from elsewhere changes lines
(`isUnprovedZeroLinePromotion` of `src/lib/commit-credit.ts`, which
development's `points-implementation-corrections.ts` applies with ownership
by first accepted source; `historical_implementation_allocation`
`bindEmptyPromotion`). A commit with an unknown parent count, or an owned
one-parent commit that changes anything, proves the promotion is not one;
merge commits are left out. The collector computes `emptyPromotion` with
`unprovedZeroLinePromotion`.

```quint
import allocation as A from "./allocation"
import periods as P from "./periods"
type Actor = TrustedWorkflow | Owner | Contributor
type CorrectionPhase = Open | Prepared | EvidenceHeld | AttributionHeld | OutOfScope | Protected | Banned | Stale | Applied |
  Replayed | Unchanged
type Supplement = SearchOnly | SupplementPending | SupplementVerified | SupplementUnavailable | SupplementFailed
type ManifestKind = OrdinaryReallocation | OctoberReplacement
type WorkLine = { author: int, lines: int, origin: int, followup: bool, parentEdges: bool, ambiguous: bool }
type JournalEntry = { source: int, occurredAt: int, shares: List[A::PointShare] }
type Manifest = { digest: str, source: int, predecessor: int, connectedProof: bool, recipients: List[A::Recipient],
  kind: ManifestKind, work: List[WorkLine], emptyPromotion: bool, earlierAcceptance: bool }
type Chunk = { index: int, digest: str }
type Packet = { digest: str, expected: List[str], staged: List[Chunk], assembled: bool, reviewedDigest: str }
type Correction = { phase: CorrectionPhase, project: str, source: int, occurredAt: int, pool: int,
  history: List[JournalEntry], staged: Manifest, applied: List[str], frozen: bool,
  packet: Packet, appliedWork: List[WorkLine], supplement: Supplement, supplementAffects: bool, confirmed: bool }
pure val octoberAt = 2432110
pure val original: JournalEntry = { source: 1, occurredAt: octoberAt,
  shares: List({ actor: 3, points: 30 }) }
pure val emptyManifest: Manifest = { digest: "", source: 0, predecessor: 0, connectedProof: false, recipients: List(),
  kind: OrdinaryReallocation, work: List(), emptyPromotion: false, earlierAcceptance: false }
pure val initial: Correction = { phase: Open, project: "eliza", source: 1, occurredAt: octoberAt, pool: 30,
  history: List(original), staged: emptyManifest, applied: List(), frozen: false,
  packet: { digest: "packet", expected: List("chunk-a", "chunk-b"), staged: List(), assembled: false, reviewedDigest: "" },
  appliedWork: List(), supplement: SearchOnly, supplementAffects: false, confirmed: false }
pure def predecessorMatches(c: Correction, manifest: Manifest): bool =
  manifest.source == c.source and manifest.digest != "" and manifest.predecessor == c.history.length()
pure def completeCorrection(c: Correction, manifest: Manifest): bool =
  manifest.connectedProof and not(manifest.emptyPromotion) and not(c.supplementAffects and c.supplement == SupplementUnavailable) and
  A::canWriteAllocation(c.pool, manifest.recipients, true, false)
    and (manifest.kind == OctoberReplacement implies
      manifest.work.length() > 0 and manifest.recipients == replacementRecipients(manifest.work))
type CensusCommit = { parentsKnown: bool, parents: int, owned: bool, linesKnown: bool, additions: int, deletions: int, files: int }
type ZeroLineScan = { unknownParents: bool, changedOwned: bool, emptyOwned: bool, carriedChange: bool }
pure def scanCommit(t: ZeroLineScan, row: CensusCommit): ZeroLineScan =
  if (not(row.parentsKnown)) { ...t, unknownParents: true }
  else if (row.parents > 1) t
  else if (row.owned)
    (if (row.linesKnown and row.additions == 0 and row.deletions == 0 and row.files == 0) { ...t, emptyOwned: true }
     else { ...t, changedOwned: true })
  else if (row.linesKnown and (row.additions > 0 or row.deletions > 0)) { ...t, carriedChange: true }
  else t
pure def unprovedZeroLinePromotion(commits: List[CensusCommit]): bool =
  val t = commits.foldl({ unknownParents: false, changedOwned: false, emptyOwned: false, carriedChange: false },
    (acc, row) => scanCommit(acc, row))
  not(t.unknownParents) and not(t.changedOwned) and t.emptyOwned and t.carriedChange
pure val emptyMarkerRow: CensusCommit = { parentsKnown: true, parents: 1, owned: true, linesKnown: true, additions: 0,
  deletions: 0, files: 0 }
pure val carriedChangeRow: CensusCommit = { ...emptyMarkerRow, owned: false, additions: 4, deletions: 1, files: 1 }
pure def lawMergeRowsLeaveTheMarkerUnproved(censusRow: CensusCommit): bool =
  (censusRow.parentsKnown and censusRow.parents > 1) implies
    unprovedZeroLinePromotion(List(emptyMarkerRow, carriedChangeRow, censusRow))
pure def lawOwnedChangeProvesWork(censusRow: CensusCommit): bool =
  (censusRow.parentsKnown and censusRow.parents <= 1 and censusRow.owned and censusRow.linesKnown and censusRow.additions > 0) implies
    not(unprovedZeroLinePromotion(List(emptyMarkerRow, carriedChangeRow, censusRow)))
pure def lawUnknownParentsProveNothing(censusRow: CensusCommit): bool =
  not(censusRow.parentsKnown) implies not(unprovedZeroLinePromotion(List(emptyMarkerRow, carriedChangeRow, censusRow)))
pure def lawEmptyPromotionNeverPrepared(c: Correction, manifest: Manifest): bool =
  manifest.emptyPromotion implies classify(c, manifest) != Prepared
pure val censusRowValues = Set(emptyMarkerRow, carriedChangeRow, { ...carriedChangeRow, parents: 2 },
  { ...emptyMarkerRow, additions: 3 }, { ...emptyMarkerRow, parentsKnown: false })
```

### October replacement PRs credit the verified original contributors by their accepted lines

Owner decision of 14 November 2026 (PRD section 7): for the October 2026
settlement of Eliza, Slop, ASI, Feed and The Network (`eliza`,
`slopdotcash`, `asi`, `feed`, `thenetwork`), the full implementation Points
of a verified replacement PR go to its verified original contributor, named
by permanent GitHub ID. A carrier's commit in the original PR is a follow-up
only when an adapter-verified chain of authenticated Git parent edges descends
from an original contributor's commit; only then is it redirected to that
contributor. Work with several complete, disjoint claim proofs divides the
unchanged pool by the accepted changed lines of each original contributor,
through the existing largest-remainder allocation. Independently initiated
work keeps its author's ordinary changed-line share. An ambiguous claim holds
the whole correction for review. Other months and projects keep the ordinary
rule: such a manifest is refused there.

```quint
pure val octoberProjects = Set("eliza", "slopdotcash", "asi", "feed", "thenetwork")
pure def octoberReplacementScope(project: str, occurredAt: int): bool =
  octoberProjects.contains(project) and P::periodOf(occurredAt) == P::october2026
pure def octoberScope(c: Correction): bool = octoberReplacementScope(c.project, c.occurredAt)
pure def redirected(w: WorkLine): bool = w.origin > 0 and not(w.ambiguous) and (not(w.followup) or w.parentEdges)
pure def recipientOf(w: WorkLine): int = if (redirected(w)) w.origin else w.author
pure def linesFor(work: List[WorkLine], actor: int): int = work.foldl(0, (acc, w) => if (recipientOf(w) == actor) acc + w.lines else acc)
pure def addRecipient(actors: List[int], w: WorkLine): List[int] = if (actors.includes(recipientOf(w))) actors else actors.append(recipientOf(w))
pure def replacementRecipients(work: List[WorkLine]): List[A::Recipient] =
  work.foldl(List(), (acc, w) => addRecipient(acc, w)).listMap(actor => { actor: actor, lines: linesFor(work, actor) })
pure def ambiguousClaim(manifest: Manifest): bool = manifest.kind == OctoberReplacement and manifest.work.some(w => w.ambiguous)
pure def lawCarrierNeverGainsVerifiedFollowup(w: WorkLine): bool =
  (w.followup and w.parentEdges and w.origin > 0 and w.origin != w.author and not(w.ambiguous)) implies recipientOf(w) == w.origin
pure def lawUnprovedFollowupKeepsOrdinaryRule(w: WorkLine): bool = (w.followup and not(w.parentEdges)) implies recipientOf(w) == w.author
pure def lawIndependentWorkKeepsAuthor(w: WorkLine): bool = w.origin == 0 implies recipientOf(w) == w.author
pure def lawOtherMonthsKeepOrdinaryRule(c: Correction, manifest: Manifest): bool =
  (manifest.kind == OctoberReplacement and not(octoberScope(c))) implies
    (prepare(c, manifest).phase != Prepared and prepare(c, manifest).history == c.history)
```

### Preparation is the plan: it captures the current predecessor and never appends an allocation

The source journal must contain the entire prior pool, including the former
carrier's share. A complete eligible proof is needed before the new shares can
reach the atomic import. A frozen source refuses. A source is frozen only
when monthly settlement freezes its project and occurrence month, through
[periods](./periods.md). A previously applied digest
is a replay and never appends again. A pending or failed census supplement
refuses preparation.

```quint
pure def classify(c: Correction, manifest: Manifest): CorrectionPhase =
  if (c.applied.includes(manifest.digest)) Replayed
  else if (not(predecessorMatches(c, manifest))) Stale
  else if (c.frozen) Protected
  else if (manifest.kind == OctoberReplacement and not(octoberScope(c))) OutOfScope
  else if (ambiguousClaim(manifest)) AttributionHeld
  else if (not(completeCorrection(c, manifest))) EvidenceHeld
  else Prepared
pure def canPrepare(c: Correction, manifest: Manifest): bool = c.phase != Prepared
  and manifest.source == c.source and manifest.digest != "" and c.packet.assembled
  and c.supplement != SupplementPending and c.supplement != SupplementFailed
pure def prepare(c: Correction, manifest: Manifest): Correction =
  if (classify(c, manifest) == Prepared) { ...c, phase: Prepared, staged: manifest } else { ...c, phase: classify(c, manifest) }
pure def canProtect(c: Correction, f: P::FreezeEvidence): bool =
  not(c.frozen) and P::freezes(f) and f.project == c.project and f.period == P::periodOf(c.occurredAt)
pure def protect(c: Correction, f: P::FreezeEvidence): Correction = { ...c, frozen: true }
```

### The atomic import rechecks current protection, bans and the captured predecessor

A protection, participation ban or predecessor change after preparation
prevents the append. The protection check runs in the same database
statement as the append; the participation bans are read again immediately
before the import, and `recipientBanned` is that re-read (development
refuses the import when the bans' digest differs from the plan's). A replayed
applied manifest is `Replayed` and appends nothing. A batch
whose receipt (`correctionBatchRecorded`) is already present is a replay and
appends nothing. Existing approved, funded, scheduled and paid terms never
change through this correction flow. A manifest that changes no share of an
ordinary pool is not committed: it is applied as unchanged (below).

```quint
pure def canCommit(c: Correction, recipientBanned: bool, by: Actor): bool = c.phase == Prepared and by == TrustedWorkflow
  and c.packet.assembled and c.packet.reviewedDigest == c.packet.digest and not(noShareChange(c, c.staged))
pure def commit(c: Correction, recipientBanned: bool, by: Actor): Correction =
  if (classify(c, c.staged) != Prepared) { ...c, phase: classify(c, c.staged), staged: emptyManifest }
  else if (recipientBanned) { ...c, phase: Banned, staged: emptyManifest }
  else { ...c, phase: Applied, staged: emptyManifest, applied: c.applied.append(c.staged.digest),
    appliedWork: c.staged.work,
    history: c.history.append({ source: c.source, occurredAt: c.occurredAt,
      shares: A::allocatePoints(c.pool, c.staged.recipients) }) }
pure def alwaysSourceHistory(c: Correction): bool = c.history.every(row => row.source == c.source
  and row.occurredAt == c.occurredAt and A::pointTotal(row.shares) == c.pool)
pure def alwaysOctoberOnlyInScope(c: Correction): bool = c.appliedWork.length() > 0 implies octoberScope(c)
pure def stepNoHistoryGrowthAfterProtection(before: Correction, after: Correction): bool =
  before.frozen implies after.history == before.history
pure def stepOnlyApplyAppends(before: Correction, via: str, after: Correction): bool =
  (via != "commit" and via != "applyUnchanged") implies after.history == before.history and after.applied == before.applied
pure def sometimesApplied(c: Correction): bool = c.phase == Applied and c.history.length() > 1
pure def sometimesProtected(c: Correction): bool = c.phase == Protected
pure def sometimesBanned(c: Correction): bool = c.phase == Banned
pure def sometimesStale(c: Correction): bool = c.phase == Stale
pure def sometimesEvidenceHeld(c: Correction): bool = c.phase == EvidenceHeld
pure def sometimesReplayed(c: Correction): bool = c.phase == Replayed and c.history.length() > 1
pure def sometimesFollowupRedirected(c: Correction): bool =
  c.phase == Applied and c.appliedWork.some(w => w.followup and redirected(w) and w.origin != w.author)
pure def sometimesTwoOriginSplit(c: Correction): bool =
  c.phase == Applied and c.history.some(row => row.shares.length() == 2) and c.appliedWork.every(w => redirected(w))
pure def sometimesAmbiguousHeld(c: Correction): bool = c.phase == AttributionHeld
```

### An already-correct pool records its earlier-acceptance proof once

An ordinary pull-request manifest whose complete proof changes no share of
the current pool appends nothing (`Unchanged`), except once: when the
source has a one-parent commit first accepted by another source, or by a
retained copy (`earlierAcceptance`), and no revision of the pool carries the
verified historical allocation decision yet, the import appends one
revision of the unchanged shares with that decision ("Verified
primary-commit changed lines reallocate this unchanged historical
implementation Points pool; its value and occurrence date are preserved.",
on the first positive share by key in development), so that a later
unassessed rolling refresh cannot guess the recipients again. A second
application appends nothing. The same rechecks as the atomic import apply
(`points-implementation-corrections.ts`, "an already-correct pool records
its complete earlier-acceptance proof once"). An October replacement keeps
the atomic import.

```quint
pure val noEntry: JournalEntry = { source: 0, occurredAt: 0, shares: List() }
pure def lastShares(c: Correction): List[A::PointShare] = c.history.nthOr(c.history.length() - 1, noEntry).shares
pure def noShareChange(c: Correction, manifest: Manifest): bool =
  manifest.kind == OrdinaryReallocation and A::allocatePoints(c.pool, manifest.recipients) == lastShares(c)
pure def confirmsAcceptance(c: Correction, manifest: Manifest): bool = manifest.earlierAcceptance and not(c.confirmed)
pure def canApplyUnchanged(c: Correction, recipientBanned: bool, by: Actor): bool = c.phase == Prepared and
  by == TrustedWorkflow and c.packet.assembled and c.packet.reviewedDigest == c.packet.digest and noShareChange(c, c.staged)
pure def applyUnchanged(c: Correction, recipientBanned: bool, by: Actor): Correction =
  if (classify(c, c.staged) != Prepared) { ...c, phase: classify(c, c.staged), staged: emptyManifest }
  else if (not(confirmsAcceptance(c, c.staged))) { ...c, phase: Unchanged, staged: emptyManifest }
  else if (recipientBanned) { ...c, phase: Banned, staged: emptyManifest }
  else { ...c, phase: Applied, staged: emptyManifest, applied: c.applied.append(c.staged.digest), confirmed: true,
    history: c.history.append({ source: c.source, occurredAt: c.occurredAt,
      shares: A::allocatePoints(c.pool, c.staged.recipients) }) }
pure def alwaysConfirmationApplied(c: Correction): bool = c.confirmed implies c.applied.length() > 0
pure def stepConfirmationKept(before: Correction, after: Correction): bool = before.confirmed implies after.confirmed
pure def sometimesConfirmed(c: Correction): bool = c.phase == Applied and c.confirmed
pure def sometimesUnchangedAppendsNothing(c: Correction): bool = c.phase == Unchanged
```

## Story: Apply a reviewed private packet only in full and only under its reviewed digest

### Chunks are verified by digest, assembled only when complete, and applied only under the owner-reviewed digest

The packet is staged privately in chunks, in manifest order; each chunk is
accepted only when the digest of its bytes equals the strict manifest's digest
for its position, and the packet is assembled only when every listed chunk is
present and matches.
Plan mode runs preparation and writes nothing. Apply runs only on `main`
under the production publication lock with the `reviewed_packet_sha256`
the repository owner reviewed, which must equal the assembled packet's
digest.

```quint
pure val noChunk: Chunk = { index: -1, digest: "" }
pure def canStageChunk(c: Correction, index: int, digest: str, by: Actor): bool = by == TrustedWorkflow
  and index == c.packet.staged.length() and index < c.packet.expected.length() and digest == c.packet.expected.nthOr(index, "")
  and not(c.packet.assembled)
pure def stageChunk(c: Correction, index: int, digest: str, by: Actor): Correction =
  { ...c, packet: { ...c.packet, staged: c.packet.staged.append({ index: index, digest: digest }) } }
pure def canAssemble(c: Correction, by: Actor): bool = by == TrustedWorkflow and not(c.packet.assembled)
  and c.packet.staged.length() == c.packet.expected.length()
pure def assemble(c: Correction, by: Actor): Correction = { ...c, packet: { ...c.packet, assembled: true } }
pure def canReviewPacket(c: Correction, digest: str, by: Actor): bool = by == Owner and digest != "" and c.packet.reviewedDigest == ""
pure def reviewPacket(c: Correction, digest: str, by: Actor): Correction = { ...c, packet: { ...c.packet, reviewedDigest: digest } }
pure def alwaysChunksMatchManifest(c: Correction): bool =
  c.packet.staged.every(x => x.index >= 0 and c.packet.staged.nthOr(x.index, noChunk) == x
    and x.digest == c.packet.expected.nthOr(x.index, "") and x.digest != "")
    and c.packet.staged.length() <= c.packet.expected.length()
    and (c.packet.assembled implies c.packet.staged.length() == c.packet.expected.length())
pure def alwaysAppliedUnderReviewedPacket(c: Correction): bool =
  c.applied.length() > 0 implies c.packet.assembled and c.packet.reviewedDigest == c.packet.digest
pure def sometimesPlannedUnreviewed(c: Correction): bool = c.phase == Prepared and c.packet.reviewedDigest == ""
pure def sometimesWrongReviewHolds(c: Correction): bool =
  c.phase == Prepared and c.packet.reviewedDigest != "" and c.packet.reviewedDigest != c.packet.digest
```

### A recorded source omitted from the historical search is verified through a census supplement

The collector requires a supplement for every recorded source the
historical search omitted, noting whether the earlier acceptance it may
prove affects this source's allocation. A verified supplement removes the
earlier acceptance's exact one-parent accepted commit from every later pool,
which the collector's manifest then carries. An unavailable accepted object
or merge identity holds only an allocation it affects, as incomplete
evidence; an unaffected allocation proceeds. A failed supplement refuses
preparation. The result is recorded once, before preparation
(`historical_implementation_allocation` `requireSupplement`,
`verifySupplement`, `prepare`).

```quint
pure def canRequireSupplement(c: Correction, affects: bool, by: Actor): bool =
  by == TrustedWorkflow and c.phase == Open and c.supplement == SearchOnly
pure def requireSupplement(c: Correction, affects: bool, by: Actor): Correction =
  { ...c, supplement: SupplementPending, supplementAffects: affects }
pure def canVerifySupplement(c: Correction, result: Supplement, by: Actor): bool =
  by == TrustedWorkflow and c.phase == Open and c.supplement == SupplementPending and
  (result == SupplementVerified or result == SupplementUnavailable or result == SupplementFailed)
pure def verifySupplement(c: Correction, result: Supplement, by: Actor): Correction = { ...c, supplement: result }
pure def alwaysUnsettledSupplementUnprepared(c: Correction): bool =
  (c.supplement == SupplementPending or c.supplement == SupplementFailed) implies (c.phase == Open and c.applied.length() == 0)
pure def alwaysSupplementShape(c: Correction): bool = c.supplement == SearchOnly implies not(c.supplementAffects)
pure def alwaysOpenUnapplied(c: Correction): bool = c.phase == Open implies c.applied.length() == 0
pure def sometimesSupplementHeld(c: Correction): bool =
  c.phase == EvidenceHeld and c.supplementAffects and c.supplement == SupplementUnavailable
pure def sometimesSupplementVerifiedApplied(c: Correction): bool = c.phase == Applied and c.supplement == SupplementVerified
pure val affectsValues = Set(true, false)
pure val resultValues = Set(SupplementVerified, SupplementUnavailable, SupplementFailed, SupplementPending)
```

### Directed witnesses check protection races, stale predecessors, October attribution and replay

```quint
pure val readyManifest: Manifest = { digest: "manifest", source: 1, predecessor: 1, connectedProof: true,
  recipients: List({ actor: 1, lines: 1 }, { actor: 2, lines: 2 }), kind: OrdinaryReallocation, work: List(),
  emptyPromotion: false, earlierAcceptance: false }
pure val carrier = 9
pure val followupWork: List[WorkLine] = List({ author: 1, lines: 2, origin: 1, followup: false, parentEdges: false, ambiguous: false },
  { author: carrier, lines: 1, origin: 1, followup: true, parentEdges: true, ambiguous: false },
  { author: 2, lines: 3, origin: 0, followup: false, parentEdges: false, ambiguous: false })
pure val twoOriginWork: List[WorkLine] = List({ author: carrier, lines: 2, origin: 1, followup: false, parentEdges: false, ambiguous: false },
  { author: carrier, lines: 1, origin: 2, followup: false, parentEdges: false, ambiguous: false })
pure val manifestValues = Set(readyManifest,
  { ...readyManifest, digest: "incomplete", connectedProof: false },
  { ...readyManifest, digest: "second", predecessor: 2 },
  { ...readyManifest, digest: "stale", predecessor: 0 },
  { ...readyManifest, digest: "followup", kind: OctoberReplacement, work: followupWork,
    recipients: List({ actor: 1, lines: 3 }, { actor: 2, lines: 3 }) },
  { ...readyManifest, digest: "two-origin", kind: OctoberReplacement, work: twoOriginWork,
    recipients: List({ actor: 1, lines: 2 }, { actor: 2, lines: 1 }) },
  { ...readyManifest, digest: "ambiguous", kind: OctoberReplacement,
    work: List({ author: carrier, lines: 2, origin: 1, followup: false, parentEdges: false, ambiguous: true }),
    recipients: List({ actor: 1, lines: 2 }) },
  { ...readyManifest, digest: "carrier-kept", kind: OctoberReplacement, work: followupWork,
    recipients: List({ actor: 1, lines: 2 }, { actor: carrier, lines: 1 }, { actor: 2, lines: 3 }) },
  { ...readyManifest, digest: "empty-promotion", emptyPromotion: true },
  { ...readyManifest, digest: "confirm", recipients: List({ actor: 3, lines: 1 }), earlierAcceptance: true },
  { ...readyManifest, digest: "unchanged", recipients: List({ actor: 3, lines: 1 }) })
pure val settledFreeze: P::FreezeEvidence = { project: "eliza", period: P::october2026, phase: P::Frozen, obligationExists: false }
pure val fValues = Set(settledFreeze, { ...settledFreeze, phase: P::Proposed }, { ...settledFreeze, period: P::november2026 })
pure val ownWork: WorkLine = { author: 1, lines: 2, origin: 1, followup: false, parentEdges: false, ambiguous: false }
pure val wValues = Set(ownWork, { ...ownWork, author: carrier, followup: true, parentEdges: true },
  { ...ownWork, author: carrier, followup: true }, { ...ownWork, author: 2, origin: 0 }, { ...ownWork, author: carrier, ambiguous: true })
pure def lawProtectionRace(manifest: Manifest): bool = manifest == readyManifest implies
  commit(protect(prepare(initial, manifest), settledFreeze), false, TrustedWorkflow).phase == Protected
    and commit(protect(prepare(initial, manifest), settledFreeze), false, TrustedWorkflow).history == initial.history
pure def lawStalePredecessor(manifest: Manifest): bool = manifest == readyManifest implies
  prepare(initial, { ...manifest, digest: "moved", predecessor: 2 }).phase == Stale
pure def lawReallocationPreservesPool(manifest: Manifest): bool =
  val corrected = commit(prepare(initial, manifest), false, TrustedWorkflow)
  manifest == readyManifest implies corrected.phase == Applied and corrected.pool == initial.pool
    and corrected.occurredAt == initial.occurredAt
    and A::pointTotal(A::allocatePoints(corrected.pool, manifest.recipients)) == initial.pool
pure def lawReplayAppendsNothing(manifest: Manifest): bool =
  val applied = commit(prepare(initial, manifest), false, TrustedWorkflow)
  manifest == readyManifest implies prepare(applied, manifest).history == applied.history
    and prepare(applied, manifest).phase == Replayed
pure val cValues = Set(initial, { ...initial, project: "p" }, { ...initial, occurredAt: 2432210 }, { ...initial, packet: { ...initial.packet, assembled: true } })
pure val indexValues = Set(0, 1, 2)
pure val digestValues = Set("chunk-a", "chunk-b", "packet", "other")
pure val byValues = Set(TrustedWorkflow, Owner)
pure val weight_stageChunk = 6
pure val weight_assemble = 6
pure val weight_reviewPacket = 4
pure val weight_prepare = 6
pure val weight_commit = 6
```
