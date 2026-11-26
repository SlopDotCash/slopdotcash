// @source src/RequestedRepos.tsx
// @evidence tests/e2e/requested-repos.spec.ts
// The Requested repos page for one viewer. The page is keyed by the account,
// so an account change remounts it: `life` counts mounts, a request keeps the
// life it began under, and an answer for an earlier life is dropped. board is
// 0 loading, 1 ready, 2 failed; a reload keeps a ready board on screen until
// its answer arrives. One flag, renew or withdraw is in flight at a time; a
// success reloads the board, a refusal shows its reason and changes nothing
// else. The server's decision is an input; `repo_request` models it. At most
// two mounts follow the first and three reloads happen in all.
module ui_requested_repos {
  type S = { life: int, board: int, loading: bool, loads: int, act: int,
    stale: int, done: bool, error: bool }
  var s: S
  action init = s' = { life: 1, board: 0, loading: true, loads: 0, act: 0,
    stale: 0, done: false, error: false }
  action boardAnswer(ok: bool): bool = all { s.loading,
    s' = s.with("loading", false)
      .with("board", if (ok) 1 else if (s.board == 1) 1 else 2) }
  action retry = all { not(s.loading), s.board == 2, s.loads < 3,
    s' = s.with("loading", true).with("board", 0).with("loads", s.loads + 1) }
  action submit = all { s.act == 0,
    s' = s.with("act", s.life).with("done", false).with("error", false) }
  // A success reloads the board, showing loading in place of a failed one;
  // a refusal leaves it as it is.
  action actAnswer(ok: bool): bool = all { s.act == s.life,
    not(ok) or s.loads < 3,
    s' = s.with("act", 0).with("done", ok).with("error", not(ok))
      .with("loading", if (ok) true else s.loading)
      .with("board", if (ok and s.board == 2) 0 else s.board)
      .with("loads", if (ok) s.loads + 1 else s.loads) }
  action accountChange = all { s.life < 3,
    s' = { life: s.life + 1, board: 0, loading: true, loads: s.loads, act: 0,
      stale: s.stale + (if (s.act != 0) 1 else 0), done: false, error: false } }
  action staleAnswer = all { s.stale > 0, s' = s.with("stale", s.stale - 1) }
  action step = any {
    { nondet ok = Set(false, true).oneOf()
      boardAnswer(ok) },
    retry,
    submit,
    { nondet ok = Set(false, true).oneOf()
      actAnswer(ok) },
    accountChange,
    staleAnswer }
  val invariant = and {
    // A request in flight belongs to this mount.
    s.act == 0 or s.act == s.life,
    // Done and an error never show together, nor beside a request.
    not(s.done and s.error),
    s.act != 0 implies not(s.done or s.error),
    // A failed board is never also loading.
    s.board == 2 implies not(s.loading) }
  run flagReloadsTheBoardTest = init
    .then(boardAnswer(true)).expect(s.board == 1)
    .then(submit)
    .then(actAnswer(true)).expect(s.done and s.loading and s.board == 1)
    .then(boardAnswer(true)).expect(s.board == 1 and not(s.loading))
  run refusalKeepsTheBoardTest = init
    .then(boardAnswer(true)).then(submit).then(actAnswer(false))
    .expect(s.error and not(s.loading) and s.board == 1)
  run failedBoardRetriesTest = init
    .then(boardAnswer(false)).expect(s.board == 2)
    .then(retry).expect(s.loading and s.board == 0)
    .then(boardAnswer(true)).expect(s.board == 1)
  run accountChangeDropsAnEarlierRequestTest = init
    .then(boardAnswer(true)).then(submit)
    .then(accountChange).expect(s.act == 0 and s.board == 0)
    .then(staleAnswer).expect(not(s.done) and not(s.error) and s.stale == 0)
  run secondRequestWaitsForTheFirstTest = init.then(submit).then(submit.fail())
  run earlierRequestCannotAnswerAfterAccountChangeTest = init
    .then(submit).then(accountChange).then(actAnswer(true).fail())
}
