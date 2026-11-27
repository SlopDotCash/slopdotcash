lemma startPost_ensures(f: Forwarding, claim: SendClaim)
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysClaimBound(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysCanonicalIsEarliestBindingCopy(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysOriginalCase(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysReceiptBinding(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysSubmittedBinding(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> alwaysDraftHasNoCopy(startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> stepPostNeedsOwnReadback(f, startPost(f, claim)))
  ensures (inv(f) ==> canStartPost(f, claim) ==> stepEarlierClaimsRetained(f, startPost(f, claim)))
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

lemma reconcile_ensures(f: Forwarding, request: Request, listing: Listing, nowMs: int)
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysClaimBound(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysCanonicalIsEarliestBindingCopy(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysOriginalCase(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysReceiptBinding(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysSubmittedBinding(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> alwaysDraftHasNoCopy(reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> stepPostNeedsOwnReadback(f, reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> stepEarlierClaimsRetained(f, reconcile(f, request, listing, nowMs)))
  ensures (inv(f) ==> canReconcile(f, request, listing, nowMs) ==> stepCanonicalFixed(f, reconcile(f, request, listing, nowMs)))
{
  if inv(f) && canReconcile(f, request, listing, nowMs) {
    var local_0 := exactListing(f, listing);
    var local_1 := earliestCopy(listing.copies, noCopy);
    if local_0 && local_1.ghsa > 0 {
      var after := reconcile(f, request, listing, nowMs);
      ReconcileDuplicates(f, request, listing, nowMs);
      DuplicateGhsasValid(listing.copies, local_1, after.duplicateGhsas);
    }
  }
}

lemma ReconcileDuplicates(f: Forwarding, request: Request, listing: Listing, nowMs: int)
  requires exactListing(f, listing) && earliestCopy(listing.copies, noCopy).ghsa > 0
  ensures var local_1 := earliestCopy(listing.copies, noCopy);
    var s_map := ProofLib.Filter((copy: Copy) => (copy.ghsa != local_1.ghsa), listing.copies);
    reconcile(f, request, listing, nowMs).duplicateGhsas == seq(|s_map|, i_map requires 0 <= i_map < |s_map| => s_map[i_map].ghsa)
{
}

lemma RecordCreatedDuplicates(f: Forwarding, claim: SendClaim, accepted: Copy, listing: Listing)
  ensures var local_2 := createdCandidates(f, accepted, listing);
    var local_3 := earliestCopy(local_2, accepted);
    var s_map := ProofLib.Filter((copy: Copy) => (copy.ghsa != local_3.ghsa), local_2 + [accepted]);
    recordCreated(f, claim, accepted, listing).duplicateGhsas == seq(|s_map|, i_map requires 0 <= i_map < |s_map| => s_map[i_map].ghsa)
{
}

lemma DuplicateGhsasValid(copies: seq<Copy>, canonical: Copy, dups: seq<int>)
  requires var s_map := ProofLib.Filter((copy: Copy) => (copy.ghsa != canonical.ghsa), copies);
    dups == seq(|s_map|, i_map requires 0 <= i_map < |s_map| => s_map[i_map].ghsa)
  ensures !(canonical.ghsa in dups)
  ensures forall copy :: copy in copies ==> copy.ghsa == canonical.ghsa || copy.ghsa in dups
{
  var p := (copy: Copy) => (copy.ghsa != canonical.ghsa);
  var s_map := ProofLib.Filter(p, copies);
  if canonical.ghsa in dups {
    var i :| 0 <= i < |dups| && dups[i] == canonical.ghsa;
    ProofLib.FilterMember(p, copies, s_map[i]);
    assert false;
  }
  forall copy | copy in copies && copy.ghsa != canonical.ghsa
    ensures copy.ghsa in dups
  {
    ProofLib.FilterMember(p, copies, copy);
    var i :| 0 <= i < |s_map| && s_map[i] == copy;
    assert dups[i] == copy.ghsa;
  }
}

lemma EarliestCopyPick(xs: seq<Copy>, a: Copy, b: Copy)
  requires a.ghsa > 0 && b.ghsa > 0 && a.ghsa != b.ghsa
  requires forall c :: c in xs ==> c.ghsa > 0 && c.ghsa != b.ghsa
  ensures earliestCopy(xs, if comesBefore(b, a) then b else a) == (if comesBefore(b, earliestCopy(xs, a)) then b else earliestCopy(xs, a))
  decreases |xs|
{
  if |xs| > 0 {
    var c := xs[0];
    assert c in xs;
    assert forall x :: x in xs[1..] ==> x in xs;
    var nextA := if comesBefore(c, a) then c else a;
    var ab := if comesBefore(b, a) then b else a;
    var nextAB := if comesBefore(c, ab) then c else ab;
    assert nextAB == (if comesBefore(b, nextA) then b else nextA);
    EarliestCopyPick(xs[1..], nextA, b);
  }
}

lemma EarliestCopyAppend(xs: seq<Copy>, accepted: Copy)
  requires accepted.ghsa > 0
  requires forall c :: c in xs ==> c.ghsa > 0 && c.ghsa != accepted.ghsa
  ensures earliestCopy(xs + [accepted], noCopy) == earliestCopy(xs, accepted)
{
  var f := (incumbent: Copy, candidate: Copy) => (if comesBefore(candidate, incumbent) then candidate else incumbent);
  ProofLib.FoldLeftAppend(f, noCopy, xs, accepted);
  if |xs| == 0 {
    assert xs + [accepted] == [accepted];
  } else {
    assert xs[0] in xs;
    assert forall x :: x in xs[1..] ==> x in xs;
    assert earliestCopy(xs, noCopy) == earliestCopy(xs[1..], xs[0]);
    assert earliestCopy(xs, accepted) == earliestCopy(xs[1..], if comesBefore(xs[0], accepted) then xs[0] else accepted);
    assert (if comesBefore(xs[0], accepted) then xs[0] else accepted) == (if comesBefore(accepted, xs[0]) then accepted else xs[0]);
    EarliestCopyPick(xs[1..], xs[0], accepted);
  }
}

lemma recordCreated_ensures(f: Forwarding, claim: SendClaim, accepted: Copy, listing: Listing)
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysClaimBound(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysCanonicalIsEarliestBindingCopy(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysOriginalCase(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysReceiptBinding(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysSubmittedBinding(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> alwaysDraftHasNoCopy(recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepPostNeedsOwnReadback(f, recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepEarlierClaimsRetained(f, recordCreated(f, claim, accepted, listing)))
  ensures (inv(f) ==> canRecordCreated(f, claim, accepted, listing) ==> stepCanonicalFixed(f, recordCreated(f, claim, accepted, listing)))
{
  if inv(f) && canRecordCreated(f, claim, accepted, listing) {
    var candidates := createdCandidates(f, accepted, listing);
    if |candidates| > 0 {
      var keeps := (copy: Copy) => (copy.ghsa != accepted.ghsa);
      assert exactListing(f, listing) && candidates == ProofLib.Filter(keeps, listing.copies);
      forall copy | copy in candidates ensures copy.ghsa > 0 && copy.ghsa != accepted.ghsa {
        ProofLib.FilterMember(keeps, listing.copies, copy);
      }
    }
    EarliestCopyIsPresent(candidates, accepted);
    EarliestCopyAppend(candidates, accepted);
    RecordCreatedDuplicates(f, claim, accepted, listing);
    DuplicateGhsasValid(candidates + [accepted], earliestCopy(candidates, accepted), recordCreated(f, claim, accepted, listing).duplicateGhsas);
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
