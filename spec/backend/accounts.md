# Account identity and session lifetime

This model covers PRD sections 2 and 3. Each instance belongs to one immutable
GitHub actor. OAuth verification, secure cookies, and storage transactions need
real integration evidence when the shell is implemented. Handles are display
metadata. Historical wallets, awards, cases, and identity reservations remain
attached to the actor across closure and reopening.

## Story: Sign in and manage participation

A person signs in through GitHub, sees disclosed public membership, and can
close or explicitly reopen their account without losing historical records.

### The actor identity remains stable through account changes

```quint
type Membership = Dormant | Open | Closed
type Account = { actor: int, handle: str, membership: Membership, publicMember: bool,
  sessionEpoch: int, sessionActive: bool, returnPath: str, draft: str,
  xId: int, reservedXId: int, publicX: bool, obligations: int, historicalPoints: int }
pure val initial: Account = { actor: 1, handle: "", membership: Dormant,
  publicMember: false, sessionEpoch: 0, sessionActive: false, returnPath: "/",
  draft: "", xId: 0, reservedXId: 0, publicX: false, obligations: 1,
  historicalPoints: 1 }
pure def alwaysActorStable(a: Account): bool = a.actor == 1
pure def alwaysRetainedHistory(a: Account): bool = a.obligations == 1 and a.historicalPoints == 1
pure def alwaysSessionEpoch(a: Account): bool = a.sessionEpoch >= 0
pure def alwaysIdentityIds(a: Account): bool = a.xId >= 0 and a.reservedXId >= 0
pure def alwaysSessionMember(a: Account): bool = a.sessionActive implies a.membership == Open
```

### A verified GitHub sign-in requires the same actor and visibility disclosure

The return destination and permitted draft survive the redirect. A closed
account requires the explicit reopen event.

```quint
pure def canSaveReturn(a: Account, path: str, draftText: str): bool = path != ""
pure def saveReturn(a: Account, path: str, draftText: str): Account =
  { ...a, returnPath: path, draft: draftText }
pure def canSignIn(a: Account, actorId: int, handle: str, oauthVerified: bool, disclosed: bool): bool =
  actorId == a.actor and oauthVerified and disclosed and a.membership != Closed
pure def signIn(a: Account, actorId: int, handle: str, oauthVerified: bool, disclosed: bool): Account =
  { ...a, handle: handle, membership: Open, publicMember: true,
    publicX: a.xId != 0, sessionActive: true, sessionEpoch: a.sessionEpoch + 1 }
pure def canRename(a: Account, actorId: int, handle: str, oauthVerified: bool): bool =
  actorId == a.actor and oauthVerified
pure def rename(a: Account, actorId: int, handle: str, oauthVerified: bool): Account =
  { ...a, handle: handle }
```

### Closure invalidates sessions and public membership until explicit reopening

```quint
pure def canClose(a: Account, by: int): bool = by == a.actor and a.sessionActive
pure def close(a: Account, by: int): Account = { ...a, membership: Closed,
  publicMember: false, publicX: false, sessionActive: false, sessionEpoch: a.sessionEpoch + 1 }
pure def canReopen(a: Account, by: int, oauthVerified: bool, disclosed: bool): bool =
  by == a.actor and oauthVerified and disclosed and a.membership == Closed
pure def reopen(a: Account, by: int, oauthVerified: bool, disclosed: bool): Account =
  { ...a, membership: Open, publicMember: true, publicX: a.xId != 0,
    sessionActive: true, sessionEpoch: a.sessionEpoch + 1 }
pure def canEndSession(a: Account): bool = a.sessionActive
pure def endSession(a: Account): Account =
  { ...a, sessionActive: false, sessionEpoch: a.sessionEpoch + 1 }
pure def alwaysClosedPrivate(a: Account): bool = a.membership == Closed implies
  not(a.publicMember) and not(a.publicX) and not(a.sessionActive)
pure def sessionValid(a: Account, actorId: int, epoch: int): bool =
  actorId == a.actor and a.sessionActive and epoch == a.sessionEpoch and a.membership == Open
```

### An optional X identity stays reserved after disconnect

The OAuth verifier supplies the authenticated X ID and the global reservation
check. The global uniqueness transaction must be atomic in the backend.

```quint
pure def canConnectX(a: Account, by: int, xId: int, oauthVerified: bool, reservationOwned: bool, disclosed: bool): bool =
  by == a.actor and a.sessionActive and xId > 0 and oauthVerified and reservationOwned and disclosed and
  (a.reservedXId == 0 or a.reservedXId == xId)
pure def connectX(a: Account, by: int, xId: int, oauthVerified: bool, reservationOwned: bool, disclosed: bool): Account =
  { ...a, xId: xId, reservedXId: xId, publicX: true }
pure def canDisconnectX(a: Account, by: int): bool = by == a.actor and a.sessionActive and a.xId != 0
pure def disconnectX(a: Account, by: int): Account = { ...a, xId: 0, publicX: false }
pure def alwaysXReservation(a: Account): bool = a.xId != 0 implies a.xId == a.reservedXId
pure def alwaysXVisibility(a: Account): bool = a.publicX implies a.membership == Open and a.xId > 0
pure def stepHistoryIsStable(before: Account, after: Account): bool =
  before.actor == after.actor and before.obligations == after.obligations and
  before.historicalPoints == after.historicalPoints
```

### Signing in, disconnecting, closing, and reopening remain possible

```quint
pure def sometimesSignedIn(a: Account): bool = a.membership == Open and a.sessionActive
pure def sometimesClosed(a: Account): bool = a.membership == Closed
pure def sometimesDisconnected(a: Account): bool = a.reservedXId > 0 and a.xId == 0
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorIdValues = Set(0, 1, 2)
pure val byValues = Set(0, 1, 2)
pure val draftTextValues = Set("", "a", "b")
pure val epochValues = Set(0, 1, 2)
pure val handleValues = Set("", "a", "b")
pure val pathValues = Set("", "a", "b")
pure val xIdValues = Set(0, 1, 2)
```
