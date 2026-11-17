# Value intake history inspection

Development at df21e37b7 lets an operator inspect the Slopbot Worker's
retained, fixed-schema value intake failures for a short past window,
without ever reading raw log bodies: `scripts/inspect-value-intake-history.ts`
and its tests, the `value-intake-diagnostic.yml` workflow, and development's
own model `formal/models/release/intake_history_projection.qnt` (commits
afbab2e59 and e1f637297). It runs on a `main` runner with the protected
Cloudflare credentials. This machine is one inspection. Its output names
only bounded retained observations; it never establishes a private request
or source identity, unsampled source coverage, or the absence of failures.

## Story: Report a bounded, unsampled and stable projection of retained intake failures

### An inspection is admitted only for a valid window, and makes at most three dry calls

The window is two exact UTC times (`YYYY-MM-DDTHH:MM:SS` with optional
milliseconds and `Z`) with its start before its end, its end not in the
future, at most 15 minutes long and starting within the last 24 hours, read
on a `main` runner with the protected authority. An invalid window or missing
authority refuses before any call. The calls are the deployment metadata, one
dry telemetry query for `slop-slopbot` limited to 200 events, and a second
metadata read.

```quint
type HistoryPhase = HistoryStart | HistoryMetadata | HistoryQuery | HistoryRecheck | HistoryComplete | HistoryRefused
type HistoryWindow = { start: int, end: int, now: int, exact: bool, mainRunner: bool, authority: bool }
type IntakeHistory = { phase: HistoryPhase, authorized: bool, calls: int, shape: bool, stable: bool,
  truncated: bool, sampled: bool, rows: int, matched: int, outputRows: int }
pure val maximumEvents = 200
pure val maxWindowMs = 900000
pure val lookbackMs = 86400000
pure val maxHistoryCalls = 3
pure val initial: IntakeHistory = { phase: HistoryStart, authorized: false, calls: 0, shape: false, stable: false,
  truncated: false, sampled: false, rows: 0, matched: 0, outputRows: 0 }
pure def validWindow(window: HistoryWindow): bool =
  window.exact and window.mainRunner and window.authority and window.start < window.end and window.end <= window.now
    and window.end - window.start <= maxWindowMs and window.start >= window.now - lookbackMs
pure def canAdmit(h: IntakeHistory, window: HistoryWindow): bool = h.phase == HistoryStart
pure def admit(h: IntakeHistory, window: HistoryWindow): IntakeHistory =
  { ...h, authorized: validWindow(window), phase: if (validWindow(window)) HistoryMetadata else HistoryRefused }
pure def canReadMetadata(h: IntakeHistory, ok: bool): bool = h.phase == HistoryMetadata and h.authorized
pure def readMetadata(h: IntakeHistory, ok: bool): IntakeHistory =
  { ...h, calls: 1, phase: if (ok) HistoryQuery else HistoryRefused }
pure def alwaysCallsNeedAuthority(h: IntakeHistory): bool =
  h.calls >= 0 and h.calls <= maxHistoryCalls and (h.calls > 0 implies h.authorized)
    and ((h.phase == HistoryMetadata or h.phase == HistoryQuery or h.phase == HistoryRecheck) implies h.authorized)
    and (h.phase == HistoryStart implies h.calls == 0)
    and (h.phase == HistoryMetadata implies h.calls == 0)
    and (h.phase == HistoryQuery implies h.calls == 1)
    and (h.phase == HistoryRecheck implies h.calls == 2)
pure def sometimesInvalidWindowRefused(h: IntakeHistory): bool = h.phase == HistoryRefused and h.calls == 0
pure val windowValues = Set(
  { start: 1000, end: 900000, now: 1000000, exact: true, mainRunner: true, authority: true },
  { start: 1000, end: 1000000, now: 1000000, exact: true, mainRunner: true, authority: true },
  { start: 1000, end: 900000, now: 1000000, exact: true, mainRunner: false, authority: true })
```

### Only a bounded, unsampled answer over an unchanged deployment yields rows, and only a complete one passes

A query that fails, returns more than 200 rows, a matched count below the
returned rows or above 1,000,000, or reports sampled statistics refuses at
once, and a deployment that changed between the two metadata reads
refuses at the recheck: none of them outputs a row. Once the deployment is
unchanged, the inspection reports every returned row that projects to the
fixed failure schema, at most 200. It is complete only when the query was not
truncated, fewer than 200 rows came back, the matched count equals the
returned rows and every returned row projected. An incomplete but stable
inspection still reports its bounded projected rows, is marked not complete
and fails the run.

```quint
pure val maxMatchedEvents = 1000000
pure def boundedAnswer(rows: int, matched: int): bool =
  rows >= 0 and rows <= maximumEvents and matched >= rows and matched <= maxMatchedEvents
pure def canQuery(h: IntakeHistory, ok: bool, rows: int, matched: int, sampled: bool): bool =
  h.phase == HistoryQuery and h.authorized
pure def query(h: IntakeHistory, ok: bool, rows: int, matched: int, sampled: bool): IntakeHistory =
  { ...h, calls: 2, shape: ok and boundedAnswer(rows, matched), truncated: not(matched == rows and rows < maximumEvents),
    sampled: sampled, rows: rows, matched: matched,
    phase: if (ok and boundedAnswer(rows, matched) and not(sampled)) HistoryRecheck else HistoryRefused }
pure def canRecheck(h: IntakeHistory, stable: bool, projected: int): bool =
  h.phase == HistoryRecheck and h.shape and projected >= 0 and projected <= h.rows
pure def recheck(h: IntakeHistory, stable: bool, projected: int): IntakeHistory =
  val complete = stable and not(h.truncated) and projected == h.rows
  { ...h, calls: 3, stable: stable, phase: if (complete) HistoryComplete else HistoryRefused,
    outputRows: if (stable) projected else 0 }
pure def alwaysRowsOnlyFromCompleteProjection(h: IntakeHistory): bool =
  h.outputRows >= 0 and h.outputRows <= maximumEvents
    and (h.outputRows > 0 implies h.shape and h.stable and h.calls == maxHistoryCalls and h.outputRows <= h.rows)
    and (h.shape implies boundedAnswer(h.rows, h.matched))
    and (not(h.truncated) implies h.matched == h.rows and h.rows < maximumEvents)
    and (h.phase == HistoryRecheck implies h.shape and not(h.sampled))
    and (h.phase == HistoryComplete implies h.authorized and h.shape and h.stable and not(h.truncated) and not(h.sampled)
      and h.calls == maxHistoryCalls and h.outputRows < maximumEvents)
pure def stepFinalPhases(before: IntakeHistory, after: IntakeHistory): bool =
  (before.phase == HistoryComplete or before.phase == HistoryRefused) implies after == before
pure def sometimesComplete(h: IntakeHistory): bool = h.phase == HistoryComplete and h.outputRows > 0
pure def sometimesIncompleteWithRows(h: IntakeHistory): bool =
  h.phase == HistoryRefused and h.stable and h.outputRows > 0
pure def sometimesTruncatedRefused(h: IntakeHistory): bool = h.phase == HistoryRefused and h.truncated and h.stable
pure def sometimesSampledRefused(h: IntakeHistory): bool = h.phase == HistoryRefused and h.sampled and h.calls == 2
pure val rowsValues = Set(0, 2, 200, 201)
pure val matchedValues = Set(0, 2, 3, 200)
pure val projectedValues = Set(0, 1, 2, 200)
```
