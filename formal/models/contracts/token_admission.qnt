// @source contracts/solana/token-extensions.ts
// @source contracts/solana/token.ts
// @source contracts/solana/programs/slop-escrow/src/token_policy.rs
// Program-specific token admission; exact byte parsing remains a refinement boundary.
module token_admission {
  type S = { program: str, initialized: bool, authoritiesDisabled: bool,
    mintExtensions: bool, accountExtensions: bool, matchingMint: bool, admitted: bool }
  var s: S
  action init = s' = {program:"unknown",initialized:false,authoritiesDisabled:false,
    mintExtensions:false,accountExtensions:false,matchingMint:false,admitted:false}
  action inspect(program: str, disabled: bool, extensions: bool, matching: bool): bool =
    s'={program:program,initialized:true,authoritiesDisabled:disabled,mintExtensions:extensions,
      accountExtensions:extensions,matchingMint:matching,admitted:false}
  val eligible = s.initialized and s.matchingMint and
    (s.program=="classic" or (s.program=="2022" and s.authoritiesDisabled and s.mintExtensions and s.accountExtensions))
  action admit = all {eligible,s'=s.with("admitted",true)}
  action inspectAny = {nondet program=Set("unknown","classic","2022").oneOf()
    nondet disabled=Set(true,false).oneOf() nondet ext=Set(true,false).oneOf() nondet matching=Set(true,false).oneOf()
    inspect(program,disabled,ext,matching)}
  action step = any {inspectAny,admit,s'=s}
  val invariant = s.admitted implies eligible
  run classicAuthorityCompatibilityTest = init.then(inspect("classic",false,false,true)).then(admit).expect(invariant)
  run unknownExtensionTest = init.then(inspect("2022",true,false,true)).then(admit.fail())
  run liveAuthorityTest = init.then(inspect("2022",false,true,true)).then(admit.fail())
  run allowedMetadataTest = init.then(inspect("2022",true,true,true)).then(admit).expect(invariant)
}
