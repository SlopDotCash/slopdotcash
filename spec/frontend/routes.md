# Addresses, fragments and document heads

PRD sections 3 and 9. Old links in emails, skills and bookmarks keep working,
a fragment opens the section it names, and every route states one title and
one canonical address. These are pure decisions of the browser router; the
shell parses the address into them and applies their results.

## Story: Follow an old link to the page it now lives on

> As someone opening a link saved before a page moved, I want to land on the
> section it meant, with my query and fragment intact.

### Legacy paths resolve to one canonical destination and keep search and fragment

Before routing, the shell rewrites the address in place (`history.replaceState`,
the query string always kept): `/wallet` becomes `/account#wallets`;
`/projects/<id>/awards` becomes the project page with the request's fragment,
or `#monthly-awards` when it has none; `/projects/<id>/funding` becomes the
project page with its fragment, or `#funding`; `/projects/<id>/manage` with the
fragment `#security-settings` becomes `/projects/<id>/security#security-settings`.
A trailing slash is accepted on each. Routing then treats
`/admin/applications/<id>` as Administration and `/points?x` as Settings (see
"Every existing product route is one Page and only private destinations need
an account"). Every other address is left as it is.

```quint
import navigation as N from "./navigation"
type PathForm = OtherPath | WalletPath | AwardsPath | FundingPath | ManagePath | SecurityPath | ProjectPath | AccountPath
type Address = { form: PathForm, project: str, hash: str }
pure def canonicalLocation(address: Address): Address =
  val form = address.form
  match form {
  | WalletPath => { form: AccountPath, project: "", hash: "wallets" }
  | AwardsPath => { ...address, form: ProjectPath, hash: if (address.hash == "") "monthly-awards" else address.hash }
  | FundingPath => { ...address, form: ProjectPath, hash: if (address.hash == "") "funding" else address.hash }
  | ManagePath => if (address.hash == "security-settings") { ...address, form: SecurityPath } else address
  | _ => address
}
pure def legacyLocation(address: Address): bool =
  address.form == WalletPath or address.form == AwardsPath or address.form == FundingPath or
    (address.form == ManagePath and address.hash == "security-settings")
pure def lawCanonicalLocationIsStable(address: Address): bool =
  canonicalLocation(canonicalLocation(address)) == canonicalLocation(address)
pure def lawNoLegacyLocationRemains(address: Address): bool = not(legacyLocation(canonicalLocation(address)))
pure def lawCanonicalKeepsTheProjectAndAGivenFragment(address: Address): bool =
  (address.form == AwardsPath or address.form == FundingPath) implies
    canonicalLocation(address).project == address.project and
    (address.hash != "" implies canonicalLocation(address).hash == address.hash)
pure val addressValues = Set(
  { form: WalletPath, project: "", hash: "" },
  { form: AwardsPath, project: "eliza", hash: "" },
  { form: AwardsPath, project: "eliza", hash: "history" },
  { form: FundingPath, project: "eliza", hash: "" },
  { form: ManagePath, project: "eliza", hash: "security-settings" },
  { form: ManagePath, project: "eliza", hash: "" },
  { form: OtherPath, project: "", hash: "x" }
)
```

### A fragment destination opens its section and stays aligned until it settles or the reader takes over

Content can render or grow after the page loads, so the element a fragment
names (decoded; a malformed escape names nothing) is aligned to the top of the
viewport again on every change of the page's content, after the first frame
and when fonts are ready, for 10 000 ms. Aligning opens every enclosing
`details` element and disclosure that reveals it. A key press, pointer press,
touch or wheel ends it at once. Back and forward restore the scroll position
remembered for that history entry instead of re-aligning the target. A click
on an internal link with the primary button and no modifier navigates in the
page and then scrolls to its fragment's element, or to the top when there is
none; a modified or middle click is left to the browser.

```quint
pure val hashSettleMs = 10000
type AlignTo = AlignTarget | RestorePosition | NoAlignment
type HashAlignment = { targetNamed: bool, elapsedMs: int, readerInput: bool, restoring: bool }
pure def stillAligning(alignment: HashAlignment): bool =
  alignment.targetNamed and alignment.elapsedMs >= 0 and alignment.elapsedMs < hashSettleMs and not(alignment.readerInput)
pure def alignTo(alignment: HashAlignment): AlignTo =
  if (not(stillAligning(alignment))) NoAlignment else if (alignment.restoring) RestorePosition else AlignTarget
pure def inPageNavigation(button: int, modified: bool): bool = button == 0 and not(modified)
pure def lawReaderInputEndsAlignment(alignment: HashAlignment): bool =
  alignment.readerInput implies alignTo(alignment) == NoAlignment
pure def lawAlignmentSettlesAfterTenSeconds(alignment: HashAlignment): bool =
  alignment.elapsedMs >= hashSettleMs implies alignTo(alignment) == NoAlignment
pure def lawHistoryRestoresItsOwnPosition(alignment: HashAlignment): bool =
  (alignment.restoring and stillAligning(alignment)) implies alignTo(alignment) == RestorePosition
pure def lawModifiedClicksStayNative(button: int, modified: bool): bool =
  (modified or button != 0) implies not(inPageNavigation(button, modified))
pure val alignmentValues = Set(
  { targetNamed: true, elapsedMs: 0, readerInput: false, restoring: false },
  { targetNamed: true, elapsedMs: 9999, readerInput: false, restoring: true },
  { targetNamed: true, elapsedMs: 10000, readerInput: false, restoring: false },
  { targetNamed: true, elapsedMs: 10, readerInput: true, restoring: false },
  { targetNamed: false, elapsedMs: 0, readerInput: false, restoring: false }
)
pure val buttonValues = Set(0, 1)
```

## Story: Give every route one title and canonical address

> As a search engine or a person sharing a link, I want each page to name
> itself once and point at one canonical address, and a private page never to
> put a private identifier in its title.

### Each route has one title, canonical and index policy, and private routes never name a private identifier

Titles are written "<name> · Slop", except Home, whose title is "Slop: make
money shipping open source". Canonical addresses are on `https://slop.cash`.
Private routes have fixed titles and canonical paths: Account (`/account`),
Log in (`/login`), Your payouts (`/earnings`), Inbox, Admin, Private vetting
evidence and Security cases (`/security`). Fixed public pages are How it works,
Sponsors, Cycle archive (`/cycles`), Leaderboard (`/points`) and Add a project
(`/projects/new`). A project page is titled with the project name (with
"security bounty" when its program is bounty-only), a manage page "Manage
<project>", a security program "<project> security bounty", a cycle "<project>
<cycle> cycle" and a profile with the login, each at its canonical slug or
path. An unknown route, an unknown project, a missing cycle, and any page
while a not-found view is mounted, are `noindex` with no canonical. The head
is rendered as hoisted React elements, without an effect hook.

```quint
type RouteHead = { titleName: str, canonical: str, indexed: bool }
pure def privateTitle(page: N::Page): str =
  if (page == N::Settings) "Account" else if (page == N::Login) "Log in" else if (page == N::Payouts) "Your payouts"
  else if (page == N::Inbox) "Inbox" else if (page == N::Administration) "Admin"
  else if (page == N::VettingEvidence) "Private vetting evidence" else if (page == N::SecurityCases) "Security cases"
  else ""
pure def staticTitle(page: N::Page): str =
  if (page == N::Home) "Slop: make money shipping open source" else if (page == N::HowItWorks) "How it works"
  else if (page == N::Sponsors) "Sponsors" else if (page == N::CycleArchive) "Cycle archive"
  else if (page == N::Rankings) "Leaderboard" else if (page == N::AddProject) "Add a project"
  else ""
pure def recordPage(page: N::Page): bool =
  page == N::Project or page == N::ManageProject or page == N::SecurityProgram or page == N::Cycle or page == N::Profile
pure val notFoundHead: RouteHead = { titleName: "Page not found", canonical: "", indexed: false }
pure def routeHead(page: N::Page, recordFound: bool, recordName: str): RouteHead =
  val routed = N::routedPage(page)
  if (privateTitle(routed) != "") { titleName: privateTitle(routed), canonical: N::routePattern(routed), indexed: true }
  else if (staticTitle(routed) != "") { titleName: staticTitle(routed), canonical: N::routePattern(routed), indexed: true }
  else if (recordPage(routed) and recordFound and recordName != "") { titleName: recordName, canonical: N::routePattern(routed), indexed: true }
  else notFoundHead
pure def lawPrivateHeadNamesNoRecord(page: N::Page, recordName: str, otherName: str): bool =
  privateTitle(N::routedPage(page)) != "" implies routeHead(page, true, recordName) == routeHead(page, true, otherName)
pure def lawMissingPageIsNotIndexed(page: N::Page, recordName: str): bool =
  recordPage(N::routedPage(page)) implies routeHead(page, false, recordName) == notFoundHead
pure def lawIndexedHeadHasCanonical(page: N::Page, recordFound: bool, recordName: str): bool =
  routeHead(page, recordFound, recordName).indexed iff routeHead(page, recordFound, recordName).canonical != ""
pure val recordNameValues = Set("", "eliza", "alice")
pure val otherNameValues = Set("", "bob")
```
