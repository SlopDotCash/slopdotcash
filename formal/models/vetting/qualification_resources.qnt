// @source scripts/qualify-vetting-controls.ts
// Hosted qualification resources are disposable but not adoptable by name.
// One resource abstracts each resource type; a lost create response remains
// unresolved unless exact ownership can be established. No production resource.
module qualification_resources {
  var s: { phase: str, authorized: bool, absent: bool, uncertain: bool,
    owned: bool, sameIdentity: bool, deployed: bool, privateBindings: bool,
    assertions: bool, deleted: bool, success: bool }
  action init = s' = { phase:"plan", authorized:false, absent:false, uncertain:false,
    owned:false, sameIdentity:true, deployed:false, privateBindings:false,
    assertions:false, deleted:false, success:false }
  action authorize(exact) = all { s.phase=="plan", exact,
    s'=s.with("phase","prepare").with("authorized",true) }
  action checkAbsent = all { s.phase=="prepare", s'=s.with("absent",true) }
  action create = all { s.phase=="prepare", s.absent,
    s'=s.with("phase","creating").with("uncertain",true) }
  action acknowledged = all { s.phase=="creating",
    s'=s.with("phase","created").with("owned",true).with("uncertain",false) }
  action resolveExact = all { s.uncertain, s.sameIdentity,
    s'=s.with("phase","created").with("owned",true).with("uncertain",false) }
  action deploy = all { s.phase=="created", s.owned,
    s'=s.with("phase","deployed").with("deployed",true) }
  action inspectBindings(exact) = all { s.phase=="deployed", exact,
    s'=s.with("phase","verified").with("privateBindings",true) }
  action fixtures = all { s.phase=="verified", s.privateBindings,
    s'=s.with("phase","cleanup").with("assertions",true) }
  action identityChanged = all { s.owned, not(s.deleted),
    s'=s.with("sameIdentity",false) }
  action cleanup = all { s.owned, s.sameIdentity, not(s.uncertain),
    s'=s.with("phase","cleaned").with("deleted",true) }
  action complete = all { s.phase=="cleaned", s.assertions, not(s.uncertain),
    s'=s.with("phase","passed").with("success",true) }
  action step = { nondet a=Set(false,true).oneOf()
    any { authorize(a), checkAbsent, create, acknowledged, resolveExact, deploy,
      inspectBindings(a), fixtures, identityChanged, cleanup, complete, s'=s } }
  val invariant = all {
    s.owned implies (s.authorized and s.absent),
    s.deleted implies (s.owned and not(s.uncertain)),
    s.assertions implies s.privateBindings,
    s.success implies (s.assertions and s.deleted and not(s.uncertain)),
  }
  run unknownCreationCannotDeleteTest = init.then(authorize(true)).then(checkAbsent).then(create).then(cleanup.fail())
  run changedOwnerCannotDeleteTest = init.then(authorize(true)).then(checkAbsent).then(create)
    .then(acknowledged).then(identityChanged).then(cleanup.fail())
  run privateVerificationPrecedesCommandsTest = init.then(authorize(true)).then(checkAbsent).then(create)
    .then(acknowledged).then(deploy).then(fixtures.fail())
  run ownedFixtureLifecycleTest = init.then(authorize(true)).then(checkAbsent).then(create)
    .then(resolveExact).then(deploy).then(inspectBindings(true)).then(fixtures).then(cleanup)
    .then(complete).expect(s.success and invariant)
}
