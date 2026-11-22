// The vault's free amount, the funds snapshot and the reserved total stay valid amounts, and a deposit only raises the free amount the cover is compared with.

lemma deposit_ensures(s: PrivateAward, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysHoldsKeepCaseRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysBountyReserveIsVaultReserve(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysBountyCoverIsVaultFree(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCoverAmountsValid(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysVaultAwardReserved(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysVaultTargetMatchesAward(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysDirectJournalBound(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysShownAmountsExact(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysAwardNoticesArePrivateCaseNotices(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCommitmentNotified(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysPaidNotified(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepVaultReservationNeedsCommitment(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepDirectPaymentNeedsFinancialApprover(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepAuthorizationFollowsDisplay(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepNoticesPermanent(s, deposit(s, amount, asset, receipt, finalized)))
{
  if inv(s) && canDeposit(s, amount, asset, receipt, finalized) {
    var free := s.settlement.vault.free;
    var raised := settlement__money_addAmounts(free, amount);
    var cover := settlement__money_subtractAmounts(s.bounty.funds.free, s.bounty.reserved);
    settlement__money_lawAdditionValid_ensures(free, amount);
    settlement__money_lawSubtractionValid_ensures(s.bounty.funds.free, s.bounty.reserved);
    settlement__money_lawAddMonotone_ensures(free, amount);
    settlement__money_lawNumericOrderTotal_ensures(raised, free);
    settlement__money_lawNumericOrderTransitive_ensures(cover, free, raised);
    assert deposit(s, amount, asset, receipt, finalized).settlement.vault.free == raised;
  }
}

lemma decideAward_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysHoldsKeepCaseRules(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysBountyReserveIsVaultReserve(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysBountyCoverIsVaultFree(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCoverAmountsValid(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysVaultAwardReserved(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysVaultTargetMatchesAward(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysDirectJournalBound(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysShownAmountsExact(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysAwardNoticesArePrivateCaseNotices(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCommitmentNotified(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysPaidNotified(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepVaultReservationNeedsCommitment(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepDirectPaymentNeedsFinancialApprover(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepAuthorizationFollowsDisplay(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepNoticesPermanent(s, decideAward(s, id, by_, checkedEpoch, amount)))
{
  if inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount) {
    assert settlement__money_validAmount(amount);
    assert vaultObligation(s, id, amount).vault == s.settlement.vault;
    assert vaultObligation(s, id, amount).payment.gross == amount;
    settlement__money_lawAdditionValid_ensures(s.bounty.reserved, amount);
    settlement__money_lawSubtractionValid_ensures(s.settlement.vault.free, amount);
  }
}

lemma reviewRelated_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysHoldsKeepCaseRules(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysBountyReserveIsVaultReserve(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysBountyCoverIsVaultFree(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCoverAmountsValid(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysVaultAwardReserved(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysVaultTargetMatchesAward(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysDirectJournalBound(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysShownAmountsExact(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysAwardNoticesArePrivateCaseNotices(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCommitmentNotified(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysPaidNotified(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepVaultReservationNeedsCommitment(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepDirectPaymentNeedsFinancialApprover(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepAuthorizationFollowsDisplay(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepNoticesPermanent(s, reviewRelated(s, id, by_, checkedEpoch, approve)))
{
  if inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve) {
    var gross := caseOf(s, id).grossChosen;
    assert vaultObligation(s, id, gross).vault == s.settlement.vault;
    assert vaultObligation(s, id, gross).payment.gross == gross;
    settlement__money_lawAdditionValid_ensures(s.bounty.reserved, gross);
    settlement__money_lawSubtractionValid_ensures(s.settlement.vault.free, gross);
  }
}

lemma reconcile_ensures(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysHoldsKeepCaseRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysBountyReserveIsVaultReserve(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysBountyCoverIsVaultFree(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCoverAmountsValid(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysVaultAwardReserved(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysVaultTargetMatchesAward(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysDirectJournalBound(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysShownAmountsExact(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysAwardNoticesArePrivateCaseNotices(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCommitmentNotified(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysPaidNotified(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepVaultReservationNeedsCommitment(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepDirectPaymentNeedsFinancialApprover(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepAuthorizationFollowsDisplay(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepNoticesPermanent(s, reconcile(s, evidence)))
{
  if inv(s) && canReconcile(s, evidence) {
    var gross := evidence.amounts.gross;
    assert settlement__money_validAmount(gross);
    settlement__money_lawSubtractionValid_ensures(s.bounty.reserved, gross);
    settlement__money_lawSubtractionValid_ensures(s.bounty.funds.free, gross);
  }
}
