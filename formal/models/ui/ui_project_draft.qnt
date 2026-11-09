// @source src/ProjectProposalPage.tsx
// @source src/lib/project-draft-store.ts
// @evidence tests/e2e/project-save.spec.ts
// ProjectUpdateForm projection: two editable fields, three object identities,
// revisions 1..3, two publications. A draft is a partial object, not a changed
// field count. Even retyping the submitted value creates a newer object.
// Values stand for normalized manifest values; epochs retain raw object identity.
// Restored fields represent the actual recognized-string/length filter; full
// JSON, normalization, image and money grammar are delegated. -1 is unknown restored revision,
// 0 is null revision. Draft store slot/lock and queued acknowledgment semantics
// live in ui_draft_slots/ui_draft_save_progress. The memory value is updated
// before disk I/O, so failed persistence is distinct from same-document reload.
// Actor, request retirement and server authorization are separately modeled by
// ui_project_authority/ui_project_publication_lifetime. No execution claimed.
module ui_project_draft {
  val fieldIds = Set(1, 2)
  type Draft = { present: bool, fields: Set[int], values: int -> int, revision: int, epoch: int }
  type State = { mounted: bool, baseKnown: bool, base: int, baseValues: int -> int,
    server: int, serverValues: int -> int, draft: Draft, memory: Draft, disk: Draft,
    storageOk: bool, saveError: bool, phase: str, submission: str, lock: bool,
    attempts: int, attempted: bool, valid: bool, submitted: Draft,
    submittedValues: int -> int, submittedBase: int, replyValues: int -> int, replyRevision: int,
    loadError: bool }
  var s: State
  val values = Map(1 -> 1, 2 -> 1)
  val empty: Draft = { present: false, fields: Set(), values: values, revision: 0, epoch: 0 }
  action init = s' = { mounted: true, baseKnown: false, base: 1, baseValues: values,
    server: 1, serverValues: values, draft: empty, memory: empty, disk: empty,
    storageOk: true, saveError: false, phase: "idle", submission: "idle", lock: false,
    attempts: 0, attempted: false, valid: true, submitted: empty,
    submittedValues: values, submittedBase: 0, replyValues: values, replyRevision: 0,
    loadError: false }
  def rendered(slot: int): int = if (s.draft.present and s.draft.fields.contains(slot)) s.draft.values.get(slot) else s.baseValues.get(slot)
  val changed = fieldIds.exists(slot => rendered(slot) != s.baseValues.get(slot))
  val stale = s.baseKnown and s.draft.present and s.draft.revision != 0 and s.draft.revision != s.base
  action initialRead = all { s.mounted, not(s.baseKnown),
    s' = s.with("baseKnown", true).with("base", s.server).with("baseValues", s.serverValues).with("loadError", false) }
  action refresh = all { s.mounted, s' = s.with("baseKnown", true).with("base", s.server)
    .with("baseValues", s.serverValues).with("loadError", false) }
  action failedRead = all { s.mounted, s' = s.with("loadError", true) }
  action restore(kind: int): bool = {
    val restored = if (kind == 0) empty else if (kind == 3) empty.with("present", true).with("revision", 1)
      else empty.with("present", true).with("fields", Set(1)).with("values", values.set(1, 2))
        .with("revision", if (kind == 2) -1 else 1).with("epoch", 1)
    all { not(s.baseKnown), s.draft.epoch == 0, 0.to(3).contains(kind),
      s' = s.with("draft", restored).with("memory", restored).with("disk", restored) }
  }
  action edit(slot: int, value: int): bool = all { s.mounted, fieldIds.contains(slot), 0.to(2).contains(value), s.draft.epoch < 3,
    s' = s.with("draft", s.draft.with("present", true).with("fields", s.draft.fields.union(Set(slot)))
      .with("values", s.draft.values.set(slot, value)).with("epoch", s.draft.epoch + 1)
      .with("revision", if (s.draft.present) s.draft.revision else if (s.baseKnown) s.base else 0)) }
  action persist = {
    val encoded = if (not(s.draft.present)) empty.with("epoch", s.draft.epoch)
      else s.draft.with("revision", if (s.draft.revision != 0) s.draft.revision else if (s.baseKnown) s.base else 0)
    all { s.mounted,
      s' = s.with("memory", encoded).with("disk", if (s.storageOk) encoded else s.disk).with("saveError", not(s.storageOk)) }
  }
  action storageUnavailable = s' = s.with("storageOk", false)
  action storageAvailable = s' = s.with("storageOk", true)
  action remoteRevision(slot: int, value: int): bool = all { s.server < 3, fieldIds.contains(slot), 0.to(2).contains(value),
    s' = s.with("server", s.server + 1).with("serverValues", s.serverValues.set(slot, value)) }
  action confirmDraft = all { s.mounted, stale, s' = s.with("draft", s.draft.with("revision", s.base)) }
  action discard = all { s.mounted, stale, s.draft.epoch < 3,
    s' = s.with("draft", empty.with("epoch", s.draft.epoch + 1)).with("attempted", false).with("submission", "idle") }
  action invalidForm = all { not(s.lock), s' = s.with("valid", false) }
  action validForm = all { not(s.lock), s' = s.with("valid", true) }
  action rejectUnchangedOrInvalid = all { s.mounted, not(s.lock), not(s.valid) or not(changed),
    s' = s.with("attempted", true) }
  action beginPublish = all { s.mounted, not(s.lock), s.valid, changed, s.baseKnown, not(stale), s.attempts < 2,
    s' = s.with("phase", "publishing").with("submission", "publishing").with("lock", true)
      .with("attempts", s.attempts + 1).with("attempted", true).with("submitted", s.draft)
      .with("submittedValues", fieldIds.mapBy(slot => rendered(slot))).with("submittedBase", s.base) }
  action conflict = all { s.phase == "publishing", s.submittedBase != s.server,
    s' = s.with("phase", "idle").with("submission", "conflict").with("lock", false) }
  action accept = all { s.phase == "publishing", s.submittedBase == s.server, s.server < 3,
    s' = s.with("phase", "reply").with("server", s.server + 1).with("serverValues", s.submittedValues)
      .with("replyRevision", s.server + 1).with("replyValues", s.submittedValues) }
  action publishSuccess = {
    val edited = s.draft.epoch != s.submitted.epoch
    all { s.mounted, s.phase == "reply",
      s' = s.with("base", s.replyRevision).with("baseKnown", true).with("baseValues", s.replyValues)
        .with("phase", "idle").with("submission", "published").with("lock", false).with("attempted", false)
        .with("draft", if (edited) s.draft.with("revision", s.replyRevision) else empty.with("epoch", s.draft.epoch)) }
  }
  action failedPublish = all { Set("publishing", "reply").contains(s.phase), s.mounted,
    s' = s.with("phase", "idle").with("submission", "error").with("lock", false) }
  action depart = s' = s.with("mounted", false)
  action remount(sameDocument: bool): bool = all { not(s.mounted), not(s.lock),
    s' = s.with("mounted", true).with("baseKnown", false).with("draft", if (sameDocument) s.memory else s.disk)
      .with("phase", "idle").with("submission", "idle").with("attempted", false).with("loadError", false) }
  action step = {
    nondet slot = fieldIds.oneOf() nondet value = 0.to(2).oneOf() nondet kind = 0.to(3).oneOf()
    nondet sameDocument = Set(false, true).oneOf()
    any { initialRead, refresh, failedRead, restore(kind), edit(slot, value), persist,
      storageUnavailable, storageAvailable, remoteRevision(slot, value), confirmDraft, discard,
      invalidForm, validForm, rejectUnchangedOrInvalid, beginPublish, conflict, accept, publishSuccess,
      failedPublish, depart, remount(sameDocument), s' = s }
  }
  val invariant = all { s.base <= s.server, s.server <= 3, s.attempts <= 2,
    s.draft.epoch <= 3, s.draft.fields.subseteq(fieldIds),
    s.lock iff Set("publishing", "reply").contains(s.phase),
    s.submission == "publishing" implies s.lock,
    not(s.draft.present) implies s.draft.fields == Set(),
    not(s.memory.present) implies s.memory.fields == Set(),
    not(s.disk.present) implies s.disk.fields == Set() }
  action editHeadline = edit(1, 2)
  action saved = accept.then(publishSuccess)
  run editsDuringSaveTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(edit(2, 2)).then(saved)
    .expect(s.draft.present and s.draft.fields == Set(1, 2) and s.draft.revision == 2 and invariant)
  run competingRevisionTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(remoteRevision(2, 2)).then(conflict)
    .expect(s.draft.present and s.submission == "conflict" and invariant)
  run restoreStaleDraftTest = init.then(restore(1)).then(remoteRevision(2, 2)).then(initialRead).expect(stale and invariant)
  run failedStorageRetainsFormTest = init.then(initialRead).then(editHeadline).then(storageUnavailable).then(persist)
    .expect(s.draft.present and s.memory.present and not(s.disk.present) and s.saveError and invariant)
  run discardRemovesPersistenceTest = init.then(restore(2)).then(initialRead).then(discard).then(persist).then(depart).then(remount(false))
    .expect(not(s.draft.present) and invariant)
  run initialReadRequiredForPublishTest = init.then(editHeadline).then(beginPublish.fail())
  run editBeforeInitialReadKeepsNullBaseUntilReadTest = init.then(editHeadline).then(initialRead)
    .expect(s.draft.revision == 0 and not(stale)).then(beginPublish).expect(s.submittedBase == 1 and invariant)
  run unknownRestoredRevisionRequiresConfirmationTest = init.then(restore(2)).then(initialRead).expect(stale)
    .then(confirmDraft).then(beginPublish).expect(s.submittedBase == 1 and invariant)
  run emptyRestoredObjectIsNotAChangeTest = init.then(restore(3)).then(initialRead).then(rejectUnchangedOrInvalid)
    .expect(s.draft.present and not(changed) and s.attempted and s.attempts == 0 and invariant)
  run equalValueEditIsStillDraftObjectTest = init.then(initialRead).then(edit(1, 1)).then(rejectUnchangedOrInvalid)
    .expect(s.draft.present and s.draft.epoch == 1 and not(changed) and s.attempts == 0 and invariant)
  run partialDraftKeepsUneditedServerFieldsTest = init.then(initialRead).then(editHeadline).then(remoteRevision(2, 2)).then(refresh)
    .expect(rendered(1) == 2 and rendered(2) == 2 and stale and invariant)
  run confirmationDoesNotChangeDraftFieldsTest = init.then(restore(1)).then(remoteRevision(2, 2)).then(initialRead).then(confirmDraft)
    .expect(s.draft.fields == Set(1) and rendered(2) == 2 and not(stale) and invariant)
  run failedReadRetainsKnownBaseTest = init.then(initialRead).then(editHeadline).then(failedRead)
    .expect(s.baseKnown and s.loadError and s.base == 1 and invariant)
  run refreshAfterConflictRequiresExplicitRebaseTest = init.then(initialRead).then(editHeadline).then(beginPublish)
    .then(remoteRevision(2, 2)).then(conflict).then(refresh).expect(stale and s.draft.revision == 1 and invariant)
  run unchangedDraftClearsOnSuccessTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(saved)
    .expect(not(s.draft.present) and s.base == 2 and not(changed) and invariant)
  run retypedSubmittedValueKeepsNewObjectTest = init.then(initialRead).then(editHeadline).then(beginPublish)
    .then(edit(1, 0)).then(editHeadline).then(saved).expect(s.draft.present and s.draft.revision == 2 and not(changed) and invariant)
  run newFieldTypedAfterServerAcceptStillSurvivesTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(accept)
    .then(edit(2, 2)).then(publishSuccess).expect(s.draft.present and rendered(2) == 2 and s.baseValues.get(2) == 1 and invariant)
  run responseSnapshotDoesNotIncludeLaterRemoteRevisionTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(accept)
    .then(remoteRevision(2, 2)).then(publishSuccess).expect(s.base == 2 and s.server == 3 and s.baseValues.get(2) == 1 and invariant)
  run acceptedWriteWithLostReplyKeepsLocalDraftTest = init.then(initialRead).then(editHeadline).then(beginPublish).then(accept).then(failedPublish)
    .expect(s.server == 2 and s.base == 1 and s.draft.present and s.submission == "error" and invariant)
  run sameDocumentRemountUsesMemoryAfterDiskFailureTest = init.then(initialRead).then(editHeadline).then(storageUnavailable).then(persist)
    .then(depart).then(remount(true)).expect(s.draft.present and s.draft.values.get(1) == 2 and invariant)
  run newDocumentCannotRecoverFailedDiskWriteTest = init.then(initialRead).then(editHeadline).then(storageUnavailable).then(persist)
    .then(depart).then(remount(false)).expect(not(s.draft.present) and invariant)
  run discardedStaleDraftDoesNotReleasePublishLockTest = init.then(initialRead).then(editHeadline).then(beginPublish)
    .then(remoteRevision(2, 2)).then(refresh).then(discard).expect(s.submission == "idle" and s.lock).then(beginPublish.fail())
  run invalidFormNeverStartsPublicationTest = init.then(initialRead).then(editHeadline).then(invalidForm).then(rejectUnchangedOrInvalid)
    .expect(s.attempts == 0 and s.attempted and invariant)
  run persistenceCanRecoverAfterFailureTest = init.then(initialRead).then(editHeadline).then(storageUnavailable).then(persist)
    .then(storageAvailable).then(persist).expect(s.disk.present and not(s.saveError) and invariant)
}
