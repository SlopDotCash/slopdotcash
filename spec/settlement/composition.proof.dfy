lemma deposit_ensures(s: Settlement, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysIdentityMatches(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysDispatchReserved(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysChildRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysPaidConsumesReserve(deposit(s, amount, asset, receipt, finalized)))
{
  if inv(s) && canDeposit(s, amount, asset, receipt, finalized) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__vault_deposit_ensures(s.vault, amount, asset, receipt, finalized);
    assert settlement__vault_inv(deposit(s, amount, asset, receipt, finalized).vault);
  }
}

lemma configure_ensures(s: Settlement, purpose: settlement__payment_Purpose, rail: settlement__payment_PaymentRail, gross: seq<int>)
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross) ==> alwaysIdentityMatches(configure(s, purpose, rail, gross)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross) ==> alwaysDispatchReserved(configure(s, purpose, rail, gross)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross) ==> alwaysChildRules(configure(s, purpose, rail, gross)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross) ==> alwaysPaidConsumesReserve(configure(s, purpose, rail, gross)))
{
  if inv(s) && canConfigure(s, purpose, rail, gross) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__payment_configure_ensures(s.payment, purpose, rail, gross);
    assert settlement__payment_inv(configure(s, purpose, rail, gross).payment);
  }
}

lemma reserve_ensures(s: Settlement)
  ensures (inv(s) ==> canReserve(s) ==> alwaysIdentityMatches(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysDispatchReserved(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysChildRules(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysPaidConsumesReserve(reserve(s)))
{
  if inv(s) && canReserve(s) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__vault_reserve_ensures(s.vault, s.payment.gross, s.payment.recipient, s.payment.obligation);
    assert settlement__vault_inv(reserve(s).vault);
  }
}

lemma reconcile_ensures(s: Settlement, evidence: FinalizedPayment)
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysIdentityMatches(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysDispatchReserved(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysChildRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysPaidConsumesReserve(reconcile(s, evidence)))
{
  if inv(s) && canReconcile(s, evidence) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    var observed := evidence.payment;
    settlement__payment_reconcile_ensures(s.payment, observed);
    settlement__vault_payReserved_ensures(s.vault, s.payment.gross, observed.source, observed.asset,
      observed.recipient, observed.obligation, evidence.receipt, observed.height);
    var after := reconcile(s, evidence);
    assert settlement__payment_inv(after.payment);
    assert settlement__vault_inv(after.vault);
    assert after.payment.finalizedHeight == observed.height && after.payment.phase.Paid?;
    var recorded := settlement__vault_SettlementRecord(observed.obligation, observed.recipient,
      s.payment.gross, evidence.receipt, observed.height);
    assert recorded in after.vault.settled;
    assert observed.obligation == after.payment.obligation && observed.recipient == after.payment.recipient;
    settlement__money_lawEqualReflexive_ensures(s.payment.gross);
    assert settlement__vault_settlementMatches(after.vault, after.payment.obligation,
      after.payment.recipient, after.payment.gross, after.payment.finalizedHeight);
    assert settlement__vault_alwaysSettlementHistory(after.vault);
    assert !(exists pending :: pending in after.vault.reservations && pending.obligation == recorded.obligation);
    assert !hasReserve(after);
  }
}
