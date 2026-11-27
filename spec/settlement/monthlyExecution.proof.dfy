lemma publish_ensures(e: Execution, key: int, project: int, period: int, network: int, vault: int, runVaultPledged: bool, automatic: bool, v2: bool, solana: bool, tree: Tree, by_: string)
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysOneRowPerMonth(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysCompleteFinalized(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysRunBounded(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysAttemptRecorded(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysNoReorderingRevert(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysSentNoncesIssued(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysLegacyCompleteSettled(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysAdmittedRootIsRowRoot(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysV2CompleteMeansCursorDone(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysLatestAttemptKnown(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysHeldTotalWrong(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysReleasedUntouched(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> alwaysClosedUnadmitted(publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepCompletionPermanent(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepOtherRowsUnchanged(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepNoAdmissionWithoutAdmit(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepAdmissionUsesLatestAttempt(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepAdmissionNeedsCurrentConsent(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepJournalFollows(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepSequenceMonotone(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepAdmittedRootFixed(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepWrongTotalNeverCompletes(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepReleasedPermanent(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
  ensures (inv(e) ==> canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) ==> stepRefusalPermanent(e, publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_)))
{
  if inv(e) && canPublish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_) {
    var after := publish(e, key, project, period, network, vault, runVaultPledged, automatic, v2, solana, tree, by_);
    var nr := Row(key, project, period, network, vault, v2, solana, 0, RowPhase.Pending, false, 0, 0, tree.root, tree.total, tree.count, tree.legacyRoot, 1, settlement__executorJournal_emptyJournal, settlement__money_zero, -1, false, false, tree.whole, tree.digest, tree, 1, sourceOf(e, project, network, vault), false, false, false);
    assert after.rows == e.rows + [nr];
    KeyIdx(e);
    forall i | 0 <= i < |e.rows|
      ensures e.rows[i].key != key && !(e.rows[i].project == project && e.rows[i].period == period && e.rows[i].network == network)
    {
      assert e.rows[i] in e.rows;
    }
    KeyOk(after);
    OthersFrame(e, after);
    assert settlement__executorJournal_wellFormed(settlement__executorJournal_emptyJournal);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    assert !(key in e.ordinaryRun) && !(key in e.prerequisiteRun);
    forall r | r in after.rows ensures r == nr || r in e.rows { }
  }
}

lemma startRun_ensures(e: Execution, now: int, by_: string)
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysOneRowPerMonth(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysCompleteFinalized(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysRunBounded(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysAttemptRecorded(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysNoReorderingRevert(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysSentNoncesIssued(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysLegacyCompleteSettled(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysAdmittedRootIsRowRoot(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysV2CompleteMeansCursorDone(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysLatestAttemptKnown(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysHeldTotalWrong(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysReleasedUntouched(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> alwaysClosedUnadmitted(startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepCompletionPermanent(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepOtherRowsUnchanged(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepNoAdmissionWithoutAdmit(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepAdmissionUsesLatestAttempt(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepAdmissionNeedsCurrentConsent(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepJournalFollows(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepSequenceMonotone(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepAdmittedRootFixed(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepWrongTotalNeverCompletes(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepReleasedPermanent(e, startRun(e, now, by_)))
  ensures (inv(e) ==> canStartRun(e, now, by_) ==> stepRefusalPermanent(e, startRun(e, now, by_)))
{
  if inv(e) && canStartRun(e, now, by_) {
    var after := startRun(e, now, by_);
    assert after.rows == e.rows;
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
  }
}

lemma markAttempt_ensures(e: Execution, key: int, runVaultPledged: bool, automatic: bool, active: bool, restricted: bool, by_: string)
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysOneRowPerMonth(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysCompleteFinalized(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysRunBounded(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysAttemptRecorded(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysNoReorderingRevert(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysSentNoncesIssued(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysLegacyCompleteSettled(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysAdmittedRootIsRowRoot(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysV2CompleteMeansCursorDone(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysLatestAttemptKnown(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysHeldTotalWrong(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysReleasedUntouched(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> alwaysClosedUnadmitted(markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepCompletionPermanent(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepOtherRowsUnchanged(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepNoAdmissionWithoutAdmit(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepAdmissionUsesLatestAttempt(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepAdmissionNeedsCurrentConsent(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepJournalFollows(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepSequenceMonotone(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepAdmittedRootFixed(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepWrongTotalNeverCompletes(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepReleasedPermanent(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
  ensures (inv(e) ==> canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) ==> stepRefusalPermanent(e, markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_)))
{
  hide *;
  if inv(e) && canMarkAttempt(e, key, runVaultPledged, automatic, active, restricted, by_) {
    reveal inv, canMarkAttempt, markAttempt, alwaysRunBounded, fresh_;
    var after := markAttempt(e, key, runVaultPledged, automatic, active, restricted, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && ((r0.key == key) && r0.phase.Pending?);
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    RowFacts(e, r0);
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    assert after.rows[t] == r0.(lastAttempt := e.now, attempts := (r0.attempts + 1),
      consent := settlement__monthPledges_runConsent(runVaultPledged, automatic), active := active, restricted := restricted);
    AttemptsAfterMark(e, after, key, t);
    SingleRowFrames(e, after, t);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
  }
}

lemma submit_ensures(e: Execution, key: int, sendResult: SendResult, admit: bool, by_: string)
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysOneRowPerMonth(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysCompleteFinalized(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysRunBounded(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysAttemptRecorded(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysNoReorderingRevert(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysSentNoncesIssued(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysLegacyCompleteSettled(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysAdmittedRootIsRowRoot(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysV2CompleteMeansCursorDone(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysLatestAttemptKnown(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysHeldTotalWrong(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysReleasedUntouched(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> alwaysClosedUnadmitted(submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepCompletionPermanent(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepOtherRowsUnchanged(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepNoAdmissionWithoutAdmit(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepAdmissionUsesLatestAttempt(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepAdmissionNeedsCurrentConsent(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepJournalFollows(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepSequenceMonotone(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepAdmittedRootFixed(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepWrongTotalNeverCompletes(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepReleasedPermanent(e, submit(e, key, sendResult, admit, by_)))
  ensures (inv(e) ==> canSubmit(e, key, sendResult, admit, by_) ==> stepRefusalPermanent(e, submit(e, key, sendResult, admit, by_)))
{
  if inv(e) && canSubmit(e, key, sendResult, admit, by_) {
    var after := submit(e, key, sendResult, admit, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && ((r0.key == key) && r0.phase.Pending?);
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    assert (((((r0.phase.Pending? && (r0.lastAttempt == e.now)) && !(newerRootPending(e, r0))) && (admit == ((admissible(r0) && windowOpen(r0.period, e.now)) && fresh_(r0)))) && resultFits(r0, sendResult, admit)) && (!(sendResult.Sent?) || !(revertsIfSent(e, r0))));
    assert admit ==> fresh_(r0);
    assert admit ==> (admissible(r0) && windowOpen(r0.period, e.now));
    assert fresh_(r0) ==> r0.root == r0.latest.root;
    assert !r0.invalidated;
    if sendResult.Sent? {
      assert !(revertsIfSent(e, r0));
      NoReorderRevert(e, r0);
      assert !admit ==> (r0.solana || settlement__executorJournal_admitted(r0.journal, r0.period));
      SubmitSent(e, key, sendResult, admit, by_, t);
    } else {
      assert after.rows == e.rows;
      KeysFrame(e, after);
      OthersFrame(e, after);
      JournalsFrame(e, after);
      SubmissionsFrame(e, after);
      PhasesFrame(e, after);
    }
  }
}

lemma observeFinality_ensures(e: Execution, key: int, landing: Landing, height: int, by_: string)
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysOneRowPerMonth(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysCompleteFinalized(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysRunBounded(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysAttemptRecorded(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysNoReorderingRevert(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysSentNoncesIssued(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysLegacyCompleteSettled(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysAdmittedRootIsRowRoot(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysV2CompleteMeansCursorDone(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysLatestAttemptKnown(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysHeldTotalWrong(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysReleasedUntouched(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> alwaysClosedUnadmitted(observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepCompletionPermanent(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepOtherRowsUnchanged(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepNoAdmissionWithoutAdmit(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepAdmissionUsesLatestAttempt(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepAdmissionNeedsCurrentConsent(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepJournalFollows(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepSequenceMonotone(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepAdmittedRootFixed(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepWrongTotalNeverCompletes(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepReleasedPermanent(e, observeFinality(e, key, landing, height, by_)))
  ensures (inv(e) ==> canObserveFinality(e, key, landing, height, by_) ==> stepRefusalPermanent(e, observeFinality(e, key, landing, height, by_)))
{
  hide *;
  if inv(e) && canObserveFinality(e, key, landing, height, by_) {
    reveal inv, canObserveFinality, observeFinality, landingFits, alwaysRunBounded, fresh_;
    var after := observeFinality(e, key, landing, height, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && ((r0.key == key) && r0.phase.Submitted?);
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    RowFacts(e, r0);
    assert landingFits(r0, landing);
    assert !r0.invalidated;
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    assert !(exists r :: r in e.rows && ((r.key == key) && r.invalidated)) by {
      forall r | r in e.rows && r.key == key ensures !r.invalidated {
        var k :| 0 <= k < |e.rows| && e.rows[k] == r;
        assert k == t;
      }
    }
    assert after.reverts == e.reverts;
    SingleRowFrames(e, after, t);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma observeJournal_ensures(e: Execution, key: int, journal: settlement__executorJournal_Journal, by_: string)
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysOneRowPerMonth(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysCompleteFinalized(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysRunBounded(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysAttemptRecorded(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysNoReorderingRevert(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysSentNoncesIssued(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysLegacyCompleteSettled(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysAdmittedRootIsRowRoot(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysV2CompleteMeansCursorDone(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysLatestAttemptKnown(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysHeldTotalWrong(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysReleasedUntouched(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> alwaysClosedUnadmitted(observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepCompletionPermanent(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepOtherRowsUnchanged(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepNoAdmissionWithoutAdmit(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepAdmissionUsesLatestAttempt(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepAdmissionNeedsCurrentConsent(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepJournalFollows(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepSequenceMonotone(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepAdmittedRootFixed(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepWrongTotalNeverCompletes(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepReleasedPermanent(e, observeJournal(e, key, journal, by_)))
  ensures (inv(e) ==> canObserveJournal(e, key, journal, by_) ==> stepRefusalPermanent(e, observeJournal(e, key, journal, by_)))
{
  if inv(e) && canObserveJournal(e, key, journal, by_) {
    var after := observeJournal(e, key, journal, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && ((r0.key == key) && (!r0.phase.Complete?));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    assert (((((((((!(r0.solana) && (!r0.phase.Complete?)) && (!r0.phase.ClosedUnadmitted?)) && (journal != r0.journal)) && monthOnly(journal, r0.period)) && admissionFits(r0, journal)) && (!(!(r0.v2)) || !((exists x :: x in journal.entries && !(x.key.kind.LegacyRoot?))))) && (!(r0.phase.Released?) || (|journal.leaves| == 0))) && settlement__executorJournal_follows(r0.journal, journal)) && settlement__executorJournal_wellFormed(journal));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(journal := journal);
    assert after.rows[t] == r1;
    assert admissionFits(r1, journal);
    if r0.phase.WrongTotal? || r0.phase.Released? {
      V2TotalKept(r0.journal, journal, r0.period, r0.root);
    }
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma complete_ensures(e: Execution, key: int, by_: string)
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysOneRowPerMonth(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysCompleteFinalized(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysRunBounded(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysAttemptRecorded(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysNoReorderingRevert(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysSentNoncesIssued(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysLegacyCompleteSettled(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysAdmittedRootIsRowRoot(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysV2CompleteMeansCursorDone(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysLatestAttemptKnown(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysHeldTotalWrong(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysReleasedUntouched(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> alwaysClosedUnadmitted(complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepCompletionPermanent(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepOtherRowsUnchanged(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepNoAdmissionWithoutAdmit(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepAdmissionUsesLatestAttempt(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepAdmissionNeedsCurrentConsent(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepJournalFollows(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepSequenceMonotone(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepAdmittedRootFixed(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepWrongTotalNeverCompletes(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepReleasedPermanent(e, complete(e, key, by_)))
  ensures (inv(e) ==> canComplete(e, key, by_) ==> stepRefusalPermanent(e, complete(e, key, by_)))
{
  if inv(e) && canComplete(e, key, by_) {
    var after := complete(e, key, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && (((r0.key == key) && r0.v2) && (r0.phase.Pending? || r0.phase.Submitted?));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    assert (((r0.journal.height > 0) && settlement__executorJournal_rootSettled(r0.journal, r0.period)) && (cursorDone(r0) || legacyWon(r0)));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(phase := RowPhase.Complete, height := r0.journal.height);
    assert after.rows[t] == r1;
    assert cursorDone(r1) == cursorDone(r0) && legacyWon(r1) == legacyWon(r0);
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma reauthorize_ensures(e: Execution, key: int, sequence: int, tree: Tree, by_: string)
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysOneRowPerMonth(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysCompleteFinalized(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysRunBounded(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysAttemptRecorded(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysNoReorderingRevert(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysSentNoncesIssued(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysLegacyCompleteSettled(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysAdmittedRootIsRowRoot(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysV2CompleteMeansCursorDone(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysLatestAttemptKnown(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysHeldTotalWrong(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysReleasedUntouched(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> alwaysClosedUnadmitted(reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepCompletionPermanent(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepOtherRowsUnchanged(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepNoAdmissionWithoutAdmit(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepAdmissionUsesLatestAttempt(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepAdmissionNeedsCurrentConsent(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepJournalFollows(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepSequenceMonotone(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepAdmittedRootFixed(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepWrongTotalNeverCompletes(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepReleasedPermanent(e, reauthorize(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canReauthorize(e, key, sequence, tree, by_) ==> stepRefusalPermanent(e, reauthorize(e, key, sequence, tree, by_)))
{
  if inv(e) && canReauthorize(e, key, sequence, tree, by_) {
    var after := reauthorize(e, key, sequence, tree, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && (((r0.key == key) && r0.v2) && (r0.phase.Pending? || r0.phase.Submitted?));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    assert (((((sequence > r0.sequence) && (sequence == r0.latestSequence)) && (tree == r0.latest)) && laterAttempt(r0, tree)) && !(settlement__executorJournal_admitted(r0.journal, r0.period)));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(sequence := sequence, root := tree.root, total := tree.total, leafCount := tree.count);
    assert after.rows[t] == r1;
    assert settlement__executorJournal_wellFormed(r0.journal) && monthOnly(r0.journal, r0.period);
    assert forall a :: a in r0.journal.admissions ==> false;
    assert admissionFits(r1, r0.journal);
    FollowsRefl(r0.journal);
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma observeWrongTotal_ensures(e: Execution, key: int, by_: string)
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysOneRowPerMonth(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysCompleteFinalized(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysRunBounded(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysAttemptRecorded(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysNoReorderingRevert(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysSentNoncesIssued(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysLegacyCompleteSettled(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysAdmittedRootIsRowRoot(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysV2CompleteMeansCursorDone(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysLatestAttemptKnown(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysHeldTotalWrong(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysReleasedUntouched(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> alwaysClosedUnadmitted(observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepCompletionPermanent(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepOtherRowsUnchanged(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepNoAdmissionWithoutAdmit(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepAdmissionUsesLatestAttempt(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepAdmissionNeedsCurrentConsent(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepJournalFollows(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepSequenceMonotone(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepAdmittedRootFixed(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepWrongTotalNeverCompletes(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepReleasedPermanent(e, observeWrongTotal(e, key, by_)))
  ensures (inv(e) ==> canObserveWrongTotal(e, key, by_) ==> stepRefusalPermanent(e, observeWrongTotal(e, key, by_)))
{
  hide *;
  if inv(e) && canObserveWrongTotal(e, key, by_) {
    reveal inv, canObserveWrongTotal, observeWrongTotal, alwaysRunBounded, fresh_;
    var after := observeWrongTotal(e, key, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && (((r0.key == key) && r0.v2) && (r0.phase.Pending? || r0.phase.Submitted?));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    RowFacts(e, r0);
    assert (settlement__executorJournal_admittedV2(r0.journal, r0.period, r0.root) && !(settlement__money_equalAmounts(v2Total(r0.journal, r0.period, r0.root), r0.total)));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(phase := RowPhase.WrongTotal, heldTotal := v2Total(r0.journal, r0.period, r0.root));
    assert after.rows[t] == r1;
    SingleRowFrames(e, after, t);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma observeReleased_ensures(e: Execution, key: int, receipt: settlement__reserveRelease_ReleaseReceipt, by_: string)
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysOneRowPerMonth(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysCompleteFinalized(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysRunBounded(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysAttemptRecorded(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysNoReorderingRevert(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysSentNoncesIssued(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysLegacyCompleteSettled(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysAdmittedRootIsRowRoot(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysV2CompleteMeansCursorDone(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysLatestAttemptKnown(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysHeldTotalWrong(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysReleasedUntouched(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> alwaysClosedUnadmitted(observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepCompletionPermanent(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepOtherRowsUnchanged(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepNoAdmissionWithoutAdmit(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepAdmissionUsesLatestAttempt(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepAdmissionNeedsCurrentConsent(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepJournalFollows(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepSequenceMonotone(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepAdmittedRootFixed(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepWrongTotalNeverCompletes(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepReleasedPermanent(e, observeReleased(e, key, receipt, by_)))
  ensures (inv(e) ==> canObserveReleased(e, key, receipt, by_) ==> stepRefusalPermanent(e, observeReleased(e, key, receipt, by_)))
{
  if inv(e) && canObserveReleased(e, key, receipt, by_) {
    var after := observeReleased(e, key, receipt, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && ((r0.key == key) && r0.phase.WrongTotal?);
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    assert ((((((((receipt.attempt > 0) && (receipt.height > 0)) && receipt.finalized) && receipt.succeeded) && (receipt.root == r0.root)) && settlement__money_equalAmounts(receipt.settledAmount, settlement__money_zero)) && settlement__money_equalAmounts(receipt.releasedAmount, r0.heldTotal)) && (|r0.journal.leaves| == 0));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(phase := RowPhase.Released, height := receipt.height);
    assert after.rows[t] == r1;
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma refuseUnadmitted_ensures(e: Execution, key: int, by_: string)
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysOneRowPerMonth(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysCompleteFinalized(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysRunBounded(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysAttemptRecorded(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysNoReorderingRevert(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysSentNoncesIssued(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysLegacyCompleteSettled(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysAdmittedRootIsRowRoot(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysV2CompleteMeansCursorDone(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysLatestAttemptKnown(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysHeldTotalWrong(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysReleasedUntouched(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> alwaysClosedUnadmitted(refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepCompletionPermanent(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepOtherRowsUnchanged(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepNoAdmissionWithoutAdmit(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepAdmissionUsesLatestAttempt(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepAdmissionNeedsCurrentConsent(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepJournalFollows(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepSequenceMonotone(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepAdmittedRootFixed(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepWrongTotalNeverCompletes(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepReleasedPermanent(e, refuseUnadmitted(e, key, by_)))
  ensures (inv(e) ==> canRefuseUnadmitted(e, key, by_) ==> stepRefusalPermanent(e, refuseUnadmitted(e, key, by_)))
{
  hide *;
  if inv(e) && canRefuseUnadmitted(e, key, by_) {
    reveal inv, canRefuseUnadmitted, refuseUnadmitted, alwaysRunBounded, fresh_;
    var after := refuseUnadmitted(e, key, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && (((r0.key == key) && r0.phase.Pending?) && !(r0.solana));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    RowFacts(e, r0);
    assert ((!(settlement__executorJournal_admitted(r0.journal, r0.period)) && !(settlement__executorJournal_hasLiveRoot(r0.journal, r0.period))) && (r0.journal.time >= settlement__monthlyCommitment_windowClosesAt(r0.period)));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(phase := RowPhase.ClosedUnadmitted);
    assert after.rows[t] == r1;
    SingleRowFrames(e, after, t);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

lemma selectRow_ensures(e: Execution, key: int, prerequisite: bool, by_: string)
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysOneRowPerMonth(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysCompleteFinalized(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysRunBounded(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysAttemptRecorded(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysNoReorderingRevert(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysSentNoncesIssued(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysLegacyCompleteSettled(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysAdmittedRootIsRowRoot(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysV2CompleteMeansCursorDone(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysLatestAttemptKnown(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysHeldTotalWrong(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysReleasedUntouched(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> alwaysClosedUnadmitted(selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepCompletionPermanent(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepOtherRowsUnchanged(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepNoAdmissionWithoutAdmit(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepAdmissionUsesLatestAttempt(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepAdmissionNeedsCurrentConsent(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepJournalFollows(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepSequenceMonotone(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepAdmittedRootFixed(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepWrongTotalNeverCompletes(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepReleasedPermanent(e, selectRow(e, key, prerequisite, by_)))
  ensures (inv(e) ==> canSelectRow(e, key, prerequisite, by_) ==> stepRefusalPermanent(e, selectRow(e, key, prerequisite, by_)))
{
  if inv(e) && canSelectRow(e, key, prerequisite, by_) {
    var after := selectRow(e, key, prerequisite, by_);
    assert after.rows == e.rows;
    KeysFrame(e, after);
    OthersFrame(e, after);
    JournalsFrame(e, after);
    SubmissionsFrame(e, after);
    PhasesFrame(e, after);
    AttemptsFrame(e, after);
  }
}

lemma signAttempt_ensures(e: Execution, key: int, sequence: int, tree: Tree, by_: string)
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysOneRowPerMonth(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysCompleteFinalized(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysRunBounded(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysAttemptRecorded(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysNoReorderingRevert(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysSentNoncesIssued(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysLegacyCompleteSettled(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysAdmittedRootIsRowRoot(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysV2CompleteMeansCursorDone(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysLatestAttemptKnown(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysHeldTotalWrong(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysReleasedUntouched(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> alwaysClosedUnadmitted(signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepCompletionPermanent(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepOtherRowsUnchanged(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepNoAdmissionWithoutAdmit(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepAdmissionUsesLatestAttempt(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepAdmissionNeedsCurrentConsent(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepJournalFollows(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepSequenceMonotone(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepAdmittedRootFixed(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepWrongTotalNeverCompletes(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepReleasedPermanent(e, signAttempt(e, key, sequence, tree, by_)))
  ensures (inv(e) ==> canSignAttempt(e, key, sequence, tree, by_) ==> stepRefusalPermanent(e, signAttempt(e, key, sequence, tree, by_)))
{
  hide *;
  if inv(e) && canSignAttempt(e, key, sequence, tree, by_) {
    reveal inv, canSignAttempt, signAttempt, laterAttempt, alwaysRunBounded, fresh_, admissionFits, monthOnly, settlement__executorJournal_admitted;
    var after := signAttempt(e, key, sequence, tree, by_);
    KeyIdx(e);
    var r0 :| r0 in e.rows && (((r0.key == key) && r0.v2) && (r0.phase.Pending? || r0.phase.Submitted?));
    var t :| 0 <= t < |e.rows| && e.rows[t] == r0;
    RowFacts(e, r0);
    assert ((((sequence > r0.latestSequence) && laterAttempt(r0, tree)) && windowOpen(r0.period, e.now)) && !(settlement__executorJournal_admitted(r0.journal, r0.period)));
    forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] { }
    var r1 := r0.(latest := tree, latestSequence := sequence, latestSource := sourceOf(e, r0.project, r0.network, r0.vault));
    assert after.rows[t] == r1;
    assert r0.sequence <= r0.latestSequence;
    assert !fresh_(r1);
    assert settlement__executorJournal_wellFormed(r0.journal) && monthOnly(r0.journal, r0.period);
    assert forall a :: a in r0.journal.admissions ==> false;
    assert admissionFits(r1, r0.journal);
    SingleRowFrames(e, after, t);
    forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      if i != t { assert e.rows[i] in e.rows; }
    }
    RowsLocal(e, after, after.rows[t]);
    AttemptsFrame(e, after);
  }
}

// ---- Folds that look up one matching element ----

lemma FoldNone<A, T>(f: (A, T) -> A, init: A, xs: seq<T>, m: T -> bool)
  requires forall a, x :: !m(x) ==> f(a, x) == a
  requires forall i :: 0 <= i < |xs| ==> !m(xs[i])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
  decreases |xs|
{
  if |xs| > 0 {
    assert f(init, xs[0]) == init;
    FoldNone(f, init, xs[1..], m);
  }
}

lemma FoldUnique<A, T>(f: (A, T) -> A, init: A, xs: seq<T>, m: T -> bool, v: T -> A, i: int)
  requires forall a, x :: f(a, x) == (if m(x) then v(x) else a)
  requires 0 <= i < |xs| && m(xs[i])
  requires forall k :: 0 <= k < |xs| && k != i ==> !m(xs[k])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == v(xs[i])
  decreases |xs|
{
  if i == 0 {
    assert f(init, xs[0]) == v(xs[0]);
    FoldNone(f, v(xs[0]), xs[1..], m);
  } else {
    assert f(init, xs[0]) == init;
    FoldUnique(f, init, xs[1..], m, v, i - 1);
  }
}

// ---- The journal a row holds ----

lemma JournalCursorsUnique(j: settlement__executorJournal_Journal)
  requires settlement__executorJournal_alwaysCursorBacked(j)
  ensures forall i, k :: 0 <= i < |j.cursors| && 0 <= k < |j.cursors| && i != k ==> !(j.cursors[i].period == j.cursors[k].period && j.cursors[i].root == j.cursors[k].root)
{
  assert settlement__executorJournal_alwaysCursorBacked(j) == !((exists c :: c in j.cursors && !(((((settlement__executorJournal_admittedV2(j, c.period, c.root) && (c.next > 0)) && (c.next <= settlement__executorJournal_leafCountOf(j, c.period, c.root))) && (|ProofLib.Filter((o: settlement__executorJournal_Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors)| == 1)) && (|ProofLib.Filter((k: settlement__executorJournal_JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), j.leaves)| == c.next)))));
  forall i, m | 0 <= i < |j.cursors| && 0 <= m < |j.cursors| && i != m
    ensures !(j.cursors[i].period == j.cursors[m].period && j.cursors[i].root == j.cursors[m].root)
  {
    var c := j.cursors[i];
    assert c in j.cursors;
    if j.cursors[m].period == c.period && j.cursors[m].root == c.root {
      ProofLib.FilterTwo((o: settlement__executorJournal_Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors, i, m);
    }
  }
}

lemma JournalCursorOfIs(j: settlement__executorJournal_Journal, period: int, root: string, i: int)
  requires 0 <= i < |j.cursors| && j.cursors[i].period == period && j.cursors[i].root == root
  requires forall k :: 0 <= k < |j.cursors| && k != i ==> !(j.cursors[k].period == period && j.cursors[k].root == root)
  ensures settlement__executorJournal_cursorOf(j, period, root) == j.cursors[i].next
{
  FoldUnique((n: int, c: settlement__executorJournal_Cursor) => (if ((c.period == period) && (c.root == root)) then c.next else n), 0, j.cursors,
    (c: settlement__executorJournal_Cursor) => ((c.period == period) && (c.root == root)), (c: settlement__executorJournal_Cursor) => c.next, i);
}

// A well-formed journal follows itself.
lemma FollowsRefl(j: settlement__executorJournal_Journal)
  requires settlement__executorJournal_alwaysCursorBacked(j)
  ensures settlement__executorJournal_follows(j, j)
{
  JournalCursorsUnique(j);
  forall c | c in j.cursors ensures settlement__executorJournal_cursorOf(j, c.period, c.root) >= c.next {
    var i :| 0 <= i < |j.cursors| && j.cursors[i] == c;
    JournalCursorOfIs(j, c.period, c.root, i);
  }
  forall x | x in j.entries ensures settlement__executorJournal_entryKept(j, x) {
    assert x in j.entries;
  }
}

lemma JournalAdmissionsUnique(j: settlement__executorJournal_Journal)
  requires settlement__executorJournal_alwaysOneRootPerPeriod(j)
  ensures forall i, k :: 0 <= i < |j.admissions| && 0 <= k < |j.admissions| && i != k ==> j.admissions[i].period != j.admissions[k].period
{
  assert settlement__executorJournal_alwaysOneRootPerPeriod(j) == !((exists a :: a in j.admissions && !(((((!a.kind.Leaf?) && (a.root != "")) && (a.count > 0)) && (|ProofLib.Filter((o: settlement__executorJournal_Admission) => (o.period == a.period), j.admissions)| == 1)))));
  forall i, m | 0 <= i < |j.admissions| && 0 <= m < |j.admissions| && i != m
    ensures j.admissions[i].period != j.admissions[m].period
  {
    var a := j.admissions[i];
    assert a in j.admissions;
    if j.admissions[m].period == a.period {
      ProofLib.FilterTwo((o: settlement__executorJournal_Admission) => (o.period == a.period), j.admissions, i, m);
    }
  }
}

lemma V2TotalIs(j: settlement__executorJournal_Journal, period: int, root: string, i: int)
  requires 0 <= i < |j.admissions| && j.admissions[i].period == period && j.admissions[i].kind.V2Root? && j.admissions[i].root == root
  requires forall k :: 0 <= k < |j.admissions| && k != i ==> j.admissions[k].period != period
  ensures v2Total(j, period, root) == j.admissions[i].total
{
  FoldUnique((t: seq<int>, a: settlement__executorJournal_Admission) => (if (((a.period == period) && a.kind.V2Root?) && (a.root == root)) then a.total else t), settlement__money_zero, j.admissions,
    (a: settlement__executorJournal_Admission) => (((a.period == period) && a.kind.V2Root?) && (a.root == root)), (a: settlement__executorJournal_Admission) => a.total, i);
}

// A later journal keeps the admitted root of a period and its gross total.
lemma V2TotalKept(j: settlement__executorJournal_Journal, later: settlement__executorJournal_Journal, period: int, root: string)
  requires settlement__executorJournal_alwaysOneRootPerPeriod(j) && settlement__executorJournal_alwaysOneRootPerPeriod(later)
  requires settlement__executorJournal_admittedV2(j, period, root)
  requires settlement__executorJournal_stepCommittedPermanent(j, later)
  ensures settlement__executorJournal_admittedV2(later, period, root)
  ensures v2Total(later, period, root) == v2Total(j, period, root)
{
  JournalAdmissionsUnique(j);
  JournalAdmissionsUnique(later);
  var a :| a in j.admissions && (((a.period == period) && a.kind.V2Root?) && (a.root == root));
  var i :| 0 <= i < |j.admissions| && j.admissions[i] == a;
  assert a in later.admissions;
  var k :| 0 <= k < |later.admissions| && later.admissions[k] == a;
  V2TotalIs(j, period, root, i);
  V2TotalIs(later, period, root, k);
}

// ---- Rows: one per key and per month ----

lemma KeyBridge(e: Execution)
  ensures alwaysOneRowPerMonth(e) == !((exists r :: r in e.rows && !((((r.key > 0) && (|ProofLib.Filter((o: Row) => (o.key == r.key), e.rows)| == 1)) && (|ProofLib.Filter((o: Row) => (((o.project == r.project) && (o.period == r.period)) && (o.network == r.network)), e.rows)| == 1)))))
{
}

lemma KeyIdx(e: Execution)
  requires alwaysOneRowPerMonth(e)
  ensures forall i :: 0 <= i < |e.rows| ==> e.rows[i].key > 0
  ensures forall i, k :: 0 <= i < |e.rows| && 0 <= k < |e.rows| && i != k ==> (e.rows[i].key != e.rows[k].key
    && !(e.rows[i].project == e.rows[k].project && e.rows[i].period == e.rows[k].period && e.rows[i].network == e.rows[k].network))
{
  KeyBridge(e);
  forall i | 0 <= i < |e.rows| ensures e.rows[i].key > 0 {
    assert e.rows[i] in e.rows;
  }
  forall i, m | 0 <= i < |e.rows| && 0 <= m < |e.rows| && i != m
    ensures e.rows[i].key != e.rows[m].key
      && !(e.rows[i].project == e.rows[m].project && e.rows[i].period == e.rows[m].period && e.rows[i].network == e.rows[m].network)
  {
    var r := e.rows[i];
    assert r in e.rows;
    if e.rows[m].key == r.key {
      ProofLib.FilterTwo((o: Row) => (o.key == r.key), e.rows, i, m);
    }
    if e.rows[m].project == r.project && e.rows[m].period == r.period && e.rows[m].network == r.network {
      ProofLib.FilterTwo((o: Row) => (((o.project == r.project) && (o.period == r.period)) && (o.network == r.network)), e.rows, i, m);
    }
  }
}

lemma KeyOk(e: Execution)
  requires forall i :: 0 <= i < |e.rows| ==> e.rows[i].key > 0
  requires forall i, k :: 0 <= i < |e.rows| && 0 <= k < |e.rows| && i != k ==> (e.rows[i].key != e.rows[k].key
    && !(e.rows[i].project == e.rows[k].project && e.rows[i].period == e.rows[k].period && e.rows[i].network == e.rows[k].network))
  ensures alwaysOneRowPerMonth(e)
{
  KeyBridge(e);
  forall r | r in e.rows
    ensures ((r.key > 0) && (|ProofLib.Filter((o: Row) => (o.key == r.key), e.rows)| == 1)) && (|ProofLib.Filter((o: Row) => (((o.project == r.project) && (o.period == r.period)) && (o.network == r.network)), e.rows)| == 1)
  {
    var i :| 0 <= i < |e.rows| && e.rows[i] == r;
    ProofLib.FilterOne((o: Row) => (o.key == r.key), e.rows, i);
    ProofLib.FilterOne((o: Row) => (((o.project == r.project) && (o.period == r.period)) && (o.network == r.network)), e.rows, i);
  }
}

// ---- Rows whose identity is unchanged, position by position ----

lemma KeysFrame(e: Execution, after: Execution)
  requires alwaysOneRowPerMonth(e)
  requires |after.rows| == |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (after.rows[i].key == e.rows[i].key && after.rows[i].project == e.rows[i].project
    && after.rows[i].period == e.rows[i].period && after.rows[i].network == e.rows[i].network)
  ensures alwaysOneRowPerMonth(after)
{
  KeyIdx(e);
  KeyOk(after);
}

lemma OthersFrame(e: Execution, after: Execution)
  requires |after.rows| >= |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (e.rows[i].key == after.touched || after.rows[i] == e.rows[i])
  ensures stepOtherRowsUnchanged(e, after)
{
  forall r | r in e.rows && r.key != after.touched ensures r in after.rows {
    var i :| 0 <= i < |e.rows| && e.rows[i] == r;
    assert after.rows[i] in after.rows;
  }
}

// Rows that keep their journal, or read a later well-formed one of their month, keep every journal rule; a row's root
// changes only before its month admits a root, and its sequence never decreases.
lemma JournalsFrame(e: Execution, after: Execution)
  requires alwaysOneRowPerMonth(e) && alwaysAdmittedRootIsRowRoot(e)
  requires |after.rows| >= |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (after.rows[i].key == e.rows[i].key && after.rows[i].period == e.rows[i].period
    && after.rows[i].legacyRoot == e.rows[i].legacyRoot && after.rows[i].v2 == e.rows[i].v2 && after.rows[i].sequence >= e.rows[i].sequence
    && (after.rows[i].root == e.rows[i].root || !settlement__executorJournal_admitted(e.rows[i].journal, e.rows[i].period))
    && ((after.rows[i].journal == e.rows[i].journal && after.rows[i].root == e.rows[i].root && after.rows[i].total == e.rows[i].total
        && after.rows[i].leafCount == e.rows[i].leafCount && after.rows[i].sequence == e.rows[i].sequence
        && after.rows[i].latestSequence == e.rows[i].latestSequence)
      || (settlement__executorJournal_follows(e.rows[i].journal, after.rows[i].journal) && settlement__executorJournal_wellFormed(after.rows[i].journal)
        && monthOnly(after.rows[i].journal, after.rows[i].period) && admissionFits(after.rows[i], after.rows[i].journal))))
  requires forall i, k :: |e.rows| <= i < |after.rows| && 0 <= k < |e.rows| ==> after.rows[i].key != e.rows[k].key
  requires forall i :: |e.rows| <= i < |after.rows| ==> (settlement__executorJournal_wellFormed(after.rows[i].journal)
    && monthOnly(after.rows[i].journal, after.rows[i].period) && admissionFits(after.rows[i], after.rows[i].journal))
  ensures alwaysAdmittedRootIsRowRoot(after) && stepJournalFollows(e, after) && stepAdmittedRootFixed(e, after) && stepSequenceMonotone(e, after)
{
  KeyIdx(e);
  forall r | r in after.rows
    ensures settlement__executorJournal_wellFormed(r.journal) && monthOnly(r.journal, r.period) && admissionFits(r, r.journal)
    ensures forall o :: o in e.rows && o.key == r.key ==> (settlement__executorJournal_follows(o.journal, r.journal)
      && r.sequence >= o.sequence && (!settlement__executorJournal_admitted(o.journal, o.period) || r.root == o.root))
  {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    if i < |e.rows| {
      assert e.rows[i] in e.rows;
      if r.journal == e.rows[i].journal && r.root == e.rows[i].root && r.total == e.rows[i].total && r.leafCount == e.rows[i].leafCount
        && r.sequence == e.rows[i].sequence && r.latestSequence == e.rows[i].latestSequence {
        FollowsRefl(r.journal);
      }
      forall o | o in e.rows && o.key == r.key ensures o == e.rows[i] {
        var k :| 0 <= k < |e.rows| && e.rows[k] == o;
      }
    } else {
      forall o | o in e.rows && o.key == r.key ensures false {
        var k :| 0 <= k < |e.rows| && e.rows[k] == o;
      }
    }
  }
}

// No row becomes submitted without admission, unless the step submits it with admission.
lemma SubmissionsFrame(e: Execution, after: Execution)
  requires alwaysOneRowPerMonth(e)
  requires |after.rows| >= |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (after.rows[i].key == e.rows[i].key
    && ((after.rows[i].phase.Submitted? && !after.rows[i].lastAdmit && e.rows[i].phase.Pending?)
      ==> (after.rows[i].solana || settlement__executorJournal_admitted(after.rows[i].journal, after.rows[i].period)))
    && ((after.rows[i].phase.Submitted? && after.rows[i].lastAdmit && e.rows[i].phase.Pending?)
      ==> (fresh_(after.rows[i]) && after.rows[i].root == after.rows[i].latest.root
        && admissible(after.rows[i]) && windowOpen(after.rows[i].period, after.now))))
  requires forall i, k :: |e.rows| <= i < |after.rows| && 0 <= k < |e.rows| ==> after.rows[i].key != e.rows[k].key
  ensures stepNoAdmissionWithoutAdmit(e, after)
  ensures stepAdmissionUsesLatestAttempt(e, after)
  ensures stepAdmissionNeedsCurrentConsent(e, after)
{
  KeyIdx(e);
  forall r | r in after.rows && r.phase.Submitted? && r.lastAdmit && (exists o :: o in e.rows && o.key == r.key && o.phase.Pending?)
    ensures admissible(r) && windowOpen(r.period, after.now)
  {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    var o :| o in e.rows && o.key == r.key && o.phase.Pending?;
    var k :| 0 <= k < |e.rows| && e.rows[k] == o;
    assert i == k;
  }
  forall r | r in after.rows && r.phase.Submitted? && r.lastAdmit && (exists o :: o in e.rows && o.key == r.key && o.phase.Pending?)
    ensures fresh_(r) && r.root == r.latest.root
  {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    var o :| o in e.rows && o.key == r.key && o.phase.Pending?;
    var k :| 0 <= k < |e.rows| && e.rows[k] == o;
    assert i == k;
  }
  forall r | r in after.rows && r.phase.Submitted? && !r.lastAdmit && (exists o :: o in e.rows && o.key == r.key && o.phase.Pending?)
    ensures r.solana || settlement__executorJournal_admitted(r.journal, r.period)
  {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    var o :| o in e.rows && o.key == r.key && o.phase.Pending?;
    var k :| 0 <= k < |e.rows| && e.rows[k] == o;
    assert i == k;
  }
}

// Completed, held, released and refused rows stay so.
lemma PhasesFrame(e: Execution, after: Execution)
  requires alwaysOneRowPerMonth(e)
  requires |after.rows| >= |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (after.rows[i].key == e.rows[i].key
    && (e.rows[i].phase.Complete? ==> after.rows[i] == e.rows[i])
    && (e.rows[i].phase.ClosedUnadmitted? ==> after.rows[i] == e.rows[i])
    && (e.rows[i].phase.Released? ==> after.rows[i].phase.Released?)
    && (e.rows[i].phase.WrongTotal? ==> (after.rows[i].phase.WrongTotal? || after.rows[i].phase.Released?)))
  requires forall i, k :: |e.rows| <= i < |after.rows| && 0 <= k < |e.rows| ==> after.rows[i].key != e.rows[k].key
  ensures stepCompletionPermanent(e, after) && stepRefusalPermanent(e, after)
  ensures stepWrongTotalNeverCompletes(e, after) && stepReleasedPermanent(e, after)
{
  KeyIdx(e);
  forall o | o in e.rows
    ensures (o.phase.Complete? ==> o in after.rows) && (o.phase.ClosedUnadmitted? ==> o in after.rows)
    ensures forall r :: r in after.rows && r.key == o.key ==> ((o.phase.Released? ==> r.phase.Released?)
      && (o.phase.WrongTotal? ==> (r.phase.WrongTotal? || r.phase.Released?)))
  {
    var k :| 0 <= k < |e.rows| && e.rows[k] == o;
    assert after.rows[k] in after.rows;
    forall r | r in after.rows && r.key == o.key ensures r == after.rows[k] {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    }
  }
}

// A send changes its own pending row only, with the facts its guard gives.
lemma SubmitSent(e: Execution, key: int, sendResult: SendResult, admit: bool, by_: string, t: int)
  requires inv(e) && sendResult.Sent?
  requires 0 <= t < |e.rows| && e.rows[t].key == key && e.rows[t].phase.Pending? && e.rows[t].lastAttempt == e.now
  requires attemptedThisRun(e, key) && !(key in e.processed)
  requires forall i :: 0 <= i < |e.rows| && i != t ==> e.rows[i].key != key
  requires !(revertsIfSent(e, e.rows[t])) && !e.rows[t].invalidated
  requires admit ==> (fresh_(e.rows[t]) && e.rows[t].root == e.rows[t].latest.root)
  requires admit ==> (admissible(e.rows[t]) && windowOpen(e.rows[t].period, e.now))
  requires !admit ==> (e.rows[t].solana || settlement__executorJournal_admitted(e.rows[t].journal, e.rows[t].period))
  ensures inv(submit(e, key, sendResult, admit, by_))
  ensures stepCompletionPermanent(e, submit(e, key, sendResult, admit, by_))
  ensures stepOtherRowsUnchanged(e, submit(e, key, sendResult, admit, by_))
  ensures stepNoAdmissionWithoutAdmit(e, submit(e, key, sendResult, admit, by_))
  ensures stepAdmissionUsesLatestAttempt(e, submit(e, key, sendResult, admit, by_))
  ensures stepAdmissionNeedsCurrentConsent(e, submit(e, key, sendResult, admit, by_))
  ensures stepJournalFollows(e, submit(e, key, sendResult, admit, by_))
  ensures stepSequenceMonotone(e, submit(e, key, sendResult, admit, by_))
  ensures stepAdmittedRootFixed(e, submit(e, key, sendResult, admit, by_))
  ensures stepWrongTotalNeverCompletes(e, submit(e, key, sendResult, admit, by_))
  ensures stepReleasedPermanent(e, submit(e, key, sendResult, admit, by_))
  ensures stepRefusalPermanent(e, submit(e, key, sendResult, admit, by_))
{
  var after := submit(e, key, sendResult, admit, by_);
  var r0 := e.rows[t];
  assert r0 in e.rows;
  NoReorderRevert(e, r0);
  SubmitShape(e, key, sendResult, admit, by_, t);
  KeysFrame(e, after);
  OthersFrame(e, after);
  JournalsFrame(e, after);
  SubmissionsFrame(e, after);
  PhasesFrame(e, after);
  forall r | r in after.rows ensures r == after.rows[t] || r in e.rows {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    if i != t { assert e.rows[i] in e.rows; }
  }
  RowsLocal(e, after, after.rows[t]);
  AttemptsFrame(e, after);
}

// A send changes only its own row: no other row was sent at a later nonce.
lemma SubmitShape(e: Execution, key: int, sendResult: SendResult, admit: bool, by_: string, t: int)
  requires alwaysSentNoncesIssued(e) && sendResult.Sent?
  requires 0 <= t < |e.rows| && e.rows[t].key == key
  requires forall i :: 0 <= i < |e.rows| && i != t ==> e.rows[i].key != key
  requires !(revertsIfSent(e, e.rows[t])) && !(reorderReverts(e, e.rows[t])) && !e.rows[t].invalidated
  ensures |submit(e, key, sendResult, admit, by_).rows| == |e.rows|
  ensures forall i :: 0 <= i < |e.rows| && i != t ==> submit(e, key, sendResult, admit, by_).rows[i] == e.rows[i]
  ensures submit(e, key, sendResult, admit, by_).rows[t] == e.rows[t].(phase := RowPhase.Submitted, sentNonce := e.sends, lastAdmit := admit, sentWithoutAdmit := (e.rows[t].sentWithoutAdmit || !(admit)))
  ensures submit(e, key, sendResult, admit, by_).sends == e.sends + 1
{
  var after := submit(e, key, sendResult, admit, by_);
  forall i | 0 <= i < |e.rows| && i != t ensures after.rows[i] == e.rows[i] {
    assert e.rows[i] in e.rows;
  }
}

// Row rules hold after a step that changes at most one row, x, when they hold of x.
lemma RowsLocal(e: Execution, after: Execution, x: Row)
  requires alwaysCompleteFinalized(e) && alwaysNoReorderingRevert(e) && alwaysSentNoncesIssued(e) && alwaysLegacyCompleteSettled(e)
  requires alwaysV2CompleteMeansCursorDone(e) && alwaysHeldTotalWrong(e) && alwaysReleasedUntouched(e) && alwaysClosedUnadmitted(e)
  requires alwaysLatestAttemptKnown(e)
  requires forall r :: r in after.rows ==> (r in e.rows || r == x)
  requires x.sequence >= 1 && x.sequence <= x.latestSequence && validTree(x.latest) && x.latest.legacyRoot == x.legacyRoot
    && x.latest.whole == x.wholeGross && x.latest.digest == x.digest
    && (!(fresh_(x)) || (x.root == x.latest.root && x.total == x.latest.total && x.leafCount == x.latest.count))
  requires after.reverts == e.reverts && after.sends >= e.sends
  requires (!(x.phase.Complete?) || (x.height > 0)) && !(x.invalidated)
  requires (x.sentNonce < after.sends) && ((x.sentNonce >= 0) || (x.sentNonce == -1))
  requires (!(((x.phase.Complete? && !(x.v2)) && !(x.solana))) || (settlement__executorJournal_admittedLegacy(x.journal, x.period, x.root) && settlement__executorJournal_rootSettled(x.journal, x.period)))
  requires (!((x.v2 && x.phase.Complete?)) || (settlement__executorJournal_rootSettled(x.journal, x.period) && (cursorDone(x) || legacyWon(x))))
  requires (!((x.phase.WrongTotal? || x.phase.Released?)) || (((x.v2 && settlement__executorJournal_admittedV2(x.journal, x.period, x.root)) && !(settlement__money_equalAmounts(x.heldTotal, x.total))) && (x.heldTotal == v2Total(x.journal, x.period, x.root))))
  requires (!(x.phase.Released?) || ((x.height > 0) && (|x.journal.leaves| == 0)))
  requires (!(x.phase.ClosedUnadmitted?) || (((!(x.solana) && !(settlement__executorJournal_admitted(x.journal, x.period))) && !(settlement__executorJournal_hasLiveRoot(x.journal, x.period))) && (x.journal.time >= settlement__monthlyCommitment_windowClosesAt(x.period))))
  ensures alwaysCompleteFinalized(after) && alwaysNoReorderingRevert(after) && alwaysSentNoncesIssued(after) && alwaysLegacyCompleteSettled(after)
  ensures alwaysV2CompleteMeansCursorDone(after) && alwaysHeldTotalWrong(after) && alwaysReleasedUntouched(after) && alwaysClosedUnadmitted(after)
  ensures alwaysLatestAttemptKnown(after)
{
}

// Marking one row's attempt records it in this run at the scheduler clock.
lemma AttemptsAfterMark(e: Execution, after: Execution, key: int, t: int)
  requires alwaysAttemptRecorded(e)
  requires after.now == e.now && after.processed == e.processed
  requires (after.ordinaryRun == e.ordinaryRun + [key] && after.prerequisiteRun == e.prerequisiteRun)
    || (after.ordinaryRun == e.ordinaryRun && after.prerequisiteRun == e.prerequisiteRun + [key])
  requires |after.rows| == |e.rows| && 0 <= t < |e.rows| && e.rows[t].key == key && after.rows[t].key == key && after.rows[t].lastAttempt == e.now
  requires forall i :: 0 <= i < |e.rows| && i != t ==> (after.rows[i] == e.rows[i] && e.rows[i].key != key)
  ensures alwaysAttemptRecorded(after)
{
  forall r | r in after.rows ensures (!(attemptedThisRun(after, r.key)) || (r.lastAttempt == after.now)) && (r.lastAttempt <= after.now) {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    if i != t { assert e.rows[i] in e.rows; }
  }
  assert after.rows[t] in after.rows;
  forall k | k in e.ordinaryRun || k in e.prerequisiteRun ensures hasRow(after, k) {
    var r :| r in e.rows && r.key == k;
    var i :| 0 <= i < |e.rows| && e.rows[i] == r;
    assert after.rows[i] in after.rows;
  }
}

// A step that keeps every row's key and attempt time, and the run, keeps attempts recorded; it may mark one attempted
// row processed.
lemma AttemptsFrame(e: Execution, after: Execution)
  requires alwaysAttemptRecorded(e)
  requires after.now == e.now && after.ordinaryRun == e.ordinaryRun && after.prerequisiteRun == e.prerequisiteRun
  requires forall k :: k in after.processed ==> (k in e.processed || attemptedThisRun(e, k))
  requires |after.rows| == |e.rows|
  requires forall i :: 0 <= i < |e.rows| ==> (after.rows[i].key == e.rows[i].key && after.rows[i].lastAttempt == e.rows[i].lastAttempt)
  ensures alwaysAttemptRecorded(after)
{
  forall r | r in after.rows ensures (!(attemptedThisRun(after, r.key)) || (r.lastAttempt == after.now)) && (r.lastAttempt <= after.now) {
    var i :| 0 <= i < |after.rows| && after.rows[i] == r;
    assert e.rows[i] in e.rows;
  }
  forall k | k in e.ordinaryRun || k in e.prerequisiteRun ensures hasRow(after, k) {
    var r :| r in e.rows && r.key == k;
    var i :| 0 <= i < |e.rows| && e.rows[i] == r;
    assert after.rows[i] in after.rows;
  }
}

// The executor's guard covers every reverting send: an award-recording step of the vault is a step in flight.
lemma SingleRowFrames(e: Execution, after: Execution, t: int)
  requires inv(e)
  requires |after.rows| == |e.rows| && 0 <= t < |e.rows| && after.touched == e.rows[t].key
  requires forall i :: 0 <= i < |e.rows| && i != t ==> after.rows[i] == e.rows[i]
  requires after.rows[t].key == e.rows[t].key && after.rows[t].project == e.rows[t].project
    && after.rows[t].period == e.rows[t].period && after.rows[t].network == e.rows[t].network
  requires after.rows[t].legacyRoot == e.rows[t].legacyRoot && after.rows[t].v2 == e.rows[t].v2
    && after.rows[t].sequence == e.rows[t].sequence && after.rows[t].root == e.rows[t].root
    && after.rows[t].total == e.rows[t].total && after.rows[t].leafCount == e.rows[t].leafCount
    && after.rows[t].journal == e.rows[t].journal
  requires after.rows[t].latestSequence == e.rows[t].latestSequence
    || (settlement__executorJournal_wellFormed(after.rows[t].journal) && monthOnly(after.rows[t].journal, after.rows[t].period) && admissionFits(after.rows[t], after.rows[t].journal))
  requires !(after.rows[t].phase.Submitted? && e.rows[t].phase.Pending?)
  requires !e.rows[t].phase.Complete? && !e.rows[t].phase.ClosedUnadmitted? && !e.rows[t].phase.Released? && !e.rows[t].phase.WrongTotal?
  ensures alwaysOneRowPerMonth(after) && stepOtherRowsUnchanged(e, after)
  ensures alwaysAdmittedRootIsRowRoot(after) && stepJournalFollows(e, after) && stepAdmittedRootFixed(e, after) && stepSequenceMonotone(e, after)
  ensures stepNoAdmissionWithoutAdmit(e, after) && stepAdmissionUsesLatestAttempt(e, after) && stepAdmissionNeedsCurrentConsent(e, after)
  ensures stepCompletionPermanent(e, after) && stepRefusalPermanent(e, after) && stepWrongTotalNeverCompletes(e, after) && stepReleasedPermanent(e, after)
{
  hide *;
  reveal inv, settlement__executorJournal_wellFormed;
  RowFacts(e, e.rows[t]);
  FollowsRefl(e.rows[t].journal);
  KeysFrame(e, after);
  OthersFrame(e, after);
  JournalsFrame(e, after);
  SubmissionsFrame(e, after);
  PhasesFrame(e, after);
}

lemma RowFacts(e: Execution, x: Row)
  requires inv(e) && x in e.rows
  ensures x.sequence >= 1 && x.sequence <= x.latestSequence && validTree(x.latest) && x.latest.legacyRoot == x.legacyRoot
    && x.latest.whole == x.wholeGross && x.latest.digest == x.digest
    && (!(fresh_(x)) || (x.root == x.latest.root && x.total == x.latest.total && x.leafCount == x.latest.count))
  ensures (!(x.phase.Complete?) || (x.height > 0)) && !(x.invalidated)
  ensures (x.sentNonce < e.sends) && ((x.sentNonce >= 0) || (x.sentNonce == -1))
  ensures (!(((x.phase.Complete? && !(x.v2)) && !(x.solana))) || (settlement__executorJournal_admittedLegacy(x.journal, x.period, x.root) && settlement__executorJournal_rootSettled(x.journal, x.period)))
  ensures (!((x.v2 && x.phase.Complete?)) || (settlement__executorJournal_rootSettled(x.journal, x.period) && (cursorDone(x) || legacyWon(x))))
  ensures (!((x.phase.WrongTotal? || x.phase.Released?)) || (((x.v2 && settlement__executorJournal_admittedV2(x.journal, x.period, x.root)) && !(settlement__money_equalAmounts(x.heldTotal, x.total))) && (x.heldTotal == v2Total(x.journal, x.period, x.root))))
  ensures (!(x.phase.Released?) || ((x.height > 0) && (|x.journal.leaves| == 0)))
  ensures (!(x.phase.ClosedUnadmitted?) || (((!(x.solana) && !(settlement__executorJournal_admitted(x.journal, x.period))) && !(settlement__executorJournal_hasLiveRoot(x.journal, x.period))) && (x.journal.time >= settlement__monthlyCommitment_windowClosesAt(x.period))))
  ensures settlement__executorJournal_wellFormed(x.journal) && monthOnly(x.journal, x.period) && admissionFits(x, x.journal)
{
}

lemma NoReorderRevert(e: Execution, row: Row)
  requires !(revertsIfSent(e, row))
  ensures !(reorderReverts(e, row))
{
  forall o | o in e.rows && sameVault(o, row) && recordsAwards(o) ensures inFlight(o) {
    if !o.phase.Submitted? {
      var x :| x in o.journal.entries && x.phase.Live? && !x.key.kind.V2Root?;
      assert liveAny(o.journal);
    }
  }
}
