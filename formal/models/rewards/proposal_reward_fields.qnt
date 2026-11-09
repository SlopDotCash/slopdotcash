// @source src/lib/project-proposal.ts
// @source src/lib/project-schema.mjs
// @source src/lib/reward-asset.mjs
// @evidence scripts/project-proposal-rewards.test.ts
// rewardFields caller projection: one choice, one Date, native/stable/custom,
// registered or unsupported network. Date validity and helper parsing/asset
// validation are supplied outcomes. No authority, chain read or reservation.
// Custom tokens stage zero and trimmed unverified metadata without validating
// network/address/symbol/amount here. The form/API provide those other gates.
// A bad native/stable amount returns a zero staged cap rather than throwing.
// All returned rewards remain pledged, uncommitted and payment-disabled.
// Source-only scenarios, unexecuted.
module proposal_reward_fields {
  type State = { phase: str, mode: str, kind: str, networkKnown: bool,
    dateValid: bool, assetValid: bool, amountValid: bool, parsed: int,
    assetPresent: bool, escrowPresent: bool, unverifiedAsset: bool,
    cap: int, committed: int, paymentEnabled: bool, funded: bool,
    fee: int, display: str, chain: str, returned: bool, error: str }
  var s: State
  action init = s' = { phase: "input", mode: "monthly", kind: "stablecoin", networkKnown: true,
    dateValid: true, assetValid: true, amountValid: true, parsed: 1,
    assetPresent: false, escrowPresent: false, unverifiedAsset: false,
    cap: 0, committed: 0, paymentEnabled: false, funded: false,
    fee: 0, display: "none", chain: "none", returned: false, error: "none" }
  action configure(mode: str, kind: str, networkKnown: bool, dateValid: bool, assetValid: bool, amountValid: bool, parsed: int): bool = all {
    s.phase == "input", Set("none", "monthly").contains(mode),
    Set("stablecoin", "native", "token").contains(kind), 0.to(3).contains(parsed),
    mode == "none" or kind == "token" or not(amountValid) or parsed > 0,
    s' = s.with("mode", mode).with("kind", kind).with("networkKnown", networkKnown)
      .with("dateValid", dateValid).with("assetValid", assetValid)
      .with("amountValid", amountValid).with("parsed", parsed) }
  def refuse(reason: str): State = s.with("phase", "done").with("error", reason)
  action start = all { s.phase == "input", s' =
    if (s.mode == "none") s.with("phase", "time").with("chain", "base").with("fee", 100).with("display", "dollar-zero")
    else s.with("phase", "asset") }
  action chooseAsset = all { s.phase == "asset", s' =
    if (s.kind != "token" and (not(s.networkKnown) or not(s.assetValid))) refuse("asset")
    else s.with("phase", "amount").with("assetPresent", true).with("unverifiedAsset", true)
      .with("chain", if (s.networkKnown) "selected" else "unsupported") }
  action amount = all { s.phase == "amount", s' = s.with("phase", "time")
    .with("cap", if (s.kind == "token" or not(s.amountValid)) 0 else s.parsed)
    .with("display", if (s.kind == "token") "token-zero" else if (not(s.amountValid)) "invalid-zero"
      else if (s.kind == "native") "native" else "dollar")
    .with("escrowPresent", s.networkKnown).with("fee", if (s.networkKnown) 200 else 100) }
  action timestamp = all { s.phase == "time", s' =
    if (not(s.dateValid)) refuse("date") else s.with("phase", "done").with("returned", true) }
  action step = {
    nondet mode = Set("none", "monthly").oneOf()
    nondet kind = Set("stablecoin", "native", "token").oneOf()
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf() nondet d = Set(false, true).oneOf()
    nondet parsed = 0.to(3).oneOf()
    any { configure(mode, kind, a, b, c, d, parsed), start, chooseAsset, amount, timestamp, s' = s }
  }
  val invariant = all { s.committed == 0, not(s.paymentEnabled), not(s.funded),
    s.returned implies s.dateValid and s.error == "none",
    s.returned and s.mode == "none" implies not(s.assetPresent) and not(s.escrowPresent) and s.cap == 0 and s.chain == "base" and s.fee == 100,
    s.returned and s.kind == "token" implies s.cap == 0,
    s.escrowPresent implies s.mode == "monthly" and s.networkKnown and s.fee == 200,
    s.error != "none" implies not(s.returned) }
  action finish = start.then(chooseAsset).then(amount).then(timestamp)
  run unfundedIgnoresNetworkAndAssetInputTest = init.then(configure("none", "native", false, true, false, false, 3)).then(start).then(timestamp)
    .expect(s.returned and not(s.assetPresent) and s.cap == 0 and invariant)
  run unfundedStillRequiresValidDateTest = init.then(configure("none", "token", false, false, false, false, 0)).then(start).then(timestamp).expect(s.error == "date" and invariant)
  run stablecoinStagesParsedAmountTest = init.then(finish).expect(s.returned and s.cap == 1 and s.display == "dollar" and invariant)
  run nativeStagesNativeAmountTest = init.then(configure("monthly", "native", true, true, true, true, 2)).then(finish).expect(s.returned and s.cap == 2 and s.display == "native" and invariant)
  run customTokenHasZeroUntilMetadataTest = init.then(configure("monthly", "token", true, true, false, false, 3)).then(finish).expect(s.returned and s.cap == 0 and s.unverifiedAsset and invariant)
  run badCustomTokenMetadataIsNotValidatedHereTest = init.then(configure("monthly", "token", true, true, false, true, 3)).then(finish).expect(s.returned and s.unverifiedAsset and invariant)
  run unsupportedCustomTokenNetworkIsCallerGateTest = init.then(configure("monthly", "token", false, true, false, false, 3)).then(finish).expect(s.returned and s.chain == "unsupported" and not(s.escrowPresent) and invariant)
  run unsupportedNativeNetworkThrowsTest = init.then(configure("monthly", "native", false, true, true, true, 1)).then(start).then(chooseAsset).expect(s.error == "asset" and invariant)
  run unsupportedStablecoinNetworkThrowsTest = init.then(configure("monthly", "stablecoin", false, true, true, true, 1)).then(start).then(chooseAsset).expect(s.error == "asset" and invariant)
  run invalidAmountStagesZeroWithoutThrowingTest = init.then(configure("monthly", "native", true, true, true, false, 3)).then(finish).expect(s.returned and s.cap == 0 and s.display == "invalid-zero" and invariant)
  run invalidDateRejectsAfterAssetPreparationTest = init.then(configure("monthly", "token", true, false, false, false, 0)).then(finish).expect(s.error == "date" and s.assetPresent and not(s.returned) and invariant)
  run stagedManifestNeverCommitsFundsTest = init.then(finish).expect(s.cap > 0 and s.committed == 0 and not(s.funded) and not(s.paymentEnabled) and invariant)
}
