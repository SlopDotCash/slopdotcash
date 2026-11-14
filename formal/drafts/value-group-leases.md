# Shared Slopbot work-unit source leases

PRD sections 5, 7 and 12. The [inference model](./valueInference.md) owns
the provider and result for one immutable key. This table owns current durable
claims across keys. It models overlapping and disjoint source sets and the
two independently checked leases. Source is
`workers/slopbot/value-processing.ts`,
`workers/slopbot/value-source-leases.ts` and
`workers/slopbot/value-consumer.ts` at
`ee1a4b2cd2672245537928380e425f5bd9ecb994`.

## Story: An overlapping request cannot claim a subset and spend despite contention

### One current request token is eligible to own its complete group

Accepted delivery rows have an immutable primary repository and pull-request
identity. The first claim lasts ten minutes. A new token may replace an
expired request claim. Two active requests for the same primary identity
cannot claim concurrently. A different primary can begin its own request
and still encounter a shared source later.

```quint
type SourceId = { repository: int, pull: int }
type RequestPhase = Running | Waiting | Complete
type Delivery = { deliveryId: str, primary: SourceId }
type RequestLease = { token: str, delivery: Delivery, until: int, phase: RequestPhase, retryAt: int }
type GroupLease = { token: str, sources: List[SourceId] }
type Claims = { now: int, owners: str -> RequestLease, tokens: List[str], groups: List[GroupLease] }
pure val initial: Claims = { now: 0, owners: Map(), tokens: List(), groups: List() }
pure val noOwner: RequestLease = { token: "", delivery: { deliveryId: "", primary: { repository: 0, pull: 0 } },
  until: 0, phase: Complete, retryAt: 0 }
pure def readOwner(c: Claims, token: str): RequestLease = c.owners.getOr(token, noOwner)
pure def validSource(sourceId: SourceId): bool = sourceId.repository > 0 and sourceId.pull > 0
pure def validGroup(sources: List[SourceId]): bool = sources.length() > 0 and
  sources.every(sourceId => validSource(sourceId) and sources.select(other => other == sourceId).length() == 1)
pure def active(owner: RequestLease, time: int): bool = owner.token != "" and owner.phase == Running and owner.until > time
pure def primaryFree(c: Claims, delivery: Delivery): bool =
  not(c.tokens.some(t => active(readOwner(c, t), c.now) and
    (readOwner(c, t).delivery.deliveryId == delivery.deliveryId or readOwner(c, t).delivery.primary == delivery.primary)))
pure def canClaim(c: Claims, token: str, delivery: Delivery): bool =
  token != "" and delivery.deliveryId != "" and validSource(delivery.primary) and not(c.owners.keys().contains(token))
    and primaryFree(c, delivery)
    and c.tokens.every(t => readOwner(c, t).delivery.deliveryId != delivery.deliveryId or
      (readOwner(c, t).delivery == delivery and readOwner(c, t).phase != Complete and
        (readOwner(c, t).phase != Waiting or (readOwner(c, t).retryAt > 0 and readOwner(c, t).retryAt <= c.now))))
pure def claim(c: Claims, token: str, delivery: Delivery): Claims =
  { ...c, tokens: c.tokens.append(token), owners: c.owners.put(token, { token: token, delivery: delivery, until: c.now + 600000, phase: Running, retryAt: 0 }) }
pure def canObserveClock(c: Claims, checkedAt: int): bool = checkedAt > c.now
pure def observeClock(c: Claims, checkedAt: int): Claims = { ...c, now: checkedAt }
pure def alwaysClock(c: Claims): bool = c.now >= 0
pure def stepClockMonotonic(before: Claims, after: Claims): bool = after.now >= before.now
```

### The atomic group claim requires every source and a live request owner

The source lease key uses permanent repository and pull-request IDs, so
changed content and different inference keys still contend. The hosted
SQLite statement admits the entire group together. If any wanted source
belongs to another running and unexpired request, none is written. Expired
or completed owners no longer block the group. This model retains the exact
group input per token. The caller's complete source scope comes from its
verified source collection.

```quint
pure def overlaps(left: List[SourceId], right: List[SourceId]): bool = left.some(sourceId => right.includes(sourceId))
pure def ownedSources(c: Claims, token: str): List[SourceId] =
  c.groups.select(group => group.token == token).foldl(List(), (sources, group) => sources.concat(group.sources))
pure def availableForGroup(c: Claims, token: str, sources: List[SourceId]): bool =
  not(c.groups.some(group => group.token != token and active(readOwner(c, group.token), c.now) and overlaps(group.sources, sources)))
pure def canClaimGroup(c: Claims, token: str, sources: List[SourceId]): bool =
  active(readOwner(c, token), c.now) and validGroup(sources) and availableForGroup(c, token, sources)
    and not(c.groups.some(group => group.token == token))
pure def claimGroup(c: Claims, token: str, sources: List[SourceId]): Claims =
  { ...c, groups: c.groups.append({ token: token, sources: sources }) }
pure def mayUseGroup(c: Claims, token: str, sources: List[SourceId], databaseClock: int): bool =
  active(readOwner(c, token), c.now) and active(readOwner(c, token), databaseClock)
    and validGroup(sources) and sources.every(sourceId => ownedSources(c, token).includes(sourceId))
    and ownedSources(c, token).every(sourceId => sources.includes(sourceId))
pure def lawDatabaseExpiryFencesQueuedOperation(c: Claims, token: str, sources: List[SourceId], databaseClock: int): bool =
  databaseClock >= readOwner(c, token).until implies not(mayUseGroup(c, token, sources, databaseClock))
pure def lawConflictRefusesEntireGroup(c: Claims, token: str, sources: List[SourceId]): bool =
  not(availableForGroup(c, token, sources)) implies not(canClaimGroup(c, token, sources))
```

### Completion and expiry immediately remove authority for further operations

Completion or deferral rechecks the exact token and database execution time.
A terminal delivery cannot restart. Deferred work resumes at the given retry
time. A zero retry time is parked until the separately verified scheduler
resumes that registration. An expired
worker cannot publish, mark the request complete, or call the provider again,
even if it still holds a previously submitted query. The provider attempt
journal separately retains cost for a real call that already started.
This owner supplies only the lease predicate. Remote authority and final
source validation remain independently necessary.

```quint
pure def canFinish(c: Claims, token: str, databaseClock: int): bool =
  active(readOwner(c, token), c.now) and active(readOwner(c, token), databaseClock)
pure def finish(c: Claims, token: str, databaseClock: int): Claims =
  val owner = readOwner(c, token)
  { ...c, owners: c.owners.put(token, { ...owner, phase: Complete }) }
pure def canDefer(c: Claims, token: str, databaseClock: int, retryTime: int): bool =
  canFinish(c, token, databaseClock) and (retryTime == 0 or retryTime > c.now)
pure def defer(c: Claims, token: str, databaseClock: int, retryTime: int): Claims =
  val owner = readOwner(c, token)
  { ...c, owners: c.owners.put(token, { ...owner, phase: Waiting, retryAt: retryTime }) }
pure def canResumeParked(c: Claims, token: str, registryActive: bool): bool =
  val owner = readOwner(c, token)
  owner.phase == Waiting and owner.retryAt == 0 and registryActive and c.now > 0
pure def resumeParked(c: Claims, token: str, registryActive: bool): Claims =
  val owner = readOwner(c, token)
  { ...c, owners: c.owners.put(token, { ...owner, retryAt: c.now }) }
pure def alwaysKnownGroupOwners(c: Claims): bool = c.groups.every(group => readOwner(c, group.token).token == group.token and group.token != "")
pure def alwaysExclusiveGroups(c: Claims): bool =
  c.groups.every(first => c.groups.every(second =>
    first.token == second.token or not(active(readOwner(c, first.token), c.now))
      or not(active(readOwner(c, second.token), c.now)) or not(overlaps(first.sources, second.sources))))
pure def sometimesDisjointOwners(c: Claims): bool = c.groups.some(first => c.groups.some(second =>
  first.token != second.token and active(readOwner(c, first.token), c.now) and active(readOwner(c, second.token), c.now)
    and not(overlaps(first.sources, second.sources))))
pure def sometimesExpiredOwnerReplaced(c: Claims): bool = c.groups.some(first => c.groups.some(second =>
  first.token != second.token and not(active(readOwner(c, first.token), c.now)) and active(readOwner(c, second.token), c.now)
    and overlaps(first.sources, second.sources)))
```

### Simulation samples include intersecting, reordered and disjoint groups

```quint
pure val a: SourceId = { repository: 1, pull: 1 }
pure val b: SourceId = { repository: 1, pull: 2 }
pure val d: SourceId = { repository: 2, pull: 1 }
pure val deliveryValues = Set(
  { deliveryId: "one", primary: a }, { deliveryId: "two", primary: b },
  { deliveryId: "three", primary: d }, { deliveryId: "alternate", primary: a })
pure val tokenValues = Set("first", "second", "third", "retry")
pure val retryTimeValues = Set(0, 1, 600000)
pure val checkedAtValues = Set(1, 600000, 600001, 1200000)
pure val databaseClockValues = Set(0, 1, 600000, 600001, 1200000)
pure val sourcesValues = Set(List(a), List(b), List(d), List(a, b), List(b, a), List(b, d), List(a, a))
pure val weight_claim = 35
pure val weight_claimGroup = 60
pure val weight_finish = 12
pure val weight_defer = 10
pure val weight_resumeParked = 10
```
