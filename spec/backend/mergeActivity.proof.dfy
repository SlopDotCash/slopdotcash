// spec/backend/mergeActivity.md, "Outside pull requests come from authors who cannot merge, never bots or drafts"; spec/backend/mergeActivity.md, "Rules"

lemma lawOpenCountCoversWaiting_ensures(open: seq<OpenPull>, now: int)
  ensures (lawOpenCountCoversWaiting(open, now) == true)
{
  WaitingOutsideFilter(open, now);
  OutsideOpenFilter(open, 0);
  ProofLib.FilterImpLength(
    (p: OpenPull) => (((outsideAuthor(p.association, p.bot) && !(p.draft)) && !(p.maintainerResponded)) && (p.openedAt <= (now - waitingHours))),
    (p: OpenPull) => (outsideAuthor(p.association, p.bot) && !(p.draft)),
    open
  );
}

lemma readSucceeded_ensures(m: Merges, open: seq<OpenPull>, capped: bool, merged: seq<MergedPull>, countedBeyond: int, countCapped: bool, wanted: seq<WantedIssue>, by_: string)
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> alwaysNoWantedWithoutLabel(readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> alwaysRunBounded(readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> alwaysUnobservedHasNoValues(readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> alwaysTimesOrdered(readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> alwaysOpenCountCoversWaiting(readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepLabelCreatedOnlyWhenNotReady(m, "readSucceeded", readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state, readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).out))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepUnlistedStaysUnlisted(m, readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepOnlyUnlistedRowsDeleted(m, "readSucceeded", readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepUnlistedPathNotRead(m, "readSucceeded", readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepWritesOnlyMergeRows(m, "readSucceeded", readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state, readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).out))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepFailureKeepsLastValues(m, "readSucceeded", readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
  ensures (inv(m) ==> canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) ==> stepObservedNeverGoesBack(m, readSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_).state))
{
  if inv(m) && canReadSucceeded(m, open, capped, merged, countedBeyond, countCapped, wanted, by_) {
    lawOpenCountCoversWaiting_ensures(open, m.now);
  }
}

lemma WaitingOutsideFilter(open: seq<OpenPull>, now: int)
  ensures waitingOutside(open, now) == |ProofLib.Filter((p: OpenPull) => (((outsideAuthor(p.association, p.bot) && !(p.draft)) && !(p.maintainerResponded)) && (p.openedAt <= (now - waitingHours))), open)|
{
}

lemma OutsideOpenFilter(open: seq<OpenPull>, countedBeyond: int)
  ensures outsideOpen(open, countedBeyond) == (|ProofLib.Filter((p: OpenPull) => (outsideAuthor(p.association, p.bot) && !(p.draft)), open)| + countedBeyond)
{
}
