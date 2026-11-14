lemma reserve_ensures(v: Vault, amount: seq<int>, recipient: string, obligation: int)
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysConserved(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysValidAmounts(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysReservationMatches(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysReservationTotal(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysReservationIdentity(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysSettlementHistory(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> alwaysSettlementTotal(reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> stepRetainedObligations(v, reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> stepIdentityFixed(v, reserve(v, amount, recipient, obligation)))
  ensures (inv(v) ==> canReserve(v, amount, recipient, obligation) ==> stepRetainedSettlements(v, reserve(v, amount, recipient, obligation)))
{
  if inv(v) && canReserve(v, amount, recipient, obligation) {
    settlement__money_lawSubtractionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.reserved, amount);
    var added := Reservation(obligation, recipient, amount);
    var after := reserve(v, amount, recipient, obligation);
    ReservationIdentityMeaning(v);
    ReservationIdentityMeaning(after);
    assert forall r :: r in v.reservations ==> r.obligation in v.obligations;
    assert forall r :: r in v.reservations ==> r.obligation != obligation;
    forall r | r in after.reservations
      ensures r.obligation > 0 && r.obligation in after.obligations && r.recipient != "" &&
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
      ensures r.obligation > 0 && r.obligation in after.obligations && r.recipient != "" &&
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

lemma payReserved_ensures(v: Vault, amount: seq<int>, vault: string, asset: string, recipient: string, obligation: int, receipt: int, finalizedHeight: int)
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysConserved(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysValidAmounts(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysReservationMatches(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysReservationTotal(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysReservationIdentity(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysSettlementHistory(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> alwaysSettlementTotal(payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> stepRetainedObligations(v, payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> stepIdentityFixed(v, payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
  ensures (inv(v) ==> canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) ==> stepRetainedSettlements(v, payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight)))
{
  if inv(v) && canPayReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight) {
    settlement__money_lawSubtractionValid_ensures(v.reserved, amount);
    settlement__money_lawAdditionValid_ensures(v.paid, amount);
    var keep := (r: Reservation) => (r.obligation != obligation);
    var after := payReserved(v, amount, vault, asset, recipient, obligation, receipt, finalizedHeight);
    var added := SettlementRecord(obligation, recipient, amount, receipt, finalizedHeight);
    assert after.reservations == withoutReservation(v.reservations, obligation);
    RetainedReservations(v.reservations, [], obligation);
    assert after.reservations == ProofLib.Filter(keep, v.reservations);
    ReservationIdentityMeaning(v);
    ReservationIdentityMeaning(after);
    SettlementHistoryMeaning(v);
    SettlementHistoryMeaning(after);
    var matched :| matched in v.reservations && matched.obligation == obligation && matched.recipient == recipient && settlement__money_equalAmounts(matched.amount, amount);
    assert matched.obligation in v.obligations;
    forall r | r in after.reservations
      ensures r.obligation > 0 && r.obligation in after.obligations && r.recipient != "" &&
        settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) && r.obligation != obligation &&
        |ProofLib.Filter((other: Reservation) => (other.obligation == r.obligation), after.reservations)| == 1
    {
      ProofLib.FilterMember(keep, v.reservations, r);
      RetainedReservationFilter(v.reservations, obligation, r.obligation);
    }
    assert forall r :: r in v.settled ==> r.obligation != obligation;
    forall r | r in after.settled
      ensures r.obligation > 0 && r.obligation in after.obligations && r.recipient != "" &&
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
  ensures alwaysReservationIdentity(v) == !(exists r :: (r in v.reservations && !(r.obligation > 0 && r.obligation in v.obligations && r.recipient != "" &&
    settlement__money_validAmount(r.amount) && settlement__money_positiveAmount(r.amount) &&
    |ProofLib.Filter((other: Reservation) => (other.obligation == r.obligation), v.reservations)| == 1)))
{
}

lemma SettlementHistoryMeaning(v: Vault)
  ensures alwaysSettlementHistory(v) == !(exists r :: (r in v.settled && !(r.obligation > 0 && r.obligation in v.obligations && r.recipient != "" &&
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
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysConserved(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysValidAmounts(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationMatches(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationTotal(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysReservationIdentity(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysSettlementHistory(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> alwaysSettlementTotal(deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepRetainedObligations(v, deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepIdentityFixed(v, deposit(v, amount, asset, receipt, finalized)))
  ensures (inv(v) ==> canDeposit(v, amount, asset, receipt, finalized) ==> stepRetainedSettlements(v, deposit(v, amount, asset, receipt, finalized)))
{
  if inv(v) && canDeposit(v, amount, asset, receipt, finalized) {
    settlement__money_lawAdditionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.deposited, amount);
  }
}

lemma refund_ensures(v: Vault, amount: seq<int>, destination: string, receipt: int, finalizedHeight: int, by_: string)
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysConserved(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysValidAmounts(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationMatches(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationTotal(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysReservationIdentity(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysSettlementHistory(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> alwaysSettlementTotal(refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepRetainedObligations(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepIdentityFixed(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
  ensures (inv(v) ==> canRefund(v, amount, destination, receipt, finalizedHeight, by_) ==> stepRetainedSettlements(v, refund(v, amount, destination, receipt, finalizedHeight, by_)))
{
  if inv(v) && canRefund(v, amount, destination, receipt, finalizedHeight, by_) {
    settlement__money_lawSubtractionValid_ensures(v.free, amount);
    settlement__money_lawAdditionValid_ensures(v.refunded, amount);
  }
}
