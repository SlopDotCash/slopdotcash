// @source contracts/evm/src/SubmissionDeposits.sol
// @evidence contracts/evm/test/SubmissionDeposits.t.sol
// @evidence contracts/evm/test/SubmissionDepositsInvariant.t.sol
// Two deposit ids of one unit each, three callers (1 first owner, 2 first
// resolver, 3 a payer; roles may move among them), one valid kept address (4),
// ticks 0..3 and a reclaim delay of 2 ticks, which abstracts the immutable
// duration, not seconds. Deposits are made at ticks 0..1 so the delay can run out.
// A payout is two steps: the record changes and the lock is taken, then the token
// transfer either completes or fails and the whole call reverts. While the lock
// is held every deposit, settlement and reclaim is refused, which is the
// reentrancy rule. A deposit is one step: the pull either delivers exactly the
// amount or the call reverts; reentry during that pull is covered by the Foundry
// tests, not here. Owner actions never touch a deposit, so they are not locked.
// Not modeled: several tokens, amounts other than one, resolveMany (it settles
// each id through the same path and reverts as a whole), and tokens sent to the
// contract without a deposit.
module submission_deposits {
  type D = { state: str, payer: int, to: int, at: int, paid: int, dest: int }
  type S = { owner: int, pending: int, resolver: int, paused: bool, tick: int,
    lock: int, held: int, count: int, d: int -> D }
  var s: S
  pure val Kept = 4
  pure val Delay = 2
  pure val empty: D = { state: "none", payer: 0, to: 0, at: 0, paid: 0, dest: 0 }
  action init = s' = { owner: 1, pending: 0, resolver: 2, paused: false, tick: 0,
    lock: 0, held: 0, count: 0, d: Map(1 -> empty, 2 -> empty) }
  action tick = all { s.tick < 3, s' = s.with("tick", s.tick + 1) }

  // deposit(item, token, amount, keptTo): ids count up from 1; the payer and the
  // kept address are fixed here. `exact` is whether the pull delivered the amount.
  action deposit(caller: int, keptTo: int, exact: bool): bool = all {
    s.lock == 0, not(s.paused), keptTo == Kept, s.count < 2, s.tick <= 1, exact,
    s' = s.with("count", s.count + 1).with("held", s.held + 1)
      .with("d", s.d.set(s.count + 1, { state: "open", payer: caller, to: keptTo, at: s.tick, paid: 0, dest: 0 })) }

  // resolve(id, refund): the resolver only, an open deposit only.
  action settle(caller: int, id: int, refund: bool): bool = all {
    s.lock == 0, caller == s.resolver, s.d.get(id).state == "open",
    s' = s.with("lock", id).with("d", s.d.set(id, s.d.get(id).with("state", if (refund) "refunded" else "kept"))) }

  // reclaim(id): the payer only, an open deposit only, once the delay has passed.
  action reclaim(caller: int, id: int): bool = all {
    s.lock == 0, s.d.get(id).state == "open", caller == s.d.get(id).payer,
    s.tick >= s.d.get(id).at + Delay,
    s' = s.with("lock", id).with("d", s.d.set(id, s.d.get(id).with("state", "reclaimed"))) }

  // The token transfer of the payout in flight. Kept goes to the kept address;
  // a refund or a reclaim goes to the payer. A failed transfer reverts the call.
  action finish(delivered: bool): bool = {
    val r = s.d.get(s.lock)
    all { s.lock != 0,
      s' = if (delivered) s.with("lock", 0).with("held", s.held - 1)
          .with("d", s.d.set(s.lock, r.with("paid", r.paid + 1).with("dest", if (r.state == "kept") r.to else r.payer)))
        else s.with("lock", 0).with("d", s.d.set(s.lock, r.with("state", "open"))) } }

  action setResolver(caller: int, candidate: int): bool = all { caller == s.owner, candidate > 0,
    candidate != s.owner, candidate != s.pending, candidate != s.resolver, s' = s.with("resolver", candidate) }
  action pauseDeposits(caller: int, paused: bool): bool = all { caller == s.owner, paused != s.paused,
    s' = s.with("paused", paused) }
  action transferOwner(caller: int, candidate: int): bool = all { caller == s.owner, candidate != s.resolver,
    s' = s.with("pending", candidate) }
  action acceptOwner(caller: int): bool = all { caller > 0, caller == s.pending,
    s' = s.with("owner", caller).with("pending", 0) }

  action step = {
    nondet caller = oneOf(Set(1, 2, 3))
    nondet candidate = oneOf(Set(0, 1, 2, 3))
    nondet id = oneOf(Set(1, 2))
    nondet keptTo = oneOf(Set(0, 4))
    nondet flag = oneOf(Set(true, false))
    any { tick, deposit(caller, keptTo, flag), settle(caller, id, flag), reclaim(caller, id), finish(flag),
      setResolver(caller, candidate), pauseDeposits(caller, flag), transferOwner(caller, candidate),
      acceptOwner(caller), s' = s }
  }

  def inFlight(id: int): bool = s.lock == id
  def open(id: int): bool = s.d.get(id).state == "open"
  def recorded(id: int): bool = s.d.get(id).state != "none"
  // A deposit is paid at most once, only after it left the open state, and only to
  // its own payer (refund, reclaim) or its own kept address (kept).
  def paidRight(id: int): bool = {
    val r = s.d.get(id)
    all { r.paid <= 1,
      (r.state == "none" or r.state == "open" or inFlight(id)) implies (r.paid == 0 and r.dest == 0),
      (r.state == "kept" and not(inFlight(id))) implies (r.paid == 1 and r.dest == r.to),
      ((r.state == "refunded" or r.state == "reclaimed") and not(inFlight(id))) implies (r.paid == 1 and r.dest == r.payer),
      recorded(id) implies (r.to == Kept and r.payer > 0),
      r.state == "reclaimed" implies s.tick >= r.at + Delay }
  }
  def holds(id: int): int = if (open(id) or inFlight(id)) 1 else 0
  val invariant = all {
    s.owner > 0, s.resolver > 0, s.resolver != s.owner, s.resolver != s.pending,
    paidRight(1), paidRight(2),
    // The contract holds exactly the deposits that are open or being paid out.
    s.held == holds(1) + holds(2),
    // Ids count up from 1 with no gap.
    recorded(2) implies recorded(1), s.count == (if (recorded(2)) 2 else if (recorded(1)) 1 else 0) }

  run refundGoesToThePayerTest = init.then(deposit(3, 4, true)).then(settle(2, 1, true)).then(finish(true))
    .expect(s.d.get(1).dest == 3 and s.held == 0 and invariant)
  run keptGoesToTheKeptAddressTest = init.then(deposit(3, 4, true)).then(settle(2, 1, false)).then(finish(true))
    .expect(s.d.get(1).dest == 4 and s.held == 0 and invariant)
  run resolvesOnceTest = init.then(deposit(3, 4, true)).then(settle(2, 1, true)).then(finish(true))
    .then(settle(2, 1, false).fail())
  run onlyTheResolverSettlesTest = init.then(deposit(3, 4, true)).then(settle(1, 1, true).fail())
  run payerCannotSettleTest = init.then(deposit(3, 4, true)).then(settle(3, 1, true).fail())
  run ownerCannotReclaimTest = init.then(deposit(3, 4, true)).then(tick).then(tick).then(reclaim(1, 1).fail())
  run earlyReclaimRefusedTest = init.then(deposit(3, 4, true)).then(tick).then(reclaim(3, 1).fail())
  run reclaimAfterDelayTest = init.then(deposit(3, 4, true)).then(tick).then(tick).then(reclaim(3, 1)).then(finish(true))
    .expect(s.d.get(1).state == "reclaimed" and s.d.get(1).dest == 3 and s.held == 0 and invariant)
  run reclaimedCannotBeSettledTest = init.then(deposit(3, 4, true)).then(tick).then(tick).then(reclaim(3, 1))
    .then(finish(true)).then(settle(2, 1, false).fail())
  run settledCannotBeReclaimedTest = init.then(deposit(3, 4, true)).then(settle(2, 1, false)).then(finish(true))
    .then(tick).then(tick).then(reclaim(3, 1).fail())
  run pausedDepositRefusedTest = init.then(pauseDeposits(1, true)).then(deposit(3, 4, true).fail())
  run pauseNeverBlocksSettlementTest = init.then(deposit(3, 4, true)).then(pauseDeposits(1, true))
    .then(settle(2, 1, true)).then(finish(true)).expect(s.held == 0 and invariant)
  run pauseNeverBlocksReclaimTest = init.then(deposit(3, 4, true)).then(pauseDeposits(1, true)).then(tick).then(tick)
    .then(reclaim(3, 1)).then(finish(true)).expect(s.held == 0 and invariant)
  run shortDeliveryRefusedTest = init.then(deposit(3, 4, false).fail())
  run missingKeptAddressRefusedTest = init.then(deposit(3, 0, true).fail())
  run reentrantSettleRefusedTest = init.then(deposit(3, 4, true)).then(deposit(3, 4, true)).then(settle(2, 1, true))
    .then(settle(2, 2, false).fail())
  run reentrantReclaimRefusedTest = init.then(deposit(3, 4, true)).then(deposit(3, 4, true)).then(tick).then(tick)
    .then(reclaim(3, 1)).then(reclaim(3, 2).fail())
  run reentrantDepositRefusedTest = init.then(deposit(3, 4, true)).then(settle(2, 1, true)).then(deposit(3, 4, true).fail())
  run failedTransferLeavesTheDepositOpenTest = init.then(deposit(3, 4, true)).then(settle(2, 1, true)).then(finish(false))
    .expect(s.d.get(1).state == "open" and s.d.get(1).paid == 0 and s.held == 1 and s.lock == 0 and invariant)
  run failedRefundCanStillBeKeptTest = init.then(deposit(3, 4, true)).then(settle(2, 1, true)).then(finish(false))
    .then(settle(2, 1, false)).then(finish(true)).expect(s.d.get(1).dest == 4 and invariant)
  run ownerCannotBecomeResolverTest = init.then(setResolver(1, 1).fail())
  run pendingOwnerCannotBecomeResolverTest = init.then(transferOwner(1, 3)).then(setResolver(1, 3).fail())
  run resolverCannotBeNamedOwnerTest = init.then(transferOwner(1, 2).fail())
  run cancelledOwnershipCannotBeAcceptedTest = init.then(transferOwner(1, 3)).then(transferOwner(1, 0)).then(acceptOwner(3).fail())
  run replacedResolverLosesPowerTest = init.then(deposit(3, 4, true)).then(setResolver(1, 3)).then(settle(2, 1, true).fail())
  run newResolverStillHasOnlyTheTwoOutcomesTest = init.then(deposit(3, 4, true)).then(transferOwner(1, 3)).then(acceptOwner(3))
    .then(setResolver(3, 1)).then(settle(1, 1, false)).then(finish(true))
    .expect(s.d.get(1).dest == 4 and s.d.get(1).payer == 3 and s.owner == 3 and s.resolver == 1 and invariant)
  run twoDepositsSettleIndependentlyTest = init.then(deposit(3, 4, true)).then(tick).then(deposit(1, 4, true))
    .then(settle(2, 2, false)).then(finish(true)).then(tick).then(reclaim(3, 1)).then(finish(true))
    .expect(s.d.get(1).dest == 3 and s.d.get(2).dest == 4 and s.held == 0 and invariant)
  run secondDepositHasItsOwnClockTest = init.then(deposit(3, 4, true)).then(tick).then(deposit(3, 4, true)).then(tick)
    .then(reclaim(3, 2).fail())
}
