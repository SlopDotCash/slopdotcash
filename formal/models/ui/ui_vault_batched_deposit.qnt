// @source src/VaultActions.tsx
// @source src/lib/evm-vault-actions.ts
// @evidence tests/e2e/vault-actions.spec.ts
// One token deposit sent as a single atomic wallet request (EIP-5792): the
// approval and the deposit together. The request is offered only when the
// wallet already reports atomic support; "ready" (an account upgrade) and no
// support keep the two separate requests. A refused or declined request sent
// nothing and removes the saved record; an unclear reply keeps it. The
// wallet's own status is untrusted: it only names the transaction to read, and
// may say anything at any time. Funding counts only from a final block that
// carries the vault's matching deposit event. Abstracted: the event, amount
// and depositor predicates come from the real adapter; one request is modeled.
module ui_vault_batched_deposit {
  var s: { capability: str, offered: bool, record: str, sent: bool, block: str,
    reverted: bool, event: bool, report: str, verdict: str, funded: bool,
    separate: bool, requests: int }
  action start(capability: str, reverted: bool, event: bool): bool = s' = { capability: capability,
    offered: false, record: "none", sent: false, block: "none", reverted: reverted,
    event: event, report: "pending", verdict: "none", funded: false, separate: false,
    requests: 0 }
  action init = any {
    start("supported", false, true), start("supported", true, false),
    start("supported", false, false), start("ready", false, true), start("none", false, true) }
  // The review offers one request only for a wallet that is already atomic.
  action review = all { s.record == "none", s.verdict == "none",
    s' = s.with("offered", s.capability == "supported" and not(s.separate)) }
  action request = all { s.offered, s.record == "none", s.requests == 0,
    s' = s.with("record", "intent").with("requests", 1).with("offered", false) }
  action walletReturnsReference = all { s.record == "intent",
    s' = s.with("record", "reference").with("sent", true).with("block", "unmined") }
  action walletRefuses = all { s.record == "intent",
    s' = s.with("record", "none").with("separate", true) }
  action walletDeclines = all { s.record == "intent", s' = s.with("record", "none") }
  // The reply was lost after the prompt: the batch may or may not have been sent.
  action walletUnclear(sent: bool): bool = all { s.record == "intent",
    s' = s.with("record", "unclear").with("sent", sent)
      .with("block", if (sent) "unmined" else "none") }
  action mine = all { s.block == "unmined", s' = s.with("block", "included") }
  action replace = all { s.block == "included", s' = s.with("block", "unmined") }
  action finalize = all { s.block == "included", s' = s.with("block", "final") }
  // The wallet may report anything; nothing below trusts it for funding.
  action walletReports(report: str): bool = all { s.record == "reference", s' = s.with("report", report) }
  val proven = s.block == "final" and not(s.reverted) and s.event
  action readChain = s' = if (s.block != "final") s
    else if (s.reverted) s.with("record", "none").with("verdict", "failed")
    else if (not(s.event)) s
    else s.with("record", "none").with("verdict", "verified").with("funded", true)
  // A check with the wallet's reference, automatic or by the button.
  action checkReference = all { s.record == "reference",
    if (s.report == "pending") s' = s
    else if (s.report == "not-sent") s' = s.with("record", "none").with("verdict", "not-sent")
    else all { s' = s.with("record", "named") } }
  action checkNamed = all { s.record == "named", readChain }
  // After an unclear reply the owner enters the hash from wallet activity.
  action checkEnteredHash = all { s.record == "unclear", s.sent, readChain }
  action step = any { review, request, walletReturnsReference, walletRefuses, walletDeclines,
    walletUnclear(true), walletUnclear(false), mine, replace, finalize,
    walletReports("pending"), walletReports("confirmed"), walletReports("not-sent"),
    checkReference, checkNamed, checkEnteredHash, s' = s }
  val invariant = all {
    s.funded implies (proven and s.verdict == "verified" and s.sent),
    s.requests > 0 implies s.capability == "supported",
    s.separate implies (not(s.sent) and s.record == "none"),
    s.requests <= 1,
    s.verdict == "verified" implies s.funded,
    Set("verified", "failed").contains(s.verdict) implies s.block == "final"
  }
  run oneRequestTest = start("supported", false, true).then(review).then(request)
    .then(walletReturnsReference).then(walletReports("confirmed")).then(mine)
    .then(checkReference).then(checkNamed).expect(s.record == "named" and not(s.funded))
    .then(finalize).then(checkNamed).expect(s.funded and s.record == "none")
  run readyWalletKeepsTwoRequestsTest = start("ready", false, true).then(review)
    .expect(not(s.offered) and s.requests == 0)
  run refusedTest = start("supported", false, true).then(review).then(request).then(walletRefuses)
    .then(review).expect(s.separate and not(s.offered) and not(s.sent) and s.record == "none")
  run walletStatusIsNotProofTest = start("supported", false, true).then(review).then(request)
    .then(walletReturnsReference).then(walletReports("confirmed")).then(checkReference)
    .then(checkNamed).expect(not(s.funded) and s.record == "named")
  run revertedBatchTest = start("supported", true, false).then(review).then(request)
    .then(walletReturnsReference).then(mine).then(finalize).then(walletReports("confirmed"))
    .then(checkReference).then(checkNamed).expect(s.verdict == "failed" and not(s.funded))
  run unclearReplyTest = start("supported", false, true).then(review).then(request)
    .then(walletUnclear(true)).then(mine).then(finalize).then(checkEnteredHash).expect(s.funded)
}
