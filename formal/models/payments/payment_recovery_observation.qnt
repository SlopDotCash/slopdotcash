// @source workers/payments/index.ts
// @evidence workers/payments/attempt-observation.test.ts
// recoverUncertainAttempts composition, two rows and one captured list. SQL
// selection has no ORDER BY: both representative orders are allowed. At most
// one concurrent row change is modeled. Network 1
// is served; hash identities 1/2 represent nonempty strings, 0 is null. Response
// profiles represent JSON/type/HTTP outcomes without proving provider truth.
// Cancellation's journal serialization and signed-byte retention are separate
// contracts (payment_unsigned_retirement and executor models). This model
// applies the actual write guards, including late status after selection.
// One batch is atomic; its reply can fail after commit. Per-row failures do not
// stop later captured rows. No response proves finalized payment. Unexecuted.
module payment_recovery_observation {
  type Row = { network: int, solana: bool, obligation: str, attempt: str, tx: int,
    outbox: str, liveLease: bool, successor: bool }
  type State = { phase: str, rows: int -> Row, profiles: int -> str,
    selected: List[int], offset: int, current: int, answerTx: int,
    answerSubmitted: bool, writeKind: str, errors: List[int], visited: List[int],
    failureEvidence: Set[int], changedAfterRead: bool, response: str, paidByRecovery: bool }
  var s: State
  val rowIds = Set(1, 2)
  val profiles = Set("submitted", "unsubmitted", "unsigned", "cancel-retired",
    "cancel-signed", "cancel-unsubmitted", "service-missing", "status-http",
    "status-json", "transaction-invalid", "submitted-missing", "cancel-http",
    "cancel-json", "retired-invalid", "cancel-null")
  val initialRow: Row = { network: 1, solana: false, obligation: "reserved",
    attempt: "unknown", tx: 0, outbox: "ready", liveLease: false, successor: false }
  action init = s' = { phase: "input", rows: Map(1 -> initialRow, 2 -> initialRow),
    profiles: Map(1 -> "submitted", 2 -> "submitted"), selected: List(), offset: 0,
    current: 0, answerTx: 0, answerSubmitted: false, writeKind: "none",
    errors: List(), visited: List(), failureEvidence: Set(), changedAfterRead: false,
    response: "none", paidByRecovery: false }
  pure def eligible(row: Row): bool = row.network == 1 and row.obligation == "reserved"
    and ((Set("unknown", "prepared").contains(row.attempt) and row.tx == 0)
      or (row.solana and row.attempt == "submitted"))
  def currentRow: Row = s.rows.get(if (rowIds.contains(s.current)) s.current else 1)
  def profile: str = s.profiles.get(if (rowIds.contains(s.current)) s.current else 1)
  def refused: State = s.with("phase", "advance").with("errors", s.errors.append(s.current))
  action configure(id: int, row: Row, outcome: str): bool = all {
    s.phase == "input", rowIds.contains(id), profiles.contains(outcome),
    Set(1, 2).contains(row.network), Set("reserved", "paid").contains(row.obligation),
    Set("prepared", "unknown", "submitted", "failed").contains(row.attempt), 0.to(2).contains(row.tx),
    Set("ready", "processing", "held", "submitted", "paid").contains(row.outbox),
    s' = s.with("rows", s.rows.set(id, row)).with("profiles", s.profiles.set(id, outcome)) }
  action selectRows(reverse: bool): bool = {
    val order = if (reverse) List(2, 1) else List(1, 2)
    all { s.phase == "input", s' = s.with("phase", "loop")
      .with("selected", order.select(id => eligible(s.rows.get(id)))) }
  }
  action selectionFailure = all { s.phase == "input", s' = s.with("phase", "done").with("response", "selection-error") }
  action visit = all { s.phase == "loop", s' =
    if (s.offset == s.selected.length()) s.with("phase", "done").with("response", if (s.errors.length() == 0) "returned" else "aggregate-error")
    else s.with("phase", "status").with("current", s.selected.nth(s.offset))
      .with("visited", s.visited.append(s.selected.nth(s.offset))) }
  action status = all { s.phase == "status", s' =
    if (Set("service-missing", "status-http", "status-json", "transaction-invalid", "submitted-missing").contains(profile)) refused
    else if (Set("unsigned", "cancel-retired", "cancel-signed", "cancel-unsubmitted", "cancel-http", "cancel-json", "retired-invalid", "cancel-null").contains(profile))
      s.with("phase", "successor")
    else s.with("answerTx", 1).with("answerSubmitted", profile == "submitted")
      .with("writeKind", if (profile == "submitted") "record" else "reopen").with("phase", "write") }
  action successor = all { s.phase == "successor", s' =
    if (currentRow.successor) s.with("phase", "cancel") else s.with("phase", "advance") }
  action cancel = all { s.phase == "cancel", s' =
    if (Set("cancel-http", "cancel-json", "retired-invalid", "cancel-null").contains(profile)) refused
    else if (profile == "cancel-retired") s.with("writeKind", "retire").with("phase", "write")
    else s.with("answerTx", 2).with("answerSubmitted", profile == "cancel-signed")
      .with("writeKind", if (profile == "cancel-signed") "record" else "reopen").with("phase", "write") }
  // A selected row may be settled, failed or submitted while the service call
  // is pending. The captured list is unchanged; SQL re-reads current state.
  action concurrent(kind: str): bool = {
    val row = currentRow
    val changed = if (kind == "paid") row.with("obligation", "paid").with("outbox", "paid")
      else if (kind == "failed") row.with("attempt", "failed").with("tx", 0).with("outbox", "held")
      else if (kind == "signed") row.with("attempt", "submitted").with("tx", 2).with("outbox", "submitted")
      else row.with("outbox", "processing").with("liveLease", true)
    all { Set("status", "successor", "cancel", "write").contains(s.phase), not(s.changedAfterRead),
      Set("paid", "failed", "signed", "lease").contains(kind),
      s' = s.with("rows", s.rows.set(s.current, changed)).with("changedAfterRead", true) }
  }
  action write = {
    val row = currentRow
    val retireChanged = (row.tx == 0 and Set("prepared", "unknown").contains(row.attempt)) or row.attempt == "submitted"
    val retired = if (retireChanged) row.with("attempt", "failed").with("tx", 0) else row
    val retiredBox = if (retireChanged and row.outbox != "paid" and not(row.outbox == "processing" and row.liveLease)) retired.with("outbox", "ready") else retired
    val reopened = if (row.attempt == "submitted" and row.tx == s.answerTx and row.obligation == "reserved") row.with("attempt", "unknown").with("tx", 0) else row
    val reopenedBox = if (row.outbox == "submitted" and reopened.attempt == "unknown" and reopened.tx == 0 and row.obligation == "reserved") reopened.with("outbox", "ready") else reopened
    val recorded = if (row.tx == 0 and Set("prepared", "unknown").contains(row.attempt)) row.with("attempt", "submitted").with("tx", s.answerTx) else row
    val recordedBox = if (row.outbox != "paid" and recorded.attempt == "submitted" and recorded.tx == s.answerTx) recorded.with("outbox", "submitted").with("liveLease", false) else recorded
    all { s.phase == "write", s' = s.with("phase", "ack")
      .with("rows", s.rows.set(s.current, if (s.writeKind == "retire") retiredBox else if (s.writeKind == "reopen") reopenedBox else recordedBox))
      .with("failureEvidence", if (s.writeKind == "retire") s.failureEvidence.union(Set(s.current)) else s.failureEvidence) }
  }
  action writeFailure = all { s.phase == "write", s' = refused }
  action acknowledge(success: bool): bool = all { s.phase == "ack", s' = if (success) s.with("phase", "advance") else refused }
  action advance = all { s.phase == "advance", s' = s.with("phase", "loop").with("offset", s.offset + 1).with("writeKind", "none") }
  action step = {
    nondet id = rowIds.oneOf() nondet outcome = profiles.oneOf() nondet yes = Set(false, true).oneOf()
    nondet kind = Set("paid", "failed", "signed", "lease").oneOf()
    any { configure(id, initialRow, outcome), selectRows(yes), selectionFailure, visit, status, successor,
      cancel, concurrent(kind), write, writeFailure, acknowledge(yes), advance, s' = s }
  }
  val invariant = all { not(s.paidByRecovery), s.offset <= s.selected.length(), s.errors.length() <= 2,
    s.visited.length() <= 2, s.failureEvidence.subseteq(rowIds),
    s.response == "returned" implies s.errors.length() == 0,
    s.response == "aggregate-error" implies s.errors.length() > 0,
    s.rows.get(1).obligation == "paid" implies s.rows.get(1).outbox == "paid",
    s.rows.get(2).obligation == "paid" implies s.rows.get(2).outbox == "paid" }
  action first = selectRows(false).then(visit).then(status)
  action accepted = write.then(acknowledge(true)).then(advance).then(visit)
  run bothRowsContinueAfterFirstFailureTest = init.then(configure(1, initialRow, "status-http")).then(first)
    .then(advance).then(visit).then(status).then(accepted)
    .expect(s.response == "aggregate-error" and s.errors == List(1) and s.rows.get(2).attempt == "submitted" and invariant)
  run serviceMissingIsPerRowFailureTest = init.then(configure(1, initialRow, "service-missing")).then(first).expect(s.errors == List(1) and s.phase == "advance" and invariant)
  run unservedNetworkNotSelectedTest = init.then(configure(2, initialRow.with("network", 2), "submitted")).then(first).then(accepted)
    .expect(s.response == "returned" and s.visited == List(1) and s.rows.get(2).attempt == "unknown" and invariant)
  run paidRowNotSelectedTest = init.then(configure(1, initialRow.with("obligation", "paid").with("outbox", "paid"), "submitted")).then(selectRows(false))
    .expect(s.selected == List(2) and invariant)
  run signedEvmRowNotSelectedTest = init.then(configure(1, initialRow.with("attempt", "submitted").with("tx", 1), "submitted")).then(selectRows(false))
    .expect(s.selected == List(2) and invariant)
  run signedSolanaRowSelectedTest = init.then(configure(1, initialRow.with("solana", true).with("attempt", "submitted").with("tx", 1).with("outbox", "submitted"), "unsubmitted")).then(first).then(accepted)
    .expect(s.rows.get(1).attempt == "unknown" and s.rows.get(1).outbox == "ready" and invariant)
  run nullWithoutSuccessorSkipsCancellationTest = init.then(configure(1, initialRow, "unsigned")).then(first).then(successor)
    .expect(s.phase == "advance" and s.failureEvidence == Set() and s.rows.get(1).attempt == "unknown" and invariant)
  run successorCancellationCanReturnSignedAttemptTest = init.then(configure(1, initialRow.with("successor", true), "cancel-signed")).then(first).then(successor).then(cancel).then(accepted)
    .expect(s.rows.get(1).attempt == "submitted" and s.rows.get(1).tx == 2 and invariant)
  run successorCancellationCanReturnUnsubmittedBytesTest = init.then(configure(1, initialRow.with("successor", true), "cancel-unsubmitted")).then(first).then(successor).then(cancel).then(accepted)
    .expect(s.rows.get(1).attempt == "unknown" and s.rows.get(1).tx == 0 and invariant)
  run invalidCancellationDoesNotRetireTest = init.then(configure(1, initialRow.with("successor", true), "retired-invalid")).then(first).then(successor).then(cancel)
    .expect(s.errors == List(1) and s.failureEvidence == Set() and invariant)
  run retirementPreservesLiveLeaseTest = init.then(configure(1, initialRow.with("successor", true), "cancel-retired")).then(first).then(successor).then(cancel).then(concurrent("lease")).then(accepted)
    .expect(s.rows.get(1).attempt == "failed" and s.rows.get(1).outbox == "processing" and invariant)
  run lateFailureDoesNotResubmitAttemptTest = init.then(first).then(concurrent("failed")).then(accepted)
    .expect(s.rows.get(1).attempt == "failed" and s.rows.get(1).outbox == "held" and invariant)
  run conflictingTransactionDoesNotReplaceReceiptTest = init.then(first).then(concurrent("signed")).then(accepted)
    .expect(s.rows.get(1).tx == 2 and invariant)
  run latePaidStillRetainsStatusButNeverUnpaysTest = init.then(first).then(concurrent("paid")).then(accepted)
    .expect(s.rows.get(1).attempt == "submitted" and s.rows.get(1).outbox == "paid" and invariant)
  run lostWriteReplyRetainsCommittedStatusTest = init.then(first).then(write).then(acknowledge(false)).then(advance).then(visit)
    .expect(s.rows.get(1).attempt == "submitted" and s.errors == List(1) and s.current == 2 and invariant)
  run writeFailureDoesNotPreventNextRowTest = init.then(first).then(writeFailure).then(advance).then(visit)
    .expect(s.rows.get(1).attempt == "unknown" and s.current == 2 and invariant)
  run malformedStatusIsNotSubmissionTest = init.then(configure(1, initialRow, "submitted-missing")).then(first)
    .expect(s.errors == List(1) and s.rows.get(1).attempt == "unknown" and invariant)
  run sourceOrderNotPromisedTest = init.then(selectRows(true)).then(visit).expect(s.current == 2 and invariant)
  run selectionErrorPreventsServiceCallsTest = init.then(selectionFailure).expect(s.response == "selection-error" and s.visited == List() and invariant)
}
