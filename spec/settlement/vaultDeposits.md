# Finalized vault deposit records

PRD section 6 (operator decision, 18 November 2026): any wallet may deposit
into an active project's recorded vault, and the project page lists each
finalized deposit under "Funded by" with its depositing address, amount and
block time. The payments Worker records each finalized deposit event of
every recorded ordinary vault, from the vault's creation; private bounty
vaults are never read or listed. Sources at Slop development `b67e98e36`:
`workers/payments/deposits.ts`, `backend/payments/vault-deposits.ts`
(`assertVaultDeposit`, `vaultDepositInsert`, `projectVaultDeposits`),
`migrations/0138_vault_deposits.sql` and the retained models
`formal/models/payments/vault_deposit_evm_record.qnt` and
`vault_deposit_solana_record.qnt`. This unit is the EVM scan; the
[Solana scan](./solanaVaultDeposits.md) keeps the same record by its own
cursor. The public list and the months covered are
[projections](../frontend/projections.md).

The list is display evidence only. Balances, funded months, listing and
payment still come from the finalized vault counters of the [vault
snapshots](./vaultSnapshots.md), and a failed deposit read is retried
without failing or delaying a payout step. A record row never changes and is
never deleted: it is keyed by its network, transaction and event index, so
a page read twice, or by two overlapping runs, adds nothing.

## Story: Record every finalized deposit of an ordinary EVM vault once

> As a funder, I want my finalized deposit to appear under "Funded by", so
> that anyone can see who funded the project.

### A record row is a positive amount of one finalized deposit event

A row names the project, network, vault, transaction, event index (the log
index), depositing address, amount in base units above zero, block number
and block time. A row that could not have come from a finalized deposit
event is refused before it is stored.

```quint
import money as M from "./money"
type DepositRow = { network: str, transaction: str, eventIndex: int, depositor: str, amount: M::Amount, block: int, blockTime: int }
pure def validDepositRow(row: DepositRow): bool = row.network != "" and row.transaction != "" and row.eventIndex >= 0
  and row.depositor != "" and M::validAmount(row.amount) and M::positiveAmount(row.amount) and row.block > 0 and row.blockTime > 0
pure def sameEvent(a: DepositRow, b: DepositRow): bool =
  a.network == b.network and a.transaction == b.transaction and a.eventIndex == b.eventIndex
pure def lawZeroAmountRefused(row: DepositRow): bool = not(M::positiveAmount(row.amount)) implies not(validDepositRow(row))
```

### A run reads pages up to the finalized block and stores each page with its cursor

The scan has its own cursor, separate from the payment scanner's, and starts
at the vault's creation block. A run authenticates the chain, reads the
cursor once, and reads the vault's deposit event in pages of block ranges up
to the finalized block. One page's deposits and the cursor are a single
atomic write, and the cursor only moves forward, so an older overlapping run
cannot rewind it and a failed page (an RPC failure, an unexpected event or
an unreadable block) changes nothing. Two runs may overlap. A private bounty
vault, and a chain that does not match the reviewed deployment, are never
read.

```quint
type VaultPurpose = OrdinaryVault | PrivateBountyVault
type Run = { active: bool, fromBlock: int, toBlock: int }
type EvmDeposits = { purpose: VaultPurpose, chainMatches: bool, finalized: int, cursor: int, recorded: Set[int],
  first: Run, second: Run }
pure val worker = "payments-worker"
pure val chain = "chain"
pure val pageBlocks = 2
pure val chainDepositBlocks = Set(2, 5)
pure val idleRun: Run = { active: false, fromBlock: 0, toBlock: 0 }
pure val initial: EvmDeposits = { purpose: OrdinaryVault, chainMatches: true, finalized: 1, cursor: 0, recorded: Set(),
  first: idleRun, second: idleRun }
pure def runOf(v: EvmDeposits, slot: int): Run = if (slot == 1) v.first else v.second
pure def withRun(slot: int, v: EvmDeposits, r: Run): EvmDeposits = if (slot == 1) { ...v, first: r } else { ...v, second: r }
pure def canFinalize(v: EvmDeposits, by: str): bool = by == chain and v.finalized < 6
pure def finalize(v: EvmDeposits, by: str): EvmDeposits = { ...v, finalized: v.finalized + 1 }
pure def canObserveChain(v: EvmDeposits, matches: bool, by: str): bool = by == worker and matches != v.chainMatches
pure def observeChain(v: EvmDeposits, matches: bool, by: str): EvmDeposits = { ...v, chainMatches: matches }
pure def canStartPage(v: EvmDeposits, slot: int, by: str): bool = by == worker and (slot == 1 or slot == 2)
  and not(runOf(v, slot).active) and v.chainMatches and v.purpose == OrdinaryVault and v.cursor < v.finalized
pure def startPage(v: EvmDeposits, slot: int, by: str): EvmDeposits =
  withRun(slot, v, { active: true, fromBlock: v.cursor + 1,
    toBlock: if (v.cursor + pageBlocks < v.finalized) v.cursor + pageBlocks else v.finalized })
pure def canCompletePage(v: EvmDeposits, slot: int, by: str): bool = by == worker and (slot == 1 or slot == 2) and runOf(v, slot).active
pure def completePage(v: EvmDeposits, slot: int, by: str): EvmDeposits =
  val r = runOf(v, slot)
  withRun(slot, { ...v, recorded: v.recorded.union(chainDepositBlocks.filter(b => b >= r.fromBlock and b <= r.toBlock)),
    cursor: if (r.toBlock > v.cursor) r.toBlock else v.cursor }, idleRun)
pure def canFailPage(v: EvmDeposits, slot: int, by: str): bool = canCompletePage(v, slot, by)
pure def failPage(v: EvmDeposits, slot: int, by: str): EvmDeposits = withRun(slot, v, idleRun)
```

### Rules

Every deposit at or below the cursor is on record, and nothing else is. A
bounty vault has no record. The cursor and the record only grow.

```quint
pure def runWithinCursor(r: Run, cursor: int, finalized: int): bool =
  r.active implies (r.fromBlock >= 1 and r.fromBlock <= cursor + 1 and r.fromBlock <= r.toBlock and r.toBlock <= finalized)
pure def alwaysRunsContiguous(v: EvmDeposits): bool =
  runWithinCursor(v.first, v.cursor, v.finalized) and runWithinCursor(v.second, v.cursor, v.finalized)
pure def alwaysCursorFinalized(v: EvmDeposits): bool = v.cursor >= 0 and v.cursor <= v.finalized
pure def alwaysRecordedExactlyBelowCursor(v: EvmDeposits): bool =
  v.recorded.subseteq(chainDepositBlocks.filter(b => b <= v.cursor)) and chainDepositBlocks.filter(b => b <= v.cursor).subseteq(v.recorded)
pure def alwaysBountyVaultNeverRead(v: EvmDeposits): bool = v.purpose == PrivateBountyVault implies
  (v.cursor == 0 and v.recorded.size() == 0 and not(v.first.active) and not(v.second.active))
pure def stepCursorNeverGoesBack(before: EvmDeposits, after: EvmDeposits): bool = after.cursor >= before.cursor
pure def stepRecordPermanent(before: EvmDeposits, after: EvmDeposits): bool = before.recorded.subseteq(after.recorded)
pure def stepFailedPageChangesNothing(before: EvmDeposits, via: str, after: EvmDeposits): bool =
  via == "failPage" implies (after.cursor == before.cursor and after.recorded.subseteq(before.recorded))
pure def sometimesWholeHistory(v: EvmDeposits): bool = v.cursor == 6 and v.recorded.size() == 2
pure def sometimesOlderRunBehindCursor(v: EvmDeposits): bool = v.first.active and v.first.toBlock < v.cursor
pure def sometimesWrongChainWaits(v: EvmDeposits): bool = not(v.chainMatches) and v.cursor < v.finalized
pure val slotValues = Set(1, 2)
pure val rValues = Set(idleRun, { active: true, fromBlock: 1, toBlock: 2 })
pure val matchesValues = Set(true, false)
pure val byValues = Set(worker, chain)
pure val rowValues = Set({ network: "base", transaction: "0xa", eventIndex: 0, depositor: "0xd", amount: List(5), block: 2, blockTime: 10 },
  { network: "base", transaction: "0xa", eventIndex: 0, depositor: "0xd", amount: List(0), block: 2, blockTime: 10 })
pure val weight_startPage = 3
pure val weight_completePage = 3
```
