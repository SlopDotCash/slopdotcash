# GitHub identity flows and one-time assertions

PRD sections 3 and 9 make GitHub the only login method. The identity Worker
(`workers/identity/handler.ts`, `persistence.ts`, `contracts.ts`,
`rate-limit.ts`, migrations 0002, 0006 and 0108) runs the GitHub
authorization-code flow with PKCE and returns a one-time identity assertion
bound to one audience. Every start and poll request, admitted or refused,
counts in its client's fixed one-minute D1 window (12 starts, 120 polls)
before it is handled. Web sign-in consumes the `slop-points-web` audience
([Accounts](./accounts.md)); the contributor session exchange consumes
`private-trace-api` ([Session exchange](../contributor/sessionExchange.md)).
The local development handoff uses the same flow store but never issues a
production assertion.

This machine is the whole server-side store: flows, assertions and the D1
rate windows. Time is the Worker's trusted clock in seconds.

The authenticated sender `by` matters only for three internal senders, which
the shell establishes from its own code paths, never from a request:
`githubExchange` is the Worker's callback handler after its own GitHub token
exchange and `/user` read, and is the only source of a flow's GitHub
identity or callback failure; `workerClock` advances the trusted clock; and
`identityCron` is the hourly cleanup. Browser and backend requests (start,
callback claim, poll, consume) need no sender: their authority is the state,
cookie, capability or token they present. Model flow,
state, capability and token identifiers stand for random 256-bit values: the
shell stores only their SHA-256 digests and compares in constant time. The
token of a production flow is derived deterministically from that flow, so
the model uses the flow ID as the token.

External shell obligations, not modeled here: HTTPS-only routing; the fixed
public origin and callback; the `__Host-` state cookie attributes; PKCE
verifier encryption with flow-bound associated data; the GitHub token
exchange and `/user` read; clearing the access token; the approximate edge
rate-limit shield in front of the D1 counters; and the 503 answer when
either limiter fails, which handles nothing.

## Story: Start and complete a GitHub sign-in flow

> As a person signing in to Slop, I want GitHub to prove who I am exactly
> once, so that nobody can reuse my sign-in or redirect it elsewhere.

### A flow starts pending, carries its audience and mode, and expires after five minutes

A start names one audience. The launch sample starts with one client whose
start and poll windows are already full, so refusal is reachable in
simulation. The local handoff is restricted to the web
audience and an exact loopback return origin, which the shell checks. Flow
IDs are issued in order and never reused. The PKCE verifier is stored only
while the flow is pending.

```quint
type Audience = PointsWeb | PrivateTrace
type FlowMode = Production | LocalHandoff
type FlowStatus = Pending | CallbackProcessing | CallbackComplete | AssertionIssued | CallbackFailed
type GitHubIdentity = { actor: int, login: str, nodeId: int }
type Flow = { id: int, oauthState: int, capability: int, audience: Audience, mode: FlowMode,
  status: FlowStatus, pkceStored: bool, github: GitHubIdentity, createdAt: int, expiresAt: int }
type Assertion = { token: int, audience: Audience, github: GitHubIdentity,
  createdAt: int, expiresAt: int, consumed: bool, consumedAt: int }
type RateScope = StartScope | PollScope
type RateWindow = { client: int, scope: RateScope, count: int, expiresAt: int }
pure val githubExchange = -1
pure val workerClock = -2
pure val identityCron = -3
type Identity = { now: int, flows: List[Flow], assertions: List[Assertion], windows: List[RateWindow],
  lastFlow: int, issued: List[int], localDelivered: List[int], consumedTokens: List[int] }
pure val flowLifetime = 300
pure val assertionLifetime = 90
pure val rateWindow = 60
pure val startLimit = 12
pure val pollLimit = 120
pure val noGitHub: GitHubIdentity = { actor: 0, login: "", nodeId: 0 }
pure val absentFlow: Flow = { id: 0, oauthState: 0, capability: 0, audience: PointsWeb, mode: Production,
  status: CallbackFailed, pkceStored: false, github: noGitHub, createdAt: 0, expiresAt: 0 }
pure val absentAssertion: Assertion = { token: 0, audience: PointsWeb, github: noGitHub,
  createdAt: 0, expiresAt: 0, consumed: true, consumedAt: 0 }
pure val initial: Identity = { now: 0, flows: List(), assertions: List(),
  windows: List({ client: 2, scope: StartScope, count: startLimit, expiresAt: rateWindow },
    { client: 2, scope: PollScope, count: pollLimit, expiresAt: rateWindow }),
  lastFlow: 0, issued: List(), localDelivered: List(), consumedTokens: List() }
pure def flowById(s: Identity, flowId: int): Flow =
  s.flows.select(f => f.id == flowId).nthOr(0, absentFlow)
pure def hasFlow(s: Identity, flowId: int): bool = s.flows.some(f => f.id == flowId)
pure def assertionFor(s: Identity, token: int): Assertion =
  s.assertions.select(a => a.token == token).nthOr(0, absentAssertion)
pure def hasAssertion(s: Identity, token: int): bool = s.assertions.some(a => a.token == token)
pure def replaceFlow(flows: List[Flow], changed: Flow): List[Flow] =
  flows.listMap(f => if (f.id == changed.id) changed else f)
pure def live(s: Identity, f: Flow): bool = f.id > 0 and s.now < f.expiresAt
pure def limitOf(scope: RateScope): int = if (scope == StartScope) startLimit else pollLimit
pure def windowOf(s: Identity, client: int, scope: RateScope): RateWindow =
  s.windows.select(w => w.client == client and w.scope == scope)
    .nthOr(0, { client: client, scope: scope, count: 0, expiresAt: 0 })
pure def nextWindow(w: RateWindow, now: int): RateWindow =
  if (w.expiresAt <= now) { ...w, count: 1, expiresAt: now + rateWindow } else { ...w, count: w.count + 1 }
pure def countRequest(s: Identity, client: int, scope: RateScope): List[RateWindow] =
  val counted = nextWindow(windowOf(s, client, scope), s.now)
  s.windows.select(w => not(w.client == client and w.scope == scope)).append(counted)
pure def admitted(s: Identity, client: int, scope: RateScope): bool =
  nextWindow(windowOf(s, client, scope), s.now).count <= limitOf(scope)
pure def canStart(s: Identity, client: int, audience: Audience, mode: FlowMode): bool =
  client > 0 and admitted(s, client, StartScope) and (mode == LocalHandoff implies audience == PointsWeb)
pure def start(s: Identity, client: int, audience: Audience, mode: FlowMode): Identity =
  val id = s.lastFlow + 1
  { ...s, windows: countRequest(s, client, StartScope), lastFlow: id,
    flows: s.flows.append({ id: id, oauthState: id, capability: id, audience: audience, mode: mode,
      status: Pending, pkceStored: true, github: noGitHub, createdAt: s.now, expiresAt: s.now + flowLifetime }) }
pure def canStartStorageFailed(s: Identity, client: int): bool = client > 0 and admitted(s, client, StartScope)
pure def startStorageFailed(s: Identity, client: int): Identity =
  { ...s, windows: countRequest(s, client, StartScope) }
pure def canRefuseRateLimited(s: Identity, client: int, scope: RateScope): bool =
  client > 0 and not(admitted(s, client, scope))
pure def refuseRateLimited(s: Identity, client: int, scope: RateScope): Identity =
  { ...s, windows: countRequest(s, client, scope) }
pure def alwaysFlowsWellFormed(s: Identity): bool = s.lastFlow >= 0 and s.now >= 0 and s.flows.every(f =>
  f.id > 0 and f.id <= s.lastFlow and f.oauthState == f.id and f.capability == f.id
    and f.expiresAt == f.createdAt + flowLifetime and f.createdAt >= 0 and f.createdAt <= s.now
    and (f.mode == LocalHandoff implies f.audience == PointsWeb))
pure def alwaysFlowIdsUnique(s: Identity): bool = s.flows.every(f => s.flows.select(g => g.id == f.id).length() == 1)
pure def alwaysRateWindowsCounted(s: Identity): bool = s.windows.every(w => w.count >= 1 and w.client > 0
  and s.windows.select(o => o.client == w.client and o.scope == w.scope).length() == 1)
pure def lawFullWindowRefusesUntilItExpires(w: RateWindow, now: int): bool =
  ((w.count >= limitOf(w.scope) and w.expiresAt > now) implies nextWindow(w, now).count > limitOf(w.scope))
    and (w.expiresAt <= now implies nextWindow(w, now).count == 1)
```

### The callback claims a pending flow once and clears its verifier before contacting GitHub

The callback carries GitHub's `state` and the browser's state cookie; both
must be equal and must name a live pending flow. The single conditional
update moves the flow to processing and clears the stored verifier, so a
replayed callback finds nothing to claim. Any later failure ends the flow:
GitHub's `error` parameter, a verifier that cannot be decrypted, a failed
token exchange, no identity, a web identity without a node ID, or expiry
while GitHub answered. Only a processing flow can fail, and only the
callback handler's own exchange completes or fails it. A failed token
exchange or user read logs one structured `github_identity_failed` record
with its stage (`token` or `user`), a fixed reason (`http-rejected`,
`invalid-response` or `request-or-response-failed`), the HTTP status when
known and GitHub's OAuth error code only when it is one of
`incorrect_client_credentials`, `redirect_uri_mismatch`,
`bad_verification_code`, `unverified_user_email`, `access_denied`,
`unsupported_grant_type`, `server_error` or `temporarily_unavailable`; never
the code, verifier, tokens, secrets, error descriptions or response bodies
(Slop development `6ec8e3dfd`, `workers/identity/index.ts:215–251`; shell
obligation).

```quint
pure def flowByState(s: Identity, oauthState: int): Flow = s.flows.select(f => f.oauthState == oauthState).nthOr(0, absentFlow)
pure def canClaimCallback(s: Identity, oauthState: int, cookie: int): bool =
  val f = flowByState(s, oauthState)
  oauthState > 0 and cookie == oauthState and f.status == Pending and live(s, f)
pure def claimCallback(s: Identity, oauthState: int, cookie: int): Identity =
  val f = flowByState(s, oauthState)
  { ...s, flows: replaceFlow(s.flows, { ...f, status: CallbackProcessing, pkceStored: false }) }
pure def canFailCallback(s: Identity, by: int, flowId: int): bool =
  by == githubExchange and flowById(s, flowId).status == CallbackProcessing and flowId > 0
pure def failCallback(s: Identity, by: int, flowId: int): Identity =
  { ...s, flows: replaceFlow(s.flows, { ...flowById(s, flowId), status: CallbackFailed }) }
pure def identityComplete(f: Flow, github: GitHubIdentity): bool =
  github.actor > 0 and github.login != "" and ((f.audience == PointsWeb or f.mode == LocalHandoff) implies github.nodeId > 0)
pure def canCompleteCallback(s: Identity, by: int, flowId: int, github: GitHubIdentity): bool =
  val f = flowById(s, flowId)
  by == githubExchange and flowId > 0 and f.status == CallbackProcessing and live(s, f) and identityComplete(f, github)
pure def completeCallback(s: Identity, by: int, flowId: int, github: GitHubIdentity): Identity =
  { ...s, flows: replaceFlow(s.flows, { ...flowById(s, flowId), status: CallbackComplete, github: github }) }
pure def alwaysVerifierOnlyWhilePending(s: Identity): bool = s.flows.every(f => f.pkceStored iff f.status == Pending)
pure def alwaysIdentityAfterCallback(s: Identity): bool = s.flows.every(f =>
  ((f.status == CallbackComplete or f.status == AssertionIssued) iff f.github.actor > 0)
    and ((f.status == CallbackComplete or f.status == AssertionIssued) implies identityComplete(f, f.github)))
```

### At most one poll receives the flow's identity

A poll names the flow, its capability and its audience. Production and local
flows answer only their own poll route. Before the callback completes, a
poll is told to wait. An unknown or expired flow, a wrong capability and a
wrong audience all answer the same `flow_unavailable`; a poll on the other
route answers `wrong_flow`; a failed callback answers `callback_failed` and a
used flow `flow_consumed`. Every poll first counts in its client's poll
window; an over-limit poll is refused (`refuseRateLimited`) and handled no
further.
A production poll first stores the flow's one deterministic assertion. The
insert itself requires the parent flow to be callback-complete, so a delayed
poll cannot recreate the token after it was issued and purged. The stored
row must be unconsumed and unexpired. A separate conditional update then
marks the flow issued, and only the poll whose update wins returns the
assertion. A local poll returns the identity to the local backend once and
creates no assertion.

```quint
type PollOutcome = PollUnavailable | PollWrongMode | PollPending | PollCallbackFailed | PollConsumed | PollReady
pure def pollOutcome(s: Identity, flowId: int, capability: int, audience: Audience, localRoute: bool): PollOutcome =
  val f = flowById(s, flowId)
  if (not(live(s, f)) or f.capability != capability or f.audience != audience) PollUnavailable
  else if ((f.mode == LocalHandoff) != localRoute) PollWrongMode
  else if (f.status == Pending or f.status == CallbackProcessing) PollPending
  else if (f.status == CallbackFailed) PollCallbackFailed
  else if (f.status == AssertionIssued) PollConsumed
  else PollReady
pure def canPollAnswered(s: Identity, client: int, flowId: int, capability: int, audience: Audience, localRoute: bool): bool =
  client > 0 and admitted(s, client, PollScope) and pollOutcome(s, flowId, capability, audience, localRoute) != PollReady
pure def pollAnswered(s: Identity, client: int, flowId: int, capability: int, audience: Audience, localRoute: bool): Identity =
  { ...s, windows: countRequest(s, client, PollScope) }
pure def canStoreAssertion(s: Identity, client: int, flowId: int, capability: int, audience: Audience): bool =
  val row = assertionFor(s, flowId)
  client > 0 and admitted(s, client, PollScope) and pollOutcome(s, flowId, capability, audience, false) == PollReady
    and (hasAssertion(s, flowId) implies not(row.consumed) and s.now < row.expiresAt)
pure def storeAssertion(s: Identity, client: int, flowId: int, capability: int, audience: Audience): Identity =
  val f = flowById(s, flowId)
  if (hasAssertion(s, flowId)) { ...s, windows: countRequest(s, client, PollScope) } else
    { ...s, windows: countRequest(s, client, PollScope), assertions: s.assertions.append({ token: flowId, audience: f.audience, github: f.github,
      createdAt: s.now, expiresAt: s.now + assertionLifetime, consumed: false, consumedAt: 0 }) }
pure def canIssueAssertion(s: Identity, flowId: int, capability: int, audience: Audience): bool =
  val row = assertionFor(s, flowId)
  pollOutcome(s, flowId, capability, audience, false) == PollReady and hasAssertion(s, flowId)
    and not(row.consumed) and s.now < row.expiresAt
pure def issueAssertion(s: Identity, flowId: int, capability: int, audience: Audience): Identity =
  { ...s, flows: replaceFlow(s.flows, { ...flowById(s, flowId), status: AssertionIssued }), issued: s.issued.append(flowId) }
pure def canPollLocal(s: Identity, client: int, flowId: int, capability: int): bool =
  client > 0 and admitted(s, client, PollScope) and pollOutcome(s, flowId, capability, PointsWeb, true) == PollReady
pure def pollLocal(s: Identity, client: int, flowId: int, capability: int): Identity =
  { ...s, windows: countRequest(s, client, PollScope), flows: replaceFlow(s.flows, { ...flowById(s, flowId), status: AssertionIssued }),
    localDelivered: s.localDelivered.append(flowId) }
pure def alwaysIssuedOnce(s: Identity): bool =
  s.issued.every(id => s.issued.select(x => x == id).length() == 1 and not(s.localDelivered.includes(id)))
    and s.localDelivered.every(id => s.localDelivered.select(x => x == id).length() == 1)
pure def alwaysIssuedFlowsClosed(s: Identity): bool = s.flows.every(f =>
  (s.issued.includes(f.id) or s.localDelivered.includes(f.id)) iff f.status == AssertionIssued)
pure def alwaysOneAssertionPerFlow(s: Identity): bool = s.assertions.every(a =>
  a.token > 0 and a.token <= s.lastFlow and s.assertions.select(b => b.token == a.token).length() == 1
    and a.expiresAt == a.createdAt + assertionLifetime and a.createdAt <= s.now and a.github.actor > 0
    and (a.audience == PointsWeb implies a.github.nodeId > 0))
pure def alwaysLocalFlowsHaveNoAssertion(s: Identity): bool = s.flows.every(f =>
  f.mode == LocalHandoff implies not(hasAssertion(s, f.id)) and not(s.issued.includes(f.id)))
pure def alwaysAssertionsMatchTheirFlow(s: Identity): bool = s.flows.every(f => hasAssertion(s, f.id) implies
  assertionFor(s, f.id).github == f.github and assertionFor(s, f.id).audience == f.audience
    and (f.status == CallbackComplete or f.status == AssertionIssued))
pure def lawPendingFlowIsNotReady(s: Identity, flowId: int, capability: int, audience: Audience): bool =
  (flowById(s, flowId).status == Pending or flowById(s, flowId).status == CallbackProcessing)
    implies pollOutcome(s, flowId, capability, audience, false) != PollReady
```

### The assertion is consumed atomically by its own audience before it expires

Consumption is one conditional update on the token digest, the audience,
an empty consumption mark and the expiry. It returns the GitHub actor ID,
login and node ID. A wrong audience, a used token, an unknown token and an
expired token all answer 401 and change nothing. Consumers map that answer
to their own refusal; an unavailable Worker is a separate 503.

```quint
type ConsumeOutcome = ConsumedIdentity | AssertionRefused
pure def consumeOutcome(s: Identity, token: int, audience: Audience): ConsumeOutcome =
  val a = assertionFor(s, token)
  if (hasAssertion(s, token) and token > 0 and s.issued.includes(token) and a.audience == audience and not(a.consumed) and s.now < a.expiresAt)
    ConsumedIdentity else AssertionRefused
pure def canConsume(s: Identity, token: int, audience: Audience): bool = consumeOutcome(s, token, audience) == ConsumedIdentity
pure def consume(s: Identity, token: int, audience: Audience): Identity =
  { ...s, assertions: s.assertions.listMap(a => if (a.token == token) { ...a, consumed: true, consumedAt: s.now } else a),
    consumedTokens: s.consumedTokens.append(token) }
pure def consumedIdentity(s: Identity, token: int): GitHubIdentity = assertionFor(s, token).github
pure def alwaysConsumedOnce(s: Identity): bool =
  s.consumedTokens.every(t => s.consumedTokens.select(x => x == t).length() == 1 and s.issued.includes(t))
    and s.assertions.every(a => a.consumed iff s.consumedTokens.includes(a.token))
pure def alwaysConsumedBeforeExpiry(s: Identity): bool = s.assertions.every(a =>
  a.consumed implies a.consumedAt >= a.createdAt and a.consumedAt < a.expiresAt)
pure def lawWrongAudienceRefused(s: Identity, token: int): bool =
  consumeOutcome(s, token, PointsWeb) == ConsumedIdentity implies consumeOutcome(s, token, PrivateTrace) == AssertionRefused
pure def lawConsumedTokenCannotBeReused(s: Identity, token: int, audience: Audience): bool =
  canConsume(s, token, audience) implies not(canConsume(consume(s, token, audience), token, audience))
```

### Time advances and the hourly job removes only expired rows

The scheduled cleanup deletes expired flows, assertions and rate windows.
It never touches live flows. Removing an issued flow's row does not let a
delayed poll recreate its assertion: the poll needs the parent flow.

```quint
pure def canAdvanceTime(s: Identity, by: int, now: int): bool = by == workerClock and now >= s.now
pure def advanceTime(s: Identity, by: int, now: int): Identity = { ...s, now: now }
pure def canPurgeExpired(s: Identity, by: int): bool = by == identityCron and (
  s.flows.some(f => f.expiresAt <= s.now) or s.assertions.some(a => a.expiresAt <= s.now)
    or s.windows.some(w => w.expiresAt <= s.now))
pure def purgeExpired(s: Identity, by: int): Identity =
  { ...s, flows: s.flows.select(f => f.expiresAt > s.now), assertions: s.assertions.select(a => a.expiresAt > s.now),
    windows: s.windows.select(w => w.expiresAt > s.now) }
pure def movedForward(f: FlowStatus, g: FlowStatus): bool = g == f
  or (f == Pending and g == CallbackProcessing)
  or (f == CallbackProcessing and (g == CallbackComplete or g == CallbackFailed))
  or (f == CallbackComplete and g == AssertionIssued)
pure def stepFlowsMoveForward(before: Identity, after: Identity): bool = before.flows.every(f =>
  not(hasFlow(after, f.id)) or movedForward(f.status, flowById(after, f.id).status))
pure def stepPurgeKeepsLiveFlows(before: Identity, after: Identity): bool =
  before.flows.every(f => f.expiresAt > after.now implies hasFlow(after, f.id))
pure def stepDeliveryHistoryRetained(before: Identity, after: Identity): bool =
  before.issued.every(i => after.issued.includes(i)) and before.localDelivered.every(i => after.localDelivered.includes(i))
    and before.consumedTokens.every(t => after.consumedTokens.includes(t)) and before.lastFlow <= after.lastFlow
    and before.now <= after.now
pure def stepNoAssertionWithoutCompleteParent(before: Identity, after: Identity): bool =
  after.assertions.every(a => hasAssertion(before, a.token) or flowById(before, a.token).status == CallbackComplete)
```

### Every sign-in outcome is reachable

```quint
pure def sometimesIssued(s: Identity): bool = s.issued.length() > 0
pure def sometimesConsumed(s: Identity): bool = s.consumedTokens.length() > 0
pure def sometimesCallbackFailed(s: Identity): bool = s.flows.some(f => f.status == CallbackFailed)
pure def sometimesLocalDelivered(s: Identity): bool = s.localDelivered.length() > 0
pure def sometimesAssertionExpiredUnused(s: Identity): bool = s.assertions.some(a => not(a.consumed) and a.expiresAt <= s.now)
pure def sometimesIssuedFlowPurged(s: Identity): bool = s.issued.some(id => not(hasFlow(s, id)))
pure def sometimesExpiredPendingFlow(s: Identity): bool = s.flows.some(f => f.status == Pending and f.expiresAt <= s.now)
pure def leadsToCallbackSettles(s: Identity, later: Identity): bool =
  flowById(s, 1).status == CallbackProcessing implies flowById(later, 1).status != CallbackProcessing
pure val fair_failCallback = "weak"
pure val sampleStarted: Identity = start(initial, 1, PointsWeb, Production)
pure val sampleComplete: Identity = completeCallback(claimCallback(sampleStarted, 1, 1), githubExchange, 1, { actor: 7, login: "octo", nodeId: 70 })
pure val sampleIssued: Identity = issueAssertion(storeAssertion(sampleComplete, 1, 1, 1, PointsWeb), 1, 1, PointsWeb)
pure val sValues = Set(initial).union(Set(sampleStarted)).union(Set(sampleComplete)).union(Set(sampleIssued))
pure val audienceValues = Set(PointsWeb, PrivateTrace)
pure val wValues = Set({ client: 2, scope: StartScope, count: 12, expiresAt: 60 }, { client: 2, scope: PollScope, count: 3, expiresAt: 60 },
  { client: 1, scope: StartScope, count: 1, expiresAt: 0 })
pure val clientValues = Set(1, 2)
pure val flowIdValues = Set(1, 2, 3)
pure val tokenValues = Set(0, 1, 2, 3)
pure val oauthStateValues = Set(1, 2, 3)
pure val cookieValues = Set(1, 2, 9)
pure val capabilityValues = Set(1, 2, 9)
pure val nowValues = Set(0, 30, 89, 90, 120, 299, 300, 400, 3700)
pure val githubValues = Set({ actor: 7, login: "octo", nodeId: 70 }, { actor: 7, login: "octo", nodeId: 0 },
  { actor: 8, login: "other", nodeId: 80 }, { actor: 0, login: "", nodeId: 0 })
pure val byValues = Set(githubExchange, workerClock, identityCron, 0)
pure val localRouteValues = Set(true, false)
pure val weight_start = 6
pure val weight_claimCallback = 6
pure val weight_completeCallback = 6
pure val weight_storeAssertion = 6
pure val weight_issueAssertion = 6
pure val weight_consume = 6
```
