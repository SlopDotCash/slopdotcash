// Appending a new page or source preserves one occurrence per immutable ID.
lemma recordPage_ensures(c: Census, page: int, sourceId: int)
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysExpectedCounts(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysPageRange(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysDistinctPages(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysSourceIds(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysDistinctSources(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysWindow(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysPublishedComplete(recordPage(c, page, sourceId)))
  ensures (inv(c) ==> canRecordPage(c, page, sourceId) ==> alwaysFailedKeepsSnapshot(recordPage(c, page, sourceId)))
{
  if inv(c) && canRecordPage(c, page, sourceId) {
    DistinctPagesMeaning(c);
    DistinctSourcesMeaning(c);
    if !(page in c.pagesSeen) {
      AppendUniqueInteger(c.pagesSeen, page);
    }
    if !(sourceId in c.sourceIds) {
      AppendUniqueInteger(c.sourceIds, sourceId);
    }
    DistinctPagesMeaning(recordPage(c, page, sourceId));
    DistinctSourcesMeaning(recordPage(c, page, sourceId));
  }
}

lemma recordEmptyPage_ensures(c: Census, page: int)
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysExpectedCounts(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysPageRange(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysDistinctPages(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysSourceIds(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysDistinctSources(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysWindow(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysPublishedComplete(recordEmptyPage(c, page)))
  ensures (inv(c) ==> canRecordEmptyPage(c, page) ==> alwaysFailedKeepsSnapshot(recordEmptyPage(c, page)))
{
  if inv(c) && canRecordEmptyPage(c, page) {
    DistinctPagesMeaning(c);
    if !(page in c.pagesSeen) {
      AppendUniqueInteger(c.pagesSeen, page);
    }
    DistinctPagesMeaning(recordEmptyPage(c, page));
  }
}

lemma DistinctPagesMeaning(c: Census)
  ensures alwaysDistinctPages(c) == !(exists page :: page in c.pagesSeen && !(|ProofLib.Filter((other: int) => (other == page), c.pagesSeen)| == 1))
{
}

lemma DistinctSourcesMeaning(c: Census)
  ensures alwaysDistinctSources(c) == !(exists id :: id in c.sourceIds && !(|ProofLib.Filter((other: int) => (other == id), c.sourceIds)| == 1))
{
}

lemma AppendUniqueInteger(xs: seq<int>, nextValue: int)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: int) => (other == value), xs)| == 1
  requires !(nextValue in xs)
  ensures forall value :: value in xs + [nextValue] ==> |ProofLib.Filter((other: int) => (other == value), xs + [nextValue])| == 1
{
  forall value | value in xs + [nextValue]
    ensures |ProofLib.Filter((other: int) => (other == value), xs + [nextValue])| == 1
  {
    ProofLib.FilterAppend((other: int) => (other == value), xs, nextValue);
    if value == nextValue {
      ProofLib.FilterNone((other: int) => (other == value), xs);
    }
  }
}
