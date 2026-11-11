// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/buyback-store.ts
// @source workers/fee-converter/debridge.ts
// @source workers/fee-converter/debridge-solana.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/solana.ts
// @source workers/fee-converter/native-gas.ts
// @source migrations/0121_fee_buyback.sql
// @evidence workers/fee-converter/buyback.test.ts
// @evidence workers/fee-converter/native-gas.test.ts
// @evidence workers/fee-converter/buyback-solana-cost.test.ts
// @evidence workers/fee-converter/buyback.integration.ts
// @evidence workers/fee-converter/buyback-solana.integration.ts
// One bridge order from its proposal to its proven outcome, across the
// source network's journal, the deBridge DLN contracts and the Robinhood
// Chain run that credits the arrival.
//
// The API only proposes an order. `proposal` is what it returned: the honest
// order, one that pays another receiver, one with a different amount, one
// that reserves an unknown taker, or one that carries an external call. The
// Worker signs only bytes it has checked field by field against its own
// decision (checkedDlnOrder, checkedSolanaDlnOrder). `checked` belongs to the
// exact bytes of one proposal: a new proposal clears it, and signing reads
// only `checked`. `signedBad` records what was really signed, so a check that
// outlived its bytes would violate the invariant.
//
// A run keeps the mode it started with (`runMode`); a configuration change
// applies to the next run.
// The total cost can change after quoting. Each signature checks the final
// native ceiling, fixed protocol fee and spread again. The EVM bound includes
// prior approvals and failed attempts since the last deposit, grouping nonce
// replacements by their maximum, and an approval leaves room for the order.
// Solana adds failed attempts to its complete separate order ceiling, with
// exact wallet/mint identity and a fresh nonce sequence. `costOk` abstracts this
// checked integer inequality; a price change never reuses an earlier verdict.
//
// Journal row (fee_conversions, kind bridge): none, approval (EVM only: the
// exact allowance is its own send), submitted, unknown, finalized (the
// deposit is on chain) or failed (reverted, or proven expired on Solana).
// Chain truth is separate from what the Worker has observed: `src` is the
// order in DlnSource (none, created, unlocked by the taker, refunded) and
// `dst` is the order in DlnDestination (none, fulfilled, cancelSent). The
// protocol makes fulfilled and cancelSent exclusive. A cancellation is an
// owner action outside the Worker; the Worker never signs one.
//
// Outcome (fee_bridge_outcomes, one row per deposit by primary key): none,
// arrived (written by the Robinhood run, under its lease, after reading
// fulfilled at a finalized block) or refunded (written by the source run,
// under its lease, after reading the refund at a finalized block). A read
// can fail or lag; a missing answer never becomes an outcome.
//
// Bounds: one order, one retry after a failed send, leases as booleans.
module buyback_bridge_order {
  type S = {
    mode: str, runMode: str, proposal: str, checked: bool, row: str, bytes: bool,
    approved: bool, attempts: int, src: str, dst: str, outcome: str, credited: int,
    released: int, sourceLease: bool, robinhoodLease: bool, signedBad: bool, alert: bool,
    costOk: bool, signedOverCost: bool, replacements: int
  }
  var s: S
  pure val Proposals = Set("honest", "wrongReceiver", "wrongAmount", "unknownTaker", "externalCall")
  pure val Open = Set("approval", "submitted", "unknown")
  action init = s' = { mode: "off", runMode: "none", proposal: "none", checked: false,
    row: "none", bytes: false, approved: false, attempts: 0, src: "none", dst: "none",
    outcome: "none", credited: 0, released: 0, sourceLease: false, robinhoodLease: false,
    signedBad: false, alert: false, costOk: true, signedOverCost: false, replacements: 0 }

  // Configuration and leases change independently of the order.
  action configure(mode: str): bool = s' = s.with("mode", mode)
  action priceCost(ok: bool): bool = s' = s.with("costOk", ok)
  action takeSourceLease = all { not(s.sourceLease), s.mode != "off",
    s' = s.with("sourceLease", true).with("runMode", s.mode) }
  // A run that ends drops its unsigned proposal with it.
  action dropSourceLease = all { s.sourceLease, s' = s.with("sourceLease", false)
    .with("runMode", "none").with("proposal", "none").with("checked", false) }
  action takeRobinhoodLease = all { not(s.robinhoodLease), s.mode != "off", s' = s.with("robinhoodLease", true) }
  action dropRobinhoodLease = all { s.robinhoodLease, s' = s.with("robinhoodLease", false) }

  // The provider answers; nothing is trusted yet.
  action propose(kind: str): bool = all { s.sourceLease, s.row == "none" or s.row == "failed",
    s.attempts < 2, s' = s.with("proposal", kind).with("checked", false) }
  // The decoded order equals the Worker's decision, field by field.
  action check = all { s.sourceLease, s.proposal == "honest", s' = s.with("checked", true) }
  // A dry run records the decision and never signs.
  action recordDryRun = all { s.sourceLease, s.runMode == "dry_run", s.checked,
    s' = s.with("proposal", "none").with("checked", false) }
  // A proposal that differs from the Worker's decision is refused before signing.
  action refuse = all { s.sourceLease, s.proposal != "none", s.proposal != "honest",
    s' = s.with("proposal", "none").with("checked", false) }
  // EVM: the exact approval is journaled and sent first.
  action signApproval = all { s.sourceLease, s.runMode == "live", s.checked, s.costOk,
    not(s.approved), Set("none", "failed").contains(s.row),
    s' = s.with("row", "approval").with("bytes", true).with("proposal", "none")
      .with("checked", false).with("signedOverCost", s.signedOverCost or not(s.costOk)) }
  action approvalFinalized = all { s.sourceLease, s.row == "approval",
    s' = s.with("row", "none").with("bytes", false).with("approved", true) }
  // The order is journaled with its terms before it is broadcast.
  action signOrder = all { s.sourceLease, s.runMode == "live", s.checked, s.approved, s.costOk,
    Set("none", "failed").contains(s.row),
    s' = s.with("row", "submitted").with("bytes", true).with("proposal", "none")
      .with("checked", false).with("attempts", s.attempts + 1)
      .with("signedBad", s.signedBad or s.proposal != "honest")
      .with("signedOverCost", s.signedOverCost or not(s.costOk)) }
  // Same-nonce replacements preserve the order and recheck the total cost.
  action replace = all { s.sourceLease, s.runMode == "live", Open.contains(s.row),
    s.costOk, s.replacements < 2,
    s' = s.with("replacements", s.replacements + 1)
      .with("signedOverCost", s.signedOverCost or not(s.costOk)) }
  action loseResponse = all { s.row == "submitted", s' = s.with("row", "unknown") }
  // The chain includes the journaled bytes, whatever the Worker knows.
  action included = all { Set("submitted", "unknown").contains(s.row), s.src == "none",
    s' = s.with("src", "created") }
  // Reconciliation needs the lease and the finalized receipt of those bytes.
  action observeDeposit = all { s.sourceLease, Set("submitted", "unknown").contains(s.row),
    s.src != "none", s' = s.with("row", "finalized") }
  // A verified revert or proven expiry: nothing moved, and the share is released.
  action observeFailure = all { s.sourceLease, Set("submitted", "unknown").contains(s.row),
    s.src == "none", s' = s.with("row", "failed").with("bytes", false) }

  // The destination side. A taker fills, or the owner cancels an unfilled order.
  action fill = all { s.src == "created", s.dst == "none", s' = s.with("dst", "fulfilled") }
  action unlock = all { s.src == "created", s.dst == "fulfilled", s' = s.with("src", "unlocked") }
  action ownerCancels = all { s.src == "created", s.dst == "none", s' = s.with("dst", "cancelSent") }
  action refundClaimed = all { s.src == "created", s.dst == "cancelSent", s' = s.with("src", "refunded") }

  // The Robinhood run credits a fulfilled order once.
  action creditArrival = all { s.robinhoodLease, s.row == "finalized", s.outcome == "none",
    s.dst == "fulfilled", s' = s.with("outcome", "arrived").with("credited", s.credited + 1) }
  // The source run releases a refunded deposit once.
  action recordRefund = all { s.sourceLease, s.row == "finalized", s.outcome == "none",
    s.src == "refunded", s' = s.with("outcome", "refunded").with("released", s.released + 1) }
  // An order nobody fills is reported; it stays in transit.
  action reportUnfilled = all { s.robinhoodLease, s.row == "finalized", s.outcome == "none",
    s.dst != "fulfilled", s' = s.with("alert", true) }

  action step = {
    nondet mode = Set("off", "dry_run", "live").oneOf()
    nondet kind = Proposals.oneOf()
    nondet cost = Set(false, true).oneOf()
    any { configure(mode), takeSourceLease, dropSourceLease, takeRobinhoodLease, dropRobinhoodLease,
      propose(kind), check, recordDryRun, refuse, signApproval, approvalFinalized, signOrder, loseResponse,
      included, observeDeposit, observeFailure, fill, unlock, ownerCancels, refundClaimed,
      creditArrival, recordRefund, reportUnfilled, priceCost(cost), replace }
  }

  val invariant = all {
    // Only bytes checked against the Worker's own decision are ever signed.
    not(s.signedBad), not(s.signedOverCost), s.checked implies s.proposal == "honest",
    // An open or deposited send always keeps its exact signed bytes.
    Open.contains(s.row) or s.row == "finalized" implies s.bytes,
    // The chain holds an order only for journaled bytes.
    s.src != "none" implies s.bytes,
    // Fill and cancellation exclude each other, so do their consequences.
    not(s.dst == "fulfilled" and s.src == "refunded"),
    not(s.dst == "cancelSent" and s.src == "unlocked"),
    // One outcome per deposit: credited at most once, released at most once, never both.
    s.credited + s.released <= 1,
    s.outcome == "arrived" implies s.dst == "fulfilled" and s.credited == 1,
    s.outcome == "refunded" implies s.src == "refunded" and s.released == 1,
    s.outcome != "none" implies s.row == "finalized",
    // A deposit that is on chain is never recorded as failed.
    s.row == "failed" implies s.src == "none",
    s.attempts <= 2
  }

  // Scenarios.
  run changedCostRefusesApprovalTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(priceCost(false)).expect(invariant).then(signApproval.fail())
  run changedCostRefusesOrderTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized)
    .then(propose("honest")).then(check).then(priceCost(false)).expect(invariant).then(signOrder.fail())
  run changedCostRefusesReplacementTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized)
    .then(propose("honest")).then(check).then(signOrder).then(priceCost(false)).expect(invariant).then(replace.fail())
  run recoveredCostAllowsReplacementTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized)
    .then(propose("honest")).then(check).then(signOrder).then(priceCost(false)).then(priceCost(true)).then(replace)
    .expect(s.replacements == 1 and invariant)
  run filledOrderCreditsOnceTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(fill).then(takeRobinhoodLease)
    .then(creditArrival).expect(s.outcome == "arrived" and s.credited == 1 and invariant)
    .then(creditArrival.fail())
  run misdirectedProposalIsNeverSignedTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("wrongReceiver")).then(refuse).expect(s.row == "none" and not(s.bytes) and invariant)
    .then(signOrder.fail())
  run otherBadProposalsAreRefusedTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("externalCall")).then(refuse).then(propose("unknownTaker")).then(refuse)
    .then(propose("wrongAmount")).then(refuse).expect(s.row == "none" and invariant)
  run orderNeedsFinalApprovalTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(signOrder.fail())
  run dryRunSignsNothingTest = init.then(configure("dry_run")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(recordDryRun).expect(s.row == "none" and not(s.bytes) and invariant)
    .then(signApproval.fail())
  run lostResponseStillDepositsTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(loseResponse).then(included).then(observeDeposit)
    .expect(s.row == "finalized" and invariant).then(observeFailure.fail())
  run failedSendRetriesOnceTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(observeFailure).expect(s.row == "failed" and invariant)
    .then(propose("honest")).then(check).then(signOrder).then(included).then(observeDeposit)
    .expect(s.attempts == 2 and s.row == "finalized" and invariant)
  run unfilledOrderWaitsAndAlertsTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(takeRobinhoodLease)
    .then(reportUnfilled).expect(s.alert and s.outcome == "none" and s.credited == 0 and invariant)
    .then(creditArrival.fail())
  run cancelledOrderReleasesOnceTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(ownerCancels).then(refundClaimed)
    .then(recordRefund).expect(s.outcome == "refunded" and s.released == 1 and invariant)
    .then(recordRefund.fail())
  run cancellationInFlightIsNotARefundTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(ownerCancels)
    .then(recordRefund.fail())
  run cancelledOrderCannotArriveTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(ownerCancels).then(takeRobinhoodLease)
    .then(fill.fail())
  run outcomeNeedsItsLeaseTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(included).then(observeDeposit).then(fill).then(creditArrival.fail())
  run offStopsNewOrdersButKeepsBytesTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized).then(propose("honest"))
    .then(check).then(signOrder).then(dropSourceLease).then(configure("off"))
    .expect(s.row == "submitted" and s.bytes and invariant).then(takeSourceLease.fail())
  // A check never carries over to another proposal's bytes.
  run checkDoesNotOutliveItsBytesTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized)
    .then(propose("honest")).then(check).then(propose("wrongReceiver"))
    .expect(not(s.checked) and invariant).then(signOrder.fail())
  // A run keeps its mode: a configuration change applies to the next run.
  run runKeepsItsModeTest = init.then(configure("live")).then(takeSourceLease)
    .then(propose("honest")).then(check).then(signApproval).then(approvalFinalized)
    .then(configure("dry_run")).then(propose("honest")).then(check).then(signOrder)
    .expect(s.row == "submitted" and invariant)
}
