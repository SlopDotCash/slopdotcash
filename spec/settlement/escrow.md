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
`pledgeMonths`, `expirePledge`, `monthlyCapFor`, `closePledge`, `takeFree`,
`reserveMonthly`, `commitMonthlyLeaf`, `releaseMonthlyReserve`, `recordAward`,
`pay`, `withdrawUnused`, `claimFees`, `monthlyWindow`) and the Solana program
handlers `deposit`, `commit`, `pledge_month`, `expire_pledge`, `commit_monthly`,
`commit_monthly_award`, `release_monthly_award`, `release_monthly_reserve`,
`pay` and `withdraw`. The contract units
[EVM escrow](../contracts/evmEscrow.md) and [Solana escrow](../contracts/solanaEscrow.md)
state the same pledge, cap and release rules per network.
It started from the EVM monthly reserve draft, retired from `formal/drafts/`
(git history keeps it). Its rules are stated here and in the contract units,
except two: its goal of more than one admitted month while pool gross is
pending, and the half of its compatible-rows rule that allows one award per
monthly leaf position. Unique periods and unique sources are `alwaysMonths`
and `alwaysAwards`; `leafUnused` refuses a used leaf position, but no rule
here states it.
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
type Pledge = { period: int, amount: M::Amount, open: bool }
type Escrow = { deployed: bool, vault: str, asset: AssetIdentity, purpose: VaultPurpose, owner: str, feeRecipient: str,
  authority: str, bindingDelay: int, implementation: Implementation, at: ChainEvent, clock: int,
  monthlyEnabled: bool, monthlyCap: M::Amount, sourceSequence: int,
  deposited: M::Amount, held: M::Amount, committed: M::Amount, spent: M::Amount,
  free: M::Amount, pending: M::Amount, reserved: M::Amount,
  reservedPrincipal: M::Amount, reservedFees: M::Amount, paid: M::Amount, paidNet: M::Amount,
  payoutFees: M::Amount, grossWithdrawn: M::Amount, withdrawalFees: M::Amount,
  accruedFees: M::Amount, claimedFees: M::Amount,
  months: List[MonthReserve], awards: List[Award], releasedLeaves: List[LeafPosition], withdrawals: List[Withdrawal], depositsWhilePending: int,
  pledges: List[Pledge], pledged: M::Amount, admissionsWhileOff: int }
pure val baseAsset: AssetIdentity = { network: Base, token: "usdc", decimals: 6, native: false, kind: M::Classic }
pure val origin: ChainEvent = { block: 0, index: 0, time: 1793491200, transaction: "" }
pure val initial: Escrow = { deployed: false, vault: "vault", asset: baseAsset, purpose: OrdinaryPurpose, owner: "owner",
  feeRecipient: "fees", authority: "attester", bindingDelay: 0, implementation: PreRelease, at: origin, clock: 1793491200,
  monthlyEnabled: false, monthlyCap: M::zero, sourceSequence: 0,
  deposited: M::zero, held: M::zero, committed: M::zero, spent: M::zero, free: M::zero, pending: M::zero, reserved: M::zero,
  reservedPrincipal: M::zero, reservedFees: M::zero, paid: M::zero, paidNet: M::zero,
  payoutFees: M::zero, grossWithdrawn: M::zero, withdrawalFees: M::zero,
  accruedFees: M::zero, claimedFees: M::zero,
  months: List(), awards: List(), releasedLeaves: List(), withdrawals: List(), depositsWhilePending: 0,
  pledges: List(), pledged: M::zero, admissionsWhileOff: 0 }
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
commitments on with a positive cap. A vault is created on the implementation it was deployed with,
and gains whole reserve release only through a finalized event showing the
reviewed release-capable implementation: an EVM vault upgrade, or on Solana
the reviewed program upgrade observed for this vault. The Solana source is
not deployment evidence; the recorded mainnet program needs a separately
reviewed and owner-approved upgrade (`packages/contracts/solana/README.md`,
"Mainnet upgrade"), so no network is assumed release-capable at creation. The contract accepts a binding delay
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
pure def canDeposit(e: Escrow, funds: Deposit, ev: ChainEvent): bool =
  later(e, ev) and funds.vault == e.vault and funds.network == e.asset.network and funds.token == e.asset.token
    and M::validAmount(funds.amount) and positiveInRange(e, funds.amount)
    and inRange(e, M::addAmounts(e.deposited, funds.amount))
pure def deposit(e: Escrow, funds: Deposit, ev: ChainEvent): Escrow =
  { ...advance(ev, e), free: M::addAmounts(e.free, funds.amount), deposited: M::addAmounts(e.deposited, funds.amount),
    held: M::addAmounts(e.held, funds.amount),
    depositsWhilePending: if (M::positiveAmount(e.pending)) e.depositsWhilePending + 1 else e.depositsWhilePending }
```

### Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up

The withdrawal fee is `ceil(gross / 50)`, charged once per withdrawal, so
splitting a withdrawal never lowers it. The fee accrues to the fee bucket and
the owner receives `gross - fee`. Reserved principal, reserved fees and the
monthly pool reserve are never withdrawable, and neither are free funds that
an open month pledge holds: on both networks the free balance after the
withdrawal must still cover every open pledge (`takeFree` on EVM,
`PledgedFunds` in Solana `withdraw`). The owner address is the refund
destination.

```quint
pure def canWithdraw(e: Escrow, gross: M::Amount, ev: ChainEvent, by: str): bool =
  later(e, ev) and by == e.owner and M::validAmount(gross) and positiveInRange(e, gross)
    and unpledgedCovers(e, gross) and M::compareAmounts(e.held, gross) >= 0
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
leaf or a release consumes it. An award spends only unpledged free funds: on
both networks the free balance after it must still cover every open pledge.
On EVM the owner also commits nothing by hand while the period whose window
is open has an open pledge (`PledgedMonthOpen`), because each award moves the
source sequence and would make that period's pledged reservation stale; the
Solana program has no such block.

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
    and not(M::positiveAmount(e.pending)) and unpledgedCovers(e, gross)
    and (e.asset.network == Solana or not(openInWindowPledge(e, ev.time)))
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

### The owner pledges free funds to coming months, raising but never lowering an open pledge

An ordinary vault's owner pledges an amount of free funds to a period from
the current UTC month to eleven months after it that has no admitted root.
EVM `pledgeMonths` pledges each of up to twelve consecutive periods in one
call; Solana `pledge_month` pledges one period per instruction, and clients
batch several instructions. An open pledge below the amount is raised to it,
an equal one is unchanged, and a higher one refuses (`PledgeTooLow`): nothing
lowers or cancels a pledge. Every open pledge together must stay within the
free balance (`InsufficientFreeBalance`). Funds do not move; the pledged
total is held back from every other use of free funds until the pledge
closes, and the open pledges of every period but one are what that period's
monthly funding holds back.

```quint
pure val noPledge: Pledge = { period: 0, amount: M::zero, open: false }
pure def pledgeOf(e: Escrow, period: int): Pledge = e.pledges.foldl(noPledge, (found, p) => if (p.period == period) p else found)
pure def openPledged(pledges: List[Pledge]): M::Amount = pledges.foldl(M::zero, (t, p) => if (p.open) M::addAmounts(t, p.amount) else t)
pure def otherOpenPledged(e: Escrow, period: int): M::Amount =
  e.pledges.foldl(M::zero, (t, p) => if (p.open and p.period != period) M::addAmounts(t, p.amount) else t)
pure def unpledgedCovers(e: Escrow, gross: M::Amount): bool =
  M::compareAmounts(e.free, gross) >= 0 and M::compareAmounts(M::subtractAmounts(e.free, gross), e.pledged) >= 0
pure def openInWindowPledge(e: Escrow, time: int): bool = e.pledges.some(p => p.open and windowOpen(p.period, time))
pure def pledgePeriods(fromPeriod: int, count: int): List[int] =
  List(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12).select(i => i <= count).foldl(List(), (ps, i) =>
    ps.append(if (ps.length() == 0) fromPeriod else nextPeriod(ps.nthOr(ps.length() - 1, fromPeriod))))
// The period has not ended, and the same month a year later has not begun: from the current month to eleven after it.
pure def pledgeable(e: Escrow, period: int, time: int): bool =
  validPeriod(period) and monthStart(nextPeriod(period)) > time and monthStart(nextPeriod(period - 100)) <= time
    and not(hasMonth(e, period))
pure def raisedBy(e: Escrow, period: int, amount: M::Amount): M::Amount =
  if (pledgeOf(e, period).open) M::subtractAmounts(amount, pledgeOf(e, period).amount) else amount
pure def addedBy(e: Escrow, periods: List[int], amount: M::Amount): M::Amount =
  periods.foldl(M::zero, (t, period) => M::addAmounts(t, raisedBy(e, period, amount)))
pure def canPledgeMonths(e: Escrow, fromPeriod: int, count: int, amount: M::Amount, ev: ChainEvent, by: str): bool =
  val periods = pledgePeriods(fromPeriod, count)
  later(e, ev) and by == e.owner and e.purpose == OrdinaryPurpose and count >= 1 and count <= 12
    and (e.asset.network != Solana or count == 1) and M::validAmount(amount) and positiveInRange(e, amount)
    and periods.every(period => pledgeable(e, period, ev.time)
      and (not(pledgeOf(e, period).open) or M::compareAmounts(pledgeOf(e, period).amount, amount) <= 0))
    and M::compareAmounts(e.free, M::addAmounts(e.pledged, addedBy(e, periods, amount))) >= 0
pure def pledgeMonths(e: Escrow, fromPeriod: int, count: int, amount: M::Amount, ev: ChainEvent, by: str): Escrow =
  val periods = pledgePeriods(fromPeriod, count)
  val kept = e.pledges.select(p => not(periods.includes(p.period)))
  { ...advance(ev, e), pledged: M::addAmounts(e.pledged, addedBy(e, periods, amount)),
    pledges: periods.foldl(kept, (ps, period) => ps.append({ period: period, amount: amount, open: true })) }
```

### A pledge closes when its period is admitted or its window has closed

Admission closes the period's own open pledge, whose funds pay it. Anyone
closes an open pledge once its period's window has closed without admission
(`expirePledge`, `expire_pledge`). On Solana a commit that did not name the
pledge account leaves the period's pledge open, and `expire_pledge` then
closes it at once because the month exists. The amount stays as a record and
returns to the owner's unpledged free funds; the free balance itself does not
change.

```quint
pure def closesAt(period: int): int = monthStart(nextPeriod(nextPeriod(period))) + cutoffSeconds
pure def closePledge(period: int, e: Escrow): Escrow =
  val p = pledgeOf(e, period)
  if (p.open) { ...e, pledged: M::subtractAmounts(e.pledged, p.amount),
    pledges: e.pledges.listMap(x => if (x.period == period) { ...x, open: false } else x) } else e
pure def canExpirePledge(e: Escrow, period: int, ev: ChainEvent): bool =
  later(e, ev) and e.purpose == OrdinaryPurpose and pledgeOf(e, period).open
    and (ev.time >= closesAt(period) or (e.asset.network == Solana and hasMonth(e, period)))
pure def expirePledge(e: Escrow, period: int, ev: ChainEvent): Escrow = closePledge(period, advance(ev, e))
```

### Anyone may admit an attester-signed root once per period inside its window

The window opens 72 hours after the calendar UTC month ends and closes 72
hours after the next month ends. The current identity authority must have
signed the exact period, vault, network, allocation digest, root, whole
gross, unfunded remainder, leaf count and ordinary source sequence. The
period admits while monthly commitments are on or while the period has an
open pledge, and its whole gross is within the period's cap: the monthly cap
while commitments are on (zero while off), raised to the period's open
pledge (`monthlyCapFor` on EVM, `monthly_limit` on Solana). Only the
remainder is debited from free funds into the pool reserve, and it never
takes funds another period's open pledge holds (`PledgedFunds`). Admission
closes the period's own pledge. On EVM the contract always reads the
period's pledge. On Solana only a pledge account the caller names counts:
an unnamed own pledge is treated as another period's and stays open. On EVM a concurrent manual award changes the
source sequence, so a root signed before it is stale. Solana signs the whole
total and the freeze time `frozenAt` instead, which lies inside the window
and not after admission. A period holds at most one root forever, even after
its reserve is released. The adapter counts the admissions made while monthly
commitments were off; each was admitted by its own open pledge, under a cap
of zero raised to that pledge.

```quint
type RootAuthorization = { period: int, vault: str, network: Network, allocationDigest: str, root: str,
  wholeGross: M::Amount, remainingGross: M::Amount, leafCount: int, sourceSequence: int, frozenAt: int, signer: str,
  pledgeAccount: bool }
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
pure def namesPledge(e: Escrow, authorization: RootAuthorization): bool = e.asset.network != Solana or authorization.pledgeAccount
pure def namedPledge(e: Escrow, period: int, named: bool): Pledge = if (named) pledgeOf(e, period) else noPledge
pure def capFor(e: Escrow, period: int, named: bool): M::Amount =
  val cap = if (e.monthlyEnabled) e.monthlyCap else M::zero
  val p = namedPledge(e, period, named)
  if (p.open and M::compareAmounts(p.amount, cap) > 0) p.amount else cap
pure def closeNamed(period: int, named: bool, e: Escrow): Escrow = if (named) closePledge(period, e) else e
pure def admissionEnabled(e: Escrow, period: int, named: bool): bool = e.monthlyEnabled or namedPledge(e, period, named).open
pure def offAdmission(e: Escrow): int = if (e.monthlyEnabled) e.admissionsWhileOff else e.admissionsWhileOff + 1
pure def canAdmitRoot(e: Escrow, authorization: RootAuthorization, ev: ChainEvent): bool =
  val named = namesPledge(e, authorization)
  later(e, ev) and e.purpose == OrdinaryPurpose and admissionEnabled(e, authorization.period, named)
    and windowOpen(authorization.period, ev.time)
    and (not(named) or e.asset.network != Solana or e.pledges.some(p => p.period == authorization.period))
    and not(hasMonth(e, authorization.period)) and authorization.vault == e.vault and authorization.network == e.asset.network
    and authorization.signer == e.authority and authorization.root != "" and authorization.allocationDigest != ""
    and (if (e.asset.network == Solana) authorization.frozenAt >= monthStart(nextPeriod(authorization.period)) + cutoffSeconds
      and authorization.frozenAt <= ev.time and authorization.remainingGross == authorization.wholeGross
      else authorization.sourceSequence == e.sourceSequence)
    and M::validAmount(authorization.wholeGross) and M::validAmount(authorization.remainingGross)
    and positiveInRange(e, authorization.wholeGross) and M::compareAmounts(authorization.remainingGross, authorization.wholeGross) <= 0
    and M::compareAmounts(authorization.wholeGross, capFor(e, authorization.period, named)) <= 0
    and authorization.leafCount >= 0 and ((authorization.leafCount == 0) == not(M::positiveAmount(authorization.remainingGross)))
    and unpledgedCovers(closeNamed(authorization.period, named, e), authorization.remainingGross)
pure def admitRoot(e: Escrow, authorization: RootAuthorization, ev: ChainEvent): Escrow =
  val amount = authorization.remainingGross
  val closed = closeNamed(authorization.period, namesPledge(e, authorization), advance(ev, e))
  { ...closed, free: M::subtractAmounts(e.free, amount), pending: M::addAmounts(e.pending, amount),
    committed: M::addAmounts(e.committed, amount), admissionsWhileOff: offAdmission(e),
    months: e.months.append({ period: authorization.period, allocationDigest: authorization.allocationDigest,
      root: authorization.root, wholeGross: authorization.wholeGross, admittedGross: amount, remaining: amount,
      released: M::zero, leafCount: authorization.leafCount, admittedAt: ev.time,
      frozenAt: if (e.asset.network == Solana) authorization.frozenAt else ev.time }) }
```

### On EVM a legacy V1 root commits every leaf at once and counts an identical existing award once

Anyone may submit a V1 commitment the identity authority signed. It is
admitted under the same window, opt-in or pledge, cap, pledge holdback and
one-root-per-period rules, and closes the period's own pledge. It
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
  later(e, ev) and e.asset.network != Solana and e.purpose == OrdinaryPurpose and admissionEnabled(e, legacy.period, true)
    and windowOpen(legacy.period, ev.time)
    and not(hasMonth(e, legacy.period)) and legacy.vault == e.vault and legacy.signer == e.authority and legacy.root != ""
    and legacy.entries.length() > 0 and legacy.entries.every(x => legacyEntryAdmissible(e, legacy.entries, x))
    and inRange(e, legacyTotal(legacy.entries)) and M::compareAmounts(legacyTotal(legacy.entries), capFor(e, legacy.period, true)) <= 0
    and unpledgedCovers(closePledge(legacy.period, e), legacyNewTotal(e, legacy.entries))
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
  val withMonth = { ...closePledge(legacy.period, advance(ev, e)), free: M::subtractAmounts(e.free, newTotal), committed: M::addAmounts(e.committed, newTotal),
    admissionsWhileOff: offAdmission(e),
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
leaves, awards and fees do not change and the period stays committed. After
the release the remainder is zero, so no later leaf proves, and the whole
amount is released at most once. No transition releases a
reserve because time passed. The application service approves only the whole
untouched wrong-total remainder under [reserve release](./reserveRelease.md),
and both contracts accept only that: the whole remainder of a month with no
committed or released leaf (`packages/contracts/README.md`, "Monthly reserve
release"). An EVM month's released gross therefore always equals its admitted
gross, with no remainder and no leaf award left beside it. On Solana a
per-leaf release also counts as released, so the rule is stated for both
networks over months without a released leaf: such a month's released gross
is its whole admitted gross, with no remainder, no leaf award and no released
leaf beside it. It rests on a month that a leaf has touched always holding
less remainder than it admitted (a legacy V1 month admits no pool gross).

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
pure def alwaysEvmReleaseWhole(e: Escrow): bool = e.asset.network != Solana implies e.months.every(m =>
  M::positiveAmount(m.released) implies M::equalAmounts(m.released, m.admittedGross) and M::equalAmounts(m.remaining, M::zero)
    and not(e.awards.some(a => a.origin == MonthlyLeaf and a.period == m.period)))
pure def leafTouched(e: Escrow, period: int): bool =
  e.awards.some(a => a.origin == MonthlyLeaf and a.period == period) or e.releasedLeaves.some(l => l.period == period)
pure def alwaysTouchedMonthsShrink(e: Escrow): bool = e.months.every(m => leafTouched(e, m.period) implies
  (M::compareAmounts(m.remaining, m.admittedGross) < 0 or not(M::positiveAmount(m.admittedGross))))
pure def alwaysReleaseWhole(e: Escrow): bool = e.months.every(m =>
  (M::positiveAmount(m.released) and not(e.releasedLeaves.some(l => l.period == m.period))) implies
    (M::equalAmounts(m.released, m.admittedGross) and M::equalAmounts(m.remaining, M::zero) and not(leafTouched(e, m.period))))
pure def lawNoLeafAfterRelease(e: Escrow, proof: LeafProof, ev: ChainEvent): bool =
  M::positiveAmount(monthFor(e, proof.period).released) and M::equalAmounts(monthFor(e, proof.period).remaining, M::zero)
    implies not(canMaterialize(e, proof, ev))
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
admitted, and a monthly leaf belongs to an admitted month. The pledged total
is the sum of the open pledges and the free balance always covers it; each
period holds one positive pledge, a bounty vault and a vault not yet created
hold none, and on EVM an open pledge's period has no admitted root.

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
pure def alwaysPledgesCovered(e: Escrow): bool =
  M::equalAmounts(e.pledged, openPledged(e.pledges)) and M::validAmount(e.pledged) and M::compareAmounts(e.free, e.pledged) >= 0
    and e.pledges.every(p => validPeriod(p.period) and M::validAmount(p.amount) and M::positiveAmount(p.amount)
      and e.pledges.select(o => o.period == p.period).length() == 1
      and (p.open and hasMonth(e, p.period) implies e.asset.network == Solana))
    and ((e.purpose == BountyPurpose or not(e.deployed)) implies e.pledges.length() == 0)
pure def alwaysUndeployedEmpty(e: Escrow): bool = not(e.deployed) implies e.at == origin and e.awards.length() == 0
  and e.months.length() == 0 and e.withdrawals.length() == 0 and M::equalAmounts(e.deposited, M::zero)
```

### Identity, history and cumulative counters never go backwards

The vault, asset, purpose, owner and fee recipient never change. Awards,
months and withdrawals are append-only, an award's terms never change, and a
paid award never changes again. Cumulative deposited, paid, fee and
withdrawal counters never decrease. Pool gross leaves the reserve only by a
proven leaf or an authorized release. Free funds leave only by an owner
award, a root admission or an owner withdrawal, and rise only by a deposit or
a release of monthly pool gross: a whole reserve release, or on Solana one
uncommittable leaf. A proven leaf, a payment, a fee claim and a pledge
closing never credit free funds. A manual award never happens while pool
gross is pending. A period's root is admitted only once. An open pledge stays
open and never falls until its own period is admitted, or until it expires
because its window has closed or, on Solana, because its month exists; an
admission never closes or lowers another period's pledge.

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
pure def stepFreeEntersOnlyByDepositOrRelease(before: Escrow, via: str, after: Escrow): bool =
  M::compareAmounts(after.free, before.free) > 0 implies (via == "deposit" or via == "releaseReserve" or via == "releaseLeaf")
pure def pledgeClosable(before: Escrow, via: str, after: Escrow, period: int): bool =
  ((via == "admitRoot" or via == "admitLegacyMonth") and hasMonth(after, period) and not(hasMonth(before, period)))
    or (via == "expirePledge" and (after.clock >= closesAt(period) or (before.asset.network == Solana and hasMonth(before, period))))
pure def stepPledgeIrrevocable(before: Escrow, via: str, after: Escrow): bool = before.pledges.every(p => p.open implies
  (pledgeOf(after, p.period).open and M::compareAmounts(pledgeOf(after, p.period).amount, p.amount) >= 0)
    or pledgeClosable(before, via, after, p.period))
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

### Pool deposits, withdrawals, leaves after opt-out, releases, pledges and fee claims are reachable

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
pure def sometimesPledgedAdmittedWhileOff(e: Escrow): bool = not(e.monthlyEnabled) and e.admissionsWhileOff > 0
  and e.pledges.some(p => not(p.open) and hasMonth(e, p.period))
pure def sometimesPledgeExpired(e: Escrow): bool = e.pledges.some(p => not(p.open) and not(hasMonth(e, p.period)))
pure def sometimesLegacyMonthCountsExistingOnce(e: Escrow): bool = e.months.some(m => m.allocationDigest == "v1")
  and e.awards.some(a => a.origin == ManualAward and a.source.period == 202611)
```

### Simulation samples reach the November 2026 window

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules. The November 2026
window opens at 1796342400 (4 December 00:00 UTC) and closes at 1799020800.
Discovered by simulation: a pledge needs its period not yet ended, so two
events in November 2026 (block 0) let a deposit and then a pledge for
November or December 2026 happen before the November window opens, and the
pledge samples reach a pledged admission with commitments off and an expired
pledge after the window closes.
Discovered by simulation: a pledge reaches admission only for a period with
an open window or one just ended, so the pledge periods, the expiry periods
and the first pledged period are November and December 2026; a count of two
pledges both in one EVM call, and a count of twelve with an amount of one
base unit reaches the twelve-period bound (November 2026 to October 2027)
within two deposits, while thirteen is refused; amounts of five and eight
reach a pledge above the monthly cap, which raises it, and a pledge as large
as the free balance, which blocks other spending.
Discovered by proof: a deposit parameter named `deposit` shadowed the
`deposit` transition in the generated Dafny, so it is named `funds` and its
samples `fundsValues`; the samples themselves are unchanged.

```quint
pure val evValues = Set(
  { block: 0, index: 1, time: 1795000000, transaction: "t0" },
  { block: 0, index: 2, time: 1795000100, transaction: "t0b" },
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
pure val fundsValues = Set({ vault: "vault", network: Base, token: "usdc", amount: List(8) },
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
  frozenAt: 1796342400, signer: "attester", pledgeAccount: false }
pure val authorizationValues = Set(rootAuthorization, { ...rootAuthorization, network: Solana },
  { ...rootAuthorization, network: Solana, pledgeAccount: true },
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
pure val weight_pledgeMonths = 6
pure val weight_expirePledge = 6
pure val fromPeriodValues = Set(202611, 202612)
pure val countValues = Set(1, 2, 12, 13)
pure val amountValues = Set(List(1), List(5), List(8))
pure val periodValues = Set(202611, 202612)
pure val legacyValues = Set({ period: 202611, vault: "vault", root: "v1", signer: "attester",
  entries: List({ source: sampleKey(202611, 1), actor: 1, gross: List(4) }, { source: sampleKey(202611, 2), actor: 2, gross: List(1) }) },
  { period: 202611, vault: "vault", root: "v1", signer: "attester",
  entries: List({ source: sampleKey(202611, 1), actor: 1, gross: List(50) }) })
```
