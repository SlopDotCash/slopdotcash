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

lemma CommitMonthlyView(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, signer: string)
  ensures canCommitMonthly(e, period, entries, signer) == (var local_4 := freshEntries(e.vault, entries); (((((((admissionOpen(e, period) && (|entries| > 0)) && signedByAuthority(e, signer)) && (contracts__ledger_leafTotal(entries) <= capFor(e.vault, period))) && !((exists l :: l in entries && !((!(contracts__ledger_hasSource(e.vault.awards, l.source)) || existingMatches(e.vault, l)))))) && !((exists l :: l in local_4 && !(((((l.actor > 0) && (l.gross > 0)) && (l.source > 0)) && (|ProofLib.Filter((o: contracts__ledger_Leaf) => (o.source == l.source), local_4)| == 1)))))) && (contracts__ledger_leafTotal(local_4) <= e.vault.free)) && (contracts__ledger_leafTotal(local_4) <= unpledged(closePledge(e.vault, period)))))
{
}

// Closing a pledge changes only the pledge fields.
lemma ClosePledgeFrame(v: Vault, period: int)
  ensures closePledge(v, period) == v.(pledged := closePledge(v, period).pledged, pledges := closePledge(v, period).pledges)
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
    && nm.released >= e.vault.months[i].released && nm.committedGross >= e.vault.months[i].committedGross
    && nm.admittedAt == e.vault.months[i].admittedAt)
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


// ---- Committed-leaf origins ------------------------------------------------------

lemma OriginsView(e: Escrow)
  ensures alwaysCommittedLeavesTraced(e) == (!((exists m :: m in e.vault.months && !((m.committedGross == originGross(e.vault.origins, m.period))))) && !((exists o :: o in e.vault.origins && !((((((hasMonth(e.vault.months, o.period) && leafProves(monthFor(e.vault.months, o.period), o.leaf)) && contracts__ledger_hasSource(e.vault.awards, o.leaf.source)) && (contracts__ledger_awardFor(e.vault.awards, o.leaf.source).actor == o.leaf.actor)) && (contracts__ledger_awardFor(e.vault.awards, o.leaf.source).gross == o.leaf.gross)) && (|ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), e.vault.origins)| == 1))))))
{
}

// The trace's four parts, each over every month or every logged leaf.
lemma TracedParts(e: Escrow)
  requires alwaysCommittedLeavesTraced(e)
  ensures forall m :: m in e.vault.months ==> m.committedGross == originGross(e.vault.origins, m.period)
  ensures forall o :: o in e.vault.origins ==> hasMonth(e.vault.months, o.period) && leafProves(monthFor(e.vault.months, o.period), o.leaf)
  ensures forall o :: o in e.vault.origins ==> (contracts__ledger_hasSource(e.vault.awards, o.leaf.source)
    && contracts__ledger_awardFor(e.vault.awards, o.leaf.source).actor == o.leaf.actor
    && contracts__ledger_awardFor(e.vault.awards, o.leaf.source).gross == o.leaf.gross)
  ensures forall o :: o in e.vault.origins ==> |ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), e.vault.origins)| == 1
{
  OriginsView(e);
}

// The four parts make the trace.
lemma TracedBuild(e: Escrow)
  requires forall m :: m in e.vault.months ==> m.committedGross == originGross(e.vault.origins, m.period)
  requires forall o :: o in e.vault.origins ==> hasMonth(e.vault.months, o.period) && leafProves(monthFor(e.vault.months, o.period), o.leaf)
  requires forall o :: o in e.vault.origins ==> (contracts__ledger_hasSource(e.vault.awards, o.leaf.source)
    && contracts__ledger_awardFor(e.vault.awards, o.leaf.source).actor == o.leaf.actor
    && contracts__ledger_awardFor(e.vault.awards, o.leaf.source).gross == o.leaf.gross)
  requires forall o :: o in e.vault.origins ==> |ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), e.vault.origins)| == 1
  ensures alwaysCommittedLeavesTraced(e)
{
  OriginsView(e);
}

lemma OriginGrossAppend(os: seq<LeafOrigin>, lo: LeafOrigin, period: int)
  ensures originGross(os + [lo], period) == originGross(os, period) + (if lo.period == period then lo.leaf.gross else 0)
{
  ProofLib.FoldLeftAppend((t: int, o: LeafOrigin) => (if (o.period == period) then (t + o.leaf.gross) else t), 0, os, lo);
}

lemma OriginGrossNone(os: seq<LeafOrigin>, period: int)
  requires forall o :: o in os ==> o.period != period
  ensures originGross(os, period) == 0
{
  forall i | 0 <= i < |os|
    ensures os[i].period != period
  {
    assert os[i] in os;
  }
  OriginFoldFixed((t: int, o: LeafOrigin) => (if (o.period == period) then (t + o.leaf.gross) else t), period, 0, os);
}

lemma OriginFoldFixed(f: (int, LeafOrigin) -> int, period: int, init: int, os: seq<LeafOrigin>)
  requires forall t, x :: f(t, x) == (if (x.period == period) then (t + x.leaf.gross) else t)
  requires forall i :: 0 <= i < |os| ==> os[i].period != period
  ensures Std.Collections.Seq.FoldLeft(f, init, os) == init
  decreases |os|
{
  if |os| > 0 {
    OriginFoldFixed(f, period, init, os[1..]);
  }
}

// One source's award is the same in a list of awards that keeps every award of another, both with one award per source.
lemma AwardKept(xs: seq<contracts__ledger_Award>, ys: seq<contracts__ledger_Award>, s: int)
  requires contracts__ledger_uniqueSources(xs) && contracts__ledger_uniqueSources(ys)
  requires forall a :: a in xs ==> a in ys
  requires contracts__ledger_hasSource(xs, s)
  ensures contracts__ledger_hasSource(ys, s) && contracts__ledger_awardFor(ys, s) == contracts__ledger_awardFor(xs, s)
{
  var a :| a in xs && a.source == s;
  var k :| 0 <= k < |xs| && xs[k] == a;
  AwardForAt(xs, k);
  assert a in ys;
  var j :| 0 <= j < |ys| && ys[j] == a;
  AwardForAt(ys, j);
}

// Awards that keep every award of a list, both with one award per source, keep each source's award.
lemma AwardsSuperset(xs: seq<contracts__ledger_Award>, ys: seq<contracts__ledger_Award>)
  requires contracts__ledger_uniqueSources(xs) && contracts__ledger_uniqueSources(ys)
  requires forall a :: a in xs ==> a in ys
  ensures forall s :: contracts__ledger_hasSource(xs, s) ==> (contracts__ledger_hasSource(ys, s)
    && contracts__ledger_awardFor(ys, s) == contracts__ledger_awardFor(xs, s))
{
  forall s | contracts__ledger_hasSource(xs, s)
    ensures contracts__ledger_hasSource(ys, s) && contracts__ledger_awardFor(ys, s) == contracts__ledger_awardFor(xs, s)
  {
    AwardKept(xs, ys, s);
  }
}

// One source's actor and gross are the same in awards changed in place that keep each one's source, actor and gross.
lemma AwardMatched(xs: seq<contracts__ledger_Award>, ys: seq<contracts__ledger_Award>, s: int)
  requires contracts__ledger_uniqueSources(xs) && contracts__ledger_uniqueSources(ys)
  requires |xs| == |ys| && forall k :: 0 <= k < |xs| ==> ys[k].source == xs[k].source && ys[k].actor == xs[k].actor && ys[k].gross == xs[k].gross
  requires contracts__ledger_hasSource(xs, s)
  ensures contracts__ledger_hasSource(ys, s)
    && contracts__ledger_awardFor(ys, s).actor == contracts__ledger_awardFor(xs, s).actor
    && contracts__ledger_awardFor(ys, s).gross == contracts__ledger_awardFor(xs, s).gross
{
  var a :| a in xs && a.source == s;
  var k :| 0 <= k < |xs| && xs[k] == a;
  AwardForAt(xs, k);
  assert ys[k] in ys;
  AwardForAt(ys, k);
}

// Awards changed in place, keeping each one's source, actor and gross, keep each source's actor and gross.
lemma AwardsPointwise(xs: seq<contracts__ledger_Award>, ys: seq<contracts__ledger_Award>)
  requires contracts__ledger_uniqueSources(xs) && contracts__ledger_uniqueSources(ys)
  requires |xs| == |ys| && forall k :: 0 <= k < |xs| ==> ys[k].source == xs[k].source && ys[k].actor == xs[k].actor && ys[k].gross == xs[k].gross
  ensures forall s :: contracts__ledger_hasSource(xs, s) ==> (contracts__ledger_hasSource(ys, s)
    && contracts__ledger_awardFor(ys, s).actor == contracts__ledger_awardFor(xs, s).actor
    && contracts__ledger_awardFor(ys, s).gross == contracts__ledger_awardFor(xs, s).gross)
{
  forall s | contracts__ledger_hasSource(xs, s)
    ensures contracts__ledger_hasSource(ys, s)
      && contracts__ledger_awardFor(ys, s).actor == contracts__ledger_awardFor(xs, s).actor
      && contracts__ledger_awardFor(ys, s).gross == contracts__ledger_awardFor(xs, s).gross
  {
    AwardMatched(xs, ys, s);
  }
}

// The last award of a list is its source's award.
lemma AwardForAppendSelf(xs: seq<contracts__ledger_Award>, n: contracts__ledger_Award)
  ensures contracts__ledger_awardFor(xs + [n], n.source) == n
{
  AwardForLast(xs, n, n.source);
}

lemma AwardForLast(xs: seq<contracts__ledger_Award>, n: contracts__ledger_Award, source: int)
  requires n.source == source
  ensures contracts__ledger_awardFor(xs + [n], source) == n
{
  ProofLib.FoldLeftAppend((found: contracts__ledger_Award, a: contracts__ledger_Award) => (if (a.source == source) then a else found), contracts__ledger_noAward, xs, n);
}

// withMonth puts the new month exactly where its period was.
lemma WithMonthAt(ms: seq<Month>, nm: Month, k: int)
  requires 0 <= k < |ms|
  ensures |withMonth(ms, nm)| == |ms|
  ensures withMonth(ms, nm)[k] == (if ms[k].period == nm.period then nm else ms[k])
  ensures withMonth(ms, nm)[k].period == ms[k].period
{
}

// Well-formed months have distinct periods.
lemma MonthsDistinct(e: Escrow)
  requires alwaysMonthsWellFormed(e)
  ensures forall j, k :: 0 <= j < |e.vault.months| && 0 <= k < |e.vault.months| && e.vault.months[j].period == e.vault.months[k].period ==> j == k
{
  forall j, k | 0 <= j < |e.vault.months| && 0 <= k < |e.vault.months| && e.vault.months[j].period == e.vault.months[k].period
    ensures j == k
  {
    MonthPeriodUnique(e, j, k);
  }
}

// The only month of a period is that period's month.
lemma MonthForAt(ms: seq<Month>, i: int, period: int)
  requires 0 <= i < |ms| && ms[i].period == period
  requires forall j :: 0 <= j < |ms| && j != i ==> ms[j].period != period
  ensures hasMonth(ms, period) && monthFor(ms, period) == ms[i]
{
  assert ms[i] in ms;
  LastMatch((found: Month, m: Month) => (if (m.period == period) then m else found), (m: Month) => m.period == period, noMonth, ms, i);
}

// Replacing one period's month in months with distinct periods keeps each period that has a month, and each other period's month.
lemma MonthForWith(ms: seq<Month>, nm: Month, i: int, period: int)
  requires 0 <= i < |ms| && ms[i].period == nm.period
  requires forall j, k :: 0 <= j < |ms| && 0 <= k < |ms| && ms[j].period == ms[k].period ==> j == k
  requires hasMonth(ms, period)
  ensures hasMonth(withMonth(ms, nm), period)
  ensures monthFor(withMonth(ms, nm), period) == (if period == nm.period then nm else monthFor(ms, period))
{
  var ys := withMonth(ms, nm);
  var m :| m in ms && m.period == period;
  var k :| 0 <= k < |ms| && ms[k] == m;
  forall j | 0 <= j < |ms| && j != k
    ensures ms[j].period != period
  {
  }
  MonthForAt(ms, k, period);
  WithMonthAt(ms, nm, k);
  forall j | 0 <= j < |ys| && j != k
    ensures ys[j].period != period
  {
    WithMonthAt(ms, nm, j);
  }
  MonthForAt(ys, k, period);
}

// Appending a month for a new period keeps every other period's month.
lemma MonthForAppendOther(ms: seq<Month>, nm: Month, period: int)
  requires period != nm.period
  ensures monthFor(ms + [nm], period) == monthFor(ms, period)
{
  ProofLib.FoldLeftAppend((found: Month, m: Month) => (if (m.period == period) then m else found), noMonth, ms, nm);
}

lemma HasMonthAppend(ms: seq<Month>, nm: Month, period: int)
  requires hasMonth(ms, period)
  ensures hasMonth(ms + [nm], period)
{
  var m :| m in ms && m.period == period;
  assert m in ms + [nm];
}

// Replacing one period's month, adding to its committed gross, adds to that period's month alone.
lemma GrossWithMonth(ms: seq<Month>, nm: Month, i: int, os: seq<LeafOrigin>, added: int, k: int)
  requires 0 <= i < |ms| && ms[i].period == nm.period && nm.committedGross == ms[i].committedGross + added
  requires forall m :: m in ms ==> m.committedGross == originGross(os, m.period)
  requires 0 <= k < |ms|
  ensures withMonth(ms, nm)[k].committedGross == originGross(os, ms[k].period) + (if ms[k].period == nm.period then added else 0)
{
  assert ms[i] in ms;
  assert ms[k] in ms;
  WithMonthAt(ms, nm, k);
}

// A leaf proved by its period's month stays proved after a month with the same proof fields replaces that period's month.
lemma ProvedWithMonth(ms: seq<Month>, nm: Month, i: int, period: int, leaf: contracts__ledger_Leaf)
  requires 0 <= i < |ms| && ms[i].period == nm.period
  requires forall j, k :: 0 <= j < |ms| && 0 <= k < |ms| && ms[j].period == ms[k].period ==> j == k
  requires nm.version2 == ms[i].version2 && nm.leaves == ms[i].leaves && nm.count == ms[i].count && nm.total == ms[i].total
  requires hasMonth(ms, period) && leafProves(monthFor(ms, period), leaf)
  ensures hasMonth(withMonth(ms, nm), period) && leafProves(monthFor(withMonth(ms, nm), period), leaf)
{
  MonthForWith(ms, nm, i, period);
  if period == nm.period {
    forall j | 0 <= j < |ms| && j != i
      ensures ms[j].period != period
    {
    }
    MonthForAt(ms, i, period);
  }
}

// Logging a leaf whose source no logged leaf has keeps each logged source logged once.
lemma OriginCountAppend(os: seq<LeafOrigin>, lo: LeafOrigin, o: LeafOrigin)
  requires forall x :: x in os ==> x.leaf.source != lo.leaf.source
  requires o in os ==> |ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), os)| == 1
  requires o in os + [lo]
  ensures |ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), os + [lo])| == 1
{
  ProofLib.FilterAppend((x: LeafOrigin) => (x.leaf.source == o.leaf.source), os, lo);
  if o !in os {
    assert o == lo;
    forall j | 0 <= j < |os|
      ensures !(os[j].leaf.source == o.leaf.source)
    {
      assert os[j] in os;
    }
    ProofLib.FilterNone((x: LeafOrigin) => (x.leaf.source == o.leaf.source), os);
  }
}

// A transition that keeps the origins, gives each month its period's logged gross, keeps each logged leaf
// proved by its period's month, and keeps each award's actor and gross keeps the trace.
lemma TracedFrame(e: Escrow, after: Escrow)
  requires alwaysCommittedLeavesTraced(e)
  requires after.vault.origins == e.vault.origins
  requires forall m :: m in after.vault.months ==> m.committedGross == originGross(e.vault.origins, m.period)
  requires forall o :: o in e.vault.origins ==> (hasMonth(after.vault.months, o.period)
    && leafProves(monthFor(after.vault.months, o.period), o.leaf))
  requires forall s :: contracts__ledger_hasSource(e.vault.awards, s) ==> (contracts__ledger_hasSource(after.vault.awards, s)
    && contracts__ledger_awardFor(after.vault.awards, s).actor == contracts__ledger_awardFor(e.vault.awards, s).actor
    && contracts__ledger_awardFor(after.vault.awards, s).gross == contracts__ledger_awardFor(e.vault.awards, s).gross)
  ensures alwaysCommittedLeavesTraced(after)
  ensures stepOriginsRetained(e, after)
{
  TracedParts(e);
  TracedBuild(after);
}

// A transition that keeps the months and the origins, and each award's actor and gross, keeps the trace.
lemma TracedSameMonths(e: Escrow, after: Escrow)
  requires alwaysCommittedLeavesTraced(e)
  requires after.vault.months == e.vault.months && after.vault.origins == e.vault.origins
  requires forall s :: contracts__ledger_hasSource(e.vault.awards, s) ==> (contracts__ledger_hasSource(after.vault.awards, s)
    && contracts__ledger_awardFor(after.vault.awards, s).actor == contracts__ledger_awardFor(e.vault.awards, s).actor
    && contracts__ledger_awardFor(after.vault.awards, s).gross == contracts__ledger_awardFor(e.vault.awards, s).gross)
  ensures alwaysCommittedLeavesTraced(after)
  ensures stepOriginsRetained(e, after)
{
  TracedParts(e);
  TracedFrame(e, after);
}

// Appending a month for a period without one, with nothing committed, keeps the trace.
lemma TracedAppendMonth(e: Escrow, after: Escrow, nm: Month)
  requires alwaysCommittedLeavesTraced(e)
  requires !hasMonth(e.vault.months, nm.period) && nm.committedGross == 0
  requires after.vault.months == e.vault.months + [nm] && after.vault.origins == e.vault.origins
  requires forall s :: contracts__ledger_hasSource(e.vault.awards, s) ==> (contracts__ledger_hasSource(after.vault.awards, s)
    && contracts__ledger_awardFor(after.vault.awards, s).actor == contracts__ledger_awardFor(e.vault.awards, s).actor
    && contracts__ledger_awardFor(after.vault.awards, s).gross == contracts__ledger_awardFor(e.vault.awards, s).gross)
  ensures alwaysCommittedLeavesTraced(after)
  ensures stepOriginsRetained(e, after)
{
  TracedParts(e);
  var ms := e.vault.months;
  var os := e.vault.origins;
  forall o | o in os
    ensures o.period != nm.period
  {
  }
  OriginGrossNone(os, nm.period);
  forall o | o in os
    ensures hasMonth(ms + [nm], o.period) && leafProves(monthFor(ms + [nm], o.period), o.leaf)
  {
    HasMonthAppend(ms, nm, o.period);
    MonthForAppendOther(ms, nm, o.period);
  }
  forall m | m in ms + [nm]
    ensures m.committedGross == originGross(os, m.period)
  {
    if m != nm {
      assert m in ms;
    }
  }
  TracedFrame(e, after);
}

// Replacing one period's month, keeping its proof fields and committed gross, keeps the trace.
lemma TracedReplaceMonth(e: Escrow, after: Escrow, i: int, nm: Month)
  requires alwaysCommittedLeavesTraced(e)
  requires forall j, k :: 0 <= j < |e.vault.months| && 0 <= k < |e.vault.months| && e.vault.months[j].period == e.vault.months[k].period ==> j == k
  requires 0 <= i < |e.vault.months| && e.vault.months[i].period == nm.period
  requires after.vault.months == withMonth(e.vault.months, nm) && after.vault.origins == e.vault.origins
  requires nm.version2 == e.vault.months[i].version2 && nm.leaves == e.vault.months[i].leaves
    && nm.count == e.vault.months[i].count && nm.total == e.vault.months[i].total
    && nm.committedGross == e.vault.months[i].committedGross
  requires after.vault.awards == e.vault.awards
  ensures alwaysCommittedLeavesTraced(after)
  ensures stepOriginsRetained(e, after)
{
  TracedParts(e);
  var ms := e.vault.months;
  var ys := after.vault.months;
  var os := e.vault.origins;
  assert |ys| == |ms|;
  forall o | o in os
    ensures hasMonth(ys, o.period) && leafProves(monthFor(ys, o.period), o.leaf)
  {
    ProvedWithMonth(ms, nm, i, o.period, o.leaf);
  }
  forall m | m in ys
    ensures m.committedGross == originGross(os, m.period)
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    WithMonthAt(ms, nm, k);
    GrossWithMonth(ms, nm, i, os, 0, k);
  }
  TracedFrame(e, after);
}

// Committing a proved leaf adds its gross to its period's month alone.
lemma CommitLeafGross(ms: seq<Month>, nm: Month, i: int, os: seq<LeafOrigin>, lo: LeafOrigin, k: int)
  requires 0 <= i < |ms| && ms[i].period == lo.period && nm.period == lo.period
  requires nm.committedGross == ms[i].committedGross + lo.leaf.gross
  requires forall m :: m in ms ==> m.committedGross == originGross(os, m.period)
  requires 0 <= k < |ms|
  ensures withMonth(ms, nm)[k].committedGross == originGross(os + [lo], withMonth(ms, nm)[k].period)
{
  WithMonthAt(ms, nm, k);
  GrossWithMonth(ms, nm, i, os, lo.leaf.gross, k);
  OriginGrossAppend(os, lo, ms[k].period);
}

// Committing a proved leaf logs it with its period: the trace holds after it.
lemma CommitLeafTraced(e: Escrow, after: Escrow, i: int, nm: Month, lo: LeafOrigin, n: contracts__ledger_Award)
  requires alwaysCommittedLeavesTraced(e)
  requires forall j, k :: 0 <= j < |e.vault.months| && 0 <= k < |e.vault.months| && e.vault.months[j].period == e.vault.months[k].period ==> j == k
  requires contracts__ledger_uniqueSources(e.vault.awards) && contracts__ledger_uniqueSources(after.vault.awards)
  requires 0 <= i < |e.vault.months| && e.vault.months[i].period == lo.period && leafProves(e.vault.months[i], lo.leaf)
  requires nm.period == lo.period && nm.version2 == e.vault.months[i].version2 && nm.leaves == e.vault.months[i].leaves
    && nm.count == e.vault.months[i].count && nm.total == e.vault.months[i].total
    && nm.committedGross == e.vault.months[i].committedGross + lo.leaf.gross
  requires after.vault.months == withMonth(e.vault.months, nm)
  requires after.vault.origins == e.vault.origins + [lo]
  requires after.vault.awards == e.vault.awards + [n] && !contracts__ledger_hasSource(e.vault.awards, n.source)
  requires n.source == lo.leaf.source && n.actor == lo.leaf.actor && n.gross == lo.leaf.gross
  ensures alwaysCommittedLeavesTraced(after)
  ensures stepOriginsRetained(e, after)
{
  TracedParts(e);
  var ms := e.vault.months;
  var ys := after.vault.months;
  var os := e.vault.origins;
  assert |ys| == |ms|;
  forall m | m in ys
    ensures m.committedGross == originGross(os + [lo], m.period)
  {
    var k :| 0 <= k < |ys| && ys[k] == m;
    CommitLeafGross(ms, nm, i, os, lo, k);
  }
  assert ms[i] in ms;
  forall o | o in os + [lo]
    ensures hasMonth(ys, o.period) && leafProves(monthFor(ys, o.period), o.leaf)
  {
    if o in os {
      ProvedWithMonth(ms, nm, i, o.period, o.leaf);
    } else {
      assert o == lo;
      MonthForWith(ms, nm, i, lo.period);
    }
  }
  forall a | a in e.vault.awards
    ensures a in after.vault.awards
  {
  }
  AwardsSuperset(e.vault.awards, after.vault.awards);
  AwardForAppendSelf(e.vault.awards, n);
  assert n in after.vault.awards;
  forall o | o in os + [lo]
    ensures contracts__ledger_hasSource(after.vault.awards, o.leaf.source)
      && contracts__ledger_awardFor(after.vault.awards, o.leaf.source).actor == o.leaf.actor
      && contracts__ledger_awardFor(after.vault.awards, o.leaf.source).gross == o.leaf.gross
  {
  }
  forall x | x in os
    ensures x.leaf.source != lo.leaf.source
  {
  }
  forall o | o in os + [lo]
    ensures |ProofLib.Filter((x: LeafOrigin) => (x.leaf.source == o.leaf.source), os + [lo])| == 1
  {
    OriginCountAppend(os, lo, o);
  }
  TracedBuild(after);
}

lemma Initial_alwaysCommittedLeavesTraced()
  ensures alwaysCommittedLeavesTraced(initial)
{
  assert initial.vault.months == [] && initial.vault.origins == [];
  OriginsView(initial);
}

// In well-formed months, a period with committed gross keeps its remainder below its total.
lemma lawTouchedMonthNeverReleases_ensures(e: Escrow, period: int, expectedRemaining: int, releasedGross: int, signer: string, by_: string)
  ensures (lawTouchedMonthNeverReleases(e, period, expectedRemaining, releasedGross, signer, by_) == true)
{
  if alwaysMonthsWellFormed(e) && hasMonth(e.vault.months, period) {
    var i := MonthForIndex(e, period);
    assert e.vault.months[i] in e.vault.months;
  }
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
  var v := initial.vault;
  assert v.months == [] && v.pendingMonthly == 0;
  assert sumRemaining(v.months) == 0;
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
  ensures |Std.Collections.Seq.FoldLeft(f, v, xs).awards| == |v.awards| + |xs|
  ensures Std.Collections.Seq.FoldLeft(f, v, xs).sourceSequence == v.sourceSequence + |xs|
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    var w := f(v, first);
    var n := contracts__ledger_newAward(first.source, first.actor, first.gross, contracts__ledger_awardFee(v.key.purpose, first.gross), e.now);
    assert w == charged(v, first.source, first.actor, first.gross, e.now);
    assert w.awards == v.awards + [n];
    assert w.sourceSequence == v.sourceSequence + 1;
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

lemma CommitMonthlyFacts(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, signer: string)
  requires inv(e) && canCommitMonthly(e, period, entries, signer)
  ensures alwaysAwardsWellFormed(commitMonthly(e, period, entries, signer))
  ensures alwaysReservedMatchesAwards(commitMonthly(e, period, entries, signer))
  ensures alwaysPaidMatchesAwards(commitMonthly(e, period, entries, signer))
  ensures alwaysMonthsWellFormed(commitMonthly(e, period, entries, signer))
  ensures alwaysPendingMatchesMonths(commitMonthly(e, period, entries, signer))
  ensures alwaysNonnegative(commitMonthly(e, period, entries, signer))
  ensures alwaysConserved(commitMonthly(e, period, entries, signer))
  ensures alwaysBalanceCovers(commitMonthly(e, period, entries, signer))
  ensures alwaysFeesAccounted(commitMonthly(e, period, entries, signer))
  ensures alwaysCreatedVault(commitMonthly(e, period, entries, signer))
  ensures alwaysBountyHasNoMonthly(commitMonthly(e, period, entries, signer))
  ensures alwaysBindingsWellFormed(commitMonthly(e, period, entries, signer))
  ensures stepPaidToLiveBinding(e, commitMonthly(e, period, entries, signer))
  ensures stepAwardsRetained(e, commitMonthly(e, period, entries, signer))
  ensures stepMonthsRetained(e, commitMonthly(e, period, entries, signer))
  ensures stepNewBindingAttested(e, commitMonthly(e, period, entries, signer))
  ensures stepConfigurationFixed(e, commitMonthly(e, period, entries, signer))
  ensures stepAuthorityChanges(e, "commitMonthly", commitMonthly(e, period, entries, signer))
  ensures stepMonthlyPolicyByOwner(e, "commitMonthly", commitMonthly(e, period, entries, signer))
  ensures alwaysPledgesCovered(commitMonthly(e, period, entries, signer))
  ensures alwaysPledgedMonthUnadmitted(commitMonthly(e, period, entries, signer))
  ensures alwaysAdmittedInWindow(commitMonthly(e, period, entries, signer))
  ensures stepFreeRisesOnlyByDepositOrRelease(e, "commitMonthly", commitMonthly(e, period, entries, signer))
  ensures stepSourceSequenceCountsOrdinaryAwards(e, commitMonthly(e, period, entries, signer))
  ensures alwaysCommittedLeavesTraced(commitMonthly(e, period, entries, signer))
  ensures stepOriginsRetained(e, commitMonthly(e, period, entries, signer))
{
  var after := commitMonthly(e, period, entries, signer);
  var newEntries := freshEntries(e.vault, entries);
  FreshView(e.vault, entries);
  CommitMonthlyView(e, period, entries, signer);
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
  var cv := closePledge(e.vault, period);
  ClosePledgeFrame(e.vault, period);
  assert e.(vault := cv).vault.awards == e.vault.awards && cv.key == e.vault.key && cv.free == e.vault.free;
  ChargeFold(e, (v: Vault, l: contracts__ledger_Leaf) => charged(v, l.source, l.actor, l.gross, e.now), cv, newEntries);
  var r := Std.Collections.Seq.FoldLeft((v: Vault, l: contracts__ledger_Leaf) => charged(v, l.source, l.actor, l.gross, e.now), cv, newEntries);
  var nm := noMonth.(period := period, root := "legacy", wholeGross := contracts__ledger_leafTotal(entries), count := |entries|, admittedAt := e.now, cap := capFor(e.vault, period), leaves := entries);
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
  ClosePledgeCovers(e, period);
  PledgedMonthAfterClose(e, period, after);
  assert after.vault.months == e.vault.months + [nm];
  forall m | m in after.vault.months
    ensures contracts__ledger_inWindow(m.period, m.admittedAt)
  {
    if m != nm {
      assert m in e.vault.months;
    }
  }
  EntriesNonneg(e, newEntries);
  assert after.vault.free == e.vault.free - contracts__ledger_leafTotal(newEntries);
  assert after.vault.sourceSequence == e.vault.sourceSequence + |newEntries|;
  assert |after.vault.awards| == |e.vault.awards| + |newEntries|;
  AwardsSuperset(e.vault.awards, after.vault.awards);
  TracedAppendMonth(e, after, nm);
}

// ---- Month pledges -------------------------------------------------------------

// pledgeOf's fold returns its start or a pledge of that period, and a pledge of that period when one exists.
lemma PledgeOfPick(f: (Pledge, Pledge) -> Pledge, ps: seq<Pledge>, period: int, init: Pledge)
  requires forall a, x :: f(a, x) == (if (x.period == period) then x else a)
  ensures Std.Collections.Seq.FoldLeft(f, init, ps) == init
    || (Std.Collections.Seq.FoldLeft(f, init, ps) in ps && Std.Collections.Seq.FoldLeft(f, init, ps).period == period)
  ensures (exists i :: 0 <= i < |ps| && ps[i].period == period)
    ==> Std.Collections.Seq.FoldLeft(f, init, ps) in ps && Std.Collections.Seq.FoldLeft(f, init, ps).period == period
  decreases |ps|
{
  if |ps| > 0 {
    PledgeOfPick(f, ps[1..], period, f(init, ps[0]));
    if (exists i :: 0 <= i < |ps| && ps[i].period == period) && ps[0].period != period {
      var i :| 0 <= i < |ps| && ps[i].period == period;
      assert ps[1..][i - 1] == ps[i];
    }
  }
}

// With one pledge per period, pledgeOf finds the pledge itself.
lemma PledgeOfMember(v: Vault, p: Pledge)
  requires p in v.pledges
  requires forall x :: x in v.pledges ==> |ProofLib.Filter((o: Pledge) => (o.period == x.period), v.pledges)| == 1
  ensures pledgeOf(v, p.period) == p
{
  var ps := v.pledges;
  var i :| 0 <= i < |ps| && ps[i] == p;
  PledgeOfPick((found: Pledge, x: Pledge) => (if (x.period == p.period) then x else found), ps, p.period, noPledge);
  var q := pledgeOf(v, p.period);
  if q != p {
    var j :| 0 <= j < |ps| && ps[j] == q;
    ProofLib.FilterTwo((o: Pledge) => (o.period == p.period), ps, i, j);
  }
}

// A transition that keeps the pledges keeps every open pledge whole.
lemma PledgesKept(e: Escrow, via: string, after: Escrow)
  requires alwaysPledgesCovered(e)
  requires after.vault.pledges == e.vault.pledges
  ensures stepPledgeIrrevocable(e, via, after)
{
  forall p | p in e.vault.pledges
    ensures pledgeOf(after.vault, p.period) == p
  {
    PledgeOfMember(e.vault, p);
    assert pledgeOf(after.vault, p.period) == pledgeOf(e.vault, p.period);
  }
}

// Positive pledges never sum below zero.
lemma OpenPledgedNonneg(f: (int, Pledge) -> int, init: int, ps: seq<Pledge>)
  requires forall t, x :: f(t, x) == (if x.open then (t + x.amount) else t)
  requires init >= 0 && forall x :: x in ps ==> x.amount > 0
  ensures Std.Collections.Seq.FoldLeft(f, init, ps) >= 0
  decreases |ps|
{
  if |ps| > 0 {
    OpenPledgedNonneg(f, f(init, ps[0]), ps[1..]);
  }
}

lemma PledgedNonneg(e: Escrow)
  requires alwaysPledgesCovered(e)
  ensures e.vault.pledged >= 0
{
  OpenPledgedNonneg((t: int, x: Pledge) => (if x.open then (t + x.amount) else t), 0, e.vault.pledges);
}

// Closing a pledge keeps the open pledges summed and one per period, and leaves no open pledge of that period.
lemma ClosePledgeCovers(e: Escrow, period: int)
  requires alwaysPledgesCovered(e)
  ensures closePledge(e.vault, period).pledged == openPledged(closePledge(e.vault, period).pledges)
  ensures closePledge(e.vault, period).pledged <= e.vault.pledged
  ensures forall p :: p in closePledge(e.vault, period).pledges ==>
    (p.amount > 0 && |ProofLib.Filter((o: Pledge) => (o.period == p.period), closePledge(e.vault, period).pledges)| == 1)
  ensures forall p :: p in closePledge(e.vault, period).pledges && p.open ==> p in e.vault.pledges && p.period != period
{
  var v := e.vault;
  var ps := v.pledges;
  var q := pledgeOf(v, period);
  if !q.open {
    forall p | p in ps && p.open
      ensures p.period != period
    {
      if p.period == period {
        PledgeOfMember(v, p);
      }
    }
  } else {
    var ys := closePledge(v, period).pledges;
    PledgeOfPick((found: Pledge, x: Pledge) => (if (x.period == period) then x else found), ps, period, noPledge);
    assert q != noPledge;
    var i :| 0 <= i < |ps| && ps[i] == q;
    assert q in ps;
    forall j | 0 <= j < |ps| && j != i
      ensures ys[j] == ps[j]
    {
      if ps[j].period == period {
        ProofLib.FilterTwo((o: Pledge) => (o.period == q.period), ps, i, j);
      }
    }
    assert ys[i] == q.(open := false);
    SumFoldChangeOne((t: int, p: Pledge) => (if p.open then (t + p.amount) else t), (p: Pledge) => (if p.open then p.amount else 0), 0, ps, ys, i);
    forall p | p in ys
      ensures p.amount > 0 && |ProofLib.Filter((o: Pledge) => (o.period == p.period), ys)| == 1
      ensures p.open ==> p in ps && p.period != period
    {
      var k :| 0 <= k < |ys| && ys[k] == p;
      assert ps[k] in ps;
      ProofLib.FilterLengthPointwise((o: Pledge) => (o.period == ps[k].period), (o: Pledge) => (o.period == p.period), ps, ys);
    }
  }
}

// Adding a month for one period leaves every open pledge of another period unadmitted.
lemma PledgedMonthAfterClose(e: Escrow, period: int, after: Escrow)
  requires alwaysPledgesCovered(e) && alwaysPledgedMonthUnadmitted(e)
  requires after.vault.pledges == closePledge(e.vault, period).pledges
  requires forall m :: m in after.vault.months ==> m in e.vault.months || m.period == period
  ensures alwaysPledgedMonthUnadmitted(after)
{
  ClosePledgeCovers(e, period);
  forall p | p in after.vault.pledges && p.open
    ensures !hasMonth(after.vault.months, p.period)
  {
    assert p in e.vault.pledges;
  }
}

// Appending one open pledge per period keeps the base and adds exactly those pledges.
lemma AppendPledges(f: (seq<Pledge>, int) -> seq<Pledge>, base: seq<Pledge>, periods: seq<int>, amount: int)
  requires forall a, period :: f(a, period) == a + [Pledge(period, amount, true)]
  ensures forall x :: x in Std.Collections.Seq.FoldLeft(f, base, periods) ==>
    (x in base || (x == Pledge(x.period, amount, true) && x.period in periods))
  ensures forall period :: period in periods ==> Pledge(period, amount, true) in Std.Collections.Seq.FoldLeft(f, base, periods)
  ensures forall x :: x in base ==> x in Std.Collections.Seq.FoldLeft(f, base, periods)
  decreases |periods|
{
  if |periods| > 0 {
    var next := f(base, periods[0]);
    assert next == base + [Pledge(periods[0], amount, true)];
    assert Std.Collections.Seq.FoldLeft(f, base, periods) == Std.Collections.Seq.FoldLeft(f, next, periods[1..]);
    AppendPledges(f, next, periods[1..], amount);
    assert periods[0] in periods;
    forall x | x in next
      ensures x in base || x == Pledge(periods[0], amount, true)
    {
    }
    forall x | x in base
      ensures x in next
    {
    }
    forall period | period in periods[1..]
      ensures period in periods
    {
    }
    forall period | period in periods
      ensures period == periods[0] || period in periods[1..]
    {
      var i :| 0 <= i < |periods| && periods[i] == period;
      if i > 0 {
        assert periods[1..][i - 1] == period;
      }
    }
  }
}

// pledgeMonths keeps the pledges of other periods and appends one open pledge per period.
lemma PledgeMonthsView(e: Escrow, fromPeriod: int, count: int, amount: int, by_: string)
  ensures pledgeMonths(e, fromPeriod, count, amount, by_).vault.pledges == Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), ProofLib.Filter((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), e.vault.pledges), pledgePeriods(fromPeriod, count))
  ensures pledgeMonths(e, fromPeriod, count, amount, by_).vault.months == e.vault.months
{
}

// Pledging months leaves every open pledge at least as large and pledges only unadmitted months.
lemma PledgeMonthsKeeps(e: Escrow, fromPeriod: int, count: int, amount: int, by_: string)
  requires inv(e) && canPledgeMonths(e, fromPeriod, count, amount, by_)
  ensures alwaysPledgedMonthUnadmitted(pledgeMonths(e, fromPeriod, count, amount, by_))
  ensures stepPledgeIrrevocable(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_))
{
  var after := pledgeMonths(e, fromPeriod, count, amount, by_);
  var ps := e.vault.pledges;
  PledgeMonthsView(e, fromPeriod, count, amount, by_);
  AppendPledges((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), ProofLib.Filter((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), ps), pledgePeriods(fromPeriod, count), amount);
  forall p | p in after.vault.pledges && p.open
    ensures !hasMonth(after.vault.months, p.period)
  {
    ProofLib.FilterMember((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), ps, p);
  }
  forall p | p in ps && p.open
    ensures pledgeOf(after.vault, p.period).open && pledgeOf(after.vault, p.period).amount >= p.amount
  {
    PledgeOfMember(e.vault, p);
    ProofLib.FilterMember((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), ps, p);
    var held := if p.period in pledgePeriods(fromPeriod, count) then Pledge(p.period, amount, true) else p;
    assert held in after.vault.pledges;
    var w :| 0 <= w < |after.vault.pledges| && after.vault.pledges[w] == held;
    PledgeOfPick((found: Pledge, x: Pledge) => (if (x.period == p.period) then x else found), after.vault.pledges, p.period, noPledge);
    var q := pledgeOf(after.vault, p.period);
    assert q in after.vault.pledges && q.period == p.period;
    ProofLib.FilterMember((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), ps, q);
    if q != held {
      var a :| 0 <= a < |ps| && ps[a] == p;
      var b :| 0 <= b < |ps| && ps[b] == q;
      ProofLib.FilterTwo((o: Pledge) => (o.period == p.period), ps, a, b);
    }
  }
}

// The month after a period is a later period.
lemma NextAfter(p: int)
  ensures contracts__ledger_nextPeriod(p) > p
{
  var q := contracts__ledger_quotient_contracts__ledger(p, 100);
  assert contracts__ledger_remainder_contracts__ledger(p, 100) == p - 100 * q;
}

lemma PeriodsIncrease(g: (seq<int>, int) -> seq<int>, from: int, ps: seq<int>, xs: seq<int>)
  requires forall a, i :: g(a, i) == a + [(if |a| == 0 then from else contracts__ledger_nextPeriod(a[|a| - 1]))]
  requires forall i, j :: 0 <= i < j < |ps| ==> ps[i] < ps[j]
  ensures forall i, j :: 0 <= i < j < |Std.Collections.Seq.FoldLeft(g, ps, xs)| ==>
    Std.Collections.Seq.FoldLeft(g, ps, xs)[i] < Std.Collections.Seq.FoldLeft(g, ps, xs)[j]
  decreases |xs|
{
  if |xs| > 0 {
    var next := g(ps, xs[0]);
    if |ps| > 0 {
      NextAfter(ps[|ps| - 1]);
    }
    forall i, j | 0 <= i < j < |next|
      ensures next[i] < next[j]
    {
      if j == |ps| && i < |ps| - 1 {
        assert ps[i] < ps[|ps| - 1];
      }
    }
    PeriodsIncrease(g, from, next, xs[1..]);
  }
}

// The pledged periods strictly increase, so none repeats.
lemma PledgePeriodsIncrease(fromPeriod: int, count: int)
  ensures forall i, j :: 0 <= i < j < |pledgePeriods(fromPeriod, count)| ==> pledgePeriods(fromPeriod, count)[i] < pledgePeriods(fromPeriod, count)[j]
{
  PeriodsIncrease((ps: seq<int>, i: int) => (ps + [(if (|ps| == 0) then fromPeriod else contracts__ledger_nextPeriod((if ((0 <= (|ps| - 1)) && ((|ps| - 1) < |ps|)) then ps[(|ps| - 1)] else fromPeriod)))]), fromPeriod, [], ProofLib.Filter((i: int) => (i <= count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  assert pledgePeriods(fromPeriod, count) == Std.Collections.Seq.FoldLeft((ps: seq<int>, i: int) => (ps + [(if (|ps| == 0) then fromPeriod else contracts__ledger_nextPeriod((if ((0 <= (|ps| - 1)) && ((|ps| - 1) < |ps|)) then ps[(|ps| - 1)] else fromPeriod)))]), [], ProofLib.Filter((i: int) => (i <= count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
}

lemma OpenCons(x: Pledge, rest: seq<Pledge>)
  ensures openPledged([x] + rest) == (if x.open then x.amount else 0) + openPledged(rest)
{
  assert ([x] + rest)[0] == x && ([x] + rest)[1..] == rest;
  SumFoldShift((t: int, p: Pledge) => (if p.open then (t + p.amount) else t), (p: Pledge) => (if p.open then p.amount else 0), (if x.open then x.amount else 0), rest);
}

// Open pledges sum over two disjoint filters as over their union.
lemma OpenUnion(a: Pledge -> bool, b: Pledge -> bool, c: Pledge -> bool, xs: seq<Pledge>)
  requires forall x :: c(x) == (a(x) || b(x)) && !(a(x) && b(x))
  ensures openPledged(ProofLib.Filter(c, xs)) == openPledged(ProofLib.Filter(a, xs)) + openPledged(ProofLib.Filter(b, xs))
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(a, xs);
    ProofLib.FilterNil(b, xs);
    ProofLib.FilterNil(c, xs);
  } else {
    ProofLib.FilterCons(a, xs);
    ProofLib.FilterCons(b, xs);
    ProofLib.FilterCons(c, xs);
    OpenUnion(a, b, c, xs[1..]);
    OpenCons(xs[0], ProofLib.Filter(a, xs[1..]));
    OpenCons(xs[0], ProofLib.Filter(b, xs[1..]));
    OpenCons(xs[0], ProofLib.Filter(c, xs[1..]));
    assert [] + ProofLib.Filter(a, xs[1..]) == ProofLib.Filter(a, xs[1..]);
    assert [] + ProofLib.Filter(b, xs[1..]) == ProofLib.Filter(b, xs[1..]);
    assert [] + ProofLib.Filter(c, xs[1..]) == ProofLib.Filter(c, xs[1..]);
  }
}

lemma OpenAll(xs: seq<Pledge>)
  ensures openPledged(ProofLib.Filter((o: Pledge) => true, xs)) == openPledged(xs)
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil((o: Pledge) => true, xs);
  } else {
    ProofLib.FilterCons((o: Pledge) => true, xs);
    OpenAll(xs[1..]);
    OpenCons(xs[0], ProofLib.Filter((o: Pledge) => true, xs[1..]));
    OpenCons(xs[0], xs[1..]);
    assert xs == [xs[0]] + xs[1..];
  }
}

// With one pledge per period, the open pledges of a period sum to pledgeOf's open amount.
lemma OpenOne(v: Vault, z: int)
  requires forall p :: p in v.pledges ==> |ProofLib.Filter((o: Pledge) => (o.period == p.period), v.pledges)| == 1
  ensures openPledged(ProofLib.Filter((o: Pledge) => (o.period == z), v.pledges)) == (if pledgeOf(v, z).open then pledgeOf(v, z).amount else 0)
{
  var ps := v.pledges;
  var f := ProofLib.Filter((o: Pledge) => (o.period == z), ps);
  if exists y :: y in ps && y.period == z {
    var y :| y in ps && y.period == z;
    PledgeOfMember(v, y);
    ProofLib.FilterLengthPointwise((o: Pledge) => (o.period == y.period), (o: Pledge) => (o.period == z), ps, ps);
    ProofLib.FilterMember((o: Pledge) => (o.period == z), ps, y);
    assert f[0] in f;
    assert f == [y];
    OpenCons(y, []);
    assert [y] + [] == [y];
    assert openPledged([]) == 0;
  } else {
    forall i | 0 <= i < |ps|
      ensures ps[i].period != z
    {
      assert ps[i] in ps;
    }
    ProofLib.FilterNone((o: Pledge) => (o.period == z), ps);
    assert f == [];
    LastMatchNone((found: Pledge, p: Pledge) => (if (p.period == z) then p else found), (p: Pledge) => p.period == z, noPledge, ps);
    assert pledgeOf(v, z) == noPledge;
  }
}

// The open pledges of distinct periods sum to their pledgeOf amounts.
lemma RemovedSum(v: Vault, periods: seq<int>)
  requires forall p :: p in v.pledges ==> |ProofLib.Filter((o: Pledge) => (o.period == p.period), v.pledges)| == 1
  requires forall i, j :: 0 <= i < j < |periods| ==> periods[i] < periods[j]
  ensures openPledged(ProofLib.Filter((o: Pledge) => (o.period in periods), v.pledges))
    == Std.Collections.Seq.FoldLeft((t: int, period: int) => (t + (if pledgeOf(v, period).open then pledgeOf(v, period).amount else 0)), 0, periods)
  decreases |periods|
{
  if |periods| == 0 {
    ProofLib.FilterNone((o: Pledge) => (o.period in periods), v.pledges);
  } else {
    var first := periods[..|periods| - 1];
    var z := periods[|periods| - 1];
    assert periods == first + [z];
    forall i | 0 <= i < |first|
      ensures first[i] != z
    {
      assert first[i] == periods[i];
    }
    RemovedSum(v, first);
    OpenUnion((o: Pledge) => (o.period in first), (o: Pledge) => (o.period == z), (o: Pledge) => (o.period in periods), v.pledges);
    OpenOne(v, z);
    ProofLib.FoldLeftAppend((t: int, period: int) => (t + (if pledgeOf(v, period).open then pledgeOf(v, period).amount else 0)), 0, first, z);
  }
}

lemma AddedBySum(v: Vault, periods: seq<int>, amount: int)
  ensures addedBy(v, periods, amount) == |periods| * amount
    - Std.Collections.Seq.FoldLeft((t: int, period: int) => (t + (if pledgeOf(v, period).open then pledgeOf(v, period).amount else 0)), 0, periods)
  decreases |periods|
{
  if |periods| > 0 {
    var first := periods[..|periods| - 1];
    var z := periods[|periods| - 1];
    assert periods == first + [z];
    AddedBySum(v, first, amount);
    ProofLib.FoldLeftAppend((t: int, period: int) => (t + (if pledgeOf(v, period).open then pledgeOf(v, period).amount else 0)), 0, first, z);
    ProofLib.FoldLeftAppend((t: int, period: int) => (t + raisedBy(v, period, amount)), 0, first, z);
  }
}

lemma AppendedSum(f: (seq<Pledge>, int) -> seq<Pledge>, base: seq<Pledge>, periods: seq<int>, amount: int)
  requires forall a, period :: f(a, period) == a + [Pledge(period, amount, true)]
  ensures openPledged(Std.Collections.Seq.FoldLeft(f, base, periods)) == openPledged(base) + |periods| * amount
  decreases |periods|
{
  if |periods| > 0 {
    AppendedSum(f, f(base, periods[0]), periods[1..], amount);
    ProofLib.FoldLeftAppend((t: int, p: Pledge) => (if p.open then (t + p.amount) else t), 0, base, Pledge(periods[0], amount, true));
  }
}

lemma DistinctFromCount(xs: seq<Pledge>)
  requires forall p :: p in xs ==> |ProofLib.Filter((o: Pledge) => (o.period == p.period), xs)| == 1
  ensures forall i, j :: 0 <= i < j < |xs| ==> xs[i].period != xs[j].period
{
  forall i, j | 0 <= i < j < |xs|
    ensures xs[i].period != xs[j].period
  {
    if xs[i].period == xs[j].period {
      var p := xs[i];
      assert p in xs;
      ProofLib.FilterTwo((o: Pledge) => (o.period == p.period), xs, i, j);
    }
  }
}

lemma CountFromDistinct(xs: seq<Pledge>, x: Pledge)
  requires forall i, j :: 0 <= i < j < |xs| ==> xs[i].period != xs[j].period
  requires x in xs
  ensures |ProofLib.Filter((o: Pledge) => (o.period == x.period), xs)| == 1
  decreases |xs|
{
  ProofLib.FilterCons((o: Pledge) => (o.period == x.period), xs);
  assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
  if xs[0] == x {
    ProofLib.FilterNone((o: Pledge) => (o.period == x.period), xs[1..]);
  } else {
    var k :| 0 <= k < |xs| && xs[k] == x;
    assert xs[1..][k - 1] == x;
    CountFromDistinct(xs[1..], x);
  }
}

lemma FilterDistinct(k: Pledge -> bool, xs: seq<Pledge>)
  requires forall i, j :: 0 <= i < j < |xs| ==> xs[i].period != xs[j].period
  ensures forall i, j :: 0 <= i < j < |ProofLib.Filter(k, xs)| ==> ProofLib.Filter(k, xs)[i].period != ProofLib.Filter(k, xs)[j].period
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(k, xs);
  } else {
    ProofLib.FilterCons(k, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    FilterDistinct(k, xs[1..]);
    var r := ProofLib.Filter(k, xs[1..]);
    forall y | y in r
      ensures y.period != xs[0].period
    {
      ProofLib.FilterMember(k, xs[1..], y);
      var i :| 0 <= i < |xs[1..]| && xs[1..][i] == y;
    }
    if k(xs[0]) {
      var f := [xs[0]] + r;
      forall i, j | 0 <= i < j < |f|
        ensures f[i].period != f[j].period
      {
        assert f[j] == r[j - 1];
        if i == 0 {
          assert r[j - 1] in r;
        } else {
          assert f[i] == r[i - 1];
        }
      }
    } else {
      assert [] + r == r;
    }
  }
}

lemma AppendDistinct(f: (seq<Pledge>, int) -> seq<Pledge>, base: seq<Pledge>, periods: seq<int>, amount: int)
  requires forall a, period :: f(a, period) == a + [Pledge(period, amount, true)]
  requires forall i, j :: 0 <= i < j < |base| ==> base[i].period != base[j].period
  requires forall x :: x in base ==> x.period !in periods
  requires forall i, j :: 0 <= i < j < |periods| ==> periods[i] < periods[j]
  ensures forall i, j :: 0 <= i < j < |Std.Collections.Seq.FoldLeft(f, base, periods)| ==>
    Std.Collections.Seq.FoldLeft(f, base, periods)[i].period != Std.Collections.Seq.FoldLeft(f, base, periods)[j].period
  decreases |periods|
{
  if |periods| > 0 {
    var next := f(base, periods[0]);
    assert next == base + [Pledge(periods[0], amount, true)];
    assert periods[0] in periods;
    forall x | x in next
      ensures x.period !in periods[1..]
    {
      if x.period in periods[1..] {
        var i :| 0 <= i < |periods[1..]| && periods[1..][i] == x.period;
        assert periods[i + 1] == x.period;
      }
    }
    forall i, j | 0 <= i < j < |next|
      ensures next[i].period != next[j].period
    {
      if j == |base| {
        assert base[i] in base;
      }
    }
    forall i, j | 0 <= i < j < |periods[1..]|
      ensures periods[1..][i] < periods[1..][j]
    {
      assert periods[1..][i] == periods[i + 1] && periods[1..][j] == periods[j + 1];
    }
    AppendDistinct(f, next, periods[1..], amount);
  }
}

// Pledging months keeps the open pledges summed in pledged and one pledge per period.
lemma PledgeMonthsCovers(e: Escrow, fromPeriod: int, count: int, amount: int, by_: string)
  requires inv(e) && canPledgeMonths(e, fromPeriod, count, amount, by_)
  ensures alwaysPledgesCovered(pledgeMonths(e, fromPeriod, count, amount, by_))
{
  var after := pledgeMonths(e, fromPeriod, count, amount, by_);
  var periods := pledgePeriods(fromPeriod, count);
  var olds := e.vault.pledges;
  var kept := ProofLib.Filter((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), olds);
  PledgeMonthsView(e, fromPeriod, count, amount, by_);
  PledgePeriodsIncrease(fromPeriod, count);
  DistinctFromCount(olds);
  FilterDistinct((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), olds);
  forall x | x in kept
    ensures x.period !in periods && x in olds
  {
    ProofLib.FilterMember((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), olds, x);
  }
  AppendPledges((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, periods, amount);
  AppendDistinct((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, periods, amount);
  forall x | x in after.vault.pledges
    ensures x.amount > 0 && |ProofLib.Filter((o: Pledge) => (o.period == x.period), after.vault.pledges)| == 1
  {
    CountFromDistinct(after.vault.pledges, x);
  }
  OpenAll(olds);
  OpenUnion((p: Pledge) => !((p.period in pledgePeriods(fromPeriod, count))), (o: Pledge) => (o.period in periods), (o: Pledge) => true, olds);
  RemovedSum(e.vault, periods);
  AddedBySum(e.vault, periods, amount);
  AppendedSum((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, periods, amount);
}

lemma Initial_alwaysPledgesCovered()
  ensures alwaysPledgesCovered(initial)
{
  var v := initial.vault;
  assert v.pledges == [] && v.pledged == 0 && v.free == 0;
}

lemma Initial_alwaysPledgedMonthUnadmitted()
  ensures alwaysPledgedMonthUnadmitted(initial)
{
  assert initial.vault.pledges == [];
}

lemma Initial_alwaysAdmittedInWindow()
  ensures alwaysAdmittedInWindow(initial)
{
  assert initial.vault.months == [];
}

lemma pledgeMonths_ensures(e: Escrow, fromPeriod: int, count: int, amount: int, by_: string)
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysClockStarted(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysFactoryRolesSeparate(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysUninitializedEmpty(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysRotationEffective(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysOneVaultPerKey(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysCreatedVault(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysConserved(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysBalanceCovers(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysFeesAccounted(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysNonnegative(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysReservedMatchesAwards(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysPaidMatchesAwards(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysAwardsWellFormed(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysMonthsWellFormed(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysPendingMatchesMonths(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysBountyHasNoMonthly(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysAdmittedInWindow(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysCommittedLeavesTraced(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysPledgesCovered(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysPledgedMonthUnadmitted(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> alwaysBindingsWellFormed(pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepAuthorityChanges(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepConfigurationFixed(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepAwardsRetained(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepMonthlyPolicyByOwner(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepMonthsRetained(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepOriginsRetained(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepPledgeIrrevocable(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepNewBindingAttested(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepPaidToLiveBinding(e, pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, by_)))
{
  if inv(e) && canPledgeMonths(e, fromPeriod, count, amount, by_) {
    SameAwards(e, pledgeMonths(e, fromPeriod, count, amount, by_));
    AwardsFrame(e, pledgeMonths(e, fromPeriod, count, amount, by_));    PledgeMonthsKeeps(e, fromPeriod, count, amount, by_);
    PledgeMonthsCovers(e, fromPeriod, count, amount, by_);
  }
}

lemma expirePledge_ensures(e: Escrow, period: int)
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysClockStarted(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysFactoryRolesSeparate(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysUninitializedEmpty(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysRotationEffective(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysOneVaultPerKey(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysCreatedVault(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysConserved(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysBalanceCovers(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysFeesAccounted(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysNonnegative(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysReservedMatchesAwards(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysPaidMatchesAwards(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysAwardsWellFormed(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysMonthsWellFormed(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysPendingMatchesMonths(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysBountyHasNoMonthly(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysAdmittedInWindow(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysCommittedLeavesTraced(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysPledgesCovered(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysPledgedMonthUnadmitted(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> alwaysBindingsWellFormed(expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepAuthorityChanges(e, "expirePledge", expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepConfigurationFixed(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepSourceSequenceCountsOrdinaryAwards(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepAwardsRetained(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepMonthlyPolicyByOwner(e, "expirePledge", expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepMonthsRetained(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepOriginsRetained(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepPledgeIrrevocable(e, "expirePledge", expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepNewBindingAttested(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepPaidToLiveBinding(e, expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepFreeSpentByOwnerOrAttestation(e, "expirePledge", expirePledge(e, period)))
  ensures (inv(e) ==> canExpirePledge(e, period) ==> stepFreeRisesOnlyByDepositOrRelease(e, "expirePledge", expirePledge(e, period)))
{
  if inv(e) && canExpirePledge(e, period) {
    SameAwards(e, expirePledge(e, period));
    AwardsFrame(e, expirePledge(e, period));
    ClosePledgeCovers(e, period);
    PledgedMonthAfterClose(e, period, expirePledge(e, period));
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
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysAdmittedInWindow(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysCommittedLeavesTraced(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysPledgesCovered(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysPledgedMonthUnadmitted(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> alwaysBindingsWellFormed(tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepAuthorityChanges(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepConfigurationFixed(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepSourceSequenceCountsOrdinaryAwards(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepAwardsRetained(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepMonthlyPolicyByOwner(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepMonthsRetained(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepOriginsRetained(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepPledgeIrrevocable(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepNewBindingAttested(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepPaidToLiveBinding(e, tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepFreeSpentByOwnerOrAttestation(e, "tick", tick(e, timestamp)))
  ensures (inv(e) ==> canTick(e, timestamp) ==> stepFreeRisesOnlyByDepositOrRelease(e, "tick", tick(e, timestamp)))
{
  if inv(e) && canTick(e, timestamp) {
    PledgesKept(e, "tick", tick(e, timestamp));
  }

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
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysAdmittedInWindow(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysCommittedLeavesTraced(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysPledgesCovered(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysPledgedMonthUnadmitted(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> alwaysBindingsWellFormed(proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepAuthorityChanges(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepConfigurationFixed(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepAwardsRetained(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepMonthlyPolicyByOwner(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepMonthsRetained(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepOriginsRetained(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepPledgeIrrevocable(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepNewBindingAttested(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepPaidToLiveBinding(e, proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeUpgradeAuthority(e, successor, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_)))
{
  if inv(e) && canProposeUpgradeAuthority(e, successor, by_) {
    PledgesKept(e, "proposeUpgradeAuthority", proposeUpgradeAuthority(e, successor, by_));
  }

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
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysAdmittedInWindow(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysCommittedLeavesTraced(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysPledgesCovered(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysPledgedMonthUnadmitted(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> alwaysBindingsWellFormed(acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepAuthorityChanges(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepConfigurationFixed(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepAwardsRetained(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepMonthlyPolicyByOwner(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepMonthsRetained(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepOriginsRetained(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepPledgeIrrevocable(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepNewBindingAttested(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepPaidToLiveBinding(e, acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
  ensures (inv(e) ==> canAcceptUpgradeAuthority(e, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_)))
{
  if inv(e) && canAcceptUpgradeAuthority(e, by_) {
    PledgesKept(e, "acceptUpgradeAuthority", acceptUpgradeAuthority(e, by_));
  }

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
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysAdmittedInWindow(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysCommittedLeavesTraced(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysPledgesCovered(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysPledgedMonthUnadmitted(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> alwaysBindingsWellFormed(setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepAuthorityChanges(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepConfigurationFixed(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepAwardsRetained(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepMonthsRetained(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepOriginsRetained(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepPledgeIrrevocable(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepNewBindingAttested(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
  ensures (inv(e) ==> canSetVaultImplementation(e, logic, uups, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_)))
{
  if inv(e) && canSetVaultImplementation(e, logic, uups, by_) {
    PledgesKept(e, "setVaultImplementation", setVaultImplementation(e, logic, uups, by_));
  }

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
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysAdmittedInWindow(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysCommittedLeavesTraced(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysPledgesCovered(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysPledgedMonthUnadmitted(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> alwaysBindingsWellFormed(upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepAuthorityChanges(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepConfigurationFixed(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepAwardsRetained(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepMonthsRetained(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepOriginsRetained(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepPledgeIrrevocable(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepNewBindingAttested(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeFactory(e, logic, uups, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_)))
{
  if inv(e) && canUpgradeFactory(e, logic, uups, by_) {
    PledgesKept(e, "upgradeFactory", upgradeFactory(e, logic, uups, by_));
  }

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
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysAdmittedInWindow(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysCommittedLeavesTraced(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysPledgesCovered(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysPledgedMonthUnadmitted(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> alwaysBindingsWellFormed(upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepAuthorityChanges(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepConfigurationFixed(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepAwardsRetained(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepMonthlyPolicyByOwner(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepMonthsRetained(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepOriginsRetained(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepPledgeIrrevocable(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepNewBindingAttested(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepPaidToLiveBinding(e, upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
  ensures (inv(e) ==> canUpgradeVault(e, logic, uups, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "upgradeVault", upgradeVault(e, logic, uups, by_)))
{
  if inv(e) && canUpgradeVault(e, logic, uups, by_) {
    PledgesKept(e, "upgradeVault", upgradeVault(e, logic, uups, by_));
  }

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
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysAdmittedInWindow(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysCommittedLeavesTraced(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysPledgesCovered(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysPledgedMonthUnadmitted(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> alwaysBindingsWellFormed(proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepAuthorityChanges(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepConfigurationFixed(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepAwardsRetained(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepMonthlyPolicyByOwner(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepMonthsRetained(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepOriginsRetained(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepPledgeIrrevocable(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepNewBindingAttested(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepPaidToLiveBinding(e, proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
  ensures (inv(e) ==> canProposeIdentityAuthority(e, successor, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_)))
{
  if inv(e) && canProposeIdentityAuthority(e, successor, by_) {
    PledgesKept(e, "proposeIdentityAuthority", proposeIdentityAuthority(e, successor, by_));
  }

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
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysAdmittedInWindow(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysCommittedLeavesTraced(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysPledgesCovered(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysPledgedMonthUnadmitted(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> alwaysBindingsWellFormed(cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepAuthorityChanges(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepConfigurationFixed(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepAwardsRetained(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepMonthlyPolicyByOwner(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepMonthsRetained(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepOriginsRetained(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepPledgeIrrevocable(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepNewBindingAttested(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepPaidToLiveBinding(e, cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
  ensures (inv(e) ==> canCancelIdentityAuthorityRotation(e, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_)))
{
  if inv(e) && canCancelIdentityAuthorityRotation(e, by_) {
    PledgesKept(e, "cancelIdentityAuthorityRotation", cancelIdentityAuthorityRotation(e, by_));
  }

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
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysAdmittedInWindow(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysCommittedLeavesTraced(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysPledgesCovered(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysPledgedMonthUnadmitted(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> alwaysBindingsWellFormed(executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepAuthorityChanges(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepConfigurationFixed(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepSourceSequenceCountsOrdinaryAwards(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepAwardsRetained(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepMonthlyPolicyByOwner(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepMonthsRetained(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepOriginsRetained(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepPledgeIrrevocable(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepNewBindingAttested(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepPaidToLiveBinding(e, executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepFreeSpentByOwnerOrAttestation(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
  ensures (inv(e) ==> canExecuteIdentityAuthorityRotation(e) ==> stepFreeRisesOnlyByDepositOrRelease(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e)))
{
  if inv(e) && canExecuteIdentityAuthorityRotation(e) {
    PledgesKept(e, "executeIdentityAuthorityRotation", executeIdentityAuthorityRotation(e));
  }

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
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysAdmittedInWindow(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysCommittedLeavesTraced(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysPledgesCovered(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysPledgedMonthUnadmitted(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> alwaysBindingsWellFormed(deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepAuthorityChanges(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepConfigurationFixed(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepSourceSequenceCountsOrdinaryAwards(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepAwardsRetained(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepMonthlyPolicyByOwner(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepMonthsRetained(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepOriginsRetained(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepPledgeIrrevocable(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepNewBindingAttested(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepPaidToLiveBinding(e, deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepFreeSpentByOwnerOrAttestation(e, "deposit", deposit(e, amount, sent, transferExact)))
  ensures (inv(e) ==> canDeposit(e, amount, sent, transferExact) ==> stepFreeRisesOnlyByDepositOrRelease(e, "deposit", deposit(e, amount, sent, transferExact)))
{
  if inv(e) && canDeposit(e, amount, sent, transferExact) {
    PledgesKept(e, "deposit", deposit(e, amount, sent, transferExact));
  }

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
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysAdmittedInWindow(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysCommittedLeavesTraced(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysPledgesCovered(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysPledgedMonthUnadmitted(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> alwaysBindingsWellFormed(transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepAuthorityChanges(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepConfigurationFixed(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepSourceSequenceCountsOrdinaryAwards(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepAwardsRetained(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepMonthlyPolicyByOwner(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepMonthsRetained(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepOriginsRetained(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepPledgeIrrevocable(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepNewBindingAttested(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepPaidToLiveBinding(e, transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepFreeSpentByOwnerOrAttestation(e, "transferIn", transferIn(e, amount)))
  ensures (inv(e) ==> canTransferIn(e, amount) ==> stepFreeRisesOnlyByDepositOrRelease(e, "transferIn", transferIn(e, amount)))
{
  if inv(e) && canTransferIn(e, amount) {
    PledgesKept(e, "transferIn", transferIn(e, amount));
  }

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
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysAdmittedInWindow(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysCommittedLeavesTraced(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysPledgesCovered(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysPledgedMonthUnadmitted(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> alwaysBindingsWellFormed(setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepAuthorityChanges(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepConfigurationFixed(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepAwardsRetained(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepMonthlyPolicyByOwner(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepMonthsRetained(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepOriginsRetained(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepPledgeIrrevocable(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepNewBindingAttested(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepPaidToLiveBinding(e, setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
  ensures (inv(e) ==> canSetMonthlyCommitment(e, cap, on, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_)))
{
  if inv(e) && canSetMonthlyCommitment(e, cap, on, by_) {
    PledgesKept(e, "setMonthlyCommitment", setMonthlyCommitment(e, cap, on, by_));
  }

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
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysAdmittedInWindow(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysCommittedLeavesTraced(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysPledgesCovered(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysPledgedMonthUnadmitted(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> alwaysBindingsWellFormed(withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepAuthorityChanges(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepConfigurationFixed(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepAwardsRetained(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepMonthlyPolicyByOwner(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepMonthsRetained(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepOriginsRetained(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepPledgeIrrevocable(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepNewBindingAttested(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepPaidToLiveBinding(e, withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
  ensures (inv(e) ==> canWithdrawUnused(e, gross, transferOk, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_)))
{
  if inv(e) && canWithdrawUnused(e, gross, transferOk, by_) {
    PledgesKept(e, "withdrawUnused", withdrawUnused(e, gross, transferOk, by_));
    PledgedNonneg(e);
  }

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
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysAdmittedInWindow(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysCommittedLeavesTraced(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysPledgesCovered(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysPledgedMonthUnadmitted(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> alwaysBindingsWellFormed(claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepAuthorityChanges(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepConfigurationFixed(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepSourceSequenceCountsOrdinaryAwards(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepAwardsRetained(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepMonthlyPolicyByOwner(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepMonthsRetained(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepOriginsRetained(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepPledgeIrrevocable(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepNewBindingAttested(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepPaidToLiveBinding(e, claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepFreeSpentByOwnerOrAttestation(e, "claimFees", claimFees(e, transferOk)))
  ensures (inv(e) ==> canClaimFees(e, transferOk) ==> stepFreeRisesOnlyByDepositOrRelease(e, "claimFees", claimFees(e, transferOk)))
{
  if inv(e) && canClaimFees(e, transferOk) {
    PledgesKept(e, "claimFees", claimFees(e, transferOk));
  }

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
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysAdmittedInWindow(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysCommittedLeavesTraced(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysPledgesCovered(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysPledgedMonthUnadmitted(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> alwaysBindingsWellFormed(create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepAuthorityChanges(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepConfigurationFixed(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepAwardsRetained(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepMonthlyPolicyByOwner(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepMonthsRetained(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepOriginsRetained(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepPledgeIrrevocable(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepNewBindingAttested(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepPaidToLiveBinding(e, create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "create", create(e, project, token, purpose, tokenReady, by_)))
  ensures (inv(e) ==> canCreate(e, project, token, purpose, tokenReady, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "create", create(e, project, token, purpose, tokenReady, by_)))
{
  if inv(e) && canCreate(e, project, token, purpose, tokenReady, by_) {
    PledgesKept(e, "create", create(e, project, token, purpose, tokenReady, by_));
  }

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
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysAdmittedInWindow(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysCommittedLeavesTraced(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysPledgesCovered(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysPledgedMonthUnadmitted(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> alwaysBindingsWellFormed(createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepAuthorityChanges(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepConfigurationFixed(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepAwardsRetained(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepMonthlyPolicyByOwner(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepMonthsRetained(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepOriginsRetained(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepPledgeIrrevocable(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepNewBindingAttested(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepPaidToLiveBinding(e, createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
  ensures (inv(e) ==> canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_)))
{
  if inv(e) && canCreateWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_) {
    PledgesKept(e, "createWithMonthlyCommitment", createWithMonthlyCommitment(e, project, token, cap, on, tokenReady, by_));
  }

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
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysAdmittedInWindow(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysCommittedLeavesTraced(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysPledgesCovered(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysPledgedMonthUnadmitted(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepAuthorityChanges(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepConfigurationFixed(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepAwardsRetained(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepMonthlyPolicyByOwner(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepMonthsRetained(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepOriginsRetained(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepPledgeIrrevocable(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepNewBindingAttested(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepPaidToLiveBinding(e, commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "commitAward", commitAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "commitAward", commitAward(e, source, actor, gross, by_)))
{
  if inv(e) && canCommitAward(e, source, actor, gross, by_) {
    PledgesKept(e, "commitAward", commitAward(e, source, actor, gross, by_));
    PledgedNonneg(e);
  }

  if inv(e) && canCommitAward(e, source, actor, gross, by_) {
    var after := commitAward(e, source, actor, gross, by_);
    RecordAward(e, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(e.vault.key.purpose, gross), e.now));
    AwardsSuperset(e.vault.awards, after.vault.awards);
    TracedSameMonths(e, after);
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
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysAdmittedInWindow(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysCommittedLeavesTraced(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysPledgesCovered(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysPledgedMonthUnadmitted(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> alwaysBindingsWellFormed(commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepAuthorityChanges(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepConfigurationFixed(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepAwardsRetained(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepMonthlyPolicyByOwner(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepMonthsRetained(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepOriginsRetained(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepPledgeIrrevocable(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepNewBindingAttested(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepPaidToLiveBinding(e, commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
  ensures (inv(e) ==> canCommitBountyAward(e, source, actor, gross, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "commitBountyAward", commitBountyAward(e, source, actor, gross, by_)))
{
  if inv(e) && canCommitBountyAward(e, source, actor, gross, by_) {
    var after := commitBountyAward(e, source, actor, gross, by_);
    RecordAward(e, after, contracts__ledger_newAward(source, actor, gross, contracts__ledger_awardFee(e.vault.key.purpose, gross), e.now));
    AwardsSuperset(e.vault.awards, after.vault.awards);
    TracedSameMonths(e, after);
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
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysAdmittedInWindow(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysCommittedLeavesTraced(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysPledgesCovered(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysPledgedMonthUnadmitted(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> alwaysBindingsWellFormed(commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepAuthorityChanges(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepConfigurationFixed(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepSourceSequenceCountsOrdinaryAwards(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepAwardsRetained(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepMonthlyPolicyByOwner(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepMonthsRetained(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepOriginsRetained(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepPledgeIrrevocable(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepNewBindingAttested(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepPaidToLiveBinding(e, commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepFreeSpentByOwnerOrAttestation(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
  ensures (inv(e) ==> canCommitMonthlyLeaf(e, period, leaf) ==> stepFreeRisesOnlyByDepositOrRelease(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf)))
{
  if inv(e) && canCommitMonthlyLeaf(e, period, leaf) {
    PledgesKept(e, "commitMonthlyLeaf", commitMonthlyLeaf(e, period, leaf));
  }

  if inv(e) && canCommitMonthlyLeaf(e, period, leaf) {
    var after := commitMonthlyLeaf(e, period, leaf);
    var i := MonthForIndex(e, period);
    var m := e.vault.months[i];
    assert e.vault.key.purpose.Ordinary?;
    RecordAward(e, after, contracts__ledger_newAward(leaf.source, leaf.actor, leaf.gross, settlement__money_ordinaryFee(leaf.gross), e.now));
    assert m.released == 0;
    ReplaceMonth(e, after, i, m.(remaining := (m.remaining - leaf.gross), committedGross := (m.committedGross + leaf.gross)));
    MonthsDistinct(e);
    CommitLeafTraced(e, after, i, m.(remaining := (m.remaining - leaf.gross), committedGross := (m.committedGross + leaf.gross)), LeafOrigin(period, leaf), contracts__ledger_newAward(leaf.source, leaf.actor, leaf.gross, settlement__money_ordinaryFee(leaf.gross), e.now));
  }
}

lemma releaseMonthlyReserve_ensures(e: Escrow, period: int, expectedRemaining: int, releasedGross: int, signer: string, by_: string)
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysClockStarted(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysFactoryRolesSeparate(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysUninitializedEmpty(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysRotationEffective(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysOneVaultPerKey(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysCreatedVault(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysConserved(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysBalanceCovers(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysFeesAccounted(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysNonnegative(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysReservedMatchesAwards(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysPaidMatchesAwards(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysAwardsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysMonthsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysPendingMatchesMonths(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysBountyHasNoMonthly(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysAdmittedInWindow(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysCommittedLeavesTraced(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysPledgesCovered(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysPledgedMonthUnadmitted(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> alwaysBindingsWellFormed(releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepAuthorityChanges(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepConfigurationFixed(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepAwardsRetained(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepMonthlyPolicyByOwner(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepMonthsRetained(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepOriginsRetained(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepPledgeIrrevocable(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepNewBindingAttested(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepPaidToLiveBinding(e, releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
  ensures (inv(e) ==> canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_)))
{
  if inv(e) && canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) {
    PledgesKept(e, "releaseMonthlyReserve", releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_));
  }

  if inv(e) && canReleaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_) {
    var after := releaseMonthlyReserve(e, period, expectedRemaining, releasedGross, signer, by_);
    var i := MonthForIndex(e, period);
    var m := e.vault.months[i];
    assert m.committedGross == 0 && m.released == 0;
    SameAwards(e, after);
    AwardsFrame(e, after);
    ReplaceMonth(e, after, i, m.(remaining := 0, released := releasedGross));
    MonthsDistinct(e);
    TracedReplaceMonth(e, after, i, m.(remaining := 0, released := releasedGross));
  }
}

lemma reserveMonthly_ensures(e: Escrow, period: int, reservation: Reservation, sequence: int, signer: string)
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysClockStarted(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysFactoryRolesSeparate(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysUninitializedEmpty(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysRotationEffective(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysOneVaultPerKey(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysCreatedVault(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysConserved(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysBalanceCovers(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysFeesAccounted(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysNonnegative(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysReservedMatchesAwards(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysPaidMatchesAwards(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysAwardsWellFormed(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysMonthsWellFormed(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysPendingMatchesMonths(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysBountyHasNoMonthly(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysAdmittedInWindow(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysCommittedLeavesTraced(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysPledgesCovered(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysPledgedMonthUnadmitted(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> alwaysBindingsWellFormed(reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepAuthorityChanges(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepConfigurationFixed(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepSourceSequenceCountsOrdinaryAwards(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepAwardsRetained(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepMonthlyPolicyByOwner(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepMonthsRetained(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepOriginsRetained(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepPledgeIrrevocable(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepNewBindingAttested(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepPaidToLiveBinding(e, reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepFreeSpentByOwnerOrAttestation(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, signer)))
  ensures (inv(e) ==> canReserveMonthly(e, period, reservation, sequence, signer) ==> stepFreeRisesOnlyByDepositOrRelease(e, "reserveMonthly", reserveMonthly(e, period, reservation, sequence, signer)))
{
  if inv(e) && canReserveMonthly(e, period, reservation, sequence, signer) {
    var after := reserveMonthly(e, period, reservation, sequence, signer);
    SameAwards(e, after);
    AwardsFrame(e, after);
    ClosePledgeFrame(e.vault, period);
    AppendMonth(e, after, Month(period, true, reservation.digest, reservation.root, reservation.wholeGross, reservation.remainingGross, reservation.remainingGross, reservation.count, 0, 0, e.now, capFor(e.vault, period), reservation.leaves));
    TracedAppendMonth(e, after, Month(period, true, reservation.digest, reservation.root, reservation.wholeGross, reservation.remainingGross, reservation.remainingGross, reservation.count, 0, 0, e.now, capFor(e.vault, period), reservation.leaves));
    ClosePledgeCovers(e, period);
    PledgedMonthAfterClose(e, period, after);
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
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysAdmittedInWindow(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysCommittedLeavesTraced(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysPledgesCovered(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysPledgedMonthUnadmitted(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> alwaysBindingsWellFormed(bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepAuthorityChanges(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepConfigurationFixed(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepAwardsRetained(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepMonthlyPolicyByOwner(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepMonthsRetained(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepOriginsRetained(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepPledgeIrrevocable(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepNewBindingAttested(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepPaidToLiveBinding(e, bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
  ensures (inv(e) ==> canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_)))
{
  if inv(e) && canBindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_) {
    PledgesKept(e, "bindDestination", bindDestination(e, actor, destination, expectedVersion, claim, expiresAt, walletSigned, by_));
  }

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
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysAdmittedInWindow(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysCommittedLeavesTraced(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysPledgesCovered(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysPledgedMonthUnadmitted(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> alwaysBindingsWellFormed(cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepAuthorityChanges(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepConfigurationFixed(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepSourceSequenceCountsOrdinaryAwards(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepAwardsRetained(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepMonthlyPolicyByOwner(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepMonthsRetained(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepOriginsRetained(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepPledgeIrrevocable(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepNewBindingAttested(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepPaidToLiveBinding(e, cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepFreeSpentByOwnerOrAttestation(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
  ensures (inv(e) ==> canCancelBinding(e, actor, expectedVersion, by_) ==> stepFreeRisesOnlyByDepositOrRelease(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_)))
{
  if inv(e) && canCancelBinding(e, actor, expectedVersion, by_) {
    PledgesKept(e, "cancelBinding", cancelBinding(e, actor, expectedVersion, by_));
  }

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
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysAdmittedInWindow(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysCommittedLeavesTraced(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysPledgesCovered(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysPledgedMonthUnadmitted(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> alwaysBindingsWellFormed(pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepAuthorityChanges(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepConfigurationFixed(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepSourceSequenceCountsOrdinaryAwards(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepAwardsRetained(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepMonthlyPolicyByOwner(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepMonthsRetained(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepOriginsRetained(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepPledgeIrrevocable(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepNewBindingAttested(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepPaidToLiveBinding(e, pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepFreeSpentByOwnerOrAttestation(e, "pay", pay(e, source, expectedVersion, transferOk)))
  ensures (inv(e) ==> canPay(e, source, expectedVersion, transferOk) ==> stepFreeRisesOnlyByDepositOrRelease(e, "pay", pay(e, source, expectedVersion, transferOk)))
{
  if inv(e) && canPay(e, source, expectedVersion, transferOk) {
    PledgesKept(e, "pay", pay(e, source, expectedVersion, transferOk));
  }

  if inv(e) && canPay(e, source, expectedVersion, transferOk) {
    PayFacts(e, source, expectedVersion, transferOk);
    var after := pay(e, source, expectedVersion, transferOk);
    assert |after.vault.awards| == |e.vault.awards|;
    AwardsPointwise(e.vault.awards, after.vault.awards);
    TracedSameMonths(e, after);
  }
}

lemma commitMonthly_ensures(e: Escrow, period: int, entries: seq<contracts__ledger_Leaf>, signer: string)
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysClockStarted(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysFactoryRolesSeparate(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysUninitializedEmpty(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysRotationEffective(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysOneVaultPerKey(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysCreatedVault(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysConserved(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysBalanceCovers(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysFeesAccounted(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysNonnegative(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysReservedMatchesAwards(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysPaidMatchesAwards(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysAwardsWellFormed(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysMonthsWellFormed(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysPendingMatchesMonths(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysBountyHasNoMonthly(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysAdmittedInWindow(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysCommittedLeavesTraced(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysPledgesCovered(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysPledgedMonthUnadmitted(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> alwaysBindingsWellFormed(commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepAuthorityChanges(e, "commitMonthly", commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepConfigurationFixed(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepSourceSequenceCountsOrdinaryAwards(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepAwardsRetained(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepMonthlyPolicyByOwner(e, "commitMonthly", commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepMonthsRetained(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepOriginsRetained(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepPledgeIrrevocable(e, "commitMonthly", commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepNewBindingAttested(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepPaidToLiveBinding(e, commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepFreeSpentByOwnerOrAttestation(e, "commitMonthly", commitMonthly(e, period, entries, signer)))
  ensures (inv(e) ==> canCommitMonthly(e, period, entries, signer) ==> stepFreeRisesOnlyByDepositOrRelease(e, "commitMonthly", commitMonthly(e, period, entries, signer)))
{
  if inv(e) && canCommitMonthly(e, period, entries, signer) {
    CommitMonthlyFacts(e, period, entries, signer);
  }
}

lemma step_ensures(current: Escrow, event: Event, by_: string)
  requires inv(current)
  ensures inv(step(current, event, by_))
{
  hide *;
  reveal step, inv;
  match event {
    case initializeFactory(i_registrar, i_feeRecipient, i_identity, i_delay, i_upgrader, i_factoryLogic, i_logic, i_uups) => initializeFactory_ensures(current, i_registrar, i_feeRecipient, i_identity, i_delay, i_upgrader, i_factoryLogic, i_logic, i_uups);
    case tick(i_timestamp) => tick_ensures(current, i_timestamp);
    case proposeUpgradeAuthority(i_successor) => proposeUpgradeAuthority_ensures(current, i_successor, by_);
    case acceptUpgradeAuthority => acceptUpgradeAuthority_ensures(current, by_);
    case setVaultImplementation(i_logic, i_uups) => setVaultImplementation_ensures(current, i_logic, i_uups, by_);
    case upgradeFactory(i_logic, i_uups) => upgradeFactory_ensures(current, i_logic, i_uups, by_);
    case upgradeVault(i_logic, i_uups) => upgradeVault_ensures(current, i_logic, i_uups, by_);
    case proposeIdentityAuthority(i_successor) => proposeIdentityAuthority_ensures(current, i_successor, by_);
    case cancelIdentityAuthorityRotation => cancelIdentityAuthorityRotation_ensures(current, by_);
    case executeIdentityAuthorityRotation => executeIdentityAuthorityRotation_ensures(current);
    case create(i_project, i_token, i_purpose, i_tokenReady) => create_ensures(current, i_project, i_token, i_purpose, i_tokenReady, by_);
    case createWithMonthlyCommitment(i_project, i_token, i_cap, i_on, i_tokenReady) => createWithMonthlyCommitment_ensures(current, i_project, i_token, i_cap, i_on, i_tokenReady, by_);
    case deposit(i_amount, i_sent, i_transferExact) => deposit_ensures(current, i_amount, i_sent, i_transferExact);
    case transferIn(i_amount) => transferIn_ensures(current, i_amount);
    case commitAward(i_source, i_actor, i_gross) => commitAward_ensures(current, i_source, i_actor, i_gross, by_);
    case commitBountyAward(i_source, i_actor, i_gross) => commitBountyAward_ensures(current, i_source, i_actor, i_gross, by_);
    case setMonthlyCommitment(i_cap, i_on) => setMonthlyCommitment_ensures(current, i_cap, i_on, by_);
    case commitMonthly(i_period, i_entries, i_signer) => commitMonthly_ensures(current, i_period, i_entries, i_signer);
    case reserveMonthly(i_period, i_reservation, i_sequence, i_signer) => reserveMonthly_ensures(current, i_period, i_reservation, i_sequence, i_signer);
    case commitMonthlyLeaf(i_period, i_leaf) => commitMonthlyLeaf_ensures(current, i_period, i_leaf);
    case releaseMonthlyReserve(i_period, i_expectedRemaining, i_releasedGross, i_signer) => releaseMonthlyReserve_ensures(current, i_period, i_expectedRemaining, i_releasedGross, i_signer, by_);
    case pledgeMonths(i_fromPeriod, i_count, i_amount) => pledgeMonths_ensures(current, i_fromPeriod, i_count, i_amount, by_);
    case expirePledge(i_period) => expirePledge_ensures(current, i_period);
    case bindDestination(i_actor, i_destination, i_expectedVersion, i_claim, i_expiresAt, i_walletSigned) => bindDestination_ensures(current, i_actor, i_destination, i_expectedVersion, i_claim, i_expiresAt, i_walletSigned, by_);
    case cancelBinding(i_actor, i_expectedVersion) => cancelBinding_ensures(current, i_actor, i_expectedVersion, by_);
    case pay(i_source, i_expectedVersion, i_transferOk) => pay_ensures(current, i_source, i_expectedVersion, i_transferOk);
    case withdrawUnused(i_gross, i_transferOk) => withdrawUnused_ensures(current, i_gross, i_transferOk, by_);
    case claimFees(i_transferOk) => claimFees_ensures(current, i_transferOk);
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
  Initial_alwaysAdmittedInWindow();
  Initial_alwaysPledgesCovered();
  Initial_alwaysPledgedMonthUnadmitted();
  Initial_alwaysBindingsWellFormed();
  Initial_alwaysCommittedLeavesTraced();
}
