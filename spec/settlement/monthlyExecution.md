# Monthly commitment execution

PRD sections 6 and 11: the payments scheduler sends each published monthly
allocation to the configured executor until finalized evidence completes it,
and one failure never blocks the others. Source anchors are development
`workers/payments/index.ts` (`runMonthlyCommitments` and the scheduled
handler, which isolates each step), development
`workers/payment-executor/core.ts` (`submitEvmMonthly`,
`submitEvmMonthlyReserve`), vibestack
`apps/settlement/src/keeper/monthly.vibe` (`submitEvmMonthly`,
`submitReserve`, `serveMonths`) and `backend/payments/README.md`
("Authorization and execution"); retained source models
`monthly_execution_recovery`, `monthly_commit_cursor` and
`monthly_cutoff_queue` map here. One instance is the execution queue of
every published [monthly allocation](./monthly.md); each row is one
(project, period, network) and its vault, and it reads the executor's
[exact-byte journal](./executorJournal.md) for that month.

## Story: Execute every published month fairly and in a safe order

### Each published month has one execution row, and only finalized evidence completes it

A row is published once a month's authorization is signed. It carries the
signed tree (root, gross total and leaf count), its source sequence, and for
a version 2 EVM reserve the retained original V1 root, if any. A row is
pending, submitted to the executor, complete, or held: held as a wrong-total
reservation, a released wrong-total reservation, or a month whose admission
window closed unadmitted. A completed row never changes, and every step
touches at most one row. The publisher refuses a month unless the frozen
run's own vault holds a stored pledge for it above zero or the project's
automatic default is on, as [month pledges](./monthPledges.md) "Publication,
a newer attempt and on-chain admission need a pledge in the run's own vault
or the automatic default on" requires (`runConsent`).

```quint
import monthly as Mo from "./monthly"
import monthPledges as P from "./monthPledges"
import money as M from "./money"
import monthlyCommitment as Mc from "./monthlyCommitment"
import executorJournal as J from "./executorJournal"
import reserveRelease as R from "./reserveRelease"
type RowPhase = Pending | Submitted | Complete | WrongTotal | Released | ClosedUnadmitted
type Tree = { root: str, total: M::Amount, count: int, legacyRoot: str }
type Row = { key: int, project: int, period: int, network: int, vault: int, v2: bool, solana: bool,
  lastAttempt: int, phase: RowPhase, invalidated: bool, height: int, attempts: int,
  root: str, total: M::Amount, leafCount: int, legacyRoot: str, sequence: int, journal: J::Journal,
  heldTotal: M::Amount, sentNonce: int, lastAdmit: bool, sentWithoutAdmit: bool }
type Execution = { rows: List[Row], now: int, ordinaryRun: List[int], prerequisiteRun: List[int], reverts: int, touched: int,
  processed: List[int], sends: int }
pure val batchLimit = 50
pure val initial: Execution = { rows: List(), now: 0, ordinaryRun: List(), prerequisiteRun: List(), reverts: 0, touched: 0,
  processed: List(), sends: 0 }
pure def hasRow(e: Execution, key: int): bool = e.rows.some(r => r.key == key)
pure def validTree(tree: Tree): bool = tree.root != "" and tree.count > 0 and M::validAmount(tree.total) and M::positiveAmount(tree.total)
pure def canPublish(e: Execution, key: int, project: int, period: int, network: int, vault: int,
    runVaultPledged: bool, automatic: bool, v2: bool, solana: bool, tree: Tree, by: str): bool =
  by == "scheduler" and key > 0 and project > 0 and Mo::validPeriod(period) and network > 0 and vault > 0 and not(hasRow(e, key))
    and not(e.rows.some(r => r.project == project and r.period == period and r.network == network))
    and P::runConsent(runVaultPledged, automatic)
    and not(v2 and solana) and validTree(tree) and (not(v2) implies tree.legacyRoot == "")
pure def publish(e: Execution, key: int, project: int, period: int, network: int, vault: int,
    runVaultPledged: bool, automatic: bool, v2: bool, solana: bool, tree: Tree, by: str): Execution =
  { ...e, touched: key, rows: e.rows.append({ key: key, project: project, period: period, network: network, vault: vault, v2: v2,
    solana: solana, lastAttempt: 0, phase: Pending, invalidated: false, height: 0, attempts: 0,
    root: tree.root, total: tree.total, leafCount: tree.count, legacyRoot: tree.legacyRoot, sequence: 1, journal: J::emptyJournal,
    heldTotal: M::zero, sentNonce: -1, lastAdmit: false, sentWithoutAdmit: false }) }
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
pure val byValues = Set("scheduler", "publisher", "other")
pure val treeR1: Tree = { root: "r1", total: List(5), count: 2, legacyRoot: "v1" }
pure val treeR2: Tree = { root: "r2", total: List(3), count: 1, legacyRoot: "v1" }
pure val treeValues = Set(treeR1, { ...treeR1, legacyRoot: "" }, treeR2, { ...treeR1, root: "" })
```

### Each run attempts the least recently attempted rows first

A run starts at a later scheduler time and takes at most 50 pending rows,
least recently attempted first. A legacy EVM row is selectable only in its
own admission window (the source's `activePeriod`); a version 2 EVM or
Solana row is selectable in any later run, because an admitted month stays
resumable. A run adds any omitted version 2 EVM root of the active period
whose same project, network and vault has a selected older version 2 row,
at most 50 more (the prerequisite query of `runMonthlyCommitments`). The
attempt time is recorded before the attempt, so a crash during the attempt
still moves the row to the back of the queue. Held and complete rows are not
selected.

Discovered by simulation: the scheduler clock is sampled at real window
boundaries (`Mc::windowOpensAt` and `Mc::windowClosesAt` of the sampled
periods, and one instant before any window), because selection and
admission depend on the window of the row's period.

```quint
pure def windowOpen(period: int, now: int): bool = Mc::windowOpensAt(period) <= now and now < Mc::windowClosesAt(period)
pure def selectable(e: Execution, row: Row): bool = row.v2 or row.solana or windowOpen(row.period, e.now)
pure def attemptedThisRun(e: Execution, key: int): bool = e.ordinaryRun.includes(key) or e.prerequisiteRun.includes(key)
pure def canStartRun(e: Execution, now: int, by: str): bool = by == "scheduler" and now > e.now
pure def startRun(e: Execution, now: int, by: str): Execution =
  { ...e, now: now, ordinaryRun: List(), prerequisiteRun: List(), touched: 0, processed: List() }
pure def leastRecent(e: Execution, row: Row): bool =
  e.rows.every(o => (o.phase == Pending and selectable(e, o) and not(attemptedThisRun(e, o.key))) implies o.lastAttempt >= row.lastAttempt)
pure def waitedOn(e: Execution, row: Row): bool = row.v2 and windowOpen(row.period, e.now) and e.ordinaryRun.some(k =>
  e.rows.some(o => o.key == k and o.v2 and o.project == row.project and o.network == row.network
    and o.vault == row.vault and o.period < row.period))
pure def canMarkAttempt(e: Execution, key: int, prerequisite: bool, by: str): bool =
  by == "scheduler" and not(attemptedThisRun(e, key)) and e.now > 0
    and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and selectable(e, r)
      and (if (prerequisite) waitedOn(e, r) else leastRecent(e, r))))
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
  and e.processed.every(k => attemptedThisRun(e, k))
pure val nowValues = Set(Mc::monthStart(202612), Mc::windowOpensAt(202611), Mc::windowClosesAt(202611), Mc::windowClosesAt(202612))
pure val prerequisiteValues = Set(false, true)
```

### A newer admitting root goes first, so no older leaf reverts it

An older period's commitment advances the vault's ordinary source sequence,
which reverts a newer EVM v2 root that lands after it
(`MonthlySourceChanged`). Each run therefore processes its attempted rows
newest period first: a row is submitted only after every newer pending row
attempted in the same run has been processed (the source sorts the run's
items by period, newest first). Across runs the executor does not wait: it
relies on the stated adapter assumption `sameSignerNonceOrder`, that one
executor signer sends every monthly step of a vault and that a later nonce
of that signer never mines before an earlier one. A newer root sent in an
earlier run holds an earlier nonce than any later send, so it lands first;
the model records each send's nonce, and a send would invalidate a newer
submitted root only if that root's nonce were later, which the recorded
nonces exclude. A leaf already in flight when an attester signed a newer
root is a stale signature, not a reordering: the root reverts and
[the authorization journal](./monthlyCommitment.md) signs a new attempt.

Submitting needs an attempt recorded in this run, and each row is processed
at most once per run. A failed send leaves that row pending and touches no
other row. Admission uses `admit`: the run's consent (a pledge counts) and
the period's admission window open at the scheduler clock. Without
admission, a legacy row is skipped, and a version 2 row whose journal shows
no admitted root is answered `notAdmitted` and stays pending; a version 2
row whose root is already admitted, or a Solana row, is still sent, because
an admitted month stays resumable.

```quint
type SendResult = Sent | Failed | NotAdmitted
pure def newerRootPending(e: Execution, row: Row): bool =
  e.rows.some(o => o.key != row.key and attemptedThisRun(e, o.key) and not(e.processed.includes(o.key))
    and o.phase == Pending and o.period > row.period)
pure def resultFits(row: Row, sendResult: SendResult, admit: bool): bool =
  if (admit) sendResult != NotAdmitted
  else if (row.solana) true
  else if (row.v2 and J::admitted(row.journal, row.period)) sendResult != NotAdmitted
  else sendResult == NotAdmitted
pure def canSubmit(e: Execution, key: int, sendResult: SendResult, admit: bool, consent: bool, by: str): bool =
  by == "scheduler" and attemptedThisRun(e, key) and not(e.processed.includes(key)) and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and r.lastAttempt == e.now and not(newerRootPending(e, r))
      and admit == (consent and windowOpen(r.period, e.now)) and resultFits(r, sendResult, admit)))
pure def reorderedBy(e: Execution, row: Row, o: Row): bool =
  o.phase == Submitted and o.v2 and o.vault == row.vault and o.period > row.period and o.sentNonce > e.sends
pure def submit(e: Execution, key: int, sendResult: SendResult, admit: bool, consent: bool, by: str): Execution =
  if (sendResult != Sent) { ...e, touched: key, processed: e.processed.append(key) }
  else { ...e, touched: key, processed: e.processed.append(key), sends: e.sends + 1, rows: e.rows.listMap(o =>
    if (o.key == key) { ...o, phase: Submitted, sentNonce: e.sends, lastAdmit: admit, sentWithoutAdmit: o.sentWithoutAdmit or not(admit) }
    else if (e.rows.some(r => r.key == key and reorderedBy(e, r, o))) { ...o, invalidated: true }
    else o) }
pure def alwaysNoReorderingRevert(e: Execution): bool = e.reverts == 0 and e.rows.every(r => not(r.invalidated))
pure def alwaysSentNoncesIssued(e: Execution): bool = e.sends >= 0
  and e.rows.every(r => r.sentNonce < e.sends and (r.sentNonce >= 0 or r.sentNonce == -1))
pure def stepNoAdmissionWithoutAdmit(before: Execution, after: Execution): bool =
  after.rows.every(r => (r.phase == Submitted and not(r.lastAdmit) and before.rows.some(o => o.key == r.key and o.phase == Pending))
    implies (r.solana or J::admitted(r.journal, r.period)))
pure val sendResultValues = Set(Sent, Failed, NotAdmitted)
```

### Finalized evidence completes a submitted legacy or Solana row, and a dropped submission is retried

A submitted row completes on a landing only with a positive finalized
height. A legacy EVM row completes on the executor's `alreadyCommitted`
answer only when its journal shows its own V1 root admitted and its root
attempts settled (`sendJournaledUntilFinalized`); a Solana row completes on
its executor's landing. A version 2 EVM row never completes on a landing: it
completes only through its journal's cursor or a verified legacy winner,
below. A submission that finality shows was dropped, or a version 2 run that
did not complete the month, returns the row to pending for a later run. A
root whose source changed after submission would revert; the ordering rule
keeps that from happening.

```quint
type Landing = Landed | Dropped
pure def landingFits(row: Row, landing: Landing): bool = landing == Dropped or (not(row.v2) and (row.solana
  or (J::admittedLegacy(row.journal, row.period, row.root) and J::rootSettled(row.journal, row.period))))
pure def canObserveFinality(e: Execution, key: int, landing: Landing, height: int, by: str): bool =
  by == "scheduler" and height > 0 and e.rows.some(r => r.key == key and r.phase == Submitted)
    and e.rows.every(r => r.key != key or landingFits(r, landing))
pure def observeFinality(e: Execution, key: int, landing: Landing, height: int, by: str): Execution =
  { ...e, touched: key,
    reverts: if (landing == Landed and e.rows.some(r => r.key == key and r.invalidated)) e.reverts + 1 else e.reverts,
    rows: e.rows.listMap(r => if (r.key != key) r
      else if (landing == Dropped or r.invalidated) { ...r, phase: Pending, invalidated: false }
      else { ...r, phase: Complete, height: height }) }
pure def alwaysLegacyCompleteSettled(e: Execution): bool = e.rows.every(r => (r.phase == Complete and not(r.v2) and not(r.solana))
  implies J::admittedLegacy(r.journal, r.period, r.root) and J::rootSettled(r.journal, r.period))
pure val landingValues = Set(Landed, Dropped)
pure val heightValues = Set(0, 7)
pure def sometimesCompleted(e: Execution): bool = e.rows.some(r => r.phase == Complete)
pure def sometimesPrerequisiteIncluded(e: Execution): bool = e.prerequisiteRun.length() > 0
pure def sometimesRetriedThenCompleted(e: Execution): bool = e.rows.some(r => r.phase == Complete and r.attempts > 1)
pure def sometimesNewestFirst(e: Execution): bool = e.rows.some(r => r.v2 and r.phase == Complete
  and e.rows.some(o => o.vault == r.vault and o.period < r.period and o.phase == Pending))
```

## Story: Complete a version 2 month only from its journal

### A row reads only a later, well-formed journal of its own month

The executor's journal for the row's month is read from finalized evidence.
A row accepts a newer snapshot only when it keeps every rule of the
[journal](./executorJournal.md) and extends the snapshot the row holds. An
EVM row's month admits at most its own signed root: a version 2 root is the
row's current root with its signed leaf count, and a V1 root is the row's own
root for a legacy row or the retained original V1 root for a version 2 row.
This is the composition assumption with
[the authorization journal](./monthlyCommitment.md): every attempt is signed
at a finalized view with no admitted root and a newer source sequence, and
the contract admits a reserve only at its signed source sequence, which never
decreases; so an older attempt cannot be admitted after a newer one is
signed, and the only V1 signature of a frozen month is the retained one
(`stepLegacyRetainedOnce`). A whole release leaves the month's remaining
reserve at zero, so the contract refuses every later leaf
(`ProjectEscrow.sol` `releaseMonthlyReserve`); a released row reads only a
journal with no committed leaf. A Solana row has no EVM journal.

```quint
pure def monthOnly(j: J::Journal, period: int): bool = j.entries.every(x => x.key.period == period)
  and j.admissions.every(a => a.period == period) and j.leaves.every(k => k.period == period)
  and j.cursors.every(c => c.period == period)
pure def admissionFits(row: Row, j: J::Journal): bool = j.admissions.every(a =>
  if (a.kind == J::V2Root) row.v2 and a.root == row.root and a.count == row.leafCount
  else if (row.v2) row.legacyRoot != "" and a.root == row.legacyRoot
  else a.root == row.root and a.count == row.leafCount and M::equalAmounts(a.total, row.total))
pure def canObserveJournal(e: Execution, key: int, journal: J::Journal, by: str): bool =
  by == "scheduler" and e.rows.some(r => r.key == key and r.phase != Complete)
    and e.rows.every(r => r.key != key or (not(r.solana) and r.phase != Complete and r.phase != ClosedUnadmitted and journal != r.journal
      and monthOnly(journal, r.period) and admissionFits(r, journal)
      and (not(r.v2) implies journal.entries.every(x => x.key.kind == J::LegacyRoot))
      and (r.phase == Released implies journal.leaves.length() == 0)
      and J::follows(r.journal, journal) and J::wellFormed(journal)))
pure def observeJournal(e: Execution, key: int, journal: J::Journal, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key) { ...r, journal: journal } else r) }
pure def stepJournalFollows(before: Execution, after: Execution): bool =
  after.rows.every(r => before.rows.every(o => o.key != r.key or J::follows(o.journal, r.journal)))
pure def alwaysAdmittedRootIsRowRoot(e: Execution): bool =
  e.rows.every(r => J::wellFormed(r.journal) and monthOnly(r.journal, r.period) and admissionFits(r, r.journal))
```

### A version 2 row completes once its root is settled and its cursor reaches the leaf count, or a verified V1 root won

`submitEvmMonthlyReserve` reports a version 2 month complete only when both
root keys of the month are settled and the root-keyed cursor equals the leaf
count; when an independently signed V1 root won the month, it verifies that
root against the retained original V1 authorization and reports complete
once both root keys are settled. A month whose admitted total differs from
its tree is never completed this way.

```quint
pure def v2Total(j: J::Journal, period: int, root: str): M::Amount =
  j.admissions.foldl(M::zero, (t, a) => if (a.period == period and a.kind == J::V2Root and a.root == root) a.total else t)
pure def cursorDone(row: Row): bool = J::admittedV2(row.journal, row.period, row.root)
  and M::equalAmounts(v2Total(row.journal, row.period, row.root), row.total)
  and J::cursorOf(row.journal, row.period, row.root) == row.leafCount
pure def legacyWon(row: Row): bool = row.legacyRoot != "" and J::admittedLegacy(row.journal, row.period, row.legacyRoot)
pure def canComplete(e: Execution, key: int, by: str): bool =
  by == "scheduler" and e.rows.some(r => r.key == key and r.v2 and (r.phase == Pending or r.phase == Submitted))
    and e.rows.every(r => r.key != key or (r.journal.height > 0 and J::rootSettled(r.journal, r.period)
      and (cursorDone(r) or legacyWon(r))))
pure def complete(e: Execution, key: int, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key) { ...r, phase: Complete, height: r.journal.height } else r) }
pure def alwaysV2CompleteMeansCursorDone(e: Execution): bool = e.rows.every(r => (r.v2 and r.phase == Complete)
  implies J::rootSettled(r.journal, r.period) and (cursorDone(r) or legacyWon(r)))
pure def otherSenderLeaf(row: Row): bool = row.journal.leaves.some(k =>
  not(row.journal.entries.some(x => x.key == k and x.verdict == J::Succeeded)))
pure def sometimesCompletedAfterOtherSenderCommittedLeaves(e: Execution): bool =
  e.rows.some(r => r.v2 and r.phase == Complete and cursorDone(r) and otherSenderLeaf(r))
pure def sometimesV2CompletedByLegacyWinner(e: Execution): bool = e.rows.some(r => r.v2 and r.phase == Complete and legacyWon(r))
pure def sometimesResumedAfterWindowClosed(e: Execution): bool = e.rows.some(r => r.v2 and r.phase == Complete
  and r.sentWithoutAdmit and r.lastAttempt >= Mc::windowClosesAt(r.period))
```

### The executor uses the latest authorization, and its cursor belongs to that root

The scheduler reads the month's current authorization
(`monthly_payment_current_authorizations`); a newer attempt replaces it only
with a strictly higher source sequence, the same whole gross and the same
retained V1 authorization (`retainAuthorization`), and only while the
month's journal shows no admitted root. Once a root is admitted the row's
root never changes. The cursor is read under the row's current root, so a
replaced tree never inherits another root's progress.

```quint
pure def canReauthorize(e: Execution, key: int, sequence: int, tree: Tree, by: str): bool =
  by == "publisher" and validTree(tree) and e.rows.some(r => r.key == key and r.v2 and (r.phase == Pending or r.phase == Submitted))
    and e.rows.every(r => r.key != key or (sequence > r.sequence and tree.legacyRoot == r.legacyRoot
      and not(J::admitted(r.journal, r.period))))
pure def reauthorize(e: Execution, key: int, sequence: int, tree: Tree, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key)
    { ...r, sequence: sequence, root: tree.root, total: tree.total, leafCount: tree.count } else r) }
pure def stepSequenceMonotone(before: Execution, after: Execution): bool =
  after.rows.every(r => before.rows.every(o => o.key != r.key or r.sequence >= o.sequence))
pure def stepAdmittedRootFixed(before: Execution, after: Execution): bool =
  after.rows.every(r => before.rows.every(o => o.key != r.key or not(J::admitted(o.journal, o.period)) or r.root == o.root))
pure def sometimesReauthorizedThenAdmitted(e: Execution): bool =
  e.rows.some(r => r.sequence > 1 and J::admittedV2(r.journal, r.period, r.root))
pure val sequenceValues = Set(2)
```

### A wrong admitted total is held and never completes; only a finalized whole release ends it

When the month's admitted version 2 root is the row's root but its admitted
total differs from the tree, the source throws `Another monthly reserve is
already admitted` on every run. The row is held as `WrongTotal` with the
admitted total and never completes. Only a finalized, successful release
receipt for that root that returns exactly the held total with nothing
settled, while no leaf of the month is committed, moves it to `Released`
([wrong-total reserve release](./reserveRelease.md)); the owner signs and
sends that release. Whether a released month counts as complete is an owner
decision gate: both phases stay distinct and neither is complete. Other
admitted-state mismatches (another root, digest or count) also throw in the
source; the composition assumption above excludes them. Source gap: the
development scheduler keeps a held row in its batch and lets the executor
throw on every run; the spec holds it out of the batch.

```quint
pure def canObserveWrongTotal(e: Execution, key: int, by: str): bool =
  by == "scheduler" and e.rows.some(r => r.key == key and r.v2 and (r.phase == Pending or r.phase == Submitted))
    and e.rows.every(r => r.key != key or (J::admittedV2(r.journal, r.period, r.root)
      and not(M::equalAmounts(v2Total(r.journal, r.period, r.root), r.total))))
pure def observeWrongTotal(e: Execution, key: int, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key)
    { ...r, phase: WrongTotal, heldTotal: v2Total(r.journal, r.period, r.root) } else r) }
pure def canObserveReleased(e: Execution, key: int, receipt: R::ReleaseReceipt, by: str): bool =
  by == "scheduler" and e.rows.some(r => r.key == key and r.phase == WrongTotal)
    and e.rows.every(r => r.key != key or (receipt.attempt > 0 and receipt.height > 0 and receipt.finalized and receipt.succeeded
      and receipt.root == r.root and M::equalAmounts(receipt.settledAmount, M::zero)
      and M::equalAmounts(receipt.releasedAmount, r.heldTotal) and r.journal.leaves.length() == 0))
pure def observeReleased(e: Execution, key: int, receipt: R::ReleaseReceipt, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key) { ...r, phase: Released, height: receipt.height } else r) }
pure def alwaysHeldTotalWrong(e: Execution): bool = e.rows.every(r => (r.phase == WrongTotal or r.phase == Released)
  implies r.v2 and J::admittedV2(r.journal, r.period, r.root) and not(M::equalAmounts(r.heldTotal, r.total))
    and M::equalAmounts(v2Total(r.journal, r.period, r.root), r.heldTotal))
pure def alwaysReleasedUntouched(e: Execution): bool = e.rows.every(r => r.phase == Released
  implies r.height > 0 and r.journal.leaves.length() == 0)
pure def stepWrongTotalNeverCompletes(before: Execution, after: Execution): bool =
  before.rows.every(o => o.phase != WrongTotal or after.rows.every(r => r.key != o.key or r.phase == WrongTotal or r.phase == Released))
pure def stepReleasedPermanent(before: Execution, after: Execution): bool =
  before.rows.every(r => r.phase != Released or after.rows.every(o => o.key != r.key or o.phase == Released))
pure def sometimesWrongTotalReleased(e: Execution): bool = e.rows.some(r => r.phase == Released)
pure val receiptSample: R::ReleaseReceipt = { attempt: 1, root: "r1", height: 9, releasedAmount: List(6),
  settledAmount: M::zero, finalized: true, succeeded: true }
pure val receiptValues = Set(receiptSample, { ...receiptSample, root: "r2" }, { ...receiptSample, releasedAmount: List(5) },
  { ...receiptSample, finalized: false })
```

### An EVM month whose window closed unadmitted is refused and leaves the batch

When finalized chain time has reached the period's `closesAt`, no root of
the month is admitted and the executor holds no live root attempt, the
contract refuses every later admission (`MonthlyWindowClosed`), so the row
is refused permanently and takes no batch slot. This is the execution side
of [the authorization journal](./monthlyCommitment.md)
`WindowClosedUnadmitted` (`canCloseWindow`), which needs no admitted root
and a clock at or past `closesAt`; the free funds stay free. An admitted
month is never refused. Source gap: the development scheduler keeps
selecting such a version 2 row and receives `notAdmitted` on every run; a
legacy row already stops being selected after its window.

```quint
pure def canRefuseUnadmitted(e: Execution, key: int, by: str): bool =
  by == "scheduler" and e.rows.some(r => r.key == key and r.phase == Pending and not(r.solana))
    and e.rows.every(r => r.key != key or (not(J::admitted(r.journal, r.period)) and not(J::hasLiveRoot(r.journal, r.period))
      and r.journal.time >= Mc::windowClosesAt(r.period)))
pure def refuseUnadmitted(e: Execution, key: int, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key) { ...r, phase: ClosedUnadmitted } else r) }
pure def alwaysClosedUnadmitted(e: Execution): bool = e.rows.every(r => r.phase == ClosedUnadmitted
  implies not(r.solana) and not(J::admitted(r.journal, r.period)) and not(J::hasLiveRoot(r.journal, r.period))
    and r.journal.time >= Mc::windowClosesAt(r.period))
pure def stepRefusalPermanent(before: Execution, after: Execution): bool =
  before.rows.every(r => r.phase != ClosedUnadmitted or after.rows.includes(r))
pure def sometimesClosedUnadmitted(e: Execution): bool = e.rows.some(r => r.phase == ClosedUnadmitted)
```

### Simulation samples are finalized journals of each sampled month

Each sampled journal is one finalized snapshot of a month's executor journal:
a version 2 root in flight, admitted, its leaves committed by this signer
and by another sender with the cursor following, a wrong admitted total, a
V1 root won by another sender with this signer's root attempt live and then
settled, this signer's own V1 root, and a closed window with nothing
admitted.

```quint
pure def entryOf(xKey: J::JournalKey, xBytes: int, xNonce: int, xPhase: J::EntryPhase, xVerdict: J::Outcome,
    xRoot: str, xTotal: M::Amount, xCount: int): J::JournalEntry =
  { key: xKey, bytes: xBytes, nonce: xNonce, phase: xPhase, verdict: xVerdict, delivered: true, lost: false, rebroadcasts: 0,
    root: xRoot, total: xTotal, count: xCount }
pure def snapshot(xEntries: List[J::JournalEntry], xNonce: int, xFinalized: int, xHeight: int, xTime: int,
    xAdmissions: List[J::Admission], xLeaves: List[J::JournalKey], xCursors: List[J::Cursor]): J::Journal =
  { entries: xEntries, nextNonce: xNonce, finalizedNonce: xFinalized, height: xHeight, time: xTime,
    admissions: xAdmissions, leaves: xLeaves, cursors: xCursors }
pure def v2Journal(p: int, xTree: Tree, n: int): J::Journal =
  val opens = Mc::windowOpensAt(p)
  val v2Key = J::rootKey(p, J::V2Root)
  val leaf0 = J::keyOf(p, J::Leaf, xTree.root, 0)
  val leaf1 = J::keyOf(p, J::Leaf, xTree.root, 1)
  val live = entryOf(v2Key, 1, 0, J::Live, J::Unknown, xTree.root, xTree.total, xTree.count)
  val won = entryOf(v2Key, 1, 0, J::Settled, J::Succeeded, xTree.root, xTree.total, xTree.count)
  val ownLeaf = entryOf(leaf0, 2, 1, J::Settled, J::Succeeded, xTree.root, M::zero, 0)
  val admission = J::admissionOf(p, J::V2Root, xTree.root, xTree.total, xTree.count, 1)
  if (n == 1) snapshot(List(live), 1, 0, 1, opens, List(), List(), List())
  else if (n == 2) snapshot(List(won), 1, 1, 2, opens, List(admission), List(), List())
  else if (n == 3) snapshot(List(won, ownLeaf), 2, 2, 3, opens, List(admission), List(leaf0), List({ period: p, root: xTree.root, next: 1 }))
  else if (n == 4) snapshot(List(won, ownLeaf), 2, 2, 4, opens, List(admission), List(leaf0, leaf1), List({ period: p, root: xTree.root, next: 2 }))
  else snapshot(List(), 0, 0, 2, opens, List({ ...admission, total: List(6), winner: 0 }), List(), List())
pure def monthJournal(p: int, n: int): J::Journal =
  val opens = Mc::windowOpensAt(p)
  val legacyKey = J::rootKey(p, J::LegacyRoot)
  val otherV1 = J::admissionOf(p, J::LegacyRoot, "v1", List(5), 2, 0)
  val ownV1 = J::admissionOf(p, J::LegacyRoot, "r1", List(5), 2, 1)
  if (n == 1) snapshot(List(entryOf(legacyKey, 1, 0, J::Live, J::Unknown, "r1", List(5), 2)), 1, 0, 1, opens, List(otherV1), List(), List())
  else if (n == 2) snapshot(List(entryOf(legacyKey, 1, 0, J::Settled, J::Reverted, "r1", List(5), 2)), 1, 1, 2, opens, List(otherV1), List(), List())
  else if (n == 3) snapshot(List(entryOf(legacyKey, 1, 0, J::Settled, J::Succeeded, "r1", List(5), 2)), 1, 1, 2, opens, List(ownV1), List(), List())
  else snapshot(List(), 0, 0, 1, Mc::windowClosesAt(p), List(), List(), List())
pure val journalValues = Set(
  monthJournal(202611, 1), monthJournal(202611, 2), monthJournal(202611, 3), monthJournal(202611, 4),
  v2Journal(202611, treeR1, 1), v2Journal(202611, treeR1, 2), v2Journal(202611, treeR1, 3), v2Journal(202611, treeR1, 4), v2Journal(202611, treeR1, 5),
  v2Journal(202611, treeR2, 1), v2Journal(202611, treeR2, 2), v2Journal(202611, treeR2, 3), v2Journal(202611, treeR2, 5),
  monthJournal(202612, 1), monthJournal(202612, 2), monthJournal(202612, 3), monthJournal(202612, 4),
  v2Journal(202612, treeR1, 1), v2Journal(202612, treeR1, 2), v2Journal(202612, treeR1, 3), v2Journal(202612, treeR1, 4), v2Journal(202612, treeR1, 5),
  v2Journal(202612, treeR2, 1), v2Journal(202612, treeR2, 2), v2Journal(202612, treeR2, 3), v2Journal(202612, treeR2, 5))
```
