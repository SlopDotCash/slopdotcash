lemma StatusMeaning(sources: seq<TextSource>, actor: int)
  ensures status(sources, actor) ==
    (var local_0 := ProofLib.Filter((s: TextSource) => assessed(s, actor), sources);
     var local_1 := |ProofLib.Filter((s: TextSource) => validSource(s), local_0)|;
     var local_2 := |ProofLib.Filter((s: TextSource) => invalidSource(s), local_0)|;
     if (((|local_0| > 0) && (local_1 == |local_0|)) && (local_2 == 0)) then
       AttributionStatus.Complete
     else
       if (local_1 > 0) then
         AttributionStatus.Partial
       else
         if (local_2 > 0) then
           AttributionStatus.Invalid
         else
           AttributionStatus.Missing)
{
}

lemma lawOtherActorsNeverChangeStatus_ensures(sources: seq<TextSource>, actor: int, other: TextSource)
  ensures (lawOtherActorsNeverChangeStatus(sources, actor, other) == true)
{
  if !assessed(other, actor) {
    StatusMeaning(sources, actor);
    StatusMeaning(sources + [other], actor);
    ProofLib.FilterAppend((s: TextSource) => assessed(s, actor), sources, other);
    var e1 := ProofLib.Filter((s: TextSource) => assessed(s, actor), sources);
    var e2 := ProofLib.Filter((s: TextSource) => assessed(s, actor), sources + [other]);
    assert e2 == e1;
  }
}

lemma lawBotTextIgnored_ensures(sources: seq<TextSource>, actor: int, other: TextSource)
  ensures (lawBotTextIgnored(sources, actor, other) == true)
{
  lawOtherActorsNeverChangeStatus_ensures(sources, actor, other.(bot := true));
}
