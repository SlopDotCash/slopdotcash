# ASI November 2026 closeout

PRD section 6 records one historical exception, approved and reviewed on
development: ASI's November 2026 pool closes early, at
2026-11-19T00:00:00.000Z, from one reviewed import, and its owner may
finalize the month from then on instead of after the calendar month and its
cutoff. Sources at development `8660a6121` and main `a73480a8c`
(`c7ba3b9db`, `7febcc40b`, `a1c80d7f3`), whose later repairs decide:
`src/lib/payments/asi-november-closeout.ts` (`ASI_NOVEMBER_CLOSEOUT`),
`scripts/prepare-asi-november-closeout.ts`,
`scripts/run-asi-november-closeout.ts`, `scripts/guarded-monthly-import.ts`,
`.github/workflows/asi-november-closeout.yml`,
`migrations/0143_asi_november_closeout.sql` and the retained model
`formal/models/rewards/asi_november_closeout.qnt`. The import had not
landed on main by 21 November, so it is ported as the settlement program
`asi-november-closeout` (orchestrator decision settlement6:S1, replacing
plan5:O13); a run after a base was written only reports the replay, and
[monthly allocations](./monthly.md) honours the stored row with its
`early_close_at` (`proposeCloseout`, the owner's early finalization, no
allocation change). This unit records what the reviewed import guarantees,
so that the stored row means exactly that.
The ordinary [October import](./octoberImport.md) is the precedent.

## Story: Close ASI's November pool early from one reviewed import

> As ASI's owner, I want November's pool to close at the reviewed cutoff
> and be paid from what contributors earned until then, so that the
> project can settle early without any other month or project changing.

### The closeout is exactly ASI's November 2026 pool up to its cutoff

Project `asi`, period 2026-11, cutoff 2026-11-19T00:00:00.000Z
(1795046400), gross 150,000,000 base units of USDG (6 decimals) on
`robinhood-mainnet`: ASI's monthly cap for November prorated to the time
before the cutoff (cap × (cutoff − month start) / month length, rounded
down, must equal the gross exactly). The project is active and verified
with an active receipt policy and a monthly-pool reward, has exactly one
deployment, on that network, whose asset is the network's USDG, and a fee
of 200 basis points: the ordinary per-award fee, with no maintainer share
and no review budget. The reviewed packet (schema `"1"`, kind
`"reviewed-asi-november-closeout"`, exactly its fields) binds the project,
period, cutoff and gross, a producer and a different independent reviewer
by numeric GitHub id, a review time at or after the cutoff, the snapshot
digest, the Points batch, the manifest digest, the registry revision and
the enforcement generation, and its bytes hash to the reviewed packet
digest given to the run.

```quint
import money as M from "./money"
type Packet = { project: str, period: int, cutoff: int, gross: int, producer: int, reviewer: int, reviewedAt: int, digest: str }
pure val closeoutProject = "asi"
pure val closeoutPeriod = 202611
pure val closeoutCutoff = 1795046400
pure val closeoutGross = 150000000
pure val closeoutCap: M::Amount = List(0, 0, 150)
pure val closeoutNetwork = "robinhood-mainnet"
pure val closeoutAsset = "USDG"
pure val closeoutDecimals = 6
pure val closeoutFeeBasisPoints = 200
pure def closeoutMonth(project: str, period: int): bool = project == closeoutProject and period == closeoutPeriod
pure def packetApproved(packet: Packet): bool = closeoutMonth(packet.project, packet.period)
  and packet.cutoff == closeoutCutoff and packet.gross == closeoutGross
  and packet.producer > 0 and packet.reviewer > 0 and packet.producer != packet.reviewer
  and packet.reviewedAt >= closeoutCutoff and packet.digest != ""
pure def lawSameReviewerRefused(packet: Packet): bool = packet.producer == packet.reviewer implies not(packetApproved(packet))
pure def lawOnlyTheReviewedMonth(packet: Packet): bool = packetApproved(packet) implies closeoutMonth(packet.project, packet.period)
```

### Only an apply run under the reviewed packet and preview digests writes the closeout base, once

The run is trusted only from a manual dispatch (`workflow_dispatch`) of the
canonical repository `SlopDotCash/slopdotcash` on `refs/heads/main`
(`trustedDispatch`: the program observes its own dispatch before it reads
anything, and a preview or an import needs a trusted one; the operator
workflow reaches inspect, preview and apply under the same condition), at
the current head of `main` (a moved `main` refuses, checked again just
before the write), under
the shared production lock, in one of three modes. Inspect reads the
published cutoff and the canonical Points coverage and writes nothing.
Preview needs the exact reviewed packet and its digest, computes the import
and its preview digest (the plan's review without its capture time) and
writes nothing. Apply needs both digests: it refuses when the current
closeout differs from the approved preview, writes the base, its rows and
`early_close_at` in one guarded import, and reads them back inside the same
import, so a failed readback commits nothing. A replay that matches the
stored base exactly is a no-op. The ordinary monthly workflow writes an
ordinary base only after the calendar month ends; each month has one base,
so whichever is written first is the month's. The owner may finalize a
closeout base from the cutoff and an ordinary one after the month ends;
the automatic path keeps the ordinary cutoff for both.

Phases: 0 before the cutoff, 1 from the cutoff, 2 from the end of the
calendar month, 3 from the ordinary automatic cutoff.

```quint
type BaseKind = NoBase | CloseoutBase | OrdinaryBase
type HeldWork = NoHeldWork | HeldOutsideAsi | HeldUnproved
type Closeout = { phase: int, dispatchTrusted: bool, sourcesVerified: bool, heldSources: HeldWork, packet: Packet, preview: str,
  base: BaseKind, frozen: bool, ownerSigned: bool, admitted: bool }
pure val noPacket: Packet = { project: "", period: 0, cutoff: 0, gross: 0, producer: 0, reviewer: 0, reviewedAt: 0, digest: "" }
pure val initial: Closeout = { phase: 0, dispatchTrusted: false, sourcesVerified: false, heldSources: NoHeldWork, packet: noPacket,
  preview: "", base: NoBase, frozen: false, ownerSigned: false, admitted: false }
pure def trustedDispatch(repository: str, gitRef: str, dispatchEvent: str): bool =
  repository == "SlopDotCash/slopdotcash" and gitRef == "refs/heads/main" and dispatchEvent == "workflow_dispatch"
pure def lawOnlyTrustedDispatch(repository: str, gitRef: str, dispatchEvent: str): bool =
  (repository != "SlopDotCash/slopdotcash" or gitRef != "refs/heads/main" or dispatchEvent != "workflow_dispatch")
    implies not(trustedDispatch(repository, gitRef, dispatchEvent))
pure def canObserveDispatch(c: Closeout, repository: str, gitRef: str, dispatchEvent: str, by: str): bool =
  by == "workflow" and trustedDispatch(repository, gitRef, dispatchEvent) != c.dispatchTrusted
pure def observeDispatch(c: Closeout, repository: str, gitRef: str, dispatchEvent: str, by: str): Closeout =
  { ...c, dispatchTrusted: trustedDispatch(repository, gitRef, dispatchEvent) }
pure def canAdvance(c: Closeout, by: str): bool = by == "clock" and c.phase < 3
pure def advance(c: Closeout, by: str): Closeout = { ...c, phase: c.phase + 1 }
pure def canPreviewCloseout(c: Closeout, packet: Packet, preview: str, by: str): bool =
  by == "workflow" and c.dispatchTrusted and c.phase >= 1 and c.base == NoBase and c.sourcesVerified and packetApproved(packet)
    and preview != ""
pure def previewCloseout(c: Closeout, packet: Packet, preview: str, by: str): Closeout = { ...c, packet: packet, preview: preview }
pure def canImportCloseout(c: Closeout, packetDigest: str, preview: str, by: str): bool =
  by == "workflow" and c.dispatchTrusted and c.phase >= 1 and c.base == NoBase and c.sourcesVerified and packetApproved(c.packet)
    and c.preview != "" and preview == c.preview and packetDigest == c.packet.digest
pure def importCloseout(c: Closeout, packetDigest: str, preview: str, by: str): Closeout = { ...c, base: CloseoutBase }
pure def stepCloseoutBaseOnlyFromTrustedVerifiedRun(before: Closeout, after: Closeout): bool =
  (before.base == NoBase and after.base == CloseoutBase) implies (before.dispatchTrusted and before.sourcesVerified)
pure def canImportOrdinary(c: Closeout, by: str): bool = by == "workflow" and c.phase >= 2 and c.base == NoBase
pure def importOrdinary(c: Closeout, by: str): Closeout = { ...c, base: OrdinaryBase }
```

### The closeout base binds the cutoff-specific source, the Points checkpoint and the registry revision

Before a base is created the import requires the project row at the
reviewed revision and manifest, active; the current Points batch to be the
reviewed one, with coverage of the published cutoff snapshot for every
counted repository; the registry's enforcement generation to be the
reviewed one; the month not protected by a recorded payment; no recipient
with a participation ban; and no orphan base rows. The registry capture
comes from `https://slop.cash`, names exactly the ASI project with a clear
restriction, and is taken after the review and not in the future; the
current reviewer's authority is read again before the write. The stored
row's check lets `early_close_at` exist only on this month with this cutoff
and gross, and a trigger refuses every allocation change of a month that
has it. A source that stops being the reviewed one before the write stops
the import (`sourcesVerified`).

The cutoff snapshot may hold work units and name unavailable sources only
when every held unit is another project's work, proven from Slopbot's
journal: each held unit is the exact canonical work-unit journal row named
by its digest (its bytes hash to the digest, schema
`slop-work-unit-record:v1`, a 64-hex source digest) of a project other than
ASI; every source of it is a registered repository of that project,
identified by its immutable node and database ids, and none is a repository
counted for ASI in November; no pull request appears twice; the journal's
source index equals the record's sources; and the snapshot's unavailable
sources are exactly the held units' unavailable members. Each held unit has
its own journal row, and its listed sources are exactly the record's pull
requests. A snapshot with no
held unit names no unavailable source. Held work of ASI, mixed work, a
missing or altered journal row and an unbound unavailable source stop the
import. The workflow observes the coverage (`verified`) together with what
the held units prove: `NoHeldWork` (none held), `HeldOutsideAsi` (all proven
another project's) or `HeldUnproved`.

```quint
pure def heldSourcesAdmitted(heldSources: HeldWork): bool = heldSources == NoHeldWork or heldSources == HeldOutsideAsi
pure def lawUnprovedHeldRefused(heldSources: HeldWork): bool = heldSources == HeldUnproved implies not(heldSourcesAdmitted(heldSources))
pure def canObserveSources(c: Closeout, verified: bool, heldSources: HeldWork, by: str): bool = by == "workflow"
  and ((verified and heldSourcesAdmitted(heldSources)) != c.sourcesVerified or heldSources != c.heldSources)
pure def observeSources(c: Closeout, verified: bool, heldSources: HeldWork, by: str): Closeout =
  { ...c, sourcesVerified: verified and heldSourcesAdmitted(heldSources), heldSources: heldSources }
pure def canOwnerFinalize(c: Closeout, by: str): bool = by == "owner" and c.base != NoBase and not(c.frozen)
  and (c.phase >= 2 or (c.base == CloseoutBase and c.phase >= 1))
pure def ownerFinalize(c: Closeout, by: str): Closeout = { ...c, frozen: true }
pure def canAutomaticFinalize(c: Closeout, by: str): bool = by == "coordinator" and c.base != NoBase and c.phase >= 3 and not(c.frozen)
pure def automaticFinalize(c: Closeout, by: str): Closeout = { ...c, frozen: true }
pure def canOwnerReserve(c: Closeout, by: str): bool = by == "owner" and c.frozen and not(c.ownerSigned) and not(c.admitted)
pure def ownerReserve(c: Closeout, by: str): Closeout = { ...c, ownerSigned: true }
pure def canAutomaticAdmit(c: Closeout, by: str): bool = by == "coordinator" and c.frozen and c.phase >= 3 and not(c.admitted)
pure def automaticAdmit(c: Closeout, by: str): Closeout = { ...c, admitted: true }
```

### A month freezes before its calendar end only from a reviewed closeout base, and a written base never changes

A closeout base exists only from a reviewed preview of the approved packet
after the cutoff, an ordinary base only after the month ends, a month
freezes before its calendar end only from a closeout base, and the base and
the reviewed packet never change once written.

```quint
pure def alwaysCloseoutBaseReviewed(c: Closeout): bool =
  c.base == CloseoutBase implies (c.preview != "" and packetApproved(c.packet) and c.phase >= 1)
pure def alwaysOrdinaryBaseAfterMonth(c: Closeout): bool = c.base == OrdinaryBase implies c.phase >= 2
pure def alwaysVerifiedOnlyAdmittedHeld(c: Closeout): bool = c.sourcesVerified implies heldSourcesAdmitted(c.heldSources)
pure def alwaysFrozenHasBase(c: Closeout): bool = c.frozen implies c.base != NoBase
pure def alwaysEarlyFreezeOnlyFromCloseout(c: Closeout): bool = (c.frozen and c.phase < 2) implies c.base == CloseoutBase
pure def alwaysReservedOnlyFrozen(c: Closeout): bool = c.ownerSigned implies c.frozen
pure def alwaysAdmittedAfterCutoff(c: Closeout): bool = c.admitted implies (c.frozen and c.phase >= 3)
pure def stepBaseWrittenOnce(before: Closeout, after: Closeout): bool = before.base != NoBase implies after.base == before.base
pure def stepReviewedPacketFixed(before: Closeout, after: Closeout): bool =
  before.base == CloseoutBase implies (after.packet == before.packet and after.preview == before.preview)
pure def sometimesOwnerClosesEarly(c: Closeout): bool = c.ownerSigned and c.phase == 1 and c.base == CloseoutBase
pure def sometimesOrdinaryCalendar(c: Closeout): bool = c.admitted and c.base == OrdinaryBase
pure def sometimesPreviewedNotApplied(c: Closeout): bool = c.preview != "" and c.base == OrdinaryBase
pure def sometimesClosedWithOtherProjectsHeld(c: Closeout): bool = c.base == CloseoutBase and c.heldSources == HeldOutsideAsi
pure val reviewedPacket: Packet = { project: closeoutProject, period: closeoutPeriod, cutoff: closeoutCutoff, gross: closeoutGross,
  producer: 1, reviewer: 2, reviewedAt: closeoutCutoff, digest: "d1" }
pure val packetValues = Set(reviewedPacket, { ...reviewedPacket, reviewer: 1 }, { ...reviewedPacket, gross: 250000000 },
  { ...reviewedPacket, digest: "d2" })
pure val previewValues = Set("p1", "p2")
pure val packetDigestValues = Set("d1", "d2")
pure val byValues = Set("clock", "workflow", "owner", "coordinator", "other")
pure val repositoryValues = Set("SlopDotCash/slopdotcash", "other/slopdotcash")
pure val gitRefValues = Set("refs/heads/main", "refs/heads/develop", "refs/pull/1/merge")
pure val dispatchEventValues = Set("workflow_dispatch", "workflow_run", "pull_request")
pure val weight_importCloseout = 3
pure val eval_witness_sometimesOwnerClosesEarly = (
  ("observeDispatch", "SlopDotCash/slopdotcash", "refs/heads/main", "workflow_dispatch", "workflow"),
  ("observeSources", true, NoHeldWork, "workflow"), ("advance", "clock"), ("previewCloseout", reviewedPacket, "p1", "workflow"),
  ("importCloseout", "d1", "p1", "workflow"), ("ownerFinalize", "owner"), ("ownerReserve", "owner"))
pure val eval_witness_sometimesClosedWithOtherProjectsHeld = (
  ("observeDispatch", "SlopDotCash/slopdotcash", "refs/heads/main", "workflow_dispatch", "workflow"),
  ("observeSources", true, HeldOutsideAsi, "workflow"), ("advance", "clock"), ("previewCloseout", reviewedPacket, "p1", "workflow"),
  ("importCloseout", "d1", "p1", "workflow"))
pure val eval_witness_sometimesPreviewedNotApplied = (
  ("observeDispatch", "SlopDotCash/slopdotcash", "refs/heads/main", "workflow_dispatch", "workflow"),
  ("observeSources", true, NoHeldWork, "workflow"), ("advance", "clock"), ("previewCloseout", reviewedPacket, "p1", "workflow"),
  ("advance", "clock"), ("importOrdinary", "workflow"))
```
