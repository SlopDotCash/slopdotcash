# Received-fee conversion and native holds

PRD section 6 separates fee-wallet funds from contributor principal. Sources include `fee_conversion`, `fee_value_caps`, `fee_lease_journal`, `fee_quote_policy`, `native_budget`, `fee_wallet_handoff`, `solana_route` and `solana_expiry`. Values use integer USDC micro-units and native budget units. EVM native budgets are integer gwei and Solana native budgets are lamports. The adapter reserves any fractional gwei upward before this comparison. Actual token amounts remain exact asset-specific values at the adapter boundary. Price conversion observations are explicitly trusted inputs until the quote and receipt adapter is implemented and qualified.

## Story: Convert received fees within limits

### Each network has a fixed transaction and UTC-day native ceiling

Solana order creation uses the separate buyback ceiling. It does not consume this conversion allowance in place of its own allowance.

```quint
type Network = Base | Ethereum | Robinhood | Solana
pure def transactionCeiling(network: Network): int =
  if (network == Base) 100000 else if (network == Ethereum) 1000000
  else if (network == Robinhood) 200000 else 5000000
pure def dailyCeiling(network: Network): int =
  if (network == Base) 1000000 else if (network == Ethereum) 10000000
  else if (network == Robinhood) 2000000 else 20000000
```

### A fee attempt starts from a finalized fee receipt

```quint
type FeePhase = Empty | Received | Reserved | Signed | Pending | Uncertain | Converted | Retained | Failed
 type FeeConversion = { expiryObservations: List[ExpiryObservation], receivedReceipts: List[int], finalizedReceipts: List[int], attempts: List[int],
  minimumOutput: int, outputAmount: int, phase: FeePhase, network: Network, wallet: str, asset: str,
  value: int, spentValue: int, nativeHold: int, nativeSpent: int, quoteNative: int,
  gasValue: int, slippageBps: int, impactBps: int, outputWallet: str,
  receipt: int, attempt: int, day: int, releaseEnabled: bool, route: str }
pure val initial: FeeConversion = { expiryObservations: List(), receivedReceipts: List(), finalizedReceipts: List(), attempts: List(),
  minimumOutput: 0, outputAmount: 0, phase: Empty, network: Base, wallet: "fees", asset: "token",
  value: 0, spentValue: 0, nativeHold: 0, nativeSpent: 0, quoteNative: 0,
  gasValue: 0, slippageBps: 0, impactBps: 0, outputWallet: "", receipt: 0,
  attempt: 0, day: 1, releaseEnabled: false, route: "" }
pure def canChooseNetwork(f: FeeConversion, network: Network): bool = f.phase == Empty and f.receivedReceipts.length() == 0
pure def chooseNetwork(f: FeeConversion, network: Network): FeeConversion = { ...f, network: network }
pure val valueValues = Set(5000000, 25000000, 1000000000)
pure val nativeCostValues = Set(50000, 1000000, 100000)
pure def canReceive(f: FeeConversion, receipt: int, value: int, asset: str, finalized: bool): bool =
  f.phase == Empty and receipt > 0 and not(f.receivedReceipts.includes(receipt))
    and value > 0 and asset != "" and finalized
pure def receive(f: FeeConversion, receipt: int, value: int, asset: str, finalized: bool): FeeConversion =
  { ...f, phase: Received, receipt: receipt, value: value, asset: asset, receivedReceipts: f.receivedReceipts.append(receipt) }
pure def canEnableRelease(f: FeeConversion, by: str): bool = f.phase == Received and by == "owner"
pure def enableRelease(f: FeeConversion, by: str): FeeConversion = { ...f, releaseEnabled: true }
pure val byValues = Set("owner", "wrong")
pure val assetValues = Set("token", "USDC", "")
pure val minimumOutputValues = Set(1, 5)
pure val outputValues = Set(0, 1, 5, 6)
pure val walletValues = Set("fees", "wrong")
pure val outputWalletValues = Set("fees", "wrong")
pure val routeValues = Set("inspectedAllowlist", "unchecked")
```

### Only allowlisted same-wallet quotes reserve value and gas

The quote binds every instruction, token program, lookup table, signer and account. Unresolved lookup tables or unsupported Token-2022 extensions are rejected by the later adapter. Route identifiers here denote those completely inspected route records.

```quint
pure def canReserve(f: FeeConversion, gasValue: int, nativeCost: int, slippageBps: int,
  impactBps: int, outputWallet: str, route: str, minimumOutput: int): bool = f.phase == Received and f.releaseEnabled
    and f.network != Robinhood and f.value >= 5000000 and gasValue >= 0 and f.value >= gasValue * 10
    and f.value <= 1000000000 and f.spentValue + f.value <= 5000000000
    and nativeCost > 0 and nativeCost <= transactionCeiling(f.network)
    and f.nativeSpent + f.nativeHold + nativeCost <= dailyCeiling(f.network)
    and slippageBps >= 0 and slippageBps <= 100 and impactBps >= 0 and impactBps <= 200
    and outputWallet == f.wallet and route == "inspectedAllowlist" and minimumOutput > 0
pure def reserve(f: FeeConversion, gasValue: int, nativeCost: int, slippageBps: int,
  impactBps: int, outputWallet: str, route: str, minimumOutput: int): FeeConversion =
  { ...f, phase: Reserved, gasValue: gasValue, quoteNative: nativeCost, nativeHold: nativeCost,
    slippageBps: slippageBps, impactBps: impactBps, outputWallet: outputWallet, route: route, minimumOutput: minimumOutput }
pure def canSign(f: FeeConversion, attempt: int): bool = f.phase == Reserved and attempt > 0 and not(f.attempts.includes(attempt))
pure def sign(f: FeeConversion, attempt: int): FeeConversion = { ...f, phase: Signed, attempt: attempt, attempts: f.attempts.append(attempt) }
pure def canBroadcast(f: FeeConversion): bool = f.phase == Signed
pure def broadcast(f: FeeConversion): FeeConversion = { ...f, phase: Pending }
pure def canLoseObservation(f: FeeConversion): bool = f.phase == Pending
pure def loseObservation(f: FeeConversion): FeeConversion = { ...f, phase: Uncertain }
pure def canRetain(f: FeeConversion): bool = f.phase == Received and f.network == Robinhood
pure def retain(f: FeeConversion): FeeConversion = { ...f, phase: Retained }
```

### Only a matching finalized receipt consumes a native hold

Missing receipts and uncertain broadcasts keep their reservations. A failure receipt consumes its actual native fee while preserving the token fee balance. Daily rollover cannot discard an unresolved hold.

```quint
pure def canConfirm(f: FeeConversion, attempt: int, receipt: int, wallet: str, asset: str,
  output: int, actualNative: int, finalized: bool, succeeded: bool): bool =
  (f.phase == Pending or f.phase == Uncertain) and attempt == f.attempt and wallet == f.wallet
    and receipt > 0 and not(f.finalizedReceipts.includes(receipt)) and asset == "USDC"
    and output >= f.minimumOutput and actualNative >= 0 and actualNative <= f.nativeHold and finalized and succeeded
pure def confirm(f: FeeConversion, attempt: int, receipt: int, wallet: str, asset: str,
  output: int, actualNative: int, finalized: bool, succeeded: bool): FeeConversion =
  { ...f, phase: Converted, nativeSpent: f.nativeSpent + actualNative, nativeHold: 0,
    spentValue: f.spentValue + f.value, outputAmount: output,
    finalizedReceipts: f.finalizedReceipts.append(receipt) }
pure def canConfirmFailure(f: FeeConversion, attempt: int, receipt: int, actualNative: int, finalized: bool, succeeded: bool): bool =
  (f.phase == Pending or f.phase == Uncertain) and attempt == f.attempt
    and receipt > 0 and not(f.finalizedReceipts.includes(receipt)) and not(succeeded)
    and actualNative >= 0 and actualNative <= f.nativeHold and finalized
pure def confirmFailure(f: FeeConversion, attempt: int, receipt: int, actualNative: int, finalized: bool, succeeded: bool): FeeConversion =
  { ...f, phase: Failed, nativeSpent: f.nativeSpent + actualNative, nativeHold: 0,
    finalizedReceipts: f.finalizedReceipts.append(receipt) }
pure def alwaysNativeBounded(f: FeeConversion): bool = f.nativeSpent >= 0 and f.nativeHold >= 0
  and f.nativeSpent + f.nativeHold <= dailyCeiling(f.network)
pure def alwaysValueBounded(f: FeeConversion): bool = f.spentValue >= 0 and f.spentValue <= 5000000000
pure def alwaysOutputOwned(f: FeeConversion): bool =
  (f.phase == Reserved or f.phase == Signed or f.phase == Pending or f.phase == Uncertain or f.phase == Converted)
    implies f.outputWallet == f.wallet and f.route == "inspectedAllowlist"
pure def alwaysPendingHeld(f: FeeConversion): bool = (f.phase == Pending or f.phase == Uncertain) implies f.nativeHold > 0
pure def sometimesConverted(f: FeeConversion): bool = f.phase == Converted
pure def sometimesUncertain(f: FeeConversion): bool = f.phase == Uncertain
pure def sometimesFailed(f: FeeConversion): bool = f.phase == Failed
```

## Story: Resolve expired Solana sends conservatively

### Both independent history providers must prove expiry and absence

The signed blockhash's slot must remain inside both retained histories. Provider disagreement or missing history keeps the hold. This predicate authorizes the separate expiry transition after complete receipt records are retained.

```quint
pure def mayReleaseExpiredHold(providerA: str, providerB: str, signedSlot: int,
  firstA: int, firstB: int, finalizedA: int, finalizedB: int,
  invalidA: bool, invalidB: bool, signatureA: bool, signatureB: bool,
  transactionA: bool, transactionB: bool): bool =
  providerA != "" and providerB != "" and providerA != providerB and signedSlot > 0
    and firstA <= signedSlot and firstB <= signedSlot
    and finalizedA >= signedSlot and finalizedB >= signedSlot
    and invalidA and invalidB and not(signatureA) and not(signatureB)
    and not(transactionA) and not(transactionB)
```

## Story: Replace only an unmined underpriced EVM attempt

### Replacement preserves nonce and transaction content and bounds the fee increase

The activation record is independent of source approval. Content includes destination, value, data, chain and gas limit. Both attempts remain in the durable journal. The maximum is three times the original fee. The next fee advances by no more than a rounded-up quarter of the current fee, with a one-unit minimum step. Every replacement reserves native budget before signing.

```quint
pure def mayReplaceEvm(originalNonce: int, replacementNonce: int, originalContent: str,
  replacementContent: str, originalFee: int, currentFee: int, replacementFee: int,
  networkFee: int, unmined: bool, activated: bool): bool =
  activated and unmined and originalNonce == replacementNonce and originalContent == replacementContent
    and originalFee > 0 and currentFee >= originalFee and currentFee < networkFee
    and replacementFee > currentFee and replacementFee <= originalFee * 3
    and replacementFee <= currentFee + currentFee / 4 + 1
```

## Story: Claim only accrued fees from reviewed vaults

### A claim can only deliver the accrued amount to the configured fee wallet

Permissionless claims confer no owner or withdrawal role. Wrong deployment bytes, fee recipient, asset, network or unknown current state refuse the claim. Claim gas consumes the same daily native budget as conversion and replacement. Sweeps are executed by the owner outside the Worker and do not enter this signer state machine.

```quint
pure def claimAdmitted(vault: str, expectedVault: str, deployment: str, expectedDeployment: str,
  recipient: str, feeWallet: str, amount: int, accrued: int, asset: str, expectedAsset: str,
  networkId: str, expectedNetwork: str): bool =
  vault == expectedVault and deployment == expectedDeployment and recipient == feeWallet
    and amount > 0 and amount <= accrued and asset == expectedAsset and networkId == expectedNetwork
```

## Story: Continue after a terminal attempt without discarding uncertainty

### Retrying a failed conversion preserves the received fee and spent gas

A failed receipt consumes only the proven native fee. A new signed attempt receives a fresh durable identifier. An unresolved attempt cannot take the retry or next-receipt transition.

```quint
pure def canRetry(f: FeeConversion): bool = f.phase == Failed and f.nativeHold == 0
pure def retry(f: FeeConversion): FeeConversion = { ...f, phase: Received, attempt: 0 }
pure def canNextReceipt(f: FeeConversion): bool =
  (f.phase == Converted or f.phase == Retained) and f.nativeHold == 0
pure def nextReceipt(f: FeeConversion): FeeConversion =
  { ...f, phase: Empty, receipt: 0, attempt: 0, value: 0, outputAmount: 0, minimumOutput: 0 }
pure def canObserveDay(f: FeeConversion, day: int): bool = day > f.day
pure def observeDay(f: FeeConversion, day: int): FeeConversion =
  { ...f, day: day, nativeSpent: 0, spentValue: 0 }
pure def stepUncertainHolds(before: FeeConversion, after: FeeConversion): bool =
  (before.phase == Uncertain and after.phase == Uncertain) implies after.nativeHold == before.nativeHold
pure def alwaysConvertedReceipt(f: FeeConversion): bool = f.phase == Converted implies
  f.finalizedReceipts.length() > 0 and f.outputAmount >= f.minimumOutput
```

The shell supplies a monotonically increasing UTC day. A day change carries every unresolved native hold forward conservatively. The signed attempt's original-day spend remains in the durable journal. The adapter must reconcile both original-day and current-day limits before releasing that conservative hold.

## Story: Retire an expired Solana attempt only from two retained observations

### Expiry proof releases only the pending native hold and keeps the attempt history

The expiry observations are retained with the state and the durable journal. Neither an RPC error nor absence from a short-history provider can satisfy this transition.

```quint
type ExpiryObservation = { providerA: str, providerB: str, signedSlot: int,
  firstA: int, firstB: int, finalizedA: int, finalizedB: int,
  invalidA: bool, invalidB: bool, signatureA: bool, signatureB: bool,
  transactionA: bool, transactionB: bool }
pure def expiryProvesAbsence(observation: ExpiryObservation): bool =
  mayReleaseExpiredHold(observation.providerA, observation.providerB, observation.signedSlot,
    observation.firstA, observation.firstB, observation.finalizedA, observation.finalizedB,
    observation.invalidA, observation.invalidB, observation.signatureA, observation.signatureB,
    observation.transactionA, observation.transactionB)
pure val observationValues = Set(
  { providerA: "a", providerB: "b", signedSlot: 2, firstA: 1, firstB: 1, finalizedA: 3, finalizedB: 3,
    invalidA: true, invalidB: true, signatureA: false, signatureB: false, transactionA: false, transactionB: false },
  { providerA: "a", providerB: "a", signedSlot: 2, firstA: 1, firstB: 1, finalizedA: 3, finalizedB: 3,
    invalidA: true, invalidB: true, signatureA: false, signatureB: false, transactionA: false, transactionB: false })
pure def canExpire(f: FeeConversion, observation: ExpiryObservation): bool =
  f.phase == Uncertain and f.network == Solana and expiryProvesAbsence(observation)
pure def expire(f: FeeConversion, observation: ExpiryObservation): FeeConversion =
  { ...f, phase: Failed, nativeHold: 0, expiryObservations: f.expiryObservations.append(observation) }
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val accruedValues = Set(0, 1, 2)
pure val actualNativeValues = Set(0, 50000)
pure val amountValues = Set(0, 1, 2)
pure val attemptValues = Set(0, 1, 2)
pure val currentFeeValues = Set(0, 1, 2)
pure val dayValues = Set(1, 2)
pure val deploymentValues = Set("", "a", "b")
pure val expectedAssetValues = Set("", "a", "b")
pure val expectedDeploymentValues = Set("", "a", "b")
pure val expectedNetworkValues = Set("", "a", "b")
pure val expectedVaultValues = Set("", "a", "b")
pure val feeWalletValues = Set("", "a", "b")
pure val finalizedAValues = Set(0, 1, 2)
pure val finalizedBValues = Set(0, 1, 2)
pure val firstAValues = Set(0, 1, 2)
pure val firstBValues = Set(0, 1, 2)
pure val gasValueValues = Set(0, 500000)
pure val impactBpsValues = Set(0, 200, 201)
pure val networkIdValues = Set("", "a", "b")
pure val networkFeeValues = Set(0, 1, 2)
pure val originalContentValues = Set("", "a", "b")
pure val originalFeeValues = Set(0, 1, 2)
pure val originalNonceValues = Set(0, 1, 2)
pure val providerAValues = Set("", "a", "b")
pure val providerBValues = Set("", "a", "b")
pure val receiptValues = Set(0, 1, 2)
pure val recipientValues = Set("", "a", "b")
pure val replacementContentValues = Set("", "a", "b")
pure val replacementFeeValues = Set(0, 1, 2)
pure val replacementNonceValues = Set(0, 1, 2)
pure val signedSlotValues = Set(0, 1, 2)
pure val slippageBpsValues = Set(0, 100, 101)
pure val vaultValues = Set("", "a", "b")
```
