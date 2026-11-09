// @source src/lib/model-outcomes.ts
// Canonical model aliases share a bucket; attribution joins the same actor and
// exact PR artifact/review source. Input ledger points never depend on tokens.
// Six representative declarations include alias, wrong actor and unknown model.
module ui_model_outcomes {
  var declarations: Set[int]
  var events: Set[int]
  var projection: { ready: bool, model1: int, model2: int, total: int }
  pure def declarationActor(d: int): int = if (d == 3) 2 else 1
  pure def declarationModel(d: int): int = if (d == 5) 0 else if (d == 2) 2 else 1
  pure def declarationSource(d: int): int = if (d == 6) 2 else 1
  pure def eventActor(e: int): int = if (e == 2) 2 else 1
  // Events 1 and 2 share PR artifact 1; event 3 is review source 2.
  def ownModels(e: int): Set[int] = declarations.filter(d =>
    declarationModel(d) > 0 and declarationActor(d) == eventActor(e)
      and (e != 3 or declarationSource(d) == 2)).map(d => declarationModel(d))
  def modelPoints(model: int): int = events.fold(0, (total, e) =>
    total + if (ownModels(e).contains(model)) 6 / ownModels(e).size() else 0)
  val attributedPoints = events.filter(e => ownModels(e).size() > 0).size() * 6
  val score = events.size() * 6
  action init = all { declarations' = Set(), events' = Set(), projection' = {ready: false, model1: 0, model2: 0, total: 0} }
  action declare(d: int): bool = all { declarations' = declarations.union(Set(d)), events' = events, projection' = projection.with("ready", false) }
  action observe(e: int): bool = all { events' = events.union(Set(e)), declarations' = declarations, projection' = projection.with("ready", false) }
  action project = all { declarations' = declarations, events' = events,
    projection' = { ready: true, model1: modelPoints(1), model2: modelPoints(2), total: score } }
  action step = any {
    declare(1), declare(2), declare(3), declare(4), declare(5), declare(6),
    observe(1), observe(2), observe(3), project
  }
  val invariant = all {
    modelPoints(1) + modelPoints(2) == attributedPoints,
    attributedPoints <= score,
    modelPoints(1) >= 0, modelPoints(2) >= 0,
    projection.ready implies projection.model1 == modelPoints(1) and projection.model2 == modelPoints(2) and projection.total == score
  }
  run ownActorTest = init.then(declare(1)).then(observe(2)).expect(attributedPoints == 0 and score == 6)
  run aliasTest = init.then(declare(1)).then(declare(4)).then(observe(1)).expect(modelPoints(1) == 6)
  run splitTest = init.then(declare(1)).then(declare(2)).then(observe(1)).expect(modelPoints(1) == 3 and modelPoints(2) == 3)
  run reviewSourceTest = init.then(declare(1)).then(observe(3)).expect(attributedPoints == 0)
  run reviewJoinedTest = init.then(declare(6)).then(observe(3)).expect(modelPoints(1) == 6)
  run unavailableModelTest = init.then(declare(5)).then(observe(1)).expect(attributedPoints == 0)
}
