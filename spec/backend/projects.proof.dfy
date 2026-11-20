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

// Appending distinct new repositories, each with one start, keeps exactly one start per repository.
lemma AppendedStarts(repos: seq<int>, starts: seq<RepositoryStart>, added: seq<int>, m: int)
  requires m >= 0
  requires forall start :: start in starts ==> start.month >= 0 && start.repositoryId in repos
  requires forall id :: id in repos ==> |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts)| == 1
  requires forall i, j :: 0 <= i < j < |added| ==> added[i] != added[j]
  requires forall r :: r in added ==> r !in repos
  ensures forall start :: start in starts + seq(|added|, i requires 0 <= i < |added| => RepositoryStart(added[i], m)) ==> start.month >= 0 && start.repositoryId in repos + added
  ensures forall id :: id in repos + added ==> |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts + seq(|added|, i requires 0 <= i < |added| => RepositoryStart(added[i], m)))| == 1
  decreases |added|
{
  var news := seq(|added|, i requires 0 <= i < |added| => RepositoryStart(added[i], m));
  if |added| > 0 {
    var front := added[..|added| - 1];
    var x := added[|added| - 1];
    var frontNews := seq(|front|, i requires 0 <= i < |front| => RepositoryStart(front[i], m));
    AppendedStarts(repos, starts, front, m);
    assert news == frontNews + [RepositoryStart(x, m)];
    assert starts + news == (starts + frontNews) + [RepositoryStart(x, m)];
    assert added == front + [x];
    assert repos + added == (repos + front) + [x];
    assert x !in repos + front;
    forall id | id in repos + added
      ensures |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts + news)| == 1
    {
      ProofLib.FilterAppend((start: RepositoryStart) => (start.repositoryId == id), starts + frontNews, RepositoryStart(x, m));
      if id == x {
        ProofLib.FilterNone((start: RepositoryStart) => (start.repositoryId == id), starts + frontNews);
      }
    }
  } else {
    assert news == [];
    assert starts + news == starts;
    assert repos + added == repos;
  }
}

lemma publishOwnerRevision_ensures(p: Project, by_: int, change: OwnerChange)
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysHistoryNumbered(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysCurrentRevisionIsState(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysPublishedApplicationCreated(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysCreatedFacts(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysActiveRequirements(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysEconomicTermsPrecedeNothing(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysClockStarted(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysRepositoryBound(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysRepositoryStarts(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysOrdinaryVaultFunds(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysRestrictedParticipationPaused(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysRetirementConsistent(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepHistoryRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRevisionAdvancesByOne(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepCreatorFixed(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepCancellationFinal(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepCancellationAppendsNothing(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepEconomicTermsRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepFundedAssetFixed(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRepositoryStartsRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRepositoriesRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepConsentChangesOnlyByOwnerRevision(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepOwnerRemovalPermanent(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRemovalReplayAppendsNothing(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRemovalAlwaysRetires(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepVaultRecordsRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepNoRegistryEventUnretires(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepEveryManifestChangeAppendsRevision(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepClockMonotone(p, publishOwnerRevision(p, by_, change)))
{
  if inv(p) && canPublishOwnerRevision(p, by_, change) {
    StartsMeaning(p);
    var appends := change.appends;
    var added := seq(|appends|, i requires 0 <= i < |appends| => appends[i].facts.repository);
    var after := publishOwnerRevision(p, by_, change);
    assert after.repositories == p.repositories + added;
    assert after.starts == p.starts + seq(|added|, i requires 0 <= i < |added| => RepositoryStart(added[i], p.month + 1));
    forall i, j | 0 <= i < j < |added|
      ensures added[i] != added[j]
    {
      if added[i] == added[j] {
        var a := appends[i];
        assert a in appends;
        ProofLib.FilterTwo((b: NewRepository) => (b.facts.repository == a.facts.repository), appends, i, j);
      }
    }
    forall r | r in added
      ensures r !in p.repositories
    {
      var k :| 0 <= k < |added| && added[k] == r;
      assert appends[k] in appends;
    }
    AppendedStarts(p.repositories, p.starts, added, p.month + 1);
    StartsMeaning(after);
  }
}

lemma publishUpdate_ensures(p: Project, by_: int, change: OwnerChange)
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysHistoryNumbered(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysCurrentRevisionIsState(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysPublishedApplicationCreated(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysCreatedFacts(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysActiveRequirements(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysEconomicTermsPrecedeNothing(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysClockStarted(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysRepositoryBound(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysRepositoryStarts(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysOrdinaryVaultFunds(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysRestrictedParticipationPaused(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysRetirementConsistent(publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepHistoryRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRevisionAdvancesByOne(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepCreatorFixed(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepCancellationFinal(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepCancellationAppendsNothing(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepEconomicTermsRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepFundedAssetFixed(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRepositoryStartsRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRepositoriesRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepConsentChangesOnlyByOwnerRevision(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepOwnerRemovalPermanent(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRemovalReplayAppendsNothing(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRemovalAlwaysRetires(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepVaultRecordsRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepNoRegistryEventUnretires(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepEveryManifestChangeAppendsRevision(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepClockMonotone(p, publishUpdate(p, by_, change)))
{
  if inv(p) && canPublishUpdate(p, by_, change) {
    StartsMeaning(p);
    var appends := change.appends;
    var added := seq(|appends|, i requires 0 <= i < |appends| => appends[i].facts.repository);
    var after := publishUpdate(p, by_, change);
    assert after.repositories == p.repositories + added;
    assert after.starts == p.starts + seq(|added|, i requires 0 <= i < |added| => RepositoryStart(added[i], p.month + 1));
    forall i, j | 0 <= i < j < |added|
      ensures added[i] != added[j]
    {
      if added[i] == added[j] {
        var a := appends[i];
        assert a in appends;
        ProofLib.FilterTwo((b: NewRepository) => (b.facts.repository == a.facts.repository), appends, i, j);
      }
    }
    forall r | r in added
      ensures r !in p.repositories
    {
      var k :| 0 <= k < |added| && added[k] == r;
      assert appends[k] in appends;
    }
    AppendedStarts(p.repositories, p.starts, added, p.month + 1);
    StartsMeaning(after);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var p := initialHolds();
  ProofLib.FilterOne((start: RepositoryStart) => (start.repositoryId == 1), p.starts, 0);
  StartsMeaning(p);
}
