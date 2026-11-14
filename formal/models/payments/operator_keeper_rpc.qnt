// @source workers/operator-keeper/index.ts
// @conformance workers/operator-keeper/rpc-rotation.test.ts
// One immutable operator configuration, its two endpoint choices and one
// retained journal. URL syntax and HTTPS are input classes; the conformance
// tests exercise the actual URL parser. This models configuration selection
// and the existing chain guard, not provider responses, TLS or payment execution.
module operator_keeper_rpc {
  val overrides = Set("absent", "https", "empty", "malformed", "http")
  type Config = { network: int, signer: int, budget: int, projects: int, registry: int, rpc: int }
  val original: Config = { network: 1, signer: 2, budget: 3, projects: 4, registry: 5, rpc: 1 }
  var s: { config: Config, selected: Config, override: str, resolved: bool,
    refused: bool, ready: bool, chain: int, objectId: int, journal: int }

  action init = s' = { config: original, selected: original, override: "absent",
    resolved: false, refused: false, ready: false, chain: 0, objectId: 1, journal: 7 }
  action choose(kind: str): bool = all { overrides.contains(kind),
    s' = s.with("override", kind).with("resolved", false)
      .with("refused", false).with("ready", false).with("chain", 0) }
  action resolve = all { not(s.resolved), not(s.refused),
    s' = if (Set("empty", "malformed", "http").contains(s.override))
      s.with("refused", true)
    else s.with("resolved", true)
      .with("selected", s.config.with("rpc", if (s.override == "https") 2 else s.config.rpc)) }
  action preflight(chain: int): bool = all { s.resolved, not(s.refused), Set(1, 9).contains(chain),
    s' = s.with("chain", chain).with("ready", chain == s.config.network)
      .with("refused", chain != s.config.network) }
  action step = any {
    { nondet kind = overrides.oneOf() choose(kind) },
    resolve,
    { nondet chain = Set(1, 9).oneOf() preflight(chain) },
    s' = s,
  }
  val invariant = all {
    s.config == original,
    s.selected.network == original.network,
    s.selected.signer == original.signer,
    s.selected.budget == original.budget,
    s.selected.projects == original.projects,
    s.selected.registry == original.registry,
    s.objectId == 1 and s.journal == 7,
    s.resolved implies s.selected.rpc == (if (s.override == "https") 2 else original.rpc),
    s.ready implies (s.resolved and not(s.refused) and s.chain == original.network),
    s.refused implies not(s.ready)
  }
  run existingConfigRemainsAvailableTest = init.then(resolve).then(preflight(1))
    .expect(s.selected == original and s.ready and invariant)
  run rotationRetainsIdentityAndJournalTest = init.then(resolve).then(preflight(1))
    .then(choose("https")).then(resolve).then(preflight(1))
    .expect(s.selected.rpc == 2 and s.objectId == 1 and s.journal == 7 and invariant)
  run removingOverrideRestoresOriginalTest = init.then(choose("https")).then(resolve)
    .then(choose("absent")).then(resolve).expect(s.selected == original and invariant)
  run emptyOverrideRefusesTest = init.then(choose("empty")).then(resolve)
    .expect(s.refused and not(s.resolved) and invariant)
  run malformedOverrideRefusesTest = init.then(choose("malformed")).then(resolve)
    .expect(s.refused and not(s.resolved) and invariant)
  run insecureOverrideRefusesTest = init.then(choose("http")).then(resolve)
    .expect(s.refused and not(s.resolved) and invariant)
  run wrongChainRefusesTest = init.then(choose("https")).then(resolve).then(preflight(9))
    .expect(s.refused and not(s.ready) and s.selected.rpc == 2 and invariant)
}
