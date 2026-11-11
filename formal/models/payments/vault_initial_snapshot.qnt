// @source backend/projects/vault-setup.ts
// @source backend/projects/handler.ts
// @source backend/payments/vault-snapshots.ts
// @source backend/security/payment-database.ts
// @source workers/payments/index.ts
// @source scripts/recover-vault-observations.ts
// @evidence scripts/vault-setup-network-failure.test.ts
// @evidence scripts/solana-vault-setup-network-failure.test.ts
// @evidence backend/payments/vault-snapshots.test.ts
// @evidence scripts/recover-vault-observations.test.ts
// Two requests, ordinary/private policy stores, two finalized block/time values
// and one representative cumulative counter in 0..1. These are finite bounds,
// not product limits. Each cumulative counter uses the same independent guard.
// Current balances may decrease and are outside the monotonic-counter claim.
// Factory/finality/asset/vault/decimal validation is an external predicate; this
// model does not prove RPC truth, SQL execution, authorization or chain finality.
// Successful append is atomic and immutable. Snapshot prior reads and guarded
// writes are separate; an unavailable or lost reply never rolls append back.
// Scope 1 is ordinary; scope 2 is the private security-payment database adapter.
// trustedMain abstracts the script's exact workflow/event/ref/checkout checks;
// environment parsing and the fixed Solana-mainnet RPC selection need native
// entry-point tests. Refused recovery has no transition; step includes stutter.
module vault_initial_snapshot {
  type Snapshot = { exists: bool, scope: int, block: int, counter: int, time: int }
  type Request = { phase: str, scope: int, expected: int, existing: bool,
    registration: int, block: int, counter: int, time: int,
    prior: Snapshot, status: int, result: str }
  var s: { revision: int, registered: int -> int, snapshots: int -> Snapshot,
    requests: int -> Request, regressed: bool }
  val ids = Set(1, 2)
  val scopes = Set(1, 2)
  val absent = { exists: false, scope: 0, block: 0, counter: 0, time: 0 }
  val idle = { phase: "unused", scope: 0, expected: 0, existing: false,
    registration: 0, block: 0, counter: 0, time: 0, prior: absent, status: 0, result: "none" }
  pure def finish(r: Request, status: int, result: str): Request =
    r.with("phase", "done").with("status", status).with("result", result)
  pure def older(block: int, time: int, row: Snapshot): bool = row.exists and
    (block < row.block or (block == row.block and time < row.time))
  action init = s' = { revision: 1, registered: scopes.mapBy(_ => 0),
    snapshots: scopes.mapBy(_ => absent), requests: ids.mapBy(_ => idle), regressed: false }
  action begin(id: int, scope: int): bool = all {
    ids.contains(id), scopes.contains(scope), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "register")
      .with("scope", scope).with("expected", s.revision)
      .with("existing", s.registered.get(scope) > 0))) }
  // The reviewed repair selects only registered rows missing a first snapshot.
  // Recovery is ordinary Solana-mainnet only; chain selection is external here.
  // It observes; it never appends a project revision or replaces a retained row
  // merely because that row is stale. A later writer can still win this race.
  action beginRecovery(id: int, scope: int, trustedMain: bool): bool = all {
    ids.contains(id), scope == 1, trustedMain, s.requests.get(id).phase == "unused",
    s.registered.get(scope) > 0, not(s.snapshots.get(scope).exists),
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "totals")
      .with("scope", scope).with("expected", s.revision).with("existing", true)
      .with("registration", s.registered.get(scope)))) }
  // Existing transaction recognition precedes expected-revision validation.
  // A newly admitted deployment instead appends under the captured revision.
  action register(id: int, admitted: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "register",
      s' = if (r.existing) s.with("requests", s.requests.set(id,
          r.with("phase", "totals").with("registration", s.registered.get(r.scope))))
        else if (not(admitted) or r.expected != s.revision or s.revision >= 3)
          s.with("requests", s.requests.set(id, finish(r, 409, "refused")))
        else s.with("revision", s.revision + 1)
          .with("registered", s.registered.set(r.scope, s.revision + 1))
          .with("requests", s.requests.set(id,
            r.with("phase", "totals").with("registration", s.revision + 1))) }
  }
  action totals(id: int, outcome: str, block: int, counter: int, time: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "totals", Set("valid", "unavailable", "identity-refused").contains(outcome),
      Set(1, 2).contains(block), Set(0, 1).contains(counter), Set(1, 2).contains(time),
      s' = s.with("requests", s.requests.set(id,
        if (outcome != "valid") finish(r, 503, "unavailable")
        else r.with("phase", "prior").with("block", block)
          .with("counter", counter).with("time", time))) }
  }
  action priorRead(id: int): bool = {
    val r = s.requests.get(id)
    val prior = s.snapshots.get(r.scope)
    all { r.phase == "prior",
      s' = s.with("requests", s.requests.set(id,
        if (prior.exists and r.block < prior.block) finish(r, 200, "older")
        else if (prior.exists and r.counter < prior.counter) finish(r, 503, "unavailable")
        else r.with("phase", "write").with("prior", prior))) }
  }
  action observationFails(id: int): bool = {
    val r = s.requests.get(id)
    all { Set("totals", "prior", "write").contains(r.phase),
      s' = s.with("requests", s.requests.set(id, finish(r, 503, "unavailable"))) }
  }
  action write(id: int, reply: str): bool = {
    val r = s.requests.get(id)
    val latest = s.snapshots.get(r.scope)
    val writable = not(latest.exists) or (not(older(r.block, r.time, latest)) and r.counter >= latest.counter)
    val incoming = { exists: true, scope: r.scope, block: r.block, counter: r.counter, time: r.time }
    all { r.phase == "write", Set("ok", "failed", "lost").contains(reply),
      s' = if (reply == "failed") s.with("requests", s.requests.set(id, finish(r, 503, "unavailable")))
        else if (writable) s.with("snapshots", s.snapshots.set(r.scope, incoming))
          .with("regressed", s.regressed or (latest.exists and
            (r.block < latest.block or r.counter < latest.counter or
              (r.block == latest.block and r.time < latest.time))))
          .with("requests", s.requests.set(id, finish(r, if (reply == "lost") 503 else 200,
            if (reply == "lost") "unavailable" else "stored")))
        else s.with("requests", s.requests.set(id,
          if (older(r.block, r.time, latest) and reply == "ok") finish(r, 200, "older")
          else finish(r, 503, "unavailable"))) }
  }
  action step = any {
    { nondet id = ids.oneOf() nondet scope = scopes.oneOf() begin(id, scope) },
    { nondet id = ids.oneOf() nondet scope = scopes.oneOf() beginRecovery(id, scope, true) },
    { nondet id = ids.oneOf() nondet admitted = Set(false, true).oneOf() register(id, admitted) },
    { nondet id = ids.oneOf() nondet outcome = Set("valid", "unavailable", "identity-refused").oneOf()
      nondet block = Set(1, 2).oneOf() nondet counter = Set(0, 1).oneOf() nondet time = Set(1, 2).oneOf()
      totals(id, outcome, block, counter, time) },
    { nondet id = ids.oneOf() priorRead(id) },
    { nondet id = ids.oneOf() observationFails(id) },
    { nondet id = ids.oneOf() nondet reply = Set("ok", "failed", "lost").oneOf() write(id, reply) },
    s' = s
  }
  val invariant = all {
    s.revision == 1 + scopes.filter(scope => s.registered.get(scope) > 0).size(),
    not(s.regressed),
    scopes.forall(scope => s.snapshots.get(scope).exists implies
      s.registered.get(scope) > 0 and s.snapshots.get(scope).scope == scope),
    ids.forall(id => { val r = s.requests.get(id)
      r.registration > 0 implies r.registration == s.registered.get(r.scope) }),
    ids.forall(id => { val r = s.requests.get(id)
      r.status == 200 implies r.registration > 0 and s.snapshots.get(r.scope).exists })
  }
  action ready(id: int, scope: int): bool = begin(id, scope).then(register(id, true))
  action observed(id: int, block: int, counter: int, time: int): bool =
    totals(id, "valid", block, counter, time).then(priorRead(id))
  run registrationSeedsSnapshotTest = init.then(ready(1, 1)).then(observed(1, 1, 0, 1))
    .then(write(1, "ok")).expect(s.revision == 2 and s.requests.get(1).status == 200
      and s.snapshots.get(1).exists and not(s.snapshots.get(2).exists))
  run unavailableReadRetainsRegistrationTest = init.then(ready(1, 1))
    .then(totals(1, "unavailable", 1, 0, 1)).expect(s.revision == 2 and s.registered.get(1) == 2
      and not(s.snapshots.get(1).exists) and s.requests.get(1).status == 503)
  run identityRefusalNeverSeedsTest = init.then(ready(1, 2))
    .then(totals(1, "identity-refused", 1, 0, 1)).expect(not(s.snapshots.get(2).exists))
  run retrySeedsWithoutAnotherRevisionTest = init.then(ready(1, 1))
    .then(totals(1, "unavailable", 1, 0, 1)).then(ready(2, 1))
    .then(observed(2, 1, 0, 1)).then(write(2, "ok"))
    .expect(s.revision == 2 and s.requests.get(2).registration == 2 and s.snapshots.get(1).exists)
  run failedWriteRetainsRegistrationTest = init.then(ready(1, 1)).then(observed(1, 1, 0, 1))
    .then(write(1, "failed")).expect(s.revision == 2 and not(s.snapshots.get(1).exists))
  run lostWriteReplyDoesNotProveMissingSnapshotTest = init.then(ready(1, 1)).then(observed(1, 1, 0, 1))
    .then(write(1, "lost")).expect(s.snapshots.get(1).exists and s.requests.get(1).status == 503)
  run racingOlderBlockCannotReplaceNewerTest = init.then(ready(1, 1)).then(ready(2, 1))
    .then(observed(1, 1, 0, 2)).then(observed(2, 2, 1, 1)).then(write(2, "ok")).then(write(1, "ok"))
    .expect(s.snapshots.get(1).block == 2 and s.snapshots.get(1).counter == 1
      and s.requests.get(1).result == "older")
  run racingSameBlockOlderTimeCannotReplaceTest = init.then(ready(1, 1)).then(ready(2, 1))
    .then(observed(1, 1, 0, 1)).then(observed(2, 1, 1, 2)).then(write(2, "ok")).then(write(1, "ok"))
    .expect(s.snapshots.get(1).time == 2 and s.snapshots.get(1).counter == 1)
  run racingLowerCounterRefusesTest = init.then(ready(1, 1)).then(ready(2, 1))
    .then(observed(1, 2, 0, 2)).then(observed(2, 1, 1, 1)).then(write(2, "ok")).then(write(1, "ok"))
    .expect(s.snapshots.get(1).counter == 1 and s.requests.get(1).status == 503)
  run privateAndOrdinaryStoresRemainSeparateTest = init.then(ready(1, 1)).then(ready(2, 2))
    .then(observed(1, 1, 0, 1)).then(observed(2, 2, 1, 2)).then(write(2, "ok")).then(write(1, "ok"))
    .expect(s.revision == 3 and s.snapshots.get(1).block == 1 and s.snapshots.get(2).block == 2)
  run registrationRefusalCreatesNoSnapshotTest = init.then(begin(1, 1)).then(register(1, false))
    .expect(s.revision == 1 and s.registered.get(1) == 0 and not(s.snapshots.get(1).exists))
  run priorReadFailureKeepsImmutableRegistrationTest = init.then(ready(1, 1))
    .then(totals(1, "valid", 1, 0, 1)).then(observationFails(1))
    .expect(s.revision == 2 and not(s.snapshots.get(1).exists))
  run missingSnapshotRecoveryNeverAppendsRevisionTest = init.then(ready(1, 1))
    .then(totals(1, "unavailable", 1, 0, 1)).then(beginRecovery(2, 1, true))
    .then(observed(2, 1, 0, 1)).then(write(2, "ok"))
    .expect(s.revision == 2 and s.snapshots.get(1).exists)
  run recoveryCannotSelectRetainedSnapshotTest = init.then(ready(1, 1))
    .then(observed(1, 1, 0, 1)).then(write(1, "ok"))
    .expect(s.snapshots.get(1).block == 1).then(beginRecovery(2, 1, true).fail())
  run recoveryRefusesUnregisteredDeploymentTest = init
    .expect(s.revision == 1 and not(s.snapshots.get(1).exists)).then(beginRecovery(1, 1, true).fail())
  run recoveryDoesNotSelectPrivateBountyTest = init.then(ready(1, 2))
    .then(totals(1, "unavailable", 1, 0, 1)).expect(not(s.snapshots.get(2).exists))
    .then(beginRecovery(2, 2, true).fail())
  run untrustedRecoveryCannotWriteTest = init.then(ready(1, 1))
    .then(totals(1, "unavailable", 1, 0, 1)).then(beginRecovery(2, 1, false).fail())
  run racingRegistrationDoesNotAppendTwiceTest = init.then(begin(1, 1)).then(begin(2, 1))
    .then(register(1, true)).then(register(2, true))
    .expect(s.revision == 2 and s.requests.get(2).status == 409)
}
