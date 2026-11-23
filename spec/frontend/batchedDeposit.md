# Atomic wallet deposit requests

PRD sections 6 and 12 require exact deposit evidence before credit. The
legacy `ui_vault_batched_deposit` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` covers the atomic approval and
ERC-20 deposit request in `src/VaultActions.tsx` and
`src/lib/evm-vault-actions.ts`. The shell validates capability, binds the
wallet request to the original authorized intent and interprets expected
same-wallet chain events. This state is a wallet request projection. It
does not own the registered vault balance or publish a second receipt.

The sender `by` is the signed-in owner (positive), the person in a tab with
no session on the public page's deposit-only form (`-4`, the
[owner vault](./ownerVault.md)'s `visitor`), the chain reader (`-1`) or the
wallet adapter (`-2`). Whoever reviews is the sender of the review, never a
value the request names; the wallet's replies to the batch request are the
wallet adapter's and finalized vault evidence is the chain reader's.

## Story: Offer one atomic request only on a wallet that already supports it

### Capabilities that require a wallet upgrade use the separate-signature path

Discovered by the proof, an unreviewed request with a captured prompt could
pass the capability review twice. Before review there is no owner or intent
and no wallet prompt has been requested. The saved intent is a
[wallet attempt](./walletAttempt.md) keyed by its plan digest: the request
starts only after storage creates its empty slot, and a storage failure
blocks it.

The public project page's deposit-only form offers the same one request to
any connected wallet, signed in or not (development `src/VaultActions.tsx`
`send("batch")` with `depositOnly`, no session check, and
`src/lib/evm-vault-actions.ts` `sendVaultBatch`): the review accepts the
signed-out person as the owner vault's `canReviewDeposit` does, and that
person alone then saves the intent and recovers its hash.

```quint
import walletAttempt as WA from "./walletAttempt"
import ownerVault as OV from "./ownerVault"
type BatchCapability = AlreadyAtomic | RequiresUpgrade | NoCapability
type BatchPhase = Unreviewed | Offered | Separate | IntentSaved | WalletReference | Uncertain | HashKnown | Declined | NotSent | Failed | Verified
type ChainResult = ChainPending | ChainIncluded | ChainFinalFailed | ChainFinalEvent | ChainFinalMissingEvent
type Batch = { phase: BatchPhase, capability: BatchCapability, owner: int, intent: int, digest: str,
  reference: str, transaction: str, requests: int, evidence: ChainResult, slot: WA::Attempt, storageBlocked: bool,
  approval: ApprovalEvidence }
pure val initial: Batch = { phase: Unreviewed, capability: NoCapability, owner: 0, intent: 0, digest: "",
  reference: "", transaction: "", requests: 0, evidence: ChainPending, slot: WA::noAttempt, storageBlocked: false,
  approval: ApprovalPending }
pure val walletAdapter = -2
pure def canReview(b: Batch, capability: BatchCapability, by: int): bool = b.phase == Unreviewed and (by > 0 or by == OV::visitor)
pure def review(b: Batch, capability: BatchCapability, by: int): Batch =
  { ...b, owner: by, capability: capability, phase: if (capability == AlreadyAtomic) Offered else Separate }
pure def sometimesVisitorBatch(b: Batch): bool = b.owner == OV::visitor and b.requests == 1
pure def intentAttempt(digest: str): WA::Attempt = { identity: digest, bytesId: digest, hash: "", candidate: "" }
pure def canSaveIntent(b: Batch, intent: int, digest: str, stored: bool, by: int): bool = b.phase == Offered and b.capability == AlreadyAtomic
  and intent > 0 and digest != "" and by == b.owner and b.requests == 0 and WA::mayCreate(b.slot)
pure def saveIntent(b: Batch, intent: int, digest: str, stored: bool, by: int): Batch =
  if (stored) { ...b, phase: IntentSaved, intent: intent, digest: digest, requests: 1,
    slot: WA::createIfEmpty(b.slot, intentAttempt(digest)), storageBlocked: false }
  else { ...b, storageBlocked: true }
```

### Wallet references identify later lookups and uncertainty preserves the intent

A definitive capability refusal exposes the separate-signature path. A
user decline closes the intent. A network failure or ambiguous wallet reply
keeps the exact saved intent and never requests a second signature. A
refusal, decline or report that nothing was sent clears only the slot that
still holds this intent. A known
wallet reference may name a transaction for a read. Its status is no proof
of transfer or finality.

```quint
pure def canKeepWalletReference(b: Batch, reference: str, by: int): bool = b.phase == IntentSaved and reference != ""
  and by == walletAdapter
pure def keepWalletReference(b: Batch, reference: str, by: int): Batch = { ...b, phase: WalletReference, reference: reference }
pure def canRefuseBatch(b: Batch, by: int): bool = b.phase == IntentSaved and by == walletAdapter
pure def refuseBatch(b: Batch, by: int): Batch = { ...b, phase: Separate, intent: 0, slot: WA::compareAndClear(b.slot, intentAttempt(b.digest)) }
pure def canDeclineBatch(b: Batch, by: int): bool = b.phase == IntentSaved and by == walletAdapter
pure def declineBatch(b: Batch, by: int): Batch = { ...b, phase: Declined, intent: 0, slot: WA::compareAndClear(b.slot, intentAttempt(b.digest)) }
pure def canKeepUncertain(b: Batch, by: int): bool = b.phase == IntentSaved and by == walletAdapter
pure def keepUncertain(b: Batch, by: int): Batch = { ...b, phase: Uncertain }
pure def canReportNotSent(b: Batch, reference: str, by: int): bool = b.phase == WalletReference and reference == b.reference
  and by == walletAdapter
pure def reportNotSent(b: Batch, reference: str, by: int): Batch = { ...b, phase: NotSent, intent: 0, slot: WA::compareAndClear(b.slot, intentAttempt(b.digest)) }
pure def canNameTransaction(b: Batch, reference: str, transaction: str, by: int): bool = b.phase == WalletReference
  and reference == b.reference and transaction != "" and by == walletAdapter
pure def nameTransaction(b: Batch, reference: str, transaction: str, by: int): Batch = { ...b, phase: HashKnown, transaction: transaction }
pure def canRecoverHash(b: Batch, transaction: str, by: int): bool = b.phase == Uncertain
  and transaction != "" and by == b.owner
pure def recoverHash(b: Batch, transaction: str, by: int): Batch = { ...b, phase: HashKnown, transaction: transaction }
```

### A separate approval proceeds at canonical inclusion and never counts as funding

On the separate-signature path the token approval, or the allowance reset
before it, moves no funds. The chain reader (`by` is `chainReader`) settles it
from a successful matching transaction in a canonical block, included or
finalized; a failed receipt fails it. A settled approval only lets the owner
go on: the deposit review reads the live allowance again before its own
wallet prompt, so a reorganized approval fails there, and only the
deposit's own finalized vault event counts as funding (development
`src/lib/evm-vault-actions.ts` `checkVaultAction`, 67fd54fd4).

```quint
type ApprovalEvidence = ApprovalPending | ApprovalIncluded | ApprovalFinal | ApprovalFailed
pure val chainReader = -1
pure def approvalSettled(e: ApprovalEvidence): bool = e == ApprovalIncluded or e == ApprovalFinal
pure def canObserveApproval(b: Batch, approvalRead: ApprovalEvidence, by: int): bool = b.phase == Separate
  and by == chainReader and not(approvalSettled(b.approval)) and b.approval != ApprovalFailed and approvalRead != ApprovalPending
pure def observeApproval(b: Batch, approvalRead: ApprovalEvidence, by: int): Batch = { ...b, approval: approvalRead }
pure def alwaysApprovalNeverFunds(b: Batch): bool = b.approval != ApprovalPending implies b.phase == Separate
pure def sometimesApprovalIncluded(b: Batch): bool = b.approval == ApprovalIncluded and b.phase == Separate
pure def sometimesApprovalFailed(b: Batch): bool = b.approval == ApprovalFailed
```

## Story: Verify money moved from matching finalized evidence

### Included or missing-event evidence leaves verification pending

The read checks the exact configured chain, source vault, asset, depositor,
gross units and transaction identity. Finalized evidence settles the saved
attempt. A block can be replaced before finality.
Its replacement may return an included transaction to pending. A finalized
success with no matching event is not evidence of a deposit and keeps the
intent recoverable. The owning settlement writer still rechecks registered
vault identity and stored receipt deduplication before credit.

```quint
pure def canObserveChain(b: Batch, intent: int, expectedDigest: str, transaction: str, by: int): bool = b.phase == HashKnown
  and by == chainReader and intent == b.intent and expectedDigest == b.digest and transaction == b.transaction
pure def observeChain(b: Batch, intent: int, expectedDigest: str, transaction: str, observed: ChainResult, by: int): Batch =
  { ...b, evidence: observed, phase: if (observed == ChainFinalEvent) Verified else
    if (observed == ChainFinalFailed) Failed else HashKnown,
    slot: if (observed == ChainFinalEvent or observed == ChainFinalFailed) WA::compareAndClear(b.slot, intentAttempt(b.digest)) else b.slot }
pure def alwaysEvidenceForTerminal(b: Batch): bool = (b.phase == Verified implies b.evidence == ChainFinalEvent)
  and (b.phase == Failed implies b.evidence == ChainFinalFailed)
pure def alwaysAtomicRequest(b: Batch): bool = b.requests > 0 implies b.capability == AlreadyAtomic
pure def alwaysSingleBatchPrompt(b: Batch): bool = b.requests >= 0 and b.requests <= 1
pure def alwaysLiveIntentIsSaved(b: Batch): bool =
  (b.phase == IntentSaved or b.phase == WalletReference or b.phase == Uncertain or b.phase == HashKnown)
    implies b.slot == intentAttempt(b.digest)
pure def sometimesStorageBlocksRequest(b: Batch): bool = b.storageBlocked and b.phase == Offered
pure def alwaysUnreviewedEmpty(b: Batch): bool = b.phase == Unreviewed implies b.requests == 0 and b.owner == 0 and b.intent == 0
pure def stepVerifiedStable(before: Batch, after: Batch): bool = before.phase == Verified implies after == before
pure def sometimesOneBatch(b: Batch): bool = b.requests == 1 and b.phase == Verified
pure def sometimesSeparate(b: Batch): bool = b.phase == Separate and b.capability == RequiresUpgrade
pure def sometimesUncertain(b: Batch): bool = b.phase == Uncertain
pure def sometimesMissingEvent(b: Batch): bool = b.phase == HashKnown and b.evidence == ChainFinalMissingEvent
pure val byValues = Set(1, 2, chainReader, walletAdapter, OV::visitor)
pure val intentValues = Set(1, 2)
pure val digestValues = Set("plan", "wrong", "")
pure val expectedDigestValues = Set("plan", "wrong", "")
pure val referenceValues = Set("ref", "wrong", "")
pure val transactionValues = Set("tx", "other", "")
pure val weight_saveIntent = 6
pure val weight_observeChain = 6
```
