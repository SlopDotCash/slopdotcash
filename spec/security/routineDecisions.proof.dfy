// A live decision changes only an unappealed undecided report, so the routine marks follow from the read guard.
lemma decideReport_ensures(r: Routine, found: Observation)
  ensures (inv(r) ==> canDecideReport(r, found) ==> alwaysCaseRoutineMarks(decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> alwaysOnlyLiveApplies(decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> alwaysVersionsAligned(decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepAuditRecordsRetained(r, decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepOneFinalDecisionPerRevisionAndMode(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepAttemptsBounded(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepOnlyLiveChangesTheCase(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepRoutineCloseConditions(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepNoProofOnlyAfterTheClock(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepRoutineNeverConfirmsOrCommits(r, "decideReport", decideReport(r, found)))
  ensures (inv(r) ==> canDecideReport(r, found) ==> stepRoutineAppealReturnsToOwner(r, "decideReport", decideReport(r, found)))
{
  if inv(r) && canDecideReport(r, found) {
    var d := verdict(r, found);
    var after := decideReport(r, found);
    var record := RoutineRecord(r.mode, r.privateCase.revision, r.privateCase.reportVersion, r.nowMs, d, r.mode.Live?);
    assert after.records == r.records + [record];
    forall x | x in after.records
      ensures x.applied == x.mode.Live?
    {
      if x !in r.records { assert x == record; }
    }
    if r.mode.Live? {
      var c := r.privateCase;
      assert security__cases_routineReadable(c, r.nowMs);
      assert security__cases_routineOutcomeAllowed(c, d.outcome, d.duplicateOf, r.nowMs);
      assert c.appeal.NoAppeal? && |c.appealHistory| == 0 && !c.routine.returned;
    }
  }
}

// An appeal decision leaves the routine marks as the open appeal had them.
lemma decideAppeal_ensures(r: Routine, by_: int, uphold: bool)
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> alwaysCaseRoutineMarks(decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> alwaysOnlyLiveApplies(decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> alwaysVersionsAligned(decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepAuditRecordsRetained(r, decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepOneFinalDecisionPerRevisionAndMode(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepAttemptsBounded(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepOnlyLiveChangesTheCase(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepRoutineCloseConditions(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepNoProofOnlyAfterTheClock(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepRoutineNeverConfirmsOrCommits(r, "decideAppeal", decideAppeal(r, by_, uphold)))
  ensures (inv(r) ==> canDecideAppeal(r, by_, uphold) ==> stepRoutineAppealReturnsToOwner(r, "decideAppeal", decideAppeal(r, by_, uphold)))
{
  if inv(r) && canDecideAppeal(r, by_, uphold) {
    var c := r.privateCase;
    assert c.appeal.AppealOpen? && c.receipt.Disputed? && !c.routine.closed;
    assert !c.appealFrom.Disputed? && !c.appealFrom.NeedsInformation?;
    assert c.routine.proofDueAt == 0;
  }
}
