// Folding a page into the census keeps one item per immutable ID; a new cursor is appended once.
lemma recordPage_ensures(c: Census, page: Page)
  ensures (inv(c) ==> canRecordPage(c, page) ==> alwaysItemsDistinct(recordPage(c, page)))
  ensures (inv(c) ==> canRecordPage(c, page) ==> alwaysCursorsDistinct(recordPage(c, page)))
  ensures (inv(c) ==> canRecordPage(c, page) ==> alwaysCompleteWhenReady(recordPage(c, page)))
  ensures (inv(c) ==> canRecordPage(c, page) ==> alwaysFailedKeepsSnapshot(recordPage(c, page)))
  ensures (inv(c) ==> canRecordPage(c, page) ==> alwaysWindowForward(recordPage(c, page)))
  ensures (inv(c) ==> canRecordPage(c, page) ==> stepPublishedWindowNeverRegresses(c, recordPage(c, page)))
{
  if inv(c) && canRecordPage(c, page) {
    ItemsMeaning(c);
    CursorsMeaning(c);
    FoldAddUnique(c.items, page.items);
    AppendUniqueInteger(c.cursorsSeen, page.cursor);
    ItemsMeaning(recordPage(c, page));
    CursorsMeaning(recordPage(c, page));
  }
}

lemma ItemsMeaning(c: Census)
  ensures alwaysItemsDistinct(c) == !((exists i :: i in c.items && !(((i.id > 0) && (|ProofLib.Filter((o: Item) => (o.id == i.id), c.items)| == 1)))))
{
}

lemma CursorsMeaning(c: Census)
  ensures alwaysCursorsDistinct(c) == !((exists k :: k in c.cursorsSeen && !((|ProofLib.Filter((o: int) => (o == k), c.cursorsSeen)| == 1))))
{
}

lemma AddItemUnique(items: seq<Item>, n: Item)
  requires forall x :: x in items ==> x.id > 0 && |ProofLib.Filter((o: Item) => (o.id == x.id), items)| == 1
  requires n.id > 0
  ensures forall x :: x in addItem(items, n) ==> x.id > 0 && |ProofLib.Filter((o: Item) => (o.id == x.id), addItem(items, n))| == 1
{
  if !(exists o :: o in items && (o.id == n.id)) {
    forall x | x in items + [n]
      ensures x.id > 0 && |ProofLib.Filter((o: Item) => (o.id == x.id), items + [n])| == 1
    {
      ProofLib.FilterAppend((o: Item) => (o.id == x.id), items, n);
      if x.id == n.id {
        ProofLib.FilterNone((o: Item) => (o.id == x.id), items);
      }
    }
  }
}

lemma FoldAddUnique(start: seq<Item>, xs: seq<Item>)
  requires forall x :: x in start ==> x.id > 0 && |ProofLib.Filter((o: Item) => (o.id == x.id), start)| == 1
  requires forall x :: x in xs ==> x.id > 0
  ensures forall x :: x in Std.Collections.Seq.FoldLeft((acc: seq<Item>, i: Item) => addItem(acc, i), start, xs) ==>
    x.id > 0 && |ProofLib.Filter((o: Item) => (o.id == x.id), Std.Collections.Seq.FoldLeft((acc: seq<Item>, i: Item) => addItem(acc, i), start, xs))| == 1
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    AddItemUnique(start, xs[0]);
    assert forall x :: x in xs[1..] ==> x in xs;
    FoldAddUnique(addItem(start, xs[0]), xs[1..]);
  }
}

lemma AppendUniqueInteger(xs: seq<int>, nextValue: int)
  requires forall value :: value in xs ==> |ProofLib.Filter((o: int) => (o == value), xs)| == 1
  requires !(nextValue in xs)
  ensures forall value :: value in xs + [nextValue] ==> |ProofLib.Filter((o: int) => (o == value), xs + [nextValue])| == 1
{
  forall value | value in xs + [nextValue]
    ensures |ProofLib.Filter((o: int) => (o == value), xs + [nextValue])| == 1
  {
    ProofLib.FilterAppend((o: int) => (o == value), xs, nextValue);
    if value == nextValue {
      ProofLib.FilterNone((o: int) => (o == value), xs);
    }
  }
}

// Each blocker puts its reason into one group, and a group's reasons are in the concatenated list.
lemma InReasons(i: Item, r: Reason)
  requires r in authorReasons(i) || r in readinessReasons(i) || r in scopeReasons(i) || r in claimReasons(i) || r in reviewReasons(i)
  ensures r in reasons(i)
{
  var first := authorReasons(i) + readinessReasons(i);
  var second := scopeReasons(i) + claimReasons(i);
  assert reasons(i) == (first + second) + reviewReasons(i);
}

lemma lawUnknownAuthorFailsClosed_ensures(i: Item)
  ensures (lawUnknownAuthorFailsClosed(i) == true)
{
  if i.author.UnknownAuthor? {
    assert Reason.AuthorUnknown in reasonIf(i.author.UnknownAuthor?, Reason.AuthorUnknown);
    assert Reason.AuthorUnknown in authorReasons(i);
    InReasons(i, Reason.AuthorUnknown);
  }
}

lemma lawUnavailableDiffFailsClosed_ensures(i: Item)
  ensures (lawUnavailableDiffFailsClosed(i) == true)
{
  if i.kind.PullRequestItem? && !i.diffAvailable {
    assert Reason.DiffUnavailable in readinessReasons(i);
    InReasons(i, Reason.DiffUnavailable);
  }
}

lemma lawUntriagedIssueFailsClosed_ensures(i: Item)
  ensures (lawUntriagedIssueFailsClosed(i) == true)
{
  if i.kind.IssueItem? && !i.contributorReady {
    assert Reason.Untriaged in readinessReasons(i);
    InReasons(i, Reason.Untriaged);
  }
}

lemma lawEveryReasonListed_ensures(i: Item)
  ensures (lawEveryReasonListed(i) == true)
{
  if i.hasAssignee {
    assert Reason.Assigned in claimReasons(i);
    InReasons(i, Reason.Assigned);
  }
  if i.claimed {
    assert Reason.Claimed in claimReasons(i);
    InReasons(i, Reason.Claimed);
  }
  if i.approved {
    assert Reason.Approved in reviewReasons(i);
    InReasons(i, Reason.Approved);
  }
  if i.changesRequested {
    assert Reason.ChangesRequested in reviewReasons(i);
    InReasons(i, Reason.ChangesRequested);
  }
}
