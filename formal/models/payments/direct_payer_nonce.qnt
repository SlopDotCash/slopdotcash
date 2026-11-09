// @source backend/security/direct-payments.ts
// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// EVM direct-payment payer nonce reservation. `reserveNextNonces` reads the
// payer's pending nonce and the highest reserved nonce outside any
// transaction, then the intent insert (0112 `security_direct_initial_nonces`)
// or successor insert (0113 `security_direct_successor_nonce`) reserves the
// chosen nonces in the same statement. PRIMARY KEY(network,payer,nonce) and
// UNIQUE(case_id,generation,leg_index) abort a conflicting insert, which
// leaves no intent or successor behind. A successor reserves only nonces that
// differ from the prior generation; a consent renewal keeps both nonces.
//
// Ghost state: `issued` holds (nonce, case, leg) for every request any
// generation of any case ever offered. Bounds: one payer on one network, two
// cases, one successor or renewal each, pending nonce advanced by unrelated
// payer activity at most twice. The triggers store
// lower(json_extract(t.value,'$.nonce')), the canonical lowercase unpadded
// 0x-hex nonce of direct-evm.ts, whose length-then-lexicographic order equals
// integer order, so the SQL `ORDER BY length(nonce) DESC, nonce DESC` maximum
// is the integer maximum. The initial intent passes the reserved pair
// reversed (direct-payments.ts `[nonces[1], nonces[0]]`): the researcher leg
// (leg_index 0) takes base+1 and the fee leg (leg_index 1) takes base.
module direct_payer_nonce {
  type R = { nonce: int, caseId: int, gen: int, leg: int }
  type S = { pending: int, reservations: Set[R], read: int -> int, gen: int -> int,
    nonce0: int -> int, nonce1: int -> int, issued: Set[(int, int, int)] }
  var s: S
  pure val Cases = Set(1, 2)
  action init = s' = { pending: 1, reservations: Set(),
    read: Cases.mapBy(c => 0), gen: Cases.mapBy(c => -1),
    nonce0: Cases.mapBy(c => 0), nonce1: Cases.mapBy(c => 0), issued: Set() }

  def maxReserved: int = s.reservations.fold(0, (m, r) => if (r.nonce > m) r.nonce else m)
  def nextBase: int = if (maxReserved >= s.pending) maxReserved + 1 else s.pending
  def free(n: int): bool = s.reservations.forall(r => r.nonce != n)
  def slotFree(c: int, g: int, leg: int): bool =
    s.reservations.forall(r => not(r.caseId == c and r.gen == g and r.leg == leg))

  // The unfenced read of reserveNextNonces.
  action readBase(c: int): bool = all { s.read.get(c) == 0, s.gen.get(c) < 1,
    s' = s.with("read", s.read.set(c, nextBase)) }
  // A failed insert or abandoned request forgets its read.
  action dropRead(c: int): bool = all { s.read.get(c) > 0,
    s' = s.with("read", s.read.set(c, 0)) }
  action prepare(c: int): bool = {
    val b = s.read.get(c)
    all { b > 0, s.gen.get(c) == -1, free(b), free(b + 1), slotFree(c, 0, 0), slotFree(c, 0, 1),
      s' = s.with("reservations", s.reservations.union(Set(
          { nonce: b + 1, caseId: c, gen: 0, leg: 0 }, { nonce: b, caseId: c, gen: 0, leg: 1 })))
        .with("gen", s.gen.set(c, 0)).with("read", s.read.set(c, 0))
        .with("nonce0", s.nonce0.set(c, b + 1)).with("nonce1", s.nonce1.set(c, b))
        .with("issued", s.issued.union(Set((b + 1, c, 0), (b, c, 1)))) } }
  // Successor replacing one leg's nonce after its retirement proof.
  action successor(c: int, leg: int): bool = {
    val b = s.read.get(c)
    val g = s.gen.get(c) + 1
    all { b > 0, s.gen.get(c) == 0, free(b), slotFree(c, g, leg),
      s' = s.with("reservations", s.reservations.union(Set({ nonce: b, caseId: c, gen: g, leg: leg })))
        .with("gen", s.gen.set(c, g)).with("read", s.read.set(c, 0))
        .with("nonce0", if (leg == 0) s.nonce0.set(c, b) else s.nonce0)
        .with("nonce1", if (leg == 1) s.nonce1.set(c, b) else s.nonce1)
        .with("issued", s.issued.union(Set((b, c, leg)))) } }
  // Consent renewal: same transactions, no nonce insert.
  action renew(c: int): bool = all { s.gen.get(c) == 0,
    s' = s.with("gen", s.gen.set(c, 1)) }
  action external = all { s.pending < 3, s' = s.with("pending", s.pending + 1) }

  action step = any { external,
    nondet c = Cases.oneOf()
    any { readBase(c), dropRead(c), prepare(c), successor(c, 0), successor(c, 1), renew(c) },
    s' = s }

  def current(c: int, leg: int): int = if (leg == 0) s.nonce0.get(c) else s.nonce1.get(c)
  val invariant = all {
    // PRIMARY KEY(network,payer,nonce): one owner per nonce.
    s.reservations.forall(a => s.reservations.forall(b => a.nonce == b.nonce implies a == b)),
    // No nonce was ever offered to two different case legs.
    s.issued.forall(a => s.issued.forall(b => a._1 == b._1 implies a == b)),
    // Every offered nonce is reserved for that case and leg.
    s.issued.forall(i => s.reservations.exists(r => r.nonce == i._1 and r.caseId == i._2 and r.leg == i._3)),
    // Each prepared case's current nonces are reserved by itself and distinct.
    Cases.forall(c => s.gen.get(c) >= 0 implies all {
      current(c, 0) != current(c, 1),
      s.issued.contains((current(c, 0), c, 0)), s.issued.contains((current(c, 1), c, 1)) }) }

  run concurrentReadSecondInsertRefusedTest = init.then(readBase(1)).then(readBase(2))
    .then(prepare(1)).then(prepare(2).fail())
  run retryAfterConflictTakesFreshNoncesTest = init.then(readBase(1)).then(readBase(2))
    .then(prepare(1)).then(dropRead(2)).then(readBase(2)).then(prepare(2))
    .expect(s.nonce0.get(2) == 4 and s.nonce1.get(2) == 3 and invariant)
  run pendingAboveReservationsTest = init.then(external).then(external).then(readBase(1)).then(prepare(1))
    .expect(s.nonce1.get(1) == 3 and s.nonce0.get(1) == 4 and invariant)
  run successorReservesOnlyChangedLegTest = init.then(readBase(1)).then(prepare(1)).then(readBase(1))
    .then(successor(1, 0)).expect(s.nonce0.get(1) == 3 and s.nonce1.get(1) == 1
      and s.reservations.size() == 3 and invariant)
  run staleSuccessorReadRefusedTest = init.then(readBase(1)).then(prepare(1)).then(readBase(1))
    .then(readBase(2)).then(prepare(2)).then(successor(1, 1).fail())
  run renewalKeepsNoncesTest = init.then(readBase(1)).then(prepare(1)).then(renew(1))
    .expect(s.reservations.size() == 2 and s.gen.get(1) == 1 and invariant)
}
