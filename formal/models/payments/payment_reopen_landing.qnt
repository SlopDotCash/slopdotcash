// @source workers/payments/index.ts
// @source backend/payments/dispatch.ts
// @source backend/payments/ledger.ts
// "The chain never saw it" reopen (workers/payments/index.ts) clears a
// submitted attempt's recorded transaction and returns the outbox to `ready`.
// The status service can be stale, so the model lets that observation arrive
// for any recorded transaction, including one that already landed.
//
// Ghost state: `broadcast` holds every signed transaction the executor has
// released, `landed` the ones the chain executed and `expired` the ones whose
// finalized expiry (Solana blockhash) or replaced nonce (EVM) proves they can
// never land. These sets are not stored by Slop; they let the invariant say
// that at most one transaction pays the obligation.
//
// Executor contract (external trust boundary, stated in index.ts): a retried
// attempt resends the same signed bytes; it signs replacement bytes only after
// it proves the previous bytes expired without landing and rechecks that the
// award is unpaid. `replace` encodes that contract; the scenario
// `replaceRequiresExpiryProofTest` shows the guard is load-bearing.
//
// Bounds: one obligation, one attempt id, at most three signed transactions.
module payment_reopen_landing {
  type S = { obligation: str, paidTx: int, attempt: str, attemptTx: int, outbox: str,
    bytes: int, nextTx: int, broadcast: Set[int], landed: Set[int], expired: Set[int] }
  var s: S
  action init = s' = { obligation: "reserved", paidTx: 0, attempt: "none", attemptTx: 0,
    outbox: "ready", bytes: 0, nextTx: 1, broadcast: Set(), landed: Set(), expired: Set() }

  // dispatch.ts: a lease on a reserved obligation prepares the stable attempt.
  action lease = all { s.obligation == "reserved", s.outbox == "ready",
    s' = s.with("outbox", "processing")
      .with("attempt", if (s.attempt == "none") "prepared" else s.attempt) }
  // The executor signs once per attempt id and resends those bytes on retry.
  action submit = {
    val tx = if (s.bytes == 0) s.nextTx else s.bytes
    all { s.outbox == "processing", s.obligation == "reserved", tx <= 3,
      s' = s.with("bytes", tx).with("nextTx", if (s.bytes == 0) s.nextTx + 1 else s.nextTx)
        .with("broadcast", s.broadcast.union(Set(tx)))
        // A recorded transaction id is never replaced by a different one.
        .with("attemptTx", if (s.attemptTx == 0) tx else s.attemptTx)
        .with("attempt", if (s.attemptTx == 0 or s.attemptTx == tx) "submitted" else s.attempt)
        .with("outbox", if (s.attemptTx == 0 or s.attemptTx == tx) "submitted" else "processing") } }
  // Executor-side replacement after finalized expiry of unlanded bytes.
  action replace = all { s.obligation == "reserved", s.bytes > 0, s.nextTx <= 3,
    s.expired.contains(s.bytes), not(s.landed.contains(s.bytes)), s.attemptTx == 0,
    s' = s.with("bytes", s.nextTx).with("nextTx", s.nextTx + 1) }
  // Chain: a released, unexpired transaction may execute; or it may expire.
  action land(tx: int): bool = all { s.broadcast.contains(tx), not(s.expired.contains(tx)),
    not(s.landed.contains(tx)), s' = s.with("landed", s.landed.union(Set(tx))) }
  action expire(tx: int): bool = all { s.broadcast.contains(tx), not(s.landed.contains(tx)),
    not(s.expired.contains(tx)), s' = s.with("expired", s.expired.union(Set(tx))) }
  // index.ts `!status.submitted`: possibly stale. Clears the recorded
  // transaction and reopens a submitted outbox only while the award is reserved.
  action notSeen = all { s.attempt == "submitted", s.attemptTx > 0, s.obligation == "reserved",
    s' = s.with("attempt", "unknown").with("attemptTx", 0)
      .with("outbox", if (s.outbox == "submitted") "ready" else s.outbox) }
  // ledger.ts: the scanner's finalized event pays with its own transaction,
  // recorded by an attempt or not.
  action scannerPaid(tx: int): bool = all { s.landed.contains(tx), s.obligation == "reserved",
    s' = s.with("obligation", "paid").with("paidTx", tx).with("outbox", "paid") }

  action step = any { lease, submit, replace, notSeen,
    land(1), land(2), land(3), expire(1), expire(2), expire(3),
    scannerPaid(1), scannerPaid(2), scannerPaid(3), s' = s }

  val invariant = all {
    s.landed.size() <= 1,
    s.obligation == "paid" implies (s.landed.contains(s.paidTx) and s.outbox == "paid"),
    (s.obligation == "paid") iff (s.paidTx > 0),
    s.landed.intersect(s.expired) == Set(),
    s.attemptTx > 0 implies s.broadcast.contains(s.attemptTx),
    s.nextTx <= 4 }
  temporal paidAbsorbingProperty = always(all {
    s.obligation == "paid" implies always(s.obligation == "paid"),
    s.paidTx == 1 implies always(s.paidTx == 1),
    s.paidTx == 2 implies always(s.paidTx == 2) })

  run reopenResendsSameBytesTest = init.then(lease).then(submit).then(notSeen).then(lease).then(submit)
    .expect(s.attemptTx == 1 and s.broadcast == Set(1) and s.outbox == "submitted" and invariant)
  run staleNotSeenAfterLandingTest = init.then(lease).then(submit).then(land(1)).then(notSeen)
    .then(lease).then(expire(1).fail())
  run landedBytesCannotBeReplacedTest = init.then(lease).then(submit).then(land(1)).then(notSeen)
    .then(replace.fail())
  run staleReopenThenExternalPaidTest = init.then(lease).then(submit).then(land(1)).then(notSeen)
    .then(scannerPaid(1)).expect(s.obligation == "paid" and s.paidTx == 1 and s.attemptTx == 0 and invariant)
  run expiredReplacementPaysOnceTest = init.then(lease).then(submit).then(expire(1)).then(notSeen)
    .then(replace).then(lease).then(submit).then(land(2)).then(scannerPaid(2))
    .expect(s.paidTx == 2 and s.landed == Set(2) and invariant)
  run expiredOldBytesNeverLandTest = init.then(lease).then(submit).then(expire(1)).then(notSeen)
    .then(replace).then(lease).then(submit).then(land(1).fail())
  run replaceRequiresExpiryProofTest = init.then(lease).then(submit).then(notSeen).then(replace.fail())
  run paidStopsReopenTest = init.then(lease).then(submit).then(land(1)).then(scannerPaid(1))
    .then(notSeen.fail())
}
