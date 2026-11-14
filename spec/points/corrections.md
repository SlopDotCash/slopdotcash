# Import historical implementation Points corrections atomically

PRD sections 2, 7 and 12 require historical reallocation to preserve the
accepted source's full prior pool, original identity and occurrence time. This
model includes `historical_implementation_allocation` at legacy main commit
`8d14a9692b998ee3f4479725b6323125f11f11be`.

The collector binds a complete connected source and claim proof, allocation
manifest digest, and expected current predecessor. Project-private financial
protection is rechecked in the same database operation as the append. The view
contains no private award amount. Database atomicity and evidence authenticity
require adapter conformance. The machine is instantiated per accepted source.

This is a detailed projection of a correction in the canonical [Points
journal](./journal.md). `history` tracks recipient allocations for that single
source and `applied` tracks the digests of its canonical correction records.
The operation represented by `commit` appends once to the canonical journal.
The summary journal's `reassign` represents that same append at the aggregate
weight level. A future adapter uses a single database transaction and does
not emit a second append from the summary. Publication consumes the resulting
journal snapshot through the [publication model](./publication.md).

## Story: Reassign the existing pool while preserving funded history

### A historical source retains its original carrier and every successor

```quint
import allocation as A from "./allocation"
import journal as J from "./journal"
type CorrectionPhase = Open | Prepared | EvidenceHeld | Protected | Stale | Applied | Replayed
type JournalEntry = { source: int, occurredAt: int, shares: List[A::PointShare], revoked: bool }
type Manifest = { digest: str, source: int, predecessor: int, connectedProof: bool, recipients: List[A::Recipient] }
type Correction = { phase: CorrectionPhase, source: int, occurredAt: int, pool: int,
  history: List[JournalEntry], staged: Manifest, applied: List[str], frozen: bool, revoked: bool }
pure val original: JournalEntry = { source: 1, occurredAt: 1,
  shares: List({ actor: 3, points: 30 }), revoked: false }
pure val emptyManifest: Manifest = { digest: "", source: 0, predecessor: 0, connectedProof: false, recipients: List() }
pure val initial: Correction = { phase: Open, source: 1, occurredAt: 1, pool: 30,
  history: List(original), staged: emptyManifest, applied: List(), frozen: false, revoked: false }
pure def predecessorMatches(c: Correction, manifest: Manifest): bool =
  manifest.source == c.source and manifest.digest != "" and manifest.predecessor == c.history.length()
pure def completeCorrection(c: Correction, manifest: Manifest): bool =
  manifest.connectedProof and A::canWriteAllocation(c.pool, manifest.recipients, true, false)
```

### Preparation captures the current predecessor and never appends an allocation

The source journal must contain the entire prior pool, including the former
carrier's share. A complete eligible proof is needed before the new shares can
reach the atomic import. A frozen source refuses. A previously applied digest
is a replay, including after later revocation, and never appends again.

```quint
pure def canPrepare(c: Correction, manifest: Manifest): bool = c.phase != Prepared
  and manifest.source == c.source and manifest.digest != ""
pure def prepare(c: Correction, manifest: Manifest): Correction =
  if (c.applied.includes(manifest.digest)) { ...c, phase: Replayed }
  else if (not(predecessorMatches(c, manifest)) or c.revoked) { ...c, phase: Stale }
  else if (c.frozen) { ...c, phase: Protected }
  else if (not(completeCorrection(c, manifest))) { ...c, phase: EvidenceHeld }
  else { ...c, phase: Prepared, staged: manifest }
pure def canProtect(c: Correction): bool = not(c.frozen)
pure def protect(c: Correction): Correction = { ...c, frozen: true }
```

### The atomic import rechecks current protection and the captured predecessor

A protection or predecessor change after preparation prevents the append. A
legitimate later revocation is itself append-only. Replaying the original
manifest retains the revocation. Existing approved, funded, scheduled and
paid terms never change through this correction flow.

```quint
pure def canCommit(c: Correction): bool = c.phase == Prepared
pure def commit(c: Correction): Correction =
  if (c.applied.includes(c.staged.digest)) { ...c, phase: Replayed, staged: emptyManifest }
  else if (not(predecessorMatches(c, c.staged)) or c.revoked) { ...c, phase: Stale, staged: emptyManifest }
  else if (c.frozen) { ...c, phase: Protected, staged: emptyManifest }
  else if (not(completeCorrection(c, c.staged))) { ...c, phase: EvidenceHeld, staged: emptyManifest }
  else { ...c, phase: Applied, staged: emptyManifest, applied: c.applied.append(c.staged.digest),
    history: c.history.append({ source: c.source, occurredAt: c.occurredAt,
      shares: A::allocatePoints(c.pool, c.staged.recipients), revoked: false }) }
pure def canRevoke(c: Correction, verifiedRevocation: bool): bool = verifiedRevocation and not(c.revoked) and not(c.frozen)
pure def revoke(c: Correction, verifiedRevocation: bool): Correction = { ...c, revoked: true,
  history: c.history.append({ source: c.source, occurredAt: c.occurredAt, shares: List(), revoked: true }) }
pure def alwaysSourceHistory(c: Correction): bool = c.history.every(row => row.source == c.source
  and row.occurredAt == c.occurredAt and (if (row.revoked) row.shares.length() == 0 else A::pointTotal(row.shares) == c.pool))
pure def stepNoHistoryGrowthAfterProtection(before: Correction, after: Correction): bool =
  before.frozen implies after.history == before.history
pure def stepRevocationPermanent(before: Correction, after: Correction): bool =
  before.revoked implies after.revoked and after.history == before.history
pure def sometimesApplied(c: Correction): bool = c.phase == Applied and c.history.length() > 1
pure def sometimesProtected(c: Correction): bool = c.phase == Protected
pure def sometimesStale(c: Correction): bool = c.phase == Stale
pure def sometimesEvidenceHeld(c: Correction): bool = c.phase == EvidenceHeld
pure def sometimesReplayAfterRevocation(c: Correction): bool = c.phase == Replayed and c.revoked
```

### Directed witnesses check protection races, stale predecessors and replay after revocation

```quint
pure val readyManifest: Manifest = { digest: "manifest", source: 1, predecessor: 1, connectedProof: true,
  recipients: List({ actor: 1, lines: 1 }, { actor: 2, lines: 2 }) }
pure val manifestValues = Set(readyManifest,
  { ...readyManifest, digest: "incomplete", connectedProof: false },
  { ...readyManifest, digest: "second", predecessor: 2 },
  { ...readyManifest, digest: "stale", predecessor: 0 })
pure def lawProtectionRace(manifest: Manifest): bool = manifest == readyManifest implies
  commit(protect(prepare(initial, manifest))).phase == Protected
    and commit(protect(prepare(initial, manifest))).history == initial.history
pure def lawStalePredecessor(manifest: Manifest): bool = manifest == readyManifest implies
  commit(revoke(prepare(initial, manifest), true)).phase == Stale
pure def lawCanonicalWeightPreserved(manifest: Manifest): bool =
  val source = J::credit(J::initial, 30, 1, true, true, false)
  val corrected = commit(prepare(initial, manifest))
  manifest == readyManifest implies corrected.phase == Applied
    and J::canReassign(source, initial.pool, corrected.pool, manifest.connectedProof)
    and J::reassign(source, initial.pool, corrected.pool, manifest.connectedProof).rewardWeight == source.rewardWeight
    and J::reassign(source, initial.pool, corrected.pool, manifest.connectedProof).occurredAt == corrected.occurredAt
pure def lawReplayPreservesRevocation(manifest: Manifest): bool =
  val revokedState = revoke(commit(prepare(initial, manifest)), true)
  manifest == readyManifest implies prepare(revokedState, manifest).history == revokedState.history
    and prepare(revokedState, manifest).phase == Replayed
```
