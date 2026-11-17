// The next row keeps every revision number unique; a served receipt is a stored row.
lemma appendRevision_ensures(r: RevisionStore, revision: int, text: int)
  ensures (inv(r) ==> canAppendRevision(r, revision, text) ==> alwaysStoredDigestIsOfStoredText(appendRevision(r, revision, text)))
  ensures (inv(r) ==> canAppendRevision(r, revision, text) ==> alwaysReceiptsMatchTheirDigest(appendRevision(r, revision, text)))
  ensures (inv(r) ==> canAppendRevision(r, revision, text) ==> stepStoredRevisionsImmutable(r, appendRevision(r, revision, text)))
{
  if inv(r) && canAppendRevision(r, revision, text) {
    var added := StoredRevision(revision, text, sha256(text));
    var after := appendRevision(r, revision, text);
    assert after.rows == r.rows + [added];
    RowsMeaning(r);
    AppendNextRow(r.rows, added);
    RowsMeaning(after);
  }
}

lemma serveReceipt_ensures(r: RevisionStore, revision: int)
  ensures (inv(r) ==> canServeReceipt(r, revision) ==> alwaysStoredDigestIsOfStoredText(serveReceipt(r, revision)))
  ensures (inv(r) ==> canServeReceipt(r, revision) ==> alwaysReceiptsMatchTheirDigest(serveReceipt(r, revision)))
  ensures (inv(r) ==> canServeReceipt(r, revision) ==> stepStoredRevisionsImmutable(r, serveReceipt(r, revision)))
{
  if inv(r) && canServeReceipt(r, revision) {
    var found :| found in r.rows && found.revision == revision;
    var i :| 0 <= i < |r.rows| && r.rows[i] == found;
    ProofLib.FilterNone((s: StoredRevision) => (s.revision == revision), r.rows);
    ProofLib.FilterSubset((s: StoredRevision) => (s.revision == revision), r.rows);
    StoredRevisionMeaning(r, revision);
    var row := storedRevision(r, revision);
    assert row in r.rows;
    RowsMeaning(r);
    assert row.digest == sha256(row.text);
    assert receiptOf(r, revision) == Receipt(1, row.revision, row.text, row.digest);
    assert StoredRevision(row.revision, row.text, row.digest) == row;
    RowsMeaning(serveReceipt(r, revision));
  }
}

lemma RowsMeaning(r: RevisionStore)
  ensures alwaysStoredDigestIsOfStoredText(r) == !(exists s :: s in r.rows && !(s.revision > 0 && s.revision <= |r.rows| && s.text > 0 && s.digest == sha256(s.text) && |ProofLib.Filter((o: StoredRevision) => (o.revision == s.revision), r.rows)| == 1))
{
}

lemma StoredRevisionMeaning(r: RevisionStore, revision: int)
  ensures storedRevision(r, revision) == (if 0 < |ProofLib.Filter((s: StoredRevision) => (s.revision == revision), r.rows)| then ProofLib.Filter((s: StoredRevision) => (s.revision == revision), r.rows)[0] else absentRevision)
{
}

lemma AppendNextRow(xs: seq<StoredRevision>, added: StoredRevision)
  requires forall s :: s in xs ==> s.revision > 0 && s.revision <= |xs| && s.text > 0 && s.digest == sha256(s.text) && |ProofLib.Filter((o: StoredRevision) => (o.revision == s.revision), xs)| == 1
  requires added.revision == |xs| + 1 && added.text > 0 && added.digest == sha256(added.text)
  ensures forall s :: s in xs + [added] ==> s.revision > 0 && s.revision <= |xs + [added]| && s.text > 0 && s.digest == sha256(s.text) && |ProofLib.Filter((o: StoredRevision) => (o.revision == s.revision), xs + [added])| == 1
{
  assert forall k :: 0 <= k < |xs| ==> xs[k] in xs;
  forall s | s in xs + [added]
    ensures s.revision > 0 && s.revision <= |xs + [added]| && s.text > 0 && s.digest == sha256(s.text) && |ProofLib.Filter((o: StoredRevision) => (o.revision == s.revision), xs + [added])| == 1
  {
    ProofLib.FilterAppend((o: StoredRevision) => (o.revision == s.revision), xs, added);
    if s.revision == added.revision {
      assert s == added;
      ProofLib.FilterNone((o: StoredRevision) => (o.revision == s.revision), xs);
    } else {
      assert s in xs;
    }
  }
}
