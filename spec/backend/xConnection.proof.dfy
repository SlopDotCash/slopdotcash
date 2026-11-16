// Starting keeps only other members' live flows and appends exactly one of this member's.
lemma lawStartReplacesEarlierFlows_ensures(r: XRegistry, now: int, actor: int, session: int)
  ensures (lawStartReplacesEarlierFlows(r, now, actor, session) == true)
{
  var keep := (f: XFlow) => ((f.actor != actor) && (f.expiresAt > now));
  var mine := (f: XFlow) => (f.actor == actor);
  var kept := ProofLib.Filter(keep, r.flows);
  var added := XFlow((r.lastFlow + 1), actor, session, (r.lastFlow + 1), XFlowStatus.XPending, (now + xFlowLifetime));
  assert startX(r, now, actor, session).flows == kept + [added];
  ProofLib.FilterSubset(keep, r.flows);
  forall i | 0 <= i < |kept|
    ensures !mine(kept[i])
  {
    ProofLib.FilterMember(keep, r.flows, kept[i]);
  }
  ProofLib.FilterNone(mine, kept);
  ProofLib.FilterAppend(mine, kept, added);
}
