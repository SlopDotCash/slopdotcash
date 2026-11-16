# Owner monthly pages

PRD sections 6, 8 and 11: the owner edits the month's awards before the
freeze, publishes each cut with its reason, signs the vault's monthly
commitment, turns the automatic payment on or off on chain, requests release
of a wrong-total reserve, and reads the private bounty vault's funds. Slop
signs none of these. Sources at Slop development `87a26cc98`:
`src/OwnerAwards.tsx:63–69,385–466`, `src/OwnerCommitment.tsx`,
`src/AutomaticMonthlyPayment.tsx`, `src/OwnerReserveRelease.tsx` and
`src/OwnerBountyVault.tsx:94–184`. It succeeds the retained
`ui_owner_awards`, `ui_monthly_setting_recovery`, `ui_owner_bounty_funds`
and `ui_owner_private_requests` models. The [month](../settlement/monthly.md),
[monthly commitment](../settlement/monthlyCommitment.md),
[monthly settings](../settlement/monthlySettings.md) and
[reserve release](../settlement/reserveRelease.md) machines decide; this page
only asks and shows.

One instance is one browser context on one project's owner pages. The
sender `by` is the signed-in account (positive), the server (`0`), the
wallet and chain adapter (`-1`) or the clock (`-2`). Every server reply
carries the page lifetime it answers; one from an earlier lifetime, after an
account change or sign-out, changes nothing. Time is seconds.

## Story: Edit the month's awards with public, noticed cuts

### Only a current manager edits, and the editor closes at the cutoff

The server reports whether the viewer is an owner or administrator who may
manage the month; a maintainer reads awards but never edits, saves or
finalizes. With the automatic default on, editing closes at the cutoff, and
a cut closes 24 hours before it. A frozen month accepts nothing.

```quint
import walletAttempt as WA from "./walletAttempt"
import monthly as MO from "../settlement/monthly"
type MonthView = { sequence: int, automatic: bool, cutoffAt: int, latestCutAt: int, frozen: bool }
type SaveResult = SaveAccepted | SaveConflict | WindowClosed | SaveFailed
type Notice = Quiet | AllocationSaved | CutSaved | Conflict | Closed | Failed | Finalized | StorageBlocked | Occupied
type Target = Commitment | Setting | Release
type Phase = Idle | Reviewed | Awaiting | Sent | Unclear | Done | Reverted
type ChainResult = StillPending | FinalMatch | FinalFailure | Mismatch
type Flow = { phase: Phase, slot: WA::Attempt, slotOwner: int, awaiting: str }
type Funds = FundsHidden | FundsLoading | FundsError | FundsReady
type OwnerMonthly = { owner: int, manages: bool, lifetime: int, now: int, month: MonthView, loaded: bool,
  draftOpen: bool, draftCut: bool, reasonLength: int, saving: int, expected: int, savingCut: bool, finalizing: bool,
  requests: int, notice: Notice, commitment: Flow, setting: Flow, release: Flow, releaseApproved: bool,
  funds: Funds, fundsRequest: int, used: List[str] }
pure val server = 0
pure val adapter = -1
pure val clock = -2
pure val noMonth: MonthView = { sequence: 0, automatic: true, cutoffAt: 0, latestCutAt: 0, frozen: false }
pure val idleFlow: Flow = { phase: Idle, slot: WA::noAttempt, slotOwner: 0, awaiting: "" }
pure val initial: OwnerMonthly = { owner: 0, manages: false, lifetime: 0, now: 1, month: noMonth, loaded: false,
  draftOpen: false, draftCut: false, reasonLength: 0, saving: 0, expected: 0, savingCut: false, finalizing: false,
  requests: 0, notice: Quiet, commitment: idleFlow, setting: idleFlow, release: idleFlow, releaseApproved: false,
  funds: FundsHidden, fundsRequest: 0, used: List() }
pure def editorOpen(v: OwnerMonthly): bool = v.loaded and v.manages and not(v.month.frozen)
  and not(v.month.automatic and v.now >= v.month.cutoffAt)
pure def cutsOpen(v: OwnerMonthly): bool = editorOpen(v) and not(v.month.automatic and v.now >= v.month.cutoffAt - MO::cutNoticeSeconds)
pure def reasonValid(reasonLength: int): bool = reasonLength >= MO::cutReasonMin and reasonLength <= MO::cutReasonMax
pure def resumed(flow: Flow, account: int): Flow =
  val own = flow.slot != WA::noAttempt and flow.slotOwner == account
  { ...flow, awaiting: "", phase: if (not(own)) Idle else if (flow.slot.hash != "" or flow.slot.candidate != "") Sent else Unclear }
pure def fresh(account: int, manages: bool, v: OwnerMonthly): OwnerMonthly =
  { ...initial, owner: account, manages: manages, lifetime: v.lifetime + 1, now: v.now, requests: v.requests,
    commitment: resumed(v.commitment, account), setting: resumed(v.setting, account), release: resumed(v.release, account),
    used: v.used }
pure def canSignIn(v: OwnerMonthly, account: int, manages: bool, by: int): bool = account > 0 and by == account
  and account != v.owner and v.lifetime < 9007199254740991
pure def signIn(v: OwnerMonthly, account: int, manages: bool, by: int): OwnerMonthly = fresh(account, manages, v)
pure def canSignOut(v: OwnerMonthly, by: int): bool = v.owner > 0 and by == v.owner
pure def signOut(v: OwnerMonthly, by: int): OwnerMonthly = fresh(0, false, v)
pure def canObserveClock(v: OwnerMonthly, now: int, by: int): bool = by == clock and now > v.now
pure def observeClock(v: OwnerMonthly, now: int, by: int): OwnerMonthly = { ...v, now: now }
pure def canObserveMonth(v: OwnerMonthly, lifetime: int, month: MonthView, by: int): bool = by == server and v.owner > 0
  and lifetime == v.lifetime and month.cutoffAt > 0 and month.sequence >= v.month.sequence and month.latestCutAt <= v.now
pure def observeMonth(v: OwnerMonthly, lifetime: int, month: MonthView, by: int): OwnerMonthly =
  { ...v, month: month, loaded: true, draftOpen: v.draftOpen and not(month.frozen) }
```

### A cut needs a 20 to 500 character public reason, and a save names the sequence it read

A change below the proposed amount is a cut: its reason field is required,
from 20 to 500 characters after trimming, and is public. An increase or
unchanged amount sends no reason. The save names the allocation sequence the
editor read; the server refuses it when another save came first, or when the
cutoff or the cut window closed meanwhile, and the draft stays for the owner
to review. A saved cut says "Cut saved. The reason is public and the
contributor was notified."; any other save says "Allocation saved.". The
owner may finalize only 24 hours after the latest cut, and then the month's
awards are final.

```quint
pure def canEditDraft(v: OwnerMonthly, cut: bool, reasonLength: int, by: int): bool = by == v.owner and editorOpen(v)
  and v.saving == 0 and reasonLength >= 0 and (cut or reasonLength == 0)
pure def editDraft(v: OwnerMonthly, cut: bool, reasonLength: int, by: int): OwnerMonthly =
  { ...v, draftOpen: true, draftCut: cut, reasonLength: reasonLength, notice: Quiet }
pure def canSave(v: OwnerMonthly, by: int): bool = by == v.owner and editorOpen(v) and v.draftOpen and v.saving == 0
  and not(v.finalizing) and (v.draftCut implies (reasonValid(v.reasonLength) and cutsOpen(v))) and v.requests < 9007199254740991
pure def save(v: OwnerMonthly, by: int): OwnerMonthly =
  { ...v, requests: v.requests + 1, saving: v.requests + 1, expected: v.month.sequence, savingCut: v.draftCut }
pure def canSaveReply(v: OwnerMonthly, lifetime: int, request: int, result: SaveResult, by: int): bool =
  by == server and lifetime == v.lifetime and request > 0 and request == v.saving
    and (result == SaveAccepted implies (v.expected == v.month.sequence and (if (v.savingCut) cutsOpen(v) else editorOpen(v))))
    and (result == WindowClosed implies not(if (v.savingCut) cutsOpen(v) else editorOpen(v)))
pure def saveReply(v: OwnerMonthly, lifetime: int, request: int, result: SaveResult, by: int): OwnerMonthly =
  if (result == SaveAccepted) { ...v, saving: 0, draftOpen: false, draftCut: false, reasonLength: 0,
    month: { ...v.month, sequence: v.month.sequence + 1, latestCutAt: if (v.savingCut) v.now else v.month.latestCutAt },
    notice: if (v.savingCut) CutSaved else AllocationSaved }
  else { ...v, saving: 0, notice: if (result == SaveConflict) Conflict else if (result == WindowClosed) Closed else Failed }
pure def canFinalize(v: OwnerMonthly, by: int): bool = by == v.owner and v.loaded and v.manages and not(v.month.frozen)
  and v.saving == 0 and not(v.finalizing) and (v.month.latestCutAt == 0 or v.now >= v.month.latestCutAt + MO::cutNoticeSeconds)
pure def finalize(v: OwnerMonthly, by: int): OwnerMonthly = { ...v, finalizing: true }
pure def canFinalizeReply(v: OwnerMonthly, lifetime: int, accepted: bool, by: int): bool =
  by == server and lifetime == v.lifetime and v.finalizing
    and (accepted implies (v.month.latestCutAt == 0 or v.now >= v.month.latestCutAt + MO::cutNoticeSeconds))
pure def finalizeReply(v: OwnerMonthly, lifetime: int, accepted: bool, by: int): OwnerMonthly =
  if (accepted) { ...v, finalizing: false, draftOpen: false, month: { ...v.month, frozen: true }, notice: Finalized }
  else { ...v, finalizing: false, notice: Failed }
```

## Story: Sign the owner's monthly transactions from a saved attempt

### Commitment, automatic-payment setting and reserve release each keep one recoverable attempt

The owner signs the monthly commitment, the on-chain automatic-payment
setting and, after the attester approved it from fresh finalized evidence,
the reserve release; Slop signs none of them. Each send first creates its
[wallet attempt](./walletAttempt.md); an occupied slot or failed storage
asks nothing of the wallet. A returned hash is kept, a decline clears only
its own attempt, and an unclear result keeps it until the owner enters the
hash or explicitly confirms nothing was sent. A wallet reply after an account
change or sign-out is not applied: its attempt stays unclear and recoverable
for the same account, and another account never sees it. A check settles the attempt
only on a finalized match or finalized failure; a finalized failure does not
claim the setting changed, and a mismatch or pending read keeps it.

```quint
pure def flowOf(v: OwnerMonthly, target: Target): Flow =
  if (target == Commitment) v.commitment else if (target == Setting) v.setting else v.release
pure def withFlow(target: Target, flow: Flow, v: OwnerMonthly): OwnerMonthly =
  if (target == Commitment) { ...v, commitment: flow } else if (target == Setting) { ...v, setting: flow } else { ...v, release: flow }
pure def canObserveApproval(v: OwnerMonthly, lifetime: int, approved: bool, by: int): bool =
  by == server and lifetime == v.lifetime and v.owner > 0
pure def observeApproval(v: OwnerMonthly, lifetime: int, approved: bool, by: int): OwnerMonthly = { ...v, releaseApproved: approved }
pure def canReview(v: OwnerMonthly, target: Target, by: int): bool = by == v.owner and v.owner > 0 and v.manages
  and (flowOf(v, target).phase == Idle or flowOf(v, target).phase == Done or flowOf(v, target).phase == Reverted)
  and (target == Release implies v.releaseApproved)
pure def review(v: OwnerMonthly, target: Target, by: int): OwnerMonthly = withFlow(target, { ...flowOf(v, target), phase: Reviewed }, v)
pure def canSend(v: OwnerMonthly, target: Target, identity: str, stored: bool, by: int): bool = by == v.owner and v.owner > 0
  and flowOf(v, target).phase == Reviewed and identity != "" and not(v.used.includes(identity))
pure def send(v: OwnerMonthly, target: Target, identity: str, stored: bool, by: int): OwnerMonthly =
  val flow = flowOf(v, target)
  if (not(stored)) { ...v, notice: StorageBlocked }
  else if (not(WA::mayCreate(flow.slot))) { ...v, notice: Occupied }
  else withFlow(target, { phase: Awaiting, awaiting: identity, slotOwner: v.owner,
      slot: { ...WA::noAttempt, identity: identity, bytesId: "prepared" } },
    { ...v, used: v.used.append(identity), notice: Quiet })
pure def canWalletReply(v: OwnerMonthly, target: Target, identity: str, reply: WA::Reply, hash: str, by: int): bool =
  by == adapter and identity != "" and flowOf(v, target).awaiting == identity and reply != WA::NoReply
    and ((reply == WA::Signed) iff (hash != ""))
pure def walletReply(v: OwnerMonthly, target: Target, identity: str, reply: WA::Reply, hash: str, by: int): OwnerMonthly =
  val flow = flowOf(v, target)
  val expected = { ...WA::noAttempt, identity: identity, bytesId: "prepared" }
  withFlow(target, { ...flow, awaiting: "",
    slot: if (reply == WA::Signed) WA::compareAndSet(flow.slot, expected, { ...flow.slot, hash: hash })
      else if (reply == WA::Declined) WA::compareAndClear(flow.slot, expected) else flow.slot,
    phase: if (reply == WA::Signed) Sent else if (reply == WA::Declined) Reviewed else Unclear }, v)
pure def canConfirmUnsent(v: OwnerMonthly, target: Target, by: int): bool = by == v.owner and v.owner > 0
  and flowOf(v, target).phase == Unclear
pure def confirmUnsent(v: OwnerMonthly, target: Target, by: int): OwnerMonthly =
  withFlow(target, { ...flowOf(v, target), phase: Reviewed, slot: WA::compareAndClear(flowOf(v, target).slot, flowOf(v, target).slot) }, v)
pure def canEnterCandidate(v: OwnerMonthly, target: Target, candidate: str, by: int): bool = by == v.owner and v.owner > 0
  and candidate != "" and flowOf(v, target).phase == Unclear
pure def enterCandidate(v: OwnerMonthly, target: Target, candidate: str, by: int): OwnerMonthly =
  val flow = flowOf(v, target)
  withFlow(target, { ...flow, phase: Sent, slot: WA::compareAndReplace(flow.slot, flow.slot, { ...flow.slot, candidate: candidate }) }, v)
pure def canCheck(v: OwnerMonthly, target: Target, result: ChainResult, by: int): bool = by == adapter and flowOf(v, target).phase == Sent
pure def check(v: OwnerMonthly, target: Target, result: ChainResult, by: int): OwnerMonthly =
  val flow = flowOf(v, target)
  if (result == FinalMatch) withFlow(target, { ...flow, phase: Done, slot: WA::compareAndClear(flow.slot, flow.slot) }, v)
  else if (result == FinalFailure) withFlow(target, { ...flow, phase: Reverted, slot: WA::compareAndClear(flow.slot, flow.slot) }, v)
  else v
```

## Story: Read the private bounty vault's funds under current authority

### The funds view is loading, error or ready for the current owner only

The private bounty vault panel reads its funds only while the server
confirms the viewer still manages the project. Loading, error and ready are
distinct; a failed read never shows zero. A recheck that finds the authority
gone hides the panel and discards the read in flight, as does an account
change or sign-out. A balance confers no signing authority.

```quint
pure def canOpenFunds(v: OwnerMonthly, by: int): bool = by == v.owner and v.owner > 0 and v.manages and v.funds != FundsLoading
  and v.requests < 9007199254740991
pure def openFunds(v: OwnerMonthly, by: int): OwnerMonthly = { ...v, funds: FundsLoading, requests: v.requests + 1, fundsRequest: v.requests + 1 }
pure def canFundsReply(v: OwnerMonthly, lifetime: int, request: int, ok: bool, by: int): bool =
  by == server and lifetime == v.lifetime and v.funds == FundsLoading and request == v.fundsRequest
pure def fundsReply(v: OwnerMonthly, lifetime: int, request: int, ok: bool, by: int): OwnerMonthly =
  { ...v, funds: if (ok) FundsReady else FundsError }
pure def canRecheckAuthority(v: OwnerMonthly, lifetime: int, manages: bool, by: int): bool =
  by == server and lifetime == v.lifetime and v.owner > 0
pure def recheckAuthority(v: OwnerMonthly, lifetime: int, manages: bool, by: int): OwnerMonthly =
  if (manages) { ...v, manages: true } else { ...v, manages: false, funds: FundsHidden, fundsRequest: 0, draftOpen: false }
```

### Rules

```quint
pure def flowSaved(flow: Flow): bool =
  (flow.phase == Awaiting implies flow.slot.identity == flow.awaiting and flow.awaiting != "")
  and ((flow.phase == Sent or flow.phase == Unclear) implies flow.slot != WA::noAttempt)
  and (flow.slot != WA::noAttempt implies flow.slotOwner > 0)
  and ((flow.awaiting != "") iff (flow.phase == Awaiting))
pure def alwaysAttemptsSaved(v: OwnerMonthly): bool = flowSaved(v.commitment) and flowSaved(v.setting) and flowSaved(v.release)
pure def ownFlow(flow: Flow, account: int): bool =
  (flow.phase == Awaiting or flow.phase == Sent or flow.phase == Unclear) implies flow.slotOwner == account
pure def alwaysAttemptsOwnAccountOnly(v: OwnerMonthly): bool =
  ownFlow(v.commitment, v.owner) and ownFlow(v.setting, v.owner) and ownFlow(v.release, v.owner)
pure def alwaysOnlyManagersEdit(v: OwnerMonthly): bool = (v.draftOpen or v.funds != FundsHidden) implies v.manages and v.owner > 0
pure def alwaysOneRequestAtATime(v: OwnerMonthly): bool = v.saving >= 0 and v.saving <= v.requests
  and not(v.saving > 0 and v.finalizing)
pure def alwaysSignedOutShowsNothing(v: OwnerMonthly): bool = v.owner == 0 implies
  not(v.loaded) and v.saving == 0 and not(v.finalizing) and v.funds == FundsHidden
pure def stepCutHasReasonAndNotice(before: OwnerMonthly, after: OwnerMonthly): bool =
  (after.notice == CutSaved and before.notice != CutSaved) implies
    reasonValid(before.reasonLength) and before.savingCut and after.month.latestCutAt == before.now
pure def stepFrozenOnlyAfterNotice(before: OwnerMonthly, via: str, after: OwnerMonthly): bool =
  (via == "finalizeReply" and not(before.month.frozen) and after.month.frozen)
    implies (before.month.latestCutAt == 0 or before.now >= before.month.latestCutAt + MO::cutNoticeSeconds)
pure def stepReleaseNeedsApproval(before: OwnerMonthly, after: OwnerMonthly): bool =
  (before.release.phase != Reviewed and after.release.phase == Reviewed and after.release.slot == before.release.slot)
    implies before.releaseApproved
pure def sometimesCutSaved(v: OwnerMonthly): bool = v.notice == CutSaved
pure def sometimesConflict(v: OwnerMonthly): bool = v.notice == Conflict and v.draftOpen
pure def sometimesCutWindowClosedEditorOpen(v: OwnerMonthly): bool = editorOpen(v) and not(cutsOpen(v))
pure def sometimesFinalizedAfterCut(v: OwnerMonthly): bool = v.notice == Finalized and v.month.latestCutAt > 0
pure def sometimesSettingUnclear(v: OwnerMonthly): bool = v.setting.phase == Unclear
pure def sometimesReleaseSigned(v: OwnerMonthly): bool = v.release.phase == Done
pure def sometimesFundsHiddenAfterRecheck(v: OwnerMonthly): bool = v.owner > 0 and v.funds == FundsHidden and not(v.manages) and v.fundsRequest == 0
  and v.requests > 0
pure def sometimesFundsError(v: OwnerMonthly): bool = v.funds == FundsError
pure def sometimesCommitmentRecoveredAfterSignOut(v: OwnerMonthly): bool = v.owner > 0 and v.lifetime > 1 and v.commitment.phase == Sent
pure val accountValues = Set(1, 2)
pure val byValues = Set(1, 2, server, adapter, clock)
pure val lifetimeValues = Set(1, 2)
pure val requestValues = Set(1, 2)
pure val nowValues = Set(100000, 180000, 200000)
pure val monthValues = Set({ sequence: 0, automatic: true, cutoffAt: 190000, latestCutAt: 0, frozen: false },
  { sequence: 1, automatic: true, cutoffAt: 190000, latestCutAt: 0, frozen: false },
  { sequence: 0, automatic: false, cutoffAt: 190000, latestCutAt: 0, frozen: false })
pure val reasonLengthValues = Set(0, 40, 600)
pure val identityValues = Set("p1", "p2", "p3")
pure val hashValues = Set("", "h1")
pure val candidateValues = Set("h2")
pure val weight_observeMonth = 8
pure val weight_observeClock = 6
pure val weight_editDraft = 10
pure val weight_save = 12
pure val weight_saveReply = 16
pure val weight_finalize = 10
pure val weight_finalizeReply = 16
pure val weight_review = 3
pure val weight_send = 4
pure val weight_walletReply = 6
pure val weight_check = 4
```
