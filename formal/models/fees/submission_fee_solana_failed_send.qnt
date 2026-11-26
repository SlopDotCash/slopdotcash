// @source workers/submission-fee/solana-core.ts
// @source workers/submission-fee/solana.ts
// @source workers/submission-fee/core.ts
// @source workers/submission-fee/store.ts
// @source workers/submission-fee/index.ts
// @evidence workers/submission-fee/solana.test.ts
// @evidence workers/submission-fee/submission-fee.test.ts
// A Solana resolve transaction that landed and failed (operator decision,
// 26 November 2026). Two due refunds: X, whose payer closes and reopens
// their token account at will (`xOpen`), and Y, an honest one. A resolve
// transaction of both is all or nothing. The Worker simulates against the
// confirmed bank right before signing, so it signs for X only while the
// account is open; the payer can still close it before the block.
//
// `flight` is the one send in flight: "both", "x", "y" or "none". `tainted`
// says a send of both landed and failed: from then on each goes alone, the
// lower id (X) first. `xAlone` says X's own single send landed and failed:
// X is parked (`xParked`, on day `parkedDay`), looked at again only on a
// later day and while its account is open, and from then on goes after Y.
// `day` counts UTC days, bounded at 2. `batchFails` and `singleFails` count
// the network fees paid for failed sends. Signing, the journal, expiry and
// the proof of a settlement are the models submission_fee_send and
// submission_fee_solana_deposit; the lamport ceilings are theirs too.
//
// `evm`, `solanaMode`, `solanaConfig` and the two results are one run of the
// whole Worker: a Solana configuration that cannot be read fails the Solana
// ledger only, and the EVM ledgers still run.
module submission_fee_solana_failed_send {
  var s: { xOpen: bool, x: str, y: str, flight: str, tainted: bool, xAlone: bool, xParked: bool,
    parkedDay: int, day: int, batchFails: int, singleFails: int,
    evm: bool, solanaMode: str, solanaConfig: bool, evmResult: str, solanaResult: str }
  action init = s' = { xOpen: true, x: "due", y: "due", flight: "none", tainted: false, xAlone: false,
    xParked: false, parkedDay: 0, day: 0, batchFails: 0, singleFails: 0,
    evm: true, solanaMode: "off", solanaConfig: true, evmResult: "none", solanaResult: "none" }

  // The payer of X closes or reopens their token account. Not the Worker's doing.
  action setOpen(v) = all { s.xOpen != v, s' = s.with("xOpen", v) }
  action nextDay = all { s.day < 2, s' = s.with("day", s.day + 1) }

  val xReady = s.x == "due" and not(s.xParked)
  val yReady = s.y == "due"
  // Before any failed send, everything due goes together.
  action signBoth = all { s.flight == "none", not(s.tainted), xReady, yReady, s.xOpen,
    s' = s.with("flight", "both") }
  // The simulation shows X's account closed: X is parked before anything is
  // signed, as any unusable destination is, and Y goes without it.
  action parkUnusable = all { s.flight == "none", xReady, not(s.xOpen),
    s' = s.with("xParked", true).with("parkedDay", s.day) }
  // X alone: when no send may hold both, and X is first in line. A deposit
  // whose own send failed is first only when nothing else is due.
  action signX = all { s.flight == "none", xReady, s.xOpen,
    s.tainted or not(yReady), not(s.xAlone) or not(yReady),
    s' = s.with("flight", "x") }
  action signY = all { s.flight == "none", yReady,
    not(xReady) or (s.tainted and s.xAlone),
    s' = s.with("flight", "y") }
  // The transaction lands. One that holds X fails whole when X's account
  // is closed in that block.
  action land = all { s.flight != "none",
    if (s.flight == "y") s' = s.with("y", "refunded").with("flight", "none")
    else if (s.xOpen)
      s' = s.with("x", "refunded").with("y", if (s.flight == "both") "refunded" else s.y).with("flight", "none")
    else if (s.flight == "both")
      s' = s.with("flight", "none").with("tainted", true).with("batchFails", s.batchFails + 1)
    else s' = s.with("flight", "none").with("xAlone", true).with("xParked", true)
      .with("parkedDay", s.day).with("singleFails", s.singleFails + 1) }
  // A day later the parked deposit is simulated alone and returns to the
  // queue only when its payout would go through.
  action recheck = all { s.flight == "none", s.xParked, s.day > s.parkedDay, s.xOpen,
    s' = s.with("xParked", false) }

  // One run of the whole Worker, with the Solana ledger's switch and whether
  // its own configuration can be read.
  action configure(evm, mode, ok) = all { Set("off", "dry_run", "live").contains(mode),
    s' = s.with("evm", evm).with("solanaMode", mode).with("solanaConfig", ok)
      .with("evmResult", "none").with("solanaResult", "none") }
  action runWorker = s' = s.with("evmResult", if (s.evm) "ran" else "off")
    .with("solanaResult", if (s.solanaMode == "off") "off"
      else if (s.solanaConfig) "ran" else "error")

  action step = { nondet a = Set(true, false).oneOf() nondet b = Set(true, false).oneOf()
    nondet m = Set("off", "dry_run", "live").oneOf()
    any { setOpen(a), nextDay, signBoth, parkUnusable, signX, signY, land, recheck,
      configure(a, m, b), runWorker, s' = s } }

  val invariant = all {
    // After a send of both landed and failed, no send holds both again.
    s.tainted implies s.flight != "both",
    // At most one send of both ever fails, and X's own send fails at most
    // once a day: the fees an account-closing payer can burn are bounded.
    s.batchFails <= 1, s.singleFails <= s.day + 1,
    // A parked deposit is still due and is in no send.
    s.xParked implies (s.x == "due" and s.flight != "x" and s.flight != "both"),
    // A send in flight carries only deposits still due.
    s.flight == "y" implies s.y == "due", s.flight == "x" implies s.x == "due",
    s.flight == "both" implies (s.x == "due" and s.y == "due"),
    // A Solana configuration error never stops the EVM ledgers.
    (s.solanaResult == "error" and s.evm) implies s.evmResult == "ran"
  }

  run togetherWhenNothingFailedTest = init.then(signBoth).then(land)
    .expect(s.x == "refunded" and s.y == "refunded" and s.batchFails == 0 and invariant)
  // The attack: closed in the block of every send that holds X.
  run failedBatchThenSinglesTest = init.then(signBoth).then(setOpen(false)).then(land)
    .expect(s.tainted and s.y == "due" and s.batchFails == 1).then(setOpen(true))
    .then(signBoth.fail())
  run badOneIsParkedOthersRefundedTest = init.then(signBoth).then(setOpen(false)).then(land).then(setOpen(true))
    .then(signX).then(setOpen(false)).then(land)
    .expect(s.xParked and s.xAlone and s.singleFails == 1 and invariant)
    .then(setOpen(true)).then(signY).then(setOpen(false)).then(land)
    .expect(s.y == "refunded" and s.x == "due" and invariant)
  run parkedWaitsADayTest = init.then(signBoth).then(setOpen(false)).then(land).then(setOpen(true))
    .then(signX).then(setOpen(false)).then(land).then(setOpen(true))
    .then(recheck.fail())
  run parkedRetriedAfterADayTest = init.then(signBoth).then(setOpen(false)).then(land).then(setOpen(true))
    .then(signX).then(setOpen(false)).then(land).then(setOpen(true)).then(signY).then(land)
    .then(nextDay).then(recheck).then(signX).then(land)
    .expect(s.x == "refunded" and s.y == "refunded" and s.singleFails == 1 and invariant)
  run failedAloneGoesLastTest = init.then(signBoth).then(setOpen(false)).then(land).then(setOpen(true))
    .then(signX).then(setOpen(false)).then(land).then(setOpen(true)).then(nextDay).then(recheck)
    .expect(s.x == "due" and s.y == "due" and not(s.xParked))
    .then(signX.fail())
  run closedAtSimulationSignsNothingTest = init.then(setOpen(false)).then(signBoth.fail())
  run closedAtSimulationParksAndOtherGoesTest = init.then(setOpen(false)).then(parkUnusable).then(signY).then(land)
    .expect(s.y == "refunded" and s.batchFails == 0 and s.singleFails == 0 and invariant)
  run solanaConfigErrorLeavesEvmRunningTest = init.then(configure(true, "live", false)).then(runWorker)
    .expect(s.evmResult == "ran" and s.solanaResult == "error" and invariant)
  run solanaOffIsInertTest = init.then(configure(true, "off", false)).then(runWorker)
    .expect(s.evmResult == "ran" and s.solanaResult == "off" and invariant)
}
