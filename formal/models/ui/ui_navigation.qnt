// @source src/App.tsx
// @source src/Link.tsx
// @source src/lib/site-routes.ts
// @source src/lib/document-head.ts
// @source src/Presentation.tsx
// @source src/Operations.tsx
// @source src/lib/copy-text.ts
// Navigation, bounded list selection, disclosure, and coarse clipboard outcome.
// Request ownership and feedback expiry are refined in ui_clipboard_requests.
module ui_navigation {
  var s: { route: int, history: List[int], selected: int, page: int, pages: int, disclosure: bool, copy: str }
  action init = s' = { route: 1, history: List(1), selected: 1, page: 0, pages: 2, disclosure: false, copy: "idle" }
  action navigate = all { s.history.length() == 1 and s.route == 1, s' = s.with("route", 2).with("history", s.history.append(2)).with("selected", 2).with("copy", "idle") }
  action back = all { s.history.length() > 1, s' = s.with("history", s.history.slice(0, s.history.length() - 1)).with("route", 1).with("selected", 1).with("copy", "idle") }
  action nextPage = all { s.page + 1 < s.pages, s' = s.with("page", s.page + 1) }
  action filterRows = s' = s.with("page", 0).with("pages", 1)
  action toggle = s' = s.with("disclosure", not(s.disclosure))
  action copySuccess = s' = s.with("copy", "copied")
  action copyFailure = s' = s.with("copy", "error")
  action clearFeedback = s' = s.with("copy", "idle")
  action step = any { navigate, back, nextPage, filterRows, toggle, copySuccess, copyFailure, clearFeedback, s' = s }
  val invariant = all { s.selected == s.route, s.page >= 0, s.page < s.pages }
  run historyTest = init.then(navigate).then(back).expect(s.route == 1 and s.selected == 1)
  run filterTest = init.then(nextPage).then(filterRows).expect(s.page == 0)
  run copyFailureTest = init.then(copyFailure).expect(s.copy == "error")
}
