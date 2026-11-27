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

lemma PhaseChangeCommon(l: Locks, after: Locks, id: int, phase: RunPhase)
  requires inv(l)
  requires id > 0 && runOf(l, id).id == id
  requires !runOf(l, id).phase.Published? && !runOf(l, id).phase.Superseded? && !runOf(l, id).phase.Rejected? && !runOf(l, id).phase.Abandoned?
  requires phase.Published? ==> runOf(l, id).source == branchHead(l, runOf(l, id).environment)
  requires after.runs == setPhase(l, id, phase)
  requires after.mainHead == l.mainHead && after.developmentHead == l.developmentHead
  requires after.mainLineage == l.mainLineage && after.developmentLineage == l.developmentLineage && after.nextHead == l.nextHead
  ensures alwaysHeadsEndLineage(after)
  ensures alwaysRunsWellFormed(after)
  ensures stepOutcomesFinal(l, after)
  ensures stepPublishesOnlyCurrentSource(l, after)
{
  PhaseUpdate(l, id, phase);
  forall r | r in after.runs
    ensures r.id > 0 && runOf(after, r.id) == r && r.source > 0 && r.source <= branchHead(after, r.environment)
  {
    var k :| 0 <= k < |after.runs| && after.runs[k] == r;
    assert l.runs[k] in l.runs;
    assert runOf(l, l.runs[k].id) == l.runs[k];
    assert 0 <= r.id - 1 < |l.runs|;
    assert after.runs[r.id - 1] == r;
  }
  forall b | b in l.runs && (b.phase.Published? || b.phase.Superseded? || b.phase.Rejected? || b.phase.Abandoned?)
    ensures b in after.runs
  {
    var k :| 0 <= k < |l.runs| && l.runs[k] == b;
    assert b.id != id;
    assert after.runs[k] == b;
  }
  forall a | a in after.runs && a.phase.Published?
    ensures (exists b :: b in l.runs && b.id == a.id && b.phase.Published?) || a.source == branchHead(after, a.environment)
  {
    var k :| 0 <= k < |after.runs| && after.runs[k] == a;
    if l.runs[k].id == id {
      assert a == runOf(l, id).(phase := phase);
    } else {
      assert l.runs[k] == a && l.runs[k] in l.runs;
    }
  }
}

lemma start_ensures(l: Locks, environment: Environment, kind: RunKind, by_: Actor)
  ensures (inv(l) ==> canStart(l, environment, kind, by_) ==> alwaysHeadsEndLineage(start(l, environment, kind, by_)))
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
      ensures r.phase.Holding? ==> holder(after, r.environment) == r.id
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
    forall a | a in after.runs && a.phase.Published?
      ensures exists b :: b in l.runs && b.id == a.id && b.phase.Published?
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == a;
      assert k < |l.runs|;
      assert l.runs[k] == a && l.runs[k] in l.runs;
    }
  }
}

lemma acquire_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canAcquire(l, id) ==> alwaysHeadsEndLineage(acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> alwaysOneHolderPerEnvironment(acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> alwaysRunsWellFormed(acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepHealthJobNeverLocks(l, "acquire", acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepOutcomesFinal(l, acquire(l, id)))
  ensures (inv(l) ==> canAcquire(l, id) ==> stepPublishesOnlyCurrentSource(l, acquire(l, id)))
{
  if inv(l) && canAcquire(l, id) {
    var after := acquire(l, id);
    PhaseChangeCommon(l, after, id, RunPhase.Holding);
    PhaseUpdate(l, id, RunPhase.Holding);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert runOf(after, after.production).phase.Holding? && runOf(after, after.production).environment.Production?;
    }
    if after.staging > 0 {
      assert runOf(after, after.staging).phase.Holding? && runOf(after, after.staging).environment.Staging?;
    }
  }
}

lemma rejectObsolete_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> alwaysHeadsEndLineage(rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> alwaysOneHolderPerEnvironment(rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> alwaysRunsWellFormed(rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepHealthJobNeverLocks(l, "rejectObsolete", rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepOutcomesFinal(l, rejectObsolete(l, id)))
  ensures (inv(l) ==> canRejectObsolete(l, id) ==> stepPublishesOnlyCurrentSource(l, rejectObsolete(l, id)))
{
  if inv(l) && canRejectObsolete(l, id) {
    var after := rejectObsolete(l, id);
    PhaseChangeCommon(l, after, id, RunPhase.Rejected);
    PhaseUpdate(l, id, RunPhase.Rejected);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert after.production != id;
      assert runOf(after, after.production) == runOf(l, l.production);
    }
    if after.staging > 0 {
      assert after.staging != id;
      assert runOf(after, after.staging) == runOf(l, l.staging);
    }
  }
}

lemma finish_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canFinish(l, id) ==> alwaysHeadsEndLineage(finish(l, id)))
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
    PhaseChangeCommon(l, after, id, ph);
    PhaseUpdate(l, id, ph);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert after.production != id;
      assert runOf(after, after.production) == runOf(l, l.production);
    }
    if after.staging > 0 {
      assert after.staging != id;
      assert runOf(after, after.staging) == runOf(l, l.staging);
    }
  }
}

lemma abandon_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canAbandon(l, id) ==> alwaysHeadsEndLineage(abandon(l, id)))
  ensures (inv(l) ==> canAbandon(l, id) ==> alwaysOneHolderPerEnvironment(abandon(l, id)))
  ensures (inv(l) ==> canAbandon(l, id) ==> alwaysRunsWellFormed(abandon(l, id)))
  ensures (inv(l) ==> canAbandon(l, id) ==> stepHealthJobNeverLocks(l, "abandon", abandon(l, id)))
  ensures (inv(l) ==> canAbandon(l, id) ==> stepOutcomesFinal(l, abandon(l, id)))
  ensures (inv(l) ==> canAbandon(l, id) ==> stepPublishesOnlyCurrentSource(l, abandon(l, id)))
{
  if inv(l) && canAbandon(l, id) {
    var after := abandon(l, id);
    PhaseChangeCommon(l, after, id, RunPhase.Abandoned);
    PhaseUpdate(l, id, RunPhase.Abandoned);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert after.production != id;
      assert runOf(after, after.production) == runOf(l, l.production);
    }
    if after.staging > 0 {
      assert after.staging != id;
      assert runOf(after, after.staging) == runOf(l, l.staging);
    }
  }
}

lemma yieldLock_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canYieldLock(l, id) ==> alwaysHeadsEndLineage(yieldLock(l, id)))
  ensures (inv(l) ==> canYieldLock(l, id) ==> alwaysOneHolderPerEnvironment(yieldLock(l, id)))
  ensures (inv(l) ==> canYieldLock(l, id) ==> alwaysRunsWellFormed(yieldLock(l, id)))
  ensures (inv(l) ==> canYieldLock(l, id) ==> stepHealthJobNeverLocks(l, "yieldLock", yieldLock(l, id)))
  ensures (inv(l) ==> canYieldLock(l, id) ==> stepOutcomesFinal(l, yieldLock(l, id)))
  ensures (inv(l) ==> canYieldLock(l, id) ==> stepPublishesOnlyCurrentSource(l, yieldLock(l, id)))
{
  if inv(l) && canYieldLock(l, id) {
    var after := yieldLock(l, id);
    PhaseChangeCommon(l, after, id, RunPhase.Waiting);
    PhaseUpdate(l, id, RunPhase.Waiting);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert after.production != id;
      assert runOf(after, after.production) == runOf(l, l.production);
    }
    if after.staging > 0 {
      assert after.staging != id;
      assert runOf(after, after.staging) == runOf(l, l.staging);
    }
  }
}

lemma refuseRewritten_ensures(l: Locks, id: int)
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> alwaysHeadsEndLineage(refuseRewritten(l, id)))
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> alwaysOneHolderPerEnvironment(refuseRewritten(l, id)))
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> alwaysRunsWellFormed(refuseRewritten(l, id)))
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> stepHealthJobNeverLocks(l, "refuseRewritten", refuseRewritten(l, id)))
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> stepOutcomesFinal(l, refuseRewritten(l, id)))
  ensures (inv(l) ==> canRefuseRewritten(l, id) ==> stepPublishesOnlyCurrentSource(l, refuseRewritten(l, id)))
{
  if inv(l) && canRefuseRewritten(l, id) {
    var after := refuseRewritten(l, id);
    PhaseChangeCommon(l, after, id, RunPhase.Rejected);
    PhaseUpdate(l, id, RunPhase.Rejected);
    forall r | r in after.runs && r.phase.Holding?
      ensures holder(after, r.environment) == r.id
    {
      var k :| 0 <= k < |after.runs| && after.runs[k] == r;
      assert l.runs[k] in l.runs;
    }
    if after.production > 0 {
      assert after.production != id;
      assert runOf(after, after.production) == runOf(l, l.production);
    }
    if after.staging > 0 {
      assert after.staging != id;
      assert runOf(after, after.staging) == runOf(l, l.staging);
    }
  }
}
