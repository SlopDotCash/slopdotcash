lemma route_ensures(s: Screening, seenRevision: int, routing: Routing)
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> alwaysClockBindings(route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> alwaysHistoryMatchesVersion(route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> alwaysRecordedNoticeBelongsToRetainedVersion(route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> stepRevisionAdvancesOnce(s, route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> stepReportHistoryRetained(s, route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> stepNoticeHistoryRetained(s, route(s, seenRevision, routing)))
  ensures (inv(s) ==> canRoute(s, seenRevision, routing) ==> stepNewRoutingNeedsQualification(s, route(s, seenRevision, routing)))
{
  if inv(s) && canRoute(s, seenRevision, routing) {
    var after := route(s, seenRevision, routing);
    var unseen := (version: int) => !(version in s.noticeVersions);
    if routing.eligibleRecipients {
      ProofLib.FilterCons(unseen, [s.version]);
      ProofLib.FilterNil(unseen, []);
      assert after.noticeVersions == s.noticeVersions + (if unseen(s.version) then [s.version] else []);
    }
    assert after.version == s.version;
    assert s.version > 0;
    forall version | version in after.noticeVersions
      ensures 0 < version <= after.version
    {
      assert version in s.noticeVersions || version == s.version;
    }
  }
}
