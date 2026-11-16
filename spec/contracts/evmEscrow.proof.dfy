// Proofs of the EVM escrow obligations Dafny does not find on its own.

// Views of the rules that count with a filter, through ProofLib.Filter.

lemma UniqueSourcesView(awards: seq<contracts__ledger_Award>)
  ensures contracts__ledger_uniqueSources(awards) == !((exists a :: a in awards && !((|ProofLib.Filter((b: contracts__ledger_Award) => (b.source == a.source), awards)| == 1))))
{
}

lemma KeysView(e: Escrow)
  ensures alwaysOneVaultPerKey(e) == !((exists k :: k in e.vaultKeys && !((|ProofLib.Filter((o: VaultKey) => (o == k), e.vaultKeys)| == 1))))
{
}

lemma MonthsView(e: Escrow)
  ensures alwaysMonthsWellFormed(e) == !((exists m :: m in e.vault.months && !(((((((((((|ProofLib.Filter((o: Month) => (o.period == m.period), e.vault.months)| == 1) && contracts__ledger_validPeriod(m.period)) && (m.wholeGross <= m.cap)) && (m.total <= m.wholeGross)) && (m.remaining >= 0)) && (m.committedGross >= 0)) && (m.released >= 0)) && (((m.committedGross + m.released) + m.remaining) == m.total)) && ((m.released == 0) || ((m.released == m.total) && (m.committedGross == 0)))) && (if m.version2 then ((m.digest != "") && (m.root != "")) else ((m.total == 0) && (|m.leaves| == m.count)))))))
{
}

lemma FreshView(v: Vault, entries: seq<contracts__ledger_Leaf>)
  ensures freshEntries(v, entries) == ProofLib.Filter((l: contracts__ledger_Leaf) => !(contracts__ledger_hasSource(v.awards, l.source)), entries)
{
}

lemma CommitMonthlyView(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, attested: bool)
  ensures canCommitMonthly(e, period, entries, attested) == (var local_1 := freshEntries(e.vault, entries); ((((((admissionOpen(e, period) && (|entries| > 0)) && attested) && (contracts__ledger_leafTotal(entries) <= e.vault.monthlyCap)) && !((exists l :: l in entries && !((!(contracts__ledger_hasSource(e.vault.awards, l.source)) || existingMatches(e.vault, l)))))) && !((exists l :: l in local_1 && !(((((l.actor > 0) && (l.gross > 0)) && (l.source > 0)) && (|ProofLib.Filter((o: contracts__ledger_Leaf) => (o.source == l.source), local_1)| == 1)))))) && (contracts__ledger_leafTotal(local_1) <= e.vault.free)))
{
}

lemma BindingsView(e: Escrow)
  ensures alwaysBindingsWellFormed(e) == !((exists b :: b in e.vault.bindings && !(((((((((((((((|ProofLib.Filter((o: Binding) => (o.actor == b.actor), e.vault.bindings)| == 1) && (b.actor > 0)) && (b.version > 0)) && (b.destination != "")) && (b.destination != "vault")) && (b.claim != 0)) && b.walletSigned) && (b.attester != "")) && (b.paidVersion >= 0)) && (b.paidVersion <= b.version)) && (b.cancels >= 0)) && (b.cancels <= contracts__ledger_maxCancels)) && (b.activatesAt > 0)) && (b.activatesAt <= e.now)))))
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

// ---- Fees ----------------------------------------------------------------------

lemma FeeWithinGross(g: int)
  requires g > 0
  ensures 0 <= settlement__money_ordinaryFee(g) <= g
  ensures 0 <= quotient_contracts__evmEscrow(g, 50) <= g
  ensures 0 <= settlement__money_privateSponsor(g) <= g
{
  assert settlement__money_quotient_settlement__money(g, 50) == g / 50;
  assert quotient_contracts__evmEscrow(g, 50) == g / 50;
  assert settlement__money_quotient_settlement__money(g, 4) == g / 4;
  var r := settlement__money_remainder_settlement__money(g, 50);
  assert r == g - 50 * (g / 50);
  if r != 0 {
    assert g / 50 < g;
  }
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

lemma AwardForFound(awards: seq<contracts__ledger_Award>, source: int)
  ensures contracts__ledger_awardFor(awards, source) == contracts__ledger_noAward
    || (contracts__ledger_awardFor(awards, source) in awards && contracts__ledger_awardFor(awards, source).source == source)
{
  LastMatchIn((found: contracts__ledger_Award, a: contracts__ledger_Award) => (if (a.source == source) then a else found), (a: contracts__ledger_Award) => a.source == source, contracts__ledger_noAward, awards);
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

// Every award of a well-formed vault keeps a principal from zero through its gross.
lemma AwardNet(e: Escrow, a: contracts__ledger_Award)
  requires alwaysAwardsWellFormed(e) && a in e.vault.awards
  ensures 0 <= a.fee <= a.gross
{
  FeeWithinGross(a.gross);
}

lemma UnpaidPrincipalNonneg(e: Escrow)
  requires alwaysAwardsWellFormed(e)
  ensures contracts__ledger_unpaidPrincipal(e.vault.awards) >= 0
  ensures contracts__ledger_unpaidFees(e.vault.awards) >= 0
{
  var xs := e.vault.awards;
  forall i | 0 <= i < |xs|
    ensures (if xs[i].paid then 0 else xs[i].gross - xs[i].fee) >= 0 && (if xs[i].paid then 0 else xs[i].fee) >= 0
  {
    assert xs[i] in xs;
    AwardNet(e, xs[i]);
  }
  SumFoldNonneg((t: int, a: contracts__ledger_Award) => (if a.paid then t else ((t + a.gross) - a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.gross - a.fee), 0, xs);
  SumFoldNonneg((t: int, a: contracts__ledger_Award) => (if a.paid then t else (t + a.fee)), (a: contracts__ledger_Award) => (if a.paid then 0 else a.fee), 0, xs);
}

// A transition that adds only unpaid awards pays nothing through a binding.
lemma PaidLiveFromOld(before: Escrow, after: Escrow)
  requires contracts__ledger_uniqueSources(before.vault.awards)
  requires forall a :: a in after.vault.awards && a.paid ==> a in before.vault.awards
  ensures stepPaidToLiveBinding(before, after)
{
  forall a | a in after.vault.awards && a.paid
    ensures contracts__ledger_awardFor(before.vault.awards, a.source).paid
  {
    var i :| 0 <= i < |before.vault.awards| && before.vault.awards[i] == a;
    AwardForAt(before.vault.awards, i);
  }
}

lemma SameAwards(before: Escrow, after: Escrow)
  requires alwaysAwardsWellFormed(before)
  requires after.vault.awards == before.vault.awards
  ensures stepPaidToLiveBinding(before, after)
  ensures stepAwardsRetained(before, after)
{
  PaidLiveFromOld(before, after);
  forall a | a in before.vault.awards
    ensures a in after.vault.awards
  {
  }
}

// A transition that keeps the awards and the purpose, and does not move the clock back, keeps them well formed.
lemma AwardsFrame(before: Escrow, after: Escrow)
  requires alwaysAwardsWellFormed(before)
  requires after.vault.awards == before.vault.awards && after.now >= before.now
  requires after.vault.key.purpose == before.vault.key.purpose || before.vault.awards == []
  ensures alwaysAwardsWellFormed(after)
{
  UniqueSourcesView([]);
}

// Recording one fresh unpaid award keeps every award rule.
lemma RecordAward(before: Escrow, after: Escrow, n: contracts__ledger_Award)
  requires alwaysClockStarted(before) && alwaysAwardsWellFormed(before)
  requires alwaysReservedMatchesAwards(before) && alwaysPaidMatchesAwards(before)
  requires after.vault.awards == before.vault.awards + [n]
  requires after.vault.key == before.vault.key && after.now == before.now
  requires !contracts__ledger_hasSource(before.vault.awards, n.source)
  requires n.source > 0 && n.actor > 0 && contracts__ledger_awardGrossAdmissible(before.vault.key.purpose, n.gross)
  requires n.fee == contracts__ledger_awardFee(before.vault.key.purpose, n.gross)
  requires n.committedAt == before.now && !n.paid && n.paidVersion == 0
  requires after.vault.reservedPrincipal == before.vault.reservedPrincipal + n.gross - n.fee
  requires after.vault.reservedFees == before.vault.reservedFees + n.fee
  requires after.vault.paid == before.vault.paid && after.vault.payoutFees == before.vault.payoutFees
  ensures alwaysAwardsWellFormed(after)
  ensures alwaysReservedMatchesAwards(after)
  ensures alwaysPaidMatchesAwards(after)
  ensures stepPaidToLiveBinding(before, after)
  ensures stepAwardsRetained(before, after)
  ensures 0 <= n.fee <= n.gross
{
  UniqueSourcesAppend(before.vault.awards, n);
  AwardTotalsAppend(before.vault.awards, n);
  FeeWithinGross(n.gross);
  PaidLiveFromOld(before, after);
  forall a | a in before.vault.awards
    ensures a in after.vault.awards
  {
  }
}

// ---- Bindings ------------------------------------------------------------------

lemma BindingActorUnique(e: Escrow, i: int, j: int)
  requires alwaysBindingsWellFormed(e)
  requires 0 <= i < |e.vault.bindings| && 0 <= j < |e.vault.bindings|
  requires e.vault.bindings[i].actor == e.vault.bindings[j].actor
  ensures i == j
{
  BindingsView(e);
  var b := e.vault.bindings[i];
  assert b in e.vault.bindings;
  FilterOneIndex((o: Binding) => (o.actor == b.actor), e.vault.bindings, i, j);
}

lemma BindingForFound(bs: seq<Binding>, actor: int)
  ensures bindingFor(bs, actor) == noBinding || (bindingFor(bs, actor) in bs && bindingFor(bs, actor).actor == actor)
{
  LastMatchIn((found: Binding, b: Binding) => (if (b.actor == actor) then b else found), (b: Binding) => b.actor == actor, noBinding, bs);
}

lemma BindingForAt(e: Escrow, i: int)
  requires alwaysBindingsWellFormed(e) && 0 <= i < |e.vault.bindings|
  ensures bindingFor(e.vault.bindings, e.vault.bindings[i].actor) == e.vault.bindings[i]
{
  var bs := e.vault.bindings;
  var actor := bs[i].actor;
  forall j | i < j < |bs|
    ensures bs[j].actor != actor
  {
    if bs[j].actor == actor {
      BindingActorUnique(e, i, j);
    }
  }
  LastMatch((found: Binding, b: Binding) => (if (b.actor == actor) then b else found), (b: Binding) => b.actor == actor, noBinding, bs, i);
}

// Replacing or adding the binding of one actor keeps every binding rule.
lemma ReplaceBinding(e: Escrow, after: Escrow, nb: Binding)
  requires alwaysBindingsWellFormed(e)
  requires after.vault.bindings == withBinding(e.vault.bindings, nb)
  requires after.now >= e.now
  requires nb.actor > 0 && nb.version > 0 && nb.destination != "" && nb.destination != "vault" && nb.claim != 0
    && nb.walletSigned && nb.attester != "" && nb.paidVersion >= 0 && nb.paidVersion <= nb.version
    && nb.cancels >= 0 && nb.cancels <= contracts__ledger_maxCancels && nb.activatesAt > 0 && nb.activatesAt <= after.now
  ensures alwaysBindingsWellFormed(after)
  ensures forall b :: b in after.vault.bindings ==> b == nb || b in e.vault.bindings
{
  var bs := e.vault.bindings;
  var ys := after.vault.bindings;
  BindingsView(e);
  BindingsView(after);
  if hasBinding(bs, nb.actor) {
    assert |ys| == |bs|;
    forall k | 0 <= k < |ys|
      ensures ys[k].actor == bs[k].actor
      ensures ys[k] == nb || ys[k] == bs[k]
    {
    }
    forall b | b in ys
      ensures |ProofLib.Filter((o: Binding) => (o.actor == b.actor), ys)| == 1
    {
      var k :| 0 <= k < |ys| && ys[k] == b;
      var old_ := bs[k];
      assert old_ in bs;
      ProofLib.FilterLengthPointwise((o: Binding) => (o.actor == b.actor), (o: Binding) => (o.actor == old_.actor), ys, bs);
    }
    forall b | b in ys
      ensures b == nb || b in bs
    {
      var k :| 0 <= k < |ys| && ys[k] == b;
    }
  } else {
    assert ys == bs + [nb];
    forall b | b in ys
      ensures |ProofLib.Filter((o: Binding) => (o.actor == b.actor), ys)| == 1
    {
      ProofLib.FilterAppend((o: Binding) => (o.actor == b.actor), bs, nb);
      if b in bs {
        assert nb.actor != b.actor;
      } else {
        assert b == nb;
        forall i | 0 <= i < |bs|
          ensures !(bs[i].actor == b.actor)
        {
          assert bs[i] in bs;
        }
        ProofLib.FilterNone((o: Binding) => (o.actor == b.actor), bs);
      }
    }
  }
}

lemma ReplaceBindingAttested(e: Escrow, after: Escrow, nb: Binding)
  requires forall b :: b in after.vault.bindings ==> b == nb || b in e.vault.bindings
  requires (exists o :: o in e.vault.bindings && o.actor == nb.actor && o.version == nb.version)
    || (nb.attester == e.identityAuthority && nb.walletSigned)
  ensures stepNewBindingAttested(e, after)
{
  forall b | b in after.vault.bindings
    ensures (exists o :: o in e.vault.bindings && ((o.actor == b.actor) && (o.version == b.version)))
      || ((b.attester == e.identityAuthority) && b.walletSigned)
  {
    if b != nb {
      assert b in e.vault.bindings;
    }
  }
}

// ---- Months --------------------------------------------------------------------

lemma MonthPeriodUnique(e: Escrow, i: int, j: int)
  requires alwaysMonthsWellFormed(e)
  requires 0 <= i < |e.vault.months| && 0 <= j < |e.vault.months|
  requires e.vault.months[i].period == e.vault.months[j].period
  ensures i == j
{
  MonthsView(e);
  var m := e.vault.months[i];
  assert m in e.vault.months;
  FilterOneIndex((o: Month) => (o.period == m.period), e.vault.months, i, j);
}

// The month of a period that has one, and its index.
lemma MonthForIndex(e: Escrow, period: int) returns (i: int)
  requires alwaysMonthsWellFormed(e) && hasMonth(e.vault.months, period)
  ensures 0 <= i < |e.vault.months| && e.vault.months[i].period == period
  ensures monthFor(e.vault.months, period) == e.vault.months[i]
  ensures forall j :: 0 <= j < |e.vault.months| && j != i ==> e.vault.months[j].period != period
{
  var ms := e.vault.months;
  var m0 :| m0 in ms && m0.period == period;
  i :| 0 <= i < |ms| && ms[i] == m0;
  forall j | 0 <= j < |ms| && j != i
    ensures ms[j].period != period
  {
    if ms[j].period == period {
      MonthPeriodUnique(e, i, j);
    }
  }
  LastMatch((found: Month, m: Month) => (if (m.period == period) then m else found), (m: Month) => m.period == period, noMonth, ms, i);
}

lemma SumRemainingAppend(ms: seq<Month>, last: Month)
  ensures sumRemaining(ms + [last]) == sumRemaining(ms) + last.remaining
{
  ProofLib.FoldLeftAppend((t: int, m: Month) => (t + m.remaining), 0, ms, last);
}

lemma SumRemainingNonneg(ms: seq<Month>)
  requires forall m :: m in ms ==> m.remaining >= 0
  ensures sumRemaining(ms) >= 0
{
  forall i | 0 <= i < |ms|
    ensures ms[i].remaining >= 0
  {
    assert ms[i] in ms;
  }
  SumFoldNonneg((t: int, m: Month) => (t + m.remaining), (m: Month) => m.remaining, 0, ms);
}

// Replacing the month of a period that has one: the other months stay, and
// the pending sum moves by the change in its remainder.
lemma ReplaceMonth(e: Escrow, after: Escrow, i: int, nm: Month)
  requires alwaysMonthsWellFormed(e) && 0 <= i < |e.vault.months|
  requires e.vault.months[i].period == nm.period
  requires after.vault.months == withMonth(e.vault.months, nm)
  requires contracts__ledger_validPeriod(nm.period) && nm.wholeGross <= nm.cap && nm.total <= nm.wholeGross
    && nm.remaining >= 0 && nm.committedGross >= 0 && nm.released >= 0
    && nm.committedGross + nm.released + nm.remaining == nm.total
    && (nm.released == 0 || (nm.released == nm.total && nm.committedGross == 0))
    && (if nm.version2 then nm.digest != "" && nm.root != "" else nm.total == 0 && |nm.leaves| == nm.count)
  ensures alwaysMonthsWellFormed(after)
  ensures sumRemaining(after.vault.months) == sumRemaining(e.vault.months) + nm.remaining - e.vault.months[i].remaining
  ensures sumRemaining(after.vault.months) >= 0
  ensures forall m :: m in e.vault.months && m.period != nm.period ==> m in after.vault.months
  ensures nm in after.vault.months
  ensures (nm.version2 == e.vault.months[i].version2 && nm.digest == e.vault.months[i].digest
    && nm.root == e.vault.months[i].root && nm.wholeGross == e.vault.months[i].wholeGross
    && nm.total == e.vault.months[i].total && nm.leaves == e.vault.months[i].leaves
    && nm.released >= e.vault.months[i].released && nm.committedGross >= e.vault.months[i].committedGross)
    ==> stepMonthsRetained(e, after)
{
  var ms := e.vault.months;
  var ys := after.vault.months;
  MonthsView(e);
  MonthsView(after);
  assert |ys| == |ms|;
  forall j | 0 <= j < |ms| && j != i
    ensures ms[j].period != nm.period
  {
    if ms[j].period == nm.period {
      MonthPeriodUnique(e, i, j);
    }
  }
  forall k | 0 <= k < |ys|
    ensures ys[k].period == ms[k].period
    ensures k == i ==> ys[k] == nm
    ensures k != i ==> ys[k] == ms[k]
  {
  }
  forall m | m in ys
    ensures |ProofLib.Filter((o: Month) => (o.period == m.period), ys)| == 1
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    var old_ := ms[k];
    assert old_ in ms;
    ProofLib.FilterLengthPointwise((o: Month) => (o.period == m.period), (o: Month) => (o.period == old_.period), ys, ms);
  }
  SumFoldChangeOne((t: int, m: Month) => (t + m.remaining), (m: Month) => m.remaining, 0, ms, ys, i);
  forall m | m in ys
    ensures m.remaining >= 0
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    assert ms[k] in ms;
  }
  SumRemainingNonneg(ys);
  forall m | m in ms && m.period != nm.period
    ensures m in ys
  {
    var k :| 0 <= k < |ms| && ms[k] == m;
    assert ys[k] == m;
  }
  assert ys[i] == nm;
  forall m | m in ms
    ensures m.period == nm.period ==> m == ms[i]
  {
    var k :| 0 <= k < |ms| && ms[k] == m;
    if m.period == nm.period && k != i {
      MonthPeriodUnique(e, i, k);
    }
  }
}

lemma AppendMonth(e: Escrow, after: Escrow, nm: Month)
  requires alwaysMonthsWellFormed(e)
  requires !hasMonth(e.vault.months, nm.period)
  requires after.vault.months == e.vault.months + [nm]
  requires contracts__ledger_validPeriod(nm.period) && nm.wholeGross <= nm.cap && nm.total <= nm.wholeGross
    && nm.remaining >= 0 && nm.committedGross >= 0 && nm.released >= 0
    && nm.committedGross + nm.released + nm.remaining == nm.total
    && (nm.released == 0 || (nm.released == nm.total && nm.committedGross == 0))
    && (if nm.version2 then nm.digest != "" && nm.root != "" else nm.total == 0 && |nm.leaves| == nm.count)
  ensures alwaysMonthsWellFormed(after)
  ensures sumRemaining(after.vault.months) == sumRemaining(e.vault.months) + nm.remaining
  ensures forall m :: m in e.vault.months ==> m in after.vault.months
{
  var ms := e.vault.months;
  var ys := after.vault.months;
  MonthsView(e);
  MonthsView(after);
  forall m | m in ys
    ensures |ProofLib.Filter((o: Month) => (o.period == m.period), ys)| == 1
  {
    ProofLib.FilterAppend((o: Month) => (o.period == m.period), ms, nm);
    if m in ms {
      assert nm.period != m.period;
    } else {
      assert m == nm;
      forall i | 0 <= i < |ms|
        ensures !(ms[i].period == m.period)
      {
        assert ms[i] in ms;
      }
      ProofLib.FilterNone((o: Month) => (o.period == m.period), ms);
    }
  }
  SumRemainingAppend(ms, nm);
}

lemma PendingNonneg(e: Escrow)
  requires alwaysMonthsWellFormed(e)
  ensures sumRemaining(e.vault.months) >= 0
{
  SumRemainingNonneg(e.vault.months);
}


lemma KeysAppend(e: Escrow, after: Escrow, k: VaultKey)
  requires alwaysOneVaultPerKey(e)
  requires after.vaultKeys == e.vaultKeys + [k] && k !in e.vaultKeys
  ensures alwaysOneVaultPerKey(after)
{
  var ks := e.vaultKeys;
  KeysView(e);
  KeysView(after);
  forall x | x in ks + [k]
    ensures |ProofLib.Filter((o: VaultKey) => (o == x), ks + [k])| == 1
  {
    ProofLib.FilterAppend((o: VaultKey) => (o == x), ks, k);
    if x != k {
      assert x in ks;
    } else {
      forall i | 0 <= i < |ks|
        ensures !(ks[i] == x)
      {
        assert ks[i] in ks;
      }
      ProofLib.FilterNone((o: VaultKey) => (o == x), ks);
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

lemma PayFacts(e: Escrow, source: int, expectedVersion: int, transferOk: bool)
  requires inv(e) && canPay(e, source, expectedVersion, transferOk)
  ensures alwaysReservedMatchesAwards(pay(e, source, expectedVersion, transferOk))
  ensures alwaysPaidMatchesAwards(pay(e, source, expectedVersion, transferOk))
  ensures alwaysAwardsWellFormed(pay(e, source, expectedVersion, transferOk))
  ensures alwaysNonnegative(pay(e, source, expectedVersion, transferOk))
  ensures alwaysBindingsWellFormed(pay(e, source, expectedVersion, transferOk))
  ensures stepNewBindingAttested(e, pay(e, source, expectedVersion, transferOk))
  ensures stepAwardsRetained(e, pay(e, source, expectedVersion, transferOk))
  ensures stepPaidToLiveBinding(e, pay(e, source, expectedVersion, transferOk))
  ensures pay(e, source, expectedVersion, transferOk).vault.months == e.vault.months
{
  var after := pay(e, source, expectedVersion, transferOk);
  var xs := e.vault.awards;
  var chosen := contracts__ledger_awardFor(xs, source);
  AwardForFound(xs, source);
  assert chosen in xs && chosen.source == source;
  var i :| 0 <= i < |xs| && xs[i] == chosen;
  forall j | 0 <= j < |xs| && j != i
    ensures xs[j].source != source
  {
    if xs[j].source == source {
      SourceIndexUnique(xs, i, j);
    }
  }
  var bs := e.vault.bindings;
  var b := bindingFor(bs, chosen.actor);
  BindingForFound(bs, chosen.actor);
  assert b in bs;
  var ys := after.vault.awards;
  assert ys == contracts__ledger_markPaid(xs, source, b.destination, b.version);
  var paidOne := chosen.(paid := true, paidTo := b.destination, paidVersion := b.version);
  assert |ys| == |xs|;
  assert ys[i] == paidOne;
  forall j | 0 <= j < |xs| && j != i
    ensures ys[j] == xs[j]
  {
  }
  AwardNet(e, chosen);
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
  UnpaidPrincipalNonneg(after);
  var nb := b.(paidVersion := b.version, cancels := 0);
  ReplaceBinding(e, after, nb);
  ReplaceBindingAttested(e, after, nb);
  forall c | c in ys && c.paid
    ensures contracts__ledger_awardFor(xs, c.source).paid || paidThroughBinding(bs, c)
  {
    var k :| 0 <= k < |ys| && ys[k] == c;
    if k == i {
      assert paidThroughBinding(bs, c);
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
  ensures sumRemaining([]) == 0
{
}

lemma Initial_alwaysClockStarted()
  ensures alwaysClockStarted(initial)
{
}

lemma Initial_alwaysFactoryRolesSeparate()
  ensures alwaysFactoryRolesSeparate(initial)
{
}

lemma Initial_alwaysUninitializedEmpty()
  ensures alwaysUninitializedEmpty(initial)
{
}

lemma Initial_alwaysRotationEffective()
  ensures alwaysRotationEffective(initial)
{
}

lemma Initial_alwaysOneVaultPerKey()
  ensures alwaysOneVaultPerKey(initial)
{
  assert initial.vaultKeys == [];
  KeysView(initial);
}

lemma Initial_alwaysCreatedVault()
  ensures alwaysCreatedVault(initial)
{
}

lemma Initial_alwaysConserved()
  ensures alwaysConserved(initial)
{
}

lemma Initial_alwaysBalanceCovers()
  ensures alwaysBalanceCovers(initial)
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

lemma Initial_alwaysReservedMatchesAwards()
  ensures alwaysReservedMatchesAwards(initial)
{
}

lemma Initial_alwaysPaidMatchesAwards()
  ensures alwaysPaidMatchesAwards(initial)
{
}

lemma Initial_alwaysAwardsWellFormed()
  ensures alwaysAwardsWellFormed(initial)
{
  assert initial.vault.awards == [];
  UniqueSourcesView([]);
}

lemma Initial_alwaysMonthsWellFormed()
  ensures alwaysMonthsWellFormed(initial)
{
  assert initial.vault.months == [];
  MonthsView(initial);
}

lemma Initial_alwaysPendingMatchesMonths()
  ensures alwaysPendingMatchesMonths(initial)
{
  assert initial.vault == emptyVault;
  assert emptyVault.months == [];
  assert emptyVault.pendingMonthly == 0;
  assert sumRemaining([]) == 0;
}

lemma Initial_alwaysBountyHasNoMonthly()
  ensures alwaysBountyHasNoMonthly(initial)
{
}

lemma Initial_alwaysBindingsWellFormed()
  ensures alwaysBindingsWellFormed(initial)
{
  assert initial.vault.bindings == [];
  BindingsView(initial);
}



// ---- Legacy monthly allocation --------------------------------------------------

lemma LeafTotalCons(xs: seq<contracts__ledger_Leaf>)
  requires |xs| > 0
  ensures contracts__ledger_leafTotal(xs) == xs[0].gross + contracts__ledger_leafTotal(xs[1..])
{
  SumFoldShift((t: int, l: contracts__ledger_Leaf) => (t + l.gross), (l: contracts__ledger_Leaf) => l.gross, xs[0].gross, xs[1..]);
}

lemma LeafTotalNonneg(xs: seq<contracts__ledger_Leaf>)
  requires forall l :: l in xs ==> l.gross >= 0
  ensures contracts__ledger_leafTotal(xs) >= 0
{
  forall i | 0 <= i < |xs|
    ensures xs[i].gross >= 0
  {
    assert xs[i] in xs;
  }
  SumFoldNonneg((t: int, l: contracts__ledger_Leaf) => (t + l.gross), (l: contracts__ledger_Leaf) => l.gross, 0, xs);
}

// Charging newEntries, distinct leaves one after another: each becomes an unpaid
// award, the free balance pays their gross, and nothing else changes.
lemma ChargeFold(e: Escrow, f: (Vault, contracts__ledger_Leaf) -> Vault, v: Vault, xs: seq<contracts__ledger_Leaf>)
  requires forall w, l :: f(w, l) == charged(w, l.source, l.actor, l.gross, e.now)
  requires v.key == e.vault.key && e.vault.key.purpose.Ordinary? && e.now > 0
  requires alwaysAwardsWellFormed(e.(vault := v)) && alwaysReservedMatchesAwards(e.(vault := v)) && alwaysPaidMatchesAwards(e.(vault := v))
  requires forall l :: l in xs ==> l.actor > 0 && l.gross > 0 && l.source > 0 && !contracts__ledger_hasSource(v.awards, l.source)
  requires forall i, j :: 0 <= i < j < |xs| ==> xs[i].source != xs[j].source
  requires contracts__ledger_leafTotal(xs) <= v.free
  ensures Std.Collections.Seq.FoldLeft(f, v, xs) == v.(free := Std.Collections.Seq.FoldLeft(f, v, xs).free,
    reservedPrincipal := Std.Collections.Seq.FoldLeft(f, v, xs).reservedPrincipal,
    reservedFees := Std.Collections.Seq.FoldLeft(f, v, xs).reservedFees,
    sourceSequence := Std.Collections.Seq.FoldLeft(f, v, xs).sourceSequence,
    awards := Std.Collections.Seq.FoldLeft(f, v, xs).awards)
  ensures Std.Collections.Seq.FoldLeft(f, v, xs).free == v.free - contracts__ledger_leafTotal(xs)
  ensures Std.Collections.Seq.FoldLeft(f, v, xs).free + Std.Collections.Seq.FoldLeft(f, v, xs).reservedPrincipal
    + Std.Collections.Seq.FoldLeft(f, v, xs).reservedFees == v.free + v.reservedPrincipal + v.reservedFees
  ensures Std.Collections.Seq.FoldLeft(f, v, xs).sourceSequence >= v.sourceSequence
  ensures alwaysAwardsWellFormed(e.(vault := Std.Collections.Seq.FoldLeft(f, v, xs)))
  ensures alwaysReservedMatchesAwards(e.(vault := Std.Collections.Seq.FoldLeft(f, v, xs)))
  ensures alwaysPaidMatchesAwards(e.(vault := Std.Collections.Seq.FoldLeft(f, v, xs)))
  ensures forall a :: a in Std.Collections.Seq.FoldLeft(f, v, xs).awards ==> a in v.awards || !a.paid
  ensures forall a :: a in v.awards ==> a in Std.Collections.Seq.FoldLeft(f, v, xs).awards
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    var w := f(v, first);
    var n := contracts__ledger_newAward(first.source, first.actor, first.gross, contracts__ledger_awardFee(v.key.purpose, first.gross), e.now);
    assert w == charged(v, first.source, first.actor, first.gross, e.now);
    assert w.awards == v.awards + [n];
    assert first in xs;
    RecordAward(e.(vault := v), e.(vault := w), n);
    LeafTotalCons(xs);
    forall k | k in xs[1..]
      ensures !contracts__ledger_hasSource(w.awards, k.source)
    {
      var j :| 0 <= j < |xs[1..]| && xs[1..][j] == k;
      assert xs[j + 1] == k;
      assert k.source != first.source;
      assert k in xs;
      if contracts__ledger_hasSource(w.awards, k.source) {
        var a :| a in w.awards && a.source == k.source;
        assert a in v.awards || a == n;
      }
    }
    forall i, j | 0 <= i < j < |xs[1..]|
      ensures xs[1..][i].source != xs[1..][j].source
    {
      assert xs[1..][i] == xs[i + 1] && xs[1..][j] == xs[j + 1];
    }
    ChargeFold(e, f, w, xs[1..]);
    assert Std.Collections.Seq.FoldLeft(f, v, xs) == Std.Collections.Seq.FoldLeft(f, w, xs[1..]);
  }
}

// An entry that is already an award has a positive gross.
lemma EntriesNonneg(e: Escrow, entries: seq<contracts__ledger_Leaf>)
  requires alwaysAwardsWellFormed(e)
  requires forall l :: l in entries ==> !contracts__ledger_hasSource(e.vault.awards, l.source) || existingMatches(e.vault, l)
  requires forall l :: l in entries && !contracts__ledger_hasSource(e.vault.awards, l.source) ==> l.gross > 0
  ensures contracts__ledger_leafTotal(entries) >= 0
{
  forall l | l in entries
    ensures l.gross >= 0
  {
    if contracts__ledger_hasSource(e.vault.awards, l.source) {
      var a :| a in e.vault.awards && a.source == l.source;
      var k :| 0 <= k < |e.vault.awards| && e.vault.awards[k] == a;
      AwardForAt(e.vault.awards, k);
      assert existingMatches(e.vault, l);
    }
  }
  LeafTotalNonneg(entries);
}

lemma CommitMonthlyFacts(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, attested: bool)
  requires inv(e) && canCommitMonthly(e, period, entries, attested)
  ensures alwaysAwardsWellFormed(commitMonthly(e, period, entries, attested))
  ensures alwaysReservedMatchesAwards(commitMonthly(e, period, entries, attested))
  ensures alwaysPaidMatchesAwards(commitMonthly(e, period, entries, attested))
  ensures alwaysMonthsWellFormed(commitMonthly(e, period, entries, attested))
  ensures alwaysPendingMatchesMonths(commitMonthly(e, period, entries, attested))
  ensures alwaysNonnegative(commitMonthly(e, period, entries, attested))
  ensures alwaysConserved(commitMonthly(e, period, entries, attested))
  ensures alwaysBalanceCovers(commitMonthly(e, period, entries, attested))
  ensures alwaysFeesAccounted(commitMonthly(e, period, entries, attested))
  ensures alwaysCreatedVault(commitMonthly(e, period, entries, attested))
  ensures alwaysBountyHasNoMonthly(commitMonthly(e, period, entries, attested))
  ensures alwaysBindingsWellFormed(commitMonthly(e, period, entries, attested))
  ensures stepPaidToLiveBinding(e, commitMonthly(e, period, entries, attested))
  ensures stepAwardsRetained(e, commitMonthly(e, period, entries, attested))
  ensures stepMonthsRetained(e, commitMonthly(e, period, entries, attested))
  ensures stepNewBindingAttested(e, commitMonthly(e, period, entries, attested))
  ensures stepConfigurationFixed(e, commitMonthly(e, period, entries, attested))
  ensures stepAuthorityChanges(e, "commitMonthly", commitMonthly(e, period, entries, attested))
  ensures stepMonthlyPolicyByOwner(e, "commitMonthly", commitMonthly(e, period, entries, attested))
{
  var after := commitMonthly(e, period, entries, attested);
  var newEntries := freshEntries(e.vault, entries);
  FreshView(e.vault, entries);
  CommitMonthlyView(e, period, entries, attested);
  forall k | k in newEntries
    ensures k.actor > 0 && k.gross > 0 && k.source > 0 && !contracts__ledger_hasSource(e.vault.awards, k.source)
  {
    ProofLib.FilterMember((l: contracts__ledger_Leaf) => !(contracts__ledger_hasSource(e.vault.awards, l.source)), entries, k);
  }
  forall i, j | 0 <= i < j < |newEntries|
    ensures newEntries[i].source != newEntries[j].source
  {
    if newEntries[i].source == newEntries[j].source {
      var k := newEntries[i];
      assert k in newEntries;
      ProofLib.FilterTwo((o: contracts__ledger_Leaf) => (o.source == k.source), newEntries, i, j);
    }
  }
  ChargeFold(e, (v: Vault, l: contracts__ledger_Leaf) => charged(v, l.source, l.actor, l.gross, e.now), e.vault, newEntries);
  var r := Std.Collections.Seq.FoldLeft((v: Vault, l: contracts__ledger_Leaf) => charged(v, l.source, l.actor, l.gross, e.now), e.vault, newEntries);
  var nm := noMonth.(period := period, root := "legacy", wholeGross := contracts__ledger_leafTotal(entries), count := |entries|, admittedAt := e.now, cap := e.vault.monthlyCap, leaves := entries);
  assert after == e.(vault := r.(months := r.months + [nm]));
  forall k | k in entries && !contracts__ledger_hasSource(e.vault.awards, k.source)
    ensures k.gross > 0
  {
    ProofLib.FilterMember((l: contracts__ledger_Leaf) => !(contracts__ledger_hasSource(e.vault.awards, l.source)), entries, k);
  }
  EntriesNonneg(e, entries);
  AppendMonth(e, after, nm);
  UnpaidPrincipalNonneg(after);
  PaidLiveFromOld(e, after);
  forall a | a in e.vault.awards
    ensures a in after.vault.awards
  {
  }
  forall b | b in after.vault.bindings
    ensures b in e.vault.bindings
  {
  }
}

lemma tick_ensures(e: Escrow, timestamp: int)
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysClockStarted(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysFactoryRolesSeparate(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysUninitializedEmpty(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysRotationEffective(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysOneVaultPerKey(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysCreatedVault(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysConserved(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysBalanceCovers(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysFeesAccounted(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysNonnegative(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysReservedMatchesAwards(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysPaidMatchesAwards(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysAwardsWellFormed(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysMonthsWellFormed(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysPendingMatchesMonths(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysBountyHasNoMonthly(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysBindingsWellFormed(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepAuthorityChanges(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepConfigurationFixed(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepAwardsRetained(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepMonthlyPolicyByOwner(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepMonthsRetained(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepNewBindingAttested(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepPaidToLiveBinding(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepFreeSpentByOwnerOrAttestation(e, "tick", tick(e, timestamp)))
{
  if inv(e) && canTick(e, timestamp) {
    SameAwards(e, tick(e, timestamp));
    AwardsFrame(e, tick(e, timestamp));
  }
}

lemma proposeUpgradeAuthority_ensures(e: Escrow, successor: string, by_: string)
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysClockStarted(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysFactoryRolesSeparate(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysUninitializedEmpty(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysRotationEffective(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysOneVaultPerKey(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysCreatedVault(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysConserved(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysBalanceCovers(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysFeesAccounted(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysNonnegative(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysReservedMatchesAwards(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysPaidMatchesAwards(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysAwardsWellFormed(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysMonthsWellFormed(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysPendingMatchesMonths(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysBountyHasNoMonthly(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysBindingsWellFormed(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepAuthorityChanges(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepConfigurationFixed(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepAwardsRetained(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepMonthlyPolicyByOwner(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepMonthsRetained(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepNewBindingAttested(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepPaidToLiveBinding(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
{
  if inv(e) && canProposeUpgradeAuthority(e, successor, by_) {
    SameAwards(e, proposeUpgradeAuthority(e, successor, by_));
    AwardsFrame(e, proposeUpgradeAuthority(e, successor, by_));
  }
}

lemma acceptUpgradeAuthority_ensures(e: Escrow, by_: string)
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysClockStarted(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysFactoryRolesSeparate(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysUninitializedEmpty(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysRotationEffective(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysOneVaultPerKey(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysCreatedVault(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysConserved(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysBalanceCovers(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysFeesAccounted(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysNonnegative(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysReservedMatchesAwards(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysPaidMatchesAwards(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysAwardsWellFormed(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysMonthsWellFormed(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysPendingMatchesMonths(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysBountyHasNoMonthly(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysBindingsWellFormed(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepAuthorityChanges(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepConfigurationFixed(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepAwardsRetained(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepMonthlyPolicyByOwner(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepMonthsRetained(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepNewBindingAttested(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepPaidToLiveBinding(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
{
  if inv(e) && canAcceptUpgradeAuthority(e, by_) {
    SameAwards(e, acceptUpgradeAuthority(e, by_));
    AwardsFrame(e, acceptUpgradeAuthority(e, by_));
  }
}

lemma setVaultImplementation_ensures(e: Escrow, logic: int, uups: bool, by_: string)
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysClockStarted(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysFactoryRolesSeparate(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysUninitializedEmpty(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysRotationEffective(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysOneVaultPerKey(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysCreatedVault(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysConserved(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysBalanceCovers(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysFeesAccounted(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysNonnegative(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysReservedMatchesAwards(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysPaidMatchesAwards(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysAwardsWellFormed(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysMonthsWellFormed(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysPendingMatchesMonths(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysBountyHasNoMonthly(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysBindingsWellFormed(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepAuthorityChanges(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepConfigurationFixed(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepAwardsRetained(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepMonthsRetained(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepNewBindingAttested(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
{
  if inv(e) && canSetVaultImplementation(e, logic, uups, by_) {
    SameAwards(e, setVaultImplementation(e, logic, uups, by_));
    AwardsFrame(e, setVaultImplementation(e, logic, uups, by_));
  }
}

lemma upgradeFactory_ensures(e: Escrow, logic: int, uups: bool, by_: string)
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysClockStarted(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysFactoryRolesSeparate(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysUninitializedEmpty(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysRotationEffective(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysOneVaultPerKey(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysCreatedVault(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysConserved(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysBalanceCovers(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysFeesAccounted(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysNonnegative(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysReservedMatchesAwards(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysPaidMatchesAwards(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysAwardsWellFormed(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysMonthsWellFormed(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysPendingMatchesMonths(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysBountyHasNoMonthly(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysBindingsWellFormed(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepAuthorityChanges(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepConfigurationFixed(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepAwardsRetained(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepMonthsRetained(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepNewBindingAttested(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
{
  if inv(e) && canUpgradeFactory(e, logic, uups, by_) {
    SameAwards(e, upgradeFactory(e, logic, uups, by_));
    AwardsFrame(e, upgradeFactory(e, logic, uups, by_));
  }
}

lemma upgradeVault_ensures(e: Escrow, logic: int, uups: bool, by_: string)
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysClockStarted(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysFactoryRolesSeparate(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysUninitializedEmpty(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysRotationEffective(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysOneVaultPerKey(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysCreatedVault(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysConserved(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysBalanceCovers(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysFeesAccounted(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysNonnegative(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysReservedMatchesAwards(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysPaidMatchesAwards(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysAwardsWellFormed(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysMonthsWellFormed(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysPendingMatchesMonths(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysBountyHasNoMonthly(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysBindingsWellFormed(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepAuthorityChanges(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepConfigurationFixed(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepAwardsRetained(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepMonthsRetained(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepNewBindingAttested(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
{
  if inv(e) && canUpgradeVault(e, logic, uups, by_) {
    SameAwards(e, upgradeVault(e, logic, uups, by_));
    AwardsFrame(e, upgradeVault(e, logic, uups, by_));
  }
}

lemma proposeIdentityAuthority_ensures(e: Escrow, successor: string, by_: string)
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysClockStarted(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysFactoryRolesSeparate(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysUninitializedEmpty(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysRotationEffective(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysOneVaultPerKey(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysCreatedVault(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysConserved(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysBalanceCovers(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysFeesAccounted(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysNonnegative(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysReservedMatchesAwards(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysPaidMatchesAwards(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysAwardsWellFormed(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysMonthsWellFormed(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysPendingMatchesMonths(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysBountyHasNoMonthly(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysBindingsWellFormed(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepAuthorityChanges(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepConfigurationFixed(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepAwardsRetained(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepMonthlyPolicyByOwner(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepMonthsRetained(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepNewBindingAttested(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepPaidToLiveBinding(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
{
  if inv(e) && canProposeIdentityAuthority(e, successor, by_) {
    SameAwards(e, proposeIdentityAuthority(e, successor, by_));
    AwardsFrame(e, proposeIdentityAuthority(e, successor, by_));
  }
}

lemma cancelIdentityAuthorityRotation_ensures(e: Escrow, by_: string)
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysClockStarted(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysFactoryRolesSeparate(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysUninitializedEmpty(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysRotationEffective(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysOneVaultPerKey(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysCreatedVault(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysConserved(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysBalanceCovers(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysFeesAccounted(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysNonnegative(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysReservedMatchesAwards(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysPaidMatchesAwards(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysAwardsWellFormed(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysMonthsWellFormed(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysPendingMatchesMonths(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysBountyHasNoMonthly(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysBindingsWellFormed(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepAuthorityChanges(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepConfigurationFixed(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepAwardsRetained(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepMonthlyPolicyByOwner(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepMonthsRetained(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepNewBindingAttested(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepPaidToLiveBinding(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
{
  if inv(e) && canCancelIdentityAuthorityRotation(e, by_) {
    SameAwards(e, cancelIdentityAuthorityRotation(e, by_));
    AwardsFrame(e, cancelIdentityAuthorityRotation(e, by_));
  }
}

lemma executeIdentityAuthorityRotation_ensures(e: Escrow)
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysClockStarted(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysFactoryRolesSeparate(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysUninitializedEmpty(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysRotationEffective(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysOneVaultPerKey(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysCreatedVault(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysConserved(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysBalanceCovers(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysFeesAccounted(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysNonnegative(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysReservedMatchesAwards(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysPaidMatchesAwards(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysAwardsWellFormed(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysMonthsWellFormed(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysPendingMatchesMonths(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysBountyHasNoMonthly(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysBindingsWellFormed(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepAuthorityChanges(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepConfigurationFixed(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepAwardsRetained(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepMonthlyPolicyByOwner(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepMonthsRetained(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepNewBindingAttested(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepPaidToLiveBinding(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepFreeSpentByOwnerOrAttestation(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
{
  if inv(e) && canExecuteIdentityAuthorityRotation(e) {
    SameAwards(e, executeIdentityAuthorityRotation(e));
    AwardsFrame(e, executeIdentityAuthorityRotation(e));
  }
}

lemma deposit_ensures(e: Escrow, amount: int, sent: int, transferExact: bool)
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysClockStarted(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysFactoryRolesSeparate(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysUninitializedEmpty(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysRotationEffective(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysOneVaultPerKey(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysCreatedVault(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysConserved(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysBalanceCovers(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysFeesAccounted(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysNonnegative(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysReservedMatchesAwards(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysPaidMatchesAwards(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysAwardsWellFormed(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysMonthsWellFormed(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysPendingMatchesMonths(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysBountyHasNoMonthly(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysBindingsWellFormed(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepAuthorityChanges(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepConfigurationFixed(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepAwardsRetained(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepMonthlyPolicyByOwner(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepMonthsRetained(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepNewBindingAttested(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepPaidToLiveBinding(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepFreeSpentByOwnerOrAttestation(e, "deposit", deposit(e, amount, sent, transferExact)))
{
  if inv(e) && canDeposit(e, amount, sent, transferExact) {
    SameAwards(e, deposit(e, amount, sent, transferExact));
    AwardsFrame(e, deposit(e, amount, sent, transferExact));
  }
}

lemma transferIn_ensures(e: Escrow, amount: int)
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysClockStarted(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysFactoryRolesSeparate(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysUninitializedEmpty(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysRotationEffective(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysOneVaultPerKey(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysCreatedVault(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysConserved(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysBalanceCovers(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysFeesAccounted(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysNonnegative(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysReservedMatchesAwards(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysPaidMatchesAwards(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysAwardsWellFormed(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysMonthsWellFormed(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysPendingMatchesMonths(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysBountyHasNoMonthly(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysBindingsWellFormed(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepAuthorityChanges(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepConfigurationFixed(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepAwardsRetained(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepMonthlyPolicyByOwner(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepMonthsRetained(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepNewBindingAttested(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepPaidToLiveBinding(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepFreeSpentByOwnerOrAttestation(e, "transferIn", transferIn(e, amount)))
{
  if inv(e) && canTransferIn(e, amount) {
    SameAwards(e, transferIn(e, amount));
    AwardsFrame(e, transferIn(e, amount));
  }
}

lemma setMonthlyCommitment_ensures(e: Escrow, cap: int, on: bool, by_: string)
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysClockStarted(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysFactoryRolesSeparate(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysUninitializedEmpty(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysRotationEffective(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysOneVaultPerKey(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysCreatedVault(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysConserved(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysBalanceCovers(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysFeesAccounted(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysNonnegative(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysReservedMatchesAwards(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysPaidMatchesAwards(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysAwardsWellFormed(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysMonthsWellFormed(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysPendingMatchesMonths(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysBountyHasNoMonthly(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysBindingsWellFormed(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepAuthorityChanges(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepConfigurationFixed(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepAwardsRetained(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepMonthlyPolicyByOwner(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepMonthsRetained(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepNewBindingAttested(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepPaidToLiveBinding(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
{
  if inv(e) && canSetMonthlyCommitment(e, cap, on, by_) {
    SameAwards(e, setMonthlyCommitment(e, cap, on, by_));
    AwardsFrame(e, setMonthlyCommitment(e, cap, on, by_));
  }
}

lemma withdrawUnused_ensures(e: Escrow, gross: int, transferOk: bool, by_: string)
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysClockStarted(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysFactoryRolesSeparate(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysUninitializedEmpty(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysRotationEffective(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysOneVaultPerKey(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysCreatedVault(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysConserved(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysBalanceCovers(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysFeesAccounted(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysNonnegative(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysReservedMatchesAwards(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysPaidMatchesAwards(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysAwardsWellFormed(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysMonthsWellFormed(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysPendingMatchesMonths(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysBountyHasNoMonthly(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysBindingsWellFormed(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepAuthorityChanges(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepConfigurationFixed(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepAwardsRetained(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepMonthlyPolicyByOwner(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepMonthsRetained(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepNewBindingAttested(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepPaidToLiveBinding(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
{
  if inv(e) && canWithdrawUnused(e, gross, transferOk, by_) {
    SameAwards(e, withdrawUnused(e, gross, transferOk, by_));
    AwardsFrame(e, withdrawUnused(e, gross, transferOk, by_));
  }
}

lemma claimFees_ensures(e: Escrow, transferOk: bool)
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysClockStarted(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysFactoryRolesSeparate(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysUninitializedEmpty(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysRotationEffective(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysOneVaultPerKey(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysCreatedVault(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysConserved(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysBalanceCovers(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysFeesAccounted(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysNonnegative(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysReservedMatchesAwards(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysPaidMatchesAwards(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysAwardsWellFormed(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysMonthsWellFormed(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysPendingMatchesMonths(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysBountyHasNoMonthly(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysBindingsWellFormed(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepAuthorityChanges(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepConfigurationFixed(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepAwardsRetained(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepMonthlyPolicyByOwner(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepMonthsRetained(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepNewBindingAttested(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepPaidToLiveBinding(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepFreeSpentByOwnerOrAttestation(e, "claimFees", claimFees(e, transferOk)))
{
  if inv(e) && canClaimFees(e, transferOk) {
    SameAwards(e, claimFees(e, transferOk));
    AwardsFrame(e, claimFees(e, transferOk));
  }
}

lemma create_ensures(e: Escrow, project: string, token: string, purpose: contracts__ledger_Purpose, tokenReady: bool, by_: string)
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysClockStarted(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysFactoryRolesSeparate(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysUninitializedEmpty(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysRotationEffective(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysOneVaultPerKey(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysCreatedVault(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysConserved(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysBalanceCovers(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysFeesAccounted(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysNonnegative(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysReservedMatchesAwards(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysPaidMatchesAwards(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysAwardsWellFormed(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysMonthsWellFormed(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysPendingMatchesMonths(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysBountyHasNoMonthly(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysBindingsWellFormed(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepAuthorityChanges(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepConfigurationFixed(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepAwardsRetained(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepMonthlyPolicyByOwner(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepMonthsRetained(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepNewBindingAttested(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepPaidToLiveBinding(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "create", create(e, project, token, purpose, tokenReady, by_)))
{
  if inv(e) && canCreate(e, project, token, purpose, tokenReady, by_) {
    var after := create(e, project, token, purpose, tokenReady, by_);
    if !e.created {
      assert e.vault == emptyVault;
    }
    assert after.vault.awards == e.vault.awards;
    SameAwards(e, after);
    AwardsFrame(e, after);
    KeysAppend(e, after, keyOf(by_, project, token, purpose));
  }
}

lemma createWithMonthlyCommitment_ensures(e: Escrow, project: string, token: string, cap: int, on: bool, tokenReady: bool, by_: string)
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysClockStarted(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysFactoryRolesSeparate(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysUninitializedEmpty(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysRotationEffective(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysOneVaultPerKey(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysCreatedVault(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysConserved(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysBalanceCovers(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysFeesAccounted(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysNonnegative(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysReservedMatchesAwards(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysPaidMatchesAwards(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysAwardsWellFormed(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysMonthsWellFormed(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysPendingMatchesMonths(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysBountyHasNoMonthly(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysBindingsWellFormed(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepAuthorityChanges(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepConfigurationFixed(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepAwardsRetained(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepMonthlyPolicyByOwner(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepMonthsRetained(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepNewBindingAttested(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepPaidToLiveBinding(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
{
  if inv(e) && canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) {
    var after := createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_);
    if !e.created {
      assert e.vault == emptyVault;
    }
    assert after.vault.awards == e.vault.awards;
    SameAwards(e, after);
    AwardsFrame(e, after);
    KeysAppend(e, after, keyOf(by_, project, token, contracts__ledger_Purpose.Ordinary));
  }
}

lemma commitAward_ensures(e: Escrow, source: int, actor: int, gross: int, by_: string)
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysClockStarted(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysFactoryRolesSeparate(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysUninitializedEmpty(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysRotationEffective(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysOneVaultPerKey(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysCreatedVault(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysConserved(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysBalanceCovers(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysFeesAccounted(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysNonnegative(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysReservedMatchesAwards(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysPaidMatchesAwards(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysAwardsWellFormed(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysMonthsWellFormed(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysPendingMatchesMonths(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysBountyHasNoMonthly(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepAuthorityChanges(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepConfigurationFixed(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepAwardsRetained(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepMonthlyPolicyByOwner(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepMonthsRetained(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepNewBindingAttested(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepPaidToLiveBinding(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "commitAward", commitAward(e, source, actor, gross, by_)))
{
  if inv(e) && canCommitAward(e, source, actor, gross, by_) {
    var after := commitAward(e, source, actor, gross, by_);
    RecordAward(e, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(e.vault.key.purpose, gross), e.now));
  }
}

lemma commitBountyAward_ensures(e: Escrow, source: int, actor: int, gross: int, by_: string)
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysClockStarted(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysFactoryRolesSeparate(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysUninitializedEmpty(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysRotationEffective(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysOneVaultPerKey(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysCreatedVault(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysConserved(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysBalanceCovers(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysFeesAccounted(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysNonnegative(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysReservedMatchesAwards(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysPaidMatchesAwards(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysAwardsWellFormed(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysMonthsWellFormed(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysPendingMatchesMonths(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysBountyHasNoMonthly(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepAuthorityChanges(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepConfigurationFixed(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepAwardsRetained(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepMonthlyPolicyByOwner(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepMonthsRetained(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepNewBindingAttested(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepPaidToLiveBinding(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
{
  if inv(e) && canCommitBountyAward(e, source, actor, gross, by_) {
    var after := commitBountyAward(e, source, actor, gross, by_);
    RecordAward(e, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(e.vault.key.purpose, gross), e.now));
  }
}

lemma commitMonthlyLeaf_ensures(e: Escrow, period: int, leaf: contracts__ledger_Leaf)
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysClockStarted(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysFactoryRolesSeparate(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysUninitializedEmpty(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysRotationEffective(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysOneVaultPerKey(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysCreatedVault(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysConserved(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysBalanceCovers(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysFeesAccounted(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysNonnegative(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysReservedMatchesAwards(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysPaidMatchesAwards(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysAwardsWellFormed(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysMonthsWellFormed(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysPendingMatchesMonths(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysBountyHasNoMonthly(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysBindingsWellFormed(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepAuthorityChanges(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepConfigurationFixed(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepAwardsRetained(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepMonthlyPolicyByOwner(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepMonthsRetained(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepNewBindingAttested(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepPaidToLiveBinding(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepFreeSpentByOwnerOrAttestation(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
{
  if inv(e) && canCommitMonthlyLeaf(e, period, leaf) {
    var after := commitMonthlyLeaf(e, period, leaf);
    var i := MonthForIndex(e, period);
    var m := e.vault.months[i];
    assert e.vault.key.purpose.Ordinary?;
    RecordAward(e, after, contracts__ledger_newAward(leaf.source, leaf.actor, leaf.gross, settlement__money_ordinaryFee(leaf.gross), e.now));
    assert m.released == 0;
    ReplaceMonth(e, after, i, m.(remaining := (m.remaining - leaf.gross), committedGross := (m.committedGross + leaf.gross)));
  }
}

lemma releaseMonthlyReserve_ensures(e: Escrow, period: int, expectedRemaining: int, releasedGross: int, attested: bool, by_: string)
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysClockStarted(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysFactoryRolesSeparate(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysUninitializedEmpty(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysRotationEffective(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysOneVaultPerKey(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysCreatedVault(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysConserved(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysBalanceCovers(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysFeesAccounted(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysNonnegative(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysReservedMatchesAwards(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysPaidMatchesAwards(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysAwardsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysMonthsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysPendingMatchesMonths(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysBountyHasNoMonthly(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> alwaysBindingsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepAuthorityChanges(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepConfigurationFixed(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepAwardsRetained(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepMonthlyPolicyByOwner(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepMonthsRetained(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepNewBindingAttested(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepPaidToLiveBinding(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_)))
{
  if inv(e) && canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_) {
    var after := releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, attested, by_);
    var i := MonthForIndex(e, period);
    var m := e.vault.months[i];
    assert m.committedGross == 0 && m.released == 0;
    SameAwards(e, after);
    AwardsFrame(e, after);
    ReplaceMonth(e, after, i, m.(remaining := 0, released := releasedGross));
  }
}

lemma reserveMonthly_ensures(e: Escrow, period: int, reservation: Reservation, sequence: int, attested: bool)
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysClockStarted(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysFactoryRolesSeparate(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysUninitializedEmpty(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysRotationEffective(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysOneVaultPerKey(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysCreatedVault(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysConserved(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysBalanceCovers(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysFeesAccounted(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysNonnegative(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysReservedMatchesAwards(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysPaidMatchesAwards(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysAwardsWellFormed(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysMonthsWellFormed(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysPendingMatchesMonths(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysBountyHasNoMonthly(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> alwaysBindingsWellFormed(reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepAuthorityChanges(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepConfigurationFixed(e, reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepAwardsRetained(e, reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepMonthlyPolicyByOwner(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepMonthsRetained(e, reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepNewBindingAttested(e, reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepPaidToLiveBinding(e, reserveMonthly(e, period, reservation, sequence, attested)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, attested) ==> stepFreeSpentByOwnerOrAttestation(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, attested)))
{
  if inv(e) && canReserveMonthly(e, period, reservation, sequence, attested) {
    var after := reserveMonthly(e, period, reservation, sequence, attested);
    SameAwards(e, after);
    AwardsFrame(e, after);
    AppendMonth(e, after, Month(period, true, reservation.digest, reservation.root, reservation.wholeGross, reservation.remainingGross, reservation.remainingGross, reservation.count, 0, 0, e.now, e.vault.monthlyCap, reservation.leaves));
  }
}

lemma bindDestination_ensures(e: Escrow, actor: int, destination: string, expectedVersion: int, claim: int, expiresAt: int, walletSigned: bool, by_: string)
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysClockStarted(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysFactoryRolesSeparate(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysUninitializedEmpty(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysRotationEffective(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysOneVaultPerKey(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysCreatedVault(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysConserved(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysBalanceCovers(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysFeesAccounted(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysNonnegative(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysReservedMatchesAwards(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysPaidMatchesAwards(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysAwardsWellFormed(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysMonthsWellFormed(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysPendingMatchesMonths(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysBountyHasNoMonthly(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysBindingsWellFormed(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepAuthorityChanges(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepConfigurationFixed(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepAwardsRetained(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepMonthlyPolicyByOwner(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepMonthsRetained(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepNewBindingAttested(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepPaidToLiveBinding(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
{
  if inv(e) && canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) {
    var after := bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_);
    var old_ := bindingFor(e.vault.bindings, actor);
    BindingForFound(e.vault.bindings, actor);
    if old_ != noBinding {
      assert old_ in e.vault.bindings;
    }
    var nb := old_.(actor := actor, destination := destination, version := (expectedVersion + 1), claim := claim, activatesAt := e.now, cancelled := false, attester := by_, walletSigned := true);
    ReplaceBinding(e, after, nb);
    ReplaceBindingAttested(e, after, nb);
    SameAwards(e, after);
    AwardsFrame(e, after);
  }
}

lemma cancelBinding_ensures(e: Escrow, actor: int, expectedVersion: int, by_: string)
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysClockStarted(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysFactoryRolesSeparate(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysUninitializedEmpty(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysRotationEffective(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysOneVaultPerKey(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysCreatedVault(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysConserved(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysBalanceCovers(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysFeesAccounted(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysNonnegative(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysReservedMatchesAwards(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysPaidMatchesAwards(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysAwardsWellFormed(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysMonthsWellFormed(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysPendingMatchesMonths(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysBountyHasNoMonthly(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysBindingsWellFormed(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepAuthorityChanges(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepConfigurationFixed(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepAwardsRetained(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepMonthlyPolicyByOwner(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepMonthsRetained(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepNewBindingAttested(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepPaidToLiveBinding(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
{
  if inv(e) && canCancelBinding(e, actor, expectedVersion, by_) {
    var after := cancelBinding(e, actor, expectedVersion, by_);
    var b := bindingFor(e.vault.bindings, actor);
    BindingForFound(e.vault.bindings, actor);
    assert b in e.vault.bindings;
    var nb := b.(cancelled := true, cancels := contracts__ledger_cancelsAfter(b.cancels, (e.pendingIdentityAuthority != "")));
    ReplaceBinding(e, after, nb);
    ReplaceBindingAttested(e, after, nb);
    SameAwards(e, after);
    AwardsFrame(e, after);
  }
}

lemma pay_ensures(e: Escrow, source: int, expectedVersion: int, transferOk: bool)
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysClockStarted(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysFactoryRolesSeparate(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysUninitializedEmpty(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysRotationEffective(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysOneVaultPerKey(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysCreatedVault(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysConserved(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysBalanceCovers(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysFeesAccounted(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysNonnegative(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysReservedMatchesAwards(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysPaidMatchesAwards(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysAwardsWellFormed(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysMonthsWellFormed(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysPendingMatchesMonths(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysBountyHasNoMonthly(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysBindingsWellFormed(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepAuthorityChanges(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepConfigurationFixed(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepAwardsRetained(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepMonthlyPolicyByOwner(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepMonthsRetained(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepNewBindingAttested(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepPaidToLiveBinding(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepFreeSpentByOwnerOrAttestation(e, "pay", pay(e, source, expectedVersion, transferOk)))
{
  if inv(e) && canPay(e, source, expectedVersion, transferOk) {
    PayFacts(e, source, expectedVersion, transferOk);
  }
}

lemma commitMonthly_ensures(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, attested: bool)
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysClockStarted(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysFactoryRolesSeparate(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysUninitializedEmpty(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysRotationEffective(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysOneVaultPerKey(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysCreatedVault(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysConserved(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysBalanceCovers(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysFeesAccounted(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysNonnegative(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysReservedMatchesAwards(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysPaidMatchesAwards(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysAwardsWellFormed(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysMonthsWellFormed(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysPendingMatchesMonths(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysBountyHasNoMonthly(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> alwaysBindingsWellFormed(commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepAuthorityChanges(e, "commitMonthly", commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepConfigurationFixed(e, commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepAwardsRetained(e, commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepMonthlyPolicyByOwner(e, "commitMonthly", commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepMonthsRetained(e, commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepNewBindingAttested(e, commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepPaidToLiveBinding(e, commitMonthly(e, period, entries, attested)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, attested) ==> stepFreeSpentByOwnerOrAttestation(e, "commitMonthly", commitMonthly(e, period, entries, attested)))
{
  if inv(e) && canCommitMonthly(e, period, entries, attested) {
    CommitMonthlyFacts(e, period, entries, attested);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  hide *;
  reveal inv;
  InitialIs();
  Initial_alwaysClockStarted();
  Initial_alwaysFactoryRolesSeparate();
  Initial_alwaysUninitializedEmpty();
  Initial_alwaysRotationEffective();
  Initial_alwaysOneVaultPerKey();
  Initial_alwaysCreatedVault();
  Initial_alwaysConserved();
  Initial_alwaysBalanceCovers();
  Initial_alwaysFeesAccounted();
  Initial_alwaysNonnegative();
  Initial_alwaysReservedMatchesAwards();
  Initial_alwaysPaidMatchesAwards();
  Initial_alwaysAwardsWellFormed();
  Initial_alwaysMonthsWellFormed();
  Initial_alwaysPendingMatchesMonths();
  Initial_alwaysBountyHasNoMonthly();
  Initial_alwaysBindingsWellFormed();
}
