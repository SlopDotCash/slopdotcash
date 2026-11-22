# GitHub ingestion reads and leaderboard transport

PRD sections 7 and 9: public pages serve cached snapshots that background
jobs refresh, and a failed refresh never becomes an empty or partial
leaderboard. This machine represents one GitHub read in the ingestion
transport of `scripts/github-ingestion-read.ts` and the legacy
`github_ingestion_read` and `ingestion_retry` models. The legacy
`github_budget_window` model has no counterpart here: this REST read
transport keeps no request budget or window, so none is modeled here. The
live GraphQL collection keeps its own cost budget, modeled in the
[census](./census.md). The census consumes the result; the [quota
recovery](./quotaRecovery.md) collector owns the historical campaign.

Only a GET to the GitHub API is retried. A rate-limited response (403 with a
usable primary reset or Retry-After, 429, or a 403 whose JSON body has a
string `message` matching `/secondary rate limit|abuse detection/iu`; the
last two wait one minute without a hint) is retried at most five attempts in
all, and the fifth answer is returned with its status. Any other response,
including an ordinary authorization 403, is returned as it is, except that a
per-item list page (`pulls/<n>/files`, `reviews`, `comments` or `commits`,
or `issues/<n>/comments`, `events` or `timeline`, under `/repos/<owner>/<name>`
or `/repositories/<id>`) or an exact commit's pull-request association page
answering 500 is read again at most twice, and an exact commit's file page
(`commits/<sha>?per_page=100&page=<n>`) answering 422 once, waiting one
second times the number of such retries so far. The same commit file page,
when its address carries no credentials or fragment, answering 502 is also
read again at most twice on a budget of its own, waiting one second times
the number of 502 retries so far; the third 502 is returned as it is. These
page and gateway retries never count as attempts. A wait that
would reach the run's quota deadline stops the run with a checkpoint, and the
checkpoint then refuses every later read. Times and delays are integer
milliseconds from the transport's verified clock.

## Story: Read GitHub without retrying writes or inventing success

### A read classifies each response and waits only for a rate limit

```quint
type Method = Get | Write
type Origin = GitHubApi | OtherOrigin
type ReadPhase = Idle | Waiting | Returned | Checkpointed
type Page = OtherPage | ItemList | CommitPulls | CommitFiles
type Response = { status: int, primaryDelay: int, retryAfter: int, secondaryMessage: bool }
type Read = { phase: ReadPhase, method: Method, origin: Origin, page: Page, attempt: int, pageRetries: int,
  pageWait: bool, gatewayRetries: int, gatewayWait: bool, now: int, deadline: int, wakeAt: int, returnedStatus: int,
  sent: int, checkpoint: bool }
pure val maxAttempts = 5
pure val initial: Read = { phase: Idle, method: Get, origin: GitHubApi, page: OtherPage, attempt: 0, pageRetries: 0,
  pageWait: false, gatewayRetries: 0, gatewayWait: false, now: 0, deadline: 1000000, wakeAt: 0, returnedStatus: 0,
  sent: 0, checkpoint: false }
pure def retryable(r: Read): bool = r.method == Get and r.origin == GitHubApi
pure def pageRetryLimit(page: Page): int =
  if (page == ItemList or page == CommitPulls) 2 else if (page == CommitFiles) 1 else 0
pure def pageRetryStatus(page: Page): int = if (page == CommitFiles) 422 else 500
pure def pageRetried(r: Read, x: Response): bool =
  retryable(r) and r.pageRetries < pageRetryLimit(r.page) and x.status == pageRetryStatus(r.page)
pure def pageDelay(r: Read): int = 1000 * (r.pageRetries + 1)
pure def gatewayRetryLimit(page: Page): int = if (page == CommitFiles) 2 else 0
pure def gatewayRetried(r: Read, x: Response): bool =
  retryable(r) and x.status == 502 and r.gatewayRetries < gatewayRetryLimit(r.page)
pure def gatewayDelay(r: Read): int = 1000 * (r.gatewayRetries + 1)
pure def delayFor(x: Response): int =
  val hinted = if (x.primaryDelay > x.retryAfter) x.primaryDelay else x.retryAfter
  if (x.status != 403 and x.status != 429) -1
  else if (hinted > 0) hinted
  else if (x.status == 429 or x.secondaryMessage) 60000
  else -1
pure def canBegin(r: Read, method: Method, origin: Origin, page: Page): bool = r.phase == Idle and r.sent == 0 and not(r.checkpoint)
pure def begin(r: Read, method: Method, origin: Origin, page: Page): Read =
  if (method == Get and origin == GitHubApi and r.now >= r.deadline)
    { ...r, method: method, origin: origin, page: page, phase: Checkpointed, checkpoint: true }
  else { ...r, method: method, origin: origin, page: page, attempt: 1, sent: 1 }
pure def canRespond(r: Read, x: Response): bool = r.phase == Idle and r.sent > 0 and x.status >= 100 and x.primaryDelay >= 0 and x.retryAfter >= 0
pure def respond(r: Read, x: Response): Read =
  if (pageRetried(r, x))
    (if (r.now + pageDelay(r) >= r.deadline) { ...r, phase: Checkpointed, checkpoint: true }
     else { ...r, phase: Waiting, pageWait: true, wakeAt: r.now + pageDelay(r) })
  else if (gatewayRetried(r, x))
    (if (r.now + gatewayDelay(r) >= r.deadline) { ...r, phase: Checkpointed, checkpoint: true }
     else { ...r, phase: Waiting, gatewayWait: true, wakeAt: r.now + gatewayDelay(r) })
  else if (not(retryable(r)) or r.attempt >= maxAttempts or delayFor(x) < 0) { ...r, phase: Returned, returnedStatus: x.status }
  else if (r.now + delayFor(x) >= r.deadline) { ...r, phase: Checkpointed, checkpoint: true }
  else { ...r, phase: Waiting, wakeAt: r.now + delayFor(x) }
pure def canTick(r: Read, at: int): bool = at > r.now and r.phase != Returned
pure def tick(r: Read, at: int): Read = { ...r, now: at }
pure def canRetry(r: Read): bool = r.phase == Waiting and r.now >= r.wakeAt
pure def retry(r: Read): Read =
  if (r.now >= r.deadline) { ...r, phase: Checkpointed, checkpoint: true, pageWait: false, gatewayWait: false }
  else if (r.pageWait) { ...r, phase: Idle, pageWait: false, pageRetries: r.pageRetries + 1, sent: r.sent + 1 }
  else if (r.gatewayWait) { ...r, phase: Idle, gatewayWait: false, gatewayRetries: r.gatewayRetries + 1, sent: r.sent + 1 }
  else { ...r, phase: Idle, attempt: r.attempt + 1, sent: r.sent + 1 }
pure def alwaysAttemptsBounded(r: Read): bool = r.attempt >= 0 and r.attempt <= maxAttempts and
  r.pageRetries >= 0 and r.pageRetries <= pageRetryLimit(r.page) and
  r.gatewayRetries >= 0 and r.gatewayRetries <= gatewayRetryLimit(r.page) and
  r.sent == r.attempt + r.pageRetries + r.gatewayRetries and (r.sent > 0 implies r.attempt >= 1) and
  (r.pageWait implies (r.phase == Waiting and r.pageRetries < pageRetryLimit(r.page))) and
  (r.gatewayWait implies (r.phase == Waiting and r.gatewayRetries < gatewayRetryLimit(r.page))) and
  not(r.pageWait and r.gatewayWait)
pure def alwaysWritesSentOnce(r: Read): bool = not(retryable(r)) implies r.sent <= 1
pure def alwaysCheckpointFinal(r: Read): bool = r.checkpoint iff r.phase == Checkpointed
pure def alwaysWaitingRetryable(r: Read): bool = r.phase == Waiting implies
  (retryable(r) and r.attempt >= 1 and (r.pageWait or r.gatewayWait or r.attempt < maxAttempts))
pure def stepCheckpointRefusesLater(before: Read, after: Read): bool = before.checkpoint implies (after.checkpoint and after.sent == before.sent)
pure def lawAuthorizationNotRetried(primaryDelay: int, retryAfter: int, secondaryMessage: bool): bool =
  (primaryDelay <= 0 and retryAfter <= 0 and not(secondaryMessage)) implies
    delayFor({ status: 403, primaryDelay: primaryDelay, retryAfter: retryAfter, secondaryMessage: secondaryMessage }) < 0
pure def lawUnhintedLimitWaitsOneMinute(status: int): bool = status == 429 implies delayFor({ status: status, primaryDelay: 0, retryAfter: 0, secondaryMessage: false }) == 60000
pure def lawUnhintedSecondaryLimitWaitsOneMinute(status: int): bool = status == 403 implies
  delayFor({ status: status, primaryDelay: 0, retryAfter: 0, secondaryMessage: true }) == 60000
pure def sometimesRetriedThenReturned(r: Read): bool = r.phase == Returned and r.attempt > 1
pure def lawFifthLimitIsReturned(status: int): bool = status == 429 implies
  respond({ ...initial, attempt: maxAttempts, sent: maxAttempts }, { status: status, primaryDelay: 0, retryAfter: 1000, secondaryMessage: false }).phase == Returned
pure def lawFifthSecondaryLimitIsReturned(status: int): bool =
  val after = respond({ ...initial, attempt: maxAttempts, sent: maxAttempts }, { status: status, primaryDelay: 0, retryAfter: 0, secondaryMessage: true })
  status == 403 implies (after.phase == Returned and after.returnedStatus == 403)
pure def sometimesSecondAttempt(r: Read): bool = r.attempt >= 2
pure def sometimesWriteReturnedOnce(r: Read): bool = r.phase == Returned and r.method == Write and r.returnedStatus == 429
pure def sometimesCheckpointed(r: Read): bool = r.phase == Checkpointed
pure def sometimesPageRetriedThenReturned(r: Read): bool = r.phase == Returned and r.pageRetries > 0
pure def lawPageRetryKeepsAttempt(page: Page): bool =
  val after = respond({ ...initial, page: page, attempt: maxAttempts, sent: maxAttempts },
    { status: pageRetryStatus(page), primaryDelay: 0, retryAfter: 0, secondaryMessage: false })
  pageRetryLimit(page) > 0 implies (after.phase == Waiting and after.pageWait and after.wakeAt == 1000)
pure def lawOtherPageServerErrorReturned(status: int): bool =
  (status == 500 or status == 422 or status == 502) implies
    respond({ ...initial, attempt: 1, sent: 1 }, { status: status, primaryDelay: 0, retryAfter: 0, secondaryMessage: false }).phase == Returned
pure def lawGatewayRetryKeepsAttempt(gatewayRetries: int): bool =
  val after = respond({ ...initial, page: CommitFiles, attempt: maxAttempts, gatewayRetries: gatewayRetries,
    sent: maxAttempts + gatewayRetries }, { status: 502, primaryDelay: 0, retryAfter: 0, secondaryMessage: false })
  (gatewayRetries >= 0 and gatewayRetries < 2) implies
    (after.phase == Waiting and after.gatewayWait and not(after.pageWait) and after.attempt == maxAttempts and
      after.wakeAt == 1000 * (gatewayRetries + 1))
pure def lawThirdGatewayErrorReturned(pageRetries: int): bool =
  val after = respond({ ...initial, page: CommitFiles, attempt: 1, pageRetries: pageRetries, gatewayRetries: 2,
    sent: 3 + pageRetries }, { status: 502, primaryDelay: 0, retryAfter: 0, secondaryMessage: false })
  (pageRetries == 0 or pageRetries == 1) implies (after.phase == Returned and after.returnedStatus == 502)
pure def lawGatewayRetryOnlyOnCommitFiles(page: Page): bool =
  page != CommitFiles implies
    respond({ ...initial, page: page, attempt: 1, sent: 1 }, { status: 502, primaryDelay: 0, retryAfter: 0, secondaryMessage: false }).phase == Returned
pure def sometimesGatewayRetriedThenReturned(r: Read): bool = r.phase == Returned and r.gatewayRetries > 0
```

### A multi-part leaderboard is read as one content-addressed generation

The manifest names each part by its digest and size and the whole by its
digest. The reader checks the entire manifest before any part read. Every
part must match its digest and size, and the assembled bytes must match the
whole digest. A mismatch is an error, never a fallback to another copy or an
older generation. The two laws below are consequences of that acceptance
check, not further evidence: that a deployment between part reads cannot
mix generations rests on each part path being its own digest, which is a
shell obligation of the deployed reader.

```quint
type Part = { digest: int, bytes: int }
type PartsManifest = { total: int, digest: int, parts: List[Part] }
type ReadPart = { digest: int, bytes: int, content: int }
pure def manifestValid(m: PartsManifest, partSize: int): bool =
  partSize > 0 and m.total > 0 and m.digest > 0 and m.parts.length() > 0 and
  m.parts.every(p => p.digest > 0 and p.bytes > 0 and p.bytes <= partSize) and
  m.parts.foldl(0, (acc, p) => acc + p.bytes) == m.total
pure def partOf(p: ReadPart): Part = { digest: p.digest, bytes: p.bytes }
pure def partsMatch(m: PartsManifest, read: List[ReadPart]): bool = read.listMap(p => partOf(p)) == m.parts
pure def accepted(m: PartsManifest, partSize: int, read: List[ReadPart], wholeDigest: int): bool =
  manifestValid(m, partSize) and partsMatch(m, read) and wholeDigest == m.digest
pure def lawMixedGenerationRefused(m: PartsManifest, read: List[ReadPart], wholeDigest: int): bool =
  read.some(p => not(m.parts.includes(partOf(p)))) implies
    not(accepted(m, 4, read, wholeDigest))
pure def lawDigestMismatchRefused(m: PartsManifest, read: List[ReadPart], wholeDigest: int): bool =
  wholeDigest != m.digest implies not(accepted(m, 4, read, wholeDigest))
```

### Simulation samples include limits, authorization refusals and generations

```quint
pure val xValues = Set({ status: 200, primaryDelay: 0, retryAfter: 0, secondaryMessage: false },
  { status: 429, primaryDelay: 0, retryAfter: 0, secondaryMessage: false },
  { status: 403, primaryDelay: 0, retryAfter: 0, secondaryMessage: false },
  { status: 403, primaryDelay: 0, retryAfter: 0, secondaryMessage: true },
  { status: 403, primaryDelay: 5000, retryAfter: 0, secondaryMessage: false },
  { status: 429, primaryDelay: 0, retryAfter: 200000, secondaryMessage: false },
  { status: 429, primaryDelay: 0, retryAfter: 1000, secondaryMessage: false },
  { status: 500, primaryDelay: 0, retryAfter: 0, secondaryMessage: false },
  { status: 422, primaryDelay: 0, retryAfter: 0, secondaryMessage: false },
  { status: 502, primaryDelay: 0, retryAfter: 0, secondaryMessage: false })
pure val atValues = Set(1000, 2000, 3000, 4000, 5000, 60000, 1000000)
pure val statusValues = Set(403, 429, 422, 500, 502)
pure val gatewayRetriesValues = Set(-1, 0, 1, 2)
pure val pageRetriesValues = Set(0, 1)
pure val primaryDelayValues = Set(0, 5000)
pure val retryAfterValues = Set(0, 1000)
pure val secondaryMessageValues = Set(false, true)
pure val mValues = Set({ total: 6, digest: 9, parts: List({ digest: 1, bytes: 4 }, { digest: 2, bytes: 2 }) })
pure val readValues = Set(List({ digest: 1, bytes: 4, content: 1 }, { digest: 2, bytes: 2, content: 2 }),
  List({ digest: 1, bytes: 4, content: 1 }, { digest: 3, bytes: 2, content: 3 }))
pure val wholeDigestValues = Set(9, 8)
```
