lemma settleRestrictionRevision_ensures(c: Registry, by_: int)
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysRevisionMirrored(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysChildFactsHold(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysAdministratorsAgree(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysRepositoriesAgree(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysRestrictionRetiresRegistry(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysRestrictionRetirementHasRestriction(settleRestrictionRevision(c, by_)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_) ==> alwaysRestrictedProjectRegistered(settleRestrictionRevision(c, by_)))
{
  if inv(c) && canSettleRestrictionRevision(c, by_) {
    assert !c.security.restriction.Clear? && !c.security.restriction.FlagQuarantine?;
    assert c.project.revision > 0;
    if backend__projects_canRetireForRestriction(c.project) {
      var p := backend__projects_retireForRestriction(c.project);
      assert p.revision == c.project.revision + 1 && p.steward == c.project.steward && p.creator == c.project.creator;
      assert p.tier.Retired? && p.status.Paused? && p.retirement.RestrictionRetired?;
    } else {
      assert !c.project.retirement.NotRetired?;
      assert c.project.tier.Retired? && c.project.status.Paused?;
    }
  }
}

lemma reinstate_ensures(c: Registry, by_: int, pins: seq<security__enforcement_PinRead>)
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysRevisionMirrored(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysChildFactsHold(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysAdministratorsAgree(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysRepositoriesAgree(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysRestrictionRetiresRegistry(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysRestrictionRetirementHasRestriction(reinstate(c, by_, pins)))
  ensures (inv(c) ==> canReinstate(c, by_, pins) ==> alwaysRestrictedProjectRegistered(reinstate(c, by_, pins)))
{
  if inv(c) && canReinstate(c, by_, pins) {
    var e1 := security__enforcement_reinstate(c.security, by_, pins);
    assert e1.revision == c.security.revision && e1.steward == c.security.steward && e1.creator == c.security.creator;
    assert e1.restriction.Clear? && !e1.revisionPending && |e1.restrictedBy| == 0;
    if backend__projects_canRestoreCommunity(c.project) {
      var p := backend__projects_restoreCommunity(c.project);
      assert p.revision == c.project.revision + 1 && p.steward == c.project.steward && p.creator == c.project.creator;
      assert p.retirement.NotRetired? && p.tier.Community? && p.status.Paused?;
    } else {
      assert !c.project.retirement.RestrictionRetired?;
    }
  }
}
