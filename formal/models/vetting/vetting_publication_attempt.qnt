// @source workers/vetting/publication.ts
// @evidence workers/vetting/publication.test.ts
// @evidence scripts/vetting-api.test.ts
// One publishResult invocation and one blocked retry; lifecycle persistence is
// additionally covered by vetting_publication and journal-specific models.
// Versions 1/2 represent distinct caller-owned values. The captured envelope
// includes transport/journal identity for coherence; the signature itself
// binds only method, path/query, timestamp and body digest. Seven finite receipt
// fields represent the exact comparisons in publishResult. Status classes and
// body read/cancellation failures are bounded; cryptography, parser correctness,
// trusted endpoint truth and atomic durable journal storage are assumptions.
// In particular, the reviewed intake returns the designated rejection statuses
// only before commit; that server contract is not enforced by this client.
// A failed reservation or completion may already have persisted remotely.
// No response, exception or signature alone proves server commit, and unknown
// outcomes never grant a second send. All scenarios are currently unexecuted.
module vetting_publication_attempt {
  type Envelope = { body: int, digest: int, origin: int, key: int,
    at: int, transport: int, journal: int, completeCallback: int }
  val original: Envelope = { body: 1, digest: 1, origin: 1, key: 1,
    at: 1, transport: 1, journal: 1, completeCallback: 1 }
  val changed: Envelope = { body: 2, digest: 2, origin: 2, key: 2,
    at: 2, transport: 2, journal: 2, completeCallback: 2 }
  val requiredFields = Set(1, 2, 3, 4, 5, 6, 7)
  val rejectionStatuses = Set(400, 401, 403, 404, 413, 422)
  val responseStatuses = rejectionStatuses.union(Set(200, 201, 204, 301, 408, 409, 429, 500, 503))
  var s: { phase: str, caller: Envelope, captured: Envelope,
    callbackArgument: Envelope, intent: Envelope, sent: Envelope,
    signedBody: int, approved: bool, reserved: bool, journalHeld: bool,
    sends: int, serverCommitted: bool, status: int, fields: Set[int],
    outcome: str, completion: Envelope, receiptStored: bool,
    returned: bool, blockedRetries: int }

  action init = s' = { phase: "idle", caller: original, captured: original,
    callbackArgument: original, intent: original, sent: original,
    signedBody: 0, approved: false, reserved: false, journalHeld: false,
    sends: 0, serverCommitted: false, status: 0, fields: Set(),
    outcome: "none", completion: original, receiptStored: false,
    returned: false, blockedRetries: 0 }
  // Exact origin, parser/canonical bytes, approved digest and policy problems
  // are synchronous preconditions before any signature or reservation.
  action begin(valid: bool): bool = all { s.phase == "idle",
    s' = s.with("captured", s.caller).with("approved", valid)
      .with("phase", if (valid) "signing" else "thrown") }
  action mutateCaller = all { s.phase != "idle", s' = s.with("caller", changed) }
  action sign = all { s.phase == "signing",
    s' = s.with("signedBody", s.captured.body).with("intent", s.captured)
      .with("callbackArgument", s.captured).with("phase", "reserving") }
  action signFailure = all { s.phase == "signing", s' = s.with("phase", "thrown") }
  action priorReservation = all { s.phase == "idle", s' = s.with("journalHeld", true) }
  action mutateCallbackArgument = all {
    Set("reserving", "completing").contains(s.phase),
    s' = s.with("callbackArgument", changed) }
  action reserveSuccess = all { s.phase == "reserving", not(s.journalHeld),
    s' = s.with("reserved", true).with("journalHeld", true)
      .with("outcome", "unknown").with("phase", "reserved") }
  action reserveFailure(persisted: bool): bool = all { s.phase == "reserving",
    s' = s.with("journalHeld", s.journalHeld or persisted).with("phase", "thrown") }
  action sendResult = all { s.phase == "reserved", s.sends == 0,
    s' = s.with("sent", s.captured).with("sends", 1).with("phase", "posting") }
  action serverCommit = all { s.phase == "posting",
    s' = s.with("serverCommitted", true) }
  action responseLost = all { s.phase == "posting",
    s' = s.with("phase", "completing").with("completion", s.intent)
      .with("callbackArgument", s.intent) }
  action receiveStatus(status: int): bool = all { s.phase == "posting", responseStatuses.contains(status),
    not(rejectionStatuses.contains(status)) or not(s.serverCommitted),
    s' = s.with("status", status)
      .with("outcome", if (rejectionStatuses.contains(status)) "rejected" else "unknown")
      .with("phase", if (status == 200) "reading" else "cancelling") }
  // Cancellation failure cannot erase the already-classified rejection.
  action finishCancellation = all { s.phase == "cancelling",
    s' = s.with("phase", "completing").with("completion", s.intent)
      .with("callbackArgument", s.intent) }
  action readReceipt(fields: Set[int]): bool = all { s.phase == "reading",
    s' = s.with("fields", fields)
      .with("outcome", if (fields == requiredFields) "accepted" else "unknown")
      .with("phase", "completing").with("completion", s.intent)
      .with("callbackArgument", s.intent) }
  action readFailure = all { s.phase == "reading",
    s' = s.with("phase", "completing").with("completion", s.intent)
      .with("callbackArgument", s.intent) }
  action completeSuccess = all { s.phase == "completing",
    s' = s.with("receiptStored", true).with("returned", true).with("phase", "returned") }
  action completeFailure(persisted: bool): bool = all { s.phase == "completing",
    s' = s.with("receiptStored", persisted).with("phase", "thrown") }
  // Macro for a later invocation reaching the same atomic reservation gate.
  action retryRefused = all { Set("returned", "thrown").contains(s.phase),
    s.journalHeld, s.blockedRetries == 0, s' = s.with("blockedRetries", 1) }
  action step = {
    nondet status = responseStatuses.oneOf()
    nondet missing = requiredFields.oneOf()
    any { begin(true), begin(false), mutateCaller, sign, signFailure,
      priorReservation, mutateCallbackArgument, reserveSuccess,
      reserveFailure(false), reserveFailure(true), sendResult, serverCommit,
      responseLost, receiveStatus(status), finishCancellation,
      readReceipt(requiredFields), readReceipt(requiredFields.exclude(Set(missing))),
      readReceipt(Set()), readFailure, completeSuccess,
      completeFailure(false), completeFailure(true), retryRefused, s' = s }
  }
  val invariant = all {
    s.sends >= 0 and s.sends <= 1,
    s.sends == 1 implies s.approved and s.reserved and s.journalHeld
      and s.sent == s.captured and s.intent == s.captured and s.signedBody == s.sent.body,
    s.outcome == "accepted" implies s.status == 200 and s.fields == requiredFields,
    s.outcome == "rejected" implies rejectionStatuses.contains(s.status) and not(s.serverCommitted),
    s.returned implies s.receiptStored and s.phase == "returned" and s.reserved,
    s.receiptStored implies s.completion == s.captured and s.sends == 1,
    not(s.approved) implies s.sends == 0 and not(s.reserved)
  }
  run invalidApprovalStopsBeforeSigningTest = init.then(begin(false))
    .expect(s.phase == "thrown" and s.signedBody == 0 and s.sends == 0)
  run signingFailureDoesNotReserveTest = init.then(begin(true)).then(signFailure)
    .expect(not(s.reserved) and not(s.journalHeld) and s.sends == 0)
  run callerMutationDuringSigningKeepsApprovalTest = init.then(begin(true)).then(mutateCaller)
    .then(sign).then(reserveSuccess).then(sendResult)
    .expect(s.sent == original and s.intent == original and s.caller == changed)
  run callerMutationDuringReservationKeepsApprovalTest = init.then(begin(true)).then(sign)
    .then(mutateCaller).then(reserveSuccess).then(sendResult).expect(s.sent == original)
  run callbackMutationDoesNotRewriteIntentTest = init.then(begin(true)).then(sign)
    .then(mutateCallbackArgument).then(reserveSuccess).then(sendResult)
    .expect(s.intent == original and s.callbackArgument == changed and invariant)
  run uncertainReservationNeverPostsTest = init.then(begin(true)).then(sign)
    .then(reserveFailure(true)).then(retryRefused)
    .expect(s.journalHeld and s.sends == 0 and not(s.returned))
  run knownReservationFailureNeverPostsTest = init.then(begin(true)).then(sign)
    .then(reserveFailure(false)).expect(s.sends == 0 and not(s.journalHeld))
  run priorReservationStopsAnotherAttemptTest = init.then(priorReservation).then(begin(true))
    .then(sign).then(reserveFailure(false)).expect(s.journalHeld and s.sends == 0)
  run exactReceiptRecordsAcceptanceTest = init.then(begin(true)).then(sign).then(reserveSuccess)
    .then(sendResult).then(receiveStatus(200)).then(readReceipt(requiredFields)).then(completeSuccess)
    .expect(s.outcome == "accepted" and s.returned and s.completion == original)
  run changedApprovalWhileReadingCannotChangeReceiptBindingTest = init.then(begin(true)).then(sign)
    .then(reserveSuccess).then(sendResult).then(receiveStatus(200)).then(mutateCaller)
    .then(readReceipt(requiredFields)).then(completeSuccess).expect(s.outcome == "accepted" and invariant)
  run missingReceiptFieldStaysUnknownTest = init.then(begin(true)).then(sign).then(reserveSuccess)
    .then(sendResult).then(receiveStatus(200)).then(readReceipt(requiredFields.exclude(Set(7))))
    .then(completeSuccess).expect(s.outcome == "unknown" and s.status == 200)
  run malformedOrOversizedBodyStaysUnknownTest = init.then(begin(true)).then(sign).then(reserveSuccess)
    .then(sendResult).then(receiveStatus(200)).then(readFailure).then(completeSuccess)
    .expect(s.outcome == "unknown" and s.returned)
  run prewriteRejectionStaysRejectedIfCancellationFailsTest = init.then(begin(true)).then(sign)
    .then(reserveSuccess).then(sendResult).then(receiveStatus(422)).then(finishCancellation)
    .then(completeSuccess).expect(s.outcome == "rejected" and s.status == 422)
  run conflictCannotProveRejectionTest = init.then(begin(true)).then(sign).then(reserveSuccess)
    .then(sendResult).then(receiveStatus(409)).then(finishCancellation).then(completeSuccess)
    .expect(s.outcome == "unknown" and s.status == 409)
  run lostCommittedResponseStaysUnknownTest = init.then(begin(true)).then(sign).then(reserveSuccess)
    .then(sendResult).then(serverCommit).then(responseLost).then(completeSuccess).then(retryRefused)
    .expect(s.serverCommitted and s.outcome == "unknown" and s.sends == 1 and s.status == 0)
  run failedCompletionDoesNotReturnKnownOutcomeTest = init.then(begin(true)).then(sign)
    .then(reserveSuccess).then(sendResult).then(receiveStatus(200)).then(readReceipt(requiredFields))
    .then(completeFailure(false)).then(retryRefused)
    .expect(s.outcome == "accepted" and not(s.returned) and not(s.receiptStored) and s.sends == 1)
  run lostCompletionResponseStillBlocksRetryTest = init.then(begin(true)).then(sign)
    .then(reserveSuccess).then(sendResult).then(responseLost).then(completeFailure(true)).then(retryRefused)
    .expect(s.receiptStored and not(s.returned) and s.sends == 1)
  run completionCallbackCannotRewriteReturnedEnvelopeTest = init.then(begin(true)).then(sign)
    .then(reserveSuccess).then(sendResult).then(receiveStatus(200)).then(readReceipt(requiredFields))
    .then(mutateCallbackArgument).then(completeSuccess)
    .expect(s.completion == original and s.callbackArgument == changed and s.returned)
}
