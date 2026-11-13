// @source src/App.tsx
// @evidence tests/e2e/home-audience.spec.ts
// @evidence tests/e2e/clipboard-feedback.spec.ts
// Two audiences, three URL values, and at most three browser history entries.
// URL parsing is abstracted to absent, maintainer, or invalid. The DOM, native
// history and launch URL encoding are checked through the browser scenarios.
// Async clipboard ownership is refined by ui_clipboard_requests; this model
// records only current visible feedback and its reset on an audience change.
module ui_home_audience {
  type View = { history: List[str], cursor: int, audience: str,
    prompt: str, launcher: str, feedback: str }
  var s: View
  val queries = Set("", "maintainer", "invalid")
  pure def audience(query: str): str =
    if (query == "maintainer") "maintainer" else "contributor"
  pure def changed(view: View, query: str): View = {
    val selectedAudience = audience(query)
    view.with("audience", selectedAudience).with("prompt", selectedAudience).with("launcher", selectedAudience)
      .with("feedback", if (view.audience == selectedAudience) view.feedback else "idle")
  }
  action init = s' = {history: List(""), cursor: 0, audience: "contributor",
    prompt: "contributor", launcher: "contributor", feedback: "idle"}
  action open(query: str): bool = all {
    queries.contains(query),
    s' = changed(s, query).with("history", List(query)).with("cursor", 0)
      .with("feedback", "idle")
  }
  action chooseAudience(selectedAudience: str): bool = all {
    Set("contributor", "maintainer").contains(selectedAudience), selectedAudience != s.audience,
    s.cursor < 2,
    s' = changed(s, if (selectedAudience == "maintainer") "maintainer" else "")
      .with("history", s.history.slice(0, s.cursor + 1)
        .append(if (selectedAudience == "maintainer") "maintainer" else ""))
      .with("cursor", s.cursor + 1)
  }
  action back = all {s.cursor > 0,
    s' = changed(s, s.history.nth(s.cursor - 1)).with("cursor", s.cursor - 1)}
  action forward = all {s.cursor + 1 < s.history.length(),
    s' = changed(s, s.history.nth(s.cursor + 1)).with("cursor", s.cursor + 1)}
  action reload = s' = changed(s, s.history.nth(s.cursor)).with("feedback", "idle")
  action copy(result: str): bool = all {Set("copied", "failed").contains(result),
    s' = s.with("feedback", result)}
  action step = any {
    {nondet query = queries.oneOf(); open(query)},
    {nondet selectedAudience = Set("contributor", "maintainer").oneOf(); chooseAudience(selectedAudience)},
    back, forward, reload,
    {nondet result = Set("copied", "failed").oneOf(); copy(result)},
    s' = s
  }
  val invariant = all {
    s.cursor >= 0, s.cursor < s.history.length(), s.history.length() <= 3,
    s.audience == audience(s.history.nth(s.cursor)),
    s.prompt == s.audience, s.launcher == s.audience
  }
  run defaultContributorTest = init.expect(s.audience == "contributor")
  run directMaintainerTest = init.then(open("maintainer"))
    .expect(s.prompt == "maintainer" and s.launcher == "maintainer")
  run invalidFallsBackTest = init.then(open("invalid"))
    .expect(s.audience == "contributor")
  run selectedRoleSurvivesReloadTest = init.then(chooseAudience("maintainer")).then(reload)
    .expect(s.audience == "maintainer")
  run historyRestoresRoleTest = init.then(chooseAudience("maintainer"))
    .then(chooseAudience("contributor")).then(back)
    .expect(s.audience == "maintainer").then(forward)
    .expect(s.audience == "contributor")
  run roleChangeClearsSuccessTest = init.then(copy("copied"))
    .then(chooseAudience("maintainer")).expect(s.feedback == "idle")
  run roleChangeClearsFailureTest = init.then(copy("failed"))
    .then(chooseAudience("maintainer")).expect(s.feedback == "idle")
  run newSelectionDiscardsForwardHistoryTest = init.then(chooseAudience("maintainer"))
    .then(back).then(chooseAudience("maintainer"))
    .expect(s.history.length() == 2 and s.cursor == 1)
}
