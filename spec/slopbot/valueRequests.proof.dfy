lemma DeliveryOfBridge(v: ValueRequests, deliveryId: int)
  ensures deliveryOf(v, deliveryId) ==
    (if 0 < |ProofLib.Filter((d: Delivery) => (d.id == deliveryId), v.deliveries)| then ProofLib.Filter((d: Delivery) => (d.id == deliveryId), v.deliveries)[0] else noDelivery)
{
}

lemma RowsMatchBridge(v: ValueRequests)
  ensures alwaysRowsMatchState(v) ==
    !((exists d :: d in v.deliveries && !((((((((((((d.id > 0) && validKey(d.key)) && (d.attempts >= 0)) && (d.incompleteSince >= 0)) && (|ProofLib.Filter((o: Delivery) => (o.id == d.id), v.deliveries)| == 1)) && (d.token <= v.lastToken)) && (!(d.state.Running?) || ((((d.token > 0) && (d.leaseUntil > 0)) && d.code.NoOutcome?) && (d.retryAt == 0)))) && (!(d.state.Completed?) || ((terminal(d.code) && (d.retryAt == 0)) && (d.leaseUntil == 0)))) && (!(d.state.Waiting?) || (((!(terminal(d.code)) && (!d.code.NoOutcome?)) && (d.leaseUntil == 0)) && (!((!d.code.Parked?)) || (d.retryAt > 0))))) && (!(d.state.Unread?) || (((d.code.NoOutcome? && (d.token == 0)) && (d.attempts == 0)) && (d.incompleteSince == 0)))) && (!(resolving(d.code)) || (d.incompleteSince == 0))))))
{
}

lemma GroupsUniqueBridge(v: ValueRequests)
  ensures alwaysOneGroupPerToken(v) ==
    !((exists g :: g in v.groups && !((((g.token > 0) && (g.token <= v.lastToken)) && (|ProofLib.Filter((o: GroupLease) => (o.token == g.token), v.groups)| == 1)))))
{
}

lemma ParkedChecksUniqueBridge(v: ValueRequests)
  ensures alwaysParkedChecksAreUnique(v) ==
    !((exists c :: c in v.parkedChecks && !((((c.checkedAt > 0) && (c.checkedAt <= v.now)) && (|ProofLib.Filter((o: ParkedCheck) => (o.target == c.target), v.parkedChecks)| == 1)))))
{
}

lemma ExclusiveGroupsBridge(v: ValueRequests)
  ensures alwaysExclusiveLiveGroups(v) ==
    !((exists a :: a in v.groups && !(!((exists b :: b in v.groups && !(((((a.token == b.token) || !(tokenLive(v, a.token))) || !(tokenLive(v, b.token))) || (|ProofLib.Filter((set_x: int) => (set_x in b.sources), a.sources)| == 0))))))))
{
}

lemma CanClaimGroupBridge(v: ValueRequests, token: int, sources: seq<int>)
  ensures canClaimGroup(v, token, sources) ==
    (((tokenLive(v, token) && (|sources| > 0)) && !((exists g :: g in v.groups && (g.token == token)))) && !((exists g :: g in v.groups && !((!(tokenLive(v, g.token)) || (|ProofLib.Filter((set_x: int) => (set_x in sources), g.sources)| == 0))))))
{
}

lemma FinishGroupsBridge(v: ValueRequests, deliveryId: int, token: int, observation: Observation)
  ensures finish(v, deliveryId, token, observation).groups == ProofLib.Filter((g: GroupLease) => (g.token != token), v.groups)
{
}

lemma CheckParkedChecksBridge(v: ValueRequests, target: ParkedTarget, registry: slopbot__repositoryScope_RegistryObservation)
  ensures checkParked(v, target, registry).parkedChecks == ProofLib.Filter((c: ParkedCheck) => (c.target != target), v.parkedChecks) + [ParkedCheck(target, v.now)]
{
}

lemma ClaimGroupGroupsBridge(v: ValueRequests, token: int, sources: seq<int>)
  ensures claimGroup(v, token, sources).groups == ProofLib.Filter((g: GroupLease) => tokenLive(v, g.token), v.groups) + [GroupLease(token, sources)]
{
}

lemma DeliveryIdsDistinct(v: ValueRequests)
  requires alwaysRowsMatchState(v)
  ensures ProofLib.DistinctBy(v.deliveries, (d: Delivery) => d.id)
{
  RowsMatchBridge(v);
  forall i, j | 0 <= i < |v.deliveries| && 0 <= j < |v.deliveries| && i != j
    ensures v.deliveries[i].id != v.deliveries[j].id
  {
    ProofLib.FilterCountOneIffUnique((o: Delivery) => (o.id == v.deliveries[i].id), v.deliveries, (d: Delivery) => d.id, i);
  }
}

lemma DeliveryOfMember(v: ValueRequests, d: Delivery)
  requires alwaysRowsMatchState(v) && d in v.deliveries
  ensures deliveryOf(v, d.id) == d
{
  DeliveryOfBridge(v, d.id);
  DeliveryIdsDistinct(v);
  var matches := ProofLib.Filter((o: Delivery) => (o.id == d.id), v.deliveries);
  ProofLib.FilterMember((o: Delivery) => (o.id == d.id), v.deliveries, d);
  ProofLib.FilterMember((o: Delivery) => (o.id == d.id), v.deliveries, matches[0]);
  var i :| 0 <= i < |v.deliveries| && v.deliveries[i] == d;
  var j :| 0 <= j < |v.deliveries| && v.deliveries[j] == matches[0];
  assert i == j;
}

lemma DeliveryOfLookup(v: ValueRequests, deliveryId: int)
  ensures deliveryOf(v, deliveryId) == noDelivery || (deliveryOf(v, deliveryId) in v.deliveries && deliveryOf(v, deliveryId).id == deliveryId)
{
  DeliveryOfBridge(v, deliveryId);
  var matches := ProofLib.Filter((d: Delivery) => (d.id == deliveryId), v.deliveries);
  if |matches| > 0 {
    ProofLib.FilterMember((d: Delivery) => (d.id == deliveryId), v.deliveries, matches[0]);
  }
}

lemma DeliveryOfAbsent(v: ValueRequests, deliveryId: int)
  requires alwaysRowsMatchState(v) && deliveryId > 0 && deliveryOf(v, deliveryId).id == 0
  ensures forall d :: d in v.deliveries ==> d.id != deliveryId
{
  forall d | d in v.deliveries
    ensures d.id != deliveryId
  {
    if d.id == deliveryId {
      DeliveryOfMember(v, d);
    }
  }
}

lemma SameDeliveriesStep(before: ValueRequests, after: ValueRequests)
  requires alwaysRowsMatchState(before) && after.deliveries == before.deliveries
  ensures stepPublishNeedsLiveGroupAndInstallation(before, after)
  ensures stepSourcesImmutable(before, after)
{
  forall d | d in before.deliveries
    ensures deliveryOf(before, d.id) == d && deliveryOf(after, d.id) == d
  {
    DeliveryOfMember(before, d);
    DeliveryOfBridge(before, d.id);
    DeliveryOfBridge(after, d.id);
  }
}

lemma DisjointSourcesSym(a: seq<int>, b: seq<int>)
  requires |ProofLib.Filter((set_x: int) => (set_x in b), a)| == 0
  ensures |ProofLib.Filter((set_x: int) => (set_x in a), b)| == 0
{
  ProofLib.FilterNone((set_x: int) => (set_x in b), a);
  ProofLib.FilterNone((set_x: int) => (set_x in a), b);
}

lemma GroupTokensDistinct(v: ValueRequests)
  requires alwaysOneGroupPerToken(v)
  ensures ProofLib.DistinctBy(v.groups, (g: GroupLease) => g.token)
{
  GroupsUniqueBridge(v);
  forall i, j | 0 <= i < |v.groups| && 0 <= j < |v.groups| && i != j
    ensures v.groups[i].token != v.groups[j].token
  {
    ProofLib.FilterCountOneIffUnique((o: GroupLease) => (o.token == v.groups[i].token), v.groups, (g: GroupLease) => g.token, i);
  }
}

lemma ParkedTargetsDistinct(v: ValueRequests)
  requires alwaysParkedChecksAreUnique(v)
  ensures ProofLib.DistinctBy(v.parkedChecks, (c: ParkedCheck) => c.target)
{
  ParkedChecksUniqueBridge(v);
  forall i, j | 0 <= i < |v.parkedChecks| && 0 <= j < |v.parkedChecks| && i != j
    ensures v.parkedChecks[i].target != v.parkedChecks[j].target
  {
    ProofLib.FilterCountOneIffUnique((o: ParkedCheck) => (o.target == v.parkedChecks[i].target), v.parkedChecks, (c: ParkedCheck) => c.target, i);
  }
}

lemma elapse_ensures(v: ValueRequests, seconds: int)
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysOneGroupPerToken(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysOneLiveClaimPerPull(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysRunWithinLimits(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysParkedChecksAreUnique(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysExclusiveLiveGroups(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> alwaysRowsMatchState(elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> stepCompletedIsFinal(v, elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> stepPublishNeedsLiveGroupAndInstallation(v, elapse(v, seconds)))
  ensures (inv(v) ==> canElapse(v, seconds) ==> stepSourcesImmutable(v, elapse(v, seconds)))
{
  if inv(v) && canElapse(v, seconds) {
    SameDeliveriesStep(v, elapse(v, seconds));
  }
}

lemma applyInstallation_ensures(v: ValueRequests, e: slopbot__installation_InstallEvent)
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysOneGroupPerToken(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysOneLiveClaimPerPull(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysRunWithinLimits(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysParkedChecksAreUnique(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysExclusiveLiveGroups(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> alwaysRowsMatchState(applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> stepCompletedIsFinal(v, applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> stepPublishNeedsLiveGroupAndInstallation(v, applyInstallation(v, e)))
  ensures (inv(v) ==> canApplyInstallation(v, e) ==> stepSourcesImmutable(v, applyInstallation(v, e)))
{
  if inv(v) && canApplyInstallation(v, e) {
    SameDeliveriesStep(v, applyInstallation(v, e));
  }
}

lemma startRun_ensures(v: ValueRequests)
  ensures (inv(v) ==> canStartRun(v) ==> alwaysOneGroupPerToken(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> alwaysOneLiveClaimPerPull(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> alwaysRunWithinLimits(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> alwaysParkedChecksAreUnique(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> alwaysExclusiveLiveGroups(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> alwaysRowsMatchState(startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> stepCompletedIsFinal(v, startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> stepPublishNeedsLiveGroupAndInstallation(v, startRun(v)))
  ensures (inv(v) ==> canStartRun(v) ==> stepSourcesImmutable(v, startRun(v)))
{
  if inv(v) && canStartRun(v) {
    SameDeliveriesStep(v, startRun(v));
  }
}

lemma record_ensures(v: ValueRequests, deliveryId: int, key: PrKey)
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysOneGroupPerToken(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysOneLiveClaimPerPull(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysRunWithinLimits(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysParkedChecksAreUnique(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysExclusiveLiveGroups(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> alwaysRowsMatchState(record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> stepCompletedIsFinal(v, record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> stepPublishNeedsLiveGroupAndInstallation(v, record(v, deliveryId, key)))
  ensures (inv(v) ==> canRecord(v, deliveryId, key) ==> stepSourcesImmutable(v, record(v, deliveryId, key)))
{
  if inv(v) && canRecord(v, deliveryId, key) {
    var after := record(v, deliveryId, key);
    var added := noDelivery.(id := deliveryId, key := key, receivedAt := v.now);
    assert after.deliveries == v.deliveries + [added];
    DeliveryOfAbsent(v, deliveryId);
    assert alwaysRowsMatchState(after) by {
      RowsMatchBridge(v);
      RowsMatchBridge(after);
      forall d | d in after.deliveries
        ensures |ProofLib.Filter((o: Delivery) => (o.id == d.id), after.deliveries)| == 1
      {
        ProofLib.FilterAppend((o: Delivery) => (o.id == d.id), v.deliveries, added);
        if d == added {
          ProofLib.FilterNone((o: Delivery) => (o.id == added.id), v.deliveries);
        }
      }
    }
    assert stepPublishNeedsLiveGroupAndInstallation(v, after) && stepSourcesImmutable(v, after) by {
      forall d | d in v.deliveries
        ensures deliveryOf(v, d.id) == d && deliveryOf(after, d.id) == d
      {
        DeliveryOfMember(v, d);
        DeliveryOfMember(after, d);
      }
    }
  }
}

lemma ClaimRowsMatch(v: ValueRequests, deliveryId: int)
  requires inv(v) && canClaim(v, deliveryId)
  ensures alwaysRowsMatchState(claim(v, deliveryId))
{
  var after := claim(v, deliveryId);
  RowsMatchBridge(v);
  RowsMatchBridge(after);
  forall i | 0 <= i < |after.deliveries|
    ensures |ProofLib.Filter((o: Delivery) => (o.id == after.deliveries[i].id), after.deliveries)| == 1
  {
    ProofLib.FilterLengthPointwise(
      (o: Delivery) => (o.id == v.deliveries[i].id),
      (o: Delivery) => (o.id == after.deliveries[i].id),
      v.deliveries,
      after.deliveries
    );
  }
}

lemma ClaimOneLivePull(v: ValueRequests, deliveryId: int)
  requires inv(v) && canClaim(v, deliveryId)
  ensures alwaysOneLiveClaimPerPull(claim(v, deliveryId))
{
  var after := claim(v, deliveryId);
  var owner := deliveryOf(v, deliveryId);
  DeliveryOfLookup(v, deliveryId);
  DeliveryIdsDistinct(v);
  var k :| 0 <= k < |v.deliveries| && v.deliveries[k] == owner;
  forall i, j | 0 <= i < |after.deliveries| && 0 <= j < |after.deliveries|
    ensures after.deliveries[i].id == after.deliveries[j].id || !samePull(after.deliveries[i].key, after.deliveries[j].key) ||
      !liveClaim(after.deliveries[i], after.now) || !liveClaim(after.deliveries[j], after.now)
  {
    if i != k {
      assert after.deliveries[i] == v.deliveries[i];
    }
    if j != k {
      assert after.deliveries[j] == v.deliveries[j];
    }
  }
}

lemma ClaimStepProps(v: ValueRequests, deliveryId: int)
  requires inv(v) && canClaim(v, deliveryId) && alwaysRowsMatchState(claim(v, deliveryId))
  ensures stepCompletedIsFinal(v, claim(v, deliveryId))
  ensures stepPublishNeedsLiveGroupAndInstallation(v, claim(v, deliveryId))
  ensures stepSourcesImmutable(v, claim(v, deliveryId))
{
  var after := claim(v, deliveryId);
  var owner := deliveryOf(v, deliveryId);
  DeliveryOfLookup(v, deliveryId);
  DeliveryIdsDistinct(v);
  var k :| 0 <= k < |v.deliveries| && v.deliveries[k] == owner;
  forall i | 0 <= i < |v.deliveries|
    ensures deliveryOf(v, v.deliveries[i].id) == v.deliveries[i] && deliveryOf(after, after.deliveries[i].id) == after.deliveries[i]
    ensures v.deliveries[i].state.Completed? ==> after.deliveries[i] == v.deliveries[i]
  {
    DeliveryOfMember(v, v.deliveries[i]);
    DeliveryOfMember(after, after.deliveries[i]);
    if v.deliveries[i].state.Completed? {
      assert i != k;
    }
  }
}

lemma claim_ensures(v: ValueRequests, deliveryId: int)
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysOneGroupPerToken(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysOneLiveClaimPerPull(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysRunWithinLimits(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysParkedChecksAreUnique(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysExclusiveLiveGroups(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> alwaysRowsMatchState(claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> stepCompletedIsFinal(v, claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> stepPublishNeedsLiveGroupAndInstallation(v, claim(v, deliveryId)))
  ensures (inv(v) ==> canClaim(v, deliveryId) ==> stepSourcesImmutable(v, claim(v, deliveryId)))
{
  if inv(v) && canClaim(v, deliveryId) {
    ClaimRowsMatch(v, deliveryId);
    ClaimOneLivePull(v, deliveryId);
    ClaimStepProps(v, deliveryId);
  }
}

lemma finish_ensures(v: ValueRequests, deliveryId: int, token: int, observation: Observation)
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysOneGroupPerToken(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysOneLiveClaimPerPull(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysRunWithinLimits(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysParkedChecksAreUnique(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysExclusiveLiveGroups(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> alwaysRowsMatchState(finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> stepCompletedIsFinal(v, finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> stepPublishNeedsLiveGroupAndInstallation(v, finish(v, deliveryId, token, observation)))
  ensures (inv(v) ==> canFinish(v, deliveryId, token, observation) ==> stepSourcesImmutable(v, finish(v, deliveryId, token, observation)))
{
  if inv(v) && canFinish(v, deliveryId, token, observation) {
    var after := finish(v, deliveryId, token, observation);
    var owner := deliveryOf(v, deliveryId);
    var code := outcomeFor(v, token, observation);
    DeliveryOfLookup(v, deliveryId);
    assert !code.NoOutcome?;
    assert alwaysRowsMatchState(after) by {
      RowsMatchBridge(v);
      RowsMatchBridge(after);
      forall i | 0 <= i < |after.deliveries|
        ensures |ProofLib.Filter((o: Delivery) => (o.id == after.deliveries[i].id), after.deliveries)| == 1
      {
        ProofLib.FilterLengthPointwise(
          (o: Delivery) => (o.id == v.deliveries[i].id),
          (o: Delivery) => (o.id == after.deliveries[i].id),
          v.deliveries,
          after.deliveries
        );
      }
    }
    assert alwaysOneGroupPerToken(after) by {
      FinishGroupsBridge(v, deliveryId, token, observation);
      GroupsUniqueBridge(v);
      GroupsUniqueBridge(after);
      GroupTokensDistinct(v);
      ProofLib.FilterKeepsDistinctBy((g: GroupLease) => (g.token != token), v.groups, (g: GroupLease) => g.token);
      forall i | 0 <= i < |after.groups|
        ensures after.groups[i] in v.groups && |ProofLib.Filter((o: GroupLease) => (o.token == after.groups[i].token), after.groups)| == 1
      {
        ProofLib.FilterMember((g: GroupLease) => (g.token != token), v.groups, after.groups[i]);
        ProofLib.FilterCountOneIffUnique((o: GroupLease) => (o.token == after.groups[i].token), after.groups, (g: GroupLease) => g.token, i);
      }
    }
    assert alwaysExclusiveLiveGroups(after) by {
      FinishGroupsBridge(v, deliveryId, token, observation);
      forall t | tokenLive(after, t)
        ensures tokenLive(v, t)
      {
        var i :| 0 <= i < |after.deliveries| && after.deliveries[i].token == t && liveClaim(after.deliveries[i], after.now);
        assert after.deliveries[i] == v.deliveries[i];
      }
      forall g | g in after.groups
        ensures g in v.groups
      {
        ProofLib.FilterMember((x: GroupLease) => (x.token != token), v.groups, g);
      }
    }
    assert stepCompletedIsFinal(v, after) by {
      DeliveryIdsDistinct(v);
      forall i | 0 <= i < |v.deliveries| && v.deliveries[i].state.Completed?
        ensures v.deliveries[i] in after.deliveries
      {
        if v.deliveries[i].id == owner.id {
          var k :| 0 <= k < |v.deliveries| && v.deliveries[k] == owner;
          assert i == k;
        }
        assert after.deliveries[i] == v.deliveries[i];
      }
    }
    assert stepPublishNeedsLiveGroupAndInstallation(v, after) && stepSourcesImmutable(v, after) by {
      forall i | 0 <= i < |v.deliveries|
        ensures deliveryOf(v, v.deliveries[i].id) == v.deliveries[i] && deliveryOf(after, after.deliveries[i].id) == after.deliveries[i]
      {
        DeliveryOfMember(v, v.deliveries[i]);
        DeliveryOfMember(after, after.deliveries[i]);
      }
    }
  }
}

lemma checkParked_ensures(v: ValueRequests, target: ParkedTarget, registry: slopbot__repositoryScope_RegistryObservation)
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysOneGroupPerToken(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysOneLiveClaimPerPull(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysRunWithinLimits(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysParkedChecksAreUnique(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysExclusiveLiveGroups(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> alwaysRowsMatchState(checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> stepCompletedIsFinal(v, checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> stepPublishNeedsLiveGroupAndInstallation(v, checkParked(v, target, registry)))
  ensures (inv(v) ==> canCheckParked(v, target, registry) ==> stepSourcesImmutable(v, checkParked(v, target, registry)))
{
  if inv(v) && canCheckParked(v, target, registry) {
    var after := checkParked(v, target, registry);
    assert alwaysParkedChecksAreUnique(after) by {
      CheckParkedChecksBridge(v, target, registry);
      ParkedChecksUniqueBridge(v);
      ParkedChecksUniqueBridge(after);
      ParkedTargetsDistinct(v);
      var kept := ProofLib.Filter((c: ParkedCheck) => (c.target != target), v.parkedChecks);
      var added := ParkedCheck(target, v.now);
      ProofLib.FilterKeepsDistinctBy((c: ParkedCheck) => (c.target != target), v.parkedChecks, (c: ParkedCheck) => c.target);
      forall i | 0 <= i < |kept|
        ensures kept[i] in v.parkedChecks && kept[i].target != target && |ProofLib.Filter((o: ParkedCheck) => (o.target == kept[i].target), kept)| == 1
      {
        ProofLib.FilterMember((c: ParkedCheck) => (c.target != target), v.parkedChecks, kept[i]);
        ProofLib.FilterCountOneIffUnique((o: ParkedCheck) => (o.target == kept[i].target), kept, (c: ParkedCheck) => c.target, i);
      }
      forall c | c in after.parkedChecks
        ensures c.checkedAt > 0 && c.checkedAt <= after.now && |ProofLib.Filter((o: ParkedCheck) => (o.target == c.target), after.parkedChecks)| == 1
      {
        ProofLib.FilterAppend((o: ParkedCheck) => (o.target == c.target), kept, added);
        if c == added {
          ProofLib.FilterNone((o: ParkedCheck) => (o.target == added.target), kept);
        }
      }
    }
    assert alwaysRowsMatchState(after) by {
      RowsMatchBridge(v);
      RowsMatchBridge(after);
      forall i | 0 <= i < |after.deliveries|
        ensures |ProofLib.Filter((o: Delivery) => (o.id == after.deliveries[i].id), after.deliveries)| == 1
      {
        ProofLib.FilterLengthPointwise(
          (o: Delivery) => (o.id == v.deliveries[i].id),
          (o: Delivery) => (o.id == after.deliveries[i].id),
          v.deliveries,
          after.deliveries
        );
      }
    }
    assert stepCompletedIsFinal(v, after) by {
      forall i | 0 <= i < |v.deliveries| && v.deliveries[i].state.Completed?
        ensures v.deliveries[i] in after.deliveries
      {
        assert after.deliveries[i] == v.deliveries[i];
      }
    }
    assert stepPublishNeedsLiveGroupAndInstallation(v, after) && stepSourcesImmutable(v, after) by {
      forall i | 0 <= i < |v.deliveries|
        ensures deliveryOf(v, v.deliveries[i].id) == v.deliveries[i] && deliveryOf(after, after.deliveries[i].id) == after.deliveries[i]
      {
        DeliveryOfMember(v, v.deliveries[i]);
        DeliveryOfMember(after, after.deliveries[i]);
      }
    }
  }
}

lemma ClaimGroupOnePerToken(v: ValueRequests, token: int, sources: seq<int>)
  requires inv(v) && canClaimGroup(v, token, sources)
  ensures alwaysOneGroupPerToken(claimGroup(v, token, sources))
{
  var after := claimGroup(v, token, sources);
  ClaimGroupGroupsBridge(v, token, sources);
  GroupsUniqueBridge(v);
  GroupsUniqueBridge(after);
  GroupTokensDistinct(v);
  var kept := ProofLib.Filter((g: GroupLease) => tokenLive(v, g.token), v.groups);
  var added := GroupLease(token, sources);
  ProofLib.FilterKeepsDistinctBy((g: GroupLease) => tokenLive(v, g.token), v.groups, (g: GroupLease) => g.token);
  forall i | 0 <= i < |kept|
    ensures kept[i] in v.groups && kept[i].token != token && |ProofLib.Filter((o: GroupLease) => (o.token == kept[i].token), kept)| == 1
  {
    ProofLib.FilterMember((g: GroupLease) => tokenLive(v, g.token), v.groups, kept[i]);
    ProofLib.FilterCountOneIffUnique((o: GroupLease) => (o.token == kept[i].token), kept, (g: GroupLease) => g.token, i);
  }
  forall g | g in after.groups
    ensures g.token > 0 && g.token <= after.lastToken && |ProofLib.Filter((o: GroupLease) => (o.token == g.token), after.groups)| == 1
  {
    ProofLib.FilterAppend((o: GroupLease) => (o.token == g.token), kept, added);
    if g == added {
      ProofLib.FilterNone((o: GroupLease) => (o.token == added.token), kept);
    }
  }
}

lemma ClaimGroupExclusive(v: ValueRequests, token: int, sources: seq<int>)
  requires inv(v) && canClaimGroup(v, token, sources)
  ensures alwaysExclusiveLiveGroups(claimGroup(v, token, sources))
{
  var after := claimGroup(v, token, sources);
  ClaimGroupGroupsBridge(v, token, sources);
  ExclusiveGroupsBridge(v);
  ExclusiveGroupsBridge(after);
  CanClaimGroupBridge(v, token, sources);
  var kept := ProofLib.Filter((g: GroupLease) => tokenLive(v, g.token), v.groups);
  var added := GroupLease(token, sources);
  forall g | g in kept
    ensures g in v.groups && tokenLive(v, g.token)
  {
    ProofLib.FilterMember((x: GroupLease) => tokenLive(v, x.token), v.groups, g);
  }
  forall a, b | a in after.groups && b in after.groups && a.token != b.token && tokenLive(after, a.token) && tokenLive(after, b.token)
    ensures |ProofLib.Filter((set_x: int) => (set_x in b.sources), a.sources)| == 0
  {
    assert tokenLive(v, a.token) && tokenLive(v, b.token);
    if a == added && b in kept {
      DisjointSourcesSym(b.sources, added.sources);
    }
  }
}

lemma claimGroup_ensures(v: ValueRequests, token: int, sources: seq<int>)
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysOneGroupPerToken(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysOneLiveClaimPerPull(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysRunWithinLimits(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysParkedChecksAreUnique(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysExclusiveLiveGroups(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> alwaysRowsMatchState(claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> stepCompletedIsFinal(v, claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> stepPublishNeedsLiveGroupAndInstallation(v, claimGroup(v, token, sources)))
  ensures (inv(v) ==> canClaimGroup(v, token, sources) ==> stepSourcesImmutable(v, claimGroup(v, token, sources)))
{
  if inv(v) && canClaimGroup(v, token, sources) {
    SameDeliveriesStep(v, claimGroup(v, token, sources));
    ClaimGroupOnePerToken(v, token, sources);
    ClaimGroupExclusive(v, token, sources);
  }
}
