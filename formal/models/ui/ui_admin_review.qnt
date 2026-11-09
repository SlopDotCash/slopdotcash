// @source src/Admin.tsx
// @source src/AdminProjectEnforcement.tsx
// @source src/AdminVetting.tsx
// Admin proposal/preview is separate from append-only apply; stale revision refuses.
module ui_admin_review {
  var s: { role: bool, phase: str, revision: int, previewRevision: int, reason: bool, records: int }
  action init = s' = { role: false, phase: "draft", revision: 1, previewRevision: 0, reason: false, records: 0 }
  action grantRole = s' = s.with("role", true)
  action provideReason = s' = s.with("reason", true)
  action preview = all { s.role, s.reason, s.phase == "draft", s' = s.with("phase", "preview").with("previewRevision", s.revision) }
  action concurrentRevision = all { s.revision == 1, s' = s.with("revision", 2) }
  action apply = all { s.role, s.reason, s.phase == "preview", s.previewRevision == s.revision, s' = s.with("phase", "saved").with("records", 1) }
  action conflict = all { s.phase == "preview", s.previewRevision != s.revision, s' = s.with("phase", "draft").with("previewRevision", 0) }
  action revoke = s' = s.with("role", false)
  action step = any { grantRole, provideReason, preview, concurrentRevision, apply, conflict, revoke, s' = s }
  val invariant = all { s.records <= 1, s.records > 0 iff s.phase == "saved" }
  run applyTest = init.then(grantRole).then(provideReason).then(preview).then(apply).expect(s.records == 1)
  run conflictTest = init.then(grantRole).then(provideReason).then(preview).then(concurrentRevision).then(conflict).expect(s.records == 0)
  run accessLossTest = init.then(grantRole).then(provideReason).then(preview).then(revoke).expect(s.records == 0)
}
