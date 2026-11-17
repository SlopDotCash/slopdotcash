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

## Story: Count whole months

### Adding months counts on the ordinal month, so December 2026 plus two is February 2027

A month lock's months and the months a pledge read asks for are counted
this way (development `src/lib/month-lock.ts`, `lockPeriods`). A month
before year 0 has no successor here and maps to zero.

```quint
pure def addPeriods(period: int, count: int): int =
  val ordinal = ordinalPeriod(period) + count
  if (ordinal < 0) 0 else (ordinal / 12) * 100 + ordinal % 12 + 1
```
