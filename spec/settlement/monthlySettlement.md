# Monthly settlement across the allocation and the vault

PRD section 6 requires the frozen monthly allocation, its obligations and
the project's vault to describe the same awards, with no manual and automatic
duplicate. This machine composes one project's [monthly allocation](./monthly.md)
with its [escrow accounting](./escrow.md). Obligations are created against
the vault's own finalized free balance. A funded obligation becomes reserved
only through a finalized award for its source key, by the owner's manual
award or by a proven leaf of the attester-signed root, and paid only through
the vault's payment of that award. Source anchors are development
`backend/payments/README.md` steps 4 and 5, `backend/payments/monthly.ts`
(coordinator) and `contracts/evm/src/ProjectEscrow.sol`.

External shell obligations: the payment ledger accepts a payout as paid
only for an authorized destination ([payment investigation](./paymentInvestigation.md));
the binding version comes from [binding authority](./bindingAuthority.md);
earlier periods' unreserved obligations of the same vault are supplied by
the coordinator's read of `monthly_payment_obligations`.

## Story: Fund, reserve and pay one month through its own vault

### The month and the vault start independently

```quint
import monthly as MO from "./monthly"
import escrow as E from "./escrow"
import money as M from "./money"
import allocation as A from "./allocation"
import payoutExclusions as X from "./payoutExclusions"
type MonthlySettlement = { month: MO::Monthly, escrow: E::Escrow }
pure val initial: MonthlySettlement = { month: { ...MO::initial, project: "eliza" }, escrow: E::initial }
pure def sourceOf(s: MonthlySettlement, actor: int): E::SourceKey = { origin: s.month.project, period: s.month.period, actor: actor }
pure def canDeploy(s: MonthlySettlement, asset: E::AssetIdentity, mint: E::MintFacts, purpose: E::VaultPurpose, delay: int, cap: M::Amount, turnOn: bool): bool =
  purpose == E::OrdinaryPurpose and E::canDeploy(s.escrow, asset, mint, purpose, delay, cap, turnOn)
pure def deploy(s: MonthlySettlement, asset: E::AssetIdentity, mint: E::MintFacts, purpose: E::VaultPurpose, delay: int, cap: M::Amount, turnOn: bool): MonthlySettlement =
  { ...s, escrow: E::deploy(s.escrow, asset, mint, purpose, delay, cap, turnOn) }
pure def canOpenMonth(s: MonthlySettlement, period: int): bool = MO::canOpenMonth(s.month, period)
pure def openMonth(s: MonthlySettlement, period: int): MonthlySettlement = { ...s, month: MO::openMonth(s.month, period) }
pure def canObserveClock(s: MonthlySettlement, now: int): bool = MO::canObserveClock(s.month, now)
pure def observeClock(s: MonthlySettlement, now: int): MonthlySettlement = { ...s, month: MO::observeClock(s.month, now) }
pure def canObserveEligibility(s: MonthlySettlement, eligibility: MO::Eligibility): bool = MO::canObserveEligibility(s.month, eligibility)
pure def observeEligibility(s: MonthlySettlement, eligibility: MO::Eligibility): MonthlySettlement =
  { ...s, month: MO::observeEligibility(s.month, eligibility) }
pure def canPropose(s: MonthlySettlement, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: MO::RevisionFact): bool =
  MO::canPropose(s.month, snapshot, exclusions, revision)
pure def propose(s: MonthlySettlement, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: MO::RevisionFact): MonthlySettlement =
  { ...s, month: MO::propose(s.month, snapshot, exclusions, revision) }
pure def canAutoFreeze(s: MonthlySettlement): bool = MO::canAutoFreeze(s.month)
pure def autoFreeze(s: MonthlySettlement): MonthlySettlement = { ...s, month: MO::autoFreeze(s.month) }
pure def canDeposit(s: MonthlySettlement, deposit: E::Deposit, ev: E::ChainEvent): bool = E::canDeposit(s.escrow, deposit, ev)
pure def deposit(s: MonthlySettlement, deposit: E::Deposit, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::deposit(s.escrow, deposit, ev) }
```

### Obligations are created only when the vault's finalized free balance covers the month

The observation is the vault's own free balance at the current finalized
event, so it cannot be stale or belong to another vault. Earlier periods'
unreserved obligations of the same vault are a typed input from the
coordinator.

```quint
pure def observation(s: MonthlySettlement, earlierUnreserved: M::Amount): MO::VaultObservation =
  { observedAt: s.month.now, free: s.escrow.free, earlierUnreserved: earlierUnreserved }
pure def canCreateObligations(s: MonthlySettlement, earlierUnreserved: M::Amount, bans: List[MO::BanExclusion]): bool =
  s.escrow.deployed and s.escrow.purpose == E::OrdinaryPurpose
    and MO::canCreateObligations(s.month, observation(s, earlierUnreserved), bans)
pure def createObligations(s: MonthlySettlement, earlierUnreserved: M::Amount, bans: List[MO::BanExclusion]): MonthlySettlement =
  { ...s, month: MO::createObligations(s.month, observation(s, earlierUnreserved), bans) }
pure def canNoteUnderfunded(s: MonthlySettlement, earlierUnreserved: M::Amount, bans: List[MO::BanExclusion]): bool =
  s.escrow.deployed and MO::canNoteUnderfunded(s.month, observation(s, earlierUnreserved), bans)
pure def noteUnderfunded(s: MonthlySettlement, earlierUnreserved: M::Amount, bans: List[MO::BanExclusion]): MonthlySettlement =
  { ...s, month: MO::noteUnderfunded(s.month, observation(s, earlierUnreserved), bans) }
```

### The owner may prepare one funded obligation by hand, and only while no pool gross is pending

A hand award uses the obligation's fixed source key and exact amount, so the
contract refuses any second award for that source. While a monthly pool
reserve is pending, the contract refuses every manual award.

```quint
pure def obligationOf(s: MonthlySettlement, actor: int): MO::Obligation = MO::obligationFor(s.month, actor)
pure def awardFact(s: MonthlySettlement, actor: int, paid: bool): MO::AwardFact =
  { source: MO::keyFor(s.month, actor), actor: actor, gross: obligationOf(s, actor).amount, paid: paid }
pure def canCommitObligation(s: MonthlySettlement, actor: int, ev: E::ChainEvent, by: str): bool =
  val o = obligationOf(s, actor)
  o.actor > 0 and E::canCommitAward(s.escrow, sourceOf(s, actor), actor, o.amount, ev, by)
    and MO::canRecordReserved(s.month, awardFact(s, actor, false))
pure def commitObligation(s: MonthlySettlement, actor: int, ev: E::ChainEvent, by: str): MonthlySettlement =
  { escrow: E::commitAward(s.escrow, sourceOf(s, actor), actor, obligationOf(s, actor).amount, ev, by),
    month: MO::recordReserved(s.month, awardFact(s, actor, false)) }
```

### Anyone admits the attester-signed root of exactly the month's unreserved obligations

The signed whole gross is the month's funded payable total and the signed
remainder is the gross of obligations not yet reserved. A proven leaf
reserves exactly one obligation of this month.

```quint
pure def createdTotal(s: MonthlySettlement): M::Amount =
  s.month.obligations.foldl(M::zero, (sum, o) => M::addAmounts(sum, if (o.progress == MO::Created) o.amount else M::zero))
pure def canAdmitRoot(s: MonthlySettlement, authorization: E::RootAuthorization, ev: E::ChainEvent): bool =
  s.month.phase == MO::Funded and authorization.period == s.month.period
    and M::equalAmounts(authorization.remainingGross, createdTotal(s))
    and authorization.leafCount == s.month.obligations.select(o => o.progress == MO::Created).length()
    and E::canAdmitRoot(s.escrow, authorization, ev)
pure def admitRoot(s: MonthlySettlement, authorization: E::RootAuthorization, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::admitRoot(s.escrow, authorization, ev) }
pure def canMaterialize(s: MonthlySettlement, proof: E::LeafProof, ev: E::ChainEvent): bool =
  proof.period == s.month.period and proof.source == sourceOf(s, proof.actor)
    and M::equalAmounts(proof.gross, obligationOf(s, proof.actor).amount)
    and E::canMaterialize(s.escrow, proof, ev) and MO::canRecordReserved(s.month, awardFact(s, proof.actor, false))
pure def materialize(s: MonthlySettlement, proof: E::LeafProof, ev: E::ChainEvent): MonthlySettlement =
  { escrow: E::materialize(s.escrow, proof, ev), month: MO::recordReserved(s.month, awardFact(s, proof.actor, false)) }
```

### Paying the award pays the obligation, and the vault keeps every other operation

```quint
pure def canPayObligation(s: MonthlySettlement, actor: int, binding: E::PayableBinding, ev: E::ChainEvent): bool =
  E::canPay(s.escrow, sourceOf(s, actor), binding, ev) and MO::canRecordPaid(s.month, awardFact(s, actor, true))
pure def payObligation(s: MonthlySettlement, actor: int, binding: E::PayableBinding, ev: E::ChainEvent): MonthlySettlement =
  { escrow: E::pay(s.escrow, sourceOf(s, actor), binding, ev), month: MO::recordPaid(s.month, awardFact(s, actor, true)) }
pure def canWithdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): bool = E::canWithdraw(s.escrow, gross, ev, by)
pure def withdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::withdraw(s.escrow, gross, ev, by) }
pure def canReleaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): bool =
  E::canReleaseReserve(s.escrow, release, ev, by)
pure def releaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::releaseReserve(s.escrow, release, ev, by) }
```

## Story: The month and the vault always agree

### An obligation is reserved or paid exactly when the vault holds that award

Each obligation past Created has exactly one vault award with its source key,
actor and gross, and a paid obligation's award is paid. No vault award for
this month's source keys exists without an obligation, so there is no manual
and automatic duplicate.

```quint
pure def alwaysObligationsMatchVault(s: MonthlySettlement): bool = s.month.obligations.every(o =>
  val award = E::awardFor(s.escrow, sourceOf(s, o.actor))
  (o.progress == MO::Created) == E::sourceFree(s.escrow, sourceOf(s, o.actor))
    and (o.progress != MO::Created implies award.actor == o.actor and M::equalAmounts(award.gross, o.amount))
    and ((o.progress == MO::Paid) == (award.paid and not(E::sourceFree(s.escrow, sourceOf(s, o.actor))))))
pure def alwaysNoAwardWithoutObligation(s: MonthlySettlement): bool = s.escrow.awards.every(a =>
  (a.source.origin == s.month.project and a.source.period == s.month.period and s.month.phase != MO::Unopened)
    implies s.month.obligations.some(o => o.actor == a.source.actor))
pure def alwaysChildRules(s: MonthlySettlement): bool =
  MO::alwaysAllocationConserved(s.month) and MO::alwaysObligationsMatchShares(s.month) and MO::alwaysCompletedPaid(s.month)
    and E::alwaysGrossConserved(s.escrow) and E::alwaysAwards(s.escrow)
pure def sometimesManualThenLeaf(s: MonthlySettlement): bool =
  s.escrow.awards.some(a => a.origin == E::ManualAward) and s.escrow.awards.some(a => a.origin == E::MonthlyLeaf)
pure def sometimesMonthPaid(s: MonthlySettlement): bool = s.month.phase == MO::Completed and s.month.obligations.length() >= 2
pure def sometimesPoolBlocksManual(s: MonthlySettlement): bool =
  M::positiveAmount(s.escrow.pending) and s.month.obligations.some(o => o.progress == MO::Created)
pure def sometimesUnderfundedThenDeposit(s: MonthlySettlement): bool = s.month.underfundedNotice and s.month.phase == MO::Funded
```

### Simulation samples

These input sets bound simulation only.

```quint
pure val assetValues = Set(E::baseAsset)
pure val mintValues = Set(E::cleanMint)
pure val purposeValues = Set(E::OrdinaryPurpose)
pure val delayValues = Set(0)
pure val capValues = Set(List(10))
pure val turnOnValues = Set(true)
pure val periodValues = Set(202611)
pure val nowValues = Set(1796083300, 1796342400, 1796342500)
pure val eligibilityValues = Set(MO::eligible)
pure val snapshotValues = Set(MO::snapshotSample)
pure val exclusionsValues = Set(List())
pure val revisionValues = Set(MO::revisionSample)
pure val earlierUnreservedValues = Set(List(0))
pure val bansValues = Set(List())
pure val depositValues = Set({ vault: "vault", network: E::Base, token: "usdc", amount: List(4) },
  { vault: "vault", network: E::Base, token: "usdc", amount: List(8) })
pure val evValues = Set(
  { block: 1, index: 0, time: 1796342400, transaction: "t1" }, { block: 2, index: 0, time: 1796342500, transaction: "t2" },
  { block: 3, index: 0, time: 1796342600, transaction: "t3" }, { block: 4, index: 0, time: 1796342700, transaction: "t4" },
  { block: 5, index: 0, time: 1796342800, transaction: "t5" }, { block: 6, index: 0, time: 1796342900, transaction: "t6" },
  { block: 7, index: 0, time: 1796343000, transaction: "t7" }, { block: 8, index: 0, time: 1796343100, transaction: "t8" })
pure val actorValues = Set(1, 2, 3)
pure val byValues = Set("owner")
pure def monthKey(actor: int): E::SourceKey = { origin: "eliza", period: 202611, actor: actor }
pure val rootSample: E::RootAuthorization = { period: 202611, vault: "vault", network: E::Base, allocationDigest: "a", root: "r",
  wholeGross: List(10), remainingGross: List(10), leafCount: 3, sourceSequence: 0, frozenAt: 0, signer: "attester" }
pure val authorizationValues = Set(rootSample, { ...rootSample, root: "q", remainingGross: List(8), leafCount: 2, sourceSequence: 1 })
pure val leafBase: E::LeafProof = { period: 202611, index: 0, root: "r", rootTotal: List(10), source: monthKey(1), actor: 1, gross: List(2) }
pure val proofValues = Set(leafBase).union(Set({ ...leafBase, index: 1, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, index: 2, source: monthKey(3), actor: 3, gross: List(2) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 0, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 1, source: monthKey(3), actor: 3, gross: List(2) }))
pure val bindingValues = Set({ actor: 1, destination: "w1", version: 1 }, { actor: 2, destination: "w2", version: 1 }, { actor: 3, destination: "w3", version: 1 })
pure val grossValues = Set(List(1))
pure val releaseValues = Set({ period: 202611, expectedRemaining: List(10), releasedGross: List(10), signer: "attester" },
  { period: 202611, expectedRemaining: List(8), releasedGross: List(8), signer: "attester" })
pure val weight_materialize = 8
pure val weight_payObligation = 8
pure val weight_deposit = 4
```
