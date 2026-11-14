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
  xId: str, reservedXIds: Set[str], publicX: bool, obligations: int, historicalPoints: int }
pure def newAccount(actorId: int, obligations: int, historicalPoints: int): Account = { actor: actorId, handle: "", membership: Dormant,
  publicMember: false, sessionEpoch: 0, sessionActive: false, returnPath: "/",
  draft: "", xId: "", reservedXIds: Set(), publicX: false, obligations: obligations,
  historicalPoints: historicalPoints }
pure val initial: Account = newAccount(1, 0, 0)
pure def alwaysActorValid(a: Account): bool = a.actor > 0
pure def alwaysRetainedHistory(a: Account): bool = a.obligations >= 0 and a.historicalPoints >= 0
pure def lawNewAccountPreservesIdentity(actorId: int, obligations: int, historicalPoints: int): bool =
  (actorId > 0 and obligations >= 0 and historicalPoints >= 0) implies
    newAccount(actorId, obligations, historicalPoints).actor == actorId and
    newAccount(actorId, obligations, historicalPoints).obligations == obligations and
    newAccount(actorId, obligations, historicalPoints).historicalPoints == historicalPoints
pure def alwaysSessionEpoch(a: Account): bool = a.sessionEpoch >= 0
pure def alwaysIdentityIds(a: Account): bool = a.reservedXIds.forall(id => id != "")
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
    publicX: a.xId != "", sessionActive: true, sessionEpoch: a.sessionEpoch + 1 }
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
  { ...a, membership: Open, publicMember: true, publicX: a.xId != "",
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
check. The global uniqueness transaction must be atomic in the backend. A person may
connect a different X identity that is available to their GitHub identity. Each
previously verified X ID remains reserved after disconnect. X IDs retain their
exact decimal string representation, including values above the JavaScript
safe-integer range. The OAuth boundary validates 1–30 decimal digits as the
pinned source does in `backend/points/x.ts`.

```quint
pure def canConnectX(a: Account, by: int, xId: str, oauthVerified: bool, reservationOwned: bool, disclosed: bool): bool =
  by == a.actor and a.sessionActive and xId != "" and oauthVerified and reservationOwned and disclosed
pure def connectX(a: Account, by: int, xId: str, oauthVerified: bool, reservationOwned: bool, disclosed: bool): Account =
  { ...a, xId: xId, reservedXIds: a.reservedXIds.union(Set(xId)), publicX: true }
pure def canDisconnectX(a: Account, by: int): bool = by == a.actor and a.sessionActive and a.xId != ""
pure def disconnectX(a: Account, by: int): Account = { ...a, xId: "", publicX: false }
pure def alwaysXReservation(a: Account): bool = a.xId != "" implies a.reservedXIds.contains(a.xId)
pure def alwaysXVisibility(a: Account): bool = a.publicX implies a.membership == Open and a.xId != ""
pure def stepHistoryIsStable(before: Account, after: Account): bool =
  before.actor == after.actor and before.obligations == after.obligations and
  before.historicalPoints == after.historicalPoints
```

### Signing in, disconnecting, closing, and reopening remain possible

```quint
pure def sometimesSignedIn(a: Account): bool = a.membership == Open and a.sessionActive
pure def sometimesClosed(a: Account): bool = a.membership == Closed
pure def sometimesDisconnected(a: Account): bool = a.reservedXIds.size() > 0 and a.xId == ""
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val obligationsValues = Set(0, 1, 2)
pure val historicalPointsValues = Set(0, 10, 30)
pure val actorIdValues = Set(0, 1, 2)
pure val byValues = Set(0, 1, 2)
pure val draftTextValues = Set("", "a", "b")
pure val epochValues = Set(0, 1, 2)
pure val handleValues = Set("", "a", "b")
pure val pathValues = Set("", "a", "b")
pure val xIdValues = Set("", "123456789", "123456789012345678901234567890")
```
