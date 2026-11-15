// Updating the phase of one well-formed run keeps every other run and every identity in place.
lemma PhaseUpdate(l: Locks, id: int, phase: RunPhase)
  requires alwaysRunsWellFormed(l)
  requires id > 0 && runOf(l, id).id == id
  ensures |setPhase(l, id, phase)| == |l.runs|
  ensures forall k :: 0 <= k < |l.runs| ==> setPhase(l, id, phase)[k] == (if l.runs[k].id == id then runOf(l, id).(phase := phase) else l.runs[k])
  ensures 0 <= id - 1 < |l.runs| && l.runs[id - 1] == runOf(l, id)
{
  forall k | 0 <= k < |l.runs|
    ensures setPhase(l, id, phase)[k] == (if l.runs[k].id == id then runOf(l, id).(phase := phase) else l.runs[k])
  {
    assert l.runs[k] in l.runs;
    assert runOf(l, l.runs[k].id) == l.runs[k];
  }
}

lemma start_ensures(l: Locks, environment: Environment, kind: RunKind, by_: Actor)
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> alwaysOneHolderPerEnvironment(start(l, environment, kind, by_)))
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> alwaysRunsWellFormed(start(l, environment, kind, by_)))
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> stepHealthJobNeverLocks(l, "start", start(l, environment, kind, by_)))
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> stepOutcomesFinal(l, start(l, environment, kind, by_)))
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> stepPublishesOnlyCurrentSource(l, start(l, environment, kind, by_)))
{
  if inv(l) && canStart(l, environment, kind, by_) {
    var after := start(l, environment, kind, by_);
    assert after.runs[..|l.runs|] == l.runs;
    forall r | r in after.runs
      ensures r.id > 0 && runOf(after, r.id) == r && r.source > 0 && r.source <= branchHead(after, r.environment)
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      if k < |l.runs| {
        assert l.runs[k] in l.runs;
        assert runOf(l, r.id) == r;
        assert 0 <= r.id - 1 < |l.runs|;
        assert after.runs[r.id - 1] == l.runs[r.id - 1];
      } else {
        assert k == |l.runs|;
        assert r.id == |l.runs| + 1;
      }
    }
    assert runOf(after, l.production) == runOf(l, l.production);
    assert runOf(after, l.staging) == runOf(l, l.staging);
  }
}

lemma acquire_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canAcquire(l, id) ==> alwaysOneHolderPerEnvironment(acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> alwaysRunsWellFormed(acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepHealthJobNeverLocks(l, "acquire", acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepOutcomesFinal(l, acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepPublishesOnlyCurrentSource(l, acquire(l, id)))
{
  if inv(l) && canAcquire(l, id) {
    var after := acquire(l, id);
    PhaseUpdate(l, id, RunPhase.Holding);
    forall r | r in after.runs
      ensures r.id > 0 && runOf(after, r.id) == r && r.source > 0 && r.source <= branchHead(after, r.environment)
      ensures r.phase.Holding? ==> holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    forall b | b in l.runs && (b.phase.Published? || b.phase.Superseded? || b.phase.Rejected?)
      ensures b in after.runs
    {
      var k :| 0 <= k < |l.runs| && l.runs[k] == b;
      assert after.runs[k] == b;
    }
  }
}

lemma rejectObsolete_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> alwaysOneHolderPerEnvironment(rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> alwaysRunsWellFormed(rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepHealthJobNeverLocks(l, "rejectObsolete", rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepOutcomesFinal(l, rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepPublishesOnlyCurrentSource(l, rejectObsolete(l, id)))
{
  if inv(l) && canRejectObsolete(l, id) {
    var after := rejectObsolete(l, id);
    PhaseUpdate(l, id, RunPhase.Rejected);
    forall r | r in after.runs
      ensures r.id > 0 && runOf(after, r.id) == r && r.source > 0 && r.source <= branchHead(after, r.environment)
      ensures r.phase.Holding? ==> holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    forall b | b in l.runs && (b.phase.Published? || b.phase.Superseded? || b.phase.Rejected?)
      ensures b in after.runs
    {
      var k :| 0 <= k < |l.runs| && l.runs[k] == b;
      assert after.runs[k] == b;
    }
  }
}

lemma finish_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canFinish(l, id) ==> alwaysOneHolderPerEnvironment(finish(l, id)))
  ensures (inv(l) ==> canFinish(l, id) ==> alwaysRunsWellFormed(finish(l, id)))
  ensures (inv(l) ==> canFinish(l, id) ==> stepHealthJobNeverLocks(l, "finish", finish(l, id)))
  ensures (inv(l) ==> canFinish(l, id) ==> stepOutcomesFinal(l, finish(l, id)))
  ensures (inv(l) ==> canFinish(l, id) ==> stepPublishesOnlyCurrentSource(l, finish(l, id)))
{
  if inv(l) && canFinish(l, id) {
    var after := finish(l, id);
    var r0 := runOf(l, id);
    var ph := if r0.source == branchHead(l, r0.environment) then RunPhase.Published else RunPhase.Superseded;
    PhaseUpdate(l, id, ph);
    forall r | r in after.runs
      ensures r.id > 0 && runOf(after, r.id) == r && r.source > 0 && r.source <= branchHead(after, r.environment)
      ensures r.phase.Holding? ==> holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    forall b | b in l.runs && (b.phase.Published? || b.phase.Superseded? || b.phase.Rejected?)
      ensures b in after.runs
    {
      var k :| 0 <= k < |l.runs| && l.runs[k] == b;
      assert after.runs[k] == b;
    }
  }
}
