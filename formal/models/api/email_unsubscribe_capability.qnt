// @source backend/notifications/email.ts
// @source backend/notifications/email-destinations.ts
// @source workers/notify/enrollment.ts
// @source migrations/0033_optional_notification_email.sql
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @evidence backend/notifications/email-enrollment.test.ts
// One account, two verified destination versions, two signing-key generations,
// three possible issued capabilities and two request slots. Revision is bounded
// at four writes; keys/tokens are opaque and collisions are excluded. Token 0
// is a well-formed but unissued capability. Public malformed-body admission is
// separate. This endpoint needs no session and confers no private-read authority.
// Issue persists only a token hash and its captured destination version. Key
// rotation or sender pause cannot erase it. Unsubscribe first looks up that
// immutable row, then atomically matches BOTH current destination and preference
// versions. A later replacement may interleave between lookup and UPDATE.
// A successful UPDATE advances revision even if consent was already disabled;
// queued/retrying channel suppression is the SQL-trigger boundary represented
// by queued booleans. In-flight provider calls and delivery outcomes are excluded.
// Replacement is the atomic successful Verify boundary from
// email_verification_completion; this model does not duplicate token verification.
// Opt-in captures the current preference revision, as in email.ts, and new
// consent never reenqueues historical notices. Service/storage failure before
// a write, lost committed responses and absent change metadata remain distinct.
// Exact HMAC, HTTP grammar, JSON bodies, queue inventories and provider behavior
// are not verified here. All scenarios are source-authored and unexecuted.
module email_unsubscribe_capability {
  val tokens = Set(1, 2, 3)
  val requests = Set(1, 2)
  def tokenVersion(token: int): int = if (token == 3) 2 else if (token == 0) 0 else 1
  def tokenKey(token: int): int = if (token == 1) 1 else 2
  type Request = { phase: str, token: int, observedVersion: int,
    committed: bool, authorizedVersion: int, response: int }
  val unused = { phase: "unused", token: 0, observedVersion: 0,
    committed: false, authorizedVersion: 0, response: 0 }
  type Consent = { pending: bool, revision: int, version: int,
    activity: bool, security: bool }
  var s: { destination: int, preferenceVersion: int, key: int,
    senderAvailable: bool, issued: Set[int], issuePhases: int -> str,
    activity: bool, security: bool, queuedActivity: bool, queuedSecurity: bool,
    revision: int, calls: int -> Request, consent: Consent, consentResponse: int }
  action init = s' = { destination: 1, preferenceVersion: 1, key: 1,
    senderAvailable: true, issued: Set(), issuePhases: tokens.mapBy(_ => "unused"),
    activity: true, security: true, queuedActivity: true, queuedSecurity: true,
    revision: 0, calls: requests.mapBy(_ => unused),
    consent: { pending: false, revision: 0, version: 1, activity: false, security: false },
    consentResponse: 0 }

  // Capturing an issued version is allowed to precede a destination replacement.
  action beginIssue(token: int): bool = all { tokens.contains(token),
    Set("unused", "done", "lost").contains(s.issuePhases.get(token)),
    tokenVersion(token) == s.destination, tokenKey(token) == s.key,
    s' = s.with("issuePhases", s.issuePhases.set(token, "hash")) }
  action storeIssue(token: int): bool = all { s.issuePhases.get(token) == "hash",
    s' = s.with("issued", s.issued.union(Set(token)))
      .with("issuePhases", s.issuePhases.set(token, "reply")) }
  action issueReply(token: int, received: bool): bool = all {
    s.issuePhases.get(token) == "reply",
    // Lost replies do not delete the immutable issued capability.
    s' = s.with("issuePhases", s.issuePhases.set(token, if (received) "done" else "lost")) }
  action issueFailure(token: int): bool = all { s.issuePhases.get(token) == "hash",
    s' = s.with("issuePhases", s.issuePhases.set(token, "done")) }
  action rotateKey = all { s.key == 1, s' = s.with("key", 2) }
  action pauseSender = s' = s.with("senderAvailable", false)
  action replaceDestination = all { s.destination == 1, s.revision < 4,
    s' = s.with("destination", 2).with("preferenceVersion", 2)
      .with("activity", true).with("security", true).with("revision", s.revision + 1) }

  action begin(requestId: int, token: int, validShape: bool): bool = all {
    requests.contains(requestId), Set(0, 1, 2, 3).contains(token),
    Set("unused", "done").contains(s.calls.get(requestId).phase),
    s' = s.with("calls", s.calls.set(requestId, unused.with("token", token)
      .with("phase", if (validShape) "lookup" else "done")
      .with("response", if (validShape) 0 else 400))) }
  action lookup(requestId: int): bool = {
    val request = s.calls.get(requestId)
    val found = s.issued.contains(request.token)
    all { request.phase == "lookup",
      s' = s.with("calls", s.calls.set(requestId, request
        .with("phase", if (found) "update" else "done")
        .with("observedVersion", if (found) tokenVersion(request.token) else 0)
        .with("response", if (found) 0 else 409))) }
  }
  action update(requestId: int): bool = {
    val request = s.calls.get(requestId)
    val matched = request.observedVersion == s.destination and
      request.observedVersion == s.preferenceVersion
    all { request.phase == "update", s.revision < 4,
      s' = s.with("calls", s.calls.set(requestId, request.with("phase", "reply")
        .with("committed", matched)
        .with("authorizedVersion", if (matched) s.destination else 0)))
        .with("activity", if (matched) false else s.activity)
        .with("security", if (matched) false else s.security)
        .with("queuedActivity", if (matched) false else s.queuedActivity)
        .with("queuedSecurity", if (matched) false else s.queuedSecurity)
        .with("revision", if (matched) s.revision + 1 else s.revision) }
  }
  action reply(requestId: int, received: bool, countVisible: bool): bool = {
    val request = s.calls.get(requestId)
    all { request.phase == "reply",
      s' = s.with("calls", s.calls.set(requestId, request.with("phase", "done")
        .with("response", if (not(received)) 503
          else if (request.committed and countVisible) 200 else 409))) }
  }
  action storageFailure(requestId: int): bool = {
    val request = s.calls.get(requestId)
    all { Set("lookup", "update").contains(request.phase),
      s' = s.with("calls", s.calls.set(requestId,
        request.with("phase", "done").with("response", 503))) }
  }
  action prepareConsent(activity: bool, security: bool): bool = all {
    not(s.consent.pending), activity or security,
    s' = s.with("consent", { pending: true, revision: s.revision,
      version: s.destination, activity: activity, security: security }) }
  action commitConsent = {
    val matched = s.consent.revision == s.revision and s.consent.version == s.destination
    all { s.consent.pending, s.revision < 4,
      s' = s.with("consent", s.consent.with("pending", false))
        .with("activity", if (matched) s.consent.activity else s.activity)
        .with("security", if (matched) s.consent.security else s.security)
        .with("revision", if (matched) s.revision + 1 else s.revision)
        .with("consentResponse", if (matched) 200 else 409) }
  }
  action newNotice = s' = s.with("queuedActivity", s.queuedActivity or s.activity)
    .with("queuedSecurity", s.queuedSecurity or s.security)
  action issued(token: int): bool = beginIssue(token).then(storeIssue(token)).then(issueReply(token, true))
  action pending(requestId: int, token: int): bool = begin(requestId, token, true).then(lookup(requestId))
  action unsubscribe(requestId: int, token: int): bool = pending(requestId, token).then(update(requestId)).then(reply(requestId, true, true))
  action step = {
    nondet token = tokens.oneOf()
    nondet requestId = requests.oneOf()
    nondet supplied = Set(0, 1, 2, 3).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { beginIssue(token), storeIssue(token), issueReply(token, yes), issueFailure(token),
      rotateKey, pauseSender, replaceDestination, begin(requestId, supplied, yes),
      lookup(requestId), update(requestId), reply(requestId, yes, other), storageFailure(requestId),
      prepareConsent(yes, other), commitConsent, newNotice, s' = s }
  }
  val invariant = all { s.issued.subseteq(tokens), s.revision >= 0, s.revision <= 4,
    s.destination == s.preferenceVersion,
    requests.forall(id => { val request = s.calls.get(id)
      (request.committed implies s.issued.contains(request.token) and
        request.authorizedVersion == tokenVersion(request.token)) and
      (request.response == 200 implies request.committed) }) }

  run issuedCapabilityDisablesBothChannelsTest = init.then(issued(1)).then(unsubscribe(1, 1))
    .expect(not(s.activity) and not(s.security) and not(s.queuedActivity) and not(s.queuedSecurity) and invariant)
  run capabilityWorksWithoutSessionOrSenderTest = init.then(issued(1)).then(pauseSender).then(unsubscribe(1, 1))
    .expect(s.calls.get(1).response == 200 and not(s.senderAvailable) and invariant)
  run malformedCapabilityNeverLooksUpTest = init.then(begin(1, 1, false))
    .expect(s.calls.get(1).response == 400 and s.activity and s.revision == 0 and invariant)
  run unissuedCapabilityCannotDisableTest = init.then(begin(1, 0, true)).then(lookup(1))
    .expect(s.calls.get(1).response == 409 and s.activity and invariant)
  run currentKeyMacWithoutIssuedRecordRefusesTest = init.then(rotateKey).then(replaceDestination)
    .then(begin(1, 3, true)).then(lookup(1)).expect(s.calls.get(1).response == 409 and s.activity and invariant)
  run rotationDoesNotRevokeIssuedCapabilityTest = init.then(issued(1)).then(rotateKey).then(issued(2))
    .then(pauseSender).then(unsubscribe(1, 1)).expect(s.issued == Set(1, 2) and s.calls.get(1).response == 200 and invariant)
  run repeatedUnsubscribeAdvancesRevisionTest = init.then(issued(1)).then(unsubscribe(1, 1)).then(unsubscribe(2, 1))
    .expect(s.revision == 2 and s.calls.get(2).response == 200 and invariant)
  run replacementBetweenLookupAndWriteRefusesTest = init.then(issued(1)).then(pending(1, 1))
    .then(replaceDestination).then(update(1)).then(reply(1, true, true))
    .expect(s.calls.get(1).response == 409 and s.activity and s.security and s.revision == 1 and invariant)
  run oldCapabilityCannotDisableReplacementTest = init.then(issued(1)).then(replaceDestination)
    .then(unsubscribe(1, 1)).expect(s.calls.get(1).response == 409 and s.activity and invariant)
  run issuanceFinishingAfterReplacementConfersNoAuthorityTest = init.then(beginIssue(1))
    .then(replaceDestination).then(storeIssue(1)).then(issueReply(1, true)).then(unsubscribe(1, 1))
    .expect(s.issued.contains(1) and s.calls.get(1).response == 409 and s.activity and invariant)
  run lostIssueReplyRetainsCapabilityTest = init.then(beginIssue(1)).then(storeIssue(1)).then(issueReply(1, false))
    .then(unsubscribe(1, 1)).expect(s.issued.contains(1) and s.calls.get(1).response == 200 and invariant)
  run lostUnsubscribeReplyDoesNotRestoreConsentTest = init.then(issued(1)).then(pending(1, 1)).then(update(1))
    .then(reply(1, false, true)).then(unsubscribe(2, 1))
    .expect(s.calls.get(1).response == 503 and s.calls.get(2).response == 200 and not(s.activity) and s.revision == 2 and invariant)
  run missingChangeMetadataDoesNotUndoWriteTest = init.then(issued(1)).then(pending(1, 1))
    .then(update(1)).then(reply(1, true, false))
    .expect(s.calls.get(1).response == 409 and not(s.activity) and s.revision == 1 and invariant)
  run storageFailureBeforeWriteLeavesConsentTest = init.then(issued(1)).then(pending(1, 1)).then(storageFailure(1))
    .expect(s.calls.get(1).response == 503 and s.activity and s.revision == 0 and invariant)
  run repeatedUnsubscribeFencesEarlierOptInTest = init.then(issued(1)).then(unsubscribe(1, 1))
    .then(prepareConsent(true, true)).then(unsubscribe(2, 1)).then(commitConsent)
    .expect(s.consentResponse == 409 and not(s.activity) and not(s.security) and invariant)
  run freshConsentDoesNotReenqueueHistoryTest = init.then(issued(1)).then(unsubscribe(1, 1))
    .then(prepareConsent(true, false)).then(commitConsent)
    .expect(s.activity and not(s.security) and not(s.queuedActivity) and not(s.queuedSecurity) and invariant)
    .then(newNotice).expect(s.queuedActivity and not(s.queuedSecurity) and invariant)
}
