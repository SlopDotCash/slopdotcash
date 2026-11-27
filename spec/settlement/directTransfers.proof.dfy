lemma OneRowFilter(s: Disclosures)
  ensures alwaysOneRowPerTransaction(s) == !((exists d :: d in s.rows && !((validDisclosure(d) && (|ProofLib.Filter((o: Disclosure) => sameKey(o, d), s.rows)| == 1)))))
{
}

lemma UniqueKeysFromFilter(rows: seq<Disclosure>)
  requires forall d :: d in rows ==> |ProofLib.Filter((o: Disclosure) => sameKey(o, d), rows)| == 1
  ensures forall i, j :: 0 <= i < |rows| && 0 <= j < |rows| && i != j ==> !sameKey(rows[i], rows[j])
{
  forall i, j | 0 <= i < |rows| && 0 <= j < |rows| && i != j
    ensures !sameKey(rows[i], rows[j])
  {
    if sameKey(rows[i], rows[j]) {
      assert rows[i] in rows;
      ProofLib.FilterTwo((o: Disclosure) => sameKey(o, rows[i]), rows, i, j);
    }
  }
}

lemma FilterFromUniqueKeys(rows: seq<Disclosure>)
  requires forall i, j :: 0 <= i < |rows| && 0 <= j < |rows| && i != j ==> !sameKey(rows[i], rows[j])
  ensures forall d :: d in rows ==> |ProofLib.Filter((o: Disclosure) => sameKey(o, d), rows)| == 1
{
  forall d | d in rows
    ensures |ProofLib.Filter((o: Disclosure) => sameKey(o, d), rows)| == 1
  {
    var i :| 0 <= i < |rows| && rows[i] == d;
    ProofLib.FilterOne((o: Disclosure) => sameKey(o, d), rows, i);
  }
}

lemma FoldImportRows(f: (seq<Disclosure>, Disclosure) -> seq<Disclosure>, acc: seq<Disclosure>, rest: seq<Disclosure>)
  requires forall rows, d :: f(rows, d) == (if (d in rows) then rows else (rows + [d]))
  requires forall x :: x in acc ==> validDisclosure(x)
  requires forall x :: x in rest ==> validDisclosure(x)
  requires forall i, j :: 0 <= i < |acc| && 0 <= j < |acc| && i != j ==> !sameKey(acc[i], acc[j])
  requires forall x, y :: x in acc && y in rest && sameKey(x, y) ==> x == y
  requires forall x, y :: x in rest && y in rest && sameKey(x, y) ==> x == y
  ensures var res := Std.Collections.Seq.FoldLeft(f, acc, rest);
    (forall x :: x in acc ==> x in res)
    && (forall x :: x in res ==> validDisclosure(x))
    && (forall i, j :: 0 <= i < |res| && 0 <= j < |res| && i != j ==> !sameKey(res[i], res[j]))
  decreases |rest|
{
  if |rest| > 0 {
    var d := rest[0];
    var next := f(acc, d);
    if !(d in acc) {
      forall i, j | 0 <= i < |next| && 0 <= j < |next| && i != j
        ensures !sameKey(next[i], next[j])
      {
        if i < |acc| && j == |acc| {
          assert acc[i] in acc;
          assert d in rest;
          if sameKey(acc[i], d) {
            assert acc[i] == d;
          }
        } else if i == |acc| && j < |acc| {
          assert acc[j] in acc;
          assert d in rest;
          if sameKey(d, acc[j]) {
            assert sameKey(acc[j], d);
            assert acc[j] == d;
          }
        }
      }
    }
    FoldImportRows(f, next, rest[1..]);
  }
}

lemma ImportRowsEq(s: Disclosures, batch: seq<Disclosure>, f: (seq<Disclosure>, Disclosure) -> seq<Disclosure>)
  requires !(exists d :: d in batch && (contradicts(s.rows, d) || contradicts(batch, d)))
  requires forall rows, d :: f(rows, d) == (if (d in rows) then rows else (rows + [d]))
  ensures importBatch(s, batch).rows == Std.Collections.Seq.FoldLeft(f, s.rows, batch)
{
  ProofLib.FoldLeftPointwise((rows: seq<Disclosure>, d: Disclosure) => (if (d in rows) then rows else (rows + [d])), f, s.rows, batch, batch);
}

lemma importBatch_ensures(s: Disclosures, batch: seq<Disclosure>)
  ensures (inv(s) ==> canImportBatch(s, batch) ==> alwaysOneRowPerTransaction(importBatch(s, batch)))
  ensures (inv(s) ==> canImportBatch(s, batch) ==> stepRowsImmutable(s, importBatch(s, batch)))
{
  if inv(s) && canImportBatch(s, batch) {
    var after := importBatch(s, batch);
    if !(exists d :: d in batch && (contradicts(s.rows, d) || contradicts(batch, d))) {
      OneRowFilter(s);
      OneRowFilter(after);
      UniqueKeysFromFilter(s.rows);
      forall x, y | x in s.rows && y in batch && sameKey(x, y)
        ensures x == y
      {
        assert !contradicts(s.rows, y);
      }
      forall x, y | x in batch && y in batch && sameKey(x, y)
        ensures x == y
      {
        assert !contradicts(batch, y);
      }
      var f := (rows: seq<Disclosure>, d: Disclosure) => (if (d in rows) then rows else (rows + [d]));
      ImportRowsEq(s, batch, f);
      FoldImportRows(f, s.rows, batch);
      FilterFromUniqueKeys(after.rows);
    }
  }
}
