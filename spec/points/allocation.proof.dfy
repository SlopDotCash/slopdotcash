// Unfold the literal recipient lists used by the allocation laws.
lemma lawSingleRecipient_ensures(total: int, actor: int, lines: int)
  ensures (lawSingleRecipient(total, actor, lines) == true)
{
  reveal Std.Collections.Seq.Filter();
  reveal Std.Collections.Seq.FoldLeft();
}

lemma lawEqualTwo_ensures(total: int)
  ensures (lawEqualTwo(total) == true)
{
  reveal Std.Collections.Seq.Filter();
  reveal Std.Collections.Seq.FoldLeft();
}

lemma lawTenPointSplit_ensures(total: int)
  ensures (lawTenPointSplit(total) == true)
{
  reveal Std.Collections.Seq.Filter();
  reveal Std.Collections.Seq.FoldLeft();
}
