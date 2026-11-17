# Shared public snapshot ownership

PRD sections 9 and 12. The `ui_snapshot_cache` model at legacy main commit
`6b3b9d0b979f0608d87941f1146056a98513ffcf` distinguishes public cached
snapshot identity, pending transport identity and each consumer's displayed
record. This composition tracks an individual public resource key. The
[asynchronous read model](./requests.md) still owns data validation and
disposition. This cache accepts only its validated public snapshot versions.
It does not cache private records or establish source authority.

## Story: Several consumers share a public read without accepting stale completions

### Each subscriber receives a unique current read binding

`lease` is a fresh consumer subscription instance. The adapter issues a new
lease when a browser effect replaces its previous subscription. Its old
cleanup may remove only that original subscription and never clears a newer
subscription. Last-good displayed data remains when a refresh starts.

```quint
type Subscription = { consumer: int, lease: int, read: int }
type Displayed = { consumer: int, version: int }
type ReadRecord = { identity: int, pending: bool, releaseQueued: bool, aborted: bool }
type Cache = { newest: int, cacheVersion: int, reads: List[ReadRecord], active: List[Subscription], issued: List[Subscription], displayed: List[Displayed] }
pure val initial: Cache = { newest: 0, cacheVersion: 0, reads: List(), active: List(), issued: List(), displayed: List() }
pure val noRead: ReadRecord = { identity: 0, pending: false, releaseQueued: false, aborted: false }
pure def readEntry(c: Cache, read: int): ReadRecord = c.reads.select(x => x.identity == read).nthOr(0, noRead)
pure def pendingRead(c: Cache, read: int): bool = read > 0 and readEntry(c, read).pending
pure def latestBinding(c: Cache, x: Subscription): bool = not(c.issued.some(other => other.consumer == x.consumer and other.lease > x.lease))
pure def hasConsumer(c: Cache, consumer: int): bool = c.active.some(x => x.consumer == consumer and latestBinding(c, x))
pure def hasReadConsumer(c: Cache, read: int): bool = c.active.some(x => x.read == read)
pure def canBeginRead(c: Cache, read: int): bool = read > c.newest and read > 0
pure def beginRead(c: Cache, read: int): Cache = { ...c, newest: read, cacheVersion: 0,
  reads: c.reads.append({ identity: read, pending: true, releaseQueued: false, aborted: false }) }
pure def canAcquire(c: Cache, consumer: int, lease: int): bool = consumer > 0 and lease > 0 and pendingRead(c, c.newest)
  and not(c.issued.some(x => x.consumer == consumer and x.lease >= lease))
pure def acquire(c: Cache, consumer: int, lease: int): Cache = { ...c,
  active: c.active.append({ consumer: consumer, lease: lease, read: c.newest }),
  issued: c.issued.append({ consumer: consumer, lease: lease, read: c.newest }) }
pure def canCacheHit(c: Cache, consumer: int): bool = consumer > 0 and c.cacheVersion > 0 and not(hasConsumer(c, consumer))
pure def cacheHit(c: Cache, consumer: int): Cache = { ...c,
  displayed: c.displayed.select(x => x.consumer != consumer).append({ consumer: consumer, version: c.cacheVersion }) }
```

### Deferred disposal cancels transport only after the last matching consumer leaves

An effect cleanup releases its own immutable lease. A release also queues a
transport-disposal check. A replacement effect can join the same pending read
before that check and keep it alive. A displaced older cleanup can request
that check, while the binding of any newer subscriber stays untouched.

```quint
pure def canRelease(c: Cache, consumer: int, lease: int, read: int): bool =
  pendingRead(c, read) and consumer > 0 and lease > 0 and
    c.active.some(x => x.consumer == consumer and x.lease == lease and x.read == read)
pure def release(c: Cache, consumer: int, lease: int, read: int): Cache = { ...c,
  active: c.active.select(x => not(x.consumer == consumer and x.lease == lease and x.read == read)),
  reads: c.reads.listMap(x => if (x.identity == read) { ...x, releaseQueued: true } else x) }
pure def canFlushRelease(c: Cache, read: int): bool = pendingRead(c, read) and readEntry(c, read).releaseQueued
pure def flushRelease(c: Cache, read: int): Cache = { ...c,
  reads: c.reads.listMap(x => if (x.identity == read) { ...x, releaseQueued: false,
    pending: hasReadConsumer(c, read), aborted: not(hasReadConsumer(c, read)) } else x) }
```

### A stale response can update only its still-owned view and never replace the current cache

Only a successful validated result with a still-present subscriber may update
this cache. Failed refreshes retain previously displayed rows. An aborted
transport never updates either destination. A superseded transport can
complete an older consumer binding while the newest cache stays unchanged.

```quint
pure def canComplete(c: Cache, read: int, version: int, validSnapshot: bool): bool =
  pendingRead(c, read) and version > 0 and validSnapshot
pure def complete(c: Cache, read: int, version: int, validSnapshot: bool): Cache =
  val subscribed = c.active.select(x => x.read == read and latestBinding(c, x))
  { ...c, cacheVersion: if (read == c.newest and subscribed.length() > 0) version else c.cacheVersion,
    displayed: c.displayed.select(v => not(subscribed.some(x => x.consumer == v.consumer)))
      .concat(subscribed.listMap(x => { consumer: x.consumer, version: version })),
    active: c.active.select(x => x.read != read),
    reads: c.reads.listMap(x => if (x.identity == read) { ...x, pending: false, releaseQueued: false } else x) }
pure def canFailRead(c: Cache, read: int): bool = pendingRead(c, read)
pure def failRead(c: Cache, read: int): Cache = { ...c,
  active: c.active.select(x => x.read != read),
  reads: c.reads.listMap(x => if (x.identity == read) { ...x, pending: false, releaseQueued: false } else x) }
pure def stepNoOlderCacheWrite(before: Cache, via: str, after: Cache): bool =
  (via == "release" or via == "flushRelease" or via == "failRead" or via == "cacheHit" or via == "acquire")
    implies before.cacheVersion == after.cacheVersion
pure def stepNewestNeverMovesBack(before: Cache, after: Cache): bool = after.newest >= before.newest
pure def stepRetainedDisplayOnFailure(before: Cache, via: str, after: Cache): bool =
  (via == "failRead" or via == "beginRead" or via == "flushRelease" or via == "release") implies after.displayed == before.displayed
pure def sometimesSharedRead(c: Cache): bool = c.active.some(a => c.active.some(b => a.consumer != b.consumer and a.read == c.newest and b.read == c.newest))
pure def sometimesCache(c: Cache): bool = c.cacheVersion > 0
pure def sometimesAborted(c: Cache): bool = c.reads.some(x => x.aborted)
pure def sometimesRefreshKeepsDisplay(c: Cache): bool = c.cacheVersion == 0 and c.displayed.length() > 0 and pendingRead(c, c.newest)
pure val consumerValues = Set(1, 2)
pure val leaseValues = Set(1, 2, 3)
pure val readValues = Set(1, 2, 3)
pure val versionValues = Set(1, 2, 3)
pure val weight_acquire = 4
pure val weight_release = 3
pure val weight_complete = 3
```

## Story: Reuse a recent snapshot and retry a failed read once

> As a visitor moving between public pages, I want a snapshot read a moment
> ago to be reused, an old one to be labelled stale, and a failed read to be
> tried once more before I see an error.

### A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted

A completed, validated snapshot is reused without a new read while its age
since completion is at least 0 and under 60 000 ms, and only for the registry
it was built from; a forced refresh discards it. A displayed snapshot is
labelled stale once more than 8 hours (28 800 000 ms) have passed since its
`generatedAt`; the page re-renders at that boundary. A failed read is retried
exactly once, 400 ms later, unless its consumers aborted it; the second
failure is the read's error.

```quint
pure val snapshotCacheMs = 60000
pure val snapshotStaleAfterMs = 28800000
pure val snapshotRetries = 1
pure val snapshotRetryDelayMs = 400
pure def snapshotCacheFresh(ageMs: int): bool = ageMs >= 0 and ageMs < snapshotCacheMs
pure def snapshotStale(nowMs: int, generatedMs: int): bool = nowMs - generatedMs > snapshotStaleAfterMs
pure def retryRead(retriesUsed: int, aborted: bool): bool = not(aborted) and retriesUsed >= 0 and retriesUsed < snapshotRetries
pure def lawFutureCacheIsNotFresh(ageMs: int): bool = ageMs < 0 implies not(snapshotCacheFresh(ageMs))
pure def lawCacheExpiresAtSixtySeconds(ageMs: int): bool = ageMs >= snapshotCacheMs implies not(snapshotCacheFresh(ageMs))
pure def lawStaleOnlyAfterEightHours(nowMs: int, generatedMs: int): bool =
  snapshotStale(nowMs, generatedMs) iff nowMs >= generatedMs + snapshotStaleAfterMs + 1
pure def lawAtMostOneRetry(retriesUsed: int, aborted: bool): bool =
  retryRead(retriesUsed, aborted) implies retriesUsed == 0 and not(aborted)
pure val ageMsValues = Set(-1, 0, 59999, 60000)
pure val nowMsValues = Set(0, 28800000, 28800001)
pure val generatedMsValues = Set(0, 1)
pure val retriesUsedValues = Set(0, 1)
```
