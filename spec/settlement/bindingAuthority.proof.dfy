lemma ActorsUniqueBridge(b: Bindings)
  ensures alwaysActorsUnique(b) == !((exists a :: a in b.actors && !(((a.actor > 0) && (|ProofLib.Filter((o: ActorBinding) => (o.actor == a.actor), b.actors)| == 1)))))
{
  hide *;
  reveal alwaysActorsUnique, ProofLib.Filter;
}

lemma ActorStateBridge(b: Bindings, actor: int)
  ensures actorState(b, actor) ==
    (if ((0 <= 0) && (0 < |ProofLib.Filter((a: ActorBinding) => (a.actor == actor), b.actors)|)) then
      ProofLib.Filter((a: ActorBinding) => (a.actor == actor), b.actors)[0]
    else
      noActor.(actor := actor))
{
  hide *;
  reveal actorState, ProofLib.Filter;
}

lemma ActorsDistinctFromUnique(b: Bindings)
  requires alwaysActorsUnique(b)
  ensures forall a :: a in b.actors ==> a.actor > 0
  ensures forall i, j :: 0 <= i < |b.actors| && 0 <= j < |b.actors| && i != j ==> b.actors[i].actor != b.actors[j].actor
{
  hide *;
  ActorsUniqueBridge(b);
  forall i, j | 0 <= i < |b.actors| && 0 <= j < |b.actors| && i != j
    ensures b.actors[i].actor != b.actors[j].actor
  {
    var a := b.actors[i];
    var p := (o: ActorBinding) => (o.actor == a.actor);
    assert a in b.actors;
    assert |ProofLib.Filter(p, b.actors)| == 1;
    if b.actors[j].actor == a.actor {
      ProofLib.FilterTwo(p, b.actors, i, j);
    }
  }
}

lemma ActorsUniqueFromDistinct(b: Bindings)
  requires forall a :: a in b.actors ==> a.actor > 0
  requires forall i, j :: 0 <= i < |b.actors| && 0 <= j < |b.actors| && i != j ==> b.actors[i].actor != b.actors[j].actor
  ensures alwaysActorsUnique(b)
{
  hide *;
  ActorsUniqueBridge(b);
  forall a | a in b.actors
    ensures a.actor > 0 && |ProofLib.Filter((o: ActorBinding) => (o.actor == a.actor), b.actors)| == 1
  {
    var i :| 0 <= i < |b.actors| && b.actors[i] == a;
    var p := (o: ActorBinding) => (o.actor == a.actor);
    ProofLib.FilterOne(p, b.actors, i);
  }
}

lemma ActorStateFound(b: Bindings, i: int)
  requires alwaysActorsUnique(b)
  requires 0 <= i < |b.actors|
  ensures actorState(b, b.actors[i].actor) == b.actors[i]
{
  hide *;
  ActorsDistinctFromUnique(b);
  var actor := b.actors[i].actor;
  ActorStateBridge(b, actor);
  var p := (a: ActorBinding) => (a.actor == actor);
  ProofLib.FilterOne(p, b.actors, i);
  ProofLib.FilterMember(p, b.actors, b.actors[i]);
  assert b.actors[i] in ProofLib.Filter(p, b.actors);
  assert ProofLib.Filter(p, b.actors)[0] == b.actors[i];
}

lemma ActorStateMissing(b: Bindings, actor: int)
  requires forall a :: a in b.actors ==> a.actor != actor
  ensures actorState(b, actor) == noActor.(actor := actor)
{
  hide *;
  ActorStateBridge(b, actor);
  var p := (a: ActorBinding) => (a.actor == actor);
  ProofLib.FilterNone(p, b.actors);
}

lemma ActorStateInOrMissing(b: Bindings, actor: int)
  requires alwaysActorsUnique(b)
  ensures (exists a :: a in b.actors && a.actor == actor) ==> actorState(b, actor) in b.actors && actorState(b, actor).actor == actor
  ensures !(exists a :: a in b.actors && a.actor == actor) ==> actorState(b, actor) == noActor.(actor := actor)
  ensures forall a :: a in b.actors && a.actor == actor ==> actorState(b, actor) == a
{
  hide *;
  ActorsDistinctFromUnique(b);
  if exists a :: a in b.actors && a.actor == actor {
    var a :| a in b.actors && a.actor == actor;
    var i :| 0 <= i < |b.actors| && b.actors[i] == a;
    ActorStateFound(b, i);
    forall x | x in b.actors && x.actor == actor ensures actorState(b, actor) == x {
      var j :| 0 <= j < |b.actors| && b.actors[j] == x;
      assert i == j;
    }
  } else {
    ActorStateMissing(b, actor);
  }
}

lemma WithActorReplace(b: Bindings, after: Bindings, ab: ActorBinding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires ab == actorState(b, updated.actor)
  requires updated.actor > 0
  requires exists a :: a in b.actors && a.actor == updated.actor
  requires after.actors == withActor(updated, b).actors
  requires updated.current.version >= ab.current.version && updated.paidVersion >= ab.paidVersion
  ensures alwaysActorsUnique(after)
  ensures updated in after.actors
  ensures forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != updated.actor)
  ensures forall a :: a in b.actors && a.actor != updated.actor ==> a in after.actors
  ensures stepVersionsGrow(b, after)
{
  hide *;
  reveal withActor, stepVersionsGrow;
  ActorsDistinctFromUnique(b);
  ActorStateInOrMissing(b, updated.actor);
  var existing :| existing in b.actors && existing.actor == updated.actor;
  var idx :| 0 <= idx < |b.actors| && b.actors[idx] == existing;
  assert |after.actors| == |b.actors|;
  forall i | 0 <= i < |after.actors|
    ensures after.actors[i].actor == b.actors[i].actor
  { }
  ActorsUniqueFromDistinct(after);
  assert after.actors[idx] == updated;
  forall a | a in b.actors
    ensures actorState(after, a.actor).current.version >= a.current.version
    ensures actorState(after, a.actor).paidVersion >= a.paidVersion
  {
    var i :| 0 <= i < |b.actors| && b.actors[i] == a;
    ActorStateFound(after, i);
    if a.actor == updated.actor {
      assert a == ab;
      assert after.actors[i] == updated;
    } else {
      assert after.actors[i] == a;
    }
  }
}

lemma WithActorAppend(b: Bindings, after: Bindings, ab: ActorBinding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires ab == actorState(b, updated.actor)
  requires updated.actor > 0
  requires !(exists a :: a in b.actors && a.actor == updated.actor)
  requires after.actors == withActor(updated, b).actors
  requires updated.current.version >= ab.current.version && updated.paidVersion >= ab.paidVersion
  ensures alwaysActorsUnique(after)
  ensures updated in after.actors
  ensures forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != updated.actor)
  ensures forall a :: a in b.actors && a.actor != updated.actor ==> a in after.actors
  ensures stepVersionsGrow(b, after)
{
  hide *;
  reveal withActor, stepVersionsGrow;
  ActorsDistinctFromUnique(b);
  assert after.actors == b.actors + [updated];
  ActorsUniqueFromDistinct(after);
  assert after.actors[|b.actors|] == updated;
  forall a | a in b.actors
    ensures a in after.actors
    ensures actorState(after, a.actor).current.version >= a.current.version
    ensures actorState(after, a.actor).paidVersion >= a.paidVersion
  {
    var i :| 0 <= i < |b.actors| && b.actors[i] == a;
    assert after.actors[i] == a;
    ActorStateFound(after, i);
  }
}

lemma WithActorUpdated(b: Bindings, after: Bindings, ab: ActorBinding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires ab == actorState(b, updated.actor)
  requires updated.actor > 0
  requires after.actors == withActor(updated, b).actors
  requires updated.current.version >= ab.current.version && updated.paidVersion >= ab.paidVersion
  ensures alwaysActorsUnique(after)
  ensures updated in after.actors
  ensures forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != updated.actor)
  ensures forall a :: a in b.actors && a.actor != updated.actor ==> a in after.actors
  ensures stepVersionsGrow(b, after)
{
  hide *;
  if exists a :: a in b.actors && a.actor == updated.actor {
    WithActorReplace(b, after, ab, updated);
  } else {
    WithActorAppend(b, after, ab, updated);
  }
}

lemma SameActorsPreserves(before: Bindings, after: Bindings)
  requires alwaysActorsUnique(before)
  requires alwaysCancelBudget(before)
  requires alwaysPaidVersionKnown(before)
  requires after.actors == before.actors
  ensures alwaysActorsUnique(after)
  ensures alwaysCancelBudget(after)
  ensures alwaysPaidVersionKnown(after)
  ensures stepVersionsGrow(before, after)
{
  hide *;
  reveal alwaysCancelBudget, alwaysPaidVersionKnown, stepVersionsGrow;
  ActorsUniqueBridge(before);
  ActorsUniqueBridge(after);
  forall a | a in before.actors
    ensures actorState(after, a.actor).current.version >= a.current.version
    ensures actorState(after, a.actor).paidVersion >= a.paidVersion
  {
    var i :| 0 <= i < |after.actors| && after.actors[i] == a;
    ActorStateFound(after, i);
  }
}

lemma SameActorsHistoryPreserves(before: Bindings, after: Bindings)
  requires alwaysCurrentInHistory(before)
  requires after.actors == before.actors && after.history == before.history
  ensures alwaysCurrentInHistory(after)
  ensures stepHistoryRetained(before, after)
{
  hide *;
  reveal alwaysCurrentInHistory, stepHistoryRetained;
  forall h | h in before.history
    ensures exists n :: n in after.history && n.actor == h.actor && n.version == h.version && n.destination == h.destination && n.claimDigest == h.claimDigest && n.activatesAt == h.activatesAt
  {
    assert h in after.history;
  }
}

lemma SameTimesPreserves(before: Bindings, after: Bindings)
  requires alwaysTimesInPast(before)
  requires after.actors == before.actors && after.clock >= before.clock
  ensures alwaysTimesInPast(after)
  ensures alwaysZeroDelayLeavesNoVeto(after)
{
  hide *;
  reveal alwaysTimesInPast, alwaysZeroDelayLeavesNoVeto, cancelWindowOpen, reviewWindowOpen;
}

lemma ZeroDelayFromTimesInPast(b: Bindings)
  requires alwaysTimesInPast(b)
  ensures alwaysZeroDelayLeavesNoVeto(b)
{
  hide *;
  reveal alwaysTimesInPast, alwaysZeroDelayLeavesNoVeto, cancelWindowOpen, reviewWindowOpen;
}

lemma HistoryRetainedSame(before: Bindings, after: Bindings)
  requires after.history == before.history
  ensures stepHistoryRetained(before, after)
{
  hide *;
  reveal stepHistoryRetained;
  forall h | h in before.history
    ensures exists n :: n in after.history && n.actor == h.actor && n.version == h.version && n.destination == h.destination && n.claimDigest == h.claimDigest && n.activatesAt == h.activatesAt
  {
    assert h in after.history;
  }
}

lemma HistoryRetainedAppend(before: Bindings, after: Bindings, bound: Binding)
  requires after.history == before.history + [bound]
  ensures stepHistoryRetained(before, after)
{
  hide *;
  reveal stepHistoryRetained;
  forall h | h in before.history
    ensures exists n :: n in after.history && n.actor == h.actor && n.version == h.version && n.destination == h.destination && n.claimDigest == h.claimDigest && n.activatesAt == h.activatesAt
  {
    assert h in after.history;
  }
}

lemma HistoryRetainedByIndex(before: Bindings, after: Bindings)
  requires |after.history| == |before.history|
  requires forall i :: 0 <= i < |before.history| ==>
    after.history[i].actor == before.history[i].actor &&
    after.history[i].version == before.history[i].version &&
    after.history[i].destination == before.history[i].destination &&
    after.history[i].claimDigest == before.history[i].claimDigest &&
    after.history[i].activatesAt == before.history[i].activatesAt
  ensures stepHistoryRetained(before, after)
{
  hide *;
  reveal stepHistoryRetained;
  forall h | h in before.history
    ensures exists n :: n in after.history && n.actor == h.actor && n.version == h.version && n.destination == h.destination && n.claimDigest == h.claimDigest && n.activatesAt == h.activatesAt
  {
    var i :| 0 <= i < |before.history| && before.history[i] == h;
    assert after.history[i] in after.history;
  }
}

lemma SameCurrentHistoryPreserves(b: Bindings, after: Bindings, ab: ActorBinding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires alwaysCurrentInHistory(b)
  requires ab == actorState(b, updated.actor)
  requires updated.current == ab.current
  requires updated in after.actors
  requires forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != updated.actor)
  requires forall a :: a in b.actors && a.actor != updated.actor ==> a in after.actors
  requires after.history == b.history
  ensures alwaysCurrentInHistory(after)
{
  hide *;
  reveal alwaysCurrentInHistory, noActor, noBinding;
  ActorStateInOrMissing(b, updated.actor);
  forall a | a in after.actors && a.current.version > 0
    ensures a.current.actor == a.actor && a.current in after.history
  {
    if a == updated {
      assert ab in b.actors;
    }
  }
  forall h | h in after.history
    ensures h.actor > 0 && h.version > 0 &&
      exists a :: a in after.actors && a.actor == h.actor && h.version <= a.current.version &&
        (h.version == a.current.version ==> h == a.current)
  {
    var a :| a in b.actors && a.actor == h.actor && h.version <= a.current.version &&
      (h.version == a.current.version ==> h == a.current);
    if a.actor == updated.actor {
      assert a == ab;
      assert updated in after.actors;
    } else {
      assert a in after.actors;
    }
  }
}

lemma BindHistoryPreserves(b: Bindings, after: Bindings, ab: ActorBinding, bound: Binding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires alwaysCurrentInHistory(b)
  requires ab == actorState(b, updated.actor)
  requires bound.actor == updated.actor && bound.actor > 0
  requires bound.version == ab.current.version + 1 && ab.current.version >= 0
  requires updated.current == bound
  requires updated in after.actors
  requires forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != updated.actor)
  requires forall a :: a in b.actors && a.actor != updated.actor ==> a in after.actors
  requires after.history == b.history + [bound]
  ensures alwaysCurrentInHistory(after)
{
  hide *;
  reveal alwaysCurrentInHistory, noActor, noBinding;
  ActorStateInOrMissing(b, updated.actor);
  forall a | a in after.actors && a.current.version > 0
    ensures a.current.actor == a.actor && a.current in after.history
  {
    if a == updated {
      assert bound in after.history;
    }
  }
  forall h | h in after.history
    ensures h.actor > 0 && h.version > 0 &&
      exists a :: a in after.actors && a.actor == h.actor && h.version <= a.current.version &&
        (h.version == a.current.version ==> h == a.current)
  {
    if h == bound {
      assert updated in after.actors && updated.actor == h.actor && h.version == updated.current.version && h == updated.current;
    } else {
      assert h in b.history;
      var a :| a in b.actors && a.actor == h.actor && h.version <= a.current.version &&
        (h.version == a.current.version ==> h == a.current);
      if a.actor == updated.actor {
        assert a == ab;
        assert h.version <= ab.current.version < updated.current.version;
        assert updated in after.actors;
      } else {
        assert a in after.actors;
      }
    }
  }
}

lemma CancelHistoryPreserves(b: Bindings, after: Bindings, actor: int, expectedVersion: int, ab: ActorBinding, cancelled: Binding, updated: ActorBinding)
  requires alwaysActorsUnique(b)
  requires alwaysCurrentInHistory(b)
  requires alwaysSolanaDestinationsSafe(b)
  requires ab == actorState(b, actor) && ab in b.actors && ab.actor == actor
  requires ab.current.version > 0 && ab.current.version == expectedVersion
  requires cancelled == ab.current.(cancelled := true)
  requires updated.actor == actor && updated.current == cancelled
  requires updated in after.actors
  requires forall a :: a in after.actors ==> a == updated || (a in b.actors && a.actor != actor)
  requires forall a :: a in b.actors && a.actor != actor ==> a in after.actors
  requires after.chain == b.chain && after.project == b.project && after.vault == b.vault
  requires after.history == seq(|b.history|, i requires 0 <= i < |b.history| => if b.history[i].actor == actor && b.history[i].version == expectedVersion then cancelled else b.history[i])
  ensures alwaysCurrentInHistory(after)
  ensures alwaysSolanaDestinationsSafe(after)
  ensures stepHistoryRetained(b, after)
{
  hide *;
  reveal alwaysCurrentInHistory, alwaysSolanaDestinationsSafe;
  ActorStateInOrMissing(b, actor);
  assert ab.current.actor == actor && ab.current in b.history;
  forall i | 0 <= i < |b.history|
    ensures var h := b.history[i]; var n := after.history[i];
      n.actor == h.actor && n.version == h.version && n.destination == h.destination &&
      n.claimDigest == h.claimDigest && n.activatesAt == h.activatesAt &&
      (b.chain.SolanaChain? ==> n.destination != b.project && n.destination != b.vault)
  {
    var h := b.history[i];
    if h.actor == actor && h.version == expectedVersion {
      var a :| a in b.actors && a.actor == h.actor && h.version <= a.current.version &&
        (h.version == a.current.version ==> h == a.current);
      assert a == ab;
      assert h == ab.current;
      assert after.history[i] == cancelled;
    } else {
      assert after.history[i] == h;
    }
  }
  HistoryRetainedByIndex(b, after);
  forall a | a in after.actors && a.current.version > 0
    ensures a.current.actor == a.actor && a.current in after.history
  {
    if a == updated {
      var idx :| 0 <= idx < |b.history| && b.history[idx] == ab.current;
      assert after.history[idx] == cancelled;
    } else {
      assert a in b.actors && a.actor != actor;
      assert a.current.actor == a.actor && a.current in b.history;
      var idx :| 0 <= idx < |b.history| && b.history[idx] == a.current;
      assert after.history[idx] == a.current;
    }
  }
  forall i | 0 <= i < |after.history|
    ensures var n := after.history[i];
      n.actor > 0 && n.version > 0 &&
      exists a :: a in after.actors && a.actor == n.actor && n.version <= a.current.version &&
        (n.version == a.current.version ==> n == a.current)
  {
    var h := b.history[i];
    var n := after.history[i];
    var a :| a in b.actors && a.actor == h.actor && h.version <= a.current.version &&
      (h.version == a.current.version ==> h == a.current);
    if a.actor == actor {
      assert a == ab;
      assert updated in after.actors;
      if h.version == expectedVersion {
        assert n == cancelled == updated.current;
      } else {
        assert n == h && h.version < expectedVersion == updated.current.version;
      }
    } else {
      assert a in after.actors && n == h;
    }
  }
}

lemma deploy_ensures(b: Bindings, chain: Chain, delay: int, rotation: int)
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysActorsUnique(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysCancelBudget(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysPaidVersionKnown(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysTimesInPast(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysCurrentInHistory(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysAuthorityNotExcludedRole(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysSolanaDestinationsSafe(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysRotationShape(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> alwaysZeroDelayLeavesNoVeto(deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> stepHistoryRetained(b, deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> stepOnlyRegistrarOrAnyoneRotates(b, "deploy", deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> stepDeploymentFixed(b, deploy(b, chain, delay, rotation)))
  ensures (inv(b) ==> canDeploy(b, chain, delay, rotation) ==> stepVersionsGrow(b, deploy(b, chain, delay, rotation)))
{
  hide *;
  reveal inv, canDeploy, deploy, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed;
  if inv(b) && canDeploy(b, chain, delay, rotation) {
    var after := deploy(b, chain, delay, rotation);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}

lemma observeTime_ensures(b: Bindings, now: int)
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysActorsUnique(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysCancelBudget(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysPaidVersionKnown(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysTimesInPast(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysCurrentInHistory(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysAuthorityNotExcludedRole(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysSolanaDestinationsSafe(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysRotationShape(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> alwaysZeroDelayLeavesNoVeto(observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> stepHistoryRetained(b, observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> stepOnlyRegistrarOrAnyoneRotates(b, "observeTime", observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> stepDeploymentFixed(b, observeTime(b, now)))
  ensures (inv(b) ==> canObserveTime(b, now) ==> stepVersionsGrow(b, observeTime(b, now)))
{
  hide *;
  reveal inv, canObserveTime, observeTime, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canObserveTime(b, now) {
    var after := observeTime(b, now);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}

lemma bind_ensures(b: Bindings, request: BindRequest, by_: string)
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysActorsUnique(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysCancelBudget(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysPaidVersionKnown(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysTimesInPast(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysCurrentInHistory(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysAuthorityNotExcludedRole(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysSolanaDestinationsSafe(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysRotationShape(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> alwaysZeroDelayLeavesNoVeto(bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> stepHistoryRetained(b, bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> stepOnlyRegistrarOrAnyoneRotates(b, "bind", bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> stepDeploymentFixed(b, bind(b, request, by_)))
  ensures (inv(b) ==> canBind(b, request, by_) ==> stepVersionsGrow(b, bind(b, request, by_)))
{
  hide *;
  reveal inv, canBind, bind, withActor, noActor, noBinding, maxCancelsBetweenPayments, alwaysCancelBudget, alwaysPaidVersionKnown, alwaysTimesInPast, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canBind(b, request, by_) {
    var ab := actorState(b, request.actor);
    var bound := Binding(request.actor, request.destination, request.expectedVersion + 1, request.claimDigest, b.clock, false);
    var updated := ab.(current := bound);
    var after := bind(b, request, by_);
    ActorStateInOrMissing(b, request.actor);
    WithActorUpdated(b, after, ab, updated);
    HistoryRetainedAppend(b, after, bound);
    BindHistoryPreserves(b, after, ab, bound, updated);
    ZeroDelayFromTimesInPast(after);
  }
}

lemma recordCommit_ensures(b: Bindings, actor: int)
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysActorsUnique(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysCancelBudget(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysPaidVersionKnown(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysTimesInPast(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysCurrentInHistory(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysAuthorityNotExcludedRole(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysSolanaDestinationsSafe(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysRotationShape(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> alwaysZeroDelayLeavesNoVeto(recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> stepHistoryRetained(b, recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> stepOnlyRegistrarOrAnyoneRotates(b, "recordCommit", recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> stepDeploymentFixed(b, recordCommit(b, actor)))
  ensures (inv(b) ==> canRecordCommit(b, actor) ==> stepVersionsGrow(b, recordCommit(b, actor)))
{
  hide *;
  reveal inv, canRecordCommit, recordCommit, withActor, noActor, noBinding, maxCancelsBetweenPayments, alwaysCancelBudget, alwaysPaidVersionKnown, alwaysTimesInPast, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canRecordCommit(b, actor) {
    var ab := actorState(b, actor);
    var updated := ab.(lastCommittedAt := b.clock, commitTimes := ab.commitTimes + [b.clock]);
    var after := recordCommit(b, actor);
    ActorStateInOrMissing(b, actor);
    WithActorUpdated(b, after, ab, updated);
    HistoryRetainedSame(b, after);
    SameCurrentHistoryPreserves(b, after, ab, updated);
    ZeroDelayFromTimesInPast(after);
  }
}

lemma cancel_ensures(b: Bindings, actor: int, expectedVersion: int, named: int, by_: string)
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysActorsUnique(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysCancelBudget(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysPaidVersionKnown(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysTimesInPast(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysCurrentInHistory(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysAuthorityNotExcludedRole(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysSolanaDestinationsSafe(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysRotationShape(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> alwaysZeroDelayLeavesNoVeto(cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> stepHistoryRetained(b, cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> stepOnlyRegistrarOrAnyoneRotates(b, "cancel", cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> stepDeploymentFixed(b, cancel(b, actor, expectedVersion, named, by_)))
  ensures (inv(b) ==> canCancel(b, actor, expectedVersion, named, by_) ==> stepVersionsGrow(b, cancel(b, actor, expectedVersion, named, by_)))
{
  hide *;
  reveal inv, canCancel, cancel, withActor, noActor, noBinding, maxCancelsBetweenPayments, alwaysCancelBudget, alwaysPaidVersionKnown, alwaysTimesInPast, alwaysRotationShape, alwaysAuthorityNotExcludedRole, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canCancel(b, actor, expectedVersion, named, by_) {
    var ab := actorState(b, actor);
    var cancelled := ab.current.(cancelled := true);
    var updated := ab.(current := cancelled, cancelCount := (if rotationWaiver(b) then ab.cancelCount else ab.cancelCount + 1));
    var after := cancel(b, actor, expectedVersion, named, by_);
    ActorsDistinctFromUnique(b);
    ActorStateInOrMissing(b, actor);
    assert ab in b.actors && ab.actor == actor && ab.actor > 0;
    WithActorUpdated(b, after, ab, updated);
    CancelHistoryPreserves(b, after, actor, expectedVersion, ab, cancelled, updated);
    ZeroDelayFromTimesInPast(after);
  }
}

lemma pay_ensures(b: Bindings, actor: int, expectedVersion: int)
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysActorsUnique(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysCancelBudget(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysPaidVersionKnown(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysTimesInPast(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysCurrentInHistory(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysAuthorityNotExcludedRole(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysSolanaDestinationsSafe(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysRotationShape(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> alwaysZeroDelayLeavesNoVeto(pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> stepHistoryRetained(b, pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> stepOnlyRegistrarOrAnyoneRotates(b, "pay", pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> stepDeploymentFixed(b, pay(b, actor, expectedVersion)))
  ensures (inv(b) ==> canPay(b, actor, expectedVersion) ==> stepVersionsGrow(b, pay(b, actor, expectedVersion)))
{
  hide *;
  reveal inv, canPay, pay, payable, withActor, noActor, noBinding, maxCancelsBetweenPayments, alwaysCancelBudget, alwaysPaidVersionKnown, alwaysTimesInPast, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canPay(b, actor, expectedVersion) {
    var ab := actorState(b, actor);
    var updated := ab.(paidVersion := ab.current.version, cancelCount := 0);
    var after := pay(b, actor, expectedVersion);
    ActorsDistinctFromUnique(b);
    ActorStateInOrMissing(b, actor);
    assert ab in b.actors && ab.actor == actor && ab.actor > 0;
    WithActorUpdated(b, after, ab, updated);
    HistoryRetainedSame(b, after);
    SameCurrentHistoryPreserves(b, after, ab, updated);
    ZeroDelayFromTimesInPast(after);
  }
}

lemma proposeRotation_ensures(b: Bindings, nextAuthority: string, by_: string)
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysActorsUnique(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysCancelBudget(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysPaidVersionKnown(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysTimesInPast(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysCurrentInHistory(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysAuthorityNotExcludedRole(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysSolanaDestinationsSafe(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysRotationShape(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> alwaysZeroDelayLeavesNoVeto(proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> stepHistoryRetained(b, proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> stepOnlyRegistrarOrAnyoneRotates(b, "proposeRotation", proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> stepDeploymentFixed(b, proposeRotation(b, nextAuthority, by_)))
  ensures (inv(b) ==> canProposeRotation(b, nextAuthority, by_) ==> stepVersionsGrow(b, proposeRotation(b, nextAuthority, by_)))
{
  hide *;
  reveal inv, canProposeRotation, proposeRotation, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canProposeRotation(b, nextAuthority, by_) {
    var after := proposeRotation(b, nextAuthority, by_);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}

lemma cancelRotation_ensures(b: Bindings, by_: string)
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysActorsUnique(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysCancelBudget(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysPaidVersionKnown(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysTimesInPast(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysCurrentInHistory(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysAuthorityNotExcludedRole(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysSolanaDestinationsSafe(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysRotationShape(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> alwaysZeroDelayLeavesNoVeto(cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> stepHistoryRetained(b, cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> stepOnlyRegistrarOrAnyoneRotates(b, "cancelRotation", cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> stepDeploymentFixed(b, cancelRotation(b, by_)))
  ensures (inv(b) ==> canCancelRotation(b, by_) ==> stepVersionsGrow(b, cancelRotation(b, by_)))
{
  hide *;
  reveal inv, canCancelRotation, cancelRotation, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canCancelRotation(b, by_) {
    var after := cancelRotation(b, by_);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}

lemma confirmRotation_ensures(b: Bindings, by_: string)
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysActorsUnique(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysCancelBudget(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysPaidVersionKnown(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysTimesInPast(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysCurrentInHistory(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysAuthorityNotExcludedRole(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysSolanaDestinationsSafe(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysRotationShape(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> alwaysZeroDelayLeavesNoVeto(confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> stepHistoryRetained(b, confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> stepOnlyRegistrarOrAnyoneRotates(b, "confirmRotation", confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> stepDeploymentFixed(b, confirmRotation(b, by_)))
  ensures (inv(b) ==> canConfirmRotation(b, by_) ==> stepVersionsGrow(b, confirmRotation(b, by_)))
{
  hide *;
  reveal inv, canConfirmRotation, confirmRotation, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canConfirmRotation(b, by_) {
    var after := confirmRotation(b, by_);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}

lemma executeRotation_ensures(b: Bindings)
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysActorsUnique(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysCancelBudget(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysPaidVersionKnown(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysTimesInPast(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysCurrentInHistory(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysAuthorityNotExcludedRole(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysSolanaDestinationsSafe(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysRotationShape(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> alwaysZeroDelayLeavesNoVeto(executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> stepHistoryRetained(b, executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> stepOnlyRegistrarOrAnyoneRotates(b, "executeRotation", executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> stepDeploymentFixed(b, executeRotation(b)))
  ensures (inv(b) ==> canExecuteRotation(b) ==> stepVersionsGrow(b, executeRotation(b)))
{
  hide *;
  reveal inv, canExecuteRotation, executeRotation, alwaysRotationShape, alwaysAuthorityNotExcludedRole, alwaysSolanaDestinationsSafe, stepOnlyRegistrarOrAnyoneRotates, stepDeploymentFixed, excludedAuthority;
  if inv(b) && canExecuteRotation(b) {
    var after := executeRotation(b);
    SameActorsPreserves(b, after);
    SameActorsHistoryPreserves(b, after);
    SameTimesPreserves(b, after);
  }
}
