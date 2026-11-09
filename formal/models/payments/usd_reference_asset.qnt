// @source src/lib/received-totals.ts
// @source src/lib/escrow-policy.mjs
// @evidence scripts/points-summary.test.ts
// isUsdMicroAsset: reviewed production EVM, test EVM, production Solana,
// empty-reference, unknown and inherited-property network classes. Reference identity is supplied
// from ESCROW_NETWORKS; this is not a project/vault inventory or price oracle.
// Asset inputs are strings under the typed caller contract. Lowercase 0x
// selects case-insensitive matching; other strings use exact matching.
// Exact six decimals and the testnet flag are independent gates. New runs and
// regression definitions are source-only and unexecuted.
module usd_reference_asset {
  type State = { phase: str, network: int, address: str, decimals: int,
    testnets: bool, accepted: bool }
  var s: State
  action init = s' = { phase: "input", network: 1, address: "exact", decimals: 6,
    testnets: false, accepted: false }
  action configure(network: int, address: str, decimals: int, testnets: bool): bool = all {
    s.phase == "input", 1.to(6).contains(network), Set("exact", "mixed-hex", "upper-prefix", "wrong", "mixed-base58").contains(address),
    Set(-1, 6, 9).contains(decimals), s' = s.with("network", network).with("address", address)
      .with("decimals", decimals).with("testnets", testnets) }
  action classify = all { s.phase == "input", s' = s.with("phase", "done").with("accepted",
    Set(1, 2, 3).contains(s.network) and (s.network != 2 or s.testnets)
      and s.decimals == 6 and (s.address == "exact" or (Set(1, 2).contains(s.network) and s.address == "mixed-hex"))) }
  action step = {
    nondet network = 1.to(6).oneOf()
    nondet address = Set("exact", "mixed-hex", "upper-prefix", "wrong", "mixed-base58").oneOf()
    nondet decimals = Set(-1, 6, 9).oneOf() nondet testnets = Set(false, true).oneOf()
    any { configure(network, address, decimals, testnets), classify, s' = s }
  }
  val invariant = s.accepted implies s.decimals == 6 and Set(1, 2, 3).contains(s.network)
    and (s.network != 2 or s.testnets)
  run productionReferenceAcceptedTest = init.then(classify).expect(s.accepted and invariant)
  run mixedCaseHexAcceptedTest = init.then(configure(1, "mixed-hex", 6, false)).then(classify).expect(s.accepted and invariant)
  run uppercasePrefixDoesNotSelectHexFoldingTest = init.then(configure(1, "upper-prefix", 6, false)).then(classify).expect(not(s.accepted) and invariant)
  run wrongAssetIsNotUsdTest = init.then(configure(1, "wrong", 6, false)).then(classify).expect(not(s.accepted) and invariant)
  run wrongDecimalsAreNotUsdTest = init.then(configure(1, "exact", 9, false)).then(classify).expect(not(s.accepted) and invariant)
  run negativeDecimalsAreNotUsdTest = init.then(configure(1, "exact", -1, false)).then(classify).expect(not(s.accepted) and invariant)
  run testnetReferenceExcludedInProductionTest = init.then(configure(2, "exact", 6, false)).then(classify).expect(not(s.accepted) and invariant)
  run testnetReferenceIncludedWhenRequestedTest = init.then(configure(2, "exact", 6, true)).then(classify).expect(s.accepted and invariant)
  run solanaReferenceRequiresExactCaseTest = init.then(configure(3, "mixed-base58", 6, false)).then(classify).expect(not(s.accepted) and invariant)
  run solanaReferenceAcceptedTest = init.then(configure(3, "exact", 6, false)).then(classify).expect(s.accepted and invariant)
  run networkWithoutReferenceIsNotUsdTest = init.then(configure(4, "exact", 6, true)).then(classify).expect(not(s.accepted) and invariant)
  run unknownNetworkIsNotUsdTest = init.then(configure(5, "exact", 6, true)).then(classify).expect(not(s.accepted) and invariant)
  run inheritedObjectNameIsNotNetworkTest = init.then(configure(6, "exact", 6, true)).then(classify).expect(not(s.accepted) and invariant)
}
