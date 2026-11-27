lemma FoldTwoAcceptance(f: (AcceptanceSource, AcceptanceSource) -> AcceptanceSource, z: AcceptanceSource, a: AcceptanceSource, b: AcceptanceSource)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b]) == f(f(z, a), b)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
}

lemma lawCompletionByTimeThenNodeId_ensures(first: AcceptanceSource, second: AcceptanceSource)
  ensures (lawCompletionByTimeThenNodeId(first, second) == true)
{
  FoldTwoAcceptance((acc: AcceptanceSource, a: AcceptanceSource) => (if laterAcceptance(a, acc) then a else acc), noAcceptance, first, second);
  FoldTwoAcceptance((acc: AcceptanceSource, a: AcceptanceSource) => (if laterAcceptance(a, acc) then a else acc), noAcceptance, second, first);
}
