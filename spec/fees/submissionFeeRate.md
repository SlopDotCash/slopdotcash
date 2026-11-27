# Submission fee SLOP rate

PRD section 6, "Submission fee deposits" (operator decision of 18 November
2026): a SLOP deposit is due at half the stablecoin fee, valued at the
platform's SLOP rate. Once an hour the submission-fee Worker reads the price
of the official SLOP / USDG pool on Robinhood Chain (Uniswap v4 `StateView`
`getSlot0`, pool `0x18f3778f…838b`) and stores at most one reading for that
UTC hour; from those readings it sets the rate. Sources at Slop development
`8660a6121`: `workers/submission-fee/rate.ts` (`runRate`),
`src/lib/submission-fee.mjs` (`averageSlopRate`, `slopFeeShareBps`,
`nextSlopRate`), `store.ts` (`latestRate`, `insertSample`, `samplesSince`,
`insertRate`), migration `0140_submission_fee_rates.sql` and development's
own model `formal/models/fees/submission_fee_rate.qnt`.

The rate rows are append-only and owned by the backend; which rate is in
force at a time, the 48 hours the previous one still counts, the seven-day
period and the band of 3,500 to 6,500 basis points are
[the submission fee terms](../backend/submissionFeeTerms.md). Readings and
averages are exact decimal text computed by the shell's `//@` bigint
kernels: an average is taken over the SLOP price, so it is the harmonic mean
of the readings (SLOP per 1.00), and the share is the SLOP fee at the rate
in force as basis points of the stablecoin fee at the 24-hour average
(5,000 at an unchanged price). This spec reads the counts, the share and
whether an average differs from the rate as the Worker's facts.

## Story: Keep a SLOP rate the chain's price supports, published before it counts

> As a contributor paying in SLOP, I want the amount due to follow the
> market without moving under me, so that a deposit made at the published
> rate is never judged by a rate that was not yet in force.

### One reading per UTC hour; a new SLOP rate needs enough readings and takes effect at the next hour

`off` stores nothing. Each rate pass stores at most one reading for its UTC
hour; a pool that cannot be read stores nothing and keeps the rate in force.
With no rate, the first is set from the 24-hour average once at least 24
readings exist. A rate at least seven days old is reset from the seven-day
average once at least 84 readings exist and that average differs from it.
Before that, it is reset early from the 24-hour average once at least 12
readings exist and the SLOP fee at the rate in force is worth less than
3,500 or more than 6,500 basis points of the stablecoin fee at that average,
and the average differs from it. Too few readings change nothing. A new
rate takes effect at the start of the next UTC hour and is written once for
that hour: a second pass in the same hour compares against the newest row,
even one not yet in force, and writes nothing more.

```quint
import runtime as R from "./runtime"
import submissionFeeTerms as T from "../backend/submissionFeeTerms"
type RateChange = KeepRate | FirstRate | WeeklyRate | DriftRate
type RateWindow = { weekReadings: int, dayReadings: int, shareBps: int, weekAverageDiffers: bool, dayAverageDiffers: bool }
pure val hourMs = 3600000
pure val firstRateReadings = 24
pure val weeklyRateReadings = 84
pure val earlyRateReadings = 12
pure def nextRate(hasRate: bool, ageMs: int, window: RateWindow): RateChange =
  if (not(hasRate)) (if (window.dayReadings >= firstRateReadings) FirstRate else KeepRate)
  else if (ageMs >= T::ratePeriodMs) (if (window.weekReadings >= weeklyRateReadings and window.weekAverageDiffers) WeeklyRate else KeepRate)
  else if (window.dayReadings < earlyRateReadings) KeepRate
  else if (window.shareBps >= T::bandMinBps and window.shareBps <= T::bandMaxBps) KeepRate
  else if (window.dayAverageDiffers) DriftRate
  else KeepRate
pure def nextHourStart(now: int): int = (now / hourMs + 1) * hourMs
pure def readingsBehind(change: RateChange, window: RateWindow): bool =
  if (change == FirstRate) window.dayReadings >= firstRateReadings
  else if (change == WeeklyRate) window.weekReadings >= weeklyRateReadings
  else if (change == DriftRate) window.dayReadings >= earlyRateReadings
    and (window.shareBps < T::bandMinBps or window.shareBps > T::bandMaxBps)
  else false
pure def lawNoRateWithoutReadings(hasRate: bool, ageMs: int, window: RateWindow): bool =
  nextRate(hasRate, ageMs, window) == KeepRate or readingsBehind(nextRate(hasRate, ageMs, window), window)
pure def lawInsideTheBandKeepsTheRate(hasRate: bool, ageMs: int, window: RateWindow): bool =
  (hasRate and ageMs < T::ratePeriodMs and window.shareBps >= T::bandMinBps and window.shareBps <= T::bandMaxBps)
    implies nextRate(hasRate, ageMs, window) == KeepRate
pure def lawNextHourIsLater(now: int): bool = now >= 0 implies (nextHourStart(now) > now and nextHourStart(now) - now <= hourMs
  and nextHourStart(now) % hourMs == 0)
pure val windowValues = Set(
  { weekReadings: 0, dayReadings: 23, shareBps: 5000, weekAverageDiffers: true, dayAverageDiffers: true },
  { weekReadings: 24, dayReadings: 24, shareBps: 5000, weekAverageDiffers: true, dayAverageDiffers: true },
  { weekReadings: 84, dayReadings: 12, shareBps: 3499, weekAverageDiffers: true, dayAverageDiffers: true },
  { weekReadings: 83, dayReadings: 24, shareBps: 6501, weekAverageDiffers: false, dayAverageDiffers: true },
  { weekReadings: 84, dayReadings: 11, shareBps: 6501, weekAverageDiffers: false, dayAverageDiffers: false },
  { weekReadings: 168, dayReadings: 24, shareBps: 6500, weekAverageDiffers: true, dayAverageDiffers: false })
pure val hasRateValues = Set(true, false)
pure val ageMsValues = Set(-1, 0, 604799999, 604800000)
```

### The rate pass stores readings and rates only as the rule allows

One instance is the rate ledger. `ReleaseWorkflow` publishes the Worker's
mode; the Worker's trusted clock moves forward; each pass stores the hour's
reading when the pool answered, and writes the rate the rule above chooses,
at the next UTC hour. The window counts, the share and whether an average
differs are the Worker's read of this source's stored readings in each
window (`samplesSince`), a shell obligation the journeys check.

```quint
type RateRow = { effectiveAt: int, createdAt: int, change: RateChange, window: RateWindow }
type RateLedger = { mode: R::Mode, clock: int, sampledHours: List[int], rates: List[RateRow] }
pure val rateStart = 1794441600000
pure val noRow: RateRow = { effectiveAt: 0, createdAt: 0, change: KeepRate,
  window: { weekReadings: 0, dayReadings: 0, shareBps: 0, weekAverageDiffers: false, dayAverageDiffers: false } }
pure val initial: RateLedger = { mode: R::Off, clock: rateStart, sampledHours: List(), rates: List() }
pure def newestRate(l: RateLedger): RateRow = l.rates.foldl(noRow, (found, r) => r)
pure def ageOf(l: RateLedger): int = if (l.rates.length() == 0) 0 else l.clock - newestRate(l).effectiveAt
pure def canSetMode(l: RateLedger, mode: R::Mode, by: R::Sender): bool = by == R::ReleaseWorkflow and mode != l.mode
pure def setMode(l: RateLedger, mode: R::Mode, by: R::Sender): RateLedger = { ...l, mode: mode }
pure def canAdvanceClock(l: RateLedger, now: int, by: R::Sender): bool = by == R::Worker and now > l.clock
pure def advanceClock(l: RateLedger, now: int, by: R::Sender): RateLedger = { ...l, clock: now }
pure def canStoreReading(l: RateLedger, by: R::Sender): bool = by == R::Worker and l.mode != R::Off
  and not(l.sampledHours.includes(l.clock / hourMs))
pure def storeReading(l: RateLedger, by: R::Sender): RateLedger = { ...l, sampledHours: l.sampledHours.append(l.clock / hourMs) }
pure def canSetRate(l: RateLedger, window: RateWindow, by: R::Sender): bool = by == R::Worker and l.mode != R::Off
  and l.sampledHours.length() > 0 and nextRate(l.rates.length() > 0, ageOf(l), window) != KeepRate
  and not(l.rates.some(r => r.effectiveAt == nextHourStart(l.clock)))
pure def setRate(l: RateLedger, window: RateWindow, by: R::Sender): RateLedger =
  { ...l, rates: l.rates.append({ effectiveAt: nextHourStart(l.clock), createdAt: l.clock,
    change: nextRate(l.rates.length() > 0, ageOf(l), window), window: window }) }
pure def alwaysOneReadingPerHour(l: RateLedger): bool = l.sampledHours.every(h => l.sampledHours.select(x => x == h).length() == 1
  and h <= l.clock / hourMs)
pure def alwaysRatesHaveReadingsAndWaitForTheirHour(l: RateLedger): bool = l.clock >= 0
  and l.rates.every(r => r.change != KeepRate
  and readingsBehind(r.change, r.window) and r.effectiveAt > r.createdAt and r.effectiveAt - r.createdAt <= hourMs
  and r.effectiveAt % hourMs == 0 and r.createdAt <= l.clock and l.rates.select(x => x.effectiveAt == r.effectiveAt).length() == 1)
  and (l.rates.length() > 0 implies l.sampledHours.length() > 0)
pure def stepOffStoresNothing(before: RateLedger, after: RateLedger): bool = before.mode == R::Off implies
  (after.sampledHours == before.sampledHours and after.rates == before.rates)
pure def sometimesFirstRate(l: RateLedger): bool = l.rates.some(r => r.change == FirstRate)
pure def sometimesWeeklyRate(l: RateLedger): bool = l.rates.some(r => r.change == WeeklyRate)
pure def sometimesDriftRate(l: RateLedger): bool = l.rates.some(r => r.change == DriftRate)
pure val nowValues = Set(rateStart + 1800000, rateStart + 3600001, rateStart + 604800000 + 3600001, rateStart + 604800000 + 7200001)
pure val modeValues = Set(R::Off, R::Live)
pure val byValues = Set(R::ReleaseWorkflow, R::Worker, R::Other)
```
