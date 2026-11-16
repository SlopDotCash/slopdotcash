/** Every distinct source claim is assigned to exactly one nonempty unit. */
//@ verify
//@ requires claimCount >= 0
//@ ensures \result <==> CompleteClaimPartition(claimCount, units)
export function completeClaimPartition(
  claimCount: number,
  units: number[][],
): boolean {
  const seen: boolean[] = [];
  let b = 0;
  while (b < claimCount) {
    //@ invariant 0 <= b && b <= claimCount
    //@ invariant seen.length == b
    //@ invariant forall(k, 0 <= k && k < b ==> !seen[k])
    seen.push(false);
    b += 1;
  }
  let u = 0;
  while (u < units.length) {
    //@ invariant 0 <= u && u <= units.length
    //@ invariant forall(k, 0 <= k && k < u ==> units[k].length > 0)
    //@ invariant seen.length == claimCount
    //@ invariant ClaimsInRange(FlattenClaims(units.slice(0, u)), claimCount)
    //@ invariant DistinctClaims(FlattenClaims(units.slice(0, u)))
    //@ invariant forall(k, 0 <= k && k < claimCount ==> (seen[k] <==> ContainsClaim(FlattenClaims(units.slice(0, u)), k)))
    const unit = units[u];
    if (unit.length === 0) return false;
    let i = 0;
    while (i < unit.length) {
      //@ invariant 0 <= u && u < units.length
      //@ invariant unit == units[u] && unit.length > 0
      //@ invariant 0 <= i && i <= unit.length
      //@ invariant forall(k, 0 <= k && k <= u ==> units[k].length > 0)
      //@ invariant seen.length == claimCount
      //@ invariant ClaimsInRange(ClaimsPrefix(units, u, i), claimCount)
      //@ invariant DistinctClaims(ClaimsPrefix(units, u, i))
      //@ invariant forall(k, 0 <= k && k < claimCount ==> (seen[k] <==> ContainsClaim(ClaimsPrefix(units, u, i), k)))
      const claim = unit[i];
      if (claim < 0 || claim >= claimCount || seen[claim]) return false;
      seen[claim] = true;
      i += 1;
    }
    u += 1;
  }
  b = 0;
  while (b < claimCount) {
    //@ invariant 0 <= b && b <= claimCount
    //@ invariant forall(k, 0 <= k && k < units.length ==> units[k].length > 0)
    //@ invariant seen.length == claimCount
    //@ invariant ClaimsInRange(FlattenClaims(units), claimCount) && DistinctClaims(FlattenClaims(units))
    //@ invariant forall(k, 0 <= k && k < claimCount ==> (seen[k] <==> ContainsClaim(FlattenClaims(units), k)))
    //@ invariant forall(k, 0 <= k && k < b ==> seen[k])
    if (!seen[b]) return false;
    b += 1;
  }
  return true;
}
