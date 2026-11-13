// @source backend/vetting/flagger-standing.ts
// @source backend/vetting/flags.ts
// @evidence scripts/vetting-scan-flags.test.ts
// Two members; current account age, accepted work and non-maintainer standing
// are necessary. A later participation ban is checked again at the write.
// A second project revision invalidates the captured eligibility check. This
// source-authored refinement and its five scenarios have not been executed.
module vetting_flag_admission {
  var s: { standing: Set[int], banned: Set[int], active: Set[int], paused: bool, old: Set[int],
    revision:int,digest:int,observedRevision:int->int,observedDigest:int->int,owner:int }
  action init = s' = {standing: Set(), banned: Set(), active: Set(), paused: false, old: Set(),
    revision:1,digest:1,observedRevision:Map(1->0,2->0),observedDigest:Map(1->0,2->0),owner:0}
  action verifyStanding(actor: int): bool = all{actor!=s.owner,
    s'=s.with("standing",s.standing.union(Set(actor)))
      .with("observedRevision",s.observedRevision.set(actor,s.revision))
      .with("observedDigest",s.observedDigest.set(actor,s.digest))}
  action revise(owner:int):bool=all{s.revision==1,owner>=0,owner<=2,
    s'=s.with("revision",2).with("digest",2).with("owner",owner)}
  action ban(actor: int): bool = s' = s.with("banned", s.banned.union(Set(actor)))
  action fileFlag(actor: int): bool = all { actor.in(s.standing), not(actor.in(s.banned)), not(actor.in(s.active)),
    s.observedRevision.get(actor)==s.revision,s.observedDigest.get(actor)==s.digest,
    s' = s.with("active", s.active.union(Set(actor)))
      .with("paused", s.paused or s.active.union(Set(actor)).size() == 2) }
  action expire(actor: int): bool = all { actor.in(s.active),
    s' = s.with("active", s.active.exclude(Set(actor))).with("old", s.old.union(Set(actor))) }
  action step = { nondet actor = Set(1, 2).oneOf()
    any { verifyStanding(actor), ban(actor), revise(actor), fileFlag(actor), expire(actor), s' = s } }
  val invariant = s.active.subseteq(s.standing)
  run banBetweenCheckAndWriteTest = init.then(verifyStanding(1)).then(ban(1)).expect(s.active.size() == 0)
  run twoMembersPauseThenExpireTest = init.then(verifyStanding(1)).then(verifyStanding(2))
    .then(fileFlag(1)).then(fileFlag(2)).then(expire(1)).expect(s.paused and s.active == Set(2))
  run changedProjectCannotUseOldStandingTest=init.then(verifyStanding(1)).then(revise(1))
    .expect(s.active==Set()).then(fileFlag(1).fail())
  run changedOwnerCannotRefreshStandingTest=init.then(verifyStanding(1)).then(revise(1))
    .expect(s.active==Set()).then(verifyStanding(1).fail())
  run recheckedNonOwnerCanFileNewRevisionTest=init.then(verifyStanding(1)).then(revise(2))
    .then(verifyStanding(1)).then(fileFlag(1)).expect(s.active==Set(1))
}
