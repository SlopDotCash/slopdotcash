// @source contracts/evm/foundry.toml
// @source contracts/solana/Anchor.toml
// @source contracts/solana/Cargo.toml
// @source contracts/solana/programs/slop-escrow/Cargo.toml
// Build inputs pin toolchain/compiler, dependency versions and overflow checks.
// The optional short-delay feature labels local test output; it is not default.
module contract_build_profile {
  type S = { selected: bool, shortDelay: bool, pinned: bool, overflow: bool, built: bool, profile: str }
  var s: S
  action init = s' = { selected:false,shortDelay:false,pinned:true,overflow:true,built:false,profile:"none" }
  action choose(shortDelay: bool): bool = all { not(s.built),s'=s.with("selected",true).with("shortDelay",shortDelay) }
  action build = all { s.selected,s.pinned,s.overflow,s'=s.with("built",true).with("profile",if(s.shortDelay) "local-test" else "default") }
  action step = any { choose(true),choose(false),build,s'=s }
  val invariant = all { s.pinned,s.overflow,s.built implies s.profile==(if(s.shortDelay) "local-test" else "default") }
  run defaultBuildKeepsTimingTest = init.then(choose(false)).then(build).expect(s.profile=="default" and invariant)
  run explicitLocalFeatureTest = init.then(choose(true)).then(build).expect(s.profile=="local-test" and invariant)
}
