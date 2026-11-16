// Proofs of the Solana escrow obligations Dafny does not find on its own.

// Views of the rules that count with a filter, through ProofLib.Filter.

lemma UniqueSourcesView(awards: seq<contracts__ledger_Award>)
  ensures contracts__ledger_uniqueSources(awards) == !((exists a :: a in awards && !((|ProofLib.Filter((b: contracts__ledger_Award) => (b.source == a.source), awards)| == 1))))
{
}

lemma MonthsView(p: Program)
  ensures alwaysMonthsWellFormed(p) == !((exists m :: m in p.months && !(((((((((((((|ProofLib.Filter((o: SolMonth) => (o.period == m.period), p.months)| == 1) && contracts__ledger_validPeriod(m.period)) && (m.total > 0)) && (m.total <= m.cap)) && (m.committed >= 0)) && (m.committed <= m.total)) && (m.released >= 0)) && (m.released <= m.committed)) && (m.frozenAt > 0)) && (|m.settled| <= m.committed)) && (!(m.wholeReleased) || (((m.released == m.total) && (m.committed == m.total)) && (|m.settled| == 0)))) && !((exists s :: s in m.settled && !(((|ProofLib.Filter((o: int) => (o == s), m.settled)| == 1) && (exists l :: l in m.leaves && (l.source == s))))))))))
{
}

lemma BindingsView(p: Program)
  ensures alwaysBindingsWellFormed(p) == (!((exists b :: b in p.bindings && !((((((((((((((((((|ProofLib.Filter((o: SolBinding) => (o.actor == b.actor), p.bindings)| == 1) && (b.actor > 0)) && (b.version > 0)) && (b.network == p.network)) && (b.destination != "")) && (b.destination != "project")) && (b.destination != "vault")) && (b.destination != b.authority)) && (b.claim != 0)) && b.walletSigned) && (b.authority != "")) && (b.paidVersion >= 0)) && (b.paidVersion <= b.version)) && (b.vetoes >= 0)) && (b.vetoes <= contracts__ledger_maxCancels)) && (b.boundAt > 0)) && (b.boundAt <= p.now))))) && !((exists v :: v in p.vetoes && !((((hasBinding(p.bindings, v.actor) && (v.version > 0)) && (v.version <= bindingFor(p.bindings, v.actor).version)) && (|ProofLib.Filter((o: Veto) => (o == v), p.vetoes)| == 1))))))
{
}

// ---- Folds -------------------------------------------------------------------

// A fold that adds a weight per element starts from wherever it starts.
lemma SumFoldShift<T>(f: (int, T) -> int, w: T -> int, init: int, xs: seq<T>)
  requires forall t, a :: f(t, a) == t + w(a)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init + Std.Collections.Seq.FoldLeft(f, 0, xs)
  decreases |xs|
{
  if |xs| > 0 {
    SumFoldShift(f, w, f(init, xs[0]), xs[1..]);
    SumFoldShift(f, w, f(0, xs[0]), xs[1..]);
  }
}

// Changing one element changes the sum by the change in its weight.
lemma SumFoldChangeOne<T>(f: (int, T) -> int, w: T -> int, init: int, xs: seq<T>, ys: seq<T>, i: int)
  requires forall t, a :: f(t, a) == t + w(a)
  requires |xs| == |ys| && 0 <= i < |xs|
  requires forall j :: 0 <= j < |xs| && j != i ==> xs[j] == ys[j]
  ensures Std.Collections.Seq.FoldLeft(f, init, ys) == Std.Collections.Seq.FoldLeft(f, init, xs) + w(ys[i]) - w(xs[i])
  decreases |xs|
{
  if i == 0 {
    assert xs[1..] == ys[1..];
    SumFoldShift(f, w, f(init, xs[0]), xs[1..]);
    SumFoldShift(f, w, f(init, ys[0]), ys[1..]);
  } else {
    assert xs[0] == ys[0];
    forall j | 0 <= j < |xs[1..]| && j != i - 1
      ensures xs[1..][j] == ys[1..][j]
    {
      assert xs[j + 1] == ys[j + 1];
    }
    SumFoldChangeOne(f, w, f(init, xs[0]), xs[1..], ys[1..], i - 1);
  }
}

// A sum of weights that are never negative is at least where it starts.
lemma SumFoldNonneg<T>(f: (int, T) -> int, w: T -> int, init: int, xs: seq<T>)
  requires forall t, a :: f(t, a) == t + w(a)
  requires forall i :: 0 <= i < |xs| ==> w(xs[i]) >= 0
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) >= init
  decreases |xs|
{
  if |xs| > 0 {
    SumFoldNonneg(f, w, f(init, xs[0]), xs[1..]);
  }
}

// A fold that keeps the last matching element.
lemma LastMatchNone<T>(f: (T, T) -> T, p: T -> bool, init: T, xs: seq<T>)
  requires forall found, a :: f(found, a) == (if p(a) then a else found)
  requires forall j :: 0 <= j < |xs| ==> !p(xs[j])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
  decreases |xs|
{
  if |xs| > 0 {
    LastMatchNone(f, p, init, xs[1..]);
  }
}

lemma LastMatch<T>(f: (T, T) -> T, p: T -> bool, init: T, xs: seq<T>, i: int)
  requires forall found, a :: f(found, a) == (if p(a) then a else found)
  requires 0 <= i < |xs| && p(xs[i])
  requires forall j :: i < j < |xs| ==> !p(xs[j])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == xs[i]
  decreases |xs|
{
  if i == 0 {
    LastMatchNone(f, p, xs[0], xs[1..]);
  } else {
    LastMatch(f, p, f(init, xs[0]), xs[1..], i - 1);
  }
}

lemma LastMatchIn<T>(f: (T, T) -> T, p: T -> bool, init: T, xs: seq<T>)
  requires forall found, a :: f(found, a) == (if p(a) then a else found)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
    || (Std.Collections.Seq.FoldLeft(f, init, xs) in xs && p(Std.Collections.Seq.FoldLeft(f, init, xs)))
  decreases |xs|
{
  if |xs| > 0 {
    LastMatchIn(f, p, f(init, xs[0]), xs[1..]);
    var r := Std.Collections.Seq.FoldLeft(f, init, xs);
    if r != init && r !in xs[1..] {
      assert r == f(init, xs[0]);
    }
  }
}

lemma FilterOneIndex<T>(p: T -> bool, xs: seq<T>, i: int, j: int)
  requires |ProofLib.Filter(p, xs)| == 1
  requires 0 <= i < |xs| && 0 <= j < |xs| && p(xs[i]) && p(xs[j])
  ensures i == j
{
  if i != j {
    ProofLib.FilterTwo(p, xs, i, j);
  }
}



// ---- Fees and periods ------------------------------------------------------------

lemma FeeWithinGross(g: int)
  requires g > 0
  ensures 0 <= settlement__money_ordinaryFee(g) <= g
  ensures 0 <= settlement__money_privateSponsor(g) <= g
{
  assert settlement__money_quotient_settlement__money(g, 50) == g / 50;
  assert settlement__money_quotient_settlement__money(g, 4) == g / 4;
  var r := settlement__money_remainder_settlement__money(g, 50);
  assert r == g - 50 * (g / 50);
  if r != 0 {
    assert g / 50 < g;
  }
}

// A month from January 2000 on starts after the Unix epoch.
lemma MonthStartPositive(q: int)
  requires contracts__ledger_quotient_contracts__ledger(q, 100) >= 2000
  requires 1 <= contracts__ledger_remainder_contracts__ledger(q, 100) <= 12
  ensures contracts__ledger_monthStart(q) > 0
{
  assert q >= 0;
  var y := contracts__ledger_quotient_contracts__ledger(q, 100);
  assert y == q / 100;
  var mo := contracts__ledger_remainder_contracts__ledger(q, 100);
  var sy := if mo <= 2 then y - 1 else y;
  assert sy >= 1999;
  var era := contracts__ledger_quotient_contracts__ledger(sy, 400);
  assert era == sy / 400;
  assert era >= 4;
  var yoe := sy - era * 400;
  assert 0 <= yoe < 400;
  var doyArg := (153 * (if (mo > 2) then (mo - 3) else (mo + 9))) + 2;
  assert doyArg >= 2;
  assert contracts__ledger_quotient_contracts__ledger(doyArg, 5) == doyArg / 5;
  assert contracts__ledger_quotient_contracts__ledger(yoe, 4) == yoe / 4;
  assert contracts__ledger_quotient_contracts__ledger(yoe, 100) == yoe / 100;
  assert yoe / 4 >= yoe / 100;
  assert era * 146097 + yoe * 365 >= 365 * sy + 97 * era;
}

lemma OpensAtPositive(period: int)
  requires contracts__ledger_validPeriod(period)
  ensures contracts__ledger_opensAt(period) > 0
{
  var q := contracts__ledger_nextPeriod(period);
  assert period >= 0;
  assert contracts__ledger_quotient_contracts__ledger(period, 100) == period / 100;
  if contracts__ledger_remainder_contracts__ledger(period, 100) == 12 {
    assert q == (period / 100 + 1) * 100 + 1;
  } else {
    assert q == period + 1;
  }
  assert q >= 0;
  assert contracts__ledger_quotient_contracts__ledger(q, 100) == q / 100;
  MonthStartPositive(q);
}

// ---- Awards --------------------------------------------------------------------

lemma SourceIndexUnique(awards: seq<contracts__ledger_Award>, i: int, j: int)
  requires contracts__ledger_uniqueSources(awards)
  requires 0 <= i < |awards| && 0 <= j < |awards| && awards[i].source == awards[j].source
  ensures i == j
{
  UniqueSourcesView(awards);
  var a := awards[i];
  assert a in awards;
  FilterOneIndex((b: contracts__ledger_Award) => (b.source == a.source), awards, i, j);
}

lemma AwardForAt(awards: seq<contracts__ledger_Award>, i: int)
  requires contracts__ledger_uniqueSources(awards) && 0 <= i < |awards|
  ensures contracts__ledger_awardFor(awards, awards[i].source) == awards[i]
{
  var source := awards[i].source;
  forall j | i < j < |awards|
    ensures awards[j].source != source
  {
    if awards[j].source == source {
      SourceIndexUnique(awards, i, j);
    }
  }
  LastMatch((found: contracts__ledger_Award, a: contracts__ledger_Award) => (if (a.source == source) then a else found), (a: contracts__ledger_Award) => a.source == source, contracts__ledger_noAward, awards, i);
}

lemma AwardForSource(awards: seq<contracts__ledger_Award>, source: int) returns (i: int)
  requires contracts__ledger_uniqueSources(awards) && contracts__ledger_hasSource(awards, source)
  ensures 0 <= i < |awards| && awards[i].source == source
  ensures contracts__ledger_awardFor(awards, source) == awards[i]
  ensures forall j :: 0 <= j < |awards| && j != i ==> awards[j].source != source
{
  var a :| a in awards && a.source == source;
  i :| 0 <= i < |awards| && awards[i] == a;
  AwardForAt(awards, i);
  forall j | 0 <= j < |awards| && j != i
    ensures awards[j].source != source
  {
    if awards[j].source == source {
      SourceIndexUnique(awards, i, j);
    }
  }
}

lemma UniqueSourcesAppend(xs: seq<contracts__ledger_Award>, n: contracts__ledger_Award)
  requires contracts__ledger_uniqueSources(xs) && !contracts__ledger_hasSource(xs, n.source)
  ensures contracts__ledger_uniqueSources(xs + [n])
{
  UniqueSourcesView(xs);
  UniqueSourcesView(xs + [n]);
  forall a | a in xs + [n]
    ensures |ProofLib.Filter((b: contracts__ledger_Award) => (b.source == a.source), xs + [n])| == 1
  {
    ProofLib.FilterAppend((b: contracts__ledger_Award) => (b.source == a.source), xs, n);
    if a in xs {
      assert n.source != a.source;
    } else {
      assert a == n;
      forall i | 0 <= i < |xs|
        ensures !(xs[i].source == a.source)
      {
        assert xs[i] in xs;
      }
      ProofLib.FilterNone((b: contracts__ledger_Award) => (b.source == a.source), xs);
    }
  }
}

lemma UniqueSourcesPointwise(xs: seq<contracts__ledger_Award>, ys: seq<contracts__ledger_Award>)
  requires contracts__ledger_uniqueSources(xs)
  requires |xs| == |ys| && forall k :: 0 <= k < |xs| ==> ys[k].source == xs[k].source
  ensures contracts__ledger_uniqueSources(ys)
{
  UniqueSourcesView(xs);
  UniqueSourcesView(ys);
  forall a | a in ys
    ensures |ProofLib.Filter((b: contracts__ledger_Award) => (b.source == a.source), ys)| == 1
  {
    var k :| 0 <= k < |ys| && ys[k] == a;
    var old_ := xs[k];
    assert old_ in xs;
    ProofLib.FilterLengthPointwise((b: contracts__ledger_Award) => (b.source == a.source), (b: contracts__ledger_Award) => (b.source == old_.source), ys, xs);
  }
}

lemma AwardTotalsAppend(xs: seq<contracts__ledger_Award>, n: contracts__ledger_Award)
  requires !n.paid
  ensures contracts__ledger_unpaidPrincipal(xs + [n]) == contracts__ledger_unpaidPrincipal(xs) + n.gross - n.fee
  ensures contracts__ledger_unpaidFees(xs + [n]) == contracts__ledger_unpaidFees(xs) + n.fee
  ensures contracts__ledger_paidPrincipal(xs + [n]) == contracts__ledger_paidPrincipal(xs)
  ensures contracts__ledger_paidFees(xs + [n]) == contracts__ledger_paidFees(xs)
{
  ProofLib.FoldLeftAppend((t: int, a: contracts__ledger_Award) => (if a.paid then t else ((t + a.gross) - a.fee)), 0, xs, n);
  ProofLib.FoldLeftAppend((t: int, a: contracts__ledger_Award) => (if a.paid then t else (t + a.fee)), 0, xs, n);
  ProofLib.FoldLeftAppend((t: int, a: contracts__ledger_Award) => (if a.paid then ((t + a.gross) - a.fee) else t), 0, xs, n);
  ProofLib.FoldLeftAppend((t: int, a: contracts__ledger_Award) => (if a.paid then (t + a.fee) else t), 0, xs, n);
}

lemma AwardNet(p: Program, a: contracts__ledger_Award)
  requires alwaysAwardsWellFormed(p) && a in p.awards
  ensures 0 <= a.fee <= a.gross
{
  FeeWithinGross(a.gross);
}

lemma UnpaidNonneg(p: Program)
  requires alwaysAwardsWellFormed(p)
  ensures contracts__ledger_unpaidPrincipal(p.awards) >= 0
  ensures contracts__ledger_unpaidFees(p.awards) >= 0
{
  var xs := p.awards;
  forall i | 0 <= i < |xs|
    ensures (if xs[i].paid then 0 else xs[i].gross - xs[i].fee) >= 0 && (if xs[i].paid then 0 else xs[i].fee) >= 0
  {
    assert xs[i] in xs;
    AwardNet(p, xs[i]);
  }
  SumFoldNonneg((t: int, a: contracts__ledger_Award) => (if a.paid then t else ((t + a.gross) - a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.gross - a.fee), 0, xs);
  SumFoldNonneg((t: int, a: contracts__ledger_Award) => (if a.paid then t else (t + a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.fee), 0, xs);
}

lemma PaidLiveFromOld(before: Program, after: Program)
  requires contracts__ledger_uniqueSources(before.awards)
  requires forall a :: a in after.awards && a.paid ==> a in before.awards
  ensures stepPaidToLiveBinding(before, after)
{
  forall a | a in after.awards && a.paid
    ensures contracts__ledger_awardFor(before.awards, a.source).paid
  {
    var i :| 0 <= i < |before.awards| && before.awards[i] == a;
    AwardForAt(before.awards, i);
  }
}

lemma SameAwards(before: Program, after: Program)
  requires alwaysAwardsWellFormed(before)
  requires after.awards == before.awards
  ensures stepPaidToLiveBinding(before, after)
  ensures stepAwardsRetained(before, after)
{
  PaidLiveFromOld(before, after);
  forall a | a in before.awards
    ensures a in after.awards
  {
  }
}

// A transition that keeps the awards and the purpose, and does not move the clock back, keeps them well formed.
lemma AwardsFrame(before: Program, after: Program)
  requires alwaysAwardsWellFormed(before)
  requires after.awards == before.awards && after.now >= before.now
  requires after.purpose == before.purpose || before.awards == []
  ensures alwaysAwardsWellFormed(after)
{
  UniqueSourcesView([]);
}

lemma MonthsFrame(before: Program, after: Program)
  requires alwaysMonthsWellFormed(before) && after.months == before.months
  ensures alwaysMonthsWellFormed(after)
{
}

lemma BindingsFrame(before: Program, after: Program)
  requires alwaysBindingsWellFormed(before)
  requires after.bindings == before.bindings && after.vetoes == before.vetoes
  requires after.network == before.network && after.now >= before.now
  ensures alwaysBindingsWellFormed(after)
{
}

// A transition that keeps the months keeps every month it had.
lemma MonthsSame(before: Program, after: Program)
  requires after.months == before.months
  ensures stepMonthsRetained(before, after)
{
  forall m | m in before.months
    ensures m in after.months
  {
  }
}

// A transition that keeps the bindings adds no binding.
lemma BindingsSame(before: Program, after: Program)
  requires after.bindings == before.bindings
  ensures stepNewBindingAttested(before, after)
{
  forall b | b in after.bindings
    ensures b in before.bindings
  {
  }
}

// The bindings after bindWallet: well formed, and the new version attested.
lemma BindWalletBindings(p: Program, actor: int, network: string, expectedVersion: int, claim: int, expiresAt: int, destination: string, walletSigned: bool, by_: string)
  requires inv(p) && canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)
  ensures alwaysBindingsWellFormed(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_))
  ensures stepNewBindingAttested(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_))
{
  var after := bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_);
  var old_ := bindingFor(p.bindings, actor);
  BindingForFound(p.bindings, actor);
  if old_ != noSolBinding {
    assert old_ in p.bindings;
  }
  if hasBinding(p.bindings, actor) {
    var j :| 0 <= j < |p.bindings| && p.bindings[j].actor == actor;
    BindingForAt(p, j);
  }
  BindingsView(p);
  var nb := old_.(actor := actor, network := network, authority := by_, destination := destination, claim := claim, version := (expectedVersion + 1), boundAt := p.now, walletSigned := true);
  ReplaceBinding(p, after, nb);
  ReplaceBindingAttested(p, after, nb);
}

// The bindings after vetoBinding: well formed, and the new version attested.
lemma VetoBindingBindings(p: Program, actor: int, version: int, obligation: int, by_: string)
  requires inv(p) && canVetoBinding(p, actor, version, obligation, by_)
  ensures alwaysBindingsWellFormed(vetoBinding(p, actor, version, obligation, by_))
  ensures stepNewBindingAttested(p, vetoBinding(p, actor, version, obligation, by_))
{
  var after := vetoBinding(p, actor, version, obligation, by_);
  var j :| 0 <= j < |p.bindings| && p.bindings[j].actor == actor;
  BindingForAt(p, j);
  var b := p.bindings[j];
  assert b in p.bindings;
  BindingsView(p);
  VetoAppend(p.vetoes, Veto(actor, version));
  var nb := b.(vetoes := contracts__ledger_cancelsAfter(b.vetoes, ((p.pendingIdentity != "") && p.rotationConfirmed)));
  ReplaceBinding(p, after, nb);
  ReplaceBindingAttested(p, after, nb);
}

lemma RecordAward(before: Program, after: Program, n: contracts__ledger_Award)
  requires alwaysClockStarted(before) && alwaysAwardsWellFormed(before)
  requires after.awards == before.awards + [n]
  requires after.purpose == before.purpose && after.now == before.now
  requires !contracts__ledger_hasSource(before.awards, n.source)
  requires n.actor > 0 && contracts__ledger_awardGrossAdmissible(before.purpose, n.gross)
  requires n.fee == contracts__ledger_awardFee(before.purpose, n.gross)
  requires n.committedAt == before.now && !n.paid && n.paidVersion == 0
  ensures alwaysAwardsWellFormed(after)
  ensures contracts__ledger_unpaidPrincipal(after.awards) + contracts__ledger_unpaidFees(after.awards)
    == contracts__ledger_unpaidPrincipal(before.awards) + contracts__ledger_unpaidFees(before.awards) + n.gross
  ensures contracts__ledger_paidPrincipal(after.awards) == contracts__ledger_paidPrincipal(before.awards)
  ensures contracts__ledger_paidFees(after.awards) == contracts__ledger_paidFees(before.awards)
  ensures stepPaidToLiveBinding(before, after)
  ensures stepAwardsRetained(before, after)
{
  UniqueSourcesAppend(before.awards, n);
  AwardTotalsAppend(before.awards, n);
  PaidLiveFromOld(before, after);
  forall a | a in before.awards
    ensures a in after.awards
  {
  }
}

// ---- Bindings ------------------------------------------------------------------

lemma BindingActorUnique(p: Program, i: int, j: int)
  requires alwaysBindingsWellFormed(p)
  requires 0 <= i < |p.bindings| && 0 <= j < |p.bindings|
  requires p.bindings[i].actor == p.bindings[j].actor
  ensures i == j
{
  BindingsView(p);
  var b := p.bindings[i];
  assert b in p.bindings;
  FilterOneIndex((o: SolBinding) => (o.actor == b.actor), p.bindings, i, j);
}

lemma BindingForFound(bs: seq<SolBinding>, actor: int)
  ensures bindingFor(bs, actor) == noSolBinding || (bindingFor(bs, actor) in bs && bindingFor(bs, actor).actor == actor)
{
  LastMatchIn((found: SolBinding, b: SolBinding) => (if (b.actor == actor) then b else found), (b: SolBinding) => b.actor == actor, noSolBinding, bs);
}

lemma BindingForAt(p: Program, i: int)
  requires alwaysBindingsWellFormed(p) && 0 <= i < |p.bindings|
  ensures bindingFor(p.bindings, p.bindings[i].actor) == p.bindings[i]
{
  var bs := p.bindings;
  var actor := bs[i].actor;
  forall j | i < j < |bs|
    ensures bs[j].actor != actor
  {
    if bs[j].actor == actor {
      BindingActorUnique(p, i, j);
    }
  }
  LastMatch((found: SolBinding, b: SolBinding) => (if (b.actor == actor) then b else found), (b: SolBinding) => b.actor == actor, noSolBinding, bs, i);
}

lemma BindingForNone(bs: seq<SolBinding>, actor: int)
  requires !hasBinding(bs, actor)
  ensures bindingFor(bs, actor) == noSolBinding
{
  forall j | 0 <= j < |bs|
    ensures !(bs[j].actor == actor)
  {
    assert bs[j] in bs;
  }
  LastMatchNone((found: SolBinding, b: SolBinding) => (if (b.actor == actor) then b else found), (b: SolBinding) => b.actor == actor, noSolBinding, bs);
}

// Replacing or adding the binding of one actor: the bindings stay one per
// actor and well formed, and every actor's binding is the new one or as before.
lemma ReplaceBinding(p: Program, after: Program, nb: SolBinding)
  requires alwaysBindingsWellFormed(p)
  requires after.bindings == withBinding(p.bindings, nb)
  requires after.now >= p.now && after.network == p.network
  requires nb.actor > 0 && nb.version > 0 && nb.network == p.network && nb.destination != "" && nb.destination != "project"
    && nb.destination != "vault" && nb.destination != nb.authority && nb.claim != 0 && nb.walletSigned && nb.authority != ""
    && nb.paidVersion >= 0 && nb.paidVersion <= nb.version && nb.vetoes >= 0 && nb.vetoes <= contracts__ledger_maxCancels
    && nb.boundAt > 0 && nb.boundAt <= after.now
  requires hasBinding(p.bindings, nb.actor) ==> nb.version >= bindingFor(p.bindings, nb.actor).version
  requires forall v :: v in after.vetoes ==> v in p.vetoes || (v.actor == nb.actor && 0 < v.version <= nb.version)
  requires forall v :: v in after.vetoes ==> |ProofLib.Filter((o: Veto) => (o == v), after.vetoes)| == 1
  ensures alwaysBindingsWellFormed(after)
  ensures forall b :: b in after.bindings ==> b == nb || b in p.bindings
{
  var bs := p.bindings;
  var ys := after.bindings;
  BindingsView(p);
  BindingsView(after);
  if hasBinding(bs, nb.actor) {
    assert |ys| == |bs|;
    forall k | 0 <= k < |ys|
      ensures ys[k].actor == bs[k].actor
      ensures ys[k] == nb || ys[k] == bs[k]
      ensures bs[k].actor != nb.actor ==> ys[k] == bs[k]
    {
    }
    forall b | b in ys
      ensures |ProofLib.Filter((o: SolBinding) => (o.actor == b.actor), ys)| == 1
    {
      var k :| 0 <= k < |ys| && ys[k] == b;
      var old_ := bs[k];
      assert old_ in bs;
      ProofLib.FilterLengthPointwise((o: SolBinding) => (o.actor == b.actor), (o: SolBinding) => (o.actor == old_.actor), ys, bs);
    }
    forall b | b in ys
      ensures b == nb || b in bs
    {
      var k :| 0 <= k < |ys| && ys[k] == b;
    }
  } else {
    assert ys == bs + [nb];
    forall b | b in ys
      ensures |ProofLib.Filter((o: SolBinding) => (o.actor == b.actor), ys)| == 1
    {
      ProofLib.FilterAppend((o: SolBinding) => (o.actor == b.actor), bs, nb);
      if b in bs {
        assert nb.actor != b.actor;
      } else {
        assert b == nb;
        forall i | 0 <= i < |bs|
          ensures !(bs[i].actor == b.actor)
        {
          assert bs[i] in bs;
        }
        ProofLib.FilterNone((o: SolBinding) => (o.actor == b.actor), bs);
      }
    }
  }
  assert nb in ys;
  forall v | v in after.vetoes
    ensures hasBinding(ys, v.actor) && v.version > 0 && v.version <= bindingFor(ys, v.actor).version
  {
    if v.actor == nb.actor {
      var k :| 0 <= k < |ys| && ys[k] == nb;
      YsIndex(ys, k);
      if v in p.vetoes {
        var j :| 0 <= j < |bs| && bs[j].actor == v.actor;
        BindingForAt(p, j);
      }
    } else {
      assert v in p.vetoes;
      var j :| 0 <= j < |bs| && bs[j].actor == v.actor;
      BindingForAt(p, j);
      assert ys[j] == bs[j];
      YsIndex(ys, j);
    }
  }
}

// In bindings that hold one per actor, the fold finds each actor's binding.
lemma YsIndex(ys: seq<SolBinding>, k: int)
  requires 0 <= k < |ys|
  requires forall b :: b in ys ==> |ProofLib.Filter((o: SolBinding) => (o.actor == b.actor), ys)| == 1
  ensures bindingFor(ys, ys[k].actor) == ys[k]
{
  var actor := ys[k].actor;
  var bk := ys[k];
  assert bk in ys;
  forall j | k < j < |ys|
    ensures ys[j].actor != actor
  {
    if ys[j].actor == actor {
      FilterOneIndex((o: SolBinding) => (o.actor == bk.actor), ys, k, j);
    }
  }
  LastMatch((found: SolBinding, b: SolBinding) => (if (b.actor == actor) then b else found), (b: SolBinding) => b.actor == actor, noSolBinding, ys, k);
}

lemma ReplaceBindingAttested(p: Program, after: Program, nb: SolBinding)
  requires forall b :: b in after.bindings ==> b == nb || b in p.bindings
  requires (exists o :: o in p.bindings && o.actor == nb.actor && o.version == nb.version)
    || (nb.authority == p.identityAuthority && nb.walletSigned)
  ensures stepNewBindingAttested(p, after)
{
  forall b | b in after.bindings
    ensures (exists o :: o in p.bindings && ((o.actor == b.actor) && (o.version == b.version)))
      || ((b.authority == p.identityAuthority) && b.walletSigned)
  {
    if b != nb {
      assert b in p.bindings;
    }
  }
}

// ---- Months --------------------------------------------------------------------

lemma MonthPeriodUnique(p: Program, i: int, j: int)
  requires alwaysMonthsWellFormed(p)
  requires 0 <= i < |p.months| && 0 <= j < |p.months|
  requires p.months[i].period == p.months[j].period
  ensures i == j
{
  MonthsView(p);
  var m := p.months[i];
  assert m in p.months;
  FilterOneIndex((o: SolMonth) => (o.period == m.period), p.months, i, j);
}

lemma MonthForIndex(p: Program, period: int) returns (i: int)
  requires alwaysMonthsWellFormed(p) && hasMonth(p.months, period)
  ensures 0 <= i < |p.months| && p.months[i].period == period
  ensures monthFor(p.months, period) == p.months[i]
  ensures forall j :: 0 <= j < |p.months| && j != i ==> p.months[j].period != period
{
  var ms := p.months;
  var m0 :| m0 in ms && m0.period == period;
  i :| 0 <= i < |ms| && ms[i] == m0;
  forall j | 0 <= j < |ms| && j != i
    ensures ms[j].period != period
  {
    if ms[j].period == period {
      MonthPeriodUnique(p, i, j);
    }
  }
  LastMatch((found: SolMonth, m: SolMonth) => (if (m.period == period) then m else found), (m: SolMonth) => m.period == period, noSolMonth, ms, i);
}

lemma SumUnsettledNonneg(ms: seq<SolMonth>)
  requires forall m :: m in ms ==> m.total - m.committed >= 0
  ensures sumUnsettled(ms) >= 0
{
  forall i | 0 <= i < |ms|
    ensures ms[i].total - ms[i].committed >= 0
  {
    assert ms[i] in ms;
  }
  SumFoldNonneg((t: int, m: SolMonth) => ((t + m.total) - m.committed), (m: SolMonth) => m.total - m.committed, 0, ms);
}

lemma ReplaceMonth(p: Program, after: Program, i: int, nm: SolMonth)
  requires alwaysMonthsWellFormed(p) && 0 <= i < |p.months|
  requires p.months[i].period == nm.period
  requires after.months == withMonth(p.months, nm)
  requires contracts__ledger_validPeriod(nm.period) && nm.total > 0 && nm.total <= nm.cap && nm.committed >= 0
    && nm.committed <= nm.total && nm.released >= 0 && nm.released <= nm.committed && nm.frozenAt > 0
    && |nm.settled| <= nm.committed
    && (!nm.wholeReleased || (nm.released == nm.total && nm.committed == nm.total && |nm.settled| == 0))
    && (forall s :: s in nm.settled ==> |ProofLib.Filter((o: int) => (o == s), nm.settled)| == 1 && (exists l :: l in nm.leaves && l.source == s))
  requires nm.root == p.months[i].root && nm.total == p.months[i].total && nm.frozenAt == p.months[i].frozenAt
    && nm.leaves == p.months[i].leaves && nm.committed >= p.months[i].committed && nm.released >= p.months[i].released
    && (forall s :: s in p.months[i].settled ==> s in nm.settled)
  ensures alwaysMonthsWellFormed(after)
  ensures sumUnsettled(after.months) == sumUnsettled(p.months) + (nm.total - nm.committed) - (p.months[i].total - p.months[i].committed)
  ensures sumUnsettled(after.months) >= 0
  ensures stepMonthsRetained(p, after)
{
  var ms := p.months;
  var ys := after.months;
  MonthsView(p);
  MonthsView(after);
  assert |ys| == |ms|;
  forall j | 0 <= j < |ms| && j != i
    ensures ms[j].period != nm.period
  {
    if ms[j].period == nm.period {
      MonthPeriodUnique(p, i, j);
    }
  }
  forall k | 0 <= k < |ys|
    ensures ys[k].period == ms[k].period
    ensures k == i ==> ys[k] == nm
    ensures k != i ==> ys[k] == ms[k]
  {
  }
  forall m | m in ys
    ensures |ProofLib.Filter((o: SolMonth) => (o.period == m.period), ys)| == 1
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    var old_ := ms[k];
    assert old_ in ms;
    ProofLib.FilterLengthPointwise((o: SolMonth) => (o.period == m.period), (o: SolMonth) => (o.period == old_.period), ys, ms);
  }
  SumFoldChangeOne((t: int, m: SolMonth) => ((t + m.total) - m.committed), (m: SolMonth) => m.total - m.committed, 0, ms, ys, i);
  forall m | m in ys
    ensures m.total - m.committed >= 0
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    assert ms[k] in ms;
  }
  SumUnsettledNonneg(ys);
  forall m | m in ms
    ensures exists o :: (o in ys && o.period == m.period && o.root == m.root && o.total == m.total && o.frozenAt == m.frozenAt
      && o.leaves == m.leaves && o.committed >= m.committed && o.released >= m.released && (forall s :: s in m.settled ==> s in o.settled))
  {
    var k :| 0 <= k < |ms| && ms[k] == m;
    assert ys[k] in ys;
  }
}

lemma AppendMonth(p: Program, after: Program, nm: SolMonth)
  requires alwaysMonthsWellFormed(p)
  requires !hasMonth(p.months, nm.period)
  requires after.months == p.months + [nm]
  requires contracts__ledger_validPeriod(nm.period) && nm.total > 0 && nm.total <= nm.cap && nm.committed == 0
    && nm.released == 0 && nm.frozenAt > 0 && !nm.wholeReleased && nm.settled == []
  ensures alwaysMonthsWellFormed(after)
  ensures sumUnsettled(after.months) == sumUnsettled(p.months) + nm.total
  ensures stepMonthsRetained(p, after)
{
  var ms := p.months;
  var ys := after.months;
  MonthsView(p);
  MonthsView(after);
  forall m | m in ys
    ensures |ProofLib.Filter((o: SolMonth) => (o.period == m.period), ys)| == 1
  {
    ProofLib.FilterAppend((o: SolMonth) => (o.period == m.period), ms, nm);
    if m in ms {
      assert nm.period != m.period;
    } else {
      assert m == nm;
      forall i | 0 <= i < |ms|
        ensures !(ms[i].period == m.period)
      {
        assert ms[i] in ms;
      }
      ProofLib.FilterNone((o: SolMonth) => (o.period == m.period), ms);
    }
  }
  ProofLib.FoldLeftAppend((t: int, m: SolMonth) => ((t + m.total) - m.committed), 0, ms, nm);
  forall m | m in ms
    ensures m in ys
  {
  }
}

lemma SettledAppend(settled: seq<int>, s0: int)
  requires forall s :: s in settled ==> |ProofLib.Filter((o: int) => (o == s), settled)| == 1
  requires s0 !in settled
  ensures forall s :: s in settled + [s0] ==> |ProofLib.Filter((o: int) => (o == s), settled + [s0])| == 1
{
  forall s | s in settled + [s0]
    ensures |ProofLib.Filter((o: int) => (o == s), settled + [s0])| == 1
  {
    ProofLib.FilterAppend((o: int) => (o == s), settled, s0);
    if s in settled {
      assert s0 != s;
    } else {
      forall i | 0 <= i < |settled|
        ensures !(settled[i] == s)
      {
        assert settled[i] in settled;
      }
      ProofLib.FilterNone((o: int) => (o == s), settled);
    }
  }
}

// The month a settled leaf moves: one more source settled and its gross committed.
lemma SettleMonth(p: Program, after: Program, period: int, leaf: contracts__ledger_Leaf, released: int)
  requires alwaysMonthsWellFormed(p) && settleable(p, period, leaf)
  requires leaf.gross > 0 && (released == 0 || released == leaf.gross)
  requires after.months == settledMonths(p, period, leaf, released)
  ensures alwaysMonthsWellFormed(after)
  ensures sumUnsettled(after.months) == sumUnsettled(p.months) - leaf.gross
  ensures sumUnsettled(after.months) >= 0
  ensures stepMonthsRetained(p, after)
{
  var i := MonthForIndex(p, period);
  var m := p.months[i];
  MonthsView(p);
  assert m in p.months;
  assert !m.wholeReleased;
  SettledAppend(m.settled, leaf.source);
  var nm := m.(committed := (m.committed + leaf.gross), released := (m.released + released), settled := (m.settled + [leaf.source]));
  forall s | s in nm.settled
    ensures exists l :: l in nm.leaves && l.source == s
  {
    if s == leaf.source {
      assert leaf in nm.leaves;
    } else {
      assert s in m.settled;
    }
  }
  ReplaceMonth(p, after, i, nm);
}


lemma VetoAppend(vs: seq<Veto>, v0: Veto)
  requires forall v :: v in vs ==> |ProofLib.Filter((o: Veto) => (o == v), vs)| == 1
  requires v0 !in vs
  ensures forall v :: v in vs + [v0] ==> |ProofLib.Filter((o: Veto) => (o == v), vs + [v0])| == 1
{
  forall v | v in vs + [v0]
    ensures |ProofLib.Filter((o: Veto) => (o == v), vs + [v0])| == 1
  {
    ProofLib.FilterAppend((o: Veto) => (o == v), vs, v0);
    if v in vs {
      assert v0 != v;
    } else {
      forall i | 0 <= i < |vs|
        ensures !(vs[i] == v)
      {
        assert vs[i] in vs;
      }
      ProofLib.FilterNone((o: Veto) => (o == v), vs);
    }
  }
}

lemma PaidOutFacts(p: Program, source: int, expectedVersion: int, destination: string)
  requires inv(p) && payable(p, source, expectedVersion, destination)
  ensures alwaysReservedMatches(paidOut(source, p))
  ensures alwaysPaidMatches(paidOut(source, p))
  ensures alwaysAwardsWellFormed(paidOut(source, p))
  ensures alwaysNonnegative(paidOut(source, p))
  ensures alwaysVaultCovers(paidOut(source, p))
  ensures alwaysBindingsWellFormed(paidOut(source, p))
  ensures stepNewBindingAttested(p, paidOut(source, p))
  ensures stepAwardsRetained(p, paidOut(source, p))
  ensures stepPaidToLiveBinding(p, paidOut(source, p))
  ensures paidOut(source, p).months == p.months && paidOut(source, p).monthlyOutstanding == p.monthlyOutstanding
{
  var after := paidOut(source, p);
  var xs := p.awards;
  var i := AwardForSource(xs, source);
  var chosen := xs[i];
  var bs := p.bindings;
  var b := bindingFor(bs, chosen.actor);
  var bj :| 0 <= bj < |bs| && bs[bj].actor == chosen.actor;
  BindingForAt(p, bj);
  assert b == bs[bj] && b in bs;
  var ys := after.awards;
  assert ys == contracts__ledger_markPaid(xs, source, b.destination, b.version);
  var paidOne := chosen.(paid := true, paidTo := b.destination, paidVersion := b.version);
  assert |ys| == |xs|;
  assert ys[i] == paidOne;
  forall j | 0 <= j < |xs| && j != i
    ensures ys[j] == xs[j]
  {
  }
  assert chosen in xs;
  AwardNet(p, chosen);
  SumFoldChangeOne((t: int, a: contracts__ledger_Award) => (if a.paid then t else ((t + a.gross) - a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.gross - a.fee), 0, xs, ys, i);
  SumFoldChangeOne((t: int, a: contracts__ledger_Award) => (if a.paid then t else (t + a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.fee), 0, xs, ys, i);
  SumFoldChangeOne((t: int, a: contracts__ledger_Award) => (if a.paid then ((t + a.gross) - a.fee) else t), (a: contracts__ledger_Award) => (if a.paid then a.gross - a.fee else 0), 0, xs, ys, i);
  SumFoldChangeOne((t: int, a: contracts__ledger_Award) => (if a.paid then (t + a.fee) else t), (a: contracts__ledger_Award) => (if a.paid then a.fee else 0), 0, xs, ys, i);
  UniqueSourcesPointwise(xs, ys);
  forall c | c in ys
    ensures c == paidOne || c in xs
  {
    var k :| 0 <= k < |ys| && ys[k] == c;
  }
  assert alwaysAwardsWellFormed(after);
  UnpaidNonneg(after);
  BindingsView(p);
  var nb := b.(paidVersion := b.version, vetoes := 0);
  ReplaceBinding(p, after, nb);
  ReplaceBindingAttested(p, after, nb);
  forall c | c in ys && c.paid
    ensures contracts__ledger_awardFor(xs, c.source).paid || paidThroughBinding(p, c)
  {
    var k :| 0 <= k < |ys| && ys[k] == c;
    if k == i {
      assert paidThroughBinding(p, c);
    } else {
      assert c == xs[k];
      AwardForAt(xs, k);
    }
  }
  forall c | c in xs
    ensures exists d :: (d in ys && d.source == c.source && d.actor == c.actor && d.gross == c.gross && d.fee == c.fee
      && d.committedAt == c.committedAt && (!c.paid || d == c))
  {
    var k :| 0 <= k < |xs| && xs[k] == c;
    assert ys[k] in ys;
  }
}

lemma InitialIs()
  ensures initialHolds() == initial
{
}

lemma EmptyTotals()
  ensures contracts__ledger_unpaidPrincipal([]) == 0 && contracts__ledger_unpaidFees([]) == 0
  ensures contracts__ledger_paidPrincipal([]) == 0 && contracts__ledger_paidFees([]) == 0
  ensures sumUnsettled([]) == 0
{
}

lemma Initial_alwaysConfigSeparate()
  ensures alwaysConfigSeparate(initial)
{
}

lemma Initial_alwaysClockStarted()
  ensures alwaysClockStarted(initial)
{
}

lemma Initial_alwaysAdmittedAsset()
  ensures alwaysAdmittedAsset(initial)
{
}

lemma Initial_alwaysProjectShape()
  ensures alwaysProjectShape(initial)
{
}

lemma Initial_alwaysRotationSeparate()
  ensures alwaysRotationSeparate(initial)
{
}

lemma Initial_alwaysFeesAccounted()
  ensures alwaysFeesAccounted(initial)
{
}

lemma Initial_alwaysNonnegative()
  ensures alwaysNonnegative(initial)
{
}

lemma Initial_alwaysVaultCovers()
  ensures alwaysVaultCovers(initial)
{
}

lemma Initial_alwaysReservedMatches()
  ensures alwaysReservedMatches(initial)
{
}

lemma Initial_alwaysPaidMatches()
  ensures alwaysPaidMatches(initial)
{
}

lemma Initial_alwaysAwardsWellFormed()
  ensures alwaysAwardsWellFormed(initial)
{
  assert initial.awards == [];
  UniqueSourcesView([]);
}

lemma Initial_alwaysMonthsWellFormed()
  ensures alwaysMonthsWellFormed(initial)
{
  assert initial.months == [];
  MonthsView(initial);
}

lemma Initial_alwaysOutstandingMatchesMonths()
  ensures alwaysOutstandingMatchesMonths(initial)
{
  assert initial.months == [];
  assert initial.monthlyOutstanding == 0;
  assert sumUnsettled([]) == 0;
}

lemma Initial_alwaysBountyHasNoMonthly()
  ensures alwaysBountyHasNoMonthly(initial)
{
}

lemma Initial_alwaysBindingsWellFormed()
  ensures alwaysBindingsWellFormed(initial)
{
  assert initial.bindings == [] && initial.vetoes == [];
  BindingsView(initial);
}

lemma upgradeProgram_ensures(p: Program, by_: string)
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysConfigSeparate(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysClockStarted(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysAdmittedAsset(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysProjectShape(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysRotationSeparate(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysFeesAccounted(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysNonnegative(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysVaultCovers(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysReservedMatches(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysPaidMatches(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysAwardsWellFormed(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysMonthsWellFormed(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysOutstandingMatchesMonths(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysBountyHasNoMonthly(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> alwaysBindingsWellFormed(upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepProjectFixed(p, upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepAuthorityChanges(p, "upgradeProgram", upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepAwardsRetained(p, upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "upgradeProgram", upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepMonthsRetained(p, upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepNewBindingAttested(p, upgradeProgram(p, by_)))
  ensures (inv(p) ==> canUpgradeProgram(p, by_) ==> stepPaidToLiveBinding(p, upgradeProgram(p, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canUpgradeProgram, upgradeProgram, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canUpgradeProgram(p, by_) {
    var after := upgradeProgram(p, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma setUpgradeAuthority_ensures(p: Program, successor: string, by_: string)
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysConfigSeparate(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysClockStarted(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysAdmittedAsset(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysProjectShape(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysRotationSeparate(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysFeesAccounted(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysNonnegative(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysVaultCovers(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysReservedMatches(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysPaidMatches(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysAwardsWellFormed(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysMonthsWellFormed(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysOutstandingMatchesMonths(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysBountyHasNoMonthly(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> alwaysBindingsWellFormed(setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepProjectFixed(p, setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepAuthorityChanges(p, "setUpgradeAuthority", setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepAwardsRetained(p, setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "setUpgradeAuthority", setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepMonthsRetained(p, setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepNewBindingAttested(p, setUpgradeAuthority(p, successor, by_)))
  ensures (inv(p) ==> canSetUpgradeAuthority(p, successor, by_) ==> stepPaidToLiveBinding(p, setUpgradeAuthority(p, successor, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canSetUpgradeAuthority, setUpgradeAuthority, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canSetUpgradeAuthority(p, successor, by_) {
    var after := setUpgradeAuthority(p, successor, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma initializeConfig_ensures(p: Program, identity: string, feeRecipient: string, rotation: string, by_: string)
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysConfigSeparate(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysClockStarted(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysAdmittedAsset(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysProjectShape(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysRotationSeparate(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysFeesAccounted(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysNonnegative(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysVaultCovers(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysReservedMatches(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysPaidMatches(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysAwardsWellFormed(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysMonthsWellFormed(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysOutstandingMatchesMonths(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysBountyHasNoMonthly(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> alwaysBindingsWellFormed(initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepProjectFixed(p, initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepAuthorityChanges(p, "initializeConfig", initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepAwardsRetained(p, initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "initializeConfig", initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepMonthsRetained(p, initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepNewBindingAttested(p, initializeConfig(p, identity, feeRecipient, rotation, by_)))
  ensures (inv(p) ==> canInitializeConfig(p, identity, feeRecipient, rotation, by_) ==> stepPaidToLiveBinding(p, initializeConfig(p, identity, feeRecipient, rotation, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canInitializeConfig, initializeConfig, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canInitializeConfig(p, identity, feeRecipient, rotation, by_) {
    var after := initializeConfig(p, identity, feeRecipient, rotation, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma tick_ensures(p: Program, timestamp: int)
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysConfigSeparate(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysClockStarted(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysAdmittedAsset(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysProjectShape(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysRotationSeparate(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysFeesAccounted(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysNonnegative(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysVaultCovers(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysReservedMatches(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysPaidMatches(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysAwardsWellFormed(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysMonthsWellFormed(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysOutstandingMatchesMonths(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysBountyHasNoMonthly(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> alwaysBindingsWellFormed(tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepProjectFixed(p, tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepAuthorityChanges(p, "tick", tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepAwardsRetained(p, tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepFreeSpentByOwnerOrAttestation(p, "tick", tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepMonthsRetained(p, tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepNewBindingAttested(p, tick(p, timestamp)))
  ensures (inv(p) ==> canTick(p, timestamp) ==> stepPaidToLiveBinding(p, tick(p, timestamp)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canTick, tick, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canTick(p, timestamp) {
    var after := tick(p, timestamp);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma proposeAuthorityRotation_ensures(p: Program, successor: string, by_: string)
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysConfigSeparate(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysClockStarted(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysAdmittedAsset(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysProjectShape(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysRotationSeparate(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysFeesAccounted(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysNonnegative(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysVaultCovers(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysReservedMatches(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysPaidMatches(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysAwardsWellFormed(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysMonthsWellFormed(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysOutstandingMatchesMonths(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysBountyHasNoMonthly(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> alwaysBindingsWellFormed(proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepProjectFixed(p, proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepAuthorityChanges(p, "proposeAuthorityRotation", proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepAwardsRetained(p, proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "proposeAuthorityRotation", proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepMonthsRetained(p, proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepNewBindingAttested(p, proposeAuthorityRotation(p, successor, by_)))
  ensures (inv(p) ==> canProposeAuthorityRotation(p, successor, by_) ==> stepPaidToLiveBinding(p, proposeAuthorityRotation(p, successor, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canProposeAuthorityRotation, proposeAuthorityRotation, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canProposeAuthorityRotation(p, successor, by_) {
    var after := proposeAuthorityRotation(p, successor, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma confirmAuthorityRotation_ensures(p: Program, by_: string)
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysConfigSeparate(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysClockStarted(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysAdmittedAsset(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysProjectShape(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysRotationSeparate(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysFeesAccounted(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysNonnegative(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysVaultCovers(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysReservedMatches(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysPaidMatches(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysAwardsWellFormed(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysMonthsWellFormed(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysOutstandingMatchesMonths(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysBountyHasNoMonthly(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> alwaysBindingsWellFormed(confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepProjectFixed(p, confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepAuthorityChanges(p, "confirmAuthorityRotation", confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepAwardsRetained(p, confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "confirmAuthorityRotation", confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepMonthsRetained(p, confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepNewBindingAttested(p, confirmAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canConfirmAuthorityRotation(p, by_) ==> stepPaidToLiveBinding(p, confirmAuthorityRotation(p, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canConfirmAuthorityRotation, confirmAuthorityRotation, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canConfirmAuthorityRotation(p, by_) {
    var after := confirmAuthorityRotation(p, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma cancelAuthorityRotation_ensures(p: Program, by_: string)
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysConfigSeparate(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysClockStarted(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysAdmittedAsset(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysProjectShape(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysRotationSeparate(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysFeesAccounted(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysNonnegative(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysVaultCovers(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysReservedMatches(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysPaidMatches(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysAwardsWellFormed(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysMonthsWellFormed(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysOutstandingMatchesMonths(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysBountyHasNoMonthly(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> alwaysBindingsWellFormed(cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepProjectFixed(p, cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepAuthorityChanges(p, "cancelAuthorityRotation", cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepAwardsRetained(p, cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "cancelAuthorityRotation", cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepMonthsRetained(p, cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepNewBindingAttested(p, cancelAuthorityRotation(p, by_)))
  ensures (inv(p) ==> canCancelAuthorityRotation(p, by_) ==> stepPaidToLiveBinding(p, cancelAuthorityRotation(p, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canCancelAuthorityRotation, cancelAuthorityRotation, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canCancelAuthorityRotation(p, by_) {
    var after := cancelAuthorityRotation(p, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma executeAuthorityRotation_ensures(p: Program)
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysConfigSeparate(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysClockStarted(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysAdmittedAsset(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysProjectShape(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysRotationSeparate(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysFeesAccounted(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysNonnegative(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysVaultCovers(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysReservedMatches(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysPaidMatches(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysAwardsWellFormed(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysMonthsWellFormed(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysOutstandingMatchesMonths(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysBountyHasNoMonthly(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> alwaysBindingsWellFormed(executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepProjectFixed(p, executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepAuthorityChanges(p, "executeAuthorityRotation", executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepAwardsRetained(p, executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepFreeSpentByOwnerOrAttestation(p, "executeAuthorityRotation", executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepMonthsRetained(p, executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepNewBindingAttested(p, executeAuthorityRotation(p)))
  ensures (inv(p) ==> canExecuteAuthorityRotation(p) ==> stepPaidToLiveBinding(p, executeAuthorityRotation(p)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canExecuteAuthorityRotation, executeAuthorityRotation, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canExecuteAuthorityRotation(p) {
    var after := executeAuthorityRotation(p);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma deposit_ensures(p: Program, amount: int, account: AccountFacts, transferOk: bool)
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysConfigSeparate(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysClockStarted(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysAdmittedAsset(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysProjectShape(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysRotationSeparate(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysFeesAccounted(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysNonnegative(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysVaultCovers(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysReservedMatches(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysPaidMatches(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysAwardsWellFormed(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysMonthsWellFormed(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysOutstandingMatchesMonths(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysBountyHasNoMonthly(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> alwaysBindingsWellFormed(deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepProjectFixed(p, deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepAuthorityChanges(p, "deposit", deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepAwardsRetained(p, deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepFreeSpentByOwnerOrAttestation(p, "deposit", deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepMonthsRetained(p, deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepNewBindingAttested(p, deposit(p, amount, account, transferOk)))
  ensures (inv(p) ==> canDeposit(p, amount, account, transferOk) ==> stepPaidToLiveBinding(p, deposit(p, amount, account, transferOk)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canDeposit, deposit, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canDeposit(p, amount, account, transferOk) {
    var after := deposit(p, amount, account, transferOk);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma depositNative_ensures(p: Program, amount: int)
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysConfigSeparate(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysClockStarted(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysAdmittedAsset(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysProjectShape(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysRotationSeparate(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysFeesAccounted(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysNonnegative(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysVaultCovers(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysReservedMatches(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysPaidMatches(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysAwardsWellFormed(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysMonthsWellFormed(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysOutstandingMatchesMonths(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysBountyHasNoMonthly(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> alwaysBindingsWellFormed(depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepProjectFixed(p, depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepAuthorityChanges(p, "depositNative", depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepAwardsRetained(p, depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepFreeSpentByOwnerOrAttestation(p, "depositNative", depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepMonthsRetained(p, depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepNewBindingAttested(p, depositNative(p, amount)))
  ensures (inv(p) ==> canDepositNative(p, amount) ==> stepPaidToLiveBinding(p, depositNative(p, amount)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canDepositNative, depositNative, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canDepositNative(p, amount) {
    var after := depositNative(p, amount);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma transferIn_ensures(p: Program, amount: int)
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysConfigSeparate(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysClockStarted(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysAdmittedAsset(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysProjectShape(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysRotationSeparate(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysFeesAccounted(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysNonnegative(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysVaultCovers(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysReservedMatches(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysPaidMatches(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysAwardsWellFormed(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysMonthsWellFormed(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysOutstandingMatchesMonths(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysBountyHasNoMonthly(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> alwaysBindingsWellFormed(transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepProjectFixed(p, transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepAuthorityChanges(p, "transferIn", transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepAwardsRetained(p, transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepFreeSpentByOwnerOrAttestation(p, "transferIn", transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepMonthsRetained(p, transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepNewBindingAttested(p, transferIn(p, amount)))
  ensures (inv(p) ==> canTransferIn(p, amount) ==> stepPaidToLiveBinding(p, transferIn(p, amount)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canTransferIn, transferIn, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canTransferIn(p, amount) {
    var after := transferIn(p, amount);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma setMonthlyCommitment_ensures(p: Program, cap: int, on: bool, by_: string)
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysConfigSeparate(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysClockStarted(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysAdmittedAsset(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysProjectShape(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysRotationSeparate(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysFeesAccounted(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysNonnegative(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysVaultCovers(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysReservedMatches(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysPaidMatches(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysAwardsWellFormed(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysMonthsWellFormed(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysOutstandingMatchesMonths(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysBountyHasNoMonthly(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> alwaysBindingsWellFormed(setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepProjectFixed(p, setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepAuthorityChanges(p, "setMonthlyCommitment", setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepAwardsRetained(p, setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "setMonthlyCommitment", setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepMonthsRetained(p, setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepNewBindingAttested(p, setMonthlyCommitment(p, cap, on, by_)))
  ensures (inv(p) ==> canSetMonthlyCommitment(p, cap, on, by_) ==> stepPaidToLiveBinding(p, setMonthlyCommitment(p, cap, on, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canSetMonthlyCommitment, setMonthlyCommitment, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canSetMonthlyCommitment(p, cap, on, by_) {
    var after := setMonthlyCommitment(p, cap, on, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma withdraw_ensures(p: Program, gross: int, account: AccountFacts, transferOk: bool, by_: string)
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysConfigSeparate(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysClockStarted(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysAdmittedAsset(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysProjectShape(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysRotationSeparate(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysFeesAccounted(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysNonnegative(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysVaultCovers(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysReservedMatches(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysPaidMatches(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysAwardsWellFormed(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysMonthsWellFormed(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysOutstandingMatchesMonths(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysBountyHasNoMonthly(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> alwaysBindingsWellFormed(withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepProjectFixed(p, withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepAuthorityChanges(p, "withdraw", withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepAwardsRetained(p, withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "withdraw", withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepMonthsRetained(p, withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepNewBindingAttested(p, withdraw(p, gross, account, transferOk, by_)))
  ensures (inv(p) ==> canWithdraw(p, gross, account, transferOk, by_) ==> stepPaidToLiveBinding(p, withdraw(p, gross, account, transferOk, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canWithdraw, withdraw, refundable, refunded, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canWithdraw(p, gross, account, transferOk, by_) {
    var after := withdraw(p, gross, account, transferOk, by_);
    FeeWithinGross(gross);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma withdrawNative_ensures(p: Program, gross: int, by_: string)
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysConfigSeparate(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysClockStarted(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysAdmittedAsset(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysProjectShape(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysRotationSeparate(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysFeesAccounted(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysNonnegative(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysVaultCovers(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysReservedMatches(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysPaidMatches(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysAwardsWellFormed(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysMonthsWellFormed(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysOutstandingMatchesMonths(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysBountyHasNoMonthly(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> alwaysBindingsWellFormed(withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepProjectFixed(p, withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepAuthorityChanges(p, "withdrawNative", withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepAwardsRetained(p, withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "withdrawNative", withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepMonthsRetained(p, withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepNewBindingAttested(p, withdrawNative(p, gross, by_)))
  ensures (inv(p) ==> canWithdrawNative(p, gross, by_) ==> stepPaidToLiveBinding(p, withdrawNative(p, gross, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canWithdrawNative, withdrawNative, refundable, refunded, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canWithdrawNative(p, gross, by_) {
    var after := withdrawNative(p, gross, by_);
    FeeWithinGross(gross);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma claimFees_ensures(p: Program, account: AccountFacts, transferOk: bool)
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysConfigSeparate(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysClockStarted(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysAdmittedAsset(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysProjectShape(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysRotationSeparate(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysFeesAccounted(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysNonnegative(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysVaultCovers(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysReservedMatches(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysPaidMatches(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysAwardsWellFormed(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysMonthsWellFormed(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysOutstandingMatchesMonths(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysBountyHasNoMonthly(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> alwaysBindingsWellFormed(claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepProjectFixed(p, claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepAuthorityChanges(p, "claimFees", claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepAwardsRetained(p, claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepFreeSpentByOwnerOrAttestation(p, "claimFees", claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepMonthsRetained(p, claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepNewBindingAttested(p, claimFees(p, account, transferOk)))
  ensures (inv(p) ==> canClaimFees(p, account, transferOk) ==> stepPaidToLiveBinding(p, claimFees(p, account, transferOk)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canClaimFees, claimFees, feesClaimed, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canClaimFees(p, account, transferOk) {
    var after := claimFees(p, account, transferOk);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma claimFeesNative_ensures(p: Program)
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysConfigSeparate(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysClockStarted(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysAdmittedAsset(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysProjectShape(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysRotationSeparate(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysFeesAccounted(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysNonnegative(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysVaultCovers(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysReservedMatches(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysPaidMatches(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysAwardsWellFormed(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysMonthsWellFormed(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysOutstandingMatchesMonths(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysBountyHasNoMonthly(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> alwaysBindingsWellFormed(claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepProjectFixed(p, claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepAuthorityChanges(p, "claimFeesNative", claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepAwardsRetained(p, claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepFreeSpentByOwnerOrAttestation(p, "claimFeesNative", claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepMonthsRetained(p, claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepNewBindingAttested(p, claimFeesNative(p)))
  ensures (inv(p) ==> canClaimFeesNative(p) ==> stepPaidToLiveBinding(p, claimFeesNative(p)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canClaimFeesNative, claimFeesNative, feesClaimed, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canClaimFeesNative(p) {
    var after := claimFeesNative(p);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    BindingsFrame(p, after);
    MonthsSame(p, after);
    BindingsSame(p, after);
  }
}

lemma commit_ensures(p: Program, source: int, actor: int, gross: int, by_: string)
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysConfigSeparate(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysClockStarted(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysAdmittedAsset(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysProjectShape(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysRotationSeparate(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysFeesAccounted(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysNonnegative(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysVaultCovers(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysReservedMatches(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysPaidMatches(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysAwardsWellFormed(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysMonthsWellFormed(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysOutstandingMatchesMonths(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysBountyHasNoMonthly(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepProjectFixed(p, commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepAuthorityChanges(p, "commit", commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepAwardsRetained(p, commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "commit", commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepMonthsRetained(p, commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepNewBindingAttested(p, commit(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommit(p, source, actor, gross, by_) ==> stepPaidToLiveBinding(p, commit(p, source, actor, gross, by_)))
{
  if inv(p) && canCommit(p, source, actor, gross, by_) {
    var after := commit(p, source, actor, gross, by_);
    RecordAward(p, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(p.purpose, gross), p.now));
    MonthsFrame(p, after);
    BindingsFrame(p, after);
  }
}

lemma commitBounty_ensures(p: Program, source: int, actor: int, gross: int, by_: string)
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysConfigSeparate(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysClockStarted(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysAdmittedAsset(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysProjectShape(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysRotationSeparate(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysFeesAccounted(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysNonnegative(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysVaultCovers(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysReservedMatches(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysPaidMatches(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysAwardsWellFormed(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysMonthsWellFormed(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysOutstandingMatchesMonths(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysBountyHasNoMonthly(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepProjectFixed(p, commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepAuthorityChanges(p, "commitBounty", commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepAwardsRetained(p, commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "commitBounty", commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepMonthsRetained(p, commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepNewBindingAttested(p, commitBounty(p, source, actor, gross, by_)))
  ensures (inv(p) ==> canCommitBounty(p, source, actor, gross, by_) ==> stepPaidToLiveBinding(p, commitBounty(p, source, actor, gross, by_)))
{
  if inv(p) && canCommitBounty(p, source, actor, gross, by_) {
    var after := commitBounty(p, source, actor, gross, by_);
    RecordAward(p, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(p.purpose, gross), p.now));
    MonthsFrame(p, after);
    BindingsFrame(p, after);
  }
}

lemma commitMonthly_ensures(p: Program, period: int, root: string, total: int, frozenAt: int, leaves: seq<contracts__ledger_Leaf>, attested: bool)
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysConfigSeparate(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysClockStarted(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysAdmittedAsset(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysProjectShape(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysRotationSeparate(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysFeesAccounted(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysNonnegative(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysVaultCovers(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysReservedMatches(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysPaidMatches(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysAwardsWellFormed(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysMonthsWellFormed(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysOutstandingMatchesMonths(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysBountyHasNoMonthly(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> alwaysBindingsWellFormed(commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepProjectFixed(p, commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepAuthorityChanges(p, "commitMonthly", commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepAwardsRetained(p, commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepFreeSpentByOwnerOrAttestation(p, "commitMonthly", commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepMonthsRetained(p, commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepNewBindingAttested(p, commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
  ensures (inv(p) ==> canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) ==> stepPaidToLiveBinding(p, commitMonthly(p, period, root, total, frozenAt, leaves, attested)))
{
  if inv(p) && canCommitMonthly(p, period, root, total, frozenAt, leaves, attested) {
    var after := commitMonthly(p, period, root, total, frozenAt, leaves, attested);
    OpensAtPositive(period);
    SameAwards(p, after);
    AwardsFrame(p, after);
    BindingsFrame(p, after);
    AppendMonth(p, after, noSolMonth.(period := period, root := root, total := total, frozenAt := frozenAt, cap := p.monthlyCap, leaves := leaves));
  }
}

lemma commitMonthlyAward_ensures(p: Program, period: int, leaf: contracts__ledger_Leaf)
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysConfigSeparate(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysClockStarted(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysAdmittedAsset(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysProjectShape(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysRotationSeparate(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysFeesAccounted(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysNonnegative(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysVaultCovers(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysReservedMatches(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysPaidMatches(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysAwardsWellFormed(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysMonthsWellFormed(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysOutstandingMatchesMonths(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysBountyHasNoMonthly(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> alwaysBindingsWellFormed(commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepProjectFixed(p, commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepAuthorityChanges(p, "commitMonthlyAward", commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepAwardsRetained(p, commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepFreeSpentByOwnerOrAttestation(p, "commitMonthlyAward", commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepMonthsRetained(p, commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepNewBindingAttested(p, commitMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canCommitMonthlyAward(p, period, leaf) ==> stepPaidToLiveBinding(p, commitMonthlyAward(p, period, leaf)))
{
  if inv(p) && canCommitMonthlyAward(p, period, leaf) {
    var after := commitMonthlyAward(p, period, leaf);
    assert p.purpose.Ordinary?;
    RecordAward(p, after, contracts__ledger_newAward(leaf.source, leaf.actor, leaf.gross, settlement__money_ordinaryFee(leaf.gross), p.now));
    BindingsFrame(p, after);
    SettleMonth(p, after, period, leaf, 0);
    UnpaidNonneg(after);
  }
}

lemma releaseMonthlyAward_ensures(p: Program, period: int, leaf: contracts__ledger_Leaf)
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysConfigSeparate(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysClockStarted(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysAdmittedAsset(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysProjectShape(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysRotationSeparate(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysFeesAccounted(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysNonnegative(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysVaultCovers(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysReservedMatches(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysPaidMatches(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysAwardsWellFormed(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysMonthsWellFormed(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysOutstandingMatchesMonths(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysBountyHasNoMonthly(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> alwaysBindingsWellFormed(releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepProjectFixed(p, releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepAuthorityChanges(p, "releaseMonthlyAward", releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepAwardsRetained(p, releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepFreeSpentByOwnerOrAttestation(p, "releaseMonthlyAward", releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepMonthsRetained(p, releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepNewBindingAttested(p, releaseMonthlyAward(p, period, leaf)))
  ensures (inv(p) ==> canReleaseMonthlyAward(p, period, leaf) ==> stepPaidToLiveBinding(p, releaseMonthlyAward(p, period, leaf)))
{
  if inv(p) && canReleaseMonthlyAward(p, period, leaf) {
    var after := releaseMonthlyAward(p, period, leaf);
    SameAwards(p, after);
    AwardsFrame(p, after);
    BindingsFrame(p, after);
    SettleMonth(p, after, period, leaf, leaf.gross);
    UnpaidNonneg(p);
  }
}

lemma releaseMonthlyReserve_ensures(p: Program, period: int, expectedUnsettled: int, releasedAmount: int, attested: bool, by_: string)
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysConfigSeparate(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysClockStarted(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysAdmittedAsset(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysProjectShape(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysRotationSeparate(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysFeesAccounted(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysNonnegative(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysVaultCovers(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysReservedMatches(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysPaidMatches(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysAwardsWellFormed(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysMonthsWellFormed(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysOutstandingMatchesMonths(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysBountyHasNoMonthly(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> alwaysBindingsWellFormed(releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepProjectFixed(p, releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepAuthorityChanges(p, "releaseMonthlyReserve", releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepAwardsRetained(p, releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "releaseMonthlyReserve", releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepMonthsRetained(p, releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepNewBindingAttested(p, releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
  ensures (inv(p) ==> canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) ==> stepPaidToLiveBinding(p, releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_)))
{
  if inv(p) && canReleaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_) {
    var after := releaseMonthlyReserve(p, period, expectedUnsettled, releasedAmount, attested, by_);
    var i := MonthForIndex(p, period);
    var m := p.months[i];
    MonthsView(p);
    assert m in p.months;
    assert m.settled == [];
    SameAwards(p, after);
    AwardsFrame(p, after);
    BindingsFrame(p, after);
    ReplaceMonth(p, after, i, m.(committed := m.total, released := m.total, wholeReleased := true));
    UnpaidNonneg(p);
  }
}

lemma bindWallet_ensures(p: Program, actor: int, network: string, expectedVersion: int, claim: int, expiresAt: int, destination: string, walletSigned: bool, by_: string)
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysConfigSeparate(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysClockStarted(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysAdmittedAsset(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysProjectShape(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysRotationSeparate(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysFeesAccounted(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysNonnegative(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysVaultCovers(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysReservedMatches(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysPaidMatches(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysAwardsWellFormed(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysMonthsWellFormed(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysOutstandingMatchesMonths(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysBountyHasNoMonthly(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> alwaysBindingsWellFormed(bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepProjectFixed(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepAuthorityChanges(p, "bindWallet", bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepAwardsRetained(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "bindWallet", bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepMonthsRetained(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepNewBindingAttested(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
  ensures (inv(p) ==> canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) ==> stepPaidToLiveBinding(p, bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canBindWallet, bindWallet, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canBindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_) {
    var after := bindWallet(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_);
    BindWalletBindings(p, actor, network, expectedVersion, claim, expiresAt, destination, walletSigned, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    MonthsSame(p, after);
  }
}

lemma vetoBinding_ensures(p: Program, actor: int, version: int, obligation: int, by_: string)
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysConfigSeparate(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysClockStarted(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysAdmittedAsset(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysProjectShape(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysRotationSeparate(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysFeesAccounted(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysNonnegative(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysVaultCovers(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysReservedMatches(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysPaidMatches(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysAwardsWellFormed(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysMonthsWellFormed(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysOutstandingMatchesMonths(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysBountyHasNoMonthly(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> alwaysBindingsWellFormed(vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepProjectFixed(p, vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepAuthorityChanges(p, "vetoBinding", vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepAwardsRetained(p, vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "vetoBinding", vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepMonthsRetained(p, vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepNewBindingAttested(p, vetoBinding(p, actor, version, obligation, by_)))
  ensures (inv(p) ==> canVetoBinding(p, actor, version, obligation, by_) ==> stepPaidToLiveBinding(p, vetoBinding(p, actor, version, obligation, by_)))
{
  // Only the definitions this transition changes are needed; the rest of each rule follows from the frame lemmas.
  hide *;
  reveal canVetoBinding, vetoBinding, inv, live, free, held, alwaysConfigSeparate, alwaysClockStarted, alwaysAdmittedAsset, alwaysProjectShape, alwaysRotationSeparate, alwaysFeesAccounted, alwaysNonnegative, alwaysVaultCovers, alwaysReservedMatches, alwaysPaidMatches, alwaysOutstandingMatchesMonths, alwaysBountyHasNoMonthly, stepProjectFixed, stepAuthorityChanges, stepFreeSpentByOwnerOrAttestation;
  if inv(p) && canVetoBinding(p, actor, version, obligation, by_) {
    var after := vetoBinding(p, actor, version, obligation, by_);
    VetoBindingBindings(p, actor, version, obligation, by_);
    SameAwards(p, after);
    AwardsFrame(p, after);
    MonthsFrame(p, after);
    MonthsSame(p, after);
  }
}

lemma pay_ensures(p: Program, source: int, expectedVersion: int, destination: string, account: AccountFacts, transferOk: bool)
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysConfigSeparate(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysClockStarted(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysAdmittedAsset(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysProjectShape(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysRotationSeparate(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysFeesAccounted(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysNonnegative(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysVaultCovers(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysReservedMatches(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysPaidMatches(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysAwardsWellFormed(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysMonthsWellFormed(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysOutstandingMatchesMonths(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysBountyHasNoMonthly(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> alwaysBindingsWellFormed(pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepProjectFixed(p, pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepAuthorityChanges(p, "pay", pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepAwardsRetained(p, pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepFreeSpentByOwnerOrAttestation(p, "pay", pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepMonthsRetained(p, pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepNewBindingAttested(p, pay(p, source, expectedVersion, destination, account, transferOk)))
  ensures (inv(p) ==> canPay(p, source, expectedVersion, destination, account, transferOk) ==> stepPaidToLiveBinding(p, pay(p, source, expectedVersion, destination, account, transferOk)))
{
  if inv(p) && canPay(p, source, expectedVersion, destination, account, transferOk) {
    PaidOutFacts(p, source, expectedVersion, destination);
    MonthsFrame(p, paidOut(source, p));
  }
}

lemma payNative_ensures(p: Program, source: int, expectedVersion: int, destination: string)
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysConfigSeparate(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysClockStarted(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysAdmittedAsset(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysProjectShape(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysRotationSeparate(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysFeesAccounted(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysNonnegative(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysVaultCovers(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysReservedMatches(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysPaidMatches(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysAwardsWellFormed(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysMonthsWellFormed(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysOutstandingMatchesMonths(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysBountyHasNoMonthly(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> alwaysBindingsWellFormed(payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepProjectFixed(p, payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepAuthorityChanges(p, "payNative", payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepAwardsRetained(p, payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepFreeSpentByOwnerOrAttestation(p, "payNative", payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepMonthsRetained(p, payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepNewBindingAttested(p, payNative(p, source, expectedVersion, destination)))
  ensures (inv(p) ==> canPayNative(p, source, expectedVersion, destination) ==> stepPaidToLiveBinding(p, payNative(p, source, expectedVersion, destination)))
{
  if inv(p) && canPayNative(p, source, expectedVersion, destination) {
    PaidOutFacts(p, source, expectedVersion, destination);
    MonthsFrame(p, paidOut(source, p));
  }
}

lemma createLegacyProject_ensures(p: Program, project: string, identity: string, feeRecipient: string, amount: int, by_: string)
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysConfigSeparate(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysClockStarted(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysAdmittedAsset(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysProjectShape(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysRotationSeparate(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysFeesAccounted(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysNonnegative(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysVaultCovers(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysReservedMatches(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysPaidMatches(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysAwardsWellFormed(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysMonthsWellFormed(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysOutstandingMatchesMonths(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysBountyHasNoMonthly(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> alwaysBindingsWellFormed(createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepProjectFixed(p, createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepAuthorityChanges(p, "createLegacyProject", createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepAwardsRetained(p, createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepFreeSpentByOwnerOrAttestation(p, "createLegacyProject", createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepMonthsRetained(p, createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepNewBindingAttested(p, createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
  ensures (inv(p) ==> canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) ==> stepPaidToLiveBinding(p, createLegacyProject(p, project, identity, feeRecipient, amount, by_)))
{
  if inv(p) && canCreateLegacyProject(p, project, identity, feeRecipient, amount, by_) {
    EmptyTotals();
    assert p.awards == [] && p.months == [] && p.bindings == [];
    assert p.reserved == 0;
    assert p.withdrawnGross == 0;
    assert p.accruedFees == 0;
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  hide *;
  reveal inv;
  InitialIs();
  Initial_alwaysConfigSeparate();
  Initial_alwaysClockStarted();
  Initial_alwaysAdmittedAsset();
  Initial_alwaysProjectShape();
  Initial_alwaysRotationSeparate();
  Initial_alwaysFeesAccounted();
  Initial_alwaysNonnegative();
  Initial_alwaysVaultCovers();
  Initial_alwaysReservedMatches();
  Initial_alwaysPaidMatches();
  Initial_alwaysAwardsWellFormed();
  Initial_alwaysMonthsWellFormed();
  Initial_alwaysOutstandingMatchesMonths();
  Initial_alwaysBountyHasNoMonthly();
  Initial_alwaysBindingsWellFormed();
}
