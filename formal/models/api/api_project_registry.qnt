// @source migrations/0019_project_registry.sql
// @source migrations/0020_project_application_github_check.sql
// @source migrations/0039_project_update_applications.sql
// @source backend/projects/contracts.ts
// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/setup.ts
// @source backend/projects/verified-setup.ts
// @source backend/projects/repository-access.ts
// @source backend/projects/github-lookup.ts
// @source backend/projects/skill-publication.ts
module api_project_registry {
  var s: {revision: int, history: List[int], installed: bool, authority: bool, clearance: bool, restricted: bool,
    enforcement: int, createGeneration:int, active: bool, authorizedWrite: bool, funding: bool}
  action init = s' = {revision: 0, history: List(), installed: false, authority: false, clearance: false,
    restricted: false, enforcement: 0, createGeneration:-1, active: false, authorizedWrite: false, funding: false}
  action install = s' = s.with("installed", true)
  action authorize = all { s.installed, s' = s.with("authority", true) }
  // Capture before the awaited authority check, as createProject does.
  action prepareCreate = all{not(s.restricted),s.revision==0,
    s'=s.with("createGeneration",s.enforcement)}
  action create = all { s.installed, s.authority, s.revision == 0, not(s.restricted),s.createGeneration==s.enforcement,
    s' = s.with("revision", 1).with("history", List(1)).with("authorizedWrite", true) }
  action clear = all { s.revision > 0, s' = s.with("clearance", true) }
  action revise(expected: int, generation: int): bool = all { s.authority, expected == s.revision,
    generation == s.enforcement, s.revision > 0, s.revision < 3,
    s' = s.with("revision", s.revision + 1).with("history", s.history.append(s.revision + 1))
      .with("active", s.installed and s.clearance and not(s.restricted)).with("authorizedWrite", true) }
  action restrict = all { s.enforcement < 2, s' = s.with("enforcement", s.enforcement + 1).with("restricted", true).with("active", false) }
  action fund = s' = s.with("funding", true)
  action step = { nondet expected = 0.to(3).oneOf(); nondet generation = 0.to(2).oneOf()
    any { install, authorize, prepareCreate, create, clear, revise(expected,generation), restrict, fund, s' = s } }
  val invariant = all { s.revision == s.history.length(), s.history.indices().forall(i => s.history.nth(i) == i + 1),
    s.active implies (s.installed and s.clearance and not(s.restricted) and s.authorizedWrite) }
  run unfundedActivationTest = init.then(install).then(prepareCreate).then(authorize).then(create).then(clear).then(revise(1,0)).expect(s.active and not(s.funding))
  run restrictionRaceTest = init.then(install).then(prepareCreate).then(authorize).then(create).then(clear).then(restrict).expect(not(s.active) and s.enforcement == 1)
  run restrictionBeforeCreationRefusesTest=init.then(install).then(prepareCreate).then(authorize).then(restrict)
    .expect(s.revision==0 and s.history==List()).then(create.fail())
}
