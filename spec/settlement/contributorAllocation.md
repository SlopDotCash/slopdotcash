# Separate contributor token allocation

PRD section 6 governs this owner-sent allocation. It has no Points, project-vault, ordinary fee or payment-obligation side effect. Source models include `contributor_allocation` and `ui_contributor_allocation`. A Sent row records the sender's transaction link. Slop does not certify its chain finality.

## Story: Register before the deadline and receive at most one send

### An unpublished distribution exposes no recipient row

```quint
import money as M from "./money"
type AllocationPhase = Unpublished | AwaitingWallet | Scheduled | Sent | Unclaimed
 type Allocation = { phase: AllocationPhase, actor: int, amount: M::Amount, deadline: int,
  firstConfirmation: int, wallet: str, transaction: str, batchClosed: bool }
pure val initial: Allocation = { phase: Unpublished, actor: 1, amount: List(5), deadline: 4,
  firstConfirmation: 0, wallet: "", transaction: "", batchClosed: false }
pure def canPublish(a: Allocation, by: str): bool = a.phase == Unpublished and by == "owner"
pure def publish(a: Allocation, by: str): Allocation = { ...a, phase: AwaitingWallet }
pure val byValues = Set("owner", "wrong")
pure val walletValues = Set("wallet", "replacement", "")
pure val transactionValues = Set("tx", "")
```

### A timely first wallet confirmation survives replacement

The future wallet adapter verifies account identity and destination signature. This allocation consumes only those verified confirmations. Replacement cannot change the original confirmation time or create another send.

```quint
pure def canConfirmWallet(a: Allocation, actor: int, wallet: str, confirmedAt: int): bool =
  (a.phase == AwaitingWallet or a.phase == Scheduled) and actor == a.actor and wallet != ""
    and confirmedAt > 0 and confirmedAt < a.deadline and not(a.batchClosed)
pure def confirmWallet(a: Allocation, actor: int, wallet: str, confirmedAt: int): Allocation =
  { ...a, phase: Scheduled, wallet: wallet,
    firstConfirmation: if (a.firstConfirmation == 0) confirmedAt else a.firstConfirmation }
pure def canReplaceWallet(a: Allocation, actor: int, wallet: str): bool =
  a.phase == Scheduled and actor == a.actor and wallet != "" and not(a.batchClosed)
pure def replaceWallet(a: Allocation, actor: int, wallet: str): Allocation = { ...a, wallet: wallet }
```

### Only the owner sender records the single transaction

```quint
pure def canRecordSend(a: Allocation, transaction: str, by: str): bool =
  a.phase == Scheduled and a.wallet != "" and transaction != "" and by == "owner" and not(a.batchClosed)
pure def recordSend(a: Allocation, transaction: str, by: str): Allocation =
  { ...a, phase: Sent, transaction: transaction }
pure def canExpire(a: Allocation, now: int): bool = a.phase == AwaitingWallet and now >= a.deadline
pure def expire(a: Allocation, now: int): Allocation = { ...a, phase: Unclaimed }
pure def canCloseBatch(a: Allocation, by: str): bool =
  a.phase != Unpublished and not(a.batchClosed) and by == "owner"
pure def closeBatch(a: Allocation, by: str): Allocation =
  { ...a, batchClosed: true, phase: if (a.phase == Sent) Sent else Unclaimed }
pure def mayRead(a: Allocation, actor: int): bool = a.phase != Unpublished and actor == a.actor
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

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val confirmedAtValues = Set(0, 1, 2)
pure val nowValues = Set(0, 3, 4, 5)
```
