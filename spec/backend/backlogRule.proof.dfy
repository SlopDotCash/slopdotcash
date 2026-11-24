// Proofs for the backlog rule and catch-up pause laws of
// spec/backend/backlogRule.md. Each law is a pure definition over the
// project's stored merge-activity reads, so each lemma states that its
// law holds for every value of its arguments. The bound
// alwaysCatchUpWithinFourteenDays is a reachable-state invariant, not a
// law of every record, so it is proved with the state machine, not here.

lemma lawSingleRepoOverLimitHolds_ensures(r: backend__backlogRule_BacklogRead, now: int)
  ensures (lawSingleRepoOverLimitHolds(r, now) == true)
{
}

lemma lawSingleRepoDormantHolds_ensures(r: backend__backlogRule_BacklogRead, now: int)
  ensures (lawSingleRepoDormantHolds(r, now) == true)
{
}

lemma lawQuietNeverDormant_ensures(reads: seq<backend__backlogRule_BacklogRead>, now: int)
  ensures (lawQuietNeverDormant(reads, now) == true)
{
}

lemma lawNoReadHoldsNothing_ensures(reads: seq<backend__backlogRule_BacklogRead>, now: int)
  ensures (lawNoReadHoldsNothing(reads, now) == true)
{
}

lemma lawOneMergeClearsDormancy_ensures(reads: seq<backend__backlogRule_BacklogRead>, now: int)
  ensures (lawOneMergeClearsDormancy(reads, now) == true)
{
}

lemma lawBeforeStartLists_ensures(s: backend__backlogRule_Backlog)
  ensures (lawBeforeStartLists(s) == true)
{
}

lemma lawExemptLists_ensures(s: backend__backlogRule_Backlog)
  ensures (lawExemptLists(s) == true)
{
}

lemma lawInactiveLists_ensures(s: backend__backlogRule_Backlog)
  ensures (lawInactiveLists(s) == true)
{
}

lemma lawCatchUpLists_ensures(s: backend__backlogRule_Backlog)
  ensures (lawCatchUpLists(s) == true)
{
}

lemma lawNoRecentReadLists_ensures(s: backend__backlogRule_Backlog)
  ensures (lawNoRecentReadLists(s) == true)
{
}

lemma lawCatchUpStartWindow_ensures(until: int, now: int, lastStartMonth: int, nowMonth: int)
  ensures (lawCatchUpStartWindow(until, now, lastStartMonth, nowMonth) == true)
{
}

lemma lawCatchUpNeverPastStart_ensures(startedAt: int, until: int, now: int)
  ensures (lawCatchUpNeverPastStart(startedAt, until, now) == true)
{
}

lemma lawNewProjectRefusesCatchUp_ensures(until: int, history: seq<int>)
  ensures (lawNewProjectRefusesCatchUp(until, history) == true)
{
}

lemma lawNoticeSentOnce_ensures(s: backend__backlogRule_Backlog, key: string)
  ensures (lawNoticeSentOnce(s, key) == true)
{
}

lemma lawPreviewBeforeStart_ensures(s: backend__backlogRule_Backlog, key: string)
  ensures (lawPreviewBeforeStart(s, key) == true)
{
}

lemma alwaysOutLeavesLists_ensures(s: backend__backlogRule_Backlog)
  ensures (alwaysOutLeavesLists(s) == true)
{
}

lemma alwaysInRotationIsListed_ensures(s: backend__backlogRule_Backlog)
  ensures (alwaysInRotationIsListed(s) == true)
{
}

lemma alwaysFailedReadListsAsBefore_ensures(s: backend__backlogRule_Backlog)
  ensures (alwaysFailedReadListsAsBefore(s) == true)
{
}

lemma alwaysCatchUpShownWhileRunning_ensures(s: backend__backlogRule_Backlog)
  ensures (alwaysCatchUpShownWhileRunning(s) == true)
{
}

lemma alwaysReturnNeedsClearRead_ensures(s: backend__backlogRule_Backlog)
  ensures (alwaysReturnNeedsClearRead(s) == true)
{
}
