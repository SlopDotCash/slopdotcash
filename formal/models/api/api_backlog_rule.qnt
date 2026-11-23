// @source src/lib/backlog-rule.mjs
// @source src/lib/project-schema.mjs
// @source backend/projects/handler.ts
// @source backend/projects/merge-activity.ts
// @source backend/projects/skill-publication.ts
// @source backend/projects/backlog-notices.ts
// @source backend/notifications/events.ts
// @source workers/slopbot/reporting-readiness.ts
// @source src/App.tsx
// @source src/PublicPages.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/notifications.ts
// @evidence scripts/backlog-rule.test.ts
// @evidence scripts/project-self-service.test.ts
// @evidence backend/projects/discovery-intake.test.ts
// @evidence backend/projects/backlog-notices.test.ts
// @evidence backend/projects/merge-activity.test.ts
// @evidence tests/e2e/backlog-rule.spec.ts
// The backlog rule (operator decision, 23 November 2026). The scheduled
// merge activity read stores, per repository, the outside pull requests
// waiting a week for a maintainer and the last merge. `read` false abstracts
// a project with no stored row; `stale` abstracts rows older than
// INTAKE_COUNT_MAX_AGE_MS; `waiting` 2 abstracts BACKLOG_WAITING_LIMIT (50);
// `mergeOld` abstracts no merge in DORMANT_AFTER_DAYS (14) or none found.
// `started` abstracts now >= BACKLOG_RULE_FROM (1 December 2026). `judged`
// abstracts an active, listed monthly-pool project that is not a
// security-only program. An out-of-rotation project is left out of the home
// page, /sponsors and agent discovery and its page says why; a running
// catch-up pause keeps it listed and its page says so. The owner starts a
// pause at most once per UTC month (`startsThisMonth`), may end it early, and
// it expires; only the server records the start. Owner notices: one preview
// before the start, one out notice per episode (an episode ends with a merge,
// which changes the notice key). A failed browser or server read leaves out
// nothing. Points, payment and Slopbot reviews never read this state:
// `scored` grows in every state.
module api_backlog_rule {
  type S = {
    read: bool, stale: bool, waiting: int, mergeOld: bool, started: bool,
    judged: bool, pause: bool, startsThisMonth: int,
    browser: str, server: str,
    home: bool, sponsors: bool, discovered: bool, notice: bool, catchUpNote: bool,
    previewSent: bool,
    episodes: int, episodeNoticed: bool, outNotices: int,
    scored: int
  }
  var s: S
  pure val LIMIT = 2
  pure def reason(t: S): bool =
    t.judged and t.read and not(t.stale) and
      (t.waiting >= LIMIT or (t.waiting >= 1 and t.mergeOld))
  pure def wouldBeOut(t: S): bool = reason(t) and not(t.pause)
  pure def out(t: S): bool = wouldBeOut(t) and t.started
  pure def shown(t: S): S =
    t.with("home", not(t.browser == "ready" and out(t)))
     .with("sponsors", not(t.browser == "ready" and out(t)))
     .with("discovered", not(t.server == "ready" and out(t)))
     .with("notice", t.browser == "ready" and out(t))
     .with("catchUpNote", t.browser == "ready" and t.started and t.judged and t.pause)
  action init = s' = shown({
    read: false, stale: false, waiting: 0, mergeOld: false, started: false,
    judged: true, pause: false, startsThisMonth: 0,
    browser: "loading", server: "ready",
    home: true, sponsors: true, discovered: true, notice: false, catchUpNote: false,
    previewSent: false,
    episodes: 0, episodeNoticed: false, outNotices: 0,
    scored: 0
  })
  // A successful scheduled read stores fresh figures.
  action read(w: int, old: bool): bool =
    s' = shown(s.with("read", true).with("stale", false).with("waiting", w).with("mergeOld", old))
  // A failed read keeps the last figures and their date.
  action failedRead = s' = shown(s)
  action expire = all { s.read, s' = shown(s.with("stale", true)) }
  // A maintainer merges: dormancy clears and the notice key changes.
  action merge = s' = shown(s.with("mergeOld", false)
    .with("episodes", s.episodes + 1).with("episodeNoticed", false))
  // Fourteen days pass without a merge.
  action age = s' = shown(s.with("mergeOld", true))
  // 1 December 2026 arrives.
  action begin = s' = shown(s.with("started", true))
  // The owner starts a pause; the server refuses a second start this month.
  action startPause = all {
    not(s.pause),
    s.startsThisMonth == 0,
    s' = shown(s.with("pause", true).with("startsThisMonth", 1)),
  }
  action refusedStart = all {
    not(s.pause),
    s.startsThisMonth > 0,
    s' = shown(s),
  }
  // Ending early, or the end passing, stops the pause.
  action endPause = all { s.pause, s' = shown(s.with("pause", false)) }
  action newMonth = s' = shown(s.with("startsThisMonth", 0))
  action status(j: bool): bool = s' = shown(s.with("judged", j))
  action browserRead(ok: bool): bool = s' = shown(s.with("browser", if (ok) "ready" else "failed"))
  action serverRead(ok: bool): bool = s' = shown(s.with("server", if (ok) "ready" else "failed"))
  // The notice step after a merge activity run.
  action notify =
    if (not(s.started) and wouldBeOut(s) and not(s.previewSent))
      s' = s.with("previewSent", true)
    else if (out(s) and not(s.episodeNoticed))
      s' = s.with("episodeNoticed", true).with("outNotices", s.outNotices + 1)
    else
      s' = s
  // Accepted work scores whatever the listing.
  action score = all { s.scored < 2, s' = s.with("scored", s.scored + 1) }
  action step = any {
    nondet w = 0.to(3).oneOf()
    nondet old = Bool.oneOf()
    read(w, old),
    failedRead,
    expire,
    all { s.episodes < 2, merge },
    age,
    begin,
    startPause,
    refusedStart,
    endPause,
    newMonth,
    nondet j = Bool.oneOf()
    status(j),
    nondet ok = Bool.oneOf()
    browserRead(ok),
    nondet ok2 = Bool.oneOf()
    serverRead(ok2),
    notify,
    score,
  }
  val invariant = all {
    // Not out of rotation: listed everywhere, no out line.
    not(out(s)) implies (s.home and s.sponsors and s.discovered and not(s.notice)),
    // Before the start nothing leaves and nothing shows.
    not(s.started) implies (s.home and s.sponsors and s.discovered and not(s.notice) and not(s.catchUpNote)),
    // A running pause keeps the project listed.
    s.pause implies (s.home and s.sponsors and s.discovered and not(s.notice)),
    // No recent row decides nothing.
    (not(s.read) or s.stale) implies (s.home and s.sponsors and s.discovered),
    // Fail open on a loading or failed browser read and a failed server read.
    s.browser != "ready" implies (s.home and s.sponsors and not(s.notice) and not(s.catchUpNote)),
    s.server == "failed" implies s.discovered,
    // A successful read of an out project leaves it out and says why.
    (s.browser == "ready" and out(s)) implies (not(s.home) and not(s.sponsors) and s.notice),
    (s.server == "ready" and out(s)) implies not(s.discovered),
    // A quiet project with nothing waiting is never out.
    s.waiting == 0 implies not(out(s)),
    // One start per month.
    s.startsThisMonth <= 1,
    // One out notice per episode; nothing is noticed before the start.
    s.outNotices <= s.episodes + 1,
    not(s.started) implies s.outNotices == 0,
  }
  run quietProjectStaysListedTest = init.then(begin).then(read(0, true)).then(browserRead(true))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run limitTakesItOutTest = init.then(begin).then(read(2, false)).then(browserRead(true))
    .expect(not(s.home) and not(s.sponsors) and not(s.discovered) and s.notice and invariant)
  run belowLimitStaysListedTest = init.then(begin).then(read(1, false)).then(browserRead(true))
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run dormantTakesItOutTest = init.then(begin).then(read(1, true)).then(browserRead(true))
    .expect(not(s.home) and not(s.discovered) and s.notice and invariant)
  run oneMergeBringsItBackTest = init.then(begin).then(read(1, true)).then(browserRead(true)).then(merge)
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run beforeTheStartNothingLeavesTest = init.then(read(3, true)).then(browserRead(true))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run staleRowsDecideNothingTest = init.then(begin).then(read(3, true)).then(browserRead(true)).then(expire)
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run neverReadDecidesNothingTest = init.then(begin).then(browserRead(true))
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run failedBrowserReadListsTest = init.then(begin).then(read(3, true)).then(browserRead(false))
    .expect(s.home and s.sponsors and not(s.notice) and not(s.discovered) and invariant)
  run failedServerReadListsTest = init.then(begin).then(read(3, true)).then(serverRead(false))
    .expect(s.discovered and invariant)
  run exemptProjectIsNotJudgedTest = init.then(begin).then(read(3, true)).then(browserRead(true)).then(status(false))
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run pauseKeepsItListedTest = init.then(begin).then(read(3, true)).then(browserRead(true)).then(startPause)
    .expect(s.home and s.discovered and not(s.notice) and s.catchUpNote and invariant)
  run endingEarlyAppliesTheRuleTest = init.then(begin).then(read(3, true)).then(browserRead(true)).then(startPause).then(endPause)
    .expect(not(s.home) and s.notice and not(s.catchUpNote) and invariant)
  run secondStartThisMonthIsRefusedTest = init.then(startPause).then(endPause).then(refusedStart)
    .expect(not(s.pause) and s.startsThisMonth == 1 and invariant)
  run newMonthAllowsAStartTest = init.then(startPause).then(endPause).then(newMonth).then(startPause)
    .expect(s.pause and s.startsThisMonth == 1 and invariant)
  run previewOnceBeforeTheStartTest = init.then(read(3, true)).then(notify).then(notify)
    .expect(s.previewSent and s.outNotices == 0 and invariant)
  run oneOutNoticePerEpisodeTest = init.then(begin).then(read(3, true)).then(notify).then(notify)
    .expect(s.outNotices == 1 and invariant)
  run newEpisodeNoticesAgainTest = init.then(begin).then(read(3, true)).then(notify).then(merge).then(read(3, true)).then(notify)
    .expect(s.outNotices == 2 and invariant)
  run scoresWhileOutTest = init.then(begin).then(read(3, true)).then(browserRead(true)).then(score)
    .expect(s.scored == 1 and s.notice and invariant)
}
