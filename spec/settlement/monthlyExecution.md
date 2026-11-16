# Monthly commitment execution

PRD sections 6 and 11: the payments scheduler sends each published monthly
allocation to the configured executor until finalized evidence completes it,
and one failure never blocks the others. Source anchors are development
`workers/payments/index.ts` (`runMonthlyCommitments` and the scheduled
handler, which isolates each step) and `backend/payments/README.md`
("Authorization and execution"); retained source models
`monthly_execution_recovery`, `monthly_commit_cursor` and
`monthly_cutoff_queue` map here. One instance is the execution queue of
every published [monthly allocation](./monthly.md); each row is one
(project, period, network) and its vault.

## Story: Execute every published month fairly and in a safe order

### Each published month has one execution row, and only finalized evidence completes it

A row is published once a month's authorization is signed. It is pending,
submitted to the executor, or complete. A completed row never changes, and
every step touches at most one row.

```quint
import monthly as Mo from "./monthly"
type RowPhase = Pending | Submitted | Complete
type Row = { key: int, project: int, period: int, network: int, vault: int, v2: bool,
  lastAttempt: int, phase: RowPhase, invalidated: bool, height: int, attempts: int }
type Execution = { rows: List[Row], now: int, ordinaryRun: List[int], prerequisiteRun: List[int], reverts: int, touched: int }
pure val batchLimit = 50
pure val initial: Execution = { rows: List(), now: 0, ordinaryRun: List(), prerequisiteRun: List(), reverts: 0, touched: 0 }
pure def hasRow(e: Execution, key: int): bool = e.rows.some(r => r.key == key)
pure def canPublish(e: Execution, key: int, project: int, period: int, network: int, vault: int, v2: bool, by: str): bool =
  by == "scheduler" and key > 0 and project > 0 and Mo::validPeriod(period) and network > 0 and vault > 0 and not(hasRow(e, key))
    and not(e.rows.some(r => r.project == project and r.period == period and r.network == network))
pure def publish(e: Execution, key: int, project: int, period: int, network: int, vault: int, v2: bool, by: str): Execution =
  { ...e, touched: key, rows: e.rows.append({ key: key, project: project, period: period, network: network, vault: vault, v2: v2,
    lastAttempt: 0, phase: Pending, invalidated: false, height: 0, attempts: 0 }) }
pure def alwaysOneRowPerMonth(e: Execution): bool = e.rows.every(r => r.key > 0
  and e.rows.select(o => o.key == r.key).length() == 1
  and e.rows.select(o => o.project == r.project and o.period == r.period and o.network == r.network).length() == 1)
pure def alwaysCompleteFinalized(e: Execution): bool = e.rows.every(r => r.phase == Complete implies r.height > 0)
pure def stepCompletionPermanent(before: Execution, after: Execution): bool =
  before.rows.every(r => r.phase != Complete or after.rows.includes(r))
pure def stepOtherRowsUnchanged(before: Execution, after: Execution): bool =
  before.rows.every(r => r.key == after.touched or after.rows.includes(r))
pure val keyValues = Set(1, 2, 3)
pure val projectValues = Set(1)
pure val periodValues = Set(202611, 202612)
pure val networkValues = Set(1, 2)
pure val vaultValues = Set(1)
```

### Each run attempts the least recently attempted rows first

A run starts at a later scheduler time and takes at most 50 pending rows,
least recently attempted first. It adds any omitted EVM v2 root of the same
vault and a newer period that a selected row waits on, at most 50 more. The
attempt time is recorded before the attempt, so a crash during the attempt
still moves the row to the back of the queue.

```quint
pure def attemptedThisRun(e: Execution, key: int): bool = e.ordinaryRun.includes(key) or e.prerequisiteRun.includes(key)
pure def canStartRun(e: Execution, now: int, by: str): bool = by == "scheduler" and now > e.now
pure def startRun(e: Execution, now: int, by: str): Execution =
  { ...e, now: now, ordinaryRun: List(), prerequisiteRun: List(), touched: 0 }
pure def leastRecent(e: Execution, row: Row): bool =
  e.rows.every(o => (o.phase == Pending and not(attemptedThisRun(e, o.key))) implies o.lastAttempt >= row.lastAttempt)
pure def waitedOn(e: Execution, row: Row): bool = row.v2 and e.ordinaryRun.some(k =>
  e.rows.some(o => o.key == k and o.vault == row.vault and o.period < row.period))
pure def canMarkAttempt(e: Execution, key: int, prerequisite: bool, by: str): bool =
  by == "scheduler" and not(attemptedThisRun(e, key)) and e.now > 0
    and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and (if (prerequisite) waitedOn(e, r) else leastRecent(e, r))))
    and (if (prerequisite) e.prerequisiteRun.length() < batchLimit else e.ordinaryRun.length() < batchLimit)
pure def markAttempt(e: Execution, key: int, prerequisite: bool, by: str): Execution =
  { ...e, touched: key,
    rows: e.rows.listMap(r => if (r.key == key) { ...r, lastAttempt: e.now, attempts: r.attempts + 1 } else r),
    ordinaryRun: if (prerequisite) e.ordinaryRun else e.ordinaryRun.append(key),
    prerequisiteRun: if (prerequisite) e.prerequisiteRun.append(key) else e.prerequisiteRun }
pure def alwaysRunBounded(e: Execution): bool = e.ordinaryRun.length() <= batchLimit and e.prerequisiteRun.length() <= batchLimit
pure def alwaysAttemptRecorded(e: Execution): bool = e.now >= 0
  and e.rows.every(r => (attemptedThisRun(e, r.key) implies r.lastAttempt == e.now) and r.lastAttempt <= e.now)
  and e.ordinaryRun.every(k => hasRow(e, k)) and e.prerequisiteRun.every(k => hasRow(e, k))
pure val nowValues = Set(1, 2, 3)
pure val prerequisiteValues = Set(false, true)
```

### A newer admitting root goes first, so no older leaf reverts it

An older period's commitment advances the vault's ordinary source sequence,
which reverts a newer EVM v2 root submitted before it
(`MonthlySourceChanged`). The executor therefore refuses to submit an
older-period row while a newer EVM v2 root of the same vault is incomplete.
Submitting needs an attempt recorded in this run; a failed send leaves that
row pending and touches no other row.

```quint
type SendResult = Sent | Failed
pure def newerRootPending(e: Execution, row: Row): bool =
  e.rows.some(o => o.vault == row.vault and o.v2 and o.period > row.period and o.phase != Complete)
pure def canSubmit(e: Execution, key: int, sendResult: SendResult, by: str): bool =
  by == "scheduler" and attemptedThisRun(e, key) and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and r.lastAttempt == e.now and not(newerRootPending(e, r))))
pure def submit(e: Execution, key: int, sendResult: SendResult, by: str): Execution =
  if (sendResult == Failed) { ...e, touched: key }
  else { ...e, touched: key, rows: e.rows.listMap(o =>
    if (o.key == key) { ...o, phase: Submitted }
    else if (o.phase == Submitted and o.v2 and e.rows.some(r => r.key == key and o.vault == r.vault and o.period > r.period))
      { ...o, invalidated: true }
    else o) }
pure def alwaysNoReorderingRevert(e: Execution): bool = e.reverts == 0 and e.rows.every(r => not(r.invalidated))
pure val sendResultValues = Set(Sent, Failed)
```

### Finalized evidence completes a submitted row, and a dropped submission is retried

A submitted row completes only with a positive finalized height. A
submission that finality shows was dropped returns the row to pending for a
later run. A root whose source changed after submission would revert; the
ordering rule keeps that from happening.

```quint
type Landing = Landed | Dropped
pure def canObserveFinality(e: Execution, key: int, landing: Landing, height: int, by: str): bool =
  by == "scheduler" and height > 0 and e.rows.some(r => r.key == key and r.phase == Submitted)
pure def observeFinality(e: Execution, key: int, landing: Landing, height: int, by: str): Execution =
  { ...e, touched: key,
    reverts: if (landing == Landed and e.rows.some(r => r.key == key and r.invalidated)) e.reverts + 1 else e.reverts,
    rows: e.rows.listMap(r => if (r.key != key) r
      else if (landing == Dropped or r.invalidated) { ...r, phase: Pending, invalidated: false }
      else { ...r, phase: Complete, height: height }) }
pure val landingValues = Set(Landed, Dropped)
pure val heightValues = Set(0, 7)
pure def sometimesCompleted(e: Execution): bool = e.rows.some(r => r.phase == Complete)
pure def sometimesPrerequisiteIncluded(e: Execution): bool = e.prerequisiteRun.length() > 0
pure def sometimesRetriedThenCompleted(e: Execution): bool = e.rows.some(r => r.phase == Complete and r.attempts > 1)
pure def sometimesNewestFirst(e: Execution): bool = e.rows.some(r => r.v2 and r.phase == Complete
  and e.rows.some(o => o.vault == r.vault and o.period < r.period and o.phase == Pending))
```
