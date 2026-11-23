// @source migrations/0146_identity_browser_binding.sql
// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source src/lib/identity-flow.ts
/// A website (slop-points-web) sign-in flow is bound to the browser that
/// started it: start sets a per-flow HttpOnly cookie, and authorization, the
/// callback and every poll refuse the flow without it. Terminal flows keep the
/// unbound protocol. Browsers: "starter" started the flow and holds its
/// cookie; "other" is any other browser or an HTTP client without it.
module identity_browser_binding {
  var s: {
    web: bool,
    phase: str,
    authorizedBy: str,
    completedBy: str,
    issuedTo: str,
  }

  action start(web: bool): bool =
    s' = {web: web, phase: "pending", authorizedBy: "none", completedBy: "none", issuedTo: "none"}

  action init = any { start(true), start(false) }

  /// The browser presents the flow's binding cookie.
  pure def bound(web: bool, browser: str): bool = not(web) or browser == "starter"

  /// Authorization redirects to GitHub only for a bound browser; others see a refusal page.
  action authorize(browser: str): bool = all {
    s.phase == "pending",
    bound(s.web, browser),
    s' = s.with("authorizedBy", browser),
  }

  /// The callback needs the state cookie set at authorization (same browser).
  /// Without the binding the flow ends, so no poll can receive an assertion.
  action callback(browser: str): bool = all {
    s.phase == "pending",
    s.authorizedBy == browser,
    if (bound(s.web, browser)) s' = s.with("phase", "complete").with("completedBy", browser)
    else s' = s.with("phase", "failed"),
  }

  /// Poll issues the assertion only to a bound poller.
  action poll(browser: str): bool = all {
    s.phase == "complete",
    bound(s.web, browser),
    s' = s.with("phase", "issued").with("issuedTo", browser),
  }

  action step = any {
    nondet browser = Set("starter", "other").oneOf()
    any { authorize(browser), callback(browser), poll(browser) },
    s' = s,
  }

  /// A website assertion only ever reaches the browser that started the flow,
  /// and only after that same browser completed GitHub sign-in.
  val invariant = s.web implies all {
    s.authorizedBy != "other",
    s.completedBy != "other",
    s.issuedTo != "other",
    s.phase == "issued" implies (s.completedBy == "starter" and s.issuedTo == "starter"),
  }

  run starterCompletesTest =
    start(true)
      .then(authorize("starter"))
      .then(callback("starter"))
      .then(poll("starter"))
      .expect(s.phase == "issued" and s.issuedTo == "starter")

  run otherBrowserCannotAuthorizeTest =
    start(true)
      .then(authorize("other"))
      .fail()

  run otherPollerGetsNothingTest =
    start(true)
      .then(authorize("starter"))
      .then(callback("starter"))
      .then(poll("other"))
      .fail()

  run terminalFlowStaysUnboundTest =
    start(false)
      .then(authorize("other"))
      .then(callback("other"))
      .then(poll("other"))
      .expect(s.phase == "issued")
}
