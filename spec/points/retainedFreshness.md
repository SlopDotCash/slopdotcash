# Retained production data freshness

An explicit manual production or staging release may retain its own
published snapshot instead of collecting (`use_published_data`, [release run](../operations/release.md),
"Normal releases need verified registry and GitHub collections for this
environment"). Development at df21e37b7 also refuses a retained snapshot
that is older than what production serves now, and lets such a run prepare
beside a live collection: `scripts/check-retained-release-data.ts`, the
`prepare` concurrency group and the "Refuse older retained production data"
step of `.github/workflows/deploy.yml`, and the retained-data note of
`formal/models/release/release_publication.qnt` (commits 781d3af0f and
2754336e8). Generation times are the `generatedAt` of the retained bundle's
leaderboard and profiles and of the ones `https://slop.cash` serves, each
parsed by the shell as an exact canonical UTC time in milliseconds; `valid`
is false for any time that is not one. At `67fd54fd4` the freshness check is
a step of the production `deploy` job only: a retained staging release from
`development` is not compared with what staging serves.

## Story: A retained release never moves production back to older data

### A retained snapshot is refused when its leaderboard or profiles were generated before production's current ones

Both times of both sides must be valid; an invalid time refuses. Equal times
pass. The check runs once the run holds the production lock and before its
first service write, so nothing is written for a refused snapshot; the
release step skips it only for a superseded run and for a run that rotates
the Robinhood or fee Solana RPC endpoint. That it runs inside the lock and
before the writes is a composition obligation of the release run.

```quint
import release as R from "../operations/release"
import rpcRotationRun as RR from "../operations/rpcRotationRun"
type GenerationTime = { valid: bool, millis: int }
type SnapshotTimes = { leaderboard: GenerationTime, profiles: GenerationTime }
pure def notOlder(kept: GenerationTime, served: GenerationTime): bool =
  kept.valid and served.valid and kept.millis >= served.millis
pure def retainedCurrent(retained: SnapshotTimes, published: SnapshotTimes): bool =
  notOlder(retained.leaderboard, published.leaderboard) and notOlder(retained.profiles, published.profiles)
pure def freshnessChecked(r: R::Release, mode: RR::RunMode): bool =
  r.environment == R::Production and r.dataKind == R::RetainedSnapshot and r.phase != R::Superseded and mode == RR::NormalRun
pure def lawOlderRetainedRefused(retained: SnapshotTimes, published: SnapshotTimes): bool =
  (retained.leaderboard.millis < published.leaderboard.millis or retained.profiles.millis < published.profiles.millis)
    implies not(retainedCurrent(retained, published))
pure def lawInvalidTimeRefused(retained: SnapshotTimes, published: SnapshotTimes): bool =
  not(retained.leaderboard.valid and retained.profiles.valid and published.leaderboard.valid and published.profiles.valid)
    implies not(retainedCurrent(retained, published))
pure def lawSameGenerationPasses(retained: SnapshotTimes): bool =
  (retained.leaderboard.valid and retained.profiles.valid) implies retainedCurrent(retained, retained)
pure val retainedValues = Set(
  { leaderboard: { valid: true, millis: 2 }, profiles: { valid: true, millis: 2 } },
  { leaderboard: { valid: true, millis: 1 }, profiles: { valid: true, millis: 3 } },
  { leaderboard: { valid: false, millis: 2 }, profiles: { valid: true, millis: 2 } })
pure val publishedValues = Set(
  { leaderboard: { valid: true, millis: 2 }, profiles: { valid: true, millis: 2 } },
  { leaderboard: { valid: true, millis: 1 }, profiles: { valid: false, millis: 1 } })
```

### A manual main release on retained data prepares in its own concurrency group

Preparation (the `prepare` job's concurrency group
`slop-quality-<pull request number or ref>-<lane>` in
`.github/workflows/deploy.yml`) is grouped per pull request, and per ref and
event elsewhere, and only a pull request cancels a running preparation. On
`main`, every run that is not a pull request shares one of three lanes: every
fresh collection, a push, a schedule or a manual dispatch, shares the
`collect` lane, because they spend one collector App allowance and a second
waits for the first (operator decision, 19 November 2026); a run with
`use_published_data` takes the `retained` lane, so it can prepare beside a
live collection; a run with `parallel_collection` (a manual input, false on
every other run) and without `use_published_data` takes the
`collect-parallel` lane and collects on a GitHub-hosted runner beside a
running collection (operator decision, 20 November 2026; main 18d909f0c,
development 7f71c6ce9). Only a fresh main collection outside a pull request,
without `use_published_data` or `parallel_collection`, runs on the
configured collector runner (`vars.SLOP_COLLECTOR_RUNNER`, main 31f766f7d);
every other preparation, and every one while the variable is unset (main PRD
section 9, 22 November 2026), runs on a GitHub-hosted runner
(`ubuntu-24.04`). A preparation on the collector runner has a 72,000-second
collection deadline (`SLOP_COLLECTION_DEADLINE_S`) and a 1,440-minute job
timeout; every other one 19,200 seconds and 360 minutes. The publication
lock is unchanged.

```quint
type PrepLane = PullRequestLane | MainCollect | MainCollectParallel | MainRetained | RefEvent
pure def preparationLane(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool): PrepLane =
  if (eventKind == R::PullRequestRef) PullRequestLane
  else if (branch == "main") (if (usePublishedData) MainRetained else if (parallel) MainCollectParallel else MainCollect)
  else RefEvent
pure def collectorRunner(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool, configured: bool): bool =
  configured and eventKind != R::PullRequestRef and branch == "main" and not(usePublishedData) and not(parallel)
pure def cancelsRunningPreparation(eventKind: R::RefKind): bool = eventKind == R::PullRequestRef
pure def lawOnlyRetainedMainSeparates(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool): bool =
  preparationLane(eventKind, branch, usePublishedData, parallel) == MainRetained implies
    (branch == "main" and usePublishedData and not(cancelsRunningPreparation(eventKind)))
pure def lawFreshMainCollectionsShareOneLane(eventKind: R::RefKind): bool =
  eventKind != R::PullRequestRef implies
    preparationLane(eventKind, "main", false, false) == preparationLane(R::BranchPush, "main", false, false)
pure def lawRetainedNeverSharesFreshLane(eventKind: R::RefKind, otherKind: R::RefKind, parallel: bool, otherParallel: bool): bool =
  preparationLane(eventKind, "main", true, parallel) != preparationLane(otherKind, "main", false, otherParallel) or
    eventKind == R::PullRequestRef
pure def lawParallelLaneOnlyForParallelFreshMain(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool): bool =
  preparationLane(eventKind, branch, usePublishedData, parallel) == MainCollectParallel implies
    (branch == "main" and parallel and not(usePublishedData) and not(cancelsRunningPreparation(eventKind)))
pure def lawParallelOrRetainedNeverUsesCollectorRunner(eventKind: R::RefKind, branch: str, usePublishedData: bool,
  parallel: bool, configured: bool): bool =
  (usePublishedData or parallel or not(configured)) implies not(collectorRunner(eventKind, branch, usePublishedData, parallel, configured))
pure def lawCollectorRunnerOnlyInCollectLane(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool): bool =
  collectorRunner(eventKind, branch, usePublishedData, parallel, true) implies
    preparationLane(eventKind, branch, usePublishedData, parallel) == MainCollect
pure def lawOnlyPullRequestLaneCancels(eventKind: R::RefKind, branch: str, usePublishedData: bool, parallel: bool): bool =
  cancelsRunningPreparation(eventKind) iff preparationLane(eventKind, branch, usePublishedData, parallel) == PullRequestLane
pure val branchValues = Set("main", "development")
```
