// Hints for the private award obligations that the solver does not find alone.

// A deposit only raises the free amount the cover is compared with.
lemma deposit_ensures(s: PrivateAward, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysHoldsKeepCaseRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysFundsSnapshotObserved(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysBountyReserveIsVaultReserve(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysBountyCoverIsVaultFree(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCoverAmountsValid(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysVaultAwardReserved(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCaseRevisionsCounted(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysVaultTargetMatchesAward(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysNothingAuthorizedBeforeAdmission(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysDirectJournalBound(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysShownAmountsExact(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCommittedWithinTerms(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysShownCaseReceived(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysAwardNoticesArePrivateCaseNotices(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCommitmentNotified(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysPaidNoticeOnlyWhenPaid(deposit(s, amount, asset, receipt, finalized)))
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

// The snapshot is the vault's own free and reserved total, so the cover it leaves is the vault's free amount.
lemma observeFunds_ensures(s: PrivateAward, observedAt: int)
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysHoldsKeepCaseRules(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysFundsSnapshotObserved(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysBountyReserveIsVaultReserve(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysBountyCoverIsVaultFree(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysCoverAmountsValid(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysVaultAwardReserved(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysCaseRevisionsCounted(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysVaultTargetMatchesAward(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysNothingAuthorizedBeforeAdmission(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysDirectJournalBound(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysShownAmountsExact(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysCommittedWithinTerms(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysShownCaseReceived(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysAwardNoticesArePrivateCaseNotices(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysCommitmentNotified(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysPaidNoticeOnlyWhenPaid(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysPaidNotified(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepVaultReservationNeedsCommitment(s, "observeFunds", observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepDirectPaymentNeedsFinancialApprover(s, "observeFunds", observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepAuthorizationFollowsDisplay(s, "observeFunds", observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepNoticesPermanent(s, observeFunds(s, observedAt)))
{
  if inv(s) && canObserveFunds(s, observedAt) {
    security__bounty_observeFunds_ensures(s.bounty, vaultFunds(s, observedAt));
    settlement__money_lawAdditionValid_ensures(s.settlement.vault.free, s.settlement.vault.reserved);
    ObservedCoverIsVaultFree(s.settlement.vault.free, s.settlement.vault.reserved, s.bounty.reserved);
  }
}

// The clock and the route observation touch no hold, case or reserved total.
lemma advanceClock_ensures(s: PrivateAward, nowMs: int)
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysHoldsKeepCaseRules(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysFundsSnapshotObserved(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysBountyReserveIsVaultReserve(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysBountyCoverIsVaultFree(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysCoverAmountsValid(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysVaultAwardReserved(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysCaseRevisionsCounted(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysVaultTargetMatchesAward(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysNothingAuthorizedBeforeAdmission(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysDirectJournalBound(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysShownAmountsExact(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysCommittedWithinTerms(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysShownCaseReceived(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysAwardNoticesArePrivateCaseNotices(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysCommitmentNotified(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysPaidNoticeOnlyWhenPaid(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> alwaysPaidNotified(advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> stepVaultReservationNeedsCommitment(s, "advanceClock", advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> stepDirectPaymentNeedsFinancialApprover(s, "advanceClock", advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> stepAuthorizationFollowsDisplay(s, "advanceClock", advanceClock(s, nowMs)))
  ensures (inv(s) ==> canAdvanceClock(s, nowMs) ==> stepNoticesPermanent(s, advanceClock(s, nowMs)))
{
  if inv(s) && canAdvanceClock(s, nowMs) {
    security__bounty_advanceClock_ensures(s.bounty, nowMs);
  }
}

lemma observeRoute_ensures(s: PrivateAward, route: security__bounty_RouteObservation)
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysHoldsKeepCaseRules(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysFundsSnapshotObserved(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysBountyReserveIsVaultReserve(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysBountyCoverIsVaultFree(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysCoverAmountsValid(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysVaultAwardReserved(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysCaseRevisionsCounted(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysVaultTargetMatchesAward(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysNothingAuthorizedBeforeAdmission(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysDirectJournalBound(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysShownAmountsExact(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysCommittedWithinTerms(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysShownCaseReceived(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysAwardNoticesArePrivateCaseNotices(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysCommitmentNotified(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysPaidNoticeOnlyWhenPaid(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> alwaysPaidNotified(observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> stepVaultReservationNeedsCommitment(s, "observeRoute", observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> stepDirectPaymentNeedsFinancialApprover(s, "observeRoute", observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> stepAuthorizationFollowsDisplay(s, "observeRoute", observeRoute(s, route)))
  ensures (inv(s) ==> canObserveRoute(s, route) ==> stepNoticesPermanent(s, observeRoute(s, route)))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  if inv(s) && canObserveRoute(s, route) {
    security__bounty_observeRoute_ensures(s.bounty, route);
  }
}

// A receipt, claim or link step changes only an unreceived case, which holds nothing and is never the shown case.
lemma receive_ensures(s: PrivateAward, id: int, source: security__cases_ReceiptSource, terms: security__terms_ReceiptTerms, reportVersion: int)
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysHoldsKeepCaseRules(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysFundsSnapshotObserved(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysBountyReserveIsVaultReserve(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysBountyCoverIsVaultFree(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysCoverAmountsValid(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysVaultAwardReserved(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysCaseRevisionsCounted(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysVaultTargetMatchesAward(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysNothingAuthorizedBeforeAdmission(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysDirectJournalBound(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysShownAmountsExact(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysCommittedWithinTerms(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysShownCaseReceived(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysAwardNoticesArePrivateCaseNotices(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysCommitmentNotified(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysPaidNoticeOnlyWhenPaid(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysPaidNotified(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepVaultReservationNeedsCommitment(s, "receive", receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepDirectPaymentNeedsFinancialApprover(s, "receive", receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepAuthorizationFollowsDisplay(s, "receive", receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepNoticesPermanent(s, receive(s, id, source, terms, reportVersion)))
{
  hide *;
  if inv(s) && canReceive(s, id, source, terms, reportVersion) {
    ReceivePart1(s, id, source, terms, reportVersion);
    ReceivePart2(s, id, source, terms, reportVersion);
  }
}

lemma ReceivePart1(s: PrivateAward, id: int, source: security__cases_ReceiptSource, terms: security__terms_ReceiptTerms, reportVersion: int)
  requires inv(s) && canReceive(s, id, source, terms, reportVersion)
  ensures alwaysHoldsKeepCaseRules(receive(s, id, source, terms, reportVersion))
  ensures alwaysFundsSnapshotObserved(receive(s, id, source, terms, reportVersion))
  ensures alwaysBountyReserveIsVaultReserve(receive(s, id, source, terms, reportVersion))
  ensures alwaysBountyCoverIsVaultFree(receive(s, id, source, terms, reportVersion))
  ensures alwaysCoverAmountsValid(receive(s, id, source, terms, reportVersion))
  ensures alwaysVaultAwardReserved(receive(s, id, source, terms, reportVersion))
  ensures alwaysCaseRevisionsCounted(receive(s, id, source, terms, reportVersion))
  ensures alwaysVaultTargetMatchesAward(receive(s, id, source, terms, reportVersion))
  ensures alwaysNothingAuthorizedBeforeAdmission(receive(s, id, source, terms, reportVersion))
  ensures alwaysDirectJournalBound(receive(s, id, source, terms, reportVersion))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  security__bounty_receive_ensures(s.bounty, id, source, terms, reportVersion);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma ReceivePart2(s: PrivateAward, id: int, source: security__cases_ReceiptSource, terms: security__terms_ReceiptTerms, reportVersion: int)
  requires inv(s) && canReceive(s, id, source, terms, reportVersion)
  ensures alwaysShownAmountsExact(receive(s, id, source, terms, reportVersion))
  ensures alwaysCommittedWithinTerms(receive(s, id, source, terms, reportVersion))
  ensures alwaysShownCaseReceived(receive(s, id, source, terms, reportVersion))
  ensures alwaysAwardNoticesArePrivateCaseNotices(receive(s, id, source, terms, reportVersion))
  ensures alwaysCommitmentNotified(receive(s, id, source, terms, reportVersion))
  ensures alwaysPaidNoticeOnlyWhenPaid(receive(s, id, source, terms, reportVersion))
  ensures alwaysPaidNotified(receive(s, id, source, terms, reportVersion))
  ensures stepVaultReservationNeedsCommitment(s, "receive", receive(s, id, source, terms, reportVersion))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "receive", receive(s, id, source, terms, reportVersion))
  ensures stepAuthorizationFollowsDisplay(s, "receive", receive(s, id, source, terms, reportVersion))
  ensures stepNoticesPermanent(s, receive(s, id, source, terms, reportVersion))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

lemma claim_ensures(s: PrivateAward, id: int, by_: int)
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysHoldsKeepCaseRules(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysFundsSnapshotObserved(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysBountyReserveIsVaultReserve(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysBountyCoverIsVaultFree(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysCoverAmountsValid(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysVaultAwardReserved(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysCaseRevisionsCounted(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysVaultTargetMatchesAward(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysNothingAuthorizedBeforeAdmission(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysDirectJournalBound(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysShownAmountsExact(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysCommittedWithinTerms(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysShownCaseReceived(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysAwardNoticesArePrivateCaseNotices(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysCommitmentNotified(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysPaidNoticeOnlyWhenPaid(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> alwaysPaidNotified(claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> stepVaultReservationNeedsCommitment(s, "claim", claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> stepDirectPaymentNeedsFinancialApprover(s, "claim", claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> stepAuthorizationFollowsDisplay(s, "claim", claim(s, id, by_)))
  ensures (inv(s) ==> canClaim(s, id, by_) ==> stepNoticesPermanent(s, claim(s, id, by_)))
{
  hide *;
  if inv(s) && canClaim(s, id, by_) {
    ClaimPart1(s, id, by_);
    ClaimPart2(s, id, by_);
  }
}

lemma ClaimPart1(s: PrivateAward, id: int, by_: int)
  requires inv(s) && canClaim(s, id, by_)
  ensures alwaysHoldsKeepCaseRules(claim(s, id, by_))
  ensures alwaysFundsSnapshotObserved(claim(s, id, by_))
  ensures alwaysBountyReserveIsVaultReserve(claim(s, id, by_))
  ensures alwaysBountyCoverIsVaultFree(claim(s, id, by_))
  ensures alwaysCoverAmountsValid(claim(s, id, by_))
  ensures alwaysVaultAwardReserved(claim(s, id, by_))
  ensures alwaysCaseRevisionsCounted(claim(s, id, by_))
  ensures alwaysVaultTargetMatchesAward(claim(s, id, by_))
  ensures alwaysNothingAuthorizedBeforeAdmission(claim(s, id, by_))
  ensures alwaysDirectJournalBound(claim(s, id, by_))
{
  security__bounty_claim_ensures(s.bounty, id, by_);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma ClaimPart2(s: PrivateAward, id: int, by_: int)
  requires inv(s) && canClaim(s, id, by_)
  ensures alwaysShownAmountsExact(claim(s, id, by_))
  ensures alwaysCommittedWithinTerms(claim(s, id, by_))
  ensures alwaysShownCaseReceived(claim(s, id, by_))
  ensures alwaysAwardNoticesArePrivateCaseNotices(claim(s, id, by_))
  ensures alwaysCommitmentNotified(claim(s, id, by_))
  ensures alwaysPaidNoticeOnlyWhenPaid(claim(s, id, by_))
  ensures alwaysPaidNotified(claim(s, id, by_))
  ensures stepVaultReservationNeedsCommitment(s, "claim", claim(s, id, by_))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "claim", claim(s, id, by_))
  ensures stepAuthorizationFollowsDisplay(s, "claim", claim(s, id, by_))
  ensures stepNoticesPermanent(s, claim(s, id, by_))
{
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

lemma verifyLink_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms)
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysHoldsKeepCaseRules(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysFundsSnapshotObserved(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysBountyReserveIsVaultReserve(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysBountyCoverIsVaultFree(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysCoverAmountsValid(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysVaultAwardReserved(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysCaseRevisionsCounted(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysVaultTargetMatchesAward(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysNothingAuthorizedBeforeAdmission(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysDirectJournalBound(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysShownAmountsExact(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysCommittedWithinTerms(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysShownCaseReceived(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysAwardNoticesArePrivateCaseNotices(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysCommitmentNotified(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysPaidNoticeOnlyWhenPaid(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> alwaysPaidNotified(verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> stepVaultReservationNeedsCommitment(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> stepDirectPaymentNeedsFinancialApprover(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> stepAuthorizationFollowsDisplay(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms)))
  ensures (inv(s) ==> canVerifyLink(s, id, by_, checkedEpoch, terms) ==> stepNoticesPermanent(s, verifyLink(s, id, by_, checkedEpoch, terms)))
{
  hide *;
  if inv(s) && canVerifyLink(s, id, by_, checkedEpoch, terms) {
    VerifyLinkPart1(s, id, by_, checkedEpoch, terms);
    VerifyLinkPart2(s, id, by_, checkedEpoch, terms);
  }
}

lemma VerifyLinkPart1(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms)
  requires inv(s) && canVerifyLink(s, id, by_, checkedEpoch, terms)
  ensures alwaysHoldsKeepCaseRules(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysFundsSnapshotObserved(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysBountyReserveIsVaultReserve(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysBountyCoverIsVaultFree(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysCoverAmountsValid(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysVaultAwardReserved(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysCaseRevisionsCounted(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysVaultTargetMatchesAward(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysNothingAuthorizedBeforeAdmission(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysDirectJournalBound(verifyLink(s, id, by_, checkedEpoch, terms))
{
  security__bounty_verifyLink_ensures(s.bounty, id, by_, checkedEpoch, terms);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma VerifyLinkPart2(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms)
  requires inv(s) && canVerifyLink(s, id, by_, checkedEpoch, terms)
  ensures alwaysShownAmountsExact(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysCommittedWithinTerms(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysShownCaseReceived(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysAwardNoticesArePrivateCaseNotices(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysCommitmentNotified(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysPaidNoticeOnlyWhenPaid(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures alwaysPaidNotified(verifyLink(s, id, by_, checkedEpoch, terms))
  ensures stepVaultReservationNeedsCommitment(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms))
  ensures stepAuthorizationFollowsDisplay(s, "verifyLink", verifyLink(s, id, by_, checkedEpoch, terms))
  ensures stepNoticesPermanent(s, verifyLink(s, id, by_, checkedEpoch, terms))
{
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

lemma rejectLink_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int)
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysHoldsKeepCaseRules(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysFundsSnapshotObserved(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysBountyReserveIsVaultReserve(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysBountyCoverIsVaultFree(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysCoverAmountsValid(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysVaultAwardReserved(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysCaseRevisionsCounted(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysVaultTargetMatchesAward(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysNothingAuthorizedBeforeAdmission(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysDirectJournalBound(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysShownAmountsExact(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysCommittedWithinTerms(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysShownCaseReceived(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysAwardNoticesArePrivateCaseNotices(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysCommitmentNotified(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysPaidNoticeOnlyWhenPaid(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> alwaysPaidNotified(rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> stepVaultReservationNeedsCommitment(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> stepDirectPaymentNeedsFinancialApprover(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> stepAuthorizationFollowsDisplay(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch)))
  ensures (inv(s) ==> canRejectLink(s, id, by_, checkedEpoch) ==> stepNoticesPermanent(s, rejectLink(s, id, by_, checkedEpoch)))
{
  hide *;
  if inv(s) && canRejectLink(s, id, by_, checkedEpoch) {
    RejectLinkPart1(s, id, by_, checkedEpoch);
    RejectLinkPart2(s, id, by_, checkedEpoch);
  }
}

lemma RejectLinkPart1(s: PrivateAward, id: int, by_: int, checkedEpoch: int)
  requires inv(s) && canRejectLink(s, id, by_, checkedEpoch)
  ensures alwaysHoldsKeepCaseRules(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysFundsSnapshotObserved(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysBountyReserveIsVaultReserve(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysBountyCoverIsVaultFree(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysCoverAmountsValid(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysVaultAwardReserved(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysCaseRevisionsCounted(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysVaultTargetMatchesAward(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysNothingAuthorizedBeforeAdmission(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysDirectJournalBound(rejectLink(s, id, by_, checkedEpoch))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  security__bounty_rejectLink_ensures(s.bounty, id, by_, checkedEpoch);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma RejectLinkPart2(s: PrivateAward, id: int, by_: int, checkedEpoch: int)
  requires inv(s) && canRejectLink(s, id, by_, checkedEpoch)
  ensures alwaysShownAmountsExact(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysCommittedWithinTerms(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysShownCaseReceived(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysAwardNoticesArePrivateCaseNotices(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysCommitmentNotified(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysPaidNoticeOnlyWhenPaid(rejectLink(s, id, by_, checkedEpoch))
  ensures alwaysPaidNotified(rejectLink(s, id, by_, checkedEpoch))
  ensures stepVaultReservationNeedsCommitment(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch))
  ensures stepAuthorizationFollowsDisplay(s, "rejectLink", rejectLink(s, id, by_, checkedEpoch))
  ensures stepNoticesPermanent(s, rejectLink(s, id, by_, checkedEpoch))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

lemma recordAttested_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms, confirmed: bool)
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysHoldsKeepCaseRules(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysFundsSnapshotObserved(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysBountyReserveIsVaultReserve(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysBountyCoverIsVaultFree(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysCoverAmountsValid(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysVaultAwardReserved(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysCaseRevisionsCounted(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysVaultTargetMatchesAward(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysNothingAuthorizedBeforeAdmission(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysDirectJournalBound(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysShownAmountsExact(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysCommittedWithinTerms(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysShownCaseReceived(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysAwardNoticesArePrivateCaseNotices(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysCommitmentNotified(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysPaidNoticeOnlyWhenPaid(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> alwaysPaidNotified(recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> stepVaultReservationNeedsCommitment(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> stepDirectPaymentNeedsFinancialApprover(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> stepAuthorizationFollowsDisplay(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
  ensures (inv(s) ==> canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) ==> stepNoticesPermanent(s, recordAttested(s, id, by_, checkedEpoch, terms, confirmed)))
{
  hide *;
  if inv(s) && canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed) {
    RecordAttestedPart1(s, id, by_, checkedEpoch, terms, confirmed);
    RecordAttestedPart2(s, id, by_, checkedEpoch, terms, confirmed);
  }
}

lemma RecordAttestedPart1(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms, confirmed: bool)
  requires inv(s) && canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed)
  ensures alwaysHoldsKeepCaseRules(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysFundsSnapshotObserved(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysBountyReserveIsVaultReserve(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysBountyCoverIsVaultFree(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysCoverAmountsValid(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysVaultAwardReserved(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysCaseRevisionsCounted(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysVaultTargetMatchesAward(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysNothingAuthorizedBeforeAdmission(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysDirectJournalBound(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
{
  security__bounty_recordAttested_ensures(s.bounty, id, by_, checkedEpoch, terms, confirmed);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma RecordAttestedPart2(s: PrivateAward, id: int, by_: int, checkedEpoch: int, terms: security__terms_ReceiptTerms, confirmed: bool)
  requires inv(s) && canRecordAttested(s, id, by_, checkedEpoch, terms, confirmed)
  ensures alwaysShownAmountsExact(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysCommittedWithinTerms(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysShownCaseReceived(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysAwardNoticesArePrivateCaseNotices(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysCommitmentNotified(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysPaidNoticeOnlyWhenPaid(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures alwaysPaidNotified(recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures stepVaultReservationNeedsCommitment(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures stepAuthorizationFollowsDisplay(s, "recordAttested", recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
  ensures stepNoticesPermanent(s, recordAttested(s, id, by_, checkedEpoch, terms, confirmed))
{
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

lemma settleClaim_ensures(s: PrivateAward, id: int, by_: int, listed: bool, terms: security__terms_ReceiptTerms)
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysHoldsKeepCaseRules(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysFundsSnapshotObserved(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysBountyReserveIsVaultReserve(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysBountyCoverIsVaultFree(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysCoverAmountsValid(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysVaultAwardReserved(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysCaseRevisionsCounted(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysVaultTargetMatchesAward(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysNothingAuthorizedBeforeAdmission(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysDirectJournalBound(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysShownAmountsExact(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysCommittedWithinTerms(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysShownCaseReceived(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysAwardNoticesArePrivateCaseNotices(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysCommitmentNotified(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysPaidNoticeOnlyWhenPaid(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> alwaysPaidNotified(settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> stepVaultReservationNeedsCommitment(s, "settleClaim", settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> stepDirectPaymentNeedsFinancialApprover(s, "settleClaim", settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> stepAuthorizationFollowsDisplay(s, "settleClaim", settleClaim(s, id, by_, listed, terms)))
  ensures (inv(s) ==> canSettleClaim(s, id, by_, listed, terms) ==> stepNoticesPermanent(s, settleClaim(s, id, by_, listed, terms)))
{
  hide *;
  if inv(s) && canSettleClaim(s, id, by_, listed, terms) {
    SettleClaimPart1(s, id, by_, listed, terms);
    SettleClaimPart2(s, id, by_, listed, terms);
  }
}

lemma SettleClaimPart1(s: PrivateAward, id: int, by_: int, listed: bool, terms: security__terms_ReceiptTerms)
  requires inv(s) && canSettleClaim(s, id, by_, listed, terms)
  ensures alwaysHoldsKeepCaseRules(settleClaim(s, id, by_, listed, terms))
  ensures alwaysFundsSnapshotObserved(settleClaim(s, id, by_, listed, terms))
  ensures alwaysBountyReserveIsVaultReserve(settleClaim(s, id, by_, listed, terms))
  ensures alwaysBountyCoverIsVaultFree(settleClaim(s, id, by_, listed, terms))
  ensures alwaysCoverAmountsValid(settleClaim(s, id, by_, listed, terms))
  ensures alwaysVaultAwardReserved(settleClaim(s, id, by_, listed, terms))
  ensures alwaysCaseRevisionsCounted(settleClaim(s, id, by_, listed, terms))
  ensures alwaysVaultTargetMatchesAward(settleClaim(s, id, by_, listed, terms))
  ensures alwaysNothingAuthorizedBeforeAdmission(settleClaim(s, id, by_, listed, terms))
  ensures alwaysDirectJournalBound(settleClaim(s, id, by_, listed, terms))
{
  security__bounty_settleClaim_ensures(s.bounty, id, by_, listed, terms);
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
}

lemma SettleClaimPart2(s: PrivateAward, id: int, by_: int, listed: bool, terms: security__terms_ReceiptTerms)
  requires inv(s) && canSettleClaim(s, id, by_, listed, terms)
  ensures alwaysShownAmountsExact(settleClaim(s, id, by_, listed, terms))
  ensures alwaysCommittedWithinTerms(settleClaim(s, id, by_, listed, terms))
  ensures alwaysShownCaseReceived(settleClaim(s, id, by_, listed, terms))
  ensures alwaysAwardNoticesArePrivateCaseNotices(settleClaim(s, id, by_, listed, terms))
  ensures alwaysCommitmentNotified(settleClaim(s, id, by_, listed, terms))
  ensures alwaysPaidNoticeOnlyWhenPaid(settleClaim(s, id, by_, listed, terms))
  ensures alwaysPaidNotified(settleClaim(s, id, by_, listed, terms))
  ensures stepVaultReservationNeedsCommitment(s, "settleClaim", settleClaim(s, id, by_, listed, terms))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "settleClaim", settleClaim(s, id, by_, listed, terms))
  ensures stepAuthorizationFollowsDisplay(s, "settleClaim", settleClaim(s, id, by_, listed, terms))
  ensures stepNoticesPermanent(s, settleClaim(s, id, by_, listed, terms))
{
  var c := caseOf(s, id);
  assert id in security__bounty_caseIds;
  CaseRulesOf(s.bounty, id);
  assert c.revision >= 0;
  assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  assert s.shown.caseId > 0 ==> s.shown.caseId != id;
}

// A new snapshot has a later epoch than every case's, so a direct authorization stays within the current epoch.
lemma observeAuthority_ensures(s: PrivateAward, snapshot: security__cases_Authority)
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysHoldsKeepCaseRules(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysFundsSnapshotObserved(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysBountyReserveIsVaultReserve(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysBountyCoverIsVaultFree(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysCoverAmountsValid(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysVaultAwardReserved(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysCaseRevisionsCounted(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysVaultTargetMatchesAward(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysNothingAuthorizedBeforeAdmission(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysDirectJournalBound(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysShownAmountsExact(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysCommittedWithinTerms(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysShownCaseReceived(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysAwardNoticesArePrivateCaseNotices(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysCommitmentNotified(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysPaidNoticeOnlyWhenPaid(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> alwaysPaidNotified(observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> stepVaultReservationNeedsCommitment(s, "observeAuthority", observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> stepDirectPaymentNeedsFinancialApprover(s, "observeAuthority", observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> stepAuthorizationFollowsDisplay(s, "observeAuthority", observeAuthority(s, snapshot)))
  ensures (inv(s) ==> canObserveAuthority(s, snapshot) ==> stepNoticesPermanent(s, observeAuthority(s, snapshot)))
{
  hide *;
  if inv(s) && canObserveAuthority(s, snapshot) {
    ObserveAuthorityPart1(s, snapshot);
    ObserveAuthorityPart2(s, snapshot);
  }
}

lemma ObserveAuthorityPart1(s: PrivateAward, snapshot: security__cases_Authority)
  requires inv(s) && canObserveAuthority(s, snapshot)
  ensures alwaysHoldsKeepCaseRules(observeAuthority(s, snapshot))
  ensures alwaysFundsSnapshotObserved(observeAuthority(s, snapshot))
  ensures alwaysBountyReserveIsVaultReserve(observeAuthority(s, snapshot))
  ensures alwaysBountyCoverIsVaultFree(observeAuthority(s, snapshot))
  ensures alwaysCoverAmountsValid(observeAuthority(s, snapshot))
  ensures alwaysVaultAwardReserved(observeAuthority(s, snapshot))
  ensures alwaysCaseRevisionsCounted(observeAuthority(s, snapshot))
  ensures alwaysVaultTargetMatchesAward(observeAuthority(s, snapshot))
  ensures alwaysNothingAuthorizedBeforeAdmission(observeAuthority(s, snapshot))
  ensures alwaysDirectJournalBound(observeAuthority(s, snapshot))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  security__bounty_observeAuthority_ensures(s.bounty, snapshot);
  assert 1 in security__bounty_caseIds && 2 in security__bounty_caseIds;
  assert security__cases_canObserveAuthority(s.bounty.first, snapshot) && security__cases_canObserveAuthority(s.bounty.second, snapshot);
  assert directCaseOf(s).authority.epoch < snapshot.epoch;
}

lemma ObserveAuthorityPart2(s: PrivateAward, snapshot: security__cases_Authority)
  requires inv(s) && canObserveAuthority(s, snapshot)
  ensures alwaysShownAmountsExact(observeAuthority(s, snapshot))
  ensures alwaysCommittedWithinTerms(observeAuthority(s, snapshot))
  ensures alwaysShownCaseReceived(observeAuthority(s, snapshot))
  ensures alwaysAwardNoticesArePrivateCaseNotices(observeAuthority(s, snapshot))
  ensures alwaysCommitmentNotified(observeAuthority(s, snapshot))
  ensures alwaysPaidNoticeOnlyWhenPaid(observeAuthority(s, snapshot))
  ensures alwaysPaidNotified(observeAuthority(s, snapshot))
  ensures stepVaultReservationNeedsCommitment(s, "observeAuthority", observeAuthority(s, snapshot))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "observeAuthority", observeAuthority(s, snapshot))
  ensures stepAuthorizationFollowsDisplay(s, "observeAuthority", observeAuthority(s, snapshot))
  ensures stepNoticesPermanent(s, observeAuthority(s, snapshot))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds;
  assert 1 in security__bounty_caseIds && 2 in security__bounty_caseIds;
  assert security__cases_canObserveAuthority(s.bounty.first, snapshot) && security__cases_canObserveAuthority(s.bounty.second, snapshot);
  assert directCaseOf(s).authority.epoch < snapshot.epoch;
}

// A finding is decided only on an open receipt, which has neither a commitment nor a pending proposal.
lemma decide_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, version: int, decision: security__cases_Decision)
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysHoldsKeepCaseRules(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysFundsSnapshotObserved(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysBountyReserveIsVaultReserve(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysBountyCoverIsVaultFree(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysCoverAmountsValid(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysVaultAwardReserved(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysCaseRevisionsCounted(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysVaultTargetMatchesAward(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysNothingAuthorizedBeforeAdmission(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysDirectJournalBound(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysShownAmountsExact(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysCommittedWithinTerms(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysShownCaseReceived(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysAwardNoticesArePrivateCaseNotices(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysCommitmentNotified(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysPaidNoticeOnlyWhenPaid(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysPaidNotified(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepVaultReservationNeedsCommitment(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepDirectPaymentNeedsFinancialApprover(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepAuthorizationFollowsDisplay(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepNoticesPermanent(s, decide(s, id, by_, checkedEpoch, version, decision)))
{
  if inv(s) && canDecide(s, id, by_, checkedEpoch, version, decision) {
    security__bounty_decide_ensures(s.bounty, id, by_, checkedEpoch, version, decision);
    var c := caseOf(s, id);
    assert id in security__bounty_caseIds;
    CaseRulesOf(s.bounty, id);
    assert c.revision >= 0;
    assert !security__cases_committed(c) && !c.relatedReview.ReviewPending?;
  }
}

// A commitment adds the award to both reserved totals and takes it from the vault's free amount.
lemma decideAward_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysHoldsKeepCaseRules(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysFundsSnapshotObserved(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysBountyReserveIsVaultReserve(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysBountyCoverIsVaultFree(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCoverAmountsValid(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysVaultAwardReserved(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCaseRevisionsCounted(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysVaultTargetMatchesAward(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysNothingAuthorizedBeforeAdmission(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysDirectJournalBound(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysShownAmountsExact(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCommittedWithinTerms(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysShownCaseReceived(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysAwardNoticesArePrivateCaseNotices(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysCommitmentNotified(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysPaidNoticeOnlyWhenPaid(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysPaidNotified(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepVaultReservationNeedsCommitment(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepDirectPaymentNeedsFinancialApprover(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepAuthorizationFollowsDisplay(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepNoticesPermanent(s, decideAward(s, id, by_, checkedEpoch, amount)))
{
  hide *;
  if inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount) {
    DecideAwardPart1a(s, id, by_, checkedEpoch, amount);
    DecideAwardPart1b(s, id, by_, checkedEpoch, amount);
    DecideAwardPart1c(s, id, by_, checkedEpoch, amount);
    DecideAwardPart2(s, id, by_, checkedEpoch, amount);
  }
}

lemma DecideAwardPart1a(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  requires inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount)
  ensures alwaysHoldsKeepCaseRules(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysFundsSnapshotObserved(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysBountyReserveIsVaultReserve(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysBountyCoverIsVaultFree(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysCoverAmountsValid(decideAward(s, id, by_, checkedEpoch, amount))
{
  security__bounty_decideAward_ensures(s.bounty, id, by_, checkedEpoch, amount);
  var b := s.bounty;
  var c := caseOf(s, id);
  var clearance := security__bounty_clearanceFor(b, id, amount);
  var after := security__cases_decideAward(c, by_, checkedEpoch, amount, clearance);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert settlement__money_validAmount(amount);
  settlement__money_lawAddCongruence_ensures(s.settlement.vault.reserved, b.reserved, amount);
  assert vaultObligation(s, id, amount).vault == s.settlement.vault;
  assert vaultObligation(s, id, amount).payment.gross == amount;
  settlement__money_lawAdditionValid_ensures(b.reserved, amount);
  settlement__money_lawAdditionValid_ensures(s.settlement.vault.reserved, amount);
  settlement__money_lawSubtractionValid_ensures(s.settlement.vault.free, amount);
  if after.commitment.VaultReservation? {
    assert security__bounty_fundsCover(b, amount);
    assert !(settlement__money_compareAmounts(b.reserved, b.funds.free) > 0);
    ReservedCoverStaysVaultFree(b.funds.free, b.reserved, amount, s.settlement.vault.free);
  }
}

lemma DecideAwardPart1b(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  requires inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount)
  ensures alwaysVaultAwardReserved(decideAward(s, id, by_, checkedEpoch, amount))
{
  hide security__bounty_alwaysOneHoldPerRootCause, security__bounty_alwaysReservedIsOpenVaultHolds,
    security__bounty_alwaysCasesKeepAwardRules, security__bounty_alwaysFullAwardBindsNoVault,
    security__bounty_alwaysFundsObserved, alwaysShownAmountsExact, alwaysCommittedWithinTerms,
    alwaysShownCaseReceived, alwaysAwardNoticesArePrivateCaseNotices, alwaysCommitmentNotified,
    alwaysPaidNoticeOnlyWhenPaid, alwaysPaidNotified, alwaysDirectJournalBound,
    alwaysNothingAuthorizedBeforeAdmission, alwaysBountyReserveIsVaultReserve,
    alwaysBountyCoverIsVaultFree, alwaysCoverAmountsValid, alwaysCaseRevisionsCounted,
    alwaysVaultTargetMatchesAward;
  var b := s.bounty;
  var c := caseOf(s, id);
  var clearance := security__bounty_clearanceFor(b, id, amount);
  var after := security__cases_decideAward(c, by_, checkedEpoch, amount, clearance);
  var nb := security__bounty_decideAward(b, id, by_, checkedEpoch, amount);
  assert nb == security__bounty_withHold(id, after, amount, b);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  forall x ensures x in nb.holds <==> (x in b.holds && x.caseId != id) || x == security__bounty_holdFor(b, id, after) {
    ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
  }
  assert vaultObligation(s, id, amount).vault == s.settlement.vault;
  assert vaultObligation(s, id, amount).payment.gross == amount;
  settlement__money_lawEqualReflexive_ensures(amount);
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  RecordedHoldKeepsVaultHolds(b, nb, id);
}

lemma DecideAwardPart1c(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  requires inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount)
  ensures alwaysCaseRevisionsCounted(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysVaultTargetMatchesAward(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysNothingAuthorizedBeforeAdmission(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysDirectJournalBound(decideAward(s, id, by_, checkedEpoch, amount))
{
  var b := s.bounty;
  var c := caseOf(s, id);
  var clearance := security__bounty_clearanceFor(b, id, amount);
  var after := security__cases_decideAward(c, by_, checkedEpoch, amount, clearance);
  var nb := security__bounty_decideAward(b, id, by_, checkedEpoch, amount);
  assert nb == security__bounty_withHold(id, after, amount, b);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert c.revision >= 0;
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  assert s.directCase > 0 ==> s.directCase != id;
  forall x ensures x in nb.holds <==> (x in b.holds && x.caseId != id) || x == security__bounty_holdFor(b, id, after) {
    ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
  }
}

lemma DecideAwardPart2(s: PrivateAward, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  requires inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount)
  ensures alwaysShownAmountsExact(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysCommittedWithinTerms(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysShownCaseReceived(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysAwardNoticesArePrivateCaseNotices(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysCommitmentNotified(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysPaidNoticeOnlyWhenPaid(decideAward(s, id, by_, checkedEpoch, amount))
  ensures alwaysPaidNotified(decideAward(s, id, by_, checkedEpoch, amount))
  ensures stepVaultReservationNeedsCommitment(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount))
  ensures stepAuthorizationFollowsDisplay(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount))
  ensures stepNoticesPermanent(s, decideAward(s, id, by_, checkedEpoch, amount))
{
  var b := s.bounty;
  var c := caseOf(s, id);
  var nb := security__bounty_decideAward(b, id, by_, checkedEpoch, amount);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  settlement__money_lawEqualReflexive_ensures(amount);
  assert lastDecider(security__bounty_caseOf(nb, id)) == by_;
  NotifyCaseFacts(s.inbox, noticeKey(AwardNotice.AwardCommitted, id), security__bounty_caseOf(nb, id));
  PrefixKeepsNotices(s.inbox, notifyCase(s.inbox, noticeKey(AwardNotice.AwardCommitted, id), security__bounty_caseOf(nb, id)));
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  assert s.directCase > 0 ==> s.directCase != id;
  AwardKeysDiffer(id);
  assert !operations__notifications_noticeExists(s.inbox, noticeKey(AwardNotice.AwardPaid, id), c.reporter);
}

lemma reviewRelated_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysHoldsKeepCaseRules(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysFundsSnapshotObserved(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysBountyReserveIsVaultReserve(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysBountyCoverIsVaultFree(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCoverAmountsValid(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysVaultAwardReserved(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCaseRevisionsCounted(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysVaultTargetMatchesAward(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysNothingAuthorizedBeforeAdmission(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysDirectJournalBound(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysShownAmountsExact(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCommittedWithinTerms(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysShownCaseReceived(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysAwardNoticesArePrivateCaseNotices(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysCommitmentNotified(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysPaidNoticeOnlyWhenPaid(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> alwaysPaidNotified(reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepVaultReservationNeedsCommitment(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepDirectPaymentNeedsFinancialApprover(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepAuthorizationFollowsDisplay(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve)))
  ensures (inv(s) ==> canReviewRelated(s, id, by_, checkedEpoch, approve) ==> stepNoticesPermanent(s, reviewRelated(s, id, by_, checkedEpoch, approve)))
{
  hide *;
  if inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve) {
    ReviewRelatedPart1a(s, id, by_, checkedEpoch, approve);
    ReviewRelatedPart1b(s, id, by_, checkedEpoch, approve);
    ReviewRelatedPart1c(s, id, by_, checkedEpoch, approve);
    ReviewRelatedPart2(s, id, by_, checkedEpoch, approve);
  }
}

lemma ReviewRelatedPart1a(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve)
  ensures alwaysHoldsKeepCaseRules(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysFundsSnapshotObserved(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysBountyReserveIsVaultReserve(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysBountyCoverIsVaultFree(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysCoverAmountsValid(reviewRelated(s, id, by_, checkedEpoch, approve))
{
  security__bounty_reviewRelated_ensures(s.bounty, id, by_, checkedEpoch, approve);
  var b := s.bounty;
  var c := caseOf(s, id);
  var gross := c.grossChosen;
  var clearance := security__bounty_clearanceFor(b, id, gross);
  var after := security__cases_reviewRelated(c, by_, checkedEpoch, approve, clearance);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert security__terms_amountAllowed(c.terms, gross);
  if approve {
    settlement__money_lawAddCongruence_ensures(s.settlement.vault.reserved, b.reserved, gross);
  }
  assert vaultObligation(s, id, gross).vault == s.settlement.vault;
  assert vaultObligation(s, id, gross).payment.gross == gross;
  settlement__money_lawAdditionValid_ensures(b.reserved, gross);
  settlement__money_lawAdditionValid_ensures(s.settlement.vault.reserved, gross);
  settlement__money_lawSubtractionValid_ensures(s.settlement.vault.free, gross);
  if approve && after.commitment.VaultReservation? {
    assert security__bounty_fundsCover(b, gross);
    assert !(settlement__money_compareAmounts(b.reserved, b.funds.free) > 0);
    ReservedCoverStaysVaultFree(b.funds.free, b.reserved, gross, s.settlement.vault.free);
  }
}

lemma ReviewRelatedPart1b(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve)
  ensures alwaysVaultAwardReserved(reviewRelated(s, id, by_, checkedEpoch, approve))
{
  hide *;
  if approve {
    ReviewRelatedPart1bApprove(s, id, by_, checkedEpoch);
  } else {
    ReviewRelatedPart1bRefuse(s, id, by_, checkedEpoch);
  }
}

lemma ReviewRelatedPart1bApprove(s: PrivateAward, id: int, by_: int, checkedEpoch: int)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, true)
  ensures alwaysVaultAwardReserved(reviewRelated(s, id, by_, checkedEpoch, true))
{
  hide *;
  reveal inv, canReviewRelated, reviewRelated, withCommitment, withInbox, withSettlement, withBounty, caseOf, vaultHold, vaultObligation, vaultCommitmentReady, awardTarget, alwaysHoldsKeepCaseRules, alwaysVaultAwardReserved, alwaysCommittedWithinTerms, ProofLib.Filter, security__bounty_canReviewRelated, security__bounty_reviewRelated, security__bounty_withHold, security__bounty_putCase, security__bounty_caseOf, security__bounty_caseIds, security__bounty_holdFor, security__bounty_clearanceFor, security__bounty_alwaysCasesKeepAwardRules, security__bounty_alwaysHoldsMatchCases, security__bounty_holdMatches, security__bounty_hasHold, security__bounty_known, security__cases_canReviewRelated, security__cases_reviewRelated, security__cases_committedWith, security__cases_committed, security__cases_alwaysProposalCommitsNothing, security__cases_alwaysCommitmentMatchesAward, security__cases_alwaysFullAwardHeld, security__cases_alwaysStandardAwardRail, security__cases_alwaysApprovedWithinTerms, security__terms_amountAllowed, settlement__composition_canConfigure, settlement__composition_configure, settlement__composition_canReserve, settlement__composition_reserve, settlement__composition_hasReserve, settlement__payment_canConfigure, settlement__payment_configure, settlement__payment_reserveVault, settlement__vault_reserve, settlement__vault_reservationMatches, settlement__money_positiveAmount, settlement__money_lawEqualReflexive;
  var b := s.bounty;
  var c := caseOf(s, id);
  var gross := c.grossChosen;
  var clearance := security__bounty_clearanceFor(b, id, gross);
  var after := security__cases_reviewRelated(c, by_, checkedEpoch, true, clearance);
  var nb := security__bounty_reviewRelated(b, id, by_, checkedEpoch, true);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert nb == security__bounty_withHold(id, after, gross, b);
  forall x ensures x in nb.holds <==> (x in b.holds && x.caseId != id) || x == security__bounty_holdFor(b, id, after) {
    ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
  }
  assert vaultObligation(s, id, gross).vault == s.settlement.vault;
  assert vaultObligation(s, id, gross).payment.gross == gross;
  settlement__money_lawEqualReflexive_ensures(gross);
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  RecordedHoldKeepsVaultHolds(b, nb, id);
}

lemma ReviewRelatedPart1bRefuse(s: PrivateAward, id: int, by_: int, checkedEpoch: int)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, false)
  ensures alwaysVaultAwardReserved(reviewRelated(s, id, by_, checkedEpoch, false))
{
  var b := s.bounty;
  var nb := security__bounty_reviewRelated(b, id, by_, checkedEpoch, false);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  RefusedHolds(b, id, by_, checkedEpoch);
  forall x ensures x in nb.holds <==> x in b.holds && x.caseId != id {
    ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
  }
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  RecordedHoldKeepsVaultHolds(b, nb, id);
}

lemma ReviewRelatedPart1c(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve)
  ensures alwaysCaseRevisionsCounted(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysVaultTargetMatchesAward(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysNothingAuthorizedBeforeAdmission(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysDirectJournalBound(reviewRelated(s, id, by_, checkedEpoch, approve))
{
  var b := s.bounty;
  var c := caseOf(s, id);
  var gross := c.grossChosen;
  var clearance := security__bounty_clearanceFor(b, id, gross);
  var after := security__cases_reviewRelated(c, by_, checkedEpoch, approve, clearance);
  var nb := security__bounty_reviewRelated(b, id, by_, checkedEpoch, approve);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert c.revision >= 0;
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  assert s.directCase > 0 ==> s.directCase != id;
  if approve {
    assert nb == security__bounty_withHold(id, after, gross, b);
    forall x ensures x in nb.holds <==> (x in b.holds && x.caseId != id) || x == security__bounty_holdFor(b, id, after) {
      ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
    }
  } else {
    RefusedHolds(b, id, by_, checkedEpoch);
    forall x ensures x in nb.holds <==> x in b.holds && x.caseId != id {
      ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
    }
  }
}

lemma ReviewRelatedPart2(s: PrivateAward, id: int, by_: int, checkedEpoch: int, approve: bool)
  requires inv(s) && canReviewRelated(s, id, by_, checkedEpoch, approve)
  ensures alwaysShownAmountsExact(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysCommittedWithinTerms(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysShownCaseReceived(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysAwardNoticesArePrivateCaseNotices(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysCommitmentNotified(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysPaidNoticeOnlyWhenPaid(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures alwaysPaidNotified(reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures stepVaultReservationNeedsCommitment(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures stepAuthorizationFollowsDisplay(s, "reviewRelated", reviewRelated(s, id, by_, checkedEpoch, approve))
  ensures stepNoticesPermanent(s, reviewRelated(s, id, by_, checkedEpoch, approve))
{
  var b := s.bounty;
  var c := caseOf(s, id);
  var gross := c.grossChosen;
  var nb := security__bounty_reviewRelated(b, id, by_, checkedEpoch, approve);
  assert id in security__bounty_caseIds;
  CaseRulesOf(b, id);
  assert security__terms_amountAllowed(c.terms, gross);
  settlement__money_lawEqualReflexive_ensures(gross);
  assert lastDecider(security__bounty_caseOf(nb, id)) == by_;
  NotifyCaseFacts(s.inbox, noticeKey(AwardNotice.AwardCommitted, id), security__bounty_caseOf(nb, id));
  PrefixKeepsNotices(s.inbox, notifyCase(s.inbox, noticeKey(AwardNotice.AwardCommitted, id), security__bounty_caseOf(nb, id)));
  assert s.vaultCase > 0 ==> s.vaultCase != id;
  assert s.directCase > 0 ==> s.directCase != id;
  AwardKeysDiffer(id);
  assert !operations__notifications_noticeExists(s.inbox, noticeKey(AwardNotice.AwardPaid, id), c.reporter);
}

// A finalized payout takes the award from both reserved totals.
lemma reconcile_ensures(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysHoldsKeepCaseRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysFundsSnapshotObserved(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysBountyReserveIsVaultReserve(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysBountyCoverIsVaultFree(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCoverAmountsValid(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysVaultAwardReserved(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCaseRevisionsCounted(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysVaultTargetMatchesAward(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysNothingAuthorizedBeforeAdmission(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysDirectJournalBound(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysShownAmountsExact(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCommittedWithinTerms(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysShownCaseReceived(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysAwardNoticesArePrivateCaseNotices(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCommitmentNotified(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysPaidNoticeOnlyWhenPaid(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysPaidNotified(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepVaultReservationNeedsCommitment(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepDirectPaymentNeedsFinancialApprover(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepAuthorizationFollowsDisplay(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepNoticesPermanent(s, reconcile(s, evidence)))
{
  hide *;
  if inv(s) && canReconcile(s, evidence) {
    ReconcilePart1a(s, evidence);
    ReconcilePart1b(s, evidence);
    ReconcilePart1c(s, evidence);
    ReconcilePart2a(s, evidence);
    ReconcilePart2b(s, evidence);
    ReconcilePart2c(s, evidence);
  }
}

lemma ReconcilePart1a(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysHoldsKeepCaseRules(reconcile(s, evidence))
  ensures alwaysFundsSnapshotObserved(reconcile(s, evidence))
{
  hide *;
  reveal inv, canReconcile, reconcile, withInbox, withBounty, withSettlement, alwaysHoldsKeepCaseRules, alwaysFundsSnapshotObserved, security__bounty_inv;
  security__bounty_settleVaultHold_ensures(s.bounty, s.vaultCase, vaultPayout(evidence));
}

lemma ReconcilePart1c(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysBountyReserveIsVaultReserve(reconcile(s, evidence))
  ensures alwaysBountyCoverIsVaultFree(reconcile(s, evidence))
  ensures alwaysCoverAmountsValid(reconcile(s, evidence))
{
  var gross := evidence.amounts.gross;
  assert settlement__money_validAmount(gross);
  settlement__money_lawSubtractionValid_ensures(s.bounty.reserved, gross);
  var paid := s.settlement.payment.gross;
  var chosen := caseOf(s, s.vaultCase).grossChosen;
  settlement__money_lawSubtractionValid_ensures(s.settlement.vault.reserved, paid);
  settlement__money_lawSubtractionValid_ensures(s.bounty.funds.free, gross);
  settlement__money_lawSubtractionValid_ensures(s.bounty.reserved, paid);
  assert s.vaultCase in security__bounty_caseIds;
  CaseRulesOf(s.bounty, s.vaultCase);
  assert security__cases_alwaysApprovedWithinTerms(caseOf(s, s.vaultCase));
  assert settlement__money_validAmount(chosen) && settlement__money_validAmount(paid);
  settlement__money_lawEqualSymmetric_ensures(gross, chosen);
  settlement__money_lawEqualOrder_ensures(paid, chosen, gross);
  settlement__money_lawEqualOrder_ensures(chosen, gross, paid);
  settlement__money_lawEqualReflexive_ensures(paid);
  settlement__money_lawEqualSymmetric_ensures(gross, paid);
  assert settlement__money_equalAmounts(paid, gross);
  settlement__money_lawEqualOrder_ensures(paid, gross, s.bounty.reserved);
  settlement__money_lawEqualOrder_ensures(s.settlement.vault.reserved, s.bounty.reserved, paid);
  settlement__money_lawSubtractCongruence_ensures(s.settlement.vault.reserved, s.bounty.reserved, paid);
  settlement__money_lawSubtractCongruence_ensures(paid, gross, s.bounty.reserved);
  settlement__money_lawEqualOrder_ensures(settlement__money_subtractAmounts(s.settlement.vault.reserved, paid), settlement__money_subtractAmounts(s.bounty.reserved, paid), settlement__money_subtractAmounts(s.bounty.reserved, gross));
  if s.bounty.funds.asset != "" {
    SettledCoverStaysVaultFree(s.bounty.funds.free, s.bounty.reserved, gross, s.settlement.vault.free);
  }
}

lemma SettledCoverStaysVaultFree(funds: seq<int>, reserved: seq<int>, gross: seq<int>, free: seq<int>)
  requires settlement__money_validAmount(funds) && settlement__money_validAmount(reserved)
  requires settlement__money_validAmount(gross) && settlement__money_validAmount(free)
  requires settlement__money_compareAmounts(reserved, gross) >= 0
  requires settlement__money_compareAmounts(reserved, funds) > 0
    || settlement__money_compareAmounts(settlement__money_subtractAmounts(funds, reserved), free) <= 0
  ensures var nf := if settlement__money_compareAmounts(funds, gross) >= 0 then settlement__money_subtractAmounts(funds, gross) else settlement__money_zero;
    var nr := settlement__money_subtractAmounts(reserved, gross);
    settlement__money_compareAmounts(nr, nf) > 0
      || settlement__money_compareAmounts(settlement__money_subtractAmounts(nf, nr), free) <= 0
{
  var nf := if settlement__money_compareAmounts(funds, gross) >= 0 then settlement__money_subtractAmounts(funds, gross) else settlement__money_zero;
  var nr := settlement__money_subtractAmounts(reserved, gross);
  settlement__money_lawSubtractionValid_ensures(reserved, gross);
  settlement__money_lawNumericOrderTotal_ensures(funds, gross);
  if settlement__money_compareAmounts(funds, gross) < 0 {
    settlement__money_lawZeroOrder_ensures(nr);
    settlement__money_lawNumericOrderTotal_ensures(nr, settlement__money_zero);
    if settlement__money_compareAmounts(nr, settlement__money_zero) <= 0 {
      settlement__money_lawSubtractionValid_ensures(settlement__money_zero, nr);
      settlement__money_lawSubtractionAtMost_ensures(settlement__money_zero, nr);
      settlement__money_lawZeroOrder_ensures(free);
      settlement__money_lawNumericOrderTransitive_ensures(settlement__money_subtractAmounts(settlement__money_zero, nr), settlement__money_zero, free);
    }
  } else {
    settlement__money_lawSubtractionValid_ensures(funds, gross);
    settlement__money_lawNumericOrderTotal_ensures(nr, nf);
    if settlement__money_compareAmounts(nr, nf) <= 0 {
      settlement__money_lawSubtractionReconstructs_ensures(reserved, gross);
      settlement__money_lawSubtractionReconstructs_ensures(funds, gross);
      settlement__money_lawAdditionValid_ensures(nr, gross);
      settlement__money_lawAdditionValid_ensures(nf, gross);
      settlement__money_lawAddOrder_ensures(nr, nf, gross);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(nr, gross), reserved, settlement__money_addAmounts(nf, gross));
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(nf, gross), funds, reserved);
      settlement__money_lawNumericOrderTotal_ensures(reserved, funds);
      assert settlement__money_compareAmounts(reserved, funds) <= 0;
      var d := settlement__money_subtractAmounts(nf, nr);
      var c := settlement__money_subtractAmounts(funds, reserved);
      settlement__money_lawSubtractionValid_ensures(nf, nr);
      settlement__money_lawSubtractionReconstructs_ensures(nf, nr);
      settlement__money_lawAdditionValid_ensures(d, nr);
      settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(d, nr), gross);
      settlement__money_lawAdditionValid_ensures(d, settlement__money_addAmounts(nr, gross));
      settlement__money_lawAdditionValid_ensures(d, reserved);
      settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(d, nr), nf, gross);
      settlement__money_lawAddAssociative_ensures(d, nr, gross);
      settlement__money_lawAddCommutative_ensures(d, settlement__money_addAmounts(nr, gross));
      settlement__money_lawAddCommutative_ensures(d, reserved);
      settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(nr, gross), reserved, d);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(d, nr), gross), settlement__money_addAmounts(d, settlement__money_addAmounts(nr, gross)));
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(d, settlement__money_addAmounts(nr, gross)), settlement__money_addAmounts(settlement__money_addAmounts(nr, gross), d));
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(d, reserved), settlement__money_addAmounts(reserved, d));
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(d, settlement__money_addAmounts(nr, gross)), settlement__money_addAmounts(d, reserved), funds);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(settlement__money_addAmounts(d, nr), gross), settlement__money_addAmounts(d, settlement__money_addAmounts(nr, gross)), funds);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(settlement__money_addAmounts(d, nr), gross), settlement__money_addAmounts(nf, gross), funds);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(nf, gross), funds, settlement__money_addAmounts(d, reserved));
      settlement__money_lawSubtractionValid_ensures(funds, reserved);
      settlement__money_lawSubtractionReconstructs_ensures(funds, reserved);
      settlement__money_lawAdditionValid_ensures(c, reserved);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(c, reserved), funds, settlement__money_addAmounts(d, reserved));
      settlement__money_lawAddOrder_ensures(d, c, reserved);
      settlement__money_lawNumericOrderTransitive_ensures(d, c, free);
    }
  }
}

lemma ReconcilePart1b(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysVaultAwardReserved(reconcile(s, evidence))
  ensures alwaysCaseRevisionsCounted(reconcile(s, evidence))
  ensures alwaysVaultTargetMatchesAward(reconcile(s, evidence))
  ensures alwaysNothingAuthorizedBeforeAdmission(reconcile(s, evidence))
  ensures alwaysDirectJournalBound(reconcile(s, evidence))
{
  hide *;
  reveal inv, canReconcile, reconcile, withInbox, withBounty, withSettlement, caseOf, directCaseOf, vaultHold, directHold, awardTarget, alwaysVaultAwardReserved, alwaysCaseRevisionsCounted, alwaysVaultTargetMatchesAward, alwaysNothingAuthorizedBeforeAdmission, alwaysDirectJournalBound, security__bounty_settleVaultHold, security__bounty_caseOf, security__bounty_caseIds, settlement__composition_reconcile, settlement__payment_recordVaultPayment, settlement__vault_payReserved;
  var nb := security__bounty_settleVaultHold(s.bounty, s.vaultCase, vaultPayout(evidence));
  assert |nb.holds| == |s.bounty.holds|;
  assert forall i :: 0 <= i < |s.bounty.holds| ==> nb.holds[i].caseId == s.bounty.holds[i].caseId && nb.holds[i].kind == s.bounty.holds[i].kind;
  forall x ensures vaultHold(nb, x) == vaultHold(s.bounty, x) && directHold(nb, x) == directHold(s.bounty, x) {
    if vaultHold(nb, x) {
      var h :| h in nb.holds && h.caseId == x && h.kind.VaultHold?;
      var i :| 0 <= i < |nb.holds| && nb.holds[i] == h;
      assert s.bounty.holds[i] in s.bounty.holds;
    }
    if vaultHold(s.bounty, x) {
      var h :| h in s.bounty.holds && h.caseId == x && h.kind.VaultHold?;
      var i :| 0 <= i < |s.bounty.holds| && s.bounty.holds[i] == h;
      assert nb.holds[i] in nb.holds;
    }
    if directHold(nb, x) {
      var h :| h in nb.holds && h.caseId == x && h.kind.DirectHold?;
      var i :| 0 <= i < |nb.holds| && nb.holds[i] == h;
      assert s.bounty.holds[i] in s.bounty.holds;
    }
    if directHold(s.bounty, x) {
      var h :| h in s.bounty.holds && h.caseId == x && h.kind.DirectHold?;
      var i :| 0 <= i < |s.bounty.holds| && s.bounty.holds[i] == h;
      assert nb.holds[i] in nb.holds;
    }
  }
}

lemma ReconcilePart2a(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysShownAmountsExact(reconcile(s, evidence))
  ensures alwaysCommittedWithinTerms(reconcile(s, evidence))
  ensures alwaysShownCaseReceived(reconcile(s, evidence))
{
  hide *;
  reveal inv, reconcile, withInbox, withBounty, withSettlement, caseOf, alwaysShownAmountsExact, alwaysCommittedWithinTerms, alwaysShownCaseReceived, security__bounty_settleVaultHold, security__bounty_caseOf;
}

lemma ReconcilePart2c(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysAwardNoticesArePrivateCaseNotices(reconcile(s, evidence))
  ensures alwaysCommitmentNotified(reconcile(s, evidence))
{
  hide *;
  reveal inv, canReconcile, reconcile, withInbox, withBounty, withSettlement, caseOf, alwaysAwardNoticesArePrivateCaseNotices, alwaysCommitmentNotified, security__bounty_settleVaultHold, security__bounty_caseOf, security__bounty_caseIds, noticeKey, noticeCode;
  NotifyCaseFacts(s.inbox, noticeKey(AwardNotice.AwardPaid, s.vaultCase), caseOf(s, s.vaultCase));
  AwardKeysDiffer(s.vaultCase);
}

lemma ReconcilePart2b(s: PrivateAward, evidence: settlement__composition_FinalizedPayment)
  requires inv(s) && canReconcile(s, evidence)
  ensures alwaysPaidNoticeOnlyWhenPaid(reconcile(s, evidence))
  ensures alwaysPaidNotified(reconcile(s, evidence))
  ensures stepVaultReservationNeedsCommitment(s, "reconcile", reconcile(s, evidence))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "reconcile", reconcile(s, evidence))
  ensures stepAuthorizationFollowsDisplay(s, "reconcile", reconcile(s, evidence))
  ensures stepNoticesPermanent(s, reconcile(s, evidence))
{
  assert s.vaultCase in security__bounty_caseIds;
  NotifyCaseFacts(s.inbox, noticeKey(AwardNotice.AwardPaid, s.vaultCase), caseOf(s, s.vaultCase));
  PrefixKeepsNotices(s.inbox, notifyCase(s.inbox, noticeKey(AwardNotice.AwardPaid, s.vaultCase), caseOf(s, s.vaultCase)));
  assert s.directCase > 0 ==> s.directCase != s.vaultCase;
}

// Admission changes only the journal; its terms repeat the committed direct award, and nothing was authorized before it.
lemma admitDirect_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, journalTerms: settlement__directBounty_Terms, qualifiedRoute: settlement__directBounty_QualifiedRoute)
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysHoldsKeepCaseRules(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysFundsSnapshotObserved(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysBountyReserveIsVaultReserve(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysBountyCoverIsVaultFree(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysCoverAmountsValid(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysVaultAwardReserved(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysCaseRevisionsCounted(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysVaultTargetMatchesAward(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysNothingAuthorizedBeforeAdmission(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysDirectJournalBound(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysShownAmountsExact(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysCommittedWithinTerms(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysShownCaseReceived(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysAwardNoticesArePrivateCaseNotices(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysCommitmentNotified(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysPaidNoticeOnlyWhenPaid(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> alwaysPaidNotified(admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> stepVaultReservationNeedsCommitment(s, "admitDirect", admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> stepDirectPaymentNeedsFinancialApprover(s, "admitDirect", admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> stepAuthorizationFollowsDisplay(s, "admitDirect", admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
  ensures (inv(s) ==> canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) ==> stepNoticesPermanent(s, admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute)))
{
  if inv(s) && canAdmitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute) {
    var c := caseOf(s, id);
    var after := admitDirect(s, id, by_, checkedEpoch, journalTerms, qualifiedRoute);
    assert after.bounty == s.bounty && after.settlement == s.settlement && after.inbox == s.inbox;
    assert after.shown == s.shown && after.vaultCase == s.vaultCase && after.authorizedEpoch == s.authorizedEpoch;
    assert after.direct.intent == s.direct.intent && after.directCase == id;
    assert id in security__bounty_caseIds;
    CaseRulesOf(s.bounty, id);
    var h :| h in s.bounty.holds && h.caseId == id && h.kind.DirectHold?;
    assert security__bounty_holdMatches(s.bounty, h);
    assert c.commitment.DirectAward?;
    assert s.vaultCase > 0 ==> s.vaultCase != id;
    assert !settlement__directBounty_paid(s.direct);
    settlement__money_lawEqualSymmetric_ensures(c.grossChosen, journalTerms.gross);
  }
}

// The payer saw exactly the journal's gross amount.
lemma prepareDirect_ensures(s: PrivateAward, by_: int, checkedEpoch: int, intent: settlement__directBounty_Intent, observedRevision: int, proofAvailable: bool, nonceReserved: bool)
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysHoldsKeepCaseRules(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysFundsSnapshotObserved(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysBountyReserveIsVaultReserve(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysBountyCoverIsVaultFree(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysCoverAmountsValid(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysVaultAwardReserved(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysCaseRevisionsCounted(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysVaultTargetMatchesAward(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysNothingAuthorizedBeforeAdmission(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysDirectJournalBound(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysShownAmountsExact(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysCommittedWithinTerms(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysShownCaseReceived(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysAwardNoticesArePrivateCaseNotices(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysCommitmentNotified(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysPaidNoticeOnlyWhenPaid(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> alwaysPaidNotified(prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> stepVaultReservationNeedsCommitment(s, "prepareDirect", prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> stepDirectPaymentNeedsFinancialApprover(s, "prepareDirect", prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> stepAuthorizationFollowsDisplay(s, "prepareDirect", prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
  ensures (inv(s) ==> canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) ==> stepNoticesPermanent(s, prepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved)))
{
  if inv(s) && canPrepareDirect(s, by_, checkedEpoch, intent, observedRevision, proofAvailable, nonceReserved) {
    settlement__money_lawEqualReflexive_ensures(s.direct.terms.gross);
  }
}

lemma recoverDirect_ensures(s: PrivateAward, by_: int, checkedEpoch: int, successor: settlement__directBounty_Intent, retirement: settlement__directBounty_Retirement, observedRevision: int, nonceReserved: bool)
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysHoldsKeepCaseRules(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysFundsSnapshotObserved(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysBountyReserveIsVaultReserve(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysBountyCoverIsVaultFree(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysCoverAmountsValid(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysVaultAwardReserved(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysCaseRevisionsCounted(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysVaultTargetMatchesAward(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysNothingAuthorizedBeforeAdmission(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysDirectJournalBound(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysShownAmountsExact(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysCommittedWithinTerms(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysShownCaseReceived(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysAwardNoticesArePrivateCaseNotices(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysCommitmentNotified(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysPaidNoticeOnlyWhenPaid(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> alwaysPaidNotified(recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> stepVaultReservationNeedsCommitment(s, "recoverDirect", recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> stepDirectPaymentNeedsFinancialApprover(s, "recoverDirect", recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> stepAuthorizationFollowsDisplay(s, "recoverDirect", recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
  ensures (inv(s) ==> canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) ==> stepNoticesPermanent(s, recoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved)))
{
  if inv(s) && canRecoverDirect(s, by_, checkedEpoch, successor, retirement, observedRevision, nonceReserved) {
    settlement__money_lawEqualReflexive_ensures(s.direct.terms.gross);
  }
}

// Each new leg and a newly paid award save case notices under their own keys, after every earlier notice.
lemma recordTransfer_ensures(s: PrivateAward, transfer: settlement__directBounty_Transfer, observedRevision: int, generation: int)
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysHoldsKeepCaseRules(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysFundsSnapshotObserved(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysBountyReserveIsVaultReserve(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysBountyCoverIsVaultFree(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysCoverAmountsValid(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysVaultAwardReserved(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysCaseRevisionsCounted(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysVaultTargetMatchesAward(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysNothingAuthorizedBeforeAdmission(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysDirectJournalBound(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysShownAmountsExact(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysCommittedWithinTerms(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysShownCaseReceived(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysAwardNoticesArePrivateCaseNotices(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysCommitmentNotified(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysPaidNoticeOnlyWhenPaid(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> alwaysPaidNotified(recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> stepVaultReservationNeedsCommitment(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> stepDirectPaymentNeedsFinancialApprover(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> stepAuthorizationFollowsDisplay(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation)))
  ensures (inv(s) ==> canRecordTransfer(s, transfer, observedRevision, generation) ==> stepNoticesPermanent(s, recordTransfer(s, transfer, observedRevision, generation)))
{
  hide *;
  if inv(s) && canRecordTransfer(s, transfer, observedRevision, generation) {
    RecordTransferPart1(s, transfer, observedRevision, generation);
    RecordTransferPart2a(s, transfer, observedRevision, generation);
    RecordTransferPart2b(s, transfer, observedRevision, generation);
  }
}

lemma RecordTransferPart1(s: PrivateAward, transfer: settlement__directBounty_Transfer, observedRevision: int, generation: int)
  requires inv(s) && canRecordTransfer(s, transfer, observedRevision, generation)
  ensures alwaysHoldsKeepCaseRules(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysFundsSnapshotObserved(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysBountyReserveIsVaultReserve(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysBountyCoverIsVaultFree(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysCoverAmountsValid(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysVaultAwardReserved(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysCaseRevisionsCounted(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysVaultTargetMatchesAward(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysNothingAuthorizedBeforeAdmission(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysDirectJournalBound(recordTransfer(s, transfer, observedRevision, generation))
{
}

lemma DirectLegsPart2a(s: PrivateAward, d: settlement__directBounty_DirectBounty)
  requires inv(s) && s.directCase > 0
  ensures alwaysShownAmountsExact(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures alwaysCommittedWithinTerms(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures alwaysShownCaseReceived(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures alwaysAwardNoticesArePrivateCaseNotices(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures alwaysCommitmentNotified(withInbox(withDirectLegs(s, d), withDirect(d, s)))
{
  hide *;
  reveal inv, withInbox, withDirect, caseOf, directCaseOf, alwaysShownAmountsExact, alwaysCommittedWithinTerms, alwaysShownCaseReceived, alwaysAwardNoticesArePrivateCaseNotices, alwaysCommitmentNotified, noticeKey, noticeCode;
  DirectLegsFacts(s, d);
}

lemma DirectLegsPart2b(s: PrivateAward, via: string, d: settlement__directBounty_DirectBounty)
  requires inv(s) && s.directCase > 0
  requires via != "prepareDirect" && via != "recoverDirect"
  requires s.vaultCase > 0 ==> s.vaultCase != s.directCase
  requires settlement__directBounty_paid(s.direct) ==> settlement__directBounty_paid(d)
  ensures alwaysPaidNoticeOnlyWhenPaid(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures alwaysPaidNotified(withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures stepVaultReservationNeedsCommitment(s, via, withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures stepDirectPaymentNeedsFinancialApprover(s, via, withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures stepAuthorizationFollowsDisplay(s, via, withInbox(withDirectLegs(s, d), withDirect(d, s)))
  ensures stepNoticesPermanent(s, withInbox(withDirectLegs(s, d), withDirect(d, s)))
{
  hide *;
  reveal inv, withInbox, withDirect, caseOf, directCaseOf, alwaysPaidNoticeOnlyWhenPaid, alwaysPaidNotified, stepVaultReservationNeedsCommitment, stepDirectPaymentNeedsFinancialApprover, stepAuthorizationFollowsDisplay, stepNoticesPermanent, noticeKey, noticeCode;
  DirectLegsFacts(s, d);
  PrefixKeepsNotices(s.inbox, withDirectLegs(s, d));
}

lemma RecordTransferPart2a(s: PrivateAward, transfer: settlement__directBounty_Transfer, observedRevision: int, generation: int)
  requires inv(s) && canRecordTransfer(s, transfer, observedRevision, generation)
  ensures alwaysShownAmountsExact(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysCommittedWithinTerms(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysShownCaseReceived(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysAwardNoticesArePrivateCaseNotices(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysCommitmentNotified(recordTransfer(s, transfer, observedRevision, generation))
{
  hide *;
  reveal canRecordTransfer, recordTransfer;
  DirectLegsPart2a(s, settlement__directBounty_recordTransfer(s.direct, transfer, observedRevision, generation, verifiedApprover(s)));
}

lemma RecordTransferPart2b(s: PrivateAward, transfer: settlement__directBounty_Transfer, observedRevision: int, generation: int)
  requires inv(s) && canRecordTransfer(s, transfer, observedRevision, generation)
  ensures alwaysPaidNoticeOnlyWhenPaid(recordTransfer(s, transfer, observedRevision, generation))
  ensures alwaysPaidNotified(recordTransfer(s, transfer, observedRevision, generation))
  ensures stepVaultReservationNeedsCommitment(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation))
  ensures stepAuthorizationFollowsDisplay(s, "recordTransfer", recordTransfer(s, transfer, observedRevision, generation))
  ensures stepNoticesPermanent(s, recordTransfer(s, transfer, observedRevision, generation))
{
  hide *;
  reveal inv, canRecordTransfer, recordTransfer, alwaysVaultAwardReserved, alwaysDirectJournalBound, caseOf, directCaseOf, settlement__directBounty_canRecordTransfer, settlement__directBounty_recordTransfer, settlement__directBounty_paid;
  var d := settlement__directBounty_recordTransfer(s.direct, transfer, observedRevision, generation, verifiedApprover(s));
  DirectLegsPart2b(s, "recordTransfer", d);
}

lemma recordPair_ensures(s: PrivateAward, pair: settlement__directBounty_ReceiptPair, observedRevision: int, generation: int)
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysHoldsKeepCaseRules(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysFundsSnapshotObserved(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysBountyReserveIsVaultReserve(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysBountyCoverIsVaultFree(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysCoverAmountsValid(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysVaultAwardReserved(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysCaseRevisionsCounted(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysVaultTargetMatchesAward(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysNothingAuthorizedBeforeAdmission(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysDirectJournalBound(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysShownAmountsExact(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysCommittedWithinTerms(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysShownCaseReceived(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysAwardNoticesArePrivateCaseNotices(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysCommitmentNotified(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysPaidNoticeOnlyWhenPaid(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> alwaysPaidNotified(recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> stepVaultReservationNeedsCommitment(s, "recordPair", recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> stepDirectPaymentNeedsFinancialApprover(s, "recordPair", recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> stepAuthorizationFollowsDisplay(s, "recordPair", recordPair(s, pair, observedRevision, generation)))
  ensures (inv(s) ==> canRecordPair(s, pair, observedRevision, generation) ==> stepNoticesPermanent(s, recordPair(s, pair, observedRevision, generation)))
{
  hide *;
  if inv(s) && canRecordPair(s, pair, observedRevision, generation) {
    RecordPairPart1(s, pair, observedRevision, generation);
    RecordPairPart2a(s, pair, observedRevision, generation);
    RecordPairPart2b(s, pair, observedRevision, generation);
  }
}

lemma RecordPairPart1(s: PrivateAward, pair: settlement__directBounty_ReceiptPair, observedRevision: int, generation: int)
  requires inv(s) && canRecordPair(s, pair, observedRevision, generation)
  ensures alwaysHoldsKeepCaseRules(recordPair(s, pair, observedRevision, generation))
  ensures alwaysFundsSnapshotObserved(recordPair(s, pair, observedRevision, generation))
  ensures alwaysBountyReserveIsVaultReserve(recordPair(s, pair, observedRevision, generation))
  ensures alwaysBountyCoverIsVaultFree(recordPair(s, pair, observedRevision, generation))
  ensures alwaysCoverAmountsValid(recordPair(s, pair, observedRevision, generation))
  ensures alwaysVaultAwardReserved(recordPair(s, pair, observedRevision, generation))
  ensures alwaysCaseRevisionsCounted(recordPair(s, pair, observedRevision, generation))
  ensures alwaysVaultTargetMatchesAward(recordPair(s, pair, observedRevision, generation))
  ensures alwaysNothingAuthorizedBeforeAdmission(recordPair(s, pair, observedRevision, generation))
  ensures alwaysDirectJournalBound(recordPair(s, pair, observedRevision, generation))
{
}

lemma RecordPairPart2a(s: PrivateAward, pair: settlement__directBounty_ReceiptPair, observedRevision: int, generation: int)
  requires inv(s) && canRecordPair(s, pair, observedRevision, generation)
  ensures alwaysShownAmountsExact(recordPair(s, pair, observedRevision, generation))
  ensures alwaysCommittedWithinTerms(recordPair(s, pair, observedRevision, generation))
  ensures alwaysShownCaseReceived(recordPair(s, pair, observedRevision, generation))
  ensures alwaysAwardNoticesArePrivateCaseNotices(recordPair(s, pair, observedRevision, generation))
  ensures alwaysCommitmentNotified(recordPair(s, pair, observedRevision, generation))
{
  hide *;
  reveal canRecordPair, recordPair;
  DirectLegsPart2a(s, settlement__directBounty_recordPair(s.direct, pair, observedRevision, generation, verifiedApprover(s)));
}

lemma RecordPairPart2b(s: PrivateAward, pair: settlement__directBounty_ReceiptPair, observedRevision: int, generation: int)
  requires inv(s) && canRecordPair(s, pair, observedRevision, generation)
  ensures alwaysPaidNoticeOnlyWhenPaid(recordPair(s, pair, observedRevision, generation))
  ensures alwaysPaidNotified(recordPair(s, pair, observedRevision, generation))
  ensures stepVaultReservationNeedsCommitment(s, "recordPair", recordPair(s, pair, observedRevision, generation))
  ensures stepDirectPaymentNeedsFinancialApprover(s, "recordPair", recordPair(s, pair, observedRevision, generation))
  ensures stepAuthorizationFollowsDisplay(s, "recordPair", recordPair(s, pair, observedRevision, generation))
  ensures stepNoticesPermanent(s, recordPair(s, pair, observedRevision, generation))
{
  hide *;
  reveal inv, canRecordPair, recordPair, alwaysVaultAwardReserved, alwaysDirectJournalBound, caseOf, directCaseOf, settlement__directBounty_canRecordPair, settlement__directBounty_canRecordTransfer, settlement__directBounty_recordPair, settlement__directBounty_paid;
  var d := settlement__directBounty_recordPair(s.direct, pair, observedRevision, generation, verifiedApprover(s));
  DirectLegsPart2b(s, "recordPair", d);
}

// An unreceived case has unpaid terms and no award, so no amount can be shown for it; a shown amount is one the terms allow, split exactly.
lemma showAmounts_ensures(s: PrivateAward, id: int, by_: int, checkedEpoch: int, gross: seq<int>)
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysHoldsKeepCaseRules(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysFundsSnapshotObserved(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysBountyReserveIsVaultReserve(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysBountyCoverIsVaultFree(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysCoverAmountsValid(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysVaultAwardReserved(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysCaseRevisionsCounted(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysVaultTargetMatchesAward(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysNothingAuthorizedBeforeAdmission(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysDirectJournalBound(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysShownAmountsExact(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysCommittedWithinTerms(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysShownCaseReceived(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysAwardNoticesArePrivateCaseNotices(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysCommitmentNotified(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysPaidNoticeOnlyWhenPaid(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysPaidNotified(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepVaultReservationNeedsCommitment(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepDirectPaymentNeedsFinancialApprover(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepAuthorizationFollowsDisplay(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepNoticesPermanent(s, showAmounts(s, id, by_, checkedEpoch, gross)))
{
  if inv(s) && canShowAmounts(s, id, by_, checkedEpoch, gross) {
    var c := caseOf(s, id);
    assert id in security__bounty_caseIds;
    CaseRulesOf(s.bounty, id);
    if !c.submission.Verified? {
      assert c.award.NotApplicable? && !c.terms.paidTerms;
      assert !security__terms_amountAllowed(c.terms, gross);
    }
    assert security__cases_alwaysApprovedWithinTerms(c);
    assert security__terms_amountAllowed(c.terms, gross);
    var fee := settlement__money_privateFeeAmount(gross);
    var researcher := settlement__money_privateResearcherAmount(gross);
    if c.terms.split.FullAward? {
      settlement__money_lawZeroIdentity_ensures(gross);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(gross, settlement__money_zero), gross);
    } else {
      settlement__money_lawFullPrivateConservation_ensures(gross);
      settlement__money_lawAddCommutative_ensures(researcher, fee);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(fee, researcher), gross);
      settlement__money_lawEqualReflexive_ensures(researcher);
      settlement__money_lawEqualReflexive_ensures(fee);
    }
  }
}

// ---- Helpers ----

// Saving one case notice per recipient keeps every earlier notice in place, adds only case notices on the security
// outbox, and makes a notice exist for exactly the earlier ones and the saved key for each recipient.
lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  InitialPart1();
  InitialPart2();
}

lemma InitialPart1()
  ensures alwaysHoldsKeepCaseRules(initialHolds())
  ensures alwaysFundsSnapshotObserved(initialHolds())
  ensures alwaysBountyReserveIsVaultReserve(initialHolds())
  ensures alwaysBountyCoverIsVaultFree(initialHolds())
  ensures alwaysCoverAmountsValid(initialHolds())
  ensures alwaysVaultAwardReserved(initialHolds())
  ensures alwaysCaseRevisionsCounted(initialHolds())
  ensures alwaysVaultTargetMatchesAward(initialHolds())
  ensures alwaysNothingAuthorizedBeforeAdmission(initialHolds())
  ensures alwaysDirectJournalBound(initialHolds())
{
  security__bounty_initialHolds_ensures();
}

lemma InitialPart2()
  ensures alwaysShownAmountsExact(initialHolds())
  ensures alwaysCommittedWithinTerms(initialHolds())
  ensures alwaysShownCaseReceived(initialHolds())
  ensures alwaysAwardNoticesArePrivateCaseNotices(initialHolds())
  ensures alwaysCommitmentNotified(initialHolds())
  ensures alwaysPaidNoticeOnlyWhenPaid(initialHolds())
  ensures alwaysPaidNotified(initialHolds())
{
  operations__notifications_initialHolds_ensures();
}

lemma FoldSaveFacts(inbox: operations__notifications_Inbox, key: int, rs: seq<int>)
  ensures (|Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, rs).notices| >= |inbox.notices| && Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, rs).notices[..|inbox.notices|] == inbox.notices)
  ensures (operations__notifications_alwaysChannelByKind(inbox) && (forall n :: n in inbox.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?)) ==> (operations__notifications_alwaysChannelByKind(Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, rs)) && (forall n :: n in Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, rs).notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?))
  ensures (forall k, t :: operations__notifications_noticeExists(Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, rs), k, t)
            == (operations__notifications_noticeExists(inbox, k, t) || (k == key && t in rs)))
  decreases |rs|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, operations__notifications_save, operations__notifications_newNotice, operations__notifications_noticeExists, operations__notifications_alwaysChannelByKind, operations__notifications_securityKind, operations__notifications_categoryOf;
  var f := (i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t);
  if |rs| == 0 {
    assert Std.Collections.Seq.FoldLeft(f, inbox, rs) == inbox;
  } else {
    var next := operations__notifications_save(inbox, key, operations__notifications_Kind.SecurityCase, rs[0]);
    assert Std.Collections.Seq.FoldLeft(f, inbox, rs) == Std.Collections.Seq.FoldLeft(f, next, rs[1..]);
    FoldSaveFacts(next, key, rs[1..]);
    assert (|next.notices| >= |inbox.notices| && next.notices[..|inbox.notices|] == inbox.notices);
    if !operations__notifications_noticeExists(inbox, key, rs[0]) {
      var added := next.notices[|inbox.notices|];
      assert next.notices == inbox.notices + [added];
      assert added.key == key && added.recipient == rs[0] && added.kind.SecurityCase? && added.template.CaseTemplate?;
      forall n | n in next.notices ensures n in inbox.notices || n == added { }
    }
    forall k, t ensures operations__notifications_noticeExists(next, k, t) == (operations__notifications_noticeExists(inbox, k, t) || (k == key && t == rs[0])) {
      if operations__notifications_noticeExists(inbox, k, t) {
        var n :| n in inbox.notices && n.key == k && n.recipient == t;
        assert n in next.notices;
      }
      if !operations__notifications_noticeExists(inbox, key, rs[0]) {
        assert next.notices[|inbox.notices|] in next.notices;
      }
    }
    assert forall t :: t in rs <==> (t == rs[0] || t in rs[1..]);
  }
}

// The case notices of one change, as notifyCase saves them.
lemma NotifyCaseFacts(inbox: operations__notifications_Inbox, key: int, c: security__cases_PrivateCase)
  ensures (|notifyCase(inbox, key, c).notices| >= |inbox.notices| && notifyCase(inbox, key, c).notices[..|inbox.notices|] == inbox.notices)
  ensures (operations__notifications_alwaysChannelByKind(inbox) && (forall n :: n in inbox.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?)) ==> (operations__notifications_alwaysChannelByKind(notifyCase(inbox, key, c)) && (forall n :: n in notifyCase(inbox, key, c).notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?))
  ensures (forall k, t :: operations__notifications_noticeExists(notifyCase(inbox, key, c), k, t)
            == (operations__notifications_noticeExists(inbox, k, t) || (k == key && t in caseRecipients(c))))
  ensures c.reporter in caseRecipients(c)
{
  FoldSaveFacts(inbox, key, caseRecipients(c));
  assert caseRecipients(c)[0] == c.reporter;
}

// An inbox whose notices begin with every earlier notice keeps each of them unchanged.
lemma PrefixKeepsNotices(before: operations__notifications_Inbox, after: operations__notifications_Inbox)
  requires (|after.notices| >= |before.notices| && after.notices[..|before.notices|] == before.notices)
  ensures operations__notifications_stepNoticesPermanent(before, after)
{
  forall n | n in before.notices ensures n in after.notices {
    var j :| 0 <= j < |before.notices| && before.notices[j] == n;
    assert after.notices[j] == n;
  }
}

// The notices of the newly recorded direct legs and of a newly paid direct award.
lemma DirectLegsFacts(s: PrivateAward, d: settlement__directBounty_DirectBounty)
  ensures (|withDirectLegs(s, d).notices| >= |s.inbox.notices| && withDirectLegs(s, d).notices[..|s.inbox.notices|] == s.inbox.notices)
  ensures (operations__notifications_alwaysChannelByKind(s.inbox) && (forall n :: n in s.inbox.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?)) ==> (operations__notifications_alwaysChannelByKind(withDirectLegs(s, d)) && (forall n :: n in withDirectLegs(s, d).notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?))
  ensures (forall k, t :: operations__notifications_noticeExists(withDirectLegs(s, d), k, t)
            == (operations__notifications_noticeExists(s.inbox, k, t) || (t in caseRecipients(directCaseOf(s))
              && ((k == noticeKey(AwardNotice.ResearcherLegRecorded, s.directCase) && s.direct.researcherReceipt.transaction == "" && d.researcherReceipt.transaction != "")
                || (k == noticeKey(AwardNotice.FeeLegRecorded, s.directCase) && s.direct.feeReceipt.transaction == "" && d.feeReceipt.transaction != "")
                || (k == noticeKey(AwardNotice.AwardPaid, s.directCase) && settlement__directBounty_paid(d) && !settlement__directBounty_paid(s.direct))))))
  ensures directCaseOf(s).reporter in caseRecipients(directCaseOf(s))
{
  var c := directCaseOf(s);
  var researcherNew := s.direct.researcherReceipt.transaction == "" && d.researcherReceipt.transaction != "";
  var feeNew := s.direct.feeReceipt.transaction == "" && d.feeReceipt.transaction != "";
  var one := if researcherNew then notifyCase(s.inbox, noticeKey(AwardNotice.ResearcherLegRecorded, s.directCase), c) else s.inbox;
  var two := if feeNew then notifyCase(one, noticeKey(AwardNotice.FeeLegRecorded, s.directCase), c) else one;
  NotifyCaseFacts(s.inbox, noticeKey(AwardNotice.ResearcherLegRecorded, s.directCase), c);
  NotifyCaseFacts(one, noticeKey(AwardNotice.FeeLegRecorded, s.directCase), c);
  NotifyCaseFacts(two, noticeKey(AwardNotice.AwardPaid, s.directCase), c);
  assert withDirectLegs(s, d) == (if settlement__directBounty_paid(d) && !settlement__directBounty_paid(s.direct) then notifyCase(two, noticeKey(AwardNotice.AwardPaid, s.directCase), c) else two);
}

// A case of the bounty keeps the case award rules the bounty states for every case.
lemma CaseRulesOf(b: security__bounty_Bounty, id: int)
  requires security__bounty_alwaysCasesKeepAwardRules(b) && id in security__bounty_caseIds
  ensures security__cases_alwaysProposalCommitsNothing(security__bounty_caseOf(b, id)) && security__cases_alwaysCommitmentMatchesAward(security__bounty_caseOf(b, id))
    && security__cases_alwaysFullAwardHeld(security__bounty_caseOf(b, id)) && security__cases_alwaysStandardAwardRail(security__bounty_caseOf(b, id))
    && security__cases_alwaysUnpaidHasNoAward(security__bounty_caseOf(b, id)) && security__cases_alwaysVerifiedReceiptValid(security__bounty_caseOf(b, id))
    && security__cases_alwaysConfirmedHasRootCause(security__bounty_caseOf(b, id)) && security__cases_alwaysAppealState(security__bounty_caseOf(b, id))
{
}

// Two bounties with the same holds, and the same gross amount behind every hold, have the same open vault gross.
lemma OpenVaultGrossFrame(b: security__bounty_Bounty, nb: security__bounty_Bounty)
  requires nb.holds == b.holds
  requires forall h :: h in b.holds ==> security__bounty_caseOf(nb, h.caseId).grossChosen == security__bounty_caseOf(b, h.caseId).grossChosen
  ensures security__bounty_openVaultGross(nb) == security__bounty_openVaultGross(b)
{
  assert forall i :: 0 <= i < |b.holds| ==> b.holds[i] in b.holds;
  ProofLib.FoldLeftPointwise((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(nb, h.caseId).grossChosen) else total),
    (total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(b, h.caseId).grossChosen) else total),
    settlement__money_zero, nb.holds, b.holds);
}

// A step that keeps the holds, both cases and the reserved total keeps the bounty's case rules.
lemma BountyFrameKeepsCaseRules(b: security__bounty_Bounty, nb: security__bounty_Bounty)
  requires nb.holds == b.holds && nb.first == b.first && nb.second == b.second && nb.reserved == b.reserved
  requires security__bounty_alwaysHoldsMatchCases(b) && security__bounty_alwaysCasesKeepAwardRules(b) && security__bounty_alwaysReservedIsOpenVaultHolds(b)
  ensures security__bounty_alwaysHoldsMatchCases(nb) && security__bounty_alwaysCasesKeepAwardRules(nb) && security__bounty_alwaysReservedIsOpenVaultHolds(nb)
{
  OpenVaultGrossFrame(b, nb);
  forall h | h in nb.holds ensures security__bounty_holdMatches(nb, h) {
    assert security__bounty_holdMatches(b, h);
  }
  forall x | x in security__bounty_caseIds
    ensures security__bounty_hasHold(nb, x) == (security__cases_committed(security__bounty_caseOf(nb, x)) || security__bounty_caseOf(nb, x).relatedReview.ReviewPending?)
    ensures security__cases_alwaysProposalCommitsNothing(security__bounty_caseOf(nb, x)) && security__cases_alwaysCommitmentMatchesAward(security__bounty_caseOf(nb, x))
    && security__cases_alwaysFullAwardHeld(security__bounty_caseOf(nb, x)) && security__cases_alwaysStandardAwardRail(security__bounty_caseOf(nb, x))
    && security__cases_alwaysUnpaidHasNoAward(security__bounty_caseOf(nb, x)) && security__cases_alwaysVerifiedReceiptValid(security__bounty_caseOf(nb, x))
    && security__cases_alwaysConfirmedHasRootCause(security__bounty_caseOf(nb, x)) && security__cases_alwaysAppealState(security__bounty_caseOf(nb, x))
  {
    assert security__bounty_caseOf(nb, x) == security__bounty_caseOf(b, x);
    CaseRulesOf(b, x);
  }
}

// A new authority snapshot changes no hold, award, commitment, root cause or proposal, and never lowers a revision.
lemma AuthorityKeepsCaseRules(b: security__bounty_Bounty, snapshot: security__cases_Authority)
  requires security__bounty_alwaysHoldsMatchCases(b) && security__bounty_alwaysCasesKeepAwardRules(b) && security__bounty_alwaysReservedIsOpenVaultHolds(b)
  ensures security__bounty_alwaysHoldsMatchCases(security__bounty_observeAuthority(b, snapshot)) && security__bounty_alwaysCasesKeepAwardRules(security__bounty_observeAuthority(b, snapshot)) && security__bounty_alwaysReservedIsOpenVaultHolds(security__bounty_observeAuthority(b, snapshot))
{
  var nb := security__bounty_observeAuthority(b, snapshot);
  assert forall x :: x in security__bounty_caseIds ==> security__bounty_caseOf(nb, x) == security__cases_observeAuthority(security__bounty_caseOf(b, x), snapshot);
  assert forall h :: h in b.holds ==> security__bounty_caseOf(nb, h.caseId).grossChosen == security__bounty_caseOf(b, h.caseId).grossChosen;
  OpenVaultGrossFrame(b, nb);
  forall h | h in nb.holds ensures security__bounty_holdMatches(nb, h) {
    assert security__bounty_holdMatches(b, h);
  }
  forall x | x in security__bounty_caseIds
    ensures security__bounty_hasHold(nb, x) == (security__cases_committed(security__bounty_caseOf(nb, x)) || security__bounty_caseOf(nb, x).relatedReview.ReviewPending?)
    ensures security__cases_alwaysProposalCommitsNothing(security__bounty_caseOf(nb, x)) && security__cases_alwaysCommitmentMatchesAward(security__bounty_caseOf(nb, x))
    && security__cases_alwaysFullAwardHeld(security__bounty_caseOf(nb, x)) && security__cases_alwaysStandardAwardRail(security__bounty_caseOf(nb, x))
    && security__cases_alwaysUnpaidHasNoAward(security__bounty_caseOf(nb, x)) && security__cases_alwaysVerifiedReceiptValid(security__bounty_caseOf(nb, x))
    && security__cases_alwaysConfirmedHasRootCause(security__bounty_caseOf(nb, x)) && security__cases_alwaysAppealState(security__bounty_caseOf(nb, x))
  {
    CaseRulesOf(b, x);
  }
}

// A case with neither a commitment nor a pending proposal holds nothing.
lemma HoldlessCase(b: security__bounty_Bounty, id: int)
  requires security__bounty_alwaysHoldsMatchCases(b) && security__bounty_alwaysCasesKeepAwardRules(b) && security__bounty_alwaysReservedIsOpenVaultHolds(b) && id in security__bounty_caseIds
  requires !security__cases_committed(security__bounty_caseOf(b, id)) && !security__bounty_caseOf(b, id).relatedReview.ReviewPending?
  ensures !security__bounty_hasHold(b, id)
  ensures forall h :: h in b.holds ==> h.caseId != id
{
  CaseRulesOf(b, id);
  forall h | h in b.holds ensures h.caseId != id {
    if h.caseId == id { assert security__bounty_hasHold(b, id); }
  }
}

// The funds snapshot read from the vault (free plus reserved) less the reserved total the bounty counts, which equals
// the vault's reserve, never exceeds the vault's free amount.
lemma ObservedCoverIsVaultFree(vf: seq<int>, vr: seq<int>, r: seq<int>)
  requires settlement__money_validAmount(vf) && settlement__money_validAmount(vr) && settlement__money_validAmount(r)
  requires settlement__money_equalAmounts(vr, r)
  ensures settlement__money_compareAmounts(r, settlement__money_addAmounts(vf, vr)) > 0
    || settlement__money_compareAmounts(settlement__money_subtractAmounts(settlement__money_addAmounts(vf, vr), r), vf) <= 0
{
  var whole := settlement__money_addAmounts(vf, vr);
  settlement__money_lawAdditionValid_ensures(vf, vr);
  settlement__money_lawNumericOrderTotal_ensures(r, whole);
  if settlement__money_compareAmounts(r, whole) <= 0 {
    var cover := settlement__money_subtractAmounts(whole, r);
    settlement__money_lawSubtractionValid_ensures(whole, r);
    settlement__money_lawSubtractionReconstructs_ensures(whole, r);
    settlement__money_lawAddCongruence_ensures(vr, r, vf);
    settlement__money_lawAddOrder_ensures(cover, vf, r);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(cover, r), whole, settlement__money_addAmounts(vf, r));
  }
}

// The open vault gross is a valid amount when every open vault hold's award is.
lemma OpenGrossFoldValid(b: security__bounty_Bounty, hs: seq<security__bounty_Hold>, acc: seq<int>)
  requires settlement__money_validAmount(acc)
  requires forall h :: h in hs && h.kind.VaultHold? && h.settledReceipt == 0 ==> settlement__money_validAmount(security__bounty_caseOf(b, h.caseId).grossChosen)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(b, h.caseId).grossChosen) else total), acc, hs))
  decreases |hs|
{
  if |hs| > 0 {
    var h := hs[0];
    assert h in hs;
    var next := if h.kind.VaultHold? && h.settledReceipt == 0 then settlement__money_addAmounts(acc, security__bounty_caseOf(b, h.caseId).grossChosen) else acc;
    if h.kind.VaultHold? && h.settledReceipt == 0 {
      settlement__money_lawAdditionValid_ensures(acc, security__bounty_caseOf(b, h.caseId).grossChosen);
    }
    assert forall x :: x in hs[1..] ==> x in hs;
    OpenGrossFoldValid(b, hs[1..], next);
  }
}

// Every open vault hold belongs to a committed case, whose award its terms allow, so the open vault gross is valid.
lemma OpenVaultGrossValid(b: security__bounty_Bounty)
  requires security__bounty_alwaysHoldsMatchCases(b) && security__bounty_alwaysCasesKeepAwardRules(b)
  requires forall id :: id in security__bounty_caseIds ==> security__cases_alwaysApprovedWithinTerms(security__bounty_caseOf(b, id))
  ensures settlement__money_validAmount(security__bounty_openVaultGross(b))
{
  forall h | h in b.holds && h.kind.VaultHold? && h.settledReceipt == 0
    ensures settlement__money_validAmount(security__bounty_caseOf(b, h.caseId).grossChosen)
  {
    assert security__bounty_holdMatches(b, h);
    CaseRulesOf(b, h.caseId);
    assert security__cases_alwaysApprovedWithinTerms(security__bounty_caseOf(b, h.caseId));
  }
  OpenGrossFoldValid(b, b.holds, settlement__money_zero);
}

// Dropping a case's holds, none of them an open vault hold, leaves the open vault gross of the other cases.
lemma FoldWithoutCase(b: security__bounty_Bounty, nb: security__bounty_Bounty, id: int, hs: seq<security__bounty_Hold>, acc: seq<int>)
  requires forall h :: h in hs && h.caseId == id ==> !(h.kind.VaultHold? && h.settledReceipt == 0)
  requires forall h :: h in hs && h.caseId != id ==> security__bounty_caseOf(nb, h.caseId).grossChosen == security__bounty_caseOf(b, h.caseId).grossChosen
  ensures Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(nb, h.caseId).grossChosen) else total), acc, ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), hs))
    == Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(b, h.caseId).grossChosen) else total), acc, hs)
  decreases |hs|
{
  if |hs| == 0 {
    ProofLib.FilterNil((h: security__bounty_Hold) => (h.caseId != id), hs);
  } else {
    var h := hs[0];
    assert h in hs;
    assert forall x :: x in hs[1..] ==> x in hs;
    ProofLib.FilterCons((h: security__bounty_Hold) => (h.caseId != id), hs);
    var next := if h.kind.VaultHold? && h.settledReceipt == 0 then settlement__money_addAmounts(acc, security__bounty_caseOf(b, h.caseId).grossChosen) else acc;
    FoldWithoutCase(b, nb, id, hs[1..], next);
    var rest := ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), hs[1..]);
    if h.caseId != id {
      assert ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), hs) == [h] + rest;
      assert ([h] + rest)[0] == h && ([h] + rest)[1..] == rest;
    } else {
      assert next == acc;
      assert ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), hs) == rest;
    }
  }
}

// Recording a case's hold, where the case had no open vault hold, adds its award to the open vault gross exactly when
// the new hold is a vault hold.
lemma WithHoldGross(id: int, after: security__cases_PrivateCase, amount: seq<int>, b: security__bounty_Bounty)
  requires security__bounty_alwaysHoldsMatchCases(b) && id in security__bounty_caseIds
  requires forall h :: h in b.holds && h.caseId == id ==> !(h.kind.VaultHold? && h.settledReceipt == 0)
  ensures security__bounty_openVaultGross(security__bounty_withHold(id, after, amount, b)) ==
    (if after.commitment.VaultReservation? then settlement__money_addAmounts(security__bounty_openVaultGross(b), after.grossChosen) else security__bounty_openVaultGross(b))
{
  var nb := security__bounty_withHold(id, after, amount, b);
  var nh := security__bounty_holdFor(b, id, after);
  var kept := ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), b.holds);
  assert nb.holds == kept + [nh];
  forall h | h in b.holds && h.caseId != id
    ensures security__bounty_caseOf(nb, h.caseId).grossChosen == security__bounty_caseOf(b, h.caseId).grossChosen
  {
    assert security__bounty_holdMatches(b, h);
  }
  FoldWithoutCase(b, nb, id, b.holds, settlement__money_zero);
  ProofLib.FoldLeftAppend((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(nb, h.caseId).grossChosen) else total), settlement__money_zero, kept, nh);
  assert security__bounty_caseOf(nb, id) == after;
}

// A refusal keeps exactly the other cases' holds, through the library's filter view.
lemma RefusedHolds(b: security__bounty_Bounty, id: int, by_: int, checkedEpoch: int)
  ensures security__bounty_reviewRelated(b, id, by_, checkedEpoch, false).holds == ProofLib.Filter((h: security__bounty_Hold) => (h.caseId != id), b.holds)
{
}

// A refused proposal drops its hold; every other hold still matches its unchanged case.
lemma DroppedHoldKeepsRules(b: security__bounty_Bounty, id: int, by_: int, checkedEpoch: int)
  requires security__bounty_alwaysHoldsMatchCases(b) && security__bounty_alwaysCasesKeepAwardRules(b) && security__bounty_alwaysReservedIsOpenVaultHolds(b) && id in security__bounty_caseIds
  requires !security__cases_committed(security__bounty_caseOf(b, id))
  requires !security__cases_committed(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id))
  requires !security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id).relatedReview.ReviewPending?
  requires security__cases_alwaysProposalCommitsNothing(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id)) && security__cases_alwaysCommitmentMatchesAward(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id))
    && security__cases_alwaysFullAwardHeld(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id)) && security__cases_alwaysStandardAwardRail(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id))
    && security__cases_alwaysUnpaidHasNoAward(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id)) && security__cases_alwaysVerifiedReceiptValid(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id))
    && security__cases_alwaysConfirmedHasRootCause(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id)) && security__cases_alwaysAppealState(security__bounty_caseOf(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false), id))
  ensures security__bounty_alwaysHoldsMatchCases(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false)) && security__bounty_alwaysCasesKeepAwardRules(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false)) && security__bounty_alwaysReservedIsOpenVaultHolds(security__bounty_reviewRelated(b, id, by_, checkedEpoch, false))
  ensures forall h :: h in security__bounty_reviewRelated(b, id, by_, checkedEpoch, false).holds <==> h in b.holds && h.caseId != id
{
  var nb := security__bounty_reviewRelated(b, id, by_, checkedEpoch, false);
  RefusedHolds(b, id, by_, checkedEpoch);
  forall x
    ensures x in nb.holds <==> x in b.holds && x.caseId != id
  {
    ProofLib.FilterMember((h: security__bounty_Hold) => (h.caseId != id), b.holds, x);
  }
  CaseRulesOf(b, id);
  forall h | h in b.holds && h.caseId == id ensures !(h.kind.VaultHold? && h.settledReceipt == 0) {
    assert security__bounty_holdMatches(b, h);
  }
  forall h | h in b.holds && h.caseId != id
    ensures security__bounty_caseOf(nb, h.caseId).grossChosen == security__bounty_caseOf(b, h.caseId).grossChosen
  {
    assert security__bounty_holdMatches(b, h);
  }
  FoldWithoutCase(b, nb, id, b.holds, settlement__money_zero);
  assert security__bounty_openVaultGross(nb) == security__bounty_openVaultGross(b);
  forall h | h in nb.holds ensures security__bounty_holdMatches(nb, h) {
    assert h in b.holds && h.caseId != id && security__bounty_holdMatches(b, h);
    assert security__bounty_caseOf(nb, h.caseId) == security__bounty_caseOf(b, h.caseId);
  }
  forall x | x in security__bounty_caseIds
    ensures security__bounty_hasHold(nb, x) == (security__cases_committed(security__bounty_caseOf(nb, x)) || security__bounty_caseOf(nb, x).relatedReview.ReviewPending?)
    ensures security__cases_alwaysProposalCommitsNothing(security__bounty_caseOf(nb, x)) && security__cases_alwaysCommitmentMatchesAward(security__bounty_caseOf(nb, x))
    && security__cases_alwaysFullAwardHeld(security__bounty_caseOf(nb, x)) && security__cases_alwaysStandardAwardRail(security__bounty_caseOf(nb, x))
    && security__cases_alwaysUnpaidHasNoAward(security__bounty_caseOf(nb, x)) && security__cases_alwaysVerifiedReceiptValid(security__bounty_caseOf(nb, x))
    && security__cases_alwaysConfirmedHasRootCause(security__bounty_caseOf(nb, x)) && security__cases_alwaysAppealState(security__bounty_caseOf(nb, x))
  {
    if x != id {
      assert security__bounty_caseOf(nb, x) == security__bounty_caseOf(b, x);
      CaseRulesOf(b, x);
      if security__bounty_hasHold(b, x) {
        var h :| h in b.holds && h.caseId == x;
        assert h in nb.holds;
      }
    }
  }
}

// A reservation the snapshot covers keeps the cover within the vault's free amount: both sides lose the award.
lemma ReservedCoverStaysVaultFree(funds: seq<int>, reserved: seq<int>, award: seq<int>, free: seq<int>)
  requires settlement__money_validAmount(funds) && settlement__money_validAmount(reserved)
  requires settlement__money_validAmount(award) && settlement__money_validAmount(free)
  requires settlement__money_compareAmounts(reserved, funds) <= 0
  requires settlement__money_compareAmounts(settlement__money_subtractAmounts(funds, reserved), award) >= 0
  requires settlement__money_compareAmounts(settlement__money_subtractAmounts(funds, reserved), free) <= 0
  ensures settlement__money_compareAmounts(settlement__money_subtractAmounts(funds, settlement__money_addAmounts(reserved, award)), settlement__money_subtractAmounts(free, award)) <= 0
{
  var cover := settlement__money_subtractAmounts(funds, reserved);
  var sum := settlement__money_addAmounts(reserved, award);
  settlement__money_lawNumericOrderTotal_ensures(reserved, funds);
  settlement__money_lawSubtractionValid_ensures(funds, reserved);
  settlement__money_lawSubtractionReconstructs_ensures(funds, reserved);
  settlement__money_lawAdditionValid_ensures(reserved, award);
  settlement__money_lawAdditionValid_ensures(cover, reserved);
  settlement__money_lawAdditionValid_ensures(award, reserved);
  settlement__money_lawAddOrder_ensures(cover, award, reserved);
  settlement__money_lawAddCommutative_ensures(award, reserved);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(cover, reserved), funds, sum);
  assert settlement__money_compareAmounts(funds, sum) >= 0;
  var rest := settlement__money_subtractAmounts(funds, sum);
  settlement__money_lawSubtractionValid_ensures(funds, sum);
  settlement__money_lawSubtractionReconstructs_ensures(funds, sum);
  settlement__money_lawAdditionValid_ensures(rest, award);
  settlement__money_lawAdditionValid_ensures(rest, sum);
  settlement__money_lawAddAssociative_ensures(rest, award, reserved);
  var restAward := settlement__money_addAmounts(rest, award);
  settlement__money_lawAdditionValid_ensures(restAward, reserved);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(restAward, reserved), settlement__money_addAmounts(rest, sum), settlement__money_addAmounts(cover, reserved));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(rest, sum), funds, settlement__money_addAmounts(cover, reserved));
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(cover, reserved), funds);
  settlement__money_lawAddOrder_ensures(restAward, cover, reserved);
  assert settlement__money_compareAmounts(restAward, cover) == 0;
  settlement__money_lawNumericOrderTotal_ensures(cover, award);
  settlement__money_lawNumericOrderTransitive_ensures(award, cover, free);
  settlement__money_lawNumericOrderTotal_ensures(award, free);
  assert settlement__money_compareAmounts(free, award) >= 0;
  var left := settlement__money_subtractAmounts(free, award);
  settlement__money_lawSubtractionValid_ensures(free, award);
  settlement__money_lawSubtractionReconstructs_ensures(free, award);
  settlement__money_lawAdditionValid_ensures(left, award);
  settlement__money_lawEqualOrder_ensures(restAward, cover, settlement__money_addAmounts(left, award));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(left, award), free, cover);
  settlement__money_lawAddOrder_ensures(rest, left, award);
  assert settlement__money_compareAmounts(restAward, settlement__money_addAmounts(left, award)) <= 0;
}

// An award commitment notice never shares a key with a paid notice.
lemma AwardKeysDiffer(id: int)
  ensures forall x :: noticeKey(AwardNotice.AwardPaid, x) != noticeKey(AwardNotice.AwardCommitted, id)
{
}

// A step that keeps every other case's holds keeps which of those cases hold the vault.
lemma RecordedHoldKeepsVaultHolds(b: security__bounty_Bounty, nb: security__bounty_Bounty, id: int)
  requires forall h :: h in nb.holds && h.caseId != id ==> h in b.holds
  requires forall h :: h in b.holds && h.caseId != id ==> h in nb.holds
  ensures forall x :: x != id ==> vaultHold(nb, x) == vaultHold(b, x)
{
}
