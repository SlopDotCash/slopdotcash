// @source workers/slopbot/value-consumption.ts
// @source workers/slopbot/value-work-unit-consumption.ts
// Public consumers pin throughSequence and totalRecords. Three pages abstract
// a full immutable lineage. Corrupt, missing and stale are never zero credit.
module bot_value_history {
  var s: { serverMax: int, through: int, next: int, read: int, total: int,
    valid: bool, complete: bool, fresh: bool, status: str }
  action init = s' = {serverMax: 2, through: 0, next: 0, read: 0, total: 0,
    valid: true, complete: true, fresh: true, status: "loading"}
  action firstPage = all { s.through == 0,
    s' = s.with("through", s.serverMax).with("total", s.serverMax)
      .with("next", 1).with("read", 1) }
  action appendConcurrent = all { s.serverMax < 3,
    s' = s.with("serverMax", s.serverMax + 1) }
  action nextPage = all { s.through > 0, s.next < s.through, s.valid,
    s' = s.with("next", s.next + 1).with("read", s.read + 1) }
  action corruptBytesOrLineage = s' = s.with("valid", false).with("status", "invalid")
  action evidenceMissing = s' = s.with("complete", false)
  action sourceChanged = s' = s.with("fresh", false)
  action consume = all { s.status == "loading", s.through > 0, s.next == s.through,
    s.read == s.total, s.valid,
    s' = s.with("status", if (not(s.complete)) "incomplete" else if (not(s.fresh)) "stale" else "assessed") }
  action step = any { firstPage, appendConcurrent, nextPage, corruptBytesOrLineage,
    evidenceMissing, sourceChanged, consume, s' = s }
  val invariant = all { s.read <= s.through, s.through <= s.serverMax,
    s.status == "assessed" implies s.valid and s.read == s.total }
  run stablePageBoundaryTest = init.then(firstPage).then(appendConcurrent)
    .then(nextPage).then(consume).expect(s.through == 2 and s.serverMax == 3 and s.status == "assessed")
  run missingNotZeroTest = init.then(firstPage).then(nextPage).then(evidenceMissing)
    .then(consume).expect(s.status == "incomplete")
  run staleDistinctTest = init.then(firstPage).then(nextPage).then(sourceChanged)
    .then(consume).expect(s.status == "stale")
}
