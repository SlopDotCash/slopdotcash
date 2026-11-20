# Solana vault deposit records

The [vault deposit record](./vaultDeposits.md) of one ordinary Solana vault
(PRD section 6, operator decision of 18 November 2026). Sources at Slop
development `b67e98e36`: `workers/payments/deposits.ts`,
`migrations/0138_vault_deposits.sql` (`vault_deposit_cursors`: `position`,
`pending_top`, `resume_before`) and the retained model
`formal/models/payments/vault_deposit_solana_record.qnt`. The instruction
decoding and the genesis check come from the real scanner; a repeated insert
is a no-op by the table's key.

Transactions are numbered oldest first. The project account's finalized
transactions are read newest first, a bounded page a run.

## Story: Record every finalized deposit of an ordinary Solana vault once

> As a funder, I want my finalized Solana deposit to appear under "Funded
> by", even when reads fail or overlap.

### A run reads newest first below the interval it resumes and above the covered position

`position` is the newest transaction at or below which everything has been
read. While an interval above it is being read, `pending` is its newest
transaction and `resume` the oldest one already read. A run fetches a page
below `resume` (or from the newest transaction) and above `position`, and
reads it newest first. Each transaction's deposits and that progress are one
atomic write, made only if `position` is still the value the run started
from, so a run that another run overtook stops without moving anything. An
unavailable transaction ends the run and its place is kept. A page shorter
than the limit reached the covered position and completes the interval.

```quint
type SolanaRun = { active: bool, startPosition: int, top: int, cursorAt: int, remaining: int, shortPage: bool }
type SolanaDeposits = { newest: int, position: int, pending: int, resume: int, seen: Set[int], recorded: Set[int],
  first: SolanaRun, second: SolanaRun }
pure val worker = "payments-worker"
pure val chain = "chain"
pure val pageTransactions = 2
pure val chainTransactions = Set(1, 2, 3, 4)
pure val depositTransactions = Set(2, 4)
pure val idleRun: SolanaRun = { active: false, startPosition: 0, top: 0, cursorAt: 0, remaining: 0, shortPage: false }
pure val initial: SolanaDeposits = { newest: 1, position: 0, pending: 0, resume: 0, seen: Set(), recorded: Set(),
  first: idleRun, second: idleRun }
pure def runOf(d: SolanaDeposits, slot: int): SolanaRun = if (slot == 1) d.first else d.second
pure def withRun(slot: int, d: SolanaDeposits, r: SolanaRun): SolanaDeposits =
  if (slot == 1) { ...d, first: r } else { ...d, second: r }
pure def pageFrom(d: SolanaDeposits): int = if (d.resume > 0) d.resume - 1 else d.newest
pure def captured(d: SolanaDeposits): SolanaRun =
  val available = if (pageFrom(d) > d.position) pageFrom(d) - d.position else 0
  { active: true, startPosition: d.position,
    top: if (d.pending > 0) d.pending else if (available > 0) pageFrom(d) else 0,
    cursorAt: pageFrom(d), remaining: if (available > pageTransactions) pageTransactions else available,
    shortPage: available < pageTransactions }
pure def canArrive(d: SolanaDeposits, by: str): bool = by == chain and d.newest < 4
pure def arrive(d: SolanaDeposits, by: str): SolanaDeposits = { ...d, newest: d.newest + 1 }
pure def canStartRun(d: SolanaDeposits, slot: int, by: str): bool = by == worker and (slot == 1 or slot == 2) and not(runOf(d, slot).active)
pure def startRun(d: SolanaDeposits, slot: int, by: str): SolanaDeposits = withRun(slot, d, captured(d))
pure def canReadTransaction(d: SolanaDeposits, slot: int, by: str): bool =
  by == worker and (slot == 1 or slot == 2) and runOf(d, slot).active and runOf(d, slot).remaining > 0
pure def readTransaction(d: SolanaDeposits, slot: int, by: str): SolanaDeposits =
  val r = runOf(d, slot)
  val stored = { ...d, seen: d.seen.union(Set(r.cursorAt)), recorded: d.recorded.union(depositTransactions.filter(t => t == r.cursorAt)) }
  if (d.position == r.startPosition)
    withRun(slot, { ...stored, pending: r.top, resume: r.cursorAt }, { ...r, cursorAt: r.cursorAt - 1, remaining: r.remaining - 1 })
  else withRun(slot, stored, idleRun)
pure def canFailRun(d: SolanaDeposits, slot: int, by: str): bool = by == worker and (slot == 1 or slot == 2) and runOf(d, slot).active
pure def failRun(d: SolanaDeposits, slot: int, by: str): SolanaDeposits = withRun(slot, d, idleRun)
pure def canFinishRun(d: SolanaDeposits, slot: int, by: str): bool =
  by == worker and (slot == 1 or slot == 2) and runOf(d, slot).active and runOf(d, slot).remaining == 0
pure def finishRun(d: SolanaDeposits, slot: int, by: str): SolanaDeposits =
  val r = runOf(d, slot)
  val finished = if (r.shortPage and d.position == r.startPosition)
    { ...d, position: if (r.top > 0) r.top else d.position, pending: 0, resume: 0 } else d
  withRun(slot, finished, idleRun)
```

### Rules

Everything at or below the covered position has been read, an open interval
has read every transaction from `resume` to `pending`, and a deposit is on
record exactly when its transaction has been read.

```quint
pure def alwaysPositionCovered(d: SolanaDeposits): bool = d.position >= 0 and d.position <= d.newest
  and chainTransactions.filter(t => t <= d.position).subseteq(d.seen)
pure def alwaysIntervalRead(d: SolanaDeposits): bool =
  (d.pending > 0 implies (d.resume > d.position and d.resume <= d.pending and d.pending <= d.newest
    and chainTransactions.filter(t => t >= d.resume and t <= d.pending).subseteq(d.seen)))
  and (d.pending == 0 implies d.resume == 0)
pure def alwaysRecordedExactlyRead(d: SolanaDeposits): bool =
  d.recorded.subseteq(depositTransactions.intersect(d.seen)) and depositTransactions.intersect(d.seen).subseteq(d.recorded)
pure def stepPositionNeverGoesBack(before: SolanaDeposits, after: SolanaDeposits): bool = after.position >= before.position
pure def stepRecordPermanent(before: SolanaDeposits, after: SolanaDeposits): bool = before.recorded.subseteq(after.recorded)
pure def sometimesAllCovered(d: SolanaDeposits): bool = d.position == 4 and d.pending == 0 and d.recorded.size() == 2
pure def sometimesIntervalOpen(d: SolanaDeposits): bool = d.pending > 0 and d.recorded.size() == 1
pure def sometimesOvertakenRunStopped(d: SolanaDeposits): bool = d.first.active and d.first.startPosition < d.position
pure val slotValues = Set(1, 2)
pure val rValues = Set(idleRun, { active: true, startPosition: 0, top: 2, cursorAt: 2, remaining: 2, shortPage: true })
pure val byValues = Set(worker, chain)
pure val weight_readTransaction = 3
pure val weight_finishRun = 2
```
