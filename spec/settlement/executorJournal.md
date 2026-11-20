# Monthly executor exact-byte journal

PRD sections 6 and 11: the monthly executor never claims a step done before
finalized evidence proves it, and it never abandons an uncertain transaction
to sign a different one. This journal is the executor's retry record for one
signer of one vault. Each key is one monthly step: the legacy V1 root of a
month (`monthly:<network>:<vault>:<period>`), the version 2 reserve root of a
month (`monthly:v2:<network>:<vault>:<period>`), or one leaf of an admitted
version 2 tree (`monthly:v2:…:<period>:<root>:leaf:<index>`), and the leaf
cursor is keyed by the admitted tree root
(`monthly:v2:…:<period>:<root>:finalized-cursor`). Source anchors are
vibestack `apps/settlement/src/keeper/monthly.vibe` (`sendJournaledUntilFinalized`,
`resubmitted`, `signedAndSent`, `submitReserve`) and
`apps/settlement/src/keeper/attempts.vibe` (`signNewAttempt`,
`retireReverted`), and development `workers/payment-executor/core.ts`
(`sendJournaledUntilFinalized`, `retireRevertedAttempt`,
`submitEvmMonthlyReserve`). [Monthly commitment execution](./monthlyExecution.md)
reads this journal for root settlement, the admitted root and the cursor.

## Story: Keep one exact-byte attempt per monthly step until finalized evidence settles or retires it

### A step has at most one live attempt, and only a finalized revert frees its key for new bytes

A new attempt for a key is signed only when the key has no live attempt and
the step is not already committed on chain (`signNewAttempt` returns the
journaled attempt for an existing key and refuses other bytes as an
idempotency collision). Each new attempt takes the signer's next nonce. A
call whose answer is lost leaves the attempt live, and a later run offers the
same bytes again while the signer's mined nonce has not passed it. A
version 2 root is signed only after the same month's legacy key has no live
attempt: `submitReserve` first rebroadcasts a live legacy attempt and returns.
A leaf is signed only under the month's admitted version 2 root, below its
leaf count.

```quint
import money as M from "./money"
type StepKind = LegacyRoot | V2Root | Leaf
type JournalKey = { period: int, kind: StepKind, root: str, leaf: int }
type EntryPhase = Live | Retired | Settled
type Outcome = Unknown | Succeeded | Reverted
type JournalEntry = { key: JournalKey, bytes: int, nonce: int, phase: EntryPhase, verdict: Outcome,
  delivered: bool, lost: bool, rebroadcasts: int, root: str, total: M::Amount, count: int }
type Admission = { period: int, kind: StepKind, root: str, total: M::Amount, count: int, winner: int }
type Cursor = { period: int, root: str, next: int }
type Journal = { entries: List[JournalEntry], nextNonce: int, finalizedNonce: int, height: int, time: int,
  admissions: List[Admission], leaves: List[JournalKey], cursors: List[Cursor] }
pure val emptyJournal: Journal = { entries: List(), nextNonce: 0, finalizedNonce: 0, height: 0, time: 0,
  admissions: List(), leaves: List(), cursors: List() }
pure val initial: Journal = emptyJournal
pure def validKey(k: JournalKey): bool = k.period > 0
  and (if (k.kind == Leaf) k.root != "" and k.leaf >= 0 else k.root == "" and k.leaf == 0)
pure def keyOf(period: int, kind: StepKind, root: str, leaf: int): JournalKey = { period: period, kind: kind, root: root, leaf: leaf }
pure def rootKey(period: int, kind: StepKind): JournalKey = keyOf(period, kind, "", 0)
pure def hasLive(j: Journal, k: JournalKey): bool = j.entries.some(e => e.key == k and e.phase == Live)
pure def hasSettled(j: Journal, k: JournalKey): bool = j.entries.some(e => e.key == k and e.phase == Settled)
pure def admitted(j: Journal, period: int): bool = j.admissions.some(a => a.period == period)
pure def admittedV2(j: Journal, period: int, root: str): bool =
  j.admissions.some(a => a.period == period and a.kind == V2Root and a.root == root)
pure def admittedLegacy(j: Journal, period: int, root: str): bool =
  j.admissions.some(a => a.period == period and a.kind == LegacyRoot and a.root == root)
pure def leafCountOf(j: Journal, period: int, root: str): int =
  j.admissions.foldl(0, (n, a) => if (a.period == period and a.kind == V2Root and a.root == root) a.count else n)
pure def committed(j: Journal, k: JournalKey): bool =
  if (k.kind == Leaf) j.leaves.includes(k) else admitted(j, k.period)
pure def fitsStep(j: Journal, k: JournalKey): bool =
  if (k.kind == Leaf) admittedV2(j, k.period, k.root) and k.leaf < leafCountOf(j, k.period, k.root)
  else not(admitted(j, k.period))
pure def canSendNew(j: Journal, journalKey: JournalKey, root: str, total: M::Amount, count: int, delivered: bool): bool =
  validKey(journalKey) and not(hasLive(j, journalKey)) and not(hasSettled(j, journalKey))
    and not(committed(j, journalKey)) and fitsStep(j, journalKey)
    and (if (journalKey.kind == Leaf) root == journalKey.root and count == 0 and M::equalAmounts(total, M::zero)
      else root != "" and count > 0 and M::validAmount(total) and M::positiveAmount(total))
    and (journalKey.kind == V2Root implies not(hasLive(j, rootKey(journalKey.period, LegacyRoot))))
pure def sendNew(j: Journal, journalKey: JournalKey, root: str, total: M::Amount, count: int, delivered: bool): Journal =
  { ...j, nextNonce: j.nextNonce + 1, entries: j.entries.append({ key: journalKey, bytes: j.entries.length() + 1, nonce: j.nextNonce,
    phase: Live, verdict: Unknown, delivered: delivered, lost: not(delivered), rebroadcasts: 0, root: root, total: total, count: count }) }
pure def canRebroadcast(j: Journal, journalKey: JournalKey, delivered: bool): bool =
  j.entries.some(e => e.key == journalKey and e.phase == Live and e.nonce >= j.finalizedNonce)
pure def rebroadcast(j: Journal, journalKey: JournalKey, delivered: bool): Journal =
  { ...j, entries: j.entries.listMap(e => if (e.key == journalKey and e.phase == Live)
    { ...e, delivered: e.delivered or delivered, rebroadcasts: e.rebroadcasts + 1 } else e) }
pure val totalValues = Set(List(0), List(5), List(6))
pure val countValues = Set(0, 2)
pure val deliveredValues = Set(true, false)
```

### Only the signer's finalized nonce and finalized receipts decide a step

The finalized nonce never passes a nonce the signer has not broadcast. A
finalized receipt of an attempt either commits its step or reverts. Another
sender may commit a step permissionlessly; the adapter first reads this
signer's finalized receipts for that key, so a commit is attributed to
another sender only when every finalized attempt of the key reverted. A
month has one root, of either kind, and a leaf is committed only under the
month's admitted version 2 root.

```quint
pure def canObserveFinalized(j: Journal, nonce: int, height: int, time: int): bool =
  nonce > j.finalizedNonce and nonce <= j.nextNonce and height > j.height and time >= j.time
    and j.entries.every(e => e.nonce < nonce implies e.delivered)
pure def observeFinalized(j: Journal, nonce: int, height: int, time: int): Journal =
  { ...j, finalizedNonce: nonce, height: height, time: time }
pure def admissionOf(period: int, kind: StepKind, root: str, total: M::Amount, count: int, winner: int): Admission =
  { period: period, kind: kind, root: root, total: total, count: count, winner: winner }
pure def admissionFrom(e: JournalEntry): Admission = admissionOf(e.key.period, e.key.kind, e.root, e.total, e.count, e.bytes)
pure def canObserveReceipt(j: Journal, nonce: int, succeeded: bool): bool =
  j.entries.some(e => e.nonce == nonce and e.phase == Live and e.verdict == Unknown and e.nonce < j.finalizedNonce
    and (succeeded implies not(committed(j, e.key)) and fitsStep(j, e.key)))
pure val noEntry: JournalEntry = { key: rootKey(0, LegacyRoot), bytes: 0, nonce: -1, phase: Retired, verdict: Unknown,
  delivered: false, lost: false, rebroadcasts: 0, root: "", total: M::zero, count: 0 }
pure def entryAt(j: Journal, nonce: int): JournalEntry = j.entries.foldl(noEntry, (found, e) => if (e.nonce == nonce) e else found)
pure def observeReceipt(j: Journal, nonce: int, succeeded: bool): Journal =
  { ...j,
    entries: j.entries.listMap(x => if (x.nonce == nonce) { ...x, verdict: if (succeeded) Succeeded else Reverted } else x),
    admissions: if (succeeded and entryAt(j, nonce).key.kind != Leaf) j.admissions.append(admissionFrom(entryAt(j, nonce))) else j.admissions,
    leaves: if (succeeded and entryAt(j, nonce).key.kind == Leaf) j.leaves.append(entryAt(j, nonce).key) else j.leaves }
pure def canObserveOtherCommit(j: Journal, journalKey: JournalKey, root: str, total: M::Amount, count: int): bool =
  validKey(journalKey) and not(committed(j, journalKey)) and fitsStep(j, journalKey)
    and j.entries.every(e => (e.key == journalKey and e.nonce < j.finalizedNonce) implies e.verdict == Reverted)
    and (if (journalKey.kind == Leaf) root == journalKey.root and count == 0 and M::equalAmounts(total, M::zero)
      else root != "" and count > 0 and M::validAmount(total) and M::positiveAmount(total))
pure def observeOtherCommit(j: Journal, journalKey: JournalKey, root: str, total: M::Amount, count: int): Journal =
  if (journalKey.kind == Leaf) { ...j, leaves: j.leaves.append(journalKey) }
  else { ...j, admissions: j.admissions.append(admissionOf(journalKey.period, journalKey.kind, root, total, count, 0)) }
pure val nonceValues = Set(0, 1, 2, 3)
pure val heightValues = Set(1, 2, 3, 4)
pure val timeValues = Set(1, 2)
pure val succeededValues = Set(true, false)
```

### A live attempt settles once the finalized nonce passes it and the step is committed, and retires only on a finalized revert of an uncommitted step

`sendJournaledUntilFinalized` runs only once chain state shows the step
committed (a month root, or the leaf's award). It keeps offering the bytes
until the finalized nonce passes them, and then the step is settled, even if
this signer's own transaction reverted because another sender committed it
first. `retireReverted` runs only while the step is uncommitted; it retains
the attempt with its finalized revert under `<key>:reverted:<transaction>`
and clears the key. Every signed variant of an attempt shares one nonce, so
one finalized revert of any variant proves no variant of that attempt can
land. A retired or settled attempt is never changed or removed.

```quint
pure def canSettleStep(j: Journal, journalKey: JournalKey): bool =
  committed(j, journalKey) and j.entries.some(e => e.key == journalKey and e.phase == Live and e.nonce < j.finalizedNonce)
pure def settleStep(j: Journal, journalKey: JournalKey): Journal =
  { ...j, entries: j.entries.listMap(e => if (e.key == journalKey and e.phase == Live) { ...e, phase: Settled } else e) }
pure def canRetire(j: Journal, journalKey: JournalKey): bool =
  not(committed(j, journalKey))
    and j.entries.some(e => e.key == journalKey and e.phase == Live and e.verdict == Reverted and e.nonce < j.finalizedNonce)
pure def retire(j: Journal, journalKey: JournalKey): Journal =
  { ...j, entries: j.entries.listMap(e => if (e.key == journalKey and e.phase == Live) { ...e, phase: Retired } else e) }
```

### The leaf cursor of an admitted root passes a leaf only when it is committed and its attempt is settled

The cursor is stored per admitted tree root. It passes the next leaf only
when that leaf is committed and this signer holds no live attempt for it, and
never passes the root's leaf count. A month's root is settled when it is
admitted and neither root key of the month holds a live attempt.

```quint
pure def cursorOf(j: Journal, period: int, root: str): int =
  j.cursors.foldl(0, (n, c) => if (c.period == period and c.root == root) c.next else n)
pure def canAdvanceCursor(j: Journal, period: int, root: str): bool =
  admittedV2(j, period, root) and cursorOf(j, period, root) < leafCountOf(j, period, root)
    and j.leaves.includes(keyOf(period, Leaf, root, cursorOf(j, period, root)))
    and not(hasLive(j, keyOf(period, Leaf, root, cursorOf(j, period, root))))
pure def advanceCursor(j: Journal, period: int, root: str): Journal =
  if (j.cursors.some(c => c.period == period and c.root == root))
    { ...j, cursors: j.cursors.listMap(c => if (c.period == period and c.root == root) { ...c, next: c.next + 1 } else c) }
  else { ...j, cursors: j.cursors.append({ period: period, root: root, next: 1 }) }
pure def rootSettled(j: Journal, period: int): bool = admitted(j, period)
  and not(hasLive(j, rootKey(period, LegacyRoot))) and not(hasLive(j, rootKey(period, V2Root)))
pure def hasLiveRoot(j: Journal, period: int): bool =
  hasLive(j, rootKey(period, LegacyRoot)) or hasLive(j, rootKey(period, V2Root))
pure val periodValues = Set(202611)
pure val rootValues = Set("r1", "v1")
pure val journalKeyValues = Set(rootKey(202611, LegacyRoot), rootKey(202611, V2Root),
  keyOf(202611, Leaf, "r1", 0), keyOf(202611, Leaf, "r1", 1))
```

### The journal keeps every attempt, every committed step and every cursor

```quint
pure def alwaysOneLiveAttemptPerKey(j: Journal): bool =
  j.entries.every(e => e.phase != Live or j.entries.select(o => o.key == e.key and o.phase == Live).length() == 1)
pure def alwaysNoncesIssued(j: Journal): bool = j.finalizedNonce <= j.nextNonce
  and j.entries.every(e => validKey(e.key) and e.bytes > 0 and e.nonce >= 0 and e.nonce < j.nextNonce
    and j.entries.select(o => o.nonce == e.nonce).length() == 1 and j.entries.select(o => o.bytes == e.bytes).length() == 1)
pure def alwaysFinalizedWasBroadcast(j: Journal): bool = j.entries.every(e => e.nonce < j.finalizedNonce implies e.delivered)
pure def alwaysOneRootPerPeriod(j: Journal): bool =
  j.admissions.every(a => a.kind != Leaf and a.root != "" and a.count > 0
    and j.admissions.select(o => o.period == a.period).length() == 1)
pure def alwaysLeavesUnderAdmittedRoot(j: Journal): bool =
  j.leaves.every(k => k.kind == Leaf and admittedV2(j, k.period, k.root) and k.leaf >= 0 and k.leaf < leafCountOf(j, k.period, k.root)
    and j.leaves.select(o => o == k).length() == 1)
pure def alwaysSettledCommitted(j: Journal): bool =
  j.entries.every(e => e.phase == Settled implies committed(j, e.key) and e.nonce < j.finalizedNonce)
pure def alwaysRetiredReverted(j: Journal): bool =
  j.entries.every(e => e.phase == Retired implies e.verdict == Reverted and e.nonce < j.finalizedNonce)
pure def alwaysOutcomeFinalized(j: Journal): bool = j.entries.every(e => e.verdict != Unknown implies e.nonce < j.finalizedNonce)
pure def alwaysWinnerSucceeded(j: Journal): bool =
  j.admissions.every(a => a.winner == 0 or j.entries.some(e => e.bytes == a.winner and e.verdict == Succeeded and e.key.kind == a.kind))
pure def alwaysCursorBacked(j: Journal): bool =
  j.cursors.every(c => admittedV2(j, c.period, c.root) and c.next > 0 and c.next <= leafCountOf(j, c.period, c.root)
    and j.cursors.select(o => o.period == c.period and o.root == c.root).length() == 1
    and j.leaves.select(k => k.period == c.period and k.root == c.root and k.leaf < c.next).length() == c.next)
pure def entryKept(after: Journal, e: JournalEntry): bool =
  after.entries.some(x => x.key == e.key and x.bytes == e.bytes and x.nonce == e.nonce and x.root == e.root
    and (e.phase != Live implies x == e) and (e.verdict != Unknown implies x.verdict == e.verdict))
pure def stepAttemptsRetained(before: Journal, after: Journal): bool = before.entries.every(e => entryKept(after, e))
pure def stepRetiredRetained(before: Journal, after: Journal): bool =
  before.entries.every(e => e.phase == Retired implies after.entries.includes(e))
pure def stepSettledPermanent(before: Journal, after: Journal): bool =
  before.entries.every(e => e.phase == Settled implies after.entries.includes(e))
pure def stepNoNewBytesWhileLive(before: Journal, after: Journal): bool =
  after.entries.every(e => before.entries.some(o => o.bytes == e.bytes)
    or not(hasLive(before, e.key)))
pure def stepLegacyReconciledFirst(before: Journal, after: Journal): bool =
  after.entries.every(e => (e.key.kind == V2Root and not(before.entries.some(o => o.bytes == e.bytes)))
    implies not(hasLive(before, rootKey(e.key.period, LegacyRoot))))
pure def stepCommittedPermanent(before: Journal, after: Journal): bool =
  before.admissions.every(a => after.admissions.includes(a)) and before.leaves.every(k => after.leaves.includes(k))
pure def stepCursorMonotone(before: Journal, after: Journal): bool =
  before.cursors.every(c => cursorOf(after, c.period, c.root) >= c.next)
pure def stepFinalizedMonotone(before: Journal, after: Journal): bool =
  after.finalizedNonce >= before.finalizedNonce and after.nextNonce >= before.nextNonce
    and after.height >= before.height and after.time >= before.time
pure def sometimesResumedAfterLostCall(j: Journal): bool = j.entries.some(e => e.lost and e.rebroadcasts > 0 and e.phase == Settled)
pure def sometimesSentAgainAfterRevert(j: Journal): bool =
  j.entries.some(e => e.phase == Retired and j.entries.some(o => o.key == e.key and o.nonce > e.nonce and o.verdict == Succeeded))
pure def sometimesV2AfterLegacyReconciled(j: Journal): bool =
  j.entries.some(e => e.key.kind == V2Root and j.entries.some(o => o.key == rootKey(e.key.period, LegacyRoot)
    and o.phase == Retired and o.nonce < e.nonce))
pure def sometimesSettledAfterOtherSenderCommitted(j: Journal): bool =
  j.entries.some(e => e.phase == Settled and e.verdict == Reverted)
pure def sometimesCursorDone(j: Journal): bool =
  j.cursors.some(c => c.next == leafCountOf(j, c.period, c.root) and j.entries.some(e => e.key.kind == Leaf and e.phase == Settled))
```

### Observers of the journal accept only a later journal that keeps these rules

A reader such as [monthly commitment execution](./monthlyExecution.md) takes
a journal snapshot only when it satisfies every rule above and keeps every
attempt, committed step and cursor of the snapshot it replaces.

```quint
pure def wellFormed(j: Journal): bool = alwaysOneLiveAttemptPerKey(j) and alwaysNoncesIssued(j)
  and alwaysFinalizedWasBroadcast(j) and alwaysOneRootPerPeriod(j) and alwaysLeavesUnderAdmittedRoot(j)
  and alwaysSettledCommitted(j) and alwaysRetiredReverted(j) and alwaysOutcomeFinalized(j)
  and alwaysWinnerSucceeded(j) and alwaysCursorBacked(j)
pure def follows(before: Journal, after: Journal): bool = stepAttemptsRetained(before, after)
  and stepRetiredRetained(before, after) and stepSettledPermanent(before, after)
  and stepCommittedPermanent(before, after) and stepCursorMonotone(before, after) and stepFinalizedMonotone(before, after)
```
