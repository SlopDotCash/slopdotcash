module settlement_history_witness {
  import settlement__money as M from "../../../gen/settlement__money"
  import settlement__vault as V from "../../../gen/settlement__vault"
  import settlement__payment as P from "../../../gen/settlement__payment"
  import settlement__composition as C from "../../../gen/settlement__composition"

  var clock: int
  action init = clock' = 0

  run unrelatedFinalizedPaymentRemainsInVaultTest = init.expect({
    val opened = V::deposit(V::initial, List(0, 2), "asset", 1, true)
    val reserved = V::reserve(opened, List(100), "other-wallet", 2)
    val prior = V::payReserved(reserved, List(100, 0), "vault", "asset", "other-wallet", 2, 2, 1)
    val admitted = { ...C::initial, vault: prior }
    val configured = C::configure(admitted, P::Ordinary, P::OrdinaryVault, List(100))
    val bound = C::bind(configured, "wallet", 1, "recipient")
    val held = C::reserve(bound)
    val signed = C::journal(held, 1)
    val sent = C::submit(signed)
    val receipt = { receipt: 3, payment: { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98, 0), fee: List(2), height: 3, finalized: true, succeeded: true } }
    val reconciled = C::reconcile(sent, receipt)
    and {
      V::canDeposit(V::initial, List(0, 2), "asset", 1, true),
      V::canReserve(opened, List(100), "other-wallet", 2),
      V::canPayReserved(reserved, List(100, 0), "vault", "asset", "other-wallet", 2, 2, 1),
      C::alwaysPaidConsumesReserve(admitted),
      C::canConfigure(admitted, P::Ordinary, P::OrdinaryVault, List(100)),
      C::canBind(configured, "wallet", 1, "recipient"),
      C::canReserve(bound),
      C::canJournal(held, 1),
      C::canSubmit(signed),
      C::canReconcile(sent, receipt),
      not(C::canReconcile(sent, { ...receipt, receipt: 2 })),
      not(C::canReconcile(reconciled, receipt)),
      C::alwaysPaidConsumesReserve(reconciled),
      V::settlementMatches(reconciled.vault, 1, "wallet", List(100), 3),
      V::settlementMatches(reconciled.vault, 2, "other-wallet", List(100), 1),
      V::stepRetainedSettlements(prior, reconciled.vault),
      M::equalAmounts(reconciled.vault.paid, List(200))
    }
  })
}
