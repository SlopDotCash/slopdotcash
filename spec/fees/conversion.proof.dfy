lemma HoldingsIdsEquiv(xs: seq<Holding>, k: int)
  requires k >= 0
  ensures (Std.Collections.Seq.FoldLeft((i: int, h: Holding) => (if ((i >= 0) && (h.token == (i + 1))) then (i + 1) else -1), k, xs) == k + |xs|) <==>
    (forall j :: 0 <= j < |xs| ==> xs[j].token == k + j + 1)
  decreases |xs|
{
  var f := (i: int, h: Holding) => (if ((i >= 0) && (h.token == (i + 1))) then (i + 1) else -1);
  if |xs| > 0 {
    if xs[0].token == k + 1 {
      HoldingsIdsEquiv(xs[1..], k + 1);
      assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    } else {
      HoldingsIdsNeg(xs[1..]);
    }
  }
}

lemma HoldingsIdsNeg(xs: seq<Holding>)
  ensures Std.Collections.Seq.FoldLeft((i: int, h: Holding) => (if ((i >= 0) && (h.token == (i + 1))) then (i + 1) else -1), -1, xs) == -1
  decreases |xs|
{
  if |xs| > 0 {
    HoldingsIdsNeg(xs[1..]);
  }
}

lemma RowsIdsEquiv(xs: seq<Row>, k: int)
  requires k >= 0
  ensures (Std.Collections.Seq.FoldLeft((i: int, r: Row) => (if ((i >= 0) && (r.id == (i + 1))) then (i + 1) else -1), k, xs) == k + |xs|) <==>
    (forall j :: 0 <= j < |xs| ==> xs[j].id == k + j + 1)
  decreases |xs|
{
  if |xs| > 0 {
    if xs[0].id == k + 1 {
      RowsIdsEquiv(xs[1..], k + 1);
      assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    } else {
      RowsIdsNeg(xs[1..]);
    }
  }
}

lemma RowsIdsNeg(xs: seq<Row>)
  ensures Std.Collections.Seq.FoldLeft((i: int, r: Row) => (if ((i >= 0) && (r.id == (i + 1))) then (i + 1) else -1), -1, xs) == -1
  decreases |xs|
{
  if |xs| > 0 {
    RowsIdsNeg(xs[1..]);
  }
}

lemma GasIdsEquiv(xs: seq<Reservation>, k: int)
  requires k >= 0
  ensures (Std.Collections.Seq.FoldLeft((i: int, g: Reservation) => (if ((i >= 0) && (g.id == (i + 1))) then (i + 1) else -1), k, xs) == k + |xs|) <==>
    (forall j :: 0 <= j < |xs| ==> xs[j].id == k + j + 1)
  decreases |xs|
{
  if |xs| > 0 {
    if xs[0].id == k + 1 {
      GasIdsEquiv(xs[1..], k + 1);
      assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    } else {
      GasIdsNeg(xs[1..]);
    }
  }
}

lemma GasIdsNeg(xs: seq<Reservation>)
  ensures Std.Collections.Seq.FoldLeft((i: int, g: Reservation) => (if ((i >= 0) && (g.id == (i + 1))) then (i + 1) else -1), -1, xs) == -1
  decreases |xs|
{
  if |xs| > 0 {
    GasIdsNeg(xs[1..]);
  }
}

lemma SumFoldShift<T>(f: (int, T) -> int, v: T -> int, init: int, xs: seq<T>)
  requires forall a, x :: f(a, x) == a + v(x)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init + Std.Collections.Seq.FoldLeft(f, 0, xs)
  decreases |xs|
{
  if |xs| > 0 {
    SumFoldShift(f, v, init + v(xs[0]), xs[1..]);
    SumFoldShift(f, v, v(xs[0]), xs[1..]);
  }
}

lemma SumFoldNonneg<T>(f: (int, T) -> int, v: T -> int, init: int, xs: seq<T>)
  requires forall a, x :: f(a, x) == a + v(x)
  requires forall x :: x in xs ==> v(x) >= 0
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) >= init
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init <==> (forall x :: x in xs ==> v(x) == 0)
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    SumFoldNonneg(f, v, init + v(xs[0]), xs[1..]);
    assert xs == [xs[0]] + xs[1..];
  }
}

lemma SumFoldCompare<T, U>(f1: (int, T) -> int, v1: T -> int, f2: (int, U) -> int, v2: U -> int, init1: int, init2: int, xs: seq<T>, ys: seq<U>)
  requires |xs| == |ys|
  requires init1 <= init2
  requires forall a, x :: f1(a, x) == a + v1(x)
  requires forall a, y :: f2(a, y) == a + v2(y)
  requires forall i :: 0 <= i < |xs| ==> v1(xs[i]) <= v2(ys[i])
  ensures Std.Collections.Seq.FoldLeft(f1, init1, xs) <= Std.Collections.Seq.FoldLeft(f2, init2, ys)
  decreases |xs|
{
  if |xs| > 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    SumFoldCompare(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..]);
  }
}

lemma SumFoldPointwiseDiff<T>(f: (int, T) -> int, v: T -> int, init: int, xs: seq<T>, ys: seq<T>, idx: int)
  requires |xs| == |ys|
  requires 0 <= idx < |xs|
  requires forall a, x :: f(a, x) == a + v(x)
  requires forall j :: 0 <= j < |xs| && j != idx ==> xs[j] == ys[j]
  ensures Std.Collections.Seq.FoldLeft(f, init, ys) == Std.Collections.Seq.FoldLeft(f, init, xs) - v(xs[idx]) + v(ys[idx])
  decreases |xs|
{
  if idx == 0 {
    assert xs[1..] == ys[1..];
    SumFoldShift(f, v, init + v(xs[0]), xs[1..]);
    SumFoldShift(f, v, init + v(ys[0]), ys[1..]);
  } else {
    assert xs[0] == ys[0];
    assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1] && ys[1..][j] == ys[j + 1];
    SumFoldPointwiseDiff(f, v, init + v(xs[0]), xs[1..], ys[1..], idx - 1);
  }
}

lemma SumFoldConcat<T>(f: (int, T) -> int, v: T -> int, init: int, a: seq<T>, b: seq<T>)
  requires forall acc, x :: f(acc, x) == acc + v(x)
  ensures Std.Collections.Seq.FoldLeft(f, init, a + b) == Std.Collections.Seq.FoldLeft(f, init, a) + Std.Collections.Seq.FoldLeft(f, 0, b)
  decreases |a|
{
  if |a| == 0 {
    assert a + b == b;
    SumFoldShift(f, v, init, b);
  } else {
    assert (a + b)[0] == a[0] && (a + b)[1..] == a[1..] + b;
    SumFoldConcat(f, v, f(init, a[0]), a[1..], b);
  }
}

lemma SumFoldDropOne<T>(f: (int, T) -> int, v: T -> int, init: int, xs: seq<T>, idx: int)
  requires 0 <= idx < |xs|
  requires forall a, x :: f(a, x) == a + v(x)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs[..idx] + xs[idx + 1..]) + v(xs[idx]) == Std.Collections.Seq.FoldLeft(f, init, xs)
{
  var left := xs[..idx];
  var right := xs[idx + 1..];
  var mid := [xs[idx]] + right;
  assert xs == left + mid;
  assert mid[0] == xs[idx] && mid[1..] == right;
  SumFoldConcat(f, v, init, left, mid);
  SumFoldConcat(f, v, init, left, right);
  SumFoldShift(f, v, f(0, xs[idx]), right);
}

lemma SumFoldAdd<T, U>(f1: (int, T) -> int, v1: T -> int, f2: (int, U) -> int, v2: U -> int, f3: (int, T) -> int, v3: T -> int, init1: int, init2: int, init3: int, xs: seq<T>, ys: seq<U>)
  requires |xs| == |ys|
  requires init1 + init2 == init3
  requires forall a, x :: f1(a, x) == a + v1(x)
  requires forall a, y :: f2(a, y) == a + v2(y)
  requires forall a, x :: f3(a, x) == a + v3(x)
  requires forall i :: 0 <= i < |xs| ==> v1(xs[i]) + v2(ys[i]) == v3(xs[i])
  ensures Std.Collections.Seq.FoldLeft(f1, init1, xs) + Std.Collections.Seq.FoldLeft(f2, init2, ys) == Std.Collections.Seq.FoldLeft(f3, init3, xs)
  decreases |xs|
{
  if |xs| > 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    SumFoldAdd(f1, v1, f2, v2, f3, v3, init1 + v1(xs[0]), init2 + v2(ys[0]), init3 + v3(xs[0]), xs[1..], ys[1..]);
  }
}

lemma VaultOfSpec(vs: seq<ReviewedVault>, vault: int, acc: ReviewedVault)
  requires acc.vault == 0 || acc in vs
  ensures var res := Std.Collections.Seq.FoldLeft((found: ReviewedVault, v: ReviewedVault) => (if (v.vault == vault) then v else found), acc, vs);
    res.vault > 0 ==> (res == acc || res in vs)
  decreases |vs|
{
  if |vs| > 0 {
    var next := if vs[0].vault == vault then vs[0] else acc;
    if next.vault != 0 {
      assert next == acc || next == vs[0];
    }
    VaultOfSpecAux(vs[1..], vault, next);
  }
}

lemma VaultOfSpecAux(vs: seq<ReviewedVault>, vault: int, acc: ReviewedVault)
  ensures var res := Std.Collections.Seq.FoldLeft((found: ReviewedVault, v: ReviewedVault) => (if (v.vault == vault) then v else found), acc, vs);
    res == acc || res in vs
  decreases |vs|
{
  if |vs| > 0 {
    var next := if vs[0].vault == vault then vs[0] else acc;
    VaultOfSpecAux(vs[1..], vault, next);
    assert vs == [vs[0]] + vs[1..];
  }
}

lemma OwnReservationAux(gs: seq<Reservation>, runId: int, acc: Reservation)
  requires acc.id == 0 || (acc.id > 0 && acc.state.Reserved? && acc.runId == runId)
  requires forall g :: g in gs ==> g.id > 0
  ensures var res := Std.Collections.Seq.FoldLeft((found: Reservation, g: Reservation) => (if (g.state.Reserved? && (g.runId == runId)) then g else found), acc, gs);
    (res.id > 0 <==> (acc.id > 0 || exists g :: g in gs && g.state.Reserved? && g.runId == runId)) &&
    (res == acc || (res in gs && res.state.Reserved? && res.runId == runId))
  decreases |gs|
{
  if |gs| > 0 {
    assert gs[0] in gs;
    assert forall y :: y in gs[1..] ==> y in gs;
    var next := if gs[0].state.Reserved? && gs[0].runId == runId then gs[0] else acc;
    OwnReservationAux(gs[1..], runId, next);
    assert gs == [gs[0]] + gs[1..];
  }
}

lemma PendingIntentAux(rs: seq<Row>, runId: int, acc: Row)
  requires acc.id == 0 || (acc.id > 0 && acc.state.Quoted? && acc.live && acc.runId == runId)
  requires forall r :: r in rs ==> r.id > 0
  ensures var res := Std.Collections.Seq.FoldLeft((found: Row, r: Row) => (if ((r.state.Quoted? && r.live) && (r.runId == runId)) then r else found), acc, rs);
    (res.id > 0 <==> (acc.id > 0 || exists r :: r in rs && r.state.Quoted? && r.live && r.runId == runId)) &&
    (res == acc || (res in rs && res.state.Quoted? && res.live && res.runId == runId))
  decreases |rs|
{
  if |rs| > 0 {
    assert rs[0] in rs;
    assert forall y :: y in rs[1..] ==> y in rs;
    var next := if rs[0].state.Quoted? && rs[0].live && rs[0].runId == runId then rs[0] else acc;
    PendingIntentAux(rs[1..], runId, next);
    assert rs == [rs[0]] + rs[1..];
  }
}

lemma NonceFloorBound(f: Fee, gs: seq<Reservation>, acc: int)
  ensures Std.Collections.Seq.FoldLeft((t: int, g: Reservation) => (if ((g.state.Reserved? || (g.state.Signed? && (g.settled || !(expiredRow(f, g.row))))) && (g.nonce >= t)) then (g.nonce + 1) else t), acc, gs) >= acc
  ensures forall g :: g in gs && (g.state.Reserved? || (g.state.Signed? && (g.settled || !(expiredRow(f, g.row))))) ==>
    Std.Collections.Seq.FoldLeft((t: int, g: Reservation) => (if ((g.state.Reserved? || (g.state.Signed? && (g.settled || !(expiredRow(f, g.row))))) && (g.nonce >= t)) then (g.nonce + 1) else t), acc, gs) > g.nonce
  decreases |gs|
{
  if |gs| > 0 {
    var step := (t: int, g: Reservation) => (if ((g.state.Reserved? || (g.state.Signed? && (g.settled || !(expiredRow(f, g.row))))) && (g.nonce >= t)) then (g.nonce + 1) else t);
    NonceFloorBound(f, gs[1..], step(acc, gs[0]));
    assert gs == [gs[0]] + gs[1..];
  }
}

lemma SolanaSequenceBound(gs: seq<Reservation>, acc: int)
  ensures Std.Collections.Seq.FoldLeft((t: int, g: Reservation) => (if (g.nonce >= t) then (g.nonce + 1) else t), acc, gs) >= acc
  ensures forall g :: g in gs ==> Std.Collections.Seq.FoldLeft((t: int, g: Reservation) => (if (g.nonce >= t) then (g.nonce + 1) else t), acc, gs) > g.nonce
  decreases |gs|
{
  if |gs| > 0 {
    var step := (t: int, g: Reservation) => (if (g.nonce >= t) then (g.nonce + 1) else t);
    SolanaSequenceBound(gs[1..], step(acc, gs[0]));
    assert gs == [gs[0]] + gs[1..];
  }
}

lemma OpenRowsZeroImpliesNone(f: Fee, token: int)
  requires openRows(f, token) == 0
  ensures forall r :: r in f.rows ==> !(isOpen(r) && r.token == token)
  ensures openAmount(f, token) == 0
  ensures openClaims(f, token) == 0
{
  var fr := (t: int, r: Row) => (if (isOpen(r) && (r.token == token)) then (t + 1) else t);
  var vr := (r: Row) => (if (isOpen(r) && (r.token == token)) then 1 else 0);
  SumFoldNonneg(fr, vr, 0, f.rows);
  var fa := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == token)) then (t + r.amountIn) else t);
  var va := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == token)) then r.amountIn else 0);
  SumFoldNonneg(fa, va, 0, f.rows);
  var fc := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == token)) then (t + r.amountIn) else t);
  var vc := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == token)) then r.amountIn else 0);
  SumFoldNonneg(fc, vc, 0, f.rows);
}

lemma DayMonotone(a: int, b: int)
  requires 0 <= a <= b
  ensures quotient_fees__conversion(a, dayMs) == a / dayMs
  ensures quotient_fees__conversion(b, dayMs) == b / dayMs
  ensures quotient_fees__conversion(a, dayMs) <= quotient_fees__conversion(b, dayMs)
{
}

lemma JournaledGasDef(f: Fee)
  ensures journaledGas(f) == ProofLib.Filter((g: Reservation) => !(g.imported), f.gas)
{
}

lemma BucketHoldsUnique(xs: seq<Reservation>, g1: Reservation, g2: Reservation)
  requires ProofLib.DistinctBy(xs, (g: Reservation) => g.id)
  requires g1 in xs && g2 in xs
  requires g1.nonce == g2.nonce
  requires bucketHolds(xs, g1) && bucketHolds(xs, g2)
  ensures g1 == g2
{
  var i :| 0 <= i < |xs| && xs[i] == g1;
  var j :| 0 <= j < |xs| && xs[j] == g2;
  if i != j {
    assert g1.id != g2.id;
  }
}

lemma BucketWinnerExists(xs: seq<Reservation>, targetNonce: int) returns (w: Reservation)
  requires exists g :: g in xs && !g.state.Abandoned? && !g.settled && g.nonce == targetNonce
  ensures w in xs && !w.state.Abandoned? && !w.settled && w.nonce == targetNonce
  ensures bucketHolds(xs, w)
  ensures forall g :: g in xs && !g.state.Abandoned? && !g.settled && g.nonce == targetNonce ==> g.maximum <= w.maximum
  decreases |xs|
{
  var x := xs[0];
  if exists g :: g in xs[1..] && !g.state.Abandoned? && !g.settled && g.nonce == targetNonce {
    var sub := BucketWinnerExists(xs[1..], targetNonce);
    if !x.state.Abandoned? && !x.settled && x.nonce == targetNonce && (x.maximum > sub.maximum || (x.maximum == sub.maximum && x.id < sub.id)) {
      w := x;
    } else {
      w := sub;
    }
    assert xs == [x] + xs[1..];
  } else {
    assert xs == [x] + xs[1..];
    w := x;
  }
}

lemma LiabilitySplitDropOne(xs: seq<Reservation>, k: int, today: int)
  requires 0 <= k < |xs|
  requires ProofLib.DistinctBy(xs, (g: Reservation) => g.id)
  requires forall g :: g in xs ==> g.maximum >= 0 && g.actual >= 0
  ensures liabilityOf(xs[..k] + xs[k + 1..], today) <= liabilityOf(xs, today)
{
  hide *;
  reveal liabilityOf, bucketHolds, ProofLib.DistinctBy;
  var e := xs[k];
  var ys := xs[..k] + xs[k + 1..];
  var fx := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(xs, g) then (t + g.maximum) else t));
  var vx := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(xs, g) then g.maximum else 0));
  var fy := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(ys, g) then (t + g.maximum) else t));
  var vy := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(ys, g) then g.maximum else 0));
  SumFoldDropOne(fx, vx, 0, xs, k);
  assert ProofLib.DistinctBy(ys, (g: Reservation) => g.id) by {
    forall i, j | 0 <= i < |ys| && 0 <= j < |ys| && i != j ensures ys[i].id != ys[j].id {
      var ii := if i < k then i else i + 1;
      var jj := if j < k then j else j + 1;
      assert ys[i] == xs[ii] && ys[j] == xs[jj];
    }
  }
  if e.state.Abandoned? || e.settled || !bucketHolds(xs, e) {
    if !e.state.Abandoned? && !e.settled && !bucketHolds(xs, e) {
      var dom :| dom in xs && !dom.state.Abandoned? && !dom.settled && dom.nonce == e.nonce && (dom.maximum > e.maximum || (dom.maximum == e.maximum && dom.id < e.id));
      assert dom != e;
      var di :| 0 <= di < |xs| && xs[di] == dom;
      assert di != k;
      assert dom in ys by {
        if di < k { assert ys[di] == dom; } else { assert ys[di - 1] == dom; }
      }
      forall i | 0 <= i < |ys| ensures vy(ys[i]) == vx(ys[i]) {
        assert ys[i] in xs;
        assert bucketHolds(ys, ys[i]) == bucketHolds(xs, ys[i]);
      }
    } else {
      forall i | 0 <= i < |ys| ensures vy(ys[i]) == vx(ys[i]) {
        assert ys[i] in xs;
        assert bucketHolds(ys, ys[i]) == bucketHolds(xs, ys[i]);
      }
    }
    SumFoldCompare(fy, vy, fx, vx, 0, 0, ys, ys);
    assert vx(e) >= 0;
  } else {
    assert vx(e) == e.maximum;
    if exists i :: 0 <= i < |ys| && bucketHolds(ys, ys[i]) && !bucketHolds(xs, ys[i]) {
      var wIdx :| 0 <= wIdx < |ys| && bucketHolds(ys, ys[wIdx]) && !bucketHolds(xs, ys[wIdx]);
      var w := ys[wIdx];
      assert w in xs;
      assert w.nonce == e.nonce;
      assert w.maximum <= e.maximum;
      forall i | 0 <= i < |ys| && i != wIdx ensures vy(ys[i]) == vx(ys[i]) {
        assert ys[i] in xs;
        if ys[i].nonce == e.nonce {
          if bucketHolds(ys, ys[i]) {
            BucketHoldsUnique(ys, ys[i], w);
            assert ys[i].id == w.id;
          }
          if bucketHolds(xs, ys[i]) {
            BucketHoldsUnique(xs, ys[i], e);
            var xi := if i < k then i else i + 1;
            assert xs[xi] == e && xi != k;
          }
        } else {
          assert bucketHolds(ys, ys[i]) == bucketHolds(xs, ys[i]);
        }
      }
      SumFoldDropOne(fy, vy, 0, ys, wIdx);
      SumFoldDropOne(fx, vx, 0, ys, wIdx);
      var ys2 := ys[..wIdx] + ys[wIdx + 1..];
      forall i | 0 <= i < |ys2| ensures vy(ys2[i]) == vx(ys2[i]) {
        var j := if i < wIdx then i else i + 1;
        assert ys2[i] == ys[j];
      }
      SumFoldCompare(fy, vy, fx, vx, 0, 0, ys2, ys2);
      assert vy(w) == w.maximum;
      assert vx(w) == 0;
    } else {
      forall i | 0 <= i < |ys| ensures vy(ys[i]) <= vx(ys[i]) {
        assert ys[i] in xs;
      }
      SumFoldCompare(fy, vy, fx, vx, 0, 0, ys, ys);
    }
  }
}

lemma LiabilityOfFilter(p: Reservation -> bool, xs: seq<Reservation>, today: int)
  requires ProofLib.DistinctBy(xs, (g: Reservation) => g.id)
  requires forall g :: g in xs ==> g.maximum >= 0 && g.actual >= 0
  ensures liabilityOf(ProofLib.Filter(p, xs), today) <= liabilityOf(xs, today)
  decreases |xs|
{
  if exists k :: 0 <= k < |xs| && !p(xs[k]) {
    var k :| 0 <= k < |xs| && !p(xs[k]);
    var ys := xs[..k] + xs[k + 1..];
    FilterDropFalse(p, xs, k);
    LiabilitySplitDropOne(xs, k, today);
    assert ProofLib.DistinctBy(ys, (g: Reservation) => g.id) by {
      forall i, j | 0 <= i < |ys| && 0 <= j < |ys| && i != j ensures ys[i].id != ys[j].id {
        var ii := if i < k then i else i + 1;
        var jj := if j < k then j else j + 1;
        assert ys[i] == xs[ii] && ys[j] == xs[jj];
      }
    }
    assert forall g :: g in ys ==> g in xs;
    LiabilityOfFilter(p, ys, today);
  } else {
    FilterAllTrue(p, xs);
  }
}

lemma FilterDropFalse<T>(p: T -> bool, xs: seq<T>, k: int)
  requires 0 <= k < |xs| && !p(xs[k])
  ensures ProofLib.Filter(p, xs[..k] + xs[k + 1..]) == ProofLib.Filter(p, xs)
  decreases |xs|
{
  if k == 0 {
    ProofLib.FilterCons(p, xs);
    assert xs[..0] + xs[1..] == xs[1..];
  } else {
    var ys := xs[..k] + xs[k + 1..];
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(p, ys);
    assert ys[0] == xs[0];
    assert ys[1..] == xs[1..][..(k - 1)] + xs[1..][k..];
    FilterDropFalse(p, xs[1..], k - 1);
  }
}

lemma FilterAllTrue<T>(p: T -> bool, xs: seq<T>)
  requires forall i :: 0 <= i < |xs| ==> p(xs[i])
  ensures ProofLib.Filter(p, xs) == xs
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
  } else {
    ProofLib.FilterCons(p, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    FilterAllTrue(p, xs[1..]);
  }
}

lemma LiabilityAbandonOne(xs: seq<Reservation>, k: int, today: int)
  requires 0 <= k < |xs|
  requires ProofLib.DistinctBy(xs, (g: Reservation) => g.id)
  requires forall g :: g in xs ==> g.maximum > 0 && g.actual >= 0
  requires xs[k].state.Reserved? && !xs[k].settled
  ensures liabilityOf(xs[k := xs[k].(state := GasState.Abandoned)], today) <= liabilityOf(xs, today)
{
  var ys := xs[k := xs[k].(state := GasState.Abandoned)];
  var drop := xs[..k] + xs[k + 1..];
  assert drop == ys[..k] + ys[k + 1..];
  LiabilitySplitDropOne(xs, k, today);
  var fy := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(ys, g) then (t + g.maximum) else t));
  var vy := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(ys, g) then g.maximum else 0));
  var fd := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(drop, g) then (t + g.maximum) else t));
  var vd := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(drop, g) then g.maximum else 0));
  SumFoldDropOne(fy, vy, 0, ys, k);
  assert vy(ys[k]) == 0;
  forall i | 0 <= i < |drop| ensures vy(drop[i]) == vd(drop[i]) {
    assert drop[i] in ys;
    assert bucketHolds(ys, drop[i]) == bucketHolds(drop, drop[i]);
  }
  SumFoldCompare(fy, vy, fd, vd, 0, 0, drop, drop);
}

lemma LiabilityDayAdvance(xs: seq<Reservation>, d1: int, d2: int)
  requires d1 <= d2
  requires forall g :: g in xs ==> g.actual >= 0 && g.maximum >= 0 && (g.settled ==> g.settledDay <= d1)
  ensures liabilityOf(xs, d2) <= liabilityOf(xs, d1)
{
  var f1 := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == d1)) then (t + g.actual) else (if bucketHolds(xs, g) then (t + g.maximum) else t));
  var v1 := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == d1)) then g.actual else (if bucketHolds(xs, g) then g.maximum else 0));
  var f2 := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == d2)) then (t + g.actual) else (if bucketHolds(xs, g) then (t + g.maximum) else t));
  var v2 := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == d2)) then g.actual else (if bucketHolds(xs, g) then g.maximum else 0));
  forall i | 0 <= i < |xs| ensures v2(xs[i]) <= v1(xs[i]) {
    assert xs[i] in xs;
  }
  SumFoldCompare(f2, v2, f1, v1, 0, 0, xs, xs);
}

lemma LiabilitySameShape(xs: seq<Reservation>, ys: seq<Reservation>, today: int)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==>
    xs[i].id == ys[i].id && xs[i].nonce == ys[i].nonce && xs[i].maximum == ys[i].maximum &&
    xs[i].state.Abandoned? == ys[i].state.Abandoned? && xs[i].settled == ys[i].settled &&
    xs[i].actual == ys[i].actual && xs[i].settledDay == ys[i].settledDay
  ensures liabilityOf(xs, today) == liabilityOf(ys, today)
{
  var fx := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(xs, g) then (t + g.maximum) else t));
  var fy := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(ys, g) then (t + g.maximum) else t));
  forall a, i | 0 <= i < |xs| ensures fx(a, xs[i]) == fy(a, ys[i]) {
    assert bucketHolds(xs, xs[i]) == bucketHolds(ys, ys[i]) by {
      if bucketHolds(xs, xs[i]) && !bucketHolds(ys, ys[i]) {
        var o :| o in ys && !o.state.Abandoned? && !o.settled && o.nonce == ys[i].nonce && !(o.maximum < ys[i].maximum || (o.maximum == ys[i].maximum && o.id >= ys[i].id));
        var k :| 0 <= k < |ys| && ys[k] == o;
        assert xs[k] in xs;
      }
      if !bucketHolds(xs, xs[i]) && bucketHolds(ys, ys[i]) {
        var o :| o in xs && !o.state.Abandoned? && !o.settled && o.nonce == xs[i].nonce && !(o.maximum < xs[i].maximum || (o.maximum == xs[i].maximum && o.id >= xs[i].id));
        var k :| 0 <= k < |xs| && xs[k] == o;
        assert ys[k] in ys;
      }
    }
  }
  ProofLib.FoldLeftPointwise(fx, fy, 0, xs, ys);
}

lemma BucketHoldsSettleOther(xs: seq<Reservation>, ys: seq<Reservation>, targetNonce: int, tx: int, actualNative: int, today: int)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==>
    if !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce then
      ys[i] == xs[i].(settled := true, actual := (if xs[i].tx == tx then actualNative else 0), settledDay := today)
    else
      ys[i] == xs[i]
  ensures forall i :: 0 <= i < |xs| && xs[i].nonce != targetNonce ==> bucketHolds(ys, ys[i]) == bucketHolds(xs, xs[i])
  ensures forall i :: 0 <= i < |xs| && !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce ==> !bucketHolds(ys, ys[i])
  ensures forall i :: 0 <= i < |xs| && (xs[i].state.Abandoned? || xs[i].settled) ==> !bucketHolds(xs, xs[i]) && !bucketHolds(ys, ys[i])
{
  hide *;
  reveal bucketHolds;
  forall i | 0 <= i < |xs| && xs[i].nonce != targetNonce ensures bucketHolds(ys, ys[i]) == bucketHolds(xs, xs[i]) {
    if bucketHolds(xs, xs[i]) && !bucketHolds(ys, ys[i]) {
      var o :| o in ys && !o.state.Abandoned? && !o.settled && o.nonce == ys[i].nonce && !(o.maximum < ys[i].maximum || (o.maximum == ys[i].maximum && o.id >= ys[i].id));
      var k :| 0 <= k < |ys| && ys[k] == o;
      assert xs[k] in xs && xs[k] == ys[k];
    }
    if !bucketHolds(xs, xs[i]) && bucketHolds(ys, ys[i]) {
      var o :| o in xs && !o.state.Abandoned? && !o.settled && o.nonce == xs[i].nonce && !(o.maximum < xs[i].maximum || (o.maximum == xs[i].maximum && o.id >= xs[i].id));
      var k :| 0 <= k < |xs| && xs[k] == o;
      assert ys[k] in ys && ys[k] == xs[k];
    }
  }
}

lemma SumFoldCompareExceptOne<T, U>(f1: (int, T) -> int, v1: T -> int, f2: (int, U) -> int, v2: U -> int, init1: int, init2: int, xs: seq<T>, ys: seq<U>, a: int)
  requires |xs| == |ys| && 0 <= a < |xs|
  requires forall acc, x :: f1(acc, x) == acc + v1(x)
  requires forall acc, y :: f2(acc, y) == acc + v2(y)
  requires forall i :: 0 <= i < |xs| && i != a ==> v1(xs[i]) <= v2(ys[i])
  requires init1 + v1(xs[a]) <= init2 + v2(ys[a])
  ensures Std.Collections.Seq.FoldLeft(f1, init1, xs) <= Std.Collections.Seq.FoldLeft(f2, init2, ys)
  decreases |xs|
{
  if a == 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    SumFoldCompare(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..]);
  } else {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    SumFoldCompareExceptOne(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..], a - 1);
  }
}

lemma SumFoldCompareExceptTwo<T, U>(f1: (int, T) -> int, v1: T -> int, f2: (int, U) -> int, v2: U -> int, init1: int, init2: int, xs: seq<T>, ys: seq<U>, a: int, b: int)
  requires |xs| == |ys| && 0 <= a < |xs| && 0 <= b < |xs| && a != b
  requires forall acc, x :: f1(acc, x) == acc + v1(x)
  requires forall acc, y :: f2(acc, y) == acc + v2(y)
  requires forall i :: 0 <= i < |xs| && i != a && i != b ==> v1(xs[i]) <= v2(ys[i])
  requires init1 + v1(xs[a]) + v1(xs[b]) <= init2 + v2(ys[a]) + v2(ys[b])
  ensures Std.Collections.Seq.FoldLeft(f1, init1, xs) <= Std.Collections.Seq.FoldLeft(f2, init2, ys)
  decreases |xs|
{
  assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
  if a == 0 {
    SumFoldCompareExceptOne(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..], b - 1);
  } else if b == 0 {
    SumFoldCompareExceptOne(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..], a - 1);
  } else {
    SumFoldCompareExceptTwo(f1, v1, f2, v2, init1 + v1(xs[0]), init2 + v2(ys[0]), xs[1..], ys[1..], a - 1, b - 1);
  }
}

lemma LiabilitySettleNonce(xs: seq<Reservation>, ys: seq<Reservation>, targetNonce: int, tx: int, actualNative: int, today: int)
  requires |xs| == |ys|
  requires actualNative >= 0
  requires actualNative > 0 ==> tx > 0
  requires ProofLib.DistinctBy(xs, (g: Reservation) => g.id)
  requires forall g :: g in xs ==> g.maximum > 0 && g.actual >= 0
  requires forall i, j :: 0 <= i < |xs| && 0 <= j < |xs| && i != j && xs[i].tx > 0 ==> xs[i].tx != xs[j].tx
  requires forall g :: g in xs && g.tx == tx && !g.state.Abandoned? && !g.settled ==> actualNative <= g.maximum
  requires forall i :: 0 <= i < |xs| ==>
    if !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce then
      ys[i] == xs[i].(settled := true, actual := (if xs[i].tx == tx then actualNative else 0), settledDay := today)
    else
      ys[i] == xs[i]
  ensures liabilityOf(ys, today) <= liabilityOf(xs, today)
{
  hide *;
  reveal liabilityOf;
  BucketHoldsSettleOther(xs, ys, targetNonce, tx, actualNative, today);
  var fx := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(xs, g) then (t + g.maximum) else t));
  var vx := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(xs, g) then g.maximum else 0));
  var fy := (t: int, g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then (t + g.actual) else (if bucketHolds(ys, g) then (t + g.maximum) else t));
  var vy := (g: Reservation) => (if (((!g.state.Abandoned?) && g.settled) && (g.settledDay == today)) then g.actual else (if bucketHolds(ys, g) then g.maximum else 0));
  if exists tIdx :: 0 <= tIdx < |xs| && !xs[tIdx].state.Abandoned? && !xs[tIdx].settled && xs[tIdx].nonce == targetNonce && xs[tIdx].tx == tx && actualNative > 0 {
    var tIdx :| 0 <= tIdx < |xs| && !xs[tIdx].state.Abandoned? && !xs[tIdx].settled && xs[tIdx].nonce == targetNonce && xs[tIdx].tx == tx && actualNative > 0;
    assert xs[tIdx] in xs;
    var w := BucketWinnerExists(xs, targetNonce);
    var wIdx :| 0 <= wIdx < |xs| && xs[wIdx] == w;
    assert actualNative <= xs[tIdx].maximum <= w.maximum;
    if tIdx == wIdx {
      forall i | 0 <= i < |xs| ensures vy(ys[i]) <= vx(xs[i]) {
        assert xs[i] in xs;
        if i == wIdx {
          assert vy(ys[i]) == actualNative <= w.maximum == vx(xs[i]);
        } else if !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce {
          assert xs[i].tx != tx;
          assert vy(ys[i]) == 0 <= vx(xs[i]);
        }
      }
      SumFoldCompare(fy, vy, fx, vx, 0, 0, ys, xs);
    } else {
      forall i | 0 <= i < |xs| && i != tIdx && i != wIdx ensures vy(ys[i]) <= vx(xs[i]) {
        assert xs[i] in xs;
        if !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce {
          assert xs[i].tx != tx;
          assert vy(ys[i]) == 0 <= vx(xs[i]);
        }
      }
      assert xs[tIdx] in xs && xs[wIdx] in xs;
      assert vy(ys[tIdx]) == actualNative;
      assert vy(ys[wIdx]) == 0;
      assert vx(xs[wIdx]) == w.maximum;
      assert vx(xs[tIdx]) >= 0;
      SumFoldCompareExceptTwo(fy, vy, fx, vx, 0, 0, ys, xs, tIdx, wIdx);
    }
  } else {
    forall i | 0 <= i < |xs| ensures vy(ys[i]) <= vx(xs[i]) {
      assert xs[i] in xs;
      if !xs[i].state.Abandoned? && !xs[i].settled && xs[i].nonce == targetNonce {
        assert vy(ys[i]) == 0 <= vx(xs[i]);
      }
    }
    SumFoldCompare(fy, vy, fx, vx, 0, 0, ys, xs);
  }
}

lemma PreserveSameCoreA(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network
  requires after.clock == before.clock
  requires after.holdings == before.holdings
  requires after.vaults == before.vaults
  requires after.rows == before.rows
  requires after.gas == before.gas
  requires after.overrun == before.overrun
  requires after.proofs == before.proofs
  requires after.runValue == before.runValue
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv;
  assert forall t :: holding(after, t) == holding(before, t) by { reveal holding; }
  assert forall t :: validToken(after, t) == validToken(before, t) by { reveal validToken; }
  assert forall t :: openAmount(after, t) == openAmount(before, t) by { reveal openAmount; }
  assert forall t :: openClaims(after, t) == openClaims(before, t) by { reveal openClaims; }
  assert forall t :: openRows(after, t) == openRows(before, t) by { reveal openRows; }
  assert forall t :: evaluated(after, t) == evaluated(before, t) by { reveal evaluated; }
  assert forall t :: finalizedOutput(after, t) == finalizedOutput(before, t) by { reveal finalizedOutput; }
  assert dayValue(after) == dayValue(before) by { reveal dayValue; }
  assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity; }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
  assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
  assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts; }
}

lemma PreserveSameCoreB(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network
  requires after.clock == before.clock
  requires after.rows == before.rows
  requires after.gas == before.gas
  requires after.overrun == before.overrun
  requires after.proofs == before.proofs
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv;
  assert forall r :: pendingIntent(after, r) == pendingIntent(before, r) by { reveal pendingIntent; }
  assert day(after) == day(before) by { reveal day; }
  assert journaledGas(after) == journaledGas(before) by { reveal journaledGas; }
  assert alwaysReservationsWithinTransaction(after) by { reveal alwaysReservationsWithinTransaction; }
  assert alwaysOpenSendHeld(after) by { reveal alwaysOpenSendHeld; }
  assert alwaysSignedRowsAttributed(after) by { reveal alwaysSignedRowsAttributed; }
  assert alwaysLiabilityWithinDay(after) by { reveal alwaysLiabilityWithinDay; }
  assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
  assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
  assert alwaysRowIdentity(after) by { reveal alwaysRowIdentity; }
  assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
  assert stepJournalAppendOnly(before, after) by { reveal stepJournalAppendOnly; }
}

lemma PreserveSameCore(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network
  requires after.clock == before.clock
  requires after.holdings == before.holdings
  requires after.vaults == before.vaults
  requires after.rows == before.rows
  requires after.gas == before.gas
  requires after.overrun == before.overrun
  requires after.proofs == before.proofs
  requires after.runValue == before.runValue
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  PreserveSameCoreA(before, after);
  PreserveSameCoreB(before, after);
}

lemma PreserveRowsAndGasUnchanged(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network
  requires after.clock == before.clock
  requires after.lease == before.lease
  requires after.nextRun == before.nextRun
  requires after.runValue == before.runValue
  requires after.rows == before.rows
  requires after.gas == before.gas
  requires after.overrun == before.overrun
  requires after.proofs == before.proofs
  requires after.scans == before.scans
  requires after.rotation == before.rotation
  requires after.runtime == before.runtime
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepEvidencePermanent(before, after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  PreserveSameCoreB(before, after);
  reveal inv;
  assert dayValue(after) == dayValue(before) by { reveal dayValue; }
  assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
}

lemma PreserveStepsOther(before: Fee, via: string, after: Fee)
  requires |after.gas| == |before.gas|
  requires via != "acquireLease" && via != "reserveGas" && via != "sign" && via != "replace" && via != "claim"
  requires via != "acquireRotationLease" && via != "renewRotationLease"
  ensures stepStaleRunCannotSign(before, via, after)
  ensures stepRotationBlocksRuns(before, via, after)
  ensures stepRotationOnlyWhenQuiet(before, via, after)
  ensures stepReplacementNeedsActivation(before, via, after)
  ensures stepSignaturesNeedLive(before, via, after)
{
  hide *;
  reveal stepStaleRunCannotSign, stepRotationBlocksRuns, stepRotationOnlyWhenQuiet, stepReplacementNeedsActivation, stepSignaturesNeedLive;
}

lemma PreserveRuntimeTransition(before: Fee, via: string, after: Fee)
  requires inv(before)
  requires after == before.(runtime := after.runtime)
  requires fees__runtime_inv(after.runtime)
  requires via != "acquireLease" && via != "reserveGas" && via != "sign" && via != "replace" && via != "claim"
  requires via != "acquireRotationLease" && via != "renewRotationLease"
  ensures inv(after)
  ensures stepStaleRunCannotSign(before, via, after)
  ensures stepRotationBlocksRuns(before, via, after)
  ensures stepRotationOnlyWhenQuiet(before, via, after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, via, after)
  ensures stepSignaturesNeedLive(before, via, after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  PreserveSameCore(before, after);
  PreserveStepsOther(before, via, after);
  reveal inv;
  assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound, fees__runtime_inv; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
}

lemma WithHoldingShape(f: Fee, token: int, h: Holding)
  requires alwaysHoldingsIdentity(f)
  requires validToken(f, token)
  requires h.token == token
  ensures var hs := withHolding(token, h, f);
    |hs| == |f.holdings| &&
    (forall i :: 0 <= i < |hs| ==> hs[i] == (if i == token - 1 then h else f.holdings[i])) &&
    (forall i :: 0 <= i < |hs| ==> hs[i].token == i + 1) &&
    Std.Collections.Seq.FoldLeft((i: int, x: Holding) => (if ((i >= 0) && (x.token == (i + 1))) then (i + 1) else -1), 0, hs) == |hs|
{
  hide *;
  reveal alwaysHoldingsIdentity, validToken, withHolding;
  HoldingsIdsEquiv(f.holdings, 0);
  var hs := withHolding(token, h, f);
  HoldingsIdsEquiv(hs, 0);
}

lemma FilterUpdateSamePred<T>(p: T -> bool, xs: seq<T>, k: int, x': T) returns (j: int)
  requires 0 <= k < |xs| && p(xs[k]) && p(x')
  ensures 0 <= j < |ProofLib.Filter(p, xs)|
  ensures ProofLib.Filter(p, xs)[j] == xs[k]
  ensures ProofLib.Filter(p, xs[k := x']) == ProofLib.Filter(p, xs)[j := x']
  decreases |xs|
{
  var ys := xs[k := x'];
  ProofLib.FilterCons(p, xs);
  ProofLib.FilterCons(p, ys);
  if k == 0 {
    assert ys[1..] == xs[1..];
    j := 0;
  } else {
    assert ys[0] == xs[0];
    assert ys[1..] == xs[1..][(k - 1) := x'];
    var sub := FilterUpdateSamePred(p, xs[1..], k - 1, x');
    if p(xs[0]) {
      j := sub + 1;
    } else {
      j := sub;
    }
  }
}

lemma GasDistinctById(f: Fee)
  requires alwaysRowIdentity(f)
  ensures forall i :: 0 <= i < |f.gas| ==> f.gas[i].id == i + 1
  ensures ProofLib.DistinctBy(f.gas, (g: Reservation) => g.id)
{
  hide *;
  reveal alwaysRowIdentity, ProofLib.DistinctBy;
  GasIdsEquiv(f.gas, 0);
}

lemma RowsPositional(f: Fee)
  requires alwaysRowIdentity(f)
  ensures forall i :: 0 <= i < |f.rows| ==> f.rows[i].id == i + 1
{
  hide *;
  reveal alwaysRowIdentity;
  RowsIdsEquiv(f.rows, 0);
}

lemma AbandonGasLiability(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==>
    after.gas[i] == before.gas[i] || (before.gas[i].state.Reserved? && after.gas[i] == before.gas[i].(state := GasState.Abandoned))
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv, alwaysLiabilityWithinDay;
  if !after.overrun {
    assert day(after) == day(before) by { reveal day; }
    JournaledGasDef(before);
    JournaledGasDef(after);
    var p := (g: Reservation) => !(g.imported);
    if exists k :: 0 <= k < |before.gas| && after.gas[k] != before.gas[k] {
      var k :| 0 <= k < |before.gas| && after.gas[k] != before.gas[k];
      GasDistinctById(before);
      assert forall i :: 0 <= i < |before.gas| && i != k ==> after.gas[i] == before.gas[i] by {
        reveal alwaysLeaseIdentity;
        forall i | 0 <= i < |before.gas| && i != k ensures after.gas[i] == before.gas[i] {
          if after.gas[i] != before.gas[i] {
            assert before.gas[i] in before.gas && before.gas[k] in before.gas;
            assert before.gas[i].id == before.gas[k].id;
          }
        }
      }
      assert after.gas == before.gas[k := before.gas[k].(state := GasState.Abandoned)];
      assert p(before.gas[k]) && !before.gas[k].settled by {
        reveal alwaysReservationsWithinTransaction;
        assert before.gas[k] in before.gas;
      }
      var j := FilterUpdateSamePred(p, before.gas, k, before.gas[k].(state := GasState.Abandoned));
      var jb := ProofLib.Filter(p, before.gas);
      ProofLib.FilterKeepsDistinctBy(p, before.gas, (g: Reservation) => g.id);
      ProofLib.FilterSubset(p, before.gas);
      assert forall g :: g in jb ==> g.maximum > 0 && g.actual >= 0 by {
        reveal alwaysReservationsWithinTransaction;
        forall g | g in jb ensures g.maximum > 0 && g.actual >= 0 {
          var idx :| 0 <= idx < |jb| && jb[idx] == g;
          assert g in before.gas;
        }
      }
      LiabilityAbandonOne(jb, j, day(before));
    } else {
      assert after.gas == before.gas;
    }
  }
}

lemma PreserveRowUpdateCore(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.network == before.network
  requires after.clock == before.clock
  requires after.lease == before.lease
  requires after.nextRun == before.nextRun
  requires after.runValue == before.runValue
  requires after.holdings == before.holdings
  requires after.vaults == before.vaults
  requires after.overrun == before.overrun
  requires after.proofs == before.proofs
  requires after.scans == before.scans
  requires after.rotation == before.rotation
  requires after.runtime == before.runtime
  requires 0 <= idx < |before.rows|
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id
  requires after.rows[idx].token == before.rows[idx].token
  requires after.rows[idx].kind == before.rows[idx].kind
  requires after.rows[idx].live == before.rows[idx].live
  requires after.rows[idx].runId == before.rows[idx].runId
  requires after.rows[idx].wallet == before.rows[idx].wallet
  requires after.rows[idx].amountIn == before.rows[idx].amountIn
  requires after.rows[idx].valueMicro == before.rows[idx].valueMicro
  requires after.rows[idx].nonce == before.rows[idx].nonce
  requires after.rows[idx].gasLimit == before.rows[idx].gasLimit
  requires after.rows[idx].attempts == before.rows[idx].attempts
  requires after.rows[idx].output == before.rows[idx].output
  requires after.rows[idx].createdAt == before.rows[idx].createdAt
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures stepEvidencePermanent(before, after)
{
  hide *;
  reveal inv;
  assert forall t :: holding(after, t) == holding(before, t) by { reveal holding; }
  assert forall t :: validToken(after, t) == validToken(before, t) by { reveal validToken; }
  assert forall t :: evaluated(after, t) == evaluated(before, t) by { reveal evaluated; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity;
    assert before.rows[idx] in before.rows;
  }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained;
    assert before.rows[idx] in before.rows;
  }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    assert before.rows[idx] in before.rows;
  }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
}

lemma RowUpdatePreservesReceipts(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.holdings == before.holdings
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires !before.rows[idx].state.Finalized? && !after.rows[idx].state.Finalized?
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv;
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures Std.Collections.Seq.FoldLeft((acc: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.output) else acc), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((acc: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.output) else acc), 0, before.rows) {
      var fc := (acc: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.output) else acc);
      ProofLib.FoldLeftPointwise(fc, fc, 0, after.rows, before.rows);
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures finalizedOutput(after, h.token) == finalizedOutput(before, h.token) &&
      Std.Collections.Seq.FoldLeft((acc: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.amountIn) else acc), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((acc: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.amountIn) else acc), 0, before.rows) {
      var fo := (acc: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.output) else acc);
      ProofLib.FoldLeftPointwise(fo, fo, 0, after.rows, before.rows);
      var fs := (acc: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (acc + r.amountIn) else acc);
      ProofLib.FoldLeftPointwise(fs, fs, 0, after.rows, before.rows);
    }
  }
}

lemma RowUpdateFoldsEqual(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.holdings == before.holdings && after.clock == before.clock && after.runValue == before.runValue
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires before.rows[idx].token == after.rows[idx].token
  requires before.rows[idx].kind == after.rows[idx].kind
  requires before.rows[idx].live == after.rows[idx].live
  requires before.rows[idx].amountIn == after.rows[idx].amountIn
  requires before.rows[idx].valueMicro == after.rows[idx].valueMicro
  requires before.rows[idx].createdAt == after.rows[idx].createdAt
  requires (before.rows[idx].state.Submitted? && after.rows[idx].state.Unknown?) || (before.rows[idx].state.Unknown? && after.rows[idx].state.Submitted?)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
  ensures forall r :: pendingIntent(after, r) == pendingIntent(before, r)
{
  hide *;
  reveal inv, isOpen;
  RowUpdatePreservesReceipts(before, after, idx);
  forall t ensures openAmount(after, t) == openAmount(before, t) {
    reveal openAmount;
    var f := (acc: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == t)) then (acc + r.amountIn) else acc);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall t ensures openClaims(after, t) == openClaims(before, t) {
    reveal openClaims;
    var f := (acc: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == t)) then (acc + r.amountIn) else acc);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall t ensures openRows(after, t) == openRows(before, t) {
    reveal openRows;
    var f := (acc: int, r: Row) => (if (isOpen(r) && (r.token == t)) then (acc + 1) else acc);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  assert dayValue(after) == dayValue(before) by {
    reveal dayValue;
    var f := (acc: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (acc + r.valueMicro) else acc);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall r ensures pendingIntent(after, r) == pendingIntent(before, r) {
    reveal pendingIntent;
    var f := (found: Row, x: Row) => (if ((x.state.Quoted? && x.live) && (x.runId == r)) then x else found);
    ProofLib.FoldLeftPointwise(f, f, noRow, after.rows, before.rows);
  }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
}

lemma RowCloseToFailedPreservesFolds(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.holdings == before.holdings && after.clock == before.clock && after.runValue == before.runValue
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires before.rows[idx].token == after.rows[idx].token
  requires before.rows[idx].kind == after.rows[idx].kind
  requires before.rows[idx].live == after.rows[idx].live
  requires before.rows[idx].amountIn == after.rows[idx].amountIn && before.rows[idx].amountIn > 0
  requires before.rows[idx].valueMicro == after.rows[idx].valueMicro && before.rows[idx].valueMicro >= 0
  requires before.rows[idx].createdAt == after.rows[idx].createdAt
  requires isOpen(before.rows[idx]) && after.rows[idx].state.Failed?
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, isOpen;
  RowUpdatePreservesReceipts(before, after, idx);
  forall t ensures openAmount(after, t) <= openAmount(before, t) {
    reveal openAmount;
    var f := (acc: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == t)) then (acc + r.amountIn) else acc);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == t)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  forall t ensures openClaims(after, t) <= openClaims(before, t) {
    reveal openClaims;
    var f := (acc: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == t)) then (acc + r.amountIn) else acc);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == t)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  forall t ensures openRows(after, t) <= openRows(before, t) {
    reveal openRows;
    var f := (acc: int, r: Row) => (if (isOpen(r) && (r.token == t)) then (acc + 1) else acc);
    var v := (r: Row) => (if (isOpen(r) && (r.token == t)) then 1 else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  assert dayValue(after) <= dayValue(before) by {
    reveal dayValue;
    var f := (acc: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (acc + r.valueMicro) else acc);
    var v := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then r.valueMicro else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
}

lemma RowUpdatePreservesRes(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock
  requires after.gas == before.gas
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].wallet == before.rows[idx].wallet
  requires after.rows[idx].nonce == before.rows[idx].nonce
  requires (after.rows[idx].state.Submitted? || after.rows[idx].state.Unknown?) ==> (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires forall g :: g in before.gas && g.state.Reserved? ==> pendingIntent(after, g.runId) == pendingIntent(before, g.runId)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, alwaysReservationsWithinTransaction;
  assert day(after) == day(before) by { reveal day; }
  forall i | 0 <= i < |after.rows| ensures after.rows[i].wallet == before.rows[i].wallet && ((after.rows[i].state.Submitted? || after.rows[i].state.Unknown?) ==> (before.rows[i].state.Submitted? || before.rows[i].state.Unknown?)) {}
}

lemma RowUpdatePreservesOpenAndSigned(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.gas == before.gas
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id
  requires after.rows[idx].nonce == before.rows[idx].nonce
  requires after.rows[idx].attempts == before.rows[idx].attempts
  requires (after.rows[idx].state.Submitted? || after.rows[idx].state.Unknown?) ==> (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall i | 0 <= i < |after.rows| ensures (after.rows[i].state.Submitted? || after.rows[i].state.Unknown?) ==> (before.rows[i].state.Submitted? || before.rows[i].state.Unknown?) && before.rows[i] in before.rows {}
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall g | g in before.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert after.rows[r.id - 1] in after.rows;
    }
  }
}

lemma RowUpdatePreservesRowId(before: Fee, after: Fee, idx: int)
  requires alwaysRowIdentity(before)
  requires after.gas == before.gas
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id
  requires after.rows[idx].amountIn == before.rows[idx].amountIn
  requires after.rows[idx].valueMicro == before.rows[idx].valueMicro
  requires !after.rows[idx].state.Quoted?
  requires after.rows[idx].reason.ExpiredUnlanded? ==> after.rows[idx].state.Failed?
  ensures alwaysRowIdentity(after)
{
  hide *;
  reveal alwaysRowIdentity;
  RowsIdsEquiv(before.rows, 0);
  assert before.rows[idx] in before.rows;
  RowsIdsEquiv(after.rows, 0);
}

lemma RowUpdatePreservesGasAndIds(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires after.lease == before.lease && after.nextRun == before.nextRun
  requires after.gas == before.gas && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id
  requires after.rows[idx].token == before.rows[idx].token
  requires after.rows[idx].kind == before.rows[idx].kind
  requires after.rows[idx].live == before.rows[idx].live
  requires after.rows[idx].runId == before.rows[idx].runId
  requires after.rows[idx].wallet == before.rows[idx].wallet
  requires after.rows[idx].amountIn == before.rows[idx].amountIn
  requires after.rows[idx].valueMicro == before.rows[idx].valueMicro
  requires after.rows[idx].nonce == before.rows[idx].nonce
  requires after.rows[idx].attempts == before.rows[idx].attempts
  requires !rowFrozen(before.rows[idx])
  requires !after.rows[idx].state.Quoted?
  requires after.rows[idx].reason.ExpiredUnlanded? ==> after.rows[idx].state.Failed? && !after.network.Solana?
  requires (after.rows[idx].state.Submitted? || after.rows[idx].state.Unknown?) ==> (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires forall g :: g in before.gas && g.state.Reserved? ==> pendingIntent(after, g.runId) == pendingIntent(before, g.runId)
  ensures alwaysLeaseIdentity(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  RowUpdatePreservesRes(before, after, idx);
  RowUpdatePreservesOpenAndSigned(before, after, idx);
  reveal inv;
  RowsPositional(before);
  assert day(after) == day(before) by { reveal day; }
  assert journaledGas(after) == journaledGas(before) by { reveal journaledGas; }
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity;
    assert before.rows[idx] in before.rows;
  }
  assert alwaysLiabilityWithinDay(after) by { reveal alwaysLiabilityWithinDay; }
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] in before.rows {}
  }
  RowUpdatePreservesRowId(before, after, idx);
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    assert before.rows[idx] in before.rows;
  }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly;
    forall i | 0 <= i < |before.rows| ensures after.rows[i] in after.rows {}
  }
}

lemma AbandonGasPreservesRes(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i].wallet == before.rows[i].wallet
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> (!after.gas[i].state.Reserved? && (after.gas[i] == before.gas[i] || (before.gas[i].state.Reserved? && after.gas[i] == before.gas[i].(state := GasState.Abandoned))))
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, alwaysReservationsWithinTransaction;
  assert day(after) == day(before) by { reveal day; }
  forall i | 0 <= i < |after.gas| ensures after.gas[i].state.Signed? ==> after.gas[i] == before.gas[i] {
    assert before.gas[i] in before.gas;
  }
}

lemma ReservedNotSettled(f: Fee)
  requires alwaysReservationsWithinTransaction(f)
  ensures forall g :: g in f.gas && g.state.Reserved? ==> !g.settled
{
  hide *;
  reveal alwaysReservationsWithinTransaction;
}

lemma AcquireLeasePreservesGasCore(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires after.rows == before.rows && after.proofs == before.proofs && after.scans == before.scans
  requires after.lease.holder == before.nextRun && after.nextRun == before.nextRun + 1 && !rotationHolds(before)
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i] == (if before.gas[i].state.Reserved? then before.gas[i].(state := GasState.Abandoned) else before.gas[i])
  ensures alwaysLeaseIdentity(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity;
    forall i | 0 <= i < |after.gas| ensures after.gas[i].runId > 0 && after.gas[i].runId < after.nextRun && !after.gas[i].state.Reserved? {
      assert before.gas[i] in before.gas;
    }
  }
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall g | g in before.gas && g.state.Signed? ensures g in after.gas {
      var i :| 0 <= i < |before.gas| && before.gas[i] == g;
      assert after.gas[i] == g;
    }
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall g | g in after.gas && g.state.Signed? ensures g in before.gas {
      var i :| 0 <= i < |after.gas| && after.gas[i] == g;
      assert before.gas[i] == g;
    }
  }
}

lemma AcquireLeasePreservesGasRowId(before: Fee, after: Fee)
  requires alwaysRowIdentity(before)
  requires after.rows == before.rows
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i].id == before.gas[i].id
  ensures alwaysRowIdentity(after)
{
  hide *;
  GasDistinctById(before);
  GasIdsEquiv(after.gas, 0);
  reveal alwaysRowIdentity;
  forall g | g in after.gas ensures g.id > 0 && (if 0 <= g.id - 1 < |after.gas| then after.gas[g.id - 1] else noGas).id == g.id {
    var i :| 0 <= i < |after.gas| && after.gas[i] == g;
    assert g.id == i + 1;
  }
}

lemma AcquireLeasePreservesGasAppendOnly(before: Fee, after: Fee)
  requires inv(before)
  requires after.rows == before.rows
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i] == (if before.gas[i].state.Reserved? then before.gas[i].(state := GasState.Abandoned) else before.gas[i])
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv;
  ReservedNotSettled(before);
  reveal stepJournalAppendOnly;
  forall i | 0 <= i < |before.gas| ensures after.gas[i] in after.gas {
    assert before.gas[i] in before.gas;
  }
}

lemma AcquireLeasePreservesGas(before: Fee, after: Fee)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires after.rows == before.rows && after.proofs == before.proofs && after.scans == before.scans
  requires after.lease.holder == before.nextRun && after.nextRun == before.nextRun + 1 && !rotationHolds(before)
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i] == (if before.gas[i].state.Reserved? then before.gas[i].(state := GasState.Abandoned) else before.gas[i])
  ensures alwaysLeaseIdentity(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysRowIdentity(after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  AbandonGasPreservesRes(before, after);
  AbandonGasLiability(before, after);
  AcquireLeasePreservesGasCore(before, after);
  assert alwaysRowIdentity(before) by { reveal inv; }
  AcquireLeasePreservesGasRowId(before, after);
  AcquireLeasePreservesGasAppendOnly(before, after);
}

lemma FailPrepPreservesOpenAndSigned(before: Fee, after: Fee, runId: int, idx: int)
  requires inv(before)
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires before.rows[idx].state.Quoted? && after.rows[idx] == before.rows[idx].(state := RowState.Failed, reason := Reason.PrepareFailed)
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i] == (if before.gas[i].state.Reserved? && before.gas[i].runId == runId then before.gas[i].(state := GasState.Abandoned) else before.gas[i])
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall g | g in before.gas && g.state.Signed? ensures g in after.gas {
      var i :| 0 <= i < |before.gas| && before.gas[i] == g;
      assert after.gas[i] == g;
    }
    forall i | 0 <= i < |after.rows| ensures (after.rows[i].state.Submitted? || after.rows[i].state.Unknown?) == (before.rows[i].state.Submitted? || before.rows[i].state.Unknown?) {}
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall g | g in after.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
      var gi :| 0 <= gi < |after.gas| && after.gas[gi] == g;
      assert before.gas[gi] == g;
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert after.rows[r.id - 1] in after.rows;
    }
  }
}

lemma RowIdentityFromPointwise(before: Fee, after: Fee)
  requires alwaysRowIdentity(before)
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| ==>
    after.rows[i].id == before.rows[i].id &&
    after.rows[i].amountIn > 0 &&
    after.rows[i].valueMicro >= 0 &&
    (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) &&
    (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?)
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i].id == before.gas[i].id
  ensures alwaysRowIdentity(after)
{
  hide *;
  RowsPositional(before);
  GasDistinctById(before);
  RowsIdsEquiv(after.rows, 0);
  GasIdsEquiv(after.gas, 0);
  reveal alwaysRowIdentity;
  forall r | r in after.rows ensures r.id > 0 && (if 0 <= (r.id - 1) < |after.rows| then (after.rows)[r.id - 1] else noRow) == r && r.amountIn > 0 && r.valueMicro >= 0 && (r.state.Quoted? ==> r.kind.Conversion? && |r.attempts| == 0) && (r.reason.ExpiredUnlanded? ==> r.state.Failed?) {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    assert r.id == i + 1;
  }
  forall g | g in after.gas ensures g.id > 0 && (if 0 <= (g.id - 1) < |after.gas| then (after.gas)[g.id - 1] else noGas).id == g.id {
    var i :| 0 <= i < |after.gas| && after.gas[i] == g;
    assert g.id == i + 1;
  }
}

lemma FailPrepPreservesRowId(before: Fee, after: Fee, runId: int, idx: int)
  requires alwaysRowIdentity(before)
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(state := RowState.Failed, reason := Reason.PrepareFailed)
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i].id == before.gas[i].id
  ensures alwaysRowIdentity(after)
{
  hide *;
  assert forall i :: 0 <= i < |before.rows| ==> before.rows[i] in before.rows;
  assert forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].amountIn > 0 && after.rows[i].valueMicro >= 0 && (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) && (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
  }
  RowIdentityFromPointwise(before, after);
}

lemma FailPrepPreservesGasAndIds(before: Fee, after: Fee, runId: int, idx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires after.lease == before.lease && after.nextRun == before.nextRun && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires after.rows[idx] == before.rows[idx].(state := RowState.Failed, reason := Reason.PrepareFailed)
  requires |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.gas| ==> after.gas[i] == (if before.gas[i].state.Reserved? && before.gas[i].runId == runId then before.gas[i].(state := GasState.Abandoned) else before.gas[i])
  ensures alwaysLeaseIdentity(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv;
  assert forall i :: 0 <= i < |after.gas| ==> !after.gas[i].state.Reserved? by {
    reveal alwaysLeaseIdentity, leaseHeld;
    forall i | 0 <= i < |before.gas| ensures !after.gas[i].state.Reserved? {
      assert before.gas[i] in before.gas;
    }
  }
  AbandonGasPreservesRes(before, after);
  AbandonGasLiability(before, after);
  ReservedNotSettled(before);
  RowsPositional(before);
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity;
    assert before.rows[idx] in before.rows;
    forall i | 0 <= i < |after.gas| ensures after.gas[i].runId == before.gas[i].runId {
      assert before.gas[i] in before.gas;
    }
  }
  FailPrepPreservesOpenAndSigned(before, after, runId, idx);
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] in before.rows {}
  }
  FailPrepPreservesRowId(before, after, runId, idx);
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    assert before.rows[idx] in before.rows;
  }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly, rowFrozen, settledState;
    forall i | 0 <= i < |before.rows| ensures after.rows[i] in after.rows {}
    forall i | 0 <= i < |before.gas| ensures after.gas[i] in after.gas {
      assert before.gas[i] in before.gas;
    }
  }
}

lemma RowAppendOpenFolds(before: Fee, after: Fee, row: Row, tok: int)
  requires after.rows == before.rows + [row]
  ensures openAmount(after, tok) == openAmount(before, tok) + (if isOpen(row) && row.kind.Conversion? && row.token == tok then row.amountIn else 0)
  ensures openClaims(after, tok) == openClaims(before, tok) + (if isOpen(row) && row.kind.Claim? && row.token == tok then row.amountIn else 0)
  ensures openRows(after, tok) == openRows(before, tok) + (if isOpen(row) && row.token == tok then 1 else 0)
{
  hide *;
  reveal openAmount, openClaims, openRows;
  ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then (t + r.amountIn) else t), 0, before.rows, row);
  ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then (t + r.amountIn) else t), 0, before.rows, row);
  ProofLib.FoldLeftAppend((t: int, r: Row) => (if (isOpen(r) && (r.token == tok)) then (t + 1) else t), 0, before.rows, row);
}

lemma EvaluateAppendPreservesFolds(before: Fee, after: Fee, runId: int, quote: Quote, row: Row)
  requires inv(before) && canEvaluate(before, runId, quote, fees__runtime_Sender.Worker)
  requires row == evaluationRow(before, runId, quote)
  requires after == before.(rows := (before.rows + [row]), runValue := (if (row.state.Quoted? && !(row.live)) then (before.runValue + row.valueMicro) else before.runValue))
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, canEvaluate, evaluationRow, outcomeOf, noRow;
  assert row.state.NoRoute? || row.state.Skipped? || row.state.DustPending? || row.state.Quoted?;
  assert row.state.Quoted? ==> row.valueMicro == quote.output && quote.output <= remaining(before);
  assert row.valueMicro >= 0 && row.amountIn > 0;
  OpenRowsZeroImpliesNone(before, quote.token);
  forall tok ensures openAmount(after, tok) == openAmount(before, tok) + (if isOpen(row) && row.token == tok then row.amountIn else 0) &&
    openClaims(after, tok) == openClaims(before, tok) &&
    openRows(after, tok) == openRows(before, tok) + (if isOpen(row) && row.token == tok then 1 else 0) {
    RowAppendOpenFolds(before, after, row, tok);
  }
  assert dayValue(after) == dayValue(before) by {
    reveal dayValue;
    ProofLib.FoldLeftAppend((t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t), 0, before.rows, row);
  }
  assert alwaysTopUpsNeverSold(after) by {
    reveal alwaysTopUpsNeverSold, spendable, perTransactionReserve, fees__runtime_transactionCeilingOf, alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
    var h := before.holdings[quote.token - 1];
    assert h in before.holdings && h.token == quote.token && holding(before, quote.token) == h;
    assert quote.amountIn <= h.balance && h.sold + quote.amountIn <= h.feeIncome;
  }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded, remaining; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in before.holdings ensures Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in before.holdings ensures finalizedOutput(after, h.token) == finalizedOutput(before, h.token) &&
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows, row);
    }
  }
}

lemma EvaluateAppendPreservesRes(before: Fee, after: Fee, runId: int, quote: Quote, row: Row)
  requires inv(before) && canEvaluate(before, runId, quote, fees__runtime_Sender.Worker)
  requires row == evaluationRow(before, runId, quote)
  requires after == before.(rows := (before.rows + [row]), runValue := (if (row.state.Quoted? && !(row.live)) then (before.runValue + row.valueMicro) else before.runValue))
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, canEvaluate, alwaysReservationsWithinTransaction;
  assert day(after) == day(before) by { reveal day; }
  assert forall g :: g in before.gas ==> !g.state.Reserved? by {
    reveal alwaysLeaseIdentity, leaseHeld;
    forall g | g in before.gas ensures !g.state.Reserved? {
      if g.state.Reserved? {
        assert g.runId == before.lease.holder == runId;
        assert pendingIntent(before, runId).id > 0;
      }
    }
  }
  RowsPositional(before);
  assert forall g :: g in before.gas && g.state.Signed? ==> 0 <= g.row - 1 < |before.rows| && after.rows[g.row - 1] == before.rows[g.row - 1] by {
    reveal alwaysSignedRowsAttributed;
    forall g | g in before.gas && g.state.Signed? ensures 0 <= g.row - 1 < |before.rows| && after.rows[g.row - 1] == before.rows[g.row - 1] {
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert r.id == g.row && 0 <= r.id - 1 < |before.rows|;
    }
  }
}

lemma EvaluateAppendPreservesRest(before: Fee, after: Fee, runId: int, quote: Quote, row: Row)
  requires inv(before) && canEvaluate(before, runId, quote, fees__runtime_Sender.Worker)
  requires row == evaluationRow(before, runId, quote)
  requires after == before.(rows := (before.rows + [row]), runValue := (if (row.state.Quoted? && !(row.live)) then (before.runValue + row.valueMicro) else before.runValue))
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysReservationsWithinTransaction(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepEvidencePermanent(before, after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  EvaluateAppendPreservesRes(before, after, runId, quote, row);
  reveal inv, canEvaluate, evaluationRow, outcomeOf, noRow;
  assert row.state.NoRoute? || row.state.Skipped? || row.state.DustPending? || row.state.Quoted?;
  assert row.valueMicro >= 0 && row.amountIn > 0 && !row.reason.ExpiredUnlanded?;
  assert day(after) == day(before) by { reveal day; }
  assert journaledGas(after) == journaledGas(before) by { reveal journaledGas; }
  assert forall t :: holding(after, t) == holding(before, t) by { reveal holding; }
  assert forall t :: validToken(after, t) == validToken(before, t) by { reveal validToken; }
  assert forall t :: evaluated(after, t) == evaluated(before, t) by { reveal evaluated; }
  assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity, leaseHeld; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity; }
  assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained; }
  assert alwaysOpenSendHeld(after) by { reveal alwaysOpenSendHeld; }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall r | r in before.rows ensures r in after.rows {}
  }
  assert alwaysLiabilityWithinDay(after) by { reveal alwaysLiabilityWithinDay; }
  assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
  assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
  assert alwaysRowIdentity(after) by {
    reveal alwaysRowIdentity;
    RowsIdsEquiv(before.rows, 0);
    RowsIdsEquiv(after.rows, 0);
  }
  assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly;
    forall r | r in before.rows ensures r in after.rows {}
  }
}

lemma publishWorker_ensures(f: Fee, config: fees__runtime_WorkerConfig, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysLeaseIdentity(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysRotationOnlyOnSolana(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysRotationExcludesRuns(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysRuntimeSound(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysHoldingsIdentity(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysTopUpsNeverSold(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysAccrualFromVault(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysRunValueBounded(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysNotConvertedRetained(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysOpenSendHeld(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysSignedRowsAttributed(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysLiabilityWithinDay(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysReservationsWithinTransaction(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysOneOpenSend(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysClaimsFromReceipts(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysOutputFromReceipts(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysExpiryProven(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysAttemptsKeepContent(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysDryRowsNeverSign(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> alwaysRowIdentity(publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepStaleRunCannotSign(f, "publishWorker", publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepRotationBlocksRuns(f, "publishWorker", publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepRotationOnlyWhenQuiet(f, "publishWorker", publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepEvidencePermanent(f, publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepReplacementNeedsActivation(f, "publishWorker", publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepSignaturesNeedLive(f, "publishWorker", publishWorker(f, config, by_)))
  ensures (inv(f) ==> canPublishWorker(f, config, by_) ==> stepJournalAppendOnly(f, publishWorker(f, config, by_)))
{
  hide *;
  if inv(f) && canPublishWorker(f, config, by_) {
    reveal inv, alwaysRuntimeSound, fees__runtime_inv, canPublishWorker, publishWorker;
    var after := publishWorker(f, config, by_);
    fees__runtime_publish_ensures(f.runtime, config, by_);
    PreserveRuntimeTransition(f, "publishWorker", after);
  }
}

lemma setReleaseVariable_ensures(f: Fee, variable: bool, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysLeaseIdentity(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysRotationOnlyOnSolana(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysRotationExcludesRuns(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysRuntimeSound(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysHoldingsIdentity(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysTopUpsNeverSold(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysAccrualFromVault(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysRunValueBounded(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysNotConvertedRetained(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysOpenSendHeld(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysSignedRowsAttributed(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysLiabilityWithinDay(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysReservationsWithinTransaction(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysOneOpenSend(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysClaimsFromReceipts(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysOutputFromReceipts(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysExpiryProven(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysAttemptsKeepContent(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysDryRowsNeverSign(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> alwaysRowIdentity(setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepStaleRunCannotSign(f, "setReleaseVariable", setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepRotationBlocksRuns(f, "setReleaseVariable", setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepRotationOnlyWhenQuiet(f, "setReleaseVariable", setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepEvidencePermanent(f, setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepReplacementNeedsActivation(f, "setReleaseVariable", setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepSignaturesNeedLive(f, "setReleaseVariable", setReleaseVariable(f, variable, by_)))
  ensures (inv(f) ==> canSetReleaseVariable(f, variable, by_) ==> stepJournalAppendOnly(f, setReleaseVariable(f, variable, by_)))
{
  hide *;
  if inv(f) && canSetReleaseVariable(f, variable, by_) {
    reveal inv, alwaysRuntimeSound, fees__runtime_inv, canSetReleaseVariable, setReleaseVariable;
    var after := setReleaseVariable(f, variable, by_);
    fees__runtime_setReleaseVariable_ensures(f.runtime, variable, by_);
    PreserveRuntimeTransition(f, "setReleaseVariable", after);
  }
}

lemma verifyReadiness_ensures(f: Fee, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysLeaseIdentity(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysRotationOnlyOnSolana(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysRotationExcludesRuns(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysRuntimeSound(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysHoldingsIdentity(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysTopUpsNeverSold(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysAccrualFromVault(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysRunValueBounded(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysNotConvertedRetained(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysOpenSendHeld(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysSignedRowsAttributed(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysLiabilityWithinDay(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysReservationsWithinTransaction(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysOneOpenSend(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysClaimsFromReceipts(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysOutputFromReceipts(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysExpiryProven(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysAttemptsKeepContent(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysDryRowsNeverSign(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> alwaysRowIdentity(verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepStaleRunCannotSign(f, "verifyReadiness", verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepRotationBlocksRuns(f, "verifyReadiness", verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepRotationOnlyWhenQuiet(f, "verifyReadiness", verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepEvidencePermanent(f, verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepReplacementNeedsActivation(f, "verifyReadiness", verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepSignaturesNeedLive(f, "verifyReadiness", verifyReadiness(f, by_)))
  ensures (inv(f) ==> canVerifyReadiness(f, by_) ==> stepJournalAppendOnly(f, verifyReadiness(f, by_)))
{
  hide *;
  if inv(f) && canVerifyReadiness(f, by_) {
    reveal inv, alwaysRuntimeSound, fees__runtime_inv, canVerifyReadiness, verifyReadiness;
    var after := verifyReadiness(f, by_);
    fees__runtime_verifyReadiness_ensures(f.runtime, f.network, by_);
    PreserveRuntimeTransition(f, "verifyReadiness", after);
  }
}

lemma withdrawReadiness_ensures(f: Fee, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysLeaseIdentity(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysRotationOnlyOnSolana(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysRotationExcludesRuns(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysRuntimeSound(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysHoldingsIdentity(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysTopUpsNeverSold(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysAccrualFromVault(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysRunValueBounded(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysNotConvertedRetained(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysOpenSendHeld(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysSignedRowsAttributed(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysLiabilityWithinDay(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysReservationsWithinTransaction(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysOneOpenSend(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysClaimsFromReceipts(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysOutputFromReceipts(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysExpiryProven(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysAttemptsKeepContent(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysDryRowsNeverSign(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> alwaysRowIdentity(withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepStaleRunCannotSign(f, "withdrawReadiness", withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepRotationBlocksRuns(f, "withdrawReadiness", withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepRotationOnlyWhenQuiet(f, "withdrawReadiness", withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepEvidencePermanent(f, withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepReplacementNeedsActivation(f, "withdrawReadiness", withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepSignaturesNeedLive(f, "withdrawReadiness", withdrawReadiness(f, by_)))
  ensures (inv(f) ==> canWithdrawReadiness(f, by_) ==> stepJournalAppendOnly(f, withdrawReadiness(f, by_)))
{
  hide *;
  if inv(f) && canWithdrawReadiness(f, by_) {
    reveal inv, alwaysRuntimeSound, fees__runtime_inv, canWithdrawReadiness, withdrawReadiness;
    var after := withdrawReadiness(f, by_);
    fees__runtime_withdrawReadiness_ensures(f.runtime, f.network, by_);
    PreserveRuntimeTransition(f, "withdrawReadiness", after);
  }
}

lemma setReplacement_ensures(f: Fee, active: bool, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysLeaseIdentity(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysRotationOnlyOnSolana(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysRotationExcludesRuns(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysRuntimeSound(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysHoldingsIdentity(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysTopUpsNeverSold(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysAccrualFromVault(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysRunValueBounded(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysNotConvertedRetained(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysOpenSendHeld(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysSignedRowsAttributed(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysLiabilityWithinDay(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysReservationsWithinTransaction(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysOneOpenSend(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysClaimsFromReceipts(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysOutputFromReceipts(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysExpiryProven(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysAttemptsKeepContent(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysDryRowsNeverSign(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> alwaysRowIdentity(setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepStaleRunCannotSign(f, "setReplacement", setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepRotationBlocksRuns(f, "setReplacement", setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepRotationOnlyWhenQuiet(f, "setReplacement", setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepEvidencePermanent(f, setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepReplacementNeedsActivation(f, "setReplacement", setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepSignaturesNeedLive(f, "setReplacement", setReplacement(f, active, by_)))
  ensures (inv(f) ==> canSetReplacement(f, active, by_) ==> stepJournalAppendOnly(f, setReplacement(f, active, by_)))
{
  hide *;
  if inv(f) && canSetReplacement(f, active, by_) {
    reveal inv, alwaysRuntimeSound, fees__runtime_inv, canSetReplacement, setReplacement;
    var after := setReplacement(f, active, by_);
    fees__runtime_setReplacement_ensures(f.runtime, active, by_);
    PreserveRuntimeTransition(f, "setReplacement", after);
  }
}

lemma chooseInstance_ensures(f: Fee, network: fees__runtime_Network, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysLeaseIdentity(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysRotationOnlyOnSolana(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysRotationExcludesRuns(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysRuntimeSound(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysHoldingsIdentity(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysTopUpsNeverSold(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysAccrualFromVault(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysRunValueBounded(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysNotConvertedRetained(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysOpenSendHeld(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysSignedRowsAttributed(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysLiabilityWithinDay(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysReservationsWithinTransaction(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysOneOpenSend(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysClaimsFromReceipts(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysOutputFromReceipts(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysExpiryProven(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysAttemptsKeepContent(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysDryRowsNeverSign(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> alwaysRowIdentity(chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepStaleRunCannotSign(f, "chooseInstance", chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepRotationBlocksRuns(f, "chooseInstance", chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepRotationOnlyWhenQuiet(f, "chooseInstance", chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepEvidencePermanent(f, chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepReplacementNeedsActivation(f, "chooseInstance", chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepSignaturesNeedLive(f, "chooseInstance", chooseInstance(f, network, by_)))
  ensures (inv(f) ==> canChooseInstance(f, network, by_) ==> stepJournalAppendOnly(f, chooseInstance(f, network, by_)))
{
  hide *;
  if inv(f) && canChooseInstance(f, network, by_) {
    reveal inv, canChooseInstance, chooseInstance;
    var after := chooseInstance(f, network, by_);
    assert |f.gas| == 0 by {
      reveal alwaysLeaseIdentity;
      if |f.gas| > 0 { assert f.gas[0] in f.gas; }
    }
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
    assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded, dayValue; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained; }
    assert alwaysReservationsWithinTransaction(after) by { reveal alwaysReservationsWithinTransaction; }
    assert alwaysOpenSendHeld(after) by { reveal alwaysOpenSendHeld; }
    assert alwaysSignedRowsAttributed(after) by { reveal alwaysSignedRowsAttributed; }
    assert alwaysLiabilityWithinDay(after) by {
      reveal alwaysLiabilityWithinDay, liabilityOf, fees__runtime_dailyCeilingOf, Std.Collections.Seq.FoldLeft;
      JournaledGasDef(after);
      ProofLib.FilterNil((g: Reservation) => !(g.imported), after.gas);
    }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts; }
    assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
    assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
    assert alwaysRowIdentity(after) by { reveal alwaysRowIdentity; }
    assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
    PreserveStepsOther(f, "chooseInstance", after);
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepJournalAppendOnly(f, after) by { reveal stepJournalAppendOnly; }
  }
}

lemma advanceClock_ensures(f: Fee, elapsed: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysLeaseIdentity(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysRotationOnlyOnSolana(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysRotationExcludesRuns(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysRuntimeSound(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysHoldingsIdentity(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysTopUpsNeverSold(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysAccrualFromVault(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysRunValueBounded(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysNotConvertedRetained(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysOpenSendHeld(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysSignedRowsAttributed(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysLiabilityWithinDay(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysReservationsWithinTransaction(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysOneOpenSend(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysClaimsFromReceipts(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysOutputFromReceipts(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysExpiryProven(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysAttemptsKeepContent(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysDryRowsNeverSign(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> alwaysRowIdentity(advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepStaleRunCannotSign(f, "advanceClock", advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepRotationBlocksRuns(f, "advanceClock", advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepRotationOnlyWhenQuiet(f, "advanceClock", advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepEvidencePermanent(f, advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepReplacementNeedsActivation(f, "advanceClock", advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepSignaturesNeedLive(f, "advanceClock", advanceClock(f, elapsed, by_)))
  ensures (inv(f) ==> canAdvanceClock(f, elapsed, by_) ==> stepJournalAppendOnly(f, advanceClock(f, elapsed, by_)))
{
  hide *;
  if inv(f) && canAdvanceClock(f, elapsed, by_) {
    reveal inv, canAdvanceClock, advanceClock;
    var after := advanceClock(f, elapsed, by_);
    assert f.clock >= 0 by { reveal alwaysLeaseIdentity; }
    DayMonotone(f.clock, after.clock);
    assert day(f) <= day(after) by { reveal day; }
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysRunValueBounded(after) by {
      reveal alwaysRunValueBounded, dayValue, alwaysRowIdentity;
      var f1 := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (after.clock - dayMs))) then (t + r.valueMicro) else t);
      var v1 := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (after.clock - dayMs))) then r.valueMicro else 0);
      var f2 := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (f.clock - dayMs))) then (t + r.valueMicro) else t);
      var v2 := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (f.clock - dayMs))) then r.valueMicro else 0);
      forall i | 0 <= i < |f.rows| ensures v1(f.rows[i]) <= v2(f.rows[i]) {
        assert f.rows[i] in f.rows;
      }
      SumFoldCompare(f1, v1, f2, v2, 0, 0, f.rows, f.rows);
    }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysReservationsWithinTransaction(after) by { reveal alwaysReservationsWithinTransaction, pendingIntent; }
    assert alwaysOpenSendHeld(after) by { reveal alwaysOpenSendHeld; }
    assert alwaysSignedRowsAttributed(after) by { reveal alwaysSignedRowsAttributed; }
    assert alwaysLiabilityWithinDay(after) by {
      reveal alwaysLiabilityWithinDay, alwaysReservationsWithinTransaction;
      JournaledGasDef(f);
      JournaledGasDef(after);
      var jg := ProofLib.Filter((g: Reservation) => !(g.imported), f.gas);
      ProofLib.FilterSubset((g: Reservation) => !(g.imported), f.gas);
      forall g | g in jg ensures g.actual >= 0 && g.maximum >= 0 && (g.settled ==> g.settledDay <= day(f)) {
        var i :| 0 <= i < |jg| && jg[i] == g;
        assert g in f.gas;
      }
      LiabilityDayAdvance(jg, day(f), day(after));
    }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
    assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
    assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
    assert alwaysRowIdentity(after) by { reveal alwaysRowIdentity; }
    assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
    PreserveStepsOther(f, "advanceClock", after);
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepJournalAppendOnly(f, after) by { reveal stepJournalAppendOnly; }
  }
}

lemma renewLease_ensures(f: Fee, runId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysLeaseIdentity(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysRotationOnlyOnSolana(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysRotationExcludesRuns(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysRuntimeSound(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysHoldingsIdentity(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysTopUpsNeverSold(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysAccrualFromVault(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysRunValueBounded(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysNotConvertedRetained(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysOpenSendHeld(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysSignedRowsAttributed(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysLiabilityWithinDay(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysReservationsWithinTransaction(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysOneOpenSend(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysClaimsFromReceipts(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysOutputFromReceipts(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysExpiryProven(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysAttemptsKeepContent(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysDryRowsNeverSign(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> alwaysRowIdentity(renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepStaleRunCannotSign(f, "renewLease", renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepRotationBlocksRuns(f, "renewLease", renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepRotationOnlyWhenQuiet(f, "renewLease", renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepEvidencePermanent(f, renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepReplacementNeedsActivation(f, "renewLease", renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepSignaturesNeedLive(f, "renewLease", renewLease(f, runId, by_)))
  ensures (inv(f) ==> canRenewLease(f, runId, by_) ==> stepJournalAppendOnly(f, renewLease(f, runId, by_)))
{
  hide *;
  if inv(f) && canRenewLease(f, runId, by_) {
    reveal inv, canRenewLease, renewLease;
    var after := renewLease(f, runId, by_);
    PreserveSameCore(f, after);
    PreserveStepsOther(f, "renewLease", after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity, leaseHeld; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds, leaseHeld; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
  }
}

lemma releaseLease_ensures(f: Fee, runId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysLeaseIdentity(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysRotationOnlyOnSolana(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysRotationExcludesRuns(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysRuntimeSound(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysHoldingsIdentity(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysTopUpsNeverSold(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysAccrualFromVault(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysRunValueBounded(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysNotConvertedRetained(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysOpenSendHeld(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysSignedRowsAttributed(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysLiabilityWithinDay(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysReservationsWithinTransaction(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysOneOpenSend(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysClaimsFromReceipts(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysOutputFromReceipts(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysExpiryProven(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysAttemptsKeepContent(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysDryRowsNeverSign(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> alwaysRowIdentity(releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepStaleRunCannotSign(f, "releaseLease", releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepRotationBlocksRuns(f, "releaseLease", releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepRotationOnlyWhenQuiet(f, "releaseLease", releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepEvidencePermanent(f, releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepReplacementNeedsActivation(f, "releaseLease", releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepSignaturesNeedLive(f, "releaseLease", releaseLease(f, runId, by_)))
  ensures (inv(f) ==> canReleaseLease(f, runId, by_) ==> stepJournalAppendOnly(f, releaseLease(f, runId, by_)))
{
  hide *;
  if inv(f) && canReleaseLease(f, runId, by_) {
    reveal inv, canReleaseLease, releaseLease;
    var after := releaseLease(f, runId, by_);
    PreserveSameCore(f, after);
    PreserveStepsOther(f, "releaseLease", after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
  }
}

lemma acquireRotationLease_ensures(f: Fee, rotationId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysLeaseIdentity(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysRotationOnlyOnSolana(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysRotationExcludesRuns(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysRuntimeSound(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysHoldingsIdentity(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysTopUpsNeverSold(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysAccrualFromVault(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysRunValueBounded(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysNotConvertedRetained(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysOpenSendHeld(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysSignedRowsAttributed(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysLiabilityWithinDay(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysReservationsWithinTransaction(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysOneOpenSend(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysClaimsFromReceipts(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysOutputFromReceipts(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysExpiryProven(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysAttemptsKeepContent(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysDryRowsNeverSign(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> alwaysRowIdentity(acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepStaleRunCannotSign(f, "acquireRotationLease", acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepRotationBlocksRuns(f, "acquireRotationLease", acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepRotationOnlyWhenQuiet(f, "acquireRotationLease", acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepEvidencePermanent(f, acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepReplacementNeedsActivation(f, "acquireRotationLease", acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepSignaturesNeedLive(f, "acquireRotationLease", acquireRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canAcquireRotationLease(f, rotationId, by_) ==> stepJournalAppendOnly(f, acquireRotationLease(f, rotationId, by_)))
{
  hide *;
  if inv(f) && canAcquireRotationLease(f, rotationId, by_) {
    reveal inv, canAcquireRotationLease, acquireRotationLease;
    var after := acquireRotationLease(f, rotationId, by_);
    PreserveSameCore(f, after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepStaleRunCannotSign(f, "acquireRotationLease", after) by { reveal stepStaleRunCannotSign; }
    assert stepRotationBlocksRuns(f, "acquireRotationLease", after) by { reveal stepRotationBlocksRuns; }
    assert stepRotationOnlyWhenQuiet(f, "acquireRotationLease", after) by { reveal stepRotationOnlyWhenQuiet; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepReplacementNeedsActivation(f, "acquireRotationLease", after) by { reveal stepReplacementNeedsActivation; }
    assert stepSignaturesNeedLive(f, "acquireRotationLease", after) by { reveal stepSignaturesNeedLive; }
  }
}

lemma renewRotationLease_ensures(f: Fee, rotationId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysLeaseIdentity(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysRotationOnlyOnSolana(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysRotationExcludesRuns(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysRuntimeSound(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysHoldingsIdentity(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysTopUpsNeverSold(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysAccrualFromVault(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysRunValueBounded(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysNotConvertedRetained(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysOpenSendHeld(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysSignedRowsAttributed(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysLiabilityWithinDay(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysReservationsWithinTransaction(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysOneOpenSend(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysClaimsFromReceipts(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysOutputFromReceipts(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysExpiryProven(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysAttemptsKeepContent(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysDryRowsNeverSign(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> alwaysRowIdentity(renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepStaleRunCannotSign(f, "renewRotationLease", renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepRotationBlocksRuns(f, "renewRotationLease", renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepRotationOnlyWhenQuiet(f, "renewRotationLease", renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepEvidencePermanent(f, renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepReplacementNeedsActivation(f, "renewRotationLease", renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepSignaturesNeedLive(f, "renewRotationLease", renewRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canRenewRotationLease(f, rotationId, by_) ==> stepJournalAppendOnly(f, renewRotationLease(f, rotationId, by_)))
{
  hide *;
  if inv(f) && canRenewRotationLease(f, rotationId, by_) {
    reveal inv, canRenewRotationLease, renewRotationLease;
    var after := renewRotationLease(f, rotationId, by_);
    PreserveSameCore(f, after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepStaleRunCannotSign(f, "renewRotationLease", after) by { reveal stepStaleRunCannotSign; }
    assert stepRotationBlocksRuns(f, "renewRotationLease", after) by { reveal stepRotationBlocksRuns; }
    assert stepRotationOnlyWhenQuiet(f, "renewRotationLease", after) by { reveal stepRotationOnlyWhenQuiet; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepReplacementNeedsActivation(f, "renewRotationLease", after) by { reveal stepReplacementNeedsActivation; }
    assert stepSignaturesNeedLive(f, "renewRotationLease", after) by { reveal stepSignaturesNeedLive; }
  }
}

lemma releaseRotationLease_ensures(f: Fee, rotationId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysLeaseIdentity(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysRotationOnlyOnSolana(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysRotationExcludesRuns(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysRuntimeSound(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysHoldingsIdentity(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysTopUpsNeverSold(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysAccrualFromVault(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysRunValueBounded(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysNotConvertedRetained(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysOpenSendHeld(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysSignedRowsAttributed(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysLiabilityWithinDay(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysReservationsWithinTransaction(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysOneOpenSend(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysClaimsFromReceipts(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysOutputFromReceipts(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysExpiryProven(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysAttemptsKeepContent(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysDryRowsNeverSign(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> alwaysRowIdentity(releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepStaleRunCannotSign(f, "releaseRotationLease", releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepRotationBlocksRuns(f, "releaseRotationLease", releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepRotationOnlyWhenQuiet(f, "releaseRotationLease", releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepEvidencePermanent(f, releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepReplacementNeedsActivation(f, "releaseRotationLease", releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepSignaturesNeedLive(f, "releaseRotationLease", releaseRotationLease(f, rotationId, by_)))
  ensures (inv(f) ==> canReleaseRotationLease(f, rotationId, by_) ==> stepJournalAppendOnly(f, releaseRotationLease(f, rotationId, by_)))
{
  hide *;
  if inv(f) && canReleaseRotationLease(f, rotationId, by_) {
    reveal inv, canReleaseRotationLease, releaseRotationLease;
    var after := releaseRotationLease(f, rotationId, by_);
    PreserveSameCore(f, after);
    PreserveStepsOther(f, "releaseRotationLease", after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
  }
}

lemma recordScan_ensures(f: Fee, runId: int, scan: ExpiryScan, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysLeaseIdentity(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysRotationOnlyOnSolana(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysRotationExcludesRuns(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysRuntimeSound(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysHoldingsIdentity(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysTopUpsNeverSold(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysAccrualFromVault(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysRunValueBounded(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysNotConvertedRetained(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysOpenSendHeld(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysSignedRowsAttributed(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysLiabilityWithinDay(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysReservationsWithinTransaction(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysOneOpenSend(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysClaimsFromReceipts(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysOutputFromReceipts(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysExpiryProven(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysAttemptsKeepContent(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysDryRowsNeverSign(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> alwaysRowIdentity(recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepStaleRunCannotSign(f, "recordScan", recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepRotationBlocksRuns(f, "recordScan", recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepRotationOnlyWhenQuiet(f, "recordScan", recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepEvidencePermanent(f, recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepReplacementNeedsActivation(f, "recordScan", recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepSignaturesNeedLive(f, "recordScan", recordScan(f, runId, scan, by_)))
  ensures (inv(f) ==> canRecordScan(f, runId, scan, by_) ==> stepJournalAppendOnly(f, recordScan(f, runId, scan, by_)))
{
  hide *;
  if inv(f) && canRecordScan(f, runId, scan, by_) {
    reveal inv, canRecordScan, recordScan;
    var after := recordScan(f, runId, scan, by_);
    PreserveSameCore(f, after);
    PreserveStepsOther(f, "recordScan", after);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
  }
}

lemma registerVault_ensures(f: Fee, reviewed: ReviewedVault, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysLeaseIdentity(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysRotationOnlyOnSolana(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysRotationExcludesRuns(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysRuntimeSound(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysHoldingsIdentity(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysTopUpsNeverSold(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysAccrualFromVault(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysRunValueBounded(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysNotConvertedRetained(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysOpenSendHeld(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysSignedRowsAttributed(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysLiabilityWithinDay(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysReservationsWithinTransaction(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysOneOpenSend(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysClaimsFromReceipts(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysOutputFromReceipts(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysExpiryProven(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysAttemptsKeepContent(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysDryRowsNeverSign(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> alwaysRowIdentity(registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepStaleRunCannotSign(f, "registerVault", registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepRotationBlocksRuns(f, "registerVault", registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepRotationOnlyWhenQuiet(f, "registerVault", registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepEvidencePermanent(f, registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepReplacementNeedsActivation(f, "registerVault", registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepSignaturesNeedLive(f, "registerVault", registerVault(f, reviewed, by_)))
  ensures (inv(f) ==> canRegisterVault(f, reviewed, by_) ==> stepJournalAppendOnly(f, registerVault(f, reviewed, by_)))
{
  hide *;
  if inv(f) && canRegisterVault(f, reviewed, by_) {
    reveal inv, canRegisterVault, registerVault;
    var after := registerVault(f, reviewed, by_);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "registerVault", after);
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
  }
}

lemma addToken_ensures(f: Fee, asset: HoldingKind, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysLeaseIdentity(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysRotationOnlyOnSolana(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysRotationExcludesRuns(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysRuntimeSound(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysHoldingsIdentity(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysTopUpsNeverSold(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysAccrualFromVault(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysRunValueBounded(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysNotConvertedRetained(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysOpenSendHeld(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysSignedRowsAttributed(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysLiabilityWithinDay(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysReservationsWithinTransaction(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysOneOpenSend(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysClaimsFromReceipts(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysOutputFromReceipts(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysExpiryProven(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysAttemptsKeepContent(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysDryRowsNeverSign(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> alwaysRowIdentity(addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepStaleRunCannotSign(f, "addToken", addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepRotationBlocksRuns(f, "addToken", addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepRotationOnlyWhenQuiet(f, "addToken", addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepEvidencePermanent(f, addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepReplacementNeedsActivation(f, "addToken", addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepSignaturesNeedLive(f, "addToken", addToken(f, asset, by_)))
  ensures (inv(f) ==> canAddToken(f, asset, by_) ==> stepJournalAppendOnly(f, addToken(f, asset, by_)))
{
  hide *;
  if inv(f) && canAddToken(f, asset, by_) {
    reveal inv, canAddToken, addToken, noHolding;
    var after := addToken(f, asset, by_);
    var newTok := |f.holdings| + 1;
    var nh := noHolding.(token := newTok, asset := asset);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "addToken", after);
    assert forall r :: r in f.rows ==> r.token != newTok by {
      reveal alwaysHoldingsIdentity, validToken;
    }
    assert alwaysHoldingsIdentity(after) by {
      reveal alwaysHoldingsIdentity, holding, validToken;
      HoldingsIdsEquiv(f.holdings, 0);
      HoldingsIdsEquiv(after.holdings, 0);
    }
    assert openAmount(after, newTok) == 0 && openClaims(after, newTok) == 0 && openRows(after, newTok) == 0 by {
      reveal openAmount, openClaims, openRows;
      var fa := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == newTok)) then (t + r.amountIn) else t);
      var va := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == newTok)) then r.amountIn else 0);
      SumFoldNonneg(fa, va, 0, f.rows);
      var fc := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == newTok)) then (t + r.amountIn) else t);
      var vc := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == newTok)) then r.amountIn else 0);
      SumFoldNonneg(fc, vc, 0, f.rows);
      var fr := (t: int, r: Row) => (if (isOpen(r) && (r.token == newTok)) then (t + 1) else t);
      var vr := (r: Row) => (if (isOpen(r) && (r.token == newTok)) then 1 else 0);
      SumFoldNonneg(fr, vr, 0, f.rows);
    }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by {
      reveal alwaysClaimsFromReceipts;
      var fc := (t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == newTok)) then (t + r.output) else t);
      var vc := (r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == newTok)) then r.output else 0);
      SumFoldNonneg(fc, vc, 0, f.rows);
    }
    assert alwaysOutputFromReceipts(after) by {
      reveal alwaysOutputFromReceipts, finalizedOutput;
      var fo := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == newTok)) then (t + r.output) else t);
      var vo := (r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == newTok)) then r.output else 0);
      SumFoldNonneg(fo, vo, 0, f.rows);
      var fs := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == newTok)) then (t + r.amountIn) else t);
      var vs := (r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == newTok)) then r.amountIn else 0);
      SumFoldNonneg(fs, vs, 0, f.rows);
    }
  }
}

lemma receiveFee_ensures(f: Fee, transfer: FinalizedTransfer, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysLeaseIdentity(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysRotationOnlyOnSolana(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysRotationExcludesRuns(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysRuntimeSound(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysHoldingsIdentity(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysTopUpsNeverSold(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysAccrualFromVault(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysRunValueBounded(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysNotConvertedRetained(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysOpenSendHeld(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysSignedRowsAttributed(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysLiabilityWithinDay(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysReservationsWithinTransaction(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysOneOpenSend(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysClaimsFromReceipts(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysOutputFromReceipts(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysExpiryProven(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysAttemptsKeepContent(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysDryRowsNeverSign(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> alwaysRowIdentity(receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepStaleRunCannotSign(f, "receiveFee", receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepRotationBlocksRuns(f, "receiveFee", receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepRotationOnlyWhenQuiet(f, "receiveFee", receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepEvidencePermanent(f, receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepReplacementNeedsActivation(f, "receiveFee", receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepSignaturesNeedLive(f, "receiveFee", receiveFee(f, transfer, by_)))
  ensures (inv(f) ==> canReceiveFee(f, transfer, by_) ==> stepJournalAppendOnly(f, receiveFee(f, transfer, by_)))
{
  hide *;
  if inv(f) && canReceiveFee(f, transfer, by_) {
    reveal inv, canReceiveFee, receiveFee;
    var after := receiveFee(f, transfer, by_);
    var h0 := holding(f, transfer.token);
    var h1 := h0.(balance := (h0.balance + transfer.amount), feeIncome := (h0.feeIncome + transfer.amount));
    assert h0 == f.holdings[transfer.token - 1] && h0 in f.holdings && h0.token == transfer.token by {
      reveal alwaysHoldingsIdentity, holding, validToken;
      HoldingsIdsEquiv(f.holdings, 0);
    }
    WithHoldingShape(f, transfer.token, h1);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "receiveFee", after);
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
  }
}

lemma receiveTopUp_ensures(f: Fee, token: int, amount: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysLeaseIdentity(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysRotationOnlyOnSolana(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysRotationExcludesRuns(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysRuntimeSound(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysHoldingsIdentity(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysTopUpsNeverSold(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysAccrualFromVault(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysRunValueBounded(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysNotConvertedRetained(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysOpenSendHeld(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysSignedRowsAttributed(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysLiabilityWithinDay(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysReservationsWithinTransaction(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysOneOpenSend(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysClaimsFromReceipts(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysOutputFromReceipts(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysExpiryProven(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysAttemptsKeepContent(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysDryRowsNeverSign(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> alwaysRowIdentity(receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepStaleRunCannotSign(f, "receiveTopUp", receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepRotationBlocksRuns(f, "receiveTopUp", receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepRotationOnlyWhenQuiet(f, "receiveTopUp", receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepEvidencePermanent(f, receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepReplacementNeedsActivation(f, "receiveTopUp", receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepSignaturesNeedLive(f, "receiveTopUp", receiveTopUp(f, token, amount, by_)))
  ensures (inv(f) ==> canReceiveTopUp(f, token, amount, by_) ==> stepJournalAppendOnly(f, receiveTopUp(f, token, amount, by_)))
{
  hide *;
  if inv(f) && canReceiveTopUp(f, token, amount, by_) {
    reveal inv, canReceiveTopUp, receiveTopUp;
    var after := receiveTopUp(f, token, amount, by_);
    var h0 := holding(f, token);
    var h1 := h0.(balance := (h0.balance + amount), topUps := (h0.topUps + amount));
    assert h0 == f.holdings[token - 1] && h0 in f.holdings && h0.token == token by {
      reveal alwaysHoldingsIdentity, holding, validToken;
      HoldingsIdsEquiv(f.holdings, 0);
    }
    WithHoldingShape(f, token, h1);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "receiveTopUp", after);
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
  }
}

lemma observeBalance_ensures(f: Fee, token: int, balance: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysLeaseIdentity(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysRotationOnlyOnSolana(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysRotationExcludesRuns(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysRuntimeSound(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysHoldingsIdentity(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysTopUpsNeverSold(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysAccrualFromVault(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysRunValueBounded(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysNotConvertedRetained(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysOpenSendHeld(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysSignedRowsAttributed(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysLiabilityWithinDay(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysReservationsWithinTransaction(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysOneOpenSend(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysClaimsFromReceipts(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysOutputFromReceipts(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysExpiryProven(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysAttemptsKeepContent(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysDryRowsNeverSign(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> alwaysRowIdentity(observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepStaleRunCannotSign(f, "observeBalance", observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepRotationBlocksRuns(f, "observeBalance", observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepRotationOnlyWhenQuiet(f, "observeBalance", observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepEvidencePermanent(f, observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepReplacementNeedsActivation(f, "observeBalance", observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepSignaturesNeedLive(f, "observeBalance", observeBalance(f, token, balance, by_)))
  ensures (inv(f) ==> canObserveBalance(f, token, balance, by_) ==> stepJournalAppendOnly(f, observeBalance(f, token, balance, by_)))
{
  hide *;
  if inv(f) && canObserveBalance(f, token, balance, by_) {
    reveal inv, canObserveBalance, observeBalance;
    var after := observeBalance(f, token, balance, by_);
    var h0 := holding(f, token);
    var h1 := h0.(balance := balance, feeIncome := (if (balance > h0.balance) then ((h0.feeIncome + balance) - h0.balance) else h0.feeIncome));
    assert h0 == f.holdings[token - 1] && h0 in f.holdings && h0.token == token by {
      reveal alwaysHoldingsIdentity, holding, validToken;
      HoldingsIdsEquiv(f.holdings, 0);
    }
    OpenRowsZeroImpliesNone(f, token);
    WithHoldingShape(f, token, h1);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "observeBalance", after);
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
  }
}

lemma accrue_ensures(f: Fee, accrual: VaultAccrual, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysLeaseIdentity(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysRotationOnlyOnSolana(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysRotationExcludesRuns(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysRuntimeSound(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysHoldingsIdentity(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysTopUpsNeverSold(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysAccrualFromVault(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysRunValueBounded(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysNotConvertedRetained(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysOpenSendHeld(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysSignedRowsAttributed(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysLiabilityWithinDay(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysReservationsWithinTransaction(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysOneOpenSend(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysClaimsFromReceipts(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysOutputFromReceipts(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysExpiryProven(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysAttemptsKeepContent(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysDryRowsNeverSign(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> alwaysRowIdentity(accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepStaleRunCannotSign(f, "accrue", accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepRotationBlocksRuns(f, "accrue", accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepRotationOnlyWhenQuiet(f, "accrue", accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepEvidencePermanent(f, accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepReplacementNeedsActivation(f, "accrue", accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepSignaturesNeedLive(f, "accrue", accrue(f, accrual, by_)))
  ensures (inv(f) ==> canAccrue(f, accrual, by_) ==> stepJournalAppendOnly(f, accrue(f, accrual, by_)))
{
  hide *;
  if inv(f) && canAccrue(f, accrual, by_) {
    reveal inv, canAccrue, accrue;
    var after := accrue(f, accrual, by_);
    var v := vaultOf(f, accrual.vault);
    assert v in f.vaults by {
      reveal vaultOf;
      VaultOfSpecAux(f.vaults, accrual.vault, ReviewedVault(0, 0, 0));
    }
    assert validToken(f, v.token) by { reveal alwaysHoldingsIdentity; }
    var h0 := holding(f, v.token);
    var h1 := h0.(accrued := accrual.accrued, vaultObserved := accrual.accrued, vault := v.vault);
    assert h0 == f.holdings[v.token - 1] && h0 in f.holdings && h0.token == v.token by {
      reveal alwaysHoldingsIdentity, holding, validToken;
      HoldingsIdsEquiv(f.holdings, 0);
    }
    WithHoldingShape(f, v.token, h1);
    PreserveRowsAndGasUnchanged(f, after);
    PreserveStepsOther(f, "accrue", after);
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold, openAmount; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault, openClaims; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend, openRows; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts, finalizedOutput; }
  }
}

lemma acquireLease_ensures(f: Fee, runId: int, trigger: Trigger, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysLeaseIdentity(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysRotationOnlyOnSolana(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysRotationExcludesRuns(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysRuntimeSound(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysHoldingsIdentity(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysTopUpsNeverSold(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysAccrualFromVault(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysRunValueBounded(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysNotConvertedRetained(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysOpenSendHeld(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysSignedRowsAttributed(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysLiabilityWithinDay(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysReservationsWithinTransaction(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysOneOpenSend(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysClaimsFromReceipts(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysOutputFromReceipts(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysExpiryProven(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysAttemptsKeepContent(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysDryRowsNeverSign(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> alwaysRowIdentity(acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepStaleRunCannotSign(f, "acquireLease", acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepRotationBlocksRuns(f, "acquireLease", acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepRotationOnlyWhenQuiet(f, "acquireLease", acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepEvidencePermanent(f, acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepReplacementNeedsActivation(f, "acquireLease", acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepSignaturesNeedLive(f, "acquireLease", acquireLease(f, runId, trigger, by_)))
  ensures (inv(f) ==> canAcquireLease(f, runId, trigger, by_) ==> stepJournalAppendOnly(f, acquireLease(f, runId, trigger, by_)))
{
  hide *;
  if inv(f) && canAcquireLease(f, runId, trigger, by_) {
    reveal inv, canAcquireLease, acquireLease;
    var after := acquireLease(f, runId, trigger, by_);
    AcquireLeasePreservesGas(f, after);
    PreserveSameCoreA(f, after.(runValue := f.runValue, gas := f.gas));
    assert forall t :: holding(after, t) == holding(f, t) by { reveal holding; }
    assert forall t :: validToken(after, t) == validToken(f, t) by { reveal validToken; }
    assert forall t :: openAmount(after, t) == openAmount(f, t) by { reveal openAmount; }
    assert forall t :: openClaims(after, t) == openClaims(f, t) by { reveal openClaims; }
    assert forall t :: openRows(after, t) == openRows(f, t) by { reveal openRows; }
    assert forall t :: evaluated(after, t) == evaluated(f, t) by { reveal evaluated; }
    assert forall t :: finalizedOutput(after, t) == finalizedOutput(f, t) by { reveal finalizedOutput; }
    assert dayValue(after) == dayValue(f) by { reveal dayValue; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
    assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts; }
    assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
    assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
    assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
    assert stepStaleRunCannotSign(f, "acquireLease", after) by { reveal stepStaleRunCannotSign; }
    assert stepRotationBlocksRuns(f, "acquireLease", after) by { reveal stepRotationBlocksRuns; }
    assert stepRotationOnlyWhenQuiet(f, "acquireLease", after) by { reveal stepRotationOnlyWhenQuiet; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepReplacementNeedsActivation(f, "acquireLease", after) by { reveal stepReplacementNeedsActivation; }
    assert stepSignaturesNeedLive(f, "acquireLease", after) by { reveal stepSignaturesNeedLive; }
  }
}

lemma broadcastFail_ensures(f: Fee, runId: int, id: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysLeaseIdentity(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysRotationOnlyOnSolana(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysRotationExcludesRuns(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysRuntimeSound(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysHoldingsIdentity(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysTopUpsNeverSold(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysAccrualFromVault(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysRunValueBounded(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysNotConvertedRetained(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysOpenSendHeld(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysSignedRowsAttributed(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysLiabilityWithinDay(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysReservationsWithinTransaction(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysOneOpenSend(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysClaimsFromReceipts(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysOutputFromReceipts(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysExpiryProven(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysAttemptsKeepContent(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysDryRowsNeverSign(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> alwaysRowIdentity(broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepStaleRunCannotSign(f, "broadcastFail", broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepRotationBlocksRuns(f, "broadcastFail", broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepRotationOnlyWhenQuiet(f, "broadcastFail", broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepEvidencePermanent(f, broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepReplacementNeedsActivation(f, "broadcastFail", broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepSignaturesNeedLive(f, "broadcastFail", broadcastFail(f, runId, id, by_)))
  ensures (inv(f) ==> canBroadcastFail(f, runId, id, by_) ==> stepJournalAppendOnly(f, broadcastFail(f, runId, id, by_)))
{
  hide *;
  if inv(f) && canBroadcastFail(f, runId, id, by_) {
    reveal inv, canBroadcastFail, broadcastFail;
    var after := broadcastFail(f, runId, id, by_);
    RowsPositional(f);
    var r0 :| r0 in f.rows && r0.id == id && r0.state.Submitted?;
    var idx := id - 1;
    assert 0 <= idx < |f.rows| && f.rows[idx] == r0;
    assert !rowFrozen(r0) by { reveal rowFrozen, settledState; }
    PreserveRowUpdateCore(f, after, idx);
    RowUpdateFoldsEqual(f, after, idx);
    RowUpdatePreservesGasAndIds(f, after, idx);
    PreserveStepsOther(f, "broadcastFail", after);
  }
}

lemma rebroadcast_ensures(f: Fee, runId: int, id: int, accepted: bool, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysLeaseIdentity(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysRotationOnlyOnSolana(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysRotationExcludesRuns(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysRuntimeSound(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysHoldingsIdentity(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysTopUpsNeverSold(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysAccrualFromVault(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysRunValueBounded(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysNotConvertedRetained(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysOpenSendHeld(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysSignedRowsAttributed(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysLiabilityWithinDay(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysReservationsWithinTransaction(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysOneOpenSend(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysClaimsFromReceipts(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysOutputFromReceipts(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysExpiryProven(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysAttemptsKeepContent(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysDryRowsNeverSign(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> alwaysRowIdentity(rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepStaleRunCannotSign(f, "rebroadcast", rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepRotationBlocksRuns(f, "rebroadcast", rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepRotationOnlyWhenQuiet(f, "rebroadcast", rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepEvidencePermanent(f, rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepReplacementNeedsActivation(f, "rebroadcast", rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepSignaturesNeedLive(f, "rebroadcast", rebroadcast(f, runId, id, accepted, by_)))
  ensures (inv(f) ==> canRebroadcast(f, runId, id, accepted, by_) ==> stepJournalAppendOnly(f, rebroadcast(f, runId, id, accepted, by_)))
{
  hide *;
  if inv(f) && canRebroadcast(f, runId, id, accepted, by_) {
    reveal inv, canRebroadcast, rebroadcast;
    var after := rebroadcast(f, runId, id, accepted, by_);
    if !accepted {
      PreserveSameCore(f, after);
      PreserveStepsOther(f, "rebroadcast", after);
      assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
      assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
      assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
      assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
      assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    } else {
      RowsPositional(f);
      var r0 :| r0 in f.rows && r0.id == id && r0.state.Unknown?;
      var idx := id - 1;
      assert 0 <= idx < |f.rows| && f.rows[idx] == r0;
      assert !rowFrozen(r0) by { reveal rowFrozen, settledState; }
      PreserveRowUpdateCore(f, after, idx);
      RowUpdateFoldsEqual(f, after, idx);
      RowUpdatePreservesGasAndIds(f, after, idx);
      PreserveStepsOther(f, "rebroadcast", after);
    }
  }
}

lemma abandonIntent_ensures(f: Fee, runId: int, id: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysLeaseIdentity(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysRotationOnlyOnSolana(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysRotationExcludesRuns(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysRuntimeSound(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysHoldingsIdentity(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysTopUpsNeverSold(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysAccrualFromVault(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysRunValueBounded(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysNotConvertedRetained(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysOpenSendHeld(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysSignedRowsAttributed(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysLiabilityWithinDay(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysReservationsWithinTransaction(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysOneOpenSend(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysClaimsFromReceipts(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysOutputFromReceipts(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysExpiryProven(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysAttemptsKeepContent(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysDryRowsNeverSign(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> alwaysRowIdentity(abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepStaleRunCannotSign(f, "abandonIntent", abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepRotationBlocksRuns(f, "abandonIntent", abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepRotationOnlyWhenQuiet(f, "abandonIntent", abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepEvidencePermanent(f, abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepReplacementNeedsActivation(f, "abandonIntent", abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepSignaturesNeedLive(f, "abandonIntent", abandonIntent(f, runId, id, by_)))
  ensures (inv(f) ==> canAbandonIntent(f, runId, id, by_) ==> stepJournalAppendOnly(f, abandonIntent(f, runId, id, by_)))
{
  hide *;
  if inv(f) && canAbandonIntent(f, runId, id, by_) {
    reveal inv, canAbandonIntent, abandonIntent, noRow;
    var after := abandonIntent(f, runId, id, by_);
    RowsPositional(f);
    var idx := id - 1;
    assert 0 <= idx < |f.rows|;
    var r0 := f.rows[idx];
    assert r0 in f.rows && r0.id == id && r0.state.Quoted? && r0.live && r0.runId != runId;
    assert r0.amountIn > 0 && r0.valueMicro >= 0 && isOpen(r0) && !rowFrozen(r0) by {
      reveal alwaysRowIdentity, isOpen, rowFrozen, settledState;
    }
    forall g | g in f.gas && g.state.Reserved? ensures pendingIntent(after, g.runId) == pendingIntent(f, g.runId) {
      reveal alwaysLeaseIdentity, leaseHeld, pendingIntent;
      var pf := (found: Row, r: Row) => (if ((r.state.Quoted? && r.live) && (r.runId == g.runId)) then r else found);
      ProofLib.FoldLeftPointwise(pf, pf, noRow, after.rows, f.rows);
    }
    PreserveRowUpdateCore(f, after, idx);
    RowCloseToFailedPreservesFolds(f, after, idx);
    RowUpdatePreservesGasAndIds(f, after, idx);
    PreserveStepsOther(f, "abandonIntent", after);
  }
}

lemma failPreparation_ensures(f: Fee, runId: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysLeaseIdentity(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysRotationOnlyOnSolana(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysRotationExcludesRuns(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysRuntimeSound(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysHoldingsIdentity(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysTopUpsNeverSold(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysAccrualFromVault(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysRunValueBounded(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysNotConvertedRetained(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysOpenSendHeld(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysSignedRowsAttributed(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysLiabilityWithinDay(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysReservationsWithinTransaction(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysOneOpenSend(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysClaimsFromReceipts(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysOutputFromReceipts(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysExpiryProven(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysAttemptsKeepContent(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysDryRowsNeverSign(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> alwaysRowIdentity(failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepStaleRunCannotSign(f, "failPreparation", failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepRotationBlocksRuns(f, "failPreparation", failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepRotationOnlyWhenQuiet(f, "failPreparation", failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepEvidencePermanent(f, failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepReplacementNeedsActivation(f, "failPreparation", failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepSignaturesNeedLive(f, "failPreparation", failPreparation(f, runId, by_)))
  ensures (inv(f) ==> canFailPreparation(f, runId, by_) ==> stepJournalAppendOnly(f, failPreparation(f, runId, by_)))
{
  hide *;
  if inv(f) && canFailPreparation(f, runId, by_) {
    reveal inv, canFailPreparation, failPreparation, noRow;
    var after := failPreparation(f, runId, by_);
    RowsPositional(f);
    var intent := pendingIntent(f, runId);
    assert intent in f.rows && intent.state.Quoted? && intent.live && intent.runId == runId by {
      reveal pendingIntent, alwaysRowIdentity;
      PendingIntentAux(f.rows, runId, noRow);
    }
    var idx := intent.id - 1;
    assert 0 <= idx < |f.rows| && f.rows[idx] == intent;
    assert intent.amountIn > 0 && intent.valueMicro >= 0 && isOpen(intent) by {
      reveal alwaysRowIdentity, isOpen;
    }
    PreserveRowUpdateCore(f, after, idx);
    RowCloseToFailedPreservesFolds(f, after, idx);
    FailPrepPreservesGasAndIds(f, after, runId, idx);
    PreserveStepsOther(f, "failPreparation", after);
  }
}

lemma expireEvm_ensures(f: Fee, runId: int, id: int, deadline: DeadlineEvidence, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysLeaseIdentity(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysRotationOnlyOnSolana(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysRotationExcludesRuns(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysRuntimeSound(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysHoldingsIdentity(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysTopUpsNeverSold(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysAccrualFromVault(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysRunValueBounded(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysNotConvertedRetained(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysOpenSendHeld(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysSignedRowsAttributed(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysLiabilityWithinDay(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysReservationsWithinTransaction(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysOneOpenSend(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysClaimsFromReceipts(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysOutputFromReceipts(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysExpiryProven(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysAttemptsKeepContent(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysDryRowsNeverSign(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> alwaysRowIdentity(expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepStaleRunCannotSign(f, "expireEvm", expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepRotationBlocksRuns(f, "expireEvm", expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepRotationOnlyWhenQuiet(f, "expireEvm", expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepEvidencePermanent(f, expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepReplacementNeedsActivation(f, "expireEvm", expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepSignaturesNeedLive(f, "expireEvm", expireEvm(f, runId, id, deadline, by_)))
  ensures (inv(f) ==> canExpireEvm(f, runId, id, deadline, by_) ==> stepJournalAppendOnly(f, expireEvm(f, runId, id, deadline, by_)))
{
  hide *;
  if inv(f) && canExpireEvm(f, runId, id, deadline, by_) {
    reveal inv, canExpireEvm, expireEvm, noRow;
    var after := expireEvm(f, runId, id, deadline, by_);
    RowsPositional(f);
    var idx := id - 1;
    assert 0 <= idx < |f.rows|;
    var r0 := f.rows[idx];
    assert r0 in f.rows && r0.id == id && (r0.state.Submitted? || r0.state.Unknown?);
    assert r0.amountIn > 0 && r0.valueMicro >= 0 && isOpen(r0) && !rowFrozen(r0) by {
      reveal alwaysRowIdentity, isOpen, rowFrozen, settledState;
    }
    forall g | g in f.gas && g.state.Reserved? ensures pendingIntent(after, g.runId) == pendingIntent(f, g.runId) {
      reveal pendingIntent;
      var pf := (found: Row, r: Row) => (if ((r.state.Quoted? && r.live) && (r.runId == g.runId)) then r else found);
      ProofLib.FoldLeftPointwise(pf, pf, noRow, after.rows, f.rows);
    }
    PreserveRowUpdateCore(f, after, idx);
    RowCloseToFailedPreservesFolds(f, after, idx);
    RowUpdatePreservesGasAndIds(f, after, idx);
    PreserveStepsOther(f, "expireEvm", after);
  }
}

lemma evaluate_ensures(f: Fee, runId: int, quote: Quote, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysLeaseIdentity(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysRotationOnlyOnSolana(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysRotationExcludesRuns(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysRuntimeSound(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysHoldingsIdentity(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysTopUpsNeverSold(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysAccrualFromVault(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysRunValueBounded(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysNotConvertedRetained(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysOpenSendHeld(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysSignedRowsAttributed(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysLiabilityWithinDay(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysReservationsWithinTransaction(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysOneOpenSend(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysClaimsFromReceipts(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysOutputFromReceipts(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysExpiryProven(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysAttemptsKeepContent(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysDryRowsNeverSign(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> alwaysRowIdentity(evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepStaleRunCannotSign(f, "evaluate", evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepRotationBlocksRuns(f, "evaluate", evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepRotationOnlyWhenQuiet(f, "evaluate", evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepEvidencePermanent(f, evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepReplacementNeedsActivation(f, "evaluate", evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepSignaturesNeedLive(f, "evaluate", evaluate(f, runId, quote, by_)))
  ensures (inv(f) ==> canEvaluate(f, runId, quote, by_) ==> stepJournalAppendOnly(f, evaluate(f, runId, quote, by_)))
{
  hide *;
  if inv(f) && canEvaluate(f, runId, quote, by_) {
    reveal inv, canEvaluate, evaluate;
    var row := evaluationRow(f, runId, quote);
    var after := evaluate(f, runId, quote, by_);
    if repeatsWaiting(f, row) {
      PreserveSameCore(f, after);
      PreserveStepsOther(f, "evaluate", after);
      assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity; }
      assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
      assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
      assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
      assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    } else {
      EvaluateAppendPreservesFolds(f, after, runId, quote, row);
      EvaluateAppendPreservesRest(f, after, runId, quote, row);
      PreserveStepsOther(f, "evaluate", after);
    }
  }
}

lemma LiabilityOfAppendedGas(before: Fee, after: Fee, newG: Reservation, stub: Reservation)
  requires inv(before) && !before.overrun && !after.overrun
  requires after.network == before.network && after.clock == before.clock
  requires after.gas == before.gas + [newG]
  requires newG.id == |before.gas| + 1 && newG.maximum >= 0 && newG.actual >= 0
  requires stub.id == newG.id && stub.nonce == newG.nonce && stub.maximum == newG.maximum
  requires stub.state.Abandoned? == newG.state.Abandoned? && stub.settled == newG.settled
  requires stub.actual == newG.actual && stub.settledDay == newG.settledDay
  requires liabilityOf(before.gas + [stub], day(before)) <= fees__runtime_dailyCeilingOf(before.network)
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv, alwaysLiabilityWithinDay;
  assert day(after) == day(before) by { reveal day; }
  LiabilitySameShape(after.gas, before.gas + [stub], day(before));
  GasDistinctById(before);
  assert ProofLib.DistinctBy(after.gas, (g: Reservation) => g.id) by {
    reveal ProofLib.DistinctBy;
    forall i, j | 0 <= i < |after.gas| && 0 <= j < |after.gas| && i != j ensures after.gas[i].id != after.gas[j].id {
      if i < |before.gas| { assert after.gas[i].id == i + 1; }
      if j < |before.gas| { assert after.gas[j].id == j + 1; }
    }
  }
  assert forall g :: g in after.gas ==> g.maximum >= 0 && g.actual >= 0 by {
    reveal alwaysReservationsWithinTransaction;
    forall g | g in after.gas ensures g.maximum >= 0 && g.actual >= 0 {
      if g in before.gas {}
    }
  }
  JournaledGasDef(after);
  LiabilityOfFilter((g: Reservation) => !(g.imported), after.gas, day(before));
}

lemma NoReservedWhenOwnZero(f: Fee, runId: int)
  requires inv(f) && leaseHeld(f, runId) && ownReservation(f, runId).id == 0
  ensures forall g :: g in f.gas ==> !g.state.Reserved?
{
  hide *;
  reveal inv, leaseHeld, alwaysLeaseIdentity, alwaysRowIdentity, ownReservation, noGas;
  OwnReservationAux(f.gas, runId, noGas);
}

lemma OpenRowHasUnsettledSignedGas(f: Fee, r: Row) returns (g: Reservation)
  requires inv(f) && r in f.rows && (r.state.Submitted? || r.state.Unknown?)
  ensures g in f.gas && g.row == r.id && g.nonce == r.nonce && g.state.Signed? && !g.settled
{
  hide *;
  reveal inv, alwaysOpenSendHeld, alwaysSignedRowsAttributed;
  RowsPositional(f);
  var a := r.attempts[0];
  assert a in r.attempts;
  g :| g in f.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled;
  var r2 :| r2 in f.rows && r2.id == g.row && r2.nonce == g.nonce && (exists a2 :: a2 in r2.attempts && a2.tx == g.tx);
  assert r2 == r;
}

lemma SignedGasRowInBounds(f: Fee)
  requires inv(f)
  ensures forall g :: g in f.gas && g.state.Signed? ==> 0 <= g.row - 1 < |f.rows| && f.rows[g.row - 1].id == g.row && f.rows[g.row - 1].nonce == g.nonce
{
  hide *;
  reveal inv, alwaysSignedRowsAttributed;
  RowsPositional(f);
  forall g | g in f.gas && g.state.Signed? ensures 0 <= g.row - 1 < |f.rows| && f.rows[g.row - 1].id == g.row && f.rows[g.row - 1].nonce == g.nonce {
    var r :| r in f.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
    assert 0 <= r.id - 1 < |f.rows| && f.rows[r.id - 1] == r;
  }
}

lemma NonceAboveOpenAndSameWallet(f: Fee, nonce: int)
  requires inv(f)
  requires if f.network.Solana? then nonce == solanaSequence(f) else nonce >= nonceFloor(f)
  ensures forall r :: r in f.rows && (r.state.Submitted? || r.state.Unknown?) ==> r.nonce != nonce
  ensures forall o :: o in f.gas && o.state.Signed? && !o.settled && o.nonce == nonce ==>
    0 <= o.row - 1 < |f.rows| && f.rows[o.row - 1].wallet == wallet(f)
{
  hide *;
  reveal inv;
  RowsPositional(f);
  if f.network.Solana? {
    assert forall g :: g in f.gas ==> g.nonce < nonce by {
      reveal solanaSequence;
      SolanaSequenceBound(f.gas, 0);
    }
    forall r | r in f.rows && (r.state.Submitted? || r.state.Unknown?) ensures r.nonce != nonce {
      var g := OpenRowHasUnsettledSignedGas(f, r);
      assert g.nonce < nonce;
    }
  } else {
    assert forall g :: g in f.gas && (g.state.Reserved? || (g.state.Signed? && (g.settled || !expiredRow(f, g.row)))) ==> g.nonce < nonce by {
      reveal nonceFloor;
      NonceFloorBound(f, f.gas, 0);
    }
    assert forall o :: o in f.gas && o.state.Signed? && !o.settled && o.nonce == nonce ==> 0 <= o.row - 1 < |f.rows| && f.rows[o.row - 1].wallet == wallet(f) && f.rows[o.row - 1].state.Failed? by {
      reveal expiredRow, alwaysRowIdentity;
      forall o | o in f.gas && o.state.Signed? && !o.settled && o.nonce == nonce ensures 0 <= o.row - 1 < |f.rows| && f.rows[o.row - 1].wallet == wallet(f) && f.rows[o.row - 1].state.Failed? {
        assert expiredRow(f, o.row);
        var r :| r in f.rows && r.id == o.row && r.reason.ExpiredUnlanded? && r.wallet == wallet(f);
        assert f.rows[o.row - 1] == r;
      }
    }
    forall r | r in f.rows && (r.state.Submitted? || r.state.Unknown?) ensures r.nonce != nonce {
      var g := OpenRowHasUnsettledSignedGas(f, r);
      if r.nonce == nonce {
        assert f.rows[g.row - 1] == r;
        assert r.state.Failed?;
      }
    }
  }
}

lemma ReserveGasPreservesRes(before: Fee, after: Fee, runId: int, nonce: int, maximum: int)
  requires inv(before) && canReserveGas(before, runId, nonce, maximum, fees__runtime_Sender.Worker)
  requires after == reserveGas(before, runId, nonce, maximum, fees__runtime_Sender.Worker)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, canReserveGas, reserveGas, alwaysReservationsWithinTransaction;
  assert day(after) == day(before) by { reveal day; }
  assert forall r :: pendingIntent(after, r) == pendingIntent(before, r) by { reveal pendingIntent; }
  NoReservedWhenOwnZero(before, runId);
  NonceAboveOpenAndSameWallet(before, nonce);
}

lemma ReserveGasPreservesRest(before: Fee, after: Fee, runId: int, nonce: int, maximum: int)
  requires inv(before) && canReserveGas(before, runId, nonce, maximum, fees__runtime_Sender.Worker)
  requires after == reserveGas(before, runId, nonce, maximum, fees__runtime_Sender.Worker)
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepStaleRunCannotSign(before, "reserveGas", after)
  ensures stepRotationBlocksRuns(before, "reserveGas", after)
  ensures stepRotationOnlyWhenQuiet(before, "reserveGas", after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, "reserveGas", after)
  ensures stepSignaturesNeedLive(before, "reserveGas", after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv, canReserveGas, reserveGas;
  NoReservedWhenOwnZero(before, runId);
  assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity, leaseHeld; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall g | g in before.gas ensures g in after.gas {}
  }
  assert alwaysSignedRowsAttributed(after) by { reveal alwaysSignedRowsAttributed; }
  assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
  assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent; }
  assert alwaysRowIdentity(after) by {
    GasDistinctById(before);
    GasIdsEquiv(after.gas, 0);
    reveal alwaysRowIdentity;
    forall g | g in after.gas ensures g.id > 0 && (if 0 <= g.id - 1 < |after.gas| then after.gas[g.id - 1] else noGas).id == g.id {
      var i :| 0 <= i < |after.gas| && after.gas[i] == g;
      assert g.id == i + 1;
    }
  }
  assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
  assert stepStaleRunCannotSign(before, "reserveGas", after) by { reveal stepStaleRunCannotSign; }
  assert stepRotationBlocksRuns(before, "reserveGas", after) by { reveal stepRotationBlocksRuns, alwaysRotationExcludesRuns, runHolds, leaseHeld; }
  assert stepRotationOnlyWhenQuiet(before, "reserveGas", after) by { reveal stepRotationOnlyWhenQuiet; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
  assert stepReplacementNeedsActivation(before, "reserveGas", after) by { reveal stepReplacementNeedsActivation; }
  assert stepSignaturesNeedLive(before, "reserveGas", after) by { reveal stepSignaturesNeedLive; }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly;
    forall g | g in before.gas ensures g in after.gas {}
  }
}

lemma SignPreservesFolds(before: Fee, after: Fee, runId: int, send: SignedSend, idx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires 0 <= idx < |before.rows| && before.rows[idx] == pendingIntent(before, runId)
  requires before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires before.rows[idx].valueMicro <= remaining(before)
  requires send.kind.Conversion? || send.kind.Approval?
  requires after.holdings == before.holdings && after.clock == before.clock
  requires after.runValue == (if send.kind.Conversion? then before.runValue + before.rows[idx].valueMicro else before.runValue)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(kind := send.kind, state := RowState.Submitted, nonce := send.nonce, gasLimit := send.gasLimit, deadline := send.deadline, minimumOutput := (if send.kind.Approval? then 0 else send.minimumOutput), attempts := [Attempt(send.tx, send.fees.maxFee, send.fees.priority, before.clock)])
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, isOpen;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert r0.kind.Conversion? && r0.amountIn > 0 && r0.valueMicro >= 0 by {
    reveal alwaysRowIdentity;
  }
  RowUpdatePreservesReceipts(before, after, idx);
  forall tok ensures openAmount(after, tok) <= openAmount(before, tok) {
    reveal openAmount;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  forall tok ensures openClaims(after, tok) == openClaims(before, tok) {
    reveal openClaims;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  forall tok ensures openRows(after, tok) == openRows(before, tok) {
    reveal openRows;
    var f := (t: int, r: Row) => (if (isOpen(r) && (r.token == tok)) then (t + 1) else t);
    var v := (r: Row) => (if (isOpen(r) && (r.token == tok)) then 1 else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  assert dayValue(after) <= dayValue(before) + (if send.kind.Conversion? then r0.valueMicro else 0) by {
    reveal dayValue;
    var f := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t);
    var v := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then r.valueMicro else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded, remaining; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
}

lemma ResFromConjuncts(f: Fee)
  requires forall g :: g in f.gas ==>
    g.maximum > 0 && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(f.network)) &&
    (g.imported ==> g.state.Signed?) && g.actual >= 0 &&
    (g.settled ==> g.state.Signed? && g.settledDay <= day(f)) &&
    (g.state.Signed? ==> g.tx > 0 && (if f.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0))
  requires forall g, o :: g in f.gas && o in f.gas && g.tx > 0 && o.tx == g.tx ==> o.id == g.id
  requires forall g, o :: g in f.gas && o in f.gas && g.state.Signed? && !g.settled && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
    (if 0 <= g.row - 1 < |f.rows| then f.rows[g.row - 1] else noRow).wallet == (if 0 <= o.row - 1 < |f.rows| then f.rows[o.row - 1] else noRow).wallet
  requires forall g :: g in f.gas && g.state.Reserved? ==>
    g.row == 0 && !g.settled && g.blockhashSlot == 0 && g.tx == 0 && pendingIntent(f, g.runId).id > 0 &&
    (forall r :: r in f.rows && (r.state.Submitted? || r.state.Unknown?) ==> r.nonce != g.nonce) &&
    (forall o :: o in f.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
      pendingIntent(f, g.runId).wallet == (if 0 <= o.row - 1 < |f.rows| then f.rows[o.row - 1] else noRow).wallet)
  ensures alwaysReservationsWithinTransaction(f)
{
  hide *;
  reveal alwaysReservationsWithinTransaction;
}

lemma SignPreservesResWallet(before: Fee, after: Fee, runId: int, send: SignedSend, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires 0 <= idx < |before.rows| && before.rows[idx] == pendingIntent(before, runId)
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx] == ownReservation(before, runId)
  requires before.gas[gIdx].state.Reserved? && before.gas[gIdx].runId == runId
  requires send.nonce == before.gas[gIdx].nonce
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].wallet == before.rows[idx].wallet
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx] == before.gas[gIdx].(state := GasState.Signed, row := before.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot)
  ensures forall g, o :: g in after.gas && o in after.gas && g.state.Signed? && !g.settled && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
    (if 0 <= g.row - 1 < |after.rows| then after.rows[g.row - 1] else noRow).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet
{
  hide *;
  reveal inv;
  RowsPositional(before);
  SignedGasRowInBounds(before);
  var r0 := before.rows[idx];
  var g0 := before.gas[gIdx];
  assert r0 in before.rows && g0 in before.gas;
  reveal alwaysReservationsWithinTransaction;
  forall g, o | g in after.gas && o in after.gas && g.state.Signed? && !g.settled && o.state.Signed? && !o.settled && o.nonce == g.nonce
    ensures (if 0 <= g.row - 1 < |after.rows| then after.rows[g.row - 1] else noRow).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet {
    var k1 :| 0 <= k1 < |after.gas| && after.gas[k1] == g;
    var k2 :| 0 <= k2 < |after.gas| && after.gas[k2] == o;
    if k1 == gIdx && k2 == gIdx {
    } else if k1 == gIdx {
      assert before.gas[k2] == o && o in before.gas && 1 <= o.row <= |before.rows|;
      assert (if 0 <= o.row - 1 < |before.rows| then before.rows[o.row - 1] else noRow).wallet == r0.wallet;
      assert after.rows[o.row - 1].wallet == before.rows[o.row - 1].wallet;
    } else if k2 == gIdx {
      assert before.gas[k1] == g && g in before.gas && 1 <= g.row <= |before.rows|;
      assert (if 0 <= g.row - 1 < |before.rows| then before.rows[g.row - 1] else noRow).wallet == r0.wallet;
      assert after.rows[g.row - 1].wallet == before.rows[g.row - 1].wallet;
    } else {
      assert before.gas[k1] == g && g in before.gas && 1 <= g.row <= |before.rows|;
      assert before.gas[k2] == o && o in before.gas && 1 <= o.row <= |before.rows|;
      assert after.rows[g.row - 1].wallet == before.rows[g.row - 1].wallet;
      assert after.rows[o.row - 1].wallet == before.rows[o.row - 1].wallet;
    }
  }
}

lemma SignPreservesResOnly(before: Fee, after: Fee, runId: int, send: SignedSend, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires after.network == before.network && after.clock == before.clock
  requires 0 <= idx < |before.rows| && before.rows[idx] == pendingIntent(before, runId)
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx] == ownReservation(before, runId)
  requires before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires before.gas[gIdx].state.Reserved? && before.gas[gIdx].runId == runId
  requires send.tx > 0 && !txUsed(before, send.tx) && send.nonce == before.gas[gIdx].nonce
  requires if before.network.Solana? then send.blockhashSlot > 0 else send.blockhashSlot == 0
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].wallet == before.rows[idx].wallet && after.rows[idx].nonce == send.nonce && after.rows[idx].state.Submitted?
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx] == before.gas[gIdx].(state := GasState.Signed, row := before.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, txUsed;
  GasDistinctById(before);
  var g0 := before.gas[gIdx];
  assert g0 in before.gas;
  assert day(after) == day(before) by { reveal day; }
  assert forall g :: g in after.gas ==> !g.state.Reserved? by {
    reveal alwaysLeaseIdentity;
    forall g | g in after.gas ensures !g.state.Reserved? {
      var k :| 0 <= k < |after.gas| && after.gas[k] == g;
      if k != gIdx {
        assert before.gas[k] in before.gas;
        if before.gas[k].state.Reserved? { assert before.gas[k].id == g0.id; }
      }
    }
  }
  assert forall g :: g in after.gas ==> g.maximum > 0 && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(after.network)) && (g.imported ==> g.state.Signed?) && g.actual >= 0 && (g.settled ==> g.state.Signed? && g.settledDay <= day(after)) && (g.state.Signed? ==> g.tx > 0 && (if after.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0)) by {
    reveal alwaysReservationsWithinTransaction;
    forall g | g in after.gas ensures g.maximum > 0 && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(after.network)) && (g.imported ==> g.state.Signed?) && g.actual >= 0 && (g.settled ==> g.state.Signed? && g.settledDay <= day(after)) && (g.state.Signed? ==> g.tx > 0 && (if after.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0)) {
      var k :| 0 <= k < |after.gas| && after.gas[k] == g;
      if k != gIdx { assert before.gas[k] in before.gas; }
    }
  }
  assert forall g, o :: g in after.gas && o in after.gas && g.tx > 0 && o.tx == g.tx ==> o.id == g.id by {
    reveal alwaysReservationsWithinTransaction;
    forall g, o | g in after.gas && o in after.gas && g.tx > 0 && o.tx == g.tx ensures o.id == g.id {
      var k1 :| 0 <= k1 < |after.gas| && after.gas[k1] == g;
      var k2 :| 0 <= k2 < |after.gas| && after.gas[k2] == o;
      if k1 != gIdx { assert before.gas[k1] in before.gas; }
      if k2 != gIdx { assert before.gas[k2] in before.gas; }
    }
  }
  SignPreservesResWallet(before, after, runId, send, idx, gIdx);
  ResFromConjuncts(after);
}

lemma SignPreservesOpenSendHeld(before: Fee, after: Fee, runId: int, send: SignedSend, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires 0 <= idx < |before.rows| && before.rows[idx] == pendingIntent(before, runId)
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx] == ownReservation(before, runId)
  requires before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires before.gas[gIdx].state.Reserved? && before.gas[gIdx].runId == runId
  requires send.nonce == before.gas[gIdx].nonce
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].state.Submitted? && after.rows[idx].nonce == send.nonce && |after.rows[idx].attempts| == 1 && after.rows[idx].attempts[0].tx == send.tx
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx] == before.gas[gIdx].(state := GasState.Signed, row := before.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot)
  ensures alwaysOpenSendHeld(after)
{
  hide *;
  reveal inv;
  ReservedNotSettled(before);
  var r0 := before.rows[idx];
  var g0 := before.gas[gIdx];
  assert r0 in before.rows && g0 in before.gas;
  assert forall r :: r in before.rows && (r.state.Submitted? || r.state.Unknown?) ==> r.nonce != g0.nonce by {
    reveal alwaysReservationsWithinTransaction;
  }
  reveal alwaysOpenSendHeld;
  assert after.gas[gIdx] in after.gas;
  forall r | r in after.rows && (r.state.Submitted? || r.state.Unknown?) ensures |r.attempts| > 0 && (forall a :: a in r.attempts ==> exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled) && (forall o :: o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ==> o.nonce != r.nonce) {
    var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
    if ri == idx {
      forall a | a in r.attempts ensures exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled {
        assert a == r.attempts[0];
        assert after.gas[gIdx].row == r.id && after.gas[gIdx].tx == a.tx && after.gas[gIdx].state.Signed? && !after.gas[gIdx].settled;
      }
      forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ensures o.nonce != r.nonce {
        var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
        if oi != idx { assert before.rows[oi] in before.rows; }
      }
    } else {
      assert before.rows[ri] == r && r in before.rows;
      forall a | a in r.attempts ensures exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled {
        var g :| g in before.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled;
        var gi :| 0 <= gi < |before.gas| && before.gas[gi] == g;
        assert gi != gIdx && after.gas[gi] == g && g in after.gas;
      }
      forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ensures o.nonce != r.nonce {
        var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
        if oi != idx { assert before.rows[oi] in before.rows; }
      }
    }
  }
}

lemma SignPreservesSignedAttributed(before: Fee, after: Fee, send: SignedSend, idx: int, gIdx: int)
  requires inv(before)
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted?
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx].state.Reserved?
  requires send.nonce == before.gas[gIdx].nonce
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].nonce == send.nonce && |after.rows[idx].attempts| == 1 && after.rows[idx].attempts[0].tx == send.tx
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx] == before.gas[gIdx].(state := GasState.Signed, row := before.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert |r0.attempts| == 0 by { reveal alwaysRowIdentity; }
  reveal alwaysSignedRowsAttributed;
  assert after.rows[idx] in after.rows && after.rows[idx].attempts[0] in after.rows[idx].attempts;
  forall g | g in after.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
    var k :| 0 <= k < |after.gas| && after.gas[k] == g;
    if k != gIdx {
      assert before.gas[k] == g && g in before.gas;
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert r.id != r0.id;
      assert after.rows[r.id - 1] == r && r in after.rows;
    }
  }
}

lemma SignPreservesLiab(before: Fee, after: Fee, gIdx: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires 0 <= gIdx < |before.gas| && |after.gas| == |before.gas|
  requires before.gas[gIdx].state.Reserved?
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx].id == before.gas[gIdx].id && after.gas[gIdx].nonce == before.gas[gIdx].nonce && after.gas[gIdx].maximum == before.gas[gIdx].maximum && after.gas[gIdx].state.Signed? && after.gas[gIdx].settled == before.gas[gIdx].settled && after.gas[gIdx].actual == before.gas[gIdx].actual && after.gas[gIdx].settledDay == before.gas[gIdx].settledDay && after.gas[gIdx].imported == before.gas[gIdx].imported
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv, alwaysLiabilityWithinDay, alwaysReservationsWithinTransaction;
  assert day(after) == day(before) by { reveal day; }
  JournaledGasDef(before);
  JournaledGasDef(after);
  var p := (g: Reservation) => !(g.imported);
  assert before.gas[gIdx] in before.gas;
  assert p(before.gas[gIdx]) && p(after.gas[gIdx]);
  assert after.gas == before.gas[gIdx := after.gas[gIdx]];
  var j := FilterUpdateSamePred(p, before.gas, gIdx, after.gas[gIdx]);
  LiabilitySameShape(ProofLib.Filter(p, before.gas), ProofLib.Filter(p, after.gas), day(before));
}

lemma SignPreservesRestA1(before: Fee, after: Fee, runId: int, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId)
  requires after.network == before.network && after.clock == before.clock && after.lease == before.lease && after.nextRun == before.nextRun && after.rotation == before.rotation && after.runtime == before.runtime && after.holdings == before.holdings && after.vaults == before.vaults
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx].state.Reserved? && before.gas[gIdx].runId == runId
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].runId == before.rows[idx].runId && after.rows[idx].token == before.rows[idx].token
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx].state.Signed? && after.gas[gIdx].runId == before.gas[gIdx].runId
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysHoldingsIdentity(after)
{
  hide *;
  reveal inv;
  GasDistinctById(before);
  var g0 := before.gas[gIdx];
  assert before.rows[idx] in before.rows && g0 in before.gas;
  assert forall t :: holding(after, t) == holding(before, t) by { reveal holding; }
  assert forall t :: validToken(after, t) == validToken(before, t) by { reveal validToken; }
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity;
    forall i | 0 <= i < |after.gas| ensures !after.gas[i].state.Reserved? && after.gas[i].runId == before.gas[i].runId {
      assert before.gas[i] in before.gas;
      if i != gIdx && before.gas[i].state.Reserved? { assert before.gas[i].id == g0.id; }
    }
    forall i | 0 <= i < |after.rows| ensures after.rows[i].runId == before.rows[i].runId { assert before.rows[i] in before.rows; }
  }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity;
    forall i | 0 <= i < |after.rows| ensures after.rows[i].token == before.rows[i].token { assert before.rows[i] in before.rows; }
  }
}

lemma SignPreservesRestA2(before: Fee, after: Fee, send: SignedSend, idx: int)
  requires inv(before)
  requires after.network == before.network && after.holdings == before.holdings && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted? && before.rows[idx].live
  requires send.gasLimit > 0 && send.fees.maxFee > 0 && send.fees.priority >= 0 && send.fees.priority <= send.fees.maxFee
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(kind := send.kind, state := RowState.Submitted, nonce := send.nonce, gasLimit := send.gasLimit, deadline := send.deadline, minimumOutput := (if send.kind.Approval? then 0 else send.minimumOutput), attempts := [Attempt(send.tx, send.fees.maxFee, send.fees.priority, before.clock)])
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysDryRowsNeverSign(after)
{
  hide *;
  reveal inv;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert forall t :: evaluated(after, t) == evaluated(before, t) by { reveal evaluated, holding; }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained, alwaysRowIdentity;
    assert r0.kind.Conversion?;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
}

lemma SignPreservesAppendOnly(before: Fee, after: Fee, idx: int, gIdx: int)
  requires inv(before)
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted? && before.rows[idx].live
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx].state.Reserved?
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].token == before.rows[idx].token
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx].id == before.gas[gIdx].id && after.gas[gIdx].nonce == before.gas[gIdx].nonce && after.gas[gIdx].maximum == before.gas[gIdx].maximum && after.gas[gIdx].runId == before.gas[gIdx].runId
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv;
  ReservedNotSettled(before);
  assert before.rows[idx] in before.rows && before.gas[gIdx] in before.gas;
  reveal stepJournalAppendOnly, rowFrozen, settledState;
  forall i | 0 <= i < |before.rows| ensures after.rows[i] in after.rows {}
  forall i | 0 <= i < |before.gas| ensures after.gas[i] in after.gas {}
}

lemma SignPreservesSteps(before: Fee, after: Fee, runId: int, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId) && before.runtime.converterMode.Live?
  requires after.scans == before.scans && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted? && before.rows[idx].live
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx].state.Reserved?
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].token == before.rows[idx].token && after.rows[idx].amountIn == before.rows[idx].amountIn && after.rows[idx].valueMicro == before.rows[idx].valueMicro && after.rows[idx].state.Submitted? && after.rows[idx].reason == before.rows[idx].reason
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx].id == before.gas[gIdx].id
  ensures alwaysRowIdentity(after)
  ensures stepStaleRunCannotSign(before, "sign", after)
  ensures stepRotationBlocksRuns(before, "sign", after)
  ensures stepRotationOnlyWhenQuiet(before, "sign", after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, "sign", after)
  ensures stepSignaturesNeedLive(before, "sign", after)
{
  hide *;
  reveal inv;
  assert before.rows[idx] in before.rows;
  assert forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].amountIn > 0 && after.rows[i].valueMicro >= 0 && (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) && (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i] in before.rows {}
  }
  RowIdentityFromPointwise(before, after);
  assert stepStaleRunCannotSign(before, "sign", after) by { reveal stepStaleRunCannotSign; }
  assert stepRotationBlocksRuns(before, "sign", after) by { reveal stepRotationBlocksRuns, alwaysRotationExcludesRuns, runHolds, leaseHeld; }
  assert stepRotationOnlyWhenQuiet(before, "sign", after) by { reveal stepRotationOnlyWhenQuiet; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
  assert stepReplacementNeedsActivation(before, "sign", after) by { reveal stepReplacementNeedsActivation; }
  assert stepSignaturesNeedLive(before, "sign", after) by { reveal stepSignaturesNeedLive; }
}

lemma SignPreservesRestAll(before: Fee, after: Fee, runId: int, send: SignedSend, idx: int, gIdx: int)
  requires inv(before) && leaseHeld(before, runId) && before.runtime.converterMode.Live?
  requires after.network == before.network && after.clock == before.clock && after.lease == before.lease && after.nextRun == before.nextRun && after.rotation == before.rotation && after.runtime == before.runtime && after.holdings == before.holdings && after.vaults == before.vaults && after.scans == before.scans && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && before.rows[idx].state.Quoted? && before.rows[idx].live && before.rows[idx].runId == runId
  requires 0 <= gIdx < |before.gas| && before.gas[gIdx].state.Reserved? && before.gas[gIdx].runId == runId
  requires send.gasLimit > 0 && send.fees.maxFee > 0 && send.fees.priority >= 0 && send.fees.priority <= send.fees.maxFee
  requires |after.rows| == |before.rows| && |after.gas| == |before.gas|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(kind := send.kind, state := RowState.Submitted, nonce := send.nonce, gasLimit := send.gasLimit, deadline := send.deadline, minimumOutput := (if send.kind.Approval? then 0 else send.minimumOutput), attempts := [Attempt(send.tx, send.fees.maxFee, send.fees.priority, before.clock)])
  requires forall i :: 0 <= i < |before.gas| && i != gIdx ==> after.gas[i] == before.gas[i]
  requires after.gas[gIdx] == before.gas[gIdx].(state := GasState.Signed, row := before.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot)
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepStaleRunCannotSign(before, "sign", after)
  ensures stepRotationBlocksRuns(before, "sign", after)
  ensures stepRotationOnlyWhenQuiet(before, "sign", after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, "sign", after)
  ensures stepSignaturesNeedLive(before, "sign", after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  SignPreservesRestA1(before, after, runId, idx, gIdx);
  SignPreservesRestA2(before, after, send, idx);
  SignPreservesAppendOnly(before, after, idx, gIdx);
  SignPreservesSteps(before, after, runId, idx, gIdx);
}

lemma ImportRecordedPreservesFolds(before: Fee, after: Fee, runId: int, recorded: RecordedSend, row: Row)
  requires inv(before) && canImportRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  requires after == importRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  requires row == after.rows[|before.rows|]
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, canImportRecorded, importRecorded, noRow;
  assert after.rows == before.rows + [row];
  OpenRowsZeroImpliesNone(before, recorded.token);
  forall tok ensures openAmount(after, tok) == openAmount(before, tok) + (if isOpen(row) && row.kind.Conversion? && row.token == tok then row.amountIn else 0) &&
    openClaims(after, tok) == openClaims(before, tok) + (if isOpen(row) && row.kind.Claim? && row.token == tok then row.amountIn else 0) &&
    openRows(after, tok) == openRows(before, tok) + (if isOpen(row) && row.token == tok then 1 else 0) {
    RowAppendOpenFolds(before, after, row, tok);
  }
  assert isOpen(row) by { reveal isOpen; }
  assert dayValue(after) == dayValue(before) + (if recorded.kind.Conversion? then recorded.valueMicro else 0) by {
    reveal dayValue, dayMs;
    ProofLib.FoldLeftAppend((t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t), 0, before.rows, row);
  }
  var h0 := holding(before, recorded.token);
  assert h0 == before.holdings[recorded.token - 1] && h0 in before.holdings && h0.token == recorded.token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  if recorded.kind.Claim? {
    WithHoldingShape(before, recorded.token, h0.(accrued := h0.accrued - recorded.amountIn));
  }
  assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
  assert alwaysTopUpsNeverSold(after) by {
    reveal alwaysTopUpsNeverSold, spendable, perTransactionReserve, fees__runtime_transactionCeilingOf, holding, validToken;
    if recorded.kind.Conversion? {
      assert recorded.amountIn <= h0.balance && h0.sold + recorded.amountIn <= h0.feeIncome;
    }
  }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures finalizedOutput(after, h.token) == finalizedOutput(before, h.token) &&
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows, row);
    }
  }
}

lemma ImportRecordedPreservesResOnly(before: Fee, after: Fee, runId: int, recorded: RecordedSend)
  requires inv(before) && canImportRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  requires after == importRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, canImportRecorded, importRecorded, noRow, alwaysReservationsWithinTransaction, txUsed;
  NoReservedWhenOwnZero(before, runId);
  SignedGasRowInBounds(before);
  GasDistinctById(before);
  assert recordedMaximum(before, recorded) > 0 by { reveal recordedMaximum, additionalReserve; }
  assert day(after) == day(before) by { reveal day; }
}

lemma ImportRecordedPreservesOpenSignedLiab(before: Fee, after: Fee, row: Row, newG: Reservation)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.overrun == before.overrun
  requires after.rows == before.rows + [row] && after.gas == before.gas + [newG]
  requires row.id == |before.rows| + 1 && row.state.Submitted? && |row.attempts| == 1 && row.attempts[0].tx == newG.tx
  requires newG.state.Signed? && !newG.settled && newG.row == row.id && newG.nonce == row.nonce && newG.imported
  requires !exists g :: g in before.gas && g.state.Signed? && !g.settled && g.nonce == row.nonce
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv;
  assert forall r :: r in before.rows && (r.state.Submitted? || r.state.Unknown?) ==> r.nonce != row.nonce by {
    forall r | r in before.rows && (r.state.Submitted? || r.state.Unknown?) ensures r.nonce != row.nonce {
      var g := OpenRowHasUnsettledSignedGas(before, r);
      assert g.nonce != row.nonce;
    }
  }
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall g | g in before.gas ensures g in after.gas {}
    assert newG in after.gas;
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall r | r in before.rows ensures r in after.rows {}
    assert row in after.rows && row.attempts[0] in row.attempts;
  }
  assert alwaysLiabilityWithinDay(after) by {
    reveal alwaysLiabilityWithinDay;
    assert day(after) == day(before) by { reveal day; }
    JournaledGasDef(before);
    JournaledGasDef(after);
    var p := (g: Reservation) => !(g.imported);
    ProofLib.FilterAppend(p, before.gas, newG);
    assert ProofLib.Filter(p, before.gas) + [] == ProofLib.Filter(p, before.gas);
    assert journaledGas(after) == journaledGas(before);
  }
}

lemma ImportRecordedPreservesRest(before: Fee, after: Fee, runId: int, recorded: RecordedSend)
  requires inv(before) && canImportRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  requires after == importRecorded(before, runId, recorded, fees__runtime_Sender.Worker)
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepStaleRunCannotSign(before, "importRecorded", after)
  ensures stepRotationBlocksRuns(before, "importRecorded", after)
  ensures stepRotationOnlyWhenQuiet(before, "importRecorded", after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, "importRecorded", after)
  ensures stepSignaturesNeedLive(before, "importRecorded", after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv, canImportRecorded, importRecorded, noRow;
  NoReservedWhenOwnZero(before, runId);
  assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity, leaseHeld; }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
  assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent, firstAttempt; }
  assert alwaysRowIdentity(after) by {
    reveal alwaysRowIdentity;
    RowsIdsEquiv(before.rows, 0);
    RowsIdsEquiv(after.rows, 0);
    GasIdsEquiv(before.gas, 0);
    GasIdsEquiv(after.gas, 0);
  }
  assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
  assert stepStaleRunCannotSign(before, "importRecorded", after) by { reveal stepStaleRunCannotSign; }
  assert stepRotationBlocksRuns(before, "importRecorded", after) by { reveal stepRotationBlocksRuns; }
  assert stepRotationOnlyWhenQuiet(before, "importRecorded", after) by { reveal stepRotationOnlyWhenQuiet; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
  assert stepReplacementNeedsActivation(before, "importRecorded", after) by { reveal stepReplacementNeedsActivation; }
  assert stepSignaturesNeedLive(before, "importRecorded", after) by { reveal stepSignaturesNeedLive; }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly;
    forall r | r in before.rows ensures r in after.rows {}
    forall g | g in before.gas ensures g in after.gas {}
  }
}

lemma ReplaceCeilPos(f0Max: int, f0Prio: int, l0Max: int, l0Prio: int, ceil: int)
  requires l0Max > 0 && settlement__feeReplacement_nextReplacementFees(f0Max, f0Prio, l0Max, l0Prio, ceil).ok
  ensures ceil > 0
{
  hide *;
  reveal settlement__feeReplacement_nextReplacementFees, settlement__feeReplacement_lesser, settlement__feeReplacement_ceilingPercent, settlement__feeReplacement_quotient_settlement__feeReplacement, JSFloorDiv, MathAbs;
  if ceil <= 0 {
    assert l0Max * 110 + 99 >= 209;
    assert settlement__feeReplacement_ceilingPercent(l0Max, 110) >= 2;
  }
}

lemma ReplaceMulBound(g: int, m: int, ceil: int, avail: int)
  requires g > 0 && avail >= 0 && ceil == quotient_fees__conversion(avail, g) && 0 < m <= ceil
  ensures 0 < g * m <= avail
{
  hide *;
  reveal quotient_fees__conversion, JSFloorDiv, MathAbs;
  assert ceil == avail / g;
  assert g * ceil <= avail;
  assert g * m <= g * ceil;
}

lemma ReplaceFeeMath(f: Fee, r: Row)
  requires inv(f) && !f.network.Solana? && r in f.rows && |r.attempts| > 0
  requires replacementFees(f, r).ok
  ensures var stepped := replacementFees(f, r);
    r.gasLimit > 0 &&
    stepped.maxFee >= firstAttempt(r).maxFee &&
    stepped.maxFee <= firstAttempt(r).maxFee * 3 &&
    stepped.maxFee > 0 &&
    stepped.priorityFee >= 0 &&
    stepped.priorityFee <= stepped.maxFee &&
    r.gasLimit * stepped.maxFee + additionalReserve(f.network) > 0 &&
    r.gasLimit * stepped.maxFee + additionalReserve(f.network) <= fees__runtime_transactionCeilingOf(f.network)
{
  hide *;
  reveal inv, alwaysAttemptsKeepContent, firstAttempt, latestAttempt, replacementFees;
  var f0 := firstAttempt(r);
  var l0 := latestAttempt(r);
  assert f0 in r.attempts && l0 in r.attempts;
  assert r.gasLimit > 0 && f0.maxFee > 0 && f0.priority >= 0 && l0.maxFee >= f0.maxFee && l0.maxFee > 0 && l0.priority >= 0;
  var ceil := perGasCeiling(f, r);
  var stepped := replacementFees(f, r);
  ReplaceCeilPos(f0.maxFee, f0.priority, l0.maxFee, l0.priority, ceil);
  settlement__feeReplacement_lawReplacementBounded_ensures(f0.maxFee, f0.priority, l0.maxFee, l0.priority, ceil);
  assert settlement__feeReplacement_validInputs(f0.maxFee, f0.priority, l0.maxFee, l0.priority, ceil) by {
    reveal settlement__feeReplacement_validInputs;
  }
  reveal settlement__feeReplacement_lawReplacementBounded;
  assert stepped.maxFee >= l0.maxFee >= f0.maxFee > 0 && stepped.priorityFee >= 0;
  var avail := fees__runtime_transactionCeilingOf(f.network) - additionalReserve(f.network);
  assert avail >= 0 && additionalReserve(f.network) >= 0 && ceil == quotient_fees__conversion(avail, r.gasLimit) by {
    reveal perGasCeiling, additionalReserve, fees__runtime_transactionCeilingOf;
  }
  ReplaceMulBound(r.gasLimit, stepped.maxFee, ceil, avail);
}

lemma ReplacePreservesFolds(before: Fee, after: Fee, runId: int, id: int, tx: int, networkFee: NetworkFeeObservation, idx: int)
  requires inv(before) && canReplace(before, runId, id, tx, networkFee, fees__runtime_Sender.Worker)
  requires after == replace(before, runId, id, tx, networkFee, fees__runtime_Sender.Worker)
  requires 0 <= idx < |before.rows| && idx == id - 1
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
  ensures forall r :: pendingIntent(after, r) == pendingIntent(before, r)
{
  hide *;
  reveal inv, canReplace, replace, isOpen;
  RowsPositional(before);
  var r0 := before.rows[idx];
  RowUpdatePreservesReceipts(before, after, idx);
  forall tok ensures openAmount(after, tok) == openAmount(before, tok) {
    reveal openAmount;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then (t + r.amountIn) else t);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall tok ensures openClaims(after, tok) == openClaims(before, tok) {
    reveal openClaims;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then (t + r.amountIn) else t);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall tok ensures openRows(after, tok) == openRows(before, tok) {
    reveal openRows;
    var f := (t: int, r: Row) => (if (isOpen(r) && (r.token == tok)) then (t + 1) else t);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  assert dayValue(after) == dayValue(before) by {
    reveal dayValue;
    var f := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t);
    ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
  }
  forall r ensures pendingIntent(after, r) == pendingIntent(before, r) {
    reveal pendingIntent;
    var f := (found: Row, x: Row) => (if ((x.state.Quoted? && x.live) && (x.runId == r)) then x else found);
    ProofLib.FoldLeftPointwise(f, f, noRow, after.rows, before.rows);
  }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
}

lemma ReplacePreservesResOnly(before: Fee, after: Fee, idx: int, newRow: Row, newG: Reservation)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow.id == before.rows[idx].id && newRow.wallet == before.rows[idx].wallet && newRow.nonce == before.rows[idx].nonce && newRow.state.Submitted?
  requires after.gas == before.gas + [newG]
  requires newG.id == |before.gas| + 1 && newG.nonce == before.rows[idx].nonce && newG.state.Signed? && !newG.settled && newG.row == before.rows[idx].id
  requires newG.tx > 0 && !txUsed(before, newG.tx) && newG.actual == 0 && newG.settledDay == 0 && !newG.imported && !before.network.Solana? && newG.blockhashSlot == 0
  requires newG.maximum > 0 && newG.maximum <= fees__runtime_transactionCeilingOf(before.network)
  requires forall r :: pendingIntent(after, r) == pendingIntent(before, r)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, txUsed;
  RowsPositional(before);
  GasDistinctById(before);
  SignedGasRowInBounds(before);
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  var g0 := OpenRowHasUnsettledSignedGas(before, r0);
  assert day(after) == day(before) by { reveal day; }
  reveal alwaysReservationsWithinTransaction;
  assert g0 in before.gas && g0.row == idx + 1;
  forall g | g in after.gas ensures g.maximum > 0 && g.actual >= 0 && (g.settled ==> g.state.Signed? && g.settledDay <= day(after)) && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(after.network)) && (g.state.Signed? ==> g.tx > 0 && (if after.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0) && (forall o :: o in after.gas && o.tx == g.tx ==> o.id == g.id) && (!g.settled ==> forall o :: o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ==> (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == (if 0 <= (g.row - 1) < |after.rows| then (after.rows)[g.row - 1] else noRow).wallet)) && (g.imported ==> g.state.Signed?) && (g.state.Reserved? ==> g.row == 0 && !g.settled && g.blockhashSlot == 0 && g.tx == 0 && pendingIntent(after, g.runId).id > 0 && (forall o :: o in after.rows && (o.state.Submitted? || o.state.Unknown?) ==> o.nonce != g.nonce) && (forall o :: o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ==> (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == pendingIntent(after, g.runId).wallet)) {
    if g == newG {
      assert (if 0 <= (newG.row - 1) < |after.rows| then (after.rows)[newG.row - 1] else noRow).wallet == r0.wallet;
      forall o | o in after.gas && o.tx == newG.tx ensures o.id == newG.id {
        if o in before.gas { assert o.tx != newG.tx; }
      }
      forall o | o in after.gas && o.state.Signed? && !o.settled && o.nonce == newG.nonce ensures (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == r0.wallet {
        if o in before.gas {
          assert 1 <= o.row <= |before.rows|;
          assert (if 0 <= (o.row - 1) < |before.rows| then (before.rows)[o.row - 1] else noRow).wallet == (if 0 <= (g0.row - 1) < |before.rows| then (before.rows)[g0.row - 1] else noRow).wallet;
          assert (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == before.rows[o.row - 1].wallet;
        }
      }
    } else {
      assert g in before.gas;
      if g.state.Signed? {
        assert 1 <= g.row <= |before.rows|;
        assert (if 0 <= (g.row - 1) < |after.rows| then (after.rows)[g.row - 1] else noRow).wallet == before.rows[g.row - 1].wallet;
        if !g.settled {
          forall o | o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ensures (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == (if 0 <= (g.row - 1) < |after.rows| then (after.rows)[g.row - 1] else noRow).wallet {
            if o == newG {
              assert (if 0 <= (g.row - 1) < |before.rows| then (before.rows)[g.row - 1] else noRow).wallet == (if 0 <= (g0.row - 1) < |before.rows| then (before.rows)[g0.row - 1] else noRow).wallet;
            } else {
              assert o in before.gas && 1 <= o.row <= |before.rows|;
              assert (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == before.rows[o.row - 1].wallet;
            }
          }
        }
      }
      if g.state.Reserved? {
        assert g.nonce != r0.nonce;
        forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) ensures o.nonce != g.nonce {
          var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
          if oi != idx { assert before.rows[oi] in before.rows; }
        }
        forall o | o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ensures (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == pendingIntent(after, g.runId).wallet {
          assert o != newG && o in before.gas && 1 <= o.row <= |before.rows|;
          assert (if 0 <= (o.row - 1) < |after.rows| then (after.rows)[o.row - 1] else noRow).wallet == before.rows[o.row - 1].wallet;
        }
      }
    }
  }
}

lemma ReplacePreservesOpenSendHeld(before: Fee, after: Fee, idx: int, newRow: Row, newG: Reservation)
  requires inv(before)
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow.id == before.rows[idx].id && newRow.nonce == before.rows[idx].nonce && newRow.state.Submitted?
  requires |newRow.attempts| == |before.rows[idx].attempts| + 1
  requires forall k :: 0 <= k < |before.rows[idx].attempts| ==> newRow.attempts[k] == before.rows[idx].attempts[k]
  requires newRow.attempts[|before.rows[idx].attempts|].tx == newG.tx
  requires after.gas == before.gas + [newG]
  requires newG.state.Signed? && !newG.settled && newG.row == before.rows[idx].id && newG.nonce == before.rows[idx].nonce
  ensures alwaysOpenSendHeld(after)
{
  hide *;
  reveal inv, alwaysOpenSendHeld;
  forall g | g in before.gas ensures g in after.gas {}
  assert newG in after.gas;
  forall r | r in after.rows && (r.state.Submitted? || r.state.Unknown?) ensures |r.attempts| > 0 && (forall a :: a in r.attempts ==> exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled) && (forall o :: o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ==> o.nonce != r.nonce) {
    var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
    assert before.rows[ri] in before.rows;
    if ri == idx {
      forall a | a in r.attempts ensures exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled {
        var k :| 0 <= k < |r.attempts| && r.attempts[k] == a;
        if k < |before.rows[idx].attempts| {
          assert a == before.rows[idx].attempts[k] && a in before.rows[idx].attempts;
          var g :| g in before.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled;
          assert g in after.gas;
        } else {
          assert a.tx == newG.tx && newG.row == r.id;
        }
      }
    } else {
      forall a | a in r.attempts ensures exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled {
        var g :| g in before.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled;
        assert g in after.gas;
      }
    }
    forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ensures o.nonce != r.nonce {
      var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
      assert before.rows[oi] in before.rows;
    }
  }
}

lemma ReplacePreservesSignedAttributed(before: Fee, after: Fee, idx: int, newRow: Row, newG: Reservation, tx: int)
  requires inv(before)
  requires 0 <= idx < |before.rows|
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow.id == before.rows[idx].id && newRow.nonce == before.rows[idx].nonce && |newRow.attempts| == |before.rows[idx].attempts| + 1
  requires forall k :: 0 <= k < |before.rows[idx].attempts| ==> newRow.attempts[k] == before.rows[idx].attempts[k]
  requires newRow.attempts[|before.rows[idx].attempts|].tx == tx
  requires after.gas == before.gas + [newG]
  requires newG.state.Signed? && newG.row == before.rows[idx].id && newG.nonce == before.rows[idx].nonce && newG.tx == tx
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  var r0 := before.rows[idx];
  reveal alwaysSignedRowsAttributed;
  assert after.rows[idx] in after.rows;
  assert after.rows[idx].attempts[|r0.attempts|] in after.rows[idx].attempts;
  forall g | g in after.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
    if g in before.gas {
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert after.rows[r.id - 1] in after.rows;
      if r.id == r0.id {
        var a :| a in r.attempts && a.tx == g.tx;
        var k :| 0 <= k < |r0.attempts| && r0.attempts[k] == a;
        assert newRow.attempts[k] == a && a in newRow.attempts;
      }
    } else {
      assert g == newG;
    }
  }
}

lemma ReplacePreservesRestA(before: Fee, after: Fee, runId: int, idx: int, newRow: Row, newG: Reservation, tx: int, stepped: settlement__feeReplacement_Fees)
  requires inv(before) && leaseHeld(before, runId)
  requires after.network == before.network && after.clock == before.clock && after.lease == before.lease && after.nextRun == before.nextRun && after.rotation == before.rotation && after.runtime == before.runtime && after.holdings == before.holdings && after.vaults == before.vaults && after.scans == before.scans && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?) && before.rows[idx].live && |before.rows[idx].attempts| > 0
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow == before.rows[idx].(state := RowState.Submitted, reason := Reason.NoReason, attempts := before.rows[idx].attempts + [Attempt(tx, stepped.maxFee, stepped.priorityFee, before.clock)])
  requires after.gas == before.gas + [newG]
  requires newG.id == |before.gas| + 1 && newG.runId == runId && newG.state.Signed?
  requires stepped.maxFee >= firstAttempt(before.rows[idx]).maxFee && stepped.maxFee <= firstAttempt(before.rows[idx]).maxFee * 3 && stepped.maxFee > 0 && stepped.priorityFee >= 0 && stepped.priorityFee <= stepped.maxFee
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysDryRowsNeverSign(after)
{
  hide *;
  reveal inv;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert forall t :: holding(after, t) == holding(before, t) by { reveal holding; }
  assert forall t :: validToken(after, t) == validToken(before, t) by { reveal validToken; }
  assert forall t :: evaluated(after, t) == evaluated(before, t) by { reveal evaluated; }
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity, leaseHeld;
    forall i | 0 <= i < |after.rows| ensures after.rows[i].runId == before.rows[i].runId { assert before.rows[i] in before.rows; }
  }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity;
    forall i | 0 <= i < |after.rows| ensures after.rows[i].token == before.rows[i].token { assert before.rows[i] in before.rows; }
  }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained;
    forall i | 0 <= i < |after.rows| ensures after.rows[i].token == before.rows[i].token && after.rows[i].kind == before.rows[i].kind { assert before.rows[i] in before.rows; }
  }
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    assert firstAttempt(after.rows[idx]) == firstAttempt(r0);
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
}

lemma RowIdentityAppendGas(before: Fee, after: Fee, newG: Reservation)
  requires alwaysRowIdentity(before)
  requires after.rows == before.rows && after.gas == before.gas + [newG] && newG.id == |before.gas| + 1
  ensures alwaysRowIdentity(after)
{
  hide *;
  GasDistinctById(before);
  GasIdsEquiv(after.gas, 0);
  reveal alwaysRowIdentity;
  forall g | g in after.gas ensures g.id > 0 && (if 0 <= g.id - 1 < |after.gas| then after.gas[g.id - 1] else noGas).id == g.id {
    var i :| 0 <= i < |after.gas| && after.gas[i] == g;
    assert g.id == i + 1;
  }
}

lemma ReplacePreservesRowId(before: Fee, after: Fee, idx: int, newRow: Row, newG: Reservation)
  requires alwaysRowIdentity(before)
  requires 0 <= idx < |before.rows| && |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow.id == before.rows[idx].id && newRow.amountIn == before.rows[idx].amountIn && newRow.valueMicro == before.rows[idx].valueMicro && newRow.state.Submitted? && newRow.reason.NoReason?
  requires after.gas == before.gas + [newG] && newG.id == |before.gas| + 1
  ensures alwaysRowIdentity(after)
{
  hide *;
  var mid := after.(gas := before.gas);
  assert forall i :: 0 <= i < |before.rows| ==> mid.rows[i].id == before.rows[i].id && mid.rows[i].amountIn > 0 && mid.rows[i].valueMicro >= 0 && (mid.rows[i].state.Quoted? ==> mid.rows[i].kind.Conversion? && |mid.rows[i].attempts| == 0) && (mid.rows[i].reason.ExpiredUnlanded? ==> mid.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i] in before.rows {}
  }
  RowIdentityFromPointwise(before, mid);
  RowIdentityAppendGas(mid, after, newG);
}

lemma ReplacePreservesSteps(before: Fee, after: Fee, runId: int, idx: int, newRow: Row, newG: Reservation)
  requires inv(before) && leaseHeld(before, runId) && fees__runtime_replacementSigns(before.runtime, before.network) && before.runtime.converterMode.Live?
  requires after.scans == before.scans && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == newRow
  requires newRow.id == before.rows[idx].id && newRow.token == before.rows[idx].token && newRow.kind == before.rows[idx].kind
  requires after.gas == before.gas + [newG] && newG.runId == runId
  ensures stepStaleRunCannotSign(before, "replace", after)
  ensures stepRotationBlocksRuns(before, "replace", after)
  ensures stepRotationOnlyWhenQuiet(before, "replace", after)
  ensures stepEvidencePermanent(before, after)
  ensures stepReplacementNeedsActivation(before, "replace", after)
  ensures stepSignaturesNeedLive(before, "replace", after)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv, fees__runtime_replacementSigns;
  assert stepStaleRunCannotSign(before, "replace", after) by { reveal stepStaleRunCannotSign, leaseHeld; }
  assert stepRotationBlocksRuns(before, "replace", after) by { reveal stepRotationBlocksRuns, alwaysRotationExcludesRuns, runHolds, leaseHeld; }
  assert stepRotationOnlyWhenQuiet(before, "replace", after) by { reveal stepRotationOnlyWhenQuiet; }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
  assert stepReplacementNeedsActivation(before, "replace", after) by { reveal stepReplacementNeedsActivation; }
  assert stepSignaturesNeedLive(before, "replace", after) by { reveal stepSignaturesNeedLive; }
  assert stepJournalAppendOnly(before, after) by {
    reveal stepJournalAppendOnly, rowFrozen, settledState;
    forall i | 0 <= i < |before.rows| ensures after.rows[i] in after.rows {}
    forall g | g in before.gas ensures g in after.gas {}
  }
}

lemma ClaimPreservesFolds(before: Fee, after: Fee, runId: int, vaultClaim: VaultClaim, row: Row, token: int)
  requires inv(before) && canClaim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  requires after == claim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  requires token == vaultOf(before, vaultClaim.vault).token
  requires row == after.rows[|before.rows|]
  ensures validToken(before, token)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, canClaim, claim, claimAdmitted, noRow;
  assert after.rows == before.rows + [row];
  var v := vaultOf(before, vaultClaim.vault);
  assert v in before.vaults by {
    reveal vaultOf;
    VaultOfSpecAux(before.vaults, vaultClaim.vault, ReviewedVault(0, 0, 0));
  }
  assert validToken(before, token) by { reveal alwaysHoldingsIdentity; }
  OpenRowsZeroImpliesNone(before, token);
  forall tok ensures openAmount(after, tok) == openAmount(before, tok) &&
    openClaims(after, tok) == openClaims(before, tok) + (if tok == token then vaultClaim.amount else 0) &&
    openRows(after, tok) == openRows(before, tok) + (if tok == token then 1 else 0) {
    reveal isOpen;
    RowAppendOpenFolds(before, after, row, tok);
  }
  assert dayValue(after) == dayValue(before) by {
    reveal dayValue;
    ProofLib.FoldLeftAppend((t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t), 0, before.rows, row);
  }
  var h0 := holding(before, token);
  assert h0 == before.holdings[token - 1] && h0 in before.holdings && h0.token == token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  WithHoldingShape(before, token, h0.(accrued := h0.accrued - vaultClaim.amount));
  assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity, holding, validToken; }
  assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
  assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained, evaluated, holding; }
  assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures finalizedOutput(after, h.token) == finalizedOutput(before, h.token) &&
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) ==
      Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows) {
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, before.rows, row);
      ProofLib.FoldLeftAppend((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, before.rows, row);
    }
  }
}

lemma ClaimPreservesResOnly(before: Fee, after: Fee, runId: int, vaultClaim: VaultClaim)
  requires inv(before) && canClaim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  requires after == claim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv, canClaim, claim, noRow, alwaysReservationsWithinTransaction, txUsed;
  NoReservedWhenOwnZero(before, runId);
  NonceAboveOpenAndSameWallet(before, vaultClaim.nonce);
  SignedGasRowInBounds(before);
  GasDistinctById(before);
  assert day(after) == day(before) by { reveal day; }
}

lemma ClaimPreservesOpenSignedLiab(before: Fee, after: Fee, runId: int, vaultClaim: VaultClaim)
  requires inv(before) && canClaim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  requires after == claim(before, runId, vaultClaim, fees__runtime_Sender.Worker)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv, canClaim, claim, noRow, noGas;
  NonceAboveOpenAndSameWallet(before, vaultClaim.nonce);
  var row := after.rows[|before.rows|];
  var newG := after.gas[|before.gas|];
  assert after.rows == before.rows + [row] && after.gas == before.gas + [newG];
  var maxVal := worstCase(before, vaultClaim.gasLimit, vaultClaim.fees);
  var stub := noGas.(id := (|before.gas| + 1), nonce := vaultClaim.nonce, maximum := maxVal, state := GasState.Signed, settled := false);
  LiabilityOfAppendedGas(before, after, newG, stub);
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall g | g in before.gas ensures g in after.gas {}
    assert newG in after.gas;
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall r | r in before.rows ensures r in after.rows {}
    assert row in after.rows && row.attempts[0] in row.attempts;
  }
}

lemma reserveGas_ensures(f: Fee, runId: int, nonce: int, maximum: int, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysLeaseIdentity(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysRotationOnlyOnSolana(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysRotationExcludesRuns(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysRuntimeSound(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysHoldingsIdentity(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysTopUpsNeverSold(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysAccrualFromVault(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysRunValueBounded(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysNotConvertedRetained(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysOpenSendHeld(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysSignedRowsAttributed(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysLiabilityWithinDay(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysReservationsWithinTransaction(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysOneOpenSend(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysClaimsFromReceipts(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysOutputFromReceipts(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysExpiryProven(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysAttemptsKeepContent(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysDryRowsNeverSign(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> alwaysRowIdentity(reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepStaleRunCannotSign(f, "reserveGas", reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepRotationBlocksRuns(f, "reserveGas", reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepRotationOnlyWhenQuiet(f, "reserveGas", reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepEvidencePermanent(f, reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepReplacementNeedsActivation(f, "reserveGas", reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepSignaturesNeedLive(f, "reserveGas", reserveGas(f, runId, nonce, maximum, by_)))
  ensures (inv(f) ==> canReserveGas(f, runId, nonce, maximum, by_) ==> stepJournalAppendOnly(f, reserveGas(f, runId, nonce, maximum, by_)))
{
  hide *;
  if inv(f) && canReserveGas(f, runId, nonce, maximum, by_) {
    reveal inv, canReserveGas, reserveGas, noGas;
    var after := reserveGas(f, runId, nonce, maximum, by_);
    var newG := after.gas[|f.gas|];
    var stub := noGas.(id := (|f.gas| + 1), nonce := nonce, maximum := maximum, state := GasState.Reserved, settled := false);
    assert after.gas == f.gas + [newG];
    ReserveGasPreservesRes(f, after, runId, nonce, maximum);
    LiabilityOfAppendedGas(f, after, newG, stub);
    ReserveGasPreservesRest(f, after, runId, nonce, maximum);
    PreserveSameCoreA(f, after.(gas := f.gas));
    assert forall t :: holding(after, t) == holding(f, t) by { reveal holding; }
    assert forall t :: validToken(after, t) == validToken(f, t) by { reveal validToken; }
    assert forall t :: openAmount(after, t) == openAmount(f, t) by { reveal openAmount; }
    assert forall t :: openClaims(after, t) == openClaims(f, t) by { reveal openClaims; }
    assert forall t :: openRows(after, t) == openRows(f, t) by { reveal openRows; }
    assert forall t :: evaluated(after, t) == evaluated(f, t) by { reveal evaluated; }
    assert forall t :: finalizedOutput(after, t) == finalizedOutput(f, t) by { reveal finalizedOutput; }
    assert dayValue(after) == dayValue(f) by { reveal dayValue; }
    assert alwaysHoldingsIdentity(after) by { reveal alwaysHoldingsIdentity; }
    assert alwaysTopUpsNeverSold(after) by { reveal alwaysTopUpsNeverSold; }
    assert alwaysAccrualFromVault(after) by { reveal alwaysAccrualFromVault; }
    assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
    assert alwaysNotConvertedRetained(after) by { reveal alwaysNotConvertedRetained; }
    assert alwaysOneOpenSend(after) by { reveal alwaysOneOpenSend; }
    assert alwaysClaimsFromReceipts(after) by { reveal alwaysClaimsFromReceipts; }
    assert alwaysOutputFromReceipts(after) by { reveal alwaysOutputFromReceipts; }
  }
}

lemma sign_ensures(f: Fee, runId: int, send: SignedSend, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysLeaseIdentity(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysRotationOnlyOnSolana(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysRotationExcludesRuns(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysRuntimeSound(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysHoldingsIdentity(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysTopUpsNeverSold(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysAccrualFromVault(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysRunValueBounded(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysNotConvertedRetained(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysOpenSendHeld(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysSignedRowsAttributed(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysLiabilityWithinDay(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysReservationsWithinTransaction(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysOneOpenSend(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysClaimsFromReceipts(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysOutputFromReceipts(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysExpiryProven(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysAttemptsKeepContent(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysDryRowsNeverSign(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> alwaysRowIdentity(sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepStaleRunCannotSign(f, "sign", sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepRotationBlocksRuns(f, "sign", sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepRotationOnlyWhenQuiet(f, "sign", sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepEvidencePermanent(f, sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepReplacementNeedsActivation(f, "sign", sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepSignaturesNeedLive(f, "sign", sign(f, runId, send, by_)))
  ensures (inv(f) ==> canSign(f, runId, send, by_) ==> stepJournalAppendOnly(f, sign(f, runId, send, by_)))
{
  hide *;
  if inv(f) && canSign(f, runId, send, by_) {
    reveal inv, canSign, sign, noRow, noGas;
    var after := sign(f, runId, send, by_);
    RowsPositional(f);
    GasDistinctById(f);
    var intent := pendingIntent(f, runId);
    var held := ownReservation(f, runId);
    assert intent in f.rows && intent.state.Quoted? && intent.live && intent.runId == runId by {
      reveal pendingIntent, alwaysRowIdentity;
      PendingIntentAux(f.rows, runId, noRow);
    }
    assert held in f.gas && held.state.Reserved? && held.runId == runId by {
      reveal ownReservation, alwaysRowIdentity;
      OwnReservationAux(f.gas, runId, noGas);
    }
    var idx := intent.id - 1;
    var gIdx := held.id - 1;
    assert 0 <= idx < |f.rows| && f.rows[idx] == intent;
    assert 0 <= gIdx < |f.gas| && f.gas[gIdx] == held;
    assert after.rows[idx] == f.rows[idx].(kind := send.kind, state := RowState.Submitted, nonce := send.nonce, gasLimit := send.gasLimit, deadline := send.deadline, minimumOutput := (if send.kind.Approval? then 0 else send.minimumOutput), attempts := [Attempt(send.tx, send.fees.maxFee, send.fees.priority, f.clock)]);
    assert after.gas[gIdx] == f.gas[gIdx].(state := GasState.Signed, row := f.rows[idx].id, tx := send.tx, blockhashSlot := send.blockhashSlot);
    assert f.runtime.converterMode.Live? by { reveal fees__runtime_conversionSigns; }
    SignPreservesFolds(f, after, runId, send, idx);
    SignPreservesResOnly(f, after, runId, send, idx, gIdx);
    SignPreservesOpenSendHeld(f, after, runId, send, idx, gIdx);
    SignPreservesSignedAttributed(f, after, send, idx, gIdx);
    SignPreservesLiab(f, after, gIdx);
    SignPreservesRestAll(f, after, runId, send, idx, gIdx);
  }
}

lemma importRecorded_ensures(f: Fee, runId: int, recorded: RecordedSend, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysLeaseIdentity(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysRotationOnlyOnSolana(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysRotationExcludesRuns(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysRuntimeSound(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysHoldingsIdentity(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysTopUpsNeverSold(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysAccrualFromVault(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysRunValueBounded(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysNotConvertedRetained(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysOpenSendHeld(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysSignedRowsAttributed(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysLiabilityWithinDay(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysReservationsWithinTransaction(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysOneOpenSend(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysClaimsFromReceipts(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysOutputFromReceipts(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysExpiryProven(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysAttemptsKeepContent(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysDryRowsNeverSign(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> alwaysRowIdentity(importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepStaleRunCannotSign(f, "importRecorded", importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepRotationBlocksRuns(f, "importRecorded", importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepRotationOnlyWhenQuiet(f, "importRecorded", importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepEvidencePermanent(f, importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepReplacementNeedsActivation(f, "importRecorded", importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepSignaturesNeedLive(f, "importRecorded", importRecorded(f, runId, recorded, by_)))
  ensures (inv(f) ==> canImportRecorded(f, runId, recorded, by_) ==> stepJournalAppendOnly(f, importRecorded(f, runId, recorded, by_)))
{
  hide *;
  if inv(f) && canImportRecorded(f, runId, recorded, by_) {
    reveal inv, canImportRecorded, importRecorded;
    var after := importRecorded(f, runId, recorded, by_);
    var row := after.rows[|f.rows|];
    var newG := after.gas[|f.gas|];
    ImportRecordedPreservesFolds(f, after, runId, recorded, row);
    ImportRecordedPreservesResOnly(f, after, runId, recorded);
    ImportRecordedPreservesOpenSignedLiab(f, after, row, newG);
    ImportRecordedPreservesRest(f, after, runId, recorded);
  }
}

lemma replace_ensures(f: Fee, runId: int, id: int, tx: int, networkFee: NetworkFeeObservation, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysLeaseIdentity(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysRotationOnlyOnSolana(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysRotationExcludesRuns(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysRuntimeSound(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysHoldingsIdentity(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysTopUpsNeverSold(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysAccrualFromVault(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysRunValueBounded(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysNotConvertedRetained(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysOpenSendHeld(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysSignedRowsAttributed(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysLiabilityWithinDay(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysReservationsWithinTransaction(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysOneOpenSend(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysClaimsFromReceipts(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysOutputFromReceipts(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysExpiryProven(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysAttemptsKeepContent(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysDryRowsNeverSign(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> alwaysRowIdentity(replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepStaleRunCannotSign(f, "replace", replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepRotationBlocksRuns(f, "replace", replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepRotationOnlyWhenQuiet(f, "replace", replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepEvidencePermanent(f, replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepReplacementNeedsActivation(f, "replace", replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepSignaturesNeedLive(f, "replace", replace(f, runId, id, tx, networkFee, by_)))
  ensures (inv(f) ==> canReplace(f, runId, id, tx, networkFee, by_) ==> stepJournalAppendOnly(f, replace(f, runId, id, tx, networkFee, by_)))
{
  hide *;
  if inv(f) && canReplace(f, runId, id, tx, networkFee, by_) {
    reveal inv, canReplace, replace, noRow, noGas, fees__runtime_replacementSigns;
    var after := replace(f, runId, id, tx, networkFee, by_);
    RowsPositional(f);
    var idx := id - 1;
    assert 0 <= idx < |f.rows|;
    var r0 := f.rows[idx];
    assert r0 in f.rows;
    ReplaceFeeMath(f, r0);
    var stepped := replacementFees(f, r0);
    var newRow := after.rows[idx];
    var newG := after.gas[|f.gas|];
    var stub := noGas.(id := |f.gas| + 1, nonce := r0.nonce, maximum := newG.maximum, state := GasState.Signed, settled := false);
    assert after.gas == f.gas + [newG];
    ReplacePreservesFolds(f, after, runId, id, tx, networkFee, idx);
    ReplacePreservesResOnly(f, after, idx, newRow, newG);
    ReplacePreservesOpenSendHeld(f, after, idx, newRow, newG);
    ReplacePreservesSignedAttributed(f, after, idx, newRow, newG, tx);
    LiabilityOfAppendedGas(f, after, newG, stub);
    ReplacePreservesRestA(f, after, runId, idx, newRow, newG, tx, stepped);
    ReplacePreservesRowId(f, after, idx, newRow, newG);
    ReplacePreservesSteps(f, after, runId, idx, newRow, newG);
  }
}

lemma claim_ensures(f: Fee, runId: int, vaultClaim: VaultClaim, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysLeaseIdentity(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysRotationOnlyOnSolana(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysRotationExcludesRuns(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysRuntimeSound(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysHoldingsIdentity(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysTopUpsNeverSold(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysAccrualFromVault(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysRunValueBounded(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysNotConvertedRetained(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysOpenSendHeld(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysSignedRowsAttributed(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysLiabilityWithinDay(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysReservationsWithinTransaction(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysOneOpenSend(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysClaimsFromReceipts(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysOutputFromReceipts(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysExpiryProven(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysAttemptsKeepContent(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysDryRowsNeverSign(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> alwaysRowIdentity(claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepStaleRunCannotSign(f, "claim", claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepRotationBlocksRuns(f, "claim", claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepRotationOnlyWhenQuiet(f, "claim", claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepEvidencePermanent(f, claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepReplacementNeedsActivation(f, "claim", claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepSignaturesNeedLive(f, "claim", claim(f, runId, vaultClaim, by_)))
  ensures (inv(f) ==> canClaim(f, runId, vaultClaim, by_) ==> stepJournalAppendOnly(f, claim(f, runId, vaultClaim, by_)))
{
  hide *;
  if inv(f) && canClaim(f, runId, vaultClaim, by_) {
    reveal inv, canClaim, claim, claimAdmitted, noRow;
    var after := claim(f, runId, vaultClaim, by_);
    var token := vaultOf(f, vaultClaim.vault).token;
    var row := after.rows[|f.rows|];
    var newG := after.gas[|f.gas|];
    assert after.rows == f.rows + [row] && after.gas == f.gas + [newG];
    NoReservedWhenOwnZero(f, runId);
    ClaimPreservesFolds(f, after, runId, vaultClaim, row, token);
    ClaimPreservesResOnly(f, after, runId, vaultClaim);
    ClaimPreservesOpenSignedLiab(f, after, runId, vaultClaim);
    assert alwaysLeaseIdentity(after) by { reveal alwaysLeaseIdentity, leaseHeld; }
    assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
    assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
    assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
    assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
    assert alwaysAttemptsKeepContent(after) by { reveal alwaysAttemptsKeepContent, firstAttempt; }
    assert alwaysRowIdentity(after) by {
      reveal alwaysRowIdentity;
      RowsIdsEquiv(f.rows, 0);
      RowsIdsEquiv(after.rows, 0);
      GasIdsEquiv(f.gas, 0);
      GasIdsEquiv(after.gas, 0);
    }
    assert alwaysDryRowsNeverSign(after) by { reveal alwaysDryRowsNeverSign; }
    assert stepStaleRunCannotSign(f, "claim", after) by { reveal stepStaleRunCannotSign; }
    assert stepRotationBlocksRuns(f, "claim", after) by { reveal stepRotationBlocksRuns, alwaysRotationExcludesRuns, runHolds, leaseHeld; }
    assert stepRotationOnlyWhenQuiet(f, "claim", after) by { reveal stepRotationOnlyWhenQuiet; }
    assert stepEvidencePermanent(f, after) by { reveal stepEvidencePermanent; }
    assert stepReplacementNeedsActivation(f, "claim", after) by { reveal stepReplacementNeedsActivation; }
    assert stepSignaturesNeedLive(f, "claim", after) by { reveal stepSignaturesNeedLive; }
    assert stepJournalAppendOnly(f, after) by {
      reveal stepJournalAppendOnly;
      forall r | r in f.rows ensures r in after.rows {}
      forall g | g in f.gas ensures g in after.gas {}
    }
  }
}

lemma FilterIndexMap<T>(p: T -> bool, xs: seq<T>, ys: seq<T>) returns (idx: seq<int>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> p(xs[i]) == p(ys[i])
  ensures |idx| == |ProofLib.Filter(p, xs)|
  ensures |ProofLib.Filter(p, ys)| == |idx|
  ensures forall j :: 0 <= j < |idx| ==> 0 <= idx[j] < |xs| && p(xs[idx[j]]) && ProofLib.Filter(p, xs)[j] == xs[idx[j]] && ProofLib.Filter(p, ys)[j] == ys[idx[j]]
  ensures forall j1, j2 :: 0 <= j1 < j2 < |idx| ==> idx[j1] < idx[j2]
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterNil(p, ys);
    idx := [];
  } else {
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(p, ys);
    var sub := FilterIndexMap(p, xs[1..], ys[1..]);
    var shifted := seq(|sub|, j requires 0 <= j < |sub| => sub[j] + 1);
    if p(xs[0]) {
      idx := [0] + shifted;
    } else {
      idx := shifted;
    }
  }
}

lemma SettleGasShape(before: Fee, r: Row, tx: int, actualNative: int)
  requires inv(before)
  ensures var gs := settleGas(before, r, tx, actualNative);
    |gs| == |before.gas| &&
    (forall i :: 0 <= i < |before.gas| && before.gas[i].state.Signed? ==> 1 <= before.gas[i].row <= |before.rows|) &&
    (forall i :: 0 <= i < |before.gas| ==>
      gs[i] == (if before.gas[i].state.Signed? && !before.gas[i].settled && before.gas[i].nonce == r.nonce && before.rows[before.gas[i].row - 1].wallet == r.wallet
        then before.gas[i].(settled := true, actual := (if before.gas[i].tx == tx then actualNative else 0), settledDay := day(before))
        else before.gas[i])) &&
    (forall i :: 0 <= i < |before.gas| ==>
      gs[i].id == before.gas[i].id && gs[i].runId == before.gas[i].runId && gs[i].nonce == before.gas[i].nonce &&
      gs[i].maximum == before.gas[i].maximum && gs[i].state == before.gas[i].state && gs[i].row == before.gas[i].row &&
      gs[i].tx == before.gas[i].tx && gs[i].blockhashSlot == before.gas[i].blockhashSlot && gs[i].imported == before.gas[i].imported) &&
    (forall i :: 0 <= i < |before.gas| && (before.gas[i].settled || before.gas[i].state.Abandoned?) ==> gs[i] == before.gas[i])
{
  hide *;
  SignedGasRowInBounds(before);
  reveal settleGas, noRow;
}

lemma SettleGasFilterBasic(before: Fee, tx: int, actualNative: int, jb: seq<Reservation>, idx: seq<int>)
  requires inv(before) && !overran(before, tx, actualNative) && actualNative >= 0
  requires |idx| == |jb|
  requires forall j :: 0 <= j < |idx| ==> 0 <= idx[j] < |before.gas| && jb[j] == before.gas[idx[j]]
  requires forall j1, j2 :: 0 <= j1 < j2 < |idx| ==> idx[j1] < idx[j2]
  ensures ProofLib.DistinctBy(jb, (g: Reservation) => g.id)
  ensures forall g :: g in jb ==> g.maximum > 0 && g.actual >= 0
  ensures forall a, b :: 0 <= a < |jb| && 0 <= b < |jb| && a != b && jb[a].tx > 0 ==> jb[a].tx != jb[b].tx
  ensures var txUse := if tx > 0 then tx else 0; var actUse := if tx > 0 then actualNative else 0;
    forall g :: g in jb && g.tx == txUse && !g.state.Abandoned? && !g.settled ==> actUse <= g.maximum
{
  hide *;
  reveal inv;
  GasDistinctById(before);
  assert ProofLib.DistinctBy(jb, (g: Reservation) => g.id) by {
    reveal ProofLib.DistinctBy;
    forall a, b | 0 <= a < |jb| && 0 <= b < |jb| && a != b ensures jb[a].id != jb[b].id {
      assert idx[a] != idx[b];
    }
  }
  assert forall g :: g in jb ==> g.maximum > 0 && g.actual >= 0 by {
    reveal alwaysReservationsWithinTransaction;
    forall g | g in jb ensures g.maximum > 0 && g.actual >= 0 {
      var j :| 0 <= j < |jb| && jb[j] == g;
      assert before.gas[idx[j]] in before.gas;
    }
  }
  assert forall a, b :: 0 <= a < |jb| && 0 <= b < |jb| && a != b && jb[a].tx > 0 ==> jb[a].tx != jb[b].tx by {
    reveal alwaysReservationsWithinTransaction;
    forall a, b | 0 <= a < |jb| && 0 <= b < |jb| && a != b && jb[a].tx > 0 ensures jb[a].tx != jb[b].tx {
      assert before.gas[idx[a]] in before.gas && before.gas[idx[b]] in before.gas && idx[a] != idx[b];
      if jb[a].tx == jb[b].tx {
        assert jb[a].id == jb[b].id;
      }
    }
  }
  var txUse := if tx > 0 then tx else 0;
  var actUse := if tx > 0 then actualNative else 0;
  assert forall g :: g in jb && g.tx == txUse && !g.state.Abandoned? && !g.settled ==> actUse <= g.maximum by {
    reveal overran, alwaysReservationsWithinTransaction;
    forall g | g in jb && g.tx == txUse && !g.state.Abandoned? && !g.settled ensures actUse <= g.maximum {
      var j :| 0 <= j < |jb| && jb[j] == g;
      assert before.gas[idx[j]] in before.gas;
    }
  }
}

lemma SettleGasFilterMap(before: Fee, after: Fee, r: Row, tx: int, actualNative: int, jb: seq<Reservation>, ja: seq<Reservation>, idx: seq<int>, j0: int)
  requires inv(before)
  requires after.gas == settleGas(before, r, tx, actualNative)
  requires forall g :: g in before.gas && g.state.Reserved? ==> g.nonce != r.nonce
  requires |idx| == |jb| && |ja| == |jb| && 0 <= j0 < |jb| && ja[j0] != jb[j0]
  requires forall j :: 0 <= j < |idx| ==> 0 <= idx[j] < |before.gas| && jb[j] == before.gas[idx[j]] && ja[j] == after.gas[idx[j]]
  ensures var txUse := if tx > 0 then tx else 0; var actUse := if tx > 0 then actualNative else 0;
    forall j :: 0 <= j < |jb| ==>
      if !jb[j].state.Abandoned? && !jb[j].settled && jb[j].nonce == r.nonce then
        ja[j] == jb[j].(settled := true, actual := (if jb[j].tx == txUse then actUse else 0), settledDay := day(before))
      else
        ja[j] == jb[j]
{
  hide *;
  reveal inv;
  SettleGasShape(before, r, tx, actualNative);
  var i0 := idx[j0];
  assert before.gas[i0] in before.gas;
  assert before.gas[i0].state.Signed? && !before.gas[i0].settled && before.gas[i0].nonce == r.nonce && before.rows[before.gas[i0].row - 1].wallet == r.wallet;
  var txUse := if tx > 0 then tx else 0;
  var actUse := if tx > 0 then actualNative else 0;
  reveal alwaysReservationsWithinTransaction;
  forall j | 0 <= j < |jb| ensures
    if !jb[j].state.Abandoned? && !jb[j].settled && jb[j].nonce == r.nonce then
      ja[j] == jb[j].(settled := true, actual := (if jb[j].tx == txUse then actUse else 0), settledDay := day(before))
    else
      ja[j] == jb[j] {
    var i := idx[j];
    assert before.gas[i] in before.gas;
    if !jb[j].state.Abandoned? && !jb[j].settled && jb[j].nonce == r.nonce {
      assert !jb[j].state.Reserved?;
      assert jb[j].state.Signed? && jb[j].tx > 0;
      assert (if 0 <= before.gas[i].row - 1 < |before.rows| then before.rows[before.gas[i].row - 1] else noRow).wallet ==
        (if 0 <= before.gas[i0].row - 1 < |before.rows| then before.rows[before.gas[i0].row - 1] else noRow).wallet;
      assert before.rows[before.gas[i].row - 1].wallet == r.wallet;
      assert (if jb[j].tx == tx then actualNative else 0) == (if jb[j].tx == txUse then actUse else 0);
    }
  }
}

lemma SettleGasLiability(before: Fee, after: Fee, r: Row, tx: int, actualNative: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock
  requires after.gas == settleGas(before, r, tx, actualNative)
  requires after.overrun == (before.overrun || overran(before, tx, actualNative))
  requires actualNative >= 0
  requires forall g :: g in before.gas && g.state.Reserved? ==> g.nonce != r.nonce
  ensures alwaysLiabilityWithinDay(after)
{
  hide *;
  reveal inv, alwaysLiabilityWithinDay;
  if after.overrun {
    return;
  }
  assert day(after) == day(before) by { reveal day; }
  SettleGasShape(before, r, tx, actualNative);
  JournaledGasDef(before);
  JournaledGasDef(after);
  var p := (g: Reservation) => !(g.imported);
  var jb := ProofLib.Filter(p, before.gas);
  var ja := ProofLib.Filter(p, after.gas);
  var idx := FilterIndexMap(p, before.gas, after.gas);
  if exists j0 :: 0 <= j0 < |jb| && ja[j0] != jb[j0] {
    var j0 :| 0 <= j0 < |jb| && ja[j0] != jb[j0];
    var txUse := if tx > 0 then tx else 0;
    var actUse := if tx > 0 then actualNative else 0;
    SettleGasFilterBasic(before, tx, actualNative, jb, idx);
    SettleGasFilterMap(before, after, r, tx, actualNative, jb, ja, idx, j0);
    LiabilitySettleNonce(jb, ja, r.nonce, txUse, actUse, day(before));
  } else {
    assert ja == jb;
  }
}

lemma SettleGasResWalletAndReserved(before: Fee, after: Fee, r: Row, tx: int, actualNative: int)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i].wallet == before.rows[i].wallet && after.rows[i].nonce == before.rows[i].nonce && ((after.rows[i].state.Submitted? || after.rows[i].state.Unknown?) ==> (before.rows[i].state.Submitted? || before.rows[i].state.Unknown?))
  requires forall g :: g in before.gas && g.state.Reserved? ==> pendingIntent(after, g.runId) == pendingIntent(before, g.runId)
  requires after.gas == settleGas(before, r, tx, actualNative)
  ensures forall g, o :: g in after.gas && o in after.gas && g.state.Signed? && !g.settled && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
    (if 0 <= g.row - 1 < |after.rows| then after.rows[g.row - 1] else noRow).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet
  ensures forall g :: g in after.gas && g.state.Reserved? ==>
    g.row == 0 && !g.settled && g.blockhashSlot == 0 && g.tx == 0 && pendingIntent(after, g.runId).id > 0 &&
    (forall x :: x in after.rows && (x.state.Submitted? || x.state.Unknown?) ==> x.nonce != g.nonce) &&
    (forall o :: o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
      pendingIntent(after, g.runId).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet)
{
  hide *;
  reveal inv;
  SettleGasShape(before, r, tx, actualNative);
  reveal alwaysReservationsWithinTransaction;
  forall g, o | g in after.gas && o in after.gas && g.state.Signed? && !g.settled && o.state.Signed? && !o.settled && o.nonce == g.nonce
    ensures (if 0 <= g.row - 1 < |after.rows| then after.rows[g.row - 1] else noRow).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet {
    var k1 :| 0 <= k1 < |after.gas| && after.gas[k1] == g;
    var k2 :| 0 <= k2 < |after.gas| && after.gas[k2] == o;
    assert before.gas[k1] == g && g in before.gas && before.gas[k2] == o && o in before.gas;
    assert after.rows[g.row - 1].wallet == before.rows[g.row - 1].wallet;
    assert after.rows[o.row - 1].wallet == before.rows[o.row - 1].wallet;
  }
  forall g | g in after.gas && g.state.Reserved?
    ensures g.row == 0 && !g.settled && g.blockhashSlot == 0 && g.tx == 0 && pendingIntent(after, g.runId).id > 0 &&
      (forall x :: x in after.rows && (x.state.Submitted? || x.state.Unknown?) ==> x.nonce != g.nonce) &&
      (forall o :: o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ==>
        pendingIntent(after, g.runId).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet) {
    var k :| 0 <= k < |after.gas| && after.gas[k] == g;
    assert before.gas[k] == g && g in before.gas;
    forall x | x in after.rows && (x.state.Submitted? || x.state.Unknown?) ensures x.nonce != g.nonce {
      var xi :| 0 <= xi < |after.rows| && after.rows[xi] == x;
      assert before.rows[xi] in before.rows;
    }
    forall o | o in after.gas && o.state.Signed? && !o.settled && o.nonce == g.nonce ensures pendingIntent(after, g.runId).wallet == (if 0 <= o.row - 1 < |after.rows| then after.rows[o.row - 1] else noRow).wallet {
      var j :| 0 <= j < |after.gas| && after.gas[j] == o;
      assert before.gas[j] == o && o in before.gas;
      assert after.rows[o.row - 1].wallet == before.rows[o.row - 1].wallet;
    }
  }
}

lemma SettleGasPreservesResOnly(before: Fee, after: Fee, r: Row, tx: int, actualNative: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i].wallet == before.rows[i].wallet && after.rows[i].nonce == before.rows[i].nonce && ((after.rows[i].state.Submitted? || after.rows[i].state.Unknown?) ==> (before.rows[i].state.Submitted? || before.rows[i].state.Unknown?))
  requires forall g :: g in before.gas && g.state.Reserved? ==> pendingIntent(after, g.runId) == pendingIntent(before, g.runId)
  requires after.gas == settleGas(before, r, tx, actualNative)
  requires actualNative >= 0
  ensures alwaysReservationsWithinTransaction(after)
{
  hide *;
  reveal inv;
  SettleGasShape(before, r, tx, actualNative);
  assert day(after) == day(before) by { reveal day; }
  assert forall g :: g in after.gas ==> g.maximum > 0 && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(after.network)) && (g.imported ==> g.state.Signed?) && g.actual >= 0 && (g.settled ==> g.state.Signed? && g.settledDay <= day(after)) && (g.state.Signed? ==> g.tx > 0 && (if after.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0)) by {
    reveal alwaysReservationsWithinTransaction;
    forall g | g in after.gas ensures g.maximum > 0 && (!g.imported ==> g.maximum <= fees__runtime_transactionCeilingOf(after.network)) && (g.imported ==> g.state.Signed?) && g.actual >= 0 && (g.settled ==> g.state.Signed? && g.settledDay <= day(after)) && (g.state.Signed? ==> g.tx > 0 && (if after.network.Solana? then g.blockhashSlot > 0 else g.blockhashSlot == 0)) {
      var k :| 0 <= k < |after.gas| && after.gas[k] == g;
      assert before.gas[k] in before.gas;
    }
  }
  assert forall g, o :: g in after.gas && o in after.gas && g.tx > 0 && o.tx == g.tx ==> o.id == g.id by {
    reveal alwaysReservationsWithinTransaction;
    forall g, o | g in after.gas && o in after.gas && g.tx > 0 && o.tx == g.tx ensures o.id == g.id {
      var k1 :| 0 <= k1 < |after.gas| && after.gas[k1] == g;
      var k2 :| 0 <= k2 < |after.gas| && after.gas[k2] == o;
      assert before.gas[k1] in before.gas && before.gas[k2] in before.gas;
    }
  }
  SettleGasResWalletAndReserved(before, after, r, tx, actualNative);
  ResFromConjuncts(after);
}

lemma RowCloseOpenFolds(before: Fee, after: Fee, idx: int)
  requires inv(before) && after.clock == before.clock
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].state.Finalized? || after.rows[idx].state.Failed?
  requires after.rows[idx].kind == before.rows[idx].kind && after.rows[idx].live == before.rows[idx].live && after.rows[idx].valueMicro == before.rows[idx].valueMicro && after.rows[idx].createdAt == before.rows[idx].createdAt
  ensures forall tok :: openAmount(after, tok) == openAmount(before, tok) - (if before.rows[idx].kind.Conversion? && before.rows[idx].token == tok then before.rows[idx].amountIn else 0) && openAmount(after, tok) >= 0
  ensures forall tok :: openClaims(after, tok) == openClaims(before, tok) - (if before.rows[idx].kind.Claim? && before.rows[idx].token == tok then before.rows[idx].amountIn else 0)
  ensures forall tok :: openRows(after, tok) == openRows(before, tok) - (if before.rows[idx].token == tok then 1 else 0)
  ensures dayValue(after) <= dayValue(before)
{
  hide *;
  reveal inv, isOpen;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert r0.amountIn > 0 && r0.valueMicro >= 0 by { reveal alwaysRowIdentity; }
  forall tok ensures openAmount(after, tok) == openAmount(before, tok) - (if r0.kind.Conversion? && r0.token == tok then r0.amountIn else 0) && openAmount(after, tok) >= 0 {
    reveal openAmount, alwaysRowIdentity;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
    forall i | 0 <= i < |after.rows| ensures v(after.rows[i]) >= 0 { if i != idx { assert before.rows[i] in before.rows; } }
    SumFoldNonneg(f, v, 0, after.rows);
  }
  forall tok ensures openClaims(after, tok) == openClaims(before, tok) - (if r0.kind.Claim? && r0.token == tok then r0.amountIn else 0) {
    reveal openClaims;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then r.amountIn else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  forall tok ensures openRows(after, tok) == openRows(before, tok) - (if r0.token == tok then 1 else 0) {
    reveal openRows;
    var f := (t: int, r: Row) => (if (isOpen(r) && (r.token == tok)) then (t + 1) else t);
    var v := (r: Row) => (if (isOpen(r) && (r.token == tok)) then 1 else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
  assert dayValue(after) <= dayValue(before) by {
    reveal dayValue;
    var f := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t);
    var v := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then r.valueMicro else 0);
    SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
  }
}

lemma FinalizeSendHoldingsCore(before: Fee, after: Fee, idx: int, receipt: SendReceipt, newH: Holding)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.vaults == before.vaults
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires receipt.output >= 0 && (before.rows[idx].kind.Approval? ==> receipt.output == 0) && ((before.rows[idx].kind.Claim? && receipt.succeeded) ==> receipt.output > 0)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].token == before.rows[idx].token && after.rows[idx].kind == before.rows[idx].kind && (after.rows[idx].state.Finalized? || after.rows[idx].state.Failed?)
  requires forall tok :: openAmount(after, tok) == openAmount(before, tok) - (if before.rows[idx].kind.Conversion? && before.rows[idx].token == tok then before.rows[idx].amountIn else 0) && openAmount(after, tok) >= 0
  requires forall tok :: openClaims(after, tok) == openClaims(before, tok) - (if before.rows[idx].kind.Claim? && before.rows[idx].token == tok then before.rows[idx].amountIn else 0)
  requires var r := before.rows[idx]; var credited := receipt.succeeded; var converted := credited && r.kind.Conversion?; var claimed := credited && r.kind.Claim?;
    var h := holding(before, r.token);
    newH == h.(
      balance := (if converted then h.balance - r.amountIn else if claimed then h.balance + receipt.output else h.balance),
      sold := (if converted then h.sold + r.amountIn else h.sold),
      usdcOut := (if converted then h.usdcOut + receipt.output else h.usdcOut),
      feeIncome := (if claimed then h.feeIncome + receipt.output else h.feeIncome),
      claimed := (if claimed then h.claimed + receipt.output else h.claimed),
      accrued := (if r.kind.Claim? && !credited then h.accrued + r.amountIn else h.accrued))
  requires after.holdings == withHolding(before.rows[idx].token, newH, before)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
{
  hide *;
  reveal inv;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert r0.amountIn > 0 by { reveal alwaysRowIdentity; }
  assert validToken(before, r0.token) by { reveal alwaysHoldingsIdentity; }
  var h0 := holding(before, r0.token);
  assert h0 == before.holdings[r0.token - 1] && h0 in before.holdings && h0.token == r0.token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  WithHoldingShape(before, r0.token, newH);
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    forall i | 0 <= i < |after.rows| ensures validToken(after, after.rows[i].token) { if i != idx { assert before.rows[i] in before.rows; } }
  }
  assert alwaysTopUpsNeverSold(after) by {
    reveal alwaysTopUpsNeverSold;
    forall h | h in after.holdings ensures (if h.asset.NativeAsset? then h.balance == h.feeIncome + h.topUps - h.sold else h.topUps == 0 && h.sold + h.balance <= h.feeIncome) && h.sold >= 0 && h.sold + openAmount(after, h.token) <= h.feeIncome && h.balance >= openAmount(after, h.token) && h.topUps >= 0 && h.balance >= 0 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
  assert alwaysAccrualFromVault(after) by {
    reveal alwaysAccrualFromVault;
    forall h | h in after.holdings ensures h.accrued >= 0 && h.claimed >= 0 && h.vaultObserved >= 0 && h.accrued + openClaims(after, h.token) <= h.vaultObserved {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
}

lemma FinalizeSendHoldingsRest(before: Fee, after: Fee, idx: int, receipt: SendReceipt, newH: Holding)
  requires inv(before)
  requires after.network == before.network && after.runValue == before.runValue
  requires 0 <= idx < |before.rows|
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].token == before.rows[idx].token && after.rows[idx].kind == before.rows[idx].kind
  requires dayValue(after) <= dayValue(before)
  requires forall tok :: openRows(after, tok) <= openRows(before, tok)
  requires var r := before.rows[idx]; var h := holding(before, r.token);
    newH.token == h.token && newH.asset == h.asset && newH.sold == (if receipt.succeeded && r.kind.Conversion? then h.sold + r.amountIn else h.sold)
  requires after.holdings == withHolding(before.rows[idx].token, newH, before)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
{
  hide *;
  reveal inv;
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert validToken(before, r0.token) by { reveal alwaysHoldingsIdentity; }
  var h0 := holding(before, r0.token);
  assert h0 == before.holdings[r0.token - 1] && h0 in before.holdings && h0.token == r0.token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  WithHoldingShape(before, r0.token, newH);
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained, evaluated, holding;
    forall h | h in after.holdings ensures !evaluated(after, h.token) ==> (forall r :: r in after.rows ==> r.token != h.token || !r.kind.Conversion?) && h.sold == 0 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
      if !evaluated(after, h.token) {
        assert holding(after, h.token).asset == holding(before, h.token).asset;
        forall r | r in after.rows ensures r.token != h.token || !r.kind.Conversion? {
          var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
          assert before.rows[ri] in before.rows;
        }
      }
    }
  }
  assert alwaysOneOpenSend(after) by {
    reveal alwaysOneOpenSend;
    forall h | h in after.holdings ensures openRows(after, h.token) <= 1 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
}

lemma FinalizeSendPreservesReceipts(before: Fee, after: Fee, idx: int, receipt: SendReceipt)
  requires inv(before)
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires receipt.output >= 0 && ((before.rows[idx].kind.Claim? && receipt.succeeded) ==> receipt.output > 0)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires var r := before.rows[idx]; var credited := receipt.succeeded; var converted := credited && r.kind.Conversion?; var claimed := credited && r.kind.Claim?;
    after.rows[idx] == r.(state := (if credited then RowState.Finalized else RowState.Failed),
      reason := (if !credited then Reason.Reverted else if converted && receipt.output < r.minimumOutput then Reason.BelowSignedMinimum else Reason.NoReason),
      output := (if converted || claimed then receipt.output else 0)) &&
    var h := holding(before, r.token);
    after.holdings == withHolding(r.token, h.(
      balance := (if converted then h.balance - r.amountIn else if claimed then h.balance + receipt.output else h.balance),
      sold := (if converted then h.sold + r.amountIn else h.sold),
      usdcOut := (if converted then h.usdcOut + receipt.output else h.usdcOut),
      feeIncome := (if claimed then h.feeIncome + receipt.output else h.feeIncome),
      claimed := (if claimed then h.claimed + receipt.output else h.claimed),
      accrued := (if r.kind.Claim? && !credited then h.accrued + r.amountIn else h.accrued)), before)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv;
  var r0 := before.rows[idx];
  var credited := receipt.succeeded;
  var converted := credited && r0.kind.Conversion?;
  var claimed := credited && r0.kind.Claim?;
  assert r0 in before.rows;
  assert validToken(before, r0.token) by { reveal alwaysHoldingsIdentity; }
  var h0 := holding(before, r0.token);
  assert h0 == before.holdings[r0.token - 1] && h0 in before.holdings && h0.token == r0.token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  var newH := h0.(
    balance := (if converted then h0.balance - r0.amountIn else if claimed then h0.balance + receipt.output else h0.balance),
    sold := (if converted then h0.sold + r0.amountIn else h0.sold),
    usdcOut := (if converted then h0.usdcOut + receipt.output else h0.usdcOut),
    feeIncome := (if claimed then h0.feeIncome + receipt.output else h0.feeIncome),
    claimed := (if claimed then h0.claimed + receipt.output else h0.claimed),
    accrued := (if r0.kind.Claim? && !credited then h0.accrued + r0.amountIn else h0.accrued));
  WithHoldingShape(before, r0.token, newH);
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures h.claimed == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) && h.claimed <= h.feeIncome {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
      var f := (t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t);
      var v := (r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then r.output else 0);
      SumFoldPointwiseDiff(f, v, 0, before.rows, after.rows, idx);
    }
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures h.usdcOut == finalizedOutput(after, h.token) && h.sold == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
      var fo := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t);
      var vo := (r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then r.output else 0);
      SumFoldPointwiseDiff(fo, vo, 0, before.rows, after.rows, idx);
      var fs := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t);
      var vs := (r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then r.amountIn else 0);
      SumFoldPointwiseDiff(fs, vs, 0, before.rows, after.rows, idx);
    }
  }
}

lemma RowCloseSettleGasOpenAndSigned(before: Fee, after: Fee, idx: int, tx: int, actualNative: int)
  requires inv(before)
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].nonce == before.rows[idx].nonce && after.rows[idx].attempts == before.rows[idx].attempts
  requires after.rows[idx].state.Finalized? || after.rows[idx].state.Failed?
  requires after.gas == settleGas(before, before.rows[idx], tx, actualNative)
  ensures alwaysOpenSendHeld(after)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  SettleGasShape(before, before.rows[idx], tx, actualNative);
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert alwaysOpenSendHeld(after) by {
    reveal alwaysOpenSendHeld;
    forall r | r in after.rows && (r.state.Submitted? || r.state.Unknown?) ensures (exists g :: g in after.gas && g.state.Signed? && !g.settled && g.row == r.id) && (forall o :: o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.nonce == r.nonce ==> o.id == r.id) {
      var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
      assert ri != idx && before.rows[ri] == r && r in before.rows;
      assert r.nonce != r0.nonce;
      var g := OpenRowHasUnsettledSignedGas(before, r);
      var gi :| 0 <= gi < |before.gas| && before.gas[gi] == g;
      assert after.gas[gi] == g && g in after.gas;
      forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.nonce == r.nonce ensures o.id == r.id {
        var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
        assert oi != idx && before.rows[oi] == o && o in before.rows;
      }
    }
  }
  assert alwaysSignedRowsAttributed(after) by {
    reveal alwaysSignedRowsAttributed;
    forall g | g in after.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
      var gi :| 0 <= gi < |after.gas| && after.gas[gi] == g;
      assert before.gas[gi] in before.gas;
      var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
      assert after.rows[r.id - 1] in after.rows;
    }
  }
}

lemma SettleGasPreservesCore4(before: Fee, after: Fee, r0: Row, tx: int, actualNative: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.lease == before.lease && after.nextRun == before.nextRun && after.rotation == before.rotation && after.runtime == before.runtime
  requires |after.rows| == |before.rows| && (forall i :: 0 <= i < |before.rows| ==> after.rows[i].runId == before.rows[i].runId)
  requires after.gas == settleGas(before, r0, tx, actualNative)
  ensures alwaysLeaseIdentity(after)
  ensures alwaysRotationOnlyOnSolana(after)
  ensures alwaysRotationExcludesRuns(after)
  ensures alwaysRuntimeSound(after)
{
  hide *;
  reveal inv;
  SettleGasShape(before, r0, tx, actualNative);
  assert alwaysLeaseIdentity(after) by {
    reveal alwaysLeaseIdentity;
    forall i | 0 <= i < |after.rows| ensures after.rows[i].runId == before.rows[i].runId { assert before.rows[i] in before.rows; }
    forall i | 0 <= i < |after.gas| ensures after.gas[i].runId == before.gas[i].runId && after.gas[i].state == before.gas[i].state && after.gas[i].id == before.gas[i].id { assert before.gas[i] in before.gas; }
  }
  assert alwaysRotationOnlyOnSolana(after) by { reveal alwaysRotationOnlyOnSolana; }
  assert alwaysRotationExcludesRuns(after) by { reveal alwaysRotationExcludesRuns, rotationHolds, runHolds; }
  assert alwaysRuntimeSound(after) by { reveal alwaysRuntimeSound; }
}

lemma SettleGasPreservesAppendOnly(before: Fee, after: Fee, r0: Row, tx: int, actualNative: int)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==>
    after.rows[i].id == before.rows[i].id && after.rows[i].token == before.rows[i].token && after.rows[i].kind == before.rows[i].kind &&
    (rowFrozen(before.rows[i]) ==> after.rows[i] == before.rows[i])
  requires after.gas == settleGas(before, r0, tx, actualNative)
  ensures stepJournalAppendOnly(before, after)
{
  hide *;
  reveal inv;
  SettleGasShape(before, r0, tx, actualNative);
  reveal stepJournalAppendOnly;
  forall i | 0 <= i < |before.rows| ensures after.rows[i] in after.rows {}
  forall i | 0 <= i < |before.gas| ensures after.gas[i] in after.gas {}
}

lemma FinalizeSendPreservesMisc(before: Fee, after: Fee, idx: int, tx: int, actualNative: int)
  requires inv(before)
  requires after.network == before.network && after.scans == before.scans && after.proofs == before.proofs
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx].id == before.rows[idx].id && after.rows[idx].live == before.rows[idx].live && after.rows[idx].amountIn == before.rows[idx].amountIn && after.rows[idx].valueMicro == before.rows[idx].valueMicro && after.rows[idx].gasLimit == before.rows[idx].gasLimit && after.rows[idx].attempts == before.rows[idx].attempts
  requires (after.rows[idx].state.Finalized? || after.rows[idx].state.Failed?) && !after.rows[idx].reason.ExpiredUnlanded?
  requires after.gas == settleGas(before, before.rows[idx], tx, actualNative)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepEvidencePermanent(before, after)
{
  hide *;
  reveal inv;
  SettleGasShape(before, before.rows[idx], tx, actualNative);
  assert before.rows[idx] in before.rows;
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].amountIn > 0 && after.rows[i].valueMicro >= 0 && (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) && (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i] in before.rows {}
  }
  RowIdentityFromPointwise(before, after);
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
}

lemma finalizeSend_ensures(f: Fee, runId: int, id: int, receipt: SendReceipt, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysLeaseIdentity(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysRotationOnlyOnSolana(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysRotationExcludesRuns(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysRuntimeSound(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysHoldingsIdentity(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysTopUpsNeverSold(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysAccrualFromVault(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysRunValueBounded(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysNotConvertedRetained(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysOpenSendHeld(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysSignedRowsAttributed(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysLiabilityWithinDay(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysReservationsWithinTransaction(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysOneOpenSend(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysClaimsFromReceipts(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysOutputFromReceipts(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysExpiryProven(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysAttemptsKeepContent(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysDryRowsNeverSign(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> alwaysRowIdentity(finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepStaleRunCannotSign(f, "finalizeSend", finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepRotationBlocksRuns(f, "finalizeSend", finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepRotationOnlyWhenQuiet(f, "finalizeSend", finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepEvidencePermanent(f, finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepReplacementNeedsActivation(f, "finalizeSend", finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepSignaturesNeedLive(f, "finalizeSend", finalizeSend(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canFinalizeSend(f, runId, id, receipt, by_) ==> stepJournalAppendOnly(f, finalizeSend(f, runId, id, receipt, by_)))
{
  hide *;
  if inv(f) && canFinalizeSend(f, runId, id, receipt, by_) {
    reveal inv, canFinalizeSend, finalizeSend, noRow;
    var after := finalizeSend(f, runId, id, receipt, by_);
    RowsPositional(f);
    var idx := id - 1;
    assert 0 <= idx < |f.rows|;
    var r0 := f.rows[idx];
    assert r0 in f.rows;
    assert !rowFrozen(r0) by { reveal rowFrozen, settledState; }
    assert forall g :: g in f.gas && g.state.Reserved? ==> g.nonce != r0.nonce by {
      reveal alwaysReservationsWithinTransaction;
    }
    forall g | g in f.gas && g.state.Reserved? ensures pendingIntent(after, g.runId) == pendingIntent(f, g.runId) {
      reveal pendingIntent;
      var pf := (found: Row, r: Row) => (if ((r.state.Quoted? && r.live) && (r.runId == g.runId)) then r else found);
      ProofLib.FoldLeftPointwise(pf, pf, noRow, after.rows, f.rows);
    }
    var h0 := holding(f, r0.token);
    var credited := receipt.succeeded;
    var converted := credited && r0.kind.Conversion?;
    var claimed := credited && r0.kind.Claim?;
    var newH := h0.(
      balance := (if converted then h0.balance - r0.amountIn else if claimed then h0.balance + receipt.output else h0.balance),
      sold := (if converted then h0.sold + r0.amountIn else h0.sold),
      usdcOut := (if converted then h0.usdcOut + receipt.output else h0.usdcOut),
      feeIncome := (if claimed then h0.feeIncome + receipt.output else h0.feeIncome),
      claimed := (if claimed then h0.claimed + receipt.output else h0.claimed),
      accrued := (if r0.kind.Claim? && !credited then h0.accrued + r0.amountIn else h0.accrued));
    SettleGasShape(f, r0, receipt.tx, receipt.actualNative);
    RowCloseOpenFolds(f, after, idx);
    FinalizeSendHoldingsCore(f, after, idx, receipt, newH);
    FinalizeSendHoldingsRest(f, after, idx, receipt, newH);
    FinalizeSendPreservesReceipts(f, after, idx, receipt);
    SettleGasLiability(f, after, r0, receipt.tx, receipt.actualNative);
    SettleGasPreservesResOnly(f, after, r0, receipt.tx, receipt.actualNative);
    RowCloseSettleGasOpenAndSigned(f, after, idx, receipt.tx, receipt.actualNative);
    SettleGasPreservesCore4(f, after, r0, receipt.tx, receipt.actualNative);
    SettleGasPreservesAppendOnly(f, after, r0, receipt.tx, receipt.actualNative);
    FinalizeSendPreservesMisc(f, after, idx, receipt.tx, receipt.actualNative);
    PreserveStepsOther(f, "finalizeSend", after);
  }
}

lemma SettleExpiredOpenClaimsFold(before: Fee, after: Fee, r0: Row)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  ensures forall tok :: openClaims(after, tok) + nonceLosers(before, r0, tok) == openClaims(before, tok) && nonceLosers(before, r0, tok) >= 0
{
  hide *;
  reveal inv, isOpen, reusedNonce, openClaims, nonceLosers, alwaysRowIdentity;
  forall tok ensures openClaims(after, tok) + nonceLosers(before, r0, tok) == openClaims(before, tok) && nonceLosers(before, r0, tok) >= 0 {
    var f1 := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v1 := (r: Row) => (if ((isOpen(r) && r.kind.Claim?) && (r.token == tok)) then r.amountIn else 0);
    var f2 := (t: int, x: Row) => (if ((reusedNonce(before, r0, x) && x.kind.Claim?) && (x.token == tok)) then (t + x.amountIn) else t);
    var v2 := (x: Row) => (if ((reusedNonce(before, r0, x) && x.kind.Claim?) && (x.token == tok)) then x.amountIn else 0);
    forall i | 0 <= i < |before.rows| ensures v2(before.rows[i]) + v1(after.rows[i]) == v1(before.rows[i]) && v2(before.rows[i]) >= 0 {
      assert before.rows[i] in before.rows;
    }
    SumFoldAdd(f2, v2, f1, v1, f1, v1, 0, 0, 0, before.rows, after.rows);
    SumFoldNonneg(f2, v2, 0, before.rows);
  }
}

lemma SettleExpiredOpenAmountRowsFold(before: Fee, after: Fee, r0: Row)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  ensures forall tok :: openAmount(after, tok) <= openAmount(before, tok)
  ensures forall tok :: openRows(after, tok) <= openRows(before, tok)
{
  hide *;
  reveal inv, isOpen, reusedNonce;
  forall tok ensures openAmount(after, tok) <= openAmount(before, tok) {
    reveal openAmount, alwaysRowIdentity;
    var f := (t: int, r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then (t + r.amountIn) else t);
    var v := (r: Row) => (if ((isOpen(r) && r.kind.Conversion?) && (r.token == tok)) then r.amountIn else 0);
    forall i | 0 <= i < |before.rows| ensures v(after.rows[i]) <= v(before.rows[i]) {
      assert before.rows[i] in before.rows;
    }
    SumFoldCompare(f, v, f, v, 0, 0, after.rows, before.rows);
  }
  forall tok ensures openRows(after, tok) <= openRows(before, tok) {
    reveal openRows;
    var f := (t: int, r: Row) => (if (isOpen(r) && (r.token == tok)) then (t + 1) else t);
    var v := (r: Row) => (if (isOpen(r) && (r.token == tok)) then 1 else 0);
    SumFoldCompare(f, v, f, v, 0, 0, after.rows, before.rows);
  }
}

lemma SettleExpiredDayValueFold(before: Fee, after: Fee, r0: Row)
  requires inv(before) && after.clock == before.clock
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  ensures dayValue(after) <= dayValue(before)
{
  hide *;
  assert forall i :: 0 <= i < |before.rows| ==> before.rows[i].valueMicro >= 0 by {
    reveal inv, alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i].valueMicro >= 0 {
      assert before.rows[i] in before.rows;
    }
  }
  reveal dayValue;
  var f := (t: int, r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then (t + r.valueMicro) else t);
  var v := (r: Row) => (if (((r.kind.Conversion? && r.live) && ((r.state.Submitted? || r.state.Unknown?) || r.state.Finalized?)) && (r.createdAt > (before.clock - dayMs))) then r.valueMicro else 0);
  SumFoldCompare(f, v, f, v, 0, 0, after.rows, before.rows);
}

lemma SettleExpiredOpenFolds(before: Fee, after: Fee, r0: Row)
  requires inv(before) && after.clock == before.clock
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  ensures forall tok :: openAmount(after, tok) <= openAmount(before, tok)
  ensures forall tok :: openClaims(after, tok) + nonceLosers(before, r0, tok) == openClaims(before, tok) && nonceLosers(before, r0, tok) >= 0
  ensures forall tok :: openRows(after, tok) <= openRows(before, tok)
  ensures dayValue(after) <= dayValue(before)
{
  hide *;
  SettleExpiredOpenClaimsFold(before, after, r0);
  SettleExpiredOpenAmountRowsFold(before, after, r0);
  SettleExpiredDayValueFold(before, after, r0);
}

lemma SettleExpiredPreservesHoldings(before: Fee, after: Fee, r0: Row)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.runValue == before.runValue && after.vaults == before.vaults
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  requires |after.holdings| == |before.holdings|
  requires forall i :: 0 <= i < |before.holdings| ==> after.holdings[i] == before.holdings[i].(accrued := before.holdings[i].accrued + nonceLosers(before, r0, before.holdings[i].token))
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
{
  hide *;
  reveal inv;
  SettleExpiredOpenFolds(before, after, r0);
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
    HoldingsIdsEquiv(after.holdings, 0);
    forall h | h in after.holdings ensures h.token >= 1 && holding(after, h.token) == h {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert h.token == i + 1;
    }
    forall i | 0 <= i < |after.rows| ensures validToken(after, after.rows[i].token) { assert before.rows[i] in before.rows; }
  }
  assert alwaysTopUpsNeverSold(after) by {
    reveal alwaysTopUpsNeverSold;
    forall h | h in after.holdings ensures (if h.asset.NativeAsset? then h.balance == h.feeIncome + h.topUps - h.sold else h.topUps == 0 && h.sold + h.balance <= h.feeIncome) && h.sold >= 0 && h.sold + openAmount(after, h.token) <= h.feeIncome && h.balance >= openAmount(after, h.token) && h.topUps >= 0 && h.balance >= 0 {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
    }
  }
  assert alwaysAccrualFromVault(after) by {
    reveal alwaysAccrualFromVault;
    forall h | h in after.holdings ensures h.accrued >= 0 && h.claimed >= 0 && h.vaultObserved >= 0 && h.accrued + openClaims(after, h.token) <= h.vaultObserved {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
    }
  }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained, evaluated, holding;
    forall h | h in after.holdings ensures !evaluated(after, h.token) ==> (forall r :: r in after.rows ==> r.token != h.token || !r.kind.Conversion?) && h.sold == 0 {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
      if !evaluated(after, h.token) {
        assert holding(after, h.token).asset == holding(before, h.token).asset;
        forall r | r in after.rows ensures r.token != h.token || !r.kind.Conversion? {
          var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
          assert before.rows[ri] in before.rows;
        }
      }
    }
  }
  assert alwaysOneOpenSend(after) by {
    reveal alwaysOneOpenSend;
    forall h | h in after.holdings ensures openRows(after, h.token) <= 1 {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
    }
  }
}

lemma SettleExpiredPreservesReceipts(before: Fee, after: Fee, r0: Row)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  requires |after.holdings| == |before.holdings|
  requires forall i :: 0 <= i < |before.holdings| ==> after.holdings[i].token == before.holdings[i].token && after.holdings[i].claimed == before.holdings[i].claimed && after.holdings[i].feeIncome == before.holdings[i].feeIncome && after.holdings[i].usdcOut == before.holdings[i].usdcOut && after.holdings[i].sold == before.holdings[i].sold
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv, reusedNonce;
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures h.claimed == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) && h.claimed <= h.feeIncome {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
      var f := (t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t);
      ProofLib.FoldLeftPointwise(f, f, 0, after.rows, before.rows);
    }
    forall r | r in after.rows && r.kind.Claim? && r.state.Finalized? ensures r.output > 0 {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      assert before.rows[i] == r && r in before.rows;
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures h.usdcOut == finalizedOutput(after, h.token) && h.sold == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) {
      var i :| 0 <= i < |after.holdings| && after.holdings[i] == h;
      assert before.holdings[i] in before.holdings;
      var fo := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t);
      ProofLib.FoldLeftPointwise(fo, fo, 0, after.rows, before.rows);
      var fs := (t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t);
      ProofLib.FoldLeftPointwise(fs, fs, 0, after.rows, before.rows);
    }
  }
}

lemma SettleExpiredPreservesOpenSendHeld(before: Fee, after: Fee, r0: Row, tx: int, actualNative: int)
  requires inv(before) && r0 in before.rows && r0.state.Failed?
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  requires after.gas == settleGas(before, r0, tx, actualNative)
  ensures alwaysOpenSendHeld(after)
{
  hide *;
  reveal inv, reusedNonce;
  RowsPositional(before);
  SettleGasShape(before, r0, tx, actualNative);
  reveal alwaysOpenSendHeld;
  forall r | r in after.rows && (r.state.Submitted? || r.state.Unknown?) ensures |r.attempts| > 0 && (forall a :: a in r.attempts ==> exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled) && (forall o :: o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ==> o.nonce != r.nonce) {
    var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
    assert !reusedNonce(before, r0, before.rows[ri]) && before.rows[ri] == r && r in before.rows;
    forall a | a in r.attempts ensures exists g :: g in after.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled {
      var g :| g in before.gas && g.row == r.id && g.tx == a.tx && g.state.Signed? && !g.settled;
      var gi :| 0 <= gi < |before.gas| && before.gas[gi] == g;
      assert before.rows[g.row - 1] == r;
      if g.nonce == r0.nonce && r.wallet == r0.wallet {
        assert r.id != r0.id;
        assert reusedNonce(before, r0, r);
      }
      assert after.gas[gi] == g && g in after.gas;
    }
    forall o | o in after.rows && (o.state.Submitted? || o.state.Unknown?) && o.id != r.id ensures o.nonce != r.nonce {
      var oi :| 0 <= oi < |after.rows| && after.rows[oi] == o;
      assert before.rows[oi] == o && o in before.rows;
    }
  }
}

lemma SettleExpiredPreservesSignedAttributed(before: Fee, after: Fee, r0: Row, tx: int, actualNative: int)
  requires inv(before)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].nonce == before.rows[i].nonce && after.rows[i].attempts == before.rows[i].attempts
  requires after.gas == settleGas(before, r0, tx, actualNative)
  ensures alwaysSignedRowsAttributed(after)
{
  hide *;
  reveal inv;
  RowsPositional(before);
  SettleGasShape(before, r0, tx, actualNative);
  reveal alwaysSignedRowsAttributed;
  forall g | g in after.gas && g.state.Signed? ensures exists r :: r in after.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx) {
    var gi :| 0 <= gi < |after.gas| && after.gas[gi] == g;
    assert before.gas[gi] in before.gas;
    var r :| r in before.rows && r.id == g.row && r.nonce == g.nonce && (exists a :: a in r.attempts && a.tx == g.tx);
    assert after.rows[r.id - 1] in after.rows;
  }
}

lemma SettleExpiredPreservesMisc(before: Fee, after: Fee, r0: Row, tx: int, actualNative: int)
  requires inv(before) && !before.network.Solana?
  requires after.network == before.network && after.scans == before.scans && after.proofs == before.proofs
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| ==> after.rows[i] == (if reusedNonce(before, r0, before.rows[i]) then before.rows[i].(state := RowState.Failed, reason := Reason.NonceConsumed) else before.rows[i])
  requires after.gas == settleGas(before, r0, tx, actualNative)
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepEvidencePermanent(before, after)
{
  hide *;
  reveal inv, reusedNonce;
  SettleGasShape(before, r0, tx, actualNative);
  assert alwaysExpiryProven(after) by { reveal alwaysExpiryProven; }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    forall r | r in after.rows ensures (|r.attempts| > 0 ==> r.gasLimit > 0) && (forall a :: a in r.attempts ==> a.maxFee > 0 && a.priority >= 0 && a.maxFee >= firstAttempt(r).maxFee && a.maxFee <= firstAttempt(r).maxFee * 3 && a.priority <= a.maxFee) {
      var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
      assert before.rows[ri] in before.rows && firstAttempt(r) == firstAttempt(before.rows[ri]);
    }
  }
  assert forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].amountIn > 0 && after.rows[i].valueMicro >= 0 && (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) && (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i] in before.rows {}
  }
  RowIdentityFromPointwise(before, after);
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    forall r | r in after.rows && !r.live ensures |r.attempts| == 0 && !r.state.Submitted? && !r.state.Unknown? {
      var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
      assert before.rows[ri] in before.rows;
    }
  }
  assert stepEvidencePermanent(before, after) by { reveal stepEvidencePermanent; }
}

lemma settleExpired_ensures(f: Fee, runId: int, id: int, receipt: SendReceipt, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysLeaseIdentity(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysRotationOnlyOnSolana(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysRotationExcludesRuns(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysRuntimeSound(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysHoldingsIdentity(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysTopUpsNeverSold(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysAccrualFromVault(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysRunValueBounded(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysNotConvertedRetained(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysOpenSendHeld(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysSignedRowsAttributed(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysLiabilityWithinDay(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysReservationsWithinTransaction(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysOneOpenSend(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysClaimsFromReceipts(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysOutputFromReceipts(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysExpiryProven(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysAttemptsKeepContent(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysDryRowsNeverSign(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> alwaysRowIdentity(settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepStaleRunCannotSign(f, "settleExpired", settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepRotationBlocksRuns(f, "settleExpired", settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepRotationOnlyWhenQuiet(f, "settleExpired", settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepEvidencePermanent(f, settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepReplacementNeedsActivation(f, "settleExpired", settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepSignaturesNeedLive(f, "settleExpired", settleExpired(f, runId, id, receipt, by_)))
  ensures (inv(f) ==> canSettleExpired(f, runId, id, receipt, by_) ==> stepJournalAppendOnly(f, settleExpired(f, runId, id, receipt, by_)))
{
  hide *;
  if inv(f) && canSettleExpired(f, runId, id, receipt, by_) {
    reveal inv, canSettleExpired, settleExpired, noRow;
    var after := settleExpired(f, runId, id, receipt, by_);
    var r0 := (if 0 <= (id - 1) < |f.rows| then (f.rows)[id - 1] else noRow);
    assert r0 in f.rows;
    assert forall i :: 0 <= i < |f.rows| && rowFrozen(f.rows[i]) ==> !reusedNonce(f, r0, f.rows[i]) by {
      reveal rowFrozen, settledState, reusedNonce;
    }
    NoReservedWhenOwnZero(f, runId);
    SettleGasShape(f, r0, receipt.tx, receipt.actualNative);
    SettleExpiredPreservesHoldings(f, after, r0);
    SettleExpiredPreservesReceipts(f, after, r0);
    SettleGasLiability(f, after, r0, receipt.tx, receipt.actualNative);
    SettleGasPreservesResOnly(f, after, r0, receipt.tx, receipt.actualNative);
    SettleExpiredPreservesOpenSendHeld(f, after, r0, receipt.tx, receipt.actualNative);
    SettleExpiredPreservesSignedAttributed(f, after, r0, receipt.tx, receipt.actualNative);
    SettleGasPreservesCore4(f, after, r0, receipt.tx, receipt.actualNative);
    SettleGasPreservesAppendOnly(f, after, r0, receipt.tx, receipt.actualNative);
    SettleExpiredPreservesMisc(f, after, r0, receipt.tx, receipt.actualNative);
    PreserveStepsOther(f, "settleExpired", after);
  }
}

lemma ExpireSolanaPreservesHoldings(before: Fee, after: Fee, idx: int)
  requires inv(before)
  requires after.network == before.network && after.clock == before.clock && after.runValue == before.runValue && after.vaults == before.vaults
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(state := RowState.Failed, reason := Reason.ExpiredUnlanded)
  requires var r := before.rows[idx]; var h := holding(before, r.token);
    after.holdings == (if r.kind.Claim? then withHolding(r.token, h.(accrued := h.accrued + r.amountIn), before) else before.holdings)
  ensures alwaysHoldingsIdentity(after)
  ensures alwaysTopUpsNeverSold(after)
  ensures alwaysAccrualFromVault(after)
  ensures alwaysRunValueBounded(after)
  ensures alwaysNotConvertedRetained(after)
  ensures alwaysOneOpenSend(after)
  ensures alwaysClaimsFromReceipts(after)
  ensures alwaysOutputFromReceipts(after)
{
  hide *;
  reveal inv;
  RowCloseOpenFolds(before, after, idx);
  RowUpdatePreservesReceipts(before, after.(holdings := before.holdings), idx);
  var r0 := before.rows[idx];
  assert r0 in before.rows;
  assert r0.amountIn > 0 by { reveal alwaysRowIdentity; }
  assert validToken(before, r0.token) by { reveal alwaysHoldingsIdentity; }
  var h0 := holding(before, r0.token);
  assert h0 == before.holdings[r0.token - 1] && h0 in before.holdings && h0.token == r0.token by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    HoldingsIdsEquiv(before.holdings, 0);
  }
  if r0.kind.Claim? {
    WithHoldingShape(before, r0.token, h0.(accrued := h0.accrued + r0.amountIn));
  }
  assert alwaysHoldingsIdentity(after) by {
    reveal alwaysHoldingsIdentity, holding, validToken;
    forall i | 0 <= i < |after.rows| ensures validToken(after, after.rows[i].token) { if i != idx { assert before.rows[i] in before.rows; } }
  }
  assert alwaysTopUpsNeverSold(after) by {
    reveal alwaysTopUpsNeverSold;
    forall h | h in after.holdings ensures (if h.asset.NativeAsset? then h.balance == h.feeIncome + h.topUps - h.sold else h.topUps == 0 && h.sold + h.balance <= h.feeIncome) && h.sold >= 0 && h.sold + openAmount(after, h.token) <= h.feeIncome && h.balance >= openAmount(after, h.token) && h.topUps >= 0 && h.balance >= 0 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
  assert alwaysAccrualFromVault(after) by {
    reveal alwaysAccrualFromVault;
    forall h | h in after.holdings ensures h.accrued >= 0 && h.claimed >= 0 && h.vaultObserved >= 0 && h.accrued + openClaims(after, h.token) <= h.vaultObserved {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
  assert alwaysRunValueBounded(after) by { reveal alwaysRunValueBounded; }
  assert alwaysNotConvertedRetained(after) by {
    reveal alwaysNotConvertedRetained, evaluated, holding;
    forall h | h in after.holdings ensures !evaluated(after, h.token) ==> (forall r :: r in after.rows ==> r.token != h.token || !r.kind.Conversion?) && h.sold == 0 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
      if !evaluated(after, h.token) {
        assert holding(after, h.token).asset == holding(before, h.token).asset;
        forall r | r in after.rows ensures r.token != h.token || !r.kind.Conversion? {
          var ri :| 0 <= ri < |after.rows| && after.rows[ri] == r;
          assert before.rows[ri] in before.rows;
        }
      }
    }
  }
  assert alwaysOneOpenSend(after) by {
    reveal alwaysOneOpenSend;
    forall h | h in after.holdings ensures openRows(after, h.token) <= 1 {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
  assert alwaysClaimsFromReceipts(after) by {
    reveal alwaysClaimsFromReceipts;
    forall h | h in after.holdings ensures h.claimed == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Claim? && r.state.Finalized?) && (r.token == h.token)) then (t + r.output) else t), 0, after.rows) && h.claimed <= h.feeIncome {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
  assert alwaysOutputFromReceipts(after) by {
    reveal alwaysOutputFromReceipts, finalizedOutput;
    forall h | h in after.holdings ensures h.usdcOut == finalizedOutput(after, h.token) && h.sold == Std.Collections.Seq.FoldLeft((t: int, r: Row) => (if ((r.kind.Conversion? && r.state.Finalized?) && (r.token == h.token)) then (t + r.amountIn) else t), 0, after.rows) {
      var hi :| 0 <= hi < |after.holdings| && after.holdings[hi] == h;
      assert before.holdings[hi] in before.holdings;
    }
  }
}

lemma ExpireSolanaPreservesMisc(before: Fee, after: Fee, idx: int, proof: ExpiryProof)
  requires inv(before) && before.network.Solana?
  requires after.network == before.network && after.scans == before.scans
  requires 0 <= idx < |before.rows| && (before.rows[idx].state.Submitted? || before.rows[idx].state.Unknown?) && |before.rows[idx].attempts| == 1
  requires expiryProvesAbsence(before, before.rows[idx].attempts[0].tx, proof)
  requires |after.rows| == |before.rows|
  requires forall i :: 0 <= i < |before.rows| && i != idx ==> after.rows[i] == before.rows[i]
  requires after.rows[idx] == before.rows[idx].(state := RowState.Failed, reason := Reason.ExpiredUnlanded)
  requires after.gas == settleGas(before, before.rows[idx], 0, 0)
  requires after.proofs == before.proofs + [proof]
  ensures alwaysExpiryProven(after)
  ensures alwaysAttemptsKeepContent(after)
  ensures alwaysRowIdentity(after)
  ensures alwaysDryRowsNeverSign(after)
  ensures stepEvidencePermanent(before, after)
{
  hide *;
  reveal inv;
  SettleGasShape(before, before.rows[idx], 0, 0);
  assert before.rows[idx] in before.rows;
  assert alwaysExpiryProven(after) by {
    reveal alwaysExpiryProven, expiryProvesAbsence;
    assert proof in after.proofs && after.rows[idx].attempts[0] in after.rows[idx].attempts;
    forall p | p in before.proofs ensures p in after.proofs {}
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert alwaysAttemptsKeepContent(after) by {
    reveal alwaysAttemptsKeepContent, firstAttempt;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert forall i :: 0 <= i < |before.rows| ==> after.rows[i].id == before.rows[i].id && after.rows[i].amountIn > 0 && after.rows[i].valueMicro >= 0 && (after.rows[i].state.Quoted? ==> after.rows[i].kind.Conversion? && |after.rows[i].attempts| == 0) && (after.rows[i].reason.ExpiredUnlanded? ==> after.rows[i].state.Failed?) by {
    reveal alwaysRowIdentity;
    forall i | 0 <= i < |before.rows| ensures before.rows[i] in before.rows {}
  }
  RowIdentityFromPointwise(before, after);
  assert alwaysDryRowsNeverSign(after) by {
    reveal alwaysDryRowsNeverSign;
    forall i | 0 <= i < |after.rows| && i != idx ensures after.rows[i] == before.rows[i] && before.rows[i] in before.rows {}
  }
  assert stepEvidencePermanent(before, after) by {
    reveal stepEvidencePermanent;
    forall p | p in before.proofs ensures p in after.proofs {}
  }
}

lemma expireSolana_ensures(f: Fee, runId: int, id: int, proof: ExpiryProof, by_: fees__runtime_Sender)
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysLeaseIdentity(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysRotationOnlyOnSolana(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysRotationExcludesRuns(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysRuntimeSound(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysHoldingsIdentity(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysTopUpsNeverSold(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysAccrualFromVault(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysRunValueBounded(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysNotConvertedRetained(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysOpenSendHeld(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysSignedRowsAttributed(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysLiabilityWithinDay(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysReservationsWithinTransaction(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysOneOpenSend(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysClaimsFromReceipts(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysOutputFromReceipts(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysExpiryProven(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysAttemptsKeepContent(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysDryRowsNeverSign(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> alwaysRowIdentity(expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepStaleRunCannotSign(f, "expireSolana", expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepRotationBlocksRuns(f, "expireSolana", expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepRotationOnlyWhenQuiet(f, "expireSolana", expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepEvidencePermanent(f, expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepReplacementNeedsActivation(f, "expireSolana", expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepSignaturesNeedLive(f, "expireSolana", expireSolana(f, runId, id, proof, by_)))
  ensures (inv(f) ==> canExpireSolana(f, runId, id, proof, by_) ==> stepJournalAppendOnly(f, expireSolana(f, runId, id, proof, by_)))
{
  hide *;
  if inv(f) && canExpireSolana(f, runId, id, proof, by_) {
    reveal inv, canExpireSolana, expireSolana, noRow;
    var after := expireSolana(f, runId, id, proof, by_);
    RowsPositional(f);
    var idx := id - 1;
    assert 0 <= idx < |f.rows|;
    var r0 := f.rows[idx];
    assert r0 in f.rows;
    assert !rowFrozen(r0) by { reveal rowFrozen, settledState; }
    assert !overran(f, 0, 0) by {
      reveal overran, alwaysReservationsWithinTransaction;
    }
    assert forall g :: g in f.gas && g.state.Reserved? ==> g.nonce != r0.nonce by {
      reveal alwaysReservationsWithinTransaction;
    }
    forall g | g in f.gas && g.state.Reserved? ensures pendingIntent(after, g.runId) == pendingIntent(f, g.runId) {
      reveal pendingIntent;
      var pf := (found: Row, r: Row) => (if ((r.state.Quoted? && r.live) && (r.runId == g.runId)) then r else found);
      ProofLib.FoldLeftPointwise(pf, pf, noRow, after.rows, f.rows);
    }
    SettleGasShape(f, r0, 0, 0);
    ExpireSolanaPreservesHoldings(f, after, idx);
    SettleGasLiability(f, after, r0, 0, 0);
    SettleGasPreservesResOnly(f, after, r0, 0, 0);
    RowCloseSettleGasOpenAndSigned(f, after, idx, 0, 0);
    SettleGasPreservesCore4(f, after, r0, 0, 0);
    SettleGasPreservesAppendOnly(f, after, r0, 0, 0);
    ExpireSolanaPreservesMisc(f, after, idx, proof);
    PreserveStepsOther(f, "expireSolana", after);
  }
}
