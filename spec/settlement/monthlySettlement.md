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
import reserveRelease as RR from "./reserveRelease"
type LeafCursor = { period: int, root: str, leafCount: int, position: int, passed: List[int] }
type MonthlySettlement = { month: MO::Monthly, escrow: E::Escrow, headTime: int, cursor: LeafCursor }
pure val noCursor: LeafCursor = { period: 0, root: "", leafCount: 0, position: 0, passed: List() }
pure val initial: MonthlySettlement = { month: { ...MO::initial, project: "eliza" }, escrow: E::initial, headTime: 0, cursor: noCursor }
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
pure def canDeposit(s: MonthlySettlement, funds: E::Deposit, ev: E::ChainEvent): bool = E::canDeposit(s.escrow, funds, ev)
pure def deposit(s: MonthlySettlement, funds: E::Deposit, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::deposit(s.escrow, funds, ev) }
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
vault are a typed input from the coordinator. Every other month's open
pledge in the same vault is held back from the free balance, because the
contract never lets one month take another month's pledge: the coordinator
computes it from the stored pledges with [month pledges](./monthPledges.md)
`otherOpenPledges` (zero for a vault without pledge support) and passes it
as a typed input, to the obligations and to the underfunded notice alike
(development `backend/payments/monthly.ts`, `heldBack`).

Whatever the coordinator passes for earlier unreserved obligations and other
months' pledges, both are never negative, so the vault's finalized free
balance at a head at most 30 minutes old covers at least every obligation it
creates; an underfunded notice is recorded only on such a fresh head.

```quint
pure def canObserveHead(s: MonthlySettlement, time: int): bool = time > s.headTime and time >= s.escrow.clock
pure def observeHead(s: MonthlySettlement, time: int): MonthlySettlement = { ...s, headTime: time }
pure def observation(s: MonthlySettlement, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount): MO::VaultObservation =
  { observedAt: s.headTime, free: s.escrow.free, earlierUnreserved: earlierUnreserved, otherOpenPledges: otherOpenPledges }
pure def canCreateObligations(s: MonthlySettlement, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount, bans: List[MO::BanExclusion]): bool =
  s.escrow.deployed and s.escrow.purpose == E::OrdinaryPurpose
    and MO::canCreateObligations(s.month, observation(s, earlierUnreserved, otherOpenPledges), bans)
pure def createObligations(s: MonthlySettlement, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount, bans: List[MO::BanExclusion]): MonthlySettlement =
  { ...s, month: MO::createObligations(s.month, observation(s, earlierUnreserved, otherOpenPledges), bans) }
pure def canNoteUnderfunded(s: MonthlySettlement, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount, bans: List[MO::BanExclusion]): bool =
  s.escrow.deployed and MO::canNoteUnderfunded(s.month, observation(s, earlierUnreserved, otherOpenPledges), bans)
pure def noteUnderfunded(s: MonthlySettlement, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount, bans: List[MO::BanExclusion]): MonthlySettlement =
  { ...s, month: MO::noteUnderfunded(s.month, observation(s, earlierUnreserved, otherOpenPledges), bans) }
pure def headFresh(s: MonthlySettlement): bool = s.headTime <= s.month.now and s.month.now - s.headTime <= MO::freshnessSeconds
pure def stepObligationsOnFreshCoveringHead(before: MonthlySettlement, via: str, after: MonthlySettlement): bool =
  via == "createObligations" implies headFresh(before) and M::compareAmounts(before.escrow.free, MO::obligationTotal(after.month)) >= 0
pure def stepUnderfundedOnFreshHead(before: MonthlySettlement, via: str, after: MonthlySettlement): bool =
  via == "noteUnderfunded" implies headFresh(before) and after.month.underfundedNotice
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
journaled nonce for it has settled: the signer's nonce at the finalized
block has passed it, since a nonce mined at the latest block can disappear
in a reorganization. While the signer's latest nonce has not passed its own
journaled step, the executor sends the same bytes again; once it has, it
only waits. Until every such nonce of the month, root keys included, is
finalized, the call reports the month incomplete, also when other senders
already committed every leaf (development
`workers/payment-executor/core.ts` `sendJournaledUntilFinalized`, and its
README). So a lost or replaced call resumes at
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

### The executor's cursor passes a leaf only on a matching finalized award, or once the reserve is exhausted

The cursor is journaled per period and admitted tree root (development
`workers/payment-executor/core.ts` `submitReserve`, cursor key
`<month key>:<root>:finalized-cursor`; vibestack keeper
`apps/settlement/src/keeper/monthly.vibe`). It starts at 0, stays within
the tree's leaf count and moves by exactly one leaf. While the admitted
month still has a remainder, the executor reads the award under the leaf's
source: a finalized award with the leaf's actor, gross and fee lets the
cursor pass that leaf once the sender's journaled nonce for it is finalized;
a missing award is sent as a leaf transaction and the cursor waits; any other
award halts the call with "Admitted monthly source conflicts with a funded
award", and the cursor does not move. When the admitted month's remainder is
zero, because every leaf was committed or the whole reserve was released, the
executor passes each remaining leaf on its journaled nonce alone, so a wholly
released month passes every leaf without an award. Each leaf the cursor
passes on an award keeps that award: sources are consumed for ever, so the
cursor is backed by finalized chain state, never by a sent transaction. The
cursor record keeps the tree root and leaf count it was keyed to and the
actors of the leaves it passed on an award; every leaf of this month's tree
carries this month's source key of its actor.

A conflict can never reach the cursor in this composition: while pool gross
is pending the contract refuses every manual award, and the root is admitted
only while every unreserved obligation's source is free, so no source of an
unreserved obligation is consumed while the reserve is pending. The halt is
the executor's defence if that ever fails; it is stated as a law.

```quint
pure def admittedMonth(s: MonthlySettlement): E::MonthReserve = E::monthFor(s.escrow, s.month.period)
pure def leafMatches(s: MonthlySettlement, proof: E::LeafProof): bool =
  val award = E::awardFor(s.escrow, proof.source)
  not(E::sourceFree(s.escrow, proof.source)) and award.actor == proof.actor and M::equalAmounts(award.gross, proof.gross)
    and award.fee == E::feeFor(s.escrow.purpose, proof.gross)
pure def leafConflicts(s: MonthlySettlement, proof: E::LeafProof): bool =
  not(E::sourceFree(s.escrow, proof.source)) and not(leafMatches(s, proof))
pure def cursorAt(s: MonthlySettlement, proof: E::LeafProof): bool =
  val month = admittedMonth(s)
  month.period > 0 and proof.period == month.period and proof.root == month.root
    and M::equalAmounts(proof.rootTotal, month.admittedGross)
    and (s.cursor.root == "" or (s.cursor.root == month.root and s.cursor.period == month.period))
    and proof.index == s.cursor.position and proof.index >= 0 and proof.index < month.leafCount
    and proof.source == sourceOf(s, proof.actor)
pure def passedCursor(s: MonthlySettlement, proof: E::LeafProof, onAward: bool): LeafCursor =
  val month = admittedMonth(s)
  { period: month.period, root: month.root, leafCount: month.leafCount, position: proof.index + 1,
    passed: if (onAward) s.cursor.passed.append(proof.actor) else s.cursor.passed }
pure def canAdvanceCursor(s: MonthlySettlement, proof: E::LeafProof, nonceSettled: bool): bool =
  cursorAt(s, proof) and M::positiveAmount(admittedMonth(s).remaining) and leafMatches(s, proof) and nonceSettled
pure def advanceCursor(s: MonthlySettlement, proof: E::LeafProof, nonceSettled: bool): MonthlySettlement =
  { ...s, cursor: passedCursor(s, proof, true) }
pure def canAdvanceZeroRemaining(s: MonthlySettlement, proof: E::LeafProof, nonceSettled: bool): bool =
  cursorAt(s, proof) and not(M::positiveAmount(admittedMonth(s).remaining)) and nonceSettled
pure def advanceZeroRemaining(s: MonthlySettlement, proof: E::LeafProof, nonceSettled: bool): MonthlySettlement =
  { ...s, cursor: passedCursor(s, proof, false) }
pure def lawConflictHaltsCursor(s: MonthlySettlement, proof: E::LeafProof, nonceSettled: bool): bool =
  (leafConflicts(s, proof) and M::positiveAmount(admittedMonth(s).remaining)) implies
    not(canAdvanceCursor(s, proof, nonceSettled)) and not(canAdvanceZeroRemaining(s, proof, nonceSettled))
pure def lawCursorWaitsForNonce(s: MonthlySettlement, proof: E::LeafProof): bool =
  not(canAdvanceCursor(s, proof, false)) and not(canAdvanceZeroRemaining(s, proof, false))
```

### The vault keeps its other operations while the month is reserved

Withdrawals of free funds and reserve releases remain available. Whether a
payment's destination was authorized is decided by the payment ledger
([payment investigation](./paymentInvestigation.md)) and the binding version
by [binding authority](./bindingAuthority.md); wiring those is a composition
obligation.
A vault deployed before the reviewed release-capable implementation gains
reserve release only through its finalized upgrade event, which this
composition passes through from the [escrow](./escrow.md).

```quint
pure def canWithdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): bool = E::canWithdraw(s.escrow, gross, ev, by)
pure def withdraw(s: MonthlySettlement, gross: M::Amount, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::withdraw(s.escrow, gross, ev, by) }
pure def canUpgradeToRelease(s: MonthlySettlement, ev: E::ChainEvent): bool = E::canUpgradeToRelease(s.escrow, ev)
pure def upgradeToRelease(s: MonthlySettlement, ev: E::ChainEvent): MonthlySettlement =
  { ...s, escrow: E::upgradeToRelease(s.escrow, ev) }
pure def canReleaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): bool =
  E::canReleaseReserve(s.escrow, release, ev, by)
pure def releaseReserve(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): MonthlySettlement =
  { ...s, escrow: E::releaseReserve(s.escrow, release, ev, by) }
```

### An approved service release is exactly the release the vault accepts

The [reserve release](./reserveRelease.md) record approves the whole
untouched remainder of one admitted root. The owner submits the release
transaction (signer `ReleaseSubmission`, [signer](./signer.md)); the
current identity authority signs it. When the record's root and reserve are
the vault's admitted month, its whole remainder and its untouched admitted
gross, the vault running the release-capable implementation accepts exactly
that authorization from the owner, and the finalized release that the record
accepts moves exactly that gross from the pool reserve to free funds. Only the
owner submits a release, under the current authority's signature.

```quint
pure def releaseFor(s: MonthlySettlement, approval: RR::ReserveRelease): E::ReleaseAuthorization =
  { period: s.month.period, expectedRemaining: approval.reserved, releasedGross: approval.reserved, signer: s.escrow.authority }
pure def lawApprovedReleaseAccepted(s: MonthlySettlement, approval: RR::ReserveRelease, ev: E::ChainEvent): bool =
  val month = admittedMonth(s)
  ((approval.phase == RR::Approved or approval.phase == RR::OwnerSigned) and month.period > 0 and month.root == approval.root
    and M::validAmount(approval.reserved) and M::positiveAmount(approval.reserved)
    and M::equalAmounts(approval.reserved, month.remaining) and M::equalAmounts(month.remaining, month.admittedGross)
    and not(M::positiveAmount(month.released))
    and M::compareAmounts(s.escrow.pending, approval.reserved) >= 0 and M::compareAmounts(s.escrow.committed, approval.reserved) >= 0
    and E::later(s.escrow, ev) and s.escrow.implementation == E::ReleaseCapable)
    implies canReleaseReserve(s, releaseFor(s, approval), ev, s.escrow.owner)
pure def lawFinalizedReleaseMatchesEscrow(s: MonthlySettlement, approval: RR::ReserveRelease, receipt: RR::ReleaseReceipt, ev: E::ChainEvent): bool =
  val release = releaseFor(s, approval)
  val after = releaseReserve(s, release, ev, s.escrow.owner)
  (canReleaseReserve(s, release, ev, s.escrow.owner) and RR::canFinalize(approval, receipt) and receipt.root == admittedMonth(s).root)
    implies M::equalAmounts(receipt.releasedAmount, approval.reserved) and M::equalAmounts(approval.reserved, admittedMonth(s).remaining)
      and after.escrow.free == M::addAmounts(s.escrow.free, approval.reserved)
      and after.escrow.pending == M::subtractAmounts(s.escrow.pending, approval.reserved)
pure def lawOnlyOwnerSubmitsRelease(s: MonthlySettlement, release: E::ReleaseAuthorization, ev: E::ChainEvent, by: str): bool =
  canReleaseReserve(s, release, ev, by) implies by == s.escrow.owner and release.signer == s.escrow.authority
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

The vault holds a monthly reserve only for this month, and only once its
obligations are funded. While pool gross is pending, no unreserved
obligation's source is consumed on chain, so every leaf of the admitted root
is still free when it is committed and no leaf can meet a conflicting award.
Each monthly leaf award is this month's source key of one of its
obligations. The executor's cursor stays within its tree, is keyed to the
admitted root, moves by at most one leaf, and every leaf it passed on an award
keeps that award; it passes a leaf without an award only once the admitted
remainder is zero. A wholly released month never holds a monthly leaf award.
While any of the admitted root is unreserved, its remainder is exactly the
gross of the month's unreserved obligations, whose sources are all still
free: the root's leaves are this month's source keys of those obligations,
one per actor, so no leaf source was consumed before the root and no leaf
can be stranded. Every monthly leaf award of this month reserved its own
obligation with the obligation's gross, which is reserved or paid.

Discovered by the proof: the deposit transition's parameter had the name of
the transition itself, so the generated proof could not refer to the
transition; the parameter is now `funds`.

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
pure def alwaysAdmittedOnlyWhenFunded(s: MonthlySettlement): bool =
  s.escrow.months.length() > 0 implies (s.month.phase == MO::Funded or s.month.phase == MO::Completed)
    and s.escrow.months.every(m => m.period == s.month.period)
pure def alwaysPoolOnlyWhenAdmitted(s: MonthlySettlement): bool =
  M::positiveAmount(s.escrow.pending) implies s.escrow.months.length() > 0
pure def alwaysUnreservedSourcesFreeWhilePooled(s: MonthlySettlement): bool =
  M::positiveAmount(s.escrow.pending) implies
    MO::obligationActors(s.month).every(actor => obligationOf(s, actor).progress != MO::Created or not(chainHolds(s, actor)))
pure def alwaysLeafAwardsAreObligations(s: MonthlySettlement): bool =
  E::awardActorsFor(s.escrow, s.month.project, s.month.period).every(actor =>
    E::awardFor(s.escrow, sourceOf(s, actor)).origin == E::MonthlyLeaf implies
      MO::obligationActors(s.month).includes(actor) and chainActor(s, actor) == actor)
pure def alwaysCursorInRange(s: MonthlySettlement): bool =
  0 <= s.cursor.position and s.cursor.position <= s.cursor.leafCount and s.cursor.passed.length() <= s.cursor.position
    and (s.cursor.root == "" implies s.cursor.position == 0 and s.cursor.passed.length() == 0)
    and (s.cursor.root != "" implies s.cursor.period == s.month.period and s.cursor.root == admittedMonth(s).root
      and s.cursor.leafCount == admittedMonth(s).leafCount)
pure def alwaysCursorSourceBacked(s: MonthlySettlement): bool =
  s.cursor.passed.every(actor => chainHolds(s, actor))
    and (s.cursor.position > s.cursor.passed.length() implies not(M::positiveAmount(admittedMonth(s).remaining)))
pure def alwaysReleasedMonthHasNoLeafAward(s: MonthlySettlement): bool =
  M::positiveAmount(admittedMonth(s).released) implies not(E::hasAwardOf(s.escrow, E::MonthlyLeaf))
pure def stepCursorMonotoneByOne(before: MonthlySettlement, after: MonthlySettlement): bool =
  after.cursor.position == before.cursor.position or after.cursor.position == before.cursor.position + 1
pure def stepRootAdmitsOnlyFreeSources(before: MonthlySettlement, via: str, after: MonthlySettlement): bool =
  via == "admitRoot" implies MO::obligationActors(before.month).every(actor =>
    obligationOf(before, actor).progress != MO::Created or not(chainHolds(before, actor)))
pure def leafAwardReserves(s: MonthlySettlement, actor: int): bool =
  E::awardFor(s.escrow, sourceOf(s, actor)).origin == E::MonthlyLeaf implies
    (obligationOf(s, actor).progress == MO::Reserved or obligationOf(s, actor).progress == MO::Paid)
      and M::equalAmounts(chainGross(s, actor), obligationOf(s, actor).amount)
pure def alwaysLeafAwardsReserveTheirObligation(s: MonthlySettlement): bool =
  E::awardActorsFor(s.escrow, s.month.project, s.month.period).every(actor => leafAwardReserves(s, actor))
pure def alwaysPendingPoolIsExactlyUnreserved(s: MonthlySettlement): bool =
  M::positiveAmount(admittedMonth(s).remaining) implies M::equalAmounts(admittedMonth(s).remaining, MO::createdTotal(s.month))
pure def sometimesCursorPassedLeaf(s: MonthlySettlement): bool = s.cursor.passed.length() > 0
pure def sometimesReleasedMonthPassed(s: MonthlySettlement): bool =
  s.cursor.position > 0 and s.cursor.passed.length() == 0 and M::positiveAmount(admittedMonth(s).released)
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

Discovered by simulation: the coordinator's clock samples ended at 1796342500,
before the later chain-head samples. A reported head never moves back, so once
the adapter reported a later head, no clock sample could see the vault
observation as fresh, and neither the obligations nor the underfunded notice
could be created; one admitted month was found only after thousands of
traces. The clock now also reads 1796343100, the last sampled head, as the
coordinator does when it runs after the chain has advanced, and two more
times inside the proposal window, since the clock never goes back. The
1796083300 head still exercises the stale refusal.

Discovered by simulation: two deposits, the root admission, its leaves, a
release and payments all need later finalized events, and eight sampled
blocks ran out before the root. The sampled finalized events are now 64
blocks 10 seconds apart, inside the admission window and no later than the
last head sample, and a single deposit of 12 base units covers the month.

Discovered by simulation: half the months ban actor 2, and no signed root
fitted their remaining obligations of 4; root "b" with its two leaves and its
release now covers that month.

Discovered by simulation: the month observes an existing award only after
the owner commits, by hand, this month's key for the obligation's own actor
and gross, which is one hand award in twelve, and the coordinator's own
reservation and the pool root usually closed that obligation first. Hand
awards are drawn more often, the coordinator's reservation less often, and
the root, its leaves, the release and the cursor more often, so each of them
is reached.

Discovered by simulation: the composition did not pass the vault's finalized
upgrade to the release-capable implementation through, so the release was
never reachable; the upgrade is now an event of this machine as every other
escrow event is.

```quint
pure val assetValues = Set(E::baseAsset)
pure val mintValues = Set(E::cleanMint)
pure val purposeValues = Set(E::OrdinaryPurpose)
pure val delayValues = Set(0)
pure val capValues = Set(List(10))
pure val turnOnValues = Set(true)
pure val periodValues = Set(202611)
pure val nowValues = Set(1796083300, 1796169600, 1796256100, 1796342400, 1796342500, 1796343100)
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
pure val otherOpenPledgesValues = Set(List(0), List(3))
pure val fundsValues = Set({ vault: "vault", network: E::Base, token: "usdc", amount: List(4) },
  { vault: "vault", network: E::Base, token: "usdc", amount: List(8) },
  { vault: "vault", network: E::Base, token: "usdc", amount: List(12) })
pure def blockEvent(b: int): E::ChainEvent = { block: b, index: 0, time: 1796342390 + 10 * b, transaction: "t" }
pure val evValues = 1.to(64).map(b => blockEvent(b))
pure val actorValues = Set(1, 2, 3)
pure val byValues = Set("owner")
pure def monthKey(actor: int): E::SourceKey = { origin: "eliza", period: 202611, actor: actor }
pure val sourceValues = Set(monthKey(1)).union(Set(monthKey(4)))
pure val rootSample: E::RootAuthorization = { period: 202611, vault: "vault", network: E::Base, allocationDigest: "a", root: "r",
  wholeGross: List(10), remainingGross: List(10), leafCount: 3, sourceSequence: 0, frozenAt: 0, signer: "attester" }
pure val authorizationValues = Set(rootSample, { ...rootSample, root: "q", remainingGross: List(8), leafCount: 2, sourceSequence: 1 },
  { ...rootSample, root: "b", wholeGross: List(4), remainingGross: List(4), leafCount: 2 })
pure val leafBase: E::LeafProof = { period: 202611, index: 0, root: "r", rootTotal: List(10), source: monthKey(1), actor: 1, gross: List(2) }
pure val proofValues = Set(leafBase).union(Set({ ...leafBase, index: 1, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, index: 2, source: monthKey(3), actor: 3, gross: List(2) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 0, source: monthKey(2), actor: 2, gross: List(6) }))
  .union(Set({ ...leafBase, root: "q", rootTotal: List(8), index: 1, source: monthKey(3), actor: 3, gross: List(2) }))
  .union(Set({ ...leafBase, root: "b", rootTotal: List(4) }))
  .union(Set({ ...leafBase, root: "b", rootTotal: List(4), index: 1, source: monthKey(3), actor: 3, gross: List(2) }))
pure val grossValues = Set(List(1), List(2))
pure val destinationValues = Set("w1")
pure val versionValues = Set(1)
pure val releaseValues = Set({ period: 202611, expectedRemaining: List(10), releasedGross: List(10), signer: "attester" },
  { period: 202611, expectedRemaining: List(8), releasedGross: List(8), signer: "attester" },
  { period: 202611, expectedRemaining: List(4), releasedGross: List(4), signer: "attester" })
pure val nonceSettledValues = Set(true, false)
pure val sampleFrozen: MonthlySettlement = autoFreeze(observeClock(propose(observeClock(observeRevision(observeEligibility(
  openMonth(deploy(initial, E::baseAsset, E::cleanMint, E::OrdinaryPurpose, 0, List(10), true), 202611), MO::eligible),
  MO::revisionSample), 1796083300), MO::snapshotSample, List(), MO::revisionSample), 1796342400))
pure val sampleFunded: MonthlySettlement = createObligations(observeClock(observeHead(deposit(sampleFrozen,
  { vault: "vault", network: E::Base, token: "usdc", amount: List(12) }, blockEvent(1)), 1796342440), 1796343100), List(0), List(0), List())
pure val sampleAdmitted: MonthlySettlement = admitRoot(sampleFunded, rootSample, blockEvent(2))
pure val sampleUpgraded: MonthlySettlement = upgradeToRelease(sampleAdmitted, blockEvent(3))
pure val sValues = Set(initial, sampleFrozen, sampleFunded, sampleAdmitted, materialize(sampleAdmitted, leafBase, blockEvent(3)),
  sampleUpgraded, releaseReserve(sampleUpgraded, { period: 202611, expectedRemaining: List(10), releasedGross: List(10), signer: "attester" },
    blockEvent(4), "owner"))
pure val onAwardValues = Set(true, false)
pure val approvalSample: RR::ReserveRelease = { ...RR::initial, phase: RR::OwnerSigned, root: "r", allocationRoot: "r",
  originalReserve: List(10), reserved: List(10), allocationTotal: List(9), requestRevision: 1, evidenceHeight: 1, observedHeight: 1,
  signedAttempt: 1, upgradeQualified: true, pinRevision: 1, reviewedImplementation: "v2" }
pure val approvalValues: Set[RR::ReserveRelease] = Set(approvalSample, { ...approvalSample, phase: RR::Approved, signedAttempt: 0 },
  { ...approvalSample, root: "q", reserved: List(8), originalReserve: List(8) })
pure val receiptValues: Set[RR::ReleaseReceipt] = Set({ attempt: 1, root: "r", height: 2, releasedAmount: List(10), settledAmount: List(0), finalized: true, succeeded: true },
  { attempt: 1, root: "r", height: 2, releasedAmount: List(10), settledAmount: List(0), finalized: false, succeeded: true })
pure val weight_materialize = 24
pure val weight_deposit = 2
pure val weight_propose = 12
pure val weight_autoFreeze = 12
pure val weight_createObligations = 12
pure val weight_commitObligation = 6
pure val weight_admitRoot = 24
pure val weight_observeClock = 4
pure val weight_withdraw = 1
pure val weight_releaseReserve = 16
pure val weight_upgradeToRelease = 8
pure val weight_advanceCursor = 12
pure val weight_advanceZeroRemaining = 12
pure val weight_deploy = 6
pure val weight_openMonth = 6
pure val weight_observeEligibility = 2
pure val weight_observeHead = 6
pure val weight_observeRevision = 6
pure val weight_commitManualAward = 6
pure val weight_observeConflict = 4
pure val weight_observeExistingAward = 4
pure val weight_payAward = 4
pure val weight_observePaid = 4
pure val weight_adjust = 1
pure val weight_finalize = 1
pure val weight_observeSettings = 1
pure val weight_setMonthly = 1
```
