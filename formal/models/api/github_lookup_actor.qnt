// @source backend/projects/github-lookup.ts
// @source backend/github.ts
// @evidence scripts/project-registry-api.test.ts
// One lookup, two immutable actor IDs and current-login equivalence classes.
// Invalid requested logins return null before fetch. An optional actor ID
// chooses /user/<id>; otherwise /users/<login> is used. ID lookups can return
// a renamed login, while name lookups require a case-insensitive name match.
// Account shape/login/positive-safe-ID validation is an input predicate.
// A known organization/bot type yields 422 before incomplete-fact validation.
// githubJson distinguishes 404, rate limits, other HTTP failures and malformed
// objects. Network, bounded-body and decoding exceptions propagate without a
// fabricated actor. This module does not implement redirects: the injected
// fetcher may return a followed response; an unfollowed 3xx is non-success.
// The ten-second abort signal is represented as transport failure, not a clock
// proof. No mutation, authority grant or current-login ownership persistence.
// Existing API tests cover rename/ID mismatch and personal-account refusal;
// they do not execute every scenario below. Source-authored, unexecuted model.
module github_lookup_actor {
  var s: { phase: str, byId: bool, fetched: bool, result: str, actor: int,
    login: str, status: int }
  action init = s' = { phase: "input", byId: false, fetched: false, result: "none", actor: 0, login: "none", status: 0 }
  action begin(byId: bool, validLogin: bool): bool = all { s.phase == "input",
    s' = s.with("byId", byId).with("phase", if (validLogin) "fetch" else "done")
      .with("result", if (validLogin) "none" else "null") }
  action http(outcome: str): bool = all { s.phase == "fetch",
    Set("object", "404", "429", "403-rate-zero", "403", "http-failure", "redirect", "bad-object", "body-error", "transport").contains(outcome),
    s' = s.with("fetched", true).with("phase", if (outcome == "object") "identity" else "done")
      .with("result", if (outcome == "object") "none" else if (outcome == "404") "null" else "error")
      .with("status", if (Set("429", "403-rate-zero").contains(outcome)) 503
        else if (Set("403", "http-failure", "redirect", "bad-object").contains(outcome)) 502 else 0) }
  action identity(kind: str, complete: bool, actor: int, login: str): bool = {
    val accepted = kind == "person" and complete and (if (s.byId) actor == 1 else login != "renamed")
    all { s.phase == "identity", Set("person", "non-person", "missing-type").contains(kind), Set(1, 2).contains(actor),
      Set("same", "case", "renamed").contains(login),
      s' = s.with("phase", "done").with("result", if (accepted) "actor" else "error")
        .with("status", if (accepted) 0 else if (kind == "non-person") 422 else 502)
        .with("actor", if (accepted) actor else 0).with("login", if (accepted) login else "none") }
  }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet outcome = Set("object", "404", "429", "403-rate-zero", "403", "http-failure", "redirect", "bad-object", "body-error", "transport").oneOf()
    nondet kind = Set("person", "non-person", "missing-type").oneOf()
    nondet actor = Set(1, 2).oneOf()
    nondet login = Set("same", "case", "renamed").oneOf()
    any { begin(yes, other), http(outcome), identity(kind, yes, actor, login), s' = s }
  }
  val invariant = all {
    s.result == "actor" implies s.fetched and s.phase == "done" and s.actor > 0,
    s.result == "actor" and s.byId implies s.actor == 1,
    s.result == "actor" and not(s.byId) implies s.login != "renamed",
    s.result != "actor" implies s.actor == 0 }
  run invalidLoginMakesNoRequestTest = init.then(begin(true, false)).expect(s.result == "null" and not(s.fetched) and invariant)
  run missingAccountIsNullTest = init.then(begin(false, true)).then(http("404")).expect(s.result == "null" and invariant)
  run matchingLoginAcceptsCurrentOwnerTest = init.then(begin(false, true)).then(http("object")).then(identity("person", true, 2, "same"))
    .expect(s.actor == 2 and invariant)
  run loginCaseDoesNotChangeIdentityTest = init.then(begin(false, true)).then(http("object")).then(identity("person", true, 1, "case"))
    .expect(s.result == "actor" and invariant)
  run idLookupFollowsRenamedAccountTest = init.then(begin(true, true)).then(http("object")).then(identity("person", true, 1, "renamed"))
    .expect(s.actor == 1 and s.login == "renamed" and invariant)
  run idMismatchNeverReturnsReplacementOwnerTest = init.then(begin(true, true)).then(http("object")).then(identity("person", true, 2, "same"))
    .expect(s.status == 502 and invariant)
  run nameMismatchNeverReturnsActorTest = init.then(begin(false, true)).then(http("object")).then(identity("person", true, 1, "renamed"))
    .expect(s.status == 502 and invariant)
  run organizationRefusesBeforeShapeValidationTest = init.then(begin(false, true)).then(http("object")).then(identity("non-person", false, 1, "same"))
    .expect(s.status == 422 and invariant)
  run missingTypeIsIncompleteFactsTest = init.then(begin(true, true)).then(http("object")).then(identity("missing-type", true, 1, "same"))
    .expect(s.status == 502 and invariant)
  run zeroRemaining403IsRateLimitedTest = init.then(begin(false, true)).then(http("403-rate-zero")).expect(s.status == 503 and invariant)
  run ordinary403IsUpstreamFailureTest = init.then(begin(false, true)).then(http("403")).expect(s.status == 502 and invariant)
  run unfollowedRedirectIsNotIdentityTest = init.then(begin(true, true)).then(http("redirect")).expect(s.status == 502 and invariant)
  run abortedReadReturnsNoActorTest = init.then(begin(true, true)).then(http("transport")).expect(s.result == "error" and s.actor == 0 and invariant)
}
