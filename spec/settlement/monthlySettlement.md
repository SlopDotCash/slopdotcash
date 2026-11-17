# Monthly settlement across the allocation and the vault

PRD section 6 requires the frozen monthly allocation, its obligations and
the project's vault to describe the same awards, with no manual and automatic
duplicate. This machine composes one project's [monthly allocation](./monthly.md)
with its [escrow accounting](./escrow.md). Obligations are created against
the vault's own finalized free balance. A funded obligation becomes reserved
only through a finalized award for its source key, by the owner's manual
award or by a proven leaf of the attester-signed root. Source anchors are development
`backend/payments/README.md` steps 4 and 5, `backend/payments/monthly.ts`
(coordinator) and `contracts/evm/src/ProjectEscrow.sol`.

The vault side is the chain: the owner may commit any source by hand, and
anyone may pay a matured award, so the month learns of those awards by
observing the finalized escrow (the payments scanner), never by refusing
them. External shell obligations: the chain adapter reports the finalized
head time; the payment ledger accepts a payout as paid only for an
authorized destination ([payment investigation](./paymentInvestigation.md));
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
type MonthlySettlement = { month: MO::Monthly, escrow: E::Escrow, headTime: int }
pure val initial: MonthlySettlement = { month: { ...MO::initial, project: "eliza" }, escrow: E::initial, headTime: 0 }
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
pure def canObserveRevision(s: MonthlySettlement, revision: MO::RevisionFact): bool = MO::canObserveRevision(s.month, revision)
pure def observeRevision(s: MonthlySettlement, revision: MO::RevisionFact): MonthlySettlement =
  { ...s, month: MO::observeRevision(s.month, revision) }
pure def canObserveSettings(s: MonthlySettlement, automatic: bool, settingsSequence: int): bool =
  MO::canObserveSettings(s.month, automatic, settingsSequence)
pure def observeSettings(s: MonthlySettlement, automatic: bool, settingsSequence: int): MonthlySettlement =
  { ...s, month: MO::observeSettings(s.month, automatic, settingsSequence) }
pure def canAdjust(s: MonthlySettlement, actor: int, amount: M::Amount, expectedSequence: int, fact: MO::AuthorityFact): bool =
  MO::canAdjust(s.month, actor, amount, expectedSequence, fact)
pure def adjust(s: MonthlySettlement, actor: int, amount: M::Amount, expectedSequence: int, fact: MO::AuthorityFact): MonthlySettlement =
  { ...s, month: MO::adjust(s.month, actor, amount, expectedSequence, fact) }
pure def canFinalize(s: MonthlySettlement, expectedSequence: int, fact: MO::AuthorityFact): bool =
  MO::canFinalize(s.month, expectedSequence, fact)
pure def finalize(s: MonthlySettlement, expectedSequence: int, fact: MO::AuthorityFact): MonthlySettlement =
  { ...s, month: MO::finalize(s.month, expectedSequence, fact) }
pure def canPropose(s: MonthlySettlement, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: MO::RevisionFact): bool =
  MO::canPropose(s.month, snapshot, exclusions, revision)
pure def propose(s: MonthlySettlement, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: MO::RevisionFact): MonthlySettlement =
  { ...s, month: MO::propose(s.month, snapshot, exclusions, revision) }
pure def canAutoFreeze(s: MonthlySettlement): bool = MO::canAutoFreeze(s.month)
pure def autoFreeze(s: MonthlySettlement): MonthlySettlement = { ...s, month: MO::autoFreeze(s.month) }
pure def canDeposit(s: MonthlySettlement, deposit: E::Deposit, ev: E::ChainEvent): bool = E::canDeposit(s.escrow, deposit, ev)
pure def deposit(s: MonthlySettlement, deposit: E::Deposit, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::deposit(s.escrow, deposit, ev) }
pure def canSetMonthly(s: MonthlySettlement, cap: M::Amount, turnOn: bool, ev: E::ChainEvent, by: str): bool =
  E::canSetMonthly(s.escrow, cap, turnOn, ev, by)
pure def setMonthly(s: MonthlySettlement, cap: M::Amount, turnOn: bool, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::setMonthly(s.escrow, cap, turnOn, ev, by) }
```

### Obligations are created only when the vault's finalized free balance covers the month

The observation is this vault's own free balance as of the finalized head
the chain adapter last reported, stamped with that head's time, so a
projection whose head is more than 30 minutes behind the coordinator's clock
is stale and refused. Earlier periods' unreserved obligations of the same
vault are a typed input from the coordinator.

```quint
pure def canObserveHead(s: MonthlySettlement, time: int): bool = time > s.headTime and time >= s.escrow.clock
pure def observeHead(s: MonthlySettlement, time: int): MonthlySettlement = { ...s, headTime: time }
pure def observation(s: MonthlySettlement, earlierUnreserved: M::Amount): MO::VaultObservation =
  { observedAt: s.headTime, free: s.escrow.free, earlierUnreserved: earlierUnreserved }
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
reserve is pending, the contract refuses every manual award. On a Solana
vault the coordinator also refuses to prepare a hand reservation while
automatic payment is on (`monthly_automatic`): the month is admitted with its
whole total free, and a hand reservation would spend that balance and block
the month for every recipient.

```quint
pure def obligationOf(s: MonthlySettlement, actor: int): MO::Obligation = MO::obligationFor(s.month, actor)
pure def awardFact(s: MonthlySettlement, actor: int, paid: bool): MO::AwardFact =
  { source: MO::keyFor(s.month, actor), actor: actor, gross: obligationOf(s, actor).amount, paid: paid }
pure def canCommitObligation(s: MonthlySettlement, actor: int, ev: E::ChainEvent, by: str): bool =
  obligationOf(s, actor).actor > 0 and E::canCommitAward(s.escrow, sourceOf(s, actor), actor, obligationOf(s, actor).amount, ev, by)
    and MO::canRecordReserved(s.month, awardFact(s, actor, false))
    and not(s.escrow.asset.network == E::Solana and s.month.automatic)
pure def commitObligation(s: MonthlySettlement, actor: int, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::commitAward(s.escrow, sourceOf(s, actor), actor, obligationOf(s, actor).amount, ev, by),
    month: MO::recordReserved(s.month, awardFact(s, actor, false)) }
```

### The owner may also commit any source by hand on chain; the month observes it

The contract accepts an owner award for any source digest while no pool
gross is pending, including this month's key for an actor with another
gross. The coordinator cannot refuse a chain call: it observes the finalized
award. A matching award reserves the obligation; a different actor or gross
makes it conflicted (`award_conflict`). A finalized payment of a reserved
obligation's award marks it paid. Anyone may pay a matured award of this
month's key to the binding the contract selects.

```quint
pure def canCommitManualAward(s: MonthlySettlement, source: E::SourceKey, actor: int, gross: M::Amount, ev: E::ChainEvent, by: str): bool =
  E::canCommitAward(s.escrow, source, actor, gross, ev, by)
pure def commitManualAward(s: MonthlySettlement, source: E::SourceKey, actor: int, gross: M::Amount, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::commitAward(s.escrow, source, actor, gross, ev, by) }
pure def chainActor(s: MonthlySettlement, actor: int): int = E::awardFor(s.escrow, sourceOf(s, actor)).actor
pure def chainGross(s: MonthlySettlement, actor: int): M::Amount = E::awardFor(s.escrow, sourceOf(s, actor)).gross
pure def chainPaid(s: MonthlySettlement, actor: int): bool = E::awardFor(s.escrow, sourceOf(s, actor)).paid
pure def chainHolds(s: MonthlySettlement, actor: int): bool = not(E::sourceFree(s.escrow, sourceOf(s, actor)))
pure def chainMatches(s: MonthlySettlement, actor: int): bool = chainHolds(s, actor) and chainActor(s, actor) == actor
  and M::equalAmounts(chainGross(s, actor), obligationOf(s, actor).amount)
pure def observedFact(s: MonthlySettlement, actor: int): MO::AwardFact =
  { source: MO::keyFor(s.month, actor), actor: chainActor(s, actor), gross: chainGross(s, actor), paid: chainPaid(s, actor) }
pure def canObserveExistingAward(s: MonthlySettlement, actor: int): bool =
  chainMatches(s, actor) and MO::canRecordReserved(s.month, awardFact(s, actor, false))
pure def observeExistingAward(s: MonthlySettlement, actor: int): MonthlySettlement =
  { ...s, month: MO::recordReserved(s.month, awardFact(s, actor, false)) }
pure def canObserveConflict(s: MonthlySettlement, actor: int): bool =
  obligationOf(s, actor).actor > 0 and chainHolds(s, actor) and not(chainMatches(s, actor))
    and MO::canRecordConflict(s.month, observedFact(s, actor))
pure def observeConflict(s: MonthlySettlement, actor: int): MonthlySettlement =
  { ...s, month: MO::recordConflict(s.month, observedFact(s, actor)) }
pure def canPayAward(s: MonthlySettlement, actor: int, destination: str, version: int, ev: E::ChainEvent): bool =
  E::canPay(s.escrow, sourceOf(s, actor), { actor: actor, destination: destination, version: version }, ev)
pure def payAward(s: MonthlySettlement, actor: int, destination: str, version: int, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::pay(s.escrow, sourceOf(s, actor), { actor: actor, destination: destination, version: version }, ev) }
pure def canObservePaid(s: MonthlySettlement, actor: int): bool =
  chainMatches(s, actor) and chainPaid(s, actor) and MO::canRecordPaid(s.month, awardFact(s, actor, true))
pure def observePaid(s: MonthlySettlement, actor: int): MonthlySettlement =
  { ...s, month: MO::recordPaid(s.month, awardFact(s, actor, true)) }
```

### Anyone admits the attester-signed root of exactly the month's unreserved obligations

The signed whole gross is the month's funded payable total (every
obligation) and the signed remainder is the gross of obligations not yet
reserved. Every unreserved obligation's source must still be free on chain,
so an award committed by hand before admission is observed first and never
reserved a second time by the pool. A proven leaf reserves exactly one
obligation of this month.

```quint
pure def canAdmitRoot(s: MonthlySettlement, authorization: E::RootAuthorization, ev: E::ChainEvent): bool =
  s.month.phase == MO::Funded and authorization.period == s.month.period
    and M::equalAmounts(authorization.wholeGross, MO::obligationTotal(s.month))
    and MO::obligationActors(s.month).every(actor => obligationOf(s, actor).progress != MO::Created or not(chainHolds(s, actor)))
    and M::equalAmounts(authorization.remainingGross, MO::createdTotal(s.month))
    and authorization.leafCount == MO::createdCount(s.month)
    and E::canAdmitRoot(s.escrow, authorization, ev)
pure def admitRoot(s: MonthlySettlement, authorization: E::RootAuthorization, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::admitRoot(s.escrow, authorization, ev) }
pure def canMaterialize(s: MonthlySettlement, proof: E::LeafProof, ev: E::ChainEvent): bool =
  proof.period == s.month.period and proof.source == sourceOf(s, proof.actor)
    and M::equalAmounts(proof.gross, obligationOf(s, proof.actor).amount)
    and E::canMaterialize(s.escrow, proof, ev) and MO::canRecordReserved(s.month, awardFact(s, proof.actor, false))
pure def materialize(s: MonthlySettlement, proof: E::LeafProof, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::materialize(s.escrow, proof, ev), month: MO::recordReserved(s.month, awardFact(s, proof.actor, false)) }
```

### On EVM each monthly call examines at most 16 proven leaves from a cursor that passes a leaf only once it is finalized

Development `workers/payment-executor/core.ts` (`submitEvmMonthly`,
`maxLeaves = 16`) advances an admitted EVM month by one bounded call: it
examines at most 16 leaves of the signed tree, in tree order, starting at
the cursor journaled for that tree. Each leaf is its own transaction and its
own `materialize` event above. The cursor passes a leaf only once that
leaf's award is committed at a finalized block and the sender's own
journaled nonce for it has settled, so a lost or replaced call resumes at
the first leaf that is not yet finalized and never skips one. A sent
transaction is not evidence of a reservation. The Solana path
(`solana-monthly.ts`, `submitSolanaMonthly`) keeps no cursor: each call
scans the tree from its first leaf, skips leaves whose finalized settled
marker exists, and sends at most its `limit` transactions (one by default).
This machine does not order `materialize` events, since either family may
commit any proven leaf; the cursor is a library contract the EVM shell keeps.

```quint
pure val leavesPerCall = 16
pure def leafInCall(cursor: int, leafCount: int, index: int): bool =
  cursor >= 0 and index >= cursor and index < cursor + leavesPerCall and index < leafCount
pure def nextLeafCursor(cursor: int, index: int, finalizedCommitted: bool, nonceSettled: bool): int =
  if (index == cursor and finalizedCommitted and nonceSettled) cursor + 1 else cursor
pure def lawCallBounded(cursor: int, leafCount: int, index: int): bool =
  leafInCall(cursor, leafCount, index) implies index - cursor < leavesPerCall and index < leafCount
pure def lawCursorWaitsForFinality(cursor: int, index: int, finalizedCommitted: bool, nonceSettled: bool): bool =
  nextLeafCursor(cursor, index, finalizedCommitted, nonceSettled) >= cursor
    and nextLeafCursor(cursor, index, finalizedCommitted, nonceSettled) <= cursor + 1
    and (not(finalizedCommitted and nonceSettled) implies nextLeafCursor(cursor, index, finalizedCommitted, nonceSettled) == cursor)
```

### The vault keeps its other operations while the month is reserved

Withdrawals of free funds and reserve releases remain available. Whether a
payment's destination was authorized is decided by the payment ledger
([payment investigation](./paymentInvestigation.md)) and the binding version
by [binding authority](./bindingAuthority.md); wiring those is a composition
obligation.

```quint
pure def canWithdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): bool = E::canWithdraw(s.escrow, gross, ev, by)
pure def withdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::withdraw(s.escrow, gross, ev, by) }
pure def canReleaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): bool =
  E::canReleaseReserve(s.escrow, release, ev, by)
pure def releaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::releaseReserve(s.escrow, release, ev, by) }
```

## Story: The month and the vault always agree

### An obligation is reserved, paid or conflicted only as the vault's finalized award shows

A reserved obligation has exactly one vault award with its source key, actor
and gross; a paid obligation's award is paid; a conflicted obligation's key
holds an award with another actor or gross. Each source key holds at most
one award, so a hand award and a pool leaf can never both reserve one
obligation. The pool reserve of the month never exceeds the gross of its
still-unreserved obligations, so no obligation is reserved twice by the pool
and by hand.

```quint
pure def obligationMatches(s: MonthlySettlement, actor: int): bool =
  (obligationOf(s, actor).progress == MO::Reserved implies chainMatches(s, actor))
    and (obligationOf(s, actor).progress == MO::Paid implies chainMatches(s, actor) and chainPaid(s, actor))
    and (obligationOf(s, actor).progress == MO::Conflicted implies chainHolds(s, actor) and not(chainMatches(s, actor)))
pure def alwaysObligationsMatchVault(s: MonthlySettlement): bool = MO::obligationActors(s.month).every(actor => obligationMatches(s, actor))
pure def alwaysOneAwardPerObligation(s: MonthlySettlement): bool = MO::obligationActors(s.month).every(actor =>
  E::awardActorsFor(s.escrow, s.month.project, s.month.period).select(a => a == actor).length() <= 1)
pure def alwaysPoolWithinUnreserved(s: MonthlySettlement): bool =
  M::compareAmounts(E::monthFor(s.escrow, s.month.period).remaining, MO::createdTotal(s.month)) <= 0
pure def alwaysChildRules(s: MonthlySettlement): bool =
  MO::alwaysAllocationConserved(s.month) and MO::alwaysObligationsMatchShares(s.month) and MO::alwaysCompletedPaid(s.month)
    and E::alwaysGrossConserved(s.escrow) and E::alwaysAwards(s.escrow)
pure def sometimesManualObligation(s: MonthlySettlement): bool = E::hasAwardOf(s.escrow, E::ManualAward)
pure def sometimesLeafObligation(s: MonthlySettlement): bool = E::hasAwardOf(s.escrow, E::MonthlyLeaf)
pure def sometimesMonthReserved(s: MonthlySettlement): bool = s.month.obligations.length() >= 2
  and MO::allReserved(s.month)
pure def sometimesPoolBlocksManual(s: MonthlySettlement): bool =
  M::positiveAmount(s.escrow.pending) and MO::createdCount(s.month) > 0
pure def sometimesUnderfundedThenDeposit(s: MonthlySettlement): bool = s.month.underfundedNotice and s.month.phase == MO::Funded
pure def sometimesConflicted(s: MonthlySettlement): bool = s.month.obligations.some(o => o.progress == MO::Conflicted)
pure def sometimesObligationPaid(s: MonthlySettlement): bool = s.month.obligations.some(o => o.progress == MO::Paid)
pure def sometimesManualAwardOutsideMonth(s: MonthlySettlement): bool =
  E::awardActorsFor(s.escrow, s.month.project, s.month.period).some(a => not(MO::obligationActors(s.month).includes(a)))
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
pure val timeValues = Set(1796083300, 1796342400, 1796342600, 1796343100)
pure val revisionValues = Set(MO::revisionSample)
pure val automaticValues = Set(false)
pure val settingsSequenceValues = Set(1)
pure val amountValues = Set(List(2))
pure val expectedSequenceValues = Set(0, 1)
pure val factValues = Set({ actor: 9, role: MO::ProjectOwner, banned: false, revision: 1 })
pure val eligibilityValues = Set(MO::eligible)
pure val snapshotValues = Set(MO::snapshotSample)
pure val earlierUnreservedValues = Set(List(0))
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
pure val sourceValues = Set(monthKey(1)).union(Set(monthKey(4)))
pure val rootSample: E::RootAuthorization = { period: 202611, vault: "vault", network: E::Base, allocationDigest: "a", root: "r",
  wholeGross: List(10), remainingGross: List(10), leafCount: 3, sourceSequence: 0, frozenAt: 0, signer: "attester" }
pure val authorizationValues = Set(rootSample, { ...rootSample, root: "q", remainingGross: List(8), leafCount: 2, sourceSequence: 1 })
pure val leafBase: E::LeafProof = { period: 202611, index: 0, root: "r", rootTotal: List(10), source: monthKey(1), actor: 1, gross: List(2) }
pure val proofValues = Set(leafBase).union(Set({ ...leafBase, index: 1, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, index: 2, source: monthKey(3), actor: 3, gross: List(2) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 0, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 1, source: monthKey(3), actor: 3, gross: List(2) }))
pure val grossValues = Set(List(1), List(2))
pure val destinationValues = Set("w1")
pure val versionValues = Set(1)
pure val releaseValues = Set({ period: 202611, expectedRemaining: List(10), releasedGross: List(10), signer: "attester" },
  { period: 202611, expectedRemaining: List(8), releasedGross: List(8), signer: "attester" })
pure val weight_materialize = 12
pure val weight_deposit = 4
pure val weight_propose = 12
pure val weight_autoFreeze = 12
pure val weight_createObligations = 12
pure val weight_commitObligation = 12
pure val weight_admitRoot = 12
pure val weight_observeClock = 4
pure val weight_withdraw = 1
pure val weight_releaseReserve = 1
pure val weight_observeHead = 6
pure val weight_observeRevision = 6
pure val weight_commitManualAward = 2
pure val weight_observeConflict = 4
pure val weight_observeExistingAward = 4
pure val weight_payAward = 4
pure val weight_observePaid = 4
pure val weight_adjust = 1
pure val weight_finalize = 1
pure val weight_observeSettings = 1
pure val weight_setMonthly = 1
```
