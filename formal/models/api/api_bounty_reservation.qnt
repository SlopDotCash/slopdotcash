// @source backend/security/handler.ts
// @source backend/security/program-funds.ts
// @source backend/security/award-asset.ts
module api_bounty_reservation {
  var s: {free: int, reserved: Set[int], related: Set[int], reviewed: Set[int], banned: bool, restricted: bool, pledged: bool}
  action init = s' = {free: 4, reserved: Set(), related: Set(), reviewed: Set(), banned: false, restricted: false, pledged: false}
  action related(caseId: int): bool = all { not(s.reserved.contains(caseId)), s' = s.with("related", s.related.union(Set(caseId))) }
  action review(caseId: int, independent: bool): bool = all { independent, s.related.contains(caseId),
    s' = s.with("reviewed", s.reviewed.union(Set(caseId))) }
  action reserve(caseId: int): bool = all { Set(1,2).contains(caseId), not(s.banned), not(s.restricted), not(s.pledged),
    s.free >= 3, not(s.reserved.contains(caseId)), not(s.related.contains(caseId)) or s.reviewed.contains(caseId),
    s' = s.with("free", s.free - 3).with("reserved", s.reserved.union(Set(caseId))) }
  action ban = s' = s.with("banned", true)
  action restrict = s' = s.with("restricted", true)
  action pledge = all { s.reserved == Set(), s' = s.with("pledged", true) }
  action step = any { related(1), review(1,true), review(1,false), reserve(1), reserve(2), ban, restrict, pledge, s' = s }
  val invariant = all { s.free >= 0, s.free + 3 * s.reserved.size() == 4,
    s.reserved.intersect(s.related).subseteq(s.reviewed) }
  run capTest = init.then(reserve(1)).expect(s.free == 1 and s.reserved == Set(1))
  run fundedAwardSurvivesBanTest = init.then(reserve(1)).then(ban).expect(s.reserved == Set(1))
  run relatedReviewTest = init.then(related(1)).then(review(1,true)).then(reserve(1)).expect(s.reserved == Set(1))
}
