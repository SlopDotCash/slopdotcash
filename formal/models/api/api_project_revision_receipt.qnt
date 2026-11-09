// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/edge-cache.ts
// @source migrations/0019_project_registry.sql
// @source migrations/0039_project_update_applications.sql
// @evidence scripts/project-self-service.test.ts
// @evidence backend/projects/cloudflare-persistence.test.ts
// One project, one competing writer, revisions 1..3 and two calls. Outer
// authentication/manifest/field-policy checks are supplied predicates. This
// refines appendProjectRevision and appendRevision's completion boundary:
// generation capture precedes awaited checks; revision/pointer/application,
// aliases and notification statements share an atomic D1 batch. Alias or
// constraint refusal rolls it back. A lost batch reply or postcommit failure
// does not undo it. Cache delete rejection is swallowed; the generation read
// and later setup work can still fail. Returned revision is the caller's
// committed one, never a later mutable head. Draft fields merely label two
// subsequent requests; detailed UI/storage lifetime remains in UI models.
// NoticeKeys means committed notification statements, not recipient count.
// Hashing, identity proofs, SQL/transaction semantics and policy internals are
// delegated contracts. New scenarios and regression cases are unexecuted.
module api_project_revision_receipt {
  val faults = Set("none", "restriction", "policy", "registry", "content", "root-publication",
    "clearance", "hash", "constraint", "cache-generation", "followup")
  type State = { head: int, history: List[int], phase: str, attempts: int,
    base: int, expected: int, committed: int, response: int, draft: int, submitted: int,
    enforcement: int, readEnforcement: int, clearance: int, readClearance: int,
    needsClearance: bool, fromApplication: bool, application: str, aliasOwner: int,
    fault: str, noticeKeys: Set[int], conflict: bool, otherWritten: bool, result: str }
  var s: State
  action init = s' = { head: 1, history: List(1), phase: "idle", attempts: 0,
    base: 1, expected: 0, committed: 0, response: 0, draft: 1, submitted: 0,
    enforcement: 0, readEnforcement: -1, clearance: 0, readClearance: -1,
    needsClearance: true, fromApplication: false, application: "pending", aliasOwner: 0,
    fault: "none", noticeKeys: Set(), conflict: false, otherWritten: false, result: "none" }
  action configure(fault: str, needsClearance: bool, fromApplication: bool): bool = all {
    Set("idle", "done").contains(s.phase), faults.contains(fault),
    s' = s.with("fault", fault).with("needsClearance", needsClearance).with("fromApplication", fromApplication) }
  def refuse(reason: str): State = s.with("phase", "done").with("result", reason)
  action submit = all { Set("idle", "done").contains(s.phase), s.attempts < 2,
    s' = s.with("phase", "current").with("attempts", s.attempts + 1)
      .with("expected", s.base).with("submitted", s.draft).with("committed", 0)
      .with("response", 0).with("conflict", false).with("result", "none") }
  action loadCurrent = all { s.phase == "current", s' =
    if (s.expected != s.head) refuse("conflict").with("conflict", true)
    else s.with("phase", "enforcement") }
  action captureEnforcement = all { s.phase == "enforcement",
    s' = s.with("readEnforcement", s.enforcement).with("phase", "checks") }
  action checks = all { s.phase == "checks", s' =
    if (Set("restriction", "policy", "registry", "content", "root-publication").contains(s.fault)) refuse(s.fault)
    else s.with("phase", if (s.needsClearance) "clearance-read" else "hash") }
  action captureClearance = all { s.phase == "clearance-read",
    s' = s.with("readClearance", s.clearance).with("phase", "clearance-check") }
  action checkClearance = all { s.phase == "clearance-check", s' =
    if (s.fault == "clearance") refuse("clearance") else s.with("phase", "hash") }
  action hashManifest = all { s.phase == "hash", s' =
    if (s.fault == "hash") refuse("hash") else s.with("phase", "write") }
  action commit = all { s.phase == "write", s.head < 3, s' =
    if (s.head != s.expected or s.enforcement != s.readEnforcement
      or (s.needsClearance and s.clearance != s.readClearance)
      or (s.fromApplication and s.application != "pending")
      or s.aliasOwner == 2 or s.fault == "constraint") refuse("conflict").with("conflict", true)
    else s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
      .with("committed", s.head + 1).with("phase", "ack").with("aliasOwner", 1)
      .with("noticeKeys", s.noticeKeys.union(Set(s.head + 1)))
      .with("application", if (s.fromApplication) "approved" else s.application) }
  action failedBatch = all { s.phase == "write", s' = refuse("batch-error") }
  action acknowledge(delivered: bool): bool = all { s.phase == "ack", s' =
    if (delivered) s.with("phase", "cache-generation") else refuse("batch-reply-lost") }
  action cacheGeneration = all { s.phase == "cache-generation", s' =
    if (s.fault == "cache-generation") refuse("cache-generation") else s.with("phase", "purge") }
  // Rejected Cache.delete promises are caught by purgeProjectCache.
  action purge(_succeeds: bool): bool = all { s.phase == "purge", s' = s.with("phase", "followup") }
  action followup = all { s.phase == "followup", s' =
    if (s.fault == "followup") refuse("followup") else s.with("phase", "reply") }
  action reply = all { s.phase == "reply", s' = s.with("response", s.committed)
    .with("base", s.committed).with("phase", "done").with("result", "returned") }
  action typeDuringSave = all { not(Set("idle", "done").contains(s.phase)), s' = s.with("draft", 2) }
  action anotherWriter = all { s.head < 3, not(s.otherWritten),
    s' = s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
      .with("noticeKeys", s.noticeKeys.union(Set(s.head + 1))).with("otherWritten", true) }
  action enforcementArrives = all { s.enforcement < 2, s' = s.with("enforcement", s.enforcement + 1) }
  action clearanceChanges = all { s.clearance < 2, s' = s.with("clearance", s.clearance + 1) }
  action applicationCloses = all { s.application == "pending", s' = s.with("application", "closed") }
  action aliasTaken = all { s.aliasOwner == 0, s' = s.with("aliasOwner", 2) }
  action reload = all { s.phase == "done", s' = s.with("base", s.head) }
  action retry = submit.then(loadCurrent)
  action step = {
    nondet fault = faults.oneOf() nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    any { configure(fault, a, b), submit, loadCurrent, captureEnforcement, checks, captureClearance,
      checkClearance, hashManifest, commit, failedBatch, acknowledge(a), cacheGeneration, purge(a),
      followup, reply, typeDuringSave, anotherWriter, enforcementArrives, clearanceChanges,
      applicationCloses, aliasTaken, reload, s' = s }
  }
  val invariant = all { s.head <= 3, s.history.length() == s.head, s.base <= s.head, s.attempts <= 2,
    s.history.indices().forall(i => s.history.nth(i) == i + 1),
    s.response > 0 implies s.response == s.committed and s.response <= s.head,
    s.committed > 0 implies s.history.contains(s.committed) and s.noticeKeys.contains(s.committed),
    s.result == "returned" implies s.response > 0,
    s.conflict implies s.committed == 0 }
  action toWrite = submit.then(loadCurrent).then(captureEnforcement).then(checks)
    .then(captureClearance).then(checkClearance).then(hashManifest)
  action finish = acknowledge(true).then(cacheGeneration).then(purge(true)).then(followup).then(reply)
  run replyWithoutCompetingWriteTest = init.then(toWrite).then(commit).then(finish).expect(s.response == 2 and s.head == 2 and invariant)
  run laterHeadCannotReplaceReceiptTest = init.then(toWrite).then(commit).then(anotherWriter).then(finish).expect(s.head == 3 and s.response == 2 and s.base == 2 and invariant)
  run editedDraftCannotSilentlyUseLaterHeadTest = init.then(toWrite).then(typeDuringSave).then(commit).then(anotherWriter).then(finish).then(retry).expect(s.conflict and s.head == 3 and invariant)
  run competingWriteBeforeCommitRefusesTest = init.then(toWrite).then(anotherWriter).then(commit).expect(s.conflict and s.committed == 0 and s.response == 0 and invariant)
  run changedEnforcementBeforeWriteRefusesTest = init.then(toWrite).then(enforcementArrives).then(commit).expect(s.conflict and s.head == 1 and invariant)
  run changedClearanceBeforeWriteRefusesTest = init.then(toWrite).then(clearanceChanges).then(commit).expect(s.conflict and s.head == 1 and invariant)
  run unchangedPresentationDoesNotNeedClearanceFenceTest = init.then(configure("none", false, false)).then(submit).then(loadCurrent).then(captureEnforcement).then(checks).then(hashManifest).then(clearanceChanges).then(commit).then(finish).expect(s.response == 2 and invariant)
  run closedApplicationRefusesWholeWriteTest = init.then(configure("none", true, true)).then(toWrite).then(applicationCloses).then(commit).expect(s.application == "closed" and s.head == 1 and s.noticeKeys == Set() and invariant)
  run applicationApprovalSharesRevisionCommitTest = init.then(configure("none", true, true)).then(toWrite).then(commit).expect(s.application == "approved" and s.head == 2 and s.aliasOwner == 1 and invariant)
  run lateAliasConflictRollsBackRevisionTest = init.then(toWrite).then(aliasTaken).then(commit).expect(s.conflict and s.head == 1 and s.history == List(1) and s.noticeKeys == Set() and invariant)
  run constraintFailureRollsBackNotificationAndRevisionTest = init.then(configure("constraint", true, true)).then(toWrite).then(commit).expect(s.application == "pending" and s.head == 1 and invariant)
  run batchFailureDoesNotInventCommitTest = init.then(toWrite).then(failedBatch).expect(s.head == 1 and s.committed == 0 and invariant)
  run lostBatchReplyRetainsCommitTest = init.then(toWrite).then(commit).then(acknowledge(false)).expect(s.head == 2 and s.committed == 2 and s.response == 0 and invariant)
  run lostReplyRetryAtOriginalBaseConflictsTest = init.then(toWrite).then(commit).then(acknowledge(false)).then(retry).expect(s.conflict and s.head == 2 and s.history == List(1, 2) and invariant)
  run postCommitGenerationReadFailureKeepsRevisionTest = init.then(configure("cache-generation", true, false)).then(toWrite).then(commit).then(acknowledge(true)).then(cacheGeneration).expect(s.committed == 2 and s.response == 0 and s.head == 2 and invariant)
  run cacheDeleteRejectionDoesNotFailPublicationTest = init.then(toWrite).then(commit).then(acknowledge(true)).then(cacheGeneration).then(purge(false)).then(followup).then(reply).expect(s.response == 2 and invariant)
  run laterSetupFailureKeepsCommittedRevisionTest = init.then(configure("followup", true, false)).then(toWrite).then(commit).then(acknowledge(true)).then(cacheGeneration).then(purge(true)).then(followup).expect(s.head == 2 and s.response == 0 and invariant)
  run failedPolicyHasNoWriteTest = init.then(configure("policy", true, false)).then(submit).then(loadCurrent).then(captureEnforcement).then(checks).expect(s.result == "policy" and s.head == 1 and invariant)
  run unapprovedClearanceHasNoWriteTest = init.then(configure("clearance", true, false)).then(submit).then(loadCurrent).then(captureEnforcement).then(checks).then(captureClearance).then(checkClearance).expect(s.result == "clearance" and s.head == 1 and invariant)
  run reloadedRevisionCanBeUpdatedAfterLostReplyTest = init.then(toWrite).then(commit).then(acknowledge(false)).then(reload).then(toWrite).then(commit).then(finish).expect(s.response == 3 and s.history == List(1, 2, 3) and invariant)
}
