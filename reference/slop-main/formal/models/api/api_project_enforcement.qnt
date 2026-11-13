// @source backend/projects/verified-enforcement.ts
// @source migrations/0023_project_enforcements.sql
// @source migrations/0027_project_enforcement_owner_appeals.sql
// @source migrations/0032_project_system_enforcement.sql
// @source migrations/0060_contributor_flags.sql
// @source migrations/0066_project_maintainer_bans.sql
// @source migrations/0070_banned_account_appeals.sql
// @source migrations/0072_account_reinstatements.sql
// @source backend/projects/enforcement.ts
// @source backend/projects/account-bans.ts
// @source backend/projects/edge-cache.ts
// @source backend/projects/handler.ts
// @source backend/vetting/flags.ts
// Project restriction lifecycle (PRD section 8). Two reporters; one scan in
// flight. `freshClean` is a finished clean scan requested after the latest
// restriction (handler reinstate gate and planFlagScanReinstatement): every
// new restriction resets it, and a scan requested before the restriction
// stays stale when it finishes. Only a quarantine that contributor flags
// alone placed lifts on a fresh clean scan; a moderator decides every other
// restriction, after an appeal, from an independent seat, with a fresh scan.
// A vetting-service malicious ban leaves a pending decision; the moderator
// decision that confirms it bans the maintainer accounts. Account bans are
// released separately (reinstate_accounts), never by project reinstatement.
module api_project_enforcement {
  type S = { phase: str, byFlags: bool, flags: Set[int], covered: bool,
    appeal: str, confirmedMalice: bool, deciding: bool, moderatorBan: bool,
    scan: str, scanAfterRestriction: bool, freshClean: bool,
    accountBanned: bool }
  var s: S
  action init = s' = { phase: "clear", byFlags: false, flags: Set(), covered: false,
    appeal: "none", confirmedMalice: false, deciding: false, moderatorBan: false,
    scan: "none", scanAfterRestriction: false, freshClean: false,
    accountBanned: false }
  // Any new restriction makes every earlier or in-flight scan stale.
  def restrict(x: S, phase: str, byFlags: bool): S =
    x.with("phase", phase).with("byFlags", byFlags).with("freshClean", false)
      .with("scanAfterRestriction", false)
  // flags.ts file(): the pause lands only while the project's records are
  // clear and two distinct reporters hold active flags. A flag filed during
  // a scan is not in that scan's flag snapshot.
  action flag(reporter: int): bool = all { Set(1, 2).contains(reporter),
    not(s.flags.contains(reporter)),
    val flags = s.flags.union(Set(reporter))
    val pauses = s.phase == "clear" and flags.size() >= 2
    s' = (if (pauses) restrict(s, "quarantined", true) else s)
      .with("flags", flags).with("covered", false) }
  action withdraw(reporter: int): bool = all { s.flags.contains(reporter),
    s' = s.with("flags", s.flags.exclude(Set(reporter))) }
  action moderatorQuarantine = all { s.phase == "clear",
    s' = restrict(s, "quarantined", false).with("appeal", "none") }
  // A moderator ban on a project the vetting service banned is the malicious
  // decision: it bans the maintainer accounts and closes a kept appeal.
  action moderatorBan = all { s.phase != "banned" or s.deciding,
    s' = (if (s.deciding) s.with("accountBanned", true).with("deciding", false)
            .with("appeal", if (s.appeal == "requested") "denied" else s.appeal)
          else restrict(s, "banned", false).with("appeal", "none"))
      .with("moderatorBan", true) }
  action serviceMalicious = all { s.scan == "pending",
    s' = restrict(s, "banned", false).with("scan", "none").with("confirmedMalice", true)
      .with("deciding", true) }
  action requestScan = all { s.scan == "none",
    s' = s.with("scan", "pending").with("scanAfterRestriction", s.phase != "clear")
      .with("covered", true) }
  action completeClean = all { s.scan == "pending",
    s' = s.with("scan", "none").with("freshClean", s.scanAfterRestriction) }
  action completeIncomplete = all { s.scan == "pending", s' = s.with("scan", "none") }
  action appeal = all { s.phase != "clear", s.appeal != "requested",
    s' = s.with("appeal", "requested") }
  // Only the latest flag-only pause; the scan's snapshot covers every
  // active flag; requested after the pause.
  action autoReinstate = all { s.phase == "quarantined", s.byFlags, s.freshClean, s.covered,
    s' = s.with("phase", "clear").with("byFlags", false).with("flags", Set())
      .with("appeal", if (s.appeal == "requested") "granted" else "none") }
  action moderatorReinstate(independent: bool): bool = all { independent,
    s.phase != "clear", s.appeal == "requested", s.freshClean,
    s' = s.with("phase", "clear").with("byFlags", false).with("flags", Set())
      .with("appeal", "granted").with("confirmedMalice", false).with("deciding", false)
      .with("moderatorBan", false) }
  action deny(independent: bool): bool = all { independent, s.appeal == "requested",
    not(s.deciding), s' = s.with("appeal", "denied") }
  action clearAccount(independent: bool): bool = all { independent, s.accountBanned,
    s' = s.with("accountBanned", false) }
  action step = any { flag(1), flag(2), withdraw(1), withdraw(2), moderatorQuarantine,
    moderatorBan, serviceMalicious, requestScan, completeClean, completeIncomplete,
    appeal, autoReinstate, moderatorReinstate(true), moderatorReinstate(false),
    deny(true), deny(false), clearAccount(true), clearAccount(false) }
  val invariant = all {
    s.phase == "clear" implies s.flags.size() < 2,
    s.phase == "clear" implies not(s.confirmedMalice or s.deciding or s.byFlags),
    s.phase == "banned" implies (s.confirmedMalice or s.moderatorBan),
    s.byFlags implies s.phase == "quarantined",
    s.deciding implies (s.confirmedMalice and s.phase == "banned"),
  }
  run flagsTest = init.then(flag(1)).then(flag(2)).then(requestScan).then(completeClean)
    .then(autoReinstate).expect(s.phase == "clear" and s.flags.size() == 0 and invariant)
  run flagWhileRestrictedDoesNotRepauseTest = init.then(moderatorQuarantine).then(flag(1))
    .then(flag(2)).expect(s.phase == "quarantined" and not(s.byFlags))
  run scanBeforePauseIsStaleTest = init.then(flag(1)).then(requestScan).then(flag(2))
    .then(completeClean).then(autoReinstate.fail())
  run flagDuringScanBlocksReinstatementTest = init.then(flag(1)).then(flag(2)).then(withdraw(2))
    .then(requestScan).then(flag(2)).then(completeClean).then(autoReinstate.fail())
  run moderatorQuarantineNeedsModeratorTest = init.then(moderatorQuarantine).then(requestScan)
    .then(completeClean).then(autoReinstate.fail())
  run moderatorReinstatementNeedsFreshScanTest = init.then(moderatorQuarantine).then(appeal)
    .then(moderatorReinstate(true).fail())
  run moderatorBanWithoutMaliceTest = init.then(moderatorBan)
    .expect(s.phase == "banned" and not(s.confirmedMalice) and not(s.accountBanned) and invariant)
  run maliciousDecisionBansMaintainerTest = init.then(requestScan).then(serviceMalicious)
    .then(appeal).then(deny(true).fail())
  run maliciousConfirmationTest = init.then(requestScan).then(serviceMalicious).then(appeal)
    .then(moderatorBan).expect(s.accountBanned and s.appeal == "denied" and s.phase == "banned")
  run accountSeparationTest = init.then(requestScan).then(serviceMalicious).then(moderatorBan)
    .then(appeal).then(requestScan).then(completeClean).then(moderatorReinstate(true))
    .expect(s.phase == "clear" and s.accountBanned and invariant)
  run dependentModeratorRefusedTest = init.then(moderatorQuarantine).then(appeal).then(requestScan)
    .then(completeClean).then(moderatorReinstate(false).fail())
}
