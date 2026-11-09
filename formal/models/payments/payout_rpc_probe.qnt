// @source scripts/check-payout-readiness.ts
// @source src/lib/escrow-policy.mjs
// @evidence scripts/payout-readiness-proof.test.ts
// Two independent probe invocations, EVM/Solana families, two sequential RPCs.
// Each RPC has separate transport/body/value boundaries. HTTP refusal, invalid
// JSON/envelope, deadline, missing result and transport failure return unreachable.
// EVM chain IDs are converted through BigInt(String(value)); malformed conversion
// is unreachable, a valid unequal value is wrong-chain. Solana compares the
// returned genesis value exactly. Head classes capture the source's format
// checks: EVM permits height zero and any 32-byte hex hash; Solana requires a
// numeric safe integer greater than zero. These observations do not authenticate
// a provider, prove independent finality, inspect contracts or activate payouts.
// JSON/number parsing and native deadline enforcement are supplied predicates.
module payout_rpc_probe {
  val ids = Set(1, 2)
  type Probe = { phase: str, family: str, chainMatches: bool, headShape: bool,
    identityCalls: int, headCalls: int, result: str }
  val unused: Probe = { phase: "unused", family: "evm", chainMatches: false,
    headShape: false, identityCalls: 0, headCalls: 0, result: "none" }
  var probes: int -> Probe
  action init = probes' = ids.mapBy(_ => unused)
  pure def done(probe: Probe, result: str): Probe = probe.with("phase", "done").with("result", result)
  action begin(id: int, family: str): bool = all { probes.get(id).phase == "unused", Set("evm", "solana").contains(family),
    probes' = probes.set(id, unused.with("family", family).with("phase", "identity-headers").with("identityCalls", 1)) }
  action headers(id: int, ok: bool): bool = {
    val probe = probes.get(id)
    all { Set("identity-headers", "head-headers").contains(probe.phase),
      probes' = probes.set(id, if (not(ok)) done(probe, "unreachable")
        else probe.with("phase", if (probe.phase == "identity-headers") "identity-body" else "head-body")) }
  }
  action body(id: int, envelope: bool): bool = {
    val probe = probes.get(id)
    all { Set("identity-body", "head-body").contains(probe.phase),
      probes' = probes.set(id, if (not(envelope)) done(probe, "unreachable")
        else probe.with("phase", if (probe.phase == "identity-body") "identity-value" else "head-value")) }
  }
  action identity(id: int, kind: str): bool = {
    val probe = probes.get(id)
    all { probe.phase == "identity-value", Set("exact", "unequal", "malformed").contains(kind),
      probes' = probes.set(id, if (kind == "exact") probe.with("chainMatches", true).with("headCalls", 1).with("phase", "head-headers")
        else done(probe, if (kind == "malformed" and probe.family == "evm") "unreachable" else "wrong-chain")) }
  }
  action head(id: int, kind: str): bool = {
    val probe = probes.get(id)
    val valid = kind == "positive" or (probe.family == "evm" and kind == "zero")
    all { probe.phase == "head-value", Set("positive", "zero", "fractional", "missing", "wrong-type", "unsafe", "bad-hash").contains(kind),
      probes' = probes.set(id, done(probe.with("headShape", valid), if (valid) "finalized" else "no-finalized-head")) }
  }
  action failure(id: int): bool = all { Set("identity-headers", "identity-body", "head-headers", "head-body").contains(probes.get(id).phase),
    probes' = probes.set(id, done(probes.get(id), "unreachable")) }
  action step = {
    nondet id = ids.oneOf()
    nondet family = Set("evm", "solana").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet identityKind = Set("exact", "unequal", "malformed").oneOf()
    nondet headKind = Set("positive", "zero", "fractional", "missing", "wrong-type", "unsafe", "bad-hash").oneOf()
    any { begin(id, family), headers(id, yes), body(id, yes), identity(id, identityKind), head(id, headKind), failure(id), probes' = probes }
  }
  val invariant = ids.forall(id => {
    val probe = probes.get(id)
    all { probe.identityCalls <= 1, probe.headCalls <= 1,
      probe.headCalls == 1 implies probe.chainMatches,
      probe.result == "finalized" implies probe.chainMatches and probe.headShape,
      Set("wrong-chain", "unreachable", "no-finalized-head").contains(probe.result) implies probe.phase == "done" }
  })
  action identified(id: int, family: str): bool = begin(id, family).then(headers(id, true)).then(body(id, true)).then(identity(id, "exact"))
  action observedHead(id: int, kind: str): bool = headers(id, true).then(body(id, true)).then(head(id, kind))
  run evmFinalizedShapeAcceptedTest = init.then(identified(1, "evm")).then(observedHead(1, "positive"))
    .expect(probes.get(1).result == "finalized" and invariant)
  run evmZeroHeightShapeAcceptedTest = init.then(identified(1, "evm")).then(observedHead(1, "zero"))
    .expect(probes.get(1).result == "finalized" and invariant)
  run evmMalformedChainValueIsUnreachableTest = init.then(begin(1, "evm")).then(headers(1, true)).then(body(1, true)).then(identity(1, "malformed"))
    .expect(probes.get(1).result == "unreachable" and probes.get(1).headCalls == 0 and invariant)
  run wrongEvmChainStopsBeforeHeadTest = init.then(begin(1, "evm")).then(headers(1, true)).then(body(1, true)).then(identity(1, "unequal"))
    .expect(probes.get(1).result == "wrong-chain" and probes.get(1).headCalls == 0 and invariant)
  run wrongSolanaGenesisStopsBeforeSlotTest = init.then(begin(1, "solana")).then(headers(1, true)).then(body(1, true)).then(identity(1, "unequal"))
    .expect(probes.get(1).result == "wrong-chain" and probes.get(1).headCalls == 0 and invariant)
  run nonStringSolanaGenesisIsWrongChainTest = init.then(begin(1, "solana")).then(headers(1, true)).then(body(1, true)).then(identity(1, "malformed"))
    .expect(probes.get(1).result == "wrong-chain" and invariant)
  run solanaPositiveSafeSlotAcceptedTest = init.then(identified(1, "solana")).then(observedHead(1, "positive"))
    .expect(probes.get(1).result == "finalized" and invariant)
  run solanaZeroSlotRefusedTest = init.then(identified(1, "solana")).then(observedHead(1, "zero"))
    .expect(probes.get(1).result == "no-finalized-head" and invariant)
  run solanaFractionalSlotRefusedTest = init.then(identified(1, "solana")).then(observedHead(1, "fractional"))
    .expect(probes.get(1).result == "no-finalized-head" and invariant)
  run solanaUnsafeSlotRefusedTest = init.then(identified(1, "solana")).then(observedHead(1, "unsafe"))
    .expect(probes.get(1).result == "no-finalized-head" and invariant)
  run malformedEvmHashIsNotFinalizedTest = init.then(identified(1, "evm")).then(observedHead(1, "bad-hash"))
    .expect(probes.get(1).result == "no-finalized-head" and invariant)
  run headerFailureIsUnreachableTest = init.then(begin(1, "evm")).then(headers(1, false))
    .expect(probes.get(1).result == "unreachable" and invariant)
  run malformedEnvelopeIsUnreachableTest = init.then(begin(1, "evm")).then(headers(1, true)).then(body(1, false))
    .expect(probes.get(1).result == "unreachable" and invariant)
  run bodyDeadlineIsUnreachableTest = init.then(identified(1, "evm")).then(headers(1, true)).then(failure(1))
    .expect(probes.get(1).result == "unreachable" and invariant)
  run missingFinalizedHeadIsNotFinalizedTest = init.then(identified(1, "evm")).then(observedHead(1, "missing"))
    .expect(probes.get(1).result == "no-finalized-head" and invariant)
  run secondInvocationDoesNotInheritFirstResultTest = init.then(begin(1, "evm")).then(failure(1))
    .then(identified(2, "evm")).then(observedHead(2, "positive"))
    .expect(probes.get(1).result == "unreachable" and probes.get(2).result == "finalized" and invariant)
}
