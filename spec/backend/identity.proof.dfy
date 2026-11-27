lemma FlowIdsUniqueFilter(s: Identity)
  ensures alwaysFlowIdsUnique(s) == !((exists f :: f in s.flows && !((|ProofLib.Filter((g: Flow) => (g.id == f.id), s.flows)| == 1))))
{
}

lemma FlowsDistinctBy(s: Identity)
  requires alwaysFlowIdsUnique(s)
  ensures ProofLib.DistinctBy(s.flows, (f: Flow) => f.id)
{
  FlowIdsUniqueFilter(s);
  forall i, j | 0 <= i < |s.flows| && 0 <= j < |s.flows| && i != j
    ensures s.flows[i].id != s.flows[j].id
  {
    var f := s.flows[i];
    assert f in s.flows;
    ProofLib.FilterCountOneIffUnique((g: Flow) => (g.id == f.id), s.flows, (h: Flow) => h.id, i);
  }
}

lemma DistinctFlowsHaveCountOne(flows: seq<Flow>)
  requires ProofLib.DistinctBy(flows, (f: Flow) => f.id)
  ensures forall f :: f in flows ==> |ProofLib.Filter((g: Flow) => (g.id == f.id), flows)| == 1
{
  forall f | f in flows
    ensures |ProofLib.Filter((g: Flow) => (g.id == f.id), flows)| == 1
  {
    var i :| 0 <= i < |flows| && flows[i] == f;
    ProofLib.FilterOne((g: Flow) => (g.id == f.id), flows, i);
  }
}

lemma FlowByIdBridge(s: Identity, flowId: int)
  ensures flowById(s, flowId) == (if ((0 <= 0) && (0 < |ProofLib.Filter((f: Flow) => (f.id == flowId), s.flows)|)) then ProofLib.Filter((f: Flow) => (f.id == flowId), s.flows)[0] else absentFlow)
{
}

lemma FlowByIdFound(s: Identity, flowId: int, target: Flow)
  requires alwaysFlowIdsUnique(s)
  requires target in s.flows && target.id == flowId
  ensures flowById(s, flowId) == target
{
  FlowsDistinctBy(s);
  FlowByIdBridge(s, flowId);
  var i :| 0 <= i < |s.flows| && s.flows[i] == target;
  ProofLib.FilterOne((f: Flow) => (f.id == flowId), s.flows, i);
  ProofLib.FilterMember((f: Flow) => (f.id == flowId), s.flows, target);
  var filtered := ProofLib.Filter((f: Flow) => (f.id == flowId), s.flows);
  assert |filtered| == 1 && target in filtered;
  assert filtered[0] == target;
}

lemma FlowByIdNotAbsentInFlows(s: Identity, flowId: int)
  requires flowById(s, flowId) != absentFlow
  ensures flowById(s, flowId) in s.flows && flowById(s, flowId).id == flowId
{
  FlowByIdBridge(s, flowId);
  var filtered := ProofLib.Filter((f: Flow) => (f.id == flowId), s.flows);
  assert |filtered| > 0;
  ProofLib.FilterMember((f: Flow) => (f.id == flowId), s.flows, filtered[0]);
}

lemma FlowByStateBridge(s: Identity, oauthState: int)
  ensures flowByState(s, oauthState) == (if ((0 <= 0) && (0 < |ProofLib.Filter((f: Flow) => (f.oauthState == oauthState), s.flows)|)) then ProofLib.Filter((f: Flow) => (f.oauthState == oauthState), s.flows)[0] else absentFlow)
{
}

lemma FlowByStateNotAbsentInFlows(s: Identity, oauthState: int)
  requires flowByState(s, oauthState) != absentFlow
  ensures flowByState(s, oauthState) in s.flows && flowByState(s, oauthState).oauthState == oauthState
{
  FlowByStateBridge(s, oauthState);
  var filtered := ProofLib.Filter((f: Flow) => (f.oauthState == oauthState), s.flows);
  assert |filtered| > 0;
  ProofLib.FilterMember((f: Flow) => (f.oauthState == oauthState), s.flows, filtered[0]);
}

lemma UnchangedFlowsMoveForward(before: Identity, after: Identity)
  requires alwaysFlowIdsUnique(after)
  requires after.flows == before.flows
  ensures stepFlowsMoveForward(before, after)
{
  forall f | f in before.flows
    ensures !(hasFlow(after, f.id)) || movedForward(f.status, flowById(after, f.id).status)
  {
    FlowByIdFound(after, f.id, f);
  }
}

lemma ReplaceFlowProps(s: Identity, after: Identity, target: Flow, changed: Flow)
  requires alwaysFlowIdsUnique(s)
  requires target in s.flows && changed.id == target.id
  requires after.flows == replaceFlow(s.flows, changed)
  ensures alwaysFlowIdsUnique(after)
  ensures forall f :: f in after.flows ==> (f == changed || (f in s.flows && f.id != target.id))
  ensures forall f :: f in s.flows ==> hasFlow(after, f.id) && (if f.id == target.id then f == target && flowById(after, f.id) == changed else flowById(after, f.id) == f)
{
  FlowsDistinctBy(s);
  assert |after.flows| == |s.flows|;
  assert forall i :: 0 <= i < |s.flows| ==> after.flows[i].id == s.flows[i].id;
  assert ProofLib.DistinctBy(after.flows, (f: Flow) => f.id);
  DistinctFlowsHaveCountOne(after.flows);
  FlowIdsUniqueFilter(after);
  var ti :| 0 <= ti < |s.flows| && s.flows[ti] == target;
  forall f | f in after.flows
    ensures f == changed || (f in s.flows && f.id != target.id)
  {
    var i :| 0 <= i < |after.flows| && after.flows[i] == f;
    if s.flows[i].id == target.id {
      assert i == ti;
      assert f == changed;
    } else {
      assert f == s.flows[i];
    }
  }
  forall f | f in s.flows
    ensures hasFlow(after, f.id)
    ensures if f.id == target.id then f == target && flowById(after, f.id) == changed else flowById(after, f.id) == f
  {
    var i :| 0 <= i < |s.flows| && s.flows[i] == f;
    assert after.flows[i] in after.flows && after.flows[i].id == f.id;
    FlowByIdFound(after, f.id, after.flows[i]);
    if f.id == target.id {
      assert i == ti;
      assert f == target;
      assert after.flows[i] == changed;
    } else {
      assert after.flows[i] == f;
    }
  }
}

lemma RateWindowsFilter(s: Identity)
  ensures alwaysRateWindowsCounted(s) == !((exists w :: w in s.windows && !((((w.count >= 1) && (w.client > 0)) && (|ProofLib.Filter((o: RateWindow) => ((o.client == w.client) && (o.scope == w.scope)), s.windows)| == 1)))))
{
}

lemma WindowsDistinctBy(s: Identity)
  requires alwaysRateWindowsCounted(s)
  ensures ProofLib.DistinctBy(s.windows, (w: RateWindow) => (w.client, w.scope))
{
  RateWindowsFilter(s);
  forall i, j | 0 <= i < |s.windows| && 0 <= j < |s.windows| && i != j
    ensures (s.windows[i].client, s.windows[i].scope) != (s.windows[j].client, s.windows[j].scope)
  {
    var w := s.windows[i];
    assert w in s.windows;
    ProofLib.FilterCountOneIffUnique((o: RateWindow) => ((o.client == w.client) && (o.scope == w.scope)), s.windows, (x: RateWindow) => (x.client, x.scope), i);
  }
}

lemma DistinctWindowsHaveCountOne(windows: seq<RateWindow>)
  requires ProofLib.DistinctBy(windows, (w: RateWindow) => (w.client, w.scope))
  ensures forall w :: w in windows ==> |ProofLib.Filter((o: RateWindow) => ((o.client == w.client) && (o.scope == w.scope)), windows)| == 1
{
  forall w | w in windows
    ensures |ProofLib.Filter((o: RateWindow) => ((o.client == w.client) && (o.scope == w.scope)), windows)| == 1
  {
    var i :| 0 <= i < |windows| && windows[i] == w;
    ProofLib.FilterOne((o: RateWindow) => ((o.client == w.client) && (o.scope == w.scope)), windows, i);
  }
}

lemma WindowOfBridge(s: Identity, client: int, scope: RateScope)
  ensures windowOf(s, client, scope) == (if ((0 <= 0) && (0 < |ProofLib.Filter((w: RateWindow) => ((w.client == client) && (w.scope == scope)), s.windows)|)) then ProofLib.Filter((w: RateWindow) => ((w.client == client) && (w.scope == scope)), s.windows)[0] else RateWindow(client, scope, 0, 0))
{
}

lemma WindowOfProps(s: Identity, client: int, scope: RateScope)
  requires alwaysRateWindowsCounted(s) && client > 0
  ensures windowOf(s, client, scope).client == client
  ensures windowOf(s, client, scope).scope == scope
  ensures windowOf(s, client, scope).count >= 0
{
  WindowOfBridge(s, client, scope);
  var filtered := ProofLib.Filter((w: RateWindow) => ((w.client == client) && (w.scope == scope)), s.windows);
  if |filtered| > 0 {
    ProofLib.FilterMember((w: RateWindow) => ((w.client == client) && (w.scope == scope)), s.windows, filtered[0]);
  }
}

lemma CountRequestBridge(s: Identity, client: int, scope: RateScope)
  ensures countRequest(s, client, scope) == ProofLib.Filter((w: RateWindow) => !(((w.client == client) && (w.scope == scope))), s.windows) + [nextWindow(windowOf(s, client, scope), s.now)]
{
}

lemma CountRequestPreservesWindows(s: Identity, after: Identity, client: int, scope: RateScope)
  requires alwaysRateWindowsCounted(s) && client > 0
  requires after.windows == countRequest(s, client, scope)
  ensures alwaysRateWindowsCounted(after)
{
  CountRequestBridge(s, client, scope);
  WindowsDistinctBy(s);
  WindowOfProps(s, client, scope);
  var kept := ProofLib.Filter((w: RateWindow) => !(((w.client == client) && (w.scope == scope))), s.windows);
  var added := nextWindow(windowOf(s, client, scope), s.now);
  assert added.client == client && added.scope == scope && added.count >= 1;
  ProofLib.FilterKeepsDistinctBy((w: RateWindow) => !(((w.client == client) && (w.scope == scope))), s.windows, (w: RateWindow) => (w.client, w.scope));
  forall w | w in kept
    ensures w in s.windows && !((w.client == client) && (w.scope == scope))
  {
    ProofLib.FilterMember((w: RateWindow) => !(((w.client == client) && (w.scope == scope))), s.windows, w);
  }
  ProofLib.DistinctByConcat(kept, [added], (w: RateWindow) => (w.client, w.scope));
  DistinctWindowsHaveCountOne(after.windows);
  RateWindowsFilter(after);
}

lemma IssuedOnceFilter(s: Identity)
  ensures alwaysIssuedOnce(s) == (!((exists id :: id in s.issued && !(((((id > 0) && (id <= s.lastFlow)) && (|ProofLib.Filter((x: int) => (x == id), s.issued)| == 1)) && !((id in s.localDelivered)))))) && !((exists id :: id in s.localDelivered && !((((id > 0) && (id <= s.lastFlow)) && (|ProofLib.Filter((x: int) => (x == id), s.localDelivered)| == 1))))))
{
}

lemma ConsumedOnceFilter(s: Identity)
  ensures alwaysConsumedOnce(s) == (!((exists t :: t in s.consumedTokens && !(((|ProofLib.Filter((x: int) => (x == t), s.consumedTokens)| == 1) && (t in s.issued))))) && !((exists a :: a in s.assertions && !((a.consumed == (a.token in s.consumedTokens))))))
{
}

lemma IntSeqDistinct(xs: seq<int>)
  requires forall id :: id in xs ==> |ProofLib.Filter((x: int) => (x == id), xs)| == 1
  ensures ProofLib.Distinct(xs)
{
  forall i, j | 0 <= i < j < |xs|
    ensures xs[i] != xs[j]
  {
    var id := xs[i];
    assert id in xs;
    ProofLib.FilterCountOneIffUnique((x: int) => (x == id), xs, (y: int) => y, i);
  }
}

lemma DistinctIntSeqCountOne(xs: seq<int>)
  requires ProofLib.Distinct(xs)
  ensures forall id :: id in xs ==> |ProofLib.Filter((x: int) => (x == id), xs)| == 1
{
  forall id | id in xs
    ensures |ProofLib.Filter((x: int) => (x == id), xs)| == 1
  {
    ProofLib.FilterDistinctCountOne((x: int) => (x == id), xs, id);
  }
}

lemma OneAssertionFilter(s: Identity)
  ensures alwaysOneAssertionPerFlow(s) == !((exists a :: a in s.assertions && !((((((((a.token > 0) && (a.token <= s.lastFlow)) && (|ProofLib.Filter((b: Assertion) => (b.token == a.token), s.assertions)| == 1)) && (a.expiresAt == (a.createdAt + assertionLifetime))) && (a.createdAt <= s.now)) && (a.github.actor > 0)) && (!(a.audience.PointsWeb?) || (a.github.nodeId > 0))))))
{
}

lemma AssertionsDistinctBy(s: Identity)
  requires alwaysOneAssertionPerFlow(s)
  ensures ProofLib.DistinctBy(s.assertions, (a: Assertion) => a.token)
{
  OneAssertionFilter(s);
  forall i, j | 0 <= i < |s.assertions| && 0 <= j < |s.assertions| && i != j
    ensures s.assertions[i].token != s.assertions[j].token
  {
    var a := s.assertions[i];
    assert a in s.assertions;
    ProofLib.FilterCountOneIffUnique((b: Assertion) => (b.token == a.token), s.assertions, (c: Assertion) => c.token, i);
  }
}

lemma DistinctAssertionsHaveCountOne(xs: seq<Assertion>)
  requires ProofLib.DistinctBy(xs, (a: Assertion) => a.token)
  ensures forall a :: a in xs ==> |ProofLib.Filter((b: Assertion) => (b.token == a.token), xs)| == 1
{
  forall a | a in xs
    ensures |ProofLib.Filter((b: Assertion) => (b.token == a.token), xs)| == 1
  {
    var i :| 0 <= i < |xs| && xs[i] == a;
    ProofLib.FilterOne((b: Assertion) => (b.token == a.token), xs, i);
  }
}

lemma AssertionForBridge(s: Identity, token: int)
  ensures assertionFor(s, token) == (if ((0 <= 0) && (0 < |ProofLib.Filter((a: Assertion) => (a.token == token), s.assertions)|)) then ProofLib.Filter((a: Assertion) => (a.token == token), s.assertions)[0] else absentAssertion)
{
}

lemma AssertionForFound(s: Identity, token: int, target: Assertion)
  requires alwaysOneAssertionPerFlow(s)
  requires target in s.assertions && target.token == token
  ensures assertionFor(s, token) == target
{
  AssertionsDistinctBy(s);
  AssertionForBridge(s, token);
  var i :| 0 <= i < |s.assertions| && s.assertions[i] == target;
  ProofLib.FilterOne((a: Assertion) => (a.token == token), s.assertions, i);
  ProofLib.FilterMember((a: Assertion) => (a.token == token), s.assertions, target);
  var filtered := ProofLib.Filter((a: Assertion) => (a.token == token), s.assertions);
  assert |filtered| == 1 && target in filtered;
  assert filtered[0] == target;
}

lemma PurgeFlowsFilter(s: Identity, by_: int)
  ensures purgeExpired(s, by_).flows == ProofLib.Filter((f: Flow) => (f.expiresAt > s.now), s.flows)
{
}

lemma PurgeAssertionsFilter(s: Identity, by_: int)
  ensures purgeExpired(s, by_).assertions == ProofLib.Filter((a: Assertion) => (a.expiresAt > s.now), s.assertions)
{
}

lemma PurgeWindowsFilter(s: Identity, by_: int)
  ensures purgeExpired(s, by_).windows == ProofLib.Filter((w: RateWindow) => (w.expiresAt > s.now), s.windows)
{
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  assert ProofLib.DistinctBy(initial.windows, (w: RateWindow) => (w.client, w.scope));
  DistinctWindowsHaveCountOne(initial.windows);
  RateWindowsFilter(initial);
}

lemma start_ensures(s: Identity, client: int, audience: Audience, mode: FlowMode, origin: bool)
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysFlowsWellFormed(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysFlowIdsUnique(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysRateWindowsCounted(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysBoundOnlyForWebsite(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysVerifierOnlyWhilePending(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysIdentityAfterCallback(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysIssuedOnce(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysIssuedFlowsClosed(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysOneAssertionPerFlow(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysLocalFlowsHaveNoAssertion(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysAssertionsMatchTheirFlow(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysConsumedOnce(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> alwaysConsumedBeforeExpiry(start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> stepDeliveryHistoryRetained(s, start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> stepFlowsMoveForward(s, start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> stepPurgeKeepsLiveFlows(s, start(s, client, audience, mode, origin)))
  ensures (inv(s) ==> canStart(s, client, audience, mode, origin) ==> stepNoAssertionWithoutCompleteParent(s, start(s, client, audience, mode, origin)))
{
  if inv(s) && canStart(s, client, audience, mode, origin) {
    var after := start(s, client, audience, mode, origin);
    var id := s.lastFlow + 1;
    var added := Flow(id, id, id, audience, mode, FlowStatus.Pending, true, noGitHub, s.now, s.now + flowLifetime, websiteFlow(audience, mode));
    CountRequestPreservesWindows(s, after, client, RateScope.StartScope);
    FlowsDistinctBy(s);
    ProofLib.DistinctByConcat(s.flows, [added], (f: Flow) => f.id);
    DistinctFlowsHaveCountOne(after.flows);
    FlowIdsUniqueFilter(after);
    IssuedOnceFilter(s);
    IssuedOnceFilter(after);
    OneAssertionFilter(s);
    OneAssertionFilter(after);
    assert !(id in s.issued) && !(id in s.localDelivered) && !hasAssertion(s, id);
    forall f | f in s.flows
      ensures !(hasFlow(after, f.id)) || movedForward(f.status, flowById(after, f.id).status)
    {
      FlowByIdFound(after, f.id, f);
    }
  }
}

lemma startStorageFailed_ensures(s: Identity, client: int)
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysFlowsWellFormed(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysFlowIdsUnique(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysRateWindowsCounted(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysBoundOnlyForWebsite(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysVerifierOnlyWhilePending(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysIdentityAfterCallback(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysIssuedOnce(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysIssuedFlowsClosed(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysOneAssertionPerFlow(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysLocalFlowsHaveNoAssertion(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysAssertionsMatchTheirFlow(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysConsumedOnce(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> alwaysConsumedBeforeExpiry(startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> stepDeliveryHistoryRetained(s, startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> stepFlowsMoveForward(s, startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> stepPurgeKeepsLiveFlows(s, startStorageFailed(s, client)))
  ensures (inv(s) ==> canStartStorageFailed(s, client) ==> stepNoAssertionWithoutCompleteParent(s, startStorageFailed(s, client)))
{
  if inv(s) && canStartStorageFailed(s, client) {
    var after := startStorageFailed(s, client);
    CountRequestPreservesWindows(s, after, client, RateScope.StartScope);
    UnchangedFlowsMoveForward(s, after);
  }
}

lemma refuseRateLimited_ensures(s: Identity, client: int, scope: RateScope)
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysFlowsWellFormed(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysFlowIdsUnique(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysRateWindowsCounted(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysBoundOnlyForWebsite(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysVerifierOnlyWhilePending(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysIdentityAfterCallback(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysIssuedOnce(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysIssuedFlowsClosed(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysOneAssertionPerFlow(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysLocalFlowsHaveNoAssertion(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysAssertionsMatchTheirFlow(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysConsumedOnce(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> alwaysConsumedBeforeExpiry(refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> stepDeliveryHistoryRetained(s, refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> stepFlowsMoveForward(s, refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> stepPurgeKeepsLiveFlows(s, refuseRateLimited(s, client, scope)))
  ensures (inv(s) ==> canRefuseRateLimited(s, client, scope) ==> stepNoAssertionWithoutCompleteParent(s, refuseRateLimited(s, client, scope)))
{
  if inv(s) && canRefuseRateLimited(s, client, scope) {
    var after := refuseRateLimited(s, client, scope);
    CountRequestPreservesWindows(s, after, client, scope);
    UnchangedFlowsMoveForward(s, after);
  }
}

lemma refuseOriginRequired_ensures(s: Identity, client: int)
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysFlowsWellFormed(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysFlowIdsUnique(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysRateWindowsCounted(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysBoundOnlyForWebsite(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysVerifierOnlyWhilePending(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysIdentityAfterCallback(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysIssuedOnce(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysIssuedFlowsClosed(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysOneAssertionPerFlow(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysLocalFlowsHaveNoAssertion(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysAssertionsMatchTheirFlow(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysConsumedOnce(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> alwaysConsumedBeforeExpiry(refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> stepDeliveryHistoryRetained(s, refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> stepFlowsMoveForward(s, refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> stepPurgeKeepsLiveFlows(s, refuseOriginRequired(s, client)))
  ensures (inv(s) ==> canRefuseOriginRequired(s, client) ==> stepNoAssertionWithoutCompleteParent(s, refuseOriginRequired(s, client)))
{
  if inv(s) && canRefuseOriginRequired(s, client) {
    var after := refuseOriginRequired(s, client);
    CountRequestPreservesWindows(s, after, client, RateScope.StartScope);
    UnchangedFlowsMoveForward(s, after);
  }
}

lemma failCallback_ensures(s: Identity, by_: int, flowId: int)
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysFlowsWellFormed(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysFlowIdsUnique(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysRateWindowsCounted(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysBoundOnlyForWebsite(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysVerifierOnlyWhilePending(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysIdentityAfterCallback(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysIssuedOnce(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysIssuedFlowsClosed(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysOneAssertionPerFlow(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysLocalFlowsHaveNoAssertion(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysAssertionsMatchTheirFlow(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysConsumedOnce(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> alwaysConsumedBeforeExpiry(failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> stepDeliveryHistoryRetained(s, failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> stepFlowsMoveForward(s, failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> stepPurgeKeepsLiveFlows(s, failCallback(s, by_, flowId)))
  ensures (inv(s) ==> canFailCallback(s, by_, flowId) ==> stepNoAssertionWithoutCompleteParent(s, failCallback(s, by_, flowId)))
{
  if inv(s) && canFailCallback(s, by_, flowId) {
    var after := failCallback(s, by_, flowId);
    var target := flowById(s, flowId);
    FlowByIdNotAbsentInFlows(s, flowId);
    var changed := target.(status := FlowStatus.CallbackFailed);
    ReplaceFlowProps(s, after, target, changed);
  }
}

lemma completeCallback_ensures(s: Identity, by_: int, flowId: int, github: GitHubIdentity)
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysFlowsWellFormed(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysFlowIdsUnique(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysRateWindowsCounted(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysBoundOnlyForWebsite(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysVerifierOnlyWhilePending(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysIdentityAfterCallback(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysIssuedOnce(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysIssuedFlowsClosed(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysOneAssertionPerFlow(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysLocalFlowsHaveNoAssertion(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysAssertionsMatchTheirFlow(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysConsumedOnce(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> alwaysConsumedBeforeExpiry(completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> stepDeliveryHistoryRetained(s, completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> stepFlowsMoveForward(s, completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> stepPurgeKeepsLiveFlows(s, completeCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canCompleteCallback(s, by_, flowId, github) ==> stepNoAssertionWithoutCompleteParent(s, completeCallback(s, by_, flowId, github)))
{
  if inv(s) && canCompleteCallback(s, by_, flowId, github) {
    var after := completeCallback(s, by_, flowId, github);
    var target := flowById(s, flowId);
    FlowByIdNotAbsentInFlows(s, flowId);
    var changed := target.(status := FlowStatus.CallbackComplete, github := github);
    ReplaceFlowProps(s, after, target, changed);
  }
}

lemma claimCallback_ensures(s: Identity, oauthState: int, cookie: int)
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysFlowsWellFormed(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysFlowIdsUnique(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysRateWindowsCounted(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysBoundOnlyForWebsite(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysVerifierOnlyWhilePending(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysIdentityAfterCallback(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysIssuedOnce(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysIssuedFlowsClosed(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysOneAssertionPerFlow(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysLocalFlowsHaveNoAssertion(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysAssertionsMatchTheirFlow(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysConsumedOnce(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> alwaysConsumedBeforeExpiry(claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> stepDeliveryHistoryRetained(s, claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> stepFlowsMoveForward(s, claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> stepPurgeKeepsLiveFlows(s, claimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canClaimCallback(s, oauthState, cookie) ==> stepNoAssertionWithoutCompleteParent(s, claimCallback(s, oauthState, cookie)))
{
  if inv(s) && canClaimCallback(s, oauthState, cookie) {
    var after := claimCallback(s, oauthState, cookie);
    var target := flowByState(s, oauthState);
    FlowByStateNotAbsentInFlows(s, oauthState);
    var changed := target.(status := FlowStatus.CallbackProcessing, pkceStored := false);
    ReplaceFlowProps(s, after, target, changed);
  }
}

lemma issueAssertion_ensures(s: Identity, flowId: int, capability: int, audience: Audience, binding: bool)
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysFlowsWellFormed(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysFlowIdsUnique(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysRateWindowsCounted(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysBoundOnlyForWebsite(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysVerifierOnlyWhilePending(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysIdentityAfterCallback(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysIssuedOnce(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysIssuedFlowsClosed(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysOneAssertionPerFlow(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysLocalFlowsHaveNoAssertion(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysAssertionsMatchTheirFlow(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysConsumedOnce(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> alwaysConsumedBeforeExpiry(issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> stepDeliveryHistoryRetained(s, issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> stepFlowsMoveForward(s, issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> stepPurgeKeepsLiveFlows(s, issueAssertion(s, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canIssueAssertion(s, flowId, capability, audience, binding) ==> stepNoAssertionWithoutCompleteParent(s, issueAssertion(s, flowId, capability, audience, binding)))
{
  if inv(s) && canIssueAssertion(s, flowId, capability, audience, binding) {
    var after := issueAssertion(s, flowId, capability, audience, binding);
    var target := flowById(s, flowId);
    FlowByIdNotAbsentInFlows(s, flowId);
    assert target.status.CallbackComplete? && !target.mode.LocalHandoff?;
    assert !(flowId in s.issued) && !(flowId in s.localDelivered);
    var changed := target.(status := FlowStatus.AssertionIssued);
    ReplaceFlowProps(s, after, target, changed);
    IssuedOnceFilter(s);
    IntSeqDistinct(s.issued);
    assert ProofLib.Distinct(after.issued);
    DistinctIntSeqCountOne(after.issued);
    IssuedOnceFilter(after);
    ConsumedOnceFilter(s);
    ConsumedOnceFilter(after);
  }
}

lemma pollAnswered_ensures(s: Identity, client: int, flowId: int, capability: int, audience: Audience, localRoute: bool, binding: bool)
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysFlowsWellFormed(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysFlowIdsUnique(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysRateWindowsCounted(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysBoundOnlyForWebsite(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysVerifierOnlyWhilePending(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysIdentityAfterCallback(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysIssuedOnce(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysIssuedFlowsClosed(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysOneAssertionPerFlow(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysLocalFlowsHaveNoAssertion(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysAssertionsMatchTheirFlow(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysConsumedOnce(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> alwaysConsumedBeforeExpiry(pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> stepDeliveryHistoryRetained(s, pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> stepFlowsMoveForward(s, pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> stepPurgeKeepsLiveFlows(s, pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
  ensures (inv(s) ==> canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) ==> stepNoAssertionWithoutCompleteParent(s, pollAnswered(s, client, flowId, capability, audience, localRoute, binding)))
{
  if inv(s) && canPollAnswered(s, client, flowId, capability, audience, localRoute, binding) {
    var after := pollAnswered(s, client, flowId, capability, audience, localRoute, binding);
    CountRequestPreservesWindows(s, after, client, RateScope.PollScope);
    UnchangedFlowsMoveForward(s, after);
  }
}

lemma storeAssertion_ensures(s: Identity, client: int, flowId: int, capability: int, audience: Audience, binding: bool)
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysFlowsWellFormed(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysFlowIdsUnique(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysRateWindowsCounted(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysBoundOnlyForWebsite(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysVerifierOnlyWhilePending(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysIdentityAfterCallback(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysIssuedOnce(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysIssuedFlowsClosed(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysOneAssertionPerFlow(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysLocalFlowsHaveNoAssertion(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysAssertionsMatchTheirFlow(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysConsumedOnce(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> alwaysConsumedBeforeExpiry(storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> stepDeliveryHistoryRetained(s, storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> stepFlowsMoveForward(s, storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> stepPurgeKeepsLiveFlows(s, storeAssertion(s, client, flowId, capability, audience, binding)))
  ensures (inv(s) ==> canStoreAssertion(s, client, flowId, capability, audience, binding) ==> stepNoAssertionWithoutCompleteParent(s, storeAssertion(s, client, flowId, capability, audience, binding)))
{
  if inv(s) && canStoreAssertion(s, client, flowId, capability, audience, binding) {
    var after := storeAssertion(s, client, flowId, capability, audience, binding);
    CountRequestPreservesWindows(s, after, client, RateScope.PollScope);
    UnchangedFlowsMoveForward(s, after);
    if !hasAssertion(s, flowId) {
      var target := flowById(s, flowId);
      FlowByIdNotAbsentInFlows(s, flowId);
      FlowsDistinctBy(s);
      assert target.status.CallbackComplete? && !target.mode.LocalHandoff?;
      var added := Assertion(flowId, target.audience, target.github, s.now, s.now + assertionLifetime, false, 0);
      AssertionsDistinctBy(s);
      ProofLib.DistinctByConcat(s.assertions, [added], (a: Assertion) => a.token);
      DistinctAssertionsHaveCountOne(after.assertions);
      OneAssertionFilter(after);
      assert !(flowId in s.issued);
      assert !(flowId in s.consumedTokens);
      ConsumedOnceFilter(s);
      ConsumedOnceFilter(after);
      forall f | f in after.flows
        ensures !(f.mode.LocalHandoff?) || (!(hasAssertion(after, f.id)) && !((f.id in after.issued)))
        ensures !(hasAssertion(after, f.id)) || (((assertionFor(after, f.id).github == f.github) && (assertionFor(after, f.id).audience == f.audience)) && (f.status.CallbackComplete? || f.status.AssertionIssued?))
      {
        if f.id == flowId {
          var fi :| 0 <= fi < |s.flows| && s.flows[fi] == f;
          var ti :| 0 <= ti < |s.flows| && s.flows[ti] == target;
          assert fi == ti;
          assert f == target;
          AssertionForFound(after, f.id, added);
        } else if hasAssertion(after, f.id) {
          var a :| a in after.assertions && a.token == f.id;
          assert a in s.assertions;
          assert hasAssertion(s, f.id);
          AssertionForFound(s, f.id, a);
          AssertionForFound(after, f.id, a);
        }
      }
    }
  }
}

lemma pollLocal_ensures(s: Identity, client: int, flowId: int, capability: int)
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysFlowsWellFormed(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysFlowIdsUnique(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysRateWindowsCounted(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysBoundOnlyForWebsite(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysVerifierOnlyWhilePending(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysIdentityAfterCallback(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysIssuedOnce(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysIssuedFlowsClosed(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysOneAssertionPerFlow(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysLocalFlowsHaveNoAssertion(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysAssertionsMatchTheirFlow(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysConsumedOnce(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> alwaysConsumedBeforeExpiry(pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> stepDeliveryHistoryRetained(s, pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> stepFlowsMoveForward(s, pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> stepPurgeKeepsLiveFlows(s, pollLocal(s, client, flowId, capability)))
  ensures (inv(s) ==> canPollLocal(s, client, flowId, capability) ==> stepNoAssertionWithoutCompleteParent(s, pollLocal(s, client, flowId, capability)))
{
  if inv(s) && canPollLocal(s, client, flowId, capability) {
    var after := pollLocal(s, client, flowId, capability);
    CountRequestPreservesWindows(s, after, client, RateScope.PollScope);
    var target := flowById(s, flowId);
    FlowByIdNotAbsentInFlows(s, flowId);
    assert target.status.CallbackComplete? && target.mode.LocalHandoff?;
    assert !(flowId in s.issued) && !(flowId in s.localDelivered);
    var changed := target.(status := FlowStatus.AssertionIssued);
    ReplaceFlowProps(s, after, target, changed);
    IssuedOnceFilter(s);
    IntSeqDistinct(s.localDelivered);
    assert ProofLib.Distinct(after.localDelivered);
    DistinctIntSeqCountOne(after.localDelivered);
    IssuedOnceFilter(after);
  }
}

lemma consume_ensures(s: Identity, token: int, audience: Audience)
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysFlowsWellFormed(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysFlowIdsUnique(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysRateWindowsCounted(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysBoundOnlyForWebsite(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysVerifierOnlyWhilePending(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysIdentityAfterCallback(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysIssuedOnce(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysIssuedFlowsClosed(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysOneAssertionPerFlow(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysLocalFlowsHaveNoAssertion(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysAssertionsMatchTheirFlow(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysConsumedOnce(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> alwaysConsumedBeforeExpiry(consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> stepDeliveryHistoryRetained(s, consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> stepFlowsMoveForward(s, consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> stepPurgeKeepsLiveFlows(s, consume(s, token, audience)))
  ensures (inv(s) ==> canConsume(s, token, audience) ==> stepNoAssertionWithoutCompleteParent(s, consume(s, token, audience)))
{
  if inv(s) && canConsume(s, token, audience) {
    var after := consume(s, token, audience);
    UnchangedFlowsMoveForward(s, after);
    AssertionsDistinctBy(s);
    assert |after.assertions| == |s.assertions|;
    assert forall i :: 0 <= i < |s.assertions| ==> after.assertions[i].token == s.assertions[i].token;
    assert ProofLib.DistinctBy(after.assertions, (a: Assertion) => a.token);
    DistinctAssertionsHaveCountOne(after.assertions);
    OneAssertionFilter(after);
    var target :| target in s.assertions && target.token == token;
    AssertionForFound(s, token, target);
    assert !target.consumed && s.now < target.expiresAt;
    assert !(token in s.consumedTokens);
    ConsumedOnceFilter(s);
    IntSeqDistinct(s.consumedTokens);
    assert ProofLib.Distinct(after.consumedTokens);
    DistinctIntSeqCountOne(after.consumedTokens);
    ConsumedOnceFilter(after);
    forall i | 0 <= i < |after.assertions|
      ensures after.assertions[i].consumed == (after.assertions[i].token in after.consumedTokens)
      ensures !(after.assertions[i].consumed) || ((after.assertions[i].consumedAt >= after.assertions[i].createdAt) && (after.assertions[i].consumedAt < after.assertions[i].expiresAt))
    {
      if s.assertions[i].token == token {
        var ti :| 0 <= ti < |s.assertions| && s.assertions[ti] == target;
        assert i == ti;
        assert s.assertions[i] == target;
      }
    }
    forall f | f in after.flows
      ensures !(hasAssertion(after, f.id)) || (((assertionFor(after, f.id).github == f.github) && (assertionFor(after, f.id).audience == f.audience)) && (f.status.CallbackComplete? || f.status.AssertionIssued?))
    {
      if hasAssertion(after, f.id) {
        var i :| 0 <= i < |after.assertions| && after.assertions[i].token == f.id;
        assert s.assertions[i] in s.assertions && s.assertions[i].token == f.id;
        assert hasAssertion(s, f.id);
        AssertionForFound(s, f.id, s.assertions[i]);
        AssertionForFound(after, f.id, after.assertions[i]);
      }
    }
  }
}

lemma lawConsumedTokenCannotBeReused_ensures(s: Identity, token: int, audience: Audience)
  ensures (lawConsumedTokenCannotBeReused(s, token, audience) == true)
{
  if canConsume(s, token, audience) {
    var after := consume(s, token, audience);
    var a0 :| a0 in s.assertions && a0.token == token;
    var i :| 0 <= i < |s.assertions| && s.assertions[i] == a0;
    assert after.assertions[i].token == token && after.assertions[i].consumed;
    AssertionForBridge(after, token);
    ProofLib.FilterMember((a: Assertion) => (a.token == token), after.assertions, after.assertions[i]);
    var filtered := ProofLib.Filter((a: Assertion) => (a.token == token), after.assertions);
    assert |filtered| > 0;
    ProofLib.FilterMember((a: Assertion) => (a.token == token), after.assertions, filtered[0]);
    var k :| 0 <= k < |after.assertions| && after.assertions[k] == filtered[0];
    assert s.assertions[k].token == token;
    assert assertionFor(after, token).consumed;
  }
}

lemma advanceTime_ensures(s: Identity, by_: int, now: int)
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysFlowsWellFormed(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysFlowIdsUnique(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysRateWindowsCounted(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysBoundOnlyForWebsite(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysVerifierOnlyWhilePending(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysIdentityAfterCallback(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysIssuedOnce(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysIssuedFlowsClosed(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysOneAssertionPerFlow(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysLocalFlowsHaveNoAssertion(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysAssertionsMatchTheirFlow(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysConsumedOnce(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysConsumedBeforeExpiry(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepDeliveryHistoryRetained(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepFlowsMoveForward(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepPurgeKeepsLiveFlows(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepNoAssertionWithoutCompleteParent(s, advanceTime(s, by_, now)))
{
  if inv(s) && canAdvanceTime(s, by_, now) {
    var after := advanceTime(s, by_, now);
    UnchangedFlowsMoveForward(s, after);
  }
}

lemma purgeExpired_ensures(s: Identity, by_: int)
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysFlowsWellFormed(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysFlowIdsUnique(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysRateWindowsCounted(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysBoundOnlyForWebsite(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysVerifierOnlyWhilePending(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysIdentityAfterCallback(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysIssuedOnce(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysIssuedFlowsClosed(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysOneAssertionPerFlow(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysLocalFlowsHaveNoAssertion(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysAssertionsMatchTheirFlow(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysConsumedOnce(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysConsumedBeforeExpiry(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepDeliveryHistoryRetained(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepFlowsMoveForward(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepPurgeKeepsLiveFlows(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepNoAssertionWithoutCompleteParent(s, purgeExpired(s, by_)))
{
  if inv(s) && canPurgeExpired(s, by_) {
    var after := purgeExpired(s, by_);
    PurgeFlowsFilter(s, by_);
    PurgeAssertionsFilter(s, by_);
    PurgeWindowsFilter(s, by_);
    FlowsDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((f: Flow) => (f.expiresAt > s.now), s.flows, (f: Flow) => f.id);
    DistinctFlowsHaveCountOne(after.flows);
    FlowIdsUniqueFilter(after);
    AssertionsDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((a: Assertion) => (a.expiresAt > s.now), s.assertions, (a: Assertion) => a.token);
    DistinctAssertionsHaveCountOne(after.assertions);
    OneAssertionFilter(after);
    WindowsDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((w: RateWindow) => (w.expiresAt > s.now), s.windows, (w: RateWindow) => (w.client, w.scope));
    DistinctWindowsHaveCountOne(after.windows);
    RateWindowsFilter(after);
    forall f | f in after.flows
      ensures f in s.flows
    {
      ProofLib.FilterMember((f: Flow) => (f.expiresAt > s.now), s.flows, f);
    }
    forall a | a in after.assertions
      ensures a in s.assertions
    {
      ProofLib.FilterMember((a: Assertion) => (a.expiresAt > s.now), s.assertions, a);
    }
    forall w | w in after.windows
      ensures w in s.windows
    {
      ProofLib.FilterMember((w: RateWindow) => (w.expiresAt > s.now), s.windows, w);
    }
    forall f | f in after.flows
      ensures !(hasAssertion(after, f.id)) || (((assertionFor(after, f.id).github == f.github) && (assertionFor(after, f.id).audience == f.audience)) && (f.status.CallbackComplete? || f.status.AssertionIssued?))
    {
      if hasAssertion(after, f.id) {
        var a :| a in after.assertions && a.token == f.id;
        assert a in s.assertions && hasAssertion(s, f.id);
        AssertionForFound(s, f.id, a);
        AssertionForFound(after, f.id, a);
      }
    }
    forall f | f in s.flows
      ensures !(hasFlow(after, f.id)) || movedForward(f.status, flowById(after, f.id).status)
      ensures !((f.expiresAt > after.now)) || hasFlow(after, f.id)
    {
      if f.expiresAt > s.now {
        ProofLib.FilterMember((g: Flow) => (g.expiresAt > s.now), s.flows, f);
        assert f in after.flows;
      }
      if hasFlow(after, f.id) {
        var g :| g in after.flows && g.id == f.id;
        assert g in s.flows;
        var fi :| 0 <= fi < |s.flows| && s.flows[fi] == f;
        var gi :| 0 <= gi < |s.flows| && s.flows[gi] == g;
        assert fi == gi;
        assert g == f;
        FlowByIdFound(after, f.id, g);
      }
    }
  }
}
