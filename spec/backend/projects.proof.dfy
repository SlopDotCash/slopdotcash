// Every retained repository has exactly one immutable contribution-start record.
lemma RepositoryStartsMeaning(p: Project)
  ensures alwaysRepositoryStarts(p) ==
    ((forall start :: start in p.repositoryStarts ==> start.month >= 0 && start.repositoryId in p.repositories) &&
      (forall id :: id in p.repositories ==> |ProofLib.Filter((start: RepositoryStart) => start.repositoryId == id, p.repositoryStarts)| == 1))
{
}

lemma appendRepository_ensures(p: Project, by_: int, appendEvidence: AppendEvidence)
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysAuthorityActor(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysHistoryLength(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysPublishedRevision(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysRetiredPaused(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysRegisteredRepository(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysClearanceBelongs(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysRepositoryStarts(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> alwaysActiveClearance(appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepApplicantRetained(p, appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepHistoryOnlyAppends(p, appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepRepositoriesRetained(p, appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepRepositoryStartsRetained(p, appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepUpdateHistoryRetained(p, appendRepository(p, by_, appendEvidence)))
  ensures (inv(p) ==> canAppendRepository(p, by_, appendEvidence) ==> stepCancelKeepsPublishedRevision(p, "appendRepository", appendRepository(p, by_, appendEvidence)))
{
  if inv(p) && canAppendRepository(p, by_, appendEvidence) {
    RepositoryStartsMeaning(p);
    var added := RepositoryStart(appendEvidence.repositoryId, appendEvidence.currentMonth + 1);
    var after := appendRepository(p, by_, appendEvidence);
    forall id | id in after.repositories
      ensures |ProofLib.Filter((start: RepositoryStart) => start.repositoryId == id, after.repositoryStarts)| == 1
    {
      ProofLib.FilterAppend((start: RepositoryStart) => start.repositoryId == id, p.repositoryStarts, added);
      if id == appendEvidence.repositoryId {
        ProofLib.FilterNone((start: RepositoryStart) => start.repositoryId == id, p.repositoryStarts);
      }
    }
    RepositoryStartsMeaning(after);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var p := initialHolds();
  ProofLib.FilterOne((start: RepositoryStart) => start.repositoryId == 1, p.repositoryStarts, 0);
  RepositoryStartsMeaning(p);
}
