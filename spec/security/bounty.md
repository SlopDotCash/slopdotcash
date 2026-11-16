# Project bounty exclusivity and funding

PRD sections 8 and 10 require the first verified qualifying report for each
underlying finding, one award obligation per finding and verified funds before
a vault reservation. CLAUDE.md requires that full-award cases never reserve
or pay through a 75/25 vault. This machine holds every private
[case](./cases.md) of one project (two representative cases here, `first`
and `second`), the
project's root-cause holds (`security_award_reservations`,
`security_direct_awards` and pending related-party proposals in Slop
development `backend/security/handler.ts`), the latest finalized bounty-vault
snapshot and the qualified direct route observation. It is the only producer
of `C::ProjectClearance`.

## Story: Award each underlying finding once, to its first qualifying report

### Cases of one project share holds, funds and the route observation

Each case is received once with the terms its program issued at receipt. A
new verified authority snapshot applies to every case of the project at once.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import cases as C from "./cases"
type HoldKind = ProposalHold | VaultHold | DirectHold | FullAwardHold
type Hold = { caseId: int, rootCause: int, kind: HoldKind, fundsObservedAt: int }
type FundsSnapshot = { finalized: bool, observedAt: int, asset: str, free: M::Amount }
type RouteObservation = { asset: str, qualified: bool, observedAt: int }
type Bounty = { first: C::PrivateCase, second: C::PrivateCase, holds: List[Hold], funds: FundsSnapshot, reserved: M::Amount,
  route: RouteObservation, clockMs: int }
pure val caseIds: List[int] = List(1, 2)
pure val noFunds: FundsSnapshot = { finalized: false, observedAt: 0, asset: "", free: M::zero }
pure val initial: Bounty = { first: C::initial, second: C::initial, holds: List(), funds: noFunds, reserved: M::zero,
  route: { asset: "", qualified: false, observedAt: 0 }, clockMs: 3 }
pure def caseOf(b: Bounty, id: int): C::PrivateCase = if (id == 1) b.first else b.second
pure def putCase(id: int, c: C::PrivateCase, b: Bounty): Bounty = if (id == 1) { ...b, first: c } else { ...b, second: c }
pure def known(id: int): bool = caseIds.includes(id)
pure def canReceive(b: Bounty, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): bool =
  known(id) and C::canReceive(caseOf(b, id), source, terms, C::NewReceipt, M::zero, reportVersion)
pure def receive(b: Bounty, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): Bounty =
  putCase(id, C::receive(caseOf(b, id), source, terms, C::NewReceipt, M::zero, reportVersion), b)
pure def canObserveAuthority(b: Bounty, snapshot: C::Authority): bool =
  caseIds.every(id => C::canObserveAuthority(caseOf(b, id), snapshot))
pure def observeAuthority(b: Bounty, snapshot: C::Authority): Bounty =
  { ...b, first: C::observeAuthority(b.first, snapshot), second: C::observeAuthority(b.second, snapshot) }
pure def canAdvanceClock(b: Bounty, nowMs: int): bool = nowMs > b.clockMs
pure def advanceClock(b: Bounty, nowMs: int): Bounty = { ...b, clockMs: nowMs }
pure def canObserveFunds(b: Bounty, funds: FundsSnapshot): bool = funds.observedAt > b.funds.observedAt
  and funds.observedAt <= b.clockMs and M::validAmount(funds.free)
pure def observeFunds(b: Bounty, funds: FundsSnapshot): Bounty = { ...b, funds: funds }
pure def alwaysFundsObserved(b: Bounty): bool = b.funds.observedAt >= 0 and b.funds.observedAt <= b.clockMs
  and (b.funds.finalized implies b.funds.observedAt > 0)
pure def canObserveRoute(b: Bounty, route: RouteObservation): bool = route.observedAt > b.route.observedAt and route.observedAt <= b.clockMs
pure def observeRoute(b: Bounty, route: RouteObservation): Bounty = { ...b, route: route }
```

### The earliest human-confirmed eligible report of a root cause qualifies first

Order is receipt time, then case identity. A confirmed finding still counts
while an appeal of its award is open. A later report cannot displace it,
even if the earlier case has no award yet.

```quint
pure def confirmedEligible(c: C::PrivateCase): bool = c.submission == C::Verified
  and (c.receipt == C::Confirmed or (c.appeal == C::AppealOpen and c.appealFrom == C::Confirmed))
  and T::eligibleFinding(c.terms, c.inScope, c.severity, c.loss)
pure def receivedBefore(b: Bounty, other: int, id: int): bool =
  val o = caseOf(b, other)
  val c = caseOf(b, id)
  o.terms.receivedAt < c.terms.receivedAt or (o.terms.receivedAt == c.terms.receivedAt and other < id)
pure def firstQualifying(b: Bounty, id: int): bool = caseIds.every(other => other == id
  or not(confirmedEligible(caseOf(b, other)) and caseOf(b, other).rootCause == caseOf(b, id).rootCause and receivedBefore(b, other, id)))
pure def hasHold(b: Bounty, id: int): bool = b.holds.some(h => h.caseId == id)
pure def rootCauseFree(b: Bounty, id: int): bool = b.holds.every(h => h.caseId == id or h.rootCause != caseOf(b, id).rootCause)
```

### A vault reservation needs a fresh finalized snapshot that still covers the award

A compatible reviewed bounty vault in the case's asset makes the award
vault-backed: it reserves only when the finalized free balance observed
within 30 minutes, minus open reservations, covers the gross amount;
otherwise it stays pending and the owner repeats the action once funded.
Without a compatible vault, a qualified direct route admits a direct standard
award. A full award needs neither and binds no vault.

```quint
pure def fundsFresh(b: Bounty, asset: str): bool = b.funds.finalized and b.funds.asset == asset and asset != ""
  and b.clockMs >= b.funds.observedAt and b.clockMs - b.funds.observedAt <= 1800000
pure def fundsCover(b: Bounty, amount: M::Amount): bool =
  M::compareAmounts(b.reserved, b.funds.free) <= 0 and M::compareAmounts(M::subtractAmounts(b.funds.free, b.reserved), amount) >= 0
pure def railFor(b: Bounty, id: int, amount: M::Amount): C::Rail =
  val c = caseOf(b, id)
  if (c.terms.split == T::FullAward) C::NoRail
  else if (b.funds.asset == c.terms.asset and c.terms.asset != "") (if (fundsFresh(b, c.terms.asset) and fundsCover(b, amount)) C::VaultRail else C::NoRail)
  else if (b.route.qualified and b.route.asset == c.terms.asset) C::DirectRail else C::NoRail
pure def clearanceFor(b: Bounty, id: int, amount: M::Amount): C::ProjectClearance =
  { caseRevision: caseOf(b, id).revision, firstQualifying: firstQualifying(b, id), rootCauseFree: rootCauseFree(b, id), rail: railFor(b, id, amount) }
pure def holdFor(b: Bounty, id: int, after: C::PrivateCase): Hold =
  { caseId: id, rootCause: after.rootCause, fundsObservedAt: if (after.commitment == C::VaultReservation) b.funds.observedAt else 0,
    kind: if (after.commitment == C::VaultReservation) VaultHold else if (after.commitment == C::DirectAward) DirectHold
      else if (after.commitment == C::FullAwardHeld) FullAwardHold else ProposalHold }
pure def withHold(id: int, after: C::PrivateCase, amount: M::Amount, b: Bounty): Bounty =
  { ...putCase(id, after, b), holds: b.holds.select(h => h.caseId != id).append(holdFor(b, id, after)),
    reserved: if (after.commitment == C::VaultReservation) M::addAmounts(b.reserved, amount) else b.reserved }
```

### Awards, related-party reviews and appeals go through the case with project clearance

```quint
pure def canDecide(b: Bounty, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): bool =
  known(id) and C::canDecide(caseOf(b, id), by, checkedEpoch, version, decision)
pure def decide(b: Bounty, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): Bounty =
  putCase(id, C::decide(caseOf(b, id), by, checkedEpoch, version, decision), b)
pure def canDecideAward(b: Bounty, id: int, by: int, checkedEpoch: int, amount: M::Amount): bool = known(id) and not(hasHold(b, id))
  and C::canDecideAward(caseOf(b, id), by, checkedEpoch, amount, clearanceFor(b, id, amount))
pure def decideAward(b: Bounty, id: int, by: int, checkedEpoch: int, amount: M::Amount): Bounty =
  withHold(id, C::decideAward(caseOf(b, id), by, checkedEpoch, amount, clearanceFor(b, id, amount)), amount, b)
pure def canDeclineAward(b: Bounty, id: int, by: int, checkedEpoch: int): bool = known(id) and C::canDeclineAward(caseOf(b, id), by, checkedEpoch)
pure def declineAward(b: Bounty, id: int, by: int, checkedEpoch: int): Bounty =
  putCase(id, C::declineAward(caseOf(b, id), by, checkedEpoch), b)
pure def canReviewRelated(b: Bounty, id: int, by: int, checkedEpoch: int, approve: bool): bool = known(id)
  and C::canReviewRelated(caseOf(b, id), by, checkedEpoch, approve, clearanceFor(b, id, caseOf(b, id).grossChosen))
pure def reviewRelated(b: Bounty, id: int, by: int, checkedEpoch: int, approve: bool): Bounty =
  val gross = caseOf(b, id).grossChosen
  val after = C::reviewRelated(caseOf(b, id), by, checkedEpoch, approve, clearanceFor(b, id, gross))
  if (approve) withHold(id, after, gross, b) else { ...putCase(id, after, b), holds: b.holds.select(h => h.caseId != id) }
pure def canAppeal(b: Bounty, id: int, by: int): bool = known(id) and C::canAppeal(caseOf(b, id), by)
pure def appeal(b: Bounty, id: int, by: int): Bounty = putCase(id, C::appeal(caseOf(b, id), by), b)
pure def canDecideAppeal(b: Bounty, id: int, by: int, checkedEpoch: int, uphold: bool): bool = known(id)
  and C::canDecideAppeal(caseOf(b, id), by, checkedEpoch, uphold)
pure def decideAppeal(b: Bounty, id: int, by: int, checkedEpoch: int, uphold: bool): Bounty =
  putCase(id, C::decideAppeal(caseOf(b, id), by, checkedEpoch, uphold), b)
```

### One root cause holds at most one proposal or award obligation

Every hold belongs to a known case and records that case's root cause. A
case holds exactly when it has a committed award or a pending related-party
proposal. A vault hold records the snapshot that funded it. Restriction or a
ban blocks new holds and leaves existing ones unchanged.

```quint
pure def holdMatches(b: Bounty, h: Hold): bool = known(h.caseId) and h.rootCause > 0 and h.rootCause == caseOf(b, h.caseId).rootCause
  and (if (h.kind == ProposalHold) caseOf(b, h.caseId).relatedReview == C::ReviewPending
    else if (h.kind == VaultHold) caseOf(b, h.caseId).commitment == C::VaultReservation and h.fundsObservedAt > 0
    else if (h.kind == DirectHold) caseOf(b, h.caseId).commitment == C::DirectAward
    else caseOf(b, h.caseId).commitment == C::FullAwardHeld)
pure def alwaysHoldsMatchCases(b: Bounty): bool = b.holds.every(h => holdMatches(b, h))
  and caseIds.every(id => hasHold(b, id) == (C::committed(caseOf(b, id)) or caseOf(b, id).relatedReview == C::ReviewPending))
pure def alwaysCasesKeepAwardRules(b: Bounty): bool = caseIds.every(id => C::alwaysProposalCommitsNothing(caseOf(b, id))
  and C::alwaysCommitmentMatchesAward(caseOf(b, id)) and C::alwaysFullAwardHeld(caseOf(b, id)) and C::alwaysStandardAwardRail(caseOf(b, id))
  and C::alwaysUnpaidHasNoAward(caseOf(b, id)) and C::alwaysVerifiedReceiptValid(caseOf(b, id))
  and C::alwaysConfirmedHasRootCause(caseOf(b, id)) and C::alwaysAppealState(caseOf(b, id)))
pure def alwaysOneHoldPerRootCause(b: Bounty): bool =
  b.holds.every(h => b.holds.every(g => (g.rootCause == h.rootCause or g.caseId == h.caseId) implies g == h))
pure def alwaysFullAwardBindsNoVault(b: Bounty): bool = b.holds.every(h => h.kind == VaultHold or h.kind == DirectHold implies
  caseOf(b, h.caseId).terms.split == T::StandardSplit)
pure def stepHoldsNeedClearance(before: Bounty, after: Bounty): bool = after.holds.every(h => before.holds.includes(h)
  or (not(caseOf(before, h.caseId).authority.programRestricted) and rootCauseFree(before, h.caseId) and firstQualifying(before, h.caseId)))
pure def sometimesSecondReportBlocked(b: Bounty): bool = C::committed(caseOf(b, 1)) and caseOf(b, 2).receipt == C::Confirmed
  and caseOf(b, 2).rootCause == caseOf(b, 1).rootCause and caseOf(b, 2).award == C::Pending
pure def sometimesVaultHold(b: Bounty): bool = b.holds.some(h => h.kind == VaultHold)
pure def sometimesDirectHold(b: Bounty): bool = b.holds.some(h => h.kind == DirectHold)
pure def sometimesProposalHold(b: Bounty): bool = b.holds.some(h => h.kind == ProposalHold)
pure def sometimesFullAwardHold(b: Bounty): bool = b.holds.some(h => h.kind == FullAwardHold)
```

### Simulation samples cover both orders of receipt, stale funds and both routes

```quint
pure val idValues = Set(1, 2)
pure val receiptTerms: T::ReceiptTerms = { ...T::standardTerms, receivedAt: 5 }
pure val termsValues = Set(T::standardTerms, receiptTerms, T::fullTerms, T::historicalTerms)
pure val sourceValues = Set(C::SlopReceived)
pure val reportVersionValues = Set(1)
pure val versionValues = Set(1)
pure val snapshotValues = Set(C::staff)
pure val amountValues = Set(List(100), List(101), List(4))
pure val nowMsValues = Set(2, 1800003)
pure val fundsValues = Set({ finalized: true, observedAt: 2, asset: "usdc", free: List(500) },
  { finalized: false, observedAt: 2, asset: "usdc", free: List(500) }, { finalized: true, observedAt: 3, asset: "usdc", free: List(50) })
pure val routeValues = Set({ asset: "usdc", qualified: true, observedAt: 2 }, { asset: "usdc", qualified: false, observedAt: 3 })
pure val byValues = Set(1, 2, 4)
pure val checkedEpochValues = Set(1)
pure val weight_decide = 6
pure val weight_decideAward = 8
pure val weight_receive = 5
```
