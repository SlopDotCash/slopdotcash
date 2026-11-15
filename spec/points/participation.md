# Participation Points

PRD section 7 and the owner decision of 24 October 2026 (PRD section 11,
"Participation points") stop new welcome and X-connection awards from 24
October 2026 UTC and preserve every earlier award unchanged. Earned-work
standings and rewards exclude them. This machine follows
`backend/points/handler.ts` (`PARTICIPATION_POINTS_END`), the D1 tables
`points_members` (fixed `welcome = 5`, immutable `joined_at`) and
`points_x_awards` (fixed 10 Points, immutable and permanent) and
`points_x_claims` (an X account bound permanently to its first actor), and
`backend/points/x.ts` (the claim insert and the link upsert).

Participation awards are not [Points journal](./journal.md) categories, so
[reward weights](./rewardWeights.md) never read them. The authenticated
GitHub sign-in and the X OAuth exchange are verified by the account service
([accounts](../backend/accounts.md)); this machine receives the resulting
immutable identities and instants.

## Story: Keep historical participation awards and grant no new ones

### Membership keeps its join instant and its stored welcome value

The stored welcome value is always 5. Only a membership that joined before
the cutoff reports it; a later membership reports 0. Closing a membership
disconnects its X link and keeps its awards; reopening it keeps the original
join instant.

```quint
type Member = { actor: int, joinedAt: int, welcome: int }
type XAward = { actor: int, xId: int, awardedAt: int, points: int }
type XLink = { actor: int, xId: int, linkedAt: int }
type XClaim = { xId: int, actor: int }
type Participation = { now: int, members: List[Member], closed: Set[int], awards: List[XAward], claims: List[XClaim],
  links: List[XLink] }
pure val participationEnd = 2432123
pure val initial: Participation = { now: 2432100, members: List(), closed: Set(), awards: List(), claims: List(), links: List() }
pure def isMember(s: Participation, actor: int): bool = s.members.some(m => m.actor == actor)
pure def activeMember(s: Participation, actor: int): bool = isMember(s, actor) and not(s.closed.contains(actor))
pure def effectiveWelcome(m: Member): int = if (m.joinedAt < participationEnd) m.welcome else 0
pure def canJoin(s: Participation, actor: int): bool = actor > 0 and not(isMember(s, actor))
pure def join(s: Participation, actor: int): Participation =
  { ...s, members: s.members.append({ actor: actor, joinedAt: s.now, welcome: 5 }) }
pure def canClose(s: Participation, actor: int): bool = activeMember(s, actor)
pure def close(s: Participation, actor: int): Participation =
  { ...s, closed: s.closed.union(Set(actor)), links: s.links.select(k => k.actor != actor) }
pure def canReopen(s: Participation, actor: int): bool = isMember(s, actor) and s.closed.contains(actor)
pure def reopen(s: Participation, actor: int): Participation = { ...s, closed: s.closed.exclude(Set(actor)) }
pure def alwaysMembersWellFormed(s: Participation): bool = s.members.every(m =>
  m.actor > 0 and m.welcome == 5 and m.joinedAt <= s.now and
  s.members.select(o => o.actor == m.actor).length() == 1)
pure def alwaysClosedAreMembers(s: Participation): bool = s.closed.forall(a => isMember(s, a))
```

### An X account is claimed once, forever, by its first actor

A verified X account linked before 24 October 2026 earns 10 Points once per
member and once per X account. From the cutoff a connection is an optional
public profile link with no Points. The first actor to connect an X account
claims it permanently; another actor can never connect it, even after a
disconnect. The same actor may relink, replacing its own link. Disconnecting
removes the link and keeps the claim and any award.

```quint
pure def awardedActor(s: Participation, actor: int): bool = s.awards.some(a => a.actor == actor)
pure def awardedX(s: Participation, xId: int): bool = s.awards.some(a => a.xId == xId)
pure def linkedActor(s: Participation, actor: int): bool = s.links.some(k => k.actor == actor)
pure def claimedBy(s: Participation, xId: int, actor: int): bool = s.claims.some(c => c.xId == xId and c.actor == actor)
pure def claimedByOther(s: Participation, xId: int, actor: int): bool = s.claims.some(c => c.xId == xId and c.actor != actor)
pure def claimed(s: Participation, xId: int): bool = s.claims.some(c => c.xId == xId)
pure def earnsAward(s: Participation, actor: int, xId: int): bool =
  s.now < participationEnd and not(awardedActor(s, actor)) and not(awardedX(s, xId))
pure def withClaim(s: Participation, actor: int, xId: int): List[XClaim] =
  if (claimed(s, xId)) s.claims else s.claims.append({ xId: xId, actor: actor })
pure def canConnectX(s: Participation, actor: int, xId: int): bool =
  actor > 0 and xId > 0 and activeMember(s, actor) and not(claimedByOther(s, xId, actor))
pure def connectX(s: Participation, actor: int, xId: int): Participation =
  { ...s, claims: withClaim(s, actor, xId),
    links: s.links.select(k => k.actor != actor).append({ actor: actor, xId: xId, linkedAt: s.now }),
    awards: if (earnsAward(s, actor, xId)) s.awards.append({ actor: actor, xId: xId, awardedAt: s.now, points: 10 }) else s.awards }
pure def canDisconnectX(s: Participation, actor: int): bool = linkedActor(s, actor)
pure def disconnectX(s: Participation, actor: int): Participation = { ...s, links: s.links.select(k => k.actor != actor) }
pure def canAdvance(s: Participation, at: int): bool = at > s.now
pure def advance(s: Participation, at: int): Participation = { ...s, now: at }
pure def alwaysClaimsUnique(s: Participation): bool = s.claims.every(c =>
  c.xId > 0 and c.actor > 0 and s.claims.select(o => o.xId == c.xId).length() == 1)
pure def alwaysLinksClaimed(s: Participation): bool = s.links.every(k => claimedBy(s, k.xId, k.actor))
```

### Stored awards include rows recorded on the cutoff day, which never count

`points_x_awards` rows are immutable and never deleted. Production recorded
some on 24 October 2026 itself; they stay stored and the effective view
counts only an award recorded before the cutoff instant
(`backend/points/handler.ts`, `X_AWARD_SQL`). Retaining an existing stored
row keeps its claim; no transition stores an award after the cutoff day.

```quint
pure def effectiveX(a: XAward): int = if (a.awardedAt < participationEnd) a.points else 0
pure def canRetainStoredAward(s: Participation, a: XAward): bool =
  a.actor > 0 and a.xId > 0 and a.points == 10 and a.awardedAt >= 0 and a.awardedAt <= participationEnd and
  a.awardedAt <= s.now and isMember(s, a.actor) and not(awardedActor(s, a.actor)) and not(awardedX(s, a.xId)) and
  not(claimedByOther(s, a.xId, a.actor))
pure def retainStoredAward(s: Participation, a: XAward): Participation =
  { ...s, awards: s.awards.append(a), claims: withClaim(s, a.actor, a.xId) }
pure def alwaysAwardsWellFormed(s: Participation): bool = s.awards.every(a =>
  a.awardedAt <= participationEnd and a.points == 10 and a.actor > 0 and a.xId > 0 and claimedBy(s, a.xId, a.actor) and
  s.awards.select(o => o.actor == a.actor).length() == 1 and
  s.awards.select(o => o.xId == a.xId).length() == 1)
```

### Earlier awards, claims and membership facts never change

```quint
pure def stepAwardsPermanent(before: Participation, after: Participation): bool =
  before.awards.every(a => after.awards.includes(a)) and before.members.every(m => after.members.includes(m)) and
  before.claims.every(c => after.claims.includes(c)) and after.now >= before.now
pure def stepNoAwardFromCutoff(before: Participation, via: str, after: Participation): bool =
  (before.now >= participationEnd and via != "retainStoredAward") implies after.awards == before.awards
pure def participationPoints(s: Participation, actor: int): int =
  s.members.foldl(0, (acc, m) => if (m.actor == actor) acc + effectiveWelcome(m) else acc) +
  s.awards.foldl(0, (acc, a) => if (a.actor == actor) acc + effectiveX(a) else acc)
pure def lawWelcomeEnds(actor: int, joinedAt: int): bool =
  joinedAt >= participationEnd implies effectiveWelcome({ actor: actor, joinedAt: joinedAt, welcome: 5 }) == 0
pure def lawWelcomeKept(actor: int, joinedAt: int): bool =
  joinedAt < participationEnd implies effectiveWelcome({ actor: actor, joinedAt: joinedAt, welcome: 5 }) == 5
pure def lawCutoffDayAwardNeverCounts(actor: int, xId: int): bool =
  effectiveX({ actor: actor, xId: xId, awardedAt: participationEnd, points: 10 }) == 0
pure def sometimesAwardBeforeCutoff(s: Participation): bool = s.awards.some(a => effectiveX(a) == 10)
pure def sometimesCutoffDayAwardHidden(s: Participation): bool = s.awards.some(a => effectiveX(a) == 0)
pure def sometimesLinkWithoutAward(s: Participation): bool =
  s.links.some(k => not(awardedActor(s, k.actor))) and s.now >= participationEnd
pure def sometimesLateMemberWithoutWelcome(s: Participation): bool = s.members.some(m => effectiveWelcome(m) == 0)
pure def sometimesAwardKeptAfterDisconnect(s: Participation): bool =
  s.awards.some(a => not(linkedActor(s, a.actor))) and s.now >= participationEnd
pure def sometimesRelinked(s: Participation): bool = s.links.some(k => k.linkedAt >= participationEnd and claimedBy(s, k.xId, k.actor) and awardedActor(s, k.actor))
pure def sometimesReopened(s: Participation): bool = s.members.some(m => m.joinedAt < participationEnd and activeMember(s, m.actor)) and s.now >= participationEnd and s.claims.length() > 0
```

### Simulation samples cross the cutoff

```quint
pure val actorValues = Set(0, 1, 2)
pure val xIdValues = Set(0, 7, 8)
pure val atValues = Set(2432110, 2432123, 2432200)
pure val joinedAtValues = Set(2432122, 2432123, 2432124)
pure val aValues = Set({ actor: 1, xId: 7, awardedAt: 2432123, points: 10 }, { actor: 2, xId: 8, awardedAt: 2432105, points: 10 },
  { actor: 2, xId: 7, awardedAt: 2432105, points: 10 })
```
