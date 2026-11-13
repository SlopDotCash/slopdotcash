# Navigation and session ownership

PRD sections 3, 4, 7, 8 and 9. Routes use the existing account menu. Settings,
Payouts and Inbox remain separate pages. Settings keeps wallet management and
email preferences expanded. Recovery and account-appeal controls remain outside
Settings. Private screens clear retained data when the account changes.

## Story: Resume an authorized destination after signing in

### The browser remembers its requested page independently of authentication

The return destination is a validated internal route. The HTTP boundary must
reject external redirects and invalid route parameters before making an event.

```quint
type Page = Home | Projects | Project | AddProject | ManageProject | Profile | Rankings | Cycle | Settings | Payouts | Inbox | Report | Recovery | Administration | Gone
type Navigation = { page: Page, returnPage: Page, actor: int, epoch: int, privateEpoch: int, privateRows: int }
pure val initial: Navigation = { page: Home, returnPage: Home, actor: 0, epoch: 0, privateEpoch: 0, privateRows: 0 }
pure def privatePage(page: Page): bool = Set(AddProject, ManageProject, Settings, Payouts, Inbox, Report, Recovery, Administration).contains(page)
```

### Navigation gates private destinations on a signed-in account

Deep links keep their destination through sign-in. The backend still checks the
specific account, project and case authority for every read and mutation.

```quint
pure def navigate(n: Navigation, destination: Page): Navigation = {
  ...n, page: if (privatePage(destination) and n.actor == 0) Home else destination,
  returnPage: destination, epoch: n.epoch + 1, privateRows: 0, privateEpoch: n.epoch + 1
}
pure def canSignIn(n: Navigation, actorId: int): bool = actorId > 0
pure def signIn(n: Navigation, actorId: int): Navigation = {
  ...n, actor: actorId, page: n.returnPage, epoch: n.epoch + 1,
  privateRows: 0, privateEpoch: n.epoch + 1
}
pure def signOut(n: Navigation): Navigation = {
  ...n, actor: 0, page: Home, epoch: n.epoch + 1,
  privateRows: 0, privateEpoch: n.epoch + 1
}
```

### A private read belongs to the current account and navigation lifetime

A late response cannot restore the prior user's rows or another page's private
data. Revoked or unavailable backend authority produces a recoverable refusal.

```quint
pure def canReceivePrivate(n: Navigation, actorId: int, requestEpoch: int, rows: int, authorized: bool): bool =
  privatePage(n.page) and n.actor > 0 and actorId == n.actor and requestEpoch == n.epoch and rows >= 0 and authorized
pure def receivePrivate(n: Navigation, actorId: int, requestEpoch: int, rows: int, authorized: bool): Navigation =
  { ...n, privateRows: rows, privateEpoch: requestEpoch }
pure def alwaysPrivateRowsHaveOwner(n: Navigation): bool = n.privateRows > 0 implies
  n.actor > 0 and privatePage(n.page) and n.privateEpoch == n.epoch
pure def alwaysEpochsAreValid(n: Navigation): bool = n.epoch >= 0 and n.privateEpoch >= 0 and n.privateRows >= 0
```

### A private destination and a cleared sign-out state are reachable

```quint
pure def sometimesPrivateDestination(n: Navigation): bool = n.actor > 0 and n.page == Inbox and n.privateRows > 0
pure def sometimesSignedOutAfterUse(n: Navigation): bool = n.actor == 0 and n.epoch > 2 and n.privateRows == 0
pure val actorIdValues = Set(0, 1, 2)
pure val rowsValues = Set(0, 1, 2)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val requestEpochValues = Set(0, 1, 2)
```
