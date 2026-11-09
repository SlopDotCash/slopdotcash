// @source scripts/prepare-source-correction.ts
// @source scripts/source-correction.ts
// @evidence scripts/quality-payment-ledger.test.ts
// Caller composition: validated preparation, published-cycle access, parallel
// input reads, pure preview, then writeFile(..., {flag:"wx"}). Two invocations,
// one output and one publication observation. Publication after access is not
// locked out. A failed write may leave a partial file; no cleanup or overwrite
// is promised. Lost logging can leave a complete preview. No active preparation,
// history, approval or payment is changed. The helper's validation is refined
// separately in source_correction_preview. Source-only and unexecuted.
module source_correction_cli {
  type State = { phase: str, invocation: int, published: bool, observedAbsent: bool,
    preparationValid: bool, readSucceeded: bool, previewValid: bool, output: str,
    previewProduced: bool, writeStarted: bool, wroteComplete: bool, reply: str,
    activeChanged: bool, historyChanged: bool, paid: bool }
  var s: State
  action init = s' = { phase: "input", invocation: 1, published: false, observedAbsent: false,
    preparationValid: true, readSucceeded: true, previewValid: true, output: "absent",
    previewProduced: false, writeStarted: false, wroteComplete: false, reply: "none",
    activeChanged: false, historyChanged: false, paid: false }
  action input(valid: bool, reads: bool, preview: bool, published: bool, output: str): bool = all {
    s.phase == "input", Set("absent", "complete", "partial").contains(output),
    s.invocation == 1 or output == s.output,
    not(s.published) or published,
    s' = s.with("preparationValid", valid).with("readSucceeded", reads).with("previewValid", preview)
      .with("published", published).with("output", output) }
  action begin = all { s.phase == "input", s' = s.with("phase", "preparation") }
  action readPreparation = all { s.phase == "preparation", s' =
    if (s.preparationValid) s.with("phase", "publication") else s.with("phase", "done").with("reply", "preparation-error") }
  action publication = all { s.phase == "publication", s' =
    if (s.published) s.with("phase", "done").with("reply", "published-cycle")
    else s.with("phase", "reads").with("observedAbsent", true) }
  action accessError = all { s.phase == "publication", s' = s.with("phase", "done").with("reply", "access-error") }
  action publishIndependently = all { not(s.published), s' = s.with("published", true) }
  action readInputs = all { s.phase == "reads", s' =
    if (s.readSucceeded) s.with("phase", "preview") else s.with("phase", "done").with("reply", "read-error") }
  action preview = all { s.phase == "preview", s' =
    if (s.previewValid) s.with("phase", "write").with("previewProduced", true)
    else s.with("phase", "done").with("reply", "preview-error") }
  action competingOutput = all { s.phase == "write", s.output == "absent", s' = s.with("output", "complete") }
  action openOutput = all { s.phase == "write", s' =
    if (s.output != "absent") s.with("phase", "done").with("reply", "exists")
    else s.with("phase", "write-pending").with("writeStarted", true) }
  action writeFailure(partial: bool): bool = all { s.phase == "write-pending",
    s' = s.with("phase", "done").with("reply", "write-error").with("output", if (partial) "partial" else "absent") }
  action finishWrite = all { s.phase == "write-pending", s' = s.with("phase", "log")
    .with("output", "complete").with("wroteComplete", true) }
  action logReply(delivered: bool): bool = all { s.phase == "log", s' = s.with("phase", "done")
    .with("reply", if (delivered) "success" else "lost") }
  action retry = all { s.phase == "done", s.invocation == 1, s' = s.with("phase", "input").with("invocation", 2)
    .with("observedAbsent", false).with("previewProduced", false).with("writeStarted", false)
    .with("wroteComplete", false).with("reply", "none") }
  action step = {
    nondet valid = Set(false, true).oneOf() nondet reads = Set(false, true).oneOf()
    nondet previewValid = Set(false, true).oneOf() nondet present = Set(false, true).oneOf()
    nondet output = Set("absent", "complete", "partial").oneOf() nondet yes = Set(false, true).oneOf()
    any { input(valid, reads, previewValid, present, output), begin, readPreparation, publication, accessError,
      publishIndependently, readInputs, preview, competingOutput, openOutput, writeFailure(yes),
      finishWrite, logReply(yes), retry, s' = s }
  }
  val invariant = all { s.invocation <= 2, not(s.activeChanged), not(s.historyChanged), not(s.paid),
    s.writeStarted implies s.observedAbsent and s.previewProduced,
    s.wroteComplete implies s.previewProduced and s.output == "complete",
    s.reply == "success" implies s.wroteComplete,
    s.reply == "published-cycle" implies not(s.writeStarted) }
  action toWrite = begin.then(readPreparation).then(publication).then(readInputs).then(preview)
  run publishedCycleRefusedTest = init.then(input(true, true, true, true, "absent"))
    .then(begin).then(readPreparation).then(publication).expect(s.reply == "published-cycle" and invariant)
  run invalidPreparationRefusedBeforePublicationReadTest = init.then(input(false, true, true, false, "absent"))
    .then(begin).then(readPreparation).expect(s.reply == "preparation-error" and not(s.observedAbsent) and invariant)
  run accessFailureIsNotAbsenceTest = init.then(begin).then(readPreparation).then(accessError)
    .expect(s.reply == "access-error" and not(s.observedAbsent) and invariant)
  run inputReadFailureDoesNotCreateOutputTest = init.then(input(true, false, true, false, "absent"))
    .then(begin).then(readPreparation).then(publication).then(readInputs)
    .expect(s.reply == "read-error" and s.output == "absent" and invariant)
  run helperRefusalDoesNotCreateOutputTest = init.then(input(true, true, false, false, "absent"))
    .then(toWrite).expect(s.reply == "preview-error" and s.output == "absent" and invariant)
  run existingOutputNotOverwrittenTest = init.then(input(true, true, true, false, "complete"))
    .then(toWrite).then(openOutput).expect(s.reply == "exists" and not(s.writeStarted) and invariant)
  run concurrentOutputCreationWinsWithoutOverwriteTest = init.then(toWrite).then(competingOutput).then(openOutput)
    .expect(s.reply == "exists" and not(s.wroteComplete) and invariant)
  run publicationAfterPrecheckDoesNotAuthorizeAnythingTest = init.then(toWrite).then(publishIndependently)
    .then(openOutput).then(finishWrite).then(logReply(true)).expect(s.published and s.reply == "success" and invariant)
  run successfulWriteReportsPreviewOnlyTest = init.then(toWrite).then(openOutput).then(finishWrite).then(logReply(true))
    .expect(s.output == "complete" and s.reply == "success" and invariant)
  run lostSuccessReplyPreservesCreateOnlyFileTest = init.then(toWrite).then(openOutput).then(finishWrite).then(logReply(false))
    .then(retry).then(toWrite).then(openOutput).expect(s.reply == "exists" and s.output == "complete" and invariant)
  run partialWriteBlocksAutomaticOverwriteTest = init.then(toWrite).then(openOutput).then(writeFailure(true))
    .then(retry).then(toWrite).then(openOutput).expect(s.reply == "exists" and s.output == "partial" and invariant)
  run failureWithoutCreatedFileMayRetryTest = init.then(toWrite).then(openOutput).then(writeFailure(false))
    .then(retry).then(toWrite).then(openOutput).then(finishWrite).then(logReply(true))
    .expect(s.reply == "success" and invariant)
}
