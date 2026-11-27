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
signed tree (root, remaining gross total, leaf count, the month's whole gross
and the frozen allocation digest), its source sequence, and for a version 2
EVM reserve the retained original V1 root, if any. It also records the
latest attempt the authorization journal has signed for the month, which
starts as the published one. A row is
pending, submitted to the executor, complete, or held: held as a wrong-total
reservation, a released wrong-total reservation, or a month whose admission
window closed unadmitted. A completed row never changes, and every step
touches at most one row. The publisher refuses a month unless the frozen
run's own vault holds a stored pledge for it above zero or the project's
automatic default is on, as [month pledges](./monthPledges.md) "Publication,
a newer attempt and on-chain admission need a pledge in the run's own vault
or the automatic default on" requires (`runConsent`).

Discovered by simulation: the actor sample names each role that moves a row
(the scheduler, the attester that signs a later attempt and the publisher
that retains it) and one stranger, because every guard names its actor. The
tree sample is one whole month of two leaves, the same month signed again
with one leaf left at the same whole gross and digest, the same month with
no retained V1 root, an empty root, and a later tree whose whole gross
differs, so that a later attempt is both accepted and refused.

```quint
import monthly as Mo from "./monthly"
import monthPledges as P from "./monthPledges"
import money as M from "./money"
import monthlyCommitment as Mc from "./monthlyCommitment"
import executorJournal as J from "./executorJournal"
import reserveRelease as R from "./reserveRelease"
type RowPhase = Pending | Submitted | Complete | WrongTotal | Released | ClosedUnadmitted
type Tree = { root: str, total: M::Amount, count: int, legacyRoot: str, whole: M::Amount, digest: str }
type Row = { key: int, project: int, period: int, network: int, vault: int, v2: bool, solana: bool,
  lastAttempt: int, phase: RowPhase, invalidated: bool, height: int, attempts: int,
  root: str, total: M::Amount, leafCount: int, legacyRoot: str, sequence: int, journal: J::Journal,
  heldTotal: M::Amount, sentNonce: int, lastAdmit: bool, sentWithoutAdmit: bool,
  wholeGross: M::Amount, digest: str, latest: Tree, latestSequence: int, latestSource: int,
  consent: bool, active: bool, restricted: bool }
type Execution = { rows: List[Row], now: int, ordinaryRun: List[int], prerequisiteRun: List[int], reverts: int, touched: int,
  processed: List[int], sends: int, batch: List[int], prerequisiteBatch: List[int] }
pure val batchLimit = 50
pure val initial: Execution = { rows: List(), now: 0, ordinaryRun: List(), prerequisiteRun: List(), reverts: 0, touched: 0,
  processed: List(), sends: 0, batch: List(), prerequisiteBatch: List() }
pure def hasRow(e: Execution, key: int): bool = e.rows.some(r => r.key == key)
pure def recordedAwardsOf(row: Row): int = if (row.solana) 0
  else row.journal.admissions.foldl(0, (n, a) => if (a.kind == J::LegacyRoot) n + a.count else n) + row.journal.leaves.length()
pure def sourceOf(e: Execution, project: int, network: int, vault: int): int =
  e.rows.foldl(0, (n, o) => if (o.project == project and o.network == network and o.vault == vault) n + recordedAwardsOf(o) else n)
pure def validTree(tree: Tree): bool = tree.root != "" and tree.count > 0 and M::validAmount(tree.total) and M::positiveAmount(tree.total)
  and M::validAmount(tree.whole) and M::compareAmounts(tree.total, tree.whole) <= 0 and tree.digest != ""
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
    heldTotal: M::zero, sentNonce: -1, lastAdmit: false, sentWithoutAdmit: false,
    wholeGross: tree.whole, digest: tree.digest, latest: tree, latestSequence: 1,
    latestSource: sourceOf(e, project, network, vault), consent: false, active: false, restricted: false }) }
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
pure val byValues = Set("scheduler", "attester", "publisher", "other")
pure val treeR1: Tree = { root: "r1", total: List(5), count: 2, legacyRoot: "v1", whole: List(5), digest: "d1" }
pure val treeR2: Tree = { root: "r2", total: List(3), count: 1, legacyRoot: "v1", whole: List(5), digest: "d1" }
pure val treeValues = Set(treeR1, { ...treeR1, legacyRoot: "" }, treeR2, { ...treeR1, root: "" }, { ...treeR2, whole: List(6) })
```

### Each run attempts the least recently attempted rows first

A run starts at a later scheduler time and first selects its whole batch,
before it attempts any row: at most 50 pending rows, least recently
attempted first. A legacy EVM row is selectable only in its own admission
window (the source's `activePeriod`); a version 2 EVM or Solana row is
selectable in any later run, because an admitted month stays resumable. The
batch adds any omitted version 2 EVM root of the active period whose same
project, network and vault has a selected older version 2 row, at most 50
more (the prerequisite query of `runMonthlyCommitments`, one SQL statement
that reads every row before any attempt is recorded). No row is attempted
until the batch is whole: the ordinary batch holds 50 rows or every
selectable pending row, and the prerequisite batch holds 50 rows or every
waited-on root (`batchComplete`). The run then attempts
its batch one row at a time, newest period first (the source sorts the
selected items by period, newest first, and awaits each item before the
next): a row is attempted only after every row already attempted in the run
has been processed and while no newer pending row of the batch is still
unprocessed. The attempt time is recorded before the attempt, so a crash
during the attempt still moves the row to the back of the queue. Held and
complete rows are not selected.

Discovered by simulation: the scheduler clock is sampled at real window
boundaries (`Mc::windowOpensAt` and `Mc::windowClosesAt` of the sampled
periods, and one instant before any window), because selection and
admission depend on the window of the row's period.

```quint
pure def windowOpen(period: int, now: int): bool = Mc::windowOpensAt(period) <= now and now < Mc::windowClosesAt(period)
pure def selectable(e: Execution, row: Row): bool = row.v2 or row.solana or windowOpen(row.period, e.now)
pure def attemptedThisRun(e: Execution, key: int): bool = e.ordinaryRun.includes(key) or e.prerequisiteRun.includes(key)
pure def inBatch(e: Execution, key: int): bool = e.batch.includes(key) or e.prerequisiteBatch.includes(key)
pure def canStartRun(e: Execution, now: int, by: str): bool = by == "scheduler" and now > e.now
pure def startRun(e: Execution, now: int, by: str): Execution =
  { ...e, now: now, ordinaryRun: List(), prerequisiteRun: List(), touched: 0, processed: List(), batch: List(), prerequisiteBatch: List() }
pure def leastRecent(e: Execution, row: Row): bool =
  e.rows.every(o => (o.phase == Pending and selectable(e, o) and not(inBatch(e, o.key))) implies o.lastAttempt >= row.lastAttempt)
pure def waitedOn(e: Execution, row: Row): bool = row.v2 and windowOpen(row.period, e.now) and e.batch.some(k =>
  e.rows.some(o => o.key == k and o.v2 and o.project == row.project and o.network == row.network
    and o.vault == row.vault and o.period < row.period))
pure def canSelectRow(e: Execution, key: int, prerequisite: bool, by: str): bool =
  by == "scheduler" and e.now > 0 and e.ordinaryRun.length() == 0 and e.prerequisiteRun.length() == 0 and not(inBatch(e, key))
    and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and selectable(e, r)
      and (if (prerequisite) waitedOn(e, r) else leastRecent(e, r))))
    and (if (prerequisite) e.prerequisiteBatch.length() < batchLimit else e.batch.length() < batchLimit)
pure def selectRow(e: Execution, key: int, prerequisite: bool, by: str): Execution =
  { ...e, touched: key,
    batch: if (prerequisite) e.batch else e.batch.append(key),
    prerequisiteBatch: if (prerequisite) e.prerequisiteBatch.append(key) else e.prerequisiteBatch }
pure def newerRootPending(e: Execution, row: Row): bool =
  e.rows.some(o => o.key != row.key and inBatch(e, o.key) and not(e.processed.includes(o.key))
    and o.phase == Pending and o.period > row.period)
pure def batchComplete(e: Execution): bool =
  (e.batch.length() == batchLimit or not(e.rows.some(o => o.phase == Pending and selectable(e, o) and not(inBatch(e, o.key)))))
  and (e.prerequisiteBatch.length() == batchLimit or not(e.rows.some(o => o.phase == Pending and not(inBatch(e, o.key)) and waitedOn(e, o))))
pure def canMarkAttempt(e: Execution, key: int, runVaultPledged: bool, automatic: bool, active: bool, restricted: bool, by: str): bool =
  by == "scheduler" and inBatch(e, key) and not(attemptedThisRun(e, key)) and e.now > 0 and batchComplete(e)
    and e.ordinaryRun.every(k => e.processed.includes(k)) and e.prerequisiteRun.every(k => e.processed.includes(k))
    and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and not(newerRootPending(e, r))))
    and (if (e.batch.includes(key)) e.ordinaryRun.length() < batchLimit else e.prerequisiteRun.length() < batchLimit)
pure def markAttempt(e: Execution, key: int, runVaultPledged: bool, automatic: bool, active: bool, restricted: bool, by: str): Execution =
  { ...e, touched: key,
    rows: e.rows.listMap(r => if (r.key == key) { ...r, lastAttempt: e.now, attempts: r.attempts + 1,
      consent: P::runConsent(runVaultPledged, automatic), active: active, restricted: restricted } else r),
    ordinaryRun: if (e.batch.includes(key)) e.ordinaryRun.append(key) else e.ordinaryRun,
    prerequisiteRun: if (e.batch.includes(key)) e.prerequisiteRun else e.prerequisiteRun.append(key) }
pure def alwaysRunBounded(e: Execution): bool = e.ordinaryRun.length() <= batchLimit and e.prerequisiteRun.length() <= batchLimit
pure def alwaysAttemptRecorded(e: Execution): bool = e.now >= 0
  and e.rows.every(r => (attemptedThisRun(e, r.key) implies r.lastAttempt == e.now) and r.lastAttempt <= e.now)
  and e.ordinaryRun.every(k => hasRow(e, k)) and e.prerequisiteRun.every(k => hasRow(e, k))
  and e.processed.every(k => attemptedThisRun(e, k))
pure val nowValues = Set(Mc::monthStart(202612), Mc::windowOpensAt(202611), Mc::windowClosesAt(202611), Mc::windowClosesAt(202612))
pure val prerequisiteValues = Set(false, true)
```

### A newer admitting root goes first, so no older leaf reverts it

Every ordinary award the escrow records advances the vault's
`ordinarySourceSequence`: each entry of a legacy `commitMonthly`, each
`commitMonthlyLeaf` of any month and each owner `commitAward`
(`ProjectEscrow.sol` `recordAward`). `reserveMonthly` reverts
`MonthlySourceChanged` whenever the reservation's signed source sequence
differs from the current one; no other monthly step reads it, so a root
that is already admitted is never reverted this way. The model counts the
source sequence of a project, network and vault from the finalized
journals of its rows (`sourceOf`: every admitted V1 root adds its leaf
count, every committed leaf adds one) and records, for each row, the
sequence its latest attempt was signed at (`latestSource`, taken from that
count when the month is published and when a later attempt is signed).

So a version 2 root that is not yet admitted reverts when it is sent in
either of two cases. First, the source sequence has already moved past the
one its attempt was signed at, whether by an older month's commit, a newer
month's leaf or another sender: that root can never land again, and only a
later attempt signed at the new sequence can be sent. Second, another step
of the same project, network and vault that records awards was sent before
it and is still in flight, of any period: a legacy row's `commitMonthly`, a
leaf of an admitted version 2 month, or any live V1 root or leaf attempt in
that month's exact-byte journal. Under the stated adapter assumption
`sameSignerNonceOrder` (one executor signer sends every monthly step of a
vault, each send takes that signer's next nonce, and a later nonce of that
signer never mines before an earlier one) that step mines first and moves
the sequence. `reorderReverts` states both cases from the row's own facts,
and a send records it on the row as `invalidated`; a later finalized
landing of an invalidated root is the chain's revert, which returns the row
to pending and counts it in `reverts`. The law `alwaysNoReorderingRevert`
requires that neither ever happens.

The executor's guard is operational and coarser: `revertsIfSent` refuses
a root send while the signed source sequence moved, or while any other step
of the same project, network and vault is in flight (the row is submitted,
or its journal holds any live attempt, including a version 2 root attempt
that records no award). The law checks that this guard covers every
reverting send; before the merge the effect marked newer submitted roots
when an older row was sent, which under `sameSignerNonceOrder` is no
revert, because that newer root took the earlier nonce and mines first.
The refused attempt is answered `Failed` and the row stays pending, so one
refusal never blocks the rest of the run. Discovered by review: the earlier
guard looked only at older periods, so an older month's unadmitted root
could be sent while a newer admitted month's leaves were in flight, and the
leaves would mine first and revert it; the guard now names every period.
The model records each send's nonce as `sentNonce` for evidence; the order
between nonces is the assumption, not a modelled comparison.

Ordering across periods is in-run only, as the source orders it: within a
run the batch is attempted newest period first (above), so a newer month's
root is sent before an older month's leaf of the same run. Across runs the
spec, like both sources, does not wait for a newer root: an older row may
be sent while a newer version 2 root of the same vault is not yet admitted
and not in flight. Its commit then moves the source sequence under that
root, which can no longer be admitted; the authorization journal signs a
later attempt at the new sequence while the window is open
(`canSignAttempt` below, `monthlyCommitment` `canSignEvm`). An earlier
version of this unit also refused such an older send until the newer root
was admitted or closed (`newerRootIncomplete`); no source refuses it, the
plan item that audited it asked for in-run ordering, and no owner decision
recorded a stricter rule, so it was removed. A failed or refused newer-root
prerequisite is processed in the run, so it no longer holds back the
original older row of that run (development `runMonthlyCommitments`: the
original candidates "still run after a prerequisite failure").

Source gap: development `submitEvmMonthlyReserve` and vibestack
`submitReserve` neither check the signer's other in-flight steps of the
vault nor wait before a root send; their gas estimate refuses a stale root
only once the moving step has mined. The spec refuses those sends.

Source gap: vibestack `serveMonths` does not implement the run described
here. It walks one deployment's months from `schedule.firstPeriod` up to
the current period, oldest first, and awaits each month before the next; it
has no least-recently-attempted batch of 50, no prerequisite query, no
attempt time, and no newest-first order, so within one of its runs an older
month's leaf is sent before a newer month's root. It does not refuse a root
send while another step of the vault is in flight, and it does not hold a
`WrongTotal` or `ClosedUnadmitted` month: such months are submitted on
every run and answered with a refusal. The run order, batch, prerequisites
and holds of this unit come from development `runMonthlyCommitments`; the
vibestack keeper differs from them until its code changes.

The composition assumption for observed journals is that a row's journal
holds every attempt the executor sent for that month (the exact-byte
journal is written before broadcast), so a dropped submission is reported
only once its journal shows no live attempt (below).

Submitting needs an attempt recorded in this run, and each row is processed
at most once per run. A failed send leaves that row pending and touches no
other row. Recording the attempt also reads the row's admission context at
that time, as both sources do for each item: the run's consent
(`P::runConsent` of the frozen run's own vault pledge and the project's
automatic default, read again, so an owner opt-out after publication
counts), whether the project is active, and whether it is restricted.
Admission uses `admit`: that consent, an active and unrestricted project,
the period's admission window open at the scheduler clock, and the row
holding the latest attempt the authorization journal signed
(`stepAdmissionNeedsCurrentConsent`). Source gap: development
`runMonthlyCommitments` computes `admit` from `runConsent` and the window
only, and refuses a deployment it no longer serves by throwing; vibestack
`serveMonths` computes it from `fresh`, `projectActive`, `!restricted` and
the window, without `runConsent`. The spec requires every term of both.
Vibestack admits only an authorization it has just read from the
publication (`fresh`), never a stored older one, but that publication can
still lag a later attempt that is signed and not yet published; the spec is
stricter and admits only the latest signed attempt. Without admission, a
legacy row is skipped, and a version 2 row whose journal shows no admitted
root is answered `notAdmitted` and stays pending; a version 2 row whose root
is already admitted is still sent, because an admitted month stays
resumable. A Solana row is still sent to its executor with `admit=false`
(development `runMonthlyCommitments` sends every resumable row), and that
executor answers `notAdmitted` when its month is absent
(`workers/payment-executor/README.md`: "an absent month returns
`notAdmitted: true`"). This unit models no Solana month state, so without
admission either answer fits a Solana row; it is still sent, not skipped.

Discovered by simulation: the send sample adds `NotAdmitted` beside `Sent`
and `Failed`, because a version 2 row with no admitted root answers it
whenever admission is off, and without it such a row could never be
processed.

```quint
type SendResult = Sent | Failed | NotAdmitted
pure def resultFits(row: Row, sendResult: SendResult, admit: bool): bool =
  if (admit) sendResult != NotAdmitted
  else if (row.solana) true
  else if (row.v2 and J::admitted(row.journal, row.period)) sendResult != NotAdmitted
  else sendResult == NotAdmitted
pure def fresh(row: Row): bool = row.sequence == row.latestSequence
pure def admissible(row: Row): bool = row.consent and row.active and not(row.restricted)
pure def sameVault(o: Row, row: Row): bool = o.key != row.key and not(o.solana) and o.project == row.project
  and o.network == row.network and o.vault == row.vault
pure def liveAny(j: J::Journal): bool = j.entries.some(x => x.phase == J::Live)
pure def inFlight(o: Row): bool = o.phase == Submitted or liveAny(o.journal)
pure def vaultStepInFlight(e: Execution, row: Row): bool = e.rows.some(o => sameVault(o, row) and inFlight(o))
pure def revertsIfSent(e: Execution, row: Row): bool = row.v2 and not(J::admitted(row.journal, row.period))
  and (row.latestSource != sourceOf(e, row.project, row.network, row.vault) or vaultStepInFlight(e, row))
pure def recordsAwards(o: Row): bool = (o.phase == Submitted and (not(o.v2) or J::admitted(o.journal, o.period)))
  or o.journal.entries.some(x => x.phase == J::Live and x.key.kind != J::V2Root)
pure def reorderReverts(e: Execution, row: Row): bool = row.v2 and not(J::admitted(row.journal, row.period))
  and (row.latestSource != sourceOf(e, row.project, row.network, row.vault)
    or e.rows.some(o => sameVault(o, row) and recordsAwards(o)))
pure def canSubmit(e: Execution, key: int, sendResult: SendResult, admit: bool, by: str): bool =
  by == "scheduler" and attemptedThisRun(e, key) and not(e.processed.includes(key)) and e.rows.some(r => r.key == key and r.phase == Pending)
    and e.rows.every(r => r.key != key or (r.phase == Pending and r.lastAttempt == e.now and not(newerRootPending(e, r))
      and admit == (admissible(r) and windowOpen(r.period, e.now) and fresh(r)) and resultFits(r, sendResult, admit)
      and (sendResult == Sent implies not(revertsIfSent(e, r)))))
pure def submit(e: Execution, key: int, sendResult: SendResult, admit: bool, by: str): Execution =
  if (sendResult != Sent) { ...e, touched: key, processed: e.processed.append(key) }
  else { ...e, touched: key, processed: e.processed.append(key), sends: e.sends + 1, rows: e.rows.listMap(o =>
    if (o.key == key) { ...o, phase: Submitted, sentNonce: e.sends, lastAdmit: admit, sentWithoutAdmit: o.sentWithoutAdmit or not(admit),
      invalidated: reorderReverts(e, o) }
    else o) }
pure def alwaysNoReorderingRevert(e: Execution): bool = e.reverts == 0 and e.rows.every(r => not(r.invalidated))
pure def alwaysSentNoncesIssued(e: Execution): bool = e.sends >= 0
  and e.rows.every(r => r.sentNonce < e.sends and (r.sentNonce >= 0 or r.sentNonce == -1))
pure def stepNoAdmissionWithoutAdmit(before: Execution, after: Execution): bool =
  after.rows.every(r => (r.phase == Submitted and not(r.lastAdmit) and before.rows.some(o => o.key == r.key and o.phase == Pending))
    implies (r.solana or J::admitted(r.journal, r.period)))
pure def stepAdmissionUsesLatestAttempt(before: Execution, after: Execution): bool =
  after.rows.every(r => (r.phase == Submitted and r.lastAdmit and before.rows.some(o => o.key == r.key and o.phase == Pending))
    implies (fresh(r) and r.root == r.latest.root))
pure def stepAdmissionNeedsCurrentConsent(before: Execution, after: Execution): bool =
  after.rows.every(r => (r.phase == Submitted and r.lastAdmit and before.rows.some(o => o.key == r.key and o.phase == Pending))
    implies (admissible(r) and windowOpen(r.period, after.now)))
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
did not complete the month, returns the row to pending for a later run,
once the row's journal shows no live attempt. A
root whose source changed after submission would revert; the ordering rule
keeps that from happening.

```quint
type Landing = Landed | Dropped
pure def landingFits(row: Row, landing: Landing): bool = if (landing == Dropped) not(liveAny(row.journal))
  else if (row.invalidated) true
  else not(row.v2) and (row.solana or (J::admittedLegacy(row.journal, row.period, row.root) and J::rootSettled(row.journal, row.period)))
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
row's current root with its signed leaf count, while the row holds the
latest signed attempt, and a V1 root is the row's own
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
  if (a.kind == J::V2Root) row.v2 and fresh(row) and a.root == row.root and a.count == row.leafCount
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

[The authorization journal](./monthlyCommitment.md) signs a later attempt
for a version 2 month only inside its admission window and only at a view
with no admitted root and a newer source sequence; a later attempt keeps the
frozen request, so the same allocation digest and whole gross, and the same
retained V1 authorization, while its remaining tree may hold fewer leaves.
Two numbers describe an attempt here, and they are kept apart. `sequence`
and `latestSequence` are D1's attempt order, the source sequence each
attempt is published under, which only increases. `latestSource` is the
modelled escrow source sequence (`sourceOf`, the finalized awards of the
vault's rows) at which the latest attempt was signed. A later attempt is
signed only once that modelled source has moved past `latestSource`, as
`canSignEvm` requires a view source sequence above every stored attempt's;
so an older attempt, signed at an older source, can never be admitted after
a newer one is signed, which is the composition assumption the journal
reads rely on (`admissionFits`). Owner `commitAward` awards also move the
chain sequence; this unit does not model them, so here a later attempt is
reached only through finalized monthly commits. The scheduler reads the month's
current authorization (`monthly_payment_current_authorizations`); the
publisher replaces the retained one only with that latest attempt, which
must have a strictly higher source sequence, the same whole gross, the same
frozen request and allocation digest, and the same retained V1
authorization (`retainAuthorization` refuses anything else as "Published
authorization is not a later execution attempt" or "Published authorization
changed the frozen allocation"), and only while the month's journal shows
no admitted root. A root is admitted only from the latest attempt, and the
executor admits only while the row holds it (above). Once a root is
admitted the row's root never changes. The cursor is read under the row's
current root, so a replaced tree never inherits another root's progress.
Here `attester` names the signing service's role, like `scheduler` and
`publisher`, not one identity key: which key signs, and the hold of an
attempt signed by a former authority after a rotation
(`SignedByFormerAuthority`), belong to the journal, whose `canSignEvm`
signs only with the view's current identity authority. This unit does not
model signatures, so an attempt the contract would refuse for its signer is
never admitted here either: a root counts as admitted only when finalized
contract state in the row's [executor journal](./executorJournal.md) shows it.

Discovered by simulation: one later source sequence is enough to sign,
retain and admit a later attempt and to refuse a second one at the same
sequence.

```quint
pure def laterAttempt(row: Row, tree: Tree): bool = validTree(tree) and tree.legacyRoot == row.legacyRoot
  and tree.whole == row.wholeGross and tree.digest == row.digest
pure def canSignAttempt(e: Execution, key: int, sequence: int, tree: Tree, by: str): bool =
  by == "attester" and e.rows.some(r => r.key == key and r.v2 and (r.phase == Pending or r.phase == Submitted))
    and e.rows.every(r => r.key != key or (sequence > r.latestSequence and laterAttempt(r, tree)
      and sourceOf(e, r.project, r.network, r.vault) > r.latestSource
      and windowOpen(r.period, e.now) and not(J::admitted(r.journal, r.period))))
pure def signAttempt(e: Execution, key: int, sequence: int, tree: Tree, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key)
    { ...r, latest: tree, latestSequence: sequence, latestSource: sourceOf(e, r.project, r.network, r.vault) } else r) }
pure def canReauthorize(e: Execution, key: int, sequence: int, tree: Tree, by: str): bool =
  by == "publisher" and e.rows.some(r => r.key == key and r.v2 and (r.phase == Pending or r.phase == Submitted))
    and e.rows.every(r => r.key != key or (sequence > r.sequence and sequence == r.latestSequence and tree == r.latest
      and laterAttempt(r, tree) and not(J::admitted(r.journal, r.period))))
pure def reauthorize(e: Execution, key: int, sequence: int, tree: Tree, by: str): Execution =
  { ...e, touched: key, rows: e.rows.listMap(r => if (r.key == key)
    { ...r, sequence: sequence, root: tree.root, total: tree.total, leafCount: tree.count } else r) }
pure def alwaysLatestAttemptKnown(e: Execution): bool = e.rows.every(r => r.sequence >= 1 and r.sequence <= r.latestSequence
  and validTree(r.latest) and r.latest.legacyRoot == r.legacyRoot and r.latest.whole == r.wholeGross
  and r.latest.digest == r.digest
  and (fresh(r) implies r.root == r.latest.root and r.total == r.latest.total and r.leafCount == r.latest.count))
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
decision gate: both phases stay distinct and neither is complete. Source
gap: both executors pass each remaining leaf of a zero-remainder month on
its journaled nonce alone and then report the month complete
(`complete: rootSettled && index === entries.length`), so they count a
wholly released month as complete; [monthly
settlement](./monthlySettlement.md) states that cursor branch
(`canAdvanceZeroRemaining`), while the [journal](./executorJournal.md)
cursor passes only committed leaves and a released row here reads only a
journal with no committed leaf, so its cursor never passes a leaf and the
row stays `Released` until the owner decision is made. Other
admitted-state mismatches (another root, digest or count) also throw in the
source; the composition assumption above excludes them. Source gap: the
development scheduler keeps a held row in its batch and lets the executor
throw on every run; the spec holds it out of the batch.

A leaf conflict is not held. When an admitted leaf's source already holds
an award with another actor, gross or fee, both executors throw
`Admitted monthly source conflicts with a funded award` on every run
(development `submitEvmMonthlyReserve`, vibestack `submitReserve`), before
the leaf is sent and before the cursor moves. Here that run's send is
answered `Failed`, the row stays pending and is selected again, and the
journal never commits that leaf, so its cursor cannot pass it
(`J::canAdvanceCursor`) and the row never completes. Recording the conflict
in D1 belongs to [monthly settlement](./monthlySettlement.md)
(`canObserveConflict`); resolving it is a human decision. Source gap:
neither source holds such a row out of its batch, and neither does this
unit, so a conflicted month keeps one batch slot on every run.

Discovered by simulation: the release receipt sample is one finalized
release of the held total of the wrong-total root, beside a receipt for
another root, one for another amount and one not yet finalized, so that a
release is both reached and refused.

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
    and r.heldTotal == v2Total(r.journal, r.period, r.root))
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

Discovered by simulation: journals are sampled as whole snapshots for each
sampled period and tree, because a free journal almost never satisfies the
journal's own rules and the row's admitted root, so no version 2 row would
ever complete or be held.

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
pure val eval_witness_sometimesPrerequisiteIncluded = (
  ("publish", 1, 1, 202611, 1, 1, true, true, true, false, treeR1, "scheduler"),
  ("publish", 2, 1, 202612, 1, 1, true, true, true, false, treeR1, "scheduler"),
  ("startRun", Mc::windowClosesAt(202611), "scheduler"),
  ("selectRow", 1, false, "scheduler"),
  ("selectRow", 2, true, "scheduler"),
  ("markAttempt", 2, true, true, true, false, "scheduler"))
pure val eval_witness_sometimesReauthorizedThenAdmitted = (
  ("publish", 1, 1, 202611, 1, 1, true, true, true, false, treeR1, "scheduler"),
  ("publish", 2, 1, 202612, 1, 1, true, true, true, false, treeR1, "scheduler"),
  ("observeJournal", 1, v2Journal(202611, treeR1, 4), "scheduler"),
  ("complete", 1, "scheduler"),
  ("startRun", Mc::windowOpensAt(202612), "scheduler"),
  ("signAttempt", 2, 2, treeR2, "attester"),
  ("reauthorize", 2, 2, treeR2, "publisher"),
  ("observeJournal", 2, v2Journal(202612, treeR2, 2), "scheduler"))
```
