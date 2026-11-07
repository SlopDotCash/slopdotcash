// @source contracts/solana/scripts/owner-plan.mjs
// @source contracts/solana/scripts/config-plan.mjs
// Read-only preparation. The program, not this planner, enforces live balances,
// replay prevention and the rotation/binding timelocks at execution time.
// Two project layouts and three operations abstract the transaction builder.
module unsigned_owner_plan {
  var s: { phase: str, cluster: bool, code: bool, roles: bool,
    configExists: bool, oldMonths: bool, unsettledExpired: bool,
    operation: str, signer: str, instructions: int, signed: bool, broadcast: bool }
  action init = s' = { phase: "new", cluster: false, code: false, roles: false,
    configExists: false, oldMonths: false, unsettledExpired: false,
    operation: "none", signer: "none", instructions: 0, signed: false, broadcast: false }
  action inspect(cluster, code, roles, configPresent, oldMonths, unsettled) = all {
    s.phase == "new", s' = s.with("phase", "inspected").with("cluster", cluster)
      .with("code", code).with("roles", roles).with("configExists", configPresent)
      .with("oldMonths", oldMonths).with("unsettledExpired", unsettled) }
  action initializeConfig = all { s.phase == "inspected", s.cluster, s.code, s.roles,
    not(s.configExists), s' = s.with("phase", "planned").with("operation", "config")
      .with("signer", "upgradeAuthority").with("instructions", 1) }
  action migrate = all { s.phase == "inspected", s.cluster, s.code,
    not(s.oldMonths), not(s.unsettledExpired),
    s' = s.with("phase", "planned").with("operation", "migrate")
      .with("signer", "payer").with("instructions", 1) }
  action ownerOperation(confirmRotation) = all { s.phase == "inspected", s.cluster,
    s.code, s.roles, s.configExists,
    s' = s.with("phase", "planned").with("operation", "owner")
      .with("signer", if(confirmRotation) "rotationAuthority" else "owner")
      .with("instructions", 1) }
  action permissionlessDeposit = all { s.phase == "inspected",s.cluster,s.code,s.roles,s.configExists,
    s'=s.with("phase","planned").with("operation","deposit").with("signer","depositor").with("instructions",1) }
  action serialize = all { s.phase == "planned", s.instructions > 0,
    s' = s.with("phase", "unsigned") }
  action step = {
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    nondet d = Set(false, true).oneOf()
    nondet e = Set(false, true).oneOf()
    nondet f = Set(false, true).oneOf()
    any { inspect(a,b,c,d,e,f), initializeConfig, migrate, ownerOperation(a), permissionlessDeposit, serialize, s'=s }
  }
  val invariant = all {
    not(s.signed), not(s.broadcast),
    s.phase == "unsigned" implies (s.cluster and s.code),
    s.operation == "migrate" implies not(s.oldMonths or s.unsettledExpired),
    s.operation == "config" implies (s.roles and not(s.configExists)),
    s.operation == "owner" implies (s.configExists and s.roles),
  }
  run existingConfigCannotInitializeTest = init.then(inspect(true,true,true,true,false,false)).then(initializeConfig.fail())
  run legacyMonthStopsMigrationTest = init.then(inspect(true,true,true,true,true,false)).then(migrate.fail())
  run expiredUnsettledMonthStopsMigrationTest = init.then(inspect(true,true,true,true,false,true)).then(migrate.fail())
  run rotationUsesSeparateSignerTest = init.then(inspect(true,true,true,true,false,false))
    .then(ownerOperation(true)).then(serialize).expect(s.signer=="rotationAuthority" and invariant)
  run unsignedConfigTest = init.then(inspect(true,true,true,false,false,false)).then(initializeConfig)
    .then(serialize).expect(s.phase=="unsigned" and invariant)
  run depositUsesSelectedDepositorTest = init.then(inspect(true,true,true,true,false,false))
    .then(permissionlessDeposit).then(serialize).expect(s.signer=="depositor" and not(s.signed) and invariant)
}
