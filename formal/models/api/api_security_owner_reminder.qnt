// @source backend/security/owner-reminders.ts
// One reviewer of one project across three weeks. A notice is written at most
// once a week, only while a report has waited past seven days, and it never
// changes the report.
module api_security_owner_reminder {
  // waiting: reports past seven days with no decision. sent: the weeks that
  // already have a notice. decided: reports decided so far.
  var s: { week: int, waiting: int, sent: Set[int], writes: int, decided: int }
  action init = s' = {week: 1, waiting: 0, sent: Set(), writes: 0, decided: 0}
  // At most two reports ever arrive, which bounds the model.
  action age = all { s.waiting + s.decided < 2,
    s' = s.with("waiting", s.waiting + 1) }
  action decide = all { s.waiting > 0,
    s' = s.with("waiting", s.waiting - 1).with("decided", s.decided + 1) }
  action nextWeek = all { s.week < 3, s' = s.with("week", s.week + 1) }
  // The scheduled job: a notice only with something waiting and none this week.
  action job = if (s.waiting > 0 and not(s.week.in(s.sent)))
    s' = s.with("sent", s.sent.union(Set(s.week))).with("writes", s.writes + 1)
    else s' = s
  action step = any { age, decide, nextWeek, job }
  val invariant = all { s.writes == s.sent.size(), s.writes <= s.week,
    s.sent.forall(w => w <= s.week) }
  run oncePerWeekTest = init.then(age).then(job).then(job).then(job)
    .expect(s.writes == 1 and s.sent == Set(1))
  run nothingWaitingWritesNothingTest = init.then(job).then(nextWeek).then(job)
    .expect(s.writes == 0)
  run nextWeekRemindsAgainTest = init.then(age).then(job).then(nextWeek).then(job)
    .expect(s.writes == 2 and s.waiting == 1 and s.decided == 0)
  run decidedStopsRemindersTest = init.then(age).then(job).then(decide)
    .then(nextWeek).then(job).expect(s.writes == 1 and s.decided == 1)
}
