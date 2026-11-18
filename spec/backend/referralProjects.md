# Public referred project list

PRD section 11, Referral program, operator decision of 14 November 2026.
`GET /api/v1/referrals/projects` is a public read of the authoritative
project registry. The route uses no session and provides no write. It returns
`slop-referred-projects-v1`, with public caching for 300 seconds on successful
responses. The request adapter recognizes the base path and its trailing
slash. The registry supplies immutable attribution and registration time.

The query (Slop development `67fd54fd4:backend/referrals/handler.ts`)
selects both non-null attribution fields and orders by creation and project
ID. It does not filter by listing or restriction: every registered project
with a recorded referrer appears, retired and restricted projects included,
with its current registry status. This follows development, as the owner
directed on 17 November 2026, and supersedes the earlier interpretation that
hid retired records. Conformance must cover a retired registry row carrying a referrer.

## Story: Read immutable referral attribution for public registrations

### The route exposes only successful public reads and fails explicitly when the registry is unavailable

The route gives a successful empty list for an empty registry. A method
outside GET and HEAD receives 405. A child path on a read receives 404.
The D1 query's failure leaves the result unavailable. The shell accepts one
ordered canonical project snapshot and omits the response body for HEAD.

```quint
type Method = Get | Head | OtherMethod
type Path = BasePath | TrailingSlash | ChildPath
type Result = Listed | MethodNotAllowed | NotFound | Unavailable
pure def publicRead(method: Method, routePath: Path, registryReady: bool): Result =
  if (method == OtherMethod) MethodNotAllowed else if (routePath == ChildPath) NotFound
  else if (registryReady) Listed else Unavailable
pure def lawMethodsAreReadOnly(method: Method, routePath: Path, registryReady: bool): bool =
  publicRead(method, routePath, registryReady) == Listed implies method == Get or method == Head
pure def lawFailedRegistryCannotList(method: Method, routePath: Path): bool =
  publicRead(method, routePath, false) != Listed
pure def responseHasBody(method: Method, routePath: Path, registryReady: bool): bool =
  method == Get and publicRead(method, routePath, registryReady) == Listed
pure def lawHeadHasNoBody(routePath: Path, registryReady: bool): bool = not(responseHasBody(Head, routePath, registryReady))
```

### Every registered project with complete immutable attribution appears, in registry order

Applications are stored separately. A paused, retired or restricted project
remains listed; the row's listing flag (`publicListing`) filters nothing.
The authoritative query supplies order by registration time, then project ID.
Filtering preserves that order and returns only the project identifier,
current registry status, registration time and paired GitHub ID/login.
No private fields are available in the output type.

```quint
type RegistryStatus = Active | Paused
type Registration = { projectId: str, status: RegistryStatus, listedAt: str, publicListing: bool, referrerId: str, referrerLogin: str }
type PublicProject = { projectId: str, status: RegistryStatus, listedAt: str, referrerId: str, referrerLogin: str }
pure def visibleReferral(row: Registration): bool = row.referrerId != "" and row.referrerLogin != ""
pure def projectProjection(row: Registration): PublicProject =
  { projectId: row.projectId, status: row.status, listedAt: row.listedAt, referrerId: row.referrerId, referrerLogin: row.referrerLogin }
pure def referredProjects(orderedRows: List[Registration]): List[PublicProject] = orderedRows.select(row => visibleReferral(row))
  .listMap(row => projectProjection(row))
pure def lawProjectionPreservesExactPublicFields(row: Registration): bool =
  projectProjection(row).projectId == row.projectId and projectProjection(row).status == row.status
    and projectProjection(row).listedAt == row.listedAt and projectProjection(row).referrerId == row.referrerId
    and projectProjection(row).referrerLogin == row.referrerLogin
pure def lawHiddenOrIncompleteRowOmitted(row: Registration): bool =
  not(visibleReferral(row)) implies referredProjects(List(row)).length() == 0
pure def lawPublicRegistrationAppears(row: Registration): bool =
  visibleReferral(row) implies referredProjects(List(row)) == List(projectProjection(row))
pure def lawFilterPreservesOrder(first: Registration, second: Registration): bool =
  referredProjects(List(first, second)) ==
    (if (visibleReferral(first)) List(projectProjection(first)) else List()).concat(
      if (visibleReferral(second)) List(projectProjection(second)) else List())
pure def lawRetiredRowWithAttributionAppears(row: Registration): bool =
  (not(row.publicListing) and row.referrerId != "" and row.referrerLogin != "") implies
    referredProjects(List(row)) == List(projectProjection(row))
pure def lawEmptyRegistryReturnsEmpty(orderedRows: List[Registration]): bool =
  orderedRows.length() == 0 implies referredProjects(orderedRows).length() == 0
```

### Simulation covers active and paused registrations, partial attribution and retirement

```quint
pure val rowValues = Set(
  { projectId: "active", status: Active, listedAt: "2026-10-01", publicListing: true, referrerId: "1", referrerLogin: "author" },
  { projectId: "paused", status: Paused, listedAt: "2026-11-01", publicListing: true, referrerId: "2", referrerLogin: "other" },
  { projectId: "retired", status: Paused, listedAt: "2026-11-01", publicListing: false, referrerId: "2", referrerLogin: "other" },
  { projectId: "incomplete", status: Active, listedAt: "2026-11-01", publicListing: true, referrerId: "2", referrerLogin: "" })
pure val firstValues = rowValues
pure val secondValues = rowValues
pure val orderedRowsValues = rowValues.map(row => List(row)).union(Set(List()))
```
