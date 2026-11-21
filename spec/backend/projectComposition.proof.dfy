lemma settleRestrictionRevision_ensures(c: Registry, by_: int, policy: PolicyCheck)
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysRepositoriesAgree(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysRevisionMirrored(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysChildFactsHold(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysAdministratorsAgree(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysExclusionsValid(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysRestrictionRetiresRegistry(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysRestrictionRetirementHasRestriction(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> alwaysRestrictedProjectRegistered(settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> stepOnlyReinstatementUnretires(c, "settleRestrictionRevision", settleRestrictionRevision(c, by_, policy)))
  ensures (inv(c) ==> canSettleRestrictionRevision(c, by_, policy) ==> stepExclusionsProspective(c, settleRestrictionRevision(c, by_, policy)))
{
}

lemma reinstate_ensures(c: Registry, by_: int, fence: security__enforcement_Fence)
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysRepositoriesAgree(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysRevisionMirrored(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysChildFactsHold(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysAdministratorsAgree(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysExclusionsValid(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysRestrictionRetiresRegistry(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysRestrictionRetirementHasRestriction(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> alwaysRestrictedProjectRegistered(reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> stepOnlyReinstatementUnretires(c, "reinstate", reinstate(c, by_, fence)))
  ensures (inv(c) ==> canReinstate(c, by_, fence) ==> stepExclusionsProspective(c, reinstate(c, by_, fence)))
{
}
