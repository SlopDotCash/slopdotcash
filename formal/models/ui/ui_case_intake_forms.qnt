// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// @source backend/security/handler.ts
// @source migrations/0026_private_security_cases.sql
// @source migrations/0101_durable_security_intake.sql
// @evidence tests/e2e/security-report-links.spec.ts
// Source-only, unexecuted ClaimForm / ImportReports / RecordForm refinement.
// Bound: one mounted, authenticated actor's forms; two projects/advisories;
// three attempts per form; six canonical record payload representatives,
// three record UUID representatives and four claim key generations. These
// independent namespaces abstract globally unique requestKey() outputs.
// Each record representative differs from baseline in exactly one posted field:
// project, advisory, reporter ID, reporter login, or UTC receipt time. Trimming
// and utcInput normalization precede this abstraction; confirmation is true.
// The in-memory key map does not survive unmount, refresh, or actor change.
// Busy guards model ordinary disabled-button submission, not a reentrancy
// guarantee: useAction does not prevent programmatic/reentrant submit calls.
// Parent identity/authorization checks, native validation, current maintainer
// authority, SQL races, linked-submission replay, rendering and transport are
// delegated. Each form's local reducer is independent here; shared claim/record
// storage conflicts are covered separately by api_private_case_creation.
// The ordinary existing-case branch is explicit: claims replay by
// natural case identity; verified records are unique by project + advisory,
// with replay requiring the same reporter, original actor and request key.
// A lost response can leave a committed row. Receiving that row is not evidence
// that changed record facts were saved. Server history never changes on replay.
module ui_case_intake_forms {
  type Claim = { project: int, advisory: int, phase: str, submittedProject: int,
    submittedAdvisory: int, key: int, submittedKey: int, attempts: int,
    rows: Set[int], error: bool, wrongClear: bool }
  type Import = { project: int, pendingProject: int, phase: str, attempts: int,
    outcome: str, outcomeProject: int, lastProject: int, refreshes: int }
  type Payload = { project: int, advisory: int, reporter: int, login: int, received: int }
  type Request = { phase: str, payload: int, key: int, acknowledgedPayload: int, replayed: bool }
  type Row = { advisory: int, key: int, payload: int }
  type Record = { payload: int, phase: str, active: int, keysByPayload: int -> int,
    nextKey: int, requests: int -> Request, rows: Set[Row], error: bool }
  type State = { claim: Claim, imports: Import, record: Record }
  val attempts = Set(1, 2, 3)
  val payloadIds = Set(1, 2, 3, 4, 5, 6)
  val baseline: Payload = { project: 1, advisory: 1, reporter: 1, login: 1, received: 1 }
  val payloads = Map(1 -> baseline, 2 -> baseline.with("project", 2),
    3 -> baseline.with("advisory", 2), 4 -> baseline.with("reporter", 2),
    5 -> baseline.with("login", 2), 6 -> baseline.with("received", 2))
  def advisoryKey(id: int): int = if (id == 0) 0 else {
    val p = payloads.get(id)
    (p.project - 1) * 2 + p.advisory
  }
  val noRequest: Request = { phase: "unused", payload: 0, key: 0,
    acknowledgedPayload: 0, replayed: false }
  var s: State
  val c = s.claim
  val i = s.imports
  val r = s.record
  val visibleImport = if (i.outcomeProject == i.project) i.outcome else "none"
  action init = s' = {
    claim: { project: 1, advisory: 0, phase: "idle", submittedProject: 0,
      submittedAdvisory: 0, key: 1, submittedKey: 0, attempts: 0,
      rows: Set(), error: false, wrongClear: false },
    imports: { project: 1, pendingProject: 0, phase: "idle", attempts: 0,
      outcome: "none", outcomeProject: 0, lastProject: 0, refreshes: 0 },
    record: { payload: 1, phase: "idle", active: 0,
      keysByPayload: payloadIds.mapBy(_ => 0), nextKey: 1,
      requests: attempts.mapBy(_ => noRequest), rows: Set(), error: false }
  }
  action editClaim(project: int, advisory: int): bool = all {
    Set(1, 2).contains(project), Set(0, 1, 2).contains(advisory),
    s' = s.with("claim", c.with("project", project).with("advisory", advisory))
  }
  action submitClaim = all { c.phase == "idle", c.advisory > 0, c.attempts < 3,
    s' = s.with("claim", c.with("phase", "sent").with("submittedProject", c.project)
      .with("submittedAdvisory", c.advisory).with("submittedKey", c.key)
      .with("attempts", c.attempts + 1).with("error", false)) }
  action commitClaim = all { c.phase == "sent",
    s' = s.with("claim", c.with("phase", "committed")
      .with("rows", c.rows.union(Set((c.submittedProject - 1) * 2 + c.submittedAdvisory)))) }
  action finishClaim(success: bool): bool = all {
    Set("sent", "committed").contains(c.phase), not(success) or c.phase == "committed",
    s' = s.with("claim", c.with("phase", "idle").with("error", not(success))
      .with("key", if (success) c.key + 1 else c.key)
      .with("advisory", if (success and c.project == c.submittedProject
        and c.advisory == c.submittedAdvisory) 0 else c.advisory)) }
  action editImport(project: int): bool = all { Set(1, 2).contains(project),
    s' = s.with("imports", i.with("project", project)) }
  action submitImport = all { i.phase == "idle", i.attempts < 3,
    s' = s.with("imports", i.with("phase", "sent").with("pendingProject", i.project)
      .with("outcome", "none").with("outcomeProject", 0).with("attempts", i.attempts + 1)) }
  action finishImport(outcome: str): bool = all { i.phase == "sent",
    Set("empty", "received", "error").contains(outcome),
    s' = s.with("imports", i.with("phase", "idle").with("outcome", outcome)
      .with("outcomeProject", i.pendingProject).with("lastProject", i.pendingProject)
      .with("refreshes", if (outcome == "error") i.refreshes else i.refreshes + 1)) }
  action editRecord(payload: int): bool = all { payloadIds.contains(payload),
    s' = s.with("record", r.with("payload", payload)) }
  action submitRecord(id: int): bool = {
    val previous = r.keysByPayload.get(r.payload)
    val key = if (previous == 0) r.nextKey else previous
    all { attempts.contains(id), r.phase == "idle", r.requests.get(id).phase == "unused",
      previous > 0 or r.nextKey <= 3,
      s' = s.with("record", r.with("phase", "busy").with("active", id).with("error", false)
        .with("nextKey", if (previous == 0) r.nextKey + 1 else r.nextKey)
        .with("keysByPayload", r.keysByPayload.set(r.payload, key))
        .with("requests", r.requests.set(id, noRequest.with("phase", "sent")
          .with("payload", r.payload).with("key", key)))) }
  }
  action commitRecord(id: int): bool = {
    val request = r.requests.get(id)
    val prior = r.rows.filter(row => row.advisory == advisoryKey(request.payload))
    // Actor is constant within this bounded mounted lifetime.
    val reporter = if (request.payload == 0) 0 else payloads.get(request.payload).reporter
    val matching = prior.filter(row => row.key == request.key
      and payloads.get(row.payload).reporter == reporter)
    val accepted = prior.size() == 0 or matching.size() > 0
    val acknowledged = if (prior.size() == 0) request.payload
      else matching.fold(0, (acc, row) => row.payload)
    all { request.phase == "sent",
      s' = s.with("record", r.with("rows", if (prior.size() == 0)
        r.rows.union(Set({ advisory: advisoryKey(request.payload), key: request.key, payload: request.payload })) else r.rows)
        .with("requests", r.requests.set(id, request.with("phase", if (accepted) "accepted" else "conflict")
          .with("acknowledgedPayload", if (accepted) acknowledged else 0)
          .with("replayed", matching.size() > 0)))) }
  }
  action finishRecord(id: int, received: bool): bool = {
    val request = r.requests.get(id)
    all { Set("sent", "accepted", "conflict").contains(request.phase),
      // A network failure may occur before commit or after the row is durable.
      not(received) or request.phase != "sent",
      s' = s.with("record", r.with("phase", "idle")
        .with("error", not(received) or request.phase == "conflict")
        .with("requests", r.requests.set(id, request.with("phase", "done")))) }
  }
  action step = {
    nondet project = Set(1, 2).oneOf()
    nondet advisory = Set(0, 1, 2).oneOf()
    nondet payload = payloadIds.oneOf()
    nondet id = attempts.oneOf()
    nondet success = Set(false, true).oneOf()
    nondet outcome = Set("empty", "received", "error").oneOf()
    any { editClaim(project, advisory), submitClaim, commitClaim, finishClaim(success),
      editImport(project), submitImport, finishImport(outcome), editRecord(payload),
      submitRecord(id), commitRecord(id), finishRecord(id, success), s' = s }
  }
  val invariant = all {
    c.key >= 1, c.key <= 4, not(c.wrongClear),
    i.outcome != "none" implies i.outcomeProject == i.lastProject,
    r.nextKey >= 1, r.nextKey <= 4,
    attempts.forall(a => attempts.forall(b => {
      val first = r.requests.get(a)
      val second = r.requests.get(b)
      first.key > 0 and first.key == second.key implies first.payload == second.payload
    })),
    attempts.forall(id => {
      val request = r.requests.get(id)
      request.acknowledgedPayload > 0 implies request.acknowledgedPayload == request.payload
    }),
    r.rows.forall(a => r.rows.forall(b => a.advisory == b.advisory implies a == b))
  }
  run emptyClaimCannotSubmitTest = init.expect(c.advisory == 0).then(submitClaim).fail()
  run unchangedClaimClearsDraftTest = init.then(editClaim(1, 1)).then(submitClaim).then(commitClaim)
    .then(finishClaim(true)).expect(c.advisory == 0 and c.key == 2 and c.rows == Set(1))
  run editedClaimAdvisorySurvivesSuccessTest = init.then(editClaim(1, 1)).then(submitClaim)
    .then(editClaim(1, 2)).then(commitClaim).then(finishClaim(true)).expect(c.advisory == 2 and c.rows == Set(1))
  run editedClaimProjectSurvivesSuccessTest = init.then(editClaim(1, 1)).then(submitClaim)
    .then(editClaim(2, 1)).then(commitClaim).then(finishClaim(true)).expect(c.project == 2 and c.advisory == 1)
  run claimReturnToSameDraftClearsTest = init.then(editClaim(1, 1)).then(submitClaim)
    .then(editClaim(2, 2)).then(editClaim(1, 1)).then(commitClaim).then(finishClaim(true)).expect(c.advisory == 0)
  run failedClaimKeepsDraftAndKeyTest = init.then(editClaim(1, 1)).then(submitClaim)
    .then(finishClaim(false)).expect(c.advisory == 1 and c.key == 1 and c.error)
  run uncertainClaimRetryUsesNaturalCaseTest = init.then(editClaim(1, 1)).then(submitClaim).then(commitClaim)
    .then(finishClaim(false)).then(submitClaim).then(commitClaim).then(finishClaim(true))
    .expect(c.rows.size() == 1 and c.key == 2)
  run changedClaimCanUseSameKeyTest = init.then(editClaim(1, 1)).then(submitClaim).then(commitClaim)
    .then(finishClaim(false)).then(editClaim(1, 2)).then(submitClaim).then(commitClaim).then(finishClaim(true))
    .expect(c.rows == Set(1, 2) and c.submittedKey == 1)
  run duplicateClaimClickBlockedTest = init.then(editClaim(1, 1)).then(submitClaim).then(submitClaim).fail()
  run importSuccessVisibleForOwnProjectTest = init.then(submitImport).then(finishImport("received"))
    .expect(visibleImport == "received" and i.refreshes == 1)
  run importSuccessHiddenAfterProjectSwitchTest = init.then(submitImport).then(editImport(2))
    .then(finishImport("received")).expect(visibleImport == "none" and i.refreshes == 1)
  run returnToImportedProjectShowsResultTest = init.then(submitImport).then(editImport(2))
    .then(finishImport("received")).then(editImport(1)).expect(visibleImport == "received")
  run importFailureHiddenAfterProjectSwitchTest = init.then(submitImport).then(editImport(2))
    .then(finishImport("error")).expect(visibleImport == "none" and i.refreshes == 0)
  run returnToFailedImportShowsErrorTest = init.then(submitImport).then(editImport(2))
    .then(finishImport("error")).then(editImport(1)).expect(visibleImport == "error")
  run importRetryClearsPreviousFeedbackTest = init.then(submitImport).then(finishImport("error"))
    .then(submitImport).expect(visibleImport == "none" and i.phase == "sent")
  run emptyImportStillRefreshesListTest = init.then(submitImport).then(finishImport("empty"))
    .expect(visibleImport == "empty" and i.refreshes == 1)
  run duplicateImportClickBlockedTest = init.then(submitImport).then(submitImport).fail()
  run uncertainRecordRetryUsesSameKeyTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(submitRecord(2)).then(commitRecord(2)).then(finishRecord(2, true))
    .expect(r.requests.get(2).replayed and r.rows.size() == 1 and not(r.error))
  run changedReceiptRefusesFalseAcknowledgementTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(6)).then(submitRecord(2)).then(commitRecord(2))
    .then(finishRecord(2, true)).expect(r.error and r.rows == Set({ advisory: 1, key: 1, payload: 1 }))
  run changedLoginRefusesFalseAcknowledgementTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(5)).then(submitRecord(2)).then(commitRecord(2))
    .expect(r.requests.get(2).phase == "conflict" and invariant)
  run changedProjectCreatesSeparateRecordTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(2)).then(submitRecord(2)).then(commitRecord(2))
    .expect(r.rows.size() == 2 and r.requests.get(2).key == 2 and invariant)
  run changedAdvisoryCreatesSeparateRecordTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(3)).then(submitRecord(2)).then(commitRecord(2))
    .expect(r.rows.size() == 2 and invariant)
  run changedReporterCannotDuplicateVerifiedAdvisoryTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(4)).then(submitRecord(2)).then(commitRecord(2))
    .expect(r.rows.size() == 1 and r.requests.get(2).phase == "conflict" and invariant)
  run returningToOriginalRecordReusesItsKeyTest = init.then(submitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(6)).then(submitRecord(2)).then(commitRecord(2))
    .then(finishRecord(2, true)).then(editRecord(1)).then(submitRecord(3)).then(commitRecord(3))
    .expect(r.requests.get(3).key == 1 and r.requests.get(3).replayed and invariant)
  run editingBusyRecordDoesNotChangeCapturedFactsTest = init.then(submitRecord(1)).then(editRecord(6))
    .then(commitRecord(1)).expect(r.requests.get(1).acknowledgedPayload == 1 and r.payload == 6)
  run duplicateRecordClickBlockedTest = init.then(submitRecord(1)).then(submitRecord(2)).fail()

  // Excluded historical controls demonstrate the three concrete pre-fix bugs.
  action oldFinishClaim = all { c.phase == "committed",
    s' = s.with("claim", c.with("phase", "idle").with("key", c.key + 1).with("advisory", 0)
      .with("wrongClear", c.project != c.submittedProject or c.advisory != c.submittedAdvisory)) }
  action oldFinishImport = all { i.phase == "sent",
    s' = s.with("imports", i.with("phase", "idle").with("outcome", "received")
      .with("outcomeProject", i.project).with("lastProject", i.pendingProject)) }
  action oldSubmitRecord(id: int): bool = all { r.phase == "idle", r.requests.get(id).phase == "unused",
    s' = s.with("record", r.with("phase", "busy").with("active", id)
      .with("requests", r.requests.set(id, noRequest.with("phase", "sent").with("payload", r.payload).with("key", 1)))) }
  run oldClaimSuccessErasedEditedDraftTest = init.then(editClaim(1, 1)).then(submitClaim).then(editClaim(1, 2))
    .then(commitClaim).then(oldFinishClaim).expect(c.advisory == 0 and not(invariant))
  run oldImportSuccessMislabelsCurrentProjectTest = init.then(submitImport).then(editImport(2))
    .then(oldFinishImport).expect(visibleImport == "received" and not(invariant))
  run oldRecordKeyAcknowledgedDifferentReceiptTest = init.then(oldSubmitRecord(1)).then(commitRecord(1))
    .then(finishRecord(1, false)).then(editRecord(6)).then(oldSubmitRecord(2)).then(commitRecord(2))
    .expect(r.requests.get(2).replayed and r.requests.get(2).acknowledgedPayload == 1 and not(invariant))
}
