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
lemma ChangedStarts(p: Project, by_: int, change: OwnerChange)
  requires inv(p) && changeValid(p, by_, change)
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
  forall start | start in after.starts
    ensures start.month >= 0 && start.repositoryId in after.repositories
  {
    if start in p.starts {
    } else {
      var k :| 0 <= k < |news| && news[k] == start;
    }
  }
  forall id | id in after.repositories
    ensures |ProofLib.Filter((start: RepositoryStart) => (start.repositoryId == id), after.starts)| == 1
  {
    var f := (start: RepositoryStart) => (start.repositoryId == id);
    FilterConcat(f, p.starts, news);
    if id in p.repositories {
      assert forall k :: 0 <= k < |news| ==> !f(news[k]);
      ProofLib.FilterNone(f, news);
    } else {
      assert id in added;
      var k :| 0 <= k < |added| && added[k] == id;
      assert forall j :: 0 <= j < |p.starts| ==> p.starts[j] in p.starts && !f(p.starts[j]);
      ProofLib.FilterNone(f, p.starts);
      ProofLib.FilterOne(f, news, k);
    }
  }
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
    ChangedStarts(p, by_, change);
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
    ChangedStarts(p, by_, change);
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
  if alwaysHistoryNumbered(p) && canPublishOwnerRevision(p, by_, change) && consentOnly(change) {
    var after := publishOwnerRevision(p, by_, change);
    assert after.history == p.history + [Revision(p.revision + 1, RevisionKind.ConsentChanged, p.status, p.tier, by_)];
    assert currentRevision(after) == after.history[p.revision];
  }
}

lemma lawRemovedNeverRestored_ensures(p: Project)
  ensures (lawRemovedNeverRestored(p) == true)
{
  if alwaysRetirementConsistent(p) && ownerRetired(p) {
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
