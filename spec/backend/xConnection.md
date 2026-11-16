# Optional X profile connection

PRD section 3 ("Public membership and optional X connection") and the pinned
`backend/points/x.ts`, migrations 0008 and 0015, and the retained
`api_x_connection` model. This component holds the X connection flow, the
permanent X ID reservation registry and the link each member shows. It has
no state of its own: the [account service](./accounts.md) holds one registry
for all members, supplies the trusted clock in seconds and checks the rules
here on every step.

The OAuth adapter exchanges the code with X using PKCE and reads
`/2/users/me` with the temporary token. It then deletes the flow and revokes
the token in a `finally` block; a failed revocation never undoes a verified
link and no token is retained. An X ID is a decimal string of 1–30 digits
(it can exceed the JavaScript safe integer range) and a username is 1–15
ASCII letters, digits or underscores. The account service's X callback
handler, after its own exchange, parses the provider's answer against those
patterns and fills `XProviderIdentity.wellFormed`; it is the only sender of
the commit and failure events ([Accounts](./accounts.md), `xCallback`), so
the provider answer is the only source of the ID and an entered handle
cannot create a link. A connection grants no Points, posting, messaging or other
authority.

## Story: Connect an X profile to a member's public profile

> As a member, I want to show my X profile by proving I control it, without
> anyone else ever claiming that X account.

### A start replaces the member's earlier flows and binds the originating session

The flow lives ten minutes and is bound to the session that started it and
to a per-state browser cookie. Starting deletes every earlier flow of the
same member and every expired flow.

```quint
type XFlowStatus = XPending | XProcessing
type XFlow = { id: int, actor: int, session: int, browserCap: int, status: XFlowStatus, expiresAt: int }
type XLink = { xId: str, username: str, verifiedAt: int, public: bool }
type XClaim = { xId: str, actor: int, claimedAt: int }
type XProviderIdentity = { xId: str, username: str, wellFormed: bool }
type XRegistry = { flows: List[XFlow], claims: List[XClaim], lastFlow: int }
pure val xFlowLifetime = 10 * 60
pure val noLink: XLink = { xId: "", username: "", verifiedAt: 0, public: false }
pure val emptyXRegistry: XRegistry = { flows: List(), claims: List(), lastFlow: 0 }
pure val absentXFlow: XFlow = { id: 0, actor: 0, session: 0, browserCap: 0, status: XPending, expiresAt: 0 }
pure def xFlowById(r: XRegistry, flowId: int): XFlow = r.flows.select(f => f.id == flowId).nthOr(0, absentXFlow)
pure def startX(r: XRegistry, now: int, actor: int, session: int): XRegistry =
  val id = r.lastFlow + 1
  { ...r, lastFlow: id, flows: r.flows.select(f => f.actor != actor and f.expiresAt > now)
    .append({ id: id, actor: actor, session: session, browserCap: id, status: XPending, expiresAt: now + xFlowLifetime }) }
pure def claimOwner(r: XRegistry, xId: str): int = r.claims.select(c => c.xId == xId).nthOr(0, { xId: "", actor: 0, claimedAt: 0 }).actor
pure def lawStartReplacesEarlierFlows(r: XRegistry, now: int, actor: int, session: int): bool =
  startX(r, now, actor, session).flows.select(f => f.actor == actor).length() == 1
```

### The callback claims one live pending flow whose originating session is still live

The callback's `state` names the flow and its cookie must carry that flow's
browser capability. The service passes whether the originating session is
still live at the claim; a disconnect or sign-out before the callback
leaves nothing to claim. A replayed or reordered callback finds no pending
flow.

```quint
pure def canClaimX(r: XRegistry, now: int, flowId: int, browserCap: int, sessionLive: bool): bool =
  val f = xFlowById(r, flowId)
  flowId > 0 and f.status == XPending and f.browserCap == browserCap and now < f.expiresAt and sessionLive
pure def claimX(r: XRegistry, flowId: int): XRegistry =
  { ...r, flows: r.flows.listMap(f => if (f.id == flowId) { ...f, status: XProcessing } else f) }
```

### The verified X ID is reserved forever to the first GitHub identity that links it

The link and its reservation commit together only while the flow is still
processing and its originating session is live at the verification time.
The reservation is inserted only if the ID is free; the link is written
only if the reservation belongs to this member. Every outcome deletes the
flow: a user cancel, a failed exchange or identity read, a storage failure,
an expired session or an ID reserved by another member leave the existing
link unchanged.

```quint
pure def canCommitX(r: XRegistry, flowId: int, identity: XProviderIdentity, sessionLive: bool, actor: int): bool =
  val f = xFlowById(r, flowId)
  flowId > 0 and f.status == XProcessing and f.actor == actor and sessionLive and identity.wellFormed
    and identity.xId != "" and identity.username != ""
    and (claimOwner(r, identity.xId) == 0 or claimOwner(r, identity.xId) == actor)
pure def commitClaims(r: XRegistry, now: int, flowId: int, identity: XProviderIdentity, actor: int): XRegistry =
  { ...r, flows: r.flows.select(f => f.id != flowId),
    claims: if (claimOwner(r, identity.xId) == 0) r.claims.append({ xId: identity.xId, actor: actor, claimedAt: now }) else r.claims }
pure def committedLink(now: int, identity: XProviderIdentity): XLink =
  { xId: identity.xId, username: identity.username, verifiedAt: now, public: true }
pure def endXFlow(r: XRegistry, flowId: int): XRegistry = { ...r, flows: r.flows.select(f => f.id != flowId) }
pure def dropActorFlows(r: XRegistry, actor: int): XRegistry = { ...r, flows: r.flows.select(f => f.actor != actor) }
pure def lawForeignReservationRefused(r: XRegistry, flowId: int, identity: XProviderIdentity, actor: int): bool =
  (claimOwner(r, identity.xId) != 0 and claimOwner(r, identity.xId) != actor) implies not(canCommitX(r, flowId, identity, true, actor))
pure def lawCommitKeepsEveryReservation(r: XRegistry, now: int, flowId: int, identity: XProviderIdentity, actor: int): bool =
  r.claims.every(c => commitClaims(r, now, flowId, identity, actor).claims.includes(c))
pure def registryWellFormed(r: XRegistry, now: int): bool =
  r.lastFlow >= 0 and r.flows.every(f => f.id > 0 and f.id <= r.lastFlow and f.actor > 0 and f.session > 0
    and f.browserCap == f.id and r.flows.select(g => g.id == f.id).length() == 1
    and r.flows.select(g => g.actor == f.actor).length() == 1)
    and r.claims.every(c => c.xId != "" and c.actor > 0 and r.claims.select(d => d.xId == c.xId).length() == 1)
pure def claimsPermanent(before: XRegistry, after: XRegistry): bool = before.claims.every(c => after.claims.includes(c))
```

### Simulation samples exercise reserved, foreign and malformed identities

These sets bound simulation only.

```quint
pure val sampleStarted: XRegistry = startX(emptyXRegistry, 10, 1, 1)
pure val sampleClaimed: XRegistry = claimX(sampleStarted, 1)
pure val sampleForeign: XRegistry = { ...sampleClaimed, claims: List({ xId: "77", actor: 2, claimedAt: 5 }) }
pure val rValues = Set(emptyXRegistry).union(Set(sampleStarted)).union(Set(sampleClaimed)).union(Set(sampleForeign))
pure val identityValues = Set({ xId: "77", username: "seven", wellFormed: true },
  { xId: "88", username: "eight", wellFormed: true }, { xId: "99", username: "", wellFormed: false })
pure val actorValues = Set(1, 2)
pure val sessionValues = Set(1, 2)
pure val flowIdValues = Set(0, 1, 2)
pure val nowValues = Set(0, 10, 700)
```
