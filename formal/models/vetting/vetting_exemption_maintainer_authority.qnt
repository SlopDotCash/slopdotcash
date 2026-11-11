// @source backend/vetting/handler.ts
// @source backend/projects/setup.ts
// @source backend/projects/cloudflare-persistence.ts
// @evidence scripts/vetting-exemptions.test.ts
// PRD section 8, owner decision 11 November 2026. Platform approval and
// current registered-maintainer authority are independent. Slopbot reads
// permanent actor/repository identities; this finite abstraction models the
// resulting authority facts, not that external protocol or ongoing access.
// Revision, enforcement and malicious-result races remain guarded at write.
module vetting_exemption_maintainer_authority {
  var s: { configured: bool, admin: bool, approverWrite: bool,
    creator: str, steward: str, stewardIndividual: bool, installation: str,
    identity: str, checked: bool, verified: bool, current: bool,
    restricted: bool, malicious: bool, result: str, granted: bool, grantedBy: int }
  action init = s' = { configured: false, admin: false, approverWrite: false,
    creator: "missing", steward: "missing", stewardIndividual: false,
    installation: "missing", identity: "missing", checked: false,
    verified: false, current: true, restricted: false, malicious: false,
    result: "none", granted: false, grantedBy: 0 }
  action configure(admin: bool, approverWrite: bool, creator: str, steward: str,
    individual: bool, installation: str, identity: str): bool = all {
    not(s.configured),
    s' = s.with("configured", true).with("admin", admin)
      .with("approverWrite", approverWrite).with("creator", creator)
      .with("steward", steward).with("stewardIndividual", individual)
      .with("installation", installation).with("identity", identity) }
  val registeredWriter = s.creator == "write" or
    (s.stewardIndividual and s.steward == "write")
  val uncertain = s.creator == "unavailable" or
    (s.stewardIndividual and s.steward == "unavailable")
  action check = all { s.configured, not(s.checked),
    s' = s.with("checked", true).with("verified", s.admin and registeredWriter
        and s.installation == "installed" and s.identity == "match")
      .with("result", if (not(s.admin)) "forbidden"
        else if (s.installation == "unavailable") "retry"
        else if (s.installation != "installed") "forbidden"
        else if (s.identity == "missing") "retry"
        else if (s.identity != "match") "identity-mismatch"
        else if (registeredWriter) "ready"
        else if (uncertain) "retry" else "forbidden") }
  action revisionRace = all { s.checked, not(s.granted), s' = s.with("current", false) }
  action restrictionRace = all { s.checked, not(s.granted), s' = s.with("restricted", true) }
  action maliciousRace = all { s.checked, not(s.granted), s' = s.with("malicious", true) }
  action grant = all { s.checked, s.admin, s.verified, s.result == "ready",
    s.current, not(s.restricted), not(s.malicious), not(s.granted),
    // 1 is the actual platform approver; the independently checked maintainer
    // is not substituted into the audit actor.
    s' = s.with("granted", true).with("grantedBy", 1) }
  // Configuration is fixed for the bounded request. Avoid enumerating its
  // unchanged input product again for every later race/write transition.
  action chooseConfiguration = if (s.configured) s' = s else {
    nondet admin = Set(false, true).oneOf()
    nondet approverWrite = Set(false, true).oneOf()
    nondet creator = Set("missing", "denied", "write", "unavailable").oneOf()
    nondet steward = Set("missing", "denied", "write", "unavailable").oneOf()
    nondet individual = Set(false, true).oneOf()
    nondet installation = Set("installed", "missing", "suspended", "unavailable").oneOf()
    nondet identity = Set("match", "mismatch", "missing").oneOf()
    configure(admin, approverWrite, creator, steward, individual, installation, identity)
  }
  action step = any { chooseConfiguration, check, revisionRace, restrictionRace,
    maliciousRace, grant, s' = s }
  val invariant = s.granted implies all { s.admin, s.verified, registeredWriter,
    s.installation == "installed", s.identity == "match", s.current,
    not(s.restricted), not(s.malicious), s.grantedBy == 1 }
  run readOnlyAdminCreatorWriteTest = init
    .then(configure(true, false, "write", "missing", false, "installed", "match"))
    .then(check).then(grant).expect(s.granted and s.grantedBy == 1)
  run individualStewardFallbackTest = init
    .then(configure(true, false, "denied", "write", true, "installed", "match"))
    .then(check).then(grant).expect(s.granted)
  run administratorWriteCannotReplaceMaintainerTest = init
    .then(configure(true, true, "denied", "write", false, "installed", "match"))
    .then(check).expect(not(s.granted)).then(grant.fail())
  run unavailableMaintainerRefusesTest = init
    .then(configure(true, true, "unavailable", "missing", false, "installed", "match"))
    .then(check).expect(s.result == "retry").then(grant.fail())
  run missingInstallationRefusesTest = init
    .then(configure(true, true, "write", "missing", false, "missing", "match"))
    .then(check).then(grant.fail())
  run repositoryIdentityDriftRefusesTest = init
    .then(configure(true, true, "write", "missing", false, "installed", "mismatch"))
    .then(check).then(grant.fail())
  run nonAdminMaintainerCannotApproveTest = init
    .then(configure(false, true, "write", "missing", false, "installed", "match"))
    .then(check).then(grant.fail())
  run revisionRaceRefusesTest = init
    .then(configure(true, false, "write", "missing", false, "installed", "match"))
    .then(check).then(revisionRace).then(grant.fail())
  run restrictionRaceRefusesTest = init
    .then(configure(true, false, "write", "missing", false, "installed", "match"))
    .then(check).then(restrictionRace).then(grant.fail())
  run maliciousRaceRefusesTest = init
    .then(configure(true, false, "write", "missing", false, "installed", "match"))
    .then(check).then(maliciousRace).then(grant.fail())
}
