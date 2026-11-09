// @source scripts/readme-proof-binding.ts
// @source scripts/prepare-payments-import.ts
// @source scripts/sync-cycle-index.ts
// @source scripts/prior-cycle-accrual.ts
// @source src/lib/canonical-json.ts
// @source src/lib/rewards.ts
// @source migrations/0015_wallet_observations.sql
// @evidence scripts/historical-cycle-registry.test.ts
// Historical README observations, not wallet control or payment authority.
// Two actors, two rows, two prior rows, two calls, 24 input profiles and six
// canonical proof classes. Proof 1 is one representative exact legacy pin;
// 2..6 differ in address, chain, observation time, commit or source URL.
// Dependent URL/address fields may also differ to satisfy caller validation.
// Object
// property order is not canonical identity. Other legacy entries obey the same
// exact (project, cycle, actor, proof) equality; no arbitrary legacy boolean.
//
// Reviewed prior artifacts and frozen actor/logins are caller inputs. The
// helper does not itself prove review, authenticate a file, validate a schema,
// or fetch GitHub. priorReadmeProofs collects every README row regardless of
// payment/carry state. Duplicate actor rows are excluded by validated manifest
// callers; this model does not treat an unvalidated map as trusted history.
//
// baseline models assertRewardAllocationManifest before baseline comparison.
// import models cycle rows: exact frozen login, binding, then structural check.
// schema and shape are separate supplied predicates: complete manifest checks
// versus import's numeric actor ID, README URL/commit, address and date checks.
// preparation models the separate reviewed legacy preparation path, which has
// no cycle binding check. Non-README import rows are skipped before validation.
// An unbound cycle row is reported/skipped; a malformed admitted observation
// throws and returns no SQL prefix. Returned indices record admitted membership
// in traversal order; the importer's observedAt sort before SQL serialization
// is abstracted. These are observations, never database commits. File writes,
// D1 replay and native I/O are outside this
// synchronous decision model; existing source_import covers broader imports.
module readme_proof_binding {
  val slots = Set(1, 2)
  val proofs = 0.to(6)
  type Row = { actor: int, login: int, proof: int, shape: bool, baseline: bool }
  type Prior = { actor: int, proof: int, carried: bool }
  type State = { phase: str, call: int, mode: str, project: int, cycle: int,
    count: int, priorCount: int, priorCursor: int, cursor: int, schema: bool,
    sources: bool, loginReused: bool, reordered: bool, priorRows: int -> Prior,
    rows: int -> Row, frozenLogins: int -> int, priorProofs: int -> int,
    staged: List[int], returned: List[int], skipped: Set[int], results: int -> str,
    error: str, walletAuthorized: bool, paid: bool }
  var s: State
  val original: Row = { actor: 1, login: 1, proof: 1, shape: true, baseline: true }
  val absent: Row = { actor: 2, login: 2, proof: 0, shape: true, baseline: true }
  val initial: State = { phase: "input", call: 1, mode: "baseline", project: 2, cycle: 2,
    count: 1, priorCount: 1, priorCursor: 1, cursor: 1, schema: true,
    sources: true, loginReused: false, reordered: false,
    priorRows: Map(1 -> { actor: 1, proof: 1, carried: true }, 2 -> { actor: 2, proof: 0, carried: false }),
    rows: Map(1 -> original, 2 -> absent), frozenLogins: Map(1 -> 1, 2 -> 2),
    priorProofs: Map(1 -> 0, 2 -> 0), staged: List(), returned: List(), skipped: Set(),
    results: Map(1 -> "pending", 2 -> "pending"), error: "none", walletAuthorized: false, paid: false }
  action init = s' = initial
  def current: Row = s.rows.get(if (slots.contains(s.cursor)) s.cursor else 1)
  pure def legacy(project: int, cycle: int, actor: int, proof: int): bool =
    project == 1 and cycle == 1 and actor == 1 and proof == 1
  pure def reason(prior: int, project: int, cycle: int, actor: int, proof: int): str =
    if (prior > 0 and prior == proof) "bound-prior"
    else if (legacy(project, cycle, actor, proof)) "bound-legacy"
    else if (prior > 0) "changed-proof" else "new-proof"
  def binding: str = reason(s.priorProofs.get(current.actor), s.project, s.cycle, current.actor, current.proof)
  def bound: bool = Set("bound-prior", "bound-legacy").contains(binding)
  def abort(error: str): State = s.with("phase", "done").with("error", error).with("returned", List())
  action configuration(mode: str, project: int, cycle: int, count: int, schema: bool, sources: bool): bool = all {
    s.phase == "input", Set("baseline", "import", "preparation").contains(mode),
    slots.contains(project), slots.contains(cycle), Set(0, 1, 2).contains(count),
    s' = s.with("mode", mode).with("project", project).with("cycle", cycle).with("count", count)
      .with("schema", schema).with("sources", sources) }
  action row(index: int, actor: int, login: int, proof: int, shape: bool, baseline: bool): bool = all {
    s.phase == "input", slots.contains(index), slots.contains(actor), slots.contains(login), proofs.contains(proof),
    s' = s.with("rows", s.rows.set(index, { actor: actor, login: login, proof: proof, shape: shape, baseline: baseline })) }
  action prior(index: int, actor: int, proof: int, carried: bool): bool = all {
    s.phase == "input", slots.contains(index), slots.contains(actor), proofs.contains(proof),
    s.priorRows.get(if (index == 1) 2 else 1).actor != actor,
    s' = s.with("priorCount", 2).with("priorRows", s.priorRows.set(index, { actor: actor, proof: proof, carried: carried })) }
  action observations(reused: bool, reordered: bool): bool = all { s.phase == "input",
    s' = s.with("loginReused", reused).with("reordered", reordered) }
  action begin = all { s.phase == "input",
    s' = if (s.mode == "baseline" and not(s.schema)) abort("schema") else s.with("phase", "prior") }
  action collectPrior = {
    val entry = s.priorRows.get(if (slots.contains(s.priorCursor)) s.priorCursor else 1)
    all { s.phase == "prior",
      s' = if (s.priorCursor > s.priorCount) s.with("phase", "row")
        else s.with("priorCursor", s.priorCursor + 1).with("priorProofs",
          if (entry.proof > 0) s.priorProofs.set(entry.actor, entry.proof) else s.priorProofs) }
  }
  def skip(reason: str): State = s.with("cursor", s.cursor + 1).with("skipped", s.skipped.union(Set(s.cursor)))
    .with("results", s.results.set(s.cursor, reason))
  action inspect = all { s.phase == "row",
    s' = if (s.cursor > s.count) {
      if (s.mode != "baseline" and s.sources and s.staged.length() == 0) abort("no-observations")
      else s.with("phase", "done").with("returned", s.staged)
    } else if (s.mode == "baseline") {
      if (not(current.baseline)) abort("baseline")
      else if (current.proof > 0 and not(bound)) abort(binding)
      else s.with("cursor", s.cursor + 1).with("staged", s.staged.append(s.cursor))
        .with("results", s.results.set(s.cursor, if (current.proof == 0) "other-proof" else binding))
    } else if (current.proof == 0) skip("not-readme")
    else if (s.mode == "import" and current.login != s.frozenLogins.get(current.actor)) skip("frozen-login")
    else if (s.mode == "import" and not(bound)) skip(binding)
    else s.with("phase", "shape") }
  action validateObservation = all { s.phase == "shape",
    s' = if (not(current.shape)) abort("observation-shape")
      else s.with("phase", "row").with("cursor", s.cursor + 1).with("staged", s.staged.append(s.cursor))
        .with("results", s.results.set(s.cursor, if (s.mode == "preparation") "preparation" else binding)) }
  action retry = all { s.phase == "done", s.call == 1,
    s' = s.with("phase", "input").with("call", 2).with("priorCursor", 1).with("cursor", 1)
      .with("priorProofs", Map(1 -> 0, 2 -> 0)).with("staged", List()).with("returned", List())
      .with("skipped", Set()).with("results", Map(1 -> "pending", 2 -> "pending")).with("error", "none") }
  // Bound simulation to representative complete inputs rather than allowing
  // every independent setup setter to form an artificial Cartesian product.
  // The named scenarios also use the bounded setters above for readable traces.
  action profile(kind: int): bool = {
    val base = initial.with("call", s.call)
    val noPrior = base.priorRows.set(1, { actor: 1, proof: 0, carried: false })
    val bothPrior = base.priorRows.set(2, { actor: 2, proof: 1, carried: false })
    val selected = if (kind >= 1 and kind <= 5) base.with("rows", base.rows.set(1, original.with("proof", kind + 1)))
      else if (kind == 6) base.with("rows", base.rows.set(1, original.with("actor", 2)))
      else if (kind == 7) base.with("project", 1).with("cycle", 1).with("priorRows", noPrior)
      else if (kind == 8) base.with("cycle", 1).with("priorRows", noPrior)
      else if (kind == 9) base.with("project", 1).with("priorRows", noPrior)
      else if (kind == 10) base.with("mode", "import").with("count", 2)
        .with("rows", base.rows.set(2, absent.with("proof", 1)))
      else if (kind == 11) base.with("mode", "import").with("rows", base.rows.set(1, original.with("login", 2)))
      else if (kind == 12) base.with("mode", "import").with("count", 2).with("priorCount", 2).with("priorRows", bothPrior)
        .with("rows", base.rows.set(2, absent.with("proof", 1).with("shape", false)))
      else if (kind == 13) base.with("mode", "preparation").with("rows", base.rows.set(1, absent.with("proof", 6)))
      else if (kind == 14) base.with("mode", "preparation").with("rows", base.rows.set(1, absent.with("proof", 6).with("shape", false)))
      else if (kind == 15) base.with("rows", base.rows.set(1, original.with("proof", 0)))
      else if (kind == 16) base.with("schema", false)
      else if (kind == 17) base.with("rows", base.rows.set(1, original.with("baseline", false)))
      else if (kind == 18) base.with("mode", "import").with("count", 0).with("sources", false)
      else if (kind == 19) base.with("mode", "import").with("count", 0)
      else if (kind == 20) base.with("mode", "import").with("count", 2).with("rows", base.rows.set(2, absent.with("shape", false)))
      else if (kind == 21) base.with("reordered", true).with("loginReused", true)
      else if (kind == 22) base.with("priorRows", base.priorRows.set(1, { actor: 1, proof: 1, carried: false }))
      else if (kind == 23) base.with("project", 1).with("cycle", 1)
        .with("priorRows", base.priorRows.set(1, { actor: 1, proof: 2, carried: true }))
      else base
    all { s.phase == "input", 0.to(23).contains(kind), s' = selected }
  }
  action step = {
    nondet kind = 0.to(23).oneOf()
    any { profile(kind), begin, collectPrior, inspect, validateObservation, retry, s' = s }
  }
  val invariant = all { s.call <= 2, s.cursor >= 1, s.cursor <= 3, s.priorCursor >= 1, s.priorCursor <= 3,
    not(s.walletAuthorized), not(s.paid),
    s.error != "none" implies s.returned == List(),
    s.returned.indices().forall(position => {
      val index = s.returned.nth(position)
      s.staged.indices().exists(candidate => s.staged.nth(candidate) == index) and not(s.skipped.contains(index))
    }),
    s.phase == "done" and s.error == "none" implies s.returned == s.staged,
    s.mode == "baseline" implies s.staged.indices().forall(position => {
      val entry = s.rows.get(s.staged.nth(position))
      entry.baseline and (entry.proof == 0 or
        (s.priorProofs.get(entry.actor) > 0 and s.priorProofs.get(entry.actor) == entry.proof) or
        legacy(s.project, s.cycle, entry.actor, entry.proof))
    }),
    s.mode == "import" implies s.staged.indices().forall(position => {
      val index = s.staged.nth(position)
      val entry = s.rows.get(index)
      entry.proof > 0 and entry.shape and entry.login == s.frozenLogins.get(entry.actor)
        and Set("bound-prior", "bound-legacy").contains(s.results.get(index))
        and ((s.priorProofs.get(entry.actor) > 0 and s.priorProofs.get(entry.actor) == entry.proof) or
          legacy(s.project, s.cycle, entry.actor, entry.proof))
    }),
    s.mode == "baseline" and s.error == "none" and s.phase == "done" implies s.schema }
  action ready = begin.then(collectPrior).then(collectPrior)
  action readyTwoPriors = begin.then(collectPrior).then(collectPrior).then(collectPrior)
  action baselineOne = ready.then(inspect).then(inspect)
  action importOne = ready.then(inspect).then(validateObservation).then(inspect)
  run frozenProofSurvivesRenameTest = init.then(observations(true, false)).then(baselineOne)
    .expect(s.returned == List(1) and s.results.get(1) == "bound-prior" and invariant)
  run canonicalPropertyOrderDoesNotChangeIdentityTest = init.then(observations(false, true)).then(baselineOne)
    .expect(s.returned == List(1) and invariant)
  run reusedLoginNotAuthorityTest = init.then(row(1, 2, 1, 1, true, true)).then(ready).then(inspect)
    .expect(s.error == "new-proof" and invariant)
  run alteredProofRefusedTest = init.then(row(1, 1, 1, 2, true, true)).then(ready).then(inspect)
    .expect(s.error == "changed-proof" and invariant)
  run alteredChainRefusedTest = init.then(row(1, 1, 1, 3, true, true)).then(ready).then(inspect)
    .expect(s.error == "changed-proof" and invariant)
  run alteredObservationTimeRefusedTest = init.then(row(1, 1, 1, 4, true, true)).then(ready).then(inspect)
    .expect(s.error == "changed-proof" and invariant)
  run alteredCommitRefusedTest = init.then(row(1, 1, 1, 5, true, true)).then(ready).then(inspect)
    .expect(s.error == "changed-proof" and invariant)
  run alteredSourceUrlRefusedTest = init.then(row(1, 1, 1, 6, true, true)).then(ready).then(inspect)
    .expect(s.error == "changed-proof" and invariant)
  run exactLegacyTupleQualifiesWithoutPriorProofTest = init.then(prior(1, 1, 0, false))
    .then(configuration("baseline", 1, 1, 1, true, true)).then(readyTwoPriors).then(inspect).then(inspect)
    .expect(s.results.get(1) == "bound-legacy" and invariant)
  run legacyProjectCannotBeChangedTest = init.then(prior(1, 1, 0, false))
    .then(configuration("baseline", 2, 1, 1, true, true)).then(readyTwoPriors).then(inspect)
    .expect(s.error == "new-proof" and invariant)
  run legacyCycleCannotBeChangedTest = init.then(prior(1, 1, 0, false))
    .then(configuration("baseline", 1, 2, 1, true, true)).then(readyTwoPriors).then(inspect)
    .expect(s.error == "new-proof" and invariant)
  run legacyActorCannotBeChangedTest = init.then(row(1, 2, 2, 1, true, true))
    .then(configuration("baseline", 1, 1, 1, true, true)).then(ready).then(inspect)
    .expect(s.error == "new-proof" and invariant)
  run exactLegacyPinStillQualifiesWithDifferentPriorTest = init.then(prior(1, 1, 2, false))
    .then(configuration("baseline", 1, 1, 1, true, true)).then(readyTwoPriors).then(inspect).then(inspect)
    .expect(s.results.get(1) == "bound-legacy" and invariant)
  run priorProofCollectionIncludesNoncarriedRowsTest = init.then(prior(1, 1, 1, false)).then(readyTwoPriors)
    .then(inspect).then(inspect).expect(s.results.get(1) == "bound-prior" and invariant)
  run actorBoundOtherProofUsesManifestValidationTest = init.then(row(1, 1, 1, 0, true, true)).then(baselineOne)
    .expect(s.results.get(1) == "other-proof" and invariant)
  run malformedManifestRefusesBeforeBindingTest = init.then(configuration("baseline", 1, 1, 1, false, true)).then(begin)
    .expect(s.error == "schema" and s.priorProofs.get(1) == 0 and invariant)
  run changedBaselineActorOrLoginRefusesEvenPinnedProofTest = init.then(configuration("baseline", 1, 1, 1, true, true))
    .then(row(1, 1, 1, 1, true, false)).then(ready).then(inspect).expect(s.error == "baseline" and invariant)
  run importSkipsUnboundRowAndKeepsBoundObservationTest = init.then(configuration("import", 2, 2, 2, true, true))
    .then(row(2, 2, 2, 1, true, true)).then(ready).then(inspect).then(validateObservation).then(inspect).then(inspect)
    .expect(s.returned == List(1) and s.skipped == Set(2) and s.results.get(2) == "new-proof" and invariant)
  run importChecksFrozenLoginBeforeBindingTest = init.then(configuration("import", 2, 2, 1, true, true))
    .then(row(1, 1, 2, 1, true, true)).then(ready).then(inspect).then(inspect)
    .expect(s.error == "no-observations" and s.results.get(1) == "frozen-login" and invariant)
  run laterMalformedObservationReturnsNoSqlPrefixTest = init.then(configuration("import", 2, 2, 2, true, true))
    .then(prior(2, 2, 1, false)).then(row(2, 2, 2, 1, false, true)).then(readyTwoPriors)
    .then(inspect).then(validateObservation).then(inspect).then(validateObservation)
    .expect(s.error == "observation-shape" and s.staged == List(1) and s.returned == List() and invariant)
  run reviewedPreparationDoesNotRequireCyclePinTest = init.then(configuration("preparation", 2, 2, 1, true, true))
    .then(row(1, 2, 2, 6, true, true)).then(importOne)
    .expect(s.returned == List(1) and s.results.get(1) == "preparation" and invariant)
  run preparationStillValidatesObservationTest = init.then(configuration("preparation", 2, 2, 1, true, true))
    .then(row(1, 2, 2, 6, false, true)).then(ready).then(inspect).then(validateObservation)
    .expect(s.error == "observation-shape" and invariant)
  run nonReadmeImportRowIsSkippedBeforeShapeValidationTest = init.then(configuration("import", 2, 2, 2, true, true))
    .then(row(2, 2, 2, 0, false, true)).then(ready).then(inspect).then(validateObservation).then(inspect).then(inspect)
    .expect(s.returned == List(1) and s.results.get(2) == "not-readme" and invariant)
  run noSourceRecordsReturnEmptySqlTest = init.then(configuration("import", 2, 2, 0, true, false)).then(ready).then(inspect)
    .expect(s.error == "none" and s.returned == List() and invariant)
  run sourceRecordsWithoutObservationsRefuseTest = init.then(configuration("import", 2, 2, 0, true, true)).then(ready).then(inspect)
    .expect(s.error == "no-observations" and invariant)
  run correctedRetryDropsEarlierStagedRowsTest = init.then(configuration("import", 2, 2, 2, true, true))
    .then(prior(2, 2, 1, false)).then(row(2, 2, 2, 1, false, true)).then(readyTwoPriors)
    .then(inspect).then(validateObservation).then(inspect).then(validateObservation).then(retry)
    .then(configuration("import", 2, 2, 1, true, true)).then(readyTwoPriors).then(inspect).then(validateObservation).then(inspect)
    .expect(s.returned == List(1) and s.call == 2 and invariant)
}
