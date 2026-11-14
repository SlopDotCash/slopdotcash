lemma configure_ensures(p: Payment, purpose: Purpose, rail: PaymentRail, gross: seq<int>)
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysPaidEvidence(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysCorrectFee(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysUnconfiguredEmpty(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysAdmittedAttempts(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysCorrectRail(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> alwaysConserved(configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> stepPaidPermanent(p, configure(p, purpose, rail, gross)))
  ensures (inv(p) ==> canConfigure(p, purpose, rail, gross) ==> stepObligationPermanent(p, configure(p, purpose, rail, gross)))
{
  if inv(p) && canConfigure(p, purpose, rail, gross) {
    var after := configure(p, purpose, rail, gross);
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
