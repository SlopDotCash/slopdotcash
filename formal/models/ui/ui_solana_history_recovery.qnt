// @source src/SolanaBountyRecovery.tsx
// @source src/SecurityBounty.tsx
// @source backend/security/handler.ts
// @source src/lib/use-payout-wallets.ts
// @source src/lib/wallets.ts
// @source src/lib/base58.ts
// @evidence tests/e2e/solana-history-recovery.spec.ts
// Three action slots (connect or check), two expired messages, one parent actor
// and a second/absent session actor. At most one explicit context replacement
// changes case/generation, revision, payer or message bytes; one observed
// server-only revision change can cause another refresh. Child layout cleanup
// invalidates the action token and resets its connected wallet.
// Server revision and displayed revision are distinct. One server-only case
// change may keep the same generation/messages; parent GET observation and
// reply are separate. A changed observed revision refreshes the view and
// invalidates the old action before a prompt/cache write/POST. A later connect
// and check may reuse exact valid proofs because revision is not in the key.
// POST keeps the captured displayed revision. A subsequent server revision
// change can still refuse it. The guarded external-effect action summarizes
// the backend's commit-time expected-revision fence; post-event revision and
// returned case projection are outside this child-lifetime refinement.
// Cache keys bind case/generation and actor, not revision. Proof body/payer
// fields below are semantic witnesses of exact bytes and strict Ed25519 proof,
// not additional stored schema. Finite signature classes abstract length64,
// canonical base58 and strict cryptographic verification. This does not prove
// decoder/crypto correctness or message expiry; the server establishes expiry
// and independently revalidates submitted proofs.
// A bad individual cache entry is a miss. Malformed whole JSON still fails
// visibly before prompting. Each action reads a local cache snapshot; token
// ownership guards every write. Storage refusal leaves prior proofs intact.
// Parent authorization, session observation and the next caller continuation
// are separate. The caller rechecks ownership after the helper returns.
// Parent and child lifetimes differ: case navigation can remove this child
// while its parent stays active. The owner also crosses the parent's inner
// POST identity await. Only an already-dispatched external effect may complete
// after departure; invoking verify alone is not dispatch. No rollback of an
// already handed-off request is claimed. A pre-connected state is used for bounded
// two-check retry scenarios; connection is exercised separately and the third
// slot permits reconnecting after a stale preflight before reusing cached proof.
// Old unverified-cache, late-effect and stale-finally actions are negative
// controls outside step. No tests, parser/checker, browser, signer or provider
// were run for this edit.
module ui_solana_history_recovery {
  val ids = Set(1, 2, 3)
  val messageIndices = Set(1, 2)
  val cacheKeys = Set(111, 112, 121, 122, 211, 212, 221, 222)
  val signatures = Set("valid", "invalid64", "short", "noncanonical", "wrong-payer", "wrong-message", "malformed")
  type Proof = { exists: bool, body: int, payer: int, message: int, signature: str }
  val absent: Proof = { exists: false, body: 1, payer: 1, message: 1, signature: "malformed" }
  type Op = { phase: str, mode: str, context: int, scope: int, actor: int,
    payer: int, body: int, revision: int, observedRevision: int, index: int, next: str, authorized: bool,
    local: int -> Proof, ready: Set[int], candidate: Proof, prompts: int,
    dispatched: bool, backendAccepted: bool, postActor: int, postCookie: int }
  val idle: Op = { phase: "unused", mode: "check", context: 1, scope: 1, actor: 1,
    payer: 1, body: 1, revision: 1, observedRevision: 0, index: 1, next: "none", authorized: false,
    local: messageIndices.mapBy(_ => absent), ready: Set(), candidate: absent, prompts: 0, dispatched: false, backendAccepted: false,
    postActor: -1, postCookie: 0 }
  var s: { child: bool, parent: bool, context: int, scope: int, revision: int,
    serverRevision: int, serverChanges: int, refreshes: int,
    payer: int, body: int, actor: int, allowed: bool, wallet: bool,
    active: int, busy: int, error: str, cacheJsonValid: bool, seeded: bool,
    cache: int -> Proof, written: Set[int], operations: int -> Op,
    verifyRequests: int, effects: Set[int], badEffect: bool }
  action init = s' = { child: true, parent: true, context: 1, scope: 1, revision: 1,
    serverRevision: 1, serverChanges: 0, refreshes: 0,
    payer: 1, body: 1, actor: 1, allowed: true, wallet: false, active: 0, busy: 0,
    error: "none", cacheJsonValid: true, seeded: false, cache: cacheKeys.mapBy(_ => absent),
    written: Set(), operations: ids.mapBy(_ => idle), verifyRequests: 0, effects: Set(), badEffect: false }
  def key(scope: int, actor: int, index: int): int = scope * 100 + actor * 10 + index
  def operation(id: int): Op = if (ids.contains(id)) s.operations.get(id) else idle
  def current(id: int): bool = s.child and s.active == id and operation(id).context == s.context
  def valid(proof: Proof, op: Op, index: int): bool = proof.exists and proof.body == op.body
    and proof.payer == op.payer and proof.message == index and proof.signature == "valid"
  def stopped(id, error) = s.with("operations", s.operations.set(id, operation(id).with("phase", "done")))
    .with("active", if (current(id)) 0 else s.active).with("busy", if (current(id)) 0 else s.busy)
    .with("error", if (current(id)) error else s.error)
  action connected = all { s.child, s.parent, s.context == 1, s.actor == 1, s.allowed,
    ids.forall(id => operation(id).phase == "unused"), s' = s.with("wallet", true) }
  action seed(kind: str): bool = all {
    not(s.seeded), ids.forall(id => operation(id).phase == "unused"),
    Set("empty", "both-valid", "first-valid", "wrong-body", "wrong-message", "foreign", "invalid64", "noncanonical", "short", "wrong-payer", "malformed", "bad-json").contains(kind),
    s' = s.with("seeded", true).with("cacheJsonValid", kind != "bad-json")
      .with("cache", if (kind == "both-valid") s.cache.set(111, { exists: true, body: 1, payer: 1, message: 1, signature: "valid" })
        .set(112, { exists: true, body: 1, payer: 1, message: 2, signature: "valid" })
        else if (kind == "empty" or kind == "bad-json") s.cache
        else s.cache.set(if (kind == "foreign") 121 else 111,
          { exists: true, body: if (kind == "wrong-body") 2 else 1,
            payer: if (kind == "wrong-payer") 2 else 1, message: if (kind == "wrong-message") 2 else 1,
            signature: if (Set("first-valid", "wrong-body", "wrong-message", "foreign", "wrong-payer").contains(kind)) "valid" else kind })) }
  action start(id: int, mode: str): bool = all {
    ids.contains(id), Set("connect", "check").contains(mode), s.child, s.active == 0, operation(id).phase == "unused",
    s' = s.with("active", id).with("busy", id).with("error", "none")
      .with("operations", s.operations.set(id, idle.with("mode", mode).with("context", s.context)
        .with("scope", s.scope).with("payer", s.payer).with("body", s.body).with("revision", s.revision)
        .with("phase", if (mode == "connect") "connect-authorize" else "identity"))) }
  action identityReply(id: int, available: bool): bool = {
    val op = operation(id)
    all { op.phase == "identity", s' = if (not(current(id))) stopped(id, "none")
      else if (not(available) or s.actor == 0 or not(s.wallet)) stopped(id, "identity")
      else s.with("operations", s.operations.set(id, op.with("actor", s.actor).with("phase", "cache-read"))) }
  }
  action readCache(id: int): bool = {
    val op = operation(id)
    all { op.phase == "cache-read", s' = if (not(current(id))) stopped(id, "none")
      else if (not(s.cacheJsonValid)) stopped(id, "cache-json")
      else s.with("operations", s.operations.set(id, op.with("local", messageIndices.mapBy(i => s.cache.get(key(op.scope, op.actor, i))))
        .with("phase", "loop-authorize"))) }
  }
  action authorize(id: int): bool = {
    val op = operation(id)
    val nextPhase = if (op.phase == "connect-authorize") "connect" else if (op.phase == "loop-authorize") "lookup"
      else if (op.phase == "cache-authorize") "cache-write" else "verify"
    all { Set("connect-authorize", "loop-authorize", "cache-authorize", "final-authorize").contains(op.phase),
      s' = if (not(current(id))) stopped(id, "none")
        else s.with("operations", s.operations.set(id, op.with("phase", "parent-await").with("next", nextPhase)
          .with("authorized", false).with("observedRevision", 0))) }
  }
  action parentObservation(id: int): bool = {
    val op = operation(id)
    all { op.phase == "parent-await", s' = s.with("operations", s.operations.set(id,
      op.with("phase", "parent-reply").with("observedRevision", s.serverRevision))) }
  }
  action parentCompletion(id: int, available: bool): bool = {
    val op = operation(id)
    all { op.phase == "parent-reply", s' = if (not(current(id))) stopped(id, "none")
      else if (not(available) or not(s.parent) or not(s.allowed) or s.actor != 1) stopped(id, "authority")
      else if (op.observedRevision != op.revision) stopped(id, "none")
        .with("revision", op.observedRevision).with("context", s.context + 1).with("refreshes", s.refreshes + 1)
        .with("active", 0).with("busy", 0).with("wallet", false).with("error", "none")
      else s.with("operations", s.operations.set(id, op.with("phase", if (op.mode == "connect") "authority-ready" else "session-await")
        .with("authorized", true))) }
  }
  action parentReply(id: int, available: bool): bool = parentObservation(id).then(parentCompletion(id, available))
  action sessionReply(id: int, available: bool): bool = {
    val op = operation(id)
    all { op.phase == "session-await", s' = if (not(current(id))) stopped(id, "none")
      else if (not(available) or s.actor != op.actor) stopped(id, "account")
      else s.with("operations", s.operations.set(id, op.with("phase", "authority-ready"))) }
  }
  action continueAuthorized(id: int): bool = {
    val op = operation(id)
    all { op.phase == "authority-ready", s' = if (not(current(id))) stopped(id, "none")
      else s.with("operations", s.operations.set(id, op.with("phase", op.next))) }
  }
  action walletReturns(id: int, matches: bool): bool = {
    val op = operation(id)
    all { op.phase == "connect", s' = if (not(current(id))) stopped(id, "none")
      else if (not(matches)) stopped(id, "wallet") else stopped(id, "none").with("wallet", true) }
  }
  action lookup(id: int, messageDecodes: bool): bool = {
    val op = operation(id)
    val proof = op.local.get(op.index)
    all { op.phase == "lookup", s' = if (not(current(id))) stopped(id, "none")
      else if (not(messageDecodes)) stopped(id, "message")
      else s.with("operations", s.operations.set(id, if (valid(proof, op, op.index))
        op.with("ready", op.ready.union(Set(op.index))).with("phase", "advance")
        else op.with("phase", "signing").with("prompts", op.prompts + 1))) }
  }
  action signatureReturns(id: int, kind: str): bool = {
    val op = operation(id)
    all { op.phase == "signing", signatures.contains(kind), s' = if (not(current(id))) stopped(id, "none")
      else if (kind != "valid") stopped(id, "signature")
      else s.with("operations", s.operations.set(id, op.with("candidate",
        { exists: true, body: op.body, payer: op.payer, message: op.index, signature: kind }).with("phase", "cache-authorize"))) }
  }
  action cacheWrite(id: int, succeeds: bool): bool = {
    val op = operation(id)
    val cacheKey = key(op.scope, op.actor, op.index)
    all { op.phase == "cache-write", valid(op.candidate, op, op.index),
      s' = if (not(current(id))) stopped(id, "none") else if (not(succeeds)) stopped(id, "cache-write")
        else s.with("cache", s.cache.set(cacheKey, op.candidate)).with("written", s.written.union(Set(cacheKey)))
          .with("operations", s.operations.set(id, op.with("local", op.local.set(op.index, op.candidate))
            .with("ready", op.ready.union(Set(op.index))).with("phase", "advance"))) }
  }
  action advance(id: int): bool = {
    val op = operation(id)
    all { op.phase == "advance", s' = if (not(current(id))) stopped(id, "none")
      else s.with("operations", s.operations.set(id, if (op.index == 1) op.with("index", 2).with("phase", "loop-authorize")
        else op.with("phase", "final-authorize"))) }
  }
  action beginVerification(id: int): bool = {
    val op = operation(id)
    all { op.phase == "verify", op.ready == messageIndices,
      s' = if (not(current(id))) stopped(id, "none")
        else s.with("operations", s.operations.set(id, op.with("phase", "post-identity"))) }
  }
  action postIdentityObserved(id: int, available: bool): bool = all { operation(id).phase == "post-identity",
    s' = s.with("operations", s.operations.set(id, operation(id).with("phase", "post-observed")
      .with("postActor", if (available) s.actor else -1))) }
  action postIdentityReturned(id: int): bool = all { operation(id).phase == "post-observed",
    s' = s.with("operations", s.operations.set(id, operation(id).with("phase", "post-returned"))) }
  action dispatchCurrent(id: int): bool = all { operation(id).phase == "post-returned",
    s' = if (not(current(id))) stopped(id, "none")
      else if (not(s.parent) or operation(id).postActor != operation(id).actor) stopped(id, "identity")
      else s.with("verifyRequests", s.verifyRequests + 1).with("operations", s.operations.set(id,
        operation(id).with("phase", "verify-await").with("dispatched", true).with("postCookie", s.actor))) }
  // Earlier scenarios use this convenience; step explores each inner await.
  action dispatch(id: int): bool = if (current(id)) beginVerification(id)
    .then(postIdentityObserved(id, true)).then(postIdentityReturned(id)).then(dispatchCurrent(id))
    else all { operation(id).phase == "verify", s' = stopped(id, "none") }
  action externalEffect(id: int): bool = all { operation(id).dispatched, not(s.effects.contains(id)),
    operation(id).revision == s.serverRevision,
    operation(id).postCookie == operation(id).actor, operation(id).postCookie > 0,
    s' = s.with("effects", s.effects.union(Set(id)))
      .with("operations", s.operations.set(id, operation(id).with("backendAccepted", true))) }
  action backendRefusesStale(id: int): bool = all { operation(id).phase == "verify-await",
    not(operation(id).backendAccepted), operation(id).revision != s.serverRevision,
    s' = stopped(id, "stale-revision") }
  action backendRefusesActor(id: int): bool = all { operation(id).phase == "verify-await",
    operation(id).postCookie != operation(id).actor, s' = stopped(id, "identity") }
  action verifyReturns(id: int, succeeds: bool): bool = all { operation(id).phase == "verify-await",
    not(succeeds) or operation(id).backendAccepted or operation(id).revision == s.serverRevision,
    not(succeeds) or operation(id).postCookie == operation(id).actor,
    s' = stopped(id, if (succeeds) "none" else "verification") }
  action serverRevisionAdvances = all { s.serverChanges < 1,
    s' = s.with("serverRevision", s.serverRevision + 1).with("serverChanges", s.serverChanges + 1) }
  action contextChanges(kind: str): bool = all {
    s.context == 1, Set("case", "generation", "revision", "payer", "messages").contains(kind),
    s' = s.with("context", 2).with("active", 0).with("busy", 0).with("wallet", false).with("error", "none")
      .with("scope", if (Set("case", "generation").contains(kind)) 2 else s.scope)
      .with("revision", if (kind == "revision") 2 else s.revision)
      .with("serverRevision", if (kind == "revision" and s.serverRevision < 2) 2 else s.serverRevision)
      .with("payer", if (kind == "payer") 2 else s.payer)
      .with("body", if (kind == "messages") 2 else s.body) }
  action accountChanges = s' = s.with("actor", 2)
  action signOut = s' = s.with("actor", 0)
  action accessLost = s' = s.with("allowed", false)
  action unmount = all { s.child, s' = s.with("child", false).with("active", 0).with("busy", 0).with("wallet", false) }
  action parentUnmount = s' = s.with("parent", false)
  // Old paths retain an invalid signature, write after child cleanup, invoke
  // verify through a still-mounted parent, or reset a newer action's busy flag.
  action oldUnverifiedCache(id: int): bool = {
    val op = operation(id)
    val cacheKey = key(op.scope, op.actor, op.index)
    all { op.phase == "signing",
      s' = s.with("cache", s.cache.set(cacheKey, { exists: true, body: op.body, payer: op.payer, message: op.index, signature: "invalid64" }))
        .with("written", s.written.union(Set(cacheKey))) }
  }
  action oldLateEffect(id: int): bool = all { not(current(id)), operation(id).phase != "unused", s' = s.with("badEffect", true) }
  action oldFinally(id: int): bool = all { not(current(id)), s.active > 0, s' = s.with("busy", 0) }
  action oldParentCompletionWithoutRevision(id: int): bool = {
    val op = operation(id)
    all { op.phase == "parent-reply", current(id), s.parent, s.allowed, s.actor == 1,
      s' = s.with("operations", s.operations.set(id, op.with("phase", if (op.mode == "connect") "authority-ready" else "session-await")
        .with("authorized", true))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet mode = Set("connect", "check").oneOf()
    nondet kind = signatures.oneOf()
    nondet seedKind = Set("empty", "both-valid", "first-valid", "wrong-body", "wrong-message", "foreign", "invalid64", "noncanonical", "short", "wrong-payer", "malformed", "bad-json").oneOf()
    nondet contextKind = Set("case", "generation", "revision", "payer", "messages").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { connected, seed(seedKind), start(id, mode), identityReply(id, yes), readCache(id), authorize(id), parentObservation(id), parentCompletion(id, yes),
      sessionReply(id, yes), continueAuthorized(id), walletReturns(id, yes), lookup(id, yes), signatureReturns(id, kind), cacheWrite(id, yes),
      advance(id), beginVerification(id), postIdentityObserved(id, yes), postIdentityReturned(id), dispatchCurrent(id),
      externalEffect(id), backendRefusesStale(id), backendRefusesActor(id), verifyReturns(id, yes), serverRevisionAdvances, contextChanges(contextKind), accountChanges,
      signOut, accessLost, unmount, parentUnmount, s' = s }
  }
  val invariant = all { s.busy == s.active, not(s.badEffect), s.verifyRequests <= 3,
    s.revision <= s.serverRevision, s.serverRevision <= 3, s.serverChanges <= 1, s.refreshes <= 1,
    s.active > 0 implies current(s.active), s.written.forall(k => s.cache.get(k).signature == "valid"),
    s.effects.forall(id => operation(id).dispatched),
    ids.forall(id => {
      val op = operation(id)
      all { op.index >= 1 and op.index <= 2, op.prompts <= 2,
        op.ready.subseteq(messageIndices), op.authorized implies op.observedRevision == op.revision,
        op.dispatched implies op.authorized and op.ready == messageIndices,
        op.ready.forall(i => valid(op.local.get(i), op, i)) }
    }) }
  action authority(id: int): bool = authorize(id).then(parentReply(id, true))
    .then(sessionReply(id, true)).then(continueAuthorized(id))
  action begin(id: int): bool = start(id, "check").then(identityReply(id, true)).then(readCache(id))
  action existing(id: int): bool = authority(id).then(lookup(id, true)).then(advance(id))
  action fresh(id: int): bool = authority(id).then(lookup(id, true)).then(signatureReturns(id, "valid"))
    .then(authority(id)).then(cacheWrite(id, true)).then(advance(id))
  action ready(id: int): bool = existing(id).then(existing(id)).then(authority(id)).then(dispatch(id))

  run wrongPayerCannotConnectTest = init.then(start(1, "connect")).then(authorize(1)).then(parentReply(1, true))
    .then(continueAuthorized(1)).then(walletReturns(1, false)).expect(not(s.wallet) and s.error == "wallet" and invariant)
  run validOriginalPayerConnectsTest = init.then(start(1, "connect")).then(authorize(1)).then(parentReply(1, true))
    .then(continueAuthorized(1)).then(walletReturns(1, true)).expect(s.wallet and s.active == 0 and invariant)
  run matchingCacheNeedsNoWalletPromptTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(ready(1))
    .expect(operation(1).prompts == 0 and s.verifyRequests == 1 and invariant)
  run foreignCacheCannotAvoidSigningTest = init.then(connected).then(seed("foreign")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and operation(1).prompts == 1 and invariant)
  run alteredMessageCacheCannotAvoidSigningTest = init.then(connected).then(seed("wrong-body")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and invariant)
  run invalidCachedSignatureIsReplacedTest = init.then(connected).then(seed("invalid64")).then(begin(1)).then(fresh(1))
    .expect(s.cache.get(111).signature == "valid" and operation(1).prompts == 1 and invariant)
  run noncanonicalCacheCannotAvoidSigningTest = init.then(connected).then(seed("noncanonical")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and invariant)
  run wrongPayerCacheCannotAvoidSigningTest = init.then(connected).then(seed("wrong-payer")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and invariant)
  run cachedSignatureForOtherMessageCannotAvoidSigningTest = init.then(connected).then(seed("wrong-message")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and invariant)
  run malformedEntryIsAMissRatherThanAPermanentFailureTest = init.then(connected).then(seed("malformed")).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .expect(operation(1).phase == "signing" and s.error == "none" and invariant)
  run malformedCacheStopsBeforePromptTest = init.then(connected).then(seed("bad-json")).then(begin(1))
    .expect(s.error == "cache-json" and operation(1).prompts == 0 and invariant)
  run invalidFreshSignatureIsNeverCachedTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true)).then(signatureReturns(1, "invalid64"))
    .expect(s.error == "signature" and s.written == Set() and s.verifyRequests == 0 and invariant)
  run signThenCacheFailureIsVisibleTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(signatureReturns(1, "valid")).then(authority(1)).then(cacheWrite(1, false))
    .expect(s.error == "cache-write" and s.written == Set() and s.verifyRequests == 0 and invariant)
  run partialCacheSurvivesSecondPromptRefusalTest = init.then(connected).then(begin(1)).then(fresh(1))
    .then(authority(1)).then(lookup(1, true)).then(signatureReturns(1, "invalid64"))
    .expect(s.written == Set(111) and s.error == "signature" and s.verifyRequests == 0 and invariant)
  run actorChangeAfterCaptureRefusesPromptTest = init.then(connected).then(begin(1)).then(accountChanges).then(authorize(1)).then(parentReply(1, true))
    .expect(s.error == "authority" and operation(1).prompts == 0 and invariant)
  run accountChangeDuringPromptCannotCacheProofTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(accountChanges).then(signatureReturns(1, "valid")).then(authorize(1)).then(parentReply(1, true))
    .expect(s.written == Set() and s.verifyRequests == 0 and invariant)
  run unmountDuringPromptCannotCacheOrVerifyTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(unmount).then(signatureReturns(1, "valid")).expect(s.parent and s.written == Set() and s.verifyRequests == 0 and invariant)
  run revisionChangeBeforeFinalAuthorizeRefusesOldRequestTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(existing(1)).then(existing(1))
    .then(contextChanges("revision")).then(authorize(1)).expect(s.verifyRequests == 0 and not(s.wallet) and invariant)
  run generationChangeInvalidatesCapturedConnectionTest = init.then(start(1, "connect")).then(authorize(1)).then(parentReply(1, true))
    .then(continueAuthorized(1)).then(contextChanges("generation")).then(walletReturns(1, true))
    .expect(not(s.wallet) and s.scope == 2 and invariant)
  run messagesChangeStopsOldCacheWriteTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(signatureReturns(1, "valid")).then(authority(1)).then(contextChanges("messages")).then(cacheWrite(1, true))
    .expect(s.written == Set() and s.body == 2 and invariant)
  run payerChangeResetsConnectedWalletTest = init.then(connected).then(contextChanges("payer")).expect(not(s.wallet) and s.payer == 2 and invariant)
  run newRevisionReconnectReusesExactProofTest = init.then(connected).then(seed("both-valid")).then(contextChanges("revision"))
    .then(start(1, "connect")).then(authorize(1)).then(parentReply(1, true)).then(continueAuthorized(1)).then(walletReturns(1, true))
    .then(begin(2)).then(ready(2)).expect(operation(2).prompts == 0 and s.verifyRequests == 1 and invariant)
  run newCaseCannotReuseOldCaseCacheTest = init.then(connected).then(seed("both-valid")).then(contextChanges("case"))
    .then(start(1, "connect")).then(authorize(1)).then(parentReply(1, true)).then(continueAuthorized(1)).then(walletReturns(1, true))
    .then(begin(2)).then(authority(2)).then(lookup(2, true))
    .expect(operation(2).phase == "signing" and operation(2).prompts == 1 and invariant)
  run verificationFailureKeepsCacheForRetryTest = init.then(connected).then(begin(1)).then(fresh(1)).then(fresh(1)).then(authority(1)).then(dispatch(1))
    .then(verifyReturns(1, false)).then(begin(2)).then(ready(2))
    .expect(s.written == Set(111, 112) and operation(2).prompts == 0 and s.verifyRequests == 2 and invariant)
  run parentAliveDoesNotAuthorizeDepartedChildTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(existing(1)).then(existing(1))
    .then(authority(1)).then(unmount).then(dispatch(1)).expect(s.parent and s.verifyRequests == 0 and invariant)
  run resetBetweenAuthorityReturnAndContinuationStopsEffectTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(authorize(1))
    .then(parentReply(1, true)).then(sessionReply(1, true)).then(contextChanges("case")).then(continueAuthorized(1))
    .expect(operation(1).phase == "done" and s.verifyRequests == 0 and invariant)
  run oldFinallyCannotClearNewConnectionBusyTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(ready(1))
    .then(contextChanges("revision")).then(start(2, "connect")).then(verifyReturns(1, false))
    .expect(s.active == 2 and s.busy == 2 and s.error == "none" and invariant)
  run synchronousOwnershipRefusesSecondActionTest = init.then(connected).then(begin(1)).expect(s.active == 1 and s.busy == 1 and invariant)
    .then(start(2, "check").fail())
  run signOutStopsCachedProofBeforeSubmissionTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(signOut)
    .then(authorize(1)).then(parentReply(1, true)).expect(s.verifyRequests == 0 and operation(1).prompts == 0 and invariant)
  run acceptedVerificationMayFinishAfterDepartureTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(ready(1))
    .then(unmount).then(externalEffect(1)).then(verifyReturns(1, true))
    .expect(s.effects == Set(1) and s.verifyRequests == 1 and s.busy == 0 and invariant)
  run invalidCacheOldBehaviorNegativeControlTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true)).then(oldUnverifiedCache(1))
    .expect(s.cache.get(111).signature == "invalid64" and not(invariant))
  run lateCacheOrPostOldBehaviorNegativeControlTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(unmount).then(oldLateEffect(1)).expect(s.parent and not(invariant))
  run oldFinallyResetNegativeControlTest = init.then(connected).then(seed("both-valid")).then(begin(1)).then(ready(1))
    .then(contextChanges("revision")).then(start(2, "connect")).then(oldFinally(1)).expect(not(invariant))
  run serverRevisionChangeBeforeConnectRefreshesWithoutPromptTest = init.then(start(1, "connect")).then(serverRevisionAdvances)
    .then(authorize(1)).then(parentReply(1, true))
    .expect(s.revision == 2 and s.refreshes == 1 and not(s.wallet) and operation(1).phase == "done" and invariant)
  run sameIntentNewServerRevisionInvalidatesOldCheckTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(authorize(1)).then(serverRevisionAdvances).then(parentReply(1, true))
    .expect(s.scope == 1 and s.body == 1 and s.revision == 2 and operation(1).prompts == 0 and s.verifyRequests == 0 and invariant)
  run revisionChangeDuringPromptStopsCacheWriteTest = init.then(connected).then(begin(1)).then(authority(1)).then(lookup(1, true))
    .then(serverRevisionAdvances).then(signatureReturns(1, "valid")).then(authorize(1)).then(parentReply(1, true))
    .expect(s.revision == 2 and s.written == Set() and s.verifyRequests == 0 and not(s.wallet) and invariant)
  run refreshedRevisionReconnectReusesValidatedCacheTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(serverRevisionAdvances).then(authorize(1)).then(parentReply(1, true))
    .then(start(2, "connect")).then(authorize(2)).then(parentReply(2, true)).then(continueAuthorized(2)).then(walletReturns(2, true))
    .then(begin(3)).then(ready(3))
    .expect(operation(3).revision == 2 and operation(3).prompts == 0 and s.verifyRequests == 1 and invariant)
  run revisionReadIsSnapshotAndNextPreflightStillRefusesTest = init.then(connected).then(begin(1)).then(authorize(1))
    .then(parentObservation(1)).then(serverRevisionAdvances).then(parentCompletion(1, true))
    .then(sessionReply(1, true)).then(continueAuthorized(1)).then(lookup(1, true)).then(signatureReturns(1, "valid"))
    .then(authorize(1)).then(parentReply(1, true))
    .expect(operation(1).prompts == 1 and s.revision == 2 and s.written == Set() and s.verifyRequests == 0 and invariant)
  run serverRevisionAfterFinalPreflightRefusesStalePostTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(existing(1)).then(existing(1)).then(authority(1)).then(serverRevisionAdvances).then(dispatch(1)).then(backendRefusesStale(1))
    .expect(s.error == "stale-revision" and s.verifyRequests == 1 and s.effects == Set() and invariant)
  run oldParentRevisionOmissionCouldPromptStaleViewNegativeControlTest = init.then(connected).then(begin(1)).then(authorize(1))
    .then(serverRevisionAdvances).then(parentObservation(1)).then(oldParentCompletionWithoutRevision(1))
    .then(sessionReply(1, true)).then(continueAuthorized(1)).then(lookup(1, true))
    .expect(s.revision == 1 and s.serverRevision == 2 and operation(1).prompts == 1 and not(invariant))
  action readyToVerify(id: int): bool = existing(id).then(existing(id)).then(authority(id)).then(beginVerification(id))
  run childDepartureDuringInnerPostIdentityTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, true)).then(unmount)
    .then(postIdentityReturned(1)).then(dispatchCurrent(1)).expect(s.verifyRequests == 0 and invariant)
  run parentDepartureAfterInnerIdentityReturnTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, true)).then(postIdentityReturned(1))
    .then(parentUnmount).then(dispatchCurrent(1)).expect(s.verifyRequests == 0 and invariant)
  run replacementAfterInnerIdentityCannotPostTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, true)).then(postIdentityReturned(1))
    .then(contextChanges("revision")).then(dispatchCurrent(1)).expect(s.verifyRequests == 0 and invariant)
  run unknownInnerPostIdentityRefusesTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, false)).then(postIdentityReturned(1))
    .then(dispatchCurrent(1)).expect(s.verifyRequests == 0 and s.error == "identity" and invariant)
  run actorAfterInnerObservationNeedsServerFenceTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, true)).then(accountChanges)
    .then(postIdentityReturned(1)).then(dispatchCurrent(1)).then(backendRefusesActor(1))
    .expect(s.verifyRequests == 1 and s.effects == Set() and s.error == "identity" and invariant)
  action oldUnownedInnerDispatch(id: int): bool = all { operation(id).phase == "post-returned",
    s' = s.with("verifyRequests", s.verifyRequests + 1).with("badEffect", not(current(id))) }
  run oldInnerParentAwaitCouldDispatchAfterChildTest = init.then(connected).then(seed("both-valid")).then(begin(1))
    .then(readyToVerify(1)).then(postIdentityObserved(1, true)).then(postIdentityReturned(1))
    .then(unmount).then(oldUnownedInnerDispatch(1)).expect(s.verifyRequests == 1 and not(invariant))
}
