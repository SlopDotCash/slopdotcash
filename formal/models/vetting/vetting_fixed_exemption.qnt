// @source migrations/0075_vetting_grandfathered_projects.sql
// @source migrations/0031_project_vetting_reinstatements.sql
// @source backend/vetting/persistence.ts
// The migration freezes the then-present project set. Later additions and
// name/repository changes cannot create a new member. Unwaived malice
// overrides it. A moderator reinstatement after a fresh clean scan records the
// malicious assessment as reviewed; the frozen membership never changed, so
// the exemption applies again (vetting_admission_clearance models the gates).
module vetting_fixed_exemption {
  var s: { projects: Set[int], fixed: Set[int], migrated: bool, banned: Set[int],
    freshClean: Set[int] }
  action init = s' = {projects: Set(1), fixed: Set(), migrated: false, banned: Set(),
    freshClean: Set()}
  action migrate = all { not(s.migrated), s' = s.with("fixed", s.projects).with("migrated", true) }
  action addProject = all { s.migrated, s' = s.with("projects", s.projects.union(Set(2))) }
  action ban(p: int): bool = all { s.migrated, s.projects.contains(p),
    s' = s.with("banned", s.banned.union(Set(p))).with("freshClean", s.freshClean.exclude(Set(p))) }
  action freshScan(p: int): bool = all { s.banned.contains(p),
    s' = s.with("freshClean", s.freshClean.union(Set(p))) }
  action waive(p: int): bool = all { s.banned.contains(p), s.freshClean.contains(p),
    s' = s.with("banned", s.banned.exclude(Set(p))) }
  val exempt = s.fixed.exclude(s.banned)
  action step = any { migrate, addProject, ban(1), ban(2), freshScan(1), freshScan(2),
    waive(1), waive(2) }
  val invariant = all { s.migrated implies s.fixed == Set(1), not(2.in(exempt)),
    exempt.subseteq(s.fixed), s.banned.intersect(exempt).size() == 0 }
  run laterProjectNotGrandfatheredTest = init.then(migrate).then(addProject).expect(exempt == Set(1))
  run maliceOverridesExemptionTest = init.then(migrate).then(ban(1)).expect(exempt.size() == 0)
  run waiverNeedsFreshScanTest = init.then(migrate).then(ban(1)).then(waive(1).fail())
  run waiverRestoresExemptionTest = init.then(migrate).then(ban(1)).then(freshScan(1))
    .then(waive(1)).expect(exempt == Set(1))
  run waiverNeverGrandfathersLaterProjectTest = init.then(migrate).then(addProject).then(ban(2))
    .then(freshScan(2)).then(waive(2)).expect(exempt == Set(1))
}
