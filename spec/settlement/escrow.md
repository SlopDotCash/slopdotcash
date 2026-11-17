# Project escrow contract accounting

PRD sections 2, 6 and 11 and the owner decisions in Slop AGENTS fix one
network, one asset and one purpose per vault. This unit is the finalized
projection of one deployed project escrow: every transition is one canonical
contract call whose event the chain adapter read at the finalized tag (EVM)
or finalized commitment (Solana), applied in block and event order. It owns
the contract counters that `vault_snapshots` reports: free balance, the
monthly pool reserve, reserved principal and fees, paid net, payout fees,
gross withdrawals, withdrawal fees and accrued fees.

Source anchors are development `contracts/evm/src/ProjectEscrow.sol`
(`deposit`, `commitAward`, `commitBountyAward`, `setMonthlyCommitment`,
`reserveMonthly`, `commitMonthlyLeaf`, `releaseMonthlyReserve`, `recordAward`,
`pay`, `withdrawUnused`, `claimFees`, `monthlyWindow`) and the Solana program
handlers `deposit`, `commit_award`, `commit_monthly`, `commit_monthly_award`,
`release_monthly_award`, `release_monthly_reserve`, `pay` and `withdraw`.
The unfinished `formal/drafts/monthly-reserve.md` was the starting point.
The legacy V1 `commitMonthly` path, which commits every leaf in one call, is
still callable on deployed EVM vaults; an independently signed V1
transaction can win after V2 publication, so this unit applies it. The
conservation laws cover vaults at the current account layout: a Solana
project migrated from the 316-byte layout starts its fee counters at zero
after fees were sent out at once, and legacy `expired` months settle
differently; that state is not modelled here. [Binding authority](./bindingAuthority.md)
owns destinations, owner cancellation and identity-authority rotation; a
payment here records the binding version the contract selected.
[Monthly commitment](./monthlyCommitment.md) owns the attester's signed
attempts. [Payment investigation](./paymentInvestigation.md) owns the ledger
decision for a payout to an unauthorized destination. External obligations
of the chain adapter: it verifies EIP-712 or ed25519 signatures and reports the
recovered signer, recomputes the Merkle-sum root of a leaf proof, decodes the
event and binds it to this vault, and never reports an event above the
finalized head.

## Story: Hold one asset under exact contract counters

### A vault starts empty with an immutable network, asset, purpose, owner and fee recipient

The asset identity is admitted once when the vault is created. Amounts are
integer base units. EVM counters are `uint128` and Solana counters are `u64`,
so every amount stays within its network's range. The identity authority is
the factory's current authority; rotation is owned by binding authority and
observed here as a finalized fact.

```quint
import money as M from "./money"
type Network = Base | Ethereum | RobinhoodChain | Solana
type VaultPurpose = OrdinaryPurpose | BountyPurpose
type AssetIdentity = { network: Network, token: str, decimals: int, native: bool, kind: M::AssetKind }
type MintFacts = { mintBytes: int, mintAuthority: bool, freezeAuthority: bool, pointerAuthority: bool, updateAuthority: bool,
  selfHosted: bool, mintExtensions: List[str], accountExtensions: List[str] }
type ChainEvent = { block: int, index: int, time: int, transaction: str }
type AwardOrigin = ManualAward | MonthlyLeaf
type SourceKey = { origin: str, period: int, actor: int }
type Award = { source: SourceKey, actor: int, gross: M::Amount, fee: M::Amount, origin: AwardOrigin,
  period: int, index: int, committedAt: int, paid: bool, destination: str, bindingVersion: int, paidIn: str }
type MonthReserve = { period: int, allocationDigest: str, root: str, wholeGross: M::Amount,
  admittedGross: M::Amount, remaining: M::Amount, released: M::Amount, leafCount: int, admittedAt: int, frozenAt: int }
type LeafPosition = { period: int, index: int }
type Withdrawal = { transaction: str, gross: M::Amount, fee: M::Amount, poolPending: bool }
type Implementation = PreRelease | ReleaseCapable
type Escrow = { deployed: bool, vault: str, asset: AssetIdentity, purpose: VaultPurpose, owner: str, feeRecipient: str,
  authority: str, bindingDelay: int, implementation: Implementation, at: ChainEvent, clock: int,
  monthlyEnabled: bool, monthlyCap: M::Amount, sourceSequence: int,
  deposited: M::Amount, held: M::Amount, committed: M::Amount, spent: M::Amount,
  free: M::Amount, pending: M::Amount, reserved: M::Amount,
  reservedPrincipal: M::Amount, reservedFees: M::Amount, paid: M::Amount, paidNet: M::Amount,
  payoutFees: M::Amount, grossWithdrawn: M::Amount, withdrawalFees: M::Amount,
  accruedFees: M::Amount, claimedFees: M::Amount,
  months: List[MonthReserve], awards: List[Award], releasedLeaves: List[LeafPosition], withdrawals: List[Withdrawal], depositsWhilePending: int }
pure val baseAsset: AssetIdentity = { network: Base, token: "usdc", decimals: 6, native: false, kind: M::Classic }
pure val origin: ChainEvent = { block: 0, index: 0, time: 1793491200, transaction: "" }
pure val initial: Escrow = { deployed: false, vault: "vault", asset: baseAsset, purpose: OrdinaryPurpose, owner: "owner",
  feeRecipient: "fees", authority: "attester", bindingDelay: 0, implementation: PreRelease, at: origin, clock: 1793491200,
  monthlyEnabled: false, monthlyCap: M::zero, sourceSequence: 0,
  deposited: M::zero, held: M::zero, committed: M::zero, spent: M::zero, free: M::zero, pending: M::zero, reserved: M::zero,
  reservedPrincipal: M::zero, reservedFees: M::zero, paid: M::zero, paidNet: M::zero,
  payoutFees: M::zero, grossWithdrawn: M::zero, withdrawalFees: M::zero,
  accruedFees: M::zero, claimedFees: M::zero,
  months: List(), awards: List(), releasedLeaves: List(), withdrawals: List(), depositsWhilePending: 0 }
pure def maxFor(network: Network): M::Amount = if (network == Solana) M::maxU64 else M::maxU128
pure def inRange(e: Escrow, amount: M::Amount): bool = M::withinMaximum(amount, maxFor(e.asset.network))
pure def positiveInRange(e: Escrow, amount: M::Amount): bool = inRange(e, amount) and M::positiveAmount(amount)
```

### The factory or program creates the vault once with its admitted identity

The asset is admitted once: a native coin, a classic token, or a Solana
Token-2022 mint with only the metadata extensions, disabled authorities and
immutable-owner token accounts (owner decision of 26 October 2026); the mint
facts come from the verified chain read at creation. Fee-on-transfer,
rebasing and transfer-hook behavior are refused by that subset.
Creation fixes the asset, purpose and binding delay and may turn monthly
commitments on with a positive cap. It also records whether the deployed
implementation is the reviewed release-capable one; a vault deployed before
it gains reserve release only through a finalized upgrade event. The contract accepts a binding delay
from zero through 30 days; the owner decision for Slop deployments is zero.
A bounty vault never takes monthly commitments. Before creation no event
applies.

```quint
pure val maxBindingDelay = 2592000
pure def validAsset(asset: AssetIdentity, mint: MintFacts): bool = asset.token != "" and asset.decimals >= 0 and asset.decimals <= 36
  and (asset.network != Solana or asset.decimals <= 9)
  and (asset.native == (asset.kind == M::Native))
  and (asset.kind != M::Token2022 or (asset.network == Solana and M::token2022Admissible(mint.mintBytes, mint.mintAuthority,
    mint.freezeAuthority, mint.pointerAuthority, mint.updateAuthority, mint.selfHosted, mint.mintExtensions, mint.accountExtensions)))
pure def canDeploy(e: Escrow, asset: AssetIdentity, mint: MintFacts, purpose: VaultPurpose, delay: int, cap: M::Amount, turnOn: bool): bool =
  not(e.deployed) and validAsset(asset, mint) and delay >= 0 and delay <= maxBindingDelay
    and M::withinMaximum(cap, maxFor(asset.network)) and (not(turnOn) or (purpose == OrdinaryPurpose and M::positiveAmount(cap)))
pure def deploy(e: Escrow, asset: AssetIdentity, mint: MintFacts, purpose: VaultPurpose, delay: int, cap: M::Amount, turnOn: bool): Escrow =
  { ...e, deployed: true, asset: asset, purpose: purpose, bindingDelay: delay, monthlyCap: cap, monthlyEnabled: turnOn }
pure def canUpgradeToRelease(e: Escrow, ev: ChainEvent): bool = later(e, ev) and e.implementation == PreRelease
pure def upgradeToRelease(e: Escrow, ev: ChainEvent): Escrow = { ...advance(ev, e), implementation: ReleaseCapable }
```

### Events apply once, in canonical block and event order

The adapter applies a finalized event only after every earlier event of this
vault. An event at or before the last applied position is a replay and is
refused, so a retry never applies an operation twice. The contract clock is
the event's block time and never moves backwards.

```quint
pure def later(e: Escrow, ev: ChainEvent): bool =
  e.deployed and ev.transaction != "" and ev.time >= e.clock
    and (ev.block > e.at.block or (ev.block == e.at.block and ev.index > e.at.index))
pure def advance(ev: ChainEvent, e: Escrow): Escrow = { ...e, at: ev, clock: ev.time }
pure def stepEventOrder(before: Escrow, after: Escrow): bool =
  after.clock >= before.clock and
  (after.at == before.at or after.at.block > before.at.block
    or (after.at.block == before.at.block and after.at.index > before.at.index))
```

## Story: Deposit and withdraw only free funds

### Anyone may deposit the vault asset and it joins the one free balance

A deposit names this vault and its exact asset. All deposits share one free
balance; a depositor gets no refund right. A deposit works while a monthly
pool reserve is pending.

```quint
type Deposit = { vault: str, network: Network, token: str, amount: M::Amount }
pure def canDeposit(e: Escrow, deposit: Deposit, ev: ChainEvent): bool =
  later(e, ev) and deposit.vault == e.vault and deposit.network == e.asset.network and deposit.token == e.asset.token
    and M::validAmount(deposit.amount) and positiveInRange(e, deposit.amount)
    and inRange(e, M::addAmounts(e.deposited, deposit.amount))
pure def deposit(e: Escrow, deposit: Deposit, ev: ChainEvent): Escrow =
  { ...advance(ev, e), free: M::addAmounts(e.free, deposit.amount), deposited: M::addAmounts(e.deposited, deposit.amount),
    held: M::addAmounts(e.held, deposit.amount),
    depositsWhilePending: if (M::positiveAmount(e.pending)) e.depositsWhilePending + 1 else e.depositsWhilePending }
```

### Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up

The withdrawal fee is `ceil(gross / 50)`, charged once per withdrawal, so
splitting a withdrawal never lowers it. The fee accrues to the fee bucket and
the owner receives `gross - fee`. Reserved principal, reserved fees and the
monthly pool reserve are never withdrawable. The owner address is the refund
destination.

```quint
pure def canWithdraw(e: Escrow, gross: M::Amount, ev: ChainEvent, by: str): bool =
  later(e, ev) and by == e.owner and M::validAmount(gross) and positiveInRange(e, gross)
    and M::compareAmounts(e.free, gross) >= 0 and M::compareAmounts(e.held, gross) >= 0
pure def withdraw(e: Escrow, gross: M::Amount, ev: ChainEvent, by: str): Escrow =
  val fee = M::ordinaryFeeAmount(gross)
  { ...advance(ev, e), free: M::subtractAmounts(e.free, gross), grossWithdrawn: M::addAmounts(e.grossWithdrawn, gross),
    held: M::subtractAmounts(e.held, gross), spent: M::addAmounts(e.spent, gross),
    withdrawalFees: M::addAmounts(e.withdrawalFees, fee), accruedFees: M::addAmounts(e.accruedFees, fee),
    withdrawals: e.withdrawals.append({ transaction: ev.transaction, gross: gross, fee: fee, poolPending: M::positiveAmount(e.pending) }) }
```

### Anyone may move accrued fees only to the fixed fee recipient

The claim sends the whole accrued fee bucket to the vault's immutable fee
recipient. It cannot reach free funds, reserves or contributor principal. A
blocked fee recipient affects only this call.

```quint
pure def canClaimFees(e: Escrow, recipient: str, ev: ChainEvent): bool =
  later(e, ev) and recipient == e.feeRecipient and M::positiveAmount(e.accruedFees)
pure def claimFees(e: Escrow, recipient: str, ev: ChainEvent): Escrow =
  { ...advance(ev, e), claimedFees: M::addAmounts(e.claimedFees, e.accruedFees), accruedFees: M::zero }
```

## Story: Commit awards without double reservation

### An owner award reserves gross from free funds once per source

An ordinary award holds `ceil(gross / 50)` as reserved fee and the rest as
reserved principal. A bounty vault accepts only a gross divisible by four and
holds exactly one quarter as fee. A source is consumed globally, so the
same source can never become a second award by hand or by monthly leaf. An
ordinary source digest is fixed per project, month and actor and does not
depend on the amount; a bounty source is a random opaque commitment. The
owner cannot commit a manual award while any monthly pool reserve is pending:
an allocation that cannot settle blocks manual awards on that vault until a
leaf or a release consumes it.

```quint
pure def feeFor(purpose: VaultPurpose, gross: M::Amount): M::Amount =
  if (purpose == OrdinaryPurpose) M::ordinaryFeeAmount(gross) else M::privateFeeAmount(gross)
pure val noSource: SourceKey = { origin: "", period: 0, actor: 0 }
pure def validSource(source: SourceKey): bool = source.origin != "" and source.period >= 0 and source.actor >= 0
pure def sourceFree(e: Escrow, source: SourceKey): bool = not(e.awards.some(a => a.source == source))
pure def validAwardTerms(e: Escrow, source: SourceKey, actor: int, gross: M::Amount): bool =
  validSource(source) and actor > 0 and M::validAmount(gross) and positiveInRange(e, gross) and sourceFree(e, source)
    and (e.purpose == OrdinaryPurpose or M::privateSplitPossible(gross))
pure def withAward(award: Award, e: Escrow): Escrow =
  val gross = award.gross
  val fee = award.fee
  { ...e, reserved: M::addAmounts(e.reserved, gross), reservedFees: M::addAmounts(e.reservedFees, fee),
    reservedPrincipal: M::addAmounts(e.reservedPrincipal, M::subtractAmounts(gross, fee)),
    awards: e.awards.append(award), sourceSequence: if (e.purpose == OrdinaryPurpose) e.sourceSequence + 1 else e.sourceSequence }
pure def canCommitAward(e: Escrow, source: SourceKey, actor: int, gross: M::Amount, ev: ChainEvent, by: str): bool =
  later(e, ev) and by == e.owner and validAwardTerms(e, source, actor, gross)
    and not(M::positiveAmount(e.pending)) and M::compareAmounts(e.free, gross) >= 0
pure def commitAward(e: Escrow, source: SourceKey, actor: int, gross: M::Amount, ev: ChainEvent, by: str): Escrow =
  val applied = advance(ev, e)
  val award = { source: source, actor: actor, gross: gross, fee: feeFor(e.purpose, gross), origin: ManualAward,
    period: 0, index: -1, committedAt: ev.time, paid: false, destination: "", bindingVersion: 0, paidIn: "" }
  withAward(award, { ...applied, free: M::subtractAmounts(e.free, gross), committed: M::addAmounts(e.committed, gross) })
```

## Story: Reserve one attested monthly pool per period

### The owner turns monthly commitments on with a positive cap or off

Only an ordinary vault takes monthly commitments. Turning them off stops new
admissions only; an admitted month keeps materializing.

```quint
pure def canSetMonthly(e: Escrow, cap: M::Amount, turnOn: bool, ev: ChainEvent, by: str): bool =
  later(e, ev) and by == e.owner and e.purpose == OrdinaryPurpose and M::validAmount(cap) and inRange(e, cap)
    and (not(turnOn) or M::positiveAmount(cap))
pure def setMonthly(e: Escrow, cap: M::Amount, turnOn: bool, ev: ChainEvent, by: str): Escrow =
  { ...advance(ev, e), monthlyCap: cap, monthlyEnabled: turnOn }
```

### Anyone may admit an attester-signed root once per period inside its window

The window opens 72 hours after the calendar UTC month ends and closes 72
hours after the next month ends. The current identity authority must have
signed the exact period, vault, network, allocation digest, root, whole
gross, unfunded remainder, leaf count and ordinary source sequence. The whole
gross is within the owner's cap. Only the remainder is debited from free
funds into the pool reserve. On EVM a concurrent manual award changes the
source sequence, so a root signed before it is stale. Solana signs the whole
total and the freeze time `frozenAt` instead, which lies inside the window
and not after admission. A period holds at most one root forever, even after
its reserve is released.

```quint
type RootAuthorization = { period: int, vault: str, network: Network, allocationDigest: str, root: str,
  wholeGross: M::Amount, remainingGross: M::Amount, leafCount: int, sourceSequence: int, frozenAt: int, signer: str }
pure def validPeriod(period: int): bool = period >= 200001 and period <= 999912 and period % 100 >= 1 and period % 100 <= 12
pure def nextPeriod(period: int): int = if (period % 100 == 12) (period / 100 + 1) * 100 + 1 else period + 1
pure def monthStart(period: int): int =
  val month = period % 100
  val year = period / 100 - (if (month <= 2) 1 else 0)
  val era = year / 400
  val yearOfEra = year - era * 400
  val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5
  (era * 146097 + yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear - 719468) * 86400
pure val cutoffSeconds = 259200
pure def windowOpen(period: int, clock: int): bool = validPeriod(period)
  and clock >= monthStart(nextPeriod(period)) + cutoffSeconds and clock < monthStart(nextPeriod(nextPeriod(period))) + cutoffSeconds
pure def hasMonth(e: Escrow, period: int): bool = e.months.some(m => m.period == period)
pure def canAdmitRoot(e: Escrow, authorization: RootAuthorization, ev: ChainEvent): bool =
  later(e, ev) and e.purpose == OrdinaryPurpose and e.monthlyEnabled and windowOpen(authorization.period, ev.time)
    and not(hasMonth(e, authorization.period)) and authorization.vault == e.vault and authorization.network == e.asset.network
    and authorization.signer == e.authority and authorization.root != "" and authorization.allocationDigest != ""
    and (if (e.asset.network == Solana) authorization.frozenAt >= monthStart(nextPeriod(authorization.period)) + cutoffSeconds
      and authorization.frozenAt <= ev.time and authorization.remainingGross == authorization.wholeGross
      else authorization.sourceSequence == e.sourceSequence)
    and M::validAmount(authorization.wholeGross) and M::validAmount(authorization.remainingGross)
    and positiveInRange(e, authorization.wholeGross) and M::compareAmounts(authorization.remainingGross, authorization.wholeGross) <= 0
    and M::compareAmounts(authorization.wholeGross, e.monthlyCap) <= 0
    and authorization.leafCount >= 0 and ((authorization.leafCount == 0) == not(M::positiveAmount(authorization.remainingGross)))
    and M::compareAmounts(e.free, authorization.remainingGross) >= 0
pure def admitRoot(e: Escrow, authorization: RootAuthorization, ev: ChainEvent): Escrow =
  val amount = authorization.remainingGross
  { ...advance(ev, e), free: M::subtractAmounts(e.free, amount), pending: M::addAmounts(e.pending, amount),
    committed: M::addAmounts(e.committed, amount),
    months: e.months.append({ period: authorization.period, allocationDigest: authorization.allocationDigest,
      root: authorization.root, wholeGross: authorization.wholeGross, admittedGross: amount, remaining: amount,
      released: M::zero, leafCount: authorization.leafCount, admittedAt: ev.time,
      frozenAt: if (e.asset.network == Solana) authorization.frozenAt else ev.time }) }
```

### On EVM a legacy V1 root commits every leaf at once and counts an identical existing award once

Anyone may submit a V1 commitment the identity authority signed. It is
admitted under the same window, opt-in, cap and one-root-per-period rules. It
commits each entry as a monthly award directly, debiting free funds only for
entries whose source is not yet consumed. An entry whose source already holds
an award with the same actor and gross is counted once; any other existing
award under an entry's source refuses the whole commitment. Nothing enters
the pool reserve.

```quint
type LegacyEntry = { source: SourceKey, actor: int, gross: M::Amount }
type LegacyCommitment = { period: int, vault: str, root: str, entries: List[LegacyEntry], signer: str }
pure def legacyTotal(entries: List[LegacyEntry]): M::Amount = entries.foldl(M::zero, (sum, x) => M::addAmounts(sum, x.gross))
pure def legacyNewTotal(e: Escrow, entries: List[LegacyEntry]): M::Amount =
  entries.foldl(M::zero, (sum, x) => M::addAmounts(sum, if (sourceFree(e, x.source)) x.gross else M::zero))
pure def legacyEntryAdmissible(e: Escrow, entries: List[LegacyEntry], x: LegacyEntry): bool =
  validSource(x.source) and x.actor > 0 and M::validAmount(x.gross) and M::positiveAmount(x.gross)
    and entries.select(o => o.source == x.source).length() == 1
    and (sourceFree(e, x.source) or (awardFor(e, x.source).actor == x.actor and M::equalAmounts(awardFor(e, x.source).gross, x.gross)))
pure def canAdmitLegacyMonth(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent): bool =
  later(e, ev) and e.asset.network != Solana and e.purpose == OrdinaryPurpose and e.monthlyEnabled and windowOpen(legacy.period, ev.time)
    and not(hasMonth(e, legacy.period)) and legacy.vault == e.vault and legacy.signer == e.authority and legacy.root != ""
    and legacy.entries.length() > 0 and legacy.entries.every(x => legacyEntryAdmissible(e, legacy.entries, x))
    and inRange(e, legacyTotal(legacy.entries)) and M::compareAmounts(legacyTotal(legacy.entries), e.monthlyCap) <= 0
    and M::compareAmounts(e.free, legacyNewTotal(e, legacy.entries)) >= 0
pure def legacyAward(e: Escrow, x: LegacyEntry, period: int, index: int, time: int): Award =
  { source: x.source, actor: x.actor, gross: x.gross, fee: feeFor(e.purpose, x.gross), origin: MonthlyLeaf,
    period: period, index: index, committedAt: time, paid: false, destination: "", bindingVersion: 0, paidIn: "" }
type LegacyFold = { vault: Escrow, index: int }
pure def legacyStep(period: int, time: int, acc: LegacyFold, x: LegacyEntry): LegacyFold =
  { vault: if (sourceFree(acc.vault, x.source)) withAward(legacyAward(acc.vault, x, period, acc.index, time), acc.vault) else acc.vault,
    index: acc.index + 1 }
pure def admitLegacyMonth(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent): Escrow =
  val added = legacy.entries.length()
  val newTotal = legacyNewTotal(e, legacy.entries)
  val withMonth = { ...advance(ev, e), free: M::subtractAmounts(e.free, newTotal), committed: M::addAmounts(e.committed, newTotal),
    months: e.months.append({ period: legacy.period, allocationDigest: "v1", root: legacy.root, wholeGross: legacyTotal(legacy.entries),
      admittedGross: M::zero, remaining: M::zero, released: M::zero, leafCount: added, admittedAt: ev.time, frozenAt: ev.time }) }
  legacy.entries.foldl({ vault: withMonth, index: 0 }, (acc, x) => legacyStep(legacy.period, ev.time, acc, x)).vault
```

### A proven leaf reclassifies pool gross into one award without debiting free funds

The adapter recomputes the Merkle-sum root from the leaf and its proof path;
the root and its total must equal the admitted month. A leaf needs no
wallet, fresh signature, open window or current opt-in, so an admitted month
stays resumable after the owner turns monthly commitments off or its window
closes. A source already consumed elsewhere refuses the leaf.

```quint
type LeafProof = { period: int, index: int, root: str, rootTotal: M::Amount, source: SourceKey, actor: int, gross: M::Amount }
pure val noMonth: MonthReserve = { period: 0, allocationDigest: "", root: "", wholeGross: M::zero,
  admittedGross: M::zero, remaining: M::zero, released: M::zero, leafCount: 0, admittedAt: 0, frozenAt: 0 }
pure def monthFor(e: Escrow, period: int): MonthReserve = e.months.select(m => m.period == period).nthOr(0, noMonth)
pure def leafUnused(e: Escrow, period: int, index: int): bool =
  not(e.awards.some(a => a.origin == MonthlyLeaf and a.period == period and a.index == index))
    and not(e.releasedLeaves.some(l => l.period == period and l.index == index))
pure def provesLeaf(e: Escrow, proof: LeafProof): bool =
  val month = monthFor(e, proof.period)
  month.period > 0 and proof.root == month.root and M::validAmount(proof.rootTotal)
    and M::equalAmounts(proof.rootTotal, month.admittedGross) and proof.index >= 0 and proof.index < month.leafCount
    and leafUnused(e, proof.period, proof.index) and M::validAmount(proof.gross) and M::positiveAmount(proof.gross)
    and M::compareAmounts(e.pending, proof.gross) >= 0 and M::compareAmounts(month.remaining, proof.gross) >= 0
pure def canMaterialize(e: Escrow, proof: LeafProof, ev: ChainEvent): bool =
  val month = monthFor(e, proof.period)
  later(e, ev) and provesLeaf(e, proof) and validAwardTerms(e, proof.source, proof.actor, proof.gross)
pure def materialize(e: Escrow, proof: LeafProof, ev: ChainEvent): Escrow =
  val applied = advance(ev, e)
  val award = { source: proof.source, actor: proof.actor, gross: proof.gross, fee: feeFor(e.purpose, proof.gross),
    origin: MonthlyLeaf, period: proof.period, index: proof.index, committedAt: ev.time, paid: false,
    destination: "", bindingVersion: 0, paidIn: "" }
  withAward(award, { ...applied, pending: M::subtractAmounts(e.pending, proof.gross),
    months: e.months.listMap(m => if (m.period == proof.period) { ...m, remaining: M::subtractAmounts(m.remaining, proof.gross) } else m) })
```

### On Solana an uncommittable leaf returns to free funds and a later hand commit strands it

Anyone may release one proven leaf when it can never commit: its actor is
zero, or its source already pays the same actor at least this gross and
principal, or the owner consumed the source by hand before `frozenAt`. A
source consumed by hand at or after `frozenAt` with a smaller award or for
another actor stays reserved and is never refunded: the executor reports it
as stranded. Selective removal never becomes a refund. Each leaf settles once.

```quint
pure def consumedFor(e: Escrow, proof: LeafProof): Award = awardFor(e, proof.source)
pure def leafReleasable(e: Escrow, proof: LeafProof): bool =
  val consumed = consumedFor(e, proof)
  val month = monthFor(e, proof.period)
  proof.actor == 0 or (consumed.source == proof.source and validSource(proof.source) and
    ((consumed.actor == proof.actor and M::compareAmounts(consumed.gross, proof.gross) >= 0
      and M::compareAmounts(M::subtractAmounts(consumed.gross, consumed.fee), M::ordinaryNetAmount(proof.gross)) >= 0)
     or consumed.committedAt < month.frozenAt))
pure def strandedLeaf(e: Escrow, proof: LeafProof): bool =
  provesLeaf(e, proof) and proof.actor > 0 and not(sourceFree(e, proof.source)) and not(leafReleasable(e, proof))
pure def canReleaseLeaf(e: Escrow, proof: LeafProof, ev: ChainEvent): bool =
  later(e, ev) and e.asset.network == Solana and provesLeaf(e, proof) and leafReleasable(e, proof)
    and M::compareAmounts(e.committed, proof.gross) >= 0
pure def releaseLeaf(e: Escrow, proof: LeafProof, ev: ChainEvent): Escrow =
  { ...advance(ev, e), pending: M::subtractAmounts(e.pending, proof.gross), free: M::addAmounts(e.free, proof.gross),
    committed: M::subtractAmounts(e.committed, proof.gross),
    releasedLeaves: e.releasedLeaves.append({ period: proof.period, index: proof.index }),
    months: e.months.listMap(m => if (m.period == proof.period)
      { ...m, remaining: M::subtractAmounts(m.remaining, proof.gross), released: M::addAmounts(m.released, proof.gross) } else m) }
pure def lawStrandedNeverReleases(e: Escrow, proof: LeafProof, ev: ChainEvent): bool =
  strandedLeaf(e, proof) implies not(canReleaseLeaf(e, proof, ev)) and not(canMaterialize(e, proof, ev))
```

### Only an owner request co-signed by the current authority releases pool gross

Until the vault runs the reviewed release-capable implementation, an
allocation that cannot settle stays reserved (PRD section 6). The release
names the exact current remainder of that period. Committed
leaves, awards and fees do not change, the period stays committed, and a later
leaf still proves while its gross fits the remainder. No transition releases a
reserve because time passed. The application service approves only the whole
untouched wrong-total remainder under [reserve release](./reserveRelease.md),
and both contracts accept only that: the whole remainder of a month with no
committed or released leaf (`packages/contracts/README.md`, "Monthly reserve
release").

```quint
type ReleaseAuthorization = { period: int, expectedRemaining: M::Amount, releasedGross: M::Amount, signer: str }
pure def canReleaseReserve(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by: str): bool =
  val month = monthFor(e, release.period)
  later(e, ev) and by == e.owner and e.implementation == ReleaseCapable and month.period > 0 and release.signer == e.authority
    and M::validAmount(release.expectedRemaining) and M::equalAmounts(release.expectedRemaining, month.remaining)
    and M::validAmount(release.releasedGross) and M::positiveAmount(release.releasedGross)
    and M::equalAmounts(release.releasedGross, month.remaining) and M::equalAmounts(month.remaining, month.admittedGross)
    and not(M::positiveAmount(month.released))
    and M::compareAmounts(e.pending, release.releasedGross) >= 0 and M::compareAmounts(e.committed, release.releasedGross) >= 0
pure def releaseReserve(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by: str): Escrow =
  { ...advance(ev, e), pending: M::subtractAmounts(e.pending, release.releasedGross), free: M::addAmounts(e.free, release.releasedGross),
    committed: M::subtractAmounts(e.committed, release.releasedGross),
    months: e.months.listMap(m => if (m.period == release.period)
      { ...m, remaining: M::subtractAmounts(m.remaining, release.releasedGross), released: M::addAmounts(m.released, release.releasedGross) } else m) }
```

## Story: Pay each award once to the binding the contract selects

### Anyone may pay a matured award; net goes to the destination and the fee accrues

The binding version and destination are the actor's current payable binding,
which the binding-authority owner supplies from the same finalized block. The
award waits the vault's binding delay after commitment; the owner decision
sets that delay to zero. Paying moves the reserved principal to paid net and
the reserved fee to payout fees and to the accrued fee bucket. A paid award
is permanent.

```quint
type PayableBinding = { actor: int, destination: str, version: int }
pure val noAward: Award = { source: noSource, actor: 0, gross: M::zero, fee: M::zero, origin: ManualAward,
  period: 0, index: -1, committedAt: 0, paid: false, destination: "", bindingVersion: 0, paidIn: "" }
pure def awardFor(e: Escrow, source: SourceKey): Award = e.awards.select(a => a.source == source).nthOr(0, noAward)
pure def awardActorsFor(e: Escrow, origin: str, period: int): List[int] =
  e.awards.select(a => a.source.origin == origin and a.source.period == period).listMap(a => a.source.actor)
pure def hasAwardOf(e: Escrow, origin: AwardOrigin): bool = e.awards.some(a => a.origin == origin)
pure def canPay(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent): bool =
  val award = awardFor(e, source)
  later(e, ev) and validSource(source) and award.source == source and not(award.paid) and binding.actor == award.actor
    and binding.version > 0 and binding.destination != "" and ev.time >= award.committedAt + e.bindingDelay
    and M::compareAmounts(e.reservedFees, award.fee) >= 0 and M::compareAmounts(e.reserved, award.gross) >= 0
    and M::compareAmounts(e.reservedPrincipal, M::subtractAmounts(award.gross, award.fee)) >= 0
    and M::compareAmounts(e.committed, award.gross) >= 0 and M::compareAmounts(e.held, award.gross) >= 0
pure def pay(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent): Escrow =
  val award = awardFor(e, source)
  val net = M::subtractAmounts(award.gross, award.fee)
  { ...advance(ev, e), reserved: M::subtractAmounts(e.reserved, award.gross), paid: M::addAmounts(e.paid, award.gross),
    committed: M::subtractAmounts(e.committed, award.gross), held: M::subtractAmounts(e.held, award.gross),
    spent: M::addAmounts(e.spent, award.gross),
    reservedPrincipal: M::subtractAmounts(e.reservedPrincipal, net), reservedFees: M::subtractAmounts(e.reservedFees, award.fee),
    paidNet: M::addAmounts(e.paidNet, net), payoutFees: M::addAmounts(e.payoutFees, award.fee),
    accruedFees: M::addAmounts(e.accruedFees, award.fee),
    awards: e.awards.select(a => a.source != source).append(markPaid(award, binding.destination, binding.version, ev.transaction)) }
pure def markPaid(a: Award, destination: str, version: int, transaction: str): Award =
  { source: a.source, actor: a.actor, gross: a.gross, fee: a.fee, origin: a.origin, period: a.period, index: a.index,
    committedAt: a.committedAt, paid: true, destination: destination, bindingVersion: version, paidIn: transaction }
```

### An identity-authority rotation observed at the factory changes only who signs next

Earlier attestations are not re-checked: an admitted month and existing
awards keep their state. A root or release signed by the former authority is
refused after the rotation. Which keys a rotation may name, and who proposes
it, is owned by [binding authority](./bindingAuthority.md); this unit only
applies the finalized result.

```quint
pure def canObserveAuthority(e: Escrow, authority: str, ev: ChainEvent): bool =
  later(e, ev) and authority != "" and authority != e.authority
pure def observeAuthority(e: Escrow, authority: str, ev: ChainEvent): Escrow = { ...advance(ev, e), authority: authority }
```

## Story: Every base unit is accounted for

### Gross buckets conserve every deposit and the fee buckets conserve every fee

Every gross unit deposited is either still held by the vault or spent. Held
gross is free or committed; committed gross is in the pool reserve or
reserved for an award; spent gross is paid or withdrawn. The aggregates
`held`, `committed` and `spent` are cumulative views kept with each move. Reserved gross splits exactly into
principal and fee, paid gross into net and payout fee, and every payout or
withdrawal fee is either accrued or claimed. All counters stay inside the
network's integer range.

```quint
pure def alwaysValidCounters(e: Escrow): bool =
  M::validAmount(e.deposited) and M::validAmount(e.free) and M::validAmount(e.pending) and M::validAmount(e.reserved)
    and M::validAmount(e.reservedPrincipal) and M::validAmount(e.reservedFees) and M::validAmount(e.paid)
    and M::validAmount(e.paidNet) and M::validAmount(e.payoutFees) and M::validAmount(e.grossWithdrawn)
    and M::validAmount(e.withdrawalFees) and M::validAmount(e.accruedFees) and M::validAmount(e.claimedFees)
    and M::validAmount(e.monthlyCap) and inRange(e, e.deposited)
    and M::validAmount(e.held) and M::validAmount(e.committed) and M::validAmount(e.spent) and inRange(e, e.monthlyCap)
pure def alwaysGrossConserved(e: Escrow): bool = M::equalAmounts(e.deposited, M::addAmounts(e.held, e.spent))
  and M::equalAmounts(e.held, M::addAmounts(e.free, e.committed)) and M::equalAmounts(e.committed, M::addAmounts(e.pending, e.reserved))
  and M::equalAmounts(e.spent, M::addAmounts(e.paid, e.grossWithdrawn))
pure def alwaysReservedSplit(e: Escrow): bool = M::equalAmounts(e.reserved, M::addAmounts(e.reservedPrincipal, e.reservedFees))
pure def alwaysPaidSplit(e: Escrow): bool = M::equalAmounts(e.paid, M::addAmounts(e.paidNet, e.payoutFees))
pure def alwaysFeesConserved(e: Escrow): bool =
  M::equalAmounts(M::addAmounts(e.payoutFees, e.withdrawalFees), M::addAmounts(e.accruedFees, e.claimedFees))
```

### Every award and withdrawal keeps its exact fee and immutable identity

Each award has a unique source, a positive gross, the fee its vault purpose
requires, and a paid record only with a destination, positive binding
version and transaction. Each withdrawal fee is `ceil(gross / 50)`. Each
admitted month is unique by period, never holds more remainder than it
admitted, and a monthly leaf belongs to an admitted month.

```quint
pure def validAward(e: Escrow, a: Award): bool =
  validSource(a.source) and a.actor > 0 and M::validAmount(a.gross) and M::positiveAmount(a.gross)
    and a.fee == feeFor(e.purpose, a.gross) and (e.purpose == OrdinaryPurpose or M::privateSplitPossible(a.gross))
    and (a.paid == (a.paidIn != "")) and (a.paid implies a.destination != "" and a.bindingVersion > 0)
    and (a.origin == ManualAward implies a.period == 0 and a.index == -1)
    and (a.origin == MonthlyLeaf implies hasMonth(e, a.period) and a.index >= 0)
pure def alwaysAwards(e: Escrow): bool = e.awards.every(a => validAward(e, a)
  and e.awards.select(other => other.source == a.source).length() == 1)
pure def alwaysWithdrawalFees(e: Escrow): bool = e.withdrawals.every(w => M::validAmount(w.gross) and M::positiveAmount(w.gross)
  and w.fee == M::ordinaryFeeAmount(w.gross) and w.transaction != "")
pure def alwaysMonths(e: Escrow): bool = e.months.every(m => validPeriod(m.period) and m.root != "" and m.allocationDigest != ""
  and M::validAmount(m.remaining) and M::validAmount(m.released) and M::validAmount(m.admittedGross)
  and M::compareAmounts(m.remaining, m.admittedGross) <= 0 and e.months.select(other => other.period == m.period).length() == 1)
pure def alwaysBountyVaultHasNoMonths(e: Escrow): bool = e.purpose == BountyPurpose implies e.months.length() == 0 and not(e.monthlyEnabled)
pure def alwaysUndeployedEmpty(e: Escrow): bool = not(e.deployed) implies e.at == origin and e.awards.length() == 0
  and e.months.length() == 0 and e.withdrawals.length() == 0 and M::equalAmounts(e.deposited, M::zero)
```

### Identity, history and cumulative counters never go backwards

The vault, asset, purpose, owner and fee recipient never change. Awards,
months and withdrawals are append-only, an award's terms never change, and a
paid award never changes again. Cumulative deposited, paid, fee and
withdrawal counters never decrease. Pool gross leaves the reserve only by a
proven leaf or an authorized release. Free funds leave only by an owner
award, a root admission or an owner withdrawal. A manual award never happens
while pool gross is pending. A period's root is admitted only once.

```quint
pure def stepIdentityFixed(before: Escrow, after: Escrow): bool =
  before.deployed implies after.deployed and before.vault == after.vault and before.asset == after.asset and before.purpose == after.purpose
    and before.owner == after.owner and before.feeRecipient == after.feeRecipient and before.bindingDelay == after.bindingDelay
pure def sameAwardTerms(a: Award, b: Award): bool = a.source == b.source and a.actor == b.actor and a.gross == b.gross
  and a.fee == b.fee and a.origin == b.origin and a.period == b.period and a.index == b.index and a.committedAt == b.committedAt
pure def stepAwardsRetained(before: Escrow, after: Escrow): bool =
  after.awards.length() >= before.awards.length()
    and before.awards.every(a => after.awards.some(b => sameAwardTerms(a, b) and (a.paid implies a == b)))
pure def sameMonthTerms(a: MonthReserve, b: MonthReserve): bool = a.period == b.period and a.root == b.root
  and a.allocationDigest == b.allocationDigest and a.wholeGross == b.wholeGross and a.admittedGross == b.admittedGross
  and a.leafCount == b.leafCount and a.admittedAt == b.admittedAt
pure def stepMonthsRetained(before: Escrow, after: Escrow): bool =
  after.months.length() >= before.months.length() and before.months.every(a => after.months.some(b => sameMonthTerms(a, b)))
pure def stepWithdrawalsRetained(before: Escrow, after: Escrow): bool =
  before.withdrawals.every(w => after.withdrawals.includes(w))
pure def notBelow(after: M::Amount, before: M::Amount): bool = M::compareAmounts(after, before) >= 0
pure def stepCumulativeCounters(before: Escrow, after: Escrow): bool =
  notBelow(after.deposited, before.deposited) and notBelow(after.paid, before.paid) and notBelow(after.paidNet, before.paidNet)
    and notBelow(after.payoutFees, before.payoutFees) and notBelow(after.grossWithdrawn, before.grossWithdrawn)
    and notBelow(after.withdrawalFees, before.withdrawalFees) and notBelow(after.claimedFees, before.claimedFees)
pure def stepPoolLeavesOnlyByLeafOrRelease(before: Escrow, via: str, after: Escrow): bool =
  M::compareAmounts(after.pending, before.pending) < 0 implies (via == "materialize" or via == "releaseReserve" or via == "releaseLeaf")
pure def stepFreeLeavesOnlyByOwnerOrRoot(before: Escrow, via: str, after: Escrow): bool =
  M::compareAmounts(after.free, before.free) < 0 implies (via == "commitAward" or via == "admitRoot" or via == "withdraw"
    or via == "admitLegacyMonth")
pure def stepManualBlockedWhilePoolPending(before: Escrow, via: str, after: Escrow): bool =
  via == "commitAward" implies not(M::positiveAmount(before.pending))
pure def stepOneRootPerPeriod(before: Escrow, via: str, after: Escrow): bool =
  val added = after.months.nthOr(before.months.length(), noMonth)
  (via == "admitRoot" or via == "admitLegacyMonth") implies after.months == before.months.append(added) and not(hasMonth(before, added.period))
pure def stepImplementationOnlyUpgrades(before: Escrow, after: Escrow): bool =
  before.implementation == ReleaseCapable implies after.implementation == ReleaseCapable
pure def stepReleaseNeedsUpgrade(before: Escrow, via: str, after: Escrow): bool =
  via == "releaseReserve" implies before.implementation == ReleaseCapable
```

### Pool deposits, withdrawals, leaves after opt-out, releases and fee claims are reachable

```quint
pure def sometimesDepositWhilePoolPending(e: Escrow): bool = e.depositsWhilePending > 0
pure def sometimesWithdrawWhilePoolPending(e: Escrow): bool = e.withdrawals.some(w => w.poolPending)
pure def sometimesLeafAfterOptOut(e: Escrow): bool = not(e.monthlyEnabled) and e.awards.some(a => a.origin == MonthlyLeaf)
pure def sometimesPartlyMaterialized(e: Escrow): bool = M::positiveAmount(e.pending) and e.awards.some(a => a.origin == MonthlyLeaf)
pure def sometimesReleased(e: Escrow): bool = e.months.some(m => M::positiveAmount(m.released))
pure def sometimesPaid(e: Escrow): bool = e.awards.some(a => a.paid and a.origin == MonthlyLeaf)
pure def sometimesWithdrawalFee(e: Escrow): bool = M::positiveAmount(e.withdrawalFees)
pure def sometimesFeesClaimed(e: Escrow): bool = M::positiveAmount(e.claimedFees) and M::positiveAmount(e.withdrawalFees)
pure def sometimesManualAfterRelease(e: Escrow): bool = e.awards.some(a => a.origin == ManualAward)
  and e.months.some(m => M::positiveAmount(m.released))
pure def sometimesLegacyMonthCountsExistingOnce(e: Escrow): bool = e.months.some(m => m.allocationDigest == "v1")
  and e.awards.some(a => a.origin == ManualAward and a.source.period == 202611)
```

### Simulation samples reach the November 2026 window

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules. The November 2026
window opens at 1796342400 (4 December 00:00 UTC) and closes at 1799020800.

```quint
pure val evValues = Set(
  { block: 1, index: 0, time: 1796342400, transaction: "t1" },
  { block: 2, index: 0, time: 1796342500, transaction: "t2" },
  { block: 2, index: 1, time: 1796342500, transaction: "t3" },
  { block: 3, index: 0, time: 1796428800, transaction: "t4" },
  { block: 4, index: 0, time: 1798000000, transaction: "t5" },
  { block: 5, index: 0, time: 1799020800, transaction: "t6" },
  { block: 6, index: 0, time: 1799100000, transaction: "t7" })
pure val solanaAsset: AssetIdentity = { network: Solana, token: "mint", decimals: 6, native: false, kind: M::Token2022 }
pure val cleanMint: MintFacts = { mintBytes: 300, mintAuthority: false, freezeAuthority: false, pointerAuthority: false,
  updateAuthority: false, selfHosted: true, mintExtensions: List("MetadataPointer", "TokenMetadata"), accountExtensions: List("ImmutableOwner") }
pure val mintValues = Set(cleanMint, { ...cleanMint, mintExtensions: List("TransferHook") })
pure val assetValues = Set(baseAsset, solanaAsset, { ...baseAsset, token: "" })
pure val delayValues = Set(0, 3600)
pure val depositValues = Set({ vault: "vault", network: Base, token: "usdc", amount: List(8) },
  { vault: "vault", network: Solana, token: "mint", amount: List(8) },
  { vault: "vault", network: Base, token: "other", amount: List(8) })
pure val grossValues = Set(List(4), List(50))
pure val capValues = Set(List(0), List(8))
pure def sampleKey(period: int, actor: int): SourceKey = { origin: "eliza", period: period, actor: actor }
pure val sourceValues = Set(sampleKey(202611, 1)).union(Set(sampleKey(202611, 2))).union(Set(sampleKey(202612, 1)))
pure val actorValues = Set(1, 2)
pure val byValues = Set("owner", "anyone")
pure val recipientValues = Set("fees", "owner")
pure val authorityValues = Set("attester", "next", "owner")
pure val rootAuthorization: RootAuthorization = { period: 202611, vault: "vault", network: Base,
  allocationDigest: "a1", root: "r1", wholeGross: List(5), remainingGross: List(5), leafCount: 2, sourceSequence: 0,
  frozenAt: 1796342400, signer: "attester" }
pure val authorizationValues = Set(rootAuthorization, { ...rootAuthorization, network: Solana },
  { ...rootAuthorization, sourceSequence: 1 }, { ...rootAuthorization, signer: "next" })
pure val leafSample: LeafProof = { period: 202611, index: 0, root: "r1", rootTotal: List(5), source: sampleKey(202611, 1), actor: 1, gross: List(1) }
pure val proofValues = Set(leafSample)
  .union(Set({ ...leafSample, index: 1, source: sampleKey(202611, 2), actor: 2, gross: List(4) }))
  .union(Set({ ...leafSample, index: 1, actor: 2, gross: List(4) }))
  .union(Set({ ...leafSample, index: 1, source: sampleKey(202611, 2), actor: 0, gross: List(4) }))
pure val releaseValues = Set({ period: 202611, expectedRemaining: List(5), releasedGross: List(5), signer: "attester" },
  { period: 202611, expectedRemaining: List(4), releasedGross: List(4), signer: "attester" },
  { period: 202611, expectedRemaining: List(5), releasedGross: List(5), signer: "next" })
pure val bindingValues = Set({ actor: 1, destination: "w1", version: 1 }, { actor: 2, destination: "w2", version: 1 },
  { actor: 1, destination: "w1", version: 0 })
pure val weight_deposit = 6
pure val weight_admitRoot = 8
pure val weight_materialize = 8
pure val weight_releaseReserve = 10
pure val weight_pay = 6
pure val weight_withdraw = 4
pure val weight_setMonthly = 2
pure val weight_claimFees = 2
pure val weight_observeAuthority = 1
pure val weight_releaseLeaf = 8
pure val weight_commitAward = 8
pure val weight_admitLegacyMonth = 4
pure val weight_upgradeToRelease = 4
pure val legacyValues = Set({ period: 202611, vault: "vault", root: "v1", signer: "attester",
  entries: List({ source: sampleKey(202611, 1), actor: 1, gross: List(4) }, { source: sampleKey(202611, 2), actor: 2, gross: List(1) }) },
  { period: 202611, vault: "vault", root: "v1", signer: "attester",
  entries: List({ source: sampleKey(202611, 1), actor: 1, gross: List(50) }) })
```
