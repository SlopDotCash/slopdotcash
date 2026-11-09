// @source scripts/check-payout-readiness.ts
// @source src/lib/escrow-policy.mjs
// @source src/lib/project-schema.mjs
// @source workers/payment-executor/mainnet-execution.mjs
// @source workers/payments/registry-database.mjs
// @source workers/payments/deployments.ts
// @evidence scripts/payout-readiness-proof.test.ts
// One network row at a time: the reporter applies these independent checks to
// every registry network. Fault tags are equivalence classes for failed source
// predicates, including missing/extra/changed/duplicate signer pins and every
// served dispatcher's service/database binding. Multiple faults may coexist.
// Registry and signer JSON/schema refusal aborts the whole report. A nonempty
// deployment without an identity or required EVM factory fails that schema
// gate; displayed missing factory/attester can also mean no deployment exists.
// Two calls
// model re-running after a configuration change; the prior probe is not reused.
// A configured report can be ready without a probe. CLI --require separately
// demands --probe, whose selected network must return finalized. That RPC result
// is an observation from an endpoint, not independent proof of chain honesty,
// deployed code, signing custody, provider reachability after the check, or
// authority to activate execution. No action runs the CLI or a provider.
module payout_readiness {
  val faultKinds = Set("no-deployment", "factory", "identity", "attester-pins", "relayer-pins",
    "rpc-url", "genesis", "dispatcher", "service", "registry-db", "mainnet-off", "invalid-source")
  type State = { phase: str, invocation: int, family: str, testnet: bool, faults: Set[str],
    probe: str, reasons: Set[str], factory: str, attester: str, rpc: str,
    executor: str, ready: bool, requiredPassed: bool }
  var s: State
  action init = s' = { phase: "input", invocation: 1, family: "evm", testnet: true, faults: Set(),
    probe: "configured", reasons: Set(), factory: "none", attester: "none", rpc: "none",
    executor: "none", ready: false, requiredPassed: false }
  action network(family: str, testnet: bool): bool = all { s.phase == "input", Set("evm", "solana").contains(family),
    s' = s.with("family", family).with("testnet", testnet) }
  action fault(kind: str): bool = all { s.phase == "input", faultKinds.contains(kind),
    s' = s.with("faults", s.faults.union(Set(kind))) }
  action probe(result: str): bool = all { s.phase == "input",
    Set("configured", "finalized", "wrong-chain", "no-finalized-head", "unreachable").contains(result), s' = s.with("probe", result) }
  val deployments = not(s.faults.contains("no-deployment"))
  val factoryMissing = s.family == "evm" and (not(deployments) or s.faults.contains("factory"))
  val attesterMissing = not(deployments) or s.faults.contains("identity") or s.faults.contains("attester-pins")
  val relayerMissing = not(deployments) or s.faults.contains("relayer-pins")
  val dispatcherMissing = s.faults.contains("dispatcher") or s.faults.contains("service")
  // No serving dispatcher adds the service reason only; there is no database
  // reason from an empty list. With any serving dispatcher, all must bind the
  // sole REGISTRY_DB entry to the checked project registry database.
  val databaseMissing = not(s.faults.contains("dispatcher")) and s.faults.contains("registry-db")
  val executionOff = not(s.testnet) and s.faults.contains("mainnet-off")
  val rpcState = if (s.faults.contains("rpc-url")) "missing" else s.probe
  val invalidSource = s.faults.contains("invalid-source") or (deployments and
    (s.faults.contains("identity") or (s.family == "evm" and s.faults.contains("factory"))))
  val expectedReasons = (if (not(deployments)) Set("no-deployment") else Set())
    .union(if (factoryMissing) Set("factory") else Set())
    .union(if (attesterMissing) Set("attester") else Set())
    .union(if (relayerMissing) Set("relayer") else Set())
    .union(if (dispatcherMissing) Set("dispatcher") else Set())
    .union(if (databaseMissing) Set("registry-db") else Set())
    .union(if (executionOff) Set("mainnet-off") else Set())
    .union(if (rpcState == "missing") Set("rpc-url") else if (Set("configured", "finalized").contains(rpcState)) Set() else Set("rpc-probe"))
    .union(if (s.family == "solana" and s.faults.contains("genesis")) Set("genesis") else Set())
  action report = all { s.phase == "input",
    s' = if (invalidSource) s.with("phase", "error") else
      s.with("phase", "reported").with("reasons", expectedReasons).with("ready", expectedReasons == Set())
        .with("factory", if (s.family == "solana") "not-applicable" else if (factoryMissing) "missing" else "configured")
        .with("attester", if (attesterMissing) "missing" else "configured").with("rpc", rpcState)
        .with("executor", if (executionOff) "off-by-review"
          else if (relayerMissing or dispatcherMissing or databaseMissing) "missing" else "enabled") }
  action requireNetwork = all { s.phase == "reported", s.ready, s.probe == "finalized",
    s' = s.with("requiredPassed", true) }
  action rerun = all { s.phase == "reported", s.invocation == 1,
    s' = s.with("phase", "input").with("invocation", 2).with("probe", "configured")
      .with("reasons", Set()).with("ready", false).with("requiredPassed", false)
      .with("factory", "none").with("attester", "none").with("rpc", "none").with("executor", "none") }
  action step = {
    nondet kind = faultKinds.oneOf()
    nondet family = Set("evm", "solana").oneOf()
    nondet testnet = Set(false, true).oneOf()
    nondet result = Set("configured", "finalized", "wrong-chain", "no-finalized-head", "unreachable").oneOf()
    any { network(family, testnet), fault(kind), probe(result), report, requireNetwork, rerun, s' = s }
  }
  val invariant = all {
    s.phase == "reported" implies s.reasons == expectedReasons and s.ready == (s.reasons == Set()),
    s.requiredPassed implies s.phase == "reported" and s.ready and s.probe == "finalized",
    s.phase == "error" implies not(s.ready) and not(s.requiredPassed),
    s.phase == "reported" and executionOff implies s.executor == "off-by-review",
    s.phase == "reported" and s.family == "solana" implies s.factory == "not-applicable" }
  run configuredNotProofTest = init.then(report).expect(s.ready and s.rpc == "configured").then(requireNetwork.fail())
  run wrongChainRefusedTest = init.then(probe("wrong-chain")).then(report).then(requireNetwork.fail())
  run wrongRegistryRefusedTest = init.then(fault("registry-db")).then(probe("finalized")).then(report).then(requireNetwork.fail())
  run exactProbeReadyTest = init.then(probe("finalized")).then(report).then(requireNetwork).expect(invariant)
  run changedConfigurationNeedsNewProbeTest = init.then(probe("finalized")).then(report).then(requireNetwork)
    .then(rerun).then(report).then(requireNetwork.fail())
  run noDeploymentProducesAllRelatedMissingReasonsTest = init.then(fault("no-deployment")).then(report)
    .expect(s.reasons == Set("no-deployment", "factory", "attester", "relayer") and invariant)
  run factoryPinsRequiredOnlyForEvmTest = init.then(network("solana", true)).then(fault("factory")).then(report)
    .expect(s.ready and s.factory == "not-applicable" and invariant)
  run invalidIdentityAbortsBeforeReportTest = init.then(fault("identity")).then(report)
    .expect(s.phase == "error" and not(s.ready) and invariant)
  run invalidEvmFactoryAbortsBeforeReportTest = init.then(fault("factory")).then(report)
    .expect(s.phase == "error" and not(s.ready) and invariant)
  run duplicateOrExtraAttesterPinsRefuseTest = init.then(fault("attester-pins")).then(report)
    .expect(s.reasons.contains("attester") and invariant)
  run relayerPinsCannotBeReplacedByAttesterPinsTest = init.then(fault("relayer-pins")).then(report)
    .expect(s.attester == "configured" and s.executor == "missing" and invariant)
  run missingDispatcherDoesNotInventDatabaseFailureTest = init.then(fault("dispatcher")).then(fault("registry-db")).then(report)
    .expect(s.reasons.contains("dispatcher") and not(s.reasons.contains("registry-db")) and invariant)
  run everyServingDispatcherNeedsFamilyServiceTest = init.then(fault("service")).then(report)
    .expect(s.executor == "missing" and s.reasons.contains("dispatcher") and invariant)
  run duplicateRegistryBindingIsMissingTest = init.then(fault("registry-db")).then(report)
    .expect(s.reasons.contains("registry-db") and invariant)
  run offByReviewOverridesDisplayButKeepsMissingReasonsTest = init.then(network("evm", false))
    .then(fault("mainnet-off")).then(fault("relayer-pins")).then(report)
    .expect(s.executor == "off-by-review" and s.reasons == Set("mainnet-off", "relayer") and invariant)
  run testnetDoesNotReadMainnetExecutionGateTest = init.then(fault("mainnet-off")).then(report)
    .expect(s.ready and s.executor == "enabled" and invariant)
  run wrongSolanaGenesisRefusesEvenFinalizedRpcTest = init.then(network("solana", true))
    .then(fault("genesis")).then(probe("finalized")).then(report).expect(s.reasons == Set("genesis") and invariant)
  run missingUrlDoesNotBorrowInjectedProbeTest = init.then(fault("rpc-url")).then(probe("finalized")).then(report)
    .expect(s.rpc == "missing" and not(s.ready) and invariant)
  run malformedSourceAbortsInsteadOfEmptyReadyReportTest = init.then(fault("invalid-source")).then(report)
    .expect(s.phase == "error" and not(s.ready) and invariant)
}
