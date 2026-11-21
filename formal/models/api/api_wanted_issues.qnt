// @source src/lib/wanted-label.mjs
// @source backend/projects/merge-activity.ts
// @source workers/slopbot/reporting-readiness.ts
// @source backend/security/github-advisories.ts
// @source migrations/0144_merge_activity_wanted_issues.sql
// @source src/lib/merge-activity.ts
// @source src/ProjectWork.tsx
// @source src/ProjectProposalPage.tsx
// @source skills/project-contributor-template/scripts/live-report.mjs
// @evidence backend/projects/merge-activity.test.ts
// @evidence workers/slopbot/reporting-readiness.test.ts
// @evidence src/lib/wanted-label.test.ts
// @evidence scripts/live-report-wanted.test.ts
// Wanted issues (operator decision, 21 November 2026; PRD section 5). The
// owner turns the setting on or off by immutable revision; every project uses
// the one label `slop-wanted`. The scheduled merge activity read stores the
// open issues that carry the label (`stored`: the label the stored list was
// read under, "" for none) and, while the label is not yet confirmed on the
// repository (`ready` false), asks Slopbot to create it. A failed read keeps
// the last stored values; a failed creation keeps the list and is asked
// again at the next read. `created` counts label creations GitHub accepted.
// The project page shows the stored list only when its read succeeded and the
// list was read under the current setting. The contributor skill takes a
// wanted issue only when no open pull request closes it (`openClosing`).
// Points never read this state: `merge` scores in every state.
module api_wanted_issues {
  type S = {
    on: bool, stored: str, ready: bool, created: int, labelExists: bool,
    browser: str, shown: bool, openClosing: bool, taken: str,
    // The last pick took a wanted issue that an open pull request already closed.
    pickedOverOpen: bool, scored: int
  }
  var s: S
  pure def visible(t: S): bool = t.on and t.browser == "ready" and t.stored == "slop-wanted"
  pure def view(t: S): S = t.with("shown", visible(t))
  action init = s' = view({
    on: false, stored: "", ready: false, created: 0, labelExists: false,
    browser: "loading", shown: false, openClosing: false, taken: "none",
    pickedOverOpen: false, scored: 0
  })
  action setting(on: bool): bool = s' = view(s.with("on", on))
  // A successful scheduled read. With the setting on it stores the list and,
  // when the label is not confirmed, asks for it; `created` is whether GitHub
  // accepted or already had the label.
  action read(createOk: bool): bool =
    if (not(s.on))
      s' = view(s.with("stored", "").with("ready", false))
    else if (s.ready)
      s' = view(s.with("stored", "slop-wanted"))
    else if (createOk)
      s' = view(s.with("stored", "slop-wanted").with("ready", true)
        .with("created", if (s.labelExists) s.created else s.created + 1)
        .with("labelExists", true))
    else
      s' = view(s.with("stored", "slop-wanted"))
  // A failed read keeps every stored value.
  action failedRead = s' = view(s)
  // A maintainer creates the label by hand before Slopbot does.
  action handLabel = s' = view(s.with("labelExists", true))
  action browserRead(ok: bool): bool = s' = view(s.with("browser", if (ok) "ready" else "failed"))
  action prOpened(open: bool): bool = s' = view(s.with("openClosing", open))
  // The contributor skill picks work: a wanted issue only while no open pull
  // request closes it, otherwise other work.
  action pick = {
    val wanted = s.on and not(s.openClosing)
    s' = view(s.with("taken", if (wanted) "wanted" else "other")
      .with("pickedOverOpen", wanted and s.openClosing))
  }
  action merge = all { s.scored < 2, s' = view(s.with("scored", s.scored + 1)) }
  action step = any {
    nondet on = Bool.oneOf()
    setting(on),
    nondet ok = Bool.oneOf()
    read(ok),
    failedRead,
    handLabel,
    nondet b = Bool.oneOf()
    browserRead(b),
    nondet p = Bool.oneOf()
    prOpened(p),
    pick,
    merge,
  }
  val invariant = all {
    // The page lists wanted issues only for a project that has them on, after
    // a successful page read of a list read under that setting.
    s.shown iff visible(s),
    s.shown implies s.on,
    // Slopbot never creates the label more than once.
    s.created <= 1,
    // A confirmed label exists on the repository.
    s.ready implies s.labelExists,
    // Never a second pull request for an issue that already has one.
    not(s.pickedOverOpen),
  }
  run offShowsNothingTest = init.then(read(true)).then(browserRead(true))
    .expect(not(s.shown) and s.created == 0 and invariant)
  run onListsAndCreatesOnceTest = init.then(setting(true)).then(read(true)).then(browserRead(true)).then(read(true))
    .expect(s.shown and s.created == 1 and s.ready and invariant)
  run failedCreationKeepsTheListTest = init.then(setting(true)).then(read(false)).then(browserRead(true))
    .expect(s.shown and not(s.ready) and s.created == 0 and invariant)
  run failedCreationRetriesTest = init.then(setting(true)).then(read(false)).then(read(true))
    .expect(s.ready and s.created == 1 and invariant)
  run handMadeLabelIsNotRecreatedTest = init.then(handLabel).then(setting(true)).then(read(true))
    .expect(s.ready and s.created == 0 and invariant)
  run failedReadKeepsTheListTest = init.then(setting(true)).then(read(true)).then(failedRead).then(browserRead(true))
    .expect(s.shown and invariant)
  run failedPageReadShowsNoListTest = init.then(setting(true)).then(read(true)).then(browserRead(false))
    .expect(not(s.shown) and invariant)
  run turningOffHidesTheListTest = init.then(setting(true)).then(read(true)).then(browserRead(true)).then(setting(false))
    .expect(not(s.shown) and invariant)
  run turnedOnBeforeTheNextReadShowsNothingYetTest = init.then(browserRead(true)).then(setting(true))
    .expect(not(s.shown) and invariant)
  run openClosingPullRequestIsNotTakenTest = init.then(setting(true)).then(prOpened(true)).then(pick)
    .expect(s.taken == "other" and invariant)
  run freeWantedIssueIsTakenTest = init.then(setting(true)).then(pick)
    .expect(s.taken == "wanted" and invariant)
  run mergedWorkScoresEitherWayTest = init.then(setting(true)).then(read(true)).then(merge)
    .expect(s.scored == 1 and invariant)
}
