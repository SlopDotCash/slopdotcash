// @source contracts/solana/scripts/submission-deposits-plan.mjs
// @evidence contracts/solana/integration/submission-deposits-rehearsal.e2e.mjs
// The read-only planner of the Solana submission deposit deployment. It builds two
// unsigned transactions and one read-back, and never signs or sends: `initialize`
// for the program's upgrade authority, `open_vault` for any payer, and `status`.
// Every mode first requires the expected cluster and the reviewed program bytes
// under the upgrade authority the input names (none once it was removed).
// `initialize` is planned only while that authority exists and no Config does, for
// distinct nonzero roles, and always with the thirty-day delay. Whoever holds the
// authority signs and sends it; the chain accepts it once. The authority can be
// removed at any time by its holder, which the planner cannot prevent: removed
// before initialize, the program can never be initialized (the runbook's order
// avoids it, and the planner then refuses to plan). `status` reports the program as
// replaceable exactly while an authority exists.
// Not modeled: blockhash expiry, fee payment, and the wallet tooling that signs.
module solana_submission_deposits_deployment {
  type S = { deployed: bool, authority: bool, config: bool, delayDays: int, vault: bool,
    initializePlans: int, vaultPlans: int, plannedWithoutAuthority: bool, toolSigned: bool,
    reportedReplaceable: str }
  var s: S
  action init = s' = { deployed: false, authority: false, config: false, delayDays: 0, vault: false,
    initializePlans: 0, vaultPlans: 0, plannedWithoutAuthority: false, toolSigned: false,
    reportedReplaceable: "unread" }

  // The owner deploys the reviewed build and holds its upgrade authority.
  action deploy = all { not(s.deployed), s' = s.with("deployed", true).with("authority", true) }
  // What every mode checks before anything else.
  def reviewed(cluster: bool, bytes: bool, authorityAsNamed: bool): bool =
    s.deployed and cluster and bytes and authorityAsNamed

  action planInitialize(cluster: bool, bytes: bool, authorityAsNamed: bool, rolesValid: bool): bool = all {
    reviewed(cluster, bytes, authorityAsNamed), s.authority, not(s.config), rolesValid, s.initializePlans < 2,
    s' = s.with("initializePlans", s.initializePlans + 1)
      .with("plannedWithoutAuthority", s.plannedWithoutAuthority or not(s.authority)) }
  // The chain's own rule for the signed plan: the authority, once.
  action sendInitialize(byAuthority: bool): bool = all { s.initializePlans > 0, s.authority, byAuthority,
    not(s.config), s' = s.with("config", true).with("delayDays", 30) }

  action planVault(cluster: bool, bytes: bool, authorityAsNamed: bool, classicMint: bool): bool = all {
    reviewed(cluster, bytes, authorityAsNamed), classicMint, not(s.vault), s.vaultPlans < 2,
    s' = s.with("vaultPlans", s.vaultPlans + 1) }
  action sendVault = all { s.vaultPlans > 0, not(s.vault), s' = s.with("vault", true) }

  action removeAuthority = all { s.deployed, s.authority, s' = s.with("authority", false) }
  action status(cluster: bool, bytes: bool, authorityAsNamed: bool): bool = all {
    reviewed(cluster, bytes, authorityAsNamed),
    s' = s.with("reportedReplaceable", if (s.authority) "yes" else "no") }

  action step = {
    nondet cluster = oneOf(Set(true, false))
    nondet bytes = oneOf(Set(true, false))
    nondet named = oneOf(Set(true, false))
    nondet flag = oneOf(Set(true, false))
    any { deploy, planInitialize(cluster, bytes, named, flag), sendInitialize(flag),
      planVault(cluster, bytes, named, flag), sendVault, removeAuthority, status(cluster, bytes, named), s' = s }
  }

  val invariant = all {
    not(s.toolSigned), not(s.plannedWithoutAuthority),
    // A Config exists only through a planned initialize, with the thirty-day delay.
    s.config implies (s.initializePlans > 0 and s.delayDays == 30),
    not(s.config) implies s.delayDays == 0,
    s.vault implies s.vaultPlans > 0,
    not(s.deployed) implies (not(s.config) and not(s.vault) and s.reportedReplaceable == "unread"),
    // The read-back never calls the program fixed while an authority exists.
    s.reportedReplaceable == "no" implies not(s.authority) }

  run deployed = init.then(deploy)
  run runbookOrderTest = deployed.then(planInitialize(true, true, true, true)).then(sendInitialize(true))
    .then(planVault(true, true, true, true)).then(sendVault).then(status(true, true, true))
    .expect(s.reportedReplaceable == "yes").then(removeAuthority).then(status(true, true, true))
    .expect(s.config and s.vault and s.delayDays == 30 and s.reportedReplaceable == "no" and invariant)
  run wrongClusterPlansNothingTest = deployed.then(planInitialize(false, true, true, true).fail())
  run unreviewedBytesPlanNothingTest = deployed.then(planInitialize(true, false, true, true).fail())
  run wrongAuthorityPlansNothingTest = deployed.then(planInitialize(true, true, false, true).fail())
  run sharedRolesPlanNothingTest = deployed.then(planInitialize(true, true, true, false).fail())
  run nothingBeforeDeploymentTest = init.then(planInitialize(true, true, true, true).fail())
  run secondInitializeIsNotPlannedTest = deployed.then(planInitialize(true, true, true, true))
    .then(sendInitialize(true)).then(planInitialize(true, true, true, true).fail())
  run strangerCannotSendTheInitializePlanTest = deployed.then(planInitialize(true, true, true, true))
    .then(sendInitialize(false).fail())
  run initializeIsSentOnceTest = deployed.then(planInitialize(true, true, true, true))
    .then(planInitialize(true, true, true, true)).then(sendInitialize(true)).then(sendInitialize(true).fail())
  run removedAuthorityIsNeverPlannedForTest = deployed.then(removeAuthority)
    .then(planInitialize(true, true, true, true).fail())
  run plannedButUnsentInitializeDiesWithTheAuthorityTest = deployed.then(planInitialize(true, true, true, true))
    .then(removeAuthority).then(sendInitialize(true).fail())
  run nonClassicMintHasNoVaultPlanTest = deployed.then(planVault(true, true, true, false).fail())
  run openVaultIsNotPlannedTwiceTest = deployed.then(planVault(true, true, true, true)).then(sendVault)
    .then(planVault(true, true, true, true).fail())
  run vaultNeedsNoAuthorityTest = deployed.then(removeAuthority).then(planVault(true, true, true, true))
    .then(sendVault).expect(s.vault and invariant)
}
