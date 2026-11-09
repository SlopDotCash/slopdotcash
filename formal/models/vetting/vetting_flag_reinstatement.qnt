// @source backend/projects/verified-enforcement.ts
// @source migrations/0060_contributor_flags.sql
// @source backend/vetting/flags.ts
// @source backend/vetting/persistence.ts
// @source backend/projects/enforcement.ts
// Flag-only pause and scan reinstatement keyed by flag id (PRD section 8).
// Bounds: two reporters, at most three flag ids, two source revisions, one
// scan in flight. A reporter holds at most one active flag
// (project_flags_one_active); withdrawal and the 90-day lifetime close a flag
// the same way (it stops counting and the reporter may file a new id).
// A scan snapshots the active flag ids (vetting_assessments.flag_ids). A
// clean result resolves exactly the snapshot's still-active ids, whatever
// else happens (project_flags_resolve_on_clean_scan). It reinstates only a
// flag-only quarantine, only when no active id lies outside the snapshot
// (assessmentCoversActiveFlags), only when it was requested at or after the
// latest restriction, only for a fresh (not reused) result, and only at the
// live revision. Withdrawal is not a clean scan; exemptions do not override
// a restriction; confirmed malice is decided by a moderator elsewhere
// (api_project_enforcement), so it is absorbing here.
module vetting_flag_reinstatement {
  type S = { reporterOf: int -> int, active: Set[int], resolved: Set[int], nextId: int,
    restriction: str, pauseEpoch: int, captured: Set[int], scanEpoch: int,
    revision: int, scannedRevision: int, pending: bool, exempt: bool, everBanned: bool }
  var s: S
  val ids = Set(1, 2, 3)
  action init = s' = { reporterOf: ids.mapBy(_ => 0), active: Set(), resolved: Set(), nextId: 1,
    restriction: "clear", pauseEpoch: 0, captured: Set(), scanEpoch: 0,
    revision: 1, scannedRevision: 0, pending: false, exempt: false, everBanned: false }
  def reporters(x: S, flags: Set[int]): Set[int] = flags.map(id => x.reporterOf.get(id))
  action file(reporter: int): bool = all {
    Set(1, 2).contains(reporter), s.nextId <= 3,
    not(reporters(s, s.active).contains(reporter)),
    val id = s.nextId
    val updated = s.reporterOf.set(id, reporter)
    val active = s.active.union(Set(id))
    val pauses = s.restriction == "clear" and active.map(f => updated.get(f)).size() >= 2
    s' = s.with("reporterOf", updated).with("active", active).with("nextId", id + 1)
      .with("restriction", if (pauses) "quarantined" else s.restriction)
      .with("pauseEpoch", if (pauses) s.pauseEpoch + 1 else s.pauseEpoch),
  }
  // Withdrawal by the reporter or expiry after 90 days.
  action close(id: int): bool = all { s.active.contains(id),
    s' = s.with("active", s.active.exclude(Set(id))) }
  action requestScan = all { not(s.pending),
    s' = s.with("pending", true).with("captured", s.active).with("scanEpoch", s.pauseEpoch)
      .with("scannedRevision", s.revision) }
  action revise = all { s.revision == 1, s' = s.with("revision", 2) }
  action admissionExemption = s' = s.with("exempt", true)
  action completeClean(reused: bool): bool = all { s.pending,
    val covered = s.active.subseteq(s.captured)
    val restore = s.restriction == "quarantined" and not(reused) and covered
      and s.scanEpoch == s.pauseEpoch and s.revision == s.scannedRevision
    val closing = s.active.intersect(s.captured)
    s' = s.with("pending", false).with("active", s.active.exclude(closing))
      .with("resolved", s.resolved.union(closing))
      .with("restriction", if (restore) "clear" else s.restriction),
  }
  action incomplete = all { s.pending, s' = s.with("pending", false) }
  action confirmedMalice = all { s.pending,
    s' = s.with("pending", false).with("restriction", "banned").with("everBanned", true) }
  action step = any {
    file(1), file(2), close(1), close(2), close(3), requestScan, revise,
    admissionExemption, completeClean(true), completeClean(false), incomplete, confirmedMalice,
  }
  val invariant = all {
    // Two distinct active reporters always restrict the project.
    reporters(s, s.active).size() >= 2 implies s.restriction != "clear",
    // One active flag per reporter.
    reporters(s, s.active).size() == s.active.size(),
    // A clean result resolves only ids in its own snapshot.
    s.active.intersect(s.resolved).size() == 0,
    s.active.forall(id => id < s.nextId),
    s.everBanned implies s.restriction == "banned",
    s.scannedRevision <= s.revision,
  }
  run duplicateReporterTest = init.then(file(1)).then(file(1).fail())
  run withdrawalDoesNotReinstateTest = init.then(file(1)).then(file(2)).then(close(2))
    .expect(s.restriction == "quarantined")
  run freshScanReinstatesTest = init.then(file(1)).then(file(2)).then(requestScan)
    .then(completeClean(false)).expect(s.restriction == "clear" and s.active.size() == 0)
  // The same reporter withdraws and files again during the scan: a new id
  // outside the snapshot keeps the pause, though the reporter is unchanged.
  run refiledIdDuringScanKeepsPauseTest = init.then(file(1)).then(file(2)).then(requestScan)
    .then(close(2)).then(file(2)).then(completeClean(false))
    .expect(s.restriction == "quarantined" and s.active == Set(3) and s.resolved == Set(1))
  run scanBeforePauseDoesNotReinstateTest = init.then(file(1)).then(requestScan).then(file(2))
    .then(completeClean(false)).expect(s.restriction == "quarantined" and s.active == Set(2))
  run staleRevisionDoesNotReinstateTest = init.then(file(1)).then(file(2)).then(requestScan)
    .then(revise).then(completeClean(false)).expect(s.restriction == "quarantined")
  run reusedCleanResolvesButKeepsPauseTest = init.then(file(1)).then(file(2)).then(requestScan)
    .then(completeClean(true)).expect(s.restriction == "quarantined" and s.active.size() == 0)
  run expiryAllowsRefileTest = init.then(file(1)).then(close(1)).then(file(1))
    .expect(s.active == Set(2) and s.restriction == "clear")
  run exemptionDoesNotOverrideRestrictionTest = init.then(file(1)).then(file(2))
    .then(admissionExemption).expect(s.restriction == "quarantined")
  run cleanScanDoesNotUndoBanTest = init.then(requestScan).then(confirmedMalice)
    .then(requestScan).then(completeClean(false)).expect(s.restriction == "banned")
}
