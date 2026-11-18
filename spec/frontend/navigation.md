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
  | HowItWorks | Sponsors | CycleArchive | Login | VettingEvidence | SecurityCases | SecurityProgram
type Navigation = { page: Page, returnPage: Page, actor: int, epoch: int, privateEpoch: int, privateRows: int }
pure val initial: Navigation = { page: Home, returnPage: Home, actor: 0, epoch: 0, privateEpoch: 0, privateRows: 0 }
pure def privatePage(page: Page): bool = page == AddProject or page == ManageProject or page == Settings or
  page == Payouts or page == Inbox or page == Report or page == Recovery or page == Administration or
  page == VettingEvidence or page == SecurityCases
```

### Navigation gates private destinations on a signed-in account

Deep links keep their destination through sign-in. The backend still checks the
specific account, project and case authority for every read and mutation.
Signing out changes no address: it ends the session and clears private data,
a public page stays shown, and a private one shows sign-in in place.

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
  ...n, actor: 0, page: if (privatePage(n.returnPage)) Home else n.returnPage, epoch: n.epoch + 1,
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

### An identity refresh applies only within the navigation lifetime that requested it

The Inbox, security cases and email preferences re-read the session when the
window regains focus. The shell stamps each such read with the navigation
epoch it started in. An answer from an older epoch, for example one that
started before a later sign-out, is refused, so it can neither sign the old
account back in nor reset a remounted page. An answer naming the account that
is already signed in changes nothing: an open email draft stays editable and
its lifetime is kept. An answer naming no account signs out; one naming another
account signs that account in, both exactly as the explicit transitions do.

```quint
pure def canRefreshIdentity(n: Navigation, actorId: int, requestEpoch: int): bool = actorId >= 0 and requestEpoch == n.epoch
pure def refreshIdentity(n: Navigation, actorId: int, requestEpoch: int): Navigation =
  if (actorId == n.actor) n else if (actorId == 0) signOut(n) else signIn(n, actorId)
pure def stepSameAccountRefreshKeepsLifetime(before: Navigation, via: str, after: Navigation): bool =
  (via == "refreshIdentity" and after.actor == before.actor) implies after == before
pure def stepAccountChangeStartsLifetime(before: Navigation, after: Navigation): bool =
  after.actor != before.actor implies after.epoch > before.epoch and after.privateRows == 0
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

## Story: Open every product route at its existing address

> As a visitor or a member, I want every link I was sent, in an email, a skill
> or a page, to open the same place it always did, and a private page to ask
> me to sign in right there.

### Every existing product route is one Page and only private destinations need an account

Which route an address opens, old addresses included, is decided by the
[app shell](../app/index.md) ("Each address names exactly one route kind, and
an address that names none is unknown"); each of its route kinds is one Page
here (`pageOf` in [fragments and document heads](./routes.md)), and the
unknown route is Gone. Three pages have no address of their own: Projects is
the project list on Home, Report is the report form inside the security
program, and Recovery is the payout consent section of Payouts. Login is
public. Only the private pages need a signed-in account; every other
destination opens signed out.

```quint
pure def routedPage(page: Page): Page =
  if (page == Projects) Home else if (page == Report) SecurityProgram else if (page == Recovery) Payouts else page
pure def lawPublicDestinationOpensSignedOut(destination: Page): bool =
  not(privatePage(destination)) implies navigate(initial, destination).page == destination
pure def lawPrivateDestinationWaitsForAccount(destination: Page): bool =
  privatePage(destination) implies navigate(initial, destination).page == Home and navigate(initial, destination).returnPage == destination
```

### Administration sections and project selection are parameters of the one Administration page

`/admin` takes `?project=<id>` to select a project and `?section=` for
`security`, `settings` or `skills` of that project; any other value, `overview`
included, shows the overview, and the `#admin-vetting` fragment opens the
security section. `?section=fees` without a selected project shows the fee
conversions. Links in sent emails to `/admin/applications/<id>` open the
overview. None of these is a page of its own: each is the private
Administration page, and the backend checks administrator authority for every
read.

```quint
type AdminSectionParam = SectionAbsent | SectionSecurity | SectionSettings | SectionSkills | SectionFees | SectionOther
type AdminView = AdminOverview | AdminSecurity | AdminSettings | AdminSkills | AdminFees
type AdminRequest = { section: AdminSectionParam, projectSelected: bool, vettingFragment: bool }
pure def adminView(adminRequest: AdminRequest): AdminView =
  if (adminRequest.section == SectionFees and not(adminRequest.projectSelected)) AdminFees
  else if (adminRequest.section == SectionSecurity) AdminSecurity
  else if (adminRequest.section == SectionSettings) AdminSettings
  else if (adminRequest.section == SectionSkills) AdminSkills
  else if (adminRequest.vettingFragment) AdminSecurity
  else AdminOverview
pure def adminPage(adminRequest: AdminRequest): Page = Administration
pure def lawAdminViewsArePrivateAdministration(adminRequest: AdminRequest): bool =
  adminPage(adminRequest) == Administration and privatePage(adminPage(adminRequest))
pure def lawFeesNeedNoSelectedProject(adminRequest: AdminRequest): bool =
  adminView(adminRequest) == AdminFees implies not(adminRequest.projectSelected)
pure def lawVettingFragmentOpensSecurity(adminRequest: AdminRequest): bool =
  (adminRequest.section == SectionAbsent and adminRequest.vettingFragment) implies adminView(adminRequest) == AdminSecurity
pure val adminRequestValues = Set(
  { section: SectionFees, projectSelected: false, vettingFragment: false },
  { section: SectionFees, projectSelected: true, vettingFragment: false },
  { section: SectionAbsent, projectSelected: true, vettingFragment: true },
  { section: SectionSkills, projectSelected: true, vettingFragment: true },
  { section: SectionOther, projectSelected: false, vettingFragment: false }
)
```

### A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled

`returnPage` is the destination the address bar names. Signed out on a private
destination, the shell keeps that URL and renders the sign-in panel in place
(a polite "Checking sign-in…" status, then "Sign in with GitHub" returning to
the same URL, or an alert when the session check fails), while the machine's
page stays Home and no private read can be received. Settings' `#wallets`
section, because it holds only this browser's wallet choice, and the Inbox's
email link action (an emailed verify or unsubscribe token,
[email link actions](./emailAction.md); development `src/Inbox.tsx`
`InboxEmailAction` at `67fd54fd4`) are the parts of a private page that
render signed out; neither holds a private row. Otherwise the shown page is the
addressed one, signed in or out: signing out on a public page leaves that page
shown at its URL.

```quint
pure def signInShownInPlace(n: Navigation): bool = n.actor == 0 and privatePage(n.returnPage)
pure def alwaysSignInInPlaceHoldsNoPrivateData(n: Navigation): bool =
  signInShownInPlace(n) implies n.privateRows == 0 and not(privatePage(n.page))
pure def alwaysAddressedPageIsShownWhenAllowed(n: Navigation): bool =
  n.page == n.returnPage or (n.actor == 0 and privatePage(n.returnPage) and n.page == Home)
pure def sometimesSignInShownInPlace(n: Navigation): bool = signInShownInPlace(n) and n.returnPage == Inbox
pure def sometimesPublicPageSignedOut(n: Navigation): bool = n.actor == 0 and n.page == SecurityProgram
```
