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
// A run first reconciles every open live row; a row it cannot settle joins
// the run's `blocked` set (core.ts). The candidate loop then visits each
// token once and skips a blocked token. Signing checks only the run's signer
// and that set, not the ghost conditions: `signedOutsideLive` and
// `signedWhileOpen` record what the signature actually saw, so a stale
// blocked set or a second visit would violate the invariant.
//
// Bounds: one token slot (a new conversion replaces a terminal row), at most
// two same-nonce replacements (signed_send models the fee arithmetic).
module fee_conversion {
  type S = { mode: str, network: str, lease: bool, runMode: str, signer: bool,
    row: str, rowMode: str, replacements: int, bytesRetained: bool,
    signedOutsideLive: bool, signedWhileOpen: bool, received: bool,
    runPhase: str, blocked: bool, visited: bool }
  var s: S
  pure val Open = Set("submitted", "unknown", "quoted")
  // openRows reads live rows only: a dry_run quote never blocks a token.
  pure def blocking(st: S): bool = Open.contains(st.row) and st.rowMode == "live"
  action initWith(network: str, row: str): bool = s' = { mode: "off", network: network,
    lease: false, runMode: "none", signer: false, row: row,
    rowMode: if (row == "none") "none" else "live", replacements: 0,
    bytesRetained: Set("submitted", "unknown").contains(row),
    signedOutsideLive: false, signedWhileOpen: false, received: false,
    runPhase: "none", blocked: false, visited: false }
  action init = { nondet n = Set("base", "robinhood").oneOf()
    nondet r = Set("none", "quoted").oneOf()
    initWith(n, r) }
  // Configuration may change at any time, including during a send.
  action configure(mode: str): bool = s' = s.with("mode", mode)
  action startRun = all { not(s.lease), s.mode != "off",
    s' = s.with("lease", true).with("runMode", s.mode)
      .with("signer", s.mode == "live" and s.network != "robinhood")
      .with("runPhase", "reconcile").with("blocked", false).with("visited", false) }
  action endRun = all { s.lease, s' = s.with("lease", false).with("runMode", "none").with("signer", false)
    .with("runPhase", "none") }
  // After reconciliation: an open live row left unsettled blocks its token.
  action beginCandidates = all { s.lease, s.runPhase == "reconcile",
    s' = s.with("runPhase", "candidates").with("blocked", blocking(s)) }
  val reconciling = s.lease and s.runPhase == "reconcile"
  // The candidate loop visits the token once, unless it is blocked.
  val visiting = s.lease and s.runPhase == "candidates" and not(s.blocked) and not(s.visited)
  // Reconciliation, in any non-off run.
  action abandonQuoted = all { reconciling, s.row == "quoted", s.rowMode == "live",
    s' = s.with("row", "failed") }
  action observeFinalized = all { reconciling, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", "finalized").with("received", true) }
  action observeFailed = all { reconciling, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", "failed") }
  action rebroadcast(ok: bool): bool = all { reconciling, Set("submitted", "unknown").contains(s.row),
    s' = s.with("row", if (ok) "submitted" else "unknown") }
  // replaceSend: the run's signer and a live row (deps.mode, row.mode).
  action replaceFee = all { reconciling, Set("submitted", "unknown").contains(s.row),
    s.signer, s.rowMode == "live", s.replacements < 2,
    s' = s.with("replacements", s.replacements + 1).with("row", "submitted")
      .with("signedOutsideLive", s.signedOutsideLive or s.runMode != "live") }
  // Quote outcomes; blocked while the token has an open row.
  action evaluate(outcome: str): bool = all { visiting, s.network != "robinhood",
    Set("no_route", "skipped", "pending").contains(outcome),
    s' = s.with("row", outcome).with("rowMode", s.runMode).with("replacements", 0)
      .with("bytesRetained", false).with("received", false).with("visited", true) }
  action dryQuote = all { visiting, s.runMode == "dry_run", s.network != "robinhood",
    s' = s.with("visited", true).with("row", "quoted").with("rowMode", "dry_run")
      .with("replacements", 0).with("bytesRetained", false).with("received", false) }
  // Journal the signed intent as submitted, then broadcast; a broadcast error
  // leaves it unknown with the bytes kept.
  action send(broadcastOk: bool): bool = all { visiting, s.signer,
    s' = s.with("visited", true).with("row", if (broadcastOk) "submitted" else "unknown").with("rowMode", "live")
      .with("replacements", 0).with("bytesRetained", true).with("received", false)
      .with("signedOutsideLive", s.signedOutsideLive or s.runMode != "live")
      .with("signedWhileOpen", s.signedWhileOpen or blocking(s)) }
  action prepareFailed = all { visiting, s.signer,
    s' = s.with("visited", true).with("row", "failed").with("rowMode", "live").with("bytesRetained", false)
      .with("replacements", 0).with("received", false) }
  action step = any { configure("off"), configure("dry_run"), configure("live"), startRun, endRun,
    beginCandidates,
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
    not(s.lease) implies (s.runMode == "none" and s.runPhase == "none") }
  run dryRunCannotSignTest = initWith("base", "none").then(configure("dry_run")).then(startRun)
    .then(beginCandidates).then(dryQuote).expect(s.row == "quoted" and s.rowMode == "dry_run")
  run dryRunHasNoSignerTest = initWith("base", "none").then(configure("dry_run")).then(startRun)
    .then(beginCandidates).then(send(true).fail())
  run robinhoodRetainedTest = initWith("robinhood", "none").then(configure("live")).then(startRun)
    .expect(not(s.signer)).then(beginCandidates).then(evaluate("skipped").fail())
  run offRunsNothingTest = initWith("base", "none").then(startRun.fail())
  run convertedTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(true)).then(endRun).then(startRun).then(observeFinalized)
    .expect(s.received and invariant)
  // A send journaled in live survives a switch to off with its bytes.
  run offDuringSendRetainsTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(false)).then(configure("off")).then(endRun).then(startRun.fail())
  run offDuringSendStateTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(false)).then(configure("off")).then(endRun)
    .expect(s.row == "unknown" and s.bytesRetained and invariant)
  // The run keeps its start mode; the switch applies to the next run.
  run modeChangeMidRunTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(configure("dry_run")).then(beginCandidates).then(send(true))
    .expect(s.row == "submitted" and invariant)
    .then(endRun).then(startRun).expect(s.runMode == "dry_run" and not(s.signer))
  // dry_run reconciles and rebroadcasts exact bytes but signs no replacement.
  run dryRunReconcilesOnlyTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(false)).then(endRun).then(configure("dry_run")).then(startRun)
    .then(rebroadcast(true)).expect(s.row == "submitted" and s.replacements == 0)
    .then(replaceFee.fail())
  run liveReplacesTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(true)).then(endRun).then(startRun)
    .then(replaceFee).then(replaceFee).expect(s.replacements == 2 and invariant).then(replaceFee.fail())
  // The candidate loop visits a token once per run.
  run oneVisitPerRunTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(true)).then(send(true).fail())
  // An open row the next run cannot settle blocks a new signature.
  run openRowBlocksNewSendTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(false)).then(endRun).then(startRun).then(rebroadcast(false))
    .then(beginCandidates).expect(s.blocked).then(send(true).fail())
  // A row settled during reconciliation frees the token in the same run.
  run settledRowUnblocksTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(send(true)).then(endRun).then(startRun).then(observeFinalized)
    .then(beginCandidates).then(send(true)).expect(s.row == "submitted" and invariant)
  run legacyQuotedClosedTest = initWith("base", "quoted").then(configure("dry_run")).then(startRun)
    .then(abandonQuoted).expect(s.row == "failed" and invariant)
  run pendingDustTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(beginCandidates).then(evaluate("pending")).then(endRun).then(startRun)
    .then(beginCandidates).then(send(true)).expect(s.row == "submitted" and invariant)
  run staleLeaseRefusedTest = initWith("base", "none").then(configure("live")).then(startRun)
    .then(endRun).then(send(true).fail())
}
// @source workers/fee-converter/dry-run.ts
