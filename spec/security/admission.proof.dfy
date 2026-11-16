lemma recordReceipt_ensures(s: Scan, response: Receipt)
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysAssignmentValid(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysQueuedHoldsNoRun(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysRefusalIsIncompleteWithoutReview(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysSupersededUnconsumed(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysReviewsAfterChecks(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysReviewingUndecided(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysCoverageBounds(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysDeclinedIsIncomplete(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysSpecialistOnlyAfterEscalation(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysMaliceConfirmed(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysCleanComplete(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysReuseCitesOrigin(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysPublishingDecided(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysDigestOnlyAfterIntent(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysRecordedOnlyWhenRecorded(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysRecordedMatchesDisposition(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysCleanVisibleOnlyAfterAccepted(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysAtMostOneSend(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> alwaysInvestigationIdentified(recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepAssignmentFixed(s, recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepServiceFailureDecidesNothing(s, "recordReceipt", recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepIncompleteNeverClean(s, recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepAttemptsCount(s, recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepRecordedImmutable(s, recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepRejectedRetained(s, recordReceipt(s, response)))
  ensures (inv(s) ==> canRecordReceipt(s, response) ==> stepUnknownNeverResends(s, "recordReceipt", recordReceipt(s, response)))
{
  if inv(s) && canRecordReceipt(s, response) {
    var after := recordReceipt(s, response);
    if response.kind.ReceiptAccepted? && response.digest == s.digest {
      assert after == s.(phase := Phase.Recorded, recorded := s.disposition, acceptedDigest := response.digest);
    } else if response.kind.ReceiptRejected? {
      assert after == s.(phase := Phase.PublicationRejected);
    } else {
      assert after == s.(phase := Phase.PublicationUnknown);
    }
  }
}
