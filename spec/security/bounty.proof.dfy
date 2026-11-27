lemma OpenVaultGrossMeaning(b: Bounty)
  ensures openVaultGross(b) == Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, b.holds)
{
}

lemma OpenVaultGrossValidFold(b: Bounty, hs: seq<Hold>)
  requires forall h :: h in hs && h.kind.VaultHold? ==> settlement__money_validAmount(caseOf(b, h.caseId).grossChosen)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, hs))
  decreases |hs|
{
  var f := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  if |hs| == 0 {
  } else {
    var init := hs[..|hs| - 1];
    var last := hs[|hs| - 1];
    assert hs == init + [last];
    OpenVaultGrossValidFold(b, init);
    ProofLib.FoldLeftAppend(f, settlement__money_zero, init, last);
    if last.kind.VaultHold? && last.settledReceipt == 0 {
      settlement__money_lawAdditionValid_ensures(Std.Collections.Seq.FoldLeft(f, settlement__money_zero, init), caseOf(b, last.caseId).grossChosen);
    }
  }
}

lemma OpenVaultGrossUnchanged(b: Bounty, nb: Bounty)
  requires b.holds == nb.holds
  requires forall h :: h in b.holds && h.kind.VaultHold? ==> caseOf(nb, h.caseId).grossChosen == caseOf(b, h.caseId).grossChosen
  ensures openVaultGross(nb) == openVaultGross(b)
{
  OpenVaultGrossMeaning(b);
  OpenVaultGrossMeaning(nb);
  var f1 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  var f2 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(nb, h.caseId).grossChosen) else total);
  ProofLib.FoldLeftPointwise(f1, f2, settlement__money_zero, b.holds, nb.holds);
}

lemma FoldDropNonVault(b: Bounty, hs: seq<Hold>, id: int)
  requires forall h :: h in hs && h.caseId == id ==> !h.kind.VaultHold?
  ensures Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, ProofLib.Filter((h: Hold) => (h.caseId != id), hs))
       == Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, hs)
  decreases |hs|
{
  var f := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  var p := (h: Hold) => (h.caseId != id);
  if |hs| == 0 {
    ProofLib.FilterNil(p, hs);
  } else {
    var init := hs[..|hs| - 1];
    var last := hs[|hs| - 1];
    assert hs == init + [last];
    FoldDropNonVault(b, init, id);
    ProofLib.FilterAppend(p, init, last);
    ProofLib.FoldLeftAppend(f, settlement__money_zero, init, last);
    if p(last) {
      ProofLib.FoldLeftAppend(f, settlement__money_zero, ProofLib.Filter(p, init), last);
    } else {
      assert ProofLib.Filter(p, init) + [] == ProofLib.Filter(p, init);
    }
  }
}

lemma CompareFoldZero(a: seq<int>, b: seq<int>, xs: seq<int>)
  ensures Std.Collections.Seq.FoldLeft((acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1))), settlement__money_CompareFold(0, 0), xs).index == |xs|
  ensures (Std.Collections.Seq.FoldLeft((acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1))), settlement__money_CompareFold(0, 0), xs).comparison == 0)
       <==> (forall i :: 0 <= i < |xs| ==> (if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0))
  decreases |xs|
{
  var f := (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1)));
  var z := settlement__money_CompareFold(0, 0);
  if |xs| == 0 {
  } else {
    var init := xs[..|xs| - 1];
    var last := xs[|xs| - 1];
    assert xs == init + [last];
    CompareFoldZero(a, b, init);
    ProofLib.FoldLeftAppend(f, z, init, last);
  }
}

lemma EqualToValidPositiveIsValid(r: seq<int>, g: seq<int>)
  requires settlement__money_validAmount(g) && settlement__money_positiveAmount(g) && settlement__money_equalAmounts(r, g)
  ensures settlement__money_validAmount(r)
{
  var longest := if |r| >= |g| then r else g;
  CompareFoldZero(r, g, longest);
  assert |settlement__money_zero| == 1 && settlement__money_zero[0] == 0;
  CompareFoldZero(g, settlement__money_zero, g);
  var j :| 0 <= j < |g| && g[j] != 0;
  assert (if j < |r| then r[j] else 0) == g[j];
  assert j < |r| && |r| > 0;
  forall i | 0 <= i < |r|
    ensures 0 <= r[i] < 1000
  {
    assert r[i] == (if i < |g| then g[i] else 0);
    if i < |g| {
      assert g[i] in g;
    }
  }
}

lemma OpenVaultGrossSettleFold(b: Bounty, hs: seq<Hold>, ks: seq<Hold>, idx: int, g: seq<int>)
  requires |ks| == |hs| && 0 <= idx < |hs|
  requires hs[idx].kind.VaultHold? && hs[idx].settledReceipt == 0
  requires ks[idx].settledReceipt != 0 && ks[idx].caseId == hs[idx].caseId
  requires caseOf(b, hs[idx].caseId).grossChosen == g && settlement__money_validAmount(g)
  requires forall i :: 0 <= i < |hs| && i != idx ==> ks[i] == hs[i]
  requires forall h :: h in hs && h.kind.VaultHold? ==> settlement__money_validAmount(caseOf(b, h.caseId).grossChosen)
  ensures settlement__money_equalAmounts(
    Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, hs),
    settlement__money_addAmounts(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total), settlement__money_zero, ks), g))
  decreases |hs|
{
  hide *;
  reveal settlement__money_equalAmounts, settlement__money_validAmount, settlement__money_zero,
    settlement__money_lawAdditionValid, settlement__money_lawAddCongruence, settlement__money_lawAddAssociative,
    settlement__money_lawAddCommutative, settlement__money_lawEqualReflexive,
    settlement__money_lawEqualSymmetric, settlement__money_lawEqualSubstitution;
  var f := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  var initH := hs[..|hs| - 1];
  var initK := ks[..|ks| - 1];
  var lastH := hs[|hs| - 1];
  var lastK := ks[|ks| - 1];
  assert hs == initH + [lastH] && ks == initK + [lastK];
  ProofLib.FoldLeftAppend(f, settlement__money_zero, initH, lastH);
  ProofLib.FoldLeftAppend(f, settlement__money_zero, initK, lastK);
  if |hs| == idx + 1 {
    assert initH == initK;
    settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, settlement__money_zero, initH), g));
  } else {
    assert lastH == lastK;
    OpenVaultGrossSettleFold(b, initH, initK, idx, g);
    if lastH.kind.VaultHold? && lastH.settledReceipt == 0 {
      var H := Std.Collections.Seq.FoldLeft(f, settlement__money_zero, initH);
      var K := Std.Collections.Seq.FoldLeft(f, settlement__money_zero, initK);
      var v := caseOf(b, lastH.caseId).grossChosen;
      forall h | h in initK
        ensures h.kind.VaultHold? ==> settlement__money_validAmount(caseOf(b, h.caseId).grossChosen)
      {
        var pos :| 0 <= pos < |initK| && initK[pos] == h;
        assert hs[pos] in hs;
      }
      OpenVaultGrossValidFold(b, initH);
      OpenVaultGrossValidFold(b, initK);
      settlement__money_lawAdditionValid_ensures(K, g);
      settlement__money_lawAdditionValid_ensures(K, v);
      settlement__money_lawAddCongruence_ensures(H, settlement__money_addAmounts(K, g), v);
      settlement__money_lawAddAssociative_ensures(K, g, v);
      settlement__money_lawAddCommutative_ensures(g, v);
      settlement__money_lawAddAssociative_ensures(K, v, g);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(K, v), g), settlement__money_addAmounts(K, settlement__money_addAmounts(v, g)));
      settlement__money_lawEqualSubstitution_ensures(settlement__money_addAmounts(settlement__money_addAmounts(K, g), v), settlement__money_addAmounts(K, settlement__money_addAmounts(g, v)), settlement__money_addAmounts(H, v));
      settlement__money_lawEqualSubstitution_ensures(settlement__money_addAmounts(K, settlement__money_addAmounts(v, g)), settlement__money_addAmounts(settlement__money_addAmounts(K, v), g), settlement__money_addAmounts(H, v));
    }
  }
}

lemma observeAuthority_ensures(b: Bounty, snapshot: security__cases_Authority)
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysFundsObserved(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysReservedIsOpenVaultHolds(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysOneHoldPerRootCause(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysCasesKeepAwardRules(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysFullAwardBindsNoVault(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> alwaysHoldsMatchCases(observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> stepVaultHoldsKept(b, observeAuthority(b, snapshot)))
  ensures (inv(b) ==> canObserveAuthority(b, snapshot) ==> stepHoldsNeedClearance(b, observeAuthority(b, snapshot)))
{
  if inv(b) && canObserveAuthority(b, snapshot) {
    OpenVaultGrossUnchanged(b, observeAuthority(b, snapshot));
  }
}

lemma advanceClock_ensures(b: Bounty, nowMs: int)
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysFundsObserved(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysReservedIsOpenVaultHolds(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysOneHoldPerRootCause(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysCasesKeepAwardRules(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysFullAwardBindsNoVault(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> alwaysHoldsMatchCases(advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> stepVaultHoldsKept(b, advanceClock(b, nowMs)))
  ensures (inv(b) ==> canAdvanceClock(b, nowMs) ==> stepHoldsNeedClearance(b, advanceClock(b, nowMs)))
{
  if inv(b) && canAdvanceClock(b, nowMs) {
    OpenVaultGrossUnchanged(b, advanceClock(b, nowMs));
  }
}

lemma observeFunds_ensures(b: Bounty, funds: FundsSnapshot)
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysFundsObserved(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysReservedIsOpenVaultHolds(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysOneHoldPerRootCause(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysCasesKeepAwardRules(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysFullAwardBindsNoVault(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> alwaysHoldsMatchCases(observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> stepVaultHoldsKept(b, observeFunds(b, funds)))
  ensures (inv(b) ==> canObserveFunds(b, funds) ==> stepHoldsNeedClearance(b, observeFunds(b, funds)))
{
  if inv(b) && canObserveFunds(b, funds) {
    OpenVaultGrossUnchanged(b, observeFunds(b, funds));
  }
}

lemma observeRoute_ensures(b: Bounty, route: RouteObservation)
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysFundsObserved(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysReservedIsOpenVaultHolds(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysOneHoldPerRootCause(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysCasesKeepAwardRules(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysFullAwardBindsNoVault(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> alwaysHoldsMatchCases(observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> stepVaultHoldsKept(b, observeRoute(b, route)))
  ensures (inv(b) ==> canObserveRoute(b, route) ==> stepHoldsNeedClearance(b, observeRoute(b, route)))
{
  if inv(b) && canObserveRoute(b, route) {
    OpenVaultGrossUnchanged(b, observeRoute(b, route));
  }
}

lemma receive_ensures(b: Bounty, id: int, source: security__cases_ReceiptSource, terms: security__terms_ReceiptTerms, reportVersion: int)
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysFundsObserved(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysReservedIsOpenVaultHolds(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysOneHoldPerRootCause(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysCasesKeepAwardRules(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysFullAwardBindsNoVault(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> alwaysHoldsMatchCases(receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> stepVaultHoldsKept(b, receive(b, id, source, terms, reportVersion)))
  ensures (inv(b) ==> canReceive(b, id, source, terms, reportVersion) ==> stepHoldsNeedClearance(b, receive(b, id, source, terms, reportVersion)))
{
  if inv(b) && canReceive(b, id, source, terms, reportVersion) {
    OpenVaultGrossUnchanged(b, receive(b, id, source, terms, reportVersion));
  }
}

lemma claim_ensures(b: Bounty, id: int, by_: int)
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysFundsObserved(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysReservedIsOpenVaultHolds(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysOneHoldPerRootCause(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysCasesKeepAwardRules(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysFullAwardBindsNoVault(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> alwaysHoldsMatchCases(claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> stepVaultHoldsKept(b, claim(b, id, by_)))
  ensures (inv(b) ==> canClaim(b, id, by_) ==> stepHoldsNeedClearance(b, claim(b, id, by_)))
{
  if inv(b) && canClaim(b, id, by_) {
    OpenVaultGrossUnchanged(b, claim(b, id, by_));
  }
}

lemma verifyLink_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms)
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysFundsObserved(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysReservedIsOpenVaultHolds(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysOneHoldPerRootCause(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysCasesKeepAwardRules(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysFullAwardBindsNoVault(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> alwaysHoldsMatchCases(verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> stepVaultHoldsKept(b, verifyLink(b, id, by_, checkedEpoch, terms)))
  ensures (inv(b) ==> canVerifyLink(b, id, by_, checkedEpoch, terms) ==> stepHoldsNeedClearance(b, verifyLink(b, id, by_, checkedEpoch, terms)))
{
  if inv(b) && canVerifyLink(b, id, by_, checkedEpoch, terms) {
    OpenVaultGrossUnchanged(b, verifyLink(b, id, by_, checkedEpoch, terms));
  }
}

lemma rejectLink_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int)
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysFundsObserved(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysReservedIsOpenVaultHolds(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysOneHoldPerRootCause(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysCasesKeepAwardRules(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysFullAwardBindsNoVault(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> alwaysHoldsMatchCases(rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> stepVaultHoldsKept(b, rejectLink(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canRejectLink(b, id, by_, checkedEpoch) ==> stepHoldsNeedClearance(b, rejectLink(b, id, by_, checkedEpoch)))
{
  if inv(b) && canRejectLink(b, id, by_, checkedEpoch) {
    OpenVaultGrossUnchanged(b, rejectLink(b, id, by_, checkedEpoch));
  }
}

lemma recordAttested_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms, confirmed: bool)
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysFundsObserved(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysReservedIsOpenVaultHolds(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysOneHoldPerRootCause(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysCasesKeepAwardRules(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysFullAwardBindsNoVault(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> alwaysHoldsMatchCases(recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> stepVaultHoldsKept(b, recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(b) ==> canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) ==> stepHoldsNeedClearance(b, recordAttested(b, id, by_, checkedEpoch, terms, confirmed)))
{
  if inv(b) && canRecordAttested(b, id, by_, checkedEpoch, terms, confirmed) {
    OpenVaultGrossUnchanged(b, recordAttested(b, id, by_, checkedEpoch, terms, confirmed));
  }
}

lemma settleClaim_ensures(b: Bounty, id: int, by_: int, listed: bool, terms: security__terms_ReceiptTerms)
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysFundsObserved(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysReservedIsOpenVaultHolds(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysOneHoldPerRootCause(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysCasesKeepAwardRules(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysFullAwardBindsNoVault(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> alwaysHoldsMatchCases(settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> stepVaultHoldsKept(b, settleClaim(b, id, by_, listed, terms)))
  ensures (inv(b) ==> canSettleClaim(b, id, by_, listed, terms) ==> stepHoldsNeedClearance(b, settleClaim(b, id, by_, listed, terms)))
{
  if inv(b) && canSettleClaim(b, id, by_, listed, terms) {
    OpenVaultGrossUnchanged(b, settleClaim(b, id, by_, listed, terms));
  }
}

lemma decide_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, version: int, decision: security__cases_Decision)
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysFundsObserved(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysReservedIsOpenVaultHolds(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysOneHoldPerRootCause(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysCasesKeepAwardRules(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysFullAwardBindsNoVault(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> alwaysHoldsMatchCases(decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> stepVaultHoldsKept(b, decide(b, id, by_, checkedEpoch, version, decision)))
  ensures (inv(b) ==> canDecide(b, id, by_, checkedEpoch, version, decision) ==> stepHoldsNeedClearance(b, decide(b, id, by_, checkedEpoch, version, decision)))
{
  if inv(b) && canDecide(b, id, by_, checkedEpoch, version, decision) {
    OpenVaultGrossUnchanged(b, decide(b, id, by_, checkedEpoch, version, decision));
  }
}

lemma declineAward_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int)
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysFundsObserved(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysReservedIsOpenVaultHolds(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysOneHoldPerRootCause(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysCasesKeepAwardRules(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysFullAwardBindsNoVault(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> alwaysHoldsMatchCases(declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> stepVaultHoldsKept(b, declineAward(b, id, by_, checkedEpoch)))
  ensures (inv(b) ==> canDeclineAward(b, id, by_, checkedEpoch) ==> stepHoldsNeedClearance(b, declineAward(b, id, by_, checkedEpoch)))
{
  if inv(b) && canDeclineAward(b, id, by_, checkedEpoch) {
    OpenVaultGrossUnchanged(b, declineAward(b, id, by_, checkedEpoch));
  }
}

lemma appeal_ensures(b: Bounty, id: int, by_: int)
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysFundsObserved(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysReservedIsOpenVaultHolds(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysOneHoldPerRootCause(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysCasesKeepAwardRules(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysFullAwardBindsNoVault(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> alwaysHoldsMatchCases(appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> stepVaultHoldsKept(b, appeal(b, id, by_)))
  ensures (inv(b) ==> canAppeal(b, id, by_) ==> stepHoldsNeedClearance(b, appeal(b, id, by_)))
{
  if inv(b) && canAppeal(b, id, by_) {
    OpenVaultGrossUnchanged(b, appeal(b, id, by_));
  }
}

lemma decideAppeal_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, uphold: bool)
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysFundsObserved(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysReservedIsOpenVaultHolds(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysOneHoldPerRootCause(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysCasesKeepAwardRules(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysFullAwardBindsNoVault(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> alwaysHoldsMatchCases(decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> stepVaultHoldsKept(b, decideAppeal(b, id, by_, checkedEpoch, uphold)))
  ensures (inv(b) ==> canDecideAppeal(b, id, by_, checkedEpoch, uphold) ==> stepHoldsNeedClearance(b, decideAppeal(b, id, by_, checkedEpoch, uphold)))
{
  if inv(b) && canDecideAppeal(b, id, by_, checkedEpoch, uphold) {
    OpenVaultGrossUnchanged(b, decideAppeal(b, id, by_, checkedEpoch, uphold));
  }
}

lemma OneHoldMeaning(b: Bounty)
  ensures alwaysOneHoldPerRootCause(b) ==
    !((exists h :: h in b.holds && !((!((exists g :: g in b.holds && !((!(((g.rootCause == h.rootCause) || (g.caseId == h.caseId))) || (g == h))))) && (|ProofLib.Filter((g: Hold) => (g.caseId == h.caseId), b.holds)| == 1)))))
{
}

lemma settleVaultHold_ensures(b: Bounty, id: int, receipt: VaultPayout)
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysFundsObserved(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysReservedIsOpenVaultHolds(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysOneHoldPerRootCause(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysCasesKeepAwardRules(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysFullAwardBindsNoVault(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> alwaysHoldsMatchCases(settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> stepVaultHoldsKept(b, settleVaultHold(b, id, receipt)))
  ensures (inv(b) ==> canSettleVaultHold(b, id, receipt) ==> stepHoldsNeedClearance(b, settleVaultHold(b, id, receipt)))
{
  hide *;
  reveal inv, canSettleVaultHold, settleVaultHold, openVaultHold, known, caseIds, caseOf,
    alwaysFundsObserved, alwaysReservedIsOpenVaultHolds, alwaysCasesKeepAwardRules,
    alwaysFullAwardBindsNoVault, alwaysHoldsMatchCases, holdMatches, hasHold,
    stepVaultHoldsKept, stepHoldsNeedClearance,
    settlement__money_equalAmounts, settlement__money_validAmount, settlement__money_positiveAmount,
    settlement__money_lawSubtractionValid, settlement__money_lawEqualSymmetric,
    settlement__money_lawAddCongruence, settlement__money_lawEqualSubstitution,
    settlement__money_lawSubtractionReconstructs, settlement__money_lawAddOrder,
    settlement__money_lawAdditionValid;
  if inv(b) && canSettleVaultHold(b, id, receipt) {
    var nb := settleVaultHold(b, id, receipt);
    var h0 :| h0 in b.holds && h0.caseId == id && h0.kind.VaultHold? && h0.settledReceipt == 0;
    var idx :| 0 <= idx < |b.holds| && b.holds[idx] == h0;
    OneHoldMeaning(b);
    forall i | 0 <= i < |b.holds| && i != idx
      ensures b.holds[i].caseId != id && nb.holds[i] == b.holds[i]
    {
      if b.holds[i].caseId == id {
        ProofLib.FilterTwo((g: Hold) => (g.caseId == id), b.holds, i, idx);
      }
    }
    forall i | 0 <= i < |b.holds|
      ensures nb.holds[i].caseId == b.holds[i].caseId && nb.holds[i].kind == b.holds[i].kind && nb.holds[i].rootCause == b.holds[i].rootCause && nb.holds[i].fundsObservedAt == b.holds[i].fundsObservedAt
      ensures nb.holds[i].settledReceipt == 0 || nb.holds[i].kind.VaultHold?
    {
    }
    forall other | other in caseIds
      ensures hasHold(nb, other) == hasHold(b, other)
    {
      if hasHold(b, other) {
        var x :| x in b.holds && x.caseId == other;
        var pos :| 0 <= pos < |b.holds| && b.holds[pos] == x;
        assert nb.holds[pos] in nb.holds && nb.holds[pos].caseId == other;
      }
      if hasHold(nb, other) {
        var x :| x in nb.holds && x.caseId == other;
        var pos :| 0 <= pos < |nb.holds| && nb.holds[pos] == x;
        assert b.holds[pos] in b.holds && b.holds[pos].caseId == other;
      }
    }
    forall h | h in nb.holds
      ensures |ProofLib.Filter((g: Hold) => (g.caseId == h.caseId), nb.holds)| == 1
      ensures holdMatches(nb, h)
      ensures (h.kind.VaultHold? || h.kind.DirectHold?) ==> caseOf(nb, h.caseId).terms.split.StandardSplit?
      ensures h.kind.VaultHold? ==> settlement__money_validAmount(caseOf(nb, h.caseId).grossChosen) && settlement__money_positiveAmount(caseOf(nb, h.caseId).grossChosen)
    {
      var j :| 0 <= j < |nb.holds| && nb.holds[j] == h;
      assert b.holds[j] in b.holds && b.holds[j].caseId == h.caseId;
      ProofLib.FilterLengthPointwise((g: Hold) => (g.caseId == h.caseId), (g: Hold) => (g.caseId == h.caseId), b.holds, nb.holds);
    }
    forall h | h in nb.holds
      ensures forall g :: g in nb.holds && (g.rootCause == h.rootCause || g.caseId == h.caseId) ==> g == h
    {
      var j1 :| 0 <= j1 < |nb.holds| && nb.holds[j1] == h;
      forall g | g in nb.holds && (g.rootCause == h.rootCause || g.caseId == h.caseId)
        ensures g == h
      {
        var j2 :| 0 <= j2 < |nb.holds| && nb.holds[j2] == g;
        assert b.holds[j1] in b.holds && b.holds[j2] in b.holds;
        assert b.holds[j1] == b.holds[j2];
        if j1 != j2 {
          ProofLib.FilterTwo((x: Hold) => (x.caseId == b.holds[j1].caseId), b.holds, j1, j2);
        }
      }
    }
    OneHoldMeaning(nb);
    forall h | h in b.holds && h.kind.VaultHold?
      ensures exists g :: g in nb.holds && g.caseId == h.caseId && g.kind.VaultHold? && g.rootCause == h.rootCause && (h.settledReceipt == 0 || g == h)
    {
      var j :| 0 <= j < |b.holds| && b.holds[j] == h;
      assert nb.holds[j] in nb.holds;
    }
    forall h | h in nb.holds
      ensures h in b.holds || h.(settledReceipt := 0) in b.holds
    {
      var j :| 0 <= j < |nb.holds| && nb.holds[j] == h;
      if j == idx {
        assert h.(settledReceipt := 0) == h0;
      }
    }
    var g := caseOf(b, id).grossChosen;
    EqualToValidPositiveIsValid(receipt.gross, g);
    OpenVaultGrossMeaning(b);
    OpenVaultGrossMeaning(nb);
    var f1 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
    var f2 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(nb, h.caseId).grossChosen) else total);
    ProofLib.FoldLeftPointwise(f2, f1, settlement__money_zero, nb.holds, nb.holds);
    OpenVaultGrossSettleFold(b, b.holds, nb.holds, idx, g);
    OpenVaultGrossValidFold(b, b.holds);
    OpenVaultGrossValidFold(b, nb.holds);
    var X := openVaultGross(nb);
    var B := b.reserved;
    var R := receipt.gross;
    settlement__money_lawSubtractionValid_ensures(B, R);
    settlement__money_lawAdditionValid_ensures(X, g);
    settlement__money_lawAdditionValid_ensures(X, R);
    settlement__money_lawEqualSymmetric_ensures(R, g);
    settlement__money_lawAddCongruence_ensures(g, R, X);
    settlement__money_lawEqualSubstitution_ensures(openVaultGross(b), settlement__money_addAmounts(X, g), B);
    settlement__money_lawEqualSubstitution_ensures(settlement__money_addAmounts(X, g), settlement__money_addAmounts(X, R), B);
    settlement__money_lawSubtractionReconstructs_ensures(B, R);
    settlement__money_lawEqualSubstitution_ensures(B, settlement__money_addAmounts(X, R), settlement__money_addAmounts(nb.reserved, R));
    settlement__money_lawAddOrder_ensures(nb.reserved, X, R);
    assert settlement__money_equalAmounts(nb.reserved, X);
  }
}

lemma decideAward_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysFundsObserved(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysReservedIsOpenVaultHolds(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysOneHoldPerRootCause(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysCasesKeepAwardRules(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysFullAwardBindsNoVault(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> alwaysHoldsMatchCases(decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> stepVaultHoldsKept(b, decideAward(b, id, by_, checkedEpoch, amount)))
  ensures (inv(b) ==> canDecideAward(b, id, by_, checkedEpoch, amount) ==> stepHoldsNeedClearance(b, decideAward(b, id, by_, checkedEpoch, amount)))
{
  hide *;
  reveal inv, canDecideAward, decideAward, withHold, putCase, caseOf, known, caseIds,
    clearanceFor, railFor, fundsFresh, hasHold, rootCauseFree, firstQualifying,
    alwaysFundsObserved, alwaysCasesKeepAwardRules, alwaysHoldsMatchCases, holdMatches,
    security__cases_canDecideAward, security__cases_decideAward, security__cases_committedWith,
    security__cases_mayStartCommitment, security__cases_awardOpen, security__cases_committed,
    security__cases_alwaysProposalCommitsNothing, security__cases_alwaysCommitmentMatchesAward,
    security__cases_alwaysFullAwardHeld, security__cases_alwaysStandardAwardRail,
    security__cases_alwaysUnpaidHasNoAward, security__cases_alwaysVerifiedReceiptValid,
    security__cases_alwaysUnreceivedBlank, security__cases_alwaysConfirmedHasRootCause,
    security__cases_alwaysAppealState, security__cases_alwaysAppealSource,
    security__cases_alwaysCommittedFindingStands, security__cases_receiptOpen,
    security__terms_amountAllowed, security__terms_validPaidTerms;
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
    RecordedHoldReserved(id, after, amount, b);
  }
}

lemma reviewRelated_ensures(b: Bounty, id: int, by_: int, checkedEpoch: int, approve: bool)
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysFundsObserved(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysReservedIsOpenVaultHolds(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysOneHoldPerRootCause(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysCasesKeepAwardRules(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysFullAwardBindsNoVault(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> alwaysHoldsMatchCases(reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> stepVaultHoldsKept(b, reviewRelated(b, id, by_, checkedEpoch, approve)))
  ensures (inv(b) ==> canReviewRelated(b, id, by_, checkedEpoch, approve) ==> stepHoldsNeedClearance(b, reviewRelated(b, id, by_, checkedEpoch, approve)))
{
  hide *;
  reveal inv, canReviewRelated, reviewRelated, withHold, putCase, caseOf, known, caseIds,
    clearanceFor, railFor, fundsFresh, hasHold, rootCauseFree, firstQualifying,
    alwaysFundsObserved, alwaysCasesKeepAwardRules, alwaysHoldsMatchCases, holdMatches,
    security__cases_canReviewRelated, security__cases_reviewRelated, security__cases_committedWith,
    security__cases_mayStartCommitment, security__cases_committed,
    security__cases_alwaysProposalCommitsNothing, security__cases_alwaysCommitmentMatchesAward,
    security__cases_alwaysFullAwardHeld, security__cases_alwaysStandardAwardRail,
    security__cases_alwaysUnpaidHasNoAward, security__cases_alwaysVerifiedReceiptValid,
    security__cases_alwaysUnreceivedBlank, security__cases_alwaysConfirmedHasRootCause,
    security__cases_alwaysAppealState, security__cases_alwaysAppealSource,
    security__cases_alwaysCommittedFindingStands, security__cases_receiptOpen,
    security__terms_amountAllowed, security__terms_validPaidTerms;
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
      RecordedHoldReserved(id, after, gross, b);
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

lemma RecordedHoldReserved(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: Bounty)
  requires inv(b) && known(id)
  requires forall h :: h in b.holds && h.caseId == id ==> !h.kind.VaultHold?
  requires after.commitment.VaultReservation? ==> after.grossChosen == amount && settlement__money_validAmount(amount) && settlement__money_positiveAmount(amount)
  ensures alwaysReservedIsOpenVaultHolds(withHold(id, after, amount, b))
{
  var nb := withHold(id, after, amount, b);
  var nh := holdFor(b, id, after);
  var p := (h: Hold) => (h.caseId != id);
  var kept := ProofLib.Filter(p, b.holds);
  RecordedHoldMembers(id, after, amount, b, nh);
  assert nb.holds == kept + [nh];
  forall h | h in kept
    ensures h in b.holds && h.caseId != id && caseOf(nb, h.caseId) == caseOf(b, h.caseId)
  {
    ProofLib.FilterMember(p, b.holds, h);
    OtherCaseUnchanged(id, after, b, h.caseId);
  }
  OpenVaultGrossMeaning(b);
  OpenVaultGrossMeaning(nb);
  var f1 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  var f2 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(nb, h.caseId).grossChosen) else total);
  FoldDropNonVault(b, b.holds, id);
  ProofLib.FoldLeftPointwise(f2, f1, settlement__money_zero, kept, kept);
  ProofLib.FoldLeftAppend(f2, settlement__money_zero, kept, nh);
  if after.commitment.VaultReservation? {
    OpenVaultGrossValidFold(b, b.holds);
    settlement__money_lawAdditionValid_ensures(b.reserved, amount);
    settlement__money_lawAddCongruence_ensures(b.reserved, openVaultGross(b), amount);
  }
  forall h | h in nb.holds
    ensures (h.settledReceipt == 0 || h.kind.VaultHold?)
    ensures h.kind.VaultHold? ==> settlement__money_validAmount(caseOf(nb, h.caseId).grossChosen) && settlement__money_positiveAmount(caseOf(nb, h.caseId).grossChosen)
  {
    if h == nh {
      assert caseOf(nb, id) == after;
    } else {
      assert h in kept;
    }
  }
}

lemma RecordedHoldMembers(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: Bounty, x: Hold)
  ensures withHold(id, after, amount, b).holds == ProofLib.Filter((h: Hold) => (h.caseId != id), b.holds) + [holdFor(b, id, after)]
  ensures x in withHold(id, after, amount, b).holds <==> (x in b.holds && x.caseId != id) || x == holdFor(b, id, after)
{
  ProofLib.FilterMember((h: Hold) => (h.caseId != id), b.holds, x);
}

lemma RefusedHolds(b: Bounty, id: int, by_: int, checkedEpoch: int)
  ensures reviewRelated(b, id, by_, checkedEpoch, false).holds == ProofLib.Filter((h: Hold) => (h.caseId != id), b.holds)
{
}

lemma OtherCaseUnchanged(id: int, after: security__cases_PrivateCase, b: Bounty, other: int)
  requires known(id) && known(other) && other != id
  ensures caseOf(putCase(id, after, b), other) == caseOf(b, other)
  ensures caseOf(putCase(id, after, b), id) == after
{
}

lemma RecordedHoldKeepsRules(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: Bounty)
  requires inv(b)
  requires known(id)
  requires after.rootCause == caseOf(b, id).rootCause && after.rootCause > 0
  requires rootCauseFree(b, id) && firstQualifying(b, id) && !caseOf(b, id).authority.programRestricted
  requires security__cases_committed(after) || after.relatedReview.ReviewPending?
  requires after.commitment.NoCommitment? ==> after.relatedReview.ReviewPending?
  requires after.commitment.VaultReservation? ==> b.funds.observedAt > 0
  requires (after.commitment.VaultReservation? || after.commitment.DirectAward?) ==> after.terms.split.StandardSplit?
  requires forall h :: h in b.holds && h.caseId == id ==> !h.kind.VaultHold?
  ensures alwaysOneHoldPerRootCause(withHold(id, after, amount, b))
  ensures alwaysFullAwardBindsNoVault(withHold(id, after, amount, b))
  ensures alwaysHoldsMatchCases(withHold(id, after, amount, b))
  ensures stepVaultHoldsKept(b, withHold(id, after, amount, b))
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
  OneHoldMeaning(b);
  var pKeep := (h: Hold) => (h.caseId != id);
  var kept := ProofLib.Filter(pKeep, b.holds);
  forall h | h in nb.holds
    ensures |ProofLib.Filter((g: Hold) => (g.caseId == h.caseId), nb.holds)| == 1
  {
    var q := (g: Hold) => (g.caseId == h.caseId);
    ProofLib.FilterAppend(q, kept, nh);
    if h == nh {
      forall k | 0 <= k < |kept|
        ensures !q(kept[k])
      {
        ProofLib.FilterMember(pKeep, b.holds, kept[k]);
      }
      ProofLib.FilterNone(q, kept);
    } else {
      assert h in kept;
      ProofLib.FilterMember(pKeep, b.holds, h);
      var i :| 0 <= i < |kept| && kept[i] == h;
      forall j | 0 <= j < |kept| && j != i
        ensures !q(kept[j])
      {
        if q(kept[j]) {
          ProofLib.FilterTwo(q, kept, i, j);
          ProofLib.FilterOfFilterShorter(pKeep, q, b.holds);
        }
      }
      ProofLib.FilterOne(q, kept, i);
    }
  }
  OneHoldMeaning(nb);
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

lemma DroppedHoldKeepsRules(b: Bounty, id: int, by_: int, checkedEpoch: int)
  requires inv(b)
  requires known(id)
  requires forall h :: h in b.holds && h.caseId == id ==> !h.kind.VaultHold?
  requires !security__cases_committed(caseOf(reviewRelated(b, id, by_, checkedEpoch, false), id))
  requires !caseOf(reviewRelated(b, id, by_, checkedEpoch, false), id).relatedReview.ReviewPending?
  requires forall other :: known(other) && other != id ==> caseOf(reviewRelated(b, id, by_, checkedEpoch, false), other) == caseOf(b, other)
  ensures alwaysReservedIsOpenVaultHolds(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures alwaysOneHoldPerRootCause(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures alwaysFullAwardBindsNoVault(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures alwaysHoldsMatchCases(reviewRelated(b, id, by_, checkedEpoch, false))
  ensures stepVaultHoldsKept(b, reviewRelated(b, id, by_, checkedEpoch, false))
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
  OpenVaultGrossMeaning(b);
  OpenVaultGrossMeaning(nb);
  var f1 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(b, h.caseId).grossChosen) else total);
  var f2 := (total: settlement__money_Amount, h: Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, caseOf(nb, h.caseId).grossChosen) else total);
  FoldDropNonVault(b, b.holds, id);
  ProofLib.FoldLeftPointwise(f2, f1, settlement__money_zero, nb.holds, nb.holds);
  assert alwaysReservedIsOpenVaultHolds(nb);
  OneHoldMeaning(b);
  var pKeep := (h: Hold) => (h.caseId != id);
  forall h | h in nb.holds
    ensures |ProofLib.Filter((g: Hold) => (g.caseId == h.caseId), nb.holds)| == 1
  {
    var q := (g: Hold) => (g.caseId == h.caseId);
    var i :| 0 <= i < |nb.holds| && nb.holds[i] == h;
    forall j | 0 <= j < |nb.holds| && j != i
      ensures !q(nb.holds[j])
    {
      if q(nb.holds[j]) {
        ProofLib.FilterTwo(q, nb.holds, i, j);
        ProofLib.FilterOfFilterShorter(pKeep, q, b.holds);
      }
    }
    ProofLib.FilterOne(q, nb.holds, i);
  }
  OneHoldMeaning(nb);
  assert alwaysOneHoldPerRootCause(nb);
  assert alwaysFullAwardBindsNoVault(nb);
  assert alwaysHoldsMatchCases(nb);
  assert stepHoldsNeedClearance(b, nb);
}
