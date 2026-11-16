# Separate contributor token allocation

PRD section 6 governs this owner-sent allocation. Slop Cash S.P. sends it from its own wallet; the application holds no key and signs or sends nothing. It has no Points, project-vault, ordinary fee or payment-obligation side effect. Source models include `contributor_allocation` and `ui_contributor_allocation`. The fixed actor-ID and amount list is `public/contributor-allocation.json`, changed only through reviewed pull requests; `{"distribution": null}` publishes nothing. One instance is one recipient row of that list. A Sent row records the sender's transaction link. Slop does not certify its chain finality.

## Story: Register before the deadline and receive at most one send

### An unpublished distribution exposes no recipient row

Publication reads the reviewed list. A null distribution keeps every row
unpublished. A published row fixes the actor, amount, network and
registration deadline. The trusted clock only moves forward.

```quint
import money as M from "./money"
type AllocationPhase = Unpublished | AwaitingWallet | Scheduled | Sent | Unclaimed
type ListRow = { actor: int, amount: M::Amount }
type PublishedList = { present: bool, digest: str, network: str, deadline: int, rows: List[ListRow] }
type Allocation = { phase: AllocationPhase, actor: int, amount: M::Amount, network: str, deadline: int, now: int, listDigest: str,
  firstConfirmation: int, wallet: str, transaction: str, batchClosed: bool }
pure val initial: Allocation = { phase: Unpublished, actor: 1, amount: M::zero, network: "", deadline: 0, now: 1, listDigest: "",
  firstConfirmation: 0, wallet: "", transaction: "", batchClosed: false }
pure def rowFor(list: PublishedList, actor: int): ListRow = list.rows.select(r => r.actor == actor).nthOr(0, { actor: 0, amount: M::zero })
pure def canPublish(a: Allocation, list: PublishedList, by: str): bool =
  a.phase == Unpublished and by == "owner" and list.present and list.digest != "" and list.network != ""
    and list.deadline > a.now and rowFor(list, a.actor).actor == a.actor
    and M::validAmount(rowFor(list, a.actor).amount) and M::positiveAmount(rowFor(list, a.actor).amount)
    and list.rows.every(r => list.rows.select(o => o.actor == r.actor).length() == 1)
pure def publish(a: Allocation, list: PublishedList, by: str): Allocation =
  { ...a, phase: AwaitingWallet, amount: rowFor(list, a.actor).amount, network: list.network, deadline: list.deadline, listDigest: list.digest }
pure def canObserveClock(a: Allocation, now: int): bool = now > a.now
pure def observeClock(a: Allocation, now: int): Allocation = { ...a, now: now }
pure val byValues = Set("owner", "recipient", "wrong")
pure val transactionValues = Set("tx", "")
pure val listValues = Set({ present: true, digest: "d", network: "base", deadline: 4, rows: List({ actor: 1, amount: List(5) }) },
  { present: false, digest: "", network: "", deadline: 0, rows: List() },
  { present: true, digest: "d", network: "base", deadline: 4, rows: List({ actor: 2, amount: List(5) }) })
```

### A timely first wallet confirmation survives replacement

The wallets owner verifies account identity and destination signature and
supplies the confirmation with its network and recorded confirmation time.
Only the signed-in recipient confirms; the wallet must be for the
allocation's network. Replacement cannot change the original confirmation
time or create another send.

```quint
type WalletConfirmation = { actor: int, wallet: str, network: str, confirmedAt: int }
pure def canConfirmWallet(a: Allocation, confirmation: WalletConfirmation, by: str): bool =
  (a.phase == AwaitingWallet or a.phase == Scheduled) and by == "recipient" and confirmation.actor == a.actor
    and confirmation.wallet != "" and confirmation.network == a.network and confirmation.confirmedAt > 0
    and confirmation.confirmedAt <= a.now and confirmation.confirmedAt < a.deadline and not(a.batchClosed)
pure def confirmWallet(a: Allocation, confirmation: WalletConfirmation, by: str): Allocation =
  { ...a, phase: Scheduled, wallet: confirmation.wallet,
    firstConfirmation: if (a.firstConfirmation == 0) confirmation.confirmedAt else a.firstConfirmation }
pure def canReplaceWallet(a: Allocation, confirmation: WalletConfirmation, by: str): bool =
  a.phase == Scheduled and by == "recipient" and confirmation.actor == a.actor and confirmation.wallet != ""
    and confirmation.network == a.network and not(a.batchClosed)
pure def replaceWallet(a: Allocation, confirmation: WalletConfirmation, by: str): Allocation = { ...a, wallet: confirmation.wallet }
pure val confirmationValues = Set({ actor: 1, wallet: "wallet", network: "base", confirmedAt: 2 },
  { actor: 1, wallet: "replacement", network: "base", confirmedAt: 3 }, { actor: 1, wallet: "wallet", network: "solana", confirmedAt: 2 },
  { actor: 2, wallet: "wallet", network: "base", confirmedAt: 2 }, { actor: 1, wallet: "wallet", network: "base", confirmedAt: 5 })
```

### Only the owner sender records the single transaction

```quint
pure def canRecordSend(a: Allocation, transaction: str, by: str): bool =
  a.phase == Scheduled and a.wallet != "" and transaction != "" and by == "owner" and not(a.batchClosed)
pure def recordSend(a: Allocation, transaction: str, by: str): Allocation =
  { ...a, phase: Sent, transaction: transaction }
pure def canExpire(a: Allocation): bool = a.phase == AwaitingWallet and a.now >= a.deadline
pure def expire(a: Allocation): Allocation = { ...a, phase: Unclaimed }
pure def canCloseBatch(a: Allocation, by: str): bool =
  a.phase != Unpublished and not(a.batchClosed) and by == "owner"
pure def closeBatch(a: Allocation, by: str): Allocation =
  { ...a, batchClosed: true, phase: if (a.phase == Sent) Sent else Unclaimed }
pure def mayRead(a: Allocation, actor: int): bool = a.phase != Unpublished and actor == a.actor
pure def alwaysUnpublishedEmpty(a: Allocation): bool = a.phase == Unpublished implies a.listDigest == "" and a.wallet == "" and a.transaction == ""
pure def alwaysPublishedTerms(a: Allocation): bool = a.phase != Unpublished implies
  a.listDigest != "" and a.network != "" and a.deadline > 0 and M::positiveAmount(a.amount)
pure def stepPublishedTermsFixed(before: Allocation, after: Allocation): bool = before.phase != Unpublished implies
  after.amount == before.amount and after.network == before.network and after.deadline == before.deadline and after.listDigest == before.listDigest
pure def stepClockForward(before: Allocation, after: Allocation): bool = after.now >= before.now
pure def alwaysScheduledWallet(a: Allocation): bool = a.phase == Scheduled implies
  a.wallet != "" and a.firstConfirmation > 0 and a.firstConfirmation < a.deadline
pure def alwaysSentRecorded(a: Allocation): bool = a.phase == Sent implies a.transaction != ""
pure def stepSentPermanent(before: Allocation, after: Allocation): bool = before.phase == Sent implies
  after.phase == Sent and after.transaction == before.transaction and after.wallet == before.wallet
pure def stepFirstConfirmationPreserved(before: Allocation, after: Allocation): bool =
  before.firstConfirmation > 0 implies after.firstConfirmation == before.firstConfirmation
pure def sometimesSent(a: Allocation): bool = a.phase == Sent
pure def sometimesUnclaimed(a: Allocation): bool = a.phase == Unclaimed
```

### First confirmation is either absent or inside the registration window

Discovered by the proof: an arbitrary AwaitingWallet state could retain a
negative first confirmation. Confirming a valid wallet would preserve that
invalid timestamp. Every retained first confirmation is now explicitly absent
or positive and before the fixed deadline, in every phase.

```quint
pure def alwaysFirstConfirmationValid(a: Allocation): bool = a.firstConfirmation == 0
  or (a.firstConfirmation > 0 and a.firstConfirmation < a.deadline)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val nowValues = Set(2, 3, 4, 5)
```
