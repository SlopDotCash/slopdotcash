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
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> alwaysShareWithinLimits(create(p, by_, creation)))
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
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepShareHistoryOnlyAppends(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepOpenMonthShareKept(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRepositoryStartsRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRepositoriesRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepConsentChangesOnlyByOwnerOrAdministratorRevision(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepOwnerRemovalPermanent(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRemovalReplayAppendsNothing(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepRemovalAlwaysRetires(p, "create", create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepVaultRecordsRetained(p, create(p, by_, creation)))
  ensures (inv(p) ==> canCreate(p, by_, creation) ==> stepBranchMovesOnlyByVerifiedChange(p, "create", create(p, by_, creation)))
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
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> alwaysShareWithinLimits(publishApplication(p, by_, creation)))
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
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepShareHistoryOnlyAppends(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepOpenMonthShareKept(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRepositoryStartsRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRepositoriesRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepConsentChangesOnlyByOwnerOrAdministratorRevision(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepOwnerRemovalPermanent(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRemovalReplayAppendsNothing(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepRemovalAlwaysRetires(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepVaultRecordsRetained(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepBranchMovesOnlyByVerifiedChange(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepNoRegistryEventUnretires(p, "publishApplication", publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepEveryManifestChangeAppendsRevision(p, publishApplication(p, by_, creation)))
  ensures (inv(p) ==> canPublishApplication(p, by_, creation) ==> stepClockMonotone(p, publishApplication(p, by_, creation)))
{
  if inv(p) && canPublishApplication(p, by_, creation) {
    CreatedStarts(p, publishApplication(p, by_, creation));
  }
}

// Filtering a concatenation filters each part.
lemma FilterConcat<T>(f: T -> bool, xs: seq<T>, ys: seq<T>)
  ensures ProofLib.Filter(f, xs + ys) == ProofLib.Filter(f, xs) + ProofLib.Filter(f, ys)
  decreases |ys|
{
  if |ys| == 0 {
    assert xs + ys == xs;
    ProofLib.FilterNil(f, ys);
  } else {
    var init := ys[..|ys| - 1];
    var last := ys[|ys| - 1];
    assert ys == init + [last];
    assert xs + ys == (xs + init) + [last];
    FilterConcat(f, xs, init);
    ProofLib.FilterAppend(f, xs + init, last);
    ProofLib.FilterAppend(f, init, last);
  }
}

// A valid append names a repository the project does not hold and no other append names.
lemma AppendFresh(p: Project, by_: int, appends: seq<NewRepository>, i: int)
  requires appendsValid(p, by_, appends)
  requires 0 <= i < |appends|
  ensures !(appends[i].facts.repository in p.repositories)
  ensures forall j :: 0 <= j < |appends| && j != i ==> appends[j].facts.repository != appends[i].facts.repository
{
  var a := appends[i];
  assert a in appends;
  assert appendable(p, by_, a) && |ProofLib.Filter((b: NewRepository) => (b.facts.repository == a.facts.repository), appends)| == 1;
  forall j | 0 <= j < |appends| && j != i
    ensures appends[j].facts.repository != a.facts.repository
  {
    if appends[j].facts.repository == a.facts.repository {
      ProofLib.FilterTwo((b: NewRepository) => (b.facts.repository == a.facts.repository), appends, i, j);
    }
  }
}

// An owner save keeps one start per repository: each appended repository gets its one next-month start.
lemma AppendStartsUnique(repos: seq<int>, starts: seq<RepositoryStart>, added: seq<int>, news: seq<RepositoryStart>)
  requires forall start :: start in starts ==> start.month >= 0 && start.repositoryId in repos
  requires forall id :: id in repos ==> |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts)| == 1
  requires |added| == |news|
  requires forall k :: 0 <= k < |news| ==> news[k].month >= 0 && news[k].repositoryId == added[k]
  requires forall k :: 0 <= k < |added| ==> !(added[k] in repos)
  requires forall k, j :: 0 <= k < |added| && 0 <= j < |added| && j != k ==> added[j] != added[k]
  ensures forall start :: start in starts + news ==> start.month >= 0 && start.repositoryId in repos + added
  ensures forall id :: id in repos + added ==> |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts + news)| == 1
{
  forall start | start in starts + news
    ensures start.month >= 0 && start.repositoryId in repos + added
  {
    if start in starts {
    } else {
      var k :| 0 <= k < |news| && news[k] == start;
      assert added[k] in repos + added;
    }
  }
  forall id | id in repos + added
    ensures |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), starts + news)| == 1
  {
    var f := (start: RepositoryStart) => (start.repositoryId == id);
    FilterConcat(f, starts, news);
    if id in repos {
      assert forall k :: 0 <= k < |news| ==> !f(news[k]);
      ProofLib.FilterNone(f, news);
    } else {
      assert id in added;
      var k :| 0 <= k < |added| && added[k] == id;
      assert forall j :: 0 <= j < |starts| ==> starts[j] in starts && !f(starts[j]);
      ProofLib.FilterNone(f, starts);
      ProofLib.FilterOne(f, news, k);
    }
  }
}

lemma ChangedStarts(p: Project, by_: int, change: OwnerChange)
  requires alwaysRepositoryStarts(p) && p.month >= 0 && changeValid(p, by_, change)
  ensures alwaysRepositoryStarts(changed(by_, change, p))
{
  var after := changed(by_, change, p);
  var added := after.repositories[|p.repositories|..];
  var news := after.starts[|p.starts|..];
  assert after.repositories == p.repositories + added;
  assert after.starts == p.starts + news;
  assert |added| == |change.appends| && |news| == |added|;
  assert forall k :: 0 <= k < |added| ==> added[k] == change.appends[k].facts.repository;
  assert forall k :: 0 <= k < |news| ==> news[k] == RepositoryStart(added[k], p.month + 1);
  StartsMeaning(p);
  forall k | 0 <= k < |added|
    ensures !(added[k] in p.repositories)
    ensures forall j :: 0 <= j < |added| && j != k ==> added[j] != added[k]
  {
    AppendFresh(p, by_, change.appends, k);
  }
  AppendStartsUnique(p.repositories, p.starts, added, news);
  StartsMeaning(after);
}

lemma publishOwnerRevision_ensures(p: Project, by_: int, change: OwnerChange)
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysHistoryNumbered(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysCurrentRevisionIsState(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysPublishedApplicationCreated(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysCreatedFacts(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysActiveRequirements(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysEconomicTermsPrecedeNothing(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysClockStarted(publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> alwaysShareWithinLimits(publishOwnerRevision(p, by_, change)))
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
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepShareHistoryOnlyAppends(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepOpenMonthShareKept(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRepositoryStartsRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRepositoriesRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepConsentChangesOnlyByOwnerOrAdministratorRevision(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepOwnerRemovalPermanent(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRemovalReplayAppendsNothing(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepRemovalAlwaysRetires(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepVaultRecordsRetained(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepBranchMovesOnlyByVerifiedChange(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepNoRegistryEventUnretires(p, "publishOwnerRevision", publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepEveryManifestChangeAppendsRevision(p, publishOwnerRevision(p, by_, change)))
  ensures (inv(p) ==> canPublishOwnerRevision(p, by_, change) ==> stepClockMonotone(p, publishOwnerRevision(p, by_, change)))
{
  if inv(p) && canPublishOwnerRevision(p, by_, change) {
    ChangedStarts(p, by_, change);
    ProspectiveSharePreserves(p, change.reward.share);
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
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> alwaysShareWithinLimits(publishUpdate(p, by_, change)))
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
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepShareHistoryOnlyAppends(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepOpenMonthShareKept(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRepositoryStartsRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRepositoriesRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepConsentChangesOnlyByOwnerOrAdministratorRevision(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepOwnerRemovalPermanent(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRemovalReplayAppendsNothing(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepRemovalAlwaysRetires(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepVaultRecordsRetained(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepBranchMovesOnlyByVerifiedChange(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepNoRegistryEventUnretires(p, "publishUpdate", publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepEveryManifestChangeAppendsRevision(p, publishUpdate(p, by_, change)))
  ensures (inv(p) ==> canPublishUpdate(p, by_, change) ==> stepClockMonotone(p, publishUpdate(p, by_, change)))
{
  if inv(p) && canPublishUpdate(p, by_, change) {
    ChangedStarts(p, by_, change);
    ProspectiveSharePreserves(p, change.reward.share);
  }
}

lemma lawAppendedRepositoryPausesAndStartsNextMonth_ensures(p: Project, by_: int, change: OwnerChange, newRepository: NewRepository)
  ensures (lawAppendedRepositoryPausesAndStartsNextMonth(p, by_, change, newRepository) == true)
{
  if canPublishOwnerRevision(p, by_, change) && newRepository in change.appends {
    var after := publishOwnerRevision(p, by_, change);
    var k :| 0 <= k < |change.appends| && change.appends[k] == newRepository;
    var news := after.starts[|p.starts|..];
    assert after.starts == p.starts + news;
    assert news[k] == RepositoryStart(newRepository.facts.repository, p.month + 1);
    assert news[k] in after.starts;
  }
}

lemma lawConsentOnlySaveRecordsConsentChange_ensures(p: Project, by_: int, change: OwnerChange)
  ensures (lawConsentOnlySaveRecordsConsentChange(p, by_, change) == true)
{
  if canPublishOwnerRevision(p, by_, change) && consentOnly(change) {
    var after := publishOwnerRevision(p, by_, change);
    assert after.history == p.history + [Revision(p.revision + 1, RevisionKind.ConsentChanged, p.status, p.tier, by_)];
    assert currentRevision(after) == after.history[|p.history|];
  }
}

lemma lawRemovedNeverRestored_ensures(p: Project)
  ensures (lawRemovedNeverRestored(p) == true)
{
  if ownerRetired(p) {
    assert !restorable(p);
    assert withCommunityRestored(true, p) == p;
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var p := initialHolds();
  ProofLib.FilterOne((start: RepositoryStart) => (start.repositoryId == 1), p.starts, 0);
  StartsMeaning(p);
}

lemma ShareHistoryFoldResult(history: seq<ShareEntry>, acc: int)
  requires acc >= 0
  ensures var r := Std.Collections.Seq.FoldLeft((reached: int, e: ShareEntry) => (if ((reached >= 0) && (e.throughMonth > reached)) then e.throughMonth else -1), acc, history);
    r >= 0 ==> (r == acc || exists e :: e in history && r == e.throughMonth)
  decreases |history|
{
  if |history| > 0 {
    var f := (reached: int, e: ShareEntry) => (if ((reached >= 0) && (e.throughMonth > reached)) then e.throughMonth else -1);
    var next := f(acc, history[0]);
    if next >= 0 {
      ShareHistoryFoldResult(history[1..], next);
    } else {
      ShareHistoryFoldNeg(history[1..], next);
    }
  }
}

lemma ShareHistoryFoldNeg(history: seq<ShareEntry>, acc: int)
  requires acc < 0
  ensures Std.Collections.Seq.FoldLeft((reached: int, e: ShareEntry) => (if ((reached >= 0) && (e.throughMonth > reached)) then e.throughMonth else -1), acc, history) < 0
  decreases |history|
{
  if |history| > 0 {
    ShareHistoryFoldNeg(history[1..], -1);
  }
}

lemma MonthShareMeaning(history: seq<ShareEntry>, setting: int, period: int)
  ensures monthShareOf(history, setting, period) ==
    (if 0 < |ProofLib.Filter((e: ShareEntry) => (period <= e.throughMonth), history)| then ProofLib.Filter((e: ShareEntry) => (period <= e.throughMonth), history)[0] else ShareEntry(0, setting)).basisPoints
{
}

lemma ProspectiveSharePreserves(p: Project, share: int)
  requires alwaysClockStarted(p) && alwaysShareWithinLimits(p) && 0 <= share <= maxShareBasisPoints
  ensures shareHistoryValid(prospectiveShare(p, share))
  ensures monthShareOf(prospectiveShare(p, share), share, p.month) == monthShareOf(p.shareHistory, p.share, p.month)
{
  var q := (e: ShareEntry) => (p.month <= e.throughMonth);
  MonthShareMeaning(p.shareHistory, p.share, p.month);
  MonthShareMeaning(prospectiveShare(p, share), share, p.month);
  if share == p.share {
  } else if exists e :: e in p.shareHistory && e.throughMonth >= p.month {
    var e :| e in p.shareHistory && e.throughMonth >= p.month;
    ProofLib.FilterMember(q, p.shareHistory, e);
    assert |ProofLib.Filter(q, p.shareHistory)| > 0;
  } else {
    var added := ShareEntry(p.month, p.share);
    var f := (reached: int, e: ShareEntry) => (if ((reached >= 0) && (e.throughMonth > reached)) then e.throughMonth else -1);
    ShareHistoryFoldResult(p.shareHistory, 0);
    ProofLib.FoldLeftAppend(f, 0, p.shareHistory, added);
    assert f(Std.Collections.Seq.FoldLeft(f, 0, p.shareHistory), added) == p.month;
    ProofLib.FilterNone(q, p.shareHistory);
    ProofLib.FilterAppend(q, p.shareHistory, added);
  }
}

lemma lawShareChangeStartsNextMonth_ensures(p: Project, share: int)
  ensures (lawShareChangeStartsNextMonth(p, share) == true)
{
  if share != p.share && !(exists e :: e in p.shareHistory && e.throughMonth >= p.month) {
    var added := ShareEntry(p.month, p.share);
    var q1 := (e: ShareEntry) => (p.month <= e.throughMonth);
    var q2 := (e: ShareEntry) => ((p.month + 1) <= e.throughMonth);
    MonthShareMeaning(p.shareHistory + [added], share, p.month);
    MonthShareMeaning(p.shareHistory + [added], share, p.month + 1);
    ProofLib.FilterNone(q1, p.shareHistory);
    ProofLib.FilterAppend(q1, p.shareHistory, added);
    ProofLib.FilterNone(q2, p.shareHistory);
    ProofLib.FilterAppend(q2, p.shareHistory, added);
  }
}

lemma ExceptionAppendFresh(p: Project, appended: seq<RepositoryStart>, i: int)
  requires exceptionAppendsValid(p, appended)
  requires 0 <= i < |appended|
  ensures appended[i].month >= 0 && !(appended[i].repositoryId in p.repositories)
  ensures forall j :: 0 <= j < |appended| && j != i ==> appended[j].repositoryId != appended[i].repositoryId
{
  var s := appended[i];
  assert s in appended;
  assert |ProofLib.Filter((t: RepositoryStart) => (t.repositoryId == s.repositoryId), appended)| == 1;
  forall j | 0 <= j < |appended| && j != i
    ensures appended[j].repositoryId != s.repositoryId
  {
    if appended[j].repositoryId == s.repositoryId {
      ProofLib.FilterTwo((t: RepositoryStart) => (t.repositoryId == s.repositoryId), appended, i, j);
    }
  }
}

lemma AdminReviseStarts(p: Project, by_: int, exception: Exception)
  requires alwaysRepositoryStarts(p) && exceptionAppendsValid(p, exception.appended)
  ensures alwaysRepositoryStarts(adminRevise(p, by_, exception))
{
  var after := adminRevise(p, by_, exception);
  var added := after.repositories[|p.repositories|..];
  var news := exception.appended;
  assert after.repositories == p.repositories + added;
  assert after.starts == p.starts + news;
  assert |added| == |news|;
  assert forall k :: 0 <= k < |added| ==> added[k] == news[k].repositoryId;
  StartsMeaning(p);
  forall k | 0 <= k < |news|
    ensures news[k].month >= 0 && !(news[k].repositoryId in p.repositories)
    ensures forall j :: 0 <= j < |news| && j != k ==> news[j].repositoryId != news[k].repositoryId
  {
    ExceptionAppendFresh(p, news, k);
  }
  AppendStartsUnique(p.repositories, p.starts, added, news);
  StartsMeaning(after);
}

lemma adminRevise_ensures(p: Project, by_: int, exception: Exception)
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysHistoryNumbered(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysCurrentRevisionIsState(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysPublishedApplicationCreated(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysCreatedFacts(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysActiveRequirements(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysEconomicTermsPrecedeNothing(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysClockStarted(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysShareWithinLimits(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysRepositoryBound(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysRepositoryStarts(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysOrdinaryVaultFunds(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysRestrictedParticipationPaused(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> alwaysRetirementConsistent(adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepHistoryRetained(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepRevisionAdvancesByOne(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepCreatorFixed(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepCancellationFinal(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepCancellationAppendsNothing(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepEconomicTermsRetained(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepFundedAssetFixed(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepShareHistoryOnlyAppends(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepOpenMonthShareKept(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepRepositoryStartsRetained(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepRepositoriesRetained(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepConsentChangesOnlyByOwnerOrAdministratorRevision(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepOwnerRemovalPermanent(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepRemovalReplayAppendsNothing(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepRemovalAlwaysRetires(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepVaultRecordsRetained(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepBranchMovesOnlyByVerifiedChange(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepNoRegistryEventUnretires(p, "adminRevise", adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepEveryManifestChangeAppendsRevision(p, adminRevise(p, by_, exception)))
  ensures (inv(p) ==> canAdminRevise(p, by_, exception) ==> stepClockMonotone(p, adminRevise(p, by_, exception)))
{
  if inv(p) && canAdminRevise(p, by_, exception) {
    AdminReviseStarts(p, by_, exception);
  }
}
