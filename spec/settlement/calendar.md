# UTC calendar months of an instant

PRD sections 6 and 11 date monthly promises, filings and their deadlines by
the UTC calendar month. Instants are whole seconds since 1970-01-01T00:00:00Z.
A month is written `YYYYMM`, as [monthly allocations](./monthly.md) writes it;
the referral ledger counts months as ordinals, `year * 12 + month - 1`. This
library converts an instant to its month with the proleptic Gregorian
civil-from-days arithmetic and no loop.

## Story: Name the month of an instant

### An instant belongs to the UTC month that contains its second

An instant before 1970 has no month here and maps to zero, which no caller
accepts as a month. Development `backend/payments/vault-snapshots.ts`
(`blockTime.slice(0, 7)`) and `scripts/check-referral-roots.ts`
(`pendingPeriods`) read the month from the ISO date the same way.

```quint
pure def utcPeriod(seconds: int): int =
  val z = seconds / 86400 + 719468
  val era = z / 146097
  val dayOfEra = z - era * 146097
  val yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365
  val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
  val shiftedMonth = (5 * dayOfYear + 2) / 153
  val month = if (shiftedMonth < 10) shiftedMonth + 3 else shiftedMonth - 9
  val year = yearOfEra + era * 400 + (if (month <= 2) 1 else 0)
  if (seconds < 0) 0 else year * 100 + month
pure def ordinalPeriod(period: int): int = (period / 100) * 12 + period % 100 - 1
```

## Story: Count whole months and date a month lock's lapse

### A month lock lapses at 00:00 UTC on the 4th of the second month after its month

Months are added on the ordinal count, so December 2026 plus two is
February 2027. The lapse instant is the close of the month's commit window,
72 hours after the following month ends: 2026-12 lapses at 2027-02-04
00:00 UTC. The pledge window, the release offer and the lapse date the owner
reads share it (development `src/lib/month-lock.ts`, `lockEnds`; operator
decision, 15 November 2026). A month before year 0 has no successor here
and maps to zero.

```quint
pure def addPeriods(period: int, count: int): int =
  val ordinal = ordinalPeriod(period) + count
  if (ordinal < 0) 0 else (ordinal / 12) * 100 + ordinal % 12 + 1
pure def periodStartSeconds(period: int): int =
  val month = period % 100
  val year = period / 100 - (if (month <= 2) 1 else 0)
  val era = year / 400
  val yearOfEra = year - era * 400
  val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5
  (era * 146097 + yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear - 719468) * 86400
pure val lockLapseDelaySeconds = 259200
pure def lockLapsesAt(period: int): int = periodStartSeconds(addPeriods(period, 2)) + lockLapseDelaySeconds
```
