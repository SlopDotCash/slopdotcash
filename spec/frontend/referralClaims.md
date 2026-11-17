# Referral reward claims

PRD section 11. Settings shows the signed-in account's referral rewards from
`GET /api/v1/referrals/me` and lets the account claim them from the referral
distributor on Robinhood Chain. [Referral publication](../settlement/referralPublication.md)
owns roots, pinned wallets, claimed totals and the finalized cache this screen
reads ("A claim uses the active root's pinned wallet and cumulative amount").
This machine owns only the screen: which record it shows, when it offers a
claim, and the one wallet request it may make. It mirrors
[referral link settings](./referralSettings.md).

## Story: Claim referral rewards for the signed-in account

> As a member with referral rewards, I want to see what I can claim, claim it
> once from the wallet the program pinned, and be told it succeeded only when
> the chain shows it.

### A loaded account owns the displayed claimable amount and a reply for another account is dropped

Each mount, account change or refresh starts a new read. A reply is applied
only for the same account, mount lifetime and read; the shell first parses it
(amounts canonical below 2^256, network `robinhood-mainnet` with chain 4663 or
`robinhood-testnet` with 46630, a Merkle proof that verifies for the record's
wallet and cumulative amount, and a ready record complete). Signing out or
another account clears the record. A failed read keeps the record shown,
marked "Additional payout records could not load.", and offers no claim.
Amounts are shown in program tokens with the program's decimals, "Unknown"
when absent.

```quint
import money as M from "../settlement/money"
type ClaimRecord = { ready: bool, fresh: bool, paused: bool, ended: bool, hasClaim: bool, wallet: str,
  claimable: M::Amount, cumulative: M::Amount, claimed: M::Amount }
type ClaimPhase = ClaimIdle | ClaimReviewing | ClaimSending | ClaimSubmitted | ClaimUnknown | ClaimVerified
type ClaimScreen = { actor: str, lifetime: int, readId: int, loaded: bool, loadFailed: bool, record: ClaimRecord,
  phase: ClaimPhase, markerWallet: str, markerCumulative: M::Amount, attempt: int }
pure val emptyRecord: ClaimRecord = { ready: false, fresh: false, paused: false, ended: false, hasClaim: false, wallet: "",
  claimable: M::zero, cumulative: M::zero, claimed: M::zero }
pure val initial: ClaimScreen = { actor: "", lifetime: 0, readId: 0, loaded: false, loadFailed: false, record: emptyRecord,
  phase: ClaimIdle, markerWallet: "", markerCumulative: M::zero, attempt: 0 }
pure def validRecord(record: ClaimRecord): bool =
  M::validAmount(record.claimable) and M::validAmount(record.cumulative) and M::validAmount(record.claimed) and
    (record.hasClaim implies record.wallet != "")
pure def canMount(s: ClaimScreen, actor: str): bool = actor != ""
pure def mount(s: ClaimScreen, actor: str): ClaimScreen =
  { ...s, actor: actor, lifetime: s.lifetime + 1, readId: s.readId + 1, loaded: false, loadFailed: false,
    record: emptyRecord, phase: ClaimIdle }
pure def signOut(s: ClaimScreen): ClaimScreen =
  { ...s, actor: "", loaded: false, loadFailed: false, record: emptyRecord, phase: ClaimIdle }
pure def canRefresh(s: ClaimScreen): bool = s.actor != "" and s.phase != ClaimSending
pure def refresh(s: ClaimScreen): ClaimScreen =
  { ...s, readId: s.readId + 1, phase: if (s.phase == ClaimReviewing) ClaimIdle else s.phase }
pure def markerVerified(s: ClaimScreen, record: ClaimRecord): bool =
  s.markerWallet != "" and s.markerWallet == record.wallet and record.ready and
    M::compareAmounts(record.claimed, s.markerCumulative) >= 0
pure def canReceiveRecord(s: ClaimScreen, actor: str, lifetime: int, readId: int, record: ClaimRecord): bool =
  s.actor != "" and actor == s.actor and lifetime == s.lifetime and readId == s.readId and validRecord(record) and s.phase != ClaimSending
pure def receiveRecord(s: ClaimScreen, actor: str, lifetime: int, readId: int, record: ClaimRecord): ClaimScreen =
  if (markerVerified(s, record))
    { ...s, loaded: true, loadFailed: false, record: record, phase: ClaimVerified, markerWallet: "", markerCumulative: M::zero }
  else { ...s, loaded: true, loadFailed: false, record: record,
    phase: if (s.phase == ClaimReviewing or s.phase == ClaimVerified) ClaimIdle else s.phase }
pure def canFailRead(s: ClaimScreen, actor: str, lifetime: int, readId: int): bool =
  s.actor != "" and actor == s.actor and lifetime == s.lifetime and readId == s.readId and s.phase != ClaimSending
pure def failRead(s: ClaimScreen, actor: str, lifetime: int, readId: int): ClaimScreen =
  { ...s, loadFailed: true, phase: if (s.phase == ClaimReviewing) ClaimIdle else s.phase }
pure def alwaysRecordBelongsToAccount(s: ClaimScreen): bool =
  (s.actor == "" implies not(s.loaded) and s.record == emptyRecord and s.phase == ClaimIdle) and
    (s.actor != "" implies s.lifetime > 0) and (s.loaded implies s.lifetime > 0) and
    (s.record.hasClaim implies s.record.wallet != "") and s.lifetime >= 0 and s.readId >= 0 and s.attempt >= 0
pure def sometimesRecordShown(s: ClaimScreen): bool = s.loaded and s.record.hasClaim
pure val actorValues = Set("alice-id", "bob-id")
pure val lifetimeValues = Set(1, 2)
pure val readIdValues = Set(1, 2, 3)
pure val recordValues = Set(
  { ready: true, fresh: true, paused: false, ended: false, hasClaim: true, wallet: "0xa",
    claimable: List(5), cumulative: List(5), claimed: List(0) },
  { ready: true, fresh: true, paused: false, ended: false, hasClaim: true, wallet: "0xa",
    claimable: List(0), cumulative: List(5), claimed: List(5) },
  { ready: true, fresh: false, paused: true, ended: false, hasClaim: true, wallet: "0xa",
    claimable: List(5), cumulative: List(5), claimed: List(0) },
  { ready: false, fresh: false, paused: false, ended: false, hasClaim: false, wallet: "",
    claimable: List(0), cumulative: List(0), claimed: List(0) })
```

### The claim is offered only for a fresh active root through the pinned wallet, and stale or paused data offers none

Review is offered only for a loaded, ready record whose observation and
finalization are both at most 48 hours old, that is neither paused nor ended,
carries a verified claim with a claimable amount above zero, and has no saved
claim request for its wallet. Review connects the chosen EVM wallet and
refuses unless its account is the record's pinned wallet, its chain is the
program's, the distributor's code hash, token, unpaused state and current
root and epoch match the record, cumulative minus the on-chain claimed amount
equals the claimable amount, and the claim simulates and estimates gas.
Review makes no signature and no page-view chain read happens before it.

```quint
pure def offerable(s: ClaimScreen): bool =
  s.actor != "" and s.loaded and not(s.loadFailed) and s.record.ready and s.record.fresh and not(s.record.paused) and
    not(s.record.ended) and s.record.hasClaim and M::positiveAmount(s.record.claimable) and
    not(s.markerWallet != "" and s.markerWallet == s.record.wallet)
pure def canReview(s: ClaimScreen, connectedWallet: str, chainMatches: bool, distributorMatches: bool): bool =
  offerable(s) and (s.phase == ClaimIdle or s.phase == ClaimVerified) and connectedWallet == s.record.wallet and chainMatches and distributorMatches
pure def review(s: ClaimScreen, connectedWallet: str, chainMatches: bool, distributorMatches: bool): ClaimScreen =
  { ...s, phase: ClaimReviewing }
pure def alwaysReviewIsOfferable(s: ClaimScreen): bool = s.phase == ClaimReviewing implies offerable(s)
pure def sometimesReviewing(s: ClaimScreen): bool = s.phase == ClaimReviewing
pure val connectedWalletValues = Set("0xa", "0xb")
```

### Exactly one claim request can act for each active account lifetime and success is shown only from finalized evidence

Send is a second explicit action on the reviewed claim. It reruns the review
and rechecks account and chain, then, holding the wallet's claim lock
(another view holding it refuses), saves a request marker in local storage
(`slop:referral-claim:<network>:<distributor>:<wallet>`, with its attempt id
and cumulative amount) before the wallet is asked; if the marker cannot be
saved, or one already exists, nothing is sent. A transaction hash shows "Claim
submitted. Wait for the verified record to refresh." and is never shown as
paid. A wallet rejection (code 4001) removes the marker. Any other outcome is
unknown: the marker stays and the screen says to check wallet activity. While
the marker stands no new send starts. The marker is removed in two ways only,
each under the same lock and only if the stored marker is unchanged. A later
record for that wallet whose finalized claimed amount reaches the marker's
cumulative amount removes it and shows "Your claim is verified." Otherwise the
person may clear it with "I checked wallet activity. Review again" on the
loaded record of that wallet, except while a request is being sent; a changed
marker refuses with "The saved claim request changed. Refresh before clearing
it.", and an unreadable one with "Your browser could not read the saved claim
status. Enable site storage and refresh before clearing it." Clearing shows no
success and reads the record again.

```quint
type WalletAnswer = TransactionHash | WalletRejected | AnswerUnknown
pure def canSend(s: ClaimScreen, attemptId: int): bool =
  s.phase == ClaimReviewing and offerable(s) and attemptId > s.attempt
pure def send(s: ClaimScreen, attemptId: int): ClaimScreen =
  { ...s, phase: ClaimSending, markerWallet: s.record.wallet, markerCumulative: s.record.cumulative, attempt: attemptId }
pure def canWalletAnswered(s: ClaimScreen, attemptId: int, answer: WalletAnswer): bool =
  s.phase == ClaimSending and attemptId == s.attempt
pure def walletAnswered(s: ClaimScreen, attemptId: int, answer: WalletAnswer): ClaimScreen = match answer {
  | TransactionHash => { ...s, phase: ClaimSubmitted }
  | WalletRejected => { ...s, phase: ClaimIdle, markerWallet: "", markerCumulative: M::zero }
  | _ => { ...s, phase: ClaimUnknown }
}
pure def canResetMarker(s: ClaimScreen, markerUnchanged: bool): bool =
  s.actor != "" and s.loaded and s.markerWallet != "" and s.markerWallet == s.record.wallet and
    s.phase != ClaimSending and markerUnchanged
pure def resetMarker(s: ClaimScreen, markerUnchanged: bool): ClaimScreen =
  { ...s, phase: ClaimIdle, markerWallet: "", markerCumulative: M::zero, readId: s.readId + 1 }
pure def alwaysRequestHasMarker(s: ClaimScreen): bool =
  (s.phase == ClaimSending or s.phase == ClaimSubmitted or s.phase == ClaimUnknown) implies
    s.markerWallet != "" and s.attempt > 0
pure def stepOneRequestAtATime(before: ClaimScreen, via: str, after: ClaimScreen): bool =
  via == "send" implies not(before.markerWallet != "" and before.markerWallet == before.record.wallet)
pure def stepSuccessOnlyFromFinalizedEvidence(before: ClaimScreen, via: str, after: ClaimScreen): bool =
  (after.phase == ClaimVerified and before.phase != ClaimVerified) implies
    via == "receiveRecord" and after.record.ready and before.markerWallet == after.record.wallet and
      M::compareAmounts(after.record.claimed, before.markerCumulative) >= 0
pure def sometimesSubmitted(s: ClaimScreen): bool = s.phase == ClaimSubmitted
pure def sometimesUnknownKeepsMarker(s: ClaimScreen): bool = s.phase == ClaimUnknown and s.markerWallet != ""
pure def sometimesVerified(s: ClaimScreen): bool = s.phase == ClaimVerified
pure def sometimesMarkerResetByPerson(s: ClaimScreen): bool =
  s.phase == ClaimIdle and s.markerWallet == "" and s.attempt > 0 and s.loaded
pure val attemptIdValues = Set(1, 2)
```
