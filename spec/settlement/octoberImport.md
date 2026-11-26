# October 2026 reviewed proposal import

PRD sections 6 and 7 settle October 2026 through a one-time import of an
owner-reviewed packet of monthly proposals, outside the normal
[monthly proposal](./monthly.md) write. Source anchors are development
`.github/workflows/october-rewards.yml` (manual dispatch with
`reviewed_packet_sha256` and `apply`, default off, `main` only, the
`slop-production` concurrency group), `apps/settlement/src/programs/octoberRewards.vibe`
(the native Eliza operator), and `apps/settlement/src/october/import.vibe`
(the guarded insert and exact readback).
The September–October band reapplication that produces the packet's
weights is a Points rule; this unit covers only the proposal write. One
instance is the October import of every project in the packet.

## Story: Write each reviewed October proposal once

### Planning computes the packet and writes nothing

A preview run computes the packet and its digest for the owner. The owner
reviews exactly that digest. Only an apply run and the normal monthly
workflow write proposals.

```quint
import allocation as A from "./allocation"
import money as M from "./money"
import payoutExclusions as X from "./payoutExclusions"
type PacketWeight = { actor: int, weight: M::Amount, eligible: bool }
type PacketEntry = { project: int, pool: M::Amount, weights: List[PacketWeight] }
type Packet = { digest: str, entries: List[PacketEntry] }
type Source = MonthlyWorkflow | ReviewedImport
type Proposal = { project: int, source: Source, digest: str, shares: List[A::Share] }
type WriteFacts = { project: int, ownerAuthority: bool, restricted: bool, paused: bool, protectedHistory: bool,
  banned: List[int], exclusions: List[X::Exclusion] }
type OctoberImport = { planned: Packet, reviewedDigest: str, lockHeld: bool, headIsMain: bool, proposals: List[Proposal],
  verified: List[int] }
pure val october = 202610
pure val noPacket: Packet = { digest: "", entries: List() }
pure val initial: OctoberImport = { planned: noPacket, reviewedDigest: "", lockHeld: false, headIsMain: false, proposals: List(),
  verified: List() }
pure def hasProposal(o: OctoberImport, project: int): bool = o.proposals.some(p => p.project == project)
pure def validPacket(packet: Packet): bool = packet.digest != "" and packet.entries.every(e => e.project > 0
  and packet.entries.select(o => o.project == e.project).length() == 1)
pure def canPlanImport(o: OctoberImport, packet: Packet, by: str): bool = by == "workflow" and validPacket(packet)
  and o.reviewedDigest == ""
pure def planImport(o: OctoberImport, packet: Packet, by: str): OctoberImport = { ...o, planned: packet }
pure def canReviewPacket(o: OctoberImport, digest: str, by: str): bool =
  by == "owner" and digest != "" and digest == o.planned.digest and o.reviewedDigest == ""
pure def reviewPacket(o: OctoberImport, digest: str, by: str): OctoberImport = { ...o, reviewedDigest: digest }
pure def stepOnlyWritersAddProposals(before: OctoberImport, via: str, after: OctoberImport): bool =
  (via != "applyImport" and via != "monthlyPropose") implies after.proposals == before.proposals
```

### An apply run writes only under the reviewed digest, current main and the production lock

The apply run holds the shared production lock and runs on `main` at the
current head; a moved `main` refuses. At the write it rechecks the
project's current owner authority, restriction, pause and protected
financial history, and each recipient's participation ban and the current
revision's [payout exclusions](./payoutExclusions.md). The reviewed
eligibility of every recipient must equal the current one, or the import
refuses; eligible recipients split the whole pool by largest remainder.

```quint
pure def entryFor(o: OctoberImport, project: int): PacketEntry =
  o.planned.entries.select(e => e.project == project).nthOr(0, { project: 0, pool: M::zero, weights: List() })
pure def eligibleNow(facts: WriteFacts, actor: int): bool =
  not(facts.banned.includes(actor)) and not(X::excludedIn(facts.exclusions, actor, october))
pure def payableWeights(entry: PacketEntry): List[A::Weight] =
  entry.weights.select(w => w.eligible).listMap(w => { actor: w.actor, weight: w.weight })
pure def reviewedShares(entry: PacketEntry): List[A::Share] =
  if (payableWeights(entry).length() == 0) List() else A::allocateAmounts(entry.pool, payableWeights(entry))
pure def canAcquireLock(o: OctoberImport, headIsMain: bool, by: str): bool = by == "workflow" and not(o.lockHeld)
pure def acquireLock(o: OctoberImport, headIsMain: bool, by: str): OctoberImport = { ...o, lockHeld: true, headIsMain: headIsMain }
pure def canObserveMainMoved(o: OctoberImport, by: str): bool = by == "workflow" and o.lockHeld and o.headIsMain
pure def observeMainMoved(o: OctoberImport, by: str): OctoberImport = { ...o, headIsMain: false }
pure def canReleaseLock(o: OctoberImport, by: str): bool = by == "workflow" and o.lockHeld
pure def releaseLock(o: OctoberImport, by: str): OctoberImport = { ...o, lockHeld: false, headIsMain: false }
pure def canApplyImport(o: OctoberImport, facts: WriteFacts, by: str): bool =
  val entry = entryFor(o, facts.project)
  by == "workflow" and o.lockHeld and o.headIsMain and o.reviewedDigest != "" and o.reviewedDigest == o.planned.digest
    and entry.project == facts.project and facts.project > 0 and not(hasProposal(o, facts.project))
    and facts.ownerAuthority and not(facts.restricted) and not(facts.paused) and not(facts.protectedHistory)
    and X::validList(facts.exclusions) and entry.weights.every(w => w.eligible == eligibleNow(facts, w.actor))
    and (payableWeights(entry).length() == 0 or A::canCommitAllocation(entry.pool, payableWeights(entry)))
pure def applyImport(o: OctoberImport, facts: WriteFacts, by: str): OctoberImport =
  { ...o, proposals: o.proposals.append({ project: facts.project, source: ReviewedImport, digest: o.reviewedDigest,
    shares: reviewedShares(entryFor(o, facts.project)) }) }
```

### A proposal already written is never added to or replaced

A normal monthly proposal written first keeps its rows, and the import of
that project refuses. Replaying an apply run only reads back and verifies an
imported proposal that equals the reviewed packet.

```quint
pure def canMonthlyPropose(o: OctoberImport, project: int, by: str): bool = by == "monthly" and project > 0
  and not(hasProposal(o, project))
pure def monthlyPropose(o: OctoberImport, project: int, by: str): OctoberImport =
  { ...o, proposals: o.proposals.append({ project: project, source: MonthlyWorkflow, digest: "", shares: List() }) }
pure def canVerifyReplay(o: OctoberImport, project: int, by: str): bool = by == "workflow" and o.lockHeld
  and o.proposals.some(p => p.project == project and p.source == ReviewedImport and p.digest == o.reviewedDigest
    and p.shares == reviewedShares(entryFor(o, project)))
  and not(o.verified.includes(project))
pure def verifyReplay(o: OctoberImport, project: int, by: str): OctoberImport = { ...o, verified: o.verified.append(project) }
pure def alwaysOneProposalPerProject(o: OctoberImport): bool =
  o.proposals.every(p => p.project > 0 and o.proposals.select(q => q.project == p.project).length() == 1)
pure def alwaysImportMatchesReviewedPacket(o: OctoberImport): bool =
  o.proposals.every(p => p.source == ReviewedImport implies
    (p.digest != "" and p.digest == o.reviewedDigest and p.shares == reviewedShares(entryFor(o, p.project))))
pure def alwaysVerifiedWereImported(o: OctoberImport): bool =
  o.verified.every(v => o.proposals.some(p => p.project == v and p.source == ReviewedImport))
pure def stepProposalsRetained(before: OctoberImport, after: OctoberImport): bool =
  before.proposals.every(p => after.proposals.includes(p)) and before.verified.every(v => after.verified.includes(v))
pure def stepReviewFixed(before: OctoberImport, after: OctoberImport): bool =
  before.reviewedDigest != "" implies (after.reviewedDigest == before.reviewedDigest and after.planned == before.planned)
```

### Imports, kept workflow proposals, withheld recipients and replays are reachable

```quint
pure def sometimesImported(o: OctoberImport): bool = o.proposals.some(p => p.source == ReviewedImport)
pure def sometimesWorkflowProposalKept(o: OctoberImport): bool = o.reviewedDigest != "" and o.lockHeld and o.headIsMain
  and o.proposals.some(p => p.source == MonthlyWorkflow and entryFor(o, p.project).project == p.project)
pure def sometimesWithheld(o: OctoberImport): bool = o.proposals.some(p => p.source == ReviewedImport
  and entryFor(o, p.project).weights.some(w => not(w.eligible)) and p.shares.length() > 0)
pure def sometimesReplayVerified(o: OctoberImport): bool = o.verified.length() > 0
pure val packetSample: Packet = { digest: "d1", entries: List(
  { project: 1, pool: List(6), weights: List({ actor: 1, weight: List(1), eligible: true }, { actor: 2, weight: List(3), eligible: true }) },
  { project: 2, pool: List(6), weights: List({ actor: 1, weight: List(1), eligible: false }, { actor: 3, weight: List(2), eligible: true }) }) }
pure val packetValues = Set(packetSample, { ...packetSample, digest: "d2" })
pure val digestValues = Set("d1", "d2", "")
pure val byValues = Set("workflow", "owner", "monthly", "other")
pure val headIsMainValues = Set(true, false)
pure val projectValues = Set(1, 2)
pure val factsValues = Set(
  { project: 1, ownerAuthority: true, restricted: false, paused: false, protectedHistory: false, banned: List(), exclusions: List() },
  { project: 2, ownerAuthority: true, restricted: false, paused: false, protectedHistory: false, banned: List(1), exclusions: List() },
  { project: 2, ownerAuthority: true, restricted: false, paused: false, protectedHistory: false, banned: List(),
    exclusions: List({ actor: 1, relationship: X::ProjectOwner, fromPeriod: 202610, untilPeriod: 0 }) },
  { project: 2, ownerAuthority: true, restricted: false, paused: false, protectedHistory: false, banned: List(), exclusions: List() },
  { project: 1, ownerAuthority: false, restricted: false, paused: false, protectedHistory: false, banned: List(), exclusions: List() },
  { project: 1, ownerAuthority: true, restricted: true, paused: false, protectedHistory: false, banned: List(), exclusions: List() })
pure val weight_applyImport = 5
```
