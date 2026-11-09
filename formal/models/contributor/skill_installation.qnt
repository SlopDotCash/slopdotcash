// @source src/lib/install-command.ts
// @source src/lib/project-skill.mjs
// @source src/lib/project-skill-publication.mjs
// Two template identities and two approved D1 revisions. Template ancestry is
// intentionally irrelevant; registry downgrade needs explicit rollback.
module skill_installation {
  var s: { phase: str, locked: bool, template: int, revision: int,
    currentTemplate: int, currentRevision: int, priorTemplate: int, priorRevision: int,
    retained: Set[int], verified: bool, permitted: bool, rollback: bool }
  pure def key(template, revision) = template * 10 + revision
  action init = s' = { phase: "idle", locked: false, template: 0, revision: 0,
    currentTemplate: 0, currentRevision: 0, priorTemplate: 0, priorRevision: 0,
    retained: Set(), verified: false, permitted: true, rollback: false }
  action begin(template, revision, rollback) = all {
    s.phase == "idle", template.in(Set(1, 2)), revision.in(Set(1, 2)),
    if (rollback) key(template, revision).in(s.retained) else revision >= s.currentRevision,
    s' = s.with("phase", "fetching").with("locked", true)
      .with("template", template).with("revision", revision).with("rollback", rollback)
      .with("priorTemplate", s.currentTemplate).with("priorRevision", s.currentRevision)
      .with("verified", false),
  }
  action verifyBytes = all { s.phase == "fetching", s.permitted,
    s' = s.with("phase", "verified").with("verified", true) }
  action retain = all { s.phase == "verified", s.verified,
    s' = s.with("phase", "retained").with("retained", s.retained.union(Set(key(s.template, s.revision)))) }
  action activate = all { s.phase == "retained", s.verified, s.locked,
    s' = s.with("phase", "idle").with("locked", false)
      .with("currentTemplate", s.template).with("currentRevision", s.revision) }
  action failure = all { s.phase != "idle",
    s' = s.with("phase", "idle").with("locked", false) }
  action permission(allowed) = all { s.phase == "idle", s' = s.with("permitted", allowed) }
  action step = {
    nondet template = Set(1, 2).oneOf()
    nondet revision = Set(1, 2).oneOf()
    nondet rollback = Set(false, true).oneOf()
    nondet allowed = Set(false, true).oneOf()
    any { begin(template, revision, rollback), verifyBytes, retain, activate, failure, permission(allowed) }
  }
  val invariant = all {
    s.phase != "idle" implies s.locked,
    s.currentRevision != 0 implies key(s.currentTemplate, s.currentRevision).in(s.retained),
    s.phase != "idle" implies all { s.currentRevision == s.priorRevision, s.currentTemplate == s.priorTemplate },
    s.phase == "retained" implies s.verified,
  }
  run olderTemplateNewerPolicyTest = init.then(begin(2, 1, false)).then(verifyBytes).then(retain).then(activate)
    .then(begin(1, 2, false)).then(verifyBytes).then(retain).then(activate)
    .expect(s.currentTemplate == 1 and s.currentRevision == 2)
  run explicitRollbackTest = init.then(begin(1, 1, false)).then(verifyBytes).then(retain).then(activate)
    .then(begin(2, 2, false)).then(verifyBytes).then(retain).then(activate)
    .then(begin(1, 1, true)).then(verifyBytes).then(retain).then(activate)
    .expect(s.currentRevision == 1)
  run interruptedActivationTest = init.then(begin(1, 1, false)).then(verifyBytes).then(retain).then(activate)
    .then(begin(2, 2, false)).then(verifyBytes).then(retain).then(failure)
    .expect(s.currentRevision == 1 and key(2, 2).in(s.retained))
}
