# Solana bounty payment prompt

PRD sections 3, 8 and 10: the case owner pays an approved private bounty
from their own Solana wallet, and Slop records it only from finalized
evidence. Sources at Slop development `87a26cc98`:
`src/SolanaBountyPayment.tsx` (`DirectSolanaPlan` with its `messageId`, the
pending attempt keyed by case, generation, message and account),
`src/SolanaBountyRecovery.tsx` (signs only messages the API established are
expired, never a transaction) and `src/BountySubmittedPayments.tsx`
(submitted candidates per account lifetime). It succeeds the retained
`ui_bounty_payment_parent`, `ui_solana_payment_pending`,
`ui_solana_history_recovery`, `ui_submitted_payment_lifetime`,
`ui_submitted_payment_recovery` and `ui_submitted_candidate_ownership`
models. The EVM form is the [direct bounty prompt](./directBountyPrompt.md);
the [direct bounty journal](../settlement/directBounty.md) verifies receipts.

One instance is one browser context on one case generation's payment form.
Each prepared plan's message has its own [wallet attempt](./walletAttempt.md)
slot, keyed by the message and the account that created it; the server
prepares each message for one payer, so a slot another account holds only
refuses a send. The sender `by` is the
signed-in account (positive), the server (`0`), the wallet adapter (`-1`) or
the chain height reader (`-3`).

## Story: Send each prepared message at most once and recover it after expiry

### The wallet sends only a saved, unexpired plan

The server prepares a transaction whose blockhash is valid up to a block
height. The form sends only while the chain is at or below that height, and
only after storage creates the message's empty slot; an occupied slot, a
storage failure or an expired blockhash asks nothing of the wallet. A
returned signature is saved with compare-and-set, a decline clears only its
own attempt, and an uncertain result keeps it: the form asks the owner to
check wallet activity and enter the signature, and never sends that message
again. A returned signature that browser storage cannot save is held in page
memory (`memory`) with "Submitted <signature>. Keep this signature; browser
storage could not save it." and can still be verified; a reload finds the
unsigned record and is uncertain. The owner may enter a signature beside a
saved one, in an uncertain, submitted or expired form: it is stored as the
record's candidate, and verification submits the candidate when there is
one, else the saved signature (development `src/SolanaBountyPayment.tsx`
`send` and `check` at `67fd54fd4`).

```quint
import walletAttempt as WA from "./walletAttempt"
type Phase = NoPlan | Planned | Awaiting | Submitted | Uncertain | Expired | Checking | HistoryCheck | Verified
type Notice = Quiet | StorageBlocked | Occupied | AccountChanged | NotFound | CheckFailed | KeepSignature | HistoryIncomplete
type Keyed = { owner: int, attempt: WA::Attempt }
type Result = FinalizedMatch | StillPending | ExpiredUnlanded | CheckUnavailable
type SolanaPrompt = { actor: int, lifetime: int, message: int, lastValid: int, height: int, phase: Phase, awaiting: str,
  slots: int -> Keyed, messages: List[int], used: List[str], request: int, notice: Notice, memory: str }
pure val server = 0
pure val adapter = -1
pure val heightReader = -3
pure val preparedBytes = "prepared-transaction"
pure val initial: SolanaPrompt = { actor: 0, lifetime: 0, message: 0, lastValid: 0, height: 1, phase: NoPlan, awaiting: "",
  slots: Map(), messages: List(), used: List(), request: 0, notice: Quiet, memory: "" }
pure val noKeyed: Keyed = { owner: 0, attempt: WA::noAttempt }
pure def keyedAt(message: int, p: SolanaPrompt): Keyed = if (p.slots.keys().contains(message)) p.slots.get(message) else noKeyed
pure def slotFor(message: int, owner: int, p: SolanaPrompt): WA::Attempt =
  if (keyedAt(message, p).owner == owner) keyedAt(message, p).attempt else WA::noAttempt
pure def visible(p: SolanaPrompt): WA::Attempt = slotFor(p.message, p.actor, p)
pure def writeVisible(attempt: WA::Attempt, p: SolanaPrompt): SolanaPrompt =
  { ...p, slots: p.slots.put(p.message, { owner: p.actor, attempt: attempt }),
    messages: if (p.messages.includes(p.message)) p.messages else p.messages.append(p.message) }
pure def phaseFor(attempt: WA::Attempt, p: SolanaPrompt): Phase =
  if (p.message == 0) NoPlan
  else if (p.height > p.lastValid) Expired
  else if (attempt == WA::noAttempt) Planned
  else if (attempt.hash != "" or attempt.candidate != "") Submitted
  else Uncertain
pure def canSignIn(p: SolanaPrompt, account: int, by: int): bool = account > 0 and by == account and account != p.actor
  and p.lifetime < 9007199254740991
pure def signIn(p: SolanaPrompt, account: int, by: int): SolanaPrompt =
  val advanced = { ...p, actor: account, lifetime: p.lifetime + 1, awaiting: "", memory: "" }
  { ...advanced, phase: phaseFor(slotFor(p.message, account, p), advanced), notice: Quiet }
pure def canSignOut(p: SolanaPrompt, by: int): bool = p.actor > 0 and by == p.actor
pure def signOut(p: SolanaPrompt, by: int): SolanaPrompt =
  { ...p, actor: 0, lifetime: p.lifetime + 1, phase: if (p.message == 0) NoPlan else Planned, awaiting: "", notice: Quiet,
    memory: "" }
pure def canReceivePlan(p: SolanaPrompt, lifetime: int, message: int, lastValid: int, by: int): bool = by == server
  and lifetime == p.lifetime and p.actor > 0 and message > 0 and message != p.message and lastValid >= p.height
  and (p.phase == NoPlan or p.phase == Expired)
pure def receivePlan(p: SolanaPrompt, lifetime: int, message: int, lastValid: int, by: int): SolanaPrompt =
  val advanced = { ...p, message: message, lastValid: lastValid, memory: "" }
  { ...advanced, phase: phaseFor(slotFor(message, p.actor, p), advanced), notice: Quiet }
pure def canObserveHeight(p: SolanaPrompt, height: int, by: int): bool = by == heightReader and height > p.height
pure def observeHeight(p: SolanaPrompt, height: int, by: int): SolanaPrompt =
  val advanced = { ...p, height: height }
  if (p.actor > 0 and (p.phase == Planned or p.phase == Submitted or p.phase == Uncertain) and height > p.lastValid)
    { ...advanced, phase: Expired } else advanced
pure def canSend(p: SolanaPrompt, identity: str, stored: bool, by: int): bool = by == p.actor and p.actor > 0
  and p.phase == Planned and p.height <= p.lastValid and identity != "" and not(p.used.includes(identity))
pure def send(p: SolanaPrompt, identity: str, stored: bool, by: int): SolanaPrompt =
  if (not(stored)) { ...p, notice: StorageBlocked }
  else if (not(WA::mayCreate(keyedAt(p.message, p).attempt))) { ...p, notice: Occupied }
  else { ...writeVisible({ ...WA::noAttempt, identity: identity, bytesId: preparedBytes }, p),
    phase: Awaiting, awaiting: identity, used: p.used.append(identity), notice: Quiet }
pure def canWalletReply(p: SolanaPrompt, identity: str, reply: WA::Reply, signature: str, stored: bool, by: int): bool =
  by == adapter and identity != "" and p.awaiting == identity and p.phase == Awaiting and reply != WA::NoReply
    and ((reply == WA::Signed) iff (signature != ""))
pure def walletReply(p: SolanaPrompt, identity: str, reply: WA::Reply, signature: str, stored: bool, by: int): SolanaPrompt =
  val slot = visible(p)
  val expected = { ...WA::noAttempt, identity: identity, bytesId: preparedBytes }
  val unsaved = reply == WA::Signed and not(stored)
  val updated = if (unsaved) slot else if (reply == WA::Signed) WA::compareAndSet(slot, expected, { ...slot, hash: signature })
    else if (reply == WA::Declined) WA::compareAndClear(slot, expected) else slot
  { ...writeVisible(updated, p), awaiting: "", memory: if (unsaved) signature else p.memory,
    notice: if (unsaved) KeepSignature else p.notice,
    phase: if (reply == WA::Signed) Submitted else if (reply == WA::Declined) Planned else Uncertain }
pure def canEnterCandidate(p: SolanaPrompt, read: WA::Attempt, candidate: str, by: int): bool = by == p.actor and p.actor > 0
  and (p.phase == Uncertain or p.phase == Submitted or p.phase == Expired) and candidate != "" and read == visible(p)
  and read != WA::noAttempt
pure def enterCandidate(p: SolanaPrompt, read: WA::Attempt, candidate: str, by: int): SolanaPrompt =
  val updated = WA::compareAndReplace(visible(p), read, { ...read, candidate: candidate })
  { ...writeVisible(updated, p), phase: if (p.phase == Expired) Expired else Submitted }
```

### Verification and history recovery rechecks the account and never sends

Verification submits the saved signature or candidate; only a finalized
match settles the attempt. When the server establishes that the blockhash
expired without the transaction landing, the form offers a history check:
the owner signs the expired request messages, not a transaction, and only
if the session still belongs to the account that opened the form; otherwise
it asks for a reload. A found payment settles the attempt; none found clears
it so a fresh plan can be prepared; a scan the server has not finished keeps
the attempt and leaves the form expired with the history check offered again
(the case's recovery stays `history-check`; development
`src/SolanaBountyRecovery.tsx` and `src/SecurityBounty.tsx` at
`67fd54fd4`), each check signing only messages it has no saved signature for
and sending nothing. Replies from an earlier request or lifetime change
nothing.

```quint
pure def canVerify(p: SolanaPrompt, by: int): bool = by == p.actor and p.actor > 0 and p.phase == Submitted
  and p.request < 9007199254740991
pure def verify(p: SolanaPrompt, by: int): SolanaPrompt = { ...p, phase: Checking, request: p.request + 1 }
pure def canVerifyReply(p: SolanaPrompt, lifetime: int, request: int, result: Result, by: int): bool = by == server
  and lifetime == p.lifetime and request == p.request and p.phase == Checking
  and (result == ExpiredUnlanded implies p.height > p.lastValid)
pure def verifyReply(p: SolanaPrompt, lifetime: int, request: int, result: Result, by: int): SolanaPrompt =
  if (result == FinalizedMatch) { ...writeVisible(WA::compareAndClear(visible(p), visible(p)), p), phase: Verified }
  else if (result == ExpiredUnlanded) { ...p, phase: Expired }
  else if (result == StillPending) { ...p, phase: Submitted }
  else { ...p, phase: Submitted, notice: CheckFailed }
pure def canCheckHistory(p: SolanaPrompt, sessionActor: int, by: int): bool = by == p.actor and p.actor > 0
  and p.phase == Expired and visible(p) != WA::noAttempt and p.request < 9007199254740991
pure def checkHistory(p: SolanaPrompt, sessionActor: int, by: int): SolanaPrompt =
  if (sessionActor != p.actor) { ...p, notice: AccountChanged }
  else { ...p, phase: HistoryCheck, request: p.request + 1 }
type HistoryResult = PaymentFound | NoPaymentFound | ScanIncomplete
pure def canHistoryReply(p: SolanaPrompt, lifetime: int, request: int, history: HistoryResult, by: int): bool = by == server
  and lifetime == p.lifetime and request == p.request and p.phase == HistoryCheck
pure def historyReply(p: SolanaPrompt, lifetime: int, request: int, history: HistoryResult, by: int): SolanaPrompt =
  val cleared = writeVisible(WA::compareAndClear(visible(p), visible(p)), p)
  if (history == PaymentFound) { ...cleared, phase: Verified }
  else if (history == ScanIncomplete) { ...p, phase: Expired, notice: HistoryIncomplete }
  else { ...cleared, phase: NoPlan, message: 0, notice: NotFound }
```

### Rules

```quint
pure def stepSendOnlyBeforeExpiry(before: SolanaPrompt, after: SolanaPrompt): bool =
  (before.phase != Awaiting and after.phase == Awaiting) implies
    before.height <= before.lastValid and visible(before) == WA::noAttempt
pure def stepHistoryCheckSendsNothing(before: SolanaPrompt, via: str, after: SolanaPrompt): bool =
  via == "checkHistory" implies after.messages == before.messages and after.awaiting == ""
    and before.messages.every(m => keyedAt(m, after) == keyedAt(m, before))
pure def stepOtherAccountsUntouched(before: SolanaPrompt, after: SolanaPrompt): bool =
  before.messages.every(m => keyedAt(m, before).owner == before.actor or keyedAt(m, before).attempt == WA::noAttempt
    or keyedAt(m, after) == keyedAt(m, before))
pure def alwaysSlotsKeyed(p: SolanaPrompt): bool = p.messages.every(m => m > 0 and p.slots.keys().contains(m)
  and keyedAt(m, p).owner > 0 and (keyedAt(m, p).attempt == WA::noAttempt
    or (keyedAt(m, p).attempt.bytesId == preparedBytes and p.used.includes(keyedAt(m, p).attempt.identity))))
pure def alwaysAwaitingSaved(p: SolanaPrompt): bool = p.phase == Awaiting implies
  p.awaiting != "" and visible(p).identity == p.awaiting
pure def alwaysPlanBehindPhase(p: SolanaPrompt): bool = (p.phase != NoPlan implies p.message > 0)
  and ((p.awaiting != "") iff (p.phase == Awaiting))
  and ((p.phase != NoPlan and p.phase != Planned) implies p.actor > 0)
pure def alwaysLiveAttemptVisible(p: SolanaPrompt): bool = (p.phase == Awaiting or p.phase == Submitted or p.phase == Uncertain
  or p.phase == Checking or p.phase == HistoryCheck) implies visible(p) != WA::noAttempt
pure def alwaysExpiredPastBlockhash(p: SolanaPrompt): bool = (p.phase == Expired or p.phase == HistoryCheck) implies p.height > p.lastValid
pure def alwaysSignedOutIdle(p: SolanaPrompt): bool = p.actor == 0 implies (p.phase == NoPlan or p.phase == Planned) and p.awaiting == ""
pure def sometimesVerified(p: SolanaPrompt): bool = p.phase == Verified
pure def sometimesUncertain(p: SolanaPrompt): bool = p.phase == Uncertain and visible(p) != WA::noAttempt
pure def sometimesHistoryFound(p: SolanaPrompt): bool = p.phase == Verified and p.height > p.lastValid
pure def sometimesFreshPlanAfterExpiry(p: SolanaPrompt): bool = p.phase == Planned and p.messages.length() > 0
  and p.notice == Quiet and not(p.messages.includes(p.message))
pure def sometimesAccountChanged(p: SolanaPrompt): bool = p.notice == AccountChanged
pure def sometimesCandidate(p: SolanaPrompt): bool = visible(p).candidate != ""
pure def sometimesCandidateBesideSignature(p: SolanaPrompt): bool = visible(p).candidate != "" and visible(p).hash != ""
pure def sometimesSignatureKeptInMemory(p: SolanaPrompt): bool = p.memory != "" and p.phase == Submitted and visible(p).hash == ""
pure def sometimesHistoryIncomplete(p: SolanaPrompt): bool = p.notice == HistoryIncomplete and p.phase == Expired
  and visible(p) != WA::noAttempt
pure val accountValues = Set(1, 2)
pure val sessionActorValues = Set(1, 2)
pure val byValues = Set(1, 2, server, adapter, heightReader)
pure val lifetimeValues = Set(1, 2)
pure val requestValues = Set(1, 2)
pure val messageValues = Set(1, 2)
pure val lastValidValues = Set(3, 5)
pure val heightValues = Set(2, 4, 6)
pure val identityValues = Set("s1", "s2", "s3")
pure val signatureValues = Set("", "sig1")
pure val candidateValues = Set("sig2")
pure val readValues = Set({ ...WA::noAttempt, identity: "s1", bytesId: preparedBytes }, { ...WA::noAttempt, identity: "s2", bytesId: preparedBytes },
  { ...WA::noAttempt, identity: "s1", bytesId: preparedBytes, hash: "sig1" })
pure val weight_receivePlan = 3
pure val weight_observeHeight = 2
pure val weight_send = 3
pure val weight_walletReply = 4
pure val weight_verify = 2
pure val weight_verifyReply = 4
pure val weight_checkHistory = 4
pure val weight_historyReply = 6
pure val eval_witness_sometimesFreshPlanAfterExpiry = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Signed, "sig1", true, adapter),
  ("observeHeight", 4, heightReader),
  ("checkHistory", 1, 1),
  ("historyReply", 1, 1, NoPaymentFound, server),
  ("receivePlan", 1, 2, 5, server))
pure val eval_witness_sometimesVerified = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Signed, "sig1", true, adapter),
  ("verify", 1),
  ("verifyReply", 1, 1, FinalizedMatch, server))
pure val eval_witness_sometimesHistoryFound = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Signed, "sig1", true, adapter),
  ("observeHeight", 4, heightReader),
  ("checkHistory", 1, 1),
  ("historyReply", 1, 1, PaymentFound, server))
pure val eval_witness_sometimesCandidate = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Uncertain, "", true, adapter),
  ("enterCandidate", { ...WA::noAttempt, identity: "s1", bytesId: preparedBytes }, "sig2", 1))
pure val eval_witness_sometimesCandidateBesideSignature = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Signed, "sig1", true, adapter),
  ("enterCandidate", { ...WA::noAttempt, identity: "s1", bytesId: preparedBytes, hash: "sig1" }, "sig2", 1))
pure val eval_witness_sometimesHistoryIncomplete = (
  ("signIn", 1, 1),
  ("receivePlan", 1, 1, 3, server),
  ("send", "s1", true, 1),
  ("walletReply", "s1", WA::Signed, "sig1", true, adapter),
  ("observeHeight", 4, heightReader),
  ("checkHistory", 1, 1),
  ("historyReply", 1, 1, ScanIncomplete, server))
```
