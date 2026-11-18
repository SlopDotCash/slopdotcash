// @source scripts/inspect-slopbot-runtime.ts
// @evidence scripts/inspect-slopbot-runtime.test.ts
// Finite lifecycle abstraction, not full parser/source refinement. Shape and
// equality booleans abstract UUID/schema checks and the exact lowercase 40-SHA.
// CPU boundary representatives abstract safe integers; observation means the
// five-field safe projection, never raw responses, bindings or credentials.
// Metadata is not Paid entitlement, readiness or workflow-execution evidence.
module slopbot_runtime_metadata {
  var s: { phase: str, selection: bool, authority: bool, expected: bool, calls: int,
    deployment: bool, coherent: bool, source: bool, cpu: int, usage: str,
    stable: bool, observation: bool, raw: bool, remoteWrite: bool, expanded: bool }
  action init = s' = { phase: "selection", selection: false, authority: false, expected: false, calls: 0,
    deployment: false, coherent: false, source: false, cpu: 0, usage: "invalid",
    stable: false, observation: false, raw: false, remoteWrite: false, expanded: false }
  val validRuntime = s.cpu > 0 and s.cpu <= 300000 and s.usage.in(Set("standard", "bundled", "unbound"))
  // The credential-free workflow selector rejects mixed probe/rotation inputs.
  action qualifySelection(exactSource, readbackOnly) = all { s.phase == "selection",
    s' = s.with("selection", exactSource and readbackOnly)
      .with("phase", if (exactSource and readbackOnly) "authority" else "unavailable") }
  action admit(authority, expected, tls) = all { s.phase == "authority",
    s' = s.with("authority", authority).with("expected", expected)
      .with("phase", if (authority and expected and tls) "deployment-before" else "unavailable") }
  action before(valid) = all { s.phase == "deployment-before",
    s' = s.with("calls", 1).with("deployment", valid)
      .with("phase", if (valid) "version" else "unavailable") }
  action version(coherent, source, cpu, usage) = all { s.phase == "version",
    s' = s.with("calls", 2).with("coherent", coherent).with("source", source)
      .with("cpu", cpu).with("usage", usage).with("phase",
        if (coherent and source and cpu > 0 and cpu <= 300000 and usage.in(Set("standard", "bundled", "unbound")))
          "deployment-after" else "unavailable") }
  // Both active reads require one selected 100% version; stable compares the
  // deployment ID and selected version ID, not a claim of continuous stability.
  action after(valid, stable) = all { s.phase == "deployment-after",
    s' = s.with("calls", 3).with("stable", valid and stable)
      .with("observation", valid and stable)
      .with("phase", if (valid and stable) "observed" else "unavailable") }
  action denied = all { s.phase.in(Set("deployment-before", "version", "deployment-after")),
    s' = s.with("calls", s.calls + 1).with("phase", "unavailable") }
  action step = {
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    nondet cpu = Set(-1, 0, 1, 300000, 300001).oneOf()
    nondet usage = Set("standard", "bundled", "unbound", "invalid").oneOf()
    any { qualifySelection(a, b), admit(a, b, c), before(a), version(a, b, cpu, usage), after(a, b), denied, s' = s }
  }
  val invariant = all { s.calls >= 0 and s.calls <= 3,
    not(s.raw) and not(s.remoteWrite) and not(s.expanded),
    s.authority implies s.selection,
    s.calls > 0 implies s.selection and s.authority and s.expected,
    s.observation iff s.phase == "observed",
    s.phase == "unavailable" implies not(s.observation),
    s.observation implies (s.calls == 3 and s.deployment and s.coherent and s.source and validRuntime and s.stable) }
  run positiveMetadataTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(true, true, 300000, "standard")).then(after(true, true))
    .expect(s.observation and s.calls == 3 and invariant)
  run wrongSourceRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(true, false, 1, "standard")).expect(not(s.observation) and s.phase == "unavailable")
  run incoherentVersionRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(false, true, 1, "standard")).expect(not(s.observation) and s.calls == 2)
  run deploymentDriftRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(true, true, 1, "standard")).then(after(true, false)).expect(not(s.observation))
  run malformedRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(false))
    .expect(not(s.observation) and s.calls == 1 and s.phase == "unavailable")
  run invalidRuntimeRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(true, true, 300001, "standard")).expect(not(s.observation) and s.phase == "unavailable")
  run deniedRefusedTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true)).then(denied)
    .expect(not(s.observation) and s.phase == "unavailable" and s.calls == 2)
  run privacyProjectionTest = init.then(qualifySelection(true, true)).then(admit(true, true, true)).then(before(true))
    .then(version(true, true, 1, "unbound")).then(after(true, true))
    .expect(s.observation and not(s.raw) and not(s.remoteWrite) and not(s.expanded))
  run missingAuthorityTest = init.then(qualifySelection(true, true)).then(admit(false, true, true))
    .expect(s.calls == 0 and not(s.observation) and s.phase == "unavailable")
  run malformedExpectedSourceTest = init.then(qualifySelection(false, true))
    .expect(s.calls == 0 and not(s.observation) and s.phase == "unavailable")
  run pureReadbackSelectionTest = init.then(qualifySelection(true, true))
    .expect(s.phase == "authority" and not(s.authority) and s.calls == 0 and not(s.observation))
  run mixedSelectionRefusedTest = init.then(qualifySelection(true, false))
    .expect(s.phase == "unavailable" and not(s.authority) and s.calls == 0 and not(s.observation))
}
