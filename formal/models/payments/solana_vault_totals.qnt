// @source contracts/solana/adapter.ts
// @evidence contracts/solana/adapter.test.ts
// Two observations: initial project discovers mint; a later finalized batch
// supplies project/mint/vault together. The batch slot may differ. One project,
// two mint identities, small integer balances. Account/Token-2022 parsing and
// uint64 formats are supplied predicates. Native rent is a later current RPC
// observation, not pinned to the batch slot. This reader does not check genesis
// or deployed program bytes. Unsolicited balances do not change credited free.
module solana_vault_totals {
  type State = { phase: str, fault: str, native: bool, slot: int, discoverySlot: int,
    deposited: int, spent: int, reserved: int, accrued: int, free: int,
    vaultBalance: int, rent: int, returned: bool, error: str, principal: int, fees: int }
  var s: State
  val faults = Set("none", "first", "slot", "missing", "changed-mint", "mint", "time", "program", "vault-mint", "vault-owner", "native-shape", "rent")
  action init = s' = { phase: "input", fault: "none", native: false, slot: 0, discoverySlot: 1,
    deposited: 5, spent: 2, reserved: 1, accrued: 1, free: -1,
    vaultBalance: 4, rent: 0, returned: false, error: "none", principal: -1, fees: -1 }
  action configure(fault: str, native: bool, profile: int): bool = all {
    s.phase == "input", faults.contains(fault), 0.to(4).contains(profile),
    s' = s.with("fault", fault).with("native", native)
      .with("deposited", if (profile == 1) 2 else 5)
      .with("vaultBalance", if (profile == 2) 3 else if (profile == 3) 7 else if (native) 6 else 4)
      .with("rent", if (native) (if (profile == 4) 3 else 2) else 0) }
  def refuse(reason: str): State = s.with("phase", "done").with("error", reason)
  action discovery = all { s.phase == "input", s' = if (s.fault == "first") refuse("project") else s.with("phase", "batch") }
  action batch = all { s.phase == "batch", s' =
    if (s.fault == "slot") refuse("slot") else if (s.fault == "missing") refuse("missing")
    else if (s.fault == "changed-mint") refuse("changed-mint") else s.with("phase", "mint").with("slot", 2) }
  action mint = all { s.phase == "mint", s' =
    if (not(s.native) and s.fault == "mint") refuse("mint") else s.with("phase", "time") }
  action timestamp = all { s.phase == "time", s' = if (s.fault == "time") refuse("time") else s.with("phase", "arithmetic") }
  action arithmetic = all { s.phase == "arithmetic", s' =
    if (s.deposited < s.spent + s.reserved) refuse("negative-free")
    else s.with("phase", if (s.native) "rent" else "token-balance").with("free", s.deposited - s.spent - s.reserved) }
  action tokenBalance = all { s.phase == "token-balance", s' =
    if (Set("program", "vault-mint", "vault-owner").contains(s.fault)) refuse("vault-identity")
    else if (s.vaultBalance < s.free + s.reserved + s.accrued) refuse("vault-balance")
    else s.with("phase", "done").with("returned", true) }
  action rentRead = all { s.phase == "rent", s' = if (s.fault == "rent") refuse("rent") else s.with("phase", "native-balance") }
  action nativeBalance = all { s.phase == "native-balance", s' =
    if (s.fault == "native-shape") refuse("native-shape")
    else if (s.vaultBalance - s.rent < s.free + s.reserved + s.accrued) refuse("vault-balance")
    else s.with("phase", "done").with("returned", true) }
  action step = {
    nondet fault = faults.oneOf() nondet native = Set(false, true).oneOf() nondet profile = 0.to(4).oneOf()
    any { configure(fault, native, profile), discovery, batch, mint, timestamp, arithmetic, tokenBalance, rentRead, nativeBalance, s' = s }
  }
  val invariant = all { s.error != "none" implies not(s.returned),
    s.returned implies s.slot == 2 and s.free == s.deposited - s.spent - s.reserved and s.free >= 0,
    s.returned implies s.vaultBalance - s.rent >= s.free + s.reserved + s.accrued,
    s.principal == -1 and s.fees == -1 }
  action toBalance = discovery.then(batch).then(mint).then(timestamp).then(arithmetic)
  run tokenTotalsFromLaterBatchSlotTest = init.then(toBalance).then(tokenBalance).expect(s.returned and s.slot != s.discoverySlot and invariant)
  run nativeRentExcludedFromSpendableBalanceTest = init.then(configure("none", true, 0)).then(toBalance).then(rentRead).then(nativeBalance).expect(s.returned and s.free == 2 and invariant)
  run initialProjectFailureStopsBatchTest = init.then(configure("first", false, 0)).then(discovery).expect(s.error == "project" and invariant)
  run invalidBatchSlotReturnsNoTotalsTest = init.then(configure("slot", false, 0)).then(discovery).then(batch).expect(s.error == "slot" and invariant)
  run missingBatchAccountRefusedTest = init.then(configure("missing", false, 0)).then(discovery).then(batch).expect(s.error == "missing" and invariant)
  run changedMintBetweenDiscoveryAndBatchRefusedTest = init.then(configure("changed-mint", false, 0)).then(discovery).then(batch).expect(s.error == "changed-mint" and invariant)
  run invalidMintRefusedBeforeTimeTest = init.then(configure("mint", false, 0)).then(discovery).then(batch).then(mint).expect(s.error == "mint" and invariant)
  run unavailableBlockTimeReturnsNoCountersTest = init.then(configure("time", false, 0)).then(discovery).then(batch).then(mint).then(timestamp).expect(s.error == "time" and invariant)
  run countersOverDepositsRefusedTest = init.then(configure("none", false, 1)).then(toBalance).expect(s.error == "negative-free" and invariant)
  run tokenProgramMismatchRefusedTest = init.then(configure("program", false, 0)).then(toBalance).then(tokenBalance).expect(s.error == "vault-identity" and invariant)
  run wrongVaultMintRefusedTest = init.then(configure("vault-mint", false, 0)).then(toBalance).then(tokenBalance).expect(s.error == "vault-identity" and invariant)
  run wrongVaultAuthorityRefusedTest = init.then(configure("vault-owner", false, 0)).then(toBalance).then(tokenBalance).expect(s.error == "vault-identity" and invariant)
  run tokenShortfallRefusedTest = init.then(configure("none", false, 2)).then(toBalance).then(tokenBalance).expect(s.error == "vault-balance" and invariant)
  run unsolicitedTokensDoNotIncreaseFreeTest = init.then(configure("none", false, 3)).then(toBalance).then(tokenBalance).expect(s.returned and s.vaultBalance == 7 and s.free == 2 and invariant)
  run nativeShapeRefusedAfterRentReadTest = init.then(configure("native-shape", true, 0)).then(toBalance).then(rentRead).then(nativeBalance).expect(s.error == "native-shape" and invariant)
  run missingRentRefusedTest = init.then(configure("rent", true, 0)).then(toBalance).then(rentRead).expect(s.error == "rent" and invariant)
  run rentIncreaseCanCauseShortfallTest = init.then(configure("none", true, 4)).then(toBalance).then(rentRead).then(nativeBalance).expect(s.error == "vault-balance" and invariant)
}
