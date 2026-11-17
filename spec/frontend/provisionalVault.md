# Funding an included EVM token vault

The 14 November 2026 approval in PRD section 6 allows the project owner to
fund a matching ordinary EVM token vault after canonical inclusion of the
creation. The form identifies the creation as provisional. Registration still
requires finalized creation evidence. Only finalized deposit events in a
registered vault may change the authoritative balance.

Source is `SlopDotCash/slopdotcash` main commit
`e96069ce2a403588ca2129b1ebb943f7bb0972a6`, including its PRD,
`formal/models/ui/ui_vault_provisional_funding.qnt`,
`formal/models/ui/ui_vault_auto_check.qnt`, `src/OwnerVaultSetup.tsx`,
`src/VaultActions.tsx`, `src/lib/evm-vault-actions.ts`,
`backend/projects/handler.ts`, `backend/projects/vault-setup.ts` and
`contracts/evm/adapter.ts`. The adapter verifies canonical block identity,
execution success, reviewed creation and exact transfer event identities.
This model covers a single reviewed creation and one active deposit request.
The [settlement vault](../settlement/vault.md) remains authority for actual
balances. Durable request storage and real wallet and chain conformance are
separate acceptance evidence.

## Story: Open a provisional funding form without registering a vault

### Reviewed identity and current chain evidence govern the form

A matching ordinary EVM token vault can expose the owner deposit form while
its creation remains included. Other vault kinds wait for registration.
An authenticated owner manages this setup surface. The separate registered
vault deposit surface retains the normal permissionless deposit policy.

```quint
import walletAttempt as WA from "./walletAttempt"
type VaultKind = OrdinaryEvmToken | EvmNative | BountyEvm | SolanaVault
type Creation = Missing | Included | Finalized | RevertedCreation
type FundingForm = Hidden | Provisional | Registered
type CreationNotice = NoNotice | CreationPending | CreationDropped | CreationFailed
type DepositPhase = NoDeposit | Prompt | Submitted | IncludedEvent | IncludedNoVault | FinalEvent | FinalNoVault | FailedSend | Verified
 type IncludedDepositEvidence = ExactDepositEvent | VerifiedAbsentCode | MissingDepositEvent | MismatchedDepositEvent
type DepositView = NoView | Waiting | Received | DepositFailed | NoVault | DepositVerified
 type Setup = { kind: VaultKind, creation: Creation, creationBlock: int, matchingCreation: bool, registered: bool,
  form: FundingForm, notice: CreationNotice, phase: DepositPhase, transaction: int, depositBlock: int,
  view: DepositView, counted: bool, readUnavailable: bool, slot: WA::Attempt, storageBlocked: bool }
pure val initial: Setup = { kind: OrdinaryEvmToken, creation: Missing, creationBlock: 0, matchingCreation: true,
  registered: false, form: Hidden, notice: NoNotice, phase: NoDeposit, transaction: 0, depositBlock: 0,
  view: NoView, counted: false, readUnavailable: false, slot: WA::noAttempt, storageBlocked: false }
pure val byValues = Set("owner", "other")
pure val blockValues = Set(0, 1, 2)
pure val transactionValues = Set(0, 1, 2)
pure val weight_openPrompt = 5
pure val weight_sign = 5
pure val weight_replaceCreation = 4
pure val weight_includeDeposit = 5
pure val weight_finalizeDeposit = 5
pure val weight_checkDeposit = 5
pure def canReviewCreation(s: Setup): bool = s.creation == Missing and s.form == Hidden and s.transaction == 0 and not(s.registered)
pure def reviewCreation(s: Setup, kind: VaultKind, matching: bool): Setup =
  { ...s, kind: kind, matchingCreation: matching }
pure def canIncludeCreation(s: Setup, block: int): bool = s.creation == Missing and block > 0 and not(s.registered)
pure def includeCreation(s: Setup, block: int): Setup = { ...s, creation: Included, creationBlock: block }
pure def canFinalizeCreation(s: Setup, block: int): bool = s.creation == Included and block == s.creationBlock
pure def finalizeCreation(s: Setup, block: int): Setup =
  { ...s, creation: if (s.matchingCreation) Finalized else RevertedCreation }
pure def hasVault(s: Setup): bool = s.matchingCreation and (s.creation == Included or s.creation == Finalized)
pure def showsFundingForm(s: Setup): bool = s.form == Registered or (s.form == Provisional and hasVault(s))
```

### Registration polling leaves an open wallet prompt and last verified form alone on unavailable reads

A verified replacement immediately withdraws the provisional offer and shows
that creation was dropped. A wallet prompt that is already open retains its
captured form until it settles, but the page stops offering the provisional
form and cannot start a new signature with known missing code. A read outage
without replacement evidence preserves the last known form and reports the
unavailable read.

```quint
pure def canCheckCreation(s: Setup): bool = not(s.registered) and s.phase != Prompt
pure def checkCreation(s: Setup, readOk: bool): Setup =
  if (not(readOk)) { ...s, readUnavailable: true }
  else if (s.creation == Finalized and s.matchingCreation)
    { ...s, registered: true, form: Registered, notice: NoNotice, readUnavailable: false }
  else if (s.creation == Included and s.matchingCreation and s.kind == OrdinaryEvmToken)
    { ...s, form: Provisional, notice: CreationPending, readUnavailable: false }
  else { ...s, form: Hidden, notice: if (s.form == Provisional) CreationDropped else
    if (s.creation == RevertedCreation) CreationFailed else s.notice, readUnavailable: false }
pure def canReplaceCreation(s: Setup): bool = s.creation == Included and not(s.registered)
pure def replaceCreation(s: Setup): Setup = { ...s, creation: Missing, creationBlock: 0,
  form: if (s.phase == Prompt) s.form else Hidden,
  notice: if (s.form == Provisional) CreationDropped else s.notice,
  phase: if (s.phase == IncludedEvent or s.phase == IncludedNoVault) Submitted else s.phase,
  depositBlock: if (s.phase == IncludedEvent or s.phase == IncludedNoVault) 0 else s.depositBlock }
pure def canReload(s: Setup): bool = s.phase != Prompt
pure def reload(s: Setup): Setup = { ...s, form: if (s.registered) Registered else Hidden,
  notice: NoNotice, view: NoView, readUnavailable: false }
```

## Story: Retain an uncertain deposit through replacement and finality

### Only the owner opens the provisional token deposit prompt, after storage saves its attempt

The provisional review does not offer native funding, Solana funding, bounty
funding, withdrawals or a different depositor. Prompt admission rechecks the
live matching deployment. `sign` records the wallet broadcast before any
subsequently verified replacement. An already broadcast transaction can still
be mined during an interval with no vault code. The shell authenticates its
owner and binds the transaction to the saved exact deposit intent. The
intent is the one [wallet attempt](./walletAttempt.md) of this form: the
prompt opens only after storage creates its empty slot, a storage failure
blocks the prompt, a decline clears only that attempt, and a terminal check
settles it.

```quint
pure val depositAttempt: WA::Attempt = { identity: "owner-deposit", bytesId: "reviewed-deposit", hash: "", candidate: "" }
pure def canOpenPrompt(s: Setup, by: str, stored: bool): bool = s.phase == NoDeposit and by == "owner" and hasVault(s)
  and (s.form == Registered or (s.form == Provisional and s.kind == OrdinaryEvmToken and not(s.registered)))
  and WA::mayCreate(s.slot)
pure def openPrompt(s: Setup, by: str, stored: bool): Setup =
  if (stored) { ...s, phase: Prompt, view: NoView, slot: WA::createIfEmpty(s.slot, depositAttempt), storageBlocked: false }
  else { ...s, storageBlocked: true }
pure def canDecline(s: Setup): bool = s.phase == Prompt
pure def decline(s: Setup): Setup = { ...s, phase: NoDeposit, form: if (hasVault(s)) s.form else Hidden,
  slot: WA::compareAndClear(s.slot, depositAttempt) }
pure def canSign(s: Setup, transaction: int, by: str): bool = s.phase == Prompt and transaction > 0 and by == "owner" and hasVault(s)
pure def sign(s: Setup, transaction: int, by: str): Setup =
  { ...s, phase: Submitted, transaction: transaction, view: Waiting }
```

### Included deposits are received pending finality only when there is an exact deposit event

A successful transaction sent to an address without vault code moved no
funds. The adapter verifies the audited transaction identity, exact configured
vault/event and canonical block. `VerifiedAbsentCode` requires observing the
expected address without vault code in the receipt block. A missing,
mismatched or incomplete event never supplies that evidence. Any replaced non-final transfer returns to submitted
and a subsequent check withdraws the received notice. The saved transaction
remains available for polling.

```quint
pure def canIncludeDeposit(s: Setup, transaction: int, block: int, evidence: IncludedDepositEvidence): bool =
  s.phase == Submitted and transaction == s.transaction and block > 0
    and ((evidence == ExactDepositEvent and hasVault(s)) or
      (evidence == VerifiedAbsentCode and not(hasVault(s))))
pure def includeDeposit(s: Setup, transaction: int, block: int, evidence: IncludedDepositEvidence): Setup =
  { ...s, phase: if (evidence == ExactDepositEvent) IncludedEvent else IncludedNoVault, depositBlock: block }
pure def canReplaceDeposit(s: Setup): bool = s.phase == IncludedEvent or s.phase == IncludedNoVault
pure def replaceDeposit(s: Setup): Setup = { ...s, phase: Submitted, depositBlock: 0 }
pure def canFinalizeDeposit(s: Setup, transaction: int, block: int): bool =
  transaction == s.transaction and block == s.depositBlock
    and ((s.phase == IncludedEvent and s.creation == Finalized) or s.phase == IncludedNoVault)
pure def finalizeDeposit(s: Setup, transaction: int, block: int): Setup =
  { ...s, phase: if (s.phase == IncludedEvent) FinalEvent else FinalNoVault }
pure def canObserveFailure(s: Setup, transaction: int, block: int): bool =
  s.phase == Submitted and transaction == s.transaction and block > 0
pure def observeFailure(s: Setup, transaction: int, block: int): Setup = { ...s, phase: FailedSend, depositBlock: block }
pure def canCheckDeposit(s: Setup): bool = s.phase != NoDeposit and s.phase != Prompt and s.phase != Verified
pure def checkDeposit(s: Setup): Setup =
  val cleared = WA::compareAndClear(s.slot, depositAttempt)
  if (s.phase == FinalEvent) { ...s, phase: Verified, view: DepositVerified, slot: cleared }
  else if (s.phase == FinalNoVault) { ...s, phase: NoDeposit, view: NoVault, transaction: 0, depositBlock: 0, slot: cleared }
  else if (s.phase == FailedSend) { ...s, phase: NoDeposit, view: DepositFailed, transaction: 0, depositBlock: 0, slot: cleared }
  else { ...s, view: if (s.phase == IncludedEvent) Received else Waiting }
```

### Only a finalized deposit in a registered vault is eligible for accounting

The accounting step is a projection of the settlement deposit writer,
which additionally binds amount, asset, receipt identity and replay. It does
not credit a second ledger. A finalized receipt may appear in the local view
before registration, while the project balance remains unchanged.

```quint
pure def canCountDeposit(s: Setup): bool = s.registered and not(s.counted)
  and (s.phase == FinalEvent or s.phase == Verified)
pure def countDeposit(s: Setup): Setup = { ...s, counted: true }
pure def alwaysRegistrationFinal(s: Setup): bool = s.registered implies s.creation == Finalized and s.matchingCreation
pure def alwaysProvisionalScope(s: Setup): bool = s.form == Provisional implies
  not(s.registered) and s.kind == OrdinaryEvmToken and s.matchingCreation
pure def alwaysRegisteredForm(s: Setup): bool = s.form == Registered implies s.registered
pure def alwaysCountedFinal(s: Setup): bool = s.counted implies s.registered and (s.phase == FinalEvent or s.phase == Verified)
pure def alwaysDepositFinality(s: Setup): bool = (s.phase == FinalEvent or s.phase == Verified) implies s.creation == Finalized
pure def alwaysPromptOwnsForm(s: Setup): bool = s.phase == Prompt implies s.form != Hidden
pure def alwaysVerifiedViewNeedsEvidence(s: Setup): bool = s.view == DepositVerified implies s.phase == Verified
pure def alwaysOpenDepositIsSaved(s: Setup): bool =
  if (s.phase == NoDeposit or s.phase == Verified) s.slot == WA::noAttempt else s.slot == depositAttempt
pure def sometimesStorageBlocksPrompt(s: Setup): bool = s.storageBlocked and s.phase == NoDeposit
pure def sometimesProvisional(s: Setup): bool = s.form == Provisional
pure def sometimesReplaced(s: Setup): bool = s.form == Hidden and s.notice == CreationDropped
pure def sometimesPendingTransfer(s: Setup): bool = s.view == Received and not(s.counted)
pure def sometimesVerifiedBeforeRegistration(s: Setup): bool = s.view == DepositVerified and not(s.registered)
pure def sometimesCounted(s: Setup): bool = s.counted
pure def sometimesNoVault(s: Setup): bool = s.view == NoVault
```
