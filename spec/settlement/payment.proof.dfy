lemma configure_ensures(p: Payment, purpose: Purpose, rail: PaymentRail, gross: seq<int>, target: settlement__paymentDispatch_Target)
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysConserved(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysPaidEvidence(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysCorrectFee(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysUnconfiguredEmpty(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysAdmittedAttempts(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysCorrectRail(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> alwaysVaultPhase(configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> stepPaidPermanent(p, configure(p, purpose, rail, gross, target)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross, target) ==> stepObligationPermanent(p, configure(p, purpose, rail, gross, target)))
{
  if inv(p) && canConfigure(p, purpose, rail, gross, target) {
    var after := configure(p, purpose, rail, gross, target);
    if purpose.Ordinary? {
      settlement__money_lawOrdinaryAmountsValid_ensures(gross);
      settlement__money_lawFullOrdinaryConservation_ensures(gross);
      settlement__money_lawAddCommutative_ensures(after.principal, after.fee);
      settlement__money_lawEqualSymmetric_ensures(gross, settlement__money_addAmounts(after.principal, after.fee));
      settlement__money_lawEqualReflexive_ensures(after.fee);
    } else if purpose.PrivateStandard? {
      settlement__money_lawPrivateAmountsValid_ensures(gross);
      settlement__money_lawFullPrivateConservation_ensures(gross);
      settlement__money_lawAddCommutative_ensures(after.principal, after.fee);
      settlement__money_lawEqualSymmetric_ensures(gross, settlement__money_addAmounts(after.principal, after.fee));
      settlement__money_lawEqualReflexive_ensures(after.fee);
      settlement__money_lawEqualReflexive_ensures(after.principal);
    } else {
      settlement__money_lawZeroIdentity_ensures(gross);
      settlement__money_lawEqualSymmetric_ensures(gross, settlement__money_addAmounts(after.principal, after.fee));
      settlement__money_lawEqualReflexive_ensures(after.fee);
      settlement__money_lawEqualReflexive_ensures(after.principal);
    }
    assert alwaysCorrectFee(after) && alwaysConserved(after);
  }
}
