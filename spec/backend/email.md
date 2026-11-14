# Account-bound email enrollment

This component covers PRD sections 3 and 9 and the pinned sources
`backend/notifications/email.ts`, `email-destinations.ts`,
`workers/notify/enrollment.ts` and migrations 0033, 0111 and 0116. It holds
one account's verification requests, its verified destination, its consent
preference and the unsubscribe capabilities issued for its destinations. It
has no state of its own: the [account service](./accounts.md) holds one
enrollment per member, supplies the trusted clock and the fresh identifiers
(verification ID, token digest and destination version) from its own
counters, and checks the rules here on every member.

The transport validates addresses (at most 254 bytes, the shared address
pattern) and stores only digests of high-entropy tokens. `addressKey` is the
digest of the lowercased address. Plaintext tokens and mail bodies never enter
public projections. Provider delivery is distinct from enrollment; in-app
notices ([Notifications](../operations/notifications.md)) do not depend on
any field here.

## Story: Verify a notification address and choose consent

> As a member, I want to verify an address I control and choose security and
> activity mail separately, so that Slop mails me only what I agreed to, at
> the address I verified.

### A verification request records the requested consent and is idempotent per request key

The request names the address, both consent choices and a client
idempotency key. A replay of the same key with the same fields answers with
the current state; a replay with different fields is a conflict. A new
request cancels the account's earlier pending requests. A request expires
after 30 minutes. One request per minute per account, and three per hour
per account or per address key across all accounts, are admitted; the
others are refused with a retry time. The service supplies the count of
other accounts' recent requests for the same address key. Enrollment is
refused while the mail service reports enrollment unavailable.

```quint
type DeliveryState = Queued | Sending | Sent | DeliveryUnknown
type Verification = { id: int, requestKey: int, address: str, addressKey: str, tokenDigest: int,
  activity: bool, security: bool, delivery: DeliveryState, createdAt: int, expiresAt: int,
  cancelled: bool, consumed: bool, version: int }
type Destination = { address: str, version: int, verifiedAt: int }
type Preference = { stored: bool, activity: bool, security: bool, version: int, revision: int }
type UnsubscribeToken = { token: int, version: int }
type Enrollment = { actor: int, verifications: List[Verification], destination: Destination,
  preference: Preference, unsubscribeTokens: List[UnsubscribeToken], pilotVersion: int }
type RequestOutcome = RequestAccepted | RequestReplayed | IdempotencyConflict | VerificationRateLimited
  | EnrollmentUnavailable | InvalidEmailRequest
pure val verificationLifetime = 30 * 60
pure val minuteWindow = 60
pure val hourWindow = 60 * 60
pure val hourlyLimit = 3
pure val noDestination: Destination = { address: "", version: 0, verifiedAt: 0 }
pure val noPreference: Preference = { stored: false, activity: false, security: false, version: 0, revision: 0 }
pure def newEnrollment(actorId: int, pilotVersion: int): Enrollment = { actor: actorId, verifications: List(),
  destination: noDestination, preference: noPreference, unsubscribeTokens: List(), pilotVersion: pilotVersion }
pure def pending(v: Verification, now: int): bool = not(v.consumed) and not(v.cancelled) and now < v.expiresAt
pure def recentRequests(e: Enrollment, now: int, window: int): int =
  e.verifications.select(v => v.createdAt > now - window).length()
pure def sameAddressRecent(e: Enrollment, now: int, addressKey: str): int =
  e.verifications.select(v => v.createdAt > now - hourWindow and v.addressKey == addressKey).length()
pure def ownByKey(e: Enrollment, requestKey: int): List[Verification] = e.verifications.select(v => v.requestKey == requestKey)
pure def requestOutcome(e: Enrollment, now: int, requestKey: int, address: str, addressKey: str,
  activity: bool, security: bool, otherAccountsRecent: int, available: bool): RequestOutcome =
  val prior = ownByKey(e, requestKey)
  if (requestKey <= 0 or address == "" or addressKey == "") InvalidEmailRequest
  else if (prior.length() > 0)
    (if (prior.every(v => v.address == address and v.activity == activity and v.security == security)) RequestReplayed
     else IdempotencyConflict)
  else if (not(available)) EnrollmentUnavailable
  else if (recentRequests(e, now, minuteWindow) > 0 or recentRequests(e, now, hourWindow) + otherAccountsRecent >= hourlyLimit)
    VerificationRateLimited
  else RequestAccepted
pure def requestVerification(e: Enrollment, now: int, id: int, requestKey: int, address: str, addressKey: str,
  activity: bool, security: bool): Enrollment =
  { ...e, verifications: e.verifications.listMap(v => if (not(v.consumed) and not(v.cancelled)) { ...v, cancelled: true } else v)
    .append({ id: id, requestKey: requestKey, address: address, addressKey: addressKey, tokenDigest: id,
      activity: activity, security: security, delivery: Queued, createdAt: now, expiresAt: now + verificationLifetime,
      cancelled: false, consumed: false, version: 0 }) }
pure def lawReplayNeverAddsARequest(e: Enrollment, now: int, requestKey: int, address: str, addressKey: str,
  activity: bool, security: bool, others: int): bool =
  requestOutcome(e, now, requestKey, address, addressKey, activity, security, others, true) == RequestReplayed
    implies ownByKey(e, requestKey).length() > 0
pure def lawFourthRequestInAnHourRefused(e: Enrollment, now: int, requestKey: int, address: str, addressKey: str, others: int): bool =
  (ownByKey(e, requestKey).length() == 0 and requestKey > 0 and address != "" and addressKey != ""
    and recentRequests(e, now, hourWindow) + others >= hourlyLimit)
    implies requestOutcome(e, now, requestKey, address, addressKey, true, true, others, true) == VerificationRateLimited
```

### Delivery of the verification mail has its own state

The private mail service claims a queued request (`sending`) and records
`sent` or `unknown`. If the backend cannot reach the mail service, a still
queued request becomes `unknown`. Delivery state never verifies anything.

```quint
pure def canMarkDelivery(e: Enrollment, now: int, id: int, nextState: DeliveryState): bool =
  e.verifications.some(v => v.id == id and pending(v, now) and
    ((v.delivery == Queued and (nextState == Sending or nextState == DeliveryUnknown))
      or (v.delivery == Sending and (nextState == Sent or nextState == DeliveryUnknown))))
pure def markDelivery(e: Enrollment, now: int, id: int, nextState: DeliveryState): Enrollment =
  { ...e, verifications: e.verifications.listMap(v => if (v.id == id) { ...v, delivery: nextState } else v) }
```

### Verification is account-bound, single-use, unexpired and applies the consent requested with it

The signed-in account presents the token. The request reads the preference
revision first; the single verifying write succeeds only if that revision is
unchanged, so an opt-out saved in between wins. Verification consumes the
request, records a new destination version for the address, and copies the
consent the person requested with it into the preference for that version.
A fresh verification after an opt-out is new, explicit consent.

```quint
pure def revisionOf(e: Enrollment): int = if (e.preference.stored) e.preference.revision else -1
pure def verificationByToken(e: Enrollment, token: int): Verification =
  e.verifications.select(v => v.tokenDigest == token).nthOr(0, { id: 0, requestKey: 0, address: "", addressKey: "",
    tokenDigest: 0, activity: false, security: false, delivery: Queued, createdAt: 0, expiresAt: 0,
    cancelled: true, consumed: true, version: 0 })
pure def canVerify(e: Enrollment, now: int, token: int, checkedRevision: int): bool =
  val v = verificationByToken(e, token)
  token > 0 and pending(v, now) and checkedRevision == revisionOf(e)
pure def verify(e: Enrollment, now: int, token: int, version: int): Enrollment =
  val v = verificationByToken(e, token)
  { ...e, verifications: e.verifications.listMap(x => if (x.tokenDigest == token) { ...x, consumed: true, version: version } else x),
    destination: { address: v.address, version: version, verifiedAt: now },
    preference: { stored: true, activity: v.activity, security: v.security, version: version,
      revision: if (e.preference.stored) e.preference.revision + 1 else 0 } }
pure def lawStaleRevisionCannotVerify(e: Enrollment, now: int, token: int, checkedRevision: int): bool =
  checkedRevision != revisionOf(e) implies not(canVerify(e, now, token, checkedRevision))
```

### Consent changes are compare-and-set and enabling binds the exact destination version

A save names activity consent, optionally security consent, and, only when
enabling, the destination version the person saw. Turning on a category
that was off, or naming a version, needs the current destination version:
the verified destination, or the activity-pilot destination configured for
the account. Otherwise the save is refused as `verification_changed`. Every
save compares the preference revision read at the start of the request and
is refused as `preference_changed` if another write came first.

```quint
type SecurityChoice = KeepSecurity | SecurityOn | SecurityOff
type ConsentOutcome = ConsentSaved | ConsentInvalid | VerificationChanged | PreferenceChanged
pure def currentVersion(e: Enrollment): int = if (e.destination.version > 0) e.destination.version else e.pilotVersion
pure def securityAfter(e: Enrollment, choice: SecurityChoice): bool =
  if (choice == SecurityOn) true else if (choice == SecurityOff) false else e.preference.security
pure def needsVerifiedVersion(e: Enrollment, activity: bool, choice: SecurityChoice, suppliedVersion: int): bool =
  val withdraws = (e.preference.activity and not(activity)) or (e.preference.security and choice == SecurityOff)
  (activity and not(e.preference.activity)) or (choice == SecurityOn and not(e.preference.security))
    or (suppliedVersion > 0 and (not(withdraws) or suppliedVersion != e.preference.version))
pure def consentOutcome(e: Enrollment, activity: bool, choice: SecurityChoice, suppliedVersion: int, checkedRevision: int): ConsentOutcome =
  val enabling = activity or choice == SecurityOn
  if (suppliedVersion < 0 or (suppliedVersion > 0 and not(enabling))) ConsentInvalid
  else if (needsVerifiedVersion(e, activity, choice, suppliedVersion)
    and (suppliedVersion == 0 or suppliedVersion != currentVersion(e))) VerificationChanged
  else if (checkedRevision != revisionOf(e)) PreferenceChanged
  else ConsentSaved
pure def setConsent(e: Enrollment, activity: bool, choice: SecurityChoice, suppliedVersion: int, checkedRevision: int): Enrollment =
  { ...e, preference: { stored: true, activity: activity, security: securityAfter(e, choice),
    version: if (needsVerifiedVersion(e, activity, choice, suppliedVersion)) suppliedVersion else e.preference.version,
    revision: if (e.preference.stored) e.preference.revision + 1 else 0 } }
pure def lawEnablingNeedsCurrentVersion(e: Enrollment, choice: SecurityChoice, suppliedVersion: int, checkedRevision: int): bool =
  (not(e.preference.activity) and consentOutcome(e, true, choice, suppliedVersion, checkedRevision) == ConsentSaved)
    implies suppliedVersion == currentVersion(e) and suppliedVersion > 0
pure def lawOptOutNeedsNoVersion(e: Enrollment): bool =
  consentOutcome(e, false, SecurityOff, 0, revisionOf(e)) == ConsentSaved
```

### Unsubscribe withdraws both categories only for the destination version its token was issued for

Each mail carries an unsubscribe capability issued for the destination
version it was sent to; issued capabilities are permanent and immutable.
Using one sets both consents off, but only while that version is still both
the verified destination and the preference's version. A capability for an
older destination does nothing. The one-click form needs the exact body
`List-Unsubscribe=One-Click`, which the shell checks. Unsubscribe grants no
account or case access.

```quint
pure def canIssueUnsubscribe(e: Enrollment, token: int): bool =
  token > 0 and not(e.unsubscribeTokens.some(t => t.token == token)) and e.destination.version > 0
    and e.preference.version == e.destination.version and (e.preference.activity or e.preference.security)
pure def issueUnsubscribe(e: Enrollment, token: int): Enrollment =
  { ...e, unsubscribeTokens: e.unsubscribeTokens.append({ token: token, version: e.destination.version }) }
pure def unsubscribeVersion(e: Enrollment, token: int): int =
  e.unsubscribeTokens.select(t => t.token == token).nthOr(0, { token: 0, version: 0 }).version
pure def canUnsubscribe(e: Enrollment, token: int): bool =
  val version = unsubscribeVersion(e, token)
  version > 0 and version == e.destination.version and version == e.preference.version
pure def unsubscribe(e: Enrollment, token: int): Enrollment =
  { ...e, preference: { ...e.preference, activity: false, security: false, revision: e.preference.revision + 1 } }
pure def lawStaleUnsubscribeIgnored(e: Enrollment, token: int): bool =
  unsubscribeVersion(e, token) != e.destination.version implies not(canUnsubscribe(e, token))
pure def lawUnsubscribeWithdrawsBoth(e: Enrollment, token: int): bool =
  val after = unsubscribe(e, token)
  not(after.preference.activity) and not(after.preference.security) and after.destination == e.destination
```

### Account closure withdraws both consents and cancels pending verification

The account service applies this in the closure transaction. The preference
version is cleared, so no queued mail binds to it, and pending requests are
cancelled, so their tokens cannot verify after reopening. The verified
destination row, issued capabilities and delivery history remain.

```quint
pure def closeEnrollment(e: Enrollment): Enrollment =
  { ...e, verifications: e.verifications.listMap(v => if (not(v.consumed)) { ...v, cancelled: true } else v),
    preference: if (e.preference.stored) { ...e.preference, activity: false, security: false, version: 0,
      revision: e.preference.revision + 1 } else e.preference }
pure def wellFormed(e: Enrollment, now: int): bool =
  e.actor > 0 and e.pilotVersion >= 0 and e.destination.version >= 0
    and e.verifications.every(v => v.id > 0 and v.tokenDigest == v.id and v.requestKey > 0 and v.address != ""
      and v.addressKey != "" and v.expiresAt == v.createdAt + verificationLifetime and v.createdAt <= now
      and (v.consumed implies v.version > 0 and not(v.cancelled))
      and (not(v.consumed) implies v.version == 0)
      and e.verifications.select(o => o.id == v.id).length() == 1
      and e.verifications.select(o => o.requestKey == v.requestKey).length() == 1)
    and e.verifications.select(v => not(v.consumed) and not(v.cancelled)).length() <= 1
    and ((e.preference.activity or e.preference.security) implies
      e.preference.stored and e.preference.version > 0 and e.preference.version == currentVersion(e))
    and (e.destination.version > 0 implies e.destination.address != ""
      and e.verifications.some(v => v.consumed and v.version == e.destination.version and v.address == e.destination.address))
    and e.unsubscribeTokens.every(t => t.token > 0 and t.version > 0
      and e.unsubscribeTokens.select(o => o.token == t.token).length() == 1)
    and e.preference.revision >= 0
pure def historyRetained(before: Enrollment, after: Enrollment): bool =
  before.unsubscribeTokens.every(t => after.unsubscribeTokens.includes(t))
    and before.verifications.every(v => after.verifications.some(w => w.id == v.id and w.address == v.address
      and w.activity == v.activity and w.security == v.security and w.createdAt == v.createdAt
      and (v.consumed implies w.consumed and w.version == v.version) and (v.cancelled implies w.cancelled)))
    and (before.preference.stored implies after.preference.stored and after.preference.revision >= before.preference.revision)
pure def lawClosureWithdrawsEverything(e: Enrollment, now: int): bool =
  val after = closeEnrollment(e)
  not(after.preference.activity) and not(after.preference.security)
    and after.verifications.every(v => not(pending(v, now))) and after.destination == e.destination
```

### Simulation samples exercise replay, rate limits, stale versions and revisions

These sets bound simulation only.

```quint
pure val sampleRequested: Enrollment = requestVerification(newEnrollment(1, 0), 100, 1, 1, "a", "ka", true, false)
pure val sampleVerified: Enrollment = verify(sampleRequested, 120, 1, 7)
pure val sampleTokened: Enrollment = issueUnsubscribe(sampleVerified, 3)
pure val eValues = Set(newEnrollment(1, 0)).union(Set(newEnrollment(1, 5))).union(Set(sampleRequested))
  .union(Set(sampleVerified)).union(Set(sampleTokened))
pure val nowValues = Set(0, 100, 159, 160, 1900, 3700)
pure val requestKeyValues = Set(0, 1, 2)
pure val addressValues = Set("", "a", "b")
pure val addressKeyValues = Set("", "ka", "kb")
pure val otherAccountsRecentValues = Set(0, 2, 3)
pure val othersValues = Set(0, 2, 3)
pure val tokenValues = Set(0, 1, 3, 4)
pure val checkedRevisionValues = Set(-1, 0, 1)
pure val suppliedVersionValues = Set(-1, 0, 5, 7, 8)
pure val choiceValues = Set(KeepSecurity, SecurityOn, SecurityOff)
```
