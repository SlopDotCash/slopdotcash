# Collector App token

PRD sections 7 and 9 require the release and monthly collections to read
complete public GitHub data, and a stalled collection never publishes
([ingestion](./ingestion.md)). Every workflow of the repository shares one
`GITHUB_TOKEN` quota of 1,000 REST requests an hour, and a full collection
needs more. Operator decision, 18 November 2026: the release collection, the
profile collection and the monthly close read with a dedicated read-only
GitHub App token when one is configured (development 3edb045ee, main only
from 71e7713fd), renewed during a long collection (76ffc209f,
`scripts/github-app-token-refresh.ts`, and `scripts/github-token.ts`). This
machine is one collection's credential. The reads themselves, their retries
and quota waits stay with [ingestion](./ingestion.md) and the
[census](./census.md). Times are whole minutes from the run's clock.

## Story: Collect with a read-only App token that outlives its one-hour grant

### Only a live collection outside a pull request mints the App token, and any failure falls back to the workflow token

The App token is minted outside a pull request, on any branch, when the run
collects live data (`use_published_data` off) and the App's client ID is
configured. It is scoped to this repository with read access to contents,
issues and pull requests alone, and reads only public data. A pull request
never mints it, so a review run spends none of its quota. Minting is not
limited to `main`: a token expires an hour after it is issued whatever branch
the collection runs on, so gating renewal to `main` left every non-main live
collection with a credential it could not refresh. Without the App, or when
minting fails, the collection uses `GITHUB_TOKEN` as before. The renewal
settings (client ID, key and installation ID) reach the collector only when
the App token was minted.

```quint
type Access = NoAccess | ReadAccess | WriteAccess
type CollectorGrant = { contents: Access, issues: Access, pullRequests: Access, thisRepositoryOnly: bool }
type Credential = Undecided | WorkflowToken | AppToken
type CollectionPhase = Deciding | Collecting | CollectedAll | CollectionFailed
type CollectorRun = { phase: CollectionPhase, credential: Credential, mainLive: bool, renewal: bool, now: int,
  tokenExpiry: int, knownExpiry: int, nextAttempt: int, renewals: int, failedMints: int, requests: int,
  unauthorized: bool }
pure val tokenLifetime = 60
pure val renewBefore = 10
pure val retryAfter = 1
pure val collectorGrant: CollectorGrant = { contents: ReadAccess, issues: ReadAccess, pullRequests: ReadAccess, thisRepositoryOnly: true }
pure val initial: CollectorRun = { phase: Deciding, credential: Undecided, mainLive: false, renewal: false, now: 0,
  tokenExpiry: 0, knownExpiry: 0, nextAttempt: 0, renewals: 0, failedMints: 0, requests: 0,
  unauthorized: false }
pure def mintsAppToken(onMain: bool, pullRequest: bool, usePublishedData: bool, clientConfigured: bool): bool =
  not(pullRequest) and not(usePublishedData) and clientConfigured
pure def canChooseCredential(r: CollectorRun, onMain: bool, pullRequest: bool, usePublishedData: bool,
  clientConfigured: bool, minted: bool): bool = r.phase == Deciding
pure def chooseCredential(r: CollectorRun, onMain: bool, pullRequest: bool, usePublishedData: bool,
  clientConfigured: bool, minted: bool): CollectorRun =
  val app = mintsAppToken(onMain, pullRequest, usePublishedData, clientConfigured) and minted
  { ...r, phase: Collecting, credential: if (app) AppToken else WorkflowToken,
    mainLive: onMain and not(pullRequest) and not(usePublishedData), renewal: app,
    tokenExpiry: if (app) r.now + tokenLifetime else 0 }
pure def sameGrant(a: CollectorGrant, b: CollectorGrant): bool =
  a.contents == b.contents and a.issues == b.issues and a.pullRequests == b.pullRequests
    and a.thisRepositoryOnly == b.thisRepositoryOnly
pure def lawGrantIsReadOnly(g: CollectorGrant): bool =
  sameGrant(g, collectorGrant) implies (g.contents != WriteAccess and g.issues != WriteAccess
    and g.pullRequests != WriteAccess and g.thisRepositoryOnly)
pure def alwaysAppTokenRenewsWhereverItIsMinted(r: CollectorRun): bool =
  (r.credential == AppToken) iff r.renewal
pure def sometimesFallbackCollected(r: CollectorRun): bool =
  r.phase == CollectedAll and r.credential == WorkflowToken and r.mainLive
```

### A request carrying the original App token gets a fresh one from ten minutes before expiry

Only a request to `https://api.github.com` whose authorization is the
original token is rewritten; any other request is sent unchanged. The
collector does not know the original token's age, so the first such request
mints a fresh token, and every later one mints again from ten minutes before
the known expiry. A renewal requests the same read-only grant for this
repository. A failed mint keeps the current token and is not tried again for
one minute. A run renews or fails a mint only after it has chosen its
credential. A request sent with an expired token is refused with HTTP 401,
and the collection fails rather than publishing a partial ledger.

```quint
pure def renewalDue(r: CollectorRun): bool = r.now >= r.knownExpiry - renewBefore and r.now >= r.nextAttempt
pure def canTick(r: CollectorRun, minutes: int): bool = r.phase == Collecting and minutes > 0
pure def tick(r: CollectorRun, minutes: int): CollectorRun = { ...r, now: r.now + minutes }
pure def canRequest(r: CollectorRun, toGitHubApi: bool, mintSucceeds: bool): bool = r.phase == Collecting
pure def request(r: CollectorRun, toGitHubApi: bool, mintSucceeds: bool): CollectorRun =
  val renews = r.renewal and toGitHubApi and renewalDue(r)
  val fresh = renews and mintSucceeds
  val expiry = if (fresh) r.now + tokenLifetime else r.tokenExpiry
  val expired = r.credential == AppToken and toGitHubApi and r.now >= expiry
  { ...r, tokenExpiry: expiry, knownExpiry: if (fresh) expiry else r.knownExpiry,
    nextAttempt: if (renews and not(mintSucceeds)) r.now + retryAfter else r.nextAttempt,
    renewals: if (fresh) r.renewals + 1 else r.renewals,
    failedMints: if (renews and not(mintSucceeds)) r.failedMints + 1 else r.failedMints,
    requests: r.requests + 1, unauthorized: expired,
    phase: if (expired) CollectionFailed else Collecting }
pure def canFinishCollection(r: CollectorRun): bool = r.phase == Collecting and r.requests > 0
pure def finishCollection(r: CollectorRun): CollectorRun = { ...r, phase: CollectedAll }
pure def alwaysRenewalsOnlyForTheAppToken(r: CollectorRun): bool =
  (r.renewals > 0 or r.failedMints > 0) implies r.renewal
pure def alwaysNoMintBeforeTheCredential(r: CollectorRun): bool =
  r.phase == Deciding implies r.renewals == 0 and r.failedMints == 0
pure def alwaysCollectedNeverUnauthorized(r: CollectorRun): bool =
  (r.phase == CollectedAll implies not(r.unauthorized)) and (r.unauthorized iff r.phase == CollectionFailed)
pure def stepRenewOnlyWhenDue(before: CollectorRun, after: CollectorRun): bool =
  (after.renewals > before.renewals or after.failedMints > before.failedMints) implies renewalDue(before)
pure def stepFailedMintKeepsCurrentToken(before: CollectorRun, after: CollectorRun): bool =
  after.failedMints > before.failedMints implies after.tokenExpiry == before.tokenExpiry
pure def sometimesCollectedPastTheFirstHour(r: CollectorRun): bool =
  r.phase == CollectedAll and r.credential == AppToken and r.now >= tokenLifetime and r.renewals >= 2
pure def sometimesRetriedAfterFailedMint(r: CollectorRun): bool = r.failedMints > 0 and r.renewals > 0
pure def sometimesExpiredTokenFails(r: CollectorRun): bool = r.phase == CollectionFailed and r.credential == AppToken
pure val minutesValues = Set(1, 9, 30, 50)
pure val gValues = Set(collectorGrant, { ...collectorGrant, issues: WriteAccess })
```
