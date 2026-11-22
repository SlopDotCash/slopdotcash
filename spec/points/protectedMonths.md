# Protected project months

PRD section 7, operator decisions of 20 and 21 November 2026: the Points of a
project month with a recorded payment are frozen. The atomic Points import
(`pointsSql` in `scripts/generate-points.ts`) refuses a whole staged batch
with a new revision that would change such an award, by the settlement
predicate of [periods](./periods.md) ("Direct transfers, owner allocation
changes and unmapped legacy obligations also freeze their project-months").
So that one frozen month does not stop every later collection, the generator
holds exactly the candidate revisions that import would refuse and publishes
the rest; the import guard stays, so a month the generator did not know of
still fails closed there. This library is that hold
(`holdProtectedPointAwards`), the generator's private read of the protected
months (`scripts/points-protection-read.ts`) and the operator route that
answers it (`backend/payments/protected-point-months.ts`), after the legacy
`api_protected_point_months` model. A month is the UTC month of the award's
occurrence ([periods](./periods.md), `periodOf`).

## Story: Publish a fresh collection without changing a paid month

### A candidate holds every new revision that would change a protected project month

The protected scopes are the project months of the committed list
`data/points/protected-months.json` (an array of `{ projectId, period }`
with exactly those two keys, a non-empty project id and a `YYYY-MM` period,
or the release stops with `Invalid protected Points months`), plus, when the
private read answered, its months and its projects protected in every month.
A refused, failed or invalid read, or one that is not configured, leaves the
committed list alone and never fewer months; a failed read logs one warning
(`[points] private protected-months read failed (<reason>); holding by
data/points/protected-months.json only`) whose reason is a fixed phrase, a
status or an error class, and nothing prints the months or their count.

The hold runs only in a release that loaded the published history, after the
snapshots are applied and again after the retained reviews and penalties, and
logs `[points] held <n> candidate revisions in months with a recorded
payment`. In journal order, a revision already published is kept; a revision
whose predecessor was held is held; a payout-received revision is kept;
otherwise a revision is held when its economic identity (key, actor, project,
category, amount, occurrence, source, work unit, and for a substantive review
its provisional mark, for a substantive review or an evaluated contribution
its source URL) differs from its published predecessor's, or it has no
published predecessor, and its own award or that predecessor's lies in a
protected scope. Everything not held publishes.

```quint
import periods as P from "./periods"
import reservedAwardsFeed as F from "../settlement/reservedAwardsFeed"
type ProtectedMonth = { project: str, period: int }
type Protection = { months: List[ProtectedMonth], everyMonthProjects: List[str] }
type CandidateRevision = { id: int, previous: int, payoutReceived: bool, economic: str, project: str, occurredAt: int }
type ProtectionReadResult = ReadNotConfigured | ReadFailed | ReadAnswered
type PrivateProtectionRead = { result: ProtectionReadResult, months: List[ProtectedMonth], everyMonthProjects: List[str] }
pure val noRevision: CandidateRevision = { id: 0, previous: 0, payoutReceived: false, economic: "", project: "", occurredAt: 0 }
pure def resolvedProtection(committed: List[ProtectedMonth], privateRead: PrivateProtectionRead): Protection =
  if (privateRead.result == ReadAnswered)
    { months: committed.concat(privateRead.months.select(m => not(committed.includes(m)))),
      everyMonthProjects: privateRead.everyMonthProjects }
  else { months: committed, everyMonthProjects: List() }
pure def protects(scopes: Protection, r: CandidateRevision): bool =
  scopes.everyMonthProjects.includes(r.project) or
  scopes.months.includes({ project: r.project, period: P::periodOf(r.occurredAt) })
pure def isPublished(known: List[CandidateRevision], id: int): bool = known.some(k => k.id == id)
pure def publishedPredecessor(known: List[CandidateRevision], r: CandidateRevision): CandidateRevision =
  known.foldl(noRevision, (acc, k) => if (r.previous > 0 and k.id == r.previous) k else acc)
pure def holdsRevision(known: List[CandidateRevision], scopes: Protection, held: List[int], r: CandidateRevision): bool =
  val prior = publishedPredecessor(known, r)
  not(isPublished(known, r.id)) and
    ((r.previous > 0 and held.includes(r.previous)) or
     (not(r.payoutReceived) and not(prior.id > 0 and prior.economic == r.economic) and
       (protects(scopes, r) or (prior.id > 0 and protects(scopes, prior)))))
pure def heldRevisions(known: List[CandidateRevision], scopes: Protection, candidates: List[CandidateRevision]): List[int] =
  candidates.foldl(List(), (acc, r) => if (holdsRevision(known, scopes, acc, r)) acc.append(r.id) else acc)
pure def publishedCandidates(known: List[CandidateRevision], scopes: Protection,
  candidates: List[CandidateRevision]): List[CandidateRevision] =
  val held = heldRevisions(known, scopes, candidates)
  candidates.select(r => not(held.includes(r.id)))
pure def lawUnionKeepsCommitted(committed: List[ProtectedMonth], privateRead: PrivateProtectionRead, month: ProtectedMonth): bool =
  committed.includes(month) implies resolvedProtection(committed, privateRead).months.includes(month)
pure def lawUnansweredReadUsesCommittedOnly(committed: List[ProtectedMonth], privateRead: PrivateProtectionRead): bool =
  privateRead.result != ReadAnswered implies
    resolvedProtection(committed, privateRead) == { months: committed, everyMonthProjects: List() }
pure def lawPublishedRevisionNeverHeld(known: List[CandidateRevision], scopes: Protection, held: List[int],
  r: CandidateRevision): bool =
  isPublished(known, r.id) implies not(holdsRevision(known, scopes, held, r))
pure def lawChainedRevisionHeld(known: List[CandidateRevision], scopes: Protection, held: List[int],
  r: CandidateRevision): bool =
  (not(isPublished(known, r.id)) and r.previous > 0 and held.includes(r.previous)) implies holdsRevision(known, scopes, held, r)
pure def lawUnchangedEconomicIdentityPublishes(known: List[CandidateRevision], scopes: Protection, r: CandidateRevision): bool =
  (publishedPredecessor(known, r).id > 0 and publishedPredecessor(known, r).economic == r.economic) implies
    not(holdsRevision(known, scopes, List(), r))
pure def lawUnprotectedCandidatePublishes(known: List[CandidateRevision], r: CandidateRevision): bool =
  not(holdsRevision(known, { months: List(), everyMonthProjects: List() }, List(), r))
pure def lawEveryCandidateHeldOrPublished(known: List[CandidateRevision], scopes: Protection,
  candidates: List[CandidateRevision]): bool =
  val held = heldRevisions(known, scopes, candidates)
  candidates.every(r => held.includes(r.id) or publishedCandidates(known, scopes, candidates).includes(r))
pure def lawPublishedCandidatesPassTheImportGuard(known: List[CandidateRevision], scopes: Protection,
  candidates: List[CandidateRevision]): bool =
  publishedCandidates(known, scopes, candidates).every(r => not(holdsRevision(known, scopes, List(), r)))
```

### The generator reads the protected months only from this site's own route, once, with a bounded answer

The read is configured only when the release passes both
`POINTS_PROTECTION_URL` and `POINTS_PROTECTION_TOKEN`; a URL without a token
logs that the read is not configured and asks nothing. The URL must equal
`<origin>/api/v1/operator/protected-point-months` of the site the build
publishes to, so the token is never sent anywhere else, and only in the
`Authorization: Bearer` header. One GET (Accept JSON, a 30-second timeout, a
redirect is an error, no cache) is accepted only with status 200, a body of
at most 1 MiB and exactly the answer below: `schema`, `generatedAt` (a
timestamp), `months` (each exactly `{ projectId, period }`, `YYYY-MM`) and
`everyMonthProjects`, with at most 20,000 entries in each list and project
ids of 1 to 200 characters without NUL. Anything else is a failed read.

```quint
pure val protectedMonthsPath = "/api/v1/operator/protected-point-months"
pure val protectedMonthsSchema = "slop-protected-point-months-v1"
pure val maxProtectionAnswerBytes = 1048576
pure val maxProtectionEntries = 20000
pure val maxProtectedProjectIdLength = 200
type ProtectionAnswerShape = { status: int, bytes: int, exactShape: bool, schema: str, monthEntries: int,
  projectEntries: int, longestProjectId: int }
pure def protectionReadResult(configured: bool, ownRoute: bool, answer: ProtectionAnswerShape): ProtectionReadResult =
  if (not(configured)) ReadNotConfigured
  else if (ownRoute and answer.status == 200 and answer.bytes <= maxProtectionAnswerBytes and answer.exactShape and
    answer.schema == protectedMonthsSchema and answer.monthEntries <= maxProtectionEntries and
    answer.projectEntries <= maxProtectionEntries and answer.longestProjectId <= maxProtectedProjectIdLength) ReadAnswered
  else ReadFailed
pure def lawUnconfiguredReadAsksNothing(ownRoute: bool, answer: ProtectionAnswerShape): bool =
  protectionReadResult(false, ownRoute, answer) == ReadNotConfigured
pure def lawForeignAddressFails(answer: ProtectionAnswerShape): bool =
  protectionReadResult(true, false, answer) == ReadFailed
pure def lawOnlyAnExactSmallAnswerCounts(ownRoute: bool, answer: ProtectionAnswerShape): bool =
  protectionReadResult(true, ownRoute, answer) == ReadAnswered implies
    (answer.status == 200 and answer.bytes <= maxProtectionAnswerBytes and answer.schema == protectedMonthsSchema and
      answer.monthEntries <= maxProtectionEntries and answer.projectEntries <= maxProtectionEntries)
```

### The protected-months route answers only the configured operator secret and names months and projects only

`GET` or `HEAD /api/v1/operator/protected-point-months`, with or without a
trailing slash, answers only a request whose `Authorization` is
`Bearer <POINTS_PROTECTION_TOKEN>` under the operator secret rule of the
[reserved awards feed](../settlement/reservedAwardsFeed.md) (`F::feedOpen`:
a configured secret of at least the minimum length, compared in constant
time). Without the secret, or with any other token, the request falls
through to the API's ordinary not-found answer, so the route cannot be told
apart from a path that does not exist. With the right token another method
answers 405 `method_not_allowed`, and a failed listing read answers the
API's ordinary error. The answer is `{ schema:
"slop-protected-point-months-v1", generatedAt, months: [{ projectId, period
}], everyMonthProjects: [projectId] }` with `Cache-Control: no-store`. Its
months are every project month that a monthly payment run, a monthly
allocation change or a direct transfer's contribution month names, and its
projects every project with a payment obligation no monthly obligation maps,
other than the reviewed Base qualification payment: the same tables and
clauses as the import's predicate (`protectedPointMonthsQuery`,
`protectedPointProjectsQuery` of `scripts/points-protection-sql.ts`), a row
whose month is not `YYYY-MM` or whose project id is empty or holds NUL left
out. It never carries an amount, a recipient, a wallet, a vault, a
transaction or which kind of record protects a month, and it changes no
state.

```quint
type ProtectedRouteAnswer = RouteNotFound | ProtectedListing | MethodNotAllowed | ListingUnavailable
type ProtectedListingBody = { schema: str, months: List[ProtectedMonth], everyMonthProjects: List[str] }
pure def protectedRouteAnswer(secretLength: int, presentedMatches: bool, readRequest: bool, listingRead: bool): ProtectedRouteAnswer =
  if (not(F::feedOpen(secretLength, presentedMatches))) RouteNotFound
  else if (not(readRequest)) MethodNotAllowed
  else if (listingRead) ProtectedListing
  else ListingUnavailable
pure def listingBody(scopes: Protection): ProtectedListingBody =
  { schema: protectedMonthsSchema, months: scopes.months, everyMonthProjects: scopes.everyMonthProjects }
pure def lawClosedRouteIsNotFound(readRequest: bool, listingRead: bool): bool =
  protectedRouteAnswer(0, true, readRequest, listingRead) == RouteNotFound and
    protectedRouteAnswer(64, false, readRequest, listingRead) == RouteNotFound
pure def lawWrongMethodNeedsTheSecret(secretLength: int, presentedMatches: bool, listingRead: bool): bool =
  protectedRouteAnswer(secretLength, presentedMatches, false, listingRead) == MethodNotAllowed implies
    F::feedOpen(secretLength, presentedMatches)
pure def lawListingNamesOnlyMonthsAndProjects(scopes: Protection): bool =
  listingBody(scopes).months == scopes.months and listingBody(scopes).everyMonthProjects == scopes.everyMonthProjects
```

### Simulation samples include paid months, whole projects and chained revisions

```quint
pure val paidMonth: ProtectedMonth = { project: "asi", period: 24321 }
pure val otherMonth: ProtectedMonth = { project: "feed", period: 24321 }
pure val publishedAward: CandidateRevision = { id: 1, previous: 0, payoutReceived: false, economic: "e1", project: "asi",
  occurredAt: 2432105 }
pure val changedAward: CandidateRevision = { ...publishedAward, id: 2, previous: 1, economic: "e2" }
pure val chainedAward: CandidateRevision = { ...publishedAward, id: 3, previous: 2, economic: "e3" }
pure val movedAward: CandidateRevision = { ...publishedAward, id: 4, previous: 1, economic: "e4", occurredAt: 2432205 }
pure val payoutAward: CandidateRevision = { ...publishedAward, id: 5, previous: 0, payoutReceived: true, economic: "p" }
pure val unchangedAward: CandidateRevision = { ...publishedAward, id: 6, previous: 1 }
pure val freshAward: CandidateRevision = { ...publishedAward, id: 7, previous: 0, economic: "e7", project: "eliza" }
pure val committedValues = Set(List(), List(paidMonth), List(paidMonth, otherMonth))
pure val monthValues = Set(paidMonth, otherMonth, { project: "asi", period: 24322 })
pure val privateReadValues = Set({ result: ReadNotConfigured, months: List(), everyMonthProjects: List() },
  { result: ReadFailed, months: List(otherMonth), everyMonthProjects: List("eliza") },
  { result: ReadAnswered, months: List(otherMonth), everyMonthProjects: List("eliza") },
  { result: ReadAnswered, months: List(), everyMonthProjects: List() })
pure val knownValues = Set(List(), List(publishedAward))
pure val scopesValues = Set({ months: List(), everyMonthProjects: List() }, { months: List(paidMonth), everyMonthProjects: List() },
  { months: List(), everyMonthProjects: List("eliza") })
pure val heldValues = Set(List(), List(2))
pure val rValues = Set(publishedAward, changedAward, chainedAward, movedAward, payoutAward, unchangedAward, freshAward)
pure val candidatesValues = Set(List(publishedAward, changedAward, chainedAward),
  List(publishedAward, movedAward, payoutAward, unchangedAward, freshAward))
pure val goodAnswer: ProtectionAnswerShape = { status: 200, bytes: 512, exactShape: true, schema: "slop-protected-point-months-v1",
  monthEntries: 5, projectEntries: 1, longestProjectId: 10 }
pure val answerValues = Set(goodAnswer, { ...goodAnswer, status: 404 }, { ...goodAnswer, bytes: 1048577 },
  { ...goodAnswer, exactShape: false }, { ...goodAnswer, schema: "other" }, { ...goodAnswer, monthEntries: 20001 },
  { ...goodAnswer, longestProjectId: 201 })
pure val secretLengthValues = Set(0, 31, 32, 64)
```
