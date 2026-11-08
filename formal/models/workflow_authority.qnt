// @source .github/workflows/monthly-rewards.yml
// @source .github/workflows/cancel-closed-pr-runs.yml
// @source .github/workflows/private-intake-watch.yml
// @source .github/workflows/production-watch.yml
// @source .github/workflows/referral-root-watch.yml
// @source .github/workflows/vetting-controller.yml
// @source scripts/run-vetting-controller.ts
// Separate event dispatch from an authorized exact-checkout write. Read-only
// health watches cannot imply that a deployment, payment or scan completed.
module workflow_authority {
  var s: { branch: str, event: str, exactHead: bool, environment: str,
    dispatched: Set[str], outcome: str, databaseWrite: bool, cancellation: bool }
  action init = s' = { branch: "feature", event: "pull_request", exactHead: false,
    environment: "none", dispatched: Set(), outcome: "queued", databaseWrite: false, cancellation: false }
  action event(branch, event, exact) = all {
    s.outcome == "queued", branch.in(Set("main", "development", "feature")),
    event.in(Set("schedule", "workflow_dispatch", "pull_request", "closed")),
    s' = s.with("branch", branch).with("event", event).with("exactHead", exact)
      .with("environment", if (branch == "main") "production" else if (branch == "development") "staging" else "none"),
  }
  action dispatchMonthly = all { s.outcome == "queued", s.event == "schedule",
    s' = s.with("dispatched", Set("main", "development")).with("outcome", "dispatched") }
  action writeMonthly = all { s.outcome == "queued", s.event == "workflow_dispatch", s.exactHead,
    s.branch.in(Set("main", "development")),
    s' = s.with("databaseWrite", true).with("outcome", "written") }
  action watch = all { s.outcome == "queued", s.branch == "main", s.event.in(Set("schedule", "workflow_dispatch")),
    s' = s.with("outcome", "observed") }
  action cancelClosedPr = all { s.outcome == "queued", s.event == "closed", s.exactHead,
    s' = s.with("cancellation", true).with("outcome", "cancelled-pr-checks") }
  action refuse = all { s.outcome == "queued", s' = s.with("outcome", "refused") }
  action step = {
    nondet branch = Set("main", "development", "feature").oneOf()
    nondet eventName = Set("schedule", "workflow_dispatch", "pull_request", "closed").oneOf()
    nondet exact = Set(false, true).oneOf()
    any { event(branch, eventName, exact), dispatchMonthly, writeMonthly, watch, cancelClosedPr, refuse }
  }
  val invariant = all {
    s.databaseWrite implies (s.exactHead and s.event == "workflow_dispatch" and s.environment.in(Set("production", "staging"))),
    s.environment == "production" iff s.branch == "main",
    s.cancellation implies s.event == "closed",
    s.outcome == "observed" implies not(s.databaseWrite),
  }
  run scheduledDispatchDoesNotWriteTest = init.then(event("main", "schedule", true)).then(dispatchMonthly)
    .expect(not(s.databaseWrite) and s.dispatched == Set("main", "development"))
  run stagingWriteUsesStagingTest = init.then(event("development", "workflow_dispatch", true)).then(writeMonthly)
    .expect(s.databaseWrite and s.environment == "staging")
  run featureRequestRefusedTest = init.then(event("feature", "workflow_dispatch", true)).then(refuse)
    .expect(not(s.databaseWrite))
  run closedPrCancellationTest = init.then(event("feature", "closed", true)).then(cancelClosedPr)
    .expect(s.cancellation and not(s.databaseWrite))
}
