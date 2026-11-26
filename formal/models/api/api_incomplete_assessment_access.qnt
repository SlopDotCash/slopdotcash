// @source backend/notifications/incomplete-assessments.ts
// Each repository's maintainer check is independent. A repository whose check
// fails shows none of its rows; the queue as a whole is unavailable only when
// every repository's check failed. Rows are never shown without access.
module api_incomplete_assessment_access {
  // Check outcome per repository: "pending", "allowed", "denied", "unavailable".
  var check: int -> str
  // Queue answer: "none", "ok", "unavailable"; shown holds the repositories listed.
  var answer: str
  var shown: Set[int]
  val repos = Set(0, 1)
  action init = all { check' = repos.mapBy(_ => "pending"), answer' = "none", shown' = Set() }
  action settle(r: int, outcome: str): bool = all {
    check.get(r) == "pending",
    check' = check.set(r, outcome),
    answer' = answer,
    shown' = shown,
  }
  action respond = all {
    repos.forall(r => check.get(r) != "pending"),
    if (repos.forall(r => check.get(r) == "unavailable"))
      all { answer' = "unavailable", shown' = Set() }
    else
      all { answer' = "ok", shown' = repos.filter(r => check.get(r) == "allowed") },
    check' = check,
  }
  action settleAny = {
    nondet r = repos.oneOf()
    nondet outcome = Set("allowed", "denied", "unavailable").oneOf()
    settle(r, outcome)
  }
  action step = any { settleAny, respond }
  val invariant = and {
    shown.forall(r => check.get(r) == "allowed"),
    answer == "unavailable" implies repos.forall(r => check.get(r) == "unavailable"),
  }
  run oneGoneRepositoryHidesOnlyItsRowsTest = init
    .then(settle(0, "allowed")).then(settle(1, "unavailable")).then(respond)
    .expect(answer == "ok" and shown == Set(0))
  run nonMaintainerWithGoneRepositoryGetsEmptyListTest = init
    .then(settle(0, "denied")).then(settle(1, "unavailable")).then(respond)
    .expect(answer == "ok" and shown == Set())
  run fullOutageIsUnavailableTest = init
    .then(settle(0, "unavailable")).then(settle(1, "unavailable")).then(respond)
    .expect(answer == "unavailable" and shown == Set())
}
