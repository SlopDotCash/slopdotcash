lemma decideAward_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysFundsObserved(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysOneHoldPerRootCause(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysCasesKeepAwardRules(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysFullAwardBindsNoVault(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysHoldsMatchCases(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> stepHoldsNeedClearance(b, decideAward(b, id, by_, checkedEpoch, amount)))
{
  if inv(b) && canDecideAward(b, id, by_, checkedEpoch, amount) {
    var c := caseOf(b, id);
    var clearance := clearanceFor(b, id, amount);
    var after := security__cases_decideAward(c, by_, checkedEpoch, amount, clearance);
    assert security__cases_mayStartCommitment(c, by_, clearance);
    assert rootCauseFree(b, id) && firstQualifying(b, id) && !c.authority.programRestricted;
    assert c.receipt.Confirmed?;
    assert security__cases_alwaysConfirmedHasRootCause(c);
    assert c.rootCause > 0;
    assert security__cases_alwaysCommitmentMatchesAward(c);
    assert c.commitment.NoCommitment?;
    assert after.rootCause == c.rootCause;
    if after.commitment.VaultReservation? {
      assert clearance.rail.VaultRail?;
      assert fundsFresh(b, c.terms.asset);
      assert b.funds.observedAt > 0;
    }
    RecordedHoldKeepsRules(id, after, amount, b);
  }
}

lemma reviewRelated_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, approve: bool)
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysFundsObserved(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysOneHoldPerRootCause(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysCasesKeepAwardRules(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysFullAwardBindsNoVault(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysHoldsMatchCases(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> stepHoldsNeedClearance(b, reviewRelated(b, id, by_, checkedEpoch, approve)))
{
  if inv(b) && canReviewRelated(b, id, by_, checkedEpoch, approve) {
    var c := caseOf(b, id);
    var gross := c.grossChosen;
    var clearance := clearanceFor(b, id, gross);
    var after := security__cases_reviewRelated(c, by_, checkedEpoch, approve, clearance);
    assert c.receipt.Confirmed?;
    assert security__cases_alwaysConfirmedHasRootCause(c);
    assert security__cases_alwaysProposalCommitsNothing(c);
    assert c.commitment.NoCommitment?;
    assert after.rootCause == c.rootCause && c.rootCause > 0;
    if approve {
      assert security__cases_mayStartCommitment(c, by_, clearance);
      assert rootCauseFree(b, id) && firstQualifying(b, id) && !c.authority.programRestricted;
      if after.commitment.VaultReservation? {
        assert clearance.rail.VaultRail?;
        assert fundsFresh(b, c.terms.asset);
        assert b.funds.observedAt > 0;
      }
      RecordedHoldKeepsRules(id, after, gross, b);
    } else {
      forall other | known(other) && other != id
        ensures caseOf(reviewRelated(b, id, by_, checkedEpoch, false), other) == caseOf(b, other)
      {
        OtherCaseUnchanged(id, after, b, other);
      }
      DroppedHoldKeepsRules(b, id, by_, checkedEpoch);
    }
  }
}

// Recording a case's hold keeps the other cases' holds and appends the new one.
lemma RecordedHoldMembers(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: Bounty, x: Hold)
  ensures withHold(id, after, amount, b).holds == ProofLib.Filter((h: Hold) => (h.caseId != id), b.holds) + [holdFor(b, id, after)]
  ensures x in withHold(id, after, amount, b).holds <==> (x in b.holds && x.caseId != id) || x == holdFor(b, id, after)
{
  ProofLib.FilterMember((h: Hold) => (h.caseId != id), b.holds, x);
}

// A refusal keeps exactly the other cases' holds, through the library's filter view.
lemma RefusedHolds(b: Bounty, id: int, by_: int, checkedEpoch: int)
  ensures reviewRelated(b, id, by_, checkedEpoch, false).holds == ProofLib.Filter((h: Hold) => (h.caseId != id), b.holds)
{
}

// The case rules of the other case are untouched when one case changes.
lemma OtherCaseUnchanged(id: int, after: security__cases_PrivateCase, b: Bounty, other: int)
  requires known(id) && known(other) && other != id
  ensures caseOf(putCase(id, after, b), other) == caseOf(b, other)
  ensures caseOf(putCase(id, after, b), id) == after
{
}

// A new hold for a cleared case keeps one hold per root cause and every hold matching its case.
lemma RecordedHoldKeepsRules(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: Bounty)
  requires inv(b)
  requires known(id)
  requires after.rootCause == caseOf(b, id).rootCause && after.rootCause > 0
  requires rootCauseFree(b, id) && firstQualifying(b, id) && !caseOf(b, id).authority.programRestricted
  requires security__cases_committed(after) || after.relatedReview.ReviewPending?
  requires after.commitment.NoCommitment? ==> after.relatedReview.ReviewPending?
  requires after.commitment.VaultReservation? ==> b.funds.observedAt > 0
  requires (after.commitment.VaultReservation? || after.commitment.DirectAward?) ==> after.terms.split.StandardSplit?
  ensures alwaysOneHoldPerRootCause(withHold(id, after, amount, b))
  ensures alwaysFullAwardBindsNoVault(withHold(id, after, amount, b))
  ensures alwaysHoldsMatchCases(withHold(id, after, amount, b))
  ensures stepHoldsNeedClearance(b, withHold(id, after, amount, b))
{
  var nb := withHold(id, after, amount, b);
  var nh := holdFor(b, id, after);
  forall x
    ensures x in nb.holds <==> (x in b.holds && x.caseId != id) || x == nh
  {
    RecordedHoldMembers(id, after, amount, b, x);
  }
  assert nh.caseId == id && nh.rootCause == caseOf(b, id).rootCause;
  assert caseOf(nb, id) == after;
  forall other | known(other) && other != id
    ensures caseOf(nb, other) == caseOf(b, other)
  {
    OtherCaseUnchanged(id, after, b, other);
  }
  forall h | h in b.holds
    ensures holdMatches(b, h) && known(h.caseId)
  {
  }
  forall h, g | h in nb.holds && g in nb.holds
    ensures (g.rootCause == h.rootCause || g.caseId == h.caseId) ==> g == h
  {
    if h != nh && g != nh {
      assert h in b.holds && g in b.holds;
    } else if h == nh && g != nh {
      assert g in b.holds && g.caseId != id;
      assert g.caseId == id || g.rootCause != caseOf(b, id).rootCause;
    } else if g == nh && h != nh {
      assert h in b.holds && h.caseId != id;
      assert h.caseId == id || h.rootCause != caseOf(b, id).rootCause;
    }
  }
  assert alwaysOneHoldPerRootCause(nb);
  forall h | h in nb.holds
    ensures holdMatches(nb, h)
    ensures (h.kind.VaultHold? || h.kind.DirectHold?) ==> caseOf(nb, h.caseId).terms.split.StandardSplit?
  {
    if h != nh {
      assert h in b.holds && h.caseId != id;
      assert caseOf(nb, h.caseId) == caseOf(b, h.caseId);
    }
  }
  forall other | other in caseIds
    ensures hasHold(nb, other) == (security__cases_committed(caseOf(nb, other)) || caseOf(nb, other).relatedReview.ReviewPending?)
  {
    if other == id {
      assert nh in nb.holds;
    } else {
      assert hasHold(nb, other) == hasHold(b, other);
    }
  }
  assert alwaysFullAwardBindsNoVault(nb);
  assert alwaysHoldsMatchCases(nb);
}

// A refused proposal releases its hold and leaves every other hold matching its case.
lemma DroppedHoldKeepsRules(b: Bounty, id: int, by_: int, checkedEpoch: int)
  requires inv(b)
  requires known(id)
  requires !security__cases_committed(caseOf(reviewRelated(b, id, by_, checkedEpoch, false), id))
  requires !caseOf(reviewRelated(b, id, by_, checkedEpoch, false), id).relatedReview.ReviewPending?
  requires forall other :: known(other) && other != id ==> caseOf(reviewRelated(b, id, by_, checkedEpoch, false), other) == caseOf(b, other)
  ensures alwaysOneHoldPerRootCause(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures alwaysFullAwardBindsNoVault(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures alwaysHoldsMatchCases(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures stepHoldsNeedClearance(b, reviewRelated(b, id, by_, checkedEpoch, false))
{
  var nb := reviewRelated(b, id, by_, checkedEpoch, false);
  RefusedHolds(b, id, by_, checkedEpoch);
  forall x
    ensures x in nb.holds <==> x in b.holds && x.caseId != id
  {
    ProofLib.FilterMember((h: Hold) => (h.caseId != id), b.holds, x);
  }
  forall h | h in nb.holds
    ensures holdMatches(nb, h)
    ensures (h.kind.VaultHold? || h.kind.DirectHold?) ==> caseOf(nb, h.caseId).terms.split.StandardSplit?
  {
    assert h in b.holds && h.caseId != id && holdMatches(b, h);
    assert caseOf(nb, h.caseId) == caseOf(b, h.caseId);
  }
  forall other | other in caseIds
    ensures hasHold(nb, other) == (security__cases_committed(caseOf(nb, other)) || caseOf(nb, other).relatedReview.ReviewPending?)
  {
    if other != id {
      assert hasHold(nb, other) == hasHold(b, other);
    }
  }
  forall h, g | h in nb.holds && g in nb.holds
    ensures (g.rootCause == h.rootCause || g.caseId == h.caseId) ==> g == h
  {
    assert h in b.holds && g in b.holds;
  }
  assert alwaysOneHoldPerRootCause(nb);
  assert alwaysFullAwardBindsNoVault(nb);
  assert alwaysHoldsMatchCases(nb);
  assert stepHoldsNeedClearance(b, nb);
}
