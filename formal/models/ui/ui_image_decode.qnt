// @source src/ProjectImageField.tsx
// @source src/ProjectProposalPage.tsx
// @evidence tests/e2e/project-save.spec.ts
// Source-only refinement, unexecuted: two field lifetimes, three decode jobs,
// committed parent revisions 1..3. Native decoding/encoding are predicates.
// The parent may publish while decoding; layout commits replace the callback.
module ui_image_decode {
  type Job = { generation: int, phase: str, startRevision: int,
    delivered: bool, usedRevision: int, parentAtDelivery: int }
  var s: { generation: int, active: bool, phase: str, current: int,
    jobs: int -> Job, image: int, parentRevision: int, callbackRevision: int,
    callbackHasDraft: bool, draft: bool, draftBase: int, draftVersion: int,
    submittedVersion: int, publishing: bool }
  val ids = Set(1, 2, 3)
  action init = s' = { generation: 1, active: true, phase: "idle", current: 0,
    jobs: ids.mapBy(_ => {generation: 0, phase: "unused", startRevision: 0,
      delivered: false, usedRevision: 0, parentAtDelivery: 0}), image: 0,
    parentRevision: 1, callbackRevision: 1, callbackHasDraft: false,
    draft: false, draftBase: 0, draftVersion: 0, submittedVersion: 0, publishing: false }
  def owns(job: int): bool = s.active and s.current == job
    and s.jobs.get(job).generation == s.generation
  action choose(job: int): bool = all {
    s.active, Set("idle", "error").contains(s.phase), ids.contains(job),
    s.jobs.get(job).phase == "unused",
    s' = s.with("phase", "decoding").with("current", job)
      .with("jobs", s.jobs.set(job, {generation: s.generation, phase: "pending",
        startRevision: s.callbackRevision, delivered: false,
        usedRevision: 0, parentAtDelivery: 0})) }
  // Unsupported MIME never allocates a bitmap; input becomes usable again.
  action rejectType = all {
    s.active, Set("idle", "error").contains(s.phase),
    s' = s.with("phase", "error") }
  action decode(job: int): bool = all {
    ids.contains(job), s.jobs.get(job).phase == "pending",
    s' = s.with("jobs", s.jobs.set(job, s.jobs.get(job).with("phase", "decoded"))) }
  action decodeReject(job: int): bool = {
    val nextState = s.with("jobs", s.jobs.set(job, s.jobs.get(job).with("phase", "failed")))
    all { ids.contains(job), s.jobs.get(job).phase == "pending",
      s' = if (owns(job)) nextState.with("phase", "error").with("current", 0) else nextState }
  }
  // Canvas/context/encoding/admission failure still disposes the real bitmap.
  action invalidImage(job: int): bool = all {
    owns(job), s.jobs.get(job).phase == "decoded",
    s' = s.with("jobs", s.jobs.set(job, s.jobs.get(job).with("phase", "closed")))
      .with("phase", "error").with("current", 0) }
  action encodeCurrent(job: int): bool = all {
    owns(job), s.jobs.get(job).phase == "decoded", s.draftVersion < 3,
    s' = s.with("image", job).with("phase", "idle").with("current", 0)
      .with("draft", true).with("callbackHasDraft", true)
      .with("draftVersion", s.draftVersion + 1)
      .with("draftBase", if (s.callbackHasDraft) s.draftBase else s.callbackRevision)
      .with("jobs", s.jobs.set(job, s.jobs.get(job).with("phase", "closed")
        .with("delivered", true).with("usedRevision", s.callbackRevision)
        .with("parentAtDelivery", s.parentRevision))) }
  action closeDepartedBitmap(job: int): bool = all {
    ids.contains(job), s.jobs.get(job).phase == "decoded", not(owns(job)),
    s' = s.with("jobs", s.jobs.set(job, s.jobs.get(job).with("phase", "closed"))) }
  // These parent states are committed renders. Queued React renders are not
  // treated as a new callback before their layout effect actually commits.
  action editHeadline = all { s.active, s.draftVersion < 3,
    s' = s.with("draft", true).with("callbackHasDraft", true)
      .with("draftVersion", s.draftVersion + 1)
      .with("draftBase", if (s.draft) s.draftBase else s.parentRevision) }
  action beginPublish = all {
    s.active, s.draft, s.draftBase == s.parentRevision,
    not(s.publishing), s.parentRevision < 3,
    s' = s.with("publishing", true).with("submittedVersion", s.draftVersion) }
  action publishCommit = all {
    s.active, s.publishing, s.parentRevision < 3,
    s' = s.with("parentRevision", s.parentRevision + 1)
      .with("callbackRevision", s.parentRevision + 1).with("publishing", false)
      .with("draft", s.draftVersion != s.submittedVersion)
      .with("callbackHasDraft", s.draftVersion != s.submittedVersion)
      .with("draftBase", if (s.draftVersion != s.submittedVersion) s.parentRevision + 1 else 0) }
  action remove = all {
    s.active, Set("idle", "error").contains(s.phase), s.image != 0, s.draftVersion < 3,
    s' = s.with("image", 0).with("draft", true).with("callbackHasDraft", true)
      .with("draftVersion", s.draftVersion + 1)
      .with("draftBase", if (s.draft) s.draftBase else s.parentRevision) }
  // Explicit discard resets/remounts the field; stale async callbacks stay owned
  // by their previous lifetime. Going to another wizard step still cancels it.
  action discardDraft = all { s.generation == 1, not(s.publishing),
    s' = s.with("generation", 2).with("active", true).with("current", 0)
      .with("phase", "idle").with("image", 0).with("draft", false)
      .with("draftBase", 0).with("callbackHasDraft", false) }
  action leaveField = all { s.active,
    s' = s.with("active", false).with("phase", "departed").with("current", 0) }
  action returnToField = all { not(s.active), s.generation == 1,
    s' = s.with("active", true).with("generation", 2).with("phase", "idle") }
  action step = {
    nondet job = ids.oneOf()
    any { choose(job), rejectType, decode(job), decodeReject(job), invalidImage(job),
      encodeCurrent(job), closeDepartedBitmap(job), editHeadline, beginPublish,
      publishCommit, remove, discardDraft, leaveField, returnToField, s' = s }
  }
  val invariant = all {
    s.draftVersion <= 3,
    s.callbackRevision == s.parentRevision,
    s.callbackHasDraft == s.draft,
    s.draft implies s.draftBase == s.parentRevision,
    ids.forall(job => s.jobs.get(job).delivered implies all {
      s.jobs.get(job).phase == "closed",
      s.jobs.get(job).usedRevision == s.jobs.get(job).parentAtDelivery }),
    if (s.current == 0) true else s.jobs.get(s.current).generation == s.generation }
  run discardedDecodeTest = init.then(choose(1)).then(discardDraft).then(decode(1))
    .then(closeDepartedBitmap(1)).expect(s.image == 0 and s.jobs.get(1).phase == "closed")
  run successfulDecodeTest = init.then(choose(1)).then(decode(1)).then(encodeCurrent(1))
    .expect(s.image == 1 and s.jobs.get(1).phase == "closed" and s.phase == "idle")
  run invalidDecodeClosesTest = init.then(choose(1)).then(decode(1)).then(invalidImage(1))
    .expect(s.phase == "error" and s.jobs.get(1).phase == "closed" and s.image == 0)
  run overlappingGenerationsTest = init.then(choose(1)).then(discardDraft).then(choose(2))
    .then(decode(2)).then(encodeCurrent(2)).then(decode(1)).then(closeDepartedBitmap(1))
    .expect(s.image == 2 and s.jobs.get(1).phase == "closed" and s.jobs.get(2).phase == "closed")
  run invalidTypeRetriesTest = init.then(rejectType).then(choose(1)).then(decode(1))
    .then(encodeCurrent(1)).expect(s.image == 1 and s.phase == "idle")
  run rejectedDecodeHasNoBitmapTest = init.then(choose(1)).then(decodeReject(1))
    .expect(s.phase == "error" and s.jobs.get(1).phase == "failed")
  run decodeRejectionRetriesTest = init.then(choose(1)).then(decodeReject(1))
    .then(choose(2)).then(decode(2)).then(encodeCurrent(2)).expect(s.image == 2)
  run encodingFailureRetriesTest = init.then(choose(1)).then(decode(1)).then(invalidImage(1))
    .then(choose(2)).then(decode(2)).then(encodeCurrent(2)).expect(s.image == 2)
  run busyFieldRefusesSecondSelectionTest = init.then(choose(1)).then(choose(2).fail())
  run departedDecodeRejectionDoesNotChangeNewFieldTest = init.then(choose(1)).then(discardDraft)
    .then(choose(2)).then(decodeReject(1)).expect(s.phase == "decoding" and s.current == 2)
  run wizardDepartureStillDiscardsPendingSelectionTest = init.then(choose(1)).then(leaveField)
    .then(returnToField).then(decode(1)).then(closeDepartedBitmap(1)).expect(s.image == 0)
  run publishedParentUsesCurrentCallbackTest = init.then(choose(1)).then(editHeadline)
    .then(beginPublish).then(publishCommit).then(decode(1)).then(encodeCurrent(1))
    .expect(s.draftBase == 2 and s.jobs.get(1).startRevision == 1 and s.jobs.get(1).usedRevision == 2)
  run imageEditedDuringSaveRemainsDraftTest = init.then(choose(1)).then(editHeadline)
    .then(beginPublish).then(decode(1)).then(encodeCurrent(1)).then(publishCommit)
    .expect(s.draft and s.draftBase == 2 and s.image == 1)
  run laterImageCanPublishWithoutArtificialConflictTest = init.then(choose(1)).then(editHeadline)
    .then(beginPublish).then(publishCommit).then(decode(1)).then(encodeCurrent(1))
    .then(beginPublish).then(publishCommit).expect(s.parentRevision == 3 and not(s.draft))
  run removalKeepsCurrentDraftBaseTest = init.then(choose(1)).then(decode(1)).then(encodeCurrent(1))
    .then(beginPublish).then(publishCommit).then(remove).expect(s.image == 0 and s.draftBase == 2)
}
