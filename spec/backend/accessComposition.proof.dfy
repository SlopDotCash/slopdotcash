// spec/backend/accessComposition.md, "Every new participation write is refused for a banned account, at commit"; spec/backend/accessComposition.md, "The score generator gives no credit at or after a ban's start"

lemma commit_ensures(c: Composed, by_: int, gate: Gate)
  ensures (inv(c) ==> canCommit(c, by_, gate) ==> alwaysWritesTimed(commit(c, by_, gate)))
  ensures (inv(c) ==> canCommit(c, by_, gate) ==> stepCommitsOnlyUnbanned(c, commit(c, by_, gate)))
  ensures (inv(c) ==> canCommit(c, by_, gate) ==> stepWritesAreWholeOrNothing(c, "commit", commit(c, by_, gate)))
  ensures (inv(c) ==> canCommit(c, by_, gate) ==> stepRecordsRetained(c, commit(c, by_, gate)))
{
  if inv(c) && canCommit(c, by_, gate) {
    var w0 :| w0 in c.pending && w0.gate == gate && w0.actor == by_;
    assert by_ > 0;
    var after := commit(c, by_, gate);
    CommitPendingFilter(c, by_, gate);
    forall w | w in after.pending
      ensures w in c.pending
    {
      ProofLib.FilterMember((p: Write) => !(((p.gate == gate) && (p.actor == by_))), c.pending, w);
    }
  }
}

lemma lawEarlierCreditStays_ensures(c: Composed, v: ScoreEvent)
  ensures (lawEarlierCreditStays(c, v) == true)
{
  CreditedMember(c, v);
}

lemma CommitPendingFilter(c: Composed, by_: int, gate: Gate)
  ensures commit(c, by_, gate).pending == ProofLib.Filter((p: Write) => !(((p.gate == gate) && (p.actor == by_))), c.pending)
{
}

lemma CreditedFilter(c: Composed)
  ensures credited(c) == ProofLib.Filter((v: ScoreEvent) => !((exists b :: b in c.banStarts && (((b.target == v.actor) && (b.at <= v.at)) && inForce(c, b)))), c.events)
{
}

lemma CreditedMember(c: Composed, e: ScoreEvent)
  ensures e in credited(c) <==> e in c.events && !((exists b :: b in c.banStarts && (((b.target == e.actor) && (b.at <= e.at)) && inForce(c, b))))
{
  CreditedFilter(c);
  ProofLib.FilterMember((v: ScoreEvent) => !((exists b :: b in c.banStarts && (((b.target == v.actor) && (b.at <= v.at)) && inForce(c, b)))), c.events, e);
}
