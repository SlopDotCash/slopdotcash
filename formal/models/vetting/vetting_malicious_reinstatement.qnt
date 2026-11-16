// @source migrations/0031_project_vetting_reinstatements.sql
// @source backend/vetting/persistence.ts
// An immutable moderator decision names exactly the findings it reviewed.
// A clean scan must be requested strictly after each named malicious result;
// later findings are not waived by an earlier decision.
module vetting_malicious_reinstatement {
  var s: { bad: Set[int], reviewed: Set[int], now: int, secondAt: int,
    requestedAt: int, clean: bool, revision: int, scannedRevision: int }
  action init = s' = {bad: Set(1), reviewed: Set(), now: 1, secondAt: -1,
    requestedAt: -1, clean: false, revision: 1, scannedRevision: 0}
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action requestFresh = s' = s.with("requestedAt", s.now).with("clean", false).with("scannedRevision", s.revision)
  action finishClean = all { s.requestedAt >= 0, s' = s.with("clean", true) }
  action newFinding = all { not(2.in(s.bad)), s' = s.with("bad", s.bad.union(Set(2))).with("secondAt", s.now) }
  action revise = all { s.revision == 1, s' = s.with("revision", 2) }
  action decide(named: Set[int], moderator: bool): bool = all { moderator, s.clean,
    s.revision == s.scannedRevision, named.subseteq(s.bad),
    (not(1.in(named)) or s.requestedAt > 0),
    (not(2.in(named)) or s.requestedAt > s.secondAt),
    s' = s.with("reviewed", s.reviewed.union(named)) }
  val cleared = s.bad.subseteq(s.reviewed)
  action step = { nondet named = Set(Set(1), Set(2), Set(1, 2)).oneOf()
    any { tick, requestFresh, finishClean, newFinding, revise, decide(named, true), decide(named, false), s' = s } }
  val invariant = s.reviewed.subseteq(s.bad)
  run newFindingNotWaivedTest = init.then(requestFresh).then(finishClean).then(decide(Set(1), true))
    .expect(cleared).then(newFinding).expect(not(cleared))
  run sameTimeScanCannotWaiveTest = init.then(newFinding).then(requestFresh).then(finishClean)
    .then(decide(Set(1, 2), true).fail())
  run currentRevisionRequiredTest = init.then(requestFresh).then(finishClean).then(revise)
    .then(decide(Set(1), true).fail())
}
