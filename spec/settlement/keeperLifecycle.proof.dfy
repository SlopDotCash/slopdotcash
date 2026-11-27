lemma AttemptsBoundedFilter(k: Lifecycle)
  ensures alwaysAttemptsBounded(k) == ((!((exists a :: a in k.journal.attempts && !((((((a.bytes > 0) && (a.priorityFee >= 0)) && (a.priorityFee <= a.maxFee)) && (a.maxFee <= (originalAttempt(k).maxFee * 3))) && (|ProofLib.Filter((o: SendAttempt) => (o.bytes == a.bytes), k.journal.attempts)| == 1))))) && (!((k.journal.signedBytes > 0)) || (originalAttempt(k).bytes == k.journal.signedBytes))) && (!((k.liveRun.stagedBytes > 0)) || (((k.liveRun.staged.bytes == k.liveRun.stagedBytes) && (k.liveRun.staged.priorityFee >= 0)) && (k.liveRun.staged.priorityFee <= k.liveRun.staged.maxFee))))
{
}

lemma commitAttempt_ensures(k: Lifecycle, runId: int, storageCommitted: bool)
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> alwaysOneFinalizedOutcome(commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> alwaysHoldOnlyWhileUncertain(commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> alwaysAttemptsBounded(commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> alwaysCommitIsAtomic(commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> alwaysSeparateGasTerminal(commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> stepAttemptsRetained(k, commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> stepHoldSurvivesMidnight(k, "commitAttempt", commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> stepRetainCommittedBytes(k, commitAttempt(k, runId, storageCommitted)))
  ensures (inv(k) ==> canCommitAttempt(k, runId) ==> stepRestartRetainsDurableState(k, "commitAttempt", commitAttempt(k, runId, storageCommitted)))
{
  if inv(k) && canCommitAttempt(k, runId) && storageCommitted {
    var after := commitAttempt(k, runId, storageCommitted);
    AttemptsBoundedFilter(k);
    AttemptsBoundedFilter(after);
    var staged := k.liveRun.staged;
    assert after.journal.attempts == [staged];
    assert originalAttempt(after) == staged;
    ProofLib.FilterOne((o: SendAttempt) => (o.bytes == staged.bytes), after.journal.attempts, 0);
  }
}

lemma replace_ensures(k: Lifecycle, runId: int, bytes: int, now: int, baseFee: int, extraFee: int)
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> alwaysOneFinalizedOutcome(replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> alwaysHoldOnlyWhileUncertain(replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> alwaysAttemptsBounded(replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> alwaysCommitIsAtomic(replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> alwaysSeparateGasTerminal(replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> stepAttemptsRetained(k, replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> stepHoldSurvivesMidnight(k, "replace", replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> stepRetainCommittedBytes(k, replace(k, runId, bytes, now, baseFee, extraFee)))
  ensures (inv(k) ==> canReplace(k, runId, bytes, now, baseFee, extraFee) ==> stepRestartRetainsDurableState(k, "replace", replace(k, runId, bytes, now, baseFee, extraFee)))
{
  if inv(k) && canReplace(k, runId, bytes, now, baseFee, extraFee) {
    var after := replace(k, runId, bytes, now, baseFee, extraFee);
    var proposed := replacementFees(k);
    var added := SendAttempt(bytes, proposed.maxFee, proposed.priorityFee, now, extraFee);
    AttemptsBoundedFilter(k);
    AttemptsBoundedFilter(after);
    assert |k.journal.attempts| > 0;
    assert originalAttempt(k) == k.journal.attempts[0];
    assert originalAttempt(after) == originalAttempt(k);
    assert latestAttempt(k) == k.journal.attempts[|k.journal.attempts| - 1];
    assert latestAttempt(k) in k.journal.attempts;
    assert latestAttempt(k).priorityFee >= 0;
    assert proposed.priorityFee >= 0;
    assert proposed.priorityFee <= proposed.maxFee;
    assert proposed.maxFee <= originalAttempt(k).maxFee * 3;
    forall a | a in after.journal.attempts
      ensures |ProofLib.Filter((o: SendAttempt) => (o.bytes == a.bytes), after.journal.attempts)| == 1
    {
      var pred := (o: SendAttempt) => (o.bytes == a.bytes);
      ProofLib.FilterAppend(pred, k.journal.attempts, added);
      if a == added {
        ProofLib.FilterNone(pred, k.journal.attempts);
      } else {
        assert a in k.journal.attempts;
        assert a.bytes != added.bytes;
      }
    }
  }
}
