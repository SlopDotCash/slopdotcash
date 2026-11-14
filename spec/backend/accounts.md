# Account identity and session lifetime

PRD sections 2 and 3 preserve GitHub actor identity through account renames,
current-session sign-out and closure. The retained `api_accounts` model
and pinned account handler distinguish sign-out from closing the account.
OAuth, cookie validation and durable writes are adapter responsibilities.
Wallets, obligations, settlement history, private cases and historical Points
remain attached to the immutable actor.

## Story: Sign in and manage participation

### A session belongs to one immutable account and has its own expiry

The session key here is an internal record ID. The adapter validates the actual
cookie digest, uses a trusted clock and supplies the caller's current session
ID independently of the request body. Issue IDs in order and never reuse them.
The authenticated context supplies `by`. Any action that accepts a target
session also requires a live caller session of the same account.

```quint
import email as E from "./email"
type Membership = Dormant | Open | Closed
type SessionStatus = UnknownSession | ActiveSession | RevokedSession | ExpiredSession
type Session = { id: int, expiresAt: int }
type Account = { actor: int, handle: str, membership: Membership, publicMember: bool,
  sessions: List[Session], revoked: List[int], lastSession: int, now: int, closures: List[int], returnPath: str, draft: str,
  xId: str, reservedXIds: List[str], publicX: bool, obligations: int, historicalPoints: int, email: E::Enrollment }
pure def newAccount(actorId: int, obligations: int, historicalPoints: int): Account = { actor: actorId, handle: "", membership: Dormant,
  publicMember: false, sessions: List(), revoked: List(), lastSession: 0, now: 0, closures: List(), returnPath: "/",
  draft: "", xId: "", reservedXIds: List(), publicX: false, obligations: obligations,
  historicalPoints: historicalPoints, email: E::newEnrollment(actorId) }
pure val initial: Account = newAccount(1, 0, 0)
pure def sessionStatus(a: Account, sessionId: int): SessionStatus =
  if (a.revoked.includes(sessionId)) RevokedSession
  else if (a.sessions.some(session => session.id == sessionId and session.expiresAt > a.now)) ActiveSession
  else if (a.sessions.some(session => session.id == sessionId)) ExpiredSession
  else UnknownSession
pure def sessionValid(a: Account, actorId: int, sessionId: int): bool =
  actorId == a.actor and sessionId > 0 and a.membership == Open and sessionStatus(a, sessionId) == ActiveSession
pure def alwaysActorValid(a: Account): bool = a.actor > 0 and a.email.actor == a.actor
pure def alwaysRetainedHistory(a: Account): bool = a.obligations >= 0 and a.historicalPoints >= 0
pure def alwaysSessionClock(a: Account): bool = a.lastSession >= 0 and a.now >= 0 and a.email.now == a.now
pure def alwaysEmailValid(a: Account): bool = E::alwaysEnrollmentTimes(a.email)
pure def alwaysSessionsRequireOpenAccount(a: Account): bool = a.membership != Open implies a.sessions.length() == 0
pure def alwaysSessionIds(a: Account): bool = a.sessions.every(session =>
  session.id > 0 and session.id <= a.lastSession and session.expiresAt > 0) and
  a.revoked.every(id => id > 0 and id <= a.lastSession)
pure def stepSessionSequenceNeverDecreases(before: Account, after: Account): bool = before.lastSession <= after.lastSession
pure def alwaysPublicMembershipRequiresOpenAccount(a: Account): bool = a.publicMember implies a.membership == Open
pure def lawNewAccountPreservesIdentity(actorId: int, obligations: int, historicalPoints: int): bool =
  (actorId > 0 and obligations >= 0 and historicalPoints >= 0) implies
    newAccount(actorId, obligations, historicalPoints).actor == actorId and
    newAccount(actorId, obligations, historicalPoints).obligations == obligations and
    newAccount(actorId, obligations, historicalPoints).historicalPoints == historicalPoints
```

### Each verified GitHub sign-in keeps other sessions and reveals the approved public identity

Sign-in requires the same immutable actor, verified OAuth and visibility
notice. The return destination and permitted draft survive. `handle` is the
current verified login normalized with GitHub's case-insensitive comparison.
Sign-in publishes an existing linked X identity and leaves mail consent alone.
An ordinary sign-in cannot reopen a closed account.

```quint
pure def canSaveReturn(a: Account, path: str, draftText: str): bool = path != ""
pure def saveReturn(a: Account, path: str, draftText: str): Account =
  { ...a, returnPath: path, draft: draftText }
pure def canSignIn(a: Account, actorId: int, handle: str, sessionId: int, expiresAt: int, oauthVerified: bool, disclosed: bool): bool =
  actorId == a.actor and handle != "" and sessionId > a.lastSession and not(a.revoked.includes(sessionId)) and
  expiresAt > a.now and oauthVerified and disclosed and a.membership != Closed
pure def signIn(a: Account, actorId: int, handle: str, sessionId: int, expiresAt: int, oauthVerified: bool, disclosed: bool): Account =
  { ...a, handle: handle, membership: Open, publicMember: true, publicX: a.xId != "",
    sessions: a.sessions.append({ id: sessionId, expiresAt: expiresAt }), lastSession: sessionId }
pure def canRename(a: Account, actorId: int, handle: str, oauthVerified: bool): bool =
  actorId == a.actor and handle != "" and oauthVerified
pure def rename(a: Account, actorId: int, handle: str, oauthVerified: bool): Account =
  { ...a, handle: handle }
pure def lawSignInKeepsExistingSession(a: Account, actorId: int, sessionId: int, otherSession: int, expiresAt: int): bool =
  (sessionValid(a, actorId, otherSession) and otherSession != sessionId and
    canSignIn(a, actorId, "login", sessionId, expiresAt, true, true)) implies
    sessionValid(signIn(a, actorId, "login", sessionId, expiresAt, true, true), actorId, otherSession)
```

### Sign-out revokes only the caller's session and expiry uses the trusted clock

A revoked session remains invalid even before its expiry. A session expires at
its exact deadline. Explicit backend revocation targets another session of this
same account. The product still omits a session list and a session-management
panel. Clock advancement also applies to pending email verification.

```quint
pure def canEndSession(a: Account, by: int, currentSession: int): bool = sessionValid(a, by, currentSession)
pure def endSession(a: Account, by: int, currentSession: int): Account =
  { ...a, revoked: a.revoked.append(currentSession) }
pure def canRevokeSession(a: Account, by: int, currentSession: int, targetSession: int): bool =
  sessionValid(a, by, currentSession) and sessionValid(a, by, targetSession) and targetSession != currentSession
pure def revokeSession(a: Account, by: int, currentSession: int, targetSession: int): Account =
  { ...a, revoked: a.revoked.append(targetSession) }
pure def canAdvanceTime(a: Account, now: int): bool = now >= a.now
pure def advanceTime(a: Account, now: int): Account =
  { ...a, now: now, email: E::advanceTime(a.email, now) }
pure def lawSignOutKeepsOtherSession(a: Account, by: int, currentSession: int, otherSession: int): bool =
  (sessionValid(a, by, currentSession) and sessionValid(a, by, otherSession) and currentSession != otherSession)
    implies not(sessionValid(endSession(a, by, currentSession), by, currentSession)) and
      sessionValid(endSession(a, by, currentSession), by, otherSession)
pure def lawRevocationKeepsCaller(a: Account, by: int, currentSession: int, targetSession: int): bool =
  canRevokeSession(a, by, currentSession, targetSession) implies
    not(sessionValid(revokeSession(a, by, currentSession, targetSession), by, targetSession)) and
    sessionValid(revokeSession(a, by, currentSession, targetSession), by, currentSession)
```

### Confirmed closure ends every session, disconnects X and withdraws both email consents

The person types their current GitHub login. The adapter checks the exact
confirmation field and normalizes case using the same comparison as the pinned
account handler. No other account or expired session can close this account.
The closure transaction clears links and pending X flows, keeps the prior X
identity reservations, cancels outstanding email verification, and appends
its timestamp. Reopening requires an explicit verified GitHub action and
visibility notice. It issues a new session and leaves X disconnected and email
consent withdrawn until the person connects or opts in again.

```quint
pure def canClose(a: Account, by: int, currentSession: int, confirmation: str): bool =
  sessionValid(a, by, currentSession) and confirmation != "" and confirmation == a.handle
pure def close(a: Account, by: int, currentSession: int, confirmation: str): Account =
  { ...a, membership: Closed, publicMember: false, xId: "", publicX: false, sessions: List(), revoked: List(),
    closures: a.closures.append(a.now), email: E::closeEnrollment(a.email, by, true) }
pure def canReopen(a: Account, by: int, handle: str, sessionId: int, expiresAt: int, oauthVerified: bool, disclosed: bool): bool =
  by == a.actor and handle != "" and sessionId > a.lastSession and expiresAt > a.now and
  oauthVerified and disclosed and a.membership == Closed
pure def reopen(a: Account, by: int, handle: str, sessionId: int, expiresAt: int, oauthVerified: bool, disclosed: bool): Account =
  { ...a, handle: handle, membership: Open, publicMember: true, xId: "", publicX: false,
    sessions: List({ id: sessionId, expiresAt: expiresAt }), lastSession: sessionId }
pure def alwaysClosedPrivate(a: Account): bool = a.membership == Closed implies
  not(a.publicMember) and not(a.publicX) and a.xId == "" and
  not(a.email.activityConsent) and not(a.email.securityConsent) and a.email.pendingAddress == "" and a.email.tokenDigest == ""
pure def lawClosureInvalidatesSession(a: Account, by: int, currentSession: int, confirmation: str, otherSession: int): bool =
  canClose(a, by, currentSession, confirmation) implies not(sessionValid(close(a, by, currentSession, confirmation), by, otherSession))
pure def stepHistoryIsStable(before: Account, after: Account): bool =
  before.actor == after.actor and before.obligations == after.obligations and
  before.historicalPoints == after.historicalPoints and before.closures.length() <= after.closures.length()
```

### An optional X identity stays reserved after disconnect and closure

The OAuth adapter verifies the exact X ID and the account's current session,
including the originating session of a pending link flow. It atomically checks
the global permanent reservation. X IDs remain decimal strings of 1–30 digits,
including values beyond the JavaScript safe integer range. A retained linked
identity may become public during sign-in. A disconnected identity has no
saved link to publish and requires renewed OAuth to reconnect.

```quint
pure def canConnectX(a: Account, by: int, currentSession: int, xId: str, oauthVerified: bool, reservationOwned: bool, disclosed: bool): bool =
  sessionValid(a, by, currentSession) and xId != "" and oauthVerified and reservationOwned and disclosed
pure def connectX(a: Account, by: int, currentSession: int, xId: str, oauthVerified: bool, reservationOwned: bool, disclosed: bool): Account =
  { ...a, xId: xId, reservedXIds: if (a.reservedXIds.includes(xId)) a.reservedXIds else a.reservedXIds.append(xId), publicX: true }
pure def canDisconnectX(a: Account, by: int, currentSession: int): bool = sessionValid(a, by, currentSession) and a.xId != ""
pure def disconnectX(a: Account, by: int, currentSession: int): Account = { ...a, xId: "", publicX: false }
pure def alwaysIdentityIds(a: Account): bool = a.reservedXIds.every(id => id != "")
pure def alwaysXReservation(a: Account): bool = a.xId != "" implies a.reservedXIds.includes(a.xId)
pure def alwaysXVisibility(a: Account): bool = a.publicX implies a.membership == Open and a.xId != ""
pure def stepXReservationsRetained(before: Account, after: Account): bool =
  before.reservedXIds.every(id => after.reservedXIds.includes(id))
```

## Story: Keep mail consent tied to the current account session

### Email enrollment and consent use the existing email rules under live session checks

The account aggregate uses the email enrollment machine for verification,
consent and withdrawal. Account closure's withdrawal differs from publishing
membership visibility during sign-in, which does not change email enrollment.
Unsubscribe still uses its scoped token without requiring an account session.

```quint
pure def canEnrollEmail(a: Account, by: int, currentSession: int, address: str, digest: str, expiresAt: int): bool =
  sessionValid(a, by, currentSession) and E::canEnroll(a.email, by, address, digest, expiresAt)
pure def enrollEmail(a: Account, by: int, currentSession: int, address: str, digest: str, expiresAt: int): Account =
  { ...a, email: E::enroll(a.email, by, address, digest, expiresAt) }
pure def canVerifyEmail(a: Account, by: int, currentSession: int, digest: str): bool =
  sessionValid(a, by, currentSession) and E::canVerify(a.email, by, digest)
pure def verifyEmail(a: Account, by: int, currentSession: int, digest: str): Account =
  { ...a, email: E::verify(a.email, by, digest) }
pure def canSetEmailConsent(a: Account, by: int, currentSession: int, security: bool, activity: bool): bool =
  sessionValid(a, by, currentSession) and E::canSetConsent(a.email, by, security, activity)
pure def setEmailConsent(a: Account, by: int, currentSession: int, security: bool, activity: bool): Account =
  { ...a, email: E::setConsent(a.email, by, security, activity) }
pure def canUnsubscribe(a: Account, tokenVerified: bool, security: bool): bool =
  E::canUnsubscribe(a.email, tokenVerified, security)
pure def unsubscribe(a: Account, tokenVerified: bool, security: bool): Account =
  { ...a, email: E::unsubscribe(a.email, tokenVerified, security) }
pure def stepSignInPreservesEmail(before: Account, via: str, after: Account): bool =
  (via == "signIn" or via == "reopen") implies before.email == after.email
```

### Multiple sessions, expiry, closure, disconnected X and explicit reopening are reachable

The bounded samples are for simulation only. The guards use the trusted
clock and monotonic session IDs without a fixed lifetime or account limit.

```quint
pure def sometimesTwoSessions(a: Account): bool = sessionValid(a, a.actor, 1) and sessionValid(a, a.actor, 2)
pure def sometimesTargetedSignOut(a: Account): bool = sessionStatus(a, 1) == RevokedSession and sessionValid(a, a.actor, 2)
pure def sometimesExpiredSession(a: Account): bool = sessionStatus(a, 1) == ExpiredSession
pure def sometimesClosed(a: Account): bool = a.membership == Closed
pure def sometimesDisconnected(a: Account): bool = a.reservedXIds.length() > 0 and a.xId == ""
pure def sometimesReopened(a: Account): bool = a.membership == Open and a.closures.length() > 0
pure val weight_signIn = 12
pure val weight_endSession = 4
pure val weight_revokeSession = 4
pure val weight_advanceTime = 2
pure val weight_close = 8
pure val weight_reopen = 8
pure val weight_enrollEmail = 4
pure val weight_verifyEmail = 4
pure val weight_setEmailConsent = 4
pure val obligationsValues = Set(0, 1, 2)
pure val historicalPointsValues = Set(0, 10, 30)
pure val actorIdValues = Set(0, 1, 2)
pure val byValues = Set(0, 1, 2)
pure val draftTextValues = Set("", "a", "b")
pure val handleValues = Set("", "login", "renamed")
pure val confirmationValues = Set("", "login", "renamed", "wrong")
pure val pathValues = Set("", "/inbox", "/settings")
pure val xIdValues = Set("", "123456789", "123456789012345678901234567890")
pure val sessionIdValues = Set(0, 1, 2, 3, 4)
pure val currentSessionValues = Set(0, 1, 2, 3, 4)
pure val targetSessionValues = Set(0, 1, 2, 3, 4)
pure val otherSessionValues = Set(0, 1, 2, 3, 4)
pure val expiresAtValues = Set(1, 2, 4, 8)
pure val nowValues = Set(0, 1, 2, 4, 8)
pure val firstSession = signIn(initial, 1, "login", 1, 4, true, true)
pure val twoSessions = signIn(firstSession, 1, "login", 2, 8, true, true)
pure val aValues = Set(initial, firstSession, twoSessions)
```
