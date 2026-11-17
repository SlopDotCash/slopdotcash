// @source backend/payments/reserved-awards-feed.ts
// @source functions/api/v1/[[path]].ts
// @evidence backend/payments/reserved-awards-feed.test.ts
// @evidence scripts/pages-secret-inventory.test.ts
// The private reserved-awards feed (operator decision, 17 November 2026; PRD
// section 9). The route answers only a request whose bearer token equals a
// configured Pages secret; an unset secret, a missing token and a wrong token
// all fall through to the API's ordinary not-found answer. One contributor
// and one project stand for every row. An award is listed while it is
// reserved and its contributor can still release it: `wallet` when no
// confirmed wallet exists on the award's network, `authorize` when one exists
// but no payout binding does. A confirmed and bound award is being paid and
// is not listed; neither is a paid award, a team account or a closed account.
// The feed is a read: asking never changes the award, wallet or binding, and
// the answer carries no amount or wallet address (the model has neither).
module api_reserved_awards_feed {
  type S = {
    secret: bool,
    // award: none, reserved, paid. wallet: none, registered, confirmed.
    award: str, wallet: str, bound: bool, team: bool, closed: bool,
    // The last answer: none, not_found, feed; and its row, if any.
    answer: str, listed: bool, needs: str
  }
  var s: S
  pure def releasable(t: S): bool =
    t.award == "reserved" and not(t.team) and not(t.closed) and not(t.wallet == "confirmed" and t.bound)
  pure def need(t: S): str = if (t.wallet == "confirmed") "authorize" else "wallet"
  action init = s' = {
    secret: false, award: "none", wallet: "none", bound: false, team: false, closed: false,
    answer: "none", listed: false, needs: "none"
  }
  // The operator creates or removes the Pages secret.
  action configure(on: bool): bool = s' = s.with("secret", on)
  // A request with no token, a wrong token or the right token.
  action ask(token: str): bool =
    if (s.secret and token == "right")
      s' = s.with("answer", "feed").with("listed", releasable(s))
        .with("needs", if (releasable(s)) need(s) else "none")
    else
      s' = s.with("answer", "not_found").with("listed", false).with("needs", "none")
  // The payment system, outside this read.
  action reserve = all { s.award == "none", s' = s.with("award", "reserved") }
  action registerWallet = all { s.wallet == "none", s' = s.with("wallet", "registered") }
  action confirmWallet = all { s.wallet == "registered", s' = s.with("wallet", "confirmed") }
  action bind = all { s.wallet == "confirmed", not(s.bound), s' = s.with("bound", true) }
  // A failed binding attempt is not a binding.
  action bindingFails = all { s.bound, s.award == "reserved", s' = s.with("bound", false) }
  action pay = all { s.award == "reserved", s.wallet == "confirmed", s.bound, s' = s.with("award", "paid") }
  action closeAccount = s' = s.with("closed", true)
  action joinTeam(member: bool): bool = s' = s.with("team", member)
  action step = any {
    nondet on = Bool.oneOf()
    configure(on),
    nondet token = Set("none", "wrong", "right").oneOf()
    ask(token),
    reserve, registerWallet, confirmWallet, bind, bindingFails, pay, closeAccount,
    nondet member = Bool.oneOf()
    joinTeam(member),
  }
  val invariant = all {
    // A row exists only in a feed answer, and only with a need.
    s.listed implies s.answer == "feed",
    s.listed == (s.needs != "none"),
    s.answer == "not_found" implies not(s.listed),
    // A binding needs a confirmed wallet; a paid award had both.
    s.bound implies s.wallet == "confirmed",
    s.award == "paid" implies (s.wallet == "confirmed"),
  }
  run unsetSecretIsNotFoundTest = init.then(reserve).then(ask("right"))
    .expect(s.answer == "not_found" and not(s.listed) and invariant)
  run wrongOrMissingTokenIsNotFoundTest = init.then(configure(true)).then(reserve).then(ask("wrong"))
    .expect(s.answer == "not_found").then(ask("none"))
    .expect(s.answer == "not_found" and not(s.listed) and invariant)
  run walletlessAwardNeedsWalletTest = init.then(configure(true)).then(reserve).then(ask("right"))
    .expect(s.answer == "feed" and s.listed and s.needs == "wallet" and invariant)
  run unconfirmedWalletStillNeedsWalletTest = init.then(configure(true)).then(reserve).then(registerWallet).then(ask("right"))
    .expect(s.listed and s.needs == "wallet" and invariant)
  run confirmedWalletNeedsAuthorizeTest = init.then(configure(true)).then(reserve).then(registerWallet).then(confirmWallet).then(ask("right"))
    .expect(s.listed and s.needs == "authorize" and invariant)
  run boundAwardIsNotListedTest = init.then(configure(true)).then(reserve).then(registerWallet).then(confirmWallet).then(bind).then(ask("right"))
    .expect(s.answer == "feed" and not(s.listed) and invariant)
  run failedBindingIsListedAgainTest = init.then(configure(true)).then(reserve).then(registerWallet).then(confirmWallet).then(bind).then(bindingFails).then(ask("right"))
    .expect(s.listed and s.needs == "authorize" and invariant)
  run paidAwardIsNotListedTest = init.then(configure(true)).then(reserve).then(registerWallet).then(confirmWallet).then(bind).then(pay).then(ask("right"))
    .expect(s.answer == "feed" and not(s.listed) and invariant)
  run teamAccountIsNotListedTest = init.then(configure(true)).then(reserve).then(joinTeam(true)).then(ask("right"))
    .expect(s.answer == "feed" and not(s.listed) and invariant)
  run closedAccountIsNotListedTest = init.then(configure(true)).then(reserve).then(closeAccount).then(ask("right"))
    .expect(s.answer == "feed" and not(s.listed) and invariant)
  run removedSecretClosesTheRouteTest = init.then(configure(true)).then(reserve).then(ask("right")).then(configure(false)).then(ask("right"))
    .expect(s.answer == "not_found" and not(s.listed) and invariant)
  run askingChangesNoPaymentStateTest = init.then(configure(true)).then(reserve).then(registerWallet).then(ask("right"))
    .expect(s.award == "reserved" and s.wallet == "registered" and not(s.bound) and invariant)
}
