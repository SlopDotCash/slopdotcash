// @source workers/payment-executor/release-plan.mjs
// @source workers/payment-executor/release-mainnets.mjs
// @source workers/payment-executor/mainnet-execution.mjs
// @source workers/payment-executor/configure.mjs
// @source workers/payment-executor/signer-stacks.mjs
// @source scripts/prepare-payment-deployments.ts
// @source scripts/release-referral.ts
// @source scripts/worker-release.mjs
// Pure preparation is distinct from operator-authorized service publication.
// A disabled network with retained obligations receives stop code; a disabled
// network with no existing service is not provisioned solely by configuration.
module deployment_plan {
  var s: { phase: str, executionEnabled: bool, pins: bool, existing: bool,
    secrets: bool, privateSurface: bool, authorized: bool,
    published: bool, executionOn: bool, readback: bool }
  action init = s' = { phase: "new", executionEnabled: false, pins: false, existing: false,
    secrets: false, privateSurface: true, authorized: false,
    published: false, executionOn: false, readback: false }
  action plan(executionEnabled, pins, existing) = all { s.phase == "new",
    s' = s.with("phase", "planned").with("executionEnabled", executionEnabled).with("pins", pins).with("existing", existing) }
  action checkSecrets = all { s.phase == "planned", s' = s.with("secrets", true) }
  action authorize = all { s.phase == "planned", s.privateSurface,
    (s.executionEnabled and s.pins) implies s.secrets, s' = s.with("authorized", true) }
  action publish = all { s.phase == "planned", s.authorized,
    (s.executionEnabled and s.pins) or (not(s.executionEnabled) and s.existing),
    s' = s.with("phase", "published").with("published", true)
      .with("executionOn", s.executionEnabled and s.pins),
  }
  action verify = all { s.phase == "published", s' = s.with("phase", "verified").with("readback", true) }
  action refuse = all { s.phase == "planned", s' = s.with("phase", "refused") }
  action step = {
    nondet executionEnabled = Set(false, true).oneOf()
    nondet pins = Set(false, true).oneOf()
    nondet existing = Set(false, true).oneOf()
    any { plan(executionEnabled, pins, existing), checkSecrets, authorize, publish, verify, refuse }
  }
  val invariant = all {
    s.executionOn implies (s.executionEnabled and s.pins and s.secrets and s.authorized),
    s.published implies (s.privateSurface and s.authorized),
    s.readback implies s.published,
    (not(s.executionEnabled) and not(s.existing)) implies not(s.published),
  }
  run reviewedEnabledNetworkTest = init.then(plan(true, true, false)).then(checkSecrets)
    .then(authorize).then(publish).then(verify).expect(s.executionOn and s.readback)
  run stopExistingDisabledServiceTest = init.then(plan(false, true, true)).then(authorize)
    .then(publish).then(verify).expect(not(s.executionOn) and s.readback)
  run disabledAbsentServiceTest = init.then(plan(false, false, false)).then(authorize)
    .then(refuse).expect(not(s.published))
}
