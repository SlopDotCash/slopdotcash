// @source migrations/0011_payments.sql
// @source migrations/0017_robinhood_chain.sql
// @source migrations/0021_multi_asset_vault_snapshots.sql
// @source backend/payments/dispatch.ts
// @source backend/payments/ledger.ts
// @source workers/payments/reconcile.ts
// @source workers/payments/scanner.ts
// @source workers/security-payments/index.ts
// backend/payments/dispatch.ts: lease fence and stable executor idempotency key.
module payment_dispatch {
  type S = { outbox: str, owner: int, attempt: int, tx: int, wallet: int,
    attemptWallet: int, paid: bool, generation: int, readA: int, readB: int,
    failedGenerations: Set[int] }
  var s: S
  action init = s' = { outbox: "ready", owner: 0, attempt: 0, tx: 0, wallet: 1,
    attemptWallet: 0, paid: false, generation: 0, readA: 0, readB: 0, failedGenerations: Set() }
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
  action ambiguous(worker: int): bool = all { s.owner == worker, not(s.paid),
    s' = s.with("outbox", "ready") }
  action replaceWallet = all { not(s.paid), s' = s.with("wallet", 2) }
  action hold = all { not(s.paid), s.outbox == "processing", s.attempt > 0, s.wallet != s.attemptWallet,
    s' = s.with("outbox", "held").with("owner", 0) }
  action finalized = all { s.tx > 0, s' = s.with("paid", true).with("outbox", "paid").with("owner", 0) }
  // Two receipt lookups can overlap. Retiring an older failed generation does
  // not reopen an outbox now owned by another live prepared/submitted attempt.
  action inspectFailure(worker: int): bool = all {s.attempt==1,s.tx>0,not(s.paid),
    s'=if(worker==1) s.with("readA",s.generation) else s.with("readB",s.generation)}
  action settleFailure(worker: int): bool = {
    val observed=if(worker==1) s.readA else s.readB
    all {observed>0,not(s.paid),
      s'=if(observed==s.generation)
        s.with("failedGenerations",s.failedGenerations.union(Set(observed)))
          .with("attempt",0).with("tx",0)
          .with("outbox",if(Set("submitted","held").contains(s.outbox)) "ready" else s.outbox)
      else s.with("failedGenerations",s.failedGenerations.union(Set(observed)))}
  }
  action step = any { lease(1), lease(2), prepare(1), prepare(2), success(1, 1), success(2, 1),
    success(1, 2), success(2, 2), ambiguous(1), ambiguous(2), replaceWallet, hold, finalized,
    inspectFailure(1),inspectFailure(2),settleFailure(1),settleFailure(2),s' = s }
  val invariant = all { s.attempt <= 1, s.paid implies (s.tx > 0 and s.outbox == "paid"),
    s.tx > 0 implies s.attempt == 1,s.generation<=2,s.failedGenerations.subseteq(Set(1,2)) }
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
}
