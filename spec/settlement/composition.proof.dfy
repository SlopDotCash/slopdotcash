lemma deposit_ensures(s: Settlement, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysIdentityMatches(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysDispatchReserved(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysCanonicalReceiptAgrees(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysChildRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysPaidConsumesReserve(deposit(s, amount, asset, receipt, finalized)))
{
  if inv(s) && canDeposit(s, amount, asset, receipt, finalized) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__vault_deposit_ensures(s.vault, amount, asset, receipt, finalized);
    assert settlement__vault_inv(deposit(s, amount, asset, receipt, finalized).vault);
  }
}

lemma configure_ensures(s: Settlement, purpose: settlement__payment_Purpose, rail: settlement__payment_PaymentRail, gross: seq<int>, target: settlement__paymentDispatch_Target)
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross, target) ==> alwaysIdentityMatches(configure(s, purpose, rail, gross, target)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross, target) ==> alwaysDispatchReserved(configure(s, purpose, rail, gross, target)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross, target) ==> alwaysCanonicalReceiptAgrees(configure(s, purpose, rail, gross, target)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross, target) ==> alwaysChildRules(configure(s, purpose, rail, gross, target)))
  ensures (inv(s) ==> canConfigure(s, purpose, rail, gross, target) ==> alwaysPaidConsumesReserve(configure(s, purpose, rail, gross, target)))
{
  if inv(s) && canConfigure(s, purpose, rail, gross, target) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__payment_configure_ensures(s.payment, purpose, rail, gross, target);
    assert settlement__payment_inv(configure(s, purpose, rail, gross, target).payment);
  }
}

lemma reserve_ensures(s: Settlement)
  ensures (inv(s) ==> canReserve(s) ==> alwaysIdentityMatches(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysDispatchReserved(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysCanonicalReceiptAgrees(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysChildRules(reserve(s)))
  ensures (inv(s) ==> canReserve(s) ==> alwaysPaidConsumesReserve(reserve(s)))
{
  if inv(s) && canReserve(s) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    settlement__vault_reserve_ensures(s.vault, s.payment.gross, s.payment.target.actor, s.payment.obligation);
    settlement__payment_reserveVault_ensures(s.payment);
    settlement__paymentDispatch_admit_ensures(s.delivery, s.payment.target, true);
    var after := reserve(s);
    assert settlement__vault_inv(after.vault);
    assert settlement__payment_inv(after.payment);
    assert settlement__paymentDispatch_inv(after.delivery);
    settlement__money_lawEqualReflexive_ensures(s.payment.gross);
    var reservation := settlement__vault_Reservation(s.payment.obligation, s.payment.target.actor, s.payment.gross);
    assert reservation in after.vault.reservations;
    assert hasReserve(after);
  }
}

lemma reconcile_ensures(s: Settlement, evidence: FinalizedPayment)
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysIdentityMatches(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysDispatchReserved(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysCanonicalReceiptAgrees(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysChildRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysPaidConsumesReserve(reconcile(s, evidence)))
{
  if inv(s) && canReconcile(s, evidence) {
    assert settlement__vault_inv(s.vault) && settlement__payment_inv(s.payment);
    var observed := evidence.amounts;
    var chainReceipt := evidence.scanner;
    settlement__vault_payReserved_ensures(s.vault, s.payment.gross, chainReceipt.target.vault, chainReceipt.target.asset,
      chainReceipt.target.actor, chainReceipt.destination, observed.obligation, evidence.receipt, observed.height, chainReceipt.tx);
    settlement__paymentDispatch_indexFinalized_ensures(s.delivery, chainReceipt);
    var after := reconcile(s, evidence);
    assert settlement__vault_inv(after.vault);
    assert settlement__paymentDispatch_inv(after.delivery);
    assert after.payment.finalizedHeight == observed.height && after.payment.phase.Paid?;
    var recorded := settlement__vault_SettlementRecord(observed.obligation, chainReceipt.target.actor, chainReceipt.destination,
      s.payment.gross, evidence.receipt, observed.height, chainReceipt.tx);
    assert recorded in after.vault.settled;
    assert observed.obligation == after.payment.obligation;
    settlement__money_lawEqualReflexive_ensures(s.payment.gross);
    assert settlement__vault_settlementMatches(after.vault, after.payment.obligation,
      after.payment.target.actor, chainReceipt.destination, after.payment.gross, after.payment.finalizedHeight, chainReceipt.tx);
    assert settlement__vault_alwaysSettlementHistory(after.vault);
    assert !(exists pending :: pending in after.vault.reservations && pending.obligation == recorded.obligation);
    assert !hasReserve(after);
  }
}

lemma updateDelivery_ensures(s: Settlement, update: DeliveryUpdate)
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysIdentityMatches(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysDispatchReserved(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysCanonicalReceiptAgrees(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysChildRules(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysPaidConsumesReserve(updateDelivery(s, update)))
{
  if inv(s) && canUpdateDelivery(s, update) {
    assert settlement__paymentDispatch_inv(s.delivery);
    if update.SetWallet? {
      var binding := settlement__paymentDispatch_Binding(update.claim, update.digest, update.address);
      settlement__paymentDispatch_authorizeWallet_ensures(s.delivery, binding, true);
    } else if update.TakeLease? {
      settlement__paymentDispatch_acquire_ensures(s.delivery, update.token);
    } else if update.CaptureClaim? {
      settlement__paymentDispatch_readClaim_ensures(s.delivery, update.token);
    } else if update.PrepareKey? {
      settlement__paymentDispatch_prepare_ensures(s.delivery, update.token, update.key);
    } else if update.NoteAmbiguity? {
      settlement__paymentDispatch_returnAmbiguous_ensures(s.delivery, update.token);
    } else {
      settlement__paymentDispatch_returnSuccess_ensures(s.delivery, update.token, update.tx);
    }
    var after := updateDelivery(s, update);
    assert settlement__paymentDispatch_inv(after.delivery);
    assert after.delivery.target == s.delivery.target && after.delivery.admitted == s.delivery.admitted;
    assert after.delivery.queue.Indexed? == s.delivery.queue.Indexed? && after.delivery.receipt == s.delivery.receipt;
  }
}
