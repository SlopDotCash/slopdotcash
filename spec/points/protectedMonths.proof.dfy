lemma FoldLeftStep<A, T>(f: (A, T) -> A, z: A, xs: seq<T>)
  requires |xs| > 0
  ensures Std.Collections.Seq.FoldLeft(f, z, xs) == Std.Collections.Seq.FoldLeft(f, f(z, xs[0]), xs[1..])
{
}

lemma FoldOneRev<A>(f: (A, CandidateRevision) -> A, z: A, a: CandidateRevision)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a]) == f(z, a)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
}

lemma FoldFourRev<A>(f: (A, CandidateRevision) -> A, z: A, a: CandidateRevision, b: CandidateRevision, c: CandidateRevision, d: CandidateRevision)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b, c, d]) == f(f(f(f(z, a), b), c), d)
{
  var s0: seq<CandidateRevision> := [];
  assert s0 + [a] == [a];
  assert [a] + [b] == [a, b];
  assert [a, b] + [c] == [a, b, c];
  assert [a, b, c] + [d] == [a, b, c, d];
  ProofLib.FoldLeftAppend(f, z, s0, a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
  ProofLib.FoldLeftAppend(f, z, [a, b], c);
  ProofLib.FoldLeftAppend(f, z, [a, b, c], d);
}

lemma HeldPoolsEmpty(known: seq<CandidateRevision>, candidates: seq<CandidateRevision>, held: seq<int>)
  requires held == []
  ensures heldPools(known, candidates, held) == []
{
  var f := (acc: seq<PoolKey>, r: CandidateRevision) => (if ((r.id in held) && poolEligible(known, r)) then (acc + r.pools) else acc);
  var h := (r: CandidateRevision) => (if ((r.id in held) && poolEligible(known, r)) then r.pools else []);
  ProofLib.FoldLeftConcatEmpty(f, h, [], candidates);
}

lemma HeldPoolsMonotoneAux(known: seq<CandidateRevision>, xs: seq<CandidateRevision>, h1: seq<int>, h2: seq<int>, a1: seq<PoolKey>, a2: seq<PoolKey>, k: PoolKey)
  requires forall x :: x in h1 ==> x in h2
  requires k in a1 ==> k in a2
  ensures k in Std.Collections.Seq.FoldLeft((acc: seq<PoolKey>, r: CandidateRevision) => (if ((r.id in h1) && poolEligible(known, r)) then (acc + r.pools) else acc), a1, xs) ==>
    k in Std.Collections.Seq.FoldLeft((acc: seq<PoolKey>, r: CandidateRevision) => (if ((r.id in h2) && poolEligible(known, r)) then (acc + r.pools) else acc), a2, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var r := xs[0];
    var na1 := if ((r.id in h1) && poolEligible(known, r)) then (a1 + r.pools) else a1;
    var na2 := if ((r.id in h2) && poolEligible(known, r)) then (a2 + r.pools) else a2;
    HeldPoolsMonotoneAux(known, xs[1..], h1, h2, na1, na2, k);
  }
}

lemma JoinsHeldPoolMonotone(known: seq<CandidateRevision>, candidates: seq<CandidateRevision>, h1: seq<int>, h2: seq<int>, r: CandidateRevision)
  requires forall x :: x in h1 ==> x in h2
  requires joinsHeldPool(known, candidates, h1, r)
  ensures joinsHeldPool(known, candidates, h2, r)
{
  var k :| k in r.pools && k in heldPools(known, candidates, h1);
  HeldPoolsMonotoneAux(known, candidates, h1, h2, [], [], k);
}

lemma HoldPassEmptyAux(known: seq<CandidateRevision>, candidates: seq<CandidateRevision>, xs: seq<CandidateRevision>, acc: seq<int>)
  requires acc == []
  ensures Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => (if (!((r.id in acc)) && (holdsRevision(known, Protection([], []), acc, r) || joinsHeldPool(known, candidates, acc, r))) then (acc + [r.id]) else acc), acc, xs) == []
  decreases |xs|
{
  if |xs| > 0 {
    HeldPoolsEmpty(known, candidates, acc);
    assert !holdsRevision(known, Protection([], []), acc, xs[0]);
    assert !joinsHeldPool(known, candidates, acc, xs[0]);
    HoldPassEmptyAux(known, candidates, xs[1..], acc);
  }
}

lemma HeldRevisionsEmptyAux(known: seq<CandidateRevision>, candidates: seq<CandidateRevision>, steps: seq<CandidateRevision>, acc: seq<int>)
  requires acc == []
  ensures Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => holdPass(known, Protection([], []), candidates, acc), acc, steps) == []
  decreases |steps|
{
  if |steps| > 0 {
    HoldPassEmptyAux(known, candidates, candidates, acc);
    assert holdPass(known, Protection([], []), candidates, acc) == [];
    HeldRevisionsEmptyAux(known, candidates, steps[1..], acc);
  }
}

lemma lawNothingHeldWithoutProtection_ensures(known: seq<CandidateRevision>, candidates: seq<CandidateRevision>)
  ensures (lawNothingHeldWithoutProtection(known, candidates) == true)
{
  HeldRevisionsEmptyAux(known, candidates, candidates, []);
}

lemma HoldPassFoldProps(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>, xs: seq<CandidateRevision>, acc: seq<int>)
  requires ProofLib.Distinct(acc)
  requires forall x :: x in acc ==> exists r :: r in candidates && r.id == x
  requires forall r :: r in xs ==> r in candidates
  ensures var res := Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => (if (!((r.id in acc)) && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, candidates, acc, r))) then (acc + [r.id]) else acc), acc, xs);
    |res| >= |acc| &&
    (forall i :: 0 <= i < |acc| ==> res[i] == acc[i]) &&
    (forall x :: x in acc ==> x in res) &&
    ProofLib.Distinct(res) &&
    (forall x :: x in res ==> exists r :: r in candidates && r.id == x) &&
    (forall r :: r in xs && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, candidates, acc, r)) ==> r.id in res)
  decreases |xs|
{
  if |xs| > 0 {
    var r := xs[0];
    var stepAcc := if (!(r.id in acc) && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, candidates, acc, r))) then (acc + [r.id]) else acc;
    HoldPassFoldProps(known, scopes, candidates, xs[1..], stepAcc);
    var res := Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => (if (!((r.id in acc)) && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, candidates, acc, r))) then (acc + [r.id]) else acc), acc, xs);
    forall r2 | r2 in xs && (holdsRevision(known, scopes, acc, r2) || joinsHeldPool(known, candidates, acc, r2))
      ensures r2.id in res
    {
      if r2 == r {
        assert r.id in stepAcc;
      } else {
        assert r2 in xs[1..];
        if joinsHeldPool(known, candidates, acc, r2) {
          JoinsHeldPoolMonotone(known, candidates, acc, stepAcc, r2);
        }
      }
    }
  }
}

lemma HoldPassProps(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>, acc: seq<int>)
  requires ProofLib.Distinct(acc)
  requires forall x :: x in acc ==> exists r :: r in candidates && r.id == x
  ensures var res := holdPass(known, scopes, candidates, acc);
    |res| >= |acc| &&
    (forall i :: 0 <= i < |acc| ==> res[i] == acc[i]) &&
    (forall x :: x in acc ==> x in res) &&
    ProofLib.Distinct(res) &&
    (forall x :: x in res ==> exists r :: r in candidates && r.id == x) &&
    (forall r :: r in candidates && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, candidates, acc, r)) ==> r.id in res)
{
  HoldPassFoldProps(known, scopes, candidates, candidates, acc);
}

lemma HeldRevisionsFixedStays(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>, steps: seq<CandidateRevision>, acc: seq<int>)
  requires holdPass(known, scopes, candidates, acc) == acc
  ensures Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => holdPass(known, scopes, candidates, acc), acc, steps) == acc
  decreases |steps|
{
  if |steps| > 0 {
    HeldRevisionsFixedStays(known, scopes, candidates, steps[1..], acc);
  }
}

lemma HeldRevisionsClosure(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>, steps: seq<CandidateRevision>, acc: seq<int>)
  requires ProofLib.Distinct(acc)
  requires forall x :: x in acc ==> exists r :: r in candidates && r.id == x
  ensures var res := Std.Collections.Seq.FoldLeft((acc: seq<int>, r: CandidateRevision) => holdPass(known, scopes, candidates, acc), acc, steps);
    ProofLib.Distinct(res) &&
    (forall x :: x in acc ==> x in res) &&
    (forall x :: x in res ==> exists r :: r in candidates && r.id == x) &&
    (|steps| > 0 ==> forall r :: r in candidates && holdsRevision(known, scopes, [], r) ==> r.id in res) &&
    (|res| >= |acc| + |steps| || holdPass(known, scopes, candidates, res) == res)
  decreases |steps|
{
  if |steps| > 0 {
    var next := holdPass(known, scopes, candidates, acc);
    HoldPassProps(known, scopes, candidates, acc);
    if next == acc {
      HeldRevisionsFixedStays(known, scopes, candidates, steps[1..], acc);
    } else {
      assert |next| > |acc|;
      HeldRevisionsClosure(known, scopes, candidates, steps[1..], next);
    }
  }
}

lemma DistinctSeqSetCard(xs: seq<int>)
  requires ProofLib.Distinct(xs)
  ensures |set x | x in xs| == |xs|
  decreases |xs|
{
  if |xs| > 0 {
    var tail := xs[1..];
    assert ProofLib.Distinct(tail) by {
      forall i, j | 0 <= i < j < |tail| ensures tail[i] != tail[j] {
        assert tail[i] == xs[i + 1] && tail[j] == xs[j + 1];
      }
    }
    DistinctSeqSetCard(tail);
    assert !(xs[0] in tail);
    assert (set x | x in xs) == (set x | x in tail) + {xs[0]};
  }
}

lemma CandidateIdsSetCard(candidates: seq<CandidateRevision>)
  ensures |set i | 0 <= i < |candidates| :: candidates[i].id| <= |candidates|
  decreases |candidates|
{
  if |candidates| > 0 {
    var tail := candidates[1..];
    CandidateIdsSetCard(tail);
    var sAll := set i | 0 <= i < |candidates| :: candidates[i].id;
    var sTail := set i | 0 <= i < |tail| :: tail[i].id;
    assert sAll <= sTail + {candidates[0].id} by {
      forall x | x in sAll ensures x in sTail + {candidates[0].id} {
        var i :| 0 <= i < |candidates| && candidates[i].id == x;
        if i > 0 {
          assert tail[i - 1] == candidates[i];
        }
      }
    }
    ProofLib.SubsetCard(sAll, sTail + {candidates[0].id});
  }
}

lemma lawSharedPoolHeld_ensures(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>)
  ensures (lawSharedPoolHeld(known, scopes, candidates) == true)
{
  HeldRevisionsClosure(known, scopes, candidates, candidates, []);
  var res := heldRevisions(known, scopes, candidates);
  if holdPass(known, scopes, candidates, res) == res {
    HoldPassProps(known, scopes, candidates, res);
  } else {
    assert |res| >= |candidates|;
    DistinctSeqSetCard(res);
    CandidateIdsSetCard(candidates);
    var sRes := set x | x in res;
    var sAll := set i | 0 <= i < |candidates| :: candidates[i].id;
    assert sRes <= sAll by {
      forall x | x in sRes ensures x in sAll {
        var r :| r in candidates && r.id == x;
        var i :| 0 <= i < |candidates| && candidates[i] == r;
        assert candidates[i].id == x;
      }
    }
    forall r | r in candidates
      ensures r.id in res
    {
      if !(r.id in res) {
        var i :| 0 <= i < |candidates| && candidates[i] == r;
        assert r.id in sAll;
        assert sRes <= sAll - {r.id};
        ProofLib.SubsetCard(sRes, sAll - {r.id});
      }
    }
  }
}

lemma PublishedCandidatesMeaning(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>)
  ensures publishedCandidates(known, scopes, candidates) == (var local_9 := heldRevisions(known, scopes, candidates); ProofLib.Filter((r: CandidateRevision) => !((r.id in local_9)), candidates))
{
}

lemma lawEveryCandidateHeldOrPublished_ensures(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>)
  ensures (lawEveryCandidateHeldOrPublished(known, scopes, candidates) == true)
{
  PublishedCandidatesMeaning(known, scopes, candidates);
  var held := heldRevisions(known, scopes, candidates);
  forall r | r in candidates
    ensures r.id in held || r in publishedCandidates(known, scopes, candidates)
  {
    ProofLib.FilterMember((r: CandidateRevision) => !((r.id in held)), candidates, r);
  }
}

lemma lawPublishedCandidatesPassTheImportGuard_ensures(known: seq<CandidateRevision>, scopes: Protection, candidates: seq<CandidateRevision>)
  ensures (lawPublishedCandidatesPassTheImportGuard(known, scopes, candidates) == true)
{
  PublishedCandidatesMeaning(known, scopes, candidates);
  HeldRevisionsClosure(known, scopes, candidates, candidates, []);
  var held := heldRevisions(known, scopes, candidates);
  forall r | r in publishedCandidates(known, scopes, candidates)
    ensures !holdsRevision(known, scopes, [], r)
  {
    ProofLib.FilterMember((r: CandidateRevision) => !((r.id in held)), candidates, r);
  }
}

lemma EvalHeldPoolsFour(known: seq<CandidateRevision>, c1: CandidateRevision, c2: CandidateRevision, c3: CandidateRevision, c4: CandidateRevision, held: seq<int>)
  ensures heldPools(known, [c1, c2, c3, c4], held) ==
    (var f := (acc: seq<PoolKey>, r: CandidateRevision) => (if ((r.id in held) && poolEligible(known, r)) then (acc + r.pools) else acc);
     f(f(f(f([], c1), c2), c3), c4))
{
  FoldFourRev((acc: seq<PoolKey>, r: CandidateRevision) => (if ((r.id in held) && poolEligible(known, r)) then (acc + r.pools) else acc), [], c1, c2, c3, c4);
}

lemma EvalHoldPassFour(known: seq<CandidateRevision>, scopes: Protection, c1: CandidateRevision, c2: CandidateRevision, c3: CandidateRevision, c4: CandidateRevision, held: seq<int>)
  ensures holdPass(known, scopes, [c1, c2, c3, c4], held) ==
    (var f := (acc: seq<int>, r: CandidateRevision) => (if (!((r.id in acc)) && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, [c1, c2, c3, c4], acc, r))) then (acc + [r.id]) else acc);
     f(f(f(f(held, c1), c2), c3), c4))
{
  FoldFourRev((acc: seq<int>, r: CandidateRevision) => (if (!((r.id in acc)) && (holdsRevision(known, scopes, acc, r) || joinsHeldPool(known, [c1, c2, c3, c4], acc, r))) then (acc + [r.id]) else acc), held, c1, c2, c3, c4);
}

lemma EvalPredOne(r: CandidateRevision)
  ensures publishedPredecessor([publishedAward], r) == (if r.previous > 0 && publishedAward.id == r.previous then publishedAward else noRevision)
{
  FoldOneRev((acc: CandidateRevision, k: CandidateRevision) => (if ((r.previous > 0) && (k.id == r.previous)) then k else acc), noRevision, publishedAward);
}

lemma lawFrozenRetirementHoldsItsReplacement_ensures(known: seq<CandidateRevision>)
  ensures (lawFrozenRetirementHoldsItsReplacement(known) == true)
{
  if known == [publishedAward] {
    var scopes := Protection([paidMonth], []);
    var cands := [independentUnit, replacementSuccessor, laterReplacement, frozenRetirement];
    EvalPredOne(independentUnit);
    EvalPredOne(replacementSuccessor);
    EvalPredOne(laterReplacement);
    EvalPredOne(frozenRetirement);
    assert points__periods_periodOf(publishedAward.occurredAt) == 24321;
    assert points__periods_periodOf(independentUnit.occurredAt) == 24322;
    assert points__periods_periodOf(replacementSuccessor.occurredAt) == 24322;
    assert points__periods_periodOf(laterReplacement.occurredAt) == 24322;
    assert points__periods_periodOf(frozenRetirement.occurredAt) == 24321;
    FoldFourRev((acc: seq<int>, r: CandidateRevision) => holdPass(known, scopes, cands, acc), [], independentUnit, replacementSuccessor, laterReplacement, frozenRetirement);
    EvalHoldPassFour(known, scopes, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, []);
    EvalHeldPoolsFour(known, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, []);
    assert holdPass(known, scopes, cands, []) == [8];
    EvalHoldPassFour(known, scopes, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8]);
    EvalHeldPoolsFour(known, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8]);
    assert unitPool in heldPools(known, cands, [8]);
    assert holdPass(known, scopes, cands, [8]) == [8, 9];
    EvalHoldPassFour(known, scopes, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8, 9]);
    EvalHeldPoolsFour(known, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8, 9]);
    assert holdPass(known, scopes, cands, [8, 9]) == [8, 9, 11];
    EvalHoldPassFour(known, scopes, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8, 9, 11]);
    EvalHeldPoolsFour(known, independentUnit, replacementSuccessor, laterReplacement, frozenRetirement, [8, 9, 11]);
    assert holdPass(known, scopes, cands, [8, 9, 11]) == [8, 9, 11];
  }
}
