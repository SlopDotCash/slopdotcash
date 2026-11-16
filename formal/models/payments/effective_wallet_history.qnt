// @source migrations/0100_effective_payment_wallets.sql
// @source backend/payments/wallet-registration.ts
// @source backend/payments/handler.ts
// Registration appends an intent; only authorization of the current claim
// replaces an already authorized payout destination. One actor/chain, three
// sequential claims; cross-chain/actor separation is in api_wallet_claims.
module effective_wallet_history {
  type S = { head: int, authorized: Set[int], history: List[int] }
  var s: S
  action init = s' = { head: 0, authorized: Set(), history: List() }
  action register = all { s.head < 3,
    s' = s.with("head", s.head + 1).with("history", s.history.append(s.head + 1)) }
  action authorize(id: int): bool = all { id == s.head, id > 0, not(s.authorized.contains(id)),
    s' = s.with("authorized", s.authorized.union(Set(id))) }
  val effective = if(s.authorized.size() == 0) s.head else s.authorized.fold(0, (prior, id) => if(id > prior) id else prior)
  action step = any { register, authorize(1), authorize(2), authorize(3), s' = s }
  val invariant = all { s.history.length() == s.head, effective <= s.head,
    s.authorized.size() > 0 implies s.authorized.contains(effective),
    s.history.indices().forall(i => s.history.nth(i) == i + 1) }
  run unsignedSuccessorPreservesDestinationTest = init.then(register).then(authorize(1))
    .then(register).then(register).expect(effective == 1 and invariant)
  run latestAuthorizedSuccessorTest = init.then(register).then(authorize(1))
    .then(register).then(register).then(authorize(3)).expect(effective == 3 and s.authorized == Set(1, 3) and invariant)
  run staleAuthorizationRefusedTest = init.then(register).then(register).then(authorize(1).fail())
  run noAuthorizationShowsLatestIntentTest = init.then(register).then(register).expect(effective == 2 and invariant)
}
