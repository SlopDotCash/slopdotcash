// @source src/lib/intake-cap.mjs
// @source backend/projects/merge-activity.ts
// @source backend/projects/skill-publication.ts
// @source workers/slopbot/intake-cap.ts
// @source workers/slopbot/review.ts
// @source migrations/0134_merge_activity_open_outside.sql
// @source src/App.tsx
// @source src/PublicPages.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/merge-activity.ts
// @source functions/[[path]].ts
// @evidence src/lib/intake-cap.test.ts
// @evidence backend/projects/merge-activity.test.ts
// @evidence backend/projects/discovery-intake.test.ts
// @evidence workers/slopbot/intake-cap.test.ts
// A maintainer's intake cap (operator decision, 17 November 2026). The owner
// publishes one whole number as an immutable revision; `cap` 0 abstracts the
// absent setting. The scheduled merge activity read stores the open outside
// pull request count of a repository; `count` -1 abstracts a repository whose
// count was never read, a failed read keeps the last count, and `stale`
// abstracts a count older than INTAKE_COUNT_MAX_AGE_MS. One repository stands
// for "any repository of the project". While an active project's recent count
// is at or above the cap, the home page, /sponsors and agent discovery leave
// it out, its page shows the notice, and Slopbot skips its free advisory
// review of an outside pull request it has not reviewed before. The browser
// lists every project while its read loads or after it fails; discovery
// lists every project when the server read fails. Value assessment and
// scoring never read this state: `merge` scores in every state. The funding
// listing rule is modelled in ui_project_listing and composes by conjunction.
module api_intake_cap {
  type S = {
    cap: int, count: int, stale: bool, active: bool, browser: str, server: str,
    home: bool, sponsors: bool, discovered: bool, notice: bool,
    // Slopbot: an earlier completed review of the pull request, the last
    // review outcome (none, reviewed, skipped) and whether that skip was of a
    // new outside pull request while the project was paused.
    prior: bool, outcome: str, skipWhilePaused: bool, scored: int
  }
  var s: S
  pure def paused(t: S): bool = t.active and t.cap > 0 and t.count >= t.cap and not(t.stale)
  pure def shown(t: S): S =
    t.with("home", not(t.browser == "ready" and paused(t)))
     .with("sponsors", not(t.browser == "ready" and paused(t)))
     .with("discovered", not(t.server == "ready" and paused(t)))
     .with("notice", t.browser == "ready" and paused(t))
  action init = s' = shown({
    cap: 0, count: -1, stale: false, active: true, browser: "loading", server: "ready",
    home: true, sponsors: true, discovered: true, notice: false,
    prior: false, outcome: "none", skipWhilePaused: false, scored: 0
  })
  // An owner revision sets, changes or clears the number.
  action setCap(c: int): bool = s' = shown(s.with("cap", c))
  // A successful scheduled read stores the count with a fresh date.
  action read(n: int): bool = s' = shown(s.with("count", n).with("stale", false))
  // A failed read keeps the last count and its date.
  action failedRead = s' = shown(s)
  // Time passes without a successful read until the count is too old.
  action expire = all { s.count >= 0, s' = shown(s.with("stale", true)) }
  action status(a: bool): bool = s' = shown(s.with("active", a))
  action browserRead(ok: bool): bool = s' = shown(s.with("browser", if (ok) "ready" else "failed"))
  action serverRead(ok: bool): bool = s' = shown(s.with("server", if (ok) "ready" else "failed"))
  // One Slopbot review of the pull request. `outside` is false for an author
  // with write access or organization membership.
  action review(outside: bool): bool =
    if (paused(s) and outside and not(s.prior))
      s' = s.with("outcome", "skipped").with("skipWhilePaused", true)
    else
      s' = s.with("outcome", "reviewed").with("prior", true)
  // A maintainer merges the pull request; value assessment scores it.
  action merge = all { s.scored < 2, s' = s.with("scored", s.scored + 1) }
  action step = any {
    nondet c = 0.to(2).oneOf()
    setCap(c),
    nondet n = 0.to(3).oneOf()
    read(n),
    failedRead,
    expire,
    nondet a = Bool.oneOf()
    status(a),
    nondet ok = Bool.oneOf()
    browserRead(ok),
    nondet ok2 = Bool.oneOf()
    serverRead(ok2),
    nondet outside = Bool.oneOf()
    review(outside),
    merge,
  }
  val invariant = all {
    // Off, never read, stale or not active: nothing is paused anywhere.
    not(paused(s)) implies (s.home and s.sponsors and s.discovered and not(s.notice)),
    // Fail open: a loading or failed browser read, or a failed server read.
    s.browser != "ready" implies (s.home and s.sponsors and not(s.notice)),
    s.server == "failed" implies s.discovered,
    // A successful read of a paused project leaves it out and says why.
    (s.browser == "ready" and paused(s)) implies (not(s.home) and not(s.sponsors) and s.notice),
    (s.server == "ready" and paused(s)) implies not(s.discovered),
    s.notice implies (not(s.home) and not(s.sponsors)),
    // A pull request reviewed once is never skipped by the cap afterwards.
    (s.outcome == "skipped") implies (s.skipWhilePaused and not(s.prior)),
  }
  run offByDefaultTest = init.then(read(3)).then(browserRead(true))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run pausesAtTheNumberTest = init.then(setCap(2)).then(read(2)).then(browserRead(true))
    .expect(not(s.home) and not(s.sponsors) and not(s.discovered) and s.notice and invariant)
  run belowTheNumberIsListedTest = init.then(setCap(2)).then(read(1)).then(browserRead(true))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run comesBackByItselfTest = init.then(setCap(2)).then(read(3)).then(browserRead(true)).then(read(1))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run failedReadKeepsTheLastCountTest = init.then(setCap(2)).then(read(3)).then(browserRead(true)).then(failedRead)
    .expect(not(s.home) and not(s.discovered) and s.notice and invariant)
  run staleCountPausesNothingTest = init.then(setCap(2)).then(read(3)).then(browserRead(true)).then(expire)
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run neverReadPausesNothingTest = init.then(setCap(1)).then(browserRead(true))
    .expect(s.home and s.discovered and not(s.notice) and invariant)
  run failedBrowserReadListsAsBeforeTest = init.then(setCap(1)).then(read(3)).then(browserRead(false))
    .expect(s.home and s.sponsors and not(s.notice) and not(s.discovered) and invariant)
  run failedServerReadListsAsBeforeTest = init.then(setCap(1)).then(read(3)).then(serverRead(false))
    .expect(s.discovered and invariant)
  run clearingTheNumberListsAgainTest = init.then(setCap(1)).then(read(3)).then(browserRead(true)).then(setCap(0))
    .expect(s.home and s.sponsors and s.discovered and not(s.notice) and invariant)
  run pausedProjectKeepsItsListingTest = init.then(setCap(1)).then(read(3)).then(browserRead(true)).then(status(false))
    .expect(s.home and s.sponsors and not(s.notice) and invariant)
  run newOutsidePullRequestIsSkippedTest = init.then(setCap(2)).then(read(2)).then(review(true))
    .expect(s.outcome == "skipped" and not(s.prior) and invariant)
  run reviewedPullRequestKeepsItsReviewsTest = init.then(setCap(2)).then(read(1)).then(review(true)).then(read(3)).then(review(true))
    .expect(s.outcome == "reviewed" and s.prior and invariant)
  run maintainerPullRequestIsReviewedTest = init.then(setCap(1)).then(read(3)).then(review(false))
    .expect(s.outcome == "reviewed" and invariant)
  run skippedPullRequestIsReviewedBelowTheNumberTest = init.then(setCap(2)).then(read(2)).then(review(true)).then(read(1)).then(review(true))
    .expect(s.outcome == "reviewed" and invariant)
  run mergedWorkScoresWhilePausedTest = init.then(setCap(1)).then(read(3)).then(review(true)).then(merge)
    .expect(s.outcome == "skipped" and s.scored == 1 and invariant)
}
