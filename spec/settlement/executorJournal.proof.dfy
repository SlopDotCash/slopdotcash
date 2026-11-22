lemma sendNew_ensures(j: Journal, journalKey: JournalKey, root: string, total: seq<int>, count: int, delivered: bool)
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysOneLiveAttemptPerKey(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysNoncesIssued(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysAttemptsSignedAsSteps(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysFinalizedWasBroadcast(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysOneRootPerPeriod(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysRetiredReverted(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysOutcomeFinalized(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysWinnerSucceeded(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysLeavesUnderAdmittedRoot(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysCursorBacked(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> alwaysSettledCommitted(sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepRetiredRetained(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepSettledPermanent(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepCommittedPermanent(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepFinalizedMonotone(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepAttemptsRetained(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepNoNewBytesWhileLive(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepLegacyReconciledFirst(j, sendNew(j, journalKey, root, total, count, delivered)))
  ensures (inv(j) ==> canSendNew(j, journalKey, root, total, count, delivered) ==> stepCursorMonotone(j, sendNew(j, journalKey, root, total, count, delivered)))
{
  if inv(j) && canSendNew(j, journalKey, root, total, count, delivered) {
    var after := sendNew(j, journalKey, root, total, count, delivered);
    var x := JournalEntry(journalKey, (|j.entries| + 1), j.nextNonce, EntryPhase.Live, Outcome.Unknown, delivered, !(delivered), 0, root, total, count);
    assert after.entries == j.entries + [x];
    LiveIdx(j);
    NonceIdx(j);
    forall i | 0 <= i < |j.entries| && j.entries[i].phase.Live? ensures j.entries[i].key != journalKey {
      assert j.entries[i] in j.entries;
    }
    LiveOk(after);
    NonceOk(after);
    CursorsStable(j, after);
  }
}

lemma rebroadcast_ensures(j: Journal, journalKey: JournalKey, delivered: bool)
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysOneLiveAttemptPerKey(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysNoncesIssued(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysAttemptsSignedAsSteps(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysFinalizedWasBroadcast(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysOneRootPerPeriod(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysRetiredReverted(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysOutcomeFinalized(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysWinnerSucceeded(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysLeavesUnderAdmittedRoot(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysCursorBacked(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> alwaysSettledCommitted(rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepRetiredRetained(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepSettledPermanent(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepCommittedPermanent(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepFinalizedMonotone(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepAttemptsRetained(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepNoNewBytesWhileLive(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepLegacyReconciledFirst(j, rebroadcast(j, journalKey, delivered)))
  ensures (inv(j) ==> canRebroadcast(j, journalKey, delivered) ==> stepCursorMonotone(j, rebroadcast(j, journalKey, delivered)))
{
  if inv(j) && canRebroadcast(j, journalKey, delivered) {
    var after := rebroadcast(j, journalKey, delivered);
    EntriesFrame(j, after);
    CursorsStable(j, after);
  }
}

lemma settleStep_ensures(j: Journal, journalKey: JournalKey)
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysOneLiveAttemptPerKey(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysNoncesIssued(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysAttemptsSignedAsSteps(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysFinalizedWasBroadcast(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysOneRootPerPeriod(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysRetiredReverted(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysOutcomeFinalized(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysWinnerSucceeded(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysLeavesUnderAdmittedRoot(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysCursorBacked(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> alwaysSettledCommitted(settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepRetiredRetained(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepSettledPermanent(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepCommittedPermanent(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepFinalizedMonotone(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepAttemptsRetained(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepNoNewBytesWhileLive(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepLegacyReconciledFirst(j, settleStep(j, journalKey)))
  ensures (inv(j) ==> canSettleStep(j, journalKey) ==> stepCursorMonotone(j, settleStep(j, journalKey)))
{
  if inv(j) && canSettleStep(j, journalKey) {
    var after := settleStep(j, journalKey);
    EntriesFrame(j, after);
    CursorsStable(j, after);
    LiveIdx(j);
    var e :| e in j.entries && (((e.key == journalKey) && e.phase.Live?) && (e.nonce < j.finalizedNonce));
    var ie :| 0 <= ie < |j.entries| && j.entries[ie] == e;
    forall i | 0 <= i < |j.entries| && j.entries[i].key == journalKey && j.entries[i].phase.Live? ensures i == ie { }
    assert alwaysSettledCommitted(after) by {
      forall y | y in after.entries && y.phase.Settled? ensures (committed(after, y.key) && (y.nonce < after.finalizedNonce)) {
        var i :| 0 <= i < |after.entries| && after.entries[i] == y;
        assert j.entries[i] in j.entries;
      }
    }
  }
}

lemma retire_ensures(j: Journal, journalKey: JournalKey)
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysOneLiveAttemptPerKey(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysNoncesIssued(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysAttemptsSignedAsSteps(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysFinalizedWasBroadcast(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysOneRootPerPeriod(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysRetiredReverted(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysOutcomeFinalized(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysWinnerSucceeded(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysLeavesUnderAdmittedRoot(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysCursorBacked(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> alwaysSettledCommitted(retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepRetiredRetained(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepSettledPermanent(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepCommittedPermanent(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepFinalizedMonotone(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepAttemptsRetained(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepNoNewBytesWhileLive(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepLegacyReconciledFirst(j, retire(j, journalKey)))
  ensures (inv(j) ==> canRetire(j, journalKey) ==> stepCursorMonotone(j, retire(j, journalKey)))
{
  if inv(j) && canRetire(j, journalKey) {
    var after := retire(j, journalKey);
    EntriesFrame(j, after);
    CursorsStable(j, after);
    LiveIdx(j);
    var e :| e in j.entries && ((((e.key == journalKey) && e.phase.Live?) && e.verdict.Reverted?) && (e.nonce < j.finalizedNonce));
    var ie :| 0 <= ie < |j.entries| && j.entries[ie] == e;
    forall i | 0 <= i < |j.entries| && j.entries[i].key == journalKey && j.entries[i].phase.Live? ensures i == ie { }
    assert alwaysRetiredReverted(after) by {
      forall y | y in after.entries && y.phase.Retired? ensures (y.verdict.Reverted? && (y.nonce < after.finalizedNonce)) {
        var i :| 0 <= i < |after.entries| && after.entries[i] == y;
        assert j.entries[i] in j.entries;
      }
    }
  }
}

lemma observeFinalized_ensures(j: Journal, nonce: int, height: int, time: int)
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysOneLiveAttemptPerKey(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysNoncesIssued(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysAttemptsSignedAsSteps(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysFinalizedWasBroadcast(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysOneRootPerPeriod(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysRetiredReverted(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysOutcomeFinalized(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysWinnerSucceeded(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysLeavesUnderAdmittedRoot(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysCursorBacked(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> alwaysSettledCommitted(observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepRetiredRetained(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepSettledPermanent(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepCommittedPermanent(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepFinalizedMonotone(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepAttemptsRetained(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepNoNewBytesWhileLive(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepLegacyReconciledFirst(j, observeFinalized(j, nonce, height, time)))
  ensures (inv(j) ==> canObserveFinalized(j, nonce, height, time) ==> stepCursorMonotone(j, observeFinalized(j, nonce, height, time)))
{
  if inv(j) && canObserveFinalized(j, nonce, height, time) {
    var after := observeFinalized(j, nonce, height, time);
    CursorsStable(j, after);
  }
}

lemma observeOtherCommit_ensures(j: Journal, journalKey: JournalKey, root: string, total: seq<int>, count: int)
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysOneLiveAttemptPerKey(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysNoncesIssued(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysAttemptsSignedAsSteps(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysFinalizedWasBroadcast(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysOneRootPerPeriod(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysRetiredReverted(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysOutcomeFinalized(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysWinnerSucceeded(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysLeavesUnderAdmittedRoot(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysCursorBacked(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> alwaysSettledCommitted(observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepRetiredRetained(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepSettledPermanent(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepCommittedPermanent(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepFinalizedMonotone(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepAttemptsRetained(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepNoNewBytesWhileLive(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepLegacyReconciledFirst(j, observeOtherCommit(j, journalKey, root, total, count)))
  ensures (inv(j) ==> canObserveOtherCommit(j, journalKey, root, total, count) ==> stepCursorMonotone(j, observeOtherCommit(j, journalKey, root, total, count)))
{
  if inv(j) && canObserveOtherCommit(j, journalKey, root, total, count) {
    var after := observeOtherCommit(j, journalKey, root, total, count);
    CursorsStable(j, after);
    if journalKey.kind.Leaf? {
      assert after.leaves == j.leaves + [journalKey];
      LeavesAfterLeaf(j, after, journalKey);
      CursorsAfterLeaf(j, after, journalKey);
    } else {
      var x := admissionOf(journalKey.period, journalKey.kind, root, total, count, 0);
      assert after.admissions == j.admissions + [x];
      AdmAppendOk(j, after, x);
      LeavesAfterAdmission(j, after, x);
      CursorsAfterAdmission(j, after, x);
    }
  }
}

lemma observeReceipt_ensures(j: Journal, nonce: int, succeeded: bool)
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysOneLiveAttemptPerKey(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysNoncesIssued(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysAttemptsSignedAsSteps(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysFinalizedWasBroadcast(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysOneRootPerPeriod(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysRetiredReverted(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysOutcomeFinalized(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysWinnerSucceeded(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysLeavesUnderAdmittedRoot(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysCursorBacked(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> alwaysSettledCommitted(observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepRetiredRetained(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepSettledPermanent(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepCommittedPermanent(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepFinalizedMonotone(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepAttemptsRetained(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepNoNewBytesWhileLive(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepLegacyReconciledFirst(j, observeReceipt(j, nonce, succeeded)))
  ensures (inv(j) ==> canObserveReceipt(j, nonce, succeeded) ==> stepCursorMonotone(j, observeReceipt(j, nonce, succeeded)))
{
  if inv(j) && canObserveReceipt(j, nonce, succeeded) {
    var after := observeReceipt(j, nonce, succeeded);
    var e :| e in j.entries && (((((e.nonce == nonce) && e.phase.Live?) && e.verdict.Unknown?) && (e.nonce < j.finalizedNonce)) && (!(succeeded) || (!(committed(j, e.key)) && fitsStep(j, e.key))));
    var ie :| 0 <= ie < |j.entries| && j.entries[ie] == e;
    NonceIdx(j);
    forall i | 0 <= i < |j.entries| && i != ie ensures j.entries[i].nonce != nonce { }
    EntryAtIs(j, nonce, ie);
    assert entryAt(j, nonce) == e;
    forall i | 0 <= i < |j.entries| && i != ie ensures after.entries[i] == j.entries[i] { }
    assert after.entries[ie] == e.(verdict := (if succeeded then Outcome.Succeeded else Outcome.Reverted));
    EntriesFrame(j, after);
    CursorsStable(j, after);
    assert alwaysRetiredReverted(after) by {
      forall y | y in after.entries && y.phase.Retired? ensures (y.verdict.Reverted? && (y.nonce < after.finalizedNonce)) {
        var i :| 0 <= i < |after.entries| && after.entries[i] == y;
        assert j.entries[i] in j.entries;
      }
    }
    assert alwaysWinnerSucceeded(after) by {
      forall a | a in after.admissions ensures ((a.winner == 0) || (exists y :: y in after.entries && (((y.bytes == a.winner) && y.verdict.Succeeded?) && (y.key.kind == a.kind)))) {
        if a in j.admissions {
          if a.winner != 0 {
            var y :| y in j.entries && (((y.bytes == a.winner) && y.verdict.Succeeded?) && (y.key.kind == a.kind));
            var iy :| 0 <= iy < |j.entries| && j.entries[iy] == y;
            assert after.entries[iy] in after.entries;
          }
        } else {
          assert a == admissionFrom(e);
          assert after.entries[ie] in after.entries;
        }
      }
    }
    if succeeded && !e.key.kind.Leaf? {
      var x := admissionFrom(e);
      assert after.admissions == j.admissions + [x];
      assert after.leaves == j.leaves;
      assert e.root != "" && e.count > 0;
      AdmAppendOk(j, after, x);
      LeavesAfterAdmission(j, after, x);
      CursorsAfterAdmission(j, after, x);
    } else if succeeded {
      assert after.leaves == j.leaves + [e.key];
      assert after.admissions == j.admissions;
      assert validKey(e.key);
      LeavesAfterLeaf(j, after, e.key);
      CursorsAfterLeaf(j, after, e.key);
    } else {
      assert after.leaves == j.leaves && after.admissions == j.admissions;
    }
  }
}

lemma advanceCursor_ensures(j: Journal, period: int, root: string)
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysOneLiveAttemptPerKey(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysNoncesIssued(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysAttemptsSignedAsSteps(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysFinalizedWasBroadcast(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysOneRootPerPeriod(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysRetiredReverted(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysOutcomeFinalized(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysWinnerSucceeded(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysLeavesUnderAdmittedRoot(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysCursorBacked(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> alwaysSettledCommitted(advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepRetiredRetained(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepSettledPermanent(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepCommittedPermanent(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepFinalizedMonotone(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepAttemptsRetained(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepNoNewBytesWhileLive(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepLegacyReconciledFirst(j, advanceCursor(j, period, root)))
  ensures (inv(j) ==> canAdvanceCursor(j, period, root) ==> stepCursorMonotone(j, advanceCursor(j, period, root)))
{
  if inv(j) && canAdvanceCursor(j, period, root) {
    var after := advanceCursor(j, period, root);
    CursorIdx(j);
    LeafIdx(j);
    var n := cursorOf(j, period, root);
    var t := keyOf(period, StepKind.Leaf, root, n);
    var it :| 0 <= it < |j.leaves| && j.leaves[it] == t;
    if (exists c :: c in j.cursors && ((c.period == period) && (c.root == root))) {
      var c0 :| c0 in j.cursors && ((c0.period == period) && (c0.root == root));
      var i0 :| 0 <= i0 < |j.cursors| && j.cursors[i0] == c0;
      CursorOfIs(j, period, root, i0);
      assert n == c0.next;
      var c1 := c0.(next := c0.next + 1);
      assert |after.cursors| == |j.cursors|;
      forall i | 0 <= i < |j.cursors| && i != i0 ensures after.cursors[i] == j.cursors[i] { }
      assert after.cursors[i0] == c1;
      CountSplit(j.leaves, c0, c1);
      ProofLib.FilterOne((o: JournalKey) => (o == keyOf(c0.period, StepKind.Leaf, c0.root, c0.next)), j.leaves, it);
      forall c | c in after.cursors
        ensures |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), after.leaves)| == c.next
      {
        var i :| 0 <= i < |after.cursors| && after.cursors[i] == c;
        assert j.cursors[i] in j.cursors;
      }
      CursorOk(after);
      forall c | c in j.cursors ensures cursorOf(after, c.period, c.root) >= c.next {
        var i :| 0 <= i < |j.cursors| && j.cursors[i] == c;
        CursorOfIs(after, c.period, c.root, i);
      }
    } else {
      CursorOfNone(j, period, root);
      assert n == 0;
      var c1 := Cursor(period, root, 1);
      assert after.cursors == j.cursors + [c1];
      var c0 := Cursor(period, root, 0);
      CountSplit(j.leaves, c0, c1);
      ProofLib.FilterNone((k: JournalKey) => (((k.period == c0.period) && (k.root == c0.root)) && (k.leaf < c0.next)), j.leaves);
      ProofLib.FilterOne((o: JournalKey) => (o == keyOf(c0.period, StepKind.Leaf, c0.root, c0.next)), j.leaves, it);
      forall i | 0 <= i < |j.cursors| ensures !(j.cursors[i].period == period && j.cursors[i].root == root) {
        assert j.cursors[i] in j.cursors;
      }
      forall c | c in after.cursors
        ensures |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), after.leaves)| == c.next
      {
        var i :| 0 <= i < |after.cursors| && after.cursors[i] == c;
        if i < |j.cursors| { assert j.cursors[i] in j.cursors; }
      }
      CursorOk(after);
      forall c | c in j.cursors ensures cursorOf(after, c.period, c.root) >= c.next {
        var i :| 0 <= i < |j.cursors| && j.cursors[i] == c;
        CursorOfIs(after, c.period, c.root, i);
      }
    }
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

lemma LeafCountIs(j: Journal, period: int, root: string, i: int)
  requires 0 <= i < |j.admissions| && j.admissions[i].period == period && j.admissions[i].kind.V2Root? && j.admissions[i].root == root
  requires forall k :: 0 <= k < |j.admissions| && k != i ==> j.admissions[k].period != period
  ensures leafCountOf(j, period, root) == j.admissions[i].count
{
  FoldUnique((n: int, a: Admission) => (if (((a.period == period) && a.kind.V2Root?) && (a.root == root)) then a.count else n), 0, j.admissions,
    (a: Admission) => (((a.period == period) && a.kind.V2Root?) && (a.root == root)), (a: Admission) => a.count, i);
}

lemma LeafCountAppendOther(j: Journal, after: Journal, x: Admission, period: int, root: string)
  requires after.admissions == j.admissions + [x]
  requires x.period != period
  ensures leafCountOf(after, period, root) == leafCountOf(j, period, root)
{
  ProofLib.FoldLeftAppend((n: int, a: Admission) => (if (((a.period == period) && a.kind.V2Root?) && (a.root == root)) then a.count else n), 0, j.admissions, x);
}

lemma CursorOfIs(j: Journal, period: int, root: string, i: int)
  requires 0 <= i < |j.cursors| && j.cursors[i].period == period && j.cursors[i].root == root
  requires forall k :: 0 <= k < |j.cursors| && k != i ==> !(j.cursors[k].period == period && j.cursors[k].root == root)
  ensures cursorOf(j, period, root) == j.cursors[i].next
{
  FoldUnique((n: int, c: Cursor) => (if ((c.period == period) && (c.root == root)) then c.next else n), 0, j.cursors,
    (c: Cursor) => ((c.period == period) && (c.root == root)), (c: Cursor) => c.next, i);
}

lemma CursorOfNone(j: Journal, period: int, root: string)
  requires forall k :: 0 <= k < |j.cursors| ==> !(j.cursors[k].period == period && j.cursors[k].root == root)
  ensures cursorOf(j, period, root) == 0
{
  FoldNone((n: int, c: Cursor) => (if ((c.period == period) && (c.root == root)) then c.next else n), 0, j.cursors,
    (c: Cursor) => ((c.period == period) && (c.root == root)));
}

lemma EntryAtIs(j: Journal, nonce: int, i: int)
  requires 0 <= i < |j.entries| && j.entries[i].nonce == nonce
  requires forall k :: 0 <= k < |j.entries| && k != i ==> j.entries[k].nonce != nonce
  ensures entryAt(j, nonce) == j.entries[i]
{
  FoldUnique((found: JournalEntry, e: JournalEntry) => (if (e.nonce == nonce) then e else found), noEntry, j.entries,
    (e: JournalEntry) => (e.nonce == nonce), (e: JournalEntry) => e, i);
}

// ---- One live attempt per key ----

lemma LiveBridge(j: Journal)
  ensures alwaysOneLiveAttemptPerKey(j) == !((exists e :: e in j.entries && !(((!e.phase.Live?) || (|ProofLib.Filter((o: JournalEntry) => ((o.key == e.key) && o.phase.Live?), j.entries)| == 1)))))
{
}

lemma LiveIdx(j: Journal)
  requires alwaysOneLiveAttemptPerKey(j)
  ensures forall i, k :: 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k && j.entries[i].phase.Live? && j.entries[k].phase.Live? ==> j.entries[i].key != j.entries[k].key
{
  LiveBridge(j);
  forall i, k | 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k && j.entries[i].phase.Live? && j.entries[k].phase.Live?
    ensures j.entries[i].key != j.entries[k].key
  {
    var e := j.entries[i];
    assert e in j.entries;
    if j.entries[k].key == e.key {
      ProofLib.FilterTwo((o: JournalEntry) => ((o.key == e.key) && o.phase.Live?), j.entries, i, k);
    }
  }
}

lemma LiveOk(j: Journal)
  requires forall i, k :: 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k && j.entries[i].phase.Live? && j.entries[k].phase.Live? ==> j.entries[i].key != j.entries[k].key
  ensures alwaysOneLiveAttemptPerKey(j)
{
  LiveBridge(j);
  forall e | e in j.entries && e.phase.Live?
    ensures |ProofLib.Filter((o: JournalEntry) => ((o.key == e.key) && o.phase.Live?), j.entries)| == 1
  {
    var i :| 0 <= i < |j.entries| && j.entries[i] == e;
    ProofLib.FilterOne((o: JournalEntry) => ((o.key == e.key) && o.phase.Live?), j.entries, i);
  }
}

// ---- Nonces and bytes issued once ----

lemma NonceBridge(j: Journal)
  ensures alwaysNoncesIssued(j) == (((j.finalizedNonce >= 0) && (j.finalizedNonce <= j.nextNonce)) && !((exists e :: e in j.entries && !(((((((validKey(e.key) && (e.bytes > 0)) && (e.bytes <= |j.entries|)) && (e.nonce >= 0)) && (e.nonce < j.nextNonce)) && (|ProofLib.Filter((o: JournalEntry) => (o.nonce == e.nonce), j.entries)| == 1)) && (|ProofLib.Filter((o: JournalEntry) => (o.bytes == e.bytes), j.entries)| == 1))))))
{
}

lemma NonceIdx(j: Journal)
  requires alwaysNoncesIssued(j)
  ensures j.finalizedNonce >= 0 && j.finalizedNonce <= j.nextNonce
  ensures forall i :: 0 <= i < |j.entries| ==> validKey(j.entries[i].key) && j.entries[i].bytes > 0 && j.entries[i].bytes <= |j.entries| && j.entries[i].nonce >= 0 && j.entries[i].nonce < j.nextNonce
  ensures forall i, k :: 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k ==> j.entries[i].nonce != j.entries[k].nonce && j.entries[i].bytes != j.entries[k].bytes
{
  NonceBridge(j);
  forall i | 0 <= i < |j.entries|
    ensures validKey(j.entries[i].key) && j.entries[i].bytes > 0 && j.entries[i].bytes <= |j.entries| && j.entries[i].nonce >= 0 && j.entries[i].nonce < j.nextNonce
  {
    assert j.entries[i] in j.entries;
  }
  forall i, k | 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k
    ensures j.entries[i].nonce != j.entries[k].nonce && j.entries[i].bytes != j.entries[k].bytes
  {
    var e := j.entries[i];
    assert e in j.entries;
    if j.entries[k].nonce == e.nonce {
      ProofLib.FilterTwo((o: JournalEntry) => (o.nonce == e.nonce), j.entries, i, k);
    }
    if j.entries[k].bytes == e.bytes {
      ProofLib.FilterTwo((o: JournalEntry) => (o.bytes == e.bytes), j.entries, i, k);
    }
  }
}

lemma NonceOk(j: Journal)
  requires j.finalizedNonce >= 0 && j.finalizedNonce <= j.nextNonce
  requires forall i :: 0 <= i < |j.entries| ==> validKey(j.entries[i].key) && j.entries[i].bytes > 0 && j.entries[i].bytes <= |j.entries| && j.entries[i].nonce >= 0 && j.entries[i].nonce < j.nextNonce
  requires forall i, k :: 0 <= i < |j.entries| && 0 <= k < |j.entries| && i != k ==> j.entries[i].nonce != j.entries[k].nonce && j.entries[i].bytes != j.entries[k].bytes
  ensures alwaysNoncesIssued(j)
{
  NonceBridge(j);
  forall e | e in j.entries
    ensures (((((((validKey(e.key) && (e.bytes > 0)) && (e.bytes <= |j.entries|)) && (e.nonce >= 0)) && (e.nonce < j.nextNonce)) && (|ProofLib.Filter((o: JournalEntry) => (o.nonce == e.nonce), j.entries)| == 1)) && (|ProofLib.Filter((o: JournalEntry) => (o.bytes == e.bytes), j.entries)| == 1)))
  {
    var i :| 0 <= i < |j.entries| && j.entries[i] == e;
    ProofLib.FilterOne((o: JournalEntry) => (o.nonce == e.nonce), j.entries, i);
    ProofLib.FilterOne((o: JournalEntry) => (o.bytes == e.bytes), j.entries, i);
  }
}

// ---- One root per period ----

lemma AdmBridge(j: Journal)
  ensures alwaysOneRootPerPeriod(j) == !((exists a :: a in j.admissions && !(((((!a.kind.Leaf?) && (a.root != "")) && (a.count > 0)) && (|ProofLib.Filter((o: Admission) => (o.period == a.period), j.admissions)| == 1)))))
{
}

lemma AdmIdx(j: Journal)
  requires alwaysOneRootPerPeriod(j)
  ensures forall i :: 0 <= i < |j.admissions| ==> !j.admissions[i].kind.Leaf? && j.admissions[i].root != "" && j.admissions[i].count > 0
  ensures forall i, k :: 0 <= i < |j.admissions| && 0 <= k < |j.admissions| && i != k ==> j.admissions[i].period != j.admissions[k].period
{
  AdmBridge(j);
  forall i | 0 <= i < |j.admissions|
    ensures !j.admissions[i].kind.Leaf? && j.admissions[i].root != "" && j.admissions[i].count > 0
  {
    assert j.admissions[i] in j.admissions;
  }
  forall i, k | 0 <= i < |j.admissions| && 0 <= k < |j.admissions| && i != k
    ensures j.admissions[i].period != j.admissions[k].period
  {
    var a := j.admissions[i];
    assert a in j.admissions;
    if j.admissions[k].period == a.period {
      ProofLib.FilterTwo((o: Admission) => (o.period == a.period), j.admissions, i, k);
    }
  }
}

lemma AdmOk(j: Journal)
  requires forall i :: 0 <= i < |j.admissions| ==> !j.admissions[i].kind.Leaf? && j.admissions[i].root != "" && j.admissions[i].count > 0
  requires forall i, k :: 0 <= i < |j.admissions| && 0 <= k < |j.admissions| && i != k ==> j.admissions[i].period != j.admissions[k].period
  ensures alwaysOneRootPerPeriod(j)
{
  AdmBridge(j);
  forall a | a in j.admissions
    ensures ((((!a.kind.Leaf?) && (a.root != "")) && (a.count > 0)) && (|ProofLib.Filter((o: Admission) => (o.period == a.period), j.admissions)| == 1))
  {
    var i :| 0 <= i < |j.admissions| && j.admissions[i] == a;
    ProofLib.FilterOne((o: Admission) => (o.period == a.period), j.admissions, i);
  }
}

// An admitted (period, root) has the leaf count of its one admission.
lemma LeafCountOfAdmitted(j: Journal, period: int, root: string)
  requires alwaysOneRootPerPeriod(j) && admittedV2(j, period, root)
  ensures exists i :: 0 <= i < |j.admissions| && j.admissions[i].period == period && j.admissions[i].kind.V2Root? && j.admissions[i].root == root && leafCountOf(j, period, root) == j.admissions[i].count
{
  AdmIdx(j);
  var a :| a in j.admissions && (((a.period == period) && a.kind.V2Root?) && (a.root == root));
  var i :| 0 <= i < |j.admissions| && j.admissions[i] == a;
  LeafCountIs(j, period, root, i);
}

// Adding the first admission of a period keeps one root per period.
lemma AdmAppendOk(j: Journal, after: Journal, x: Admission)
  requires alwaysOneRootPerPeriod(j)
  requires after.admissions == j.admissions + [x]
  requires !x.kind.Leaf? && x.root != "" && x.count > 0
  requires !admitted(j, x.period)
  ensures alwaysOneRootPerPeriod(after)
{
  AdmIdx(j);
  forall i | 0 <= i < |j.admissions| ensures j.admissions[i].period != x.period {
    assert j.admissions[i] in j.admissions;
  }
  AdmOk(after);
}

// ---- Committed leaves ----

lemma LeafBridge(j: Journal)
  ensures alwaysLeavesUnderAdmittedRoot(j) == !((exists k :: k in j.leaves && !(((((k.kind.Leaf? && admittedV2(j, k.period, k.root)) && (k.leaf >= 0)) && (k.leaf < leafCountOf(j, k.period, k.root))) && (|ProofLib.Filter((o: JournalKey) => (o == k), j.leaves)| == 1)))))
{
}

lemma LeafIdx(j: Journal)
  requires alwaysLeavesUnderAdmittedRoot(j)
  ensures forall i :: 0 <= i < |j.leaves| ==> j.leaves[i].kind.Leaf? && admittedV2(j, j.leaves[i].period, j.leaves[i].root) && j.leaves[i].leaf >= 0 && j.leaves[i].leaf < leafCountOf(j, j.leaves[i].period, j.leaves[i].root)
  ensures forall i, k :: 0 <= i < |j.leaves| && 0 <= k < |j.leaves| && i != k ==> j.leaves[i] != j.leaves[k]
{
  LeafBridge(j);
  forall i | 0 <= i < |j.leaves|
    ensures j.leaves[i].kind.Leaf? && admittedV2(j, j.leaves[i].period, j.leaves[i].root) && j.leaves[i].leaf >= 0 && j.leaves[i].leaf < leafCountOf(j, j.leaves[i].period, j.leaves[i].root)
  {
    assert j.leaves[i] in j.leaves;
  }
  forall i, m | 0 <= i < |j.leaves| && 0 <= m < |j.leaves| && i != m
    ensures j.leaves[i] != j.leaves[m]
  {
    var k := j.leaves[i];
    assert k in j.leaves;
    if j.leaves[m] == k {
      ProofLib.FilterTwo((o: JournalKey) => (o == k), j.leaves, i, m);
    }
  }
}

lemma LeafOk(j: Journal)
  requires forall i :: 0 <= i < |j.leaves| ==> j.leaves[i].kind.Leaf? && admittedV2(j, j.leaves[i].period, j.leaves[i].root) && j.leaves[i].leaf >= 0 && j.leaves[i].leaf < leafCountOf(j, j.leaves[i].period, j.leaves[i].root)
  requires forall i, k :: 0 <= i < |j.leaves| && 0 <= k < |j.leaves| && i != k ==> j.leaves[i] != j.leaves[k]
  ensures alwaysLeavesUnderAdmittedRoot(j)
{
  LeafBridge(j);
  forall k | k in j.leaves
    ensures ((((k.kind.Leaf? && admittedV2(j, k.period, k.root)) && (k.leaf >= 0)) && (k.leaf < leafCountOf(j, k.period, k.root))) && (|ProofLib.Filter((o: JournalKey) => (o == k), j.leaves)| == 1))
  {
    var i :| 0 <= i < |j.leaves| && j.leaves[i] == k;
    ProofLib.FilterOne((o: JournalKey) => (o == k), j.leaves, i);
  }
}

// A new admission of an unadmitted period keeps every committed leaf under its root.
lemma LeavesAfterAdmission(j: Journal, after: Journal, x: Admission)
  requires alwaysLeavesUnderAdmittedRoot(j)
  requires after.leaves == j.leaves && after.admissions == j.admissions + [x]
  requires !admitted(j, x.period)
  ensures alwaysLeavesUnderAdmittedRoot(after)
{
  LeafIdx(j);
  forall i | 0 <= i < |j.leaves|
    ensures admittedV2(after, j.leaves[i].period, j.leaves[i].root) && leafCountOf(after, j.leaves[i].period, j.leaves[i].root) == leafCountOf(j, j.leaves[i].period, j.leaves[i].root)
  {
    var k := j.leaves[i];
    var a :| a in j.admissions && (((a.period == k.period) && a.kind.V2Root?) && (a.root == k.root));
    assert a in after.admissions;
    assert x.period != k.period;
    LeafCountAppendOther(j, after, x, k.period, k.root);
  }
  LeafOk(after);
}

// A newly committed leaf under its admitted root keeps the leaves well formed.
lemma LeavesAfterLeaf(j: Journal, after: Journal, y: JournalKey)
  requires alwaysLeavesUnderAdmittedRoot(j)
  requires after.leaves == j.leaves + [y] && after.admissions == j.admissions
  requires y.kind.Leaf? && admittedV2(j, y.period, y.root) && y.leaf >= 0 && y.leaf < leafCountOf(j, y.period, y.root)
  requires !(y in j.leaves)
  ensures alwaysLeavesUnderAdmittedRoot(after)
{
  LeafIdx(j);
  assert forall p, r :: leafCountOf(after, p, r) == leafCountOf(j, p, r);
  assert forall p, r :: admittedV2(after, p, r) == admittedV2(j, p, r);
  forall i | 0 <= i < |j.leaves| ensures j.leaves[i] != y {
    assert j.leaves[i] in j.leaves;
  }
  LeafOk(after);
}

// ---- Cursors ----

lemma CursorBridge(j: Journal)
  ensures alwaysCursorBacked(j) == !((exists c :: c in j.cursors && !(((((admittedV2(j, c.period, c.root) && (c.next > 0)) && (c.next <= leafCountOf(j, c.period, c.root))) && (|ProofLib.Filter((o: Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors)| == 1)) && (|ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), j.leaves)| == c.next)))))
{
}

lemma CursorIdx(j: Journal)
  requires alwaysCursorBacked(j)
  ensures forall i :: 0 <= i < |j.cursors| ==> admittedV2(j, j.cursors[i].period, j.cursors[i].root) && j.cursors[i].next > 0 && j.cursors[i].next <= leafCountOf(j, j.cursors[i].period, j.cursors[i].root)
  ensures forall i, k :: 0 <= i < |j.cursors| && 0 <= k < |j.cursors| && i != k ==> !(j.cursors[i].period == j.cursors[k].period && j.cursors[i].root == j.cursors[k].root)
  ensures forall c :: c in j.cursors ==> |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), j.leaves)| == c.next
{
  CursorBridge(j);
  forall i | 0 <= i < |j.cursors|
    ensures admittedV2(j, j.cursors[i].period, j.cursors[i].root) && j.cursors[i].next > 0 && j.cursors[i].next <= leafCountOf(j, j.cursors[i].period, j.cursors[i].root)
  {
    assert j.cursors[i] in j.cursors;
  }
  forall i, m | 0 <= i < |j.cursors| && 0 <= m < |j.cursors| && i != m
    ensures !(j.cursors[i].period == j.cursors[m].period && j.cursors[i].root == j.cursors[m].root)
  {
    var c := j.cursors[i];
    assert c in j.cursors;
    if j.cursors[m].period == c.period && j.cursors[m].root == c.root {
      ProofLib.FilterTwo((o: Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors, i, m);
    }
  }
}

lemma CursorOk(j: Journal)
  requires forall i :: 0 <= i < |j.cursors| ==> admittedV2(j, j.cursors[i].period, j.cursors[i].root) && j.cursors[i].next > 0 && j.cursors[i].next <= leafCountOf(j, j.cursors[i].period, j.cursors[i].root)
  requires forall i, k :: 0 <= i < |j.cursors| && 0 <= k < |j.cursors| && i != k ==> !(j.cursors[i].period == j.cursors[k].period && j.cursors[i].root == j.cursors[k].root)
  requires forall c :: c in j.cursors ==> |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), j.leaves)| == c.next
  ensures alwaysCursorBacked(j)
{
  CursorBridge(j);
  forall c | c in j.cursors
    ensures |ProofLib.Filter((o: Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors)| == 1
  {
    var i :| 0 <= i < |j.cursors| && j.cursors[i] == c;
    ProofLib.FilterOne((o: Cursor) => ((o.period == c.period) && (o.root == c.root)), j.cursors, i);
  }
}

// Unchanged cursors never move back.
lemma CursorsStable(j: Journal, after: Journal)
  requires alwaysCursorBacked(j)
  requires after.cursors == j.cursors
  ensures stepCursorMonotone(j, after)
{
  CursorIdx(j);
  forall c | c in j.cursors ensures cursorOf(after, c.period, c.root) >= c.next {
    var i :| 0 <= i < |j.cursors| && j.cursors[i] == c;
    CursorOfIs(after, c.period, c.root, i);
  }
}

// The leaves below cursor value c.next + 1 are those below c.next and the one at c.next.
lemma CountSplit(xs: seq<JournalKey>, c: Cursor, d: Cursor)
  requires d.period == c.period && d.root == c.root && d.next == c.next + 1
  requires forall i :: 0 <= i < |xs| ==> xs[i].kind.Leaf?
  ensures |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs)| + |ProofLib.Filter((o: JournalKey) => (o == keyOf(c.period, StepKind.Leaf, c.root, c.next)), xs)|
    == |ProofLib.Filter((k: JournalKey) => (((k.period == d.period) && (k.root == d.root)) && (k.leaf < d.next)), xs)|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs);
    ProofLib.FilterNil((o: JournalKey) => (o == keyOf(c.period, StepKind.Leaf, c.root, c.next)), xs);
    ProofLib.FilterNil((k: JournalKey) => (((k.period == d.period) && (k.root == d.root)) && (k.leaf < d.next)), xs);
  } else {
    ProofLib.FilterCons((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs);
    ProofLib.FilterCons((o: JournalKey) => (o == keyOf(c.period, StepKind.Leaf, c.root, c.next)), xs);
    ProofLib.FilterCons((k: JournalKey) => (((k.period == d.period) && (k.root == d.root)) && (k.leaf < d.next)), xs);
    CountSplit(xs[1..], c, d);
  }
}

// Committed leaves, distinct and at nonnegative positions, below cursor value c.next number at most c.next, and one fewer
// when the leaf at position m below c.next is not committed.
lemma CountBound(xs: seq<JournalKey>, c: Cursor, m: int)
  requires c.next >= 0
  requires forall i :: 0 <= i < |xs| ==> xs[i].kind.Leaf? && xs[i].leaf >= 0
  requires forall i, k :: 0 <= i < |xs| && 0 <= k < |xs| && i != k ==> xs[i] != xs[k]
  ensures |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs)|
    <= c.next - (if 0 <= m < c.next && !(keyOf(c.period, StepKind.Leaf, c.root, m) in xs) then 1 else 0)
  decreases c.next
{
  if c.next == 0 {
    ProofLib.FilterNone((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs);
  } else {
    var b := Cursor(c.period, c.root, c.next - 1);
    CountBound(xs, b, m);
    CountSplit(xs, b, c);
    var t := keyOf(c.period, StepKind.Leaf, c.root, c.next - 1);
    if t in xs {
      var i :| 0 <= i < |xs| && xs[i] == t;
      ProofLib.FilterOne((o: JournalKey) => (o == keyOf(b.period, StepKind.Leaf, b.root, b.next)), xs, i);
    } else {
      ProofLib.FilterNone((o: JournalKey) => (o == keyOf(b.period, StepKind.Leaf, b.root, b.next)), xs);
    }
  }
}

// A leaf committed after the cursor passed its position would make one more committed leaf than positions.
lemma NoLeafBelowCursor(xs: seq<JournalKey>, c: Cursor, y: JournalKey)
  requires forall i :: 0 <= i < |xs| ==> xs[i].kind.Leaf? && xs[i].leaf >= 0
  requires forall i, k :: 0 <= i < |xs| && 0 <= k < |xs| && i != k ==> xs[i] != xs[k]
  requires |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), xs)| == c.next
  requires y.kind.Leaf? && y.period == c.period && y.root == c.root && 0 <= y.leaf < c.next
  requires !(y in xs)
  ensures false
{
  assert y == keyOf(c.period, StepKind.Leaf, c.root, y.leaf);
  CountBound(xs, c, y.leaf);
}

// A newly committed leaf keeps every cursor backed.
lemma CursorsAfterLeaf(j: Journal, after: Journal, y: JournalKey)
  requires alwaysCursorBacked(j) && alwaysLeavesUnderAdmittedRoot(j)
  requires after.leaves == j.leaves + [y] && after.admissions == j.admissions && after.cursors == j.cursors
  requires y.kind.Leaf? && y.leaf >= 0 && !(y in j.leaves)
  ensures alwaysCursorBacked(after)
{
  CursorIdx(j);
  LeafIdx(j);
  forall c | c in after.cursors
    ensures |ProofLib.Filter((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), after.leaves)| == c.next
  {
    ProofLib.FilterAppend((k: JournalKey) => (((k.period == c.period) && (k.root == c.root)) && (k.leaf < c.next)), j.leaves, y);
    if y.period == c.period && y.root == c.root && y.leaf < c.next {
      NoLeafBelowCursor(j.leaves, c, y);
    }
  }
  assert forall p, r :: leafCountOf(after, p, r) == leafCountOf(j, p, r);
  assert forall p, r :: admittedV2(after, p, r) == admittedV2(j, p, r);
  CursorOk(after);
}

// A new admission of an unadmitted period keeps every cursor backed.
lemma CursorsAfterAdmission(j: Journal, after: Journal, x: Admission)
  requires alwaysCursorBacked(j)
  requires after.leaves == j.leaves && after.cursors == j.cursors && after.admissions == j.admissions + [x]
  requires !admitted(j, x.period)
  ensures alwaysCursorBacked(after)
{
  CursorIdx(j);
  forall i | 0 <= i < |j.cursors|
    ensures admittedV2(after, j.cursors[i].period, j.cursors[i].root) && leafCountOf(after, j.cursors[i].period, j.cursors[i].root) == leafCountOf(j, j.cursors[i].period, j.cursors[i].root)
  {
    var c := j.cursors[i];
    var a :| a in j.admissions && (((a.period == c.period) && a.kind.V2Root?) && (a.root == c.root));
    assert a in after.admissions;
    assert x.period != c.period;
    LeafCountAppendOther(j, after, x, c.period, c.root);
  }
  CursorOk(after);
}

// ---- Attempts whose identity is unchanged, position by position ----

lemma EntriesFrame(j: Journal, after: Journal)
  requires alwaysOneLiveAttemptPerKey(j) && alwaysNoncesIssued(j) && alwaysAttemptsSignedAsSteps(j)
  requires |after.entries| == |j.entries| && after.nextNonce == j.nextNonce && after.finalizedNonce == j.finalizedNonce
  requires forall i :: 0 <= i < |j.entries| ==> (after.entries[i].key == j.entries[i].key && after.entries[i].bytes == j.entries[i].bytes
    && after.entries[i].nonce == j.entries[i].nonce && after.entries[i].root == j.entries[i].root && after.entries[i].total == j.entries[i].total
    && after.entries[i].count == j.entries[i].count
    && (after.entries[i].phase.Live? ==> j.entries[i].phase.Live?)
    && (!j.entries[i].phase.Live? ==> after.entries[i] == j.entries[i])
    && (!j.entries[i].verdict.Unknown? ==> after.entries[i].verdict == j.entries[i].verdict))
  ensures alwaysOneLiveAttemptPerKey(after) && alwaysNoncesIssued(after) && alwaysAttemptsSignedAsSteps(after)
  ensures stepRetiredRetained(j, after) && stepSettledPermanent(j, after) && stepAttemptsRetained(j, after)
  ensures forall e :: e in j.entries && e.verdict.Succeeded? ==> exists x :: x in after.entries && x.bytes == e.bytes && x.verdict.Succeeded? && x.key == e.key
{
  LiveIdx(j);
  NonceIdx(j);
  LiveOk(after);
  NonceOk(after);
  forall e | e in after.entries
    ensures (if e.key.kind.Leaf? then (((e.root == e.key.root) && (e.count == 0)) && settlement__money_equalAmounts(e.total, settlement__money_zero)) else ((((e.root != "") && (e.count > 0)) && settlement__money_validAmount(e.total)) && settlement__money_positiveAmount(e.total)))
  {
    var i :| 0 <= i < |after.entries| && after.entries[i] == e;
    assert j.entries[i] in j.entries;
  }
  forall e | e in j.entries
    ensures (e.phase.Retired? ==> e in after.entries) && (e.phase.Settled? ==> e in after.entries) && entryKept(after, e)
    ensures e.verdict.Succeeded? ==> exists x :: x in after.entries && x.bytes == e.bytes && x.verdict.Succeeded? && x.key == e.key
  {
    var i :| 0 <= i < |j.entries| && j.entries[i] == e;
    assert after.entries[i] in after.entries;
  }
}
