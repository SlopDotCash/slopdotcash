// Epoch indices are contiguous even when an epoch is voided.
lemma EpochSequenceCount(xs: seq<Epoch>, start: int, valid: bool)
  ensures Std.Collections.Seq.FoldLeft((acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next))), SequenceCheck(start, valid), xs).next == start + |xs|
  decreases |xs|
{
  if |xs| > 0 {
    EpochSequenceCount(xs[1..], start + 1, valid && xs[0].index == start);
  }
}

lemma EpochSequenceUnchanged(xs: seq<Epoch>, ys: seq<Epoch>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> xs[i].index == ys[i].index
  ensures Std.Collections.Seq.FoldLeft((acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next))), emptySequenceCheck, xs) ==
    Std.Collections.Seq.FoldLeft((acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next))), emptySequenceCheck, ys)
{
  ProofLib.FoldLeftPointwise((acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next))),
    (acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next))), emptySequenceCheck, xs, ys);
}

lemma ClaimLookupWithoutKey(claims: seq<AddressClaim>, key: string, fallback: seq<int>)
  requires forall c :: c in claims ==> c.wallet != key
  ensures Std.Collections.Seq.FoldLeft((selected: seq<int>, claim: AddressClaim) => (if (claim.wallet == key) then claim.cumulative else selected), fallback, claims) == fallback
  decreases |claims|
{
  if |claims| > 0 {
    assert claims[0] in claims;
    assert forall c :: c in claims[1..] ==> c in claims;
    ClaimLookupWithoutKey(claims[1..], key, fallback);
  }
}

lemma ClaimLookupUnique(claims: seq<AddressClaim>, c: AddressClaim, fallback: seq<int>)
  requires c in claims
  requires |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), claims)| == 1
  ensures Std.Collections.Seq.FoldLeft((selected: seq<int>, claim: AddressClaim) => (if (claim.wallet == c.wallet) then claim.cumulative else selected), fallback, claims) == c.cumulative
  decreases |claims|
{
  assert |claims| > 0;
  assert claims == [claims[0]] + claims[1..];
  ProofLib.FilterCons((other: AddressClaim) => (other.wallet == c.wallet), claims);
  if claims[0].wallet == c.wallet {
    assert |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), claims[1..])| == 0;
    if c != claims[0] {
      assert c in claims[1..];
      ProofLib.FilterMember((other: AddressClaim) => (other.wallet == c.wallet), claims[1..], c);
      assert false;
    }
    assert forall r :: r in claims[1..] ==> r.wallet != c.wallet by {
      forall r | r in claims[1..] ensures r.wallet != c.wallet {
        ProofLib.FilterMember((other: AddressClaim) => (other.wallet == c.wallet), claims[1..], r);
      }
    }
    ClaimLookupWithoutKey(claims[1..], c.wallet, c.cumulative);
  } else {
    assert c != claims[0] && c in claims[1..];
    ClaimLookupUnique(claims[1..], c, fallback);
  }
}

lemma UniqueClaimsByKey(s: seq<AddressClaim>)
  requires forall c :: c in s ==> |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), s)| == 1
  ensures ProofLib.DistinctBy(s, (c: AddressClaim) => c.wallet)
{
  forall i, j | 0 <= i < |s| && 0 <= j < |s| && i != j ensures s[i].wallet != s[j].wallet {
    var c := s[i];
    assert c in s;
    ProofLib.FilterCountOneIffUnique((other: AddressClaim) => (other.wallet == c.wallet), s, (r: AddressClaim) => r.wallet, i);
  }
}

lemma ClaimCountsByKey(s: seq<AddressClaim>)
  requires ProofLib.DistinctBy(s, (c: AddressClaim) => c.wallet)
  ensures forall c :: c in s ==> |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), s)| == 1
{
  forall i | 0 <= i < |s| ensures |ProofLib.Filter((other: AddressClaim) => (other.wallet == s[i].wallet), s)| == 1 {
    ProofLib.FilterCountOneIffUnique((other: AddressClaim) => (other.wallet == s[i].wallet), s, (r: AddressClaim) => r.wallet, i);
  }
}

lemma ReplacingClaimKeepsUniqueness(s: seq<AddressClaim>, c: AddressClaim)
  requires forall priorEntry :: priorEntry in s ==> |ProofLib.Filter((other: AddressClaim) => (other.wallet == priorEntry.wallet), s)| == 1
  ensures forall next :: next in ProofLib.Filter((priorEntry: AddressClaim) => (priorEntry.wallet != c.wallet), s) + [c] ==>
    |ProofLib.Filter((other: AddressClaim) => (other.wallet == next.wallet), ProofLib.Filter((priorEntry: AddressClaim) => (priorEntry.wallet != c.wallet), s) + [c])| == 1
{
  var kept := ProofLib.Filter((priorEntry: AddressClaim) => (priorEntry.wallet != c.wallet), s);
  UniqueClaimsByKey(s);
  ProofLib.FilterKeepsDistinctBy((priorEntry: AddressClaim) => (priorEntry.wallet != c.wallet), s, (r: AddressClaim) => r.wallet);
  forall i | 0 <= i < |kept| ensures kept[i].wallet != c.wallet {
    ProofLib.FilterMember((priorEntry: AddressClaim) => (priorEntry.wallet != c.wallet), s, kept[i]);
  }
  assert ProofLib.DistinctBy([c], (r: AddressClaim) => r.wallet);
  ProofLib.DistinctByConcat(kept, [c], (r: AddressClaim) => r.wallet);
  ClaimCountsByKey(kept + [c]);
}

lemma SameClaims(before: Distributor, after: Distributor)
  requires alwaysUniqueClaims(before) && before.claims == after.claims
  ensures stepClaimsRetained(before, after)
{
  forall c | c in before.claims ensures settlement__money_compareAmounts(claimedBy(after, c.wallet), c.cumulative) >= 0 {
    assert |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), before.claims)| == 1;
    ClaimLookupUnique(before.claims, c, settlement__money_zero);
    assert claimedBy(after, c.wallet) == c.cumulative;
    settlement__money_lawEqualReflexive_ensures(c.cumulative);
  }
}

lemma tick_ensures(d: Distributor, timestamp: int)
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysUnconfiguredEmpty(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysTimeValid(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysEpochRecords(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysRolesSeparate(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysMoneyValid(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysConserved(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysPaidMatchesClaims(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysUniqueClaims(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysSequentialEpochs(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> alwaysEpochTimes(tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> stepConfigurationFixed(d, tick(d, timestamp)))
  ensures (inv(d) ==> canTick(d, timestamp) ==> stepClaimsRetained(d, tick(d, timestamp)))
{
  if inv(d) && canTick(d, timestamp) {
    var after := tick(d, timestamp);
    SameClaims(d, after);
  }
}

lemma transferOwnership_ensures(d: Distributor, newOwner: string, by_: string)
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysUnconfiguredEmpty(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysTimeValid(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysEpochRecords(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysRolesSeparate(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysMoneyValid(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysConserved(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysPaidMatchesClaims(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysUniqueClaims(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysSequentialEpochs(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> alwaysEpochTimes(transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> stepConfigurationFixed(d, transferOwnership(d, newOwner, by_)))
  ensures (inv(d) ==> canTransferOwnership(d, newOwner, by_) ==> stepClaimsRetained(d, transferOwnership(d, newOwner, by_)))
{
  if inv(d) && canTransferOwnership(d, newOwner, by_) {
    var after := transferOwnership(d, newOwner, by_);
    SameClaims(d, after);
  }
}

lemma acceptOwnership_ensures(d: Distributor, by_: string)
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysUnconfiguredEmpty(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysTimeValid(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysEpochRecords(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysRolesSeparate(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysMoneyValid(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysConserved(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysPaidMatchesClaims(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysUniqueClaims(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysSequentialEpochs(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> alwaysEpochTimes(acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> stepConfigurationFixed(d, acceptOwnership(d, by_)))
  ensures (inv(d) ==> canAcceptOwnership(d, by_) ==> stepClaimsRetained(d, acceptOwnership(d, by_)))
{
  if inv(d) && canAcceptOwnership(d, by_) {
    var after := acceptOwnership(d, by_);
    SameClaims(d, after);
  }
}

lemma setPoster_ensures(d: Distributor, newPoster: string, by_: string)
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysUnconfiguredEmpty(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysTimeValid(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysEpochRecords(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysRolesSeparate(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysMoneyValid(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysConserved(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysPaidMatchesClaims(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysUniqueClaims(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysSequentialEpochs(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> alwaysEpochTimes(setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> stepConfigurationFixed(d, setPoster(d, newPoster, by_)))
  ensures (inv(d) ==> canSetPoster(d, newPoster, by_) ==> stepClaimsRetained(d, setPoster(d, newPoster, by_)))
{
  if inv(d) && canSetPoster(d, newPoster, by_) {
    var after := setPoster(d, newPoster, by_);
    SameClaims(d, after);
  }
}

lemma pause_ensures(d: Distributor, by_: string)
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysUnconfiguredEmpty(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysTimeValid(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysEpochRecords(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysRolesSeparate(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysMoneyValid(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysConserved(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysPaidMatchesClaims(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysUniqueClaims(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysSequentialEpochs(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> alwaysEpochTimes(pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> stepConfigurationFixed(d, pause(d, by_)))
  ensures (inv(d) ==> canPause(d, by_) ==> stepClaimsRetained(d, pause(d, by_)))
{
  if inv(d) && canPause(d, by_) {
    var after := pause(d, by_);
    SameClaims(d, after);
  }
}

lemma unpause_ensures(d: Distributor, by_: string)
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysUnconfiguredEmpty(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysTimeValid(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysEpochRecords(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysRolesSeparate(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysMoneyValid(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysConserved(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysPaidMatchesClaims(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysUniqueClaims(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysSequentialEpochs(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> alwaysEpochTimes(unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> stepConfigurationFixed(d, unpause(d, by_)))
  ensures (inv(d) ==> canUnpause(d, by_) ==> stepClaimsRetained(d, unpause(d, by_)))
{
  if inv(d) && canUnpause(d, by_) {
    var after := unpause(d, by_);
    SameClaims(d, after);
  }
}

lemma deposit_ensures(d: Distributor, amount: seq<int>, token: string, receipt: int, finalized: bool)
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysUnconfiguredEmpty(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysTimeValid(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysEpochRecords(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysRolesSeparate(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysMoneyValid(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysConserved(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysPaidMatchesClaims(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysUniqueClaims(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysSequentialEpochs(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> alwaysEpochTimes(deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> stepConfigurationFixed(d, deposit(d, amount, token, receipt, finalized)))
  ensures (inv(d) ==> canDeposit(d, amount, token, receipt, finalized) ==> stepClaimsRetained(d, deposit(d, amount, token, receipt, finalized)))
{
  if inv(d) && canDeposit(d, amount, token, receipt, finalized) {
    var after := deposit(d, amount, token, receipt, finalized);
    SameClaims(d, after);
    settlement__money_lawAdditionValid_ensures(d.balance, amount);
    settlement__money_lawAdditionValid_ensures(d.deposited, amount);
  }
}

lemma postRoot_ensures(d: Distributor, index: int, root: string, total: seq<int>, by_: string)
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysUnconfiguredEmpty(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysTimeValid(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysEpochRecords(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysRolesSeparate(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysMoneyValid(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysConserved(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysPaidMatchesClaims(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysUniqueClaims(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysSequentialEpochs(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> alwaysEpochTimes(postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> stepConfigurationFixed(d, postRoot(d, index, root, total, by_)))
  ensures (inv(d) ==> canPostRoot(d, index, root, total, by_) ==> stepClaimsRetained(d, postRoot(d, index, root, total, by_)))
{
  if inv(d) && canPostRoot(d, index, root, total, by_) {
    var after := postRoot(d, index, root, total, by_);
    SameClaims(d, after);
    var stepper := (acc: SequenceCheck, epoch: Epoch) => SequenceCheck((acc.next + 1), (acc.valid && (epoch.index == acc.next)));
    EpochSequenceCount(d.epochs, 0, true);
    ProofLib.FoldLeftAppend(stepper, emptySequenceCheck, d.epochs, Epoch(index, root, total, d.now, false));
  }
}

lemma voidLast_ensures(d: Distributor, index: int, by_: string)
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysUnconfiguredEmpty(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysTimeValid(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysEpochRecords(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysRolesSeparate(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysMoneyValid(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysConserved(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysPaidMatchesClaims(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysUniqueClaims(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysSequentialEpochs(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> alwaysEpochTimes(voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> stepConfigurationFixed(d, voidLast(d, index, by_)))
  ensures (inv(d) ==> canVoidLast(d, index, by_) ==> stepClaimsRetained(d, voidLast(d, index, by_)))
{
  if inv(d) && canVoidLast(d, index, by_) {
    var after := voidLast(d, index, by_);
    SameClaims(d, after);
    assert |after.epochs| == |d.epochs|;
    assert forall i :: 0 <= i < |d.epochs| ==> d.epochs[i].index == after.epochs[i].index by {
      forall i | 0 <= i < |d.epochs| ensures d.epochs[i].index == after.epochs[i].index {
        assert after.epochs[i] == (if d.epochs[i].index == index then d.epochs[i].(voided := true) else d.epochs[i]);
      }
    }
    EpochSequenceUnchanged(d.epochs, after.epochs);
  }
}

lemma rescue_ensures(d: Distributor, destination: string, transferExact: bool, by_: string)
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysUnconfiguredEmpty(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysTimeValid(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysEpochRecords(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysRolesSeparate(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysMoneyValid(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysConserved(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysPaidMatchesClaims(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysUniqueClaims(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysSequentialEpochs(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> alwaysEpochTimes(rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> stepConfigurationFixed(d, rescue(d, destination, transferExact, by_)))
  ensures (inv(d) ==> canRescue(d, destination, transferExact, by_) ==> stepClaimsRetained(d, rescue(d, destination, transferExact, by_)))
{
  if inv(d) && canRescue(d, destination, transferExact, by_) {
    var after := rescue(d, destination, transferExact, by_);
    SameClaims(d, after);
    settlement__money_lawAdditionValid_ensures(d.rescued, d.balance);
  }
}

lemma claim_ensures(d: Distributor, wallet: string, cumulative: seq<int>, proofRoot: string, verified: bool, transferExact: bool, by_: string)
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysUnconfiguredEmpty(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysTimeValid(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysEpochRecords(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysRolesSeparate(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysMoneyValid(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysConserved(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysPaidMatchesClaims(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysUniqueClaims(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysSequentialEpochs(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> alwaysEpochTimes(claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> stepConfigurationFixed(d, claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
  ensures (inv(d) ==> canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) ==> stepClaimsRetained(d, claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_)))
{
  if inv(d) && canClaim(d, wallet, cumulative, proofRoot, verified, transferExact, by_) {
    var after := claim(d, wallet, cumulative, proofRoot, verified, transferExact, by_);
    var entry := AddressClaim(wallet, cumulative);
    var keep := (old_: AddressClaim) => old_.wallet != wallet;
    var kept := ProofLib.Filter(keep, d.claims);
    assert after.claims == kept + [entry];
    assert forall c :: c in d.claims ==> |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), d.claims)| == 1;
    ReplacingClaimKeepsUniqueness(d.claims, entry);
    assert alwaysUniqueClaims(after);
    forall c | c in after.claims ensures c.wallet != "" && settlement__money_validAmount(c.cumulative) {
      if c != entry {
        assert c in kept;
        ProofLib.FilterMember(keep, d.claims, c);
      }
    }
    if !((liveRoot(d).index >= 0) && (liveRoot(d).root == proofRoot) && verified &&
      settlement__money_validAmount(cumulative) && settlement__money_compareAmounts(cumulative, claimedBy(d, wallet)) > 0 &&
      settlement__money_compareAmounts(settlement__money_addAmounts(d.paid, claimDifference(d, wallet, cumulative)), liveRoot(d).total) <= 0) {
      assert rawClaimable(d, wallet, cumulative, proofRoot, verified) == settlement__money_zero;
      settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
      assert false;
    }
    assert entry in after.claims;
    ClaimLookupUnique(after.claims, entry, settlement__money_zero);
    assert claimedBy(after, wallet) == cumulative;
    forall c | c in d.claims ensures settlement__money_compareAmounts(claimedBy(after, c.wallet), c.cumulative) >= 0 {
      assert |ProofLib.Filter((other: AddressClaim) => (other.wallet == c.wallet), d.claims)| == 1;
      ClaimLookupUnique(d.claims, c, settlement__money_zero);
      assert claimedBy(d, c.wallet) == c.cumulative;
      if c.wallet != wallet {
        ProofLib.FilterMember(keep, d.claims, c);
        assert c in after.claims;
        ClaimLookupUnique(after.claims, c, settlement__money_zero);
        assert claimedBy(after, c.wallet) == c.cumulative;
        settlement__money_lawEqualReflexive_ensures(c.cumulative);
      }
    }
    var previous := claimedBy(d, wallet);
    if exists priorEntry :: priorEntry in d.claims && priorEntry.wallet == wallet {
      var priorEntry :| priorEntry in d.claims && priorEntry.wallet == wallet;
      ClaimLookupUnique(d.claims, priorEntry, settlement__money_zero);
      assert previous == priorEntry.cumulative;
    } else {
      ClaimLookupWithoutKey(d.claims, wallet, settlement__money_zero);
      assert previous == settlement__money_zero;
    }
    assert settlement__money_validAmount(previous);
    settlement__money_lawSubtractionValid_ensures(cumulative, previous);
    var amount := claimDifference(d, wallet, cumulative);
    assert settlement__money_validAmount(amount);
    settlement__money_lawSubtractionValid_ensures(d.balance, amount);
    settlement__money_lawAdditionValid_ensures(d.paid, amount);
    assert stepClaimsRetained(d, after);
  }
}
