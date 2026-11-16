// @source src/VaultActions.tsx
// @source src/OwnerBountyVault.tsx
// @source src/lib/evm-vault-actions.ts
// @source src/lib/solana-vault-actions.ts
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// One wallet invocation, two component lifetimes, deposit/withdrawal, and one
// retained slot which another view may clear or replace. Monetary values,
// account/network checks, chain evidence and exact pending-record identity are
// predicates refined by the existing funding and recovery models.
// Preparation, provider observation, return, and the synchronous beforeSend
// callback are separate. Committed layout cleanup prevents a departed callback
// from recording/opening a new wallet request. A later capability change must
// stop a deposit; it does not stop owner withdrawals or erase a prior request.
// An already opened wallet may resolve after departure. Its returned hash is
// diagnostic evidence, not payment finality. No scenario or check has run.
module ui_vault_prompt_ownership {
  var s: { present: bool, mounted: bool, life: int, canDeposit: bool,
    phase: str, requestLife: int, operation: str, verified: bool,
    prompt: bool, authorizedAtPrompt: bool, ownedAtPrompt: bool,
    slot: int, hash: bool, result: str }
  action init = s' = { present: true, mounted: true, life: 1, canDeposit: true,
    phase: "idle", requestLife: 0, operation: "deposit", verified: false,
    prompt: false, authorizedAtPrompt: false, ownedAtPrompt: false,
    slot: 0, hash: false, result: "none" }
  action capability(allowed: bool): bool = s' = s.with("canDeposit", allowed)
  action begin(operation: str): bool = all { s.mounted, s.phase == "idle",
    Set("deposit", "withdraw").contains(operation),
    operation == "withdraw" or s.canDeposit,
    s' = s.with("requestLife", s.life).with("operation", operation)
      .with("phase", "preparing").with("result", "pending") }
  action prepare(valid: bool): bool = all { s.phase == "preparing",
    s' = s.with("phase", if (valid) "observed" else "done")
      .with("verified", valid).with("result", if (valid) "pending" else "invalid") }
  action returnPrepared = all { s.phase == "observed", s' = s.with("phase", "returned") }
  action beforeSend(storageWorks: bool): bool = {
    val owned = s.mounted and s.requestLife == s.life
    val permitted = s.operation == "withdraw" or s.canDeposit
    val allowed = owned and permitted and storageWorks and s.slot == 0
    all { s.phase == "returned", s.verified,
      s' = s.with("phase", if (allowed) "wallet" else "done")
        .with("slot", if (allowed) 1 else s.slot).with("prompt", allowed)
        .with("authorizedAtPrompt", allowed and permitted)
        .with("ownedAtPrompt", allowed and owned)
        .with("result", if (allowed) "pending" else if (not(owned)) "departed"
          else if (not(permitted)) "restricted" else "storage-refused") }
  }
  action depart = all { s.mounted, s' = s.with("present", false).with("mounted", false) }
  action remount = all { not(s.mounted), s.life == 1,
    s' = s.with("present", true).with("mounted", true).with("life", 2) }
  // This is a second view's exact-slot action, not a busy initiating form.
  action otherClears = all { s.phase == "wallet", s.slot == 1,
    s' = s.with("slot", 0).with("hash", false) }
  action otherReplaces = all { s.phase == "wallet", s.slot != 2,
    s' = s.with("slot", 2).with("hash", false) }
  action walletReply(outcome: str, storageWorks: bool): bool = all {
    s.phase == "wallet", Set("hash", "declined", "unknown").contains(outcome),
    s' = s.with("phase", "done").with("result", outcome)
      .with("hash", if (outcome == "hash" and storageWorks and s.slot == 1) true else s.hash)
      .with("slot", if (outcome == "declined" and storageWorks and s.slot == 1 and not(s.hash)) 0 else s.slot) }
  action step = {
    nondet operation = Set("deposit", "withdraw").oneOf()
    nondet outcome = Set("hash", "declined", "unknown").oneOf()
    nondet flag = Set(false, true).oneOf()
    any { capability(flag), begin(operation), prepare(flag), returnPrepared,
      beforeSend(flag), depart, remount, otherClears, otherReplaces,
      walletReply(outcome, flag), s' = s }
  }
  val invariant = all {
    not(s.present) implies not(s.mounted),
    s.prompt implies s.verified and s.authorizedAtPrompt and s.ownedAtPrompt,
    s.hash implies s.slot == 1,
    s.life >= 1 and s.life <= 2 }
  action reviewed(operation: str): bool = begin(operation).then(prepare(true)).then(returnPrepared)
  run currentDepositRecordsBeforePromptTest = init.then(reviewed("deposit")).then(beforeSend(true))
    .expect(s.prompt and s.slot == 1 and invariant)
  run currentWithdrawalRecordsBeforePromptTest = init.then(capability(false)).then(reviewed("withdraw")).then(beforeSend(true))
    .expect(s.prompt and s.authorizedAtPrompt and invariant)
  run invalidReviewCannotReachPromptTest = init.then(begin("deposit")).then(prepare(false))
    .expect(not(s.prompt) and s.slot == 0 and invariant)
  run departedPreparationCannotPromptTest = init.then(begin("deposit")).then(depart).then(prepare(true)).then(returnPrepared).then(beforeSend(true))
    .expect(s.result == "departed" and s.slot == 0 and invariant)
  run departedReturnedReviewCannotPromptTest = init.then(reviewed("deposit")).then(depart).then(beforeSend(true))
    .expect(not(s.prompt) and invariant)
  run replacementLifetimeCannotAdoptOldPreparationTest = init.then(reviewed("deposit")).then(depart).then(remount).then(beforeSend(true))
    .expect(s.result == "departed" and s.life == 2 and invariant)
  run depositCapabilityLostDuringPreparationRefusesTest = init.then(begin("deposit")).then(capability(false)).then(prepare(true)).then(returnPrepared).then(beforeSend(true))
    .expect(s.result == "restricted" and not(s.prompt) and s.slot == 0 and invariant)
  run depositCapabilityLostAfterReturnedReviewRefusesTest = init.then(reviewed("deposit")).then(capability(false)).then(beforeSend(true))
    .expect(s.result == "restricted" and s.slot == 0 and invariant)
  run withdrawalSurvivesDepositRestrictionTest = init.then(reviewed("withdraw")).then(capability(false)).then(beforeSend(true))
    .expect(s.prompt and invariant)
  run storageFailureStartsNoWalletTest = init.then(reviewed("deposit")).then(beforeSend(false))
    .expect(s.slot == 0 and not(s.prompt) and invariant)
  run laterRestrictionDoesNotEraseOpenWalletTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(capability(false))
    .then(walletReply("hash", true)).expect(s.hash and s.slot == 1 and invariant)
  run departedOpenWalletMayRetainItsHashTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(depart)
    .then(walletReply("hash", true)).expect(s.hash and s.slot == 1 and invariant)
  run returnedHashCannotRecreateClearedSlotTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(otherClears)
    .then(walletReply("hash", true)).expect(s.slot == 0 and not(s.hash) and invariant)
  run oldWalletCannotReplaceNewSlotTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(otherReplaces)
    .then(walletReply("hash", true)).expect(s.slot == 2 and not(s.hash) and invariant)
  run unknownWalletKeepsRecoverySlotTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(walletReply("unknown", true))
    .expect(s.slot == 1 and not(s.hash) and invariant)
  run declinedWalletClearsOnlyItsSlotTest = init.then(reviewed("deposit")).then(beforeSend(true)).then(otherReplaces)
    .then(walletReply("declined", true)).expect(s.slot == 2 and invariant)
  // Historical negative controls are excluded from step.
  action historicalPassiveDepart = s' = s.with("present", false)
  action historicalBeforeSend = all { s.phase == "returned", s.mounted,
    s' = s.with("phase", "wallet").with("prompt", true).with("slot", 1)
      .with("ownedAtPrompt", true).with("authorizedAtPrompt", s.operation == "withdraw" or s.canDeposit) }
  run historicalPassiveCleanupAllowedDepartedPromptTest = init.then(reviewed("deposit")).then(historicalPassiveDepart).then(beforeSend(true))
    .expect(s.prompt and not(invariant))
  run historicalCapabilitySnapshotAllowedRestrictedPromptTest = init.then(reviewed("deposit")).then(capability(false)).then(historicalBeforeSend)
    .expect(s.prompt and not(invariant))
}
