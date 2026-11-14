# Participation Points

PRD section 7 and the owner decision of 24 October 2026 (PRD section 11,
"Participation points") stop new welcome and X-connection awards from 24
October 2026 UTC and preserve every earlier award unchanged. Earned-work
standings and rewards exclude them. This machine follows
`backend/points/handler.ts` (`PARTICIPATION_POINTS_END`), the D1 tables
`points_members` (fixed `welcome = 5`, immutable `joined_at`) and
`points_x_awards` (fixed 10 Points, immutable and permanent).

Participation awards are not [Points journal](./journal.md) categories, so
[reward weights](./rewardWeights.md) never read them. The authenticated
GitHub sign-in and the X OAuth exchange are verified by the account service
([accounts](../backend/accounts.md)); this machine receives the resulting
immutable identities and instants.

## Story: Keep historical participation awards and grant no new ones

### Membership keeps its join instant and its stored welcome value

The stored welcome value is always 5. Only a membership that joined before
the cutoff reports it; a later membership reports 0. Reopening a closed
membership keeps the original join instant.

```quint
type Member = { actor: int, joinedAt: int, welcome: int }
type XAward = { actor: int, xId: int, awardedAt: int, points: int }
type XLink = { actor: int, xId: int, linkedAt: int }
type Participation = { now: int, members: List[Member], awards: List[XAward], links: List[XLink] }
pure val participationEnd = 2432123
pure val initial: Participation = { now: 2432100, members: List(), awards: List(), links: List() }
pure def isMember(s: Participation, actor: int): bool = s.members.some(m => m.actor == actor)
pure def effectiveWelcome(m: Member): int = if (m.joinedAt < participationEnd) m.welcome else 0
pure def canJoin(s: Participation, actor: int): bool = actor > 0 and not(isMember(s, actor))
pure def join(s: Participation, actor: int): Participation =
  { ...s, members: s.members.append({ actor: actor, joinedAt: s.now, welcome: 5 }) }
pure def alwaysMembersWellFormed(s: Participation): bool = s.members.every(m =>
  m.actor > 0 and m.welcome == 5 and m.joinedAt <= s.now and
  s.members.select(o => o.actor == m.actor).length() == 1)
```

### An X connection before the cutoff earns one permanent award

A verified X account linked before 24 October 2026 earns 10 Points once per
member and once per X account. From the cutoff a connection is an optional
public profile link with no Points. Disconnecting removes the link and keeps
any award.

```quint
pure def awardedActor(s: Participation, actor: int): bool = s.awards.some(a => a.actor == actor)
pure def awardedX(s: Participation, xId: int): bool = s.awards.some(a => a.xId == xId)
pure def linkedActor(s: Participation, actor: int): bool = s.links.some(k => k.actor == actor)
pure def linkedX(s: Participation, xId: int): bool = s.links.some(k => k.xId == xId)
pure def earnsAward(s: Participation, actor: int, xId: int): bool =
  s.now < participationEnd and not(awardedActor(s, actor)) and not(awardedX(s, xId))
pure def canConnectX(s: Participation, actor: int, xId: int): bool =
  actor > 0 and xId > 0 and isMember(s, actor) and not(linkedActor(s, actor)) and not(linkedX(s, xId)) and
  not(s.awards.some(a => a.xId == xId and a.actor != actor))
pure def connectX(s: Participation, actor: int, xId: int): Participation =
  { ...s, links: s.links.append({ actor: actor, xId: xId, linkedAt: s.now }),
    awards: if (earnsAward(s, actor, xId)) s.awards.append({ actor: actor, xId: xId, awardedAt: s.now, points: 10 }) else s.awards }
pure def canDisconnectX(s: Participation, actor: int): bool = linkedActor(s, actor)
pure def disconnectX(s: Participation, actor: int): Participation = { ...s, links: s.links.select(k => k.actor != actor) }
pure def canAdvance(s: Participation, at: int): bool = at > s.now
pure def advance(s: Participation, at: int): Participation = { ...s, now: at }
pure def alwaysAwardsBeforeCutoff(s: Participation): bool = s.awards.every(a =>
  a.awardedAt < participationEnd and a.points == 10 and a.actor > 0 and a.xId > 0 and
  s.awards.select(o => o.actor == a.actor).length() == 1 and
  s.awards.select(o => o.xId == a.xId).length() == 1)
```

### Earlier awards and membership facts never change

```quint
pure def stepAwardsPermanent(before: Participation, after: Participation): bool =
  before.awards.every(a => after.awards.includes(a)) and before.members.every(m => after.members.includes(m)) and
  after.now >= before.now
pure def stepNoAwardFromCutoff(before: Participation, after: Participation): bool =
  before.now >= participationEnd implies after.awards == before.awards
pure def participationPoints(s: Participation, actor: int): int =
  s.members.foldl(0, (acc, m) => if (m.actor == actor) acc + effectiveWelcome(m) else acc) +
  s.awards.foldl(0, (acc, a) => if (a.actor == actor) acc + a.points else acc)
pure def lawWelcomeEnds(actor: int, joinedAt: int): bool =
  joinedAt >= participationEnd implies effectiveWelcome({ actor: actor, joinedAt: joinedAt, welcome: 5 }) == 0
pure def lawWelcomeKept(actor: int, joinedAt: int): bool =
  joinedAt < participationEnd implies effectiveWelcome({ actor: actor, joinedAt: joinedAt, welcome: 5 }) == 5
pure def sometimesAwardBeforeCutoff(s: Participation): bool = s.awards.length() > 0
pure def sometimesLinkWithoutAward(s: Participation): bool =
  s.links.some(k => not(awardedActor(s, k.actor))) and s.now >= participationEnd
pure def sometimesLateMemberWithoutWelcome(s: Participation): bool = s.members.some(m => effectiveWelcome(m) == 0)
pure def sometimesAwardKeptAfterDisconnect(s: Participation): bool =
  s.awards.some(a => not(linkedActor(s, a.actor))) and s.now >= participationEnd
```

### Simulation samples cross the cutoff

```quint
pure val actorValues = Set(0, 1, 2)
pure val xIdValues = Set(0, 7, 8)
pure val atValues = Set(2432110, 2432123, 2432200)
pure val joinedAtValues = Set(2432122, 2432123, 2432124)
```
