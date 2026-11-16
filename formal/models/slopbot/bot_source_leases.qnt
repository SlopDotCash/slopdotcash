// @source migrations/0053_slopbot_value_source_leases.sql
// @source workers/slopbot/value-source-leases.ts
// @source workers/slopbot/value-group-collection.ts
// Two consumers and two overlapping source groups. A group is acquired wholly
// or not at all; expiry of the processing lease also invalidates source use.
module bot_source_leases {
  var s: { now: int, aUntil: int, bUntil: int, a: Set[int], b: Set[int],
    aProcessing: bool, bProcessing: bool, aPublished: bool, bPublished: bool }
  action init = s' = { now: 0, aUntil: 0, bUntil: 0, a: Set(), b: Set(),
    aProcessing: false, bProcessing: false, aPublished: false, bPublished: false }
  val aLive = s.aProcessing and s.aUntil > s.now
  val bLive = s.bProcessing and s.bUntil > s.now
  action startA = all { not(aLive), s.now < 3, s' = s.with("aProcessing", true).with("aUntil", s.now + 1).with("a", Set()) }
  action startB = all { not(bLive), s.now < 3, s' = s.with("bProcessing", true).with("bUntil", s.now + 1).with("b", Set()) }
  action claimA(group) = all {
    aLive, group.size() > 0, (not(bLive) or group.intersect(s.b).size() == 0),
    s' = s.with("a", group).with("b", if (bLive) s.b else s.b.exclude(group)),
  }
  action claimB(group) = all {
    bLive, group.size() > 0, (not(aLive) or group.intersect(s.a).size() == 0),
    s' = s.with("b", group).with("a", if (aLive) s.a else s.a.exclude(group)),
  }
  action publishA = all { aLive, s.a.size() > 0, s' = s.with("aPublished", true).with("aProcessing", false) }
  action publishB = all { bLive, s.b.size() > 0, s' = s.with("bPublished", true).with("bProcessing", false) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action step = {
    nondet group = Set(Set(1), Set(2), Set(1, 2)).oneOf()
    any { startA, startB, claimA(group), claimB(group), publishA, publishB, tick }
  }
  val invariant = (aLive and bLive) implies s.a.intersect(s.b).size() == 0
  run overlapBlocksSecondOwnerTest = init.then(startA).then(startB).then(claimA(Set(1, 2)))
    .expect(s.b.size() == 0 and invariant)
  run separateSourcesMayProceedTest = init.then(startA).then(startB).then(claimA(Set(1))).then(claimB(Set(2)))
    .then(publishA).then(publishB).expect(s.aPublished and s.bPublished)
  run expiredGroupCanBeReclaimedTest = init.then(startA).then(claimA(Set(1, 2))).then(tick)
    .then(startB).then(claimB(Set(1, 2))).expect(s.a.size() == 0 and bLive)
}
