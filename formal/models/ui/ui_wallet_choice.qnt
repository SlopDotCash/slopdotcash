// @source src/lib/use-payout-wallets.ts
// @source src/Earnings.tsx
// UUID/provider identity is sticky; discovery never connects a wallet.
module ui_wallet_choice {
  var s: { available: Set[int], conflicted: Set[int], selected: int, requested: bool, trustedAtRequest: bool }
  action init = s' = { available: Set(), conflicted: Set(), selected: 0, requested: false, trustedAtRequest: false }
  action announce(provider: int): bool = all { not(s.conflicted.contains(provider)), s' = s.with("available", s.available.union(Set(provider))) }
  action conflict(provider: int): bool = s' = s.with("conflicted", s.conflicted.union(Set(provider))).with("available", s.available.exclude(Set(provider)))
  action choose(provider: int): bool = all { s.available.contains(provider), s' = s.with("selected", provider) }
  action request = all { s.selected > 0, s.available.contains(s.selected), not(s.conflicted.contains(s.selected)),
    s' = s.with("requested", true).with("trustedAtRequest", true) }
  action step = any { announce(1), announce(2), conflict(1), conflict(2), choose(1), choose(2), request, s' = s }
  val invariant = all { s.available.intersect(s.conflicted) == Set(), s.requested implies s.trustedAtRequest }
  run discoveryTest = init.then(announce(1)).then(announce(2)).expect(not(s.requested))
  run conflictTest = init.then(announce(1)).then(choose(1)).then(conflict(1)).expect(not(s.available.contains(1)) and not(s.requested))
  run chooseTest = init.then(announce(2)).then(choose(2)).then(request).expect(s.trustedAtRequest)
}
