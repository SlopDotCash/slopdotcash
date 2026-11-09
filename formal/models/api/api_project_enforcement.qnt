// @source migrations/0023_project_enforcements.sql
// @source migrations/0027_project_enforcement_owner_appeals.sql
// @source migrations/0032_project_system_enforcement.sql
// @source migrations/0066_project_maintainer_bans.sql
// @source migrations/0070_banned_account_appeals.sql
// @source migrations/0072_account_reinstatements.sql
// @source backend/projects/enforcement.ts
// @source backend/projects/account-bans.ts
// @source backend/projects/edge-cache.ts
module api_project_enforcement {
  var s: {phase: str, flags: Set[int], appeal: bool, confirmedMalice: bool, freshClean: bool, accountBanned: bool, obligation: int, generation: int}
  action init = s' = {phase: "clear", flags: Set(), appeal: false, confirmedMalice: false, freshClean: false, accountBanned: false, obligation: 1, generation: 0}
  action flag(actor: int): bool = all { Set(1,2).contains(actor), not(s.flags.contains(actor)), s.generation < 4,
    s' = s.with("flags", s.flags.union(Set(actor))).with("phase", if(s.flags.size() == 1) "quarantined" else s.phase).with("generation", s.generation + 1) }
  action malicious = all { s.generation < 4,
    s' = s.with("phase", "banned").with("confirmedMalice", true).with("accountBanned", true).with("freshClean", false).with("generation", s.generation + 1) }
  action appeal = all { s.phase != "clear", s' = s.with("appeal", true) }
  action freshScan = s' = s.with("freshClean", true)
  action autoReinstate = all { s.phase == "quarantined", not(s.confirmedMalice), s.freshClean,
    s' = s.with("phase", "clear").with("flags", Set()).with("appeal", false) }
  action moderatorReinstate(independent: bool): bool = all { independent, s.appeal, s.freshClean,
    s' = s.with("phase", "clear").with("flags", Set()).with("appeal", false) }
  action clearAccount(independent: bool): bool = all { independent, s.accountBanned, s' = s.with("accountBanned", false) }
  action step = any { flag(1), flag(2), malicious, appeal, freshScan, autoReinstate, moderatorReinstate(true), moderatorReinstate(false), clearAccount(true), clearAccount(false), s' = s }
  val invariant = all { s.obligation == 1, s.phase == "clear" implies s.flags.size() < 2,
    s.phase == "banned" implies s.confirmedMalice }
  run flagsTest = init.then(flag(1)).then(flag(2)).then(freshScan).then(autoReinstate).expect(s.phase == "clear")
  run accountSeparationTest = init.then(malicious).then(appeal).then(freshScan).then(moderatorReinstate(true)).expect(s.phase == "clear" and s.accountBanned)
}
