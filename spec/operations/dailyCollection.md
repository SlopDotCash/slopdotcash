# Daily contribution data collection

PRD section 9 (operator decision, 19 November 2026): published contribution
data refreshes itself once a day. The source is development's
`.github/workflows/daily-collection.yml` (07:17 UTC), `scripts/daily-collection.ts`
and its model `formal/models/release/daily_collection.qnt`. The controller
reads and dispatches runs of `.github/workflows/deploy.yml` on `main` only: it
never publishes anything itself, never edits a run's data and never touches a
run that is not a trusted main release. Its `start` command runs on the daily
schedule; its `follow-up <run id>` command runs after each main release. Every
release it dispatches asks for `skip_proofs` and `skip_browser_tests`; the
[release](./release.md) still checks everything else, and a retained-data
release still refuses data older than the live site
([retained freshness](../points/retainedFreshness.md)). A push release's
collection shares the release workflow's one fresh-collection lane, so it is
the same `collecting` fact here. Ticks stand for days and data generation
times are tick numbers; another release may publish newer data at any time.
GitHub retries, polling intervals and the dispatch App token are the shell's.

## Story: Keep published contribution data fresh without a person watching it

> As the operator, I want contribution data to refresh every day, a
> superseded collection to still reach the site and a failed one to resume,
> without anyone watching the runs.

### A daily tick starts one fresh collection only when none runs

A collection runs while the monthly close on `main` has not completed, or a
trusted main release has not completed its "Prepare checked browser bundle"
job. `start` waits up to 30 minutes, polling every 2, for no collection to
run, then dispatches one fresh collection; otherwise it skips the day. A day
that dispatches starts a new resume chain. At most two collections are
dispatched per day: the fresh one and one resume; the retained-data releases
that publish a superseded collection collect nothing and are counted by the
next rule.

```quint
type DailyCollection = { tick: int, collecting: bool, collectedAt: int, live: int, peak: int, pendingPublish: bool,
  attempts: int, pendingResume: bool, resumedThisChain: bool, chainResumes: int, dispatches: int, published: int }
pure val initial: DailyCollection = { tick: 0, collecting: false, collectedAt: 0, live: 0, peak: 0, pendingPublish: false,
  attempts: 0, pendingResume: false, resumedThisChain: false, chainResumes: 0, dispatches: 0, published: 0 }
pure val startQuietMinutes = 30
pure val startPollMinutes = 2
pure def canDailyTick(d: DailyCollection): bool = d.tick >= 0
pure def dailyTick(d: DailyCollection): DailyCollection =
  if (d.collecting) { ...d, tick: d.tick + 1 }
  else { ...d, tick: d.tick + 1, collecting: true, resumedThisChain: false, chainResumes: 0, dispatches: d.dispatches + 1 }
pure def canFinishPublished(d: DailyCollection): bool = d.collecting
pure def finishPublished(d: DailyCollection): DailyCollection =
  val live = newestServed(d.live, d.tick)
  { ...d, collecting: false, live: live, peak: live, published: d.published + 1 }
pure def alwaysDailyCollectionBounded(d: DailyCollection): bool =
  d.tick >= 0 and d.attempts >= 0 and d.attempts <= maxPublishAttempts and d.chainResumes >= 0 and d.chainResumes <= 1
    and d.chainResumes == (if (d.resumedThisChain) 1 else 0)
    and d.live == d.peak and d.live >= 0 and d.live <= d.tick and d.collectedAt >= 0 and d.collectedAt <= d.tick
    and (d.pendingPublish implies d.attempts < maxPublishAttempts)
    and (d.pendingResume implies not(d.resumedThisChain))
    and d.dispatches >= 0 and d.dispatches <= d.tick + d.tick
    and (d.tick == 0 implies d.dispatches == 0 and not(d.collecting) and not(d.pendingResume) and not(d.resumedThisChain))
    and (d.tick > 0 implies d.dispatches + (if (d.resumedThisChain) 0 else 1) <= d.tick + d.tick)
    and d.published >= 0
pure def sometimesTickSkippedWhileCollecting(d: DailyCollection): bool = d.collecting and d.tick == 2 and d.dispatches == 1
```

### A superseded collection is published by a retained-data release at most three times and never replaces newer data

A main release whose own fresh collection succeeded but which did not publish
Pages (main moved meanwhile, or a later job failed) is published by a
retained-data release that names it in `data_from_run`. Before each attempt
the controller stops when the live site already serves this collection or a
newer one: the live profiles' generation time is at least the time the
release's "Generate live contributor profiles" step started. A publishing
release that ends other than successful or cancelled, while nothing newer is
served, has its failed jobs rerun once. A publishing release superseded
again is dispatched again, at most three attempts in all; a failure that is
not a supersession ends the follow-up. The release's freshness check
publishes only data at least as new as what is live.

```quint
pure val maxPublishAttempts = 3
pure val failedJobReruns = 1
pure def newestServed(live: int, data: int): int = if (data >= live) data else live
pure def canFinishSuperseded(d: DailyCollection): bool = d.collecting
pure def finishSuperseded(d: DailyCollection): DailyCollection =
  { ...d, collecting: false, collectedAt: d.tick, pendingPublish: true, attempts: 0 }
pure def canPublish(d: DailyCollection, superseded: bool): bool = d.pendingPublish and d.attempts < maxPublishAttempts
pure def publish(d: DailyCollection, superseded: bool): DailyCollection =
  val attempts = d.attempts + 1
  val live = newestServed(d.live, d.collectedAt)
  if (superseded) { ...d, attempts: attempts, pendingPublish: attempts < maxPublishAttempts }
  else { ...d, attempts: attempts, pendingPublish: false, live: live, peak: live, published: d.published + 1 }
pure def canOtherPublication(d: DailyCollection): bool = d.tick > 0
pure def otherPublication(d: DailyCollection): DailyCollection =
  val live = newestServed(d.live, d.tick)
  { ...d, live: live, peak: live }
pure def servedNewer(liveReadable: bool, liveAt: int, startedKnown: bool, profilesStartedAt: int): bool =
  liveReadable and startedKnown and liveAt >= profilesStartedAt
pure def stepLiveNeverOlder(before: DailyCollection, after: DailyCollection): bool = after.live >= before.live
pure def lawNewestServedNeverOlder(live: int, data: int): bool = newestServed(live, data) >= live and newestServed(live, data) >= data
pure def sometimesSupersededPublished(d: DailyCollection): bool =
  d.published > 0 and d.collectedAt > 0 and not(d.pendingPublish) and d.attempts == 1 and d.live == d.collectedAt
pure def sometimesPublishGaveUp(d: DailyCollection): bool = d.attempts == maxPublishAttempts and not(d.pendingPublish) and d.live == 0
pure def sometimesOlderNotReplaced(d: DailyCollection): bool =
  d.attempts == 1 and not(d.pendingPublish) and d.collectedAt > 0 and d.live > d.collectedAt
```

### A failed collection with a checkpoint is resumed once, never a resume of a resume

A main release whose "Generate live contribution data" step failed is
resumed when it saved its unexpired `leaderboard-discussions-<attempt>`
checkpoint and was not itself a resume (its "Restore trusted production
discussion reads" job did not succeed). The controller waits up to five
hours, polling every five minutes, for no other collection to run, and then
dispatches a fresh release naming it in `discussion_resume_run`; after five
hours it gives up with a warning. A resume chain resumes at most once.

```quint
pure val resumeQuietMinutes = 300
pure val resumePollMinutes = 5
pure def canFinishFailed(d: DailyCollection, checkpoint: bool): bool = d.collecting
pure def finishFailed(d: DailyCollection, checkpoint: bool): DailyCollection =
  { ...d, collecting: false, pendingResume: checkpoint and not(d.resumedThisChain) }
pure def canResume(d: DailyCollection): bool = d.pendingResume and not(d.collecting)
pure def resume(d: DailyCollection): DailyCollection =
  { ...d, pendingResume: false, collecting: true, resumedThisChain: true, chainResumes: d.chainResumes + 1,
    dispatches: d.dispatches + 1 }
pure def sometimesResumedOnce(d: DailyCollection): bool = d.chainResumes == 1 and not(d.pendingResume) and not(d.collecting)
pure def sometimesNewChainResumes(d: DailyCollection): bool = d.chainResumes == 1 and d.dispatches == 4
```

### A follow-up acts only on a completed trusted main release, and publishes before it resumes

A run is a trusted main release when its repository and head repository are
the workflow's own, its branch is `main`, its event a push or manual
dispatch and its path `.github/workflows/deploy.yml`. A follow-up on any
other run, or on one that has not completed, does nothing. Otherwise it reads
only the run's job and step results: exactly one "Prepare checked browser
bundle" job, whose single "Generate live contribution data" step decides
`collected` (job and step succeeded) and `collectionFailed` (step failed);
`published` is the success of the "Verify Cloudflare deployment commit
metadata" step of the "Deploy trusted production bundle" job.

```quint
type FollowedRun = { repository: str, headRepository: str, branch: str, event: str, path: str, completed: bool }
type ReleaseRead = { collected: bool, collectionFailed: bool, resumed: bool, published: bool, checkpointSaved: bool }
type FollowUp = PublishCollection | ResumeCollection | NoFollowUp
pure def trustedMainRelease(followed: FollowedRun, repository: str): bool =
  followed.repository == repository and followed.headRepository == repository and followed.branch == "main"
    and (followed.event == "push" or followed.event == "workflow_dispatch") and followed.path == ".github/workflows/deploy.yml"
pure def followUpOf(followed: FollowedRun, repository: str, release: ReleaseRead): FollowUp =
  if (not(trustedMainRelease(followed, repository) and followed.completed)) NoFollowUp
  else if (release.collected and not(release.published)) PublishCollection
  else if (release.collectionFailed and not(release.resumed) and release.checkpointSaved) ResumeCollection
  else NoFollowUp
pure def lawFollowUpOnlyTrustedCompleted(followed: FollowedRun, repository: str, release: ReleaseRead): bool =
  followUpOf(followed, repository, release) != NoFollowUp implies (trustedMainRelease(followed, repository) and followed.completed)
pure def lawResumeNeverResumedAgain(followed: FollowedRun, repository: str, release: ReleaseRead): bool =
  (release.resumed or not(release.checkpointSaved)) implies followUpOf(followed, repository, release) != ResumeCollection
pure def lawPublishedReleaseNotRepublished(followed: FollowedRun, repository: str, release: ReleaseRead): bool =
  release.published implies followUpOf(followed, repository, release) != PublishCollection
```

### Live data older than 48 hours fails the daily run

After dispatching or skipping, `start` reads the live profiles' generation
time and fails the run when it is unreadable or more than 48 hours old, so a
freeze is visible.

```quint
pure val staleLiveMillis = 172800000
pure def liveDataStale(liveReadable: bool, liveAgeMillis: int): bool = not(liveReadable) or liveAgeMillis > staleLiveMillis
pure def lawUnreadableLiveDataFails(liveAgeMillis: int): bool = liveDataStale(false, liveAgeMillis)
pure def lawFreshLiveDataPasses(liveAgeMillis: int): bool =
  (liveAgeMillis >= 0 and liveAgeMillis <= staleLiveMillis) implies not(liveDataStale(true, liveAgeMillis))
```

### Simulation samples cover trusted and untrusted runs and the stale boundary

These sets bound simulation only.

```quint
pure val trustedRun: FollowedRun = { repository: "SlopDotCash/slopdotcash", headRepository: "SlopDotCash/slopdotcash",
  branch: "main", event: "workflow_dispatch", path: ".github/workflows/deploy.yml", completed: true }
pure val followedValues = Set(trustedRun, { ...trustedRun, event: "push" }, { ...trustedRun, completed: false },
  { ...trustedRun, headRepository: "fork/slopdotcash" }, { ...trustedRun, branch: "development" },
  { ...trustedRun, event: "pull_request" }, { ...trustedRun, path: ".github/workflows/scheduled.yml" })
pure val repositoryValues = Set("SlopDotCash/slopdotcash")
pure val releaseValues = Set(
  { collected: true, collectionFailed: false, resumed: false, published: false, checkpointSaved: false },
  { collected: true, collectionFailed: false, resumed: false, published: true, checkpointSaved: false },
  { collected: false, collectionFailed: true, resumed: false, published: false, checkpointSaved: true },
  { collected: false, collectionFailed: true, resumed: true, published: false, checkpointSaved: true },
  { collected: false, collectionFailed: true, resumed: false, published: false, checkpointSaved: false },
  { collected: false, collectionFailed: false, resumed: false, published: false, checkpointSaved: false })
pure val liveAgeMillisValues = Set(-1, 0, 172800000, 172800001)
pure val liveValues = Set(0, 1, 2)
pure val dataValues = Set(0, 1, 3)
pure val liveAtValues = Set(1, 2)
pure val profilesStartedAtValues = Set(1, 2)
```
