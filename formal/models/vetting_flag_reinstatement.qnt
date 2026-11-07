// @source migrations/0060_contributor_flags.sql
// @source backend/vetting/flags.ts
// @source backend/vetting/persistence.ts
// @source backend/projects/enforcement.ts
// Three distinct reporters and two source revisions. Withdrawal is not a clean
// scan; grandfathered admission does not override a current restriction.
module vetting_flag_reinstatement {
  var s: { flags: Set[int], captured: Set[int], restriction: str,
    revision: int, scannedRevision: int, result: str, pending: bool, exempt: bool }
  action init = s' = { flags: Set(), captured: Set(), restriction: "clear",
    revision: 1, scannedRevision: 0, result: "none", pending: false, exempt: false }
  action flag(reporter) = all {
    reporter.in(Set(1, 2, 3)),
    val updatedFlags = s.flags.union(Set(reporter))
    s' = s.with("flags", updatedFlags).with("restriction",
      if (s.restriction == "clear" and updatedFlags.size() >= 2) "quarantined" else s.restriction),
  }
  action withdraw(reporter) = s' = s.with("flags", s.flags.exclude(Set(reporter)))
  action requestScan = all {
    not(s.pending), s' = s.with("pending", true).with("captured", s.flags)
      .with("scannedRevision", s.revision),
  }
  action revise = all { s.revision == 1, s' = s.with("revision", 2) }
  action admissionExemption = s' = s.with("exempt", true)
  action completeClean = all {
    s.pending,
    val fresh = s.revision == s.scannedRevision and s.flags.subseteq(s.captured)
    val restore = fresh and s.restriction == "quarantined"
    s' = s.with("pending", false).with("result", "clean")
      .with("restriction", if (restore) "clear" else s.restriction)
      .with("flags", if (restore) Set() else s.flags),
  }
  action incomplete = all { s.pending, s' = s.with("pending", false).with("result", "incomplete") }
  action confirmedMalice = all { s.pending,
    s' = s.with("pending", false).with("result", "malicious").with("restriction", "banned") }
  action step = {
    nondet reporter = Set(1, 2, 3).oneOf()
    any { flag(reporter), withdraw(reporter), requestScan, revise,
      admissionExemption, completeClean, incomplete, confirmedMalice }
  }
  val invariant = all {
    s.flags.size() >= 2 implies s.restriction != "clear",
    s.restriction == "banned" implies s.result.in(Set("malicious", "clean", "incomplete")),
    s.scannedRevision <= s.revision,
  }
  run duplicateReporterTest = init.then(flag(1)).then(flag(1))
    .expect(s.restriction == "clear" and s.flags.size() == 1)
  run withdrawalDoesNotReinstateTest = init.then(flag(1)).then(flag(2)).then(withdraw(2))
    .expect(s.restriction == "quarantined")
  run freshScanReinstatesTest = init.then(flag(1)).then(flag(2)).then(requestScan)
    .then(completeClean).expect(s.restriction == "clear" and s.flags.size() == 0)
  run newFlagPreventsReinstatementTest = init.then(flag(1)).then(flag(2)).then(requestScan)
    .then(flag(3)).then(completeClean).expect(s.restriction == "quarantined")
  run exemptionDoesNotOverrideRestrictionTest = init.then(flag(1)).then(flag(2)).then(admissionExemption)
    .expect(s.restriction == "quarantined")
  run cleanScanDoesNotUndoBanTest = init.then(requestScan).then(confirmedMalice)
    .then(requestScan).then(completeClean).expect(s.restriction == "banned")
}
