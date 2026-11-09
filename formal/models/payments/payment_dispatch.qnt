// @source backend/payments/verified-evidence.ts
// @source migrations/0011_payments.sql
// @source migrations/0017_robinhood_chain.sql
// @source migrations/0021_multi_asset_vault_snapshots.sql
// @source backend/payments/dispatch.ts
// @source backend/payments/ledger.ts
// @source workers/payments/reconcile.ts
// @source workers/payments/scanner.ts
// @source workers/security-payments/index.ts
// @source migrations/0057_private_security_payments.sql
// @source backend/security/payment-database.ts
// @source backend/payments/handler.ts
// 0057 and payment-database.ts: the private security rail renames the same
// obligation, outbox and attempt tables and runs this engine unchanged.
// `releaseHold(guarded)` is the held->ready release when a wallet is newly
// authorized (workers/security-payments/index.ts on each run, and the
// backend/payments/handler.ts wallet authorization). Both releases carry the
// guard: no prepared/unknown/submitted attempt under another claim
// (attempt == 1 with attemptWallet != wallet). The unguarded variant stays in
// `step` to show that the dispatcher would only park the row again.
// backend/payments/dispatch.ts: lease fence and stable executor idempotency key.
// backend/payments/ledger.ts: a finalized vault payment event marks the
// obligation paid with the event's own transaction, whether or not an attempt
// recorded that transaction (`externalPaid`). Paid is absorbing: every action
// that changes the outbox, attempt or receipt is guarded by `not(s.paid)`.
// State reduction: the former write-only `failedGenerations` set was never read
// by a guard or by another field's update, so removing it is a projection that
// keeps every successor of the remaining fields. Its invariant conjunct
// (`subseteq(Set(1,2))`) followed from `readA, readB <= generation <= 2`, which
// `invariant` still states.
module payment_dispatch {
  type S = { outbox: str, owner: int, attempt: int, tx: int, wallet: int,
    attemptWallet: int, paid: bool, paidTx: int, generation: int, readA: int, readB: int }
  var s: S
  action init = s' = { outbox: "ready", owner: 0, attempt: 0, tx: 0, wallet: 1,
    attemptWallet: 0, paid: false, paidTx: 0, generation: 0, readA: 0, readB: 0 }
  action lease(worker: int): bool = all { not(s.paid), Set("ready", "processing").contains(s.outbox),
    s' = s.with("owner", worker).with("outbox", "processing") }
  action prepare(worker: int): bool = all { s.owner == worker, s.outbox == "processing", s.attempt == 0,s.generation<2,
    s' = s.with("attempt", 1).with("attemptWallet", s.wallet).with("generation",s.generation+1) }
  // The old wallet was authorized when its immutable attempt was created. A
  // delayed response still records that attempt after a later wallet change.
  // Only the current lease may change the outbox or hold a conflicting return.
  action success(worker: int, tx: int): bool = all { s.attempt == 1, not(s.paid),
    s' = if (s.tx != 0 and s.tx != tx)
      (if(s.owner == worker) s.with("outbox", "held").with("owner", 0) else s)
      else if(s.owner == worker) s.with("tx", tx).with("outbox", "submitted").with("owner", 0)
      else s.with("tx", tx) }
  // dispatch.ts submit catch: `state='ready',lease_token=NULL ... WHERE
  // lease_token=?` returns the row and clears the lease.
  action ambiguous(worker: int): bool = all { s.owner == worker, s.outbox == "processing", not(s.paid),
    s' = s.with("outbox", "ready").with("owner", 0) }
  action replaceWallet = all { not(s.paid), s' = s.with("wallet", 2) }
  action hold = all { not(s.paid), s.outbox == "processing", s.attempt > 0, s.wallet != s.attemptWallet,
    s' = s.with("outbox", "held").with("owner", 0) }
  action releaseHold(guarded: bool): bool = all { not(s.paid), s.outbox == "held",
    not(guarded and s.attempt > 0 and s.attemptWallet != s.wallet),
    s' = s.with("outbox", "ready") }
  // The recorded transaction finalizes. The ledger accepts the event only for a
  // reserved obligation, so a second finalized event cannot rewrite the receipt.
  action finalized = all { s.tx > 0, not(s.paid),
    s' = s.with("paid", true).with("paidTx", s.tx).with("outbox", "paid").with("owner", 0) }
  // ledger.ts: the scanner's finalized event names a transaction that no
  // attempt recorded, for example one a "never seen" reopen cleared. The
  // obligation and outbox become paid; the attempt keeps whatever it recorded.
  action externalPaid(tx: int): bool = all { not(s.paid), tx != s.tx,
    s' = s.with("paid", true).with("paidTx", tx).with("outbox", "paid").with("owner", 0) }
  // Two receipt lookups can overlap. Retiring an older failed generation does
  // not reopen an outbox now owned by another live prepared/submitted attempt.
  action inspectFailure(worker: int): bool = all {s.attempt==1,s.tx>0,not(s.paid),
    s'=if(worker==1) s.with("readA",s.generation) else s.with("readB",s.generation)}
  action settleFailure(worker: int): bool = {
    val observed=if(worker==1) s.readA else s.readB
    all {observed>0,not(s.paid),
      s'=if(observed==s.generation)
        s.with("attempt",0).with("tx",0)
          .with("outbox",if(Set("submitted","held").contains(s.outbox)) "ready" else s.outbox)
      else s}
  }
  action step = any { lease(1), lease(2), prepare(1), prepare(2), success(1, 1), success(2, 1),
    success(1, 2), success(2, 2), ambiguous(1), ambiguous(2), replaceWallet, hold, releaseHold(true), releaseHold(false), finalized,
    externalPaid(1), externalPaid(2), externalPaid(3),
    inspectFailure(1),inspectFailure(2),settleFailure(1),settleFailure(2),s' = s }
  val invariant = all { s.attempt <= 1, s.paid iff s.outbox == "paid",
    s.paid iff s.paidTx > 0, s.paid implies s.owner == 0,
    s.tx > 0 implies s.attempt == 1, s.generation <= 2,
    s.outbox != "processing" implies s.owner == 0,
    s.readA <= s.generation, s.readB <= s.generation }
  // Paid is absorbing and its receipt never changes. Checked by TLC.
  temporal paidAbsorbingProperty = always(all {
    s.paid implies always(s.paid and s.outbox == "paid"),
    s.paidTx == 1 implies always(s.paidTx == 1),
    s.paidTx == 2 implies always(s.paidTx == 2),
    s.paidTx == 3 implies always(s.paidTx == 3) })
  run ambiguousClearsLeaseTest = init.then(lease(1)).then(prepare(1)).then(ambiguous(1))
    .expect(s.owner == 0 and s.outbox == "ready" and invariant)
  // A late response after the catch records its transaction but cannot move
  // the returned row to submitted (the outbox update requires the lease).
  run ambiguousCannotSubmitTest = init.then(lease(1)).then(prepare(1)).then(ambiguous(1))
    .then(success(1, 1)).expect(s.tx == 1 and s.outbox == "ready" and invariant)
  run heldUnderOldWalletRun = init.then(lease(1)).then(prepare(1)).then(ambiguous(1))
    .then(replaceWallet).then(lease(2)).then(hold)
  run guardedReleaseKeepsUncertainHoldTest = heldUnderOldWalletRun.then(releaseHold(true).fail())
  run unguardedReleaseIsReparkedTest = heldUnderOldWalletRun.then(releaseHold(false))
    .then(lease(1)).then(hold).expect(s.outbox == "held" and s.owner == 0 and invariant)
  run staleLeaseRefusedTest = init.then(lease(1)).then(lease(2)).then(prepare(1).fail())
  run ambiguousRetryTest = init.then(lease(1)).then(prepare(1)).then(ambiguous(1)).then(lease(2)).then(success(2, 1)).then(finalized).expect(invariant)
  run conflictingResponseTest = init.then(lease(1)).then(prepare(1)).then(lease(2)).then(success(1, 1)).then(success(2, 2)).expect(s.tx == 1 and s.outbox == "held" and invariant)
  run lateOriginalAfterWalletReplacementTest = init.then(lease(1)).then(prepare(1)).then(replaceWallet)
    .then(success(1, 1)).then(finalized).expect(s.paid and s.attemptWallet == 1 and s.wallet == 2 and invariant)
  run staleConflictCannotHoldCompletedTest = init.then(lease(1)).then(prepare(1)).then(lease(2))
    .then(success(2, 2)).then(success(1, 1)).expect(s.tx == 2 and s.outbox == "submitted" and invariant)
  run staleFailurePreservesSubmittedSuccessorTest = init.then(lease(1)).then(prepare(1))
    .then(success(1,1)).then(inspectFailure(1)).then(inspectFailure(2)).then(settleFailure(1))
    .then(lease(2)).then(prepare(2)).then(success(2,2)).then(settleFailure(2))
    .expect(s.generation==2 and s.tx==2 and s.outbox=="submitted" and invariant)
  run externalPaidWithoutRecordedTxTest = init.then(lease(1)).then(prepare(1)).then(ambiguous(1))
    .then(externalPaid(3)).expect(s.paid and s.paidTx == 3 and s.tx == 0 and s.outbox == "paid" and invariant)
  run externalPaidBesideRecordedTxTest = init.then(lease(1)).then(prepare(1)).then(success(1, 1))
    .then(externalPaid(2)).expect(s.paid and s.paidTx == 2 and s.tx == 1 and invariant)
  run paidIsAbsorbingTest = init.then(externalPaid(3)).then(lease(1).fail())
  run noSecondReceiptAfterExternalPaidTest = init.then(lease(1)).then(prepare(1)).then(success(1, 1))
    .then(externalPaid(2)).then(finalized.fail())
  run noResponseAfterPaidTest = init.then(lease(1)).then(prepare(1)).then(externalPaid(3)).then(success(1, 1).fail())
}
