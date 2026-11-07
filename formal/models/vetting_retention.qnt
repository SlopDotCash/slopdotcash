// @source migrations/0066_vetting_case_retention.sql
// @source migrations/0068_vetting_storage_cycles.sql
// @source migrations/0107_vetting_content_addressed_evidence.sql
// @source workers/vetting-backup/core.ts
// @source backend/vetting/evidence-retention.ts
// @source backend/vetting/evidence-chunks.ts
// Three references share one content-addressed object. Authorized retention
// waits for verified backup and fences new references before physical deletion.
module vetting_retention {
  var s: { present: bool, backup: bool, verifiedBackup: bool,
    closed: Set[int], oldEnough: Set[int], permanent: Set[int],
    references: Set[int], tombstone: bool, deletionRecorded: bool }
  action init = s' = { present: true, backup: false, verifiedBackup: false,
    closed: Set(), oldEnough: Set(), permanent: Set(), references: Set(1, 2),
    tombstone: false, deletionRecorded: false }
  action close(ref) = all { ref.in(s.references), s' = s.with("closed", s.closed.union(Set(ref))) }
  action age(ref) = all { ref.in(s.closed), s' = s.with("oldEnough", s.oldEnough.union(Set(ref))) }
  action permanentAdmission(ref) = all { ref.in(s.references), not(s.tombstone),
    s' = s.with("permanent", s.permanent.union(Set(ref))) }
  action copy = all { s.present, s' = s.with("backup", true) }
  action verifyBackup = all { s.backup, s' = s.with("verifiedBackup", true) }
  action fenceDeletion = all {
    not(s.tombstone), s.references.subseteq(s.oldEnough), s.permanent.size() == 0,
    s.verifiedBackup, s' = s.with("tombstone", true),
  }
  action addReference(ref) = all { not(s.tombstone), ref.in(Set(1, 2, 3)),
    s' = s.with("references", s.references.union(Set(ref))) }
  action delete = all { s.tombstone, s.verifiedBackup, s.present,
    s' = s.with("present", false) }
  action recordDeletion = all { s.tombstone, not(s.present), s.verifiedBackup,
    s' = s.with("deletionRecorded", true) }
  action step = {
    nondet ref = Set(1, 2, 3).oneOf()
    any { close(ref), age(ref), permanentAdmission(ref), copy, verifyBackup,
      fenceDeletion, addReference(ref), delete, recordDeletion }
  }
  val invariant = all {
    not(s.present) implies all { s.tombstone, s.verifiedBackup, s.permanent.size() == 0,
      s.references.subseteq(s.oldEnough) },
    s.deletionRecorded implies not(s.present),
    s.verifiedBackup implies s.backup,
  }
  run sharedReferencePreservesObjectTest = init.then(close(1)).then(age(1)).then(copy).then(verifyBackup)
    .expect(s.present and not(s.references.subseteq(s.oldEnough)))
  run backedUpExpiredReferencesTest = init.then(close(1)).then(close(2)).then(age(1)).then(age(2))
    .then(copy).then(verifyBackup).then(fenceDeletion).then(delete).then(recordDeletion)
    .expect(s.deletionRecorded and s.backup)
  run admissionEvidencePermanentTest = init.then(permanentAdmission(1)).then(close(1)).then(close(2))
    .then(age(1)).then(age(2)).then(copy).then(verifyBackup).expect(s.present and not(s.tombstone))
  run lateReferencePreventsDeletionTest = init.then(close(1)).then(close(2)).then(age(1)).then(age(2))
    .then(copy).then(verifyBackup).then(addReference(3)).expect(not(s.references.subseteq(s.oldEnough)))
}
