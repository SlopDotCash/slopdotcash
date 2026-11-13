// @source src/VaultActions.tsx
// @source src/lib/evm-vault-actions.ts
// @evidence tests/e2e/vault-actions.spec.ts
// One submitted EVM vault request (a token approval or a transfer of funds),
// its block (unmined, included, replaced, final) and the checks that read it.
// A timer starts a check only for a hash the wallet returned; the owner's
// button starts the same check. One check runs at a time and a check never
// opens a wallet prompt. An approval settles from canonical inclusion and only
// opens the next review; a deposit or withdrawal counts only from a final block.
// The deposit prompt requires the live allowance, so a replaced approval is
// refused before signing. A failed automatic read shows its error, keeps the
// saved request and keeps checking; the next read that works, or any owner
// action, withdraws that message. Abstracted: three automatic attempts stand for the
// source's 240, and the receipt, intent and event predicates are supplied by
// the real adapter, not inferred here.
module ui_vault_auto_check {
  var s: { kind: str, origin: str, block: str, reverted: bool, pending: bool, wallet: bool,
    busy: bool, inflight: str, attempts: int, outcome: str, reviewOpen: bool,
    funded: bool, prompts: int, error: bool }
  pure val LIMIT = 3
  action start(kind: str, origin: str, reverted: bool): bool = s' = { kind: kind, origin: origin,
    block: "unmined", reverted: reverted, pending: true, wallet: false, busy: false,
    inflight: "none", attempts: 0, outcome: "none", reviewOpen: false, funded: false,
    prompts: 0, error: false }
  action init = any { start("approval", "wallet", false), start("approval", "wallet", true),
    start("approval", "recovery", false), start("transfer", "wallet", false),
    start("transfer", "wallet", true), start("transfer", "recovery", false) }
  val included = Set("included", "final").contains(s.block)
  action connect = all { not(s.wallet), s' = s.with("wallet", true) }
  action mine = all { s.block == "unmined", s' = s.with("block", "included") }
  action replace = all { s.block == "included", s' = s.with("block", "unmined") }
  action finalize = all { s.block == "included", s' = s.with("block", "final") }
  // The timer fires only for a wallet-returned hash while no owner action runs.
  action autoCheck = all { s.pending, s.wallet, s.origin == "wallet", not(s.busy),
    s.inflight == "none", s.attempts < LIMIT,
    s' = s.with("inflight", "auto").with("attempts", s.attempts + 1) }
  // A click while a check is in flight starts no second check.
  action manualCheck = all { s.pending, s.wallet, not(s.busy), s.inflight == "none",
    s' = s.with("inflight", "manual").with("busy", true).with("error", false) }
  // The chain read itself fails (wrong network, changed account, provider error).
  action autoCheckFails = all { s.inflight == "auto",
    s' = s.with("inflight", "none").with("error", true) }
  val evidenceMet = if (s.kind == "approval") included else s.block == "final"
  action settle = all { s.inflight != "none",
    s' = if (not(evidenceMet)) s.with("inflight", "none").with("busy", false).with("error", false)
      else if (s.reverted) s.with("inflight", "none").with("busy", false).with("error", false)
        .with("pending", false).with("outcome", "failed")
      else if (s.kind == "approval") s.with("inflight", "none").with("busy", false).with("error", false)
        .with("pending", false).with("outcome", "approval-confirmed")
        .with("reviewOpen", true)
      else s.with("inflight", "none").with("busy", false).with("error", false)
        .with("pending", false).with("outcome", "verified").with("funded", true) }
  // The deposit prompt re-reads the allowance and estimates gas before signing,
  // so it opens only while the approval is still in the canonical chain.
  action promptDeposit = all { s.reviewOpen, s.outcome == "approval-confirmed", included, s.prompts == 0,
    s' = s.with("prompts", 1) }
  action refuseDeposit = all { s.reviewOpen, s.outcome == "approval-confirmed", not(included),
    s' = s.with("reviewOpen", false) }
  action step = any { connect, mine, replace, finalize, autoCheck, manualCheck, autoCheckFails, settle,
    promptDeposit, refuseDeposit, s' = s }
  val invariant = all {
    s.funded implies (s.kind == "transfer" and s.block == "final" and s.outcome == "verified"),
    s.outcome == "approval-confirmed" implies not(s.funded),
    s.kind == "approval" implies not(s.funded),
    s.prompts > 0 implies (s.kind == "approval" and s.outcome == "approval-confirmed"),
    s.inflight == "auto" implies (s.origin == "wallet" and not(s.busy)),
    s.busy implies s.inflight == "manual",
    s.attempts <= LIMIT,
    s.outcome != "none" implies not(s.pending),
    s.error implies (s.pending and s.outcome == "none" and not(s.funded) and s.inflight != "manual")
  }
  run failedReadShowsThenClearsTest = start("transfer", "wallet", false).then(connect).then(mine)
    .then(autoCheck).then(autoCheckFails).expect(s.error and s.pending and s.attempts == 1)
    .then(autoCheck).then(settle).expect(not(s.error) and s.pending)
    .then(finalize).then(autoCheck).then(settle).expect(s.funded and not(s.error))
  run approvalBeforeFinalityTest = start("approval", "wallet", false).then(connect).then(mine)
    .then(autoCheck).then(settle)
    .expect(s.outcome == "approval-confirmed" and s.reviewOpen and s.block == "included" and not(s.funded))
    .then(promptDeposit).expect(s.prompts == 1)
  run transferWaitsForFinalityTest = start("transfer", "wallet", false).then(connect).then(mine)
    .then(autoCheck).then(settle).expect(s.pending and not(s.funded))
    .then(finalize).then(autoCheck).then(settle).expect(s.funded and not(s.pending))
  run replacedApprovalTest = start("approval", "wallet", false).then(connect).then(mine)
    .then(autoCheck).then(settle).then(replace).then(refuseDeposit)
    .expect(s.prompts == 0 and not(s.reviewOpen) and not(s.funded))
  run recoveryHashNeedsClickTest = start("transfer", "recovery", false).then(connect).then(mine)
    .then(finalize).expect(s.attempts == 0 and s.pending)
    .then(manualCheck).then(settle).expect(s.funded)
  run failedTransferTest = start("transfer", "wallet", true).then(connect).then(mine).then(finalize)
    .then(autoCheck).then(settle).expect(s.outcome == "failed" and not(s.funded))
  run attemptLimitTest = start("transfer", "wallet", false).then(connect)
    .then(autoCheck).then(settle).then(autoCheck).then(settle).then(autoCheck).then(settle)
    .expect(s.attempts == LIMIT and s.pending)
    .then(manualCheck).then(settle).expect(s.pending and not(s.funded))
}
