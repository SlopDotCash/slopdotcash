# Retained production data freshness

An explicit manual production release may retain its own published snapshot
instead of collecting (`use_published_data`, [release run](../operations/release.md),
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
is false for any time that is not one.

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
  r.dataKind == R::RetainedSnapshot and r.phase != R::Superseded and mode == RR::NormalRun
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

Preparation is grouped per pull request or ref and event, and only a pull
request cancels a running preparation. A manual dispatch on `main` with
`use_published_data` adds the suffix `-retained` to its group, so it can
prepare beside a live collection of the same ref; the publication lock is
unchanged.

```quint
pure def retainedPreparationGroup(eventKind: R::RefKind, branch: str, usePublishedData: bool): bool =
  eventKind == R::WorkflowDispatch and branch == "main" and usePublishedData
pure def cancelsRunningPreparation(eventKind: R::RefKind): bool = eventKind == R::PullRequestRef
pure def lawOnlyManualMainRetainedSeparates(eventKind: R::RefKind, branch: str, usePublishedData: bool): bool =
  retainedPreparationGroup(eventKind, branch, usePublishedData) implies
    (eventKind == R::WorkflowDispatch and not(cancelsRunningPreparation(eventKind)))
pure val branchValues = Set("main", "development")
```
