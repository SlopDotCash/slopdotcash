# Vault month locks

PRD section 6 (operator decision, 15 November 2026): an owner may lock
months in an upgraded vault. One owner transaction pledges an amount for each
of 1, 3, 6 or 12 months from the vault's own current UTC month, only from
free funds not already pledged. A pledge can be raised, never lowered or
cancelled, and the contract refuses a withdrawal or an owner award that would
take pledged funds. The vault contract can still be upgraded by Slop's
upgrade key, so a lock is not a guarantee against that key. Sources at Slop development `df21e37b7`:
`src/lib/evm-month-lock.ts` (`reviewMonthLock`, `assertWithdrawalOutsideLocks`),
`src/lib/month-lock.ts` (`LOCK_MONTH_COUNTS`, `lockPeriods`, `lockEnds`,
`lockReleasable`), `src/VaultMonthLock.tsx` (`LockedMonths`),
`src/EscrowFunding.tsx:364–378` and `src/VaultActions.tsx:264–287`; the
retained development model is `formal/models/ui/ui_vault_month_lock.qnt`.
The [month lock card](./monthLock.md) runs these decisions; the
[owner vault](./ownerVault.md) withdrawal review applies the withdrawal
guard. The contract's own pledge rules belong to the escrow contracts.

## Story: Review a month lock before the wallet is asked

### A lock review refuses a count other than 1, 3, 6 or 12, another wallet, an amount below the monthly amount, a lowered month, short free funds and an unbatchable deposit, in that order

`existing` holds, for each month in the lock's range, its pledge read through
the wallet. A lock adds, for each month, the whole amount when the month has
no open pledge and otherwise what it raises the open pledge by. The counts
are the [month pledges](../settlement/monthPledges.md)' `lockMonthCounts`,
and an open month above the amount is refused as there (`openAtMost`). The free funds, plus a deposit
sent in the same request, must cover the vault's open locked total plus what
the lock adds. A deposit goes with the lock only as one atomic wallet request
([batched deposit](./batchedDeposit.md)); a wallet that cannot send it is
told to deposit first. The monthly amount is the project's reward cap for the
current UTC month: a smaller lock would not fund the month. The Solana lock
is planned by the server route (`backend/payments/solana-month-lock.ts`);
these refusals are the browser's EVM review.

```quint
import money as M from "../settlement/money"
import calendar as C from "../settlement/calendar"
import ledger as L from "../contracts/ledger"
import monthPledges as MP from "../settlement/monthPledges"
import projections as P from "./projections"
type LockRefusal = NoLockRefusal | LockCountRefused | NotVaultOwner | BelowMonthlyAmount | LowersLockedMonth
  | FreeFundsShort | DepositNotBatched
type LockRequest = { count: int, amount: M::Amount, monthly: M::Amount, existing: List[MP::ChainPledge], depositGross: M::Amount,
  batches: bool, owner: bool, free: M::Amount, locked: M::Amount }
pure def validLockCount(count: int): bool = MP::lockMonthCounts.includes(count)
pure def lockAdded(request: LockRequest): M::Amount = request.existing.foldl(M::zero, (total, month) =>
  M::addAmounts(total, if (not(month.open)) request.amount
    else if (M::compareAmounts(request.amount, month.amount) > 0) M::subtractAmounts(request.amount, month.amount) else M::zero))
pure def lowersALock(request: LockRequest): bool =
  not(MP::openAtMost(MP::PledgesRead({ openPledged: request.locked, pledges: request.existing }), request.amount))
pure def freeFundsCover(request: LockRequest): bool =
  M::compareAmounts(M::addAmounts(request.free, request.depositGross), M::addAmounts(request.locked, lockAdded(request))) >= 0
pure def lockRefusal(request: LockRequest): LockRefusal =
  if (not(validLockCount(request.count))) LockCountRefused
  else if (not(request.owner)) NotVaultOwner
  else if (M::compareAmounts(request.amount, request.monthly) < 0) BelowMonthlyAmount
  else if (lowersALock(request)) LowersLockedMonth
  else if (not(freeFundsCover(request))) FreeFundsShort
  else if (M::positiveAmount(request.depositGross) and not(request.batches)) DepositNotBatched
  else NoLockRefusal
pure def lawAcceptedLockFundsTheMonth(request: LockRequest): bool =
  lockRefusal(request) == NoLockRefusal implies request.owner and validLockCount(request.count)
    and M::compareAmounts(request.amount, request.monthly) >= 0
pure def lawALockIsNeverLowered(request: LockRequest): bool =
  lockRefusal(request) == NoLockRefusal implies request.existing.every(month => not(month.open)
    or M::compareAmounts(month.amount, request.amount) <= 0)
pure def lawAcceptedLockFitsFreeFunds(request: LockRequest): bool =
  lockRefusal(request) == NoLockRefusal implies freeFundsCover(request)
pure def lawDepositOnlyAsOneRequest(request: LockRequest): bool =
  (lockRefusal(request) == NoLockRefusal and M::positiveAmount(request.depositGross)) implies request.batches
pure val unlockedMonth: MP::ChainPledge = { period: 202612, amount: List(0), open: false }
pure val lockRequest: LockRequest = { count: 1, amount: List(2), monthly: List(2), existing: List(unlockedMonth), depositGross: List(0),
  batches: true, owner: true, free: List(4), locked: List(0) }
pure val requestValues = Set(lockRequest, { ...lockRequest, count: 2 }, { ...lockRequest, owner: false },
  { ...lockRequest, amount: List(1) }, { ...lockRequest, existing: List({ ...unlockedMonth, amount: List(3), open: true }) },
  { ...lockRequest, existing: List({ ...unlockedMonth, amount: List(3) }) }, { ...lockRequest, free: List(1) },
  { ...lockRequest, depositGross: List(2), batches: false }, { ...lockRequest, free: List(0), depositGross: List(2) })
```

### A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it

Months are `YYYYMM`, counted by the [calendar](../settlement/calendar.md)'s
`addPeriods`. A lock starts at the vault contract's `currentPeriod`, never a
month the browser computed. A month leaves the lock when it is
reserved for payout. One never reserved stays locked after its commit window
closes, at 00:00 UTC on the 4th of the second month after it (the
[escrow ledger](../contracts/ledger.md)'s `closesAt`, where both contracts
let a pledge expire; the shell passes the current instant in seconds), until a release
transaction is sent (`expirePledge` on EVM, `expire_pledge` on Solana); any
connected wallet may send it. The card lists every open lock: an open month
before then says it is locked until paid out and from which day it can be
released; an open month from then offers its release. A closed lock is not
listed, and a vault with no open lock says "No months are locked in this
vault."

```quint
type LockedLine = NotListed | LockedUntilPaid | ReleasableMonth
pure val noLockedMonthsText = "No months are locked in this vault."
pure def lockPeriod(firstPeriod: int, index: int): int = C::addPeriods(firstPeriod, index)
pure def lockedLine(month: MP::ChainPledge, now: int): LockedLine =
  if (not(month.open)) NotListed else if (now >= L::closesAt(month.period)) ReleasableMonth else LockedUntilPaid
pure def lawLockStartsAtItsMonth(firstPeriod: int): bool =
  MP::validPledgePeriod(firstPeriod) implies lockPeriod(firstPeriod, 0) == firstPeriod
pure def lawDecemberRollsIntoJanuary(index: int): bool = index == 1 implies lockPeriod(202612, index) == 202701
pure def lawReleasableFromTheFourth(month: MP::ChainPledge): bool = (month.period == 202612 and month.open)
  implies (lockedLine(month, 1801699199) == LockedUntilPaid and lockedLine(month, 1801699200) == ReleasableMonth)
pure def lawClosedLockIsNotListed(month: MP::ChainPledge, now: int): bool =
  not(month.open) implies lockedLine(month, now) == NotListed
pure val firstPeriodValues = Set(202611, 202612)
pure val indexValues = Set(0, 1, 11)
pure val monthValues = Set({ period: 202612, amount: List(2), open: true }, { period: 202612, amount: List(2), open: false })
pure val nowValues = Set(1801699199, 1801699200)
```

## Story: Withdraw only funds the month's promise or locks leave free

### A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them

`cachedSupport` is the cached vault read's pledge support for this vault.
`walletRead` is true when the review read the vault's open locked total
through the wallet (EVM) and the vault supports locks; an unreadable read, a
vault without locks, and a Solana vault leave it false, and the review then
passes on locks because the contract still refuses locked funds when the
transaction is sent. `freeKnown` is false when the review could not read the
free balance. A withdrawal that would leave the free funds below the open
locked total is refused (development `assertWithdrawalOutsideLocks`, which
also refuses a gross above the free funds when nothing is locked) with "These funds are locked for a month that has not
been paid out yet. Withdraw only funds above the locked months." The page's
promised-amount guard ([projections](./projections.md),
`withdrawalAllowedOnSlopPages`) applies only when neither read shows locks
and the month is not Funded by pledges. A Solana vault's refusal is the
server review's, `withdrawTakesPledgedFunds` of the
[month pledges](../settlement/monthPledges.md), and reaches the page as a
refused review.

```quint
type VaultLocks = { cachedSupport: bool, walletRead: bool, freeKnown: bool, free: M::Amount, locked: M::Amount }
pure val lockedFundsText = "These funds are locked for a month that has not been paid out yet. Withdraw only funds above the locked months."
pure def lockRefusesWithdrawal(locks: VaultLocks, withdrawal: M::Amount): bool = locks.walletRead and locks.freeKnown
  and M::compareAmounts(locks.free, M::addAmounts(locks.locked, withdrawal)) < 0
pure def pageGuardApplies(pool: P::PoolFacts, locks: VaultLocks): bool =
  not(locks.cachedSupport) and not(locks.walletRead) and not(P::lockedByPledges(pool))
pure def withdrawalAllowed(pool: P::PoolFacts, locks: VaultLocks, withdrawal: M::Amount): bool =
  not(lockRefusesWithdrawal(locks, withdrawal))
    and (not(pageGuardApplies(pool, locks)) or P::withdrawalAllowedOnSlopPages(pool, withdrawal))
pure def lawAllowedWithdrawalLeavesTheLocks(pool: P::PoolFacts, locks: VaultLocks, withdrawal: M::Amount): bool =
  (withdrawalAllowed(pool, locks, withdrawal) and locks.walletRead and locks.freeKnown)
    implies M::compareAmounts(locks.free, M::addAmounts(locks.locked, withdrawal)) >= 0
pure def lawUnreadLocksLeaveItToTheContract(locks: VaultLocks, withdrawal: M::Amount): bool =
  not(locks.walletRead) implies not(lockRefusesWithdrawal(locks, withdrawal))
pure def lawLockVaultSkipsThePageGuard(pool: P::PoolFacts, locks: VaultLocks, withdrawal: M::Amount): bool =
  (locks.cachedSupport and not(locks.walletRead)) implies withdrawalAllowed(pool, locks, withdrawal)
pure def lawVaultWithoutLocksKeepsThePromise(pool: P::PoolFacts, locks: VaultLocks, withdrawal: M::Amount): bool =
  (not(locks.cachedSupport) and not(locks.walletRead) and not(P::lockedByPledges(pool)))
    implies withdrawalAllowed(pool, locks, withdrawal) == P::withdrawalAllowedOnSlopPages(pool, withdrawal)
pure val noLocks: VaultLocks = { cachedSupport: false, walletRead: false, freeKnown: true, free: List(25), locked: List(0) }
pure val locksValues = Set(noLocks, { ...noLocks, cachedSupport: true }, { ...noLocks, cachedSupport: true, walletRead: true, locked: List(20) },
  { ...noLocks, cachedSupport: true, walletRead: true, locked: List(20), freeKnown: false })
```
