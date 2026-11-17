# Month pledges shared by both chains

An owner of an ordinary vault may lock free funds to upcoming monthly
allocations (PRD section 6, "Monthly allocation", operator decision of
15 November 2026). `pledgeMonths` in `ProjectEscrow.sol` and `pledge_month`
in `lib.rs` record one pledge per UTC period: an amount that only rises and
an open flag. While a pledge is open its amount is held out of the owner's
withdrawals and hand commits, and the period may be admitted up to the
pledge even with monthly commitments off. The pledge closes when its period
is admitted, or lapses once the period's window has closed; the amount stays
as a record. This library states the parts both contracts share: which
periods may be pledged, the cap a pledged period is admitted under, and the
list of pledges each contract keys by period.

## Story: Pledge free funds to upcoming months

### A pledge names the current UTC period or one of the next eleven, before its window opens

`pledgeMonths` refuses a period before `currentPeriod()` or at or after the
same month a year later, and a month outside 1 to 12; `months_ahead` in
`lib.rs` admits 0 through 11 months ahead of the period containing the
cluster clock (`MAX_PLEDGE_PERIODS_AHEAD` is 12) and refuses an invalid
period. A period's window opens 72 hours after the period ends, so a period
that can be pledged has no admitted allocation, and a period that has ended
can never be pledged again. Months are added on the ordinal month count of
[the UTC calendar](../settlement/calendar.md).

```quint
import ledger as L from "./ledger"
import calendar as C from "../settlement/calendar"
pure val maxPeriodsAhead = 12
pure def periodPlus(period: int, offset: int): int =
  val index = C::ordinalPeriod(period) + offset
  (index / 12) * 100 + index % 12 + 1
pure def periodEnded(period: int, now: int): bool = now >= L::monthStart(L::nextPeriod(period))
pure def pledgeable(period: int, now: int): bool =
  L::validPeriod(period) and not(periodEnded(period, now))
    and L::monthStart(periodPlus(period, 1 - maxPeriodsAhead)) <= now
pure def lawPledgeableBeforeWindow(period: int, now: int): bool =
  pledgeable(period, now) implies now < L::opensAt(period)
pure def lawEndedPeriodNeverPledgeable(period: int, now: int): bool =
  periodEnded(period, now) implies not(pledgeable(period, now))
pure val periodValues = Set(202610, 202611, 202612, 202613, 202710, 202711, 202712, 199912)
pure val nowValues = Set(1793491200, 1796342400, 1799020800)
```

### On 1 November 2026 the periods from November 2026 through October 2027 can be pledged

The values match the program's unit test `pledges_reach_eleven_months_ahead`.

```quint
pure def lawElevenMonthsAhead(now: int): bool = now == 1793491200 implies
  pledgeable(202611, now) and pledgeable(202710, now) and not(pledgeable(202711, now))
    and not(pledgeable(202610, now)) and not(pledgeable(202613, now))
pure def lawPeriodPlusRollsOverTheYear(offset: int): bool = offset == 1 implies
  periodPlus(202611, offset) == 202612 and periodPlus(202612, offset) == 202701
    and periodPlus(202711, offset - 12) == 202612
pure val offsetValues = Set(0, 1, 2)
```

### A pledged period is admitted up to the larger of the cap and the pledge, or the pledge alone with commitments off

`monthlyCapFor` in `ProjectEscrow.sol` and `monthly_limit` in `lib.rs`: with
monthly commitments on, the larger of the owner's monthly cap and the
period's open pledge; with them off, the open pledge alone, and zero without
one, which admission refuses first. A pledge is the owner's consent, so
turning commitments off or lowering the cap after pledging cannot stop a
pledged period.

```quint
pure def monthlyLimit(enabled: bool, cap: int, pledged: int): int =
  if (enabled) (if (pledged > cap) pledged else cap) else pledged
pure def lawLimitHonoursPledgeAndCap(enabled: bool, cap: int, pledged: int): bool = (cap >= 0 and pledged >= 0) implies
  monthlyLimit(enabled, cap, pledged) >= pledged
    and (enabled implies monthlyLimit(enabled, cap, pledged) >= cap)
    and ((enabled and pledged == 0) implies monthlyLimit(enabled, cap, pledged) == cap)
    and (not(enabled) implies monthlyLimit(enabled, cap, pledged) == pledged)
pure def lawMonthlyLimitTable(cap: int): bool = cap == 5 implies
  monthlyLimit(true, cap, 2) == 5 and monthlyLimit(true, 1, 2) == 2 and monthlyLimit(true, cap, 0) == 5
    and monthlyLimit(false, cap, 2) == 2 and monthlyLimit(false, 1, 2) == 2 and monthlyLimit(false, cap, 0) == 0
pure val capValues = Set(0, 1, 5)
pure val pledgedValues = Set(0, 2, 5)
```

### Each period has at most one pledge, whose open amount only rises

A pledge raised to an equal amount is unchanged, and one raised to a lower
amount refuses (`PledgeTooLow`); a pledge is never lowered or cancelled.
Closing keeps the amount as a record. The open total is the sum of the open
pledges, which each contract keeps as a counter (`openPledgedGross`,
`pledged_open`).

```quint
type MonthPledge = { period: int, amount: int, open: bool }
pure val noPledge: MonthPledge = { period: 0, amount: 0, open: false }
pure def hasPledge(pledges: List[MonthPledge], period: int): bool = pledges.some(x => x.period == period)
pure def pledgeFor(pledges: List[MonthPledge], period: int): MonthPledge =
  pledges.foldl(noPledge, (found, x) => if (x.period == period) x else found)
pure def openAmount(pledges: List[MonthPledge], period: int): int =
  val found = pledgeFor(pledges, period)
  if (found.open) found.amount else 0
pure def withPledge(pledges: List[MonthPledge], pledge: MonthPledge): List[MonthPledge] =
  if (hasPledge(pledges, pledge.period)) pledges.listMap(x => if (x.period == pledge.period) pledge else x)
  else pledges.append(pledge)
pure def raisedTo(pledges: List[MonthPledge], period: int, amount: int): List[MonthPledge] =
  if (openAmount(pledges, period) < amount) withPledge(pledges, { period: period, amount: amount, open: true }) else pledges
pure def closedPledge(pledges: List[MonthPledge], period: int): List[MonthPledge] =
  pledges.listMap(x => if (x.period == period) { ...x, open: false } else x)
pure def openTotal(pledges: List[MonthPledge]): int = pledges.foldl(0, (t, x) => if (x.open) t + x.amount else t)
pure def pledgesWellFormed(pledges: List[MonthPledge]): bool = pledges.every(x =>
  pledges.select(o => o.period == x.period).length() == 1 and L::validPeriod(x.period) and x.amount > 0)
```
