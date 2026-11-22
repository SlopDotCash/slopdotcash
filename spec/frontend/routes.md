# Fragments and document heads

PRD sections 3 and 9. A fragment opens the section it names, and every route
states one title and one canonical address. Which route an address opens,
old addresses included, is decided by the [app shell](../app/index.md); these
are pure decisions about the route it shows, and the shell applies their
results.

## Story: Open the section a link names

> As someone opening a link to a section of a page, I want to land on that
> section, even when the page is still loading around it.

### A fragment destination opens its section and stays aligned until it settles or the reader takes over

Content can render or grow after the page loads, so the element a fragment
names (decoded; a malformed escape names nothing) is aligned to the top of the
viewport again on every change of the page's content, after the first frame
and when fonts are ready, for 10 000 ms. Aligning opens every enclosing
`details` element and disclosure that reveals it. A key press, pointer press,
touch or wheel ends it at once. Back and forward restore the scroll position
remembered for that history entry instead of re-aligning the target. A
history entry that changes only a presentation query (Home's `audience`)
keeps the reader's current viewport instead of re-aligning, and records that
position for the new entry so back and forward restore it (development
`src/Link.tsx` `useHashScroll` and `formal/models/ui/ui_hash_navigation.qnt`
at `67fd54fd4`). A click
on an internal link with the primary button and no modifier navigates in the
page and then scrolls to its fragment's element, or to the top when there is
none; a modified or middle click is left to the browser.

```quint
pure val hashSettleMs = 10000
type AlignTo = AlignTarget | RestorePosition | NoAlignment
type HashAlignment = { targetNamed: bool, elapsedMs: int, readerInput: bool, restoring: bool, queryOnly: bool }
pure def stillAligning(alignment: HashAlignment): bool =
  alignment.targetNamed and alignment.elapsedMs >= 0 and alignment.elapsedMs < hashSettleMs and not(alignment.readerInput)
pure def alignTo(alignment: HashAlignment): AlignTo =
  if (not(stillAligning(alignment))) NoAlignment
  else if (alignment.restoring or alignment.queryOnly) RestorePosition else AlignTarget
pure def inPageNavigation(button: int, modified: bool): bool = button == 0 and not(modified)
pure def lawReaderInputEndsAlignment(alignment: HashAlignment): bool =
  alignment.readerInput implies alignTo(alignment) == NoAlignment
pure def lawAlignmentSettlesAfterTenSeconds(alignment: HashAlignment): bool =
  alignment.elapsedMs >= hashSettleMs implies alignTo(alignment) == NoAlignment
pure def lawHistoryRestoresItsOwnPosition(alignment: HashAlignment): bool =
  (alignment.restoring and stillAligning(alignment)) implies alignTo(alignment) == RestorePosition
pure def lawQueryOnlyEntryKeepsTheViewport(alignment: HashAlignment): bool =
  (alignment.queryOnly and stillAligning(alignment)) implies alignTo(alignment) == RestorePosition
pure def lawModifiedClicksStayNative(button: int, modified: bool): bool =
  (modified or button != 0) implies not(inPageNavigation(button, modified))
pure val alignmentValues = Set(
  { targetNamed: true, elapsedMs: 0, readerInput: false, restoring: false, queryOnly: false },
  { targetNamed: true, elapsedMs: 9999, readerInput: false, restoring: true, queryOnly: false },
  { targetNamed: true, elapsedMs: 10000, readerInput: false, restoring: false, queryOnly: false },
  { targetNamed: true, elapsedMs: 10, readerInput: true, restoring: false, queryOnly: false },
  { targetNamed: false, elapsedMs: 0, readerInput: false, restoring: false, queryOnly: false },
  { targetNamed: true, elapsedMs: 0, readerInput: false, restoring: false, queryOnly: true }
)
pure val buttonValues = Set(0, 1)
```

## Story: Give every route one title and canonical address

> As a search engine or a person sharing a link, I want each page to name
> itself once and point at one canonical address, and a private page never to
> put a private identifier in its title.

### Each route has one title, canonical and index policy, and private routes never name a private identifier

Titles are written "<name> · Slop", except Home, whose title is "Slop: ship
and maintain open source" (development `src/lib/site-routes.ts` at
`67fd54fd4`). Canonical addresses are on `https://slop.cash`.
Private routes have fixed titles and canonical paths: Account (`/account`),
Log in (`/login`), Your payouts (`/earnings`), Inbox, Admin, Private vetting
evidence and Security cases (`/security`). Fixed public pages are How it works,
Fund a project (`/sponsors`), Cycle archive (`/cycles`), Contributors (`/points`) and Add a project
(`/projects/new`) (development `src/lib/site-routes.ts` at `8660a6121`). The
two pay pages are titled "Submission fee" (`/fee/<owner>/<repo>/<number>`)
and "Report deposit" (`/fee/report/<case>`), one page per pull request or
report, and are never indexed and have no canonical (development
`src/App.tsx` `routeHead` at `8660a6121`); their addresses name only the pull
request or the case ([pay pages](./feePages.md)). A project page is titled with the project name (with
"security bounty" when its program is bounty-only), a manage page "Manage
<project>", a security program "<project> security bounty", a cycle "<project>
<cycle> cycle" and a profile with the login, each at its canonical slug or
path. An unknown route, an unknown project, a missing cycle, and any page
while a not-found view is mounted, are `noindex` with no canonical. The head
is rendered as hoisted React elements, without an effect hook. The production Pages Function also rewrites the
served `/sponsors` head with its own share title ("Fund a project · Slop"),
headline, description, canonical and share image, and serves the shell
unchanged when it no longer matches (development `functions/index.ts`). The
route is
the [app shell](../app/index.md)'s; each of its route kinds is one
[navigation](./navigation.md) page, and only the unknown route is Gone.

```quint
import app as A from "../app"
import navigation as N from "./navigation"
type RouteHead = { titleName: str, canonical: str, indexed: bool }
pure def pageOf(kind: A::RouteKind): N::Page =
  if (kind == A::Home) N::Home else if (kind == A::HowItWorks) N::HowItWorks else if (kind == A::Sponsors) N::Sponsors
  else if (kind == A::CycleArchive) N::CycleArchive else if (kind == A::Cycle) N::Cycle else if (kind == A::Points) N::Rankings
  else if (kind == A::Account) N::Settings else if (kind == A::Login) N::Login else if (kind == A::Earnings) N::Payouts
  else if (kind == A::Inbox) N::Inbox else if (kind == A::Admin) N::Administration else if (kind == A::NewProject) N::AddProject
  else if (kind == A::VettingEvidence) N::VettingEvidence else if (kind == A::SecurityCases) N::SecurityCases
  else if (kind == A::Project) N::Project else if (kind == A::ManageProject) N::ManageProject
  else if (kind == A::SecurityProgram) N::SecurityProgram else if (kind == A::Profile) N::Profile
  else if (kind == A::Fee) N::SubmissionFee else if (kind == A::FeeReport) N::ReportDeposit
  else N::Gone
pure def privateTitle(kind: A::RouteKind): str =
  if (kind == A::Account) "Account" else if (kind == A::Login) "Log in" else if (kind == A::Earnings) "Your payouts"
  else if (kind == A::Inbox) "Inbox" else if (kind == A::Admin) "Admin"
  else if (kind == A::VettingEvidence) "Private vetting evidence" else if (kind == A::SecurityCases) "Security cases"
  else ""
pure def staticTitle(kind: A::RouteKind): str =
  if (kind == A::Home) "Slop: ship and maintain open source" else if (kind == A::HowItWorks) "How it works"
  else if (kind == A::Sponsors) "Fund a project" else if (kind == A::CycleArchive) "Cycle archive"
  else if (kind == A::Points) "Contributors" else if (kind == A::NewProject) "Add a project"
  else ""
pure def payTitle(kind: A::RouteKind): str =
  if (kind == A::Fee) "Submission fee" else if (kind == A::FeeReport) "Report deposit" else ""
pure def canonicalPath(kind: A::RouteKind): str =
  if (kind == A::Home) "/" else if (kind == A::HowItWorks) "/how-it-works" else if (kind == A::Sponsors) "/sponsors"
  else if (kind == A::CycleArchive) "/cycles" else if (kind == A::Points) "/points" else if (kind == A::Account) "/account"
  else if (kind == A::Login) "/login" else if (kind == A::Earnings) "/earnings" else if (kind == A::Inbox) "/inbox"
  else if (kind == A::Admin) "/admin" else if (kind == A::NewProject) "/projects/new"
  else if (kind == A::VettingEvidence) "/vetting-evidence" else if (kind == A::SecurityCases) "/security"
  else if (kind == A::Project) "/projects/:project" else if (kind == A::ManageProject) "/projects/:project/manage"
  else if (kind == A::SecurityProgram) "/projects/:project/security" else if (kind == A::Cycle) "/cycles/:project/:cycle"
  else if (kind == A::Profile) "/contributors/:login"
  else ""
pure def recordKind(kind: A::RouteKind): bool =
  kind == A::Project or kind == A::ManageProject or kind == A::SecurityProgram or kind == A::Cycle or kind == A::Profile
pure val notFoundHead: RouteHead = { titleName: "Page not found", canonical: "", indexed: false }
pure def routeHead(route: A::Route, recordFound: bool, recordName: str): RouteHead =
  val kind = route.kind
  if (privateTitle(kind) != "") { titleName: privateTitle(kind), canonical: canonicalPath(kind), indexed: true }
  else if (staticTitle(kind) != "") { titleName: staticTitle(kind), canonical: canonicalPath(kind), indexed: true }
  else if (payTitle(kind) != "") { titleName: payTitle(kind), canonical: "", indexed: false }
  else if (recordKind(kind) and recordFound and recordName != "") { titleName: recordName, canonical: canonicalPath(kind), indexed: true }
  else notFoundHead
pure def lawOnlyTheUnknownRouteIsGone(kind: A::RouteKind): bool = (pageOf(kind) == N::Gone) iff (kind == A::Unknown)
pure def lawPrivateHeadNamesNoRecord(route: A::Route, recordName: str, otherName: str): bool =
  privateTitle(route.kind) != "" implies routeHead(route, true, recordName) == routeHead(route, true, otherName)
pure def lawMissingPageIsNotIndexed(route: A::Route, recordName: str): bool =
  (recordKind(route.kind) or route.kind == A::Unknown) implies routeHead(route, false, recordName) == notFoundHead
pure def lawIndexedHeadHasCanonical(route: A::Route, recordFound: bool, recordName: str): bool =
  routeHead(route, recordFound, recordName).indexed iff routeHead(route, recordFound, recordName).canonical != ""
pure def lawPayPagesAreNeverIndexed(route: A::Route, recordFound: bool, recordName: str): bool =
  (route.kind == A::Fee or route.kind == A::FeeReport) implies
    (not(routeHead(route, recordFound, recordName).indexed) and routeHead(route, recordFound, recordName).titleName == payTitle(route.kind))
pure val routeValues = Set(A::page(A::Account), A::page(A::Home), A::page(A::Unknown), { ...A::page(A::Project), projectId: "eliza" },
  { ...A::page(A::Profile), login: "alice" }, { ...A::page(A::Cycle), projectId: "eliza", cycleId: "2026-11" },
  { ...A::page(A::Fee), owner: "octocat", repo: "slop", number: "7" }, { ...A::page(A::FeeReport), caseId: "sc_abcdefgh" })
pure val recordNameValues = Set("", "eliza", "alice")
pure val otherNameValues = Set("", "bob")
```
