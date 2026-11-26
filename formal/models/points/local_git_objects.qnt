// @source scripts/local-git-objects.ts
// @source scripts/compare-local-git-objects.ts
// @source scripts/github-ingestion-read.ts
// @evidence scripts/local-git-objects.test.ts
// A collector read of an exact Git tree or commit is answered from a local
// bare clone only when the clone holds the object and its answer is certain
// to equal GitHub's; otherwise the read goes to GitHub unchanged (operator
// decision, 20 November 2026). One long-lived cat-file process answers
// pipelined requests in order. If it dies, every waiting request is declined
// to GitHub and the next request starts a fresh process. Nothing is ever lost
// or answered twice, and a local answer never replaces an uncertain one.
module local_git_objects {
  // `localServed` counts answers taken from the clone; `exactServed` counts
  // those whose object was present and certain to match GitHub's shape.
  type S = {proc:str, pending:int, localServed:int, exactServed:int,
    toApi:int, asked:int}
  var s: S
  action init = s' = {proc:"idle", pending:0, localServed:0, exactServed:0,
    toApi:0, asked:0}
  // A request starts the process if none is running.
  action request = all {
    s.asked < 3,
    s' = s.with("proc", "running").with("pending", s.pending + 1)
      .with("asked", s.asked + 1)
  }
  // `exact`: the clone holds the object and every field matches GitHub's.
  action answer(exact: bool): bool = all {
    s.proc == "running", s.pending > 0,
    s' = if (exact)
        s.with("pending", s.pending - 1).with("localServed", s.localServed + 1)
          .with("exactServed", s.exactServed + 1)
      else s.with("pending", s.pending - 1).with("toApi", s.toApi + 1)
  }
  // A crash declines every waiting request to GitHub.
  action crash = all {
    s.proc == "running",
    s' = s.with("proc", "dead").with("toApi", s.toApi + s.pending).with("pending", 0)
  }
  action step = any { request, answer(true), answer(false), crash, s' = s }
  val accounted = s.localServed + s.toApi + s.pending == s.asked
  val deadIsEmpty = s.proc == "dead" implies s.pending == 0
  val onlyExactLocal = s.localServed == s.exactServed
  val invariant = all { accounted, deadIsEmpty, onlyExactLocal, s.pending >= 0 }
  run exactServedLocallyTest = init.then(request).then(answer(true))
    .expect(all { invariant, s.localServed == 1, s.toApi == 0 })
  run uncertainGoesToGitHubTest = init.then(request).then(answer(false))
    .expect(all { invariant, s.localServed == 0, s.toApi == 1 })
  run crashDeclinesWaitingTest = init.then(request).then(request).then(crash)
    .expect(all { invariant, s.toApi == 2, s.proc == "dead" })
  run restartAfterCrashTest = init.then(request).then(crash).then(request).then(answer(true))
    .expect(all { invariant, s.localServed == 1, s.toApi == 1, s.proc == "running" })
  run deadProcessCannotAnswerTest = init.then(request).then(crash).then(answer(true).fail())
}
