// @source src/PublicVaultFunding.tsx
// @source src/EscrowFunding.tsx
// @source src/VaultActions.tsx
// @source src/lib/pending-attempt.ts
// @source backend/payments/handler.ts
// @evidence tests/e2e/public-vault-funding.spec.ts
// @evidence backend/payments/vault-deposits.test.ts
// The public project page's funding parts (operator decision, 18 November
// 2026). The deposit control is offered only for an active project whose
// vault counters are on record. It starts closed and opens when the visitor
// asks, or by itself when this tab holds a saved funding request for the
// vault, so a reload keeps checking it. Any connected wallet, the owner's
// included, is offered a deposit and never a withdrawal. A withdrawal saved
// on the owner's manage page in the same tab is still checked here; once it
// settles the form offers a deposit again. The "Funded by" list is a
// separate read: loading, empty, listed and failed are distinct, and a
// failed read is left only by a retry. Abstracted: one vault, one saved
// request slot, and the wallet, review and chain checks of the shared form,
// which the vault form models cover.
module ui_public_vault_funding {
  type S = { project: str, totals: str, saved: str, form: str, wallet: str,
    operation: str, reviewed: bool, publicSends: Set[str], funders: str }
  var s: S
  action start(project: str, saved: str): bool = s' = { project: project, totals: "loading",
    saved: saved, form: if (saved == "none") "closed" else "open", wallet: "none",
    operation: if (saved == "none") "deposit" else saved, reviewed: false,
    publicSends: Set(), funders: "hidden" }
  action init = any { start("active", "none"), start("active", "deposit"),
    start("active", "withdraw"), start("paused", "none"), start("paused", "deposit") }
  val fundable = s.project == "active" and s.totals == "ready"
  val shown = fundable and s.form == "open"
  // The first vault read: no snapshot yet (pending) or counters on record.
  action totalsAnswer(answer: str): bool = all { s.totals == "loading",
    s' = s.with("totals", answer).with("funders", if (answer == "ready") "loading" else "hidden") }
  action fundersAnswer(answer: str): bool = all { s.funders == "loading", s' = s.with("funders", answer) }
  action retryFunders = all { s.funders == "error", s' = s.with("funders", "loading") }
  action open = all { fundable, s.form == "closed", s' = s.with("form", "open") }
  // Connecting never selects a withdrawal on this page.
  action connect(wallet: str): bool = all { shown,
    s' = s.with("wallet", wallet).with("reviewed", false)
      .with("operation", if (s.saved == "none") "deposit" else s.operation) }
  action review = all { shown, s.wallet != "none", s.saved == "none", s.operation == "deposit",
    s' = s.with("reviewed", true) }
  action send = all { shown, s.reviewed, s.saved == "none",
    s' = s.with("saved", s.operation).with("reviewed", false)
      .with("publicSends", s.publicSends.union(Set(s.operation))) }
  // The saved request settles (verified, failed or cleared). A finalized
  // deposit reads the totals and the list again.
  action settle = all { shown, s.wallet != "none", s.saved != "none",
    s' = s.with("saved", "none").with("operation", "deposit")
      .with("funders", if (s.funders == "hidden") "hidden" else "loading") }
  // The owner leaves for the manage page in this tab, saves a withdrawal for
  // the vault there, and returns: the public page mounts again and reads it.
  action manageWithdraw = all { s.saved == "none",
    s' = { ...s, saved: "withdraw", totals: "loading", funders: "hidden", wallet: "none",
      reviewed: false, form: "open", operation: "withdraw" } }
  action reload = all { s' = { ...s, totals: "loading", funders: "hidden", wallet: "none",
    reviewed: false, form: if (s.saved == "none") "closed" else "open",
    operation: if (s.saved == "none") "deposit" else s.saved } }
  action step = any { totalsAnswer("pending"), totalsAnswer("ready"),
    fundersAnswer("empty"), fundersAnswer("listed"), fundersAnswer("error"), retryFunders,
    open, connect("visitor"), connect("owner"), review, send, settle, manageWithdraw,
    reload, s' = s }
  val invariant = all {
    // No request sent from the public page is a withdrawal.
    s.publicSends.subseteq(Set("deposit")),
    s.reviewed implies (s.operation == "deposit" and s.wallet != "none" and shown),
    // Only a saved withdrawal can leave a withdrawal selected here.
    s.operation == "withdraw" implies s.saved == "withdraw",
    // A saved request keeps its form open across a reload.
    s.saved != "none" implies s.form == "open",
    // The list is read only beside vault counters that are on record.
    s.funders != "hidden" implies s.totals == "ready",
    s.project == "paused" implies (s.wallet == "none" and s.publicSends == Set()),
  }
  run visitorDepositsTest = start("active", "none").then(totalsAnswer("ready"))
    .then(fundersAnswer("empty")).then(open).then(connect("visitor")).then(review).then(send)
    .expect(s.saved == "deposit" and s.publicSends == Set("deposit"))
    .then(reload).expect(s.form == "open").then(totalsAnswer("ready"))
    .then(connect("visitor")).then(settle)
    .expect(s.saved == "none" and s.funders == "loading" and invariant)
  run ownerIsOfferedOnlyADepositTest = start("active", "none").then(totalsAnswer("ready"))
    .then(open).then(connect("owner")).expect(s.operation == "deposit")
    .then(review).then(send).expect(s.publicSends == Set("deposit") and invariant)
  run savedWithdrawalIsCheckedNotRepeatedTest = start("active", "withdraw")
    .then(totalsAnswer("ready")).then(connect("owner")).expect(s.operation == "withdraw")
    .then(review.fail())
  run settledWithdrawalReturnsToDepositTest = start("active", "withdraw")
    .then(totalsAnswer("ready")).then(connect("owner")).then(settle)
    .expect(s.operation == "deposit" and s.publicSends == Set() and invariant)
  run pausedProjectOffersNothingTest = start("paused", "none").then(totalsAnswer("ready"))
    .then(open.fail())
  run noSnapshotOffersNothingTest = start("active", "none").then(totalsAnswer("pending"))
    .expect(s.funders == "hidden").then(open.fail())
  run failedFundersReadStaysFailedTest = start("active", "none").then(totalsAnswer("ready"))
    .then(fundersAnswer("error")).then(fundersAnswer("empty").fail())
  run failedFundersReadNeedsRetryTest = start("active", "none").then(totalsAnswer("ready"))
    .then(fundersAnswer("error")).then(retryFunders).then(fundersAnswer("listed"))
    .expect(s.funders == "listed" and invariant)
}
