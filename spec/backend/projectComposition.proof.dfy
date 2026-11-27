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

lemma publishOwnerRevision_ensures(c: Registry, by_: int, change: backend__projects_OwnerChange, account: AccountStanding, exclusions: seq<settlement__payoutExclusions_Exclusion>, appendReads: seq<RegistryRead>)
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysRepositoriesAgree(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysRevisionMirrored(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysChildFactsHold(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysAdministratorsAgree(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysExclusionsValid(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictionRetiresRegistry(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictionRetirementHasRestriction(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictedProjectRegistered(publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> stepOnlyReinstatementUnretires(c, "publishOwnerRevision", publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) ==> stepExclusionsProspective(c, publishOwnerRevision(c, by_, change, account, exclusions, appendReads)))
{
  if inv(c) && canPublishOwnerRevision(c, by_, change, account, exclusions, appendReads) {
    OwnerRevisionShape(c, by_, change, backend__projects_publishOwnerRevision(c.project, by_, change));
  }
}

lemma publishUpdate_ensures(c: Registry, by_: int, change: backend__projects_OwnerChange, account: AccountStanding, exclusions: seq<settlement__payoutExclusions_Exclusion>, appendReads: seq<RegistryRead>)
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysRepositoriesAgree(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysRevisionMirrored(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysChildFactsHold(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysAdministratorsAgree(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysExclusionsValid(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictionRetiresRegistry(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictionRetirementHasRestriction(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> alwaysRestrictedProjectRegistered(publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> stepOnlyReinstatementUnretires(c, "publishUpdate", publishUpdate(c, by_, change, account, exclusions, appendReads)))
  ensures (inv(c) ==> canPublishUpdate(c, by_, change, account, exclusions, appendReads) ==> stepExclusionsProspective(c, publishUpdate(c, by_, change, account, exclusions, appendReads)))
{
  if inv(c) && canPublishUpdate(c, by_, change, account, exclusions, appendReads) {
    OwnerRevisionShape(c, by_, change, backend__projects_publishUpdate(c.project, by_, change));
  }
}

lemma WithAppendsShape(change: backend__projects_OwnerChange, e: security__enforcement_Enforcement)
  ensures withAppends(change, e).repositories == e.repositories + seq(|change.appends|, i requires 0 <= i < |change.appends| => change.appends[i].facts.repository)
  ensures withAppends(change, e) == e.(repositories := withAppends(change, e).repositories, latest := withAppends(change, e).latest, identities := withAppends(change, e).identities)
  decreases |change.appends|
{
  if |change.appends| > 0 {
    var rest := change.(appends := change.appends[1..]);
    var e1 := security__enforcement_appendRepository(e, change.appends[0].facts.repository);
    WithAppendsShape(rest, e1);
    assert withAppends(change, e) == withAppends(rest, e1);
    assert [change.appends[0].facts.repository] + seq(|rest.appends|, i requires 0 <= i < |rest.appends| => rest.appends[i].facts.repository)
      == seq(|change.appends|, i requires 0 <= i < |change.appends| => change.appends[i].facts.repository);
  }
}

lemma WithExceptionAppendsShape(exception: backend__projects_Exception, e: security__enforcement_Enforcement)
  ensures withExceptionAppends(exception, e).repositories == e.repositories + seq(|exception.appended|, i requires 0 <= i < |exception.appended| => exception.appended[i].repositoryId)
  ensures withExceptionAppends(exception, e) == e.(repositories := withExceptionAppends(exception, e).repositories, latest := withExceptionAppends(exception, e).latest, identities := withExceptionAppends(exception, e).identities)
  decreases |exception.appended|
{
  if |exception.appended| > 0 {
    var rest := exception.(appended := exception.appended[1..]);
    var e1 := security__enforcement_appendRepository(e, exception.appended[0].repositoryId);
    WithExceptionAppendsShape(rest, e1);
    assert withExceptionAppends(exception, e) == withExceptionAppends(rest, e1);
    assert [exception.appended[0].repositoryId] + seq(|rest.appended|, i requires 0 <= i < |rest.appended| => rest.appended[i].repositoryId)
      == seq(|exception.appended|, i requires 0 <= i < |exception.appended| => exception.appended[i].repositoryId);
  }
}

lemma adminRevise_ensures(c: Registry, by_: int, exception: backend__projects_Exception, exclusions: seq<settlement__payoutExclusions_Exclusion>, appendReads: seq<RegistryRead>)
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysRepositoriesAgree(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysRevisionMirrored(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysChildFactsHold(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysAdministratorsAgree(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysExclusionsValid(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysRestrictionRetiresRegistry(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysRestrictionRetirementHasRestriction(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> alwaysRestrictedProjectRegistered(adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> stepOnlyReinstatementUnretires(c, "adminRevise", adminRevise(c, by_, exception, exclusions, appendReads)))
  ensures (inv(c) ==> canAdminRevise(c, by_, exception, exclusions, appendReads) ==> stepExclusionsProspective(c, adminRevise(c, by_, exception, exclusions, appendReads)))
{
  if inv(c) && canAdminRevise(c, by_, exception, exclusions, appendReads) {
    WithExceptionAppendsShape(exception, c.security);
    var w := withExceptionAppends(exception, c.security);
    var replaced := backend__projects_adminRevise(c.project, by_, exception);
    var restricted := !c.security.restriction.Clear? && !c.security.restriction.FlagQuarantine?;
    var p := if restricted && c.project.retirement.NotRetired? then replaced.(retirement := backend__projects_Retirement.RestrictionRetired) else replaced;
    assert p.repositories == c.project.repositories + seq(|exception.appended|, i requires 0 <= i < |exception.appended| => exception.appended[i].repositoryId);
    assert p.revision == c.project.revision + 1 && p.creator == c.project.creator && p.steward == exception.steward;
    assert p.administrators == c.project.administrators;
    var s := sync(p, w);
    assert s == w.(revision := p.revision, steward := p.steward, creator := p.creator);
    var after := adminRevise(c, by_, exception, exclusions, appendReads);
    assert after.security == security__enforcement_withRevisionLanded(restricted, s);
  }
}

lemma OwnerRevisionShape(c: Registry, by_: int, change: backend__projects_OwnerChange, p: backend__projects_Project)
  requires inv(c) && c.security.restriction.Clear? && backend__projects_changeValid(c.project, by_, change)
  requires p == backend__projects_changed(by_, change, c.project) || p == backend__projects_changed(by_, change, c.project).(update := backend__projects_UpdatePhase.UpdatePublished)
  ensures inv(c.(project := p, security := sync(p, withAppends(change, c.security))))
{
  WithAppendsShape(change, c.security);
  var w := withAppends(change, c.security);
  assert p.repositories == c.project.repositories + seq(|change.appends|, i requires 0 <= i < |change.appends| => change.appends[i].facts.repository);
  assert p.revision == c.project.revision + 1 && p.creator == c.project.creator && p.steward == c.project.steward;
  assert p.administrators == c.project.administrators;
  var s := sync(p, w);
  assert s == w.(revision := p.revision, steward := p.steward, creator := p.creator);
}
