lemma SetUnionMember(a: seq<int>, b: seq<int>, x: int)
  ensures x in (a + ProofLib.Filter((set_x: int) => !((set_x in a)), b)) <==> (x in a || x in b)
{
  ProofLib.FilterMember((set_x: int) => !((set_x in a)), b, x);
}

lemma SetUnionSingleton(a: seq<int>, x: int)
  requires !(x in a)
  ensures a + ProofLib.Filter((set_x: int) => !((set_x in a)), [x]) == a + [x]
{
  ProofLib.FilterCons((set_x: int) => !((set_x in a)), [x]);
  ProofLib.FilterNil((set_x: int) => !((set_x in a)), [x][1..]);
}

lemma SetIntersectEmptyIff(a: seq<int>, b: seq<int>)
  ensures (|ProofLib.Filter((set_x: int) => (set_x in b), a)| == 0) <==> (forall x :: x in a ==> !(x in b))
{
  ProofLib.FilterNone((set_x: int) => (set_x in b), a);
  if forall x :: x in a ==> !(x in b) {
    assert forall i :: 0 <= i < |a| ==> a[i] in a;
  }
  if |ProofLib.Filter((set_x: int) => (set_x in b), a)| == 0 {
    forall x | x in a
      ensures !(x in b)
    {
      var i :| 0 <= i < |a| && a[i] == x;
    }
  }
}

lemma FilterConcat<T>(p: T -> bool, a: seq<T>, b: seq<T>)
  ensures ProofLib.Filter(p, a + b) == ProofLib.Filter(p, a) + ProofLib.Filter(p, b)
  decreases |a|
{
  if |a| == 0 {
    ProofLib.FilterNil(p, a);
    assert a + b == b;
  } else {
    ProofLib.FilterCons(p, a + b);
    ProofLib.FilterCons(p, a);
    assert (a + b)[1..] == a[1..] + b;
    FilterConcat(p, a[1..], b);
  }
}

lemma SetsDisjointFilter(r: ReadAhead)
  ensures alwaysSetsDisjoint(r) == ((((|ProofLib.Filter((set_x: int) => (set_x in r.warmed), r.reading)| == 0) && (|ProofLib.Filter((set_x: int) => (set_x in r.dropped), r.reading)| == 0)) && (|ProofLib.Filter((set_x: int) => (set_x in r.dropped), r.warmed)| == 0)) && !((exists set_x :: set_x in r.empty && !((set_x in r.warmed)))))
{
}

lemma EachPageReadOnceFilter(r: ReadAhead)
  ensures alwaysEachPageReadOnce(r) == ((((|ProofLib.Filter((set_x: int) => (set_x in r.live), r.taken)| == 0) && !((exists set_x :: set_x in r.taken && !((set_x in r.empty))))) && (|ProofLib.Filter((set_x: int) => (set_x in r.empty), r.live)| == 0)) && (|ProofLib.Filter((set_x: int) => (set_x in r.live), r.reading)| == 0))
{
}

lemma DecidedOutcomesFilter(r: ReadAhead)
  ensures decidedOutcomes(r) == ProofLib.Filter((set_x: int) => !((set_x in [r.failedAt])), (r.taken + ProofLib.Filter((set_x: int) => !((set_x in r.taken)), r.live)))
{
}

lemma StartReadShape(r: ReadAhead, position: int)
  ensures startRead(r, position).reading == (r.reading + ProofLib.Filter((set_x: int) => !((set_x in r.reading)), [position]))
{
}

lemma FinishReadShape(r: ReadAhead, position: int, isEmpty: bool)
  ensures finishRead(r, position, isEmpty).reading == ProofLib.Filter((set_x: int) => !((set_x in [position])), r.reading)
  ensures finishRead(r, position, isEmpty).warmed == (r.warmed + ProofLib.Filter((set_x: int) => !((set_x in r.warmed)), [position]))
  ensures finishRead(r, position, isEmpty).empty == (if isEmpty then (r.empty + ProofLib.Filter((set_x: int) => !((set_x in r.empty)), [position])) else r.empty)
{
}

lemma DropReadShape(r: ReadAhead, position: int)
  ensures dropRead(r, position).reading == ProofLib.Filter((set_x: int) => !((set_x in [position])), r.reading)
  ensures dropRead(r, position).dropped == (r.dropped + ProofLib.Filter((set_x: int) => !((set_x in r.dropped)), [position]))
{
}

lemma TakeWarmedShape(r: ReadAhead)
  ensures takeWarmed(r).taken == (r.taken + ProofLib.Filter((set_x: int) => !((set_x in r.taken)), [r.at]))
{
}

lemma ReadLiveShape(r: ReadAhead)
  ensures readLive(r).live == (r.live + ProofLib.Filter((set_x: int) => !((set_x in r.live)), [r.at]))
{
}

lemma FailReadShape(r: ReadAhead)
  ensures failRead(r).live == (r.live + ProofLib.Filter((set_x: int) => !((set_x in r.live)), [r.at]))
{
}

lemma DecidedMember(r: ReadAhead, x: int)
  ensures x in decidedOutcomes(r) <==> (x != r.failedAt && (x in r.taken || x in r.live))
{
  DecidedOutcomesFilter(r);
  var u := r.taken + ProofLib.Filter((set_x: int) => !((set_x in r.taken)), r.live);
  ProofLib.FilterMember((set_x: int) => !((set_x in [r.failedAt])), u, x);
  SetUnionMember(r.taken, r.live, x);
}

lemma StartedMember(r: ReadAhead, x: int)
  ensures x in started(r) <==> (x in r.reading || x in r.warmed || x in r.dropped)
{
  ProofLib.FilterMember((set_x: int) => !((set_x in r.reading)), r.warmed, x);
  ProofLib.FilterMember((set_x: int) => !((set_x in (r.reading + Std.Collections.Seq.Filter((set_x: int) => !((set_x in r.reading)), r.warmed)))), r.dropped, x);
}

lemma startRead_ensures(r: ReadAhead, position: int)
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysConcurrencyInRange(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysReadsWithinConcurrency(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysReadsWithinWindow(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysNoReadsWhenFinished(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysSetsDisjoint(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysNoReadAheadWithoutConcurrency(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysEachPageReadOnce(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysOnlyTheLoopReportsAFailure(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysDecidedInOrder(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> alwaysAllReadDecidesEvery(startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> stepNoReadStartsAfterADrop(r, "startRead", startRead(r, position)))
  ensures (inv(r) ==> canStartRead(r, position) ==> stepReadAheadDecidesNothing(r, "startRead", startRead(r, position)))
{
  if inv(r) && canStartRead(r, position) {
    var after := startRead(r, position);
    StartReadShape(r, position);
    StartedMember(r, position);
    SetUnionSingleton(r.reading, position);
    assert after.reading == r.reading + [position];
    SetsDisjointFilter(r);
    SetsDisjointFilter(after);
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.reading, r.warmed);
    SetIntersectEmptyIff(after.reading, after.warmed);
    SetIntersectEmptyIff(r.reading, r.dropped);
    SetIntersectEmptyIff(after.reading, after.dropped);
    SetIntersectEmptyIff(r.reading, r.live);
    SetIntersectEmptyIff(after.reading, after.live);
  }
}

lemma finishRead_ensures(r: ReadAhead, position: int, isEmpty: bool)
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysConcurrencyInRange(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysReadsWithinConcurrency(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysReadsWithinWindow(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysNoReadsWhenFinished(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysSetsDisjoint(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysNoReadAheadWithoutConcurrency(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysEachPageReadOnce(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysOnlyTheLoopReportsAFailure(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysDecidedInOrder(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> alwaysAllReadDecidesEvery(finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> stepNoReadStartsAfterADrop(r, "finishRead", finishRead(r, position, isEmpty)))
  ensures (inv(r) ==> canFinishRead(r, position, isEmpty) ==> stepReadAheadDecidesNothing(r, "finishRead", finishRead(r, position, isEmpty)))
{
  if inv(r) && canFinishRead(r, position, isEmpty) {
    var after := finishRead(r, position, isEmpty);
    FinishReadShape(r, position, isEmpty);
    SetsDisjointFilter(r);
    SetsDisjointFilter(after);
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.reading, r.warmed);
    SetIntersectEmptyIff(r.reading, r.dropped);
    SetIntersectEmptyIff(r.warmed, r.dropped);
    SetIntersectEmptyIff(r.live, r.empty);
    SetIntersectEmptyIff(r.reading, r.live);
    forall x
      ensures x in after.reading <==> (x in r.reading && x != position)
      ensures x in after.warmed <==> (x in r.warmed || x == position)
      ensures x in after.empty <==> (x in r.empty || (isEmpty && x == position))
    {
      ProofLib.FilterMember((set_x: int) => !((set_x in [position])), r.reading, x);
      SetUnionMember(r.warmed, [position], x);
      if isEmpty {
        SetUnionMember(r.empty, [position], x);
      }
    }
    SetIntersectEmptyIff(after.reading, after.warmed);
    SetIntersectEmptyIff(after.reading, after.dropped);
    SetIntersectEmptyIff(after.warmed, after.dropped);
    SetIntersectEmptyIff(after.live, after.empty);
    SetIntersectEmptyIff(after.reading, after.live);
  }
}

lemma dropRead_ensures(r: ReadAhead, position: int)
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysConcurrencyInRange(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysReadsWithinConcurrency(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysReadsWithinWindow(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysNoReadsWhenFinished(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysSetsDisjoint(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysNoReadAheadWithoutConcurrency(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysEachPageReadOnce(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysOnlyTheLoopReportsAFailure(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysDecidedInOrder(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> alwaysAllReadDecidesEvery(dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> stepNoReadStartsAfterADrop(r, "dropRead", dropRead(r, position)))
  ensures (inv(r) ==> canDropRead(r, position) ==> stepReadAheadDecidesNothing(r, "dropRead", dropRead(r, position)))
{
  if inv(r) && canDropRead(r, position) {
    var after := dropRead(r, position);
    DropReadShape(r, position);
    SetsDisjointFilter(r);
    SetsDisjointFilter(after);
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.reading, r.warmed);
    SetIntersectEmptyIff(r.reading, r.dropped);
    SetIntersectEmptyIff(r.warmed, r.dropped);
    SetIntersectEmptyIff(r.reading, r.live);
    forall x
      ensures x in after.reading <==> (x in r.reading && x != position)
      ensures x in after.dropped <==> (x in r.dropped || x == position)
    {
      ProofLib.FilterMember((set_x: int) => !((set_x in [position])), r.reading, x);
      SetUnionMember(r.dropped, [position], x);
    }
    SetIntersectEmptyIff(after.reading, after.warmed);
    SetIntersectEmptyIff(after.reading, after.dropped);
    SetIntersectEmptyIff(after.warmed, after.dropped);
    SetIntersectEmptyIff(after.reading, after.live);
  }
}

lemma advance_ensures(r: ReadAhead)
  ensures (inv(r) ==> canAdvance(r) ==> alwaysConcurrencyInRange(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysReadsWithinConcurrency(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysReadsWithinWindow(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysNoReadsWhenFinished(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysSetsDisjoint(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysNoReadAheadWithoutConcurrency(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysEachPageReadOnce(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysOnlyTheLoopReportsAFailure(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysDecidedInOrder(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> alwaysAllReadDecidesEvery(advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> stepNoReadStartsAfterADrop(r, "advance", advance(r)))
  ensures (inv(r) ==> canAdvance(r) ==> stepReadAheadDecidesNothing(r, "advance", advance(r)))
{
  if inv(r) && canAdvance(r) {
    var after := advance(r);
    assert decidedOutcomes(after) == decidedOutcomes(r);
    assert !(after.at in decidedOutcomes(after));
  }
}

lemma takeWarmed_ensures(r: ReadAhead)
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysConcurrencyInRange(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysReadsWithinConcurrency(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysReadsWithinWindow(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysNoReadsWhenFinished(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysSetsDisjoint(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysNoReadAheadWithoutConcurrency(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysEachPageReadOnce(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysOnlyTheLoopReportsAFailure(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysDecidedInOrder(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> alwaysAllReadDecidesEvery(takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> stepNoReadStartsAfterADrop(r, "takeWarmed", takeWarmed(r)))
  ensures (inv(r) ==> canTakeWarmed(r) ==> stepReadAheadDecidesNothing(r, "takeWarmed", takeWarmed(r)))
{
  if inv(r) && canTakeWarmed(r) {
    var after := takeWarmed(r);
    TakeWarmedShape(r);
    DecidedMember(r, r.at);
    assert r.failedAt == 0;
    assert !(r.at in r.taken) && !(r.at in r.live);
    SetUnionSingleton(r.taken, r.at);
    assert after.taken == r.taken + [r.at];
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.taken, r.live);
    SetIntersectEmptyIff(r.live, r.empty);
    SetIntersectEmptyIff(after.taken, after.live);
    DecidedOutcomesFilter(r);
    DecidedOutcomesFilter(after);
    var pFail := (set_x: int) => !((set_x in [r.failedAt]));
    var restBefore := ProofLib.Filter((set_x: int) => !((set_x in r.taken)), r.live);
    var restAfter := ProofLib.Filter((set_x: int) => !((set_x in after.taken)), r.live);
    ProofLib.FilterSamePredicate((set_x: int) => !((set_x in r.taken)), (set_x: int) => !((set_x in after.taken)), r.live);
    assert restAfter == restBefore;
    FilterConcat(pFail, r.taken, restBefore);
    FilterConcat(pFail, after.taken, restAfter);
    ProofLib.FilterAppend(pFail, r.taken, r.at);
    assert |decidedOutcomes(after)| == |decidedOutcomes(r)| + 1;
    DecidedMember(after, r.at);
    forall p | p in decidedOutcomes(after)
      ensures p >= 1 && p <= after.at
    {
      DecidedMember(after, p);
    }
  }
}

lemma readLive_ensures(r: ReadAhead)
  ensures (inv(r) ==> canReadLive(r) ==> alwaysConcurrencyInRange(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysReadsWithinConcurrency(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysReadsWithinWindow(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysNoReadsWhenFinished(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysSetsDisjoint(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysNoReadAheadWithoutConcurrency(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysEachPageReadOnce(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysOnlyTheLoopReportsAFailure(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysDecidedInOrder(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> alwaysAllReadDecidesEvery(readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> stepNoReadStartsAfterADrop(r, "readLive", readLive(r)))
  ensures (inv(r) ==> canReadLive(r) ==> stepReadAheadDecidesNothing(r, "readLive", readLive(r)))
{
  if inv(r) && canReadLive(r) {
    var after := readLive(r);
    ReadLiveShape(r);
    DecidedMember(r, r.at);
    assert r.failedAt == 0;
    assert !(r.at in r.taken) && !(r.at in r.live);
    SetUnionSingleton(r.live, r.at);
    assert after.live == r.live + [r.at];
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.taken, r.live);
    SetIntersectEmptyIff(r.live, r.empty);
    SetIntersectEmptyIff(r.reading, r.live);
    SetIntersectEmptyIff(after.taken, after.live);
    SetIntersectEmptyIff(after.live, after.empty);
    SetIntersectEmptyIff(after.reading, after.live);
    DecidedOutcomesFilter(r);
    DecidedOutcomesFilter(after);
    var pFail := (set_x: int) => !((set_x in [r.failedAt]));
    var pNotTaken := (set_x: int) => !((set_x in r.taken));
    var restBefore := ProofLib.Filter(pNotTaken, r.live);
    ProofLib.FilterAppend(pNotTaken, r.live, r.at);
    assert r.taken + (restBefore + [r.at]) == (r.taken + restBefore) + [r.at];
    ProofLib.FilterAppend(pFail, r.taken + restBefore, r.at);
    assert |decidedOutcomes(after)| == |decidedOutcomes(r)| + 1;
    DecidedMember(after, r.at);
    forall p | p in decidedOutcomes(after)
      ensures p >= 1 && p <= after.at
    {
      DecidedMember(after, p);
    }
  }
}

lemma failRead_ensures(r: ReadAhead)
  ensures (inv(r) ==> canFailRead(r) ==> alwaysConcurrencyInRange(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysReadsWithinConcurrency(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysReadsWithinWindow(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysNoReadsWhenFinished(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysSetsDisjoint(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysNoReadAheadWithoutConcurrency(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysEachPageReadOnce(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysOnlyTheLoopReportsAFailure(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysDecidedInOrder(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> alwaysAllReadDecidesEvery(failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> stepNoReadStartsAfterADrop(r, "failRead", failRead(r)))
  ensures (inv(r) ==> canFailRead(r) ==> stepReadAheadDecidesNothing(r, "failRead", failRead(r)))
{
  if inv(r) && canFailRead(r) {
    var after := failRead(r);
    FailReadShape(r);
    DecidedMember(r, r.at);
    assert r.failedAt == 0;
    assert !(r.at in r.taken) && !(r.at in r.live);
    SetUnionSingleton(r.live, r.at);
    assert after.live == r.live + [r.at];
    EachPageReadOnceFilter(r);
    EachPageReadOnceFilter(after);
    SetIntersectEmptyIff(r.taken, r.live);
    SetIntersectEmptyIff(r.live, r.empty);
    SetIntersectEmptyIff(r.reading, r.live);
    SetIntersectEmptyIff(after.taken, after.live);
    SetIntersectEmptyIff(after.live, after.empty);
    SetIntersectEmptyIff(after.reading, after.live);
    DecidedOutcomesFilter(r);
    DecidedOutcomesFilter(after);
    var pFailBefore := (set_x: int) => !((set_x in [r.failedAt]));
    var pFailAfter := (set_x: int) => !((set_x in [after.failedAt]));
    var pNotTaken := (set_x: int) => !((set_x in r.taken));
    var restBefore := ProofLib.Filter(pNotTaken, r.live);
    ProofLib.FilterAppend(pNotTaken, r.live, r.at);
    var base := r.taken + restBefore;
    assert r.taken + (restBefore + [r.at]) == base + [r.at];
    ProofLib.FilterAppend(pFailAfter, base, r.at);
    forall i | 0 <= i < |base|
      ensures pFailBefore(base[i]) == pFailAfter(base[i])
    {
      if base[i] in r.taken {
        assert base[i] >= 1 && base[i] != r.at;
      } else {
        ProofLib.FilterMember(pNotTaken, r.live, base[i]);
        assert base[i] in r.live;
        assert base[i] >= 1 && base[i] != r.at;
      }
    }
    ProofLib.FilterSamePredicate(pFailBefore, pFailAfter, base);
    assert decidedOutcomes(after) == decidedOutcomes(r);
  }
}
