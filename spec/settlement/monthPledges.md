# Month pledges and month locks

PRD section 6 and the operator decision of 15 November 2026 let an owner lock
months in an upgraded vault: one owner transaction pledges one amount to each
of 1 to 12 months from the current UTC month, only from free funds not
already pledged, and a pledge can be raised but never lowered or cancelled.
The contract then refuses a withdrawal or owner award that would take pledged
funds, a pledged month may be reserved with automatic payment off, a pledge
closes when its month is reserved, and one never reserved stays locked after
the month's commit window closes until anyone sends its release. The vault
contract can still be upgraded by Slop's upgrade key, so a lock is not a
guarantee against that key.

This library states what Slop does with the facts a finalized vault read
gives: each month's pledge amount and whether it is open, and the vault's
open pledged total. The contract rules themselves are the contracts area's
([EVM escrow](../contracts/evmEscrow.md), [Solana escrow](../contracts/solanaEscrow.md)).
[Vault observations](./vaultSnapshots.md) keep the pledges read with each
ordinary vault read; [monthly allocations](./monthly.md), the
[root authorization journal](./monthlyCommitment.md) and
[owner-signed transactions](./ownerTransactions.md) take the facts these
definitions compute. Source anchors are development df21e37b7
`backend/payments/month-pledges.ts`, `month-pledge-readers.ts`,
`vault-snapshots.ts` (`recordMonthPledges`), `monthly.ts`,
`monthly-attestation.ts`, `monthly-publication.ts`, `solana-month-lock.ts`,
`solana-funding.ts`, `workers/payments/index.ts`
(`storedOpenPledgePeriods`, `readDeploymentMonthPledges`),
`contracts/solana/month-pledge.ts`, `src/lib/month-lock.ts` and migration
`0128_vault_month_pledges.sql`; development's own model is
`formal/models/rewards/monthly_month_pledge.qnt`.

## Story: Keep each vault's month pledges with its finalized read

### A finalized read reports no pledge support, or each month's pledge and the vault's open total

A vault whose contract has no pledge support, such as a Solana project not
yet migrated to the 340-byte layout or an EVM vault while no reader exists,
reads as no pledge support, never as zero pledged. Otherwise the read names,
for each month asked, its amount and whether it is open (a month with no
pledge account reads as zero and not open), and the vault's open pledged
total. A month is written `YYYYMM` as the contracts number periods, a
six-digit year and month from 01 to 12. Every amount is below 2^128 and no
month appears twice. A read that breaks any of this is refused, and counts as
a read that was not taken: the counters of the same vault read still store.

```quint
import money as M from "./money"
import calendar as C from "./calendar"
type ChainPledge = { period: int, amount: M::Amount, open: bool }
type PledgeRead = PledgesNotRead | NoPledgeSupport | PledgesRead({ openPledged: M::Amount, pledges: List[ChainPledge] })
type StoredPledge = { network: str, vault: str, period: int, amount: M::Amount, open: bool, block: M::Amount }
type StoredTotal = { supported: bool, amount: M::Amount }
pure val noChainPledge: ChainPledge = { period: 0, amount: M::zero, open: false }
pure val noStoredPledge: StoredPledge = { network: "", vault: "", period: 0, amount: M::zero, open: false, block: M::zero }
pure val noStoredTotal: StoredTotal = { supported: false, amount: M::zero }
pure def validPledgePeriod(period: int): bool =
  period >= 100001 and period <= 999912 and period % 100 >= 1 and period % 100 <= 12
pure def validPledges(openPledged: M::Amount, pledges: List[ChainPledge]): bool =
  M::withinMaximum(openPledged, M::maxU128) and pledges.every(p => validPledgePeriod(p.period)
    and M::withinMaximum(p.amount, M::maxU128) and pledges.select(o => o.period == p.period).length() == 1)
pure def acceptedRead(read: PledgeRead): PledgeRead = match read {
  | PledgesRead(x) => if (validPledges(x.openPledged, x.pledges)) read else PledgesNotRead
  | _ => read }
```

### Each month keeps the read of the newest block, and a read not taken changes nothing

After a vault read is stored, each month it read replaces that month's stored
row only when the read's block is the same as or newer than the row's; a
month first read is added. A row is never deleted, so a pledge that closed
stays stored with its amount. The vault's stored open total becomes the
read's total, or "no pledge support" for a vault without it. A pledge read
that failed or was not taken leaves every stored row and the stored total as
they were and does not fail the counters. A failed write of the pledge rows
fails the refresh, so the next one retries it.

```quint
pure def samePledge(row: StoredPledge, network: str, vault: str, period: int): bool =
  row.network == network and row.vault == vault and row.period == period
pure def readFor(pledges: List[ChainPledge], period: int): ChainPledge =
  pledges.select(p => p.period == period).nthOr(0, noChainPledge)
pure def refreshedPledge(row: StoredPledge, network: str, vault: str, block: M::Amount, pledges: List[ChainPledge]): StoredPledge =
  if (row.network == network and row.vault == vault and pledges.some(p => p.period == row.period)
    and M::compareAmounts(block, row.block) >= 0)
    { ...row, amount: readFor(pledges, row.period).amount, open: readFor(pledges, row.period).open, block: block }
  else row
pure def storePledges(stored: List[StoredPledge], network: str, vault: str, block: M::Amount, pledges: List[ChainPledge]): List[StoredPledge] =
  stored.listMap(row => refreshedPledge(row, network, vault, block, pledges)).concat(
    pledges.select(p => not(stored.some(row => samePledge(row, network, vault, p.period))))
      .listMap(p => { network: network, vault: vault, period: p.period, amount: p.amount, open: p.open, block: block }))
pure def storePledgeRead(stored: List[StoredPledge], network: str, vault: str, block: M::Amount, read: PledgeRead): List[StoredPledge] =
  match read {
    | PledgesRead(x) => storePledges(stored, network, vault, block, x.pledges)
    | _ => stored }
pure def storedTotalAfter(total: StoredTotal, read: PledgeRead): StoredTotal = match read {
  | PledgesRead(x) => { supported: true, amount: x.openPledged }
  | NoPledgeSupport => noStoredTotal
  | PledgesNotRead => total }
pure def lawUnreadChangesNothing(storedPledges: List[StoredPledge], storedTotal: StoredTotal): bool =
  storePledgeRead(storedPledges, "Base", "vault", List(9), PledgesNotRead) == storedPledges
    and storedTotalAfter(storedTotal, PledgesNotRead) == storedTotal
pure def lawUnsupportedKeepsRowsAndClearsTotal(storedPledges: List[StoredPledge], storedTotal: StoredTotal): bool =
  storePledgeRead(storedPledges, "Base", "vault", List(9), NoPledgeSupport) == storedPledges
    and storedTotalAfter(storedTotal, NoPledgeSupport) == noStoredTotal
pure val storedPledgesValues = Set(List(),
  List({ network: "Base", vault: "vault", period: 202612, amount: List(5), open: true, block: List(1) }))
pure val storedTotalValues = Set(noStoredTotal, { supported: true, amount: List(5) })
```

### A refresh reads the previous UTC month, the next eleven after the current one, and every month still stored open

The months asked are the thirteen from the UTC month before the read's
finalized block time, and every month whose stored pledge for that vault is
still open, so a lapsed lock stays read until its release closes it. The
shell asks them once each, in ascending order. EVM reads at the totals'
block, Solana at the finalized commitment.

```quint
pure def pledgeReadWindow(blockTime: int): List[int] =
  List(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12).listMap(i => C::addPeriods(C::utcPeriod(blockTime), i - 1))
pure def storedOpenPeriods(stored: List[StoredPledge], network: str, vault: str): List[int] =
  stored.select(p => p.network == network and p.vault == vault and p.open).listMap(p => p.period)
pure def readsPeriod(blockTime: int, stored: List[StoredPledge], network: str, vault: str, period: int): bool =
  pledgeReadWindow(blockTime).includes(period) or storedOpenPeriods(stored, network, vault).includes(period)
```

### Pool funding serves a vault's open total, or none without pledge support, with its pledges above zero from the previous UTC month on and every one still open

Each vault row of `GET /api/v1/pool-funding` carries the stored open total as
`openPledgedGross` in base units, null for a vault without pledge support,
and its stored pledges above zero (`pledges`, each a `YYYY-MM` month, an
amount in base units and whether it is open) for the UTC month before the
request and every later month, and every pledge still open, so an owner sees
a lapsed lock until its release; a vault without pledge support serves none.
They are served in ascending month order, under the same testnet rule as the
other rows of that route ([public payment records](./publicRecords.md)).
Source: development `backend/projects/pool-funding.ts`
(`readPoolFundingProjects`, `recentPeriods`).

```quint
pure def servedPledge(row: StoredPledge, network: str, vault: str, now: int): bool =
  row.network == network and row.vault == vault and M::positiveAmount(row.amount)
    and (row.open or row.period >= C::addPeriods(C::utcPeriod(now), -1))
pure def servedPledges(total: StoredTotal, stored: List[StoredPledge], network: str, vault: str, now: int): List[StoredPledge] =
  if (total.supported) stored.select(row => servedPledge(row, network, vault, now)) else List()
```

## Story: A pledge is the owner's consent to reserve its month

### Only a stored pledge above zero in the vault that pays the month counts, and never for a retired project

A month is pledged when the vault that pays it has a stored row for it with
an amount above zero, open or since closed: a closed pledge was either
reserved or lapsed after its window, which the window checks already refuse.
A pledge in another vault of the project, such as a replaced one, gives no
consent. A pledge lets a paused or restricted project's month go ahead with
automatic payment off; retirement ends that consent.

```quint
pure def pledgedIn(stored: List[StoredPledge], network: str, vault: str, period: int): bool =
  stored.some(p => samePledge(p, network, vault, period) and M::positiveAmount(p.amount))
pure def pledgeConsents(pledged: bool, retired: bool): bool = pledged and not(retired)
```

### Publication, a newer attempt and on-chain admission need a pledge in the run's own vault or the automatic default on

The publisher's atomic inserts of the first authorization and of a newer
attempt, and the dispatcher's admission of a published month, accept a
month when the frozen run's own vault holds a stored pledge for that month
above zero, or when the project's automatic default is on (`runConsent`).
Retirement is not part of this test; the attester already refuses a retired
project's unpledged month and signs a pledged one only while the project is
not retired.

```quint
pure def runConsent(runVaultPledged: bool, automatic: bool): bool = runVaultPledged or automatic
```

### Another month's open pledge is held back from this month's funding

The contract never lets one month take another month's pledge, so the
coordinator holds back the vault's stored open total less this month's own
open pledge. A vault with no pledge support holds back nothing.

```quint
pure def ownOpenPledge(stored: List[StoredPledge], network: str, vault: str, period: int): M::Amount =
  stored.select(p => samePledge(p, network, vault, period) and p.open).nthOr(0, noStoredPledge).amount
pure def otherOpenPledges(total: StoredTotal, stored: List[StoredPledge], network: str, vault: str, period: int): M::Amount =
  val own = ownOpenPledge(stored, network, vault, period)
  if (total.supported and M::compareAmounts(total.amount, own) > 0) M::subtractAmounts(total.amount, own) else M::zero
```

## Story: The owner locks months and anyone releases a lapsed lock

### A lock covers 1, 3, 6 or 12 months from the current UTC month at one positive amount

The months start at the UTC month of the request, as the program's clock
does. The amount is parsed to the mint's decimals and must be positive
(`invalid_month_lock_amount`, "Enter a positive amount within this token's
decimal precision."); a malformed request is refused before any chain read
(`invalid_month_lock`).

```quint
pure val lockMonthCounts = List(1, 3, 6, 12)
pure def validLockRequest(count: int, amount: M::Amount): bool =
  lockMonthCounts.includes(count) and M::validAmount(amount) and M::positiveAmount(amount)
pure def lockPeriods(now: int, count: int): List[int] =
  List(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11).select(i => i < count).listMap(i => C::addPeriods(C::utcPeriod(now), i))
```

### A lock plan refuses a vault that is not ordinary or not migrated and a month it would lower, and plans the months not open or below the amount

The planner reads the requested months at finalized. It refuses a vault
whose purpose is not ordinary ("Only an ordinary project vault takes month
pledges."), then a vault without pledge support ("This vault must be
migrated before it can lock months."), then any open pledge above the
amount ("A locked month can only be raised"). It plans the months that are
not open or hold less than the amount; when none is left there is no
transaction to sign. A failed read stops the plan. It never signs or sends.

```quint
type LockRefusal = NoLockRefusal | NotOrdinaryVault | NotMigrated | PledgesUnavailable | LockOnlyRaises
pure def readRefusal(read: PledgeRead, amount: M::Amount): LockRefusal = match read {
  | NoPledgeSupport => NotMigrated
  | PledgesNotRead => PledgesUnavailable
  | PledgesRead(x) => if (x.pledges.some(p => p.open and M::compareAmounts(p.amount, amount) > 0)) LockOnlyRaises else NoLockRefusal }
pure def lockRefusal(ordinary: bool, read: PledgeRead, amount: M::Amount): LockRefusal =
  if (ordinary) readRefusal(read, amount) else NotOrdinaryVault
pure def lockPlanPeriods(read: PledgeRead, amount: M::Amount): List[int] = match read {
  | PledgesRead(x) => x.pledges.select(p => not(p.open) or M::compareAmounts(p.amount, amount) < 0).listMap(p => p.period)
  | _ => List() }
pure def lockPlanned(count: int, amount: M::Amount, ordinary: bool, read: PledgeRead): bool =
  validLockRequest(count, amount) and lockRefusal(ordinary, read, amount) == NoLockRefusal
    and lockPlanPeriods(read, amount).length() > 0
pure def openAtMost(read: PledgeRead, amount: M::Amount): bool = match read {
  | PledgesRead(x) => x.pledges.every(p => not(p.open) or M::compareAmounts(p.amount, amount) <= 0)
  | _ => true }
pure def lawLockNeverLowers(pledgeRead: PledgeRead, lockAmount: M::Amount): bool =
  readRefusal(pledgeRead, lockAmount) == NoLockRefusal implies openAtMost(pledgeRead, lockAmount)
pure val pledgeReadValues = Set(PledgesNotRead, NoPledgeSupport,
  PledgesRead({ openPledged: List(5), pledges: List({ period: 202612, amount: List(5), open: true }) }),
  PledgesRead({ openPledged: List(0), pledges: List({ period: 202612, amount: List(0), open: false }) }))
pure val lockAmountValues = Set(List(3), List(5), List(7))
```

### A release needs an open pledge, and closing a pledge account needs a closed one

Anyone may release a lapsed lock: the plan names one month and needs its
open pledge ("This month has no open pledge."); the program's simulation
refuses a month whose window has not closed (the [ledger](../contracts/ledger.md)'s
`closesAt`). The owner's return of a closed pledge account's rent needs a pledge
above zero that is no longer open.

```quint
pure def canPlanRelease(read: PledgeRead, period: int): bool = match read {
  | PledgesRead(x) => x.pledges.some(p => p.period == period and p.open)
  | _ => false }
pure def canPlanClosePledge(read: PledgeRead, period: int): bool = match read {
  | PledgesRead(x) => x.pledges.some(p => p.period == period and M::positiveAmount(p.amount) and not(p.open))
  | _ => false }
```

### A withdrawal review refuses to take funds the open pledges hold

Before the wallet is asked, a Solana withdrawal review reads the vault's
open pledged total at finalized and refuses (`funding_action_rejected`,
"These funds are locked for a month that has not been paid out yet.
Withdraw only funds above the locked months.") when the free balance less
the gross is below it. A vault without pledge support, an open total of
zero or an unreported free balance refuses nothing here; the program still
refuses a withdrawal of pledged funds (`PledgedFunds`).

```quint
pure def withdrawTakesPledgedFunds(free: M::Amount, freeReported: bool, gross: M::Amount, read: PledgeRead): bool = match read {
  | PledgesRead(x) => freeReported and M::positiveAmount(x.openPledged)
      and M::compareAmounts(free, M::addAmounts(gross, x.openPledged)) < 0
  | _ => false }
```
