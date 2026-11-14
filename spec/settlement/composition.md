# Atomic obligation settlement

PRD sections 6 and 12 require the payment journal and the vault reserve to
describe the same finalized outcome. This machine composes one newly created
obligation with its vault accounting view. Other obligations use the vault's
distinct reservation records. The persistence adapter must commit the two
updated records in one transaction, or reconcile both from the retained receipt.
Direct payment rails use their own source balances and leg journal, outside this
vault-specific composition.

## Story: Consume the exact reserve when its payment becomes paid

### Vault and payment identities remain the same throughout settlement

```quint
import vault as V from "./vault"
import payment as P from "./payment"
import money as M from "./money"
type Settlement = { vault: V::Vault, payment: P::Payment }
type FinalizedPayment = { payment: P::PaymentEvidence, receipt: int }
pure val initial: Settlement = { vault: V::initial, payment: P::initial }
pure def hasReserve(s: Settlement): bool =
  V::reservationMatches(s.vault, s.payment.obligation, s.payment.recipient, s.payment.gross)
pure def alwaysIdentityMatches(s: Settlement): bool =
  s.vault.id == s.payment.vault and s.vault.asset == s.payment.asset
```

### Verified deposits and destination binding precede reservation

The child machines validate the asset, purpose, rail, destination and consent.
The composed machine keeps those same definitions for every transition.

```quint
pure def canDeposit(s: Settlement, amount: M::Amount, asset: str, receipt: int, finalized: bool): bool =
  V::canDeposit(s.vault, amount, asset, receipt, finalized)
pure def deposit(s: Settlement, amount: M::Amount, asset: str, receipt: int, finalized: bool): Settlement =
  { ...s, vault: V::deposit(s.vault, amount, asset, receipt, finalized) }
pure def canConfigure(s: Settlement, purpose: P::Purpose, rail: P::PaymentRail, gross: M::Amount): bool =
  (rail == P::OrdinaryVault or rail == P::StandardBountyVault) and P::canConfigure(s.payment, purpose, rail, gross)
pure def configure(s: Settlement, purpose: P::Purpose, rail: P::PaymentRail, gross: M::Amount): Settlement =
  { ...s, payment: P::configure(s.payment, purpose, rail, gross) }
pure def canBind(s: Settlement, recipient: str, consent: int, by: str): bool =
  P::canBind(s.payment, recipient, consent, by)
pure def bind(s: Settlement, recipient: str, consent: int, by: str): Settlement =
  { ...s, payment: P::bind(s.payment, recipient, consent, by) }
pure def canReserve(s: Settlement): bool = s.payment.phase == P::Ready and
  V::canReserve(s.vault, s.payment.gross, s.payment.recipient, s.payment.obligation)
pure def reserve(s: Settlement): Settlement =
  { ...s, vault: V::reserve(s.vault, s.payment.gross, s.payment.recipient, s.payment.obligation) }
```

### Every dispatched attempt retains its matching reserve

```quint
pure def canJournal(s: Settlement, attempt: int): bool = hasReserve(s) and P::canJournal(s.payment, attempt)
pure def journal(s: Settlement, attempt: int): Settlement =
  { ...s, payment: P::journal(s.payment, attempt) }
pure def canSubmit(s: Settlement): bool = hasReserve(s) and P::canSubmit(s.payment)
pure def submit(s: Settlement): Settlement = { ...s, payment: P::submit(s.payment) }
pure def canLoseReceipt(s: Settlement): bool = P::canLoseReceipt(s.payment)
pure def loseReceipt(s: Settlement): Settlement = { ...s, payment: P::loseReceipt(s.payment) }
pure def canRetransmit(s: Settlement): bool = hasReserve(s) and P::canRetransmit(s.payment)
pure def retransmit(s: Settlement): Settlement = { ...s, payment: P::retransmit(s.payment) }
pure def alwaysDispatchReserved(s: Settlement): bool =
  (s.payment.phase == P::Journaled or s.payment.phase == P::Submitted or s.payment.phase == P::Uncertain) implies hasReserve(s)
```

### One exact finalized receipt updates both child records atomically

A replay fails after the obligation is paid. Partial, wrong-asset,
wrong-recipient and unfinalized evidence changes neither record. The same
receipt identity enters the vault's deduplication journal.

```quint
pure def canReconcile(s: Settlement, evidence: FinalizedPayment): bool =
  P::canReconcile(s.payment, evidence.payment) and
  V::canPayReserved(s.vault, s.payment.gross, evidence.payment.source, evidence.payment.asset,
    evidence.payment.recipient, evidence.payment.obligation, evidence.receipt, evidence.payment.height)
pure def reconcile(s: Settlement, evidence: FinalizedPayment): Settlement = {
  payment: P::reconcile(s.payment, evidence.payment),
  vault: V::payReserved(s.vault, s.payment.gross, evidence.payment.source, evidence.payment.asset,
    evidence.payment.recipient, evidence.payment.obligation, evidence.receipt, evidence.payment.height)
}
pure def alwaysPaidConsumesReserve(s: Settlement): bool =
  if (s.payment.phase == P::Paid) not(hasReserve(s)) and M::equalAmounts(s.vault.paid, s.payment.gross)
  else M::equalAmounts(s.vault.paid, M::zero)
pure def alwaysChildRules(s: Settlement): bool =
  V::alwaysConserved(s.vault) and V::alwaysValidAmounts(s.vault) and
  V::alwaysReservationMatches(s.vault) and V::alwaysReservationTotal(s.vault) and V::alwaysReservationIdentity(s.vault) and
  P::alwaysConserved(s.payment) and P::alwaysPaidEvidence(s.payment) and P::alwaysCorrectFee(s.payment) and P::alwaysCorrectRail(s.payment)
pure def sometimesReserved(s: Settlement): bool = hasReserve(s)
pure def sometimesUncertainReserved(s: Settlement): bool = s.payment.phase == P::Uncertain and hasReserve(s)
pure def sometimesPaidTogether(s: Settlement): bool = s.payment.phase == P::Paid and not(hasReserve(s))
```

### Simulation covers exact and conflicting evidence for the same obligation

```quint
pure val amountValues = Set(List(4), List(100))
pure val grossValues = Set(List(4), List(100))
pure val assetValues = Set("asset", "wrong")
pure val recipientValues = Set("wallet", "wrong")
pure val receiptValues = Set(1, 2)
pure val consentValues = Set(0, 1)
pure val attemptValues = Set(1, 2)
pure val byValues = Set("recipient", "owner", "wrong")
pure val evidenceValues = Set(
  { receipt: 2, payment: { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true } },
  { receipt: 2, payment: { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(3), fee: List(1), height: 1, finalized: true, succeeded: true } },
  { receipt: 2, payment: { attempt: 1, obligation: 1, source: "vault", asset: "wrong", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true } },
  { receipt: 2, payment: { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wrong", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true } },
  { receipt: 2, payment: { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: false, succeeded: true } })

```
