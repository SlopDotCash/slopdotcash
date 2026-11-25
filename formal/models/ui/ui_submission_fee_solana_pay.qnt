// @source src/SubmissionFeePaySolana.tsx
// @source src/lib/solana-fee-deposit.ts
// @source src/lib/submission-fee-page.ts
// @source src/SubmissionFeePage.tsx
// @source backend/submission-fee/solana-pay.ts
// @source backend/submission-fee/handler.ts
// @source contracts/solana/wallet-transactions.ts
// @evidence backend/submission-fee/solana-pay.test.ts
// The pay page's Solana form for one pull request's fee, in one browser tab.
// `offered` is whether the page lists Solana at all: the program id is
// published, Solana is switched on and the fee is still due. The API
// prepares the payer's one transaction, because a browser cannot read a
// Solana endpoint; `honest` is whether what it returns is the message the
// page builds itself from the published tables. `ready` is what only the
// chain knows at review time: deposits are not paused, the fee wallet's
// USDC account exists, and the wallet has a USDC account with enough in it.
// `nonceFree` is whether this wallet has not used the nonce the page drew.
// `saved` is the tab's stored request: none, an intent written just before
// the wallet prompt, or a submitted signature. `chain` is the transaction.
// `deposited` is this tab's finalized deposit that Slop has not recorded
// yet. The record read, the terms and the EVM form are ui_submission_fee_pay.
module ui_submission_fee_solana_pay {
  var s: { offered: bool, wallet: bool, honest: bool, ready: bool, nonceFree: bool, tries: int,
    view: str, saved: str, chain: str, paidElsewhere: bool, deposited: bool, prompts: int,
    refusedPlan: bool }
  action init = s' = { offered: false, wallet: false, honest: true, ready: true, nonceFree: true, tries: 0,
    view: "idle", saved: "none", chain: "none", paidElsewhere: false, deposited: false, prompts: 0,
    refusedPlan: false }

  // The world outside the tab.
  action offer(on) = s' = s.with("offered", on)
  action setHonest(honest) = s' = s.with("honest", honest)
  action setReady(ready) = s' = s.with("ready", ready)
  action setNonceFree(free) = s' = s.with("nonceFree", free)
  action payElsewhere = all { not(s.paidElsewhere), s' = s.with("paidElsewhere", true) }

  action connect = all { not(s.wallet), s' = s.with("wallet", true) }
  // Review. A nonce this wallet already used is replaced by a new random
  // one without asking the payer; a chain refusal, or a prepared transaction
  // that is not the page's own message, leaves nothing to sign.
  action review = all { s.offered, s.wallet, s.view == "idle", s.saved == "none", not(s.deposited),
    if (not(s.ready)) s' = s
    else if (not(s.nonceFree))
      s' = (if (s.tries < 2) s.with("tries", s.tries + 1).with("nonceFree", true) else s.with("tries", 0))
    else if (not(s.honest)) s' = s.with("refusedPlan", true)
    else s' = s.with("view", "reviewed").with("tries", 0) }
  // Confirm reads the fee record again first. Then the intent is saved, and
  // only then is the wallet asked.
  action confirm = all { s.view == "reviewed", s.saved == "none", s.wallet,
    if (s.paidElsewhere or not(s.offered)) s' = s.with("view", "idle")
    else s' = s.with("saved", "intent").with("view", "idle")
      // Counted to two, which is all the scenarios below tell apart.
      .with("prompts", if (s.prompts < 2) s.prompts + 1 else 2) }
  action decline = all { s.saved == "intent", s.chain == "none",
    s' = s.with("saved", "none").with("view", "idle") }
  action walletSends = all { s.saved == "intent", s.chain == "none",
    s' = s.with("saved", "submitted").with("chain", "pending").with("view", "idle") }
  // The wallet's answer is lost: the intent stays until the payer enters the
  // signature or clears the request after checking wallet activity.
  action clearUnsent = all { s.saved == "intent", s.chain == "none",
    s' = s.with("saved", "none").with("view", "idle") }
  action finalize(ok) = all { s.chain == "pending", s' = s.with("chain", if (ok) "finalized" else "failed") }
  // The check reads the finalized outcome through the API.
  action check = all { s.saved == "submitted", s.chain != "pending",
    s' = s.with("saved", "none").with("deposited", s.chain == "finalized")
      .with("chain", if (s.chain == "failed") "none" else s.chain) }
  action reload = s' = s.with("wallet", false).with("view", "idle")
  // After an hour an unrecorded deposit did not count; the form returns.
  action recordWaitEnds = all { s.deposited, s' = s.with("deposited", false).with("chain", "none") }

  action step = { nondet b = Set(true, false).oneOf()
    any { offer(b), setHonest(b), setReady(b), setNonceFree(b), payElsewhere, connect, review, confirm,
      decline, walletSends, clearUnsent, finalize(b), check, reload, recordWaitEnds, s' = s } }

  val invariant = all {
    // One stored request at most, and the wallet is asked only with it saved.
    s.saved == "intent" implies s.prompts >= 1,
    // A submitted request always has its transaction.
    s.saved == "submitted" implies s.chain != "none",
    // Nothing is reviewed while a request is stored or a deposit awaits its record.
    s.view == "reviewed" implies (s.saved == "none" and not(s.deposited)),
    // A deposit counts in this tab only once its transaction is final.
    s.deposited implies s.chain == "finalized",
    s.tries <= 2
  }

  run notOfferedAsksNothingTest = init.then(connect).then(review.fail())
  run chainRefusalLeavesNothingToSignTest = init.then(offer(true)).then(connect).then(setReady(false))
    .then(review).expect(s.view == "idle").then(confirm.fail())
  run foreignPlanIsRefusedTest = init.then(offer(true)).then(connect).then(setHonest(false)).then(review)
    .expect(s.refusedPlan and s.view == "idle").then(confirm.fail())
  run usedNonceIsRedrawnTest = init.then(offer(true)).then(connect).then(setNonceFree(false)).then(review)
    .expect(s.view == "idle" and s.tries == 1 and s.nonceFree).then(review)
    .expect(s.view == "reviewed" and s.prompts == 0)
  run paidElsewhereAsksNoWalletTest = init.then(offer(true)).then(connect).then(review).then(payElsewhere)
    .then(confirm).expect(s.view == "idle" and s.prompts == 0 and s.saved == "none")
  run depositTest = init.then(offer(true)).then(connect).then(review).then(confirm)
    .expect(s.saved == "intent" and s.prompts == 1).then(walletSends).then(finalize(true)).then(check)
    .expect(s.deposited and s.saved == "none" and invariant).then(review.fail())
  run declineClearsTheIntentTest = init.then(offer(true)).then(connect).then(review).then(confirm)
    .then(decline).expect(s.saved == "none" and s.chain == "none").then(review)
    .expect(s.view == "reviewed")
  run pendingIsNotSentAgainTest = init.then(offer(true)).then(connect).then(review).then(confirm)
    .then(walletSends).then(review.fail())
  run failedTransactionReturnsTheFormTest = init.then(offer(true)).then(connect).then(review).then(confirm)
    .then(walletSends).then(finalize(false)).then(check)
    .expect(not(s.deposited) and s.saved == "none" and s.chain == "none").then(review)
    .expect(s.view == "reviewed")
  run reloadKeepsTheStoredRequestTest = init.then(offer(true)).then(connect).then(review).then(confirm)
    .then(walletSends).then(reload).expect(s.saved == "submitted").then(finalize(true)).then(check)
    .expect(s.deposited and invariant)
}
