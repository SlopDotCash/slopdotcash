lemma startPost_ensures(f: Forwarding, claim: Claim)
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysClaimBound(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysOriginalCase(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysReceiptBinding(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysSubmittedBinding(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysDraftHasNoCopy(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> stepEarlierClaimsRetained(f, startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> stepPostNeedsOwnReadback(f, startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> stepCanonicalFixed(f, startPost(f, claim)))
{
  if inv(f) && canStartPost(f, claim) {
    var keep := (set_x: int) => !((set_x in f.postedRevisions));
    ProofLib.FilterCons(keep, [claim.revision]);
    ProofLib.FilterNil(keep, []);
    var after := startPost(f, claim);
    assert after.postedRevisions == f.postedRevisions + [claim.revision];
    forall revision | revision in after.postedRevisions ensures revision in f.postedRevisions || (exists candidate :: candidate in f.readyClaims && candidate.revision == revision) {
      if revision !in f.postedRevisions {
        assert revision == claim.revision;
        assert claim in f.readyClaims;
      }
    }
  }
}

lemma recordCreated_ensures(f: Forwarding, claim: Claim, accepted: Copy, listing: Listing)
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysClaimBound(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysOriginalCase(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysReceiptBinding(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysSubmittedBinding(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysDraftHasNoCopy(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepEarlierClaimsRetained(f, recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepPostNeedsOwnReadback(f, recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepCanonicalFixed(f, recordCreated(f, claim, accepted, listing)))
{
  if inv(f) && canRecordCreated(f, claim, accepted, listing) {
    var candidates := createdCandidates(f, accepted, listing);
    if |candidates| > 0 {
      var keeps := (copy: Copy) => (copy.ghsa != accepted.ghsa);
      assert exactListing(f, listing) && candidates == ProofLib.Filter(keeps, listing.copies);
      forall copy | copy in candidates ensures copy.ghsa > 0 {
        ProofLib.FilterMember(keeps, listing.copies, copy);
      }
    }
    EarliestCopyIsPresent(candidates, accepted);
  }
}

lemma EarliestCopyIsPresent(copies: seq<Copy>, accepted: Copy)
  requires accepted.ghsa > 0
  requires forall copy :: copy in copies ==> copy.ghsa > 0
  ensures earliestCopy(copies, accepted).ghsa > 0
  decreases |copies|
{
  if |copies| > 0 {
    assert copies[0] in copies;
    assert forall copy :: copy in copies[1..] ==> copy in copies;
    var next := if comesBefore(copies[0], accepted) then copies[0] else accepted;
    EarliestCopyIsPresent(copies[1..], next);
    assert earliestCopy(copies, accepted) == earliestCopy(copies[1..], next);
  }
}
