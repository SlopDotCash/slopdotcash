// @source src/OwnerVaultSetup.tsx
// @source src/VaultActions.tsx
// @source src/lib/evm-vault-actions.ts
// @source backend/projects/vault-setup.ts
// @source backend/projects/handler.ts
// @source contracts/evm/adapter.ts
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence scripts/vault-setup-network-failure.test.ts
// @evidence src/lib/evm-vault-actions.test.ts
// Funding an EVM token vault between its creation and its registration.
// The server answers each registration check from the chain: an unmined
// creation is pending; a successful matching creation in a canonical block
// that is not final is answered as a provisional deployment and nothing is
// written; only a final creation registers. The page shows the funding form
// for a provisional deployment, hides it when a later answer no longer carries
// one (the block was replaced), and switches to the registered vault at
// registration. A registration check waits while a wallet prompt is open, so
// the form never changes under a prompt. The owner's deposit may be mined
// before the creation is final. It is reported as received only when its block
// carries the vault's event, verified only from a final block, and counted by
// the server only for a registered vault. A deposit mined while the vault was
// not on chain moved nothing: it is never received, verified or counted, and it
// ends as an explicit "no vault" result. Abstracted: one creation and one
// deposit; a reload while a wallet prompt is open is covered by the existing
// recovery models; the receipt, event and deployment predicates are supplied
// by the real adapter, not inferred here.
module ui_vault_provisional_funding {
  var s: { kind: str, creation: str, registered: bool, form: str, notice: str,
    deposit: str, shown: str, counted: bool }
  // kind: "good" matches the reviewed request; "reverted" failed on chain.
  action start(kind: str): bool = s' = { kind: kind, creation: "unmined", registered: false,
    form: "none", notice: "none", deposit: "none", shown: "none", counted: false }
  action init = any { start("good"), start("reverted") }
  val vaultOnChain = Set("included", "final").contains(s.creation) and s.kind == "good"
  action mineCreation = all { s.creation == "unmined", s' = s.with("creation", "included") }
  // A replaced block takes the creation and every deposit that is not final with it.
  action replace = all { s.creation == "included",
    s' = s.with("creation", "unmined")
      .with("deposit", if (Set("mined", "noop").contains(s.deposit)) "sent" else s.deposit) }
  action finalize = all { s.creation == "included", s' = s.with("creation", "final") }
  val answer = if (s.creation == "unmined") "pending"
    else if (s.creation == "included") (if (s.kind == "good") "provisional" else "pending")
    else if (s.kind == "good") "registered" else "failed"
  // One registration check and its answer. It never runs under a wallet prompt.
  action ask = all { s.form != "registered", s.deposit != "prompt",
    s' = if (answer == "registered")
        s.with("registered", true).with("form", "registered").with("notice", "none")
      else if (answer == "provisional")
        s.with("form", "provisional")
          .with("notice", if (s.form == "provisional") s.notice else "fundable")
      else s.with("form", "none")
        .with("notice", if (s.form == "provisional") "dropped"
          else if (answer == "failed") "failed" else s.notice) }
  // The review reads the vault at the latest block and refuses when it is absent.
  action openPrompt = all { s.form != "none", s.deposit == "none", vaultOnChain,
    s' = s.with("deposit", "prompt") }
  action decline = all { s.deposit == "prompt", s' = s.with("deposit", "none") }
  action sign = all { s.deposit == "prompt", s' = s.with("deposit", "sent").with("shown", "none") }
  // A call to an address without vault code succeeds and moves nothing.
  action mineDeposit = all { s.deposit == "sent",
    s' = s.with("deposit", if (vaultOnChain) "mined" else "noop") }
  action finalizeDeposit = any {
    all { s.deposit == "mined", s.creation == "final", s' = s.with("deposit", "final") },
    all { s.deposit == "noop", s' = s.with("deposit", "noopFinal") } }
  // The form's own check of the saved deposit. It signs nothing.
  action check = all { s.form != "none",
    Set("sent", "mined", "noop", "final", "noopFinal").contains(s.deposit),
    s' = if (s.deposit == "final") s.with("deposit", "verified").with("shown", "verified")
      else if (s.deposit == "noopFinal") s.with("deposit", "none").with("shown", "no-vault")
      else s.with("shown", if (s.deposit == "mined") "received" else "waiting") }
  // The server reads finalized counters of a registered vault only.
  action observe = all { s.registered, Set("final", "verified").contains(s.deposit),
    s' = s.with("counted", true) }
  action reload = all { s.deposit != "prompt",
    s' = s.with("form", if (s.registered) "registered" else "none")
      .with("shown", "none").with("notice", "none") }
  action step = any { mineCreation, replace, finalize, ask, openPrompt, decline, sign,
    mineDeposit, finalizeDeposit, check, observe, reload, s' = s }
  val invariant = all {
    s.registered implies (s.creation == "final" and s.kind == "good"),
    s.form == "registered" implies s.registered,
    s.form == "provisional" implies not(s.registered),
    s.counted implies (s.registered and Set("final", "verified").contains(s.deposit)),
    Set("final", "verified").contains(s.deposit) implies s.creation == "final",
    s.shown == "verified" implies s.deposit == "verified",
    Set("noop", "noopFinal").contains(s.deposit) implies (s.shown != "verified" and not(s.counted)),
    s.deposit == "prompt" implies s.form != "none",
    s.kind == "reverted" implies (s.form == "none" and s.deposit == "none" and not(s.counted))
  }
  run fundsBeforeFinalityTest = start("good").then(mineCreation).then(ask)
    .expect(s.form == "provisional" and s.notice == "fundable" and not(s.registered))
    .then(openPrompt).then(sign).then(mineDeposit).then(check)
    .expect(s.shown == "received" and not(s.counted) and not(s.registered))
    .then(finalize).then(finalizeDeposit).then(ask)
    .expect(s.registered and s.form == "registered")
    .then(check).expect(s.shown == "verified").then(observe).expect(s.counted)
  run depositVerifiesBeforeRegistrationTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(sign).then(mineDeposit).then(finalize).then(finalizeDeposit)
    .then(check).expect(s.shown == "verified" and not(s.registered) and not(s.counted))
    .then(ask).expect(s.registered).then(observe).expect(s.counted)
  run unregisteredDepositIsNotCountedTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(sign).then(mineDeposit).then(finalize).then(finalizeDeposit)
    .then(observe.fail())
  run droppedCreationHidesFormTest = start("good").then(mineCreation).then(ask)
    .then(replace).then(ask).expect(s.form == "none" and s.notice == "dropped")
    .then(openPrompt.fail())
  run reincludedCreationRestoresFormTest = start("good").then(mineCreation).then(ask)
    .then(replace).then(ask).then(mineCreation).then(ask)
    .expect(s.form == "provisional" and s.notice == "fundable")
  run depositWithoutVaultEndsClearlyTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(sign).then(replace).then(mineDeposit)
    .expect(s.deposit == "noop").then(check).expect(s.shown == "waiting")
    .then(ask).expect(s.form == "none")
    .then(mineCreation).then(ask).then(finalizeDeposit).then(check)
    .expect(s.shown == "no-vault" and s.deposit == "none" and not(s.counted))
    .then(finalize).then(ask).expect(s.registered and not(s.counted))
  run promptDefersRegistrationTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(finalize).then(ask.fail())
  run promptThenRegistrationTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(finalize).then(sign).then(ask)
    .expect(s.form == "registered").then(mineDeposit).then(finalizeDeposit).then(check)
    .expect(s.shown == "verified")
  run reloadRestoresFormTest = start("good").then(mineCreation).then(ask)
    .then(openPrompt).then(sign).then(reload).expect(s.form == "none")
    .then(ask).expect(s.form == "provisional" and s.deposit == "sent")
    .then(mineDeposit).then(check).expect(s.shown == "received")
  run revertedCreationOffersNoFormTest = start("reverted").then(mineCreation).then(ask)
    .expect(s.form == "none").then(finalize).then(ask)
    .expect(s.form == "none" and s.notice == "failed" and not(s.registered))
    .then(openPrompt.fail())
}
