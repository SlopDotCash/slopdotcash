// @source workers/payment-executor/release-staging.mjs
// @source scripts/worker-release.mjs
// All inventories precede any deploy. Each staged byte digest and active source
// tag is checked before Pages receives the complete binding set. Two networks.
module staging_attester_release {
  type S = { context: bool, checked: int, published: int, verified: int, reads: int,
    failed: bool, pagesBound: bool, secretWrites: int }
  var s: S
  action init = s' = { context: false, checked: 0, published: 0, verified: 0,
    reads: 0, failed: false, pagesBound: false, secretWrites: 0 }
  action context(matches: bool): bool = all { not(s.context), matches, s' = s.with("context", true) }
  action unreadableInventory = all { s.context, s.checked < 2, s.reads < 3, not(s.failed),
    s' = s.with("reads", s.reads + 1).with("failed", s.reads == 2) }
  action inventory(matches: bool): bool = all { s.context, s.checked < 2, not(s.failed),
    s' = if(matches) s.with("checked", s.checked + 1).with("reads", 0) else s.with("failed", true) }
  action deploy(bytesMatch: bool): bool = all { s.checked == 2, s.published < 2,
    s.published == s.verified, not(s.failed), bytesMatch, s' = s.with("published", s.published + 1) }
  action activeVersion(matches: bool): bool = all { s.published == s.verified + 1, not(s.failed),
    s' = if(matches) s.with("verified", s.verified + 1) else s.with("failed", true) }
  action bindPages = all { s.verified == 2, not(s.failed), s' = s.with("pagesBound", true) }
  action step = any { context(true), inventory(true), inventory(false), unreadableInventory,
    deploy(true), activeVersion(true), activeVersion(false), bindPages, s' = s }
  val invariant = all { s.published > 0 implies s.checked == 2, s.verified <= s.published,
    s.pagesBound implies s.verified == 2 and not(s.failed), s.secretWrites == 0 }
  run partialDeployDoesNotExposeBindingsTest = init.then(context(true)).then(inventory(true)).then(inventory(true))
    .then(deploy(true)).then(activeVersion(true)).then(deploy(true)).then(activeVersion(false)).expect(not(s.pagesBound) and invariant)
  run inventoryMismatchPreventsAllDeploysTest = init.then(context(true)).then(inventory(true)).then(inventory(false)).then(deploy(true).fail())
  run changedConfigRefusedTest = init.then(context(true)).then(inventory(true)).then(inventory(true)).then(deploy(false).fail())
  run pinnedSourcesThenBindingsTest = init.then(context(true)).then(inventory(true)).then(inventory(true))
    .then(deploy(true)).then(activeVersion(true)).then(deploy(true)).then(activeVersion(true)).then(bindPages).expect(invariant)
}
