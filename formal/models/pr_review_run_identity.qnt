// @source backend/trace/handler.ts
// Creating a trace run binds a (projectId, repository) pair. The project must be
// registered, else 404; the repository must belong to it by id, alias or current
// path, else 422. A refusal creates nothing, so the created identity is kept
// untouched. Kind: 0 foreign, 1 canonical, 2 alias.
module run_identity {
  var s: { registered: bool, kind: int, runs: int, refused: int }
  action init = s' = { registered: false, kind: 0, runs: 0, refused: 0 }
  def accepted(reg: bool, kind: int): bool = reg and kind > 0
  // The same action covers both outcomes, so weakening the guard changes state
  // instead of only disabling a step.
  action create(reg: bool, kind: int): bool =
    s' = if(accepted(reg, kind))
      s.with("registered", true).with("kind", kind).with("runs", s.runs + 1)
    else
      s.with("refused", s.refused + 1)
  action step = {
    nondet reg = Set(false, true).oneOf()
    nondet kind = Set(0, 1, 2).oneOf()
    create(reg, kind)
  }
  val invariant = all {
    s.runs == 0 or accepted(s.registered, s.kind),
    s.runs == s.runs,
    s.refused >= 0 }
  run unknownProjectRefusedTest = init.then(create(false, 1))
    .expect(s.runs == 0 and s.refused == 1)
  run foreignRepositoryRefusedTest = init.then(create(true, 1)).then(create(true, 0))
    .expect(s.runs == 1 and s.kind == 1 and s.refused == 1)
  run canonicalAcceptedTest = init.then(create(true, 1))
    .expect(s.runs == 1 and s.refused == 0)
  run aliasAcceptedTest = init.then(create(true, 2))
    .expect(s.runs == 1 and s.kind == 2)
}
