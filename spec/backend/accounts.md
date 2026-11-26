# Account identity, sessions and membership

PRD sections 2, 3, 7 and 9, with the pinned `backend/points/handler.ts`,
`backend/points/x.ts`, `backend/identity-assertion.ts`, migrations 0008,
0015, 0056 and 0108, and the retained `api_accounts`, `api_x_connection`,
`api_email_consent` and `identity_*` models. This machine is the whole web
account service: the [identity Worker](./identity.md) store it consumes
assertions from, every membership, every web session, the
[X connection registry](./xConnection.md) and each member's
[email enrollment](./email.md), together with the
[notice outbox](../operations/notifications.md) whose consent snapshot and
closure suppression it commits in the same write. Wallets, obligations, settlement history,
private cases and historical Points stay attached to the immutable actor and
are not changed by any transition here.

The authenticated sender `by` is the web session ID the shell resolved from
the presented `__Host-slop_points` cookie by its SHA-256 digest; 0 means no
valid cookie. The account behind a session comes from this state, never from
the request. Negative senders are the service's own internal paths, which
the shell establishes from its code, never from a request: the identity
Worker's GitHub callback handler, clock and hourly job (`I::githubExchange`,
`I::workerClock`, `I::identityCron`), the X callback handler after its own
OAuth exchange (`xCallback`), the private mail service (`mailService`), and
the source-change writers that save a notice in their own transaction
(`noticeSource`). The clock is the service's trusted clock in seconds. Session,
verification, destination-version and unsubscribe identifiers stand for
random values and are issued here from counters that never repeat.

Shell obligations outside this model: the allowed browser origins and
same-origin JSON write check, the 20-per-minute POST limiter per client
address, exact body key sets, cookie attributes, ASCII case folding of the
closure confirmation, and the `x-slop-expected-github-id` header. That
header only narrows the session and never supplies authority: the Points
dispute routes refuse a value naming another account with 409
`account_changed`, and every other session route refuses a malformed value
(not `^[1-9]\d{0,19}$`) with 400 `invalid_expected_actor` and another
account with 403 `actor_changed` (`backend/http.ts` `requireActor`). The
same request hardening serves every area's routes (`@repo/platform/http`):
bounded bodies with exact key sets, D1 reads that bind at most 100
parameters (long ID lists go in batches of 90), the stable error mapping and
the trace API's per-route browser headers.

## Story: Sign in with GitHub and keep one immutable account

> As a contributor, I want GitHub to be my only login, so that my account,
> history and money stay attached to me through renames.

### Members are keyed by an immutable actor and numeric GitHub ID, and sessions by server-issued IDs

A member's actor key is the GitHub node ID asserted at first join; later
sign-ins look the member up by numeric GitHub ID and reuse the stored actor
even when GitHub spells the node differently. A web session lasts exactly
one hour from sign-in, or seven days for the configured owner
([below](#only-the-configured-owner-while-a-current-administrator-gets-a-seven-day-session)).
Session IDs are issued in order and never reused.

```quint
import identity as I from "./identity"
import email as E from "./email"
import xConnection as X from "./xConnection"
import notifications as N from "../operations/notifications"
type Membership = Open | Closed
type Member = { actor: int, githubId: int, login: str, membership: Membership, public: bool,
  joinedAt: int, closedAt: int, xLink: X::XLink, telegramLinked: bool, email: E::Enrollment }
type Session = { id: int, actor: int, expiresAt: int }
type HistoricalAward = { actor: int, at: int, points: int }
type Accounts = { now: int, identity: I::Identity, members: List[Member], sessions: List[Session], lastSession: int,
  xRegistry: X::XRegistry, xConfigured: bool, mailAvailable: bool, telegramClaims: List[str],
  xAwards: List[HistoricalAward], refusedSignIns: List[int], lastEmailId: int, lastVersion: int, lastUnsubscribe: int,
  inbox: N::Inbox, ownerSession: int }
pure val sessionLifetime = 60 * 60
pure val participationPointsEnd = 1792800000
pure val launchClock = 1794614400
pure val xCallback = -5
pure val mailService = -6
pure val noticeSource = -7
pure val absentMember: Member = { actor: 0, githubId: 0, login: "", membership: Closed, public: false,
  joinedAt: 0, closedAt: 0, xLink: X::noLink, telegramLinked: false, email: E::newEnrollment(1, 0) }
pure def memberByGithub(s: Accounts, githubId: int): Member = s.members.select(m => m.githubId == githubId).nthOr(0, absentMember)
pure def memberByActor(s: Accounts, actor: int): Member = s.members.select(m => m.actor == actor).nthOr(0, absentMember)
pure def hasGithubMember(s: Accounts, githubId: int): bool = s.members.some(m => m.githubId == githubId)
pure def replaceMember(members: List[Member], changed: Member): List[Member] =
  members.listMap(m => if (m.actor == changed.actor) changed else m)
pure def sessionLive(s: Accounts, sessionId: int): bool = sessionId > 0 and s.sessions.some(x => x.id == sessionId and x.expiresAt > s.now)
pure def senderActor(s: Accounts, by: int): int =
  if (sessionLive(s, by)) s.sessions.select(x => x.id == by).nthOr(0, { id: 0, actor: 0, expiresAt: 0 }).actor else 0
pure def liveSessionOf(s: Accounts, sessionId: int, actor: int): bool =
  s.sessions.some(x => x.id == sessionId and x.actor == actor and x.expiresAt > s.now)
pure def alwaysMembersIdentified(s: Accounts): bool = s.members.every(m =>
  m.actor > 0 and m.githubId > 0 and m.login != "" and m.joinedAt > 0 and m.email.actor == m.githubId
    and s.members.select(o => o.githubId == m.githubId).length() == 1
    and s.members.select(o => o.actor == m.actor).length() == 1)
pure def alwaysSessionsBelongToOpenMembers(s: Accounts): bool = s.lastSession >= 0 and s.sessions.every(x =>
  x.id > 0 and x.id <= s.lastSession and x.expiresAt <= s.now + ownerSessionLifetime
    and s.sessions.select(o => o.id == x.id).length() == 1
    and s.members.some(m => m.actor == x.actor and m.membership == Open))
pure def alwaysClockShared(s: Accounts): bool = s.identity.now == s.now and s.now >= launchClock
pure def alwaysIdentityStoreValid(s: Accounts): bool =
  I::alwaysFlowsWellFormed(s.identity) and I::alwaysFlowIdsUnique(s.identity) and I::alwaysOneAssertionPerFlow(s.identity)
    and I::alwaysIssuedOnce(s.identity) and I::alwaysIssuedFlowsClosed(s.identity) and I::alwaysConsumedOnce(s.identity)
    and I::alwaysIdentityAfterCallback(s.identity) and I::alwaysAssertionsMatchTheirFlow(s.identity)
    and I::alwaysVerifierOnlyWhilePending(s.identity) and I::alwaysLocalFlowsHaveNoAssertion(s.identity)
    and I::alwaysBoundOnlyForWebsite(s.identity)
pure def stepMembersPermanent(before: Accounts, after: Accounts): bool = before.members.every(m =>
  after.members.some(n => n.actor == m.actor and n.githubId == m.githubId and n.joinedAt == m.joinedAt))
pure def stepSessionIdsFresh(before: Accounts, after: Accounts): bool =
  before.lastSession <= after.lastSession and before.now <= after.now
    and after.sessions.every(x => before.sessions.includes(x) or x.id > before.lastSession)
```

### A web sign-in consumes one web assertion and opens a public membership

The browser posts the assertion. Joining consumes it for the
`slop-points-web` audience first; an expired, used, unknown or other-audience
assertion is refused as `identity_expired` and changes nothing. The
assertion's GitHub identity is the only identity source. The batch then
upserts the member, publishes the membership and any existing X link, issues
a session and deletes every expired session. A first join records
`joinedAt`; later sign-ins keep it and only update the login. Existing
private memberships and X links become public here and only here; a public
read never publishes. A joined node ID that already keys another GitHub
account, or a failed batch, leaves the assertion consumed and issues no
session (503). Sign-in never changes email enrollment.

```quint
pure def assertedGithub(s: Accounts, token: int): I::GitHubIdentity = I::assertionFor(s.identity, token).github
pure def actorKeyFor(s: Accounts, token: int): int =
  val g = assertedGithub(s, token)
  if (hasGithubMember(s, g.actor)) memberByGithub(s, g.actor).actor else g.nodeId
pure def actorKeyFree(s: Accounts, token: int): bool =
  val g = assertedGithub(s, token)
  hasGithubMember(s, g.actor) or not(s.members.some(m => m.actor == g.nodeId))
pure def openSession(s: Accounts, m: Member): List[Session] =
  s.sessions.select(x => x.expiresAt > s.now)
    .append({ id: s.lastSession + 1, actor: m.actor, expiresAt: s.now + lifetimeFor(s, m.githubId) })
pure def joined(s: Accounts, token: int): Member =
  val g = assertedGithub(s, token)
  val prior = memberByGithub(s, g.actor)
  if (hasGithubMember(s, g.actor))
    { ...prior, login: g.login, membership: Open, public: true, closedAt: 0,
      xLink: if (prior.xLink.xId != "") { ...prior.xLink, public: true } else prior.xLink }
  else { actor: g.nodeId, githubId: g.actor, login: g.login, membership: Open, public: true, joinedAt: s.now,
    closedAt: 0, xLink: X::noLink, telegramLinked: false, email: E::newEnrollment(g.actor, 0) }
pure def admitMember(token: int, s: Accounts): Accounts =
  val m = joined(s, token)
  { ...s, identity: I::consume(s.identity, token, I::PointsWeb), sessions: openSession(s, m),
    lastSession: s.lastSession + 1,
    members: if (hasGithubMember(s, m.githubId)) replaceMember(s.members, m) else s.members.append(m) }
pure def canSignIn(s: Accounts, token: int): bool =
  I::canConsume(s.identity, token, I::PointsWeb) and actorKeyFree(s, token)
    and (hasGithubMember(s, assertedGithub(s, token).actor) implies memberByGithub(s, assertedGithub(s, token).actor).membership == Open)
pure def signIn(s: Accounts, token: int): Accounts = admitMember(token, s)
pure def canSignInStorageFailed(s: Accounts, token: int): bool = I::canConsume(s.identity, token, I::PointsWeb)
pure def signInStorageFailed(s: Accounts, token: int): Accounts =
  { ...s, identity: I::consume(s.identity, token, I::PointsWeb), refusedSignIns: s.refusedSignIns.append(token) }
pure def welcomeShown(m: Member): int = if (m.joinedAt > 0 and m.joinedAt < participationPointsEnd) 5 else 0
pure def socialShown(s: Accounts, actor: int): int =
  s.xAwards.select(a => a.actor == actor and a.at < participationPointsEnd).foldl(0, (sum, a) => sum + a.points)
pure def alwaysParticipationAwardsHistorical(s: Accounts): bool =
  s.xAwards.every(a => a.at < participationPointsEnd and a.points > 0 and a.actor > 0)
pure def stepNoNewParticipationAward(before: Accounts, after: Accounts): bool = after.xAwards == before.xAwards
pure def stepSignInPreservesEmail(before: Accounts, via: str, after: Accounts): bool =
  (via == "signIn" or via == "reopen") implies before.members.every(m => memberByActor(after, m.actor).email == m.email)
pure def stepPublicationOnlyBySignIn(before: Accounts, via: str, after: Accounts): bool =
  after.members.every(m => (m.public and not(memberByActor(before, m.actor).public) and hasActor(before, m.actor))
    implies (via == "signIn" or via == "reopen" or via == "publishMembership"))
pure def hasActor(s: Accounts, actor: int): bool = s.members.some(m => m.actor == actor)
pure def lawLateJoinHasNoWelcome(t: int): bool =
  t >= participationPointsEnd implies welcomeShown({ ...absentMember, actor: 1, githubId: 1, login: "a", joinedAt: t }) == 0
pure def lawEarlyJoinKeepsWelcome(t: int): bool =
  (t > 0 and t < participationPointsEnd) implies welcomeShown({ ...absentMember, actor: 1, githubId: 1, login: "a", joinedAt: t }) == 5
```

### Only the configured owner, while a current administrator, gets a seven-day session

`ownerSession` is the numeric GitHub ID of the configured production owner
(`OWNER_SESSION_GITHUB_ID`) when the current administrator list
(`ADMIN_GITHUB_IDS`) also holds it, and 0 otherwise; the shell resolves it on
each request, as it does `xConfigured`. A sign-in or explicit reopen by that
identity opens a session of exactly seven days; every other one opens a
session of exactly one hour. Each privileged action still checks current
authority itself. A session keeps its recorded expiry when the configuration
changes, and the identity flow and one-use assertion keep their own
lifetimes (PRD section 3, owner decision of 17 November 2026).

```quint
pure val ownerSessionLifetime = 7 * 24 * 60 * 60
pure def lifetimeFor(s: Accounts, githubId: int): int =
  if (s.ownerSession > 0 and githubId == s.ownerSession) ownerSessionLifetime else sessionLifetime
pure def stepSessionLifetimeFixedAtSignIn(before: Accounts, after: Accounts): bool =
  after.sessions.every(x => before.sessions.includes(x)
    or x.expiresAt == before.now + lifetimeFor(before, memberByActor(after, x.actor).githubId))
pure def sometimesOwnerWeekSession(s: Accounts): bool = s.sessions.some(x => x.expiresAt > s.now + sessionLifetime)
```

### An ordinary sign-in cannot reopen a closed account; explicit reopening can

A join for a closed account without the explicit `reopen` flag consumes the
assertion and answers `account_closed` with the closure time and no
session; a join that races closure ends the same way. An explicit reopen,
after the visibility notice, opens the membership publicly with a new
session. X stays disconnected and email consent stays withdrawn until the
person connects or opts in again. Reopening clears the closure time, as
DEV does (`closed_at=NULL`); no closure history is kept.

```quint
pure def canRefuseClosedSignIn(s: Accounts, token: int): bool =
  I::canConsume(s.identity, token, I::PointsWeb) and hasGithubMember(s, assertedGithub(s, token).actor)
    and memberByGithub(s, assertedGithub(s, token).actor).membership == Closed
pure def refuseClosedSignIn(s: Accounts, token: int): Accounts =
  { ...s, identity: I::consume(s.identity, token, I::PointsWeb), refusedSignIns: s.refusedSignIns.append(token) }
pure def canReopen(s: Accounts, token: int): bool = canRefuseClosedSignIn(s, token)
pure def reopen(s: Accounts, token: int): Accounts = admitMember(token, s)
pure def closureReadback(s: Accounts, githubId: int): int = memberByGithub(s, githubId).closedAt
pure def alwaysRefusalsConsumed(s: Accounts): bool = s.refusedSignIns.every(t => s.identity.consumedTokens.includes(t))
pure def lawJoinAfterCloseIssuesNoSession(s: Accounts, token: int): bool =
  canRefuseClosedSignIn(s, token) implies not(canSignIn(s, token))
    and refuseClosedSignIn(s, token).sessions == s.sessions and refuseClosedSignIn(s, token).members == s.members
```

### Sign-out ends only the caller's session and revocation never reaches another account

A session is valid only before its exact expiry and only while it exists.
Sign-out deletes the caller's session. Revocation by ID deletes a session of
the caller's own account, the caller's included; an ID of another account
or an unknown ID changes nothing. No page shows a session list, but
`GET /api/v1/points/sessions` answers a live session with its own account's
unexpired sessions (`id`, the first 24 hexadecimal characters of the token
hash; `expiresAt`; and `current`, whether it is the caller's), newest expiry
first; it only reads, and a missing or expired session gets 401
`not_signed_in` or `session_expired` as the other session routes do. The hourly identity job deletes expired sessions and expired
X flows with the identity rows.

```quint
pure def canSignOut(s: Accounts, by: int): bool = senderActor(s, by) > 0
pure def signOut(s: Accounts, by: int): Accounts = { ...s, sessions: s.sessions.select(x => x.id != by) }
pure def canRevokeSession(s: Accounts, by: int, target: int): bool = senderActor(s, by) > 0 and target > 0
pure def revokeSession(s: Accounts, by: int, target: int): Accounts =
  { ...s, sessions: s.sessions.select(x => not(x.id == target and x.actor == senderActor(s, by))) }
pure def canAdvanceTime(s: Accounts, by: int, now: int): bool = by == I::workerClock and now >= s.now
pure def advanceTime(s: Accounts, by: int, now: int): Accounts = { ...s, now: now, identity: I::advanceTime(s.identity, by, now) }
pure def canPurgeExpired(s: Accounts, by: int): bool = by == I::identityCron and (s.sessions.some(x => x.expiresAt <= s.now)
  or s.xRegistry.flows.some(f => f.expiresAt <= s.now) or I::canPurgeExpired(s.identity, by))
pure def purgeExpired(s: Accounts, by: int): Accounts =
  { ...s, sessions: s.sessions.select(x => x.expiresAt > s.now), identity: I::purgeExpired(s.identity, by),
    xRegistry: { ...s.xRegistry, flows: s.xRegistry.flows.select(f => f.expiresAt > s.now) } }
pure def stepRevocationStaysInAccount(before: Accounts, via: str, after: Accounts): bool =
  via == "revokeSession" implies before.sessions.select(x => not(after.sessions.includes(x))).length() <= 1
pure def lawRevokeKeepsOtherAccounts(s: Accounts, by: int, target: int): bool =
  canRevokeSession(s, by, target) implies s.sessions.every(x =>
    x.actor != senderActor(s, by) implies revokeSession(s, by, target).sessions.includes(x))
pure def lawSignOutKeepsOtherSessions(s: Accounts, by: int): bool =
  canSignOut(s, by) implies not(sessionLive(signOut(s, by), by))
    and s.sessions.every(x => x.id != by implies signOut(s, by).sessions.includes(x))
```

### Active memberships are public and a hide request is refused

Visibility can only be set to public; `public: false` answers
`public_visibility_required` and changes nothing. Closed accounts are
private.

```quint
pure def canPublishMembership(s: Accounts, by: int, requestPublic: bool): bool = senderActor(s, by) > 0 and requestPublic
pure def publishMembership(s: Accounts, by: int, requestPublic: bool): Accounts =
  { ...s, members: replaceMember(s.members, { ...memberByActor(s, senderActor(s, by)), public: true }) }
pure def alwaysPublicMembershipIsOpen(s: Accounts): bool = s.members.every(m => m.public implies m.membership == Open)
pure def stepActiveMembershipNeverHidden(before: Accounts, after: Accounts): bool = before.members.every(m =>
  (m.public and memberByActor(after, m.actor).membership == Open) implies memberByActor(after, m.actor).public)
```

### Public reads show only public open members and never publish anything

The people directory lists exactly the public members; its order and
25-row paging are the shell's presentation of that set. A member lookup by login answers a member only when exactly one member has
that login (compared case-insensitively by the shell) and that member is
public; a login collision fails closed. The public X profile read needs both
the link and the membership to be public. These reads change no state.

```quint
pure def publicPeople(s: Accounts): List[Member] = s.members.select(m => m.public)
pure def memberLookup(s: Accounts, login: str): List[Member] =
  val matches = s.members.select(m => m.login == login)
  if (matches.length() == 1 and matches.every(m => m.public)) matches else List()
pure def publicXProfile(s: Accounts, actor: int): X::XLink =
  val m = memberByActor(s, actor)
  if (m.public and m.xLink.public and m.xLink.xId != "") m.xLink else X::noLink
pure def lawPeopleArePublicAndOpen(s: Accounts): bool =
  alwaysPublicMembershipIsOpen(s) implies publicPeople(s).every(m => m.membership == Open)
pure def lawLoginCollisionFailsClosed(s: Accounts, login: str): bool =
  s.members.select(m => m.login == login).length() > 1 implies memberLookup(s, login).length() == 0
pure def lawClosedMemberHasNoPublicX(s: Accounts, actor: int): bool =
  (alwaysClosedPrivate(s) and memberByActor(s, actor).membership == Closed) implies publicXProfile(s, actor) == X::noLink
pure val loginValues = Set("octo", "newcomer", "nobody")
pure val actorValues = Set(1101, 2201, 0)
```

## Story: Close and reopen an account without losing history

> As a member, I want to close my account and make it private, without
> losing what I am owed or my reserved identities.

### Confirmed closure ends every session, hides the membership, disconnects X and withdraws both email consents

The person types their current GitHub login; the shell folds ASCII case on
both sides. One atomic batch closes and hides the membership, deletes the
member's X flows and link and any historical Telegram link, withdraws both
email consents and clears the consent version, cancels pending email
verifications and deletes every session of the account. X and historical
Telegram reservations, wallet records, obligations, settlement records,
private cases and Points history are untouched. A repeated closure that
raced the first reads back the original closure time.

```quint
pure def canClose(s: Accounts, by: int, confirmation: str): bool =
  senderActor(s, by) > 0 and confirmation != "" and confirmation == memberByActor(s, senderActor(s, by)).login
pure def close(s: Accounts, by: int, confirmation: str): Accounts =
  val m = memberByActor(s, senderActor(s, by))
  { ...s, members: replaceMember(s.members, { ...m, membership: Closed, public: false, closedAt: s.now,
      xLink: X::noLink, telegramLinked: false, email: E::closeEnrollment(m.email) }),
    sessions: s.sessions.select(x => x.actor != m.actor), xRegistry: X::dropActorFlows(s.xRegistry, m.actor),
    inbox: N::closeAccount(s.inbox, N::accountService, E::closeEnrollment(m.email)) }
pure def alwaysClosedPrivate(s: Accounts): bool = s.members.every(m => if (m.membership == Closed)
    not(m.public) and m.xLink == X::noLink and not(m.telegramLinked) and m.closedAt > 0
      and not(m.email.preference.activity) and not(m.email.preference.security)
      and m.email.verifications.every(v => v.consumed or v.cancelled)
      and not(s.sessions.some(x => x.actor == m.actor)) and not(s.xRegistry.flows.some(f => f.actor == m.actor))
    else m.closedAt == 0)
pure def stepClosureCancelsWaitingMail(before: Accounts, after: Accounts): bool = after.members.every(m =>
  (m.membership == Closed and memberByActor(before, m.actor).membership == Open) implies
    N::noWaitingMail(after.inbox, m.githubId))
pure def stepClosedAtStable(before: Accounts, after: Accounts): bool = before.members.every(m =>
  (m.membership == Closed and memberByActor(after, m.actor).membership == Closed) implies memberByActor(after, m.actor).closedAt == m.closedAt)
pure def lawClosureInvalidatesEverySession(s: Accounts, by: int, confirmation: str, other: int): bool =
  (canClose(s, by, confirmation) and senderActor(s, other) == senderActor(s, by)) implies senderActor(close(s, by, confirmation), other) == 0
```

### Telegram stays retired and historical participation awards stay frozen

Telegram has no bot, connection, profile link or support route. Historical
Telegram reservations are kept and nothing adds to them; closure removes a
historical link. No welcome or X-connection points are granted from
24 October 2026: a membership shows its fixed welcome award only if it
joined before then, and only X awards recorded before then count. Awards
recorded before that date are never rewritten.

```quint
pure def stepTelegramFrozen(before: Accounts, after: Accounts): bool =
  after.telegramClaims == before.telegramClaims
    and after.members.every(m => m.telegramLinked implies memberByActor(before, m.actor).telegramLinked)
```

## Story: Connect an optional public X profile

> As a member, I want to show my X profile after proving I control it.

### The X flow is started by a live session and committed only while that session lives

Starting needs a live session and a configured X client; it replaces the
member's earlier flows. The callback claims the flow only while its
originating session is live. The commit rechecks the session at the
verification time, reserves the ID to this member if it is free, and writes
the public link with the username and verification time. Only the X callback
handler, after its own exchange with X, commits or fails a flow. A cancel, a failed
exchange, a storage failure, a dead session or another member's reservation
ends the flow and keeps the previous link. Disconnect deletes the link and
the member's flows and keeps the reservation; reconnecting needs OAuth
again. A link cannot be hidden.

```quint
pure def canStartX(s: Accounts, by: int): bool = senderActor(s, by) > 0 and s.xConfigured
pure def startX(s: Accounts, by: int): Accounts = { ...s, xRegistry: X::startX(s.xRegistry, s.now, senderActor(s, by), by) }
pure def canClaimXCallback(s: Accounts, flowId: int, browserCap: int): bool =
  val f = X::xFlowById(s.xRegistry, flowId)
  X::canClaimX(s.xRegistry, s.now, flowId, browserCap, liveSessionOf(s, f.session, f.actor))
pure def claimXCallback(s: Accounts, flowId: int, browserCap: int): Accounts = { ...s, xRegistry: X::claimX(s.xRegistry, flowId) }
pure def canCommitX(s: Accounts, by: int, flowId: int, xIdentity: X::XProviderIdentity): bool =
  val f = X::xFlowById(s.xRegistry, flowId)
  by == xCallback and X::canCommitX(s.xRegistry, flowId, xIdentity, liveSessionOf(s, f.session, f.actor), f.actor)
pure def commitX(s: Accounts, by: int, flowId: int, xIdentity: X::XProviderIdentity): Accounts =
  val f = X::xFlowById(s.xRegistry, flowId)
  { ...s, xRegistry: X::commitClaims(s.xRegistry, s.now, flowId, xIdentity, f.actor),
    members: replaceMember(s.members, { ...memberByActor(s, f.actor), xLink: X::committedLink(s.now, xIdentity) }) }
pure def canFailX(s: Accounts, by: int, flowId: int): bool =
  by == xCallback and flowId > 0 and X::xFlowById(s.xRegistry, flowId).status == X::XProcessing
pure def failX(s: Accounts, by: int, flowId: int): Accounts = { ...s, xRegistry: X::endXFlow(s.xRegistry, flowId) }
pure def canDisconnectX(s: Accounts, by: int): bool = senderActor(s, by) > 0
pure def disconnectX(s: Accounts, by: int): Accounts =
  val m = memberByActor(s, senderActor(s, by))
  { ...s, members: replaceMember(s.members, { ...m, xLink: X::noLink }), xRegistry: X::dropActorFlows(s.xRegistry, m.actor) }
pure def canPublishX(s: Accounts, by: int): bool = senderActor(s, by) > 0 and memberByActor(s, senderActor(s, by)).xLink.xId != ""
pure def publishX(s: Accounts, by: int): Accounts =
  val m = memberByActor(s, senderActor(s, by))
  { ...s, members: replaceMember(s.members, { ...m, xLink: { ...m.xLink, public: true } }) }
pure def alwaysXRegistryValid(s: Accounts): bool = X::registryWellFormed(s.xRegistry, s.now)
  and s.xRegistry.flows.every(f => s.members.some(m => m.actor == f.actor and m.membership == Open))
pure def alwaysXLinkReserved(s: Accounts): bool = s.members.every(m => m.xLink.xId != "" implies
  X::claimOwner(s.xRegistry, m.xLink.xId) == m.actor and m.xLink.username != "" and m.xLink.verifiedAt > 0
    and m.membership == Open)
pure def alwaysXLinkPublicWhenRecent(s: Accounts): bool = s.members.every(m =>
  (m.xLink.xId != "" and m.xLink.verifiedAt >= launchClock) implies m.xLink.public)
pure def stepXReservationsPermanent(before: Accounts, after: Accounts): bool = X::claimsPermanent(before.xRegistry, after.xRegistry)
pure def stepXConfersNoOtherAuthority(before: Accounts, via: str, after: Accounts): bool =
  (via == "startX" or via == "claimXCallback" or via == "commitX" or via == "failX" or via == "disconnectX" or
    via == "publishX") implies (after.sessions == before.sessions and after.identity == before.identity and
    after.inbox == before.inbox and after.xAwards == before.xAwards and
    after.members.every(m => memberByActor(before, m.actor).githubId == m.githubId and
      memberByActor(before, m.actor).membership == m.membership and memberByActor(before, m.actor).email == m.email))
pure def stepFailedXKeepsLink(before: Accounts, via: str, after: Accounts): bool =
  (via == "failX" or via == "claimXCallback" or via == "startX") implies after.members == before.members
```

## Story: Keep mail consent tied to the signed-in account

> As a member, I want email enrollment and consent to change only through my
> own signed-in session, and unsubscribe links to stop mail without giving
> anyone access to my account.

### Email requests, verification and consent changes need a live session of the same account, and the outbox sees each change

The account service supplies the clock, fresh identifiers and the count of
other accounts' recent requests for the same address to the
[email component](./email.md). Unsubscribe uses only its capability. Only
the private mail service (`mailService`) records verification delivery and
issues the unsubscribe capability of each mail it sends. A verification, a
consent save and an unsubscribe hand the committed enrollment to the notice
outbox in the same write, and closure suppresses the account's waiting mail
there, so the outbox never queues or keeps mail on consent the account no
longer has.

```quint
pure def otherAccountsRecent(s: Accounts, githubId: int, addressKey: str): int =
  s.members.select(m => m.githubId != githubId).foldl(0, (sum, m) => sum + E::sameAddressRecent(m.email, s.now, addressKey))
pure def senderMember(s: Accounts, by: int): Member = memberByActor(s, senderActor(s, by))
pure def withEmail(s: Accounts, m: Member, e: E::Enrollment): List[Member] = replaceMember(s.members, { ...m, email: e })
pure def syncMail(e: E::Enrollment, i: N::Inbox): N::Inbox =
  if (N::canObserveEnrollment(i, N::accountService, e)) N::observeEnrollment(i, N::accountService, e) else i
type MailView = { destination: E::Destination, preference: E::Preference, pilot: int }
pure def mailView(e: E::Enrollment): MailView =
  { destination: e.destination, preference: e.preference, pilot: e.pilotVersion }
pure def canRequestEmail(s: Accounts, by: int, requestKey: int, address: str, addressKey: str, activity: bool, security: bool): bool =
  val m = senderMember(s, by)
  senderActor(s, by) > 0 and E::requestOutcome(m.email, s.now, requestKey, address, addressKey, activity, security,
    otherAccountsRecent(s, m.githubId, addressKey), s.mailAvailable) == E::RequestAccepted
pure def requestEmail(s: Accounts, by: int, requestKey: int, address: str, addressKey: str, activity: bool, security: bool): Accounts =
  val m = senderMember(s, by)
  { ...s, lastEmailId: s.lastEmailId + 1,
    members: withEmail(s, m, E::requestVerification(m.email, s.now, s.lastEmailId + 1, requestKey, address, addressKey, activity, security)) }
pure def canMarkEmailDelivery(s: Accounts, by: int, githubId: int, id: int, nextState: E::VerificationDelivery): bool =
  by == mailService and hasGithubMember(s, githubId) and E::canMarkDelivery(memberByGithub(s, githubId).email, s.now, id, nextState)
pure def markEmailDelivery(s: Accounts, by: int, githubId: int, id: int, nextState: E::VerificationDelivery): Accounts =
  val m = memberByGithub(s, githubId)
  { ...s, members: withEmail(s, m, E::markDelivery(m.email, s.now, id, nextState)) }
pure def canVerifyEmail(s: Accounts, by: int, token: int, checkedRevision: int): bool =
  senderActor(s, by) > 0 and E::canVerify(senderMember(s, by).email, s.now, token, checkedRevision)
pure def verifyEmail(s: Accounts, by: int, token: int, checkedRevision: int): Accounts =
  val m = senderMember(s, by)
  val e = E::verify(m.email, s.now, token, s.lastVersion + 1)
  { ...s, lastVersion: s.lastVersion + 1, members: withEmail(s, m, e), inbox: syncMail(e, s.inbox) }
pure def canSetEmailConsent(s: Accounts, by: int, activity: bool, choice: E::SecurityChoice, suppliedVersion: int, checkedRevision: int): bool =
  senderActor(s, by) > 0 and E::consentOutcome(senderMember(s, by).email, activity, choice, suppliedVersion, checkedRevision) == E::ConsentSaved
pure def setEmailConsent(s: Accounts, by: int, activity: bool, choice: E::SecurityChoice, suppliedVersion: int, checkedRevision: int): Accounts =
  val m = senderMember(s, by)
  val e = E::setConsent(m.email, activity, choice, suppliedVersion, checkedRevision)
  { ...s, members: withEmail(s, m, e), inbox: syncMail(e, s.inbox) }
pure def canIssueUnsubscribe(s: Accounts, by: int, githubId: int): bool =
  by == mailService and hasGithubMember(s, githubId) and E::canIssueUnsubscribe(memberByGithub(s, githubId).email, s.lastUnsubscribe + 1)
pure def issueUnsubscribe(s: Accounts, by: int, githubId: int): Accounts =
  val m = memberByGithub(s, githubId)
  { ...s, lastUnsubscribe: s.lastUnsubscribe + 1, members: withEmail(s, m, E::issueUnsubscribe(m.email, s.lastUnsubscribe + 1)) }
pure def unsubscribeHolder(s: Accounts, token: int): Member =
  s.members.select(m => m.email.unsubscribeTokens.some(t => t.token == token)).nthOr(0, absentMember)
pure def canUnsubscribe(s: Accounts, token: int): bool =
  token > 0 and unsubscribeHolder(s, token).actor > 0 and E::canUnsubscribe(unsubscribeHolder(s, token).email, token)
pure def unsubscribe(s: Accounts, token: int): Accounts =
  val m = unsubscribeHolder(s, token)
  val e = E::unsubscribe(m.email, token)
  { ...s, members: withEmail(s, m, e), inbox: syncMail(e, s.inbox) }
pure def alwaysEmailValid(s: Accounts): bool = s.members.every(m => E::wellFormed(m.email, s.now)
  and m.email.verifications.every(v => v.id <= s.lastEmailId
    and s.members.every(o => o.githubId == m.githubId or not(o.email.verifications.some(w => w.id == v.id))))
  and m.email.unsubscribeTokens.every(t => t.token <= s.lastUnsubscribe
    and s.members.every(o => o.githubId == m.githubId or not(o.email.unsubscribeTokens.some(u => u.token == t.token))))
  and m.email.destination.version <= s.lastVersion and m.email.preference.version <= s.lastVersion
  and (m.email.destination.version > 0 implies s.members.every(o => o.githubId == m.githubId
    or o.email.destination.version != m.email.destination.version)))
pure def stepConsentOnlyFromExplicitChoice(before: Accounts, via: str, after: Accounts): bool =
  after.members.every(m => ((m.email.preference.activity and not(memberByActor(before, m.actor).email.preference.activity))
    or (m.email.preference.security and not(memberByActor(before, m.actor).email.preference.security)))
    implies (via == "verifyEmail" or via == "setEmailConsent"))
pure def canSaveNotice(s: Accounts, by: int, key: int, kind: N::Kind, githubId: int): bool =
  by == noticeSource and hasGithubMember(s, githubId) and N::canSave(s.inbox, key, kind, githubId)
pure def saveNotice(s: Accounts, by: int, key: int, kind: N::Kind, githubId: int): Accounts =
  { ...s, inbox: N::save(s.inbox, key, kind, githubId) }
pure def alwaysOutboxSeesCurrentConsent(s: Accounts): bool =
  s.members.every(m => mailView(N::enrollmentOf(s.inbox, m.githubId)) == mailView(m.email))
pure def sometimesClosureSuppressedMail(s: Accounts): bool =
  N::anySuppressed(s.inbox) and s.members.some(m => m.membership == Closed)
pure def stepEmailHistoryRetained(before: Accounts, after: Accounts): bool = before.members.every(m =>
  E::historyRetained(m.email, memberByActor(after, m.actor).email)) and before.lastEmailId <= after.lastEmailId
    and before.lastVersion <= after.lastVersion and before.lastUnsubscribe <= after.lastUnsubscribe
```

### Every account outcome is reachable from the launch state

The launch state holds one legacy member with a private membership, a
private X link, a historical Telegram link, a historical X award and an
activity-pilot destination, plus issued assertions: two web assertions for
that member under a re-spelled node ID, one web assertion for a new GitHub
account and one contributor-session assertion that web sign-in must refuse. The
full identity flow is also reachable through the wrapped identity events:
web sign-in starts from Slop's own page and is polled by the browser that
started it, so the wrapped start carries a browser origin and the wrapped
poll the flow's browser binding ([identity](./identity.md), "A website flow
belongs to the browser that started it").
The sample sets bound simulation only.

```quint
pure def identityStart(s: Accounts, client: int, audience: I::Audience): Accounts =
  { ...s, identity: I::start(s.identity, client, audience, I::Production, true) }
pure def canIdentityStart(s: Accounts, client: int, audience: I::Audience): bool = I::canStart(s.identity, client, audience, I::Production, true)
pure def canIdentityClaimCallback(s: Accounts, oauthState: int, cookie: int): bool = I::canClaimCallback(s.identity, oauthState, cookie)
pure def identityClaimCallback(s: Accounts, oauthState: int, cookie: int): Accounts = { ...s, identity: I::claimCallback(s.identity, oauthState, cookie) }
pure def canIdentityFailCallback(s: Accounts, by: int, flowId: int): bool = I::canFailCallback(s.identity, by, flowId)
pure def identityFailCallback(s: Accounts, by: int, flowId: int): Accounts = { ...s, identity: I::failCallback(s.identity, by, flowId) }
pure def canIdentityCompleteCallback(s: Accounts, by: int, flowId: int, github: I::GitHubIdentity): bool =
  I::canCompleteCallback(s.identity, by, flowId, github)
pure def identityCompleteCallback(s: Accounts, by: int, flowId: int, github: I::GitHubIdentity): Accounts =
  { ...s, identity: I::completeCallback(s.identity, by, flowId, github) }
pure def canIdentityPoll(s: Accounts, client: int, flowId: int, capability: int, audience: I::Audience): bool =
  I::canStoreAssertion(s.identity, client, flowId, capability, audience, true)
    and I::canIssueAssertion(I::storeAssertion(s.identity, client, flowId, capability, audience, true), flowId, capability, audience, true)
pure def identityPoll(s: Accounts, client: int, flowId: int, capability: int, audience: I::Audience): Accounts =
  { ...s, identity: I::issueAssertion(I::storeAssertion(s.identity, client, flowId, capability, audience, true), flowId, capability,
    audience, true) }
pure val launchGithubOld: I::GitHubIdentity = { actor: 11, login: "octo", nodeId: 1102 }
pure val launchGithubNew: I::GitHubIdentity = { actor: 22, login: "newcomer", nodeId: 2201 }
pure val launchIdentity: I::Identity = { now: launchClock, lastFlow: 4, windows: List(),
  flows: List({ id: 1, oauthState: 1, capability: 1, audience: I::PointsWeb, mode: I::Production, status: I::AssertionIssued,
      pkceStored: false, github: launchGithubOld, createdAt: launchClock, expiresAt: launchClock + I::flowLifetime, bound: true },
    { id: 2, oauthState: 2, capability: 2, audience: I::PointsWeb, mode: I::Production, status: I::AssertionIssued,
      pkceStored: false, github: launchGithubNew, createdAt: launchClock, expiresAt: launchClock + I::flowLifetime, bound: true },
    { id: 3, oauthState: 3, capability: 3, audience: I::PointsWeb, mode: I::Production, status: I::AssertionIssued,
      pkceStored: false, github: launchGithubOld, createdAt: launchClock, expiresAt: launchClock + I::flowLifetime, bound: true },
    { id: 4, oauthState: 4, capability: 4, audience: I::PrivateTrace, mode: I::Production, status: I::AssertionIssued,
      pkceStored: false, github: launchGithubNew, createdAt: launchClock, expiresAt: launchClock + I::flowLifetime, bound: false }),
  assertions: List({ token: 1, audience: I::PointsWeb, github: launchGithubOld, createdAt: launchClock,
      expiresAt: launchClock + I::assertionLifetime, consumed: false, consumedAt: 0 },
    { token: 2, audience: I::PointsWeb, github: launchGithubNew, createdAt: launchClock,
      expiresAt: launchClock + I::assertionLifetime, consumed: false, consumedAt: 0 },
    { token: 3, audience: I::PointsWeb, github: launchGithubOld, createdAt: launchClock,
      expiresAt: launchClock + I::assertionLifetime, consumed: false, consumedAt: 0 },
    { token: 4, audience: I::PrivateTrace, github: launchGithubNew, createdAt: launchClock,
      expiresAt: launchClock + I::assertionLifetime, consumed: false, consumedAt: 0 }),
  issued: List(1, 2, 3, 4), localDelivered: List(), consumedTokens: List() }
pure val legacyMember: Member = { actor: 1101, githubId: 11, login: "octo", membership: Open, public: false,
  joinedAt: participationPointsEnd - 1000, closedAt: 0,
  xLink: { xId: "123456789012345678901234567890", username: "octo_x", verifiedAt: participationPointsEnd - 900, public: false },
  telegramLinked: true, email: E::newEnrollment(11, 900) }
pure val initial: Accounts = { now: launchClock, identity: launchIdentity, members: List(legacyMember), sessions: List(),
  lastSession: 0, xRegistry: { flows: List(), lastFlow: 0,
    claims: List({ xId: "123456789012345678901234567890", actor: 1101, claimedAt: participationPointsEnd - 900 }) },
  xConfigured: true, mailAvailable: true, telegramClaims: List("tg-legacy"),
  xAwards: List({ actor: 1101, at: participationPointsEnd - 900, points: 10 }), refusedSignIns: List(),
  lastEmailId: 0, lastVersion: 1000, lastUnsubscribe: 0,
  inbox: { ...N::initial, enrollments: List(legacyMember.email) }, ownerSession: 22 }
pure def sometimesLegacyPublished(s: Accounts): bool = memberByActor(s, 1101).public and memberByActor(s, 1101).xLink.public
pure def sometimesStoredActorReused(s: Accounts): bool = s.sessions.some(x => x.actor == 1101)
pure def sometimesTwoSessions(s: Accounts): bool = s.sessions.select(x => x.actor == 1101 and x.expiresAt > s.now).length() >= 2
pure def sometimesNewMemberWithoutWelcome(s: Accounts): bool = s.members.some(m => m.actor == 2201 and welcomeShown(m) == 0)
pure def sometimesClosed(s: Accounts): bool = s.members.some(m => m.membership == Closed)
pure def sometimesClosedSignInRefused(s: Accounts): bool = s.refusedSignIns.length() > 0 and s.members.some(m => m.membership == Closed)
pure def sometimesReopened(s: Accounts): bool =
  memberByActor(s, 1101).membership == Open and not(memberByActor(s, 1101).telegramLinked)
pure def sometimesExpiredSessionKept(s: Accounts): bool = s.sessions.some(x => x.expiresAt <= s.now)
pure def sometimesXConnected(s: Accounts): bool = s.members.some(m => m.actor == 2201 and m.xLink.xId != "")
pure def sometimesXDisconnectedReserved(s: Accounts): bool =
  memberByActor(s, 1101).xLink.xId == "" and X::claimOwner(s.xRegistry, "123456789012345678901234567890") == 1101
pure def sometimesXFlowProcessing(s: Accounts): bool = s.xRegistry.flows.some(f => f.status == X::XProcessing)
pure def sometimesEmailVerified(s: Accounts): bool = s.members.some(m => m.email.destination.version > 1000)
pure def sometimesBothConsent(s: Accounts): bool = s.members.some(m => m.email.preference.activity and m.email.preference.security)
pure def sometimesPilotConsent(s: Accounts): bool = s.members.some(m => m.email.preference.activity and m.email.preference.version == 900)
pure def sometimesUnsubscribed(s: Accounts): bool = s.members.some(m => m.email.unsubscribeTokens.length() > 0
  and not(m.email.preference.activity) and not(m.email.preference.security) and m.email.preference.version > 0)
pure def sometimesDeliveryUnknown(s: Accounts): bool = s.members.some(m => m.email.verifications.some(v => v.delivery == E::DeliveryUnknown))
pure def sometimesFullIdentityFlowSignIn(s: Accounts): bool = s.identity.consumedTokens.some(t => t > 4)
pure val signedOld: Accounts = signIn(initial, 1)
pure val signedBoth: Accounts = signIn(signedOld, 2)
pure val sValues = Set(initial).union(Set(signedOld)).union(Set(signedBoth))
pure val otherValues = Set(0, 1, 2)
pure val requestPublicValues = Set(true, false)
pure val tValues = Set(1, participationPointsEnd - 1, participationPointsEnd, launchClock)
pure val weight_signIn = 10
pure val weight_reopen = 6
pure val weight_close = 6
pure val weight_startX = 5
pure val weight_claimXCallback = 5
pure val weight_commitX = 5
pure val weight_requestEmail = 6
pure val weight_verifyEmail = 6
pure val weight_setEmailConsent = 4
pure val weight_identityStart = 3
pure val weight_identityClaimCallback = 3
pure val weight_identityCompleteCallback = 3
pure val weight_identityPoll = 3
pure val byValues = Set(0, 1, 2, 3, -1, -2, -3, -5, -6, -7)
pure val keyValues = Set(1)
pure val kindValues = Set(N::SecurityCase, N::PayoutHeld)
pure val weight_saveNotice = 4
pure val targetValues = Set(1, 2, 3)
pure val tokenValues = Set(1, 2, 3, 4, 5)
pure val clientValues = Set(1)
pure val oauthStateValues = Set(5, 6)
pure val cookieValues = Set(5, 6)
pure val flowIdValues = Set(1, 2, 5)
pure val capabilityValues = Set(1, 5)
pure val browserCapValues = Set(1, 2, 3)
pure val githubValues = Set(launchGithubOld, { actor: 33, login: "third", nodeId: 3301 })
pure val xIdentityValues = Set({ xId: "777", username: "new_x", wellFormed: true },
  { xId: "123456789012345678901234567890", username: "octo_x", wellFormed: true },
  { xId: "888", username: "", wellFormed: false })
pure val confirmationValues = Set("octo", "newcomer", "wrong")
pure val nowValues = Set(launchClock, launchClock + 60, launchClock + 120, launchClock + 700, launchClock + 3700)
pure val requestKeyValues = Set(1, 2)
pure val addressValues = Set("a@example.test", "b@example.test")
pure val addressKeyValues = Set("ka", "kb")
pure val idValues = Set(1, 2)
pure val githubIdValues = Set(11, 22)
pure val checkedRevisionValues = Set(-1, 0, 1)
pure val suppliedVersionValues = Set(0, 900, 1001)
pure val nextStateValues = Set(E::Sending, E::Sent, E::DeliveryUnknown)
pure val choiceValues = Set(E::KeepSecurity, E::SecurityOn, E::SecurityOff)
```
