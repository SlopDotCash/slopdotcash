// @source scripts/generate-leaderboard.ts
// GitHub GraphQL returns a window reset timestamp with every response. A
// changed timestamp starts a new budget window, so consumed cost from the
// previous window must not block the first request in the new window.
module github_budget_window {
  var s: {
    window: int,
    resetAt: int,
    consumed: int,
    remaining: int,
    waitedResetAt: int,
    requests: int,
    blocked: bool
  }

  action init = s' = {
    window: 1,
    resetAt: 2,
    consumed: 0,
    remaining: 2,
    waitedResetAt: 0,
    requests: 0,
    blocked: false
  }

  action request = all {
    s.consumed < 2,
    s.remaining > 0,
    not(s.blocked),
    s' = s
      .with("consumed", s.consumed + 1)
      .with("remaining", s.remaining - 1)
      .with("requests", s.requests + 1)
  }

  action responseNewWindow = all {
    s.window == 1,
    not(s.blocked),
    s' = s
      .with("window", 2)
      .with("resetAt", 4)
      .with("consumed", 0)
      .with("remaining", 2)
      .with("waitedResetAt", 0)
  }

  action waitSameWindow = all {
    s.window == 1,
    s.consumed >= 2,
    s.waitedResetAt != s.resetAt,
    s' = s
      .with("waitedResetAt", s.resetAt)
      .with("remaining", 2)
  }

  action blockSameWindow = all {
    s.window == 1,
    s.consumed >= 2,
    s.waitedResetAt == s.resetAt,
    s' = s.with("blocked", true)
  }

  action step = any {
    request,
    responseNewWindow,
    waitSameWindow,
    blockSameWindow,
    s' = s
  }

  val invariant = all {
    s.window <= 2,
    s.consumed <= 2,
    s.remaining >= 0,
    s.blocked implies (s.window == 1 and s.consumed >= 2)
  }

  run newWindowClearsConsumedCostTest = init
    .then(request)
    .then(request)
    .then(responseNewWindow)
    .then(request)
    .expect(s.window == 2 and s.consumed == 1 and s.requests == 3 and not(s.blocked))

  run sameWindowBlocksAfterRetryTest = init
    .then(request)
    .then(request)
    .then(waitSameWindow)
    .then(blockSameWindow)
    .expect(s.window == 1 and s.blocked and invariant)
}
