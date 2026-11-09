// @source migrations/0075_vetting_grandfathered_projects.sql
// @source backend/vetting/persistence.ts
// The migration freezes the then-present project set. Later additions and
// name/repository changes cannot create a new member. Malice overrides it.
module vetting_fixed_exemption {
  var s: { projects: Set[int], fixed: Set[int], migrated: bool, banned: Set[int] }
  action init = s' = {projects: Set(1), fixed: Set(), migrated: false, banned: Set()}
  action migrate = all { not(s.migrated), s' = s.with("fixed", s.projects).with("migrated", true) }
  action addProject = all { s.migrated, s' = s.with("projects", s.projects.union(Set(2))) }
  action ban = all { s.migrated, s' = s.with("banned", s.banned.union(Set(1))) }
  val exempt = s.fixed.exclude(s.banned)
  action step = any { migrate, addProject, ban, s' = s }
  val invariant = all { s.migrated implies s.fixed == Set(1), not(2.in(exempt)) }
  run laterProjectNotGrandfatheredTest = init.then(migrate).then(addProject).expect(exempt == Set(1))
  run maliceOverridesExemptionTest = init.then(migrate).then(ban).expect(exempt.size() == 0)
}
