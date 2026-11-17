# Private bounty program terms

PRD section 8 ("Offers and report intake", "Protected program terms") and the
repository instructions keep one optional bounty program per registered
project, published through immutable D1 project revisions. A program is never
removed. Pausing or closing it keeps every received case's receipt terms and
every funded obligation. The program issues the only paid
[receipt terms](./terms.md) a new report can freeze.

## Story: Publish, pause and close an offer without changing received reports

### A program revision needs current owner authority and exact split rules

Current GitHub authority for the stored project comes from the project
authority service (`backend/projects/`, checked through Slopbot) as a
`VerifiedOwner` record for this project and its current revision. The
project identity is bound once from the D1 registry row. Only the
platform project `slopdotcash` may publish the full-award split, and only
with an audited administrator split approval recorded for that exact program
revision. A standard split divides exactly by four. The owner's exclusion
lines are part of the revision ([terms](./terms.md)), so a change applies
only to later reports. A full award is an
after-approval pledge (CLAUDE.md, 28 October 2026): it binds no 75/25 bounty
vault.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
type ProgramStatus = Unpublished | PendingApproval | Open | Paused | Closed
type FundingState = Pledged | VerifiedAvailable
type VerifiedOwner = { actor: int, project: str, projectRevision: int }
type Offer = { status: ProgramStatus, policy: T::FundingPolicy, eligibility: T::Eligibility, gross: M::Amount,
  split: T::AwardSplit, asset: str, excludedFindings: List[int] }
type Program = { project: str, projectRevision: int, offer: Offer, revision: int, publishedAt: int,
  revisions: List[int], splitApprovals: List[int], funding: FundingState, fundingObservedAt: int }
pure val platformProject = "slopdotcash"
pure val noOffer: Offer = { status: Unpublished, policy: T::AfterApproval, eligibility: T::InScopeSecurity, gross: M::zero,
  split: T::StandardSplit, asset: "", excludedFindings: List() }
pure val initial: Program = { project: "", projectRevision: 1, offer: noOffer, revision: 0, publishedAt: 0,
  revisions: List(), splitApprovals: List(), funding: Pledged, fundingObservedAt: 0 }
pure def canBindProject(p: Program, project: str): bool = p.project == "" and project != ""
pure def bindProject(p: Program, project: str): Program = { ...p, project: project }
pure def ownerMatches(p: Program, owner: VerifiedOwner, by: int): bool =
  owner.actor == by and by > 0 and owner.project == p.project and owner.projectRevision == p.projectRevision
pure def offerShapeValid(p: Program, offer: Offer, revision: int): bool = offer.status != Unpublished and offer.asset != ""
  and T::exclusionLinesValid(offer.excludedFindings)
  and M::validAmount(offer.gross) and M::positiveAmount(offer.gross)
  and (if (offer.split == T::StandardSplit) M::privateSplitPossible(offer.gross)
    else p.project == platformProject and offer.policy == T::AfterApproval and p.splitApprovals.includes(revision))
pure def fundedEnough(p: Program, offer: Offer): bool =
  offer.status != Open or offer.policy == T::AfterApproval or p.funding == VerifiedAvailable
pure def canPublish(p: Program, by: int, owner: VerifiedOwner, offer: Offer, nowMs: int): bool =
  ownerMatches(p, owner, by) and nowMs > 0 and nowMs >= p.publishedAt
    and offerShapeValid(p, offer, p.revision + 1) and fundedEnough(p, offer)
pure def publish(p: Program, by: int, owner: VerifiedOwner, offer: Offer, nowMs: int): Program =
  { ...p, offer: offer, revision: p.revision + 1, publishedAt: nowMs, revisions: p.revisions.append(p.revision + 1) }
```

### Administrators approve a split exception for one exact future revision

The administrator list is operator configuration verified by the shell. The
approval is an audited record bound to the platform project and to the next
program revision; it grants nothing to any other project or revision.

```quint
pure val administrators = Set(18633264)
pure def canApproveFullSplit(p: Program, by: int): bool = administrators.contains(by) and p.project == platformProject
  and not(p.splitApprovals.includes(p.revision + 1))
pure def approveFullSplit(p: Program, by: int): Program = { ...p, splitApprovals: p.splitApprovals.append(p.revision + 1) }
```

### Funding state comes only from a fresh finalized bounty-vault snapshot

The server sets funding evidence; an owner cannot supply it. A finalized
snapshot of the reviewed bounty vault no older than 30 minutes with a
positive free balance in the program asset shows verified funds. A missing,
stale or empty observation shows a pledge. A pledge is never treated as
money. A later observation never rewrites a published revision.

```quint
type FundingSnapshot = { finalized: bool, observedAt: int, asset: str, free: M::Amount }
pure def canObserveFunding(p: Program, snapshot: FundingSnapshot, nowMs: int): bool =
  nowMs >= snapshot.observedAt and snapshot.observedAt >= p.fundingObservedAt and M::validAmount(snapshot.free)
pure def observeFunding(p: Program, snapshot: FundingSnapshot, nowMs: int): Program =
  { ...p, fundingObservedAt: snapshot.observedAt, funding: if (snapshot.finalized and snapshot.asset == p.offer.asset
      and p.offer.asset != "" and nowMs - snapshot.observedAt <= 1800000 and M::positiveAmount(snapshot.free)) VerifiedAvailable else Pledged }
pure def canObserveProjectRevision(p: Program, projectRevision: int): bool = projectRevision > p.projectRevision
pure def observeProjectRevision(p: Program, projectRevision: int): Program = { ...p, projectRevision: projectRevision }
```

### Receipt terms come only from the open published revision

A report freezes the offer in force at its receipt time. Only an open
program issues paid terms. Pending approval, paused, closed and unpublished
programs issue unpaid receipts with the project revision; a later revision
cannot grant an award to an earlier report.

```quint
pure def receiptTerms(p: Program, receivedAt: int): T::ReceiptTerms =
  if (p.offer.status == Open and p.revision > 0 and p.publishedAt <= receivedAt)
    { revision: p.revision, publishedAt: p.publishedAt, receivedAt: receivedAt, paidTerms: true, fundingPolicy: p.offer.policy,
      eligibility: p.offer.eligibility, offeredGross: p.offer.gross, split: p.offer.split, asset: p.offer.asset,
      excludedFindings: p.offer.excludedFindings }
  else T::unpaidTerms(p.projectRevision, receivedAt)
pure def alwaysFullAwardPlatformOnly(p: Program): bool = p.offer.split == T::FullAward and p.offer.status != Unpublished implies
  p.project == platformProject and p.offer.policy == T::AfterApproval and p.splitApprovals.includes(p.revision)
pure def alwaysPublishedOfferExact(p: Program): bool = p.offer.status != Unpublished implies p.revision > 0
  and p.revisions.includes(p.revision) and offerShapeValid(p, p.offer, p.revision)
pure def alwaysUnpublishedHasNoRevision(p: Program): bool = p.offer.status == Unpublished implies p.revision == 0 and p.revisions == List()
pure def stepRevisionsAppendOnly(before: Program, after: Program): bool = after.revision >= before.revision
  and (after.revisions == before.revisions or after.revisions == before.revisions.append(after.revision))
  and (before.project == "" or after.project == before.project)
pure def stepNoRemoval(before: Program, after: Program): bool = before.offer.status != Unpublished implies after.offer.status != Unpublished
pure def lawReceiptTermsValid(p: Program, receivedAt: int): bool =
  (alwaysPublishedOfferExact(p) and receivedAt > 0 and p.projectRevision > 0 and p.publishedAt >= 0) implies T::validReceipt(receiptTerms(p, receivedAt))
pure def sometimesOpenPledge(p: Program): bool = p.offer.status == Open and p.offer.policy == T::AfterApproval and p.funding == Pledged
pure def sometimesOpenPrefunded(p: Program): bool = p.offer.status == Open and p.offer.policy == T::Prefunded
pure def sometimesPaused(p: Program): bool = p.offer.status == Paused
pure def sometimesClosedAfterOpen(p: Program): bool = p.offer.status == Closed and p.revisions.length() > 1
```

### Simulation samples cover both projects, both splits and stale funds

```quint
pure val ownerValues = Set({ actor: 7, project: "umia", projectRevision: 1 }, { actor: 18633264, project: "slopdotcash", projectRevision: 1 },
  { actor: 7, project: "umia", projectRevision: 2 })
pure val byValues = Set(7, 18633264)
pure val projectValues = Set("umia", "slopdotcash")
pure val standardOffer: Offer = { status: Open, policy: T::AfterApproval, eligibility: T::InScopeSecurity, gross: List(100),
  split: T::StandardSplit, asset: "usdc", excludedFindings: List(3, 300) }
pure val offerValues = Set(standardOffer, { ...standardOffer, policy: T::Prefunded }, { ...standardOffer, status: Paused },
  { ...standardOffer, status: Closed }, { ...standardOffer, split: T::FullAward, gross: List(101) }, { ...standardOffer, gross: List(101) },
  { ...standardOffer, excludedFindings: List(2) })
pure val snapshotValues = Set({ finalized: true, observedAt: 1, asset: "usdc", free: List(500) },
  { finalized: false, observedAt: 2, asset: "usdc", free: List(500) }, { finalized: true, observedAt: 3, asset: "usdc", free: List(0) })
pure val nowMsValues = Set(1, 2, 1800002)
pure val projectRevisionValues = Set(2, 3)
pure val receivedAtValues = Set(0, 1, 3)
```
