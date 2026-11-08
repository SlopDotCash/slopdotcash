// @source backend/vetting/flagger-standing.ts
// @source backend/vetting/flags.ts
// Two members; current account age, accepted work and non-maintainer standing
// are necessary. A later participation ban is checked again at the write.
module vetting_flag_admission {
  var s: { standing: Set[int], banned: Set[int], active: Set[int], paused: bool, old: Set[int] }
  action init = s' = {standing: Set(), banned: Set(), active: Set(), paused: false, old: Set()}
  action verifyStanding(actor: int): bool = s' = s.with("standing", s.standing.union(Set(actor)))
  action ban(actor: int): bool = s' = s.with("banned", s.banned.union(Set(actor)))
  action fileFlag(actor: int): bool = all { actor.in(s.standing), not(actor.in(s.banned)), not(actor.in(s.active)),
    s' = s.with("active", s.active.union(Set(actor)))
      .with("paused", s.paused or s.active.union(Set(actor)).size() == 2) }
  action expire(actor: int): bool = all { actor.in(s.active),
    s' = s.with("active", s.active.exclude(Set(actor))).with("old", s.old.union(Set(actor))) }
  action step = { nondet actor = Set(1, 2).oneOf()
    any { verifyStanding(actor), ban(actor), fileFlag(actor), expire(actor), s' = s } }
  val invariant = s.active.subseteq(s.standing)
  run banBetweenCheckAndWriteTest = init.then(verifyStanding(1)).then(ban(1)).expect(s.active.size() == 0)
  run twoMembersPauseThenExpireTest = init.then(verifyStanding(1)).then(verifyStanding(2))
    .then(fileFlag(1)).then(fileFlag(2)).then(expire(1)).expect(s.paused and s.active == Set(2))
}
