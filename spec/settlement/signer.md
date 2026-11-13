# Signer boundaries and transaction replacement

PRD sections 3, 6 and 11 restrict application-service signers. Source models include `binding_cancellation`, `stored_binding_broadcast_authority`, `authority_rotation`, `inactive_attester`, `fee_nonce_reuse`, `solana_expiry` and `keeper_gas_budget`. Signatures and transaction encodings remain external effects that require exact-byte tests.

## Story: Retain both possible winners of a binding cancellation

### A binding requires both account attestation and wallet authorization

```quint
type BindingPhase = Unbound | Authorized | BindingPending | CancellationPending | Bound | Cancelled
type Binding = { phase: BindingPhase, actor: int, wallet: str, authority: int,
  signedAuthority: int, nonce: int, bindingAttempt: int, cancellationAttempt: int,
  canonical: int, finalizedHeight: int }
pure val initial: Binding = { phase: Unbound, actor: 1, wallet: "wallet", authority: 1,
  signedAuthority: 0, nonce: 0, bindingAttempt: 0, cancellationAttempt: 0,
  canonical: 0, finalizedHeight: 0 }
pure def canAuthorize(b: Binding, actor: int, wallet: str, walletSigned: bool, by: str): bool =
  b.phase == Unbound and actor == b.actor and wallet == b.wallet and walletSigned and by == "account"
pure def authorize(b: Binding, actor: int, wallet: str, walletSigned: bool, by: str): Binding =
  { ...b, phase: Authorized }
pure def canSignBinding(b: Binding, nonce: int, attempt: int, authority: int, by: str): bool =
  b.phase == Authorized and nonce >= 0 and attempt > 0 and authority == b.authority and by == "attester"
pure def signBinding(b: Binding, nonce: int, attempt: int, authority: int, by: str): Binding =
  { ...b, phase: BindingPending, nonce: nonce, bindingAttempt: attempt, signedAuthority: authority }
pure val byValues = Set("account", "attester", "wrong")
pure val walletValues = Set("wallet", "wrong")
pure val destinationValues = Set("attester", "wrong")
pure val dataValues = Set("", "payload")
```

### Cancellation uses the same nonce and an empty zero-value self-transfer

Obsolete means a later binding intent has superseded this pending intent. The canceled attempt remains retained because its original transaction may win.

```quint
pure def canCancelBinding(b: Binding, nonce: int, attempt: int, value: int, destination: str,
  data: str, obsolete: bool, by: str): bool = b.phase == BindingPending and obsolete and by == "attester"
    and nonce == b.nonce and attempt > 0 and attempt != b.bindingAttempt
    and value == 0 and destination == "attester" and data == ""
pure def cancelBinding(b: Binding, nonce: int, attempt: int, value: int, destination: str,
  data: str, obsolete: bool, by: str): Binding =
  { ...b, phase: CancellationPending, cancellationAttempt: attempt }
pure def canFinalizeBinding(b: Binding, attempt: int, height: int): bool =
  (b.phase == BindingPending or b.phase == CancellationPending) and height > 0 and attempt == b.bindingAttempt
pure def finalizeBinding(b: Binding, attempt: int, height: int): Binding =
  { ...b, phase: Bound, canonical: attempt, finalizedHeight: height }
pure def canFinalizeCancellation(b: Binding, attempt: int, height: int): bool =
  b.phase == CancellationPending and height > 0 and attempt == b.cancellationAttempt
pure def finalizeCancellation(b: Binding, attempt: int, height: int): Binding =
  { ...b, phase: Cancelled, canonical: attempt, finalizedHeight: height }
pure def alwaysCanonicalRetained(b: Binding): bool = (b.phase == Bound or b.phase == Cancelled) implies
  b.finalizedHeight > 0 and (b.canonical == b.bindingAttempt or b.canonical == b.cancellationAttempt)
pure def stepRetainSignedBinding(before: Binding, after: Binding): bool = before.bindingAttempt > 0 implies
  after.bindingAttempt == before.bindingAttempt and after.signedAuthority == before.signedAuthority
pure def sometimesOldBindingWins(b: Binding): bool = b.phase == Bound and b.cancellationAttempt > 0
pure def sometimesCancellationWins(b: Binding): bool = b.phase == Cancelled
```

## Story: Restrict every service operation

### Signer permissions distinguish identity roots from payments and fee assets

The root attester cannot select recipients or pay. Fee keys have no vault role. Referral posting needs independent activation. Owner upgrade custody remains outside service custody. These predicates are reviewed admission rules for the later signer shell.

```quint
type Signer = IdentityAttester | FeeWallet | ReferralPoster | Owner
pure val operationValues = Set("ownerPayment", "refund", "binding", "feeClaim")
pure def permittedOperation(signer: Signer, operation: str): bool =
  if (signer == IdentityAttester) List("binding", "bindingCancellation", "monthlyRoot", "reserveReleaseApproval").includes(operation)
  else if (signer == FeeWallet) List("feeClaim", "feeConversion", "buybackBridge", "buybackPurchase", "buybackBurn").includes(operation)
  else if (signer == ReferralPoster) operation == "referralRoot"
  else List("upgrade", "refund", "reserveRelease", "fund", "ownerPayment").includes(operation)
pure def lawAttesterCannotPay(operation: str): bool = operation == "ownerPayment" implies not(permittedOperation(IdentityAttester, operation))
pure def lawFeeWalletCannotRefund(operation: str): bool = operation == "refund" implies not(permittedOperation(FeeWallet, operation))
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val attemptValues = Set(0, 1, 2)
pure val authorityValues = Set(0, 1, 2)
pure val heightValues = Set(0, 1, 2)
pure val nonceValues = Set(0, 1, 2)
pure val valueValues = Set(0, 1, 2)
```
