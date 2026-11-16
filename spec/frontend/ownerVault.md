# Owner vault setup and transfers

PRD sections 6, 9 and 11: the project owner creates the project's vault with
their own wallet, Slop registers it only from a finalized matching creation,
and the owner deposits into and withdraws from the registered vault. Slop
signs nothing. Sources at Slop development `87a26cc98`:
`src/OwnerVaultSetup.tsx` (creation, registration and its automatic check),
`src/VaultActions.tsx` (deposit and withdrawal, the automatic chain check at
`:123–130,263–269`, the unclear-result recovery at `:397`) and
`src/OwnerPresentation.tsx`. It succeeds the retained `ui_owner_vault_setup`,
`ui_owner_vault_setup_storage`, `ui_vault_auto_register`,
`ui_vault_auto_check`, `ui_vault_recovery` and `ui_owner_recovery_lifetime`
models. The included-creation funding offer is the
[provisional vault](./provisionalVault.md), the one-signature deposit the
[batched deposit](./batchedDeposit.md); the [vault](../settlement/vault.md)
and [vault snapshots](../settlement/vaultSnapshots.md) own balances and
registration.

One instance is one browser context on one project's owner vault page: the
creation flow and the registered vault's transfer flow. The sender `by` is
the signed-in account (positive), the server (`0`), the wallet and chain
adapter (`-1`) or the page's timer (`-2`). Each flow's saved request is a
[wallet attempt](./walletAttempt.md) in a slot keyed by its account.

## Story: Create and register the vault without asking the wallet twice

### A flow sends only after storage saves its attempt

The owner reviews the creation against the current project revision, or a
deposit or withdrawal against the registered vault. Sending creates the
flow's slot first; an occupied slot or a storage failure asks nothing of the
wallet.

```quint
import walletAttempt as WA from "./walletAttempt"
import projections as P from "./projections"
import money as M from "../settlement/money"
type Target = Creation | Transfer
type Phase = Idle | Reviewed | Awaiting | Sent | Unclear | Done | Failed
type Origin = NoCheck | AutoCheck | OwnerCheck
type Answer = StillPending | IncludedRead | FinalRead | Refused | Reverted | ReadFailed
type Notice = Quiet | StorageBlocked | Occupied | WithdrawalRefused | Received | CheckFailed | Registered | Counted | TransferFailed
type Flow = { phase: Phase, slot: WA::Attempt, slotOwner: int, awaiting: str, sentLifetime: int, inflight: Origin,
  autoAsks: int, refusals: int, stopped: bool }
type OwnerVault = { owner: int, lifetime: int, editing: bool, creation: Flow, transfer: Flow, notice: Notice, lateReplies: int,
  used: List[str] }
pure val server = 0
pure val adapter = -1
pure val timer = -2
pure val autoAskLimit = 4
pure val refusalLimit = 3
pure val idleFlow: Flow = { phase: Idle, slot: WA::noAttempt, slotOwner: 0, awaiting: "", sentLifetime: 0, inflight: NoCheck,
  autoAsks: 0, refusals: 0, stopped: false }
pure val initial: OwnerVault = { owner: 0, lifetime: 0, editing: false, creation: idleFlow, transfer: idleFlow, notice: Quiet, lateReplies: 0,
  used: List() }
pure def flowOf(v: OwnerVault, target: Target): Flow = if (target == Creation) v.creation else v.transfer
pure def withFlow(target: Target, flow: Flow, v: OwnerVault): OwnerVault =
  if (target == Creation) { ...v, creation: flow } else { ...v, transfer: flow }
pure def resumed(flow: Flow, account: int): Flow =
  val own = flow.slot != WA::noAttempt and flow.slotOwner == account
  { ...flow, inflight: NoCheck, awaiting: "", autoAsks: 0, refusals: 0, stopped: false,
    phase: if (flow.phase == Done) Done
      else if (not(own)) Idle else if (flow.slot.hash != "" or flow.slot.candidate != "") Sent else Unclear }
pure def canSignIn(v: OwnerVault, account: int, by: int): bool = account > 0 and by == account and account != v.owner
  and v.lifetime < 9007199254740991
pure def signIn(v: OwnerVault, account: int, by: int): OwnerVault = { ...v, owner: account, lifetime: v.lifetime + 1,
  editing: false, notice: Quiet, creation: resumed(v.creation, account), transfer: resumed(v.transfer, account) }
pure def canSignOut(v: OwnerVault, by: int): bool = v.owner > 0 and by == v.owner
pure def signOut(v: OwnerVault, by: int): OwnerVault = { ...v, owner: 0, lifetime: v.lifetime + 1, editing: false,
  notice: Quiet, creation: resumed(v.creation, 0), transfer: resumed(v.transfer, 0) }
pure def canReview(v: OwnerVault, target: Target, withdrawal: M::Amount, pool: P::PoolFacts, by: int): bool =
  v.owner > 0 and by == v.owner and (flowOf(v, target).phase == Idle or flowOf(v, target).phase == Failed
    or (target == Transfer and v.transfer.phase == Done))
  and (if (target == Creation) v.creation.phase != Done else v.creation.phase == Done)
```

### A withdrawal that would break the month's promise is refused on Slop's pages

`withdrawal` is the gross amount of a withdrawal review, zero for a deposit.
While the month is Funded, the review refuses an amount that would leave the
vault below what contributors were shown
([projections](./projections.md), `withdrawalAllowedOnSlopPages`). The
contract itself does not enforce this.

```quint
pure def review(v: OwnerVault, target: Target, withdrawal: M::Amount, pool: P::PoolFacts, by: int): OwnerVault =
  if (target == Transfer and not(P::withdrawalAllowedOnSlopPages(pool, withdrawal))) { ...v, notice: WithdrawalRefused }
  else withFlow(target, { ...flowOf(v, target), phase: Reviewed, inflight: NoCheck, autoAsks: 0, refusals: 0, stopped: false },
    { ...v, notice: Quiet })
pure def canSend(v: OwnerVault, target: Target, identity: str, stored: bool, by: int): bool =
  v.owner > 0 and by == v.owner and flowOf(v, target).phase == Reviewed and identity != "" and not(v.used.includes(identity))
pure def send(v: OwnerVault, target: Target, identity: str, stored: bool, by: int): OwnerVault =
  val flow = flowOf(v, target)
  val free = WA::mayCreate(flow.slot) or flow.slotOwner != v.owner
  if (not(stored)) { ...v, notice: StorageBlocked }
  else if (not(free)) { ...v, notice: Occupied }
  else withFlow(target, { ...flow, phase: Awaiting, awaiting: identity, slotOwner: v.owner, sentLifetime: v.lifetime,
    slot: { ...WA::noAttempt, identity: identity, bytesId: if (target == Creation) "creation" else "transfer" } },
    { ...v, notice: Quiet, used: v.used.append(identity) })
```

### A wallet reply settles only its own attempt; an unclear one waits for the owner

A returned hash is saved with compare-and-set; a decline clears the exact
unsigned record. Each reply carries the page lifetime its request was sent
in, and is applied once. A reply after an account change or sign-out still lands in
its own account's slot but changes nothing on screen. An unclear result keeps
the attempt: the owner checks wallet activity, then either enters the hash
or explicitly confirms nothing was sent, which clears the slot and allows a
new send. Signing in again with the same account resumes its saved attempt;
another account never sees it.

```quint
pure def canWalletReply(v: OwnerVault, target: Target, lifetime: int, identity: str, reply: WA::Reply, hash: str, by: int): bool =
  by == adapter and identity != "" and flowOf(v, target).slot.identity == identity and reply != WA::NoReply
    and ((reply == WA::Signed) iff (hash != "")) and lifetime > 0 and lifetime == flowOf(v, target).sentLifetime
    and (lifetime < v.lifetime or flowOf(v, target).awaiting == identity)
pure def walletReply(v: OwnerVault, target: Target, lifetime: int, identity: str, reply: WA::Reply, hash: str, by: int): OwnerVault =
  val flow = flowOf(v, target)
  val expected = { ...WA::noAttempt, identity: identity, bytesId: flow.slot.bytesId }
  val slot = if (reply == WA::Signed) WA::compareAndSet(flow.slot, expected, { ...flow.slot, hash: hash })
    else if (reply == WA::Declined) WA::compareAndClear(flow.slot, expected) else flow.slot
  val kept = { ...flow, slot: slot, sentLifetime: 0 }
  val shown = flow.slotOwner == v.owner and (flow.phase == Unclear or flow.phase == Sent)
  if (lifetime < v.lifetime) withFlow(target, { ...kept, phase: if (shown) resumed(kept, v.owner).phase else flow.phase },
    { ...v, lateReplies: v.lateReplies + 1 })
  else withFlow(target, { ...flow, slot: slot, awaiting: "", sentLifetime: 0,
    phase: if (reply == WA::Signed) Sent else if (reply == WA::Declined) Reviewed else Unclear }, v)
pure def canConfirmUnsent(v: OwnerVault, target: Target, by: int): bool = v.owner > 0 and by == v.owner
  and flowOf(v, target).phase == Unclear
pure def confirmUnsent(v: OwnerVault, target: Target, by: int): OwnerVault =
  val flow = flowOf(v, target)
  withFlow(target, { ...flow, phase: Reviewed, slot: WA::compareAndClear(flow.slot, flow.slot) }, v)
pure def canEnterCandidate(v: OwnerVault, target: Target, candidate: str, by: int): bool = v.owner > 0 and by == v.owner
  and candidate != "" and (flowOf(v, target).phase == Unclear or flowOf(v, target).phase == Sent)
  and flowOf(v, target).slot.hash == "" and flowOf(v, target).inflight == NoCheck
pure def enterCandidate(v: OwnerVault, target: Target, candidate: str, by: int): OwnerVault =
  val flow = flowOf(v, target)
  withFlow(target, { ...flow, phase: Sent, slot: WA::compareAndReplace(flow.slot, flow.slot, { ...flow.slot, candidate: candidate }) }, v)
```

## Story: Check registration and transfers automatically without retiring the owner

### A timer asks only for a wallet-returned hash the owner is not editing

The page asks the server to register a saved creation, or reads the chain
for a saved transfer, without a click: only for a hash the wallet returned,
while the owner is not editing it and no check runs, at most four times. The
owner's button asks the same question for any saved hash or candidate. An
owner action retires an automatic check in flight, never the reverse; a
retired answer and an answer from an earlier lifetime are discarded. No
check opens a wallet prompt.

```quint
pure def canEdit(v: OwnerVault, editing: bool, by: int): bool = v.owner > 0 and by == v.owner and editing != v.editing
pure def edit(v: OwnerVault, editing: bool, by: int): OwnerVault =
  val retire = if (editing) NoCheck else v.creation.inflight
  { ...v, editing: editing, creation: { ...v.creation, inflight: if (v.creation.inflight == AutoCheck) retire else v.creation.inflight } }
pure def canAsk(v: OwnerVault, target: Target, origin: Origin, by: int): bool =
  val flow = flowOf(v, target)
  v.owner > 0 and flow.phase == Sent and
  (if (origin == AutoCheck) by == timer and flow.slot.hash != "" and not(v.editing) and flow.inflight == NoCheck
      and not(flow.stopped) and flow.autoAsks < autoAskLimit
    else origin == OwnerCheck and by == v.owner and flow.inflight != OwnerCheck)
pure def ask(v: OwnerVault, target: Target, origin: Origin, by: int): OwnerVault =
  val flow = flowOf(v, target)
  withFlow(target, { ...flow, inflight: origin, autoAsks: flow.autoAsks + (if (origin == AutoCheck) 1 else 0) }, v)
```

### Only a finalized matching result registers or counts, and failures keep the saved request

The server registers only a finalized matching creation and answers pending
before finality; a reverted creation fails it, and an unrelated transaction
is refused. A transfer read in a canonical block that is not final shows as
received and counts nothing; a final read counts it; a later read that no
longer sees it withdraws the notice. A refusal or failed read keeps the saved
request. A reverted result, three refusals in a row, or a refusal the owner
saw from the button stops the timer. A finalized result clears the slot.

```quint
pure def canAnswer(v: OwnerVault, target: Target, lifetime: int, origin: Origin, result: Answer, by: int): bool =
  lifetime == v.lifetime and origin != NoCheck and flowOf(v, target).inflight == origin and flowOf(v, target).phase == Sent
    and (if (target == Creation) by == server else by == adapter)
pure def answer(v: OwnerVault, target: Target, lifetime: int, origin: Origin, result: Answer, by: int): OwnerVault =
  val flow = { ...flowOf(v, target), inflight: NoCheck }
  val refused = result == Refused or result == ReadFailed
  val refusals = if (refused) flow.refusals + 1 else 0
  val stopped = flow.stopped or result == Reverted or (refused and (origin == OwnerCheck or refusals >= refusalLimit))
  if (result == FinalRead) withFlow(target, { ...flow, phase: Done, slot: WA::compareAndClear(flow.slot, flow.slot), refusals: 0 },
    { ...v, notice: if (target == Creation) Registered else Counted })
  else if (result == Reverted) withFlow(target, { ...flow, phase: Failed, slot: WA::compareAndClear(flow.slot, flow.slot),
    stopped: true, refusals: refusals }, { ...v, notice: TransferFailed })
  else withFlow(target, { ...flow, refusals: refusals, stopped: stopped },
    { ...v, notice: if (refused) CheckFailed else if (result == IncludedRead and target == Transfer) Received else Quiet })
```

### Rules

```quint
pure def flowSaved(flow: Flow): bool =
  (flow.phase == Awaiting implies flow.slot.identity == flow.awaiting and flow.awaiting != "")
  and ((flow.phase == Sent or flow.phase == Unclear) implies flow.slot != WA::noAttempt)
  and (flow.phase == Sent implies (flow.slot.hash != "" or flow.slot.candidate != ""))
  and flow.autoAsks >= 0 and flow.autoAsks <= autoAskLimit and flow.refusals >= 0
pure def alwaysLiveRequestsAreSaved(v: OwnerVault): bool = flowSaved(v.creation) and flowSaved(v.transfer)
pure def alwaysTransfersNeedRegistration(v: OwnerVault): bool = v.transfer.phase != Idle implies v.creation.phase == Done
pure def alwaysSignedOutIsIdle(v: OwnerVault): bool = v.owner == 0 implies
  (v.creation.phase == Idle or v.creation.phase == Done) and (v.transfer.phase == Idle or v.transfer.phase == Done)
    and not(v.editing)
pure def alwaysAttemptsFresh(v: OwnerVault): bool = (v.creation.slot.identity == "" or v.used.includes(v.creation.slot.identity))
  and (v.transfer.slot.identity == "" or v.used.includes(v.transfer.slot.identity))
pure def alwaysNoAutoCheckWhileEditing(v: OwnerVault): bool = v.editing implies v.creation.inflight != AutoCheck
pure def stepOwnerCheckNeverRetired(before: OwnerVault, after: OwnerVault): bool =
  not(before.creation.inflight == OwnerCheck and after.creation.inflight == AutoCheck)
  and not(before.transfer.inflight == OwnerCheck and after.transfer.inflight == AutoCheck)
pure def stepLateReplyChangesNothingShown(before: OwnerVault, after: OwnerVault): bool =
  after.lateReplies > before.lateReplies implies after.notice == before.notice and after.lifetime == before.lifetime
    and (before.creation.slotOwner != before.owner implies after.creation.phase == before.creation.phase)
    and (before.transfer.slotOwner != before.owner implies after.transfer.phase == before.transfer.phase)
pure def stepOnlyFinalResultsComplete(before: OwnerVault, via: str, after: OwnerVault): bool =
  (before.creation.phase != Done and after.creation.phase == Done) or (before.transfer.phase != Done and after.transfer.phase == Done)
    implies via == "answer"
pure def sometimesRegisteredWithoutClick(v: OwnerVault): bool = v.creation.phase == Done and v.creation.autoAsks > 0
pure def sometimesUnclearResumed(v: OwnerVault): bool = v.creation.phase == Unclear and v.lifetime > 1
pure def sometimesOtherAccountSeesNothing(v: OwnerVault): bool = v.owner > 0 and v.creation.phase == Idle
  and v.creation.slot != WA::noAttempt and v.creation.slotOwner != v.owner
pure def sometimesWithdrawalRefused(v: OwnerVault): bool = v.notice == WithdrawalRefused
pure def sometimesReceived(v: OwnerVault): bool = v.notice == Received and v.transfer.phase == Sent
pure def sometimesCounted(v: OwnerVault): bool = v.transfer.phase == Done
pure def sometimesTimerStopped(v: OwnerVault): bool = v.creation.stopped and v.creation.phase == Sent
pure def sometimesStorageBlocked(v: OwnerVault): bool = v.notice == StorageBlocked
pure def sometimesLateReply(v: OwnerVault): bool = v.lateReplies > 0
pure val accountValues = Set(1, 2)
pure val byValues = Set(1, 2, server, adapter, timer)
pure val lifetimeValues = Set(1, 2, 3)
pure val identityValues = Set("c1", "c2", "t1")
pure val hashValues = Set("", "h1")
pure val candidateValues = Set("h2")
pure val weight_send = 4
pure val weight_walletReply = 6
pure val weight_ask = 6
pure val weight_answer = 8
```
