// @source scripts/record/build-record.mjs
// @source scripts/record/agg.mjs
// @source scripts/record/receipts.mjs
// @source scripts/prepare-publication.mjs
// @evidence scripts/record/build-record.test.mjs
// @evidence scripts/record/receipts.test.mjs
// PRD section 7, "Public record pages": every release build rebuilds
// /data/record.json and never fails because of it. `prev` is whether a previous
// record could be read (this site, then the retired site). The build is
// skipped without the switch, writes a new record on success, writes the
// previous record unchanged on any failure or once its deadline passes, and
// writes nothing when it has no previous record. Receipts are counted, not
// modelled one by one: a receipts read that fails keeps the previous receipts,
// and a successful read can only add to them, because a published receipt is
// carried forward even when its payments are no longer in the public record.
// Bounds: one run, at most three published receipts before it and two new
// ones in it. Network order, JSON shape and disk atomicity are outside this
// model; the stage's own exit is always success, so the release continues.
module record_publication {
  type S = { phase: str, switched: bool, prev: bool, prevReceipts: int,
    file: str, fileReceipts: int, releaseFailed: bool }
  var s: S
  action start(switched: bool, prev: bool, prevReceipts: int): bool =
    s' = { phase: "start", switched: switched, prev: prev,
      prevReceipts: if (prev) prevReceipts else 0, file: "absent",
      fileReceipts: 0, releaseFailed: false }
  action init = {
    nondet switched = Set(false, true).oneOf()
    nondet prev = Set(false, true).oneOf()
    nondet prevReceipts = 0.to(3).oneOf()
    start(switched, prev, prevReceipts)
  }
  action skip = all { s.phase == "start", not(s.switched),
    s' = s.with("phase", "skipped") }
  // The main part built; the receipts read either answered (adding up to two
  // new receipts to the carried ones) or failed (the previous ones are kept).
  action built(receiptsRead: bool, added: int): bool = all {
    s.phase == "start", s.switched, 0 <= added, added <= 2,
    s' = s.with("phase", "built").with("file", "new")
      .with("fileReceipts", s.prevReceipts + (if (receiptsRead) added else 0)) }
  // Any error or the deadline: the previous record unchanged, or nothing.
  action failed = all { s.phase == "start", s.switched,
    s' = if (s.prev)
        s.with("phase", "previous").with("file", "previous")
          .with("fileReceipts", s.prevReceipts)
      else s.with("phase", "none") }
  action step = any {
    skip,
    { nondet receiptsRead = Set(false, true).oneOf()
      nondet added = 0.to(2).oneOf()
      built(receiptsRead, added) },
    failed,
    // A finished run stays as it is.
    all { s.phase != "start", s' = s } }
  val invariant = and {
    // The record stage never fails a release.
    not(s.releaseFailed),
    // Nothing is written without the switch, or without any record to write.
    s.phase == "skipped" implies s.file == "absent",
    s.phase == "none" implies (s.file == "absent" and not(s.prev)),
    // A failure writes the previous record, never a partial one.
    s.phase == "previous" implies (s.file == "previous" and s.prev),
    // A published receipt never disappears from a written record.
    s.file != "absent" implies s.fileReceipts >= s.prevReceipts }
  run builtKeepsEveryPublishedReceiptTest = start(true, true, 2)
    .then(built(true, 1))
    .expect(s.file == "new" and s.fileReceipts == 3)
  run failedReceiptsReadKeepsThePreviousReceiptsTest = start(true, true, 2)
    .then(built(false, 2))
    .expect(s.fileReceipts == 2)
  run failureWritesThePreviousRecordTest = start(true, true, 1)
    .then(failed)
    .expect(s.file == "previous" and not(s.releaseFailed))
  run failureWithoutPreviousWritesNothingTest = start(true, false, 0)
    .then(failed)
    .expect(s.file == "absent" and s.phase == "none")
  run withoutSwitchNothingRunsTest = start(false, true, 1)
    .then(skip)
    .expect(s.file == "absent")
  run skippedBuildCannotWriteTest = start(false, true, 1)
    .then(built(true, 1).fail())
}
