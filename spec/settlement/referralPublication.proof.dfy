// A receipt can update one claimant, preserving every other cumulative amount.
lemma ClaimLookupWithoutKey(claims: seq<Claim>, key: int, fallback: seq<int>)
  requires forall c :: c in claims ==> c.actor != key
  ensures Std.Collections.Seq.FoldLeft((found: seq<int>, claim: Claim) => (if (claim.actor == key) then claim.cumulative else found), fallback, claims) == fallback
  decreases |claims|
{
  if |claims| > 0 {
    assert claims[0] in claims;
    assert forall c :: c in claims[1..] ==> c in claims;
    ClaimLookupWithoutKey(claims[1..], key, fallback);
  }
}

lemma ClaimLookupUnique(claims: seq<Claim>, c: Claim, fallback: seq<int>)
  requires c in claims
  requires |ProofLib.Filter((other: Claim) => (other.actor == c.actor), claims)| == 1
  ensures Std.Collections.Seq.FoldLeft((found: seq<int>, claim: Claim) => (if (claim.actor == c.actor) then claim.cumulative else found), fallback, claims) == c.cumulative
  decreases |claims|
{
  assert |claims| > 0;
  assert claims == [claims[0]] + claims[1..];
  ProofLib.FilterCons((other: Claim) => (other.actor == c.actor), claims);
  if claims[0].actor == c.actor {
    assert |ProofLib.Filter((other: Claim) => (other.actor == c.actor), claims[1..])| == 0;
    if c != claims[0] {
      assert c in claims[1..];
      ProofLib.FilterMember((other: Claim) => (other.actor == c.actor), claims[1..], c);
      assert false;
    }
    assert forall r :: r in claims[1..] ==> r.actor != c.actor by {
      forall r | r in claims[1..] ensures r.actor != c.actor {
        ProofLib.FilterMember((other: Claim) => (other.actor == c.actor), claims[1..], r);
      }
    }
    ClaimLookupWithoutKey(claims[1..], c.actor, c.cumulative);
  } else {
    assert c != claims[0] && c in claims[1..];
    ClaimLookupUnique(claims[1..], c, fallback);
  }
}

lemma UniqueClaimsByKey(s: seq<Claim>)
  requires forall c :: c in s ==> |ProofLib.Filter((other: Claim) => (other.actor == c.actor), s)| == 1
  ensures ProofLib.DistinctBy(s, (c: Claim) => c.actor)
{
  forall i, j | 0 <= i < |s| && 0 <= j < |s| && i != j ensures s[i].actor != s[j].actor {
    var c := s[i];
    assert c in s;
    ProofLib.FilterCountOneIffUnique((other: Claim) => (other.actor == c.actor), s, (r: Claim) => r.actor, i);
  }
}

lemma ClaimCountsByKey(s: seq<Claim>)
  requires ProofLib.DistinctBy(s, (c: Claim) => c.actor)
  ensures forall c :: c in s ==> |ProofLib.Filter((other: Claim) => (other.actor == c.actor), s)| == 1
{
  forall i | 0 <= i < |s| ensures |ProofLib.Filter((other: Claim) => (other.actor == s[i].actor), s)| == 1 {
    ProofLib.FilterCountOneIffUnique((other: Claim) => (other.actor == s[i].actor), s, (r: Claim) => r.actor, i);
  }
}

lemma ReplacingClaimKeepsUniqueness(s: seq<Claim>, c: Claim)
  requires forall priorEntry :: priorEntry in s ==> |ProofLib.Filter((other: Claim) => (other.actor == priorEntry.actor), s)| == 1
  ensures forall next :: next in ProofLib.Filter((priorEntry: Claim) => (priorEntry.actor != c.actor), s) + [c] ==>
    |ProofLib.Filter((other: Claim) => (other.actor == next.actor), ProofLib.Filter((priorEntry: Claim) => (priorEntry.actor != c.actor), s) + [c])| == 1
{
  var kept := ProofLib.Filter((priorEntry: Claim) => (priorEntry.actor != c.actor), s);
  UniqueClaimsByKey(s);
  ProofLib.FilterKeepsDistinctBy((priorEntry: Claim) => (priorEntry.actor != c.actor), s, (r: Claim) => r.actor);
  forall i | 0 <= i < |kept| ensures kept[i].actor != c.actor {
    ProofLib.FilterMember((priorEntry: Claim) => (priorEntry.actor != c.actor), s, kept[i]);
  }
  assert ProofLib.DistinctBy([c], (r: Claim) => r.actor);
  ProofLib.DistinctByConcat(kept, [c], (r: Claim) => r.actor);
  ClaimCountsByKey(kept + [c]);
}

lemma SameClaims(before: Publication, after: Publication)
  requires alwaysUniqueClaims(before) && before.claims == after.claims
  ensures stepClaimedNeverFalls(before, after)
{
  forall c | c in before.claims ensures settlement__money_compareAmounts(claimedFor(after, c.actor), c.cumulative) >= 0 {
    assert |ProofLib.Filter((other: Claim) => (other.actor == c.actor), before.claims)| == 1;
    ClaimLookupUnique(before.claims, c, settlement__money_zero);
    assert claimedFor(after, c.actor) == c.cumulative;
    settlement__money_lawEqualReflexive_ensures(c.cumulative);
  }
}

lemma NoSpendingAfterDay(costs: seq<GasSettlement>, day: int, start: int)
  requires forall cost :: cost in costs ==> cost.day < day
  ensures Std.Collections.Seq.FoldLeft((total: int, settlement: GasSettlement) => (total + (if (settlement.day == day) then settlement.actual else 0)), start, costs) == start
  decreases |costs|
{
  if |costs| > 0 {
    assert costs[0] in costs;
    assert forall x :: x in costs[1..] ==> x in costs;
    NoSpendingAfterDay(costs[1..], day, start);
  }
}

lemma AddSettledCost(p: Publication, cost: GasSettlement)
  ensures spentGas(p.(settledGas := p.settledGas + [cost])) == spentGas(p) + (if cost.day == p.day then cost.actual else 0)
{
  var day := p.day;
  ProofLib.FoldLeftAppend((total: int, settlement: GasSettlement) => (total + (if (settlement.day == day) then settlement.actual else 0)), 0, p.settledGas, cost);
}


lemma AppendingAttemptKeepsIds(xs: seq<Attempt>, entry: Attempt)
  requires forall a :: a in xs ==> |ProofLib.Filter((other: Attempt) => (other.id == a.id), xs)| == 1
  requires !(exists a :: a in xs && a.id == entry.id)
  ensures forall a :: a in xs + [entry] ==>
    |ProofLib.Filter((other: Attempt) => (other.id == a.id), xs + [entry])| == 1
{
  forall a | a in xs + [entry] ensures |ProofLib.Filter((other: Attempt) => (other.id == a.id), xs + [entry])| == 1 {
    ProofLib.FilterAppend((other: Attempt) => (other.id == a.id), xs, entry);
    if a == entry {
      ProofLib.FilterNone((other: Attempt) => (other.id == a.id), xs);
    } else {
      assert a in xs;
      assert a.id != entry.id;
    }
  }
}

lemma GasCostIdsAppended(xs: seq<GasSettlement>, cost: GasSettlement)
  requires forall row :: row in xs ==> |ProofLib.Filter((other: GasSettlement) => (other.attempt == row.attempt), xs)| == 1
  requires !(exists row :: row in xs && row.attempt == cost.attempt)
  ensures forall row :: row in xs + [cost] ==> |ProofLib.Filter((other: GasSettlement) => (other.attempt == row.attempt), xs + [cost])| == 1
{
  forall row | row in xs + [cost] ensures |ProofLib.Filter((other: GasSettlement) => (other.attempt == row.attempt), xs + [cost])| == 1 {
    ProofLib.FilterAppend((other: GasSettlement) => (other.attempt == row.attempt), xs, cost);
    if row == cost {
      ProofLib.FilterNone((other: GasSettlement) => (other.attempt == row.attempt), xs);
    } else {
      assert row in xs;
      assert row.attempt != cost.attempt;
    }
  }
}

lemma ReconcilePendingGas(before: Publication, after: Publication, cost: GasSettlement)
  requires alwaysSettledGasValid(before) && alwaysHoldCeiling(before) && gasSettlementMatches(before, cost.attempt, cost.actual, cost.day)
  requires after.settledGas == before.settledGas + [cost] && after.attempts == before.attempts && after.day == before.day
  ensures alwaysSettledGasValid(after)
{
  var matchEntry :| matchEntry in before.attempts && matchesPendingAttempt(before, matchEntry) && matchEntry.day <= cost.day;
  assert cost.attempt == matchEntry.id && cost.day > 0 && cost.actual <= matchEntry.reservedGas && 0 <= cost.actual <= 200000000000000;
  assert cost.day <= after.day && matchEntry in after.attempts;
  assert forall row :: row in before.settledGas ==> |ProofLib.Filter((other: GasSettlement) => (other.attempt == row.attempt), before.settledGas)| == 1;
  GasCostIdsAppended(before.settledGas, cost);
  forall row | row in after.settledGas ensures row.actual >= 0 && row.actual <= 200000000000000 && row.day > 0 && row.day <= after.day &&
    (exists a :: a in after.attempts && a.id == row.attempt && a.day <= row.day && row.actual <= a.reservedGas) {
    if row == cost { assert matchEntry.id == row.attempt; }
    else { assert row in before.settledGas; }
  }
}

lemma ReconcileAttemptCoverage(before: Publication, after: Publication, cost: GasSettlement)
  requires alwaysAttemptGasAccounted(before) && gasSettlementMatches(before, cost.attempt, cost.actual, cost.day)
  requires after.settledGas == before.settledGas + [cost] && after.attempts == before.attempts
  ensures alwaysAttemptGasAccounted(after)
{
  forall entry | entry in after.attempts ensures (exists row :: row in after.settledGas && row.attempt == entry.id) {
    if !(exists row :: row in before.settledGas && row.attempt == entry.id) {
      assert pendingPosting(before) && matchesPendingAttempt(before, entry);
      assert entry.id == before.currentAttempt && before.currentAttempt == cost.attempt;
      assert cost in after.settledGas;
    }
  }
}


lemma NewAttemptHasNoSettlement(p: Publication, id: int)
  requires alwaysSettledGasValid(p)
  requires !(exists entry :: entry in p.attempts && entry.id == id)
  ensures !(exists cost :: cost in p.settledGas && cost.attempt == id)
{
  if exists cost :: cost in p.settledGas && cost.attempt == id {
    var cost :| cost in p.settledGas && cost.attempt == id;
    var entry :| entry in p.attempts && entry.id == cost.attempt && entry.day <= cost.day && cost.actual <= entry.reservedGas;
    assert entry.id != id;
  }
}

lemma JournalKeepsPriorGas(p: Publication, after: Publication, entry: Attempt)
  requires alwaysAttemptGasAccounted(p) && !pendingPosting(p)
  requires after.attempts == p.attempts + [entry] && after.settledGas == p.settledGas
  requires pendingPosting(after) && matchesPendingAttempt(after, entry)
  ensures alwaysAttemptGasAccounted(after)
{
  forall row | row in after.attempts ensures
    (exists cost :: cost in after.settledGas && cost.attempt == row.id) || (pendingPosting(after) && matchesPendingAttempt(after, row)) {
    if row != entry {
      assert row in p.attempts;
      var cost :| cost in p.settledGas && cost.attempt == row.id;
      assert cost in after.settledGas;
    }
  }
}

lemma JournalPreservesSettledGas(p: Publication, after: Publication, entry: Attempt)
  requires alwaysSettledGasValid(p)
  requires after.attempts == p.attempts + [entry] && after.settledGas == p.settledGas && after.day == p.day
  ensures alwaysSettledGasValid(after)
{
  forall cost | cost in after.settledGas ensures (exists row :: row in after.attempts && row.id == cost.attempt && row.day <= cost.day && cost.actual <= row.reservedGas) {
    var priorEntry :| priorEntry in p.attempts && priorEntry.id == cost.attempt && priorEntry.day <= cost.day && cost.actual <= priorEntry.reservedGas;
    assert priorEntry in after.attempts;
  }
}

lemma FinalizedGasUsesHeldAllowance(p: Publication, after: Publication, cost: GasSettlement)
  requires alwaysNativeBounded(p) && 0 <= cost.actual <= p.nativeHold
  requires after.settledGas == p.settledGas + [cost] && after.day == p.day && after.nativeHold == 0
  ensures alwaysNativeBounded(after)
{
  AddSettledCost(p, cost);
  assert spentGas(after) == spentGas(p) + (if cost.day == p.day then cost.actual else 0);
}

lemma RootAmountsAndPinsRetained(before: Publication, after: Publication)
  requires alwaysRootCap(before) && alwaysRootWalletPinned(before)
  requires after.tokenUnit == before.tokenUnit && after.pins == before.pins
  requires |after.roots| == |before.roots|
  requires forall i :: 0 <= i < |after.roots| ==> after.roots[i].total == before.roots[i].total && after.roots[i].entries == before.roots[i].entries
  ensures alwaysRootCap(after) && alwaysRootWalletPinned(after)
{
  forall root | root in after.roots ensures
    settlement__money_compareAmounts(root.total, settlement__money_multiplyAmounts(after.tokenUnit, settlement__money_smallAmount(2000000))) <= 0 &&
    (forall entry :: entry in root.entries ==> settlement__referralAccrual_entryWalletPinned(after.pins, entry)) {
    var i :| 0 <= i < |after.roots| && after.roots[i] == root;
    var prior := before.roots[i];
    assert prior in before.roots;
    assert prior.total == root.total && prior.entries == root.entries;
    assert settlement__money_compareAmounts(prior.total, settlement__money_multiplyAmounts(before.tokenUnit, settlement__money_smallAmount(2000000))) <= 0;
    forall entry | entry in prior.entries ensures settlement__referralAccrual_entryWalletPinned(after.pins, entry) {
      assert settlement__referralAccrual_entryWalletPinned(before.pins, entry);
    }
  }
}

lemma FileFromLedger(p: Publication, a: settlement__referralAccrual_Accrual)
  requires |nextFiling(p, a).entries| > 0
  ensures nextFiling(p, a) in a.filings
{
  var fits := (file: settlement__referralAccrual_Filing) => ((|file.entries| > 0) && !((exists root :: root in p.roots && !((root.period < file.period)))));
  var filtered := ProofLib.Filter(fits, a.filings);
  assert |filtered| > 0;
  assert nextFiling(p, a) == filtered[0];
  assert nextFiling(p, a) in filtered;
  ProofLib.FilterMember(fits, a.filings, nextFiling(p, a));
}

lemma prepare_ensures(p: Publication, control: settlement__referrals_Referral, a: settlement__referralAccrual_Accrual, rootId: int, chain: settlement__referralDistributor_Distributor, merkleRoot: string, rootVerified: bool, signer: string)
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysUniqueAttempts(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysSettledGasValid(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysHoldCeiling(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysIdleUnreserved(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysPreparedWalletsPinned(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysTokenBound(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysPreparedCap(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysRootCap(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysUniqueClaims(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysPinsUnique(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysRootWalletPinned(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysNativeBounded(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysAttemptGasAccounted(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysPendingAttempt(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> alwaysPendingHeld(prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> stepTokenFixed(p, prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> stepPinsRetained(p, prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> stepAttemptsRetained(p, prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
  ensures (inv(p) ==> canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) ==> stepClaimedNeverFalls(p, prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer)))
{
  if inv(p) && canPrepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer) {
    var after := prepare(p, control, a, rootId, chain, merkleRoot, rootVerified, signer);
    SameClaims(p, after);
    var file := nextFiling(p, a);
    FileFromLedger(p, a);
    assert settlement__money_validAmount(file.total);
    assert file in a.filings;
    assert forall e :: e in file.entries ==> settlement__referralAccrual_entryWalletPinned(a.pins, e);
    assert alwaysPreparedCap(after) && alwaysPreparedWalletsPinned(after);
    assert alwaysPinsUnique(after);
    forall root | root in after.roots ensures
      (forall entry :: entry in root.entries ==> settlement__referralAccrual_entryWalletPinned(after.pins, entry)) {
      assert root in p.roots;
      forall entry | entry in root.entries ensures settlement__referralAccrual_entryWalletPinned(after.pins, entry) {
        var pin :| pin in p.pins && pin.actor == entry.actor && pin.wallet == entry.wallet;
        assert pin in after.pins;
      }
    }
    assert alwaysRootWalletPinned(after);  }
}

lemma discardPrepared_ensures(p: Publication)
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysUniqueAttempts(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysSettledGasValid(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysHoldCeiling(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysIdleUnreserved(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysPreparedWalletsPinned(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysTokenBound(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysPreparedCap(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysRootCap(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysUniqueClaims(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysPinsUnique(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysRootWalletPinned(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysNativeBounded(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysAttemptGasAccounted(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysPendingAttempt(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> alwaysPendingHeld(discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> stepTokenFixed(p, discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> stepPinsRetained(p, discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> stepAttemptsRetained(p, discardPrepared(p)))
  ensures (inv(p) ==> canDiscardPrepared(p) ==> stepClaimedNeverFalls(p, discardPrepared(p)))
{
  if inv(p) && canDiscardPrepared(p) {
    var after := discardPrepared(p);
    SameClaims(p, after);
  }
}

lemma submit_ensures(p: Publication, control: settlement__referrals_Referral)
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysUniqueAttempts(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysSettledGasValid(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysHoldCeiling(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysIdleUnreserved(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysPreparedWalletsPinned(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysTokenBound(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysPreparedCap(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysRootCap(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysUniqueClaims(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysPinsUnique(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysRootWalletPinned(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysNativeBounded(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysAttemptGasAccounted(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysPendingAttempt(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> alwaysPendingHeld(submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> stepTokenFixed(p, submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> stepPinsRetained(p, submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> stepAttemptsRetained(p, submit(p, control)))
  ensures (inv(p) ==> canSubmit(p, control) ==> stepClaimedNeverFalls(p, submit(p, control)))
{
  if inv(p) && canSubmit(p, control) {
    var after := submit(p, control);
    SameClaims(p, after);
  }
}

lemma loseObservation_ensures(p: Publication)
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysUniqueAttempts(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysSettledGasValid(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysHoldCeiling(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysIdleUnreserved(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysPreparedWalletsPinned(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysTokenBound(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysPreparedCap(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysRootCap(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysUniqueClaims(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysPinsUnique(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysRootWalletPinned(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysNativeBounded(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysAttemptGasAccounted(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysPendingAttempt(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> alwaysPendingHeld(loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> stepTokenFixed(p, loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> stepPinsRetained(p, loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> stepAttemptsRetained(p, loseObservation(p)))
  ensures (inv(p) ==> canLoseObservation(p) ==> stepClaimedNeverFalls(p, loseObservation(p)))
{
  if inv(p) && canLoseObservation(p) {
    var after := loseObservation(p);
    SameClaims(p, after);
  }
}

lemma retransmit_ensures(p: Publication, control: settlement__referrals_Referral)
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysUniqueAttempts(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysSettledGasValid(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysHoldCeiling(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysIdleUnreserved(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysPreparedWalletsPinned(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysTokenBound(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysPreparedCap(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysRootCap(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysUniqueClaims(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysPinsUnique(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysRootWalletPinned(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysNativeBounded(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysAttemptGasAccounted(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysPendingAttempt(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> alwaysPendingHeld(retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> stepTokenFixed(p, retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> stepPinsRetained(p, retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> stepAttemptsRetained(p, retransmit(p, control)))
  ensures (inv(p) ==> canRetransmit(p, control) ==> stepClaimedNeverFalls(p, retransmit(p, control)))
{
  if inv(p) && canRetransmit(p, control) {
    var after := retransmit(p, control);
    SameClaims(p, after);
  }
}

lemma observeDay_ensures(p: Publication, day: int)
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysUniqueAttempts(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysSettledGasValid(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysHoldCeiling(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysIdleUnreserved(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysPreparedWalletsPinned(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysTokenBound(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysPreparedCap(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysRootCap(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysUniqueClaims(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysPinsUnique(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysRootWalletPinned(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysNativeBounded(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysAttemptGasAccounted(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysPendingAttempt(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> alwaysPendingHeld(observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> stepTokenFixed(p, observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> stepPinsRetained(p, observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> stepAttemptsRetained(p, observeDay(p, day)))
  ensures (inv(p) ==> canObserveDay(p, day) ==> stepClaimedNeverFalls(p, observeDay(p, day)))
{
  if inv(p) && canObserveDay(p, day) {
    var after := observeDay(p, day);
    SameClaims(p, after);
    assert forall cost :: cost in p.settledGas ==> cost.day < day;
    NoSpendingAfterDay(p.settledGas, day, 0);
    assert spentGas(after) == 0;
    assert alwaysNativeBounded(after);
  }
}

lemma setPostingPaused_ensures(p: Publication, paused: bool, by_: string)
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysUniqueAttempts(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysSettledGasValid(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysHoldCeiling(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysIdleUnreserved(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysPreparedWalletsPinned(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysTokenBound(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysPreparedCap(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysRootCap(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysUniqueClaims(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysPinsUnique(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysRootWalletPinned(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysNativeBounded(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysAttemptGasAccounted(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysPendingAttempt(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> alwaysPendingHeld(setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> stepTokenFixed(p, setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> stepPinsRetained(p, setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> stepAttemptsRetained(p, setPostingPaused(p, paused, by_)))
  ensures (inv(p) ==> canSetPostingPaused(p, paused, by_) ==> stepClaimedNeverFalls(p, setPostingPaused(p, paused, by_)))
{
  if inv(p) && canSetPostingPaused(p, paused, by_) {
    var after := setPostingPaused(p, paused, by_);
    SameClaims(p, after);
  }
}

lemma journal_ensures(p: Publication, control: settlement__referrals_Referral, attempt: int, gas: int, chain: settlement__referralDistributor_Distributor, signer: string)
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysUniqueAttempts(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysSettledGasValid(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysHoldCeiling(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysIdleUnreserved(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysPreparedWalletsPinned(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysTokenBound(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysPreparedCap(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysRootCap(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysUniqueClaims(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysPinsUnique(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysRootWalletPinned(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysNativeBounded(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysAttemptGasAccounted(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysPendingAttempt(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> alwaysPendingHeld(journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> stepTokenFixed(p, journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> stepPinsRetained(p, journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> stepAttemptsRetained(p, journal(p, control, attempt, gas, chain, signer)))
  ensures (inv(p) ==> canJournal(p, control, attempt, gas, chain, signer) ==> stepClaimedNeverFalls(p, journal(p, control, attempt, gas, chain, signer)))
{
  if inv(p) && canJournal(p, control, attempt, gas, chain, signer) {
    var after := journal(p, control, attempt, gas, chain, signer);
    SameClaims(p, after);
    var entry := Attempt(attempt, p.prepared.id, p.prepared.epoch, p.day, gas);
    assert after.attempts == p.attempts + [entry];
    assert !(exists priorEntry :: priorEntry in p.attempts && priorEntry.id == attempt);
    AppendingAttemptKeepsIds(p.attempts, entry);
    NewAttemptHasNoSettlement(p, attempt);
    assert entry in after.attempts && matchesPendingAttempt(after, entry);
    JournalKeepsPriorGas(p, after, entry);
    JournalPreservesSettledGas(p, after, entry);
  }
}

lemma finalize_ensures(p: Publication, rootReceipt: RootReceipt)
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysUniqueAttempts(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysSettledGasValid(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysHoldCeiling(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysIdleUnreserved(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysPreparedWalletsPinned(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysTokenBound(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysPreparedCap(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysRootCap(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysUniqueClaims(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysPinsUnique(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysRootWalletPinned(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysNativeBounded(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysAttemptGasAccounted(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysPendingAttempt(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> alwaysPendingHeld(finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> stepTokenFixed(p, finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> stepPinsRetained(p, finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> stepAttemptsRetained(p, finalize(p, rootReceipt)))
  ensures (inv(p) ==> canFinalize(p, rootReceipt) ==> stepClaimedNeverFalls(p, finalize(p, rootReceipt)))
{
  if inv(p) && canFinalize(p, rootReceipt) {
    var after := finalize(p, rootReceipt);
    assert p.token == after.token && p.tokenUnit == after.tokenUnit;
    assert stepTokenFixed(p, after);
    SameClaims(p, after);
    var cost := GasSettlement(rootReceipt.attempt, rootReceipt.actualGas, rootReceipt.settledDay);
    assert gasSettlementMatches(p, cost.attempt, cost.actual, cost.day);
    assert after.settledGas == p.settledGas + [cost] && after.day == p.day;
    FinalizedGasUsesHeldAllowance(p, after, cost);
    ReconcilePendingGas(p, after, cost);
    ReconcileAttemptCoverage(p, after, cost);
  }
}

lemma finalizeFailure_ensures(p: Publication, attempt: int, receipt: int, actualGas: int, settledDay: int, finalized: bool, succeeded: bool)
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysUniqueAttempts(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysSettledGasValid(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysHoldCeiling(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysIdleUnreserved(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysPreparedWalletsPinned(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysTokenBound(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysPreparedCap(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysRootCap(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysUniqueClaims(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysPinsUnique(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysRootWalletPinned(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysNativeBounded(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysAttemptGasAccounted(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysPendingAttempt(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> alwaysPendingHeld(finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> stepTokenFixed(p, finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> stepPinsRetained(p, finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> stepAttemptsRetained(p, finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
  ensures (inv(p) ==> canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) ==> stepClaimedNeverFalls(p, finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded)))
{
  if inv(p) && canFinalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded) {
    var after := finalizeFailure(p, attempt, receipt, actualGas, settledDay, finalized, succeeded);
    assert p.token == after.token && p.tokenUnit == after.tokenUnit;
    assert stepTokenFixed(p, after);
    SameClaims(p, after);
    var cost := GasSettlement(attempt, actualGas, settledDay);
    assert gasSettlementMatches(p, cost.attempt, cost.actual, cost.day);
    assert after.settledGas == p.settledGas + [cost] && after.day == p.day;
    FinalizedGasUsesHeldAllowance(p, after, cost);
    ReconcilePendingGas(p, after, cost);
    ReconcileAttemptCoverage(p, after, cost);
  }
}

lemma claim_ensures(p: Publication, claimReceipt: ClaimReceipt)
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysUniqueAttempts(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysSettledGasValid(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysHoldCeiling(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysIdleUnreserved(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysPreparedWalletsPinned(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysTokenBound(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysPreparedCap(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysRootCap(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysUniqueClaims(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysPinsUnique(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysRootWalletPinned(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysNativeBounded(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysAttemptGasAccounted(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysPendingAttempt(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> alwaysPendingHeld(claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> stepTokenFixed(p, claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> stepPinsRetained(p, claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> stepAttemptsRetained(p, claim(p, claimReceipt)))
  ensures (inv(p) ==> canClaim(p, claimReceipt) ==> stepClaimedNeverFalls(p, claim(p, claimReceipt)))
{
  if inv(p) && canClaim(p, claimReceipt) {
    var after := claim(p, claimReceipt);
    var entry := Claim(claimReceipt.actor, claimReceipt.cumulative);
    var keep := (c: Claim) => c.actor != claimReceipt.actor;
    var kept := ProofLib.Filter(keep, p.claims);
    assert after.claims == kept + [entry];
    assert forall c :: c in p.claims ==> |ProofLib.Filter((other: Claim) => (other.actor == c.actor), p.claims)| == 1;
    ReplacingClaimKeepsUniqueness(p.claims, entry);
    assert alwaysUniqueClaims(after);
    forall c | c in p.claims ensures settlement__money_compareAmounts(claimedFor(after, c.actor), c.cumulative) >= 0 {
      assert |ProofLib.Filter((other: Claim) => (other.actor == c.actor), p.claims)| == 1;
      ClaimLookupUnique(p.claims, c, settlement__money_zero);
      assert claimedFor(p, c.actor) == c.cumulative;
      if c.actor == claimReceipt.actor {
        assert entry in after.claims;
        ClaimLookupUnique(after.claims, entry, settlement__money_zero);
        assert claimedFor(after, c.actor) == claimReceipt.cumulative;
      } else {
        ProofLib.FilterMember(keep, p.claims, c);
        assert c in after.claims;
        ClaimLookupUnique(after.claims, c, settlement__money_zero);
        assert claimedFor(after, c.actor) == c.cumulative;
        settlement__money_lawEqualReflexive_ensures(c.cumulative);
      }
    }
    assert stepClaimedNeverFalls(p, after);
  }
}

lemma voidRoot_ensures(p: Publication, rootId: int, receipt: int, height: int, finalized: bool, by_: string)
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysUniqueAttempts(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysSettledGasValid(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysHoldCeiling(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysIdleUnreserved(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysPreparedWalletsPinned(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysTokenBound(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysPreparedCap(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysRootCap(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysUniqueClaims(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysPinsUnique(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysRootWalletPinned(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysNativeBounded(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysAttemptGasAccounted(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysPendingAttempt(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> alwaysPendingHeld(voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> stepTokenFixed(p, voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> stepPinsRetained(p, voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> stepAttemptsRetained(p, voidRoot(p, rootId, receipt, height, finalized, by_)))
  ensures (inv(p) ==> canVoidRoot(p, rootId, receipt, height, finalized, by_) ==> stepClaimedNeverFalls(p, voidRoot(p, rootId, receipt, height, finalized, by_)))
{
  if inv(p) && canVoidRoot(p, rootId, receipt, height, finalized, by_) {
    var after := voidRoot(p, rootId, receipt, height, finalized, by_);
    SameClaims(p, after);
    assert |after.roots| == |p.roots|;
    forall i | 0 <= i < |after.roots| ensures after.roots[i].total == p.roots[i].total && after.roots[i].entries == p.roots[i].entries {
      var root := p.roots[i];
      assert after.roots[i] == (if root.id == rootId then root.(voided := true, voidAcknowledged := false) else root);
    }
    RootAmountsAndPinsRetained(p, after);
  }
}

lemma acknowledgeVoid_ensures(p: Publication, rootId: int, by_: string)
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysUniqueAttempts(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysSettledGasValid(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysHoldCeiling(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysIdleUnreserved(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysPreparedWalletsPinned(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysTokenBound(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysPreparedCap(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysRootCap(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysUniqueClaims(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysPinsUnique(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysRootWalletPinned(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysNativeBounded(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysAttemptGasAccounted(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysPendingAttempt(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> alwaysPendingHeld(acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> stepTokenFixed(p, acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> stepPinsRetained(p, acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> stepAttemptsRetained(p, acknowledgeVoid(p, rootId, by_)))
  ensures (inv(p) ==> canAcknowledgeVoid(p, rootId, by_) ==> stepClaimedNeverFalls(p, acknowledgeVoid(p, rootId, by_)))
{
  if inv(p) && canAcknowledgeVoid(p, rootId, by_) {
    var after := acknowledgeVoid(p, rootId, by_);
    SameClaims(p, after);
  }
}

lemma invalidateCache_ensures(p: Publication)
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysUniqueAttempts(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysSettledGasValid(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysHoldCeiling(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysIdleUnreserved(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysPreparedWalletsPinned(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysTokenBound(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysPreparedCap(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysRootCap(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysUniqueClaims(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysPinsUnique(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysRootWalletPinned(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysNativeBounded(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysAttemptGasAccounted(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysPendingAttempt(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> alwaysPendingHeld(invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> stepTokenFixed(p, invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> stepPinsRetained(p, invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> stepAttemptsRetained(p, invalidateCache(p)))
  ensures (inv(p) ==> canInvalidateCache(p) ==> stepClaimedNeverFalls(p, invalidateCache(p)))
{
  if inv(p) && canInvalidateCache(p) {
    var after := invalidateCache(p);
    SameClaims(p, after);
  }
}

lemma refreshCache_ensures(p: Publication, paused: bool, finalized: bool)
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysUniqueAttempts(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysSettledGasValid(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysHoldCeiling(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysIdleUnreserved(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysPreparedWalletsPinned(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysTokenBound(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysPreparedCap(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysRootCap(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysUniqueClaims(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysPinsUnique(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysRootWalletPinned(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysNativeBounded(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysAttemptGasAccounted(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysPendingAttempt(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> alwaysPendingHeld(refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> stepTokenFixed(p, refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> stepPinsRetained(p, refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> stepAttemptsRetained(p, refreshCache(p, paused, finalized)))
  ensures (inv(p) ==> canRefreshCache(p, paused, finalized) ==> stepClaimedNeverFalls(p, refreshCache(p, paused, finalized)))
{
  if inv(p) && canRefreshCache(p, paused, finalized) {
    var after := refreshCache(p, paused, finalized);
    SameClaims(p, after);
  }
}
