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
  canonical: int, finalizedHeight: int, retired: List[int], consentExpiry: int, finalizedTime: int }
pure val initial: Binding = { phase: Unbound, actor: 1, wallet: "wallet", authority: 1, intent: 0, latestIntent: 0,
  signedAuthority: 0, nonce: 0, bindingAttempt: 0, cancellationAttempt: 0,
  canonical: 0, finalizedHeight: 0, retired: List(), consentExpiry: 0, finalizedTime: 0 }
pure def canRecordIntent(b: Binding, intent: int, by: str): bool = by == "account" and intent > b.latestIntent
pure def recordIntent(b: Binding, intent: int, by: str): Binding = { ...b, latestIntent: intent }
pure def canAuthorize(b: Binding, actor: int, signature: WalletSignature, expiresAt: int, by: str): bool =
  (b.phase == Unbound or b.phase == Retired) and actor == b.actor and signature.wallet == b.wallet
    and signature.signer == signature.wallet and signature.intent == b.latestIntent and signature.intent > b.intent and by == "account"
pure def authorize(b: Binding, actor: int, signature: WalletSignature, expiresAt: int, by: str): Binding =
  { ...b, phase: Authorized, intent: signature.intent, bindingAttempt: 0, cancellationAttempt: 0, signedAuthority: 0,
    consentExpiry: expiresAt }
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
pure val byValues = Set("account", "attester", "operator", "wrong")
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
  b.phase == BindingPending and obsoleteBinding(b) and by == "attester" and b.signedAuthority == b.authority
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

### A pending binding is obsolete only when a newer intent or a successor claim replaced it, or finalized chain time passed its consent expiry

The account's newer intent stands for a successor wallet claim. The consent
expiry is the `expiresAt` the wallet signed, passed to `authorize` beside the
signature; the contract refuses the binding
after it, so the pending transaction can no longer bind. Only a finalized
block's timestamp later than that expiry proves it; a latest or confirmed
block time, or missing evidence, does not. The finalized time is reported
only by the attester's finalized-block reader, the named source of that
evidence; no other sender can advance it. This widens when the attester may
cancel compared with the earlier newer-intent-only guard, and is listed for
the owner at acceptance as a loosened guard. Development
`workers/payment-executor/core.ts` (`cancelObsoleteStoredBinding`, reasons
`superseded` and `expired`); owner decision of 25 October 2026.

```quint
pure def canObserveFinalizedTime(b: Binding, time: int, by: str): bool = by == "attester" and time > b.finalizedTime
pure def observeFinalizedTime(b: Binding, time: int, by: str): Binding = { ...b, finalizedTime: time }
pure def obsoleteBinding(b: Binding): bool = b.latestIntent > b.intent or (b.consentExpiry > 0 and b.finalizedTime > b.consentExpiry)
pure def sometimesExpiredBindingCancelled(b: Binding): bool = b.phase == Cancelled and b.latestIntent == b.intent
pure val timeValues = Set(4, 6)
```

### An operator reconciles an externally recovered binding winner only through an audited request that cannot choose the outcome

An operator (the role named in the reviewed configuration snapshot) may ask
the attester to reconcile a pending binding whose winner was settled outside
this journal. The request names the original transaction and the claimed
winner, carries a reason of 8 to 500 characters and its scope, and is written
to the audit log before the attester is called. The outcome comes only from
finalized canonical evidence, never from the request: the original
transaction's own receipt is authoritative whenever it exists, binding on
success and retiring the attempt on revert. Otherwise only a finalized
type-2 self-transfer from the identity signer at the original nonce, with
zero value, empty data and access list and exactly 21,000 gas supplied and
used, can win, and it records the binding as cancelled. A missing or pending
receipt changes nothing. Development `workers/payment-executor/binding-recovery.ts`
(`reconcileBindingWinner`) and the Pages route
`POST /api/v1/operator/wallet-bindings/reconcile`.

```quint
type ReconcileRequest = { original: int, winner: int, reasonLength: int, audited: bool }
type WinnerEvidence = { transaction: int, originalReceiptFound: bool, succeeded: bool, sender: str, recipient: str, nonce: int,
  value: int, emptyData: bool, emptyAccessList: bool, gasLimit: int, gasUsed: int, block: int, canonicalBlock: int, finalized: bool }
pure def inertSelfTransfer(b: Binding, evidence: WinnerEvidence): bool =
  not(evidence.originalReceiptFound) and evidence.succeeded and evidence.transaction > 0
    and evidence.transaction != b.bindingAttempt and not(b.retired.includes(evidence.transaction))
    and evidence.sender == "attester" and evidence.recipient == "attester" and evidence.nonce == b.nonce
    and evidence.value == 0 and evidence.emptyData and evidence.emptyAccessList
    and evidence.gasLimit == 21000 and evidence.gasUsed == 21000
pure def canReconcileWinner(b: Binding, request: ReconcileRequest, evidence: WinnerEvidence, by: str): bool =
  (b.phase == BindingPending or b.phase == CancellationPending) and by == "operator"
    and request.audited and request.reasonLength >= 8 and request.reasonLength <= 500
    and request.original == b.bindingAttempt and request.winner > 0
    and evidence.finalized and evidence.block > 0 and evidence.block == evidence.canonicalBlock
    and (if (evidence.originalReceiptFound) evidence.transaction == b.bindingAttempt
      else request.winner == evidence.transaction and inertSelfTransfer(b, evidence))
pure def reconcileWinner(b: Binding, request: ReconcileRequest, evidence: WinnerEvidence, by: str): Binding =
  if (evidence.originalReceiptFound and evidence.succeeded)
    { ...b, phase: Bound, canonical: b.bindingAttempt, finalizedHeight: evidence.block }
  else if (evidence.originalReceiptFound)
    { ...b, phase: Retired, retired: b.retired.append(b.bindingAttempt), finalizedHeight: evidence.block }
  else { ...b, phase: Cancelled, cancellationAttempt: evidence.transaction, canonical: evidence.transaction, finalizedHeight: evidence.block }
pure def sometimesExternalWinnerReconciled(b: Binding): bool = b.phase == Cancelled and b.canonical != b.bindingAttempt
  and b.retired.length() == 0 and b.cancellationAttempt == 3
pure val requestValues = Set({ original: 1, winner: 3, reasonLength: 20, audited: true }, { original: 1, winner: 1, reasonLength: 20, audited: true },
  { original: 1, winner: 3, reasonLength: 20, audited: false }, { original: 1, winner: 3, reasonLength: 7, audited: true })
pure val winnerSample: WinnerEvidence = { transaction: 3, originalReceiptFound: false, succeeded: true, sender: "attester", recipient: "attester",
  nonce: 0, value: 0, emptyData: true, emptyAccessList: true, gasLimit: 21000, gasUsed: 21000, block: 7, canonicalBlock: 7, finalized: true }
pure val evidenceValues = Set(winnerSample, { ...winnerSample, gasUsed: 20999 }, { ...winnerSample, finalized: false },
  { ...winnerSample, transaction: 1, originalReceiptFound: true }, { ...winnerSample, transaction: 1, originalReceiptFound: true, succeeded: false },
  { ...winnerSample, nonce: 1 })
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

### Every attester EVM transaction stays under its deployment gas ceiling, a 10 gwei fee cap and its frozen native-cost cap

Owner decision of 25 October 2026 ("the existing gas limits"). The reviewed
deployment's gas ceiling is a whole number of 1 to 10 digits; the registry
gives Base 500,000, Ethereum 500,000, Ethereum Sepolia 1,000,000 and
Robinhood Chain 2,000,000. The maximum fee per gas is at most 10 gwei and
the priority fee never exceeds it. The worst-case native cost, gas times
maximum fee plus value, must fit both the deployment's current native-cost
limit and the limit frozen with the attempt before its first signature,
when either is set; finalized history is judged only by the limit frozen
with it. Costs use exact amounts because they exceed the safe-integer range.
Development `workers/payment-executor/binding-shared.ts`
(`selectReviewedEvmDeployment`, `assertEvmNativeCost`) and
`src/lib/escrow-policy.mjs`.

```quint
import money as M from "./money"
type AttesterTransaction = { gas: int, maxFee: int, priorityFee: int, value: int }
pure val attesterFeeCap = 10000000000
pure def reviewedGasCeiling(network: ServiceNetwork): int =
  if (network == BaseMainnet or network == BaseSepolia or network == EthereumMainnet) 500000
  else if (network == EthereumSepolia) 1000000
  else if (network == RobinhoodMainnet or network == RobinhoodTestnet) 2000000 else 0
pure def gasCeilingValid(gasCeiling: int): bool = gasCeiling >= 1 and gasCeiling <= 9999999999
pure def nativeCost(t: AttesterTransaction): M::Amount =
  M::addAmounts(M::multiplyAmounts(M::smallAmount(t.gas), M::smallAmount(t.maxFee)), M::smallAmount(t.value))
pure def attesterTransactionAllowed(t: AttesterTransaction, gasCeiling: int, nativeCaps: List[M::Amount]): bool =
  gasCeilingValid(gasCeiling) and t.gas > 0 and t.gas <= gasCeiling and t.maxFee > 0 and t.maxFee <= attesterFeeCap
    and t.priorityFee >= 0 and t.priorityFee <= t.maxFee and t.value >= 0
    and nativeCaps.every(cap => M::validAmount(cap) and M::positiveAmount(cap) and M::compareAmounts(nativeCost(t), cap) <= 0)
```

### A cancellation is one 21,000-gas transaction whose fee rises by at least one eighth and stays under 10 gwei

The attester sends at most one cancellation for a pending binding: an
underpriced cancellation stays held and never creates another competitor.
Each fee field rises by one eighth, rounded up, over the original's; the
priority fee is at least 0.001 gwei, and the maximum fee is the larger of
that bump and twice the latest base fee plus the priority fee. The result
must stay at or below 10 gwei with the priority fee at or below the maximum
fee, the 21,000 gas must fit the deployment's gas ceiling, and the native
cost must fit the same frozen caps as any attester transaction. Development
`workers/payment-executor/core.ts` (`cancelObsoleteStoredBinding`).

```quint
type CancellationFees = { allowed: bool, cancelMaxFee: int, cancelPriorityFee: int }
pure val cancellationGas = 21000
pure val minimumCancelPriority = 1000000
pure def eighthBump(fee: int): int = (fee * 9 + 7) / 8
pure def cancellationFees(originalMax: int, originalPriority: int, baseFee: int, gasCeiling: int): CancellationFees =
  val priority = if (eighthBump(originalPriority) > minimumCancelPriority) eighthBump(originalPriority) else minimumCancelPriority
  val quote = baseFee * 2 + priority
  val maxFee = if (quote > eighthBump(originalMax)) quote else eighthBump(originalMax)
  if (originalMax <= 0 or originalPriority < 0 or baseFee < 0 or not(gasCeilingValid(gasCeiling))
    or cancellationGas > gasCeiling or maxFee > attesterFeeCap or priority > maxFee)
    { allowed: false, cancelMaxFee: 0, cancelPriorityFee: 0 }
  else { allowed: true, cancelMaxFee: maxFee, cancelPriorityFee: priority }
pure def lawCancellationRisesAndStaysCapped(originalMax: int, originalPriority: int, baseFee: int, gasCeiling: int): bool =
  val fees = cancellationFees(originalMax, originalPriority, baseFee, gasCeiling)
  fees.allowed implies fees.cancelMaxFee * 8 >= originalMax * 9 and fees.cancelPriorityFee * 8 >= originalPriority * 9
    and fees.cancelMaxFee <= attesterFeeCap and fees.cancelPriorityFee <= fees.cancelMaxFee
pure val originalMaxValues = Set(1, 1000000000, 9000000000)
pure val originalPriorityValues = Set(0, 1000000, 2000000000)
pure val baseFeeValues = Set(0, 1000000000, 6000000000)
pure val gasCeilingValues = Set(20000, 500000)
```

### One binding consent spends at most one nonce per vault and actor

When the deployment limits a consent to one nonce, the first signature of a
binding reserves that consent's nonce budget for its vault and actor in the
same journal transaction that stores the signed bytes. A later attempt for
the same consent, vault and actor must match the reserved nonce, transaction
and native-cost ceiling exactly; any other second signature is refused. The
reservation reads at most 1,000 retained binding records and refuses when the
history reaches that bound, so the check never runs on an incomplete history.
A retained admission stays authoritative even if a later deployment turns
the limit off. Development `workers/payment-executor/core.ts`
(`reserveBindingConsentBudget`) and `binding-shared.ts`
(`assertBindingConsentBudget`).

```quint
type ConsentBudget = { vault: str, actor: int, consent: str, nonce: int, transaction: str }
pure val consentHistoryBound = 1000
pure def sameConsent(left: ConsentBudget, right: ConsentBudget): bool =
  left.vault == right.vault and left.actor == right.actor and left.consent == right.consent
pure def consentNonceReservable(history: List[ConsentBudget], budget: ConsentBudget): bool =
  history.length() < consentHistoryBound and budget.vault != "" and budget.actor > 0 and budget.consent != ""
    and budget.nonce >= 0 and budget.transaction != "" and not(history.some(old => sameConsent(old, budget)))
pure def consentBudgetMatches(history: List[ConsentBudget], budget: ConsentBudget): bool = history.includes(budget)
pure def lawConsentReservedOnce(history: List[ConsentBudget], budget: ConsentBudget): bool =
  consentNonceReservable(history, budget) implies not(history.some(old => sameConsent(old, budget)))
pure val consentSample: ConsentBudget = { vault: "vault", actor: 1, consent: "consent", nonce: 0, transaction: "0xsigned" }
pure val historyValues = Set(List(), List(consentSample), List({ ...consentSample, actor: 2 }),
  List({ ...consentSample, nonce: 1, transaction: "0xother" }))
pure val budgetValues = Set(consentSample, { ...consentSample, nonce: 1, transaction: "0xother" },
  { ...consentSample, actor: 2 }, { ...consentSample, vault: "" })
```

### Each attester run tries at most ten bindings, least recently checked first, then by first reserved obligation, actor and claim

Every pending stored binding is reconciled first, without limit. Then the
run takes the candidates of each pinned vault: an actor with a reserved
obligation, a current signed wallet claim and an unexpired stored consent,
keyed by the time of the actor's first reserved obligation, the actor and
the claim. It orders them by the time each was last checked, oldest first
and never-checked first, keeping that key order among equals, and tries at
most ten, stamping each as checked before trying it. One candidate's failure
never stops the others. Development `workers/payment-executor/core.ts`
(`bindingCandidates`, `runStoredBindings` with `perRun = 10`).

```quint
type BindingCandidate = { lastChecked: int, firstObligationAt: int, actor: int, claim: int }
type CandidateOrder = { position: int, ordered: bool }
pure val bindingsPerRun = 10
pure def candidateBefore(left: BindingCandidate, right: BindingCandidate): bool =
  left.lastChecked < right.lastChecked or (left.lastChecked == right.lastChecked and
    (left.firstObligationAt < right.firstObligationAt or (left.firstObligationAt == right.firstObligationAt and
      (left.actor < right.actor or (left.actor == right.actor and left.claim < right.claim)))))
pure def orderedCandidates(batch: List[BindingCandidate]): bool =
  batch.foldl({ position: 0, ordered: true }, (acc, c) => { position: acc.position + 1,
    ordered: acc.ordered and (acc.position == 0 or candidateBefore(batch.nthOr(acc.position - 1, c), c)) }).ordered
pure def validRunBatch(candidates: List[BindingCandidate], batch: List[BindingCandidate]): bool =
  val expected = if (candidates.length() < bindingsPerRun) candidates.length() else bindingsPerRun
  batch.length() == expected and orderedCandidates(batch) and batch.every(c => candidates.includes(c))
    and candidates.every(c => batch.includes(c) or batch.every(chosen => candidateBefore(chosen, c)))
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
pure val expiresAtValues = Set(0, 5)
pure val receiptValues = Set({ attempt: 1, reverted: true, block: 5, canonicalBlock: 5 }, { attempt: 1, reverted: true, block: 5, canonicalBlock: 6 },
  { attempt: 1, reverted: false, block: 5, canonicalBlock: 5 }, { attempt: 2, reverted: true, block: 5, canonicalBlock: 5 })
```
