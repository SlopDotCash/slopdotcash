# Wallet binding and replacement

This model covers PRD section 3 and the wallet-binding exception in section 6.
An instance is one account and wallet family. Wallet signatures, chain finality,
nonce ownership, and authenticated actor assertions are external observations
that the future shell must verify before dispatch. The model keeps uncertain
attempts and the active wallet independent.

## Story: Replace a payout wallet safely

The current wallet keeps serving the account while its successor is pending.
A replacement activates when both independent identity proofs are verified.

### A wallet binding retains its first proof and each attempted nonce

```quint
type BindingPhase = Idle | AwaitingSignature | Signed | Submitted | Uncertain | Confirmed | Cancelled
type WalletBinding = { actor: int, activeWallet: int, candidateWallet: int,
  phase: BindingPhase, nonce: int, usedNonces: List[int], firstProof: int,
  accountProof: bool, walletProof: bool, priorWallet: int, cancelledAttempt: bool }
pure val initial: WalletBinding = { actor: 1, activeWallet: 0, candidateWallet: 0,
  phase: Idle, nonce: 0, usedNonces: List(), firstProof: 0,
  accountProof: false, walletProof: false, priorWallet: 0, cancelledAttempt: false }
pure def alwaysWalletIds(b: WalletBinding): bool = b.activeWallet >= 0 and b.candidateWallet >= 0 and b.firstProof >= 0
```

### Only the authenticated account can begin an unused binding attempt

```quint
pure def canBegin(b: WalletBinding, by: int, wallet: int, nonce: int, accountVerified: bool): bool =
  by == b.actor and accountVerified and wallet > 0 and nonce > 0 and
  not(b.usedNonces.includes(nonce)) and
  (b.phase == Idle or b.phase == Confirmed or b.phase == Cancelled)
pure def begin(b: WalletBinding, by: int, wallet: int, nonce: int, accountVerified: bool): WalletBinding =
  { ...b, candidateWallet: wallet, nonce: nonce, phase: AwaitingSignature,
    usedNonces: b.usedNonces.append(nonce), accountProof: true, walletProof: false,
    priorWallet: b.activeWallet, cancelledAttempt: false }
pure def canAuthorizeWallet(b: WalletBinding, wallet: int, signatureVerified: bool): bool =
  b.phase == AwaitingSignature and wallet == b.candidateWallet and signatureVerified
pure def authorizeWallet(b: WalletBinding, wallet: int, signatureVerified: bool): WalletBinding =
  { ...b, walletProof: true, phase: Signed }
```

### Activation requires account and wallet proof for the exact candidate

There is zero award delay. First registration proof survives later replacement.

```quint
pure def canActivate(b: WalletBinding, proofId: int): bool =
  b.phase == Signed and b.accountProof and b.walletProof and proofId > 0
pure def activate(b: WalletBinding, proofId: int): WalletBinding =
  { ...b, activeWallet: b.candidateWallet, phase: Confirmed,
    firstProof: if (b.firstProof == 0) proofId else b.firstProof }
pure def alwaysActiveHasProof(b: WalletBinding): bool = b.activeWallet > 0 implies b.firstProof > 0
pure def alwaysUnsignedKeepsWallet(b: WalletBinding): bool =
  (b.phase == AwaitingSignature or b.phase == Signed or b.phase == Submitted or b.phase == Uncertain) implies
  b.activeWallet == b.priorWallet
```

### An uncertain broadcast keeps both signed attempts until one finalizes

An obsolete EVM binding may be cancelled only by the scoped same-nonce,
zero-value self-transfer with empty data. Either retained attempt may win.
Cancellation requests and absent receipts never prove cancellation.

```quint
pure def canSubmit(b: WalletBinding): bool = b.phase == Signed
pure def submit(b: WalletBinding): WalletBinding = { ...b, phase: Submitted }
pure def canMarkUncertain(b: WalletBinding): bool = b.phase == Submitted
pure def markUncertain(b: WalletBinding): WalletBinding = { ...b, phase: Uncertain }
pure def canRequestCancel(b: WalletBinding, evm: bool, obsolete: bool, sameNonce: bool, selfTransfer: bool, zeroValue: bool, emptyData: bool): bool =
  (b.phase == Submitted or b.phase == Uncertain) and evm and obsolete and sameNonce and selfTransfer and zeroValue and emptyData
pure def requestCancel(b: WalletBinding, evm: bool, obsolete: bool, sameNonce: bool, selfTransfer: bool, zeroValue: bool, emptyData: bool): WalletBinding =
  { ...b, cancelledAttempt: true }
pure def canReconcile(b: WalletBinding, bindingWon: bool, exactFinalized: bool, proofId: int): bool =
  (b.phase == Submitted or b.phase == Uncertain) and exactFinalized and proofId > 0 and
  (bindingWon or b.cancelledAttempt)
pure def reconcile(b: WalletBinding, bindingWon: bool, exactFinalized: bool, proofId: int): WalletBinding =
  { ...b, phase: if (bindingWon) Confirmed else Cancelled,
    activeWallet: if (bindingWon) b.candidateWallet else b.priorWallet,
    firstProof: if (bindingWon and b.firstProof == 0) proofId else b.firstProof }
pure def stepFirstProofPersists(before: WalletBinding, after: WalletBinding): bool =
  before.firstProof > 0 implies before.firstProof == after.firstProof
pure def sometimesBound(b: WalletBinding): bool = b.phase == Confirmed and b.activeWallet > 0
pure def sometimesUncertain(b: WalletBinding): bool = b.phase == Uncertain
pure def sometimesCancelled(b: WalletBinding): bool = b.phase == Cancelled
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val byValues = Set(0, 1, 2)
pure val nonceValues = Set(0, 1, 2)
pure val proofIdValues = Set(0, 1, 2)
pure val walletValues = Set(0, 1, 2)
```
