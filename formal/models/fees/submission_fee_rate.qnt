// @source src/lib/submission-fee.mjs
// @source workers/submission-fee/rate.ts
// @source workers/submission-fee/store.ts
// @source workers/submission-fee/chain.ts
// @source workers/submission-fee/index.ts
// @source migrations/0140_submission_fee_rates.sql
// @source backend/submission-fee/handler.ts
// @evidence workers/submission-fee/submission-fee.test.ts
// @evidence backend/submission-fee/handler.test.ts
// The SLOP rate. Time moves in hours (bounded at 12 here); `day` and `week`
// count the hourly readings inside each window, scaled down: a full day is 2
// readings, half a week is 4, a rate is due for its weekly reset at age 6,
// and the previous rate counts for a grace of 2 hours after a change. `band`
// abstracts whether the SLOP fee at the rate in force is inside 35% to 65%
// of the stablecoin fee at the 24-hour average. `rates` counts stored rows;
// `pending` is a row that takes effect at the next hour. The exact averages
// and thresholds are unit-tested; this model covers when a rate may change
// and what a deposit or a public read sees.
module submission_fee_rate {
  var s: { on: bool, hour: int, readThisHour: bool, day: int, week: int, rates: int,
    age: int, pending: bool, sinceChange: int, band: bool, source: bool, lastRead: str }
  action init = s' = { on: false, hour: 0, readThisHour: false, day: 0, week: 0, rates: 0,
    age: 0, pending: false, sinceChange: 0, band: true, source: true, lastRead: "none" }
  action switchOn = all { not(s.on), s' = s.with("on", true) }
  action world(band, source) = s' = s.with("band", band).with("source", source)
  // The next UTC hour: a pending rate takes effect and windows age.
  action tick = all { s.hour < 12,
    s' = s.with("hour", s.hour + 1).with("readThisHour", false)
      .with("age", if (s.pending) 0 else if (s.rates > 0) s.age + 1 else 0)
      .with("sinceChange", if (s.pending) 0 else if (s.rates > 0) s.sinceChange + 1 else 0)
      .with("pending", false) }
  // One reading an hour. An unreadable pool stores nothing.
  action read = all { s.on, not(s.readThisHour), s.source,
    s' = s.with("readThisHour", true).with("day", if (s.day < 2) s.day + 1 else 2)
      .with("week", if (s.week < 8) s.week + 1 else 8).with("lastRead", "stored") }
  action readFails = all { s.on, not(s.readThisHour), not(s.source),
    s' = s.with("lastRead", "source_unavailable") }
  action readAgain = all { s.on, s.readThisHour, s' = s.with("lastRead", "already_read") }
  // Readings leave the windows as time passes without new ones.
  action forget = all { s.day > 0, s' = s.with("day", s.day - 1).with("week", if (s.week > 0) s.week - 1 else 0) }
  val inForce = s.rates > 0 and not(s.pending and s.rates == 1)
  action setFirst = all { s.on, s.rates == 0, s.day == 2,
    s' = s.with("rates", 1).with("pending", true) }
  action setWeekly = all { s.on, s.rates > 0, not(s.pending), s.age >= 6, s.week >= 4, s.rates < 4,
    s' = s.with("rates", s.rates + 1).with("pending", true) }
  action setDrift = all { s.on, s.rates > 0, not(s.pending), s.age < 6, s.day >= 1, not(s.band), s.rates < 4,
    s' = s.with("rates", s.rates + 1).with("pending", true).with("band", true) }
  action step = { nondet a = Set(true, false).oneOf() nondet b = Set(true, false).oneOf()
    any { switchOn, world(a, b), tick, read, readFails, readAgain, forget, setFirst, setWeekly, setDrift, s' = s } }

  // What a deposit or a public read sees at this hour.
  val slopAccepted = inForce
  val previousAccepted = inForce and s.rates > 1 and not(s.pending) and s.sinceChange < 2
  val invariant = all {
    // Off stores nothing.
    not(s.on) implies (s.rates == 0 and s.day == 0 and s.lastRead == "none"),
    // No rate without readings behind it; SLOP is not accepted before a rate is in force.
    s.rates == 0 implies not(slopAccepted),
    s.rates <= 4, s.day <= 2, s.week <= 8,
    // The previous rate is accepted only inside its grace, never the first rate's.
    previousAccepted implies (s.rates > 1 and s.sinceChange < 2),
    // A new rate is never in force in the hour it is written.
    (s.pending and s.rates == 1) implies not(slopAccepted)
  }
  run firstRateNeedsAFullDayTest = init.then(switchOn).then(read).then(setFirst.fail())
  run firstRateFromNextHourTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .expect(not(slopAccepted) and s.pending and invariant)
    .then(tick).expect(slopAccepted and not(previousAccepted) and invariant)
  run unreadablePoolKeepsLastRateTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .then(tick).then(world(true, false)).then(readFails).then(tick).then(readFails)
    .expect(s.rates == 1 and slopAccepted and s.lastRead == "source_unavailable" and invariant)
  run driftResetsEarlyTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst).then(tick)
    .then(world(false, true)).then(read).then(setDrift)
    .expect(s.rates == 2 and s.pending and invariant)
    .then(tick).expect(previousAccepted and invariant)
    .then(tick).then(tick).expect(not(previousAccepted) and slopAccepted and invariant)
  run insideBandNoEarlyResetTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .then(tick).then(read).then(setDrift.fail())
  run weeklyNeedsAgeAndReadingsTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .then(tick).then(read).then(setWeekly.fail())
  run weeklyNotBeforeSixHoursTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .then(tick).then(read).then(tick).then(read).then(tick).then(read).then(tick).then(read)
    .then(tick).then(read).then(tick).then(read).then(setWeekly.fail())
  run weeklyResetAtSixHoursTest = init.then(switchOn).then(read).then(tick).then(read).then(setFirst)
    .then(tick).then(read).then(tick).then(read).then(tick).then(read).then(tick).then(read)
    .then(tick).then(read).then(tick).then(read).then(tick).then(read).then(setWeekly)
    .expect(s.rates == 2 and s.pending and invariant)
  run oneReadingAnHourTest = init.then(switchOn).then(read).then(read.fail())
  run offReadsNothingTest = init.then(read.fail())
}
