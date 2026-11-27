lemma OneProposalFilter(o: OctoberImport)
  ensures alwaysOneProposalPerProject(o) == !((exists p :: p in o.proposals && !(((p.project > 0) && (|ProofLib.Filter((q: Proposal) => (q.project == p.project), o.proposals)| == 1)))))
{
}

lemma AppendUniqueProposal(before: OctoberImport, after: OctoberImport, added: Proposal)
  requires alwaysOneProposalPerProject(before)
  requires added.project > 0
  requires !hasProposal(before, added.project)
  requires after.proposals == before.proposals + [added]
  ensures alwaysOneProposalPerProject(after)
{
  OneProposalFilter(before);
  OneProposalFilter(after);
  forall p | p in after.proposals
    ensures p.project > 0 && |ProofLib.Filter((q: Proposal) => (q.project == p.project), after.proposals)| == 1
  {
    var pred := (q: Proposal) => (q.project == p.project);
    ProofLib.FilterAppend(pred, before.proposals, added);
    if p == added {
      ProofLib.FilterNone(pred, before.proposals);
    } else {
      assert p in before.proposals;
      assert p.project != added.project;
    }
  }
}

lemma applyImport_ensures(o: OctoberImport, facts: WriteFacts, by_: string)
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> alwaysOneProposalPerProject(applyImport(o, facts, by_)))
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> alwaysVerifiedWereImported(applyImport(o, facts, by_)))
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> alwaysImportMatchesReviewedPacket(applyImport(o, facts, by_)))
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> stepOnlyWritersAddProposals(o, "applyImport", applyImport(o, facts, by_)))
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> stepProposalsRetained(o, applyImport(o, facts, by_)))
  ensures (inv(o) ==> canApplyImport(o, facts, by_) ==> stepReviewFixed(o, applyImport(o, facts, by_)))
{
  if inv(o) && canApplyImport(o, facts, by_) {
    var added := Proposal(facts.project, Source.ReviewedImport, o.reviewedDigest, reviewedShares(entryFor(o, facts.project)));
    AppendUniqueProposal(o, applyImport(o, facts, by_), added);
  }
}

lemma monthlyPropose_ensures(o: OctoberImport, project: int, by_: string)
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> alwaysOneProposalPerProject(monthlyPropose(o, project, by_)))
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> alwaysVerifiedWereImported(monthlyPropose(o, project, by_)))
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> alwaysImportMatchesReviewedPacket(monthlyPropose(o, project, by_)))
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> stepOnlyWritersAddProposals(o, "monthlyPropose", monthlyPropose(o, project, by_)))
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> stepProposalsRetained(o, monthlyPropose(o, project, by_)))
  ensures (inv(o) ==> canMonthlyPropose(o, project, by_) ==> stepReviewFixed(o, monthlyPropose(o, project, by_)))
{
  if inv(o) && canMonthlyPropose(o, project, by_) {
    var added := Proposal(project, Source.MonthlyWorkflow, "", []);
    AppendUniqueProposal(o, monthlyPropose(o, project, by_), added);
  }
}
