# Owner month lock card

PRD section 6 (operator decision, 15 November 2026): the owner locks this
month and the next ones in a vault with month locks, from the funding page.
Sources at Slop development `df21e37b7`: `src/VaultMonthLock.tsx` (the card,
its send and its check loop), `src/EscrowFunding.tsx:379–470` (one card per
recorded vault whose cached read shows pledge support, on a monthly-pool
project, sharing the funding form's wallet, the monthly amount from the
reward cap at the current UTC month, a vault re-read after a lock) and
`src/lib/evm-month-lock.ts`; the retained development model is
`formal/models/ui/ui_vault_month_lock.qnt`. The decisions are the
[vault month locks](./vaultLocks.md) library's.

One instance is the card of one registered vault. Its chain facts are the
vault's free funds, its open locked total and the part of it whose month
lapsed unreserved; the card shows the locked total of the last finalized
read. The sender `by` is a connected wallet (positive; the vault owner's
wallet is the `owner` the finalized read reports, development
`deployment.owner`), the finalized vault read (`0`), the wallet and chain adapter
(`-1`) or the card's check timer (`-2`). Development keeps a sent lock or
release only in page memory, not in a saved [wallet attempt](./walletAttempt.md)
(decided from development 67fd54fd4, 17 November 2026).

## Story: Lock months from the owner's wallet

### The card appears only once the finalized read shows pledge support

A vault without pledge support has no card. The first finalized read gives
the vault owner's wallet, the free funds and the open locked total, taken as
the chain reports them: development's own model lets the open locked total
exceed the free funds outside an included lock
(`ui_vault_month_lock.qnt`, `invariant`), and the card still appears.
Every later finalized read carries the same facts again and replaces the
card's own: after a lock, and whenever the shell re-reads the vault (a
deposit or withdrawal through the funding form, a lock or release sent from
another tab, a review), so the card never shows or reviews against figures
the chain no longer reports. A re-read leaves a review, and an included lock
or release, back on the idle card; a read without pledge support hides it.

```quint
import vaultLocks as VL from "./vaultLocks"
import money as M from "../settlement/money"
import monthPledges as MP from "../settlement/monthPledges"
type LockPhase = LockHidden | LockIdle | LockReviewed | LockAwaiting | LockChecking | LockIncluded
type LockKind = LockingMonths | ReleasingMonth
type LockReply = LockSigned | LockDeclined | LockUnclear
type LockResult = ChainPending | ChainFailed | ChainIncluded | ChainUnreadable
type LockNotice = LockQuiet | LockSentNotice | WalletDeclinedNotice | WalletUnclearNotice | LockFailedNotice
  | ReleaseFailedNotice | LockedNotice | ReleasedNotice | CheckUnreadableNotice
type MonthLock = { phase: LockPhase, wallet: int, owner: int, free: M::Amount, locked: M::Amount, lapsed: M::Amount,
  shownLocked: M::Amount, kind: LockKind, added: M::Amount, deposit: M::Amount, released: M::Amount,
  refusal: VL::LockRefusal, notice: LockNotice, checks: int }
pure val reader = 0
pure val adapter = -1
pure val timer = -2
pure val checkLimit = 720
pure val checkIntervalMs = 5000
pure val initial: MonthLock = { phase: LockHidden, wallet: 0, owner: 0, free: M::zero, locked: M::zero, lapsed: M::zero,
  shownLocked: M::zero, kind: LockingMonths, added: M::zero, deposit: M::zero, released: M::zero,
  refusal: VL::NoLockRefusal, notice: LockQuiet, checks: 0 }
pure def canReadVault(m: MonthLock, supported: bool, owner: int, free: M::Amount, locked: M::Amount, by: int): bool =
  by == reader and (m.phase == LockHidden or m.phase == LockIdle or m.phase == LockReviewed or m.phase == LockIncluded)
    and owner > 0 and M::validAmount(free) and M::validAmount(locked)
pure def readVault(m: MonthLock, supported: bool, owner: int, free: M::Amount, locked: M::Amount, by: int): MonthLock =
  if (supported) { ...m, phase: LockIdle, owner: owner, free: free, locked: locked, lapsed: M::zero, shownLocked: locked }
  else { ...m, phase: LockHidden }
pure def canConnect(m: MonthLock, wallet: int, by: int): bool = wallet > 0 and by == wallet and wallet != m.wallet
  and (m.phase == LockHidden or m.phase == LockIdle or m.phase == LockReviewed)
pure def connect(m: MonthLock, wallet: int, by: int): MonthLock =
  { ...m, wallet: wallet, phase: if (m.phase == LockReviewed) LockIdle else m.phase, refusal: VL::NoLockRefusal }
```

### A review runs the lock refusals against the card's own read, and only the owner's accepted review can be sent

The review reads the months of the lock's range through the wallet
(`existing`, one pledge per month for a valid count). The owner check
compares the connected wallet with the owner of the card's read. A refused review shows
its refusal and keeps the card idle. An accepted one records what the lock
adds and the deposit sent with it.

```quint
pure def canReview(m: MonthLock, count: int, amount: M::Amount, monthly: M::Amount, existing: List[MP::ChainPledge],
  deposit: M::Amount, batches: bool, by: int): bool =
  m.wallet > 0 and by == m.wallet and (m.phase == LockIdle or m.phase == LockReviewed)
    and M::validAmount(amount) and M::validAmount(monthly) and M::validAmount(deposit)
    and existing.every(e => M::validAmount(e.amount))
    and (VL::validLockCount(count) implies existing.length() == count)
pure def review(m: MonthLock, count: int, amount: M::Amount, monthly: M::Amount, existing: List[MP::ChainPledge],
  deposit: M::Amount, batches: bool, by: int): MonthLock =
  val request = { count: count, amount: amount, monthly: monthly, existing: existing, depositGross: deposit,
    batches: batches, owner: m.wallet == m.owner, free: m.free, locked: m.locked }
  val refusal = VL::lockRefusal(request)
  if (refusal != VL::NoLockRefusal) { ...m, phase: LockIdle, refusal: refusal, notice: LockQuiet }
  else { ...m, phase: LockReviewed, kind: LockingMonths, added: VL::lockAdded(request), deposit: deposit,
    released: M::zero, refusal: VL::NoLockRefusal, notice: LockQuiet }
pure def canRequestLock(m: MonthLock, by: int): bool = m.wallet > 0 and by == m.wallet and m.phase == LockReviewed
pure def requestLock(m: MonthLock, by: int): MonthLock = { ...m, phase: LockAwaiting, kind: LockingMonths, notice: LockQuiet }
```

### A lapsed month stays locked until any connected wallet sends its release

A month whose window closed unreserved stays in the open locked total and is
listed as releasable; the card offers its release to whichever wallet is
connected, the owner's or another.

```quint
pure def canLapse(m: MonthLock, monthAmount: M::Amount, by: int): bool = by == reader and m.phase == LockIdle
  and M::validAmount(monthAmount) and M::positiveAmount(monthAmount)
  and M::compareAmounts(M::addAmounts(m.lapsed, monthAmount), m.locked) <= 0
pure def lapse(m: MonthLock, monthAmount: M::Amount, by: int): MonthLock = { ...m, lapsed: M::addAmounts(m.lapsed, monthAmount) }
pure def canRequestRelease(m: MonthLock, monthAmount: M::Amount, by: int): bool = m.wallet > 0 and by == m.wallet
  and m.phase == LockIdle and M::validAmount(monthAmount) and M::positiveAmount(monthAmount)
  and M::compareAmounts(monthAmount, m.lapsed) <= 0
pure def requestRelease(m: MonthLock, monthAmount: M::Amount, by: int): MonthLock =
  { ...m, phase: LockAwaiting, kind: ReleasingMonth, released: monthAmount, refusal: VL::NoLockRefusal, notice: LockQuiet }
```

### A declined or unclear wallet request sends nothing new, and a sent one is checked every five seconds at most 720 times

A declined request says "You declined the wallet request. Nothing was sent.";
an unclear one says to check wallet activity before another attempt. Both
return the card to its review, or to idle for a release. A returned hash or
batch reference starts the automatic check. A check loop that reaches its
720th check takes an hour of five-second checks and lies beyond a
simulation's run; `alwaysChecksWithinLimit` bounds it.

```quint
pure def canWalletAnswer(m: MonthLock, reply: LockReply, by: int): bool = by == adapter and m.phase == LockAwaiting
pure def walletAnswer(m: MonthLock, reply: LockReply, by: int): MonthLock =
  val back = if (m.kind == LockingMonths) LockReviewed else LockIdle
  if (reply == LockSigned) { ...m, phase: LockChecking, checks: 0, notice: LockSentNotice }
  else { ...m, phase: back, notice: if (reply == LockDeclined) WalletDeclinedNotice else WalletUnclearNotice }
```

### A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it

A failed lock says "The lock transaction failed. Nothing was locked." (with a
deposit, "The deposit and lock were not completed. Nothing was locked."); a
failed release says "The release failed. The month is still locked." An
unreadable check shows why and keeps checking. An included lock adds to the
locked total and its deposit to the free funds; an included release frees its
month. The shown locked total follows only the finalized read, and never
exceeds the locked total. The finalized read is `readVault` arriving while
the card shows the included transaction.

```quint
pure def canCheck(m: MonthLock, result: LockResult, by: int): bool = by == timer and m.phase == LockChecking
  and m.checks < checkLimit
pure def check(m: MonthLock, result: LockResult, by: int): MonthLock =
  val counted = { ...m, checks: m.checks + 1 }
  val remaining = if (M::compareAmounts(m.released, m.locked) <= 0) M::subtractAmounts(m.locked, m.released) else m.locked
  val lapsedLeft = if (M::compareAmounts(m.released, m.lapsed) <= 0) M::subtractAmounts(m.lapsed, m.released) else m.lapsed
  if (result == ChainPending) counted
  else if (result == ChainUnreadable) { ...counted, notice: CheckUnreadableNotice }
  else if (result == ChainFailed) { ...counted, phase: LockIdle,
    notice: if (m.kind == LockingMonths) LockFailedNotice else ReleaseFailedNotice }
  else if (m.kind == LockingMonths) { ...counted, phase: LockIncluded, locked: M::addAmounts(m.locked, m.added),
    free: M::addAmounts(m.free, m.deposit), notice: LockedNotice }
  else { ...counted, phase: LockIncluded, locked: remaining, lapsed: lapsedLeft,
      shownLocked: if (M::compareAmounts(m.shownLocked, remaining) > 0) remaining else m.shownLocked, notice: ReleasedNotice }
```

### Rules

```quint
pure def pendingLock(m: MonthLock): bool = m.kind == LockingMonths
  and (m.phase == LockReviewed or m.phase == LockAwaiting or m.phase == LockChecking)
pure def pendingRelease(m: MonthLock): bool = m.kind == ReleasingMonth and (m.phase == LockAwaiting or m.phase == LockChecking)
pure def alwaysLocksWithinFreeFunds(m: MonthLock): bool =
  ((m.phase == LockIncluded and m.kind == LockingMonths) implies M::compareAmounts(m.locked, m.free) <= 0)
  and M::compareAmounts(m.lapsed, m.locked) <= 0 and M::compareAmounts(m.shownLocked, m.locked) <= 0
pure def alwaysPendingLockFits(m: MonthLock): bool = pendingLock(m) implies
  M::compareAmounts(M::addAmounts(m.locked, m.added), M::addAmounts(m.free, m.deposit)) <= 0
pure def alwaysPendingReleaseIsLapsed(m: MonthLock): bool = pendingRelease(m) implies
  M::positiveAmount(m.released) and M::compareAmounts(m.released, m.lapsed) <= 0
pure def alwaysOnlyTheOwnerLocks(m: MonthLock): bool = pendingLock(m) implies m.wallet == m.owner
pure def alwaysChecksWithinLimit(m: MonthLock): bool = m.checks >= 0 and m.checks <= checkLimit
pure def alwaysValidAmounts(m: MonthLock): bool = M::validAmount(m.free) and M::validAmount(m.locked) and M::validAmount(m.lapsed)
  and M::validAmount(m.shownLocked) and M::validAmount(m.added) and M::validAmount(m.deposit) and M::validAmount(m.released)
pure def stepOnlyIncludedTransactionsMoveLocks(before: MonthLock, via: str, after: MonthLock): bool =
  (after.locked != before.locked or after.free != before.free) implies (via == "check" or via == "readVault")
pure def sometimesLockShownAfterFinality(m: MonthLock): bool = m.phase == LockIdle and m.notice == LockedNotice
  and M::positiveAmount(m.shownLocked)
pure def sometimesBelowMonthlyRefused(m: MonthLock): bool = m.refusal == VL::BelowMonthlyAmount
pure def sometimesLowerLockRefused(m: MonthLock): bool = m.refusal == VL::LowersLockedMonth
pure def sometimesShortFundsRefused(m: MonthLock): bool = m.refusal == VL::FreeFundsShort
pure def sometimesUnbatchedDepositRefused(m: MonthLock): bool = m.refusal == VL::DepositNotBatched
pure def sometimesOtherWalletRefused(m: MonthLock): bool = m.refusal == VL::NotVaultOwner
pure def sometimesCountRefused(m: MonthLock): bool = m.refusal == VL::LockCountRefused
pure def sometimesFailedLockLocksNothing(m: MonthLock): bool = m.notice == LockFailedNotice
pure def sometimesReleaseFailed(m: MonthLock): bool = m.notice == ReleaseFailedNotice
pure def sometimesWalletDeclined(m: MonthLock): bool = m.notice == WalletDeclinedNotice
pure def sometimesCheckUnreadable(m: MonthLock): bool = m.notice == CheckUnreadableNotice
pure def sometimesDepositAndLockIncluded(m: MonthLock): bool = m.phase == LockIncluded and m.kind == LockingMonths
  and M::positiveAmount(m.deposit)
pure def sometimesReleasedByAnotherWallet(m: MonthLock): bool = m.notice == ReleasedNotice and m.wallet != m.owner
pure def sometimesUnclearKeepsTheReview(m: MonthLock): bool = m.notice == WalletUnclearNotice and m.phase == LockReviewed
pure val byValues = Set(1, 2, reader, adapter, timer)
pure val walletValues = Set(1, 2)
pure val ownerValues = Set(1)
pure val freeValues = Set(List(4))
pure val lockedValues = Set(List(0), List(2))
pure val countValues = Set(1, 2)
pure val amountValues = Set(List(1), List(2), List(3))
pure val monthlyValues = Set(List(2))
pure val existingValues = Set(List({ period: 202612, amount: List(0), open: false }),
  List({ period: 202612, amount: List(3), open: true }))
pure val depositValues = Set(List(0), List(2))
pure val monthAmountValues = Set(List(2))
```
