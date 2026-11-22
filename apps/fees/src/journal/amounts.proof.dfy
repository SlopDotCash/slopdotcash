// The megawei ceiling is the Euclidean quotient of wei plus one less than a megawei, so its remainder bounds both directions;
// the total is proved by induction on how many amounts it has added.

lemma nativeUnits_ensures(wei: int, solana: bool)
  requires (wei >= 0)
  ensures (nativeUnits(wei, solana) >= 0)
  ensures (solana ==> (nativeUnits(wei, solana) == wei))
  ensures (!(solana) ==> ((((nativeUnits(wei, solana) - 1) * 1000000) < wei) && (wei <= (nativeUnits(wei, solana) * 1000000))))
{
  if !solana {
    var adjusted := wei + 999999;
    CeilingBounds(adjusted, 1000000);
    var quotient := adjusted / 1000000;
    var remainder := adjusted % 1000000;
    assert adjusted == quotient * 1000000 + remainder;
    assert 0 <= remainder < 1000000;
    assert nativeUnits(wei, solana) == quotient;
    assert (quotient - 1) * 1000000 == quotient * 1000000 - 1000000;
  }
}

lemma nativeWei_ensures(units: int, solana: bool)
  requires (units >= 0)
  ensures (nativeWei(units, solana) >= 0)
  ensures (solana ==> (nativeWei(units, solana) == units))
  ensures (!(solana) ==> (nativeWei(units, solana) == (units * 1000000)))
{
}

lemma overran_ensures(actual: int, maximum: int)
  ensures (overran(actual, maximum) <==> (actual > maximum))
{
}

lemma withinReservation_ensures(gas: int, feePerGas: int, maximum: int)
  requires (gas >= 0)
  requires (feePerGas >= 0)
  ensures (withinReservation(gas, feePerGas, maximum) <==> ((gas * feePerGas) <= maximum))
{
}

lemma sumOf_ensures(values: seq<int>, count: int)
  requires (0 <= count)
  requires (count <= |values|)
  requires forall i: int :: ((0 <= i) ==> (i < |values|) ==> (values[i] >= 0))
  ensures (sumOf(values, count) >= 0)
  ensures ((count > 0) ==> (sumOf(values, count) >= values[(count - 1)]))
  decreases count
{
  if count > 0 {
    sumOf_ensures(values, count - 1);
    assert values[count - 1] >= 0;
  }
}

lemma CeilingBounds(n: int, d: int)
  requires n >= 0
  requires d > 0
  ensures JSTruncDiv(n, d) == n / d
  ensures n / d >= 0
{
  assert n / d >= 0;
  assert JSTruncDiv(n, d) == n / d;
}
