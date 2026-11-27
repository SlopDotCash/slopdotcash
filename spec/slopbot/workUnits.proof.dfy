lemma SetUnionMember(a: seq<int>, b: seq<int>, x: int)
  ensures x in (a + ProofLib.Filter((set_x: int) => !((set_x in a)), b)) <==> (x in a || x in b)
{
  ProofLib.FilterMember((set_x: int) => !((set_x in a)), b, x);
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

lemma FirstFilterNotLater<T>(p: T -> bool, xs: seq<T>, first: int, later: int)
  requires ProofLib.Distinct(xs)
  requires 0 <= first < later < |xs|
  requires p(xs[first])
  ensures |ProofLib.Filter(p, xs)| > 0 && ProofLib.Filter(p, xs)[0] != xs[later]
  decreases |xs|
{
  ProofLib.FilterCons(p, xs);
  if p(xs[0]) {
    assert ProofLib.Filter(p, xs)[0] == xs[0];
  } else {
    assert first > 0;
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    FirstFilterNotLater(p, xs[1..], first - 1, later - 1);
  }
}

lemma ValidEvidenceFilter(e: Evidence)
  ensures validEvidence(e) == (((((e.project > 0) && (|e.accepted| > 0)) && !(e.limitations)) && !((exists s :: s in e.accepted && !(((s > 0) && (|ProofLib.Filter((o: int) => (o == s), e.accepted)| == 1)))))) && !((exists c :: c in e.claims && !(validClaim(e, c)))))
{
}

lemma FirstCarrierFilter(e: Evidence, c: Claim)
  ensures firstCarrier(e, c) == (if ((0 <= 0) && (0 < |ProofLib.Filter((s: int) => (s in c.carriers), e.accepted)|)) then ProofLib.Filter((s: int) => (s in c.carriers), e.accepted)[0] else 0)
{
}

lemma lawLaterCarrierEarnsNothing_ensures(e: Evidence, first: int, later: int)
  ensures (lawLaterCarrierEarnsNothing(e, first, later) == true)
{
  if validEvidence(e) && 0 <= first && first < later && later < |e.accepted| {
    ValidEvidenceFilter(e);
    assert ProofLib.Distinct(e.accepted) by {
      forall i, j | 0 <= i < j < |e.accepted|
        ensures e.accepted[i] != e.accepted[j]
      {
        var s := e.accepted[i];
        assert s in e.accepted;
        ProofLib.FilterCountOneIffUnique((o: int) => (o == s), e.accepted, (x: int) => x, i);
      }
    }
    forall c | c in e.claims && e.accepted[first] in c.carriers && e.accepted[later] in c.carriers
      ensures c.credit != e.accepted[later]
    {
      FirstCarrierFilter(e, c);
      FirstFilterNotLater((s: int) => (s in c.carriers), e.accepted, first, later);
    }
  }
}

lemma CompletePartitionFilter(e: Evidence, units: seq<seq<int>>)
  ensures completePartition(e, units) == (!((exists u :: u in units && !(((|u| > 0) && !((exists set_x :: set_x in u && !((set_x in claimIds(e))))))))) && !((exists id :: id in claimIds(e) && !((|ProofLib.Filter((u: seq<int>) => (id in u), units)| == 1)))))
{
}

lemma lawPartialPartitionRefused_ensures(e: Evidence, units: seq<seq<int>>)
  ensures (lawPartialPartitionRefused(e, units) == true)
{
  if exists id :: id in claimIds(e) && !(exists u :: u in units && (id in u)) {
    CompletePartitionFilter(e, units);
    var id :| id in claimIds(e) && !(exists u :: u in units && (id in u));
    ProofLib.FilterNone((u: seq<int>) => (id in u), units);
  }
}

lemma RecordOfFilter(j: Journal, digest: int)
  ensures recordOf(j, digest) == (if ((0 <= 0) && (0 < |ProofLib.Filter((r: JointRecord) => (r.digest == digest), j.records)|)) then ProofLib.Filter((r: JointRecord) => (r.digest == digest), j.records)[0] else noRecord)
{
}

lemma LiveRecordsFilter(j: Journal)
  ensures liveRecords(j) == ProofLib.Filter((r: JointRecord) => !((r.digest in j.retired)), j.records)
{
}

lemma CurrentLegacyFilter(j: Journal)
  ensures currentLegacy(j) == ProofLib.Filter((l: LegacyRecord) => !((l.digest in j.legacyRetired)), j.legacy)
{
}

lemma RecordsUniqueFilter(j: Journal)
  ensures alwaysRecordsAreUnique(j) == ((j.lastSequence >= 0) && !((exists r :: r in j.records && !((((((((((r.digest > 0) && (r.assessmentKey > 0)) && (r.sequence > 0)) && (r.sequence <= j.lastSequence)) && (|ProofLib.Filter((o: JointRecord) => (o.digest == r.digest), j.records)| == 1)) && (|ProofLib.Filter((o: JointRecord) => (o.assessmentKey == r.assessmentKey), j.records)| == 1)) && reasonMatches(r)) && (!((|r.claims| > 0)) || (|r.units| > 0))) && !((exists u :: u in r.units && !(((|u| > 0) && !((exists set_x :: set_x in u && !((set_x in r.claims)))))))))))))
{
}

lemma OneCreditFilter(j: Journal)
  ensures alwaysOneCurrentCreditPerSource(j) == !((exists l :: l in currentLegacy(j) && !((!(jointSource(j, l.source)) && (|ProofLib.Filter((o: LegacyRecord) => (o.source == l.source), currentLegacy(j))| == 1)))))
{
}

lemma DisjointFilter(j: Journal)
  ensures alwaysCurrentRecordsAreDisjoint(j) == !((exists a :: a in liveRecords(j) && !(!((exists b :: b in liveRecords(j) && !(((a.digest == b.digest) || ((|ProofLib.Filter((set_x: int) => (set_x in b.sources), a.sources)| == 0) && (|ProofLib.Filter((set_x: int) => (set_x in b.claims), a.claims)| == 0)))))))))
{
}

lemma OmitsFilter(j: Journal, r: JointRecord)
  ensures omitsNoCurrentOwner(j, r) == !((exists o :: o in liveRecords(j) && !((((|ProofLib.Filter((set_x: int) => (set_x in r.sources), o.sources)| == 0) && (|ProofLib.Filter((set_x: int) => (set_x in r.claims), o.claims)| == 0)) || (o.digest in r.parents)))))
{
}

lemma AppendJointShape(j: Journal, r: JointRecord, e: Evidence, captured: int)
  ensures appendJoint(j, r, e, captured).retired == (j.retired + ProofLib.Filter((set_x: int) => !((set_x in j.retired)), r.parents))
  ensures appendJoint(j, r, e, captured).legacyRetired == (j.legacyRetired + ProofLib.Filter((set_x: int) => !((set_x in j.legacyRetired)), r.legacyParents))
{
}

lemma AppendLegacyShape(j: Journal, l: LegacyRecord, kind: SourceKind)
  ensures appendLegacy(j, l, kind).legacyRetired == (j.legacyRetired + ProofLib.Filter((set_x: int) => !((set_x in j.legacyRetired)), currentLegacyOf(j, [l.source])))
{
}

lemma RecordsUniqueDistinct(j: Journal)
  requires alwaysRecordsAreUnique(j)
  ensures ProofLib.DistinctBy(j.records, (o: JointRecord) => o.digest)
  ensures ProofLib.DistinctBy(j.records, (o: JointRecord) => o.assessmentKey)
{
  RecordsUniqueFilter(j);
  forall i, k | 0 <= i < |j.records| && 0 <= k < |j.records| && i != k
    ensures j.records[i].digest != j.records[k].digest
    ensures j.records[i].assessmentKey != j.records[k].assessmentKey
  {
    var r := j.records[i];
    assert r in j.records;
    ProofLib.FilterCountOneIffUnique((o: JointRecord) => (o.digest == r.digest), j.records, (x: JointRecord) => x.digest, i);
    ProofLib.FilterCountOneIffUnique((o: JointRecord) => (o.assessmentKey == r.assessmentKey), j.records, (x: JointRecord) => x.assessmentKey, i);
  }
}

lemma RecordOfFacts(j: Journal, d: int)
  requires alwaysRecordsAreUnique(j)
  ensures recordOf(j, d).digest == 0 ==> forall r :: r in j.records ==> r.digest != d
  ensures recordOf(j, d).digest > 0 ==> recordOf(j, d) in j.records && recordOf(j, d).digest == d
  ensures forall r :: r in j.records && r.digest == d ==> recordOf(j, d) == r
{
  RecordsUniqueDistinct(j);
  RecordOfFilter(j, d);
  var p := (r: JointRecord) => (r.digest == d);
  var fs := ProofLib.Filter(p, j.records);
  if |fs| == 0 {
    ProofLib.FilterNone(p, j.records);
  } else {
    ProofLib.FilterMember(p, j.records, fs[0]);
    assert fs[0] in j.records && fs[0].digest == d;
    forall r | r in j.records && r.digest == d
      ensures recordOf(j, d) == r
    {
      var i :| 0 <= i < |j.records| && j.records[i] == fs[0];
      var k :| 0 <= k < |j.records| && j.records[k] == r;
      assert i == k;
    }
  }
}

lemma RecordOfAfterAppend(j: Journal, nr: JointRecord, after: Journal, d: int)
  requires alwaysRecordsAreUnique(j)
  requires after.records == j.records + [nr]
  requires recordOf(j, nr.digest).digest == 0
  requires d != nr.digest
  ensures recordOf(after, d) == recordOf(j, d)
{
  RecordOfFilter(j, d);
  RecordOfFilter(after, d);
  ProofLib.FilterAppend((r: JointRecord) => (r.digest == d), j.records, nr);
}

lemma FoldLeftLegacyMember(f: (seq<int>, LegacyRecord) -> seq<int>, sources: seq<int>, init: seq<int>, ls: seq<LegacyRecord>, d: int)
  requires forall ds, l, y :: y in f(ds, l) <==> (y in ds || (l.source in sources && y == l.digest))
  ensures d in Std.Collections.Seq.FoldLeft(f, init, ls) <==> (d in init || exists l :: l in ls && l.source in sources && l.digest == d)
  decreases |ls|
{
  if |ls| > 0 {
    FoldLeftLegacyMember(f, sources, f(init, ls[0]), ls[1..], d);
    assert ls == [ls[0]] + ls[1..];
  }
}

lemma CurrentLegacyOfMember(j: Journal, sources: seq<int>, d: int)
  ensures d in currentLegacyOf(j, sources) <==> exists l :: l in currentLegacy(j) && l.source in sources && l.digest == d
{
  var f := (ds: seq<int>, l: LegacyRecord) => (if (l.source in sources) then (ds + Std.Collections.Seq.Filter((set_x: int) => !((set_x in ds)), [l.digest])) else ds);
  forall ds, l, y
    ensures y in f(ds, l) <==> (y in ds || (l.source in sources && y == l.digest))
  {
    if l.source in sources {
      ProofLib.FilterMember((set_x: int) => !((set_x in ds)), [l.digest], y);
    }
  }
  FoldLeftLegacyMember(f, sources, [], currentLegacy(j), d);
}

lemma FilterSubseq<T>(p: T -> bool, q: T -> bool, xs: seq<T>, f: T -> bool)
  requires forall i :: 0 <= i < |xs| && p(xs[i]) ==> q(xs[i])
  ensures |ProofLib.Filter(f, ProofLib.Filter(p, xs))| <= |ProofLib.Filter(f, ProofLib.Filter(q, xs))|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterNil(q, xs);
    ProofLib.FilterNil(f, []);
  } else {
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(q, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    FilterSubseq(p, q, xs[1..], f);
    var rp := ProofLib.Filter(p, xs[1..]);
    var rq := ProofLib.Filter(q, xs[1..]);
    if p(xs[0]) {
      assert ProofLib.Filter(p, xs) == [xs[0]] + rp;
      assert ProofLib.Filter(q, xs) == [xs[0]] + rq;
      ProofLib.FilterCons(f, [xs[0]] + rp);
      assert ([xs[0]] + rp)[1..] == rp;
      ProofLib.FilterCons(f, [xs[0]] + rq);
      assert ([xs[0]] + rq)[1..] == rq;
    } else if q(xs[0]) {
      assert ProofLib.Filter(p, xs) == rp;
      assert ProofLib.Filter(q, xs) == [xs[0]] + rq;
      ProofLib.FilterCons(f, [xs[0]] + rq);
      assert ([xs[0]] + rq)[1..] == rq;
    } else {
      assert ProofLib.Filter(p, xs) == rp;
      assert ProofLib.Filter(q, xs) == rq;
    }
  }
}

lemma AppendJointUnique(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures alwaysRecordsAreUnique(appendJoint(j, r, e, captured))
{
  var nr := r.(sequence := j.lastSequence + 1);
  var after := appendJoint(j, r, e, captured);
  RecordsUniqueDistinct(j);
  RecordsUniqueFilter(after);
  RecordOfFacts(j, r.digest);
  CompletePartitionFilter(e, nr.units);
  assert after.records == j.records + [nr];
  assert ProofLib.DistinctBy(after.records, (o: JointRecord) => o.digest) by {
    forall i, k | 0 <= i < |after.records| && 0 <= k < |after.records| && i != k
      ensures after.records[i].digest != after.records[k].digest
    {
      if i < |j.records| && k < |j.records| {
        assert after.records[i] == j.records[i] && after.records[k] == j.records[k];
      } else if i < |j.records| {
        assert after.records[i] in j.records && after.records[k] == nr;
      } else {
        assert after.records[k] in j.records && after.records[i] == nr;
      }
    }
  }
  assert ProofLib.DistinctBy(after.records, (o: JointRecord) => o.assessmentKey) by {
    forall i, k | 0 <= i < |after.records| && 0 <= k < |after.records| && i != k
      ensures after.records[i].assessmentKey != after.records[k].assessmentKey
    {
      if i < |j.records| && k < |j.records| {
        assert after.records[i] == j.records[i] && after.records[k] == j.records[k];
      } else if i < |j.records| {
        assert after.records[i] in j.records && after.records[k] == nr;
      } else {
        assert after.records[k] in j.records && after.records[i] == nr;
      }
    }
  }
  if |nr.claims| > 0 {
    var id := nr.claims[0];
    assert id in nr.claims;
    assert id in claimIds(e);
    if |nr.units| == 0 {
      ProofLib.FilterNil((u: seq<int>) => (id in u), nr.units);
      assert false;
    }
  }
  forall rec | rec in after.records
    ensures rec.digest > 0 && rec.assessmentKey > 0 && rec.sequence > 0 && rec.sequence <= after.lastSequence
      && |ProofLib.Filter((o: JointRecord) => (o.digest == rec.digest), after.records)| == 1
      && |ProofLib.Filter((o: JointRecord) => (o.assessmentKey == rec.assessmentKey), after.records)| == 1
      && reasonMatches(rec)
      && (|rec.claims| > 0 ==> |rec.units| > 0)
      && forall u :: u in rec.units ==> |u| > 0 && forall x :: x in u ==> x in rec.claims
  {
    var i :| 0 <= i < |after.records| && after.records[i] == rec;
    ProofLib.FilterOne((o: JointRecord) => (o.digest == rec.digest), after.records, i);
    ProofLib.FilterOne((o: JointRecord) => (o.assessmentKey == rec.assessmentKey), after.records, i);
  }
}

lemma AppendJointOneCredit(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures alwaysOneCurrentCreditPerSource(appendJoint(j, r, e, captured))
{
  var after := appendJoint(j, r, e, captured);
  AppendJointShape(j, r, e, captured);
  CurrentLegacyFilter(j);
  CurrentLegacyFilter(after);
  OneCreditFilter(j);
  OneCreditFilter(after);
  var pAfter := (l: LegacyRecord) => !((l.digest in after.legacyRetired));
  var pBefore := (l: LegacyRecord) => !((l.digest in j.legacyRetired));
  forall i | 0 <= i < |j.legacy| && pAfter(j.legacy[i])
    ensures pBefore(j.legacy[i])
  {
    SetUnionMember(j.legacyRetired, r.legacyParents, j.legacy[i].digest);
  }
  forall l | l in currentLegacy(after)
    ensures !jointSource(after, l.source)
      && |ProofLib.Filter((o: LegacyRecord) => (o.source == l.source), currentLegacy(after))| == 1
  {
    ProofLib.FilterMember(pAfter, after.legacy, l);
    SetUnionMember(j.legacyRetired, r.legacyParents, l.digest);
    ProofLib.FilterMember(pBefore, j.legacy, l);
    assert l in currentLegacy(j);
    if l.source in r.sources {
      CurrentLegacyOfMember(j, r.sources, l.digest);
      assert l.digest in r.legacyParents;
      assert false;
    }
    var pSrc := (o: LegacyRecord) => (o.source == l.source);
    FilterSubseq(pAfter, pBefore, j.legacy, pSrc);
    ProofLib.FilterMember(pSrc, currentLegacy(after), l);
    assert l in ProofLib.Filter(pSrc, currentLegacy(after));
  }
}

lemma AppendJointDisjoint(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures alwaysCurrentRecordsAreDisjoint(appendJoint(j, r, e, captured))
{
  var nr := r.(sequence := j.lastSequence + 1);
  var after := appendJoint(j, r, e, captured);
  AppendJointShape(j, r, e, captured);
  LiveRecordsFilter(j);
  LiveRecordsFilter(after);
  DisjointFilter(j);
  DisjointFilter(after);
  OmitsFilter(j, r);
  forall a, b | a in liveRecords(after) && b in liveRecords(after) && a.digest != b.digest
    ensures |ProofLib.Filter((set_x: int) => (set_x in b.sources), a.sources)| == 0
      && |ProofLib.Filter((set_x: int) => (set_x in b.claims), a.claims)| == 0
  {
    ProofLib.FilterMember((x: JointRecord) => !((x.digest in after.retired)), after.records, a);
    ProofLib.FilterMember((x: JointRecord) => !((x.digest in after.retired)), after.records, b);
    SetUnionMember(j.retired, r.parents, a.digest);
    SetUnionMember(j.retired, r.parents, b.digest);
    if a in j.records && b in j.records {
      ProofLib.FilterMember((x: JointRecord) => !((x.digest in j.retired)), j.records, a);
      ProofLib.FilterMember((x: JointRecord) => !((x.digest in j.retired)), j.records, b);
    } else if a in j.records && b == nr {
      ProofLib.FilterMember((x: JointRecord) => !((x.digest in j.retired)), j.records, a);
      assert a in liveRecords(j);
      assert !(a.digest in r.parents);
    } else if a == nr && b in j.records {
      ProofLib.FilterMember((x: JointRecord) => !((x.digest in j.retired)), j.records, b);
      assert b in liveRecords(j);
      assert !(b.digest in r.parents);
      SetIntersectEmptyIff(b.sources, r.sources);
      SetIntersectEmptyIff(r.sources, b.sources);
      SetIntersectEmptyIff(b.claims, r.claims);
      SetIntersectEmptyIff(r.claims, b.claims);
    }
  }
}

lemma AppendJointPredecessors(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures alwaysPredecessorsAreRetiredAndEarlier(appendJoint(j, r, e, captured))
{
  var nr := r.(sequence := j.lastSequence + 1);
  var after := appendJoint(j, r, e, captured);
  AppendJointShape(j, r, e, captured);
  RecordOfFacts(j, r.digest);
  forall rec | rec in after.records
    ensures (forall p :: p in rec.parents ==>
      p in after.retired && recordOf(after, p).digest > 0 && recordOf(after, p).sequence < rec.sequence
      && forall x :: x in recordOf(after, p).sources ==> x in rec.sources)
      && (forall d :: d in rec.legacyParents ==>
        d in after.legacyRetired && exists l :: l in after.legacy && l.digest == d && l.source in rec.sources)
  {
    if rec in j.records {
      forall p | p in rec.parents
        ensures p in after.retired && recordOf(after, p).digest > 0 && recordOf(after, p).sequence < rec.sequence
          && forall x :: x in recordOf(after, p).sources ==> x in rec.sources
      {
        SetUnionMember(j.retired, r.parents, p);
        assert recordOf(j, p).digest > 0;
        assert p != r.digest;
        RecordOfAfterAppend(j, nr, after, p);
      }
      forall d | d in rec.legacyParents
        ensures d in after.legacyRetired && exists l :: l in after.legacy && l.digest == d && l.source in rec.sources
      {
        SetUnionMember(j.legacyRetired, r.legacyParents, d);
      }
    } else {
      assert rec == nr;
      forall p | p in nr.parents
        ensures p in after.retired && recordOf(after, p).digest > 0 && recordOf(after, p).sequence < nr.sequence
          && forall x :: x in recordOf(after, p).sources ==> x in nr.sources
      {
        SetUnionMember(j.retired, r.parents, p);
        assert predecessorOk(j, r, p);
        RecordOfFacts(j, p);
        assert p != r.digest;
        RecordOfAfterAppend(j, nr, after, p);
      }
      forall d | d in nr.legacyParents
        ensures d in after.legacyRetired && exists l :: l in after.legacy && l.digest == d && l.source in nr.sources
      {
        SetUnionMember(j.legacyRetired, r.legacyParents, d);
        assert d in currentLegacyOf(j, r.sources);
        CurrentLegacyOfMember(j, r.sources, d);
        var l :| l in currentLegacy(j) && l.source in r.sources && l.digest == d;
        CurrentLegacyFilter(j);
        ProofLib.FilterMember((x: LegacyRecord) => !((x.digest in j.legacyRetired)), j.legacy, l);
        assert l in after.legacy;
      }
    }
  }
}

lemma AppendJointRetiredWereRecorded(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures alwaysRetiredWereRecorded(appendJoint(j, r, e, captured))
{
  var nr := r.(sequence := j.lastSequence + 1);
  var after := appendJoint(j, r, e, captured);
  AppendJointShape(j, r, e, captured);
  RecordOfFacts(j, r.digest);
  forall d | d in after.retired
    ensures recordOf(after, d).digest > 0
  {
    SetUnionMember(j.retired, r.parents, d);
    if d in j.retired {
      assert recordOf(j, d).digest > 0;
    } else {
      assert d in r.parents;
      assert predecessorOk(j, r, d);
    }
    assert d != r.digest;
    RecordOfAfterAppend(j, nr, after, d);
  }
  forall d | d in after.legacyRetired
    ensures exists l :: l in after.legacy && l.digest == d
  {
    SetUnionMember(j.legacyRetired, r.legacyParents, d);
    if !(d in j.legacyRetired) {
      assert d in r.legacyParents;
      assert d in currentLegacyOf(j, r.sources);
      CurrentLegacyOfMember(j, r.sources, d);
      var l :| l in currentLegacy(j) && l.source in r.sources && l.digest == d;
      CurrentLegacyFilter(j);
      ProofLib.FilterMember((x: LegacyRecord) => !((x.digest in j.legacyRetired)), j.legacy, l);
      assert l in after.legacy;
    }
  }
}

lemma AppendJointAppendOnly(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures stepJournalIsAppendOnly(j, appendJoint(j, r, e, captured))
{
  var after := appendJoint(j, r, e, captured);
  forall rec | rec in j.records
    ensures exists a :: a in after.records && sameRecord(a, rec)
  {
    assert rec in after.records;
    assert sameRecord(rec, rec);
  }
}

lemma AppendJointGroupsOnlyMerge(j: Journal, r: JointRecord, e: Evidence, captured: int)
  requires inv(j) && canAppendJoint(j, r, e, captured)
  ensures stepGroupsOnlyMerge(j, appendJoint(j, r, e, captured))
{
  var nr := r.(sequence := j.lastSequence + 1);
  var after := appendJoint(j, r, e, captured);
  AppendJointShape(j, r, e, captured);
  LiveRecordsFilter(j);
  forall rec | rec in liveRecords(j) && rec.digest in after.retired
    ensures exists n :: n in after.records && rec.digest in n.parents && forall x :: x in rec.sources ==> x in n.sources
  {
    ProofLib.FilterMember((x: JointRecord) => !((x.digest in j.retired)), j.records, rec);
    SetUnionMember(j.retired, r.parents, rec.digest);
    assert rec.digest in r.parents;
    assert predecessorOk(j, r, rec.digest);
    RecordOfFacts(j, rec.digest);
    assert recordOf(j, rec.digest) == rec;
    assert nr in after.records;
  }
}

lemma appendJoint_ensures(j: Journal, r: JointRecord, e: Evidence, captured: int)
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> alwaysRecordsAreUnique(appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> alwaysOneCurrentCreditPerSource(appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> alwaysCurrentRecordsAreDisjoint(appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> alwaysPredecessorsAreRetiredAndEarlier(appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> alwaysRetiredWereRecorded(appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> stepJournalIsAppendOnly(j, appendJoint(j, r, e, captured)))
  ensures (inv(j) ==> canAppendJoint(j, r, e, captured) ==> stepGroupsOnlyMerge(j, appendJoint(j, r, e, captured)))
{
  if inv(j) && canAppendJoint(j, r, e, captured) {
    AppendJointUnique(j, r, e, captured);
    AppendJointOneCredit(j, r, e, captured);
    AppendJointDisjoint(j, r, e, captured);
    AppendJointPredecessors(j, r, e, captured);
    AppendJointRetiredWereRecorded(j, r, e, captured);
    AppendJointAppendOnly(j, r, e, captured);
    AppendJointGroupsOnlyMerge(j, r, e, captured);
  }
}

lemma AppendLegacyOneCredit(j: Journal, l: LegacyRecord, kind: SourceKind)
  requires inv(j) && canAppendLegacy(j, l, kind)
  ensures alwaysOneCurrentCreditPerSource(appendLegacy(j, l, kind))
{
  var after := appendLegacy(j, l, kind);
  var retiredNew := currentLegacyOf(j, [l.source]);
  AppendLegacyShape(j, l, kind);
  CurrentLegacyFilter(j);
  CurrentLegacyFilter(after);
  OneCreditFilter(j);
  OneCreditFilter(after);
  var pAfter := (x: LegacyRecord) => !((x.digest in after.legacyRetired));
  var pBefore := (x: LegacyRecord) => !((x.digest in j.legacyRetired));
  ProofLib.FilterAppend(pAfter, j.legacy, l);
  SetUnionMember(j.legacyRetired, retiredNew, l.digest);
  if l.digest in retiredNew {
    CurrentLegacyOfMember(j, [l.source], l.digest);
    var oldL :| oldL in currentLegacy(j) && oldL.source in [l.source] && oldL.digest == l.digest;
    ProofLib.FilterMember(pBefore, j.legacy, oldL);
    assert oldL in j.legacy;
    assert false;
  }
  assert pAfter(l);
  var pref := ProofLib.Filter(pAfter, j.legacy);
  assert currentLegacy(after) == pref + [l];
  forall i | 0 <= i < |j.legacy| && pAfter(j.legacy[i])
    ensures pBefore(j.legacy[i])
  {
    SetUnionMember(j.legacyRetired, retiredNew, j.legacy[i].digest);
  }
  forall x | x in pref
    ensures x.source != l.source
  {
    ProofLib.FilterMember(pAfter, j.legacy, x);
    SetUnionMember(j.legacyRetired, retiredNew, x.digest);
    ProofLib.FilterMember(pBefore, j.legacy, x);
    if x.source == l.source {
      CurrentLegacyOfMember(j, [l.source], x.digest);
      assert x.digest in retiredNew;
      assert false;
    }
  }
  forall x | x in currentLegacy(after)
    ensures !jointSource(after, x.source)
      && |ProofLib.Filter((o: LegacyRecord) => (o.source == x.source), currentLegacy(after))| == 1
  {
    var pSrc := (o: LegacyRecord) => (o.source == x.source);
    ProofLib.FilterAppend(pSrc, pref, l);
    if x == l {
      ProofLib.FilterNone(pSrc, pref);
    } else {
      assert x in pref;
      ProofLib.FilterMember(pAfter, j.legacy, x);
      SetUnionMember(j.legacyRetired, retiredNew, x.digest);
      ProofLib.FilterMember(pBefore, j.legacy, x);
      assert x in currentLegacy(j);
      assert x.source != l.source;
      FilterSubseq(pAfter, pBefore, j.legacy, pSrc);
      ProofLib.FilterMember(pSrc, pref, x);
    }
  }
}

lemma AppendLegacyRetiredWereRecorded(j: Journal, l: LegacyRecord, kind: SourceKind)
  requires inv(j) && canAppendLegacy(j, l, kind)
  ensures alwaysRetiredWereRecorded(appendLegacy(j, l, kind))
{
  var after := appendLegacy(j, l, kind);
  var retiredNew := currentLegacyOf(j, [l.source]);
  AppendLegacyShape(j, l, kind);
  forall d | d in after.legacyRetired
    ensures exists x :: x in after.legacy && x.digest == d
  {
    SetUnionMember(j.legacyRetired, retiredNew, d);
    if d in j.legacyRetired {
      var x :| x in j.legacy && x.digest == d;
      assert x in after.legacy;
    } else {
      assert d in retiredNew;
      CurrentLegacyOfMember(j, [l.source], d);
      var x :| x in currentLegacy(j) && x.source in [l.source] && x.digest == d;
      CurrentLegacyFilter(j);
      ProofLib.FilterMember((y: LegacyRecord) => !((y.digest in j.legacyRetired)), j.legacy, x);
      assert x in after.legacy;
    }
  }
}

lemma appendLegacy_ensures(j: Journal, l: LegacyRecord, kind: SourceKind)
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> alwaysRecordsAreUnique(appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> alwaysOneCurrentCreditPerSource(appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> alwaysCurrentRecordsAreDisjoint(appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> alwaysPredecessorsAreRetiredAndEarlier(appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> alwaysRetiredWereRecorded(appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> stepJournalIsAppendOnly(j, appendLegacy(j, l, kind)))
  ensures (inv(j) ==> canAppendLegacy(j, l, kind) ==> stepGroupsOnlyMerge(j, appendLegacy(j, l, kind)))
{
  if inv(j) && canAppendLegacy(j, l, kind) {
    AppendLegacyOneCredit(j, l, kind);
    AppendLegacyRetiredWereRecorded(j, l, kind);
  }
}
