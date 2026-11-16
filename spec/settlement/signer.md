# Signer boundaries and binding transaction journal

PRD sections 3, 6 and 11 restrict application-service signers. Slop AGENTS
allows exactly three kinds of application-service key: the escrow identity
attester, one fee-wallet hot key per fee wallet, and the referral
root-posting key. Slop operates no payment key or payment relayer in
production. Source models include `binding_cancellation`,
`stored_binding_broadcast_authority`, `authority_rotation`,
`inactive_attester` and `fee_nonce_reuse`. Development anchors are
`workers/payment-executor/README.md` (signer stacks, `MAINNET_EXECUTION`),
`workers/payment-executor/mainnet-execution.mjs`, `signer-stacks.mjs` and
`backend/payments/README.md` ("A Base bind transaction can be retired only
after its revert is finalized…"). Signatures and transaction encodings remain
external effects that require exact-byte tests.
[Binding authority](./bindingAuthority.md) owns the on-chain binding state;
this unit is the attester's journal of one binding intent and its
transactions.

## Story: Journal one binding intent and keep both possible winners

### A binding needs the account's current intent and the wallet's own signature

The account records each binding intent with an increasing number; the
newest intent makes every earlier pending intent obsolete. The wallet
signature evidence names the wallet that signed, recovered by the
verification adapter.

```quint
type BindingPhase = Unbound | Authorized | BindingPending | CancellationPending | Bound | Cancelled | Retired
type WalletSignature = { wallet: str, signer: str, intent: int }
type FinalizedOutcome = { attempt: int, reverted: bool, block: int, canonicalBlock: int }
type Binding = { phase: BindingPhase, actor: int, wallet: str, authority: int, intent: int, latestIntent: int,
  signedAuthority: int, nonce: int, bindingAttempt: int, cancellationAttempt: int,
  canonical: int, finalizedHeight: int, retired: List[int] }
pure val initial: Binding = { phase: Unbound, actor: 1, wallet: "wallet", authority: 1, intent: 0, latestIntent: 0,
  signedAuthority: 0, nonce: 0, bindingAttempt: 0, cancellationAttempt: 0,
  canonical: 0, finalizedHeight: 0, retired: List() }
pure def canRecordIntent(b: Binding, intent: int, by: str): bool = by == "account" and intent > b.latestIntent
pure def recordIntent(b: Binding, intent: int, by: str): Binding = { ...b, latestIntent: intent }
pure def canAuthorize(b: Binding, actor: int, signature: WalletSignature, by: str): bool =
  (b.phase == Unbound or b.phase == Retired) and actor == b.actor and signature.wallet == b.wallet
    and signature.signer == signature.wallet and signature.intent == b.latestIntent and signature.intent > b.intent and by == "account"
pure def authorize(b: Binding, actor: int, signature: WalletSignature, by: str): Binding =
  { ...b, phase: Authorized, intent: signature.intent, bindingAttempt: 0, cancellationAttempt: 0, signedAuthority: 0 }
```

### Only the identity authority in force signs; a rotated-out authority cannot sign or cancel

```quint
pure def canObserveAuthority(b: Binding, authority: int): bool = authority > b.authority
pure def observeAuthority(b: Binding, authority: int): Binding = { ...b, authority: authority }
pure def canSignBinding(b: Binding, nonce: int, attempt: int, authority: int, by: str): bool =
  b.phase == Authorized and nonce >= 0 and attempt > 0 and authority == b.authority and by == "attester"
    and b.intent == b.latestIntent and not(b.retired.includes(attempt))
pure def signBinding(b: Binding, nonce: int, attempt: int, authority: int, by: str): Binding =
  { ...b, phase: BindingPending, nonce: nonce, bindingAttempt: attempt, signedAuthority: authority }
pure val byValues = Set("account", "attester", "wrong")
pure val destinationValues = Set("attester", "wrong")
pure val dataValues = Set("", "payload")
```

### Cancellation of an obsolete intent uses the same nonce and an empty zero-value self-transfer

The owner decision of 25 October 2026 lets the attester cancel its own
obsolete pending binding transaction. The cancelled attempt remains retained
because its original transaction may still win. Missing evidence is not
cancellation proof.

```quint
pure def canCancelBinding(b: Binding, nonce: int, attempt: int, value: int, destination: str, data: str, by: str): bool =
  b.phase == BindingPending and b.latestIntent > b.intent and by == "attester" and b.signedAuthority == b.authority
    and nonce == b.nonce and attempt > 0 and attempt != b.bindingAttempt
    and value == 0 and destination == "attester" and data == ""
pure def cancelBinding(b: Binding, nonce: int, attempt: int, value: int, destination: str, data: str, by: str): Binding =
  { ...b, phase: CancellationPending, cancellationAttempt: attempt }
pure def canFinalizeBinding(b: Binding, attempt: int, height: int): bool =
  (b.phase == BindingPending or b.phase == CancellationPending) and height > 0 and attempt == b.bindingAttempt
pure def finalizeBinding(b: Binding, attempt: int, height: int): Binding =
  { ...b, phase: Bound, canonical: attempt, finalizedHeight: height }
pure def canFinalizeCancellation(b: Binding, attempt: int, height: int): bool =
  b.phase == CancellationPending and height > 0 and attempt == b.cancellationAttempt
pure def finalizeCancellation(b: Binding, attempt: int, height: int): Binding =
  { ...b, phase: Cancelled, canonical: attempt, finalizedHeight: height }
```

### A bind transaction retires only after its revert is finalized at the canonical block

A Base bind transaction signed by a rotated-out authority, or with a stale
expected version, reverts on chain. The journal retires it only from a
finalized reverted receipt whose block is the canonical block, and keeps the
retired attempt identity so it is never reused. Pending or ambiguous results
remain held. A fresh intent may then authorize a new binding.

```quint
pure def canRetireReverted(b: Binding, receipt: FinalizedOutcome): bool =
  b.phase == BindingPending and receipt.attempt == b.bindingAttempt and receipt.reverted
    and receipt.block > 0 and receipt.block == receipt.canonicalBlock
pure def retireReverted(b: Binding, receipt: FinalizedOutcome): Binding =
  { ...b, phase: Retired, retired: b.retired.append(b.bindingAttempt), finalizedHeight: receipt.block }
```

### Both possible winners stay retained

```quint
pure def alwaysCanonicalRetained(b: Binding): bool = (b.phase == Bound or b.phase == Cancelled) implies
  b.finalizedHeight > 0 and (b.canonical == b.bindingAttempt or b.canonical == b.cancellationAttempt)
pure def stepRetainSignedBinding(before: Binding, after: Binding): bool =
  (before.bindingAttempt > 0 and after.phase != Authorized) implies
    after.bindingAttempt == before.bindingAttempt and after.signedAuthority == before.signedAuthority
pure def stepRetiredRetained(before: Binding, after: Binding): bool = before.retired.every(a => after.retired.includes(a))
pure def stepIntentsGrow(before: Binding, after: Binding): bool = after.latestIntent >= before.latestIntent
  and after.intent >= before.intent and after.authority >= before.authority
pure def alwaysUnsignedHasNoAttempt(b: Binding): bool =
  (b.phase == Unbound or b.phase == Authorized) implies
    b.bindingAttempt == 0 and b.signedAuthority == 0 and b.cancellationAttempt == 0
pure def alwaysIntentKnown(b: Binding): bool = b.intent <= b.latestIntent and (b.phase != Unbound implies b.intent > 0)
pure def sometimesOldBindingWins(b: Binding): bool = b.phase == Bound and b.cancellationAttempt > 0
pure def sometimesCancellationWins(b: Binding): bool = b.phase == Cancelled
pure def sometimesRetiredThenRebound(b: Binding): bool = b.phase == Bound and b.retired.length() > 0
```

## Story: Restrict every service operation

### Each service key permits only its named operations and none can pay, withdraw or upgrade

The identity attester binds, cancels its own obsolete binding transaction,
signs monthly roots and approves whole-reserve release. Each fee-wallet key
claims and converts fees and runs the buyback inside its own wallet. The
referral poster posts roots. Payments, withdrawals, deposits, release
submission and upgrades belong to the owner or to anyone the contract
permits, never to a Slop service key.

```quint
type Operation = Bind | CancelOwnBinding | MonthlyRoot | ReserveReleaseApproval | FeeClaim | FeeConversion
  | FeeReplacement | BuybackBridge | BuybackPurchase | BuybackBurn | ReferralRoot | Pay | Withdraw | Deposit
  | ReleaseSubmission | Upgrade | ManualAward
type Signer = IdentityAttester | FeeWallet | ReferralPoster | ProjectOwner | Anyone
pure def permittedOperation(signer: Signer, operation: Operation): bool =
  if (signer == IdentityAttester) operation == Bind or operation == CancelOwnBinding or operation == MonthlyRoot or operation == ReserveReleaseApproval
  else if (signer == FeeWallet) operation == FeeClaim or operation == FeeConversion or operation == FeeReplacement
    or operation == BuybackBridge or operation == BuybackPurchase or operation == BuybackBurn
  else if (signer == ReferralPoster) operation == ReferralRoot
  else if (signer == ProjectOwner) operation == Withdraw or operation == ReleaseSubmission or operation == Upgrade
    or operation == ManualAward or operation == Deposit or operation == Pay or operation == MonthlyRoot
  else operation == Deposit or operation == Pay or operation == MonthlyRoot or operation == FeeClaim
pure def serviceSigner(signer: Signer): bool = signer == IdentityAttester or signer == FeeWallet or signer == ReferralPoster
pure def moneyMovement(operation: Operation): bool =
  operation == Pay or operation == Withdraw or operation == Upgrade or operation == ManualAward or operation == ReleaseSubmission
pure def lawServiceKeysNeverMoveFunds(signer: Signer, operation: Operation): bool =
  (serviceSigner(signer) and moneyMovement(operation)) implies not(permittedOperation(signer, operation))
pure def lawOnlyAttesterSignsRoots(signer: Signer): bool =
  (serviceSigner(signer) and permittedOperation(signer, MonthlyRoot)) implies signer == IdentityAttester
pure val signerValues = Set(IdentityAttester, FeeWallet, ReferralPoster, ProjectOwner, Anyone)
pure val operationValues = Set(Bind, CancelOwnBinding, MonthlyRoot, ReserveReleaseApproval, FeeClaim, FeeConversion,
  FeeReplacement, BuybackBridge, BuybackPurchase, BuybackBurn, ReferralRoot, Pay, Withdraw, Deposit, ReleaseSubmission, Upgrade, ManualAward)
```

### A signer stack signs only for its own networks, and production signs only enabled mainnets as the attester

A test stack signs for registry test networks only. A production stack signs
for registry mainnets only, only while that network's mainnet execution flag
is on, and only as the identity attester: it refuses the relayer (pay) role.
The flags are reviewed configuration (`mainnet-execution.mjs`, changed only
through a reviewed pull request), not a product rule: the laws below hold for
every configuration. The reviewed configuration today activates only Base
mainnet (owner activation of 24 October 2026); a later reviewed activation
changes `reviewedActivation`, not these rules. A configuration naming a test
network activates nothing.

```quint
type Stack = TestStack | ProductionStack
type ServiceNetwork = BaseMainnet | EthereumMainnet | RobinhoodMainnet | SolanaMainnet | BaseSepolia | RobinhoodTestnet | EthereumSepolia | SolanaDevnet | SolanaTestnet
pure def mainnet(network: ServiceNetwork): bool =
  network == BaseMainnet or network == EthereumMainnet or network == RobinhoodMainnet or network == SolanaMainnet
pure val reviewedActivation: List[ServiceNetwork] = List(BaseMainnet)
pure def mainnetExecution(activation: List[ServiceNetwork], network: ServiceNetwork): bool = mainnet(network) and activation.includes(network)
pure def stackMaySign(activation: List[ServiceNetwork], stack: Stack, network: ServiceNetwork, operation: Operation): bool =
  if (stack == TestStack) not(mainnet(network)) and (permittedOperation(IdentityAttester, operation) or operation == Pay)
  else mainnet(network) and mainnetExecution(activation, network) and permittedOperation(IdentityAttester, operation)
pure def lawProductionNeverPays(activation: List[ServiceNetwork], network: ServiceNetwork): bool =
  not(stackMaySign(activation, ProductionStack, network, Pay))
pure def lawTestKeyNeverSignsMainnet(activation: List[ServiceNetwork], network: ServiceNetwork, operation: Operation): bool =
  mainnet(network) implies not(stackMaySign(activation, TestStack, network, operation))
pure def lawDisabledMainnetSignsNothing(activation: List[ServiceNetwork], network: ServiceNetwork, operation: Operation): bool =
  (mainnet(network) and not(mainnetExecution(activation, network))) implies not(stackMaySign(activation, ProductionStack, network, operation))
pure def lawProductionNeverSignsTestNetworks(activation: List[ServiceNetwork], network: ServiceNetwork, operation: Operation): bool =
  not(mainnet(network)) implies not(stackMaySign(activation, ProductionStack, network, operation))
pure val stackValues = Set(TestStack, ProductionStack)
pure val activationValues = Set(reviewedActivation, List(), List(BaseMainnet, SolanaMainnet), List(BaseSepolia))
pure val networkValues = Set(BaseMainnet, EthereumMainnet, RobinhoodMainnet, SolanaMainnet, BaseSepolia, RobinhoodTestnet, EthereumSepolia, SolanaDevnet, SolanaTestnet)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val attemptValues = Set(0, 1, 2, 3)
pure val authorityValues = Set(0, 1, 2)
pure val heightValues = Set(0, 1, 2)
pure val nonceValues = Set(0, 1, 2)
pure val valueValues = Set(0, 1, 2)
pure val intentValues = Set(1, 2, 3)
pure val signatureValues = Set({ wallet: "wallet", signer: "wallet", intent: 1 }, { wallet: "wallet", signer: "wallet", intent: 2 },
  { wallet: "wallet", signer: "other", intent: 1 }, { wallet: "wrong", signer: "wrong", intent: 1 })
pure val receiptValues = Set({ attempt: 1, reverted: true, block: 5, canonicalBlock: 5 }, { attempt: 1, reverted: true, block: 5, canonicalBlock: 6 },
  { attempt: 1, reverted: false, block: 5, canonicalBlock: 5 }, { attempt: 2, reverted: true, block: 5, canonicalBlock: 5 })
```
