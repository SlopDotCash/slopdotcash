// @source backend/payments/wallet-registration.ts
// @source backend/payments/possession.ts
// @source workers/payment-executor/core.ts
// @source workers/payment-executor/solana.ts
// @source workers/payment-executor/binding-shared.ts
// ProjectEscrow.bindDestination/cancelBinding/pay and Solana bind_wallet/veto_binding.
// Two wallet identities, version <=3; zero production delay is explicit.
module payment_binding {
  type S = { version: int, wallet: int, cancelled: bool, paidVersion: int,
    paid: bool, consent: bool, authority: bool }
  var s: S
  action init = s' = { version: 0, wallet: 0, cancelled: false, paidVersion: 0,
    paid: false, consent: false, authority: false }
  action consent = s' = s.with("consent", true)
  action authorize = s' = s.with("authority", true)
  action bind(expected: int, wallet: int): bool = all { s.consent, s.authority,
    expected == s.version, s.version < 3, wallet > 0,
    s' = s.with("version", s.version + 1).with("wallet", wallet).with("cancelled", false).with("consent", false) }
  action cancel = all { s.version > 0, not(s.cancelled), s.version != s.paidVersion,
    s' = s.with("cancelled", true) }
  action pay(expected: int): bool = all { not(s.paid), s.version > 0,
    expected == s.version, not(s.cancelled),
    s' = s.with("paid", true).with("paidVersion", s.version) }
  action step = any { consent, authorize, bind(s.version, 1), bind(s.version, 2), cancel, pay(s.version), s' = s }
  val invariant = all { s.paid implies s.paidVersion > 0, s.paidVersion <= s.version,
    s.version == 0 implies s.wallet == 0 }
  run replacedBindingRejectsOldTest = init.then(consent).then(authorize).then(bind(0, 1)).then(consent).then(bind(1, 2)).then(pay(1).fail())
  run immediateBindingTest = init.then(consent).then(authorize).then(bind(0, 1)).then(pay(1)).expect(s.paid and invariant)
  run noWalletConsentTest = init.then(authorize).then(bind(0, 1).fail())
}
