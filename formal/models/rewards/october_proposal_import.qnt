// @source scripts/october-reward-review.ts
// @source scripts/prepare-october-rewards.ts
// @source scripts/run-october-rewards.ts
// @source .github/workflows/october-rewards.yml
// @source scripts/prepare-monthly-rewards.ts
// @source scripts/points-protection-sql.ts
// @source migrations/0081_monthly_asset_amount_range.sql
// @evidence scripts/prepare-october-rewards.test.ts
// @evidence scripts/run-october-rewards.test.ts
// Two selected October projects, one reviewed proposal per project. Base 0
// means absent, 1 exactly matches the reviewed parent/children, 2 differs
// from the review or lacks children. The input digest, registry revision,
// authoritative Points and restrictions give the abstract fresh flag. The
// protected flag means the project cannot admit a new base. SQL syntax,
// D1's transaction behavior, exact financial units and byte-level identity
// equality require source tests. Existing monthly finalization is separate.
module october_proposal_import {
  pure val Projects = Set(0, 1)
  type S = { original: int -> int, base: int -> int, fresh: bool,
    protected: bool, fault: bool, applied: bool }
  var s: S

  action init = all {
    nondet first = Set(0, 1, 2).oneOf()
    nondet second = Set(0, 1, 2).oneOf()
    val bases = Map(0 -> first, 1 -> second)
    s' = { original: bases, base: bases, fresh: true, protected: false,
      fault: false, applied: false }
  }
  action stale = s' = s.with("fresh", false)
  action protect = s' = s.with("protected", true)
  action readbackFault = s' = s.with("fault", true)
  pure def valid(st: S, p: int): bool =
    st.base.get(p) == 1 or (st.base.get(p) == 0 and st.fresh and not(st.protected))
  action attempt =
    if (Projects.forall(p => valid(s, p)) and not(s.fault))
      s' = s.with("base", Projects.mapBy(_ => 1)).with("applied", true)
    else s' = s
  action step = any { stale, protect, readbackFault, attempt, s' = s }

  val invariant = all {
    Projects.forall(p => s.original.get(p) == 0 or s.base.get(p) == s.original.get(p)),
    not(s.applied) implies s.base == s.original,
    s.applied implies Projects.forall(p => s.base.get(p) == 1),
  }
  run exactReplayTest = init.then(attempt).expect(invariant)
    .then(stale).then(protect).then(attempt).expect(invariant)
  run protectedOrStaleTest = init.then(protect).then(stale).then(attempt)
    .expect(s.base == s.original and invariant)
  run partialReadbackRollbackTest = init.then(readbackFault).then(attempt)
    .expect(s.base == s.original and invariant)
}
