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
manifest digest, and expected current predecessor. Project-private financial
protection and participation bans are rechecked in the same database
operation as the append. The view contains no private award amount. Database
atomicity, evidence authenticity and the authenticated Git parent edges are
adapter conformance. The machine is instantiated per accepted source.

Each applied history row is to be written to the canonical [Points
journal](./journal.md) as one `reallocateUnit` revision of the source's work
unit (basis `Reallocation`), in the same database transaction. Both this
machine and the journal require the new shares to sum to the unchanged pool.
That the two writes happen together is composition obligation C11; nothing
here composes them. `applied` tracks the digests of those canonical corrections.
Publication consumes the resulting journal snapshot through the [publication
model](./publication.md). A revocation is a maintainer decision recorded in
the correction workflow and bound to the source and an applied manifest. The
`by` sender is the trusted main workflow run or the repository owner.

## Story: Reassign the existing pool while preserving funded history

### A historical source retains its original carrier and every successor

```quint
import allocation as A from "./allocation"
import periods as P from "./periods"
type Actor = TrustedWorkflow | Owner | Contributor
type CorrectionPhase = Open | Prepared | EvidenceHeld | AttributionHeld | OutOfScope | Protected | Banned | Stale | Applied | Replayed
type ManifestKind = OrdinaryReallocation | OctoberReplacement
type WorkLine = { author: int, lines: int, origin: int, followup: bool, parentEdges: bool, ambiguous: bool }
type JournalEntry = { source: int, occurredAt: int, shares: List[A::PointShare], revoked: bool }
type Manifest = { digest: str, source: int, predecessor: int, connectedProof: bool, recipients: List[A::Recipient],
  kind: ManifestKind, work: List[WorkLine] }
type Chunk = { index: int, digest: str }
type Packet = { digest: str, expected: List[str], staged: List[Chunk], assembled: bool, reviewedDigest: str }
type Correction = { phase: CorrectionPhase, project: str, source: int, occurredAt: int, pool: int,
  history: List[JournalEntry], staged: Manifest, applied: List[str], frozen: bool, revoked: bool,
  packet: Packet, appliedWork: List[WorkLine] }
pure val octoberAt = 2432110
pure val original: JournalEntry = { source: 1, occurredAt: octoberAt,
  shares: List({ actor: 3, points: 30 }), revoked: false }
pure val emptyManifest: Manifest = { digest: "", source: 0, predecessor: 0, connectedProof: false, recipients: List(),
  kind: OrdinaryReallocation, work: List() }
pure val initial: Correction = { phase: Open, project: "eliza", source: 1, occurredAt: octoberAt, pool: 30,
  history: List(original), staged: emptyManifest, applied: List(), frozen: false, revoked: false,
  packet: { digest: "packet", expected: List("chunk-a", "chunk-b"), staged: List(), assembled: false, reviewedDigest: "" },
  appliedWork: List() }
pure def predecessorMatches(c: Correction, manifest: Manifest): bool =
  manifest.source == c.source and manifest.digest != "" and manifest.predecessor == c.history.length()
pure def completeCorrection(c: Correction, manifest: Manifest): bool =
  manifest.connectedProof and A::canWriteAllocation(c.pool, manifest.recipients, true, false)
    and (manifest.kind == OctoberReplacement implies
      manifest.work.length() > 0 and manifest.recipients == replacementRecipients(manifest.work))
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
is a replay, including after later revocation, and never appends again.

```quint
pure def classify(c: Correction, manifest: Manifest): CorrectionPhase =
  if (c.applied.includes(manifest.digest)) Replayed
  else if (not(predecessorMatches(c, manifest)) or c.revoked) Stale
  else if (c.frozen) Protected
  else if (manifest.kind == OctoberReplacement and not(octoberScope(c))) OutOfScope
  else if (ambiguousClaim(manifest)) AttributionHeld
  else if (not(completeCorrection(c, manifest))) EvidenceHeld
  else Prepared
pure def canPrepare(c: Correction, manifest: Manifest): bool = c.phase != Prepared
  and manifest.source == c.source and manifest.digest != "" and c.packet.assembled
pure def prepare(c: Correction, manifest: Manifest): Correction =
  if (classify(c, manifest) == Prepared) { ...c, phase: Prepared, staged: manifest } else { ...c, phase: classify(c, manifest) }
pure def canProtect(c: Correction, f: P::FreezeEvidence): bool =
  not(c.frozen) and P::freezes(f) and f.project == c.project and f.period == P::periodOf(c.occurredAt)
pure def protect(c: Correction, f: P::FreezeEvidence): Correction = { ...c, frozen: true }
```

### The atomic import rechecks current protection, bans and the captured predecessor

A protection, participation ban or predecessor change after preparation
prevents the append; the protection and ban checks run in the same database
operation as the append. A legitimate later revocation is itself
append-only. Replaying the original manifest retains the revocation. A batch
whose receipt (`correctionBatchRecorded`) is already present is a replay and
appends nothing. Existing approved, funded, scheduled and paid terms never
change through this correction flow.

```quint
pure def canCommit(c: Correction, recipientBanned: bool, by: Actor): bool = c.phase == Prepared and by == TrustedWorkflow
  and c.packet.assembled and c.packet.reviewedDigest == c.packet.digest
pure def commit(c: Correction, recipientBanned: bool, by: Actor): Correction =
  if (classify(c, c.staged) != Prepared) { ...c, phase: classify(c, c.staged), staged: emptyManifest }
  else if (recipientBanned) { ...c, phase: Banned, staged: emptyManifest }
  else { ...c, phase: Applied, staged: emptyManifest, applied: c.applied.append(c.staged.digest),
    appliedWork: c.staged.work,
    history: c.history.append({ source: c.source, occurredAt: c.occurredAt,
      shares: A::allocatePoints(c.pool, c.staged.recipients), revoked: false }) }
type Revocation = { source: int, manifestDigest: str, decision: str }
pure def canRevoke(c: Correction, revocation: Revocation): bool = revocation.source == c.source and
  revocation.decision != "" and c.applied.includes(revocation.manifestDigest) and not(c.revoked) and not(c.frozen)
pure def revoke(c: Correction, revocation: Revocation): Correction = { ...c, revoked: true,
  history: c.history.append({ source: c.source, occurredAt: c.occurredAt, shares: List(), revoked: true }) }
pure def alwaysSourceHistory(c: Correction): bool = c.history.every(row => row.source == c.source
  and row.occurredAt == c.occurredAt and (if (row.revoked) row.shares.length() == 0 else A::pointTotal(row.shares) == c.pool))
pure def alwaysOctoberOnlyInScope(c: Correction): bool = c.appliedWork.length() > 0 implies octoberScope(c)
pure def stepNoHistoryGrowthAfterProtection(before: Correction, after: Correction): bool =
  before.frozen implies after.history == before.history
pure def stepRevocationPermanent(before: Correction, after: Correction): bool =
  before.revoked implies after.revoked and after.history == before.history
pure def stepOnlyApplyOrRevocationAppends(before: Correction, via: str, after: Correction): bool =
  (via != "commit" and via != "revoke") implies after.history == before.history and after.applied == before.applied
pure def sometimesApplied(c: Correction): bool = c.phase == Applied and c.history.length() > 1
pure def sometimesProtected(c: Correction): bool = c.phase == Protected
pure def sometimesBanned(c: Correction): bool = c.phase == Banned
pure def sometimesStale(c: Correction): bool = c.phase == Stale
pure def sometimesEvidenceHeld(c: Correction): bool = c.phase == EvidenceHeld
pure def sometimesReplayAfterRevocation(c: Correction): bool = c.phase == Replayed and c.revoked
pure def sometimesFollowupRedirected(c: Correction): bool =
  c.phase == Applied and c.appliedWork.some(w => w.followup and redirected(w) and w.origin != w.author)
pure def sometimesTwoOriginSplit(c: Correction): bool =
  c.phase == Applied and c.history.some(row => row.shares.length() == 2) and c.appliedWork.every(w => redirected(w))
pure def sometimesAmbiguousHeld(c: Correction): bool = c.phase == AttributionHeld
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

### Directed witnesses check protection races, stale predecessors, October attribution and replay after revocation

```quint
pure val readyManifest: Manifest = { digest: "manifest", source: 1, predecessor: 1, connectedProof: true,
  recipients: List({ actor: 1, lines: 1 }, { actor: 2, lines: 2 }), kind: OrdinaryReallocation, work: List() }
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
    recipients: List({ actor: 1, lines: 2 }, { actor: carrier, lines: 1 }, { actor: 2, lines: 3 }) })
pure val settledFreeze: P::FreezeEvidence = { project: "eliza", period: P::october2026, phase: P::Frozen, obligationExists: false }
pure val fValues = Set(settledFreeze, { ...settledFreeze, phase: P::Proposed }, { ...settledFreeze, period: P::november2026 })
pure val ownWork: WorkLine = { author: 1, lines: 2, origin: 1, followup: false, parentEdges: false, ambiguous: false }
pure val wValues = Set(ownWork, { ...ownWork, author: carrier, followup: true, parentEdges: true },
  { ...ownWork, author: carrier, followup: true }, { ...ownWork, author: 2, origin: 0 }, { ...ownWork, author: carrier, ambiguous: true })
pure def lawProtectionRace(manifest: Manifest): bool = manifest == readyManifest implies
  commit(protect(prepare(initial, manifest), settledFreeze), false, TrustedWorkflow).phase == Protected
    and commit(protect(prepare(initial, manifest), settledFreeze), false, TrustedWorkflow).history == initial.history
pure val readyRevocation: Revocation = { source: 1, manifestDigest: "manifest", decision: "maintainer" }
pure val revocationValues = Set(readyRevocation, { ...readyRevocation, manifestDigest: "other" }, { ...readyRevocation, source: 2 })
pure def lawStalePredecessor(manifest: Manifest): bool = manifest == readyManifest implies
  commit(revoke(prepare(initial, manifest), readyRevocation), false, TrustedWorkflow).phase == Stale
pure def lawReallocationPreservesPool(manifest: Manifest): bool =
  val corrected = commit(prepare(initial, manifest), false, TrustedWorkflow)
  manifest == readyManifest implies corrected.phase == Applied and corrected.pool == initial.pool
    and corrected.occurredAt == initial.occurredAt
    and A::pointTotal(A::allocatePoints(corrected.pool, manifest.recipients)) == initial.pool
pure def lawReplayPreservesRevocation(manifest: Manifest): bool =
  val revokedState = revoke(commit(prepare(initial, manifest), false, TrustedWorkflow), readyRevocation)
  manifest == readyManifest implies prepare(revokedState, manifest).history == revokedState.history
    and prepare(revokedState, manifest).phase == Replayed
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
