lemma reserve_ensures(v: Vault, amount: seq<int>, actor: int, obligation: int)
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysSettlementTotal(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysConserved(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysValidAmounts(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysReservationMatches(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysReservationTotal(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysReservationIdentity(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> alwaysSettlementHistory(reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> stepRetainedSettlements(v, reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> stepRetainedObligations(v, reserve(v, amount, actor, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, actor, obligation) ==> stepIdentityFixed(v, reserve(v, amount, actor, obligation)))
{
  if inv(v) && canReserve(v, amount, actor, obligation) {
    settlement__money_lawSubtractionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.reserved, amount);
    settlement__money_lawPositiveAddition_ensures(v.reserved, amount);
    var added := Reservation(obligation, actor, amount);
    var oldTotal := Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), settlement__money_zero, v.reservations);
    ValidReservationSum(v.reservations, settlement__money_zero);
    ReservationFoldAppend(v.reservations, settlement__money_zero, added);
    settlement__money_lawAddCongruence_ensures(v.reserved, oldTotal, amount);
    PreserveVaultReserveValue(v, amount);
    var after := reserve(v, amount, actor, obligation);
    ReservationIdentityMeaning(v);
    ReservationIdentityMeaning(after);
    assert forall r :: r in v.reservations ==> r.obligation in v.obligations;
    assert forall r :: r in v.reservations ==> r.obligation != obligation;
    forall r | r in after.reservations
      ensures r.obligation > 0 && r.obligation in after.obligations && r.actor > 0 &&
        settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
        |ProofLib.Filter((other: Reservation) => (other.obligation == r.obligation), after.reservations)| == 1
    {
      ProofLib.FilterAppend((other: Reservation) => (other.obligation == r.obligation), v.reservations, added);
      if r == added {
        ProofLib.FilterNone((other: Reservation) => (other.obligation == r.obligation), v.reservations);
      } else {
        assert r in v.reservations;
      }
    }
    SettlementHistoryMeaning(v);
    SettlementHistoryMeaning(after);
    forall r | r in after.settled
      ensures r.obligation > 0 && r.obligation in after.obligations && r.actor > 0 && r.recipient != "" && r.transaction != "" &&
        settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
        r.receipt > 0 && r.receipt in after.receipts && r.height > 0 &&
        !(exists pending :: pending in after.reservations && pending.obligation == r.obligation) &&
        |ProofLib.Filter((other: SettlementRecord) => (other.obligation == r.obligation), after.settled)| == 1
    {
      assert r in v.settled;
      assert r.obligation in v.obligations;
      assert r.obligation != obligation;
    }
  }
}

lemma payReserved_ensures(v: Vault, amount: seq<int>, vault: string, asset: string, actor: int, recipient: string, obligation: int, receipt: int, finalizedHeight: int, transaction: string)
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysSettlementTotal(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysConserved(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysValidAmounts(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysReservationMatches(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysReservationTotal(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysReservationIdentity(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> alwaysSettlementHistory(payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> stepRetainedSettlements(v, payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> stepRetainedObligations(v, payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) ==> stepIdentityFixed(v, payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction)))
{
  if inv(v) && canPayReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction) {
    settlement__money_lawSubtractionValid_ensures(v.reserved, amount);
    settlement__money_lawAdditionValid_ensures(v.paid, amount);
    var keep := (r: Reservation) => (r.obligation != obligation);
    var after := payReserved(v, amount, vault, asset, actor, recipient, obligation, receipt, finalizedHeight, transaction);
    var added := SettlementRecord(obligation, actor, recipient, amount, receipt, finalizedHeight, transaction);
    assert after.reservations == withoutReservation(v.reservations, obligation);
    RetainedReservations(v.reservations, [], obligation);
    assert after.reservations == ProofLib.Filter(keep, v.reservations);
    ReservationIdentityMeaning(v);
    ReservationIdentityMeaning(after);
    SettlementHistoryMeaning(v);
    SettlementHistoryMeaning(after);
    var matched :| matched in v.reservations && matched.obligation == obligation && matched.actor == actor && settlement__money_equalAmounts(matched.amount, amount);
    assert matched.obligation in v.obligations;
    assert forall other :: other in v.reservations && other.obligation == obligation ==> other == matched by {
      forall other | other in v.reservations && other.obligation == obligation ensures other == matched {
        var hasKey := (r: Reservation) => (r.obligation == matched.obligation);
        ProofLib.FilterMember(hasKey, v.reservations, matched);
        ProofLib.FilterMember(hasKey, v.reservations, other);
      }
    }
    ComputeVaultPaymentTotals(v, after, matched, amount, obligation, added);
    forall r | r in after.reservations
      ensures r.obligation > 0 && r.obligation in after.obligations && r.actor > 0 &&
        settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) && r.obligation != obligation &&
        |ProofLib.Filter((other: Reservation) => (other.obligation == r.obligation), after.reservations)| == 1
    {
      ProofLib.FilterMember(keep, v.reservations, r);
      RetainedReservationFilter(v.reservations, obligation, r.obligation);
    }
    assert forall r :: r in v.settled ==> r.obligation != obligation;
    forall r | r in after.settled
      ensures r.obligation > 0 && r.obligation in after.obligations && r.actor > 0 && r.recipient != "" && r.transaction != "" &&
        settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
        r.receipt > 0 && r.receipt in after.receipts && r.height > 0 &&
        !(exists pending :: pending in after.reservations && pending.obligation == r.obligation) &&
        |ProofLib.Filter((other: SettlementRecord) => (other.obligation == r.obligation), after.settled)| == 1
    {
      ProofLib.FilterAppend((other: SettlementRecord) => (other.obligation == r.obligation), v.settled, added);
      if r == added {
        ProofLib.FilterNone((other: SettlementRecord) => (other.obligation == r.obligation), v.settled);
      } else {
        assert r in v.settled;
        forall pending | pending in after.reservations ensures pending.obligation != r.obligation
        {
          ProofLib.FilterMember(keep, v.reservations, pending);
        }
      }
    }
  }
}

lemma ReservationIdentityMeaning(v: Vault)
  ensures alwaysReservationIdentity(v) == !(exists r :: (r in v.reservations && !(r.obligation > 0 && r.obligation in v.obligations && r.actor > 0 &&
    settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
    |ProofLib.Filter((other: Reservation) => (other.obligation == r.obligation), v.reservations)| == 1)))
{
}

lemma SettlementHistoryMeaning(v: Vault)
  ensures alwaysSettlementHistory(v) == !(exists r :: (r in v.settled && !(r.obligation > 0 && r.obligation in v.obligations && r.actor > 0 && r.recipient != "" && r.transaction != "" &&
    settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
    r.receipt > 0 && r.receipt in v.receipts && r.height > 0 &&
    !(exists pending :: pending in v.reservations && pending.obligation == r.obligation) &&
    |ProofLib.Filter((other: SettlementRecord) => (other.obligation == r.obligation), v.settled)| == 1)))
{
}

lemma RetainedReservations(xs: seq<Reservation>, prefix: seq<Reservation>, obligation: int)
  ensures Std.Collections.Seq.FoldLeft((remaining: seq<Reservation>, r: Reservation) => (if (r.obligation == obligation) then remaining else (remaining + [r])), prefix, xs)
    == prefix + ProofLib.Filter((r: Reservation) => (r.obligation != obligation), xs)
  decreases |xs|
{
  var keep := (r: Reservation) => (r.obligation != obligation);
  if |xs| == 0 {
    ProofLib.FilterNil(keep, xs);
  } else {
    ProofLib.FilterCons(keep, xs);
    RetainedReservations(xs[1..], if keep(xs[0]) then prefix + [xs[0]] else prefix, obligation);
  }
}

lemma RetainedReservationFilter(xs: seq<Reservation>, removed: int, retained: int)
  requires removed != retained
  ensures ProofLib.Filter((other: Reservation) => (other.obligation == retained),
    ProofLib.Filter((r: Reservation) => (r.obligation != removed), xs)) ==
      ProofLib.Filter((other: Reservation) => (other.obligation == retained), xs)
{
  var keep := (r: Reservation) => (r.obligation != removed);
  var hasKey := (other: Reservation) => (other.obligation == retained);
  NestedReservationFilter(hasKey, keep, xs);
}

lemma NestedReservationFilter(p: Reservation -> bool, q: Reservation -> bool, xs: seq<Reservation>)
  requires forall x :: p(x) ==> q(x)
  ensures ProofLib.Filter(p, ProofLib.Filter(q, xs)) == ProofLib.Filter(p, xs)
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(q, xs);
  } else {
    var first := xs[0];
    var tail := xs[1..];
    var filtered := ProofLib.Filter(q, tail);
    ProofLib.FilterCons(q, xs);
    ProofLib.FilterCons(p, xs);
    NestedReservationFilter(p, q, tail);
    if q(first) {
      ProofLib.FilterCons(p, [first] + filtered);
      assert ([first] + filtered)[0] == first;
      assert ([first] + filtered)[1..] == filtered;
    } else {
      assert !p(first);
      assert ProofLib.Filter(q, xs) == filtered;
    }
  }
}

lemma deposit_ensures(v: Vault, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysSettlementTotal(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysConserved(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysValidAmounts(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationMatches(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationTotal(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationIdentity(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysSettlementHistory(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepRetainedSettlements(v, deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepRetainedObligations(v, deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepIdentityFixed(v, deposit(v, amount, asset, receipt, finalized)))
{
  if inv(v) && canDeposit(v, amount, asset, receipt, finalized) {
    settlement__money_lawAdditionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.deposited, amount);
    var lower := settlement__money_addAmounts(v.free, v.reserved);
    var upper := settlement__money_addAmounts(v.paid, v.refunded);
    var all := settlement__money_addAmounts(lower, upper);
    settlement__money_lawAdditionValid_ensures(v.free, v.reserved);
    settlement__money_lawAdditionValid_ensures(v.paid, v.refunded);
    settlement__money_lawAdditionValid_ensures(lower, upper);
    settlement__money_lawAddCongruence_ensures(v.deposited, all, amount);
    RotateVaultSums(v.free, v.reserved, upper, amount);
    var oldThenDeposit := settlement__money_addAmounts(all, amount);
    var depositThenSum := settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_addAmounts(v.free, amount), v.reserved), upper);
    VaultEqualChain(settlement__money_addAmounts(v.deposited, amount), oldThenDeposit, depositThenSum);
    assert alwaysConserved(deposit(v, amount, asset, receipt, finalized));
  }
}

lemma refund_ensures(v: Vault, amount: seq<int>, destination: string, receipt: int, finalizedHeight: int, by_: string)
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysSettlementTotal(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysConserved(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysValidAmounts(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationMatches(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationTotal(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationIdentity(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysSettlementHistory(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepRetainedSettlements(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepRetainedObligations(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepIdentityFixed(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
{
  if inv(v) && canRefund(v, amount, destination, receipt, finalizedHeight, by_) {
    settlement__money_lawSubtractionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.refunded, amount);
    var freeAfter := settlement__money_subtractAmounts(v.free, amount);
    var lower := settlement__money_addAmounts(v.free, v.reserved);
    var upper := settlement__money_addAmounts(v.paid, v.refunded);
    var all := settlement__money_addAmounts(lower, upper);
    settlement__money_lawAdditionValid_ensures(freeAfter, v.reserved);
    settlement__money_lawAdditionValid_ensures(v.paid, v.refunded);
    settlement__money_lawAdditionValid_ensures(v.free, v.reserved);
    settlement__money_lawAdditionValid_ensures(lower, upper);
    VaultCrossBucket(v.free, v.reserved, v.refunded, v.paid, amount);
    var oldSwapped := settlement__money_addAmounts(lower, settlement__money_addAmounts(v.refunded, v.paid));
    var newRefund := settlement__money_addAmounts(v.refunded, amount);
    settlement__money_lawAddCommutative_ensures(v.refunded, v.paid);
    settlement__money_lawAddCommutative_ensures(newRefund, v.paid);
    assert settlement__money_equalAmounts(v.deposited, oldSwapped);
    VaultEqualChain(v.deposited, oldSwapped, settlement__money_addAmounts(settlement__money_addAmounts(freeAfter,v.reserved), settlement__money_addAmounts(newRefund,v.paid)));
    assert alwaysConserved(refund(v, amount, destination, receipt, finalizedHeight, by_));
  }
}

lemma VaultEqualChain(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a, b) && settlement__money_equalAmounts(b, c)
  ensures settlement__money_equalAmounts(a, c)
{
  settlement__money_lawEqualSubstitution_ensures(a, b, c);
}

lemma ValidReservationSum(xs: seq<Reservation>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), start, xs))
  ensures settlement__money_positiveAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), start, xs)) ==
    (settlement__money_positiveAmount(start) || (exists r :: (r in xs && settlement__money_positiveAmount(r.amount))))
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    assert first in xs;
    settlement__money_lawAdditionValid_ensures(start, first.amount);
    settlement__money_lawPositiveAddition_ensures(start, first.amount);
    ValidReservationSum(xs[1..], settlement__money_addAmounts(start, first.amount));
    assert xs == [first] + xs[1..];
  }
}

lemma ValidSettlementSum(xs: seq<SettlementRecord>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: SettlementRecord) => settlement__money_addAmounts(total, r.amount), start, xs))
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    settlement__money_lawAdditionValid_ensures(start, xs[0].amount);
    ValidSettlementSum(xs[1..], settlement__money_addAmounts(start, xs[0].amount));
  }
}

lemma MoveVaultAmount(source: seq<int>, target: seq<int>, amount: seq<int>)
  requires settlement__money_validAmount(source) && settlement__money_validAmount(target) && settlement__money_validAmount(amount)
  requires settlement__money_compareAmounts(source, amount) >= 0
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(source, target),
    settlement__money_addAmounts(settlement__money_subtractAmounts(source, amount), settlement__money_addAmounts(target, amount)))
{
  var rest := settlement__money_subtractAmounts(source, amount);
  var reconstructed := settlement__money_addAmounts(rest, amount);
  settlement__money_lawSubtractionValid_ensures(source, amount);
  settlement__money_lawAdditionValid_ensures(rest, amount);
  settlement__money_lawSubtractionReconstructs_ensures(source, amount);
  settlement__money_lawAddCongruence_ensures(reconstructed, source, target);
  settlement__money_lawAddAssociative_ensures(rest, amount, target);
  settlement__money_lawAddCommutative_ensures(amount, target);
  var sum := settlement__money_addAmounts(source, target);
  var equivalent := settlement__money_addAmounts(reconstructed, target);
  settlement__money_lawEqualSymmetric_ensures(sum, equivalent);
  VaultEqualChain(sum, equivalent, settlement__money_addAmounts(rest, settlement__money_addAmounts(target, amount)));
}

lemma RotateVaultSums(free: seq<int>, reserved: seq<int>, transferred: seq<int>, amount: seq<int>)
  requires settlement__money_validAmount(free) && settlement__money_validAmount(reserved)
  requires settlement__money_validAmount(transferred) && settlement__money_validAmount(amount)
  ensures settlement__money_equalAmounts(
    settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_addAmounts(free, reserved), transferred), amount),
    settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_addAmounts(free, amount), reserved), transferred))
{
  var lower := settlement__money_addAmounts(free, reserved);
  var shifted := settlement__money_addAmounts(settlement__money_addAmounts(free, amount), reserved);
  settlement__money_lawAdditionValid_ensures(free, reserved);
  settlement__money_lawAdditionValid_ensures(free, amount);
  settlement__money_lawAddAssociative_ensures(lower, transferred, amount);
  settlement__money_lawAddCommutative_ensures(transferred, amount);
  settlement__money_lawAddAssociative_ensures(lower, amount, transferred);
  var intermediate := settlement__money_addAmounts(settlement__money_addAmounts(lower, amount), transferred);
  var pivot := settlement__money_addAmounts(lower, settlement__money_addAmounts(amount, transferred));
  settlement__money_lawEqualSymmetric_ensures(pivot, intermediate);
  VaultEqualChain(settlement__money_addAmounts(settlement__money_addAmounts(lower, transferred), amount), pivot, intermediate);
  settlement__money_lawAddAssociative_ensures(free, reserved, amount);
  settlement__money_lawAddAssociative_ensures(free, amount, reserved);
  settlement__money_lawAddCommutative_ensures(reserved, amount);
  var common := settlement__money_addAmounts(free, settlement__money_addAmounts(reserved, amount));
  settlement__money_lawEqualSymmetric_ensures(common, shifted);
  VaultEqualChain(settlement__money_addAmounts(lower, amount), common, shifted);
  settlement__money_lawAdditionValid_ensures(lower, amount);
  settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(free, amount), reserved);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(lower, amount), shifted, transferred);
  VaultEqualChain(settlement__money_addAmounts(settlement__money_addAmounts(lower, transferred), amount), intermediate, settlement__money_addAmounts(shifted, transferred));
}

lemma ComputeVaultPaymentTotals(v: Vault, after: Vault, matched: Reservation, amount: seq<int>, obligation: int, added: SettlementRecord)
  requires inv(v)
  requires matched in v.reservations && matched.obligation == obligation && settlement__money_equalAmounts(matched.amount, amount)
  requires forall other :: other in v.reservations && other.obligation == obligation ==> other == matched
  requires |ProofLib.Filter((other: Reservation) => (other.obligation == matched.obligation), v.reservations)| == 1
  requires after.reservations == ProofLib.Filter((r: Reservation) => (r.obligation != obligation), v.reservations)
  requires after.reservation == (|after.reservations| > 0)
  requires settlement__money_validAmount(amount) && settlement__money_compareAmounts(v.reserved, amount) >= 0
  requires after.reserved == settlement__money_subtractAmounts(v.reserved, amount)
  requires after.paid == settlement__money_addAmounts(v.paid, amount) && after.settled == v.settled + [added] && added.amount == amount
  requires after.free == v.free && after.refunded == v.refunded && after.deposited == v.deposited
  ensures alwaysReservationMatches(after)
  ensures alwaysReservationTotal(after)
  ensures alwaysSettlementTotal(after)
  ensures alwaysConserved(after)
{
  var keep := (r: Reservation) => (r.obligation != obligation);
  var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
  var oldReserved := Std.Collections.Seq.FoldLeft(total, settlement__money_zero, v.reservations);
  var remaining := Std.Collections.Seq.FoldLeft(total, settlement__money_zero, after.reservations);
  var settled := (sum: settlement__money_Amount, r: SettlementRecord) => settlement__money_addAmounts(sum, r.amount);
  var oldPaid := Std.Collections.Seq.FoldLeft(settled, settlement__money_zero, v.settled);
  forall r | r in after.reservations ensures settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) {
    ProofLib.FilterMember(keep, v.reservations, r);
  }
  ValidReservationSum(v.reservations, settlement__money_zero);
  ValidReservationSum(after.reservations, settlement__money_zero);
  ReservationSumRemoval(v.reservations, matched, settlement__money_zero);
  settlement__money_lawAdditionValid_ensures(remaining, matched.amount);
  settlement__money_lawAdditionValid_ensures(remaining, amount);
  settlement__money_lawAddCongruence_ensures(matched.amount, amount, remaining);
  settlement__money_lawEqualSymmetric_ensures(oldReserved, settlement__money_addAmounts(remaining, matched.amount));
  VaultEqualChain(v.reserved, oldReserved, settlement__money_addAmounts(remaining, matched.amount));
  VaultEqualChain(v.reserved, settlement__money_addAmounts(remaining, matched.amount), settlement__money_addAmounts(remaining, amount));
  settlement__money_lawSubtractionValid_ensures(v.reserved, amount);
  settlement__money_lawSubtractionReconstructs_ensures(v.reserved, amount);
  VaultEqualChain(settlement__money_addAmounts(after.reserved, amount), v.reserved, settlement__money_addAmounts(remaining, amount));
  settlement__money_lawAddOrder_ensures(after.reserved, remaining, amount);
  settlement__money_lawEqualOrder_ensures(after.reserved, remaining, settlement__money_zero);
  assert !settlement__money_positiveAmount(settlement__money_zero);
  assert alwaysReservationTotal(after) && alwaysReservationMatches(after);
  ValidSettlementSum(v.settled, settlement__money_zero);
  ProofLib.FoldLeftAppend(settled, settlement__money_zero, v.settled, added);
  settlement__money_lawAddCongruence_ensures(v.paid, oldPaid, amount);
  assert alwaysSettlementTotal(after);
  VaultCrossBucket(v.reserved, v.free, v.paid, v.refunded, amount);
  settlement__money_lawAddCommutative_ensures(v.reserved, v.free);
  settlement__money_lawAddCommutative_ensures(after.reserved, v.free);
  VaultEqualChain(v.deposited, settlement__money_addAmounts(settlement__money_addAmounts(v.reserved, v.free), settlement__money_addAmounts(v.paid, v.refunded)),
    settlement__money_addAmounts(settlement__money_addAmounts(after.reserved, v.free), settlement__money_addAmounts(after.paid, v.refunded)));
}

lemma VaultCrossBucket(source: seq<int>, fixedBalance: seq<int>, destination: seq<int>, other: seq<int>, amount: seq<int>)
  requires settlement__money_validAmount(source) && settlement__money_validAmount(fixedBalance)
  requires settlement__money_validAmount(destination) && settlement__money_validAmount(other) && settlement__money_validAmount(amount)
  requires settlement__money_compareAmounts(source, amount) >= 0
  ensures settlement__money_equalAmounts(
    settlement__money_addAmounts(settlement__money_addAmounts(source, fixedBalance), settlement__money_addAmounts(destination, other)),
    settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_subtractAmounts(source, amount), fixedBalance), settlement__money_addAmounts(settlement__money_addAmounts(destination, amount), other)))
{
  var rest := settlement__money_subtractAmounts(source, amount);
  var low := settlement__money_addAmounts(rest, fixedBalance);
  var high := settlement__money_addAmounts(destination, other);
  var sumBefore := settlement__money_addAmounts(settlement__money_addAmounts(source, fixedBalance), high);
  var restored := settlement__money_addAmounts(rest, amount);
  var rearranged := settlement__money_addAmounts(settlement__money_addAmounts(restored, fixedBalance), high);
  settlement__money_lawSubtractionValid_ensures(source, amount);
  settlement__money_lawSubtractionReconstructs_ensures(source, amount);
  settlement__money_lawAdditionValid_ensures(rest, amount);
  settlement__money_lawAdditionValid_ensures(destination, other);
  settlement__money_lawAddCongruence_ensures(restored, source, fixedBalance);
  var lowOld := settlement__money_addAmounts(source, fixedBalance);
  var lowRestored := settlement__money_addAmounts(restored, fixedBalance);
  settlement__money_lawAdditionValid_ensures(source, fixedBalance);
  settlement__money_lawAdditionValid_ensures(restored, fixedBalance);
  settlement__money_lawAddCongruence_ensures(lowRestored, lowOld, high);
  settlement__money_lawEqualSymmetric_ensures(sumBefore, rearranged);
  RotateVaultSums(rest, fixedBalance, high, amount);
  var raised := settlement__money_addAmounts(settlement__money_addAmounts(low, high), amount);
  settlement__money_lawEqualSymmetric_ensures(rearranged, raised);
  VaultEqualChain(sumBefore, rearranged, raised);
  settlement__money_lawAdditionValid_ensures(rest, fixedBalance);
  settlement__money_lawAddAssociative_ensures(low, high, amount);
  VaultEqualChain(sumBefore, raised, settlement__money_addAmounts(low, settlement__money_addAmounts(high, amount)));
  settlement__money_lawAddAssociative_ensures(destination, other, amount);
  settlement__money_lawAddAssociative_ensures(destination, amount, other);
  settlement__money_lawAddCommutative_ensures(other, amount);
  var highNew := settlement__money_addAmounts(settlement__money_addAmounts(destination, amount), other);
  var shared := settlement__money_addAmounts(destination, settlement__money_addAmounts(amount, other));
  settlement__money_lawEqualSymmetric_ensures(shared, highNew);
  VaultEqualChain(settlement__money_addAmounts(high, amount), shared, highNew);
  settlement__money_lawAdditionValid_ensures(high, amount);
  settlement__money_lawAdditionValid_ensures(destination, amount);
  settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(destination, amount), other);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(high, amount), highNew, low);
  VaultEqualChain(sumBefore, settlement__money_addAmounts(low, settlement__money_addAmounts(high, amount)), settlement__money_addAmounts(low, highNew));
}

lemma ReservationFoldAppend(xs: seq<Reservation>, start: seq<int>, added: Reservation)
  ensures Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), start, xs + [added]) ==
    settlement__money_addAmounts(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), start, xs), added.amount)
{
  ProofLib.FoldLeftAppend((total: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(total, r.amount), start, xs, added);
}

lemma ReservationSumRemoval(xs: seq<Reservation>, selected: Reservation, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires settlement__money_validAmount(selected.amount)
  requires selected in xs
  requires |ProofLib.Filter((other: Reservation) => (other.obligation == selected.obligation), xs)| == 1
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
    var kept := ProofLib.Filter((r: Reservation) => (r.obligation != selected.obligation), xs);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(total, start, xs),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(total, start, kept), selected.amount))
  decreases |xs|
{
  assert |xs| > 0;
  var first := xs[0];
  var tail := xs[1..];
  var hasKey := (other: Reservation) => (other.obligation == selected.obligation);
  var keep := (r: Reservation) => (r.obligation != selected.obligation);
  var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
  assert first in xs;
  assert forall other :: other in tail ==> other in xs;
  ProofLib.FilterCons(hasKey, xs);
  ProofLib.FilterCons(keep, xs);
  var next := settlement__money_addAmounts(start, first.amount);
  settlement__money_lawAdditionValid_ensures(start, first.amount);
  if hasKey(first) {
    assert |ProofLib.Filter(hasKey, tail)| == 0;
    if first != selected {
      assert selected in tail;
      ProofLib.FilterMember(hasKey, tail, selected);
      assert false;
    }
    ProofLib.FilterNone(hasKey, tail);
    assert forall i :: 0 <= i < |tail| ==> keep(tail[i]);
    KeepAllReservations(keep, tail);
    assert ProofLib.Filter(keep, xs) == tail;
    ReservationSumShift(tail, start, first.amount);
    assert first.amount == selected.amount;
    assert Std.Collections.Seq.FoldLeft(total, start, xs) == Std.Collections.Seq.FoldLeft(total, next, tail);
    assert settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(total, start, xs),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(total, start, ProofLib.Filter(keep, xs)), selected.amount));
  } else {
    assert selected in tail;
    assert |ProofLib.Filter(hasKey, tail)| == 1;
    assert ProofLib.Filter(keep, xs) == [first] + ProofLib.Filter(keep, tail);
    ReservationSumRemoval(tail, selected, next);
    var kept := ProofLib.Filter(keep, xs);
    assert |kept| > 0 && kept[0] == first;
    assert kept[1..] == ProofLib.Filter(keep, tail);
    assert Std.Collections.Seq.FoldLeft(total, start, kept) == Std.Collections.Seq.FoldLeft(total, next, kept[1..]);
    assert Std.Collections.Seq.FoldLeft(total, start, xs) == Std.Collections.Seq.FoldLeft(total, next, tail);
    assert settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(total, start, xs),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(total, start, kept), selected.amount));
  }
}

lemma KeepAllReservations(keep: Reservation -> bool, xs: seq<Reservation>)
  requires forall i :: 0 <= i < |xs| ==> keep(xs[i])
  ensures ProofLib.Filter(keep, xs) == xs
  decreases |xs|
{
  if |xs| == 0 { ProofLib.FilterNil(keep, xs); }
  else {
    var tail := xs[1..];
    assert forall i :: 0 <= i < |tail| ==> tail[i] == xs[i+1];
    ProofLib.FilterCons(keep, xs);
    KeepAllReservations(keep, tail);
    assert xs == [xs[0]] + tail;
  }
}

lemma ReservationSumShift(xs: seq<Reservation>, start: seq<int>, amount: seq<int>)
  requires settlement__money_validAmount(start) && settlement__money_validAmount(amount)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(total, settlement__money_addAmounts(start, amount), xs),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(total, start, xs), amount))
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    var tail := xs[1..];
    var left := settlement__money_addAmounts(settlement__money_addAmounts(start, amount), first.amount);
    var right := settlement__money_addAmounts(settlement__money_addAmounts(start, first.amount), amount);
    assert first in xs;
    settlement__money_lawAdditionValid_ensures(start, amount);
    settlement__money_lawAdditionValid_ensures(start, first.amount);
    settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(start, amount), first.amount);
    settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(start, first.amount), amount);
    settlement__money_lawAddAssociative_ensures(start, amount, first.amount);
    settlement__money_lawAddAssociative_ensures(start, first.amount, amount);
    settlement__money_lawAddCommutative_ensures(amount, first.amount);
    var common := settlement__money_addAmounts(start, settlement__money_addAmounts(first.amount, amount));
    settlement__money_lawEqualSymmetric_ensures(common,right);
    VaultEqualChain(left, common, right);
    ReservationSumEquivalent(tail, left, right);
    ReservationSumShift(tail, settlement__money_addAmounts(start, first.amount), amount);
    var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
    VaultEqualChain(Std.Collections.Seq.FoldLeft(total, left, tail), Std.Collections.Seq.FoldLeft(total, right, tail),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(total, settlement__money_addAmounts(start, first.amount), tail),amount));
  } else {
    settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(start, amount));
  }
}

lemma ReservationSumEquivalent(xs: seq<Reservation>, a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_equalAmounts(a,b)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures var total := (sum: settlement__money_Amount, r: Reservation) => settlement__money_addAmounts(sum, r.amount);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(total, a, xs), Std.Collections.Seq.FoldLeft(total, b, xs))
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    assert first in xs;
    settlement__money_lawAdditionValid_ensures(a, first.amount);
    settlement__money_lawAdditionValid_ensures(b, first.amount);
    settlement__money_lawAddCongruence_ensures(a,b,first.amount);
    ReservationSumEquivalent(xs[1..],settlement__money_addAmounts(a,first.amount),settlement__money_addAmounts(b,first.amount));
  }
}

lemma PreserveVaultReserveValue(v: Vault, amount: seq<int>)
  requires alwaysConserved(v) && alwaysValidAmounts(v) && settlement__money_validAmount(amount)
  requires settlement__money_compareAmounts(v.free, amount) >= 0
  ensures settlement__money_equalAmounts(v.deposited,
    settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_subtractAmounts(v.free, amount), settlement__money_addAmounts(v.reserved, amount)),
      settlement__money_addAmounts(v.paid, v.refunded)))
{
  var low := settlement__money_addAmounts(v.free, v.reserved);
  var remainder := settlement__money_subtractAmounts(v.free, amount);
  var aggregate := settlement__money_addAmounts(v.reserved, amount);
  var changed := settlement__money_addAmounts(remainder, aggregate);
  var top := settlement__money_addAmounts(v.paid, v.refunded);
  MoveVaultAmount(v.free, v.reserved, amount);
  settlement__money_lawSubtractionValid_ensures(v.free, amount);
  settlement__money_lawAdditionValid_ensures(v.reserved, amount);
  settlement__money_lawAdditionValid_ensures(remainder, aggregate);
  settlement__money_lawAdditionValid_ensures(v.free, v.reserved);
  settlement__money_lawAdditionValid_ensures(v.paid, v.refunded);
  settlement__money_lawAddCongruence_ensures(low, changed, top);
  VaultEqualChain(v.deposited, settlement__money_addAmounts(low, top), settlement__money_addAmounts(changed, top));
}
