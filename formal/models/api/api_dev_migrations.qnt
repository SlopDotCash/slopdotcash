// @source scripts/dev-migrations.ts
// @source scripts/dev-backend.ts
// Per-file migration transaction: schema + dev_migrations marker commit together.
// Two versions model startup, a partial rebuild, failure/crash and retry.
module api_dev_migrations {
  var s: {schema: int, marker: int, phase: str, next: int, rows: int,
    draftRows: int, valid: bool, foreignKeys: bool}
  action init = s' = {schema: 0, marker: 0, phase: "idle", next: 0, rows: 1,
    draftRows: 1, valid: true, foreignKeys: true}
  action begin(rebuild: bool): bool = all { s.phase == "idle", s.marker < 2,
    s' = s.with("phase", "writing").with("next", s.marker + 1)
      .with("foreignKeys", not(rebuild)).with("valid", false) }
  action partialRebuild = all { s.phase == "writing", s' = s.with("draftRows", 0) }
  action copyRows = all { s.phase == "writing", s' = s.with("draftRows", s.rows) }
  action checkForeignKeys = all { s.phase == "writing", s.draftRows == s.rows,
    s' = s.with("valid", true) }
  action commit = all { s.phase == "writing", s.valid, s.draftRows == s.rows,
    s' = s.with("schema", s.next).with("marker", s.next).with("phase", "idle")
      .with("foreignKeys", true) }
  action failOrCrash = all { s.phase == "writing", s' = s.with("phase", "idle")
    .with("next", s.marker).with("draftRows", s.rows).with("foreignKeys", true).with("valid", true) }
  action skipApplied = all { s.phase == "idle", s' = s }
  action step = any { begin(false), begin(true), partialRebuild, copyRows,
    checkForeignKeys, commit, failOrCrash, skipApplied, s' = s }
  val invariant = all { s.schema == s.marker, s.rows == 1,
    s.phase == "idle" implies s.foreignKeys,
    s.schema >= 0, s.schema <= 2 }
  run atomicCommitTest = init.then(begin(true)).then(partialRebuild).then(copyRows)
    .then(checkForeignKeys).then(commit).expect(s.schema == 1 and s.marker == 1 and s.foreignKeys)
  run crashRetryTest = init.then(begin(true)).then(partialRebuild).then(failOrCrash)
    .expect(s.schema == 0 and s.marker == 0).then(begin(true)).then(copyRows)
    .then(checkForeignKeys).then(commit).expect(s.schema == 1 and s.marker == 1)
  run markerFailureTest = init.then(begin(false)).then(checkForeignKeys).then(failOrCrash)
    .expect(s.schema == s.marker and s.foreignKeys)
}
