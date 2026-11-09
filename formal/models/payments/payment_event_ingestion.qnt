// @source workers/payments/index.ts
// @source backend/payments/ledger.ts
// @source backend/payments/evm-adapter.ts
// @source contracts/solana/adapter.ts
// @evidence workers/payments/event-ingestion.test.ts
// ingestPaymentEvent and its handoff to indexPaymentEvent. One event, two
// families, ordinary/private policy, zero/one/two matching deployments. Inputs
// remain stable during the call. Field grammar, exact cached identity matching,
// adapter proof verification, monetary checks, policy and SQL atomicity are
// delegated contracts, not cryptographic or chain proofs in this model.
// Config presence is only the actual truthy-field gate, not validation of its
// full contents. Ingestion still checks config/time before the ledger's cached
// fast path. Retained matching evidence bypasses new provider/asset/policy reads;
// it does not assert those observations are current. A later matching-evidence
// read occurs only after the fresh verification/asset/policy path. A committed
// ledger batch can lose its reply. No caller result means new money was moved.
// New scenarios/regressions are unexecuted.
module payment_event_ingestion {
  val faults = Set("none", "shape", "canonical", "rpc-json", "rpc-lookup", "rpc-missing",
    "evm-fields", "chain-id", "solana-fields", "genesis-json", "genesis-missing",
    "date", "cache-read", "verification", "asset", "policy", "ledger", "reply")
  type State = { phase: str, family: str, private: bool, matches: int, fault: str,
    cachedExact: bool, laterExact: bool, adapter: str, selectedPolicy: bool,
    providerRead: bool, assetRead: bool, policyRead: bool, committed: bool,
    returned: bool, result: str }
  var s: State
  action init = s' = { phase: "input", family: "evm", private: false, matches: 1,
    fault: "none", cachedExact: false, laterExact: false, adapter: "none",
    selectedPolicy: false, providerRead: false, assetRead: false, policyRead: false,
    committed: false, returned: false, result: "none" }
  def refuse(reason: str): State = s.with("phase", "done").with("result", reason)
  action configure(family: str, private: bool, matches: int, fault: str, cached: bool, later: bool): bool = all {
    s.phase == "input", Set("evm", "solana").contains(family), 0.to(2).contains(matches), faults.contains(fault),
    s' = s.with("family", family).with("private", private).with("matches", matches)
      .with("fault", fault).with("cachedExact", cached).with("laterExact", later) }
  action request = all { s.phase == "input", s' =
    if (s.fault == "shape") refuse("shape") else s.with("phase", "selection") }
  action selectDeployment = all { s.phase == "selection", s' =
    if (s.matches != 1) refuse("selection") else s.with("phase", "identity") }
  action identity = all { s.phase == "identity", s' =
    if (s.fault == "canonical") refuse("canonical") else s.with("phase", "rpc") }
  action rpc = all { s.phase == "rpc", s' =
    if (Set("rpc-json", "rpc-lookup", "rpc-missing").contains(s.fault)) refuse(s.fault)
    else s.with("phase", "adapter") }
  action chooseAdapter = all { s.phase == "adapter", s' =
    if (s.family == "evm" and Set("evm-fields", "chain-id").contains(s.fault)) refuse(s.fault)
    else if (s.family == "solana" and s.fault == "solana-fields") refuse("solana-fields")
    else if (s.family == "solana" and Set("genesis-json", "genesis-missing").contains(s.fault)) refuse(s.fault)
    else s.with("adapter", s.family).with("phase", "time") }
  action timestamp = all { s.phase == "time", s' =
    if (s.fault == "date") refuse("date")
    else s.with("selectedPolicy", s.private).with("phase", "cache") }
  action cacheRead = all { s.phase == "cache", s' =
    if (s.fault == "cache-read") refuse("cache-read")
    else if (s.cachedExact) s.with("phase", "done").with("returned", true).with("result", "retained")
    else s.with("phase", "verify").with("providerRead", true) }
  action verify = all { s.phase == "verify", s' =
    if (s.fault == "verification") refuse("verification")
    else s.with("phase", "asset").with("assetRead", true) }
  action asset = all { s.phase == "asset", s' =
    if (s.fault == "asset") refuse("asset")
    else if (s.private) s.with("phase", "policy").with("policyRead", true)
    else s.with("phase", "ledger") }
  action authorizePolicy = all { s.phase == "policy", s' =
    if (s.fault == "policy") refuse("policy") else s.with("phase", "ledger") }
  action ledger = all { s.phase == "ledger", s' =
    if (s.fault == "ledger") refuse("ledger")
    else if (s.laterExact) s.with("phase", "done").with("returned", true).with("result", "retained-after-verification")
    else s.with("phase", "ack").with("committed", true) }
  action acknowledge = all { s.phase == "ack", s' =
    if (s.fault == "reply") refuse("reply-lost")
    else s.with("phase", "done").with("returned", true).with("result", "recorded") }
  action step = {
    nondet family = Set("evm", "solana").oneOf() nondet fault = faults.oneOf()
    nondet private = Set(false, true).oneOf() nondet cached = Set(false, true).oneOf()
    nondet later = Set(false, true).oneOf() nondet count = 0.to(2).oneOf()
    any { configure(family, private, count, fault, cached, later), request, selectDeployment,
      identity, rpc, chooseAdapter, timestamp, cacheRead, verify, asset, authorizePolicy, ledger, acknowledge, s' = s }
  }
  val invariant = all { s.providerRead implies s.adapter != "none",
    s.assetRead implies s.providerRead, s.policyRead implies s.private and s.assetRead,
    s.committed implies s.assetRead and (not(s.private) or s.policyRead),
    s.returned implies Set("retained", "retained-after-verification", "recorded").contains(s.result),
    s.result == "retained" implies not(s.providerRead) and not(s.assetRead) and not(s.policyRead) and not(s.committed),
    s.result == "retained-after-verification" implies s.providerRead and not(s.committed),
    s.result == "recorded" implies s.committed,
    s.selectedPolicy implies s.private }
  action toCache = request.then(selectDeployment).then(identity).then(rpc).then(chooseAdapter).then(timestamp)
  action ordinaryCold = toCache.then(cacheRead).then(verify).then(asset).then(ledger).then(acknowledge)
  run ordinaryRecordedEventTest = init.then(ordinaryCold).expect(s.result == "recorded" and not(s.policyRead) and invariant)
  run requestShapeRefusedTest = init.then(configure("evm", false, 1, "shape", true, false)).then(request).expect(s.result == "shape" and s.adapter == "none" and invariant)
  run absentDeploymentRefusedTest = init.then(configure("evm", false, 0, "none", true, false)).then(request).then(selectDeployment).expect(s.result == "selection" and invariant)
  run ambiguousDeploymentRefusedTest = init.then(configure("evm", false, 2, "none", true, false)).then(request).then(selectDeployment).expect(s.result == "selection" and invariant)
  run noncanonicalIdentityRefusedBeforeRpcTest = init.then(configure("evm", false, 1, "canonical", true, false)).then(request).then(selectDeployment).then(identity).expect(s.result == "canonical" and invariant)
  run invalidRpcJsonBlocksEvenCachedEventTest = init.then(configure("evm", false, 1, "rpc-json", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).expect(s.result == "rpc-json" and invariant)
  run missingRpcBlocksEvenCachedEventTest = init.then(configure("evm", false, 1, "rpc-missing", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).expect(s.result == "rpc-missing" and invariant)
  run incompleteEvmConfigRefusedTest = init.then(configure("evm", false, 1, "evm-fields", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).then(chooseAdapter).expect(s.result == "evm-fields" and invariant)
  run invalidChainIdRefusedTest = init.then(configure("evm", false, 1, "chain-id", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).then(chooseAdapter).expect(s.result == "chain-id" and invariant)
  run missingSolanaFieldsRefusedTest = init.then(configure("solana", false, 1, "solana-fields", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).then(chooseAdapter).expect(s.result == "solana-fields" and invariant)
  run missingGenesisRefusedTest = init.then(configure("solana", false, 1, "genesis-missing", true, false)).then(request).then(selectDeployment).then(identity).then(rpc).then(chooseAdapter).expect(s.result == "genesis-missing" and invariant)
  run invalidTimePrecedesLedgerCacheTest = init.then(configure("evm", true, 1, "date", true, false)).then(toCache).expect(s.result == "date" and not(s.selectedPolicy) and invariant)
  run exactRetainedEvidenceAvoidsNewProviderReadTest = init.then(configure("evm", false, 1, "verification", true, false)).then(toCache).then(cacheRead).expect(s.result == "retained" and invariant)
  run privateReplayAvoidsNewPolicyAuthorizationTest = init.then(configure("solana", true, 1, "policy", true, false)).then(toCache).then(cacheRead).expect(s.selectedPolicy and not(s.policyRead) and s.returned and invariant)
  run cacheReadFailureIsNotAReplayTest = init.then(configure("evm", false, 1, "cache-read", true, false)).then(toCache).then(cacheRead).expect(s.result == "cache-read" and not(s.returned) and invariant)
  run cachedMismatchFallsThroughToVerificationTest = init.then(configure("evm", false, 1, "verification", false, false)).then(toCache).then(cacheRead).then(verify).expect(s.providerRead and s.result == "verification" and invariant)
  run missingAssetPreventsLedgerWriteTest = init.then(configure("evm", false, 1, "asset", false, false)).then(toCache).then(cacheRead).then(verify).then(asset).expect(s.result == "asset" and not(s.committed) and invariant)
  run privatePolicyRefusalPreventsWriteTest = init.then(configure("solana", true, 1, "policy", false, false)).then(toCache).then(cacheRead).then(verify).then(asset).then(authorizePolicy).expect(s.result == "policy" and not(s.committed) and invariant)
  run lateMatchingEvidenceNeedsFullGatePathTest = init.then(configure("solana", true, 1, "none", false, true)).then(toCache).then(cacheRead).then(verify).then(asset).then(authorizePolicy).then(ledger).expect(s.result == "retained-after-verification" and s.policyRead and invariant)
  run ledgerConflictDoesNotCommitTest = init.then(configure("evm", false, 1, "ledger", false, false)).then(toCache).then(cacheRead).then(verify).then(asset).then(ledger).expect(s.result == "ledger" and not(s.committed) and invariant)
  run lostReplyKeepsCommittedEvidenceTest = init.then(configure("evm", false, 1, "reply", false, false)).then(ordinaryCold).expect(s.committed and not(s.returned) and s.result == "reply-lost" and invariant)
}
