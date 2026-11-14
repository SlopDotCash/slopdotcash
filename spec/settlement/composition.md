# Atomic obligation settlement

PRD sections 6 and 12 require the payment journal and the vault reserve to
describe the same finalized outcome. This machine composes one newly created
obligation with its vault accounting view. Other obligations use the vault's
distinct reservation records. The persistence adapter must commit the two
updated records in one transaction, or reconcile both from the retained receipt.
Direct payment rails use their own source balances and leg journal, outside this
vault-specific composition.

Pinned EVM `contracts/evm/src/ProjectEscrow.sol` records the award actor
before binding and selects the current versioned destination at execution.
Solana `contracts/solana/programs/slop-escrow/src/lib.rs` binds the pay accounts
to the obligation's actor. Both contracts pay an obligation once. The
canonical backend ledger indexes an exact finalized event for the obligation
and accepts historically authorized destination claims. Source anchors at
`e96069ce2a403588ca2129b1ebb943f7bb0972a6` are
`ProjectEscrow.sol` functions `recordAward`, `payableBinding`, and `pay`,
Solana handlers `pay`, `pay_native` and accounts `Pay`, `PayNative`,
and `backend/payments/ledger.ts:indexPaymentEvent`. Real contract and D1
conformance require separately verified chain adapters.

## Story: Reserve funds for the immutable contributor

### A verified deposit can fund a walletless award

One reserved obligation belongs to a contributor actor and immutable payout
terms. Reserving consumes free funds before a wallet is authorized and
admits the corresponding outbox identity. The authorized wallet can change
without rewriting the reservation. Independent direct rails retain their own
attempt and reconciliation rules under the payment owner.

```quint
import vault as V from "./vault"
import payment as P from "./payment"
import money as M from "./money"
import paymentDispatch as D from "./paymentDispatch"
type Settlement = { vault: V::Vault, payment: P::Payment, delivery: D::Dispatch }
type FinalizedPayment = { scanner: D::Receipt, amounts: P::VaultPaymentEvidence, receipt: int }
pure val initial: Settlement = { vault: V::initial, payment: P::initial, delivery: D::initial }
pure def hasReserve(s: Settlement): bool =
  V::reservationMatches(s.vault, s.payment.obligation, s.payment.target.actor, s.payment.gross)
pure def alwaysIdentityMatches(s: Settlement): bool = s.vault.id == s.payment.vault and s.vault.asset == s.payment.asset
  and s.payment.vault == s.payment.target.vault and s.payment.asset == s.payment.target.asset
  and (s.delivery.admitted implies s.delivery.target == s.payment.target)
pure def alwaysDispatchReserved(s: Settlement): bool = s.payment.phase == P::VaultReserved implies hasReserve(s) and s.delivery.admitted
pure def canDeposit(s: Settlement, amount: M::Amount, asset: str, receipt: int, finalized: bool): bool =
  V::canDeposit(s.vault, amount, asset, receipt, finalized)
pure def deposit(s: Settlement, amount: M::Amount, asset: str, receipt: int, finalized: bool): Settlement =
  { ...s, vault: V::deposit(s.vault, amount, asset, receipt, finalized) }
pure def canConfigure(s: Settlement, purpose: P::Purpose, rail: P::PaymentRail, gross: M::Amount): bool =
  not(s.delivery.admitted) and not(P::directRail(rail)) and P::canConfigure(s.payment, purpose, rail, gross)
pure def configure(s: Settlement, purpose: P::Purpose, rail: P::PaymentRail, gross: M::Amount): Settlement =
  { ...s, payment: P::configure(s.payment, purpose, rail, gross) }
pure def canReserve(s: Settlement): bool = P::canReserveVault(s.payment)
  and V::canReserve(s.vault, s.payment.gross, s.payment.target.actor, s.payment.obligation)
  and D::canAdmit(s.delivery, s.payment.target, true)
pure def reserve(s: Settlement): Settlement = {
  vault: V::reserve(s.vault, s.payment.gross, s.payment.target.actor, s.payment.obligation),
  payment: P::reserveVault(s.payment), delivery: D::admit(s.delivery, s.payment.target, true) }
```

### Current and historical consent belong to the shared outbox

Wallet authorization records effective claims and the historical consent needed
for post-send finalization. Attempt keys and queue leases remain solely in
the [dispatch](./paymentDispatch.md) owner. The dispatch worker can update
attempt metadata while the reservation remains unchanged.

```quint
type DeliveryUpdate = SetWallet({claim: str, digest: str, address: str}) | TakeLease({token: int}) | CaptureClaim({token: int}) | PrepareKey({token: int, key: str})
  | NoteAmbiguity({token: int}) | NoteSuccess({token: int, tx: str})
pure def canUpdateDelivery(s: Settlement, update: DeliveryUpdate): bool = match update {
  | SetWallet(walletUpdate) => D::canAuthorizeWallet(s.delivery, {claim: walletUpdate.claim, digest: walletUpdate.digest, address: walletUpdate.address}, true)
  | TakeLease(grant) => D::canAcquire(s.delivery, grant.token)
  | CaptureClaim(capture) => D::canReadClaim(s.delivery, capture.token)
  | PrepareKey(prepared) => D::canPrepare(s.delivery, prepared.token, prepared.key)
  | NoteAmbiguity(result) => D::canReturnAmbiguous(s.delivery, result.token)
  | NoteSuccess(submission) => D::canReturnSuccess(s.delivery, submission.token, submission.tx)
}
pure def nextDelivery(delivery: D::Dispatch, update: DeliveryUpdate): D::Dispatch = match update {
  | SetWallet(walletUpdate) => D::authorizeWallet(delivery, {claim: walletUpdate.claim, digest: walletUpdate.digest, address: walletUpdate.address}, true)
  | TakeLease(grant) => D::acquire(delivery, grant.token)
  | CaptureClaim(capture) => D::readClaim(delivery, capture.token)
  | PrepareKey(prepared) => D::prepare(delivery, prepared.token, prepared.key)
  | NoteAmbiguity(result) => D::returnAmbiguous(delivery, result.token)
  | NoteSuccess(submission) => D::returnSuccess(delivery, submission.token, submission.tx)
}
pure def updateDelivery(s: Settlement, update: DeliveryUpdate): Settlement =
  { ...s, delivery: nextDelivery(s.delivery, update) }
```

## Story: Commit a canonical scanner payout across all three owners

### An exact finalized event records one receipt and consumes the matching reserve

The scanner's transaction and historically authorized destination can appear
without a local attempt, before its callback or after a newer current wallet
claim. The award actor and gross amount remain fixed. One atomic transition
marks the financial obligation paid, records the delivery receipt and
consumes only that obligation's reserve. Callback metadata, unavailable
receipts and merely submitted transactions never enter the paid state.
Exact scanner replay may acknowledge the already indexed receipt through the
dispatch owner. A distinct event cannot replace the canonical payment record.
The receipt adapter injectively binds the native network, transaction and
event index to the accounting reference.

```quint
pure def canReconcile(s: Settlement, evidence: FinalizedPayment): bool =
  val observed = evidence.amounts
  val chainReceipt = evidence.scanner
  P::vaultPayoutMatches(s.payment, chainReceipt, observed) and D::canIndexFinalized(s.delivery, chainReceipt)
    and s.delivery.queue != D::Indexed and
    V::canPayReserved(s.vault, s.payment.gross, chainReceipt.target.vault, chainReceipt.target.asset,
      chainReceipt.target.actor, chainReceipt.destination, observed.obligation, evidence.receipt, observed.height, chainReceipt.tx)
pure def reconcile(s: Settlement, evidence: FinalizedPayment): Settlement =
  val observed = evidence.amounts
  val chainReceipt = evidence.scanner
  { payment: P::recordVaultPayment(chainReceipt, observed, s.payment),
    delivery: D::indexFinalized(s.delivery, chainReceipt),
    vault: V::payReserved(s.vault, s.payment.gross, chainReceipt.target.vault, chainReceipt.target.asset,
      chainReceipt.target.actor, chainReceipt.destination, observed.obligation, evidence.receipt, observed.height, chainReceipt.tx) }
pure def alwaysPaidConsumesReserve(s: Settlement): bool =
  if (s.payment.phase == P::Paid) not(hasReserve(s)) and
    V::settlementMatches(s.vault, s.payment.obligation, s.payment.target.actor, s.payment.vaultReceipt.destination,
      s.payment.gross, s.payment.finalizedHeight, s.payment.vaultReceipt.tx)
  else not(V::settlementExists(s.vault, s.payment.obligation))
pure def alwaysCanonicalReceiptAgrees(s: Settlement): bool =
  (s.payment.phase == P::Paid) == (s.delivery.queue == D::Indexed) and
    (s.delivery.queue == D::Indexed implies s.payment.vaultReceipt == s.delivery.receipt)
pure def alwaysChildRules(s: Settlement): bool =
  V::alwaysConserved(s.vault) and V::alwaysValidAmounts(s.vault) and
  V::alwaysReservationMatches(s.vault) and V::alwaysReservationTotal(s.vault) and V::alwaysReservationIdentity(s.vault) and
  V::alwaysSettlementHistory(s.vault) and V::alwaysSettlementTotal(s.vault) and
  P::alwaysConserved(s.payment) and P::alwaysPaidEvidence(s.payment) and P::alwaysCorrectFee(s.payment) and P::alwaysCorrectRail(s.payment) and
  P::alwaysUnconfiguredEmpty(s.payment) and P::alwaysAdmittedAttempts(s.payment) and P::alwaysVaultPhase(s.payment) and
  D::alwaysLeaseShape(s.delivery) and D::alwaysIndexedHasExactReceipt(s.delivery)
    and D::alwaysActiveQueueHasObligation(s.delivery) and D::alwaysClockAndTokenDomain(s.delivery)
pure def sometimesWalletlessReserved(s: Settlement): bool = hasReserve(s) and s.delivery.queue == D::NeedsWallet
pure def sometimesUncertainReserved(s: Settlement): bool = D::sometimesUnknown(s.delivery) and hasReserve(s)
pure def sometimesPaidTogether(s: Settlement): bool = s.payment.phase == P::Paid and not(hasReserve(s))
pure def sometimesPaidWithoutAttempt(s: Settlement): bool = s.payment.phase == P::Paid and s.delivery.attempts.length() == 0
pure def sometimesHistoricalDestination(s: Settlement): bool = s.payment.phase == P::Paid
  and s.delivery.wallet.address != s.payment.vaultReceipt.destination
```

### Simulation samples exercise independent actor and wallet identities

```quint
pure val amountValues = Set(List(4), List(100))
pure val grossValues = Set(List(4), List(100))
pure val assetValues = Set("asset", "wrong")
pure val receiptValues = Set(1, 2, 4)
pure val updateValues = Set(SetWallet({claim: D::walletOne.claim, digest: D::walletOne.digest, address: D::walletOne.address}),
  SetWallet({claim: D::walletTwo.claim, digest: D::walletTwo.digest, address: D::walletTwo.address}), TakeLease({token: 1}), CaptureClaim({token: 1}),
  PrepareKey({token: 1, key: "attempt-one"}), NoteAmbiguity({token: 1}), NoteSuccess({token: 1, tx: "tx-one"}))
pure val ordinaryReceipt: FinalizedPayment = { scanner: P::receiptSample, amounts: P::vaultEvidenceSample, receipt: 3 }
pure val bountyReceipt: FinalizedPayment = { ...ordinaryReceipt,
  scanner: { ...P::receiptSample, target: { ...P::receiptSample.target, scope: D::PrivateBounty } },
  amounts: { ...P::vaultEvidenceSample, gross: List(4), principal: List(3), fee: List(1) } }
pure val evidenceValues = Set(ordinaryReceipt, bountyReceipt,
  { ...ordinaryReceipt, amounts: { ...P::vaultEvidenceSample, principal: List(97) } },
  { ...ordinaryReceipt, scanner: { ...P::receiptSample, finalized: false } })
pure val weight_updateDelivery = 8
pure val weight_reconcile = 5
```
