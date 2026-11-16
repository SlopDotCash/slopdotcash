# Wallet attempt storage

PRD sections 3, 6, 8 and 10 keep an uncertain wallet send distinguishable
from a retry and from a finalized payment. Every wallet form of Slop
development `87a26cc98` saves its request in one browser storage slot before
it asks the wallet: `src/lib/pending-attempt.ts:1–75`, used by
`OwnerVaultSetup.tsx`, `OwnerCommitment.tsx`, `AutomaticMonthlyPayment.tsx`,
`OwnerReserveRelease.tsx`, `VaultActions.tsx`, `DirectBountyPayment.tsx`,
`SolanaBountyPayment.tsx` and `ReferralClaims.tsx`. It succeeds the retained
`ui_vault_prompt_ownership`, `ui_owner_vault_setup_storage`, `ui_transaction`
and `ui_tab_scope` models.

The storage key names the form, the exact project, case or vault, the
prepared request and the signed-in account, so one account never reads
another's slot. One instance is the slots of one form's key across the
accounts that sign in to one browser context; `store` holds each account's
slot. Storage is synchronous: each operation rereads and writes the slot with
no await between, so it is atomic with respect to the other views of the same
context. A slot's evidence is only a verification candidate; the owning
settlement journal checks finality.

## Story: Ask the wallet once per saved attempt and keep an uncertain one

### A wallet prompt starts only after storage creates an empty slot

`createPendingAttempt` refuses an occupied slot, even when the view saw it
empty earlier, so a second view or a retry never overwrites a saved request.
Storage that cannot be written blocks the prompt: the form says the request
could not be saved and asks nothing of the wallet. Attempt identities are
fresh for the journal.

```quint
type Attempt = { identity: str, bytesId: str, hash: str, candidate: str }
type Keyed = { account: int, attempt: Attempt }
type Reply = NoReply | Signed | Declined | Uncertain
type Notice = Quiet | Waiting | StorageBlocked | Occupied | Saved | KeepHash | Recover
type Prompt = { account: int, identity: str, bytesId: str }
type Journal = { account: int, storageReady: bool, store: List[Keyed], waiting: List[Prompt], used: List[str],
  notice: Notice, replied: str, reply: Reply }
pure val noAttempt: Attempt = { identity: "", bytesId: "", hash: "", candidate: "" }
pure val initial: Journal = { account: 0, storageReady: true, store: List(), waiting: List(), used: List(),
  notice: Quiet, replied: "", reply: NoReply }
pure def slotOf(j: Journal, account: int): Attempt =
  j.store.foldl(noAttempt, (found, k) => if (k.account == account) k.attempt else found)
pure def writeSlot(account: int, attempt: Attempt, j: Journal): Journal =
  { ...j, store: j.store.select(k => k.account != account).append({ account: account, attempt: attempt }) }
pure def mayCreate(slot: Attempt): bool = slot == noAttempt
pure def createIfEmpty(slot: Attempt, value: Attempt): Attempt = if (mayCreate(slot)) value else slot
pure def canSignIn(j: Journal, account: int): bool = account > 0 and account != j.account
pure def signIn(j: Journal, account: int): Journal =
  { ...j, account: account, notice: if (slotOf(j, account) == noAttempt) Quiet else Recover }
pure def canSignOut(j: Journal): bool = j.account > 0
pure def signOut(j: Journal): Journal = { ...j, account: 0, notice: Quiet }
pure def canSetStorage(j: Journal, ready: bool): bool = ready != j.storageReady
pure def setStorage(j: Journal, ready: bool): Journal = { ...j, storageReady: ready }
pure def canBegin(j: Journal, identity: str, bytesId: str): bool = j.account > 0 and identity != "" and bytesId != ""
  and not(j.used.includes(identity))
pure def begin(j: Journal, identity: str, bytesId: str): Journal =
  if (not(j.storageReady)) { ...j, notice: StorageBlocked }
  else if (not(mayCreate(slotOf(j, j.account)))) { ...j, notice: Occupied }
  else { ...writeSlot(j.account, { ...noAttempt, identity: identity, bytesId: bytesId }, j),
    waiting: j.waiting.append({ account: j.account, identity: identity, bytesId: bytesId }),
    used: j.used.append(identity), notice: Waiting }
```

### A late wallet reply changes only the slot that still holds its own attempt

The reply carries the identity captured before the wallet call. A signed
result writes its hash with compare-and-set on that identity; a definitive
decline removes the slot with compare-and-clear on the exact unsigned record,
with no await between the read and the removal. A reply after the view
closed, the account changed or the user signed out still lands only in its
own account's slot, and only while that slot holds its attempt, so it can
never clear or overwrite a retry. An uncertain reply keeps the slot: the
attempt stays recoverable, and the form never asks again for it. When storage
fails on a signed reply, the form shows the hash to keep.

```quint
pure def sameAttempt(slot: Attempt, expected: Attempt): bool =
  slot != noAttempt and slot.identity == expected.identity and slot.bytesId == expected.bytesId
pure def compareAndSet(slot: Attempt, expected: Attempt, value: Attempt): Attempt =
  if (sameAttempt(slot, expected)) value else slot
pure def compareAndReplace(slot: Attempt, expected: Attempt, value: Attempt): Attempt =
  if (slot != noAttempt and slot == expected) value else slot
pure def compareAndClear(slot: Attempt, expected: Attempt): Attempt =
  if (slot != noAttempt and slot == expected) noAttempt else slot
pure def promptFor(j: Journal, identity: str): Prompt =
  j.waiting.foldl({ account: 0, identity: "", bytesId: "" }, (found, w) => if (w.identity == identity) w else found)
pure def canResolve(j: Journal, identity: str, reply: Reply, hash: str): bool =
  identity != "" and j.waiting.some(w => w.identity == identity) and reply != NoReply and ((reply == Signed) iff (hash != ""))
pure def resolve(j: Journal, identity: str, reply: Reply, hash: str): Journal =
  val w = promptFor(j, identity)
  val slot = slotOf(j, w.account)
  val expected = { ...noAttempt, identity: identity, bytesId: w.bytesId }
  val updated = if (not(j.storageReady)) slot
    else if (reply == Signed) compareAndSet(slot, expected, { ...slot, hash: hash })
    else if (reply == Declined) compareAndClear(slot, expected) else slot
  val written = if (updated == slot) j else writeSlot(w.account, updated, j)
  { ...written, waiting: j.waiting.select(p => p.identity != identity), replied: identity, reply: reply,
    notice: if (w.account != j.account) j.notice
      else if (reply == Signed) (if (updated == slot) KeepHash else Saved)
      else if (reply == Uncertain) Recover else Quiet }
```

### Recovery and settlement use the saved record of the signed-in account only

A candidate hash the user enters replaces the record only if it is still the
record the form read (`updatePendingRecord`). Settlement clears the slot only
after the owning journal reports finalized evidence for exactly that record.
Another account sees an empty slot and starts its own attempt.

```quint
pure def canEnterCandidate(j: Journal, read: Attempt, candidate: str): bool = j.account > 0 and j.storageReady
  and candidate != "" and read != noAttempt and read.candidate != candidate
pure def enterCandidate(j: Journal, read: Attempt, candidate: str): Journal =
  val slot = slotOf(j, j.account)
  val updated = compareAndReplace(slot, read, { ...read, candidate: candidate })
  if (updated == slot) { ...j, notice: Occupied } else { ...writeSlot(j.account, updated, j), notice: Recover }
pure def canClearSettled(j: Journal, read: Attempt): bool = j.account > 0 and j.storageReady and read != noAttempt
  and (read.hash != "" or read.candidate != "")
pure def clearSettled(j: Journal, read: Attempt): Journal =
  val slot = slotOf(j, j.account)
  val updated = compareAndClear(slot, read)
  if (updated == slot) { ...j, notice: Occupied } else { ...writeSlot(j.account, updated, j), notice: Quiet }
pure def recoveryFor(j: Journal): Attempt = if (j.account > 0) slotOf(j, j.account) else noAttempt
```

### Rules

```quint
pure def stepCreateNeverOverwrites(before: Journal, via: str, after: Journal): bool = via == "begin" implies
  before.store.every(k => k.attempt == noAttempt or slotOf(after, k.account) == k.attempt)
pure def stepPromptNeedsSavedSlot(before: Journal, via: str, after: Journal): bool =
  after.waiting.length() > before.waiting.length() implies
    via == "begin" and before.storageReady and slotOf(before, before.account) == noAttempt
pure def stepReplyTouchesOnlyItsAttempt(before: Journal, via: str, after: Journal): bool = via == "resolve" implies
  before.store.every(k => slotOf(after, k.account) == k.attempt or k.attempt.identity == after.replied)
pure def stepUncertainKeepsAttempt(before: Journal, via: str, after: Journal): bool =
  (via == "resolve" and after.reply == Uncertain) implies after.store == before.store
pure def stepOtherAccountsUntouched(before: Journal, via: str, after: Journal): bool =
  (via == "begin" or via == "enterCandidate" or via == "clearSettled") implies
    before.store.every(k => k.account == before.account or slotOf(after, k.account) == k.attempt)
pure def alwaysWaitingWasSaved(j: Journal): bool = j.waiting.every(w => w.account > 0 and j.used.includes(w.identity))
pure def alwaysOneAttemptPerSlot(j: Journal): bool =
  j.store.every(k => j.store.select(o => o.account == k.account).length() == 1)
pure def alwaysSignedOutShowsNothing(j: Journal): bool = j.account == 0 implies recoveryFor(j) == noAttempt
pure def sometimesStorageBlocked(j: Journal): bool = j.notice == StorageBlocked and j.waiting.length() == 0
pure def sometimesOccupied(j: Journal): bool = j.notice == Occupied and slotOf(j, j.account).hash == ""
pure def sometimesLateReplyKeepsRetry(j: Journal): bool = j.reply == Declined and j.replied != ""
  and j.store.some(k => k.attempt.identity != "" and k.attempt.identity != j.replied and k.attempt.bytesId == "plan")
pure def sometimesUncertainRecoverable(j: Journal): bool = j.reply == Uncertain and recoveryFor(j) != noAttempt
pure def sometimesOtherAccountClean(j: Journal): bool = j.account > 0 and recoveryFor(j) == noAttempt
  and j.store.some(k => k.account != j.account and k.attempt != noAttempt)
pure def sometimesKeepHash(j: Journal): bool = j.notice == KeepHash
pure def sometimesSettled(j: Journal): bool = j.used.length() > 0 and j.store.length() > 0 and j.store.every(k => k.attempt == noAttempt)
pure val accountValues = Set(1, 2)
pure val identityValues = Set("a1", "a2", "a3")
pure val bytesIdValues = Set("plan")
pure val hashValues = Set("", "h1")
pure val candidateValues = Set("h1", "h2")
pure val readValues = Set(noAttempt, { ...noAttempt, identity: "a1", bytesId: "plan", hash: "h1" },
  { ...noAttempt, identity: "a1", bytesId: "plan" }, { ...noAttempt, identity: "a1", bytesId: "plan", candidate: "h1" },
  { ...noAttempt, identity: "a2", bytesId: "plan", candidate: "h2" })
pure val weight_begin = 6
pure val weight_resolve = 6
```
