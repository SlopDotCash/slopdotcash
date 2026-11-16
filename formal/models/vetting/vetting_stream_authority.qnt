// @source backend/vetting/evidence.ts
// @source backend/points/handler.ts
// @source functions/api/v1/[[path]].ts
// Two-part native stream. Consumption and each delivered part use the current
// session/actor. R2 I/O may complete after revocation; buffered bytes then fail
// closed. A delivered part is historical and cannot be undone by later signout.
module vetting_stream_authority {
  var s: { phase: str, session: bool, actor: int, grant: bool, consumed: bool,
    evidenceLive: bool, next: int, delivered: Set[int], allDeliveriesAuthorized: bool }
  action init = s' = {phase: "idle", session: true, actor: 1, grant: false, consumed: false,
    evidenceLive: true, next: 1, delivered: Set(), allDeliveriesAuthorized: true}
  action issueGrant = all { s.phase == "idle", s.session, s.actor == 1, s.evidenceLive,
    s' = s.with("grant", true).with("phase", "granted") }
  action consume = all { s.phase == "granted", s.grant, not(s.consumed), s.session, s.actor == 1,
    s' = s.with("consumed", true).with("phase", "ready") }
  val authorized = s.session and s.actor == 1 and s.evidenceLive
  action beginRead = all { s.phase == "ready", s.next <= 2, authorized,
    s' = s.with("phase", "reading") }
  action completeIO = all { s.phase == "reading", s' = s.with("phase", "buffered") }
  action enqueue = all { s.phase == "buffered", authorized,
    s' = s.with("delivered", s.delivered.union(Set(s.next))).with("next", s.next + 1)
      .with("phase", "ready").with("allDeliveriesAuthorized", s.allDeliveriesAuthorized and authorized) }
  action refuse = all { Set("ready", "reading", "buffered").contains(s.phase), not(authorized),
    s' = s.with("phase", "failed") }
  action finish = all { s.phase == "ready", s.next == 3, authorized, s' = s.with("phase", "finished") }
  action revoke = s' = s.with("session", false)
  action otherActor = s' = s.with("actor", 2)
  action expireEvidence = s' = s.with("evidenceLive", false)
  action step = any { issueGrant, consume, beginRead, completeIO, enqueue, refuse,
    finish, revoke, otherActor, expireEvidence, s' = s }
  val invariant = all { s.allDeliveriesAuthorized, s.delivered.size() <= 2,
    s.delivered.size() > 0 implies s.consumed,
    s.phase == "finished" implies s.delivered == Set(1, 2),
    s.phase == "failed" implies s.consumed }
  run revokeDuringIOKeepsBytesPrivateTest = init.then(issueGrant).then(consume).then(beginRead)
    .then(revoke).then(completeIO).then(refuse).expect(s.delivered.size() == 0 and s.consumed)
  run expiryDuringIOKeepsBytesPrivateTest = init.then(issueGrant).then(consume).then(beginRead)
    .then(expireEvidence).then(completeIO).then(refuse).expect(s.delivered.size() == 0 and s.consumed)
  run changedActorCannotReceiveOriginalGrantTest = init.then(issueGrant).then(consume).then(beginRead)
    .then(otherActor).then(completeIO).then(refuse).expect(s.delivered.size() == 0)
  run signoutBetweenPartsStopsNextPartTest = init.then(issueGrant).then(consume).then(beginRead)
    .then(completeIO).then(enqueue).then(revoke).then(refuse).expect(s.delivered == Set(1))
  run laterSignoutDoesNotRewriteAuditTest = init.then(issueGrant).then(consume).then(beginRead)
    .then(completeIO).then(enqueue).then(beginRead).then(completeIO).then(enqueue).then(finish)
    .then(revoke).expect(s.phase == "finished" and s.delivered == Set(1, 2) and invariant)
}
