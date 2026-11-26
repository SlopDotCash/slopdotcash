# App

The Slop application in `apps/app`: the route shell every page of the product
renders in. It reads the address the browser opened and names the one page it
shows, with the project, cycle or contributor the address carries. The pages
themselves and the machines they drive are the [frontend](../frontend/) specs;
which page an address opens is decided here, and nowhere else.

## Story: Open a page by its address

> As a visitor, I want every Slop address, including an old one, to open the
> page it names, and an address that names nothing to say so, so that a link
> never strands me.

### The shell shows one route, opened from the address

The shell starts on the home page. The browser hands it the path's segments,
already split at `/`, without empty ones, and percent-decoded, so a trailing
slash changes nothing; whether the query carries `x` (the X connection's
return to `/points`); and whether the hash is `#security-settings`. A path
that does not decode opens the unknown page.

```quint
type RouteKind = Home | HowItWorks | Sponsors | CycleArchive | Cycle | Points | Account | Login | Earnings | Inbox |
  Admin | NewProject | VettingEvidence | SecurityCases | Project | ManageProject | SecurityProgram | Profile |
  Fee | FeeReport | Requested | Unknown
type Route = { kind: RouteKind, projectId: str, cycleId: str, login: str, owner: str, repo: str, number: str, caseId: str }
type Shell = { route: Route, opened: int }

pure def page(kind: RouteKind): Route =
  { kind: kind, projectId: "", cycleId: "", login: "", owner: "", repo: "", number: "", caseId: "" }
pure val initial: Shell = { route: page(Home), opened: 0 }

pure def canOpen(s: Shell, segments: List[str]): bool = segments.every(segment => segment != "")
pure def open(s: Shell, segments: List[str], withX: bool, securitySettings: bool): Shell =
  { route: parse(segments, withX, securitySettings), opened: s.opened + 1 }
pure def openUndecodable(s: Shell): Shell = { route: page(Unknown), opened: s.opened + 1 }
```

### An old address opens the page that replaced it

`/wallet` is the account's wallets, a project's `funding` and `awards`
sections are the project page itself, and a project's settings opened at
`#security-settings` are its security program. The other hashes development
adds or keeps on these redirects only scroll to a section of the page the
route already names, so they are not part of the route.

```quint
pure def canonical(segments: List[str], securitySettings: bool): List[str] =
  val third = segments.nthOr(2, "")
  if (segments == List("wallet")) List("account")
  else if (segments.length() == 3 and segments.nthOr(0, "") == "projects" and third == "manage" and securitySettings)
    List("projects", segments.nthOr(1, ""), "security")
  else if (segments.length() == 3 and segments.nthOr(0, "") == "projects" and (third == "funding" or third == "awards"))
    List("projects", segments.nthOr(1, ""))
  else segments
```

### Each address names exactly one route kind, and an address that names none is unknown

Each kind is a pattern of the canonical segments. No two patterns overlap,
and the parser returns the one that matches.

Slopbot's fee comment links a pull request's submission fee at
`/fee/<owner>/<repo>/<number>`, and the Inbox links a report's deposit at
`/fee/report/<case>`; neither page needs an account. The shell matches them
by shape alone, three segments `fee`, `report` and the case, or four
segments beginning `fee`, and hands the page its segments as they are:
whether they name a pull request (a GitHub login, a repository name of 1 to
100 letters, digits, `.`, `_` and `-` other than `.` and `..`, a number of 1
to 10 digits without a leading zero) or a case (`sc_` and 8 to 72 letters,
digits, `_` and `-`) is the page's to say, as "This address does not name a
pull request" or "This address does not name a report", not the unknown
page.

`/requested` opens the Requested repos page, whose `?flag=<owner>/<name>`
query is the page's to read, not the shell's.

```quint
pure def namedKind(segment: str): RouteKind =
  if (segment == "how-it-works") HowItWorks else if (segment == "sponsors") Sponsors
  else if (segment == "cycles") CycleArchive else if (segment == "account") Account else if (segment == "login") Login
  else if (segment == "earnings") Earnings else if (segment == "inbox") Inbox else if (segment == "admin") Admin
  else if (segment == "vetting-evidence") VettingEvidence else if (segment == "security") SecurityCases
  else if (segment == "requested") Requested else Unknown
pure def namedPage(segment: str, kind: RouteKind): bool = kind != Unknown and namedKind(segment) == kind

pure def matchesKnown(kind: RouteKind, segments: List[str], withX: bool, securitySettings: bool): bool =
  val path = canonical(segments, securitySettings)
  val n = path.length()
  val first = path.nthOr(0, "")
  val second = path.nthOr(1, "")
  val third = path.nthOr(2, "")
  if (kind == Home) n == 0
  else if (kind == Points) n == 1 and first == "points" and not(withX)
  else if (kind == Account) n == 1 and (namedPage(first, Account) or (first == "points" and withX))
  else if (kind == Admin) (n == 1 and namedPage(first, Admin)) or (n == 3 and first == "admin" and second == "applications")
  else if (kind == NewProject) n == 2 and first == "projects" and second == "new"
  else if (kind == Project) n == 2 and first == "projects" and second != "new"
  else if (kind == ManageProject) n == 3 and first == "projects" and third == "manage"
  else if (kind == SecurityProgram) n == 3 and first == "projects" and third == "security"
  else if (kind == Profile) n == 2 and first == "contributors"
  else if (kind == Cycle) n == 3 and first == "cycles"
  else if (kind == FeeReport) n == 3 and first == "fee" and second == "report"
  else if (kind == Fee) n == 4 and first == "fee"
  else if (kind == Unknown) false
  else n == 1 and namedPage(first, kind)

pure val knownKinds = List(Home, HowItWorks, Sponsors, CycleArchive, Cycle, Points, Account, Login, Earnings, Inbox, Admin,
  NewProject, VettingEvidence, SecurityCases, Project, ManageProject, SecurityProgram, Profile, Fee, FeeReport,
  Requested)
pure def kindMatches(kind: RouteKind, segments: List[str], withX: bool, securitySettings: bool): bool =
  if (kind == Unknown) not(knownKinds.some(known => matchesKnown(known, segments, withX, securitySettings)))
  else matchesKnown(kind, segments, withX, securitySettings)

pure def parse(segments: List[str], withX: bool, securitySettings: bool): Route =
  val path = canonical(segments, securitySettings)
  val n = path.length()
  val first = path.nthOr(0, "")
  val second = path.nthOr(1, "")
  val third = path.nthOr(2, "")
  if (n == 0) page(Home)
  else if (n == 1 and first == "points") page(if (withX) Account else Points)
  else if (n == 1) page(namedKind(first))
  else if (n == 3 and first == "admin" and second == "applications") page(Admin)
  else if (n == 2 and first == "projects") (if (second == "new") page(NewProject) else { ...page(Project), projectId: second })
  else if (n == 3 and first == "projects" and third == "manage") { ...page(ManageProject), projectId: second }
  else if (n == 3 and first == "projects" and third == "security") { ...page(SecurityProgram), projectId: second }
  else if (n == 2 and first == "contributors") { ...page(Profile), login: second }
  else if (n == 3 and first == "cycles") { ...page(Cycle), projectId: second, cycleId: third }
  else if (n == 3 and first == "fee" and second == "report") { ...page(FeeReport), caseId: third }
  else if (n == 4 and first == "fee") { ...page(Fee), owner: second, repo: third, number: path.nthOr(3, "") }
  else page(Unknown)

pure def lawEachAddressNamesOneKind(kind: RouteKind, segments: List[str], withX: bool, securitySettings: bool): bool =
  (parse(segments, withX, securitySettings).kind == kind) iff kindMatches(kind, segments, withX, securitySettings)
```

### A route carries exactly the identifiers its page needs

A project page, its settings and its security program carry the project, a
cycle carries its project and its id, a profile carries the login, a
submission fee carries the owner, repository and number, and a report's
deposit carries the case. No other route carries any.

```quint
pure def needsProject(kind: RouteKind): bool = kind == Project or kind == ManageProject or kind == SecurityProgram or kind == Cycle
pure def alwaysRouteCarriesItsIdentifiers(s: Shell): bool =
  (s.route.projectId != "" iff needsProject(s.route.kind)) and (s.route.cycleId != "" iff s.route.kind == Cycle) and
  (s.route.login != "" iff s.route.kind == Profile) and (s.route.owner != "" iff s.route.kind == Fee) and
  (s.route.repo != "" iff s.route.kind == Fee) and (s.route.number != "" iff s.route.kind == Fee) and
  (s.route.caseId != "" iff s.route.kind == FeeReport)
pure def alwaysOpenedIsNonnegative(s: Shell): bool = s.opened >= 0
```

### Every opening shows a page

```quint
pure def stepOpensOnePage(before: Shell, after: Shell): bool = after.opened == before.opened + 1
```

### Every kind of page can be reached

```quint
pure def sometimesCycle(s: Shell): bool = s.route.kind == Cycle
pure def sometimesProjectSecurity(s: Shell): bool = s.route.kind == SecurityProgram
pure def sometimesAccountFromX(s: Shell): bool = s.route.kind == Account and s.opened > 0
pure def sometimesUnknown(s: Shell): bool = s.route.kind == Unknown
pure def sometimesProfile(s: Shell): bool = s.route.kind == Profile
pure def sometimesFee(s: Shell): bool = s.route.kind == Fee
pure def sometimesFeeReport(s: Shell): bool = s.route.kind == FeeReport
pure def sometimesRequested(s: Shell): bool = s.route.kind == Requested
pure val segmentsValues = Set(
  List("fee", "octocat", "slop", "7"), List("fee", "report", "sc_abcdefgh"), List("fee", "report"), List("fee", "octocat", "slop"),
  List(), List("points"), List("wallet"), List("security"), List("cycles"), List("how-it-works"), List("projects"),
  List("projects", "new"), List("projects", "slop"), List("projects", "slop", "manage"), List("projects", "slop", "security"),
  List("projects", "slop", "awards"), List("projects", "new", "funding"), List("admin", "applications", "7"),
  List("contributors", "octocat"), List("cycles", "slop", "2026-11"), List("cycles", "slop"), List("projects", ""),
  List("requested"), List("requested", "x"))
```
