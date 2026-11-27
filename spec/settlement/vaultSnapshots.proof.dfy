lemma RequestsUniqueBridge(s: Snapshots)
  ensures alwaysRepeatsNameASavedCreation(s) == !((exists r :: r in s.requests && !((((r.id > 0) && (|ProofLib.Filter((o: RequestRow) => (o.id == r.id), s.requests)| == 1)) && (!((r.repeatOf > 0)) || (r.source.RegistrationRequest? && (savedCreation(s, r.repeatOf).id > 0)))))))
{
  hide *;
  reveal alwaysRepeatsNameASavedCreation, ProofLib.Filter;
}

lemma RequestRowBridge(s: Snapshots, requestId: int)
  ensures requestRow(s, requestId) ==
    (if ((0 <= 0) && (0 < |ProofLib.Filter((r: RequestRow) => (r.id == requestId), s.requests)|)) then
      ProofLib.Filter((r: RequestRow) => (r.id == requestId), s.requests)[0]
    else
      noRequest)
{
  hide *;
  reveal requestRow, ProofLib.Filter;
}

lemma RequestsDistinct(s: Snapshots)
  requires alwaysRepeatsNameASavedCreation(s)
  ensures forall r :: r in s.requests ==> r.id > 0 && (r.repeatOf > 0 ==> r.source.RegistrationRequest? && savedCreation(s, r.repeatOf).id > 0)
  ensures forall i, j :: 0 <= i < |s.requests| && 0 <= j < |s.requests| && i != j ==> s.requests[i].id != s.requests[j].id
{
  hide *;
  RequestsUniqueBridge(s);
  forall i, j | 0 <= i < |s.requests| && 0 <= j < |s.requests| && i != j
    ensures s.requests[i].id != s.requests[j].id
  {
    var r := s.requests[i];
    var p := (o: RequestRow) => (o.id == r.id);
    assert r in s.requests;
    assert |ProofLib.Filter(p, s.requests)| == 1;
    if s.requests[j].id == r.id {
      ProofLib.FilterTwo(p, s.requests, i, j);
    }
  }
}

lemma RequestsUniqueFromDistinct(s: Snapshots)
  requires forall r :: r in s.requests ==> r.id > 0 && (r.repeatOf > 0 ==> r.source.RegistrationRequest? && savedCreation(s, r.repeatOf).id > 0)
  requires forall i, j :: 0 <= i < |s.requests| && 0 <= j < |s.requests| && i != j ==> s.requests[i].id != s.requests[j].id
  ensures alwaysRepeatsNameASavedCreation(s)
{
  hide *;
  RequestsUniqueBridge(s);
  forall r | r in s.requests
    ensures r.id > 0 && |ProofLib.Filter((o: RequestRow) => (o.id == r.id), s.requests)| == 1
  {
    var i :| 0 <= i < |s.requests| && s.requests[i] == r;
    var p := (o: RequestRow) => (o.id == r.id);
    ProofLib.FilterOne(p, s.requests, i);
  }
}

lemma RequestRowFound(s: Snapshots, i: int)
  requires alwaysRepeatsNameASavedCreation(s)
  requires 0 <= i < |s.requests|
  ensures requestRow(s, s.requests[i].id) == s.requests[i]
{
  hide *;
  RequestsDistinct(s);
  var requestId := s.requests[i].id;
  RequestRowBridge(s, requestId);
  var p := (r: RequestRow) => (r.id == requestId);
  ProofLib.FilterOne(p, s.requests, i);
  ProofLib.FilterMember(p, s.requests, s.requests[i]);
  assert s.requests[i] in ProofLib.Filter(p, s.requests);
  assert ProofLib.Filter(p, s.requests)[0] == s.requests[i];
}

lemma RequestRowMissing(s: Snapshots, requestId: int)
  requires forall r :: r in s.requests ==> r.id != requestId
  ensures requestRow(s, requestId) == noRequest
{
  hide *;
  RequestRowBridge(s, requestId);
  var p := (r: RequestRow) => (r.id == requestId);
  ProofLib.FilterNone(p, s.requests);
}

lemma RequestRowInOrMissing(s: Snapshots, requestId: int)
  requires alwaysRepeatsNameASavedCreation(s)
  ensures (exists r :: r in s.requests && r.id == requestId) ==> requestRow(s, requestId) in s.requests && requestRow(s, requestId).id == requestId
  ensures !(exists r :: r in s.requests && r.id == requestId) ==> requestRow(s, requestId) == noRequest
  ensures forall r :: r in s.requests && r.id == requestId ==> requestRow(s, requestId) == r
{
  hide *;
  RequestsDistinct(s);
  if exists r :: r in s.requests && r.id == requestId {
    var r :| r in s.requests && r.id == requestId;
    var i :| 0 <= i < |s.requests| && s.requests[i] == r;
    RequestRowFound(s, i);
    forall x | x in s.requests && x.id == requestId ensures requestRow(s, requestId) == x {
      var j :| 0 <= j < |s.requests| && s.requests[j] == x;
      assert i == j;
    }
  } else {
    RequestRowMissing(s, requestId);
  }
}

lemma SavedWellFormedBridge(s: Snapshots)
  ensures alwaysSavedCreationsWellFormed(s) == !((exists v :: v in s.savedCreations && !(((((((((v.id > 0) && (v.actor > 0)) && (v.tx != "")) && (v.network != "")) && (v.attempts >= 0)) && (v.createdAt > 0)) && (|ProofLib.Filter((o: SavedCreation) => (o.id == v.id), s.savedCreations)| == 1)) && (|ProofLib.Filter((o: SavedCreation) => ((o.network == v.network) && (o.tx == v.tx)), s.savedCreations)| == 1)))))
{
  hide *;
  reveal alwaysSavedCreationsWellFormed, ProofLib.Filter;
}

lemma SavedCreationBridge(s: Snapshots, savedId: int)
  ensures savedCreation(s, savedId) ==
    (if ((0 <= 0) && (0 < |ProofLib.Filter((v: SavedCreation) => (v.id == savedId), s.savedCreations)|)) then
      ProofLib.Filter((v: SavedCreation) => (v.id == savedId), s.savedCreations)[0]
    else
      noSavedCreation)
{
  hide *;
  reveal savedCreation, ProofLib.Filter;
}

lemma SavedForBridge(s: Snapshots, network: string, tx: string)
  ensures savedFor(s, network, tx) ==
    (if ((0 <= 0) && (0 < |ProofLib.Filter((v: SavedCreation) => ((v.network == network) && (v.tx == tx)), s.savedCreations)|)) then
      ProofLib.Filter((v: SavedCreation) => ((v.network == network) && (v.tx == tx)), s.savedCreations)[0]
    else
      noSavedCreation)
{
  hide *;
  reveal savedFor, ProofLib.Filter;
}

lemma WaitingCountBridge(s: Snapshots)
  ensures waitingCount(s) == |ProofLib.Filter((v: SavedCreation) => v.state.SavedWaiting?, s.savedCreations)|
{
  hide *;
  reveal waitingCount, ProofLib.Filter;
}

lemma SavedDistinct(s: Snapshots)
  requires alwaysSavedCreationsWellFormed(s)
  ensures forall v :: v in s.savedCreations ==> v.id > 0 && v.actor > 0 && v.tx != "" && v.network != "" && v.attempts >= 0 && v.createdAt > 0
  ensures forall i, j :: 0 <= i < |s.savedCreations| && 0 <= j < |s.savedCreations| && i != j ==> s.savedCreations[i].id != s.savedCreations[j].id
  ensures forall i, j :: 0 <= i < |s.savedCreations| && 0 <= j < |s.savedCreations| && i != j ==> !(s.savedCreations[i].network == s.savedCreations[j].network && s.savedCreations[i].tx == s.savedCreations[j].tx)
{
  hide *;
  SavedWellFormedBridge(s);
  forall i, j | 0 <= i < |s.savedCreations| && 0 <= j < |s.savedCreations| && i != j
    ensures s.savedCreations[i].id != s.savedCreations[j].id
    ensures !(s.savedCreations[i].network == s.savedCreations[j].network && s.savedCreations[i].tx == s.savedCreations[j].tx)
  {
    var v := s.savedCreations[i];
    assert v in s.savedCreations;
    var pId := (o: SavedCreation) => (o.id == v.id);
    if s.savedCreations[j].id == v.id {
      ProofLib.FilterTwo(pId, s.savedCreations, i, j);
    }
    var pKey := (o: SavedCreation) => ((o.network == v.network) && (o.tx == v.tx));
    if s.savedCreations[j].network == v.network && s.savedCreations[j].tx == v.tx {
      ProofLib.FilterTwo(pKey, s.savedCreations, i, j);
    }
  }
}

lemma SavedWellFormedFromDistinct(s: Snapshots)
  requires forall v :: v in s.savedCreations ==> v.id > 0 && v.actor > 0 && v.tx != "" && v.network != "" && v.attempts >= 0 && v.createdAt > 0
  requires forall i, j :: 0 <= i < |s.savedCreations| && 0 <= j < |s.savedCreations| && i != j ==> s.savedCreations[i].id != s.savedCreations[j].id
  requires forall i, j :: 0 <= i < |s.savedCreations| && 0 <= j < |s.savedCreations| && i != j ==> !(s.savedCreations[i].network == s.savedCreations[j].network && s.savedCreations[i].tx == s.savedCreations[j].tx)
  ensures alwaysSavedCreationsWellFormed(s)
{
  hide *;
  SavedWellFormedBridge(s);
  forall v | v in s.savedCreations
    ensures |ProofLib.Filter((o: SavedCreation) => (o.id == v.id), s.savedCreations)| == 1
    ensures |ProofLib.Filter((o: SavedCreation) => ((o.network == v.network) && (o.tx == v.tx)), s.savedCreations)| == 1
  {
    var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == v;
    ProofLib.FilterOne((o: SavedCreation) => (o.id == v.id), s.savedCreations, i);
    ProofLib.FilterOne((o: SavedCreation) => ((o.network == v.network) && (o.tx == v.tx)), s.savedCreations, i);
  }
}

lemma SavedCreationFound(s: Snapshots, i: int)
  requires alwaysSavedCreationsWellFormed(s)
  requires 0 <= i < |s.savedCreations|
  ensures savedCreation(s, s.savedCreations[i].id) == s.savedCreations[i]
{
  hide *;
  SavedDistinct(s);
  var savedId := s.savedCreations[i].id;
  SavedCreationBridge(s, savedId);
  var p := (v: SavedCreation) => (v.id == savedId);
  ProofLib.FilterOne(p, s.savedCreations, i);
  ProofLib.FilterMember(p, s.savedCreations, s.savedCreations[i]);
  assert s.savedCreations[i] in ProofLib.Filter(p, s.savedCreations);
  assert ProofLib.Filter(p, s.savedCreations)[0] == s.savedCreations[i];
}

lemma SavedCreationMissing(s: Snapshots, savedId: int)
  requires forall v :: v in s.savedCreations ==> v.id != savedId
  ensures savedCreation(s, savedId) == noSavedCreation
{
  hide *;
  SavedCreationBridge(s, savedId);
  var p := (v: SavedCreation) => (v.id == savedId);
  ProofLib.FilterNone(p, s.savedCreations);
}

lemma SavedCreationInOrMissing(s: Snapshots, savedId: int)
  requires alwaysSavedCreationsWellFormed(s)
  ensures (exists v :: v in s.savedCreations && v.id == savedId) ==> savedCreation(s, savedId) in s.savedCreations && savedCreation(s, savedId).id == savedId
  ensures !(exists v :: v in s.savedCreations && v.id == savedId) ==> savedCreation(s, savedId) == noSavedCreation
  ensures forall v :: v in s.savedCreations && v.id == savedId ==> savedCreation(s, savedId) == v
{
  hide *;
  SavedDistinct(s);
  if exists v :: v in s.savedCreations && v.id == savedId {
    var v :| v in s.savedCreations && v.id == savedId;
    var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == v;
    SavedCreationFound(s, i);
    forall x | x in s.savedCreations && x.id == savedId ensures savedCreation(s, savedId) == x {
      var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == x;
      assert i == j;
    }
  } else {
    SavedCreationMissing(s, savedId);
  }
}

lemma SavedForInOrMissing(s: Snapshots, network: string, tx: string)
  requires alwaysSavedCreationsWellFormed(s)
  ensures (exists v :: v in s.savedCreations && v.network == network && v.tx == tx) ==> savedFor(s, network, tx) in s.savedCreations && savedFor(s, network, tx).network == network && savedFor(s, network, tx).tx == tx
  ensures !(exists v :: v in s.savedCreations && v.network == network && v.tx == tx) ==> savedFor(s, network, tx) == noSavedCreation
{
  hide *;
  SavedDistinct(s);
  SavedForBridge(s, network, tx);
  var p := (v: SavedCreation) => ((v.network == network) && (v.tx == tx));
  if exists v :: v in s.savedCreations && v.network == network && v.tx == tx {
    var v :| v in s.savedCreations && v.network == network && v.tx == tx;
    var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == v;
    ProofLib.FilterOne(p, s.savedCreations, i);
    ProofLib.FilterMember(p, s.savedCreations, v);
    assert v in ProofLib.Filter(p, s.savedCreations);
    assert ProofLib.Filter(p, s.savedCreations)[0] == v;
  } else {
    ProofLib.FilterNone(p, s.savedCreations);
  }
}

lemma FilterReplaceOneDelta<T>(p: T -> bool, xs: seq<T>, ys: seq<T>, idx: int)
  requires |xs| == |ys| && 0 <= idx < |xs|
  requires forall i :: 0 <= i < |xs| && i != idx ==> xs[i] == ys[i]
  ensures |ProofLib.Filter(p, ys)| == |ProofLib.Filter(p, xs)| + (if p(ys[idx]) then 1 else 0) - (if p(xs[idx]) then 1 else 0)
  decreases |xs|
{
  hide *;
  ProofLib.FilterCons(p, xs);
  ProofLib.FilterCons(p, ys);
  if idx == 0 {
    assert xs[1..] == ys[1..];
  } else {
    assert xs[0] == ys[0];
    assert forall i :: 0 <= i < |xs[1..]| && i != idx - 1 ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    FilterReplaceOneDelta(p, xs[1..], ys[1..], idx - 1);
  }
}

lemma SavedListSamePreserves(before: Snapshots, after: Snapshots)
  requires alwaysSavedCreationsWellFormed(before)
  requires alwaysAtMostThreeWaiting(before)
  requires after.savedCreations == before.savedCreations
  ensures alwaysSavedCreationsWellFormed(after)
  ensures alwaysAtMostThreeWaiting(after)
  ensures stepSavedTerminal(before, after)
{
  hide *;
  reveal alwaysAtMostThreeWaiting, stepSavedTerminal;
  SavedWellFormedBridge(before);
  SavedWellFormedBridge(after);
  WaitingCountBridge(before);
  WaitingCountBridge(after);
  forall o | o in before.savedCreations
    ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
  {
    assert o in after.savedCreations;
  }
}

lemma SavedRegSamePreserves(before: Snapshots, after: Snapshots)
  requires alwaysSavedCreationsWellFormed(before)
  requires alwaysSavedRegisteredIsRegistered(before)
  requires after.savedCreations == before.savedCreations
  requires registered(before.ordinary.registration) ==> after.ordinary.registration == before.ordinary.registration
  requires registered(before.privateBounty.registration) ==> after.privateBounty.registration == before.privateBounty.registration
  ensures alwaysSavedRegisteredIsRegistered(after)
  ensures stepRefusalOnlyUnregistered(before, after)
{
  hide *;
  reveal alwaysSavedRegisteredIsRegistered, stepRefusalOnlyUnregistered, namesRegistration, deployment, registered;
  SavedDistinct(before);
  forall n | n in after.savedCreations && n.state.SavedRefused?
    ensures !(exists o :: o in before.savedCreations && o.id == n.id && o.state.SavedWaiting?)
  {
    var i :| 0 <= i < |before.savedCreations| && before.savedCreations[i] == n;
    forall o | o in before.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
      var j :| 0 <= j < |before.savedCreations| && before.savedCreations[j] == o;
      assert i == j;
    }
  }
}

lemma MonthStartsBridge(s: Snapshots)
  ensures alwaysOneMonthStartPerVault(s) == !((exists m :: m in s.monthStarts && !((((((m.blockTime > 0) && settlement__money_validAmount(m.free)) && settlement__money_validAmount(m.withdrawn)) && (settlement__calendar_utcPeriod(m.blockTime) == m.period)) && (|ProofLib.Filter((o: MonthStart) => sameMonthStart(o, m), s.monthStarts)| == 1)))))
{
  hide *;
  reveal alwaysOneMonthStartPerVault, ProofLib.Filter;
}

lemma MonthStartsSamePreserves(before: Snapshots, after: Snapshots)
  requires alwaysOneMonthStartPerVault(before)
  requires alwaysMonthStartsOfTheOrdinaryVault(before)
  requires after.monthStarts == before.monthStarts
  requires registered(before.ordinary.registration) ==> after.ordinary.registration == before.ordinary.registration
  ensures alwaysOneMonthStartPerVault(after)
  ensures alwaysMonthStartsOfTheOrdinaryVault(after)
  ensures stepMonthStartsNeverChange(before, after)
{
  hide *;
  reveal alwaysMonthStartsOfTheOrdinaryVault, stepMonthStartsNeverChange, registered;
  MonthStartsBridge(before);
  MonthStartsBridge(after);
}

lemma PledgesSamePreserves(before: Snapshots, after: Snapshots)
  requires alwaysPledgesOfTheOrdinaryVault(before)
  requires after.pledges == before.pledges && after.openPledged == before.openPledged
  requires registered(before.ordinary.registration) ==> after.ordinary.registration == before.ordinary.registration
  ensures alwaysPledgesOfTheOrdinaryVault(after)
  ensures stepStoredPledgesNeverDropped(before, after)
{
  hide *;
  reveal alwaysPledgesOfTheOrdinaryVault, stepStoredPledgesNeverDropped, settlement__monthPledges_samePledge, settlement__money_equalAmounts, registered;
  forall p | p in before.pledges
    ensures exists n :: n in after.pledges && settlement__monthPledges_samePledge(n, p.network, p.vault, p.period) && settlement__money_compareAmounts(n.block, p.block) >= 0
  {
    settlement__money_lawEqualReflexive_ensures(p.block);
    assert settlement__money_lawEqualReflexive(p.block) by { reveal settlement__money_lawEqualReflexive; }
    assert p in after.pledges;
    assert settlement__money_compareAmounts(p.block, p.block) == 0;
  }
}

lemma DeploymentsSamePreserves(before: Snapshots, after: Snapshots, via: string)
  requires alwaysObservationScoped(before)
  requires alwaysSameAssetAcrossPurposes(before)
  requires after.ordinary == before.ordinary && after.privateBounty == before.privateBounty
  ensures alwaysObservationScoped(after)
  ensures alwaysSameAssetAcrossPurposes(after)
  ensures stepRegistrationIsImmutable(before, after)
  ensures stepOrdinaryObservationMonotonic(before, via, after)
  ensures stepPrivateObservationMonotonic(before, via, after)
{
  hide *;
  reveal alwaysObservationScoped, alwaysSameAssetAcrossPurposes, stepRegistrationIsImmutable, stepOrdinaryObservationMonotonic, stepPrivateObservationMonotonic, observationMonotonic;
}

lemma RequestsSamePreserves(before: Snapshots, after: Snapshots)
  requires alwaysRepeatsNameASavedCreation(before)
  requires after.requests == before.requests
  requires forall id :: savedCreation(before, id).id > 0 ==> savedCreation(after, id).id > 0
  ensures alwaysRepeatsNameASavedCreation(after)
  ensures stepRepeatsActAsTheSaver(before, after)
{
  hide *;
  reveal stepRepeatsActAsTheSaver;
  RequestsDistinct(before);
  RequestsUniqueFromDistinct(after);
  forall r | r in after.requests
    ensures !((r.repeatOf > 0) && (requestRow(before, r.id).id == 0))
  {
    var i :| 0 <= i < |before.requests| && before.requests[i] == r;
    RequestRowFound(before, i);
  }
}

lemma RequestUpdatePreserves(before: Snapshots, after: Snapshots, r: RequestRow, updated: RequestRow)
  requires alwaysRepeatsNameASavedCreation(before)
  requires r in before.requests && r == requestRow(before, r.id)
  requires updated.id == r.id && updated.repeatOf == r.repeatOf && updated.source == r.source
  requires after.requests == updateRequest(updated, before).requests
  requires forall id :: savedCreation(before, id).id > 0 ==> savedCreation(after, id).id > 0
  ensures alwaysRepeatsNameASavedCreation(after)
  ensures stepRepeatsActAsTheSaver(before, after)
  ensures forall x :: x in after.requests ==> x == updated || (x in before.requests && x.id != r.id)
{
  hide *;
  reveal updateRequest, stepRepeatsActAsTheSaver;
  RequestsDistinct(before);
  assert |after.requests| == |before.requests|;
  forall i | 0 <= i < |after.requests|
    ensures after.requests[i].id == before.requests[i].id
    ensures after.requests[i] == updated || (after.requests[i] == before.requests[i] && after.requests[i].id != r.id)
  { }
  RequestsUniqueFromDistinct(after);
  forall x | x in after.requests
    ensures !((x.repeatOf > 0) && (requestRow(before, x.id).id == 0))
  {
    var i :| 0 <= i < |after.requests| && after.requests[i] == x;
    assert before.requests[i].id == x.id;
    RequestRowFound(before, i);
  }
}

lemma RequestAppendPreserves(before: Snapshots, after: Snapshots, added: RequestRow)
  requires alwaysRepeatsNameASavedCreation(before)
  requires added.id > 0 && requestRow(before, added.id).id == 0
  requires added.repeatOf == 0
  requires after.requests == before.requests + [added]
  requires after.savedCreations == before.savedCreations
  ensures alwaysRepeatsNameASavedCreation(after)
  ensures stepRepeatsActAsTheSaver(before, after)
{
  hide *;
  reveal stepRepeatsActAsTheSaver, noRequest;
  RequestsDistinct(before);
  RequestRowInOrMissing(before, added.id);
  forall id ensures savedCreation(after, id) == savedCreation(before, id) {
    SavedCreationBridge(before, id);
    SavedCreationBridge(after, id);
  }
  RequestsUniqueFromDistinct(after);
  forall x | x in after.requests
    ensures !((x.repeatOf > 0) && (requestRow(before, x.id).id == 0))
  {
    if x != added {
      var i :| 0 <= i < |before.requests| && before.requests[i] == x;
      RequestRowFound(before, i);
    }
  }
}

lemma SavedReplacePreserves(before: Snapshots, after: Snapshots, v: SavedCreation, updated: SavedCreation)
  requires alwaysSavedCreationsWellFormed(before)
  requires alwaysAtMostThreeWaiting(before)
  requires v in before.savedCreations && v == savedCreation(before, v.id)
  requires updated.id == v.id && updated.network == v.network && updated.tx == v.tx
  requires updated.actor > 0 && updated.attempts >= 0 && updated.createdAt > 0
  requires after.savedCreations == replaceSaved(updated, before).savedCreations
  requires (!updated.state.SavedWaiting? || v.state.SavedWaiting? || waitingCount(before) < savedLimit)
  ensures alwaysSavedCreationsWellFormed(after)
  ensures alwaysAtMostThreeWaiting(after)
  ensures forall id :: savedCreation(before, id).id > 0 ==> savedCreation(after, id).id > 0
  ensures savedCreation(after, v.id) == updated
  ensures updated in after.savedCreations
  ensures forall o :: o in before.savedCreations && o.id != v.id ==> o in after.savedCreations
  ensures forall n :: n in after.savedCreations ==> n == updated || (n in before.savedCreations && n.id != v.id)
{
  hide *;
  reveal replaceSaved, alwaysAtMostThreeWaiting, savedLimit, noSavedCreation;
  SavedDistinct(before);
  var idx :| 0 <= idx < |before.savedCreations| && before.savedCreations[idx] == v;
  assert |after.savedCreations| == |before.savedCreations|;
  forall i | 0 <= i < |after.savedCreations|
    ensures after.savedCreations[i].id == before.savedCreations[i].id
    ensures after.savedCreations[i].network == before.savedCreations[i].network
    ensures after.savedCreations[i].tx == before.savedCreations[i].tx
    ensures i == idx ==> after.savedCreations[i] == updated
    ensures i != idx ==> after.savedCreations[i] == before.savedCreations[i]
  { }
  assert after.savedCreations[idx] == updated;
  SavedWellFormedFromDistinct(after);
  WaitingCountBridge(before);
  WaitingCountBridge(after);
  var p := (x: SavedCreation) => x.state.SavedWaiting?;
  FilterReplaceOneDelta(p, before.savedCreations, after.savedCreations, idx);
  SavedCreationFound(after, idx);
  forall id | savedCreation(before, id).id > 0
    ensures savedCreation(after, id).id > 0
  {
    SavedCreationInOrMissing(before, id);
    var k :| 0 <= k < |before.savedCreations| && before.savedCreations[k].id == id;
    SavedCreationFound(after, k);
  }
}

lemma SavedAppendPreserves(before: Snapshots, after: Snapshots, added: SavedCreation)
  requires alwaysSavedCreationsWellFormed(before)
  requires alwaysAtMostThreeWaiting(before)
  requires waitingCount(before) < savedLimit
  requires added.id > 0 && savedCreation(before, added.id).id == 0
  requires added.actor > 0 && added.tx != "" && added.network != "" && added.attempts >= 0 && added.createdAt > 0
  requires savedFor(before, added.network, added.tx).id == 0
  requires after.savedCreations == before.savedCreations + [added]
  ensures alwaysSavedCreationsWellFormed(after)
  ensures alwaysAtMostThreeWaiting(after)
  ensures forall id :: savedCreation(before, id).id > 0 ==> savedCreation(after, id).id > 0
  ensures stepSavedTerminal(before, after)
{
  hide *;
  reveal alwaysAtMostThreeWaiting, stepSavedTerminal, savedLimit, noSavedCreation;
  SavedDistinct(before);
  SavedCreationInOrMissing(before, added.id);
  SavedForInOrMissing(before, added.network, added.tx);
  SavedWellFormedFromDistinct(after);
  WaitingCountBridge(before);
  WaitingCountBridge(after);
  var p := (x: SavedCreation) => x.state.SavedWaiting?;
  ProofLib.FilterAppend(p, before.savedCreations, added);
  forall id | savedCreation(before, id).id > 0
    ensures savedCreation(after, id).id > 0
  {
    SavedCreationInOrMissing(before, id);
    var k :| 0 <= k < |before.savedCreations| && before.savedCreations[k].id == id;
    assert after.savedCreations[k] == before.savedCreations[k];
    SavedCreationFound(after, k);
  }
  forall o | o in before.savedCreations
    ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
  {
    assert o in after.savedCreations;
  }
}

lemma WithMonthStartPreserves(observation: Observation, s: Snapshots)
  requires alwaysOneMonthStartPerVault(s)
  requires alwaysMonthStartsOfTheOrdinaryVault(s)
  requires registered(s.ordinary.registration)
  requires observation.identity == s.ordinary.registration.identity
  ensures var after := withMonthStart(observation, s);
    alwaysOneMonthStartPerVault(after) &&
    alwaysMonthStartsOfTheOrdinaryVault(after) &&
    stepMonthStartsNeverChange(s, after) &&
    after.ordinary == s.ordinary && after.privateBounty == s.privateBounty &&
    after.savedCreations == s.savedCreations && after.requests == s.requests &&
    after.revision == s.revision && after.history == s.history &&
    after.pledges == s.pledges && after.openPledged == s.openPledged
{
  hide *;
  reveal withMonthStart, monthStartOf, sameMonthStart, alwaysMonthStartsOfTheOrdinaryVault, stepMonthStartsNeverChange, registered;
  var start := monthStartOf(observation);
  var after := withMonthStart(observation, s);
  MonthStartsBridge(s);
  MonthStartsBridge(after);
  if (observation.balances.free.present && observation.blockTime > 0 && settlement__money_validAmount(start.free) && settlement__money_validAmount(start.withdrawn) && !(exists m :: m in s.monthStarts && sameMonthStart(m, start))) {
    assert after.monthStarts == s.monthStarts + [start];
    forall m | m in after.monthStarts
      ensures |ProofLib.Filter((o: MonthStart) => sameMonthStart(o, m), after.monthStarts)| == 1
    {
      var p := (o: MonthStart) => sameMonthStart(o, m);
      ProofLib.FilterAppend(p, s.monthStarts, start);
      if m == start {
        ProofLib.FilterNone(p, s.monthStarts);
      } else {
        assert m in s.monthStarts;
        assert !sameMonthStart(start, m);
      }
    }
  }
}

lemma ReadForBridge(pledges: seq<settlement__monthPledges_ChainPledge>, period: int)
  ensures settlement__monthPledges_readFor(pledges, period) ==
    (if ((0 <= 0) && (0 < |ProofLib.Filter((p: settlement__monthPledges_ChainPledge) => (p.period == period), pledges)|)) then
      ProofLib.Filter((p: settlement__monthPledges_ChainPledge) => (p.period == period), pledges)[0]
    else
      settlement__monthPledges_noChainPledge)
{
  hide *;
  reveal settlement__monthPledges_readFor, ProofLib.Filter;
}

lemma ReadForInPledges(pledges: seq<settlement__monthPledges_ChainPledge>, period: int)
  requires exists p :: p in pledges && p.period == period
  ensures settlement__monthPledges_readFor(pledges, period) in pledges
{
  hide *;
  ReadForBridge(pledges, period);
  var p := (x: settlement__monthPledges_ChainPledge) => (x.period == period);
  ProofLib.FilterNone(p, pledges);
  assert |ProofLib.Filter(p, pledges)| > 0;
  ProofLib.FilterSubset(p, pledges);
}

lemma StorePledgesBridge(stored: seq<settlement__monthPledges_StoredPledge>, network: string, vault: string, block: seq<int>, pledges: seq<settlement__monthPledges_ChainPledge>)
  ensures settlement__monthPledges_storePledges(stored, network, vault, block, pledges) ==
    (seq(|stored|, i_map requires 0 <= i_map < |stored| => var row := stored[i_map]; settlement__monthPledges_refreshedPledge(row, network, vault, block, pledges)) + (var s_map := ProofLib.Filter((p: settlement__monthPledges_ChainPledge) => !((exists row :: row in stored && settlement__monthPledges_samePledge(row, network, vault, p.period))), pledges); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var p := s_map[i_map]; settlement__monthPledges_StoredPledge(network, vault, p.period, p.amount, p.open, block))))
{
  hide *;
  reveal settlement__monthPledges_storePledges, ProofLib.Filter;
}

lemma WithMonthPledgesPreserves(observation: Observation, s: Snapshots)
  requires alwaysPledgesOfTheOrdinaryVault(s)
  requires observation.purpose.Ordinary? ==>
    registered(s.ordinary.registration) &&
    observation.identity == s.ordinary.registration.identity &&
    (observation.monthPledges.PledgesRead? ==> settlement__monthPledges_validPledges(observation.monthPledges.openPledged, observation.monthPledges.pledges))
  ensures var after := withMonthPledges(observation, s);
    alwaysPledgesOfTheOrdinaryVault(after) &&
    stepStoredPledgesNeverDropped(s, after) &&
    after.ordinary == s.ordinary && after.privateBounty == s.privateBounty &&
    after.savedCreations == s.savedCreations && after.requests == s.requests &&
    after.revision == s.revision && after.history == s.history &&
    after.monthStarts == s.monthStarts
{
  hide *;
  reveal withMonthPledges, alwaysPledgesOfTheOrdinaryVault, stepStoredPledgesNeverDropped, settlement__monthPledges_storePledgeRead, settlement__monthPledges_refreshedPledge, settlement__monthPledges_storedTotalAfter, settlement__monthPledges_validPledges, settlement__monthPledges_samePledge, settlement__monthPledges_noStoredTotal, settlement__money_equalAmounts, registered;
  var after := withMonthPledges(observation, s);
  if observation.purpose.Ordinary? && observation.monthPledges.PledgesRead? {
    var pledges := observation.monthPledges.pledges;
    var net := observation.identity.network;
    var vlt := observation.identity.vault;
    var blk := observation.block;
    StorePledgesBridge(s.pledges, net, vlt, blk, pledges);
    var pred := (p: settlement__monthPledges_ChainPledge) => !((exists row :: row in s.pledges && settlement__monthPledges_samePledge(row, net, vlt, p.period)));
    var filtered := ProofLib.Filter(pred, pledges);
    ProofLib.FilterSubset(pred, pledges);
    assert |after.pledges| == |s.pledges| + |filtered|;
    forall i | 0 <= i < |s.pledges|
      ensures var n := after.pledges[i];
        registered(after.ordinary.registration) &&
        n.network == after.ordinary.registration.identity.network &&
        n.vault == after.ordinary.registration.identity.vault &&
        settlement__monthPledges_validPledgePeriod(n.period) &&
        settlement__money_withinMaximum(n.amount, settlement__money_maxU128) &&
        settlement__monthPledges_samePledge(n, s.pledges[i].network, s.pledges[i].vault, s.pledges[i].period) &&
        settlement__money_compareAmounts(n.block, s.pledges[i].block) >= 0
    {
      var row := s.pledges[i];
      assert after.pledges[i] == settlement__monthPledges_refreshedPledge(row, net, vlt, blk, pledges);
      if row.network == net && row.vault == vlt && (exists p :: p in pledges && p.period == row.period) && settlement__money_compareAmounts(blk, row.block) >= 0 {
        ReadForInPledges(pledges, row.period);
      } else {
        settlement__money_lawEqualReflexive_ensures(row.block);
        assert settlement__money_lawEqualReflexive(row.block) by { reveal settlement__money_lawEqualReflexive; }
      }
    }
    forall p | p in after.pledges
      ensures registered(after.ordinary.registration) &&
        p.network == after.ordinary.registration.identity.network &&
        p.vault == after.ordinary.registration.identity.vault &&
        settlement__monthPledges_validPledgePeriod(p.period) &&
        settlement__money_withinMaximum(p.amount, settlement__money_maxU128)
    {
      var k :| 0 <= k < |after.pledges| && after.pledges[k] == p;
      if k >= |s.pledges| {
        var j := k - |s.pledges|;
        assert 0 <= j < |filtered| && filtered[j] in pledges;
        assert p == settlement__monthPledges_StoredPledge(net, vlt, filtered[j].period, filtered[j].amount, filtered[j].open, blk);
      }
    }
    forall p | p in s.pledges
      ensures exists n :: n in after.pledges && settlement__monthPledges_samePledge(n, p.network, p.vault, p.period) && settlement__money_compareAmounts(n.block, p.block) >= 0
    {
      var i :| 0 <= i < |s.pledges| && s.pledges[i] == p;
      assert after.pledges[i] in after.pledges;
    }
  } else {
    forall p | p in s.pledges
      ensures exists n :: n in after.pledges && settlement__monthPledges_samePledge(n, p.network, p.vault, p.period) && settlement__money_compareAmounts(n.block, p.block) >= 0
    {
      settlement__money_lawEqualReflexive_ensures(p.block);
      assert settlement__money_lawEqualReflexive(p.block) by { reveal settlement__money_lawEqualReflexive; }
      assert p in after.pledges;
    }
  }
}

lemma appendRegistryRevision_ensures(s: Snapshots, ordinaryPolicy: int, privatePolicy: int, authorized: bool)
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysSavedCreationsWellFormed(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysAtMostThreeWaiting(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysRepeatsNameASavedCreation(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysSavedRegisteredIsRegistered(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysObservationScoped(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysSameAssetAcrossPurposes(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysRegisteredIdentityApproved(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysOneMonthStartPerVault(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysMonthStartsOfTheOrdinaryVault(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> alwaysPledgesOfTheOrdinaryVault(appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepSavedTerminal(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepRepeatsActAsTheSaver(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepRefusalOnlyUnregistered(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepRegistrationIsImmutable(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepWritePreservesRegistry(s, "appendRegistryRevision", appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepOrdinaryObservationMonotonic(s, "appendRegistryRevision", appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepPrivateObservationMonotonic(s, "appendRegistryRevision", appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepMonthStartsNeverChange(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
  ensures (inv(s) ==> canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) ==> stepStoredPledgesNeverDropped(s, appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized)))
{
  hide *;
  reveal inv, canAppendRegistryRevision, appendRegistryRevision, nextRevision, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canAppendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized) {
    var after := appendRegistryRevision(s, ordinaryPolicy, privatePolicy, authorized);
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "appendRegistryRevision");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    RequestsSamePreserves(s, after);
  }
}

lemma checkCreation_ensures(s: Snapshots, requestId: int, creation: Creation)
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysSavedCreationsWellFormed(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysAtMostThreeWaiting(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysRepeatsNameASavedCreation(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysSavedRegisteredIsRegistered(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysObservationScoped(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysSameAssetAcrossPurposes(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysRegisteredIdentityApproved(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysOneMonthStartPerVault(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepSavedTerminal(s, checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepRepeatsActAsTheSaver(s, checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepRefusalOnlyUnregistered(s, checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepRegistrationIsImmutable(s, checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepWritePreservesRegistry(s, "checkCreation", checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "checkCreation", checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepPrivateObservationMonotonic(s, "checkCreation", checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepMonthStartsNeverChange(s, checkCreation(s, requestId, creation)))
  ensures (inv(s) ==> canCheckCreation(s, requestId) ==> stepStoredPledgesNeverDropped(s, checkCreation(s, requestId, creation)))
{
  hide *;
  reveal inv, canCheckCreation, checkCreation, finish, updateRequest, noRequest, noRegistration, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canCheckCreation(s, requestId) {
    var r := requestRow(s, requestId);
    var after := checkCreation(s, requestId, creation);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "checkCreation");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    var rev := immutableRevision(s, r.expected);
    var cap := immutableRevision(s, r.capture);
    if rev.number == 0 || policy(rev, r.purpose) != policy(cap, r.purpose) {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.RegistrationConflict, http := 409));
    } else if creation.transaction != r.tx || creation.reviewed != r.expected || creation.purpose != r.purpose || creation.status.UnverifiedCreation? {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.RegistrationRefused, http := 409));
    } else if creation.status.PendingCreation? {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.CreationPending, http := 200));
    } else if !validIdentity(creation.identity) || creation.identity.network != r.network || !compatibleAcrossPurposes(s, r.purpose, creation.identity) {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.RegistrationRefused, http := 409));
    } else if creation.status.IncludedCreation? {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.CreationPending, http := 200));
    } else {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.ReadyAppend, registration := noRegistration.(tx := r.tx, identity := creation.identity)));
    }
  }
}

lemma beginRegistration_ensures(s: Snapshots, requestId: int, purpose: Purpose, tx: string, network: string, expected: int, actor: int, authorized: bool)
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysSavedCreationsWellFormed(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysAtMostThreeWaiting(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysRepeatsNameASavedCreation(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysSavedRegisteredIsRegistered(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysObservationScoped(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysSameAssetAcrossPurposes(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysRegisteredIdentityApproved(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysOneMonthStartPerVault(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysMonthStartsOfTheOrdinaryVault(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> alwaysPledgesOfTheOrdinaryVault(beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepSavedTerminal(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepRepeatsActAsTheSaver(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepRefusalOnlyUnregistered(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepRegistrationIsImmutable(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepWritePreservesRegistry(s, "beginRegistration", beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepOrdinaryObservationMonotonic(s, "beginRegistration", beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepPrivateObservationMonotonic(s, "beginRegistration", beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepMonthStartsNeverChange(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
  ensures (inv(s) ==> canBeginRegistration(s, requestId, tx, network, actor, authorized) ==> stepStoredPledgesNeverDropped(s, beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized)))
{
  hide *;
  reveal inv, canBeginRegistration, beginRegistration, firstReadPhase, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canBeginRegistration(s, requestId, tx, network, actor, authorized) {
    var after := beginRegistration(s, requestId, purpose, tx, network, expected, actor, authorized);
    var binding := deployment(s, purpose).registration;
    var existing := registered(binding) && binding.tx == tx && binding.identity.network == network;
    var phase := if existing then firstReadPhase(binding.identity) else if registered(binding) then RequestPhase.RequestDone else RequestPhase.ReadyRegistration;
    var added := noRequest.(id := requestId, purpose := purpose, phase := phase, result := (if phase.RequestDone? then RequestResult.RegistrationConflict else RequestResult.NoResult), http := (if phase.RequestDone? then 409 else 0), capture := s.revision.number, expected := expected, tx := tx, network := network, actor := actor, registration := (if existing then binding else noRegistration));
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "beginRegistration");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestAppendPreserves(s, after, added);
  }
}

lemma commitRegistration_ensures(s: Snapshots, requestId: int, saved: bool)
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysSavedCreationsWellFormed(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysAtMostThreeWaiting(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysRepeatsNameASavedCreation(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysSavedRegisteredIsRegistered(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysObservationScoped(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysSameAssetAcrossPurposes(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysRegisteredIdentityApproved(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysOneMonthStartPerVault(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepSavedTerminal(s, commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepRepeatsActAsTheSaver(s, commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepRefusalOnlyUnregistered(s, commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepRegistrationIsImmutable(s, commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepWritePreservesRegistry(s, "commitRegistration", commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "commitRegistration", commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepPrivateObservationMonotonic(s, "commitRegistration", commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepMonthStartsNeverChange(s, commitRegistration(s, requestId, saved)))
  ensures (inv(s) ==> canCommitRegistration(s, requestId) ==> stepStoredPledgesNeverDropped(s, commitRegistration(s, requestId, saved)))
{
  hide *;
  reveal inv, canCommitRegistration, commitRegistration, finish, updateRequest, setDeployment, deployment, otherPurpose, nextRevision, compatibleAcrossPurposes, firstReadPhase, registered, noRequest, noDeployment, noObservation, alwaysObservationScoped, rowScoped, alwaysSameAssetAcrossPurposes, alwaysRegisteredIdentityApproved, stepRegistrationIsImmutable, stepWritePreservesRegistry, stepOrdinaryObservationMonotonic, stepPrivateObservationMonotonic;
  if inv(s) && canCommitRegistration(s, requestId) {
    var r := requestRow(s, requestId);
    var after := commitRegistration(s, requestId, saved);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    var rev := s.revision.(number := s.revision.number + 1);
    var admitted := r.registration.(revision := rev.number);
    if !saved || r.capture != s.revision.number || registered(deployment(s, r.purpose).registration) || !compatibleAcrossPurposes(s, r.purpose, r.registration.identity) {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.RegistrationConflict, http := 409));
    } else {
      RequestUpdatePreserves(s, after, r, r.(phase := firstReadPhase(admitted.identity), registration := admitted));
    }
  }
}

lemma expireSaved_ensures(s: Snapshots, savedId: int, now: int)
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysSavedCreationsWellFormed(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysAtMostThreeWaiting(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysRepeatsNameASavedCreation(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysSavedRegisteredIsRegistered(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysObservationScoped(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysSameAssetAcrossPurposes(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysRegisteredIdentityApproved(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysOneMonthStartPerVault(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysMonthStartsOfTheOrdinaryVault(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> alwaysPledgesOfTheOrdinaryVault(expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepSavedTerminal(s, expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepRepeatsActAsTheSaver(s, expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepRefusalOnlyUnregistered(s, expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepRegistrationIsImmutable(s, expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepWritePreservesRegistry(s, "expireSaved", expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepOrdinaryObservationMonotonic(s, "expireSaved", expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepPrivateObservationMonotonic(s, "expireSaved", expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepMonthStartsNeverChange(s, expireSaved(s, savedId, now)))
  ensures (inv(s) ==> canExpireSaved(s, savedId, now) ==> stepStoredPledgesNeverDropped(s, expireSaved(s, savedId, now)))
{
  hide *;
  reveal inv, canExpireSaved, expireSaved, savedDue, replaceSaved, noSavedCreation, alwaysSavedRegisteredIsRegistered, alwaysRegisteredIdentityApproved, namesRegistration, deployment, stepSavedTerminal, stepRefusalOnlyUnregistered, stepWritePreservesRegistry;
  if inv(s) && canExpireSaved(s, savedId, now) {
    var v := savedCreation(s, savedId);
    var updated := v.(state := SavedState.SavedExpired);
    var after := expireSaved(s, savedId, now);
    SavedDistinct(s);
    SavedCreationInOrMissing(s, savedId);
    assert v in s.savedCreations && v.id == savedId;
    SavedReplacePreserves(s, after, v, updated);
    DeploymentsSamePreserves(s, after, "expireSaved");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestsSamePreserves(s, after);
    forall o | o in s.savedCreations
      ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
    {
      if o.id == savedId {
        assert o == v && updated in after.savedCreations;
      } else {
        assert o in after.savedCreations;
      }
    }
    forall n | n in after.savedCreations && n.state.SavedRefused?
      ensures !(exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
    {
      assert n in s.savedCreations && n.id != savedId;
      var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
      forall o | o in s.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
        var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
        assert i == j;
      }
    }
  }
}

lemma closeRegisteredCreation_ensures(s: Snapshots, savedId: int)
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysSavedCreationsWellFormed(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysAtMostThreeWaiting(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysRepeatsNameASavedCreation(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysSavedRegisteredIsRegistered(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysObservationScoped(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysSameAssetAcrossPurposes(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysRegisteredIdentityApproved(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysOneMonthStartPerVault(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysMonthStartsOfTheOrdinaryVault(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> alwaysPledgesOfTheOrdinaryVault(closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepSavedTerminal(s, closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepRepeatsActAsTheSaver(s, closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepRefusalOnlyUnregistered(s, closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepRegistrationIsImmutable(s, closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepWritePreservesRegistry(s, "closeRegisteredCreation", closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepOrdinaryObservationMonotonic(s, "closeRegisteredCreation", closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepPrivateObservationMonotonic(s, "closeRegisteredCreation", closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepMonthStartsNeverChange(s, closeRegisteredCreation(s, savedId)))
  ensures (inv(s) ==> canCloseRegisteredCreation(s, savedId) ==> stepStoredPledgesNeverDropped(s, closeRegisteredCreation(s, savedId)))
{
  hide *;
  reveal inv, canCloseRegisteredCreation, closeRegisteredCreation, replaceSaved, noSavedCreation, alwaysSavedRegisteredIsRegistered, alwaysRegisteredIdentityApproved, namesRegistration, deployment, stepSavedTerminal, stepRefusalOnlyUnregistered, stepWritePreservesRegistry;
  if inv(s) && canCloseRegisteredCreation(s, savedId) {
    var v := savedCreation(s, savedId);
    var updated := v.(state := SavedState.SavedRegistered);
    var after := closeRegisteredCreation(s, savedId);
    SavedDistinct(s);
    SavedCreationInOrMissing(s, savedId);
    assert v in s.savedCreations && v.id == savedId;
    SavedReplacePreserves(s, after, v, updated);
    DeploymentsSamePreserves(s, after, "closeRegisteredCreation");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestsSamePreserves(s, after);
    forall o | o in s.savedCreations
      ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
    {
      if o.id == savedId {
        assert o == v && updated in after.savedCreations;
      } else {
        assert o in after.savedCreations;
      }
    }
    forall n | n in after.savedCreations && n.state.SavedRefused?
      ensures !(exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
    {
      assert n in s.savedCreations && n.id != savedId;
      var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
      forall o | o in s.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
        var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
        assert i == j;
      }
    }
  }
}

lemma endSavedRefused_ensures(s: Snapshots, savedId: int, requestId: int)
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysSavedCreationsWellFormed(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysAtMostThreeWaiting(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysRepeatsNameASavedCreation(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysSavedRegisteredIsRegistered(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysObservationScoped(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysSameAssetAcrossPurposes(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysRegisteredIdentityApproved(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysOneMonthStartPerVault(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> alwaysPledgesOfTheOrdinaryVault(endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepSavedTerminal(s, endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepRepeatsActAsTheSaver(s, endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepRefusalOnlyUnregistered(s, endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepRegistrationIsImmutable(s, endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepWritePreservesRegistry(s, "endSavedRefused", endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepOrdinaryObservationMonotonic(s, "endSavedRefused", endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepPrivateObservationMonotonic(s, "endSavedRefused", endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepMonthStartsNeverChange(s, endSavedRefused(s, savedId, requestId)))
  ensures (inv(s) ==> canEndSavedRefused(s, savedId, requestId) ==> stepStoredPledgesNeverDropped(s, endSavedRefused(s, savedId, requestId)))
{
  hide *;
  reveal inv, canEndSavedRefused, endSavedRefused, replaceSaved, noSavedCreation, alwaysSavedRegisteredIsRegistered, alwaysRegisteredIdentityApproved, namesRegistration, deployment, stepSavedTerminal, stepRefusalOnlyUnregistered, stepWritePreservesRegistry;
  if inv(s) && canEndSavedRefused(s, savedId, requestId) {
    var v := savedCreation(s, savedId);
    var updated := v.(state := SavedState.SavedRefused);
    var after := endSavedRefused(s, savedId, requestId);
    SavedDistinct(s);
    SavedCreationInOrMissing(s, savedId);
    assert v in s.savedCreations && v.id == savedId;
    SavedReplacePreserves(s, after, v, updated);
    DeploymentsSamePreserves(s, after, "endSavedRefused");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestsSamePreserves(s, after);
    forall o | o in s.savedCreations
      ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
    {
      if o.id == savedId {
        assert o == v && updated in after.savedCreations;
      } else {
        assert o in after.savedCreations;
      }
    }
    forall n | n in after.savedCreations && n.state.SavedRefused? && (exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
      ensures !namesRegistration(after, n)
    {
      if n != updated {
        assert n in s.savedCreations && n.id != savedId;
        var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
        var o :| o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?;
        var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
        assert i == j;
      }
    }
  }
}

lemma saveCreation_ensures(s: Snapshots, requestId: int, savedId: int, now: int)
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysSavedCreationsWellFormed(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysAtMostThreeWaiting(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysRepeatsNameASavedCreation(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysSavedRegisteredIsRegistered(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysObservationScoped(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysSameAssetAcrossPurposes(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysRegisteredIdentityApproved(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysOneMonthStartPerVault(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysMonthStartsOfTheOrdinaryVault(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> alwaysPledgesOfTheOrdinaryVault(saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepSavedTerminal(s, saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepRepeatsActAsTheSaver(s, saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepRefusalOnlyUnregistered(s, saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepRegistrationIsImmutable(s, saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepWritePreservesRegistry(s, "saveCreation", saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepOrdinaryObservationMonotonic(s, "saveCreation", saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepPrivateObservationMonotonic(s, "saveCreation", saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepMonthStartsNeverChange(s, saveCreation(s, requestId, savedId, now)))
  ensures (inv(s) ==> canSaveCreation(s, requestId, savedId, now) ==> stepStoredPledgesNeverDropped(s, saveCreation(s, requestId, savedId, now)))
{
  hide *;
  reveal inv, canSaveCreation, saveCreation, updateRequest, replaceSaved, noRequest, noSavedCreation, savedLimit, savedRetrySeconds, alwaysSavedRegisteredIsRegistered, alwaysRegisteredIdentityApproved, namesRegistration, deployment, stepSavedTerminal, stepRefusalOnlyUnregistered, stepWritePreservesRegistry;
  if inv(s) && canSaveCreation(s, requestId, savedId, now) {
    var r := requestRow(s, requestId);
    var existing := savedFor(s, r.network, r.tx);
    var stores := waitingCount(s) < savedLimit && (existing.id == 0 || existing.state.SavedExpired?);
    var waiting := SavedCreation((if existing.id > 0 then existing.id else savedId), r.purpose, r.network, r.tx, r.expected, r.actor, SavedState.SavedWaiting, 0, now + savedRetrySeconds, now, 0);
    var after := saveCreation(s, requestId, savedId, now);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedDistinct(s);
    SavedForInOrMissing(s, r.network, r.tx);
    DeploymentsSamePreserves(s, after, "saveCreation");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    if !stores {
      SavedListSamePreserves(s, after);
      SavedRegSamePreserves(s, after);
      forall id ensures savedCreation(after, id) == savedCreation(s, id) {
        SavedCreationBridge(s, id);
        SavedCreationBridge(after, id);
      }
      RequestUpdatePreserves(s, after, r, r.(saveAttempted := true));
    } else if existing.id > 0 {
      assert existing in s.savedCreations;
      SavedCreationInOrMissing(s, existing.id);
      SavedReplacePreserves(s, after, existing, waiting);
      RequestUpdatePreserves(s, after, r, r.(saveAttempted := true));
      forall o | o in s.savedCreations
        ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
      {
        if o.id == existing.id {
          assert o == existing && waiting in after.savedCreations;
        } else {
          assert o in after.savedCreations;
        }
      }
      forall n | n in after.savedCreations && n.state.SavedRefused?
        ensures !(exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
      {
        assert n in s.savedCreations && n.id != existing.id;
        var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
        forall o | o in s.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
          var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
          assert i == j;
        }
      }
    } else {
      SavedAppendPreserves(s, after, waiting);
      RequestUpdatePreserves(s, after, r, r.(saveAttempted := true));
      forall n | n in after.savedCreations && n.state.SavedRefused?
        ensures !(exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
      {
        assert n in s.savedCreations;
        var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
        forall o | o in s.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
          var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
          assert i == j;
        }
      }
    }
  }
}

lemma RepeatAuthorizedRequests(s: Snapshots, claimed: Snapshots, begun: Snapshots, after: Snapshots, savedId: int, requestId: int, v: SavedCreation)
  requires alwaysRepeatsNameASavedCreation(s)
  requires alwaysSavedCreationsWellFormed(s)
  requires v in s.savedCreations && v == savedCreation(s, savedId)
  requires requestId > 0 && requestRow(s, requestId).id == 0
  requires claimed.requests == s.requests
  requires after.savedCreations == claimed.savedCreations && begun.savedCreations == claimed.savedCreations
  requires forall id :: savedCreation(s, id).id > 0 ==> savedCreation(after, id).id > 0
  requires savedCreation(after, savedId).id == savedId
  requires begun == beginRegistration(claimed, requestId, v.purpose, v.tx, v.network, v.expected, v.actor, true)
  requires after == updateRequest(requestRow(begun, requestId).(repeatOf := savedId), begun)
  ensures alwaysRepeatsNameASavedCreation(after)
  ensures stepRepeatsActAsTheSaver(s, after)
  ensures forall r :: r in after.requests ==> r.phase.ReadyAppend? ==> r in s.requests
{
  hide *;
  reveal beginRegistration, updateRequest, firstReadPhase, noRequest, stepRepeatsActAsTheSaver;
  RequestsDistinct(s);
  SavedDistinct(s);
  RequestRowInOrMissing(s, requestId);
  var binding := deployment(claimed, v.purpose).registration;
  var existing := registered(binding) && binding.tx == v.tx && binding.identity.network == v.network;
  var phase := if existing then firstReadPhase(binding.identity) else if registered(binding) then RequestPhase.RequestDone else RequestPhase.ReadyRegistration;
  var added := noRequest.(id := requestId, purpose := v.purpose, phase := phase, result := (if phase.RequestDone? then RequestResult.RegistrationConflict else RequestResult.NoResult), http := (if phase.RequestDone? then 409 else 0), capture := claimed.revision.number, expected := v.expected, tx := v.tx, network := v.network, actor := v.actor, registration := (if existing then binding else noRegistration));
  assert begun.requests == s.requests + [added];
  assert |begun.requests| == |s.requests| + 1;
  forall id ensures savedCreation(begun, id) == savedCreation(after, id) {
    SavedCreationBridge(begun, id);
    SavedCreationBridge(after, id);
  }
  RequestsUniqueFromDistinct(begun);
  RequestRowFound(begun, |s.requests|);
  assert requestRow(begun, requestId) == added;
  var repeated := added.(repeatOf := savedId);
  assert |after.requests| == |begun.requests|;
  forall i | 0 <= i < |after.requests|
    ensures i < |s.requests| ==> after.requests[i] == s.requests[i]
    ensures i == |s.requests| ==> after.requests[i] == repeated
  { }
  assert repeated.source.RegistrationRequest? && repeated.actor == v.actor > 0;
  RequestsUniqueFromDistinct(after);
  forall r | r in after.requests
    ensures !((r.repeatOf > 0) && (requestRow(s, r.id).id == 0)) || (r.actor > 0 && r.actor == savedCreation(s, r.repeatOf).actor)
  {
    var i :| 0 <= i < |after.requests| && after.requests[i] == r;
    if i < |s.requests| {
      assert r == s.requests[i];
      RequestRowFound(s, i);
    } else {
      assert r == repeated;
    }
  }
}

lemma repeatSaved_ensures(s: Snapshots, savedId: int, requestId: int, now: int, authorized: bool)
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysSavedCreationsWellFormed(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysAtMostThreeWaiting(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysRepeatsNameASavedCreation(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysSavedRegisteredIsRegistered(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysObservationScoped(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysSameAssetAcrossPurposes(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysRegisteredIdentityApproved(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysOneMonthStartPerVault(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysMonthStartsOfTheOrdinaryVault(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> alwaysPledgesOfTheOrdinaryVault(repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepSavedTerminal(s, repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepRepeatsActAsTheSaver(s, repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepRefusalOnlyUnregistered(s, repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepRegistrationIsImmutable(s, repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepWritePreservesRegistry(s, "repeatSaved", repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepOrdinaryObservationMonotonic(s, "repeatSaved", repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepPrivateObservationMonotonic(s, "repeatSaved", repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepMonthStartsNeverChange(s, repeatSaved(s, savedId, requestId, now, authorized)))
  ensures (inv(s) ==> canRepeatSaved(s, savedId, requestId, now, authorized) ==> stepStoredPledgesNeverDropped(s, repeatSaved(s, savedId, requestId, now, authorized)))
{
  hide *;
  reveal inv, canRepeatSaved, repeatSaved, savedDue, replaceSaved, beginRegistration, updateRequest, noSavedCreation, alwaysSavedRegisteredIsRegistered, alwaysRegisteredIdentityApproved, namesRegistration, deployment, stepSavedTerminal, stepRefusalOnlyUnregistered, stepWritePreservesRegistry;
  if inv(s) && canRepeatSaved(s, savedId, requestId, now, authorized) {
    var v := savedCreation(s, savedId);
    var updated := v.(attempts := v.attempts + 1, nextAt := now + (if v.attempts < savedFastAttempts then savedRetrySeconds else savedSlowRetrySeconds), lastRepeat := (if authorized then requestId else 0));
    var claimed := replaceSaved(updated, s);
    var begun := beginRegistration(claimed, requestId, v.purpose, v.tx, v.network, v.expected, v.actor, authorized);
    var after := repeatSaved(s, savedId, requestId, now, authorized);
    SavedDistinct(s);
    SavedCreationInOrMissing(s, savedId);
    assert v in s.savedCreations && v.id == savedId;
    SavedReplacePreserves(s, after, v, updated);
    DeploymentsSamePreserves(s, after, "repeatSaved");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    if authorized {
      RepeatAuthorizedRequests(s, claimed, begun, after, savedId, requestId, v);
    } else {
      RequestsSamePreserves(s, after);
    }
    forall o | o in s.savedCreations
      ensures (exists n :: (n in after.savedCreations && n.id == o.id && n.network == o.network && n.tx == o.tx && (!((o.state.SavedRegistered? || o.state.SavedRefused?)) || (n == o)) && (!((o.state.SavedExpired? && !n.state.SavedExpired?)) || (n.state.SavedWaiting? && n.attempts == 0))))
    {
      if o.id == savedId {
        assert o == v && updated in after.savedCreations;
      } else {
        assert o in after.savedCreations;
      }
    }
    forall n | n in after.savedCreations && n.state.SavedRefused?
      ensures !(exists o :: o in s.savedCreations && o.id == n.id && o.state.SavedWaiting?)
    {
      assert n in s.savedCreations && n.id != savedId;
      var i :| 0 <= i < |s.savedCreations| && s.savedCreations[i] == n;
      forall o | o in s.savedCreations && o.id == n.id ensures !o.state.SavedWaiting? {
        var j :| 0 <= j < |s.savedCreations| && s.savedCreations[j] == o;
        assert i == j;
      }
    }
  }
}

lemma pinGenesis_ensures(s: Snapshots, requestId: int, pinnedRoot: string)
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysSavedCreationsWellFormed(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysAtMostThreeWaiting(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysRepeatsNameASavedCreation(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysSavedRegisteredIsRegistered(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysObservationScoped(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysSameAssetAcrossPurposes(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysRegisteredIdentityApproved(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysOneMonthStartPerVault(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepSavedTerminal(s, pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepRepeatsActAsTheSaver(s, pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepRefusalOnlyUnregistered(s, pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepRegistrationIsImmutable(s, pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepWritePreservesRegistry(s, "pinGenesis", pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "pinGenesis", pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepPrivateObservationMonotonic(s, "pinGenesis", pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepMonthStartsNeverChange(s, pinGenesis(s, requestId, pinnedRoot)))
  ensures (inv(s) ==> canPinGenesis(s, requestId) ==> stepStoredPledgesNeverDropped(s, pinGenesis(s, requestId, pinnedRoot)))
{
  hide *;
  reveal inv, canPinGenesis, pinGenesis, finish, updateRequest, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canPinGenesis(s, requestId) {
    var r := requestRow(s, requestId);
    var after := pinGenesis(s, requestId, pinnedRoot);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "pinGenesis");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    if pinnedRoot == "" {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    } else {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.ReadyGenesisProbe, genesisRoot := pinnedRoot));
    }
  }
}

lemma readTotals_ensures(s: Snapshots, requestId: int, observation: Observation, finalized: bool)
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysSavedCreationsWellFormed(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysAtMostThreeWaiting(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysRepeatsNameASavedCreation(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysSavedRegisteredIsRegistered(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysObservationScoped(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysSameAssetAcrossPurposes(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysRegisteredIdentityApproved(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysOneMonthStartPerVault(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepSavedTerminal(s, readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepRepeatsActAsTheSaver(s, readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepRefusalOnlyUnregistered(s, readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepRegistrationIsImmutable(s, readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepWritePreservesRegistry(s, "readTotals", readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "readTotals", readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepPrivateObservationMonotonic(s, "readTotals", readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepMonthStartsNeverChange(s, readTotals(s, requestId, observation, finalized)))
  ensures (inv(s) ==> canReadTotals(s, requestId) ==> stepStoredPledgesNeverDropped(s, readTotals(s, requestId, observation, finalized)))
{
  hide *;
  reveal inv, canReadTotals, readTotals, finish, updateRequest, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canReadTotals(s, requestId) {
    var r := requestRow(s, requestId);
    var after := readTotals(s, requestId, observation, finalized);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "readTotals");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    if finalized && exactObservation(observation, r) {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.ReadyPrior, incoming := observation.(legacyServiceFees := settlement__money_zero)));
    } else {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    }
  }
}

lemma observationFails_ensures(s: Snapshots, requestId: int)
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysSavedCreationsWellFormed(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysAtMostThreeWaiting(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysRepeatsNameASavedCreation(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysSavedRegisteredIsRegistered(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysObservationScoped(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysSameAssetAcrossPurposes(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysRegisteredIdentityApproved(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysOneMonthStartPerVault(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepSavedTerminal(s, observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepRepeatsActAsTheSaver(s, observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepRefusalOnlyUnregistered(s, observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepRegistrationIsImmutable(s, observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepWritePreservesRegistry(s, "observationFails", observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "observationFails", observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepPrivateObservationMonotonic(s, "observationFails", observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepMonthStartsNeverChange(s, observationFails(s, requestId)))
  ensures (inv(s) ==> canObservationFails(s, requestId) ==> stepStoredPledgesNeverDropped(s, observationFails(s, requestId)))
{
  hide *;
  reveal inv, canObservationFails, observationFails, finish, updateRequest, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canObservationFails(s, requestId) {
    var r := requestRow(s, requestId);
    var after := observationFails(s, requestId);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "observationFails");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
  }
}

lemma beginRead_ensures(s: Snapshots, requestId: int, purpose: Purpose)
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysSavedCreationsWellFormed(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysAtMostThreeWaiting(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysRepeatsNameASavedCreation(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysSavedRegisteredIsRegistered(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysObservationScoped(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysSameAssetAcrossPurposes(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysRegisteredIdentityApproved(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysOneMonthStartPerVault(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysMonthStartsOfTheOrdinaryVault(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> alwaysPledgesOfTheOrdinaryVault(beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepSavedTerminal(s, beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepRepeatsActAsTheSaver(s, beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepRefusalOnlyUnregistered(s, beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepRegistrationIsImmutable(s, beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepWritePreservesRegistry(s, "beginRead", beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepOrdinaryObservationMonotonic(s, "beginRead", beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepPrivateObservationMonotonic(s, "beginRead", beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepMonthStartsNeverChange(s, beginRead(s, requestId, purpose)))
  ensures (inv(s) ==> canBeginRead(s, requestId, purpose) ==> stepStoredPledgesNeverDropped(s, beginRead(s, requestId, purpose)))
{
  hide *;
  reveal inv, canBeginRead, beginRead, beginBoundRead, firstReadPhase, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canBeginRead(s, requestId, purpose) {
    var after := beginRead(s, requestId, purpose);
    var binding := deployment(s, purpose).registration;
    var added := noRequest.(id := requestId, purpose := purpose, source := Source.ScheduledRead, phase := firstReadPhase(binding.identity), capture := s.revision.number, registration := binding);
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "beginRead");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestAppendPreserves(s, after, added);
  }
}

lemma beginRecovery_ensures(s: Snapshots, requestId: int, trustedMain: bool)
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysSavedCreationsWellFormed(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysAtMostThreeWaiting(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysRepeatsNameASavedCreation(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysSavedRegisteredIsRegistered(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysObservationScoped(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysSameAssetAcrossPurposes(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysRegisteredIdentityApproved(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysOneMonthStartPerVault(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysMonthStartsOfTheOrdinaryVault(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> alwaysPledgesOfTheOrdinaryVault(beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepSavedTerminal(s, beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepRepeatsActAsTheSaver(s, beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepRefusalOnlyUnregistered(s, beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepRegistrationIsImmutable(s, beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepWritePreservesRegistry(s, "beginRecovery", beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepOrdinaryObservationMonotonic(s, "beginRecovery", beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepPrivateObservationMonotonic(s, "beginRecovery", beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepMonthStartsNeverChange(s, beginRecovery(s, requestId, trustedMain)))
  ensures (inv(s) ==> canBeginRecovery(s, requestId, trustedMain) ==> stepStoredPledgesNeverDropped(s, beginRecovery(s, requestId, trustedMain)))
{
  hide *;
  reveal inv, canBeginRecovery, canBeginRead, beginRecovery, beginBoundRead, firstReadPhase, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canBeginRecovery(s, requestId, trustedMain) {
    var after := beginRecovery(s, requestId, trustedMain);
    var binding := deployment(s, Purpose.Ordinary).registration;
    var added := noRequest.(id := requestId, purpose := Purpose.Ordinary, source := Source.RecoveryRead, phase := firstReadPhase(binding.identity), capture := s.revision.number, registration := binding);
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "beginRecovery");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    RequestAppendPreserves(s, after, added);
  }
}

lemma checkGenesis_ensures(s: Snapshots, requestId: int, seenRoot: string)
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysSavedCreationsWellFormed(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysAtMostThreeWaiting(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysRepeatsNameASavedCreation(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysSavedRegisteredIsRegistered(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysObservationScoped(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysSameAssetAcrossPurposes(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysRegisteredIdentityApproved(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysOneMonthStartPerVault(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepSavedTerminal(s, checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepRepeatsActAsTheSaver(s, checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepRefusalOnlyUnregistered(s, checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepRegistrationIsImmutable(s, checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepWritePreservesRegistry(s, "checkGenesis", checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "checkGenesis", checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepPrivateObservationMonotonic(s, "checkGenesis", checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepMonthStartsNeverChange(s, checkGenesis(s, requestId, seenRoot)))
  ensures (inv(s) ==> canCheckGenesis(s, requestId) ==> stepStoredPledgesNeverDropped(s, checkGenesis(s, requestId, seenRoot)))
{
  hide *;
  reveal inv, canCheckGenesis, checkGenesis, finish, updateRequest, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canCheckGenesis(s, requestId) {
    var r := requestRow(s, requestId);
    var checked := r.(genesisProbes := 1);
    var after := checkGenesis(s, requestId, seenRoot);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "checkGenesis");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    if seenRoot != r.genesisRoot {
      RequestUpdatePreserves(s, after, r, checked.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    } else {
      RequestUpdatePreserves(s, after, r, checked.(phase := RequestPhase.ReadyTotals, genesisConfirmed := true));
    }
  }
}

lemma readPrior_ensures(s: Snapshots, requestId: int)
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysSavedCreationsWellFormed(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysAtMostThreeWaiting(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysRepeatsNameASavedCreation(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysSavedRegisteredIsRegistered(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysObservationScoped(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysSameAssetAcrossPurposes(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysRegisteredIdentityApproved(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysOneMonthStartPerVault(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepSavedTerminal(s, readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepRepeatsActAsTheSaver(s, readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepRefusalOnlyUnregistered(s, readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepRegistrationIsImmutable(s, readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepWritePreservesRegistry(s, "readPrior", readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "readPrior", readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepPrivateObservationMonotonic(s, "readPrior", readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepMonthStartsNeverChange(s, readPrior(s, requestId)))
  ensures (inv(s) ==> canReadPrior(s, requestId) ==> stepStoredPledgesNeverDropped(s, readPrior(s, requestId)))
{
  hide *;
  reveal inv, canReadPrior, readPrior, finish, updateRequest, noRequest, alwaysRegisteredIdentityApproved, stepWritePreservesRegistry;
  if inv(s) && canReadPrior(s, requestId) {
    var r := requestRow(s, requestId);
    var prior := deployment(s, r.purpose).observation;
    var after := readPrior(s, requestId);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    SavedListSamePreserves(s, after);
    SavedRegSamePreserves(s, after);
    DeploymentsSamePreserves(s, after, "readPrior");
    MonthStartsSamePreserves(s, after);
    PledgesSamePreserves(s, after);
    forall id ensures savedCreation(after, id) == savedCreation(s, id) {
      SavedCreationBridge(s, id);
      SavedCreationBridge(after, id);
    }
    if prior.exists_ && settlement__money_compareAmounts(r.incoming.block, prior.block) < 0 {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationOlder, http := 200));
    } else if prior.exists_ && (r.incoming.identity != prior.identity || !countersAdvance(r.incoming.counters, prior.counters)) {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    } else {
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.ReadyWrite));
    }
  }
}

lemma write_ensures(s: Snapshots, requestId: int, reply: WriteReply)
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysSavedCreationsWellFormed(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysAtMostThreeWaiting(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysRepeatsNameASavedCreation(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysSavedRegisteredIsRegistered(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysObservationScoped(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysSameAssetAcrossPurposes(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysRegisteredIdentityApproved(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysOneMonthStartPerVault(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysMonthStartsOfTheOrdinaryVault(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> alwaysPledgesOfTheOrdinaryVault(write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepSavedTerminal(s, write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepRepeatsActAsTheSaver(s, write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepRefusalOnlyUnregistered(s, write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepRegistrationIsImmutable(s, write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepWritePreservesRegistry(s, "write", write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepOrdinaryObservationMonotonic(s, "write", write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepPrivateObservationMonotonic(s, "write", write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepMonthStartsNeverChange(s, write(s, requestId, reply)))
  ensures (inv(s) ==> canWrite(s, requestId) ==> stepStoredPledgesNeverDropped(s, write(s, requestId, reply)))
{
  hide *;
  reveal inv, canWrite, write, finish, updateRequest, deployment, setDeployment, registered, noRequest, writable, isOlder, observationMonotonic, alwaysObservationScoped, rowScoped, alwaysSameAssetAcrossPurposes, alwaysRegisteredIdentityApproved, stepRegistrationIsImmutable, stepWritePreservesRegistry, stepOrdinaryObservationMonotonic, stepPrivateObservationMonotonic, settlement__monthPledges_acceptedRead, settlement__money_zero;
  if inv(s) && canWrite(s, requestId) {
    var r := requestRow(s, requestId);
    var row := deployment(s, r.purpose);
    var prior := row.observation;
    var pledgeRead := if r.purpose.Ordinary? then settlement__monthPledges_acceptedRead(r.incoming.monthPledges) else settlement__monthPledges_PledgeRead.PledgesNotRead;
    var nextObs := r.incoming.(legacyServiceFees := (if prior.exists_ then prior.legacyServiceFees else settlement__money_zero), monthPledges := pledgeRead);
    var staged := setDeployment(r.purpose, row.(observation := nextObs), s);
    var withStart := if r.purpose.Ordinary? then withMonthStart(nextObs, staged) else staged;
    var committed := withMonthPledges(nextObs, withStart);
    var after := write(s, requestId, reply);
    RequestRowInOrMissing(s, requestId);
    assert r in s.requests && r.id == requestId;
    if reply.WriteFailed? {
      SavedListSamePreserves(s, after);
      SavedRegSamePreserves(s, after);
      forall id ensures savedCreation(after, id) == savedCreation(s, id) {
        SavedCreationBridge(s, id);
        SavedCreationBridge(after, id);
      }
      DeploymentsSamePreserves(s, after, "write");
      MonthStartsSamePreserves(s, after);
      PledgesSamePreserves(s, after);
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    } else if writable(r.incoming, prior) {
      MonthStartsSamePreserves(s, staged);
      PledgesSamePreserves(s, staged);
      if r.purpose.Ordinary? {
        WithMonthStartPreserves(nextObs, staged);
        PledgesSamePreserves(staged, withStart);
      }
      WithMonthPledgesPreserves(nextObs, withStart);
      MonthStartsSamePreserves(withStart, committed);
      SavedListSamePreserves(s, after);
      SavedRegSamePreserves(s, after);
      forall id ensures savedCreation(after, id) == savedCreation(s, id) {
        SavedCreationBridge(s, id);
        SavedCreationBridge(after, id);
      }
      MonthStartsSamePreserves(committed, after);
      assert stepMonthStartsNeverChange(s, after) by { reveal stepMonthStartsNeverChange; }
      PledgesSamePreserves(committed, after);
      assert stepStoredPledgesNeverDropped(s, after) by {
        reveal stepStoredPledgesNeverDropped;
      }
      if reply.WriteReplyLost? {
        RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationReplyLost, http := 503));
      } else {
        RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationStored, http := 200));
      }
    } else if reply.WriteAcknowledged? && isOlder(r.incoming, prior) {
      SavedListSamePreserves(s, after);
      SavedRegSamePreserves(s, after);
      forall id ensures savedCreation(after, id) == savedCreation(s, id) {
        SavedCreationBridge(s, id);
        SavedCreationBridge(after, id);
      }
      DeploymentsSamePreserves(s, after, "write");
      MonthStartsSamePreserves(s, after);
      PledgesSamePreserves(s, after);
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationOlder, http := 200));
    } else {
      SavedListSamePreserves(s, after);
      SavedRegSamePreserves(s, after);
      forall id ensures savedCreation(after, id) == savedCreation(s, id) {
        SavedCreationBridge(s, id);
        SavedCreationBridge(after, id);
      }
      DeploymentsSamePreserves(s, after, "write");
      MonthStartsSamePreserves(s, after);
      PledgesSamePreserves(s, after);
      RequestUpdatePreserves(s, after, r, r.(phase := RequestPhase.RequestDone, result := RequestResult.ObservationUnavailable, http := 503));
    }
  }
}
