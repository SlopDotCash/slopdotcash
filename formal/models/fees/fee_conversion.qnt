// @source workers/fee-converter/verified-solana-wire.ts
// @source migrations/0022_fee_conversions.sql
// @source migrations/0076_fee_conversion_pending.sql
// @source migrations/0078_fee_conversion_transaction_size.sql
// @source migrations/0082_fee_claim_journal.sql
// @source migrations/0088_fee_approval_journal.sql
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/config.ts
// @source workers/fee-converter/index.ts
// @source workers/fee-converter/store.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/solana.ts
// @source backend/fee-conversions/handler.ts
// One token's conversion rows on one network across runs and mode changes.
//
// The mode is configuration (FEE_CONVERTER_MODE) read once per run by
// runOnce; a run keeps the mode it started with, and a change applies to the
// next run. `off` runs nothing, including reconciliation, so an open send
// stays submitted or unknown with its bytes retained until a later run.
// `dry_run` loads no key: it reconciles and may rebroadcast exact journaled
// bytes, but never signs a send or a fee replacement. `live` signs only when
// the network has a verified USDC target; Robinhood Chain retains received
// assets and never quotes or signs.
//
// Row states (migration 0088): quoted, pending, skipped, no_route, submitted,
// unknown, finalized, failed. Current code writes a live `quoted` row only in
// legacy data (reconcile closes it as failed); dry_run writes `quoted`
// records, which openRows ignores. The pending-token index allows one submitted/unknown row per token,
// so no new intent is signed while one is open. Every journal write is fenced
// by the network lease. Approval rows follow the same states and are omitted.
//
// Bounds: one token slot (a new conversion replaces a terminal row), at most
// two same-nonce replacements (signed_send models the fee arithmetic).
module fee_conversion {
  type S = { mode: str, network: str, lease: bool, runMode: str, signer: bool,
    row: str, rowMode: str, replacements: int, bytesRetained: bool,
    signedOutsideLive: bool, signedWhileOpen: bool, received: bool }
  var s: S
  pure val Open = Set("submitted", "unknown", "quoted")
  // openRows reads live rows only: a dry_run quote never blocks a token.
  pure def blocking(st: S): bool = Open.contains(st.row) and st.rowMode == "live"
  action initWith(network: str, row: str): bool = s' = { mode: "off", network: network,
    lease: false, runMode: "none", signer: false, row: row,
    rowMode: if (row == "none") "none" else "live", replacements: 0,
    bytesRetained: Set("submitted", "unknown").contains(row),
    signedOutsideLive: false, signedWhileOpen: false, received: false }
  action init = { nondet n = Set("base", "robinhood").oneOf()
    nondet r = Set("none", "quoted").oneOf()
    initWith(n, r) }
  // Configuration may change at any time, including during a send.
  action configure(mode: str): bool = s' = s.with("mode", mode)
  action startRun = all { not(s.lease), s.mode != "off",
    s' = s.with("lease", true).with("runMode", s.mode)
      .with("signer", s.mode == "live" and s.network != "robinhood") }
  action endRun = all { s.lease, s' = s.with("lease", false).with("runMode", "none").with("signer", false) }
  // Reconciliation, in any non-off run.
  action abandonQuoted = all { s.lease, s.row == "quoted", s.rowMode == "live",
    s' = s.with("row", "failed") }
  action observeFinalized = all { s.lease, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", "finalized").with("received", true) }
  action observeFailed = all { s.lease, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", "failed") }
  action rebroadcast(ok: bool): bool = all { s.lease, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", if (ok) "submitted" else "unknown") }
  action replaceFee = all { s.lease, Set("submitted", "unknown").contains(s.row),
    s.runMode == "live", s.signer, s.rowMode == "live", s.replacements < 2,
    s' = s.with("replacements", s.replacements + 1).with("row", "submitted")
      .with("signedOutsideLive", s.signedOutsideLive or s.runMode != "live") }
  // Quote outcomes; blocked while the token has an open row.
  action evaluate(outcome: str): bool = all { s.lease, s.network != "robinhood",
    not(blocking(s)), Set("no_route", "skipped", "pending").contains(outcome),
    s' = s.with("row", outcome).with("rowMode", s.runMode).with("replacements", 0)
      .with("bytesRetained", false).with("received", false) }
  action dryQuote = all { s.lease, s.runMode == "dry_run", s.network != "robinhood",
    not(blocking(s)), s' = s.with("row", "quoted").with("rowMode", "dry_run")
      .with("replacements", 0).with("bytesRetained", false).with("received", false) }
  // Journal the signed intent as submitted, then broadcast; a broadcast error
  // leaves it unknown with the bytes kept.
  action send(broadcastOk: bool): bool = all { s.lease, s.runMode == "live", s.signer,
    s.network != "robinhood", not(blocking(s)),
    s' = s.with("row", if (broadcastOk) "submitted" else "unknown").with("rowMode", "live")
      .with("replacements", 0).with("bytesRetained", true).with("received", false)
      .with("signedOutsideLive", s.signedOutsideLive or s.runMode != "live")
      .with("signedWhileOpen", s.signedWhileOpen or blocking(s)) }
  action prepareFailed = all { s.lease, s.runMode == "live", s.signer, not(blocking(s)),
    s' = s.with("row", "failed").with("rowMode", "live").with("bytesRetained", false)
      .with("replacements", 0).with("received", false) }
  action step = any { configure("off"), configure("dry_run"), configure("live"), startRun, endRun,
    abandonQuoted, observeFinalized, observeFailed, rebroadcast(true), rebroadcast(false), replaceFee,
    evaluate("no_route"), evaluate("skipped"), evaluate("pending"), dryQuote, send(true), send(false),
    prepareFailed, s' = s }
  val invariant = all {
    not(s.signedOutsideLive), not(s.signedWhileOpen),
    s.signer implies (s.runMode == "live" and s.network != "robinhood"),
    s.network == "robinhood" implies (s.row == "none" or s.row == "quoted" or s.row == "failed"),
    Set("submitted", "unknown").contains(s.row) implies (s.rowMode == "live" and s.bytesRetained),
    s.rowMode == "dry_run" implies not(Set("submitted", "unknown", "finalized").contains(s.row)),
    s.received implies s.row == "finalized",
    s.replacements > 0 implies (s.rowMode == "live" and s.bytesRetained),
    not(s.lease) implies s.runMode == "none" }
  run dryRunCannotSignTest = initWith("base", "none").then(configure("dry_run")).then(startRun)
    .then(dryQuote).expect(s.row == "quoted" and s.rowMode == "dry_run").then(send(true).fail())
  run robinhoodRetainedTest = initWith("robinhood", "none").then(configure("live")).then(startRun)
    .expect(not(s.signer)).then(evaluate("skipped").fail())
  run offRunsNothingTest = initWith("base", "none").then(startRun.fail())
  run convertedTest = initWith("base", "none").then(configure("live")).then(startRun).then(send(true))
    .then(observeFinalized).expect(s.received and invariant)
  // A send journaled in live survives a switch to off with its bytes.
  run offDuringSendRetainsTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(send(false)).then(configure("off")).then(endRun).then(startRun.fail())
  run offDuringSendStateTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(send(false)).then(configure("off")).then(endRun)
    .expect(s.row == "unknown" and s.bytesRetained and invariant)
  // The run keeps its start mode; the switch applies to the next run.
  run modeChangeMidRunTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(configure("dry_run")).then(send(true)).expect(s.row == "submitted" and invariant)
    .then(endRun).then(startRun).expect(s.runMode == "dry_run" and not(s.signer))
  // dry_run reconciles and rebroadcasts exact bytes but signs no replacement.
  run dryRunReconcilesOnlyTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(send(false)).then(endRun).then(configure("dry_run")).then(startRun)
    .then(rebroadcast(true)).expect(s.row == "submitted" and s.replacements == 0)
    .then(replaceFee.fail())
  run liveReplacesTest = initWith("base", "none").then(configure("live")).then(startRun).then(send(true))
    .then(replaceFee).then(replaceFee).expect(s.replacements == 2 and invariant).then(replaceFee.fail())
  run openRowBlocksNewSendTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(send(true)).then(send(true).fail())
  run legacyQuotedClosedTest = initWith("base", "quoted").then(configure("dry_run")).then(startRun)
    .then(abandonQuoted).expect(s.row == "failed" and invariant)
  run pendingDustTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(evaluate("pending")).then(send(true)).expect(s.row == "submitted" and invariant)
  run staleLeaseRefusedTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(endRun).then(send(true).fail())
}
// @source workers/fee-converter/dry-run.ts
