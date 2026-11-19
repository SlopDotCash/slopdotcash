// Each retained repository has exactly one contribution-start record.
lemma StartsMeaning(p: Project)
  ensures alwaysRepositoryStarts(p) ==
    ((forall start :: start in p.starts ==> start.month >= 0 && start.repositoryId in p.repositories) &&
      (forall id :: id in p.repositories ==> |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), p.starts)| == 1))
{
}

// Revision 1 records one start, for the single primary repository of an unregistered project.
lemma CreatedStarts(p: Project, after: Project)
  requires |p.repositories| == 1 && p.month >= 0
  requires after.repositories == p.repositories && after.starts == [RepositoryStart(primary(p), p.month)]
  ensures alwaysRepositoryStarts(after)
{
  forall id | id in after.repositories
    ensures |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), after.starts)| == 1
  {
    assert id == p.repositories[0];
    ProofLib.FilterOne((start: RepositoryStart) => (start.repositoryId == id), after.starts, 0);
  }
  StartsMeaning(after);
}

lemma create_ensures(p: Project, by_: int, creation: Creation)
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysHistoryNumbered(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysCurrentRevisionIsState(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysPublishedApplicationCreated(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysCreatedFacts(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysActiveRequirements(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysEconomicTermsPrecedeNothing(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysClockStarted(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysRepositoryBound(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysRepositoryStarts(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysOrdinaryVaultFunds(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysRestrictedParticipationPaused(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysRetirementConsistent(create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepHistoryRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRevisionAdvancesByOne(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepCreatorFixed(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepCancellationFinal(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepCancellationAppendsNothing(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepEconomicTermsRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepFundedAssetFixed(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRepositoryStartsRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRepositoriesRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepConsentChangesOnlyByOwnerRevision(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepOwnerRemovalPermanent(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRemovalReplayAppendsNothing(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRemovalAlwaysRetires(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepVaultRecordsRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepNoRegistryEventUnretires(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepEveryManifestChangeAppendsRevision(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepClockMonotone(p, create(p, by_, creation)))
{
  if inv(p) && canCreate(p, by_, creation) {
    CreatedStarts(p, create(p, by_, creation));
  }
}

lemma publishApplication_ensures(p: Project, by_: int, creation: Creation)
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysHistoryNumbered(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysCurrentRevisionIsState(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysPublishedApplicationCreated(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysCreatedFacts(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysActiveRequirements(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysEconomicTermsPrecedeNothing(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysClockStarted(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysRepositoryBound(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysRepositoryStarts(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysOrdinaryVaultFunds(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysRestrictedParticipationPaused(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysRetirementConsistent(publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepHistoryRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRevisionAdvancesByOne(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepCreatorFixed(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepCancellationFinal(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepCancellationAppendsNothing(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepEconomicTermsRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepFundedAssetFixed(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRepositoryStartsRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRepositoriesRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepConsentChangesOnlyByOwnerRevision(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepOwnerRemovalPermanent(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRemovalReplayAppendsNothing(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRemovalAlwaysRetires(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepVaultRecordsRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepNoRegistryEventUnretires(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepEveryManifestChangeAppendsRevision(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepClockMonotone(p, publishApplication(p, by_, creation)))
{
  if inv(p) && canPublishApplication(p, by_, creation) {
    CreatedStarts(p, publishApplication(p, by_, creation));
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var p := initialHolds();
  ProofLib.FilterOne((start: RepositoryStart) => (start.repositoryId == 1), p.starts, 0);
  StartsMeaning(p);
}
