// @source backend/payments/handler.ts
// @source backend/payments/possession.ts
// @source contracts/evm/adapter.ts
// @source migrations/0016_binding_authorizations.sql
// @evidence backend/payments/bind-authorize.test.ts
// @evidence backend/payments/evm.integration.ts
// Two one-shot challenge/authorize requests, one actor, two successive effective
// registry claims, two version representatives and two deployment identities.
// Exact expiry offsets represent 600s, 601s, 90d, 90d+3600s and one second
// beyond. Observable time is 0, 601 or upper+1, but each request retains the
// timestamp captured before session/body/lookup awaits. No continuous-clock
// freshness or automatic retries are claimed.
// Deployment classes summarize exact network/vault matching, EVM family,
// configured registry chain/chain ID and the unknown-network 31337 exception.
// Duplicate matches refuse. A selected deployment supplies the chain ID; the
// caller does not supply an authoritative one. Body/actor/claim/chain checks
// and canonical EIP-712 signatures are predicates, not byte/crypto proofs.
// Supplied expectedVersion is accepted as signed evidence; only challenge
// omission calls version discovery. Authorization never checks that supplied
// version against a live chain. Current claim eligibility is a read snapshot.
// Consent is append-only evidence, not proof of an on-chain binding or current
// executor eligibility. No action signs, broadcasts, consumes money or changes
// payment state. Executor selection/revalidation is outside this API model.
// At most one retained seed plus two new rows. A bad seed represents existing
// inconsistent stored evidence for readback refusal, not an API-generated bad
// signature. First signature/timestamp survive a same-key replay. New expiry
// means another key. INSERT effect, reply, exact stored-signature verification
// and HTTP delivery are separate. Statement success metadata is not inspected.
// Existing workflows exercise real signing, local chain and migrated handlers;
// no workflow, parser or checker was executed for these definitions.
// The finite step uses reviewed reductions (see the comment at step and
// formal/README.md); direct actions and named scenarios keep full behavior.
module evm_binding_consent_api {
  val ids = Set(1, 2)
  val lifetime = 90 * 24 * 60 * 60
  val upper = lifetime + 3600
  val offsets = Set(600, 601, lifetime, upper, upper + 1)
  val deploymentClasses = Set("missing", "error", "none", "duplicate", "wrong-chain",
    "wrong-chain-id", "wrong-vault", "wrong-network", "registry", "local-31337")
  val signatures = Set("canonical", "v01", "high-s", "wrong-binding", "invalid")
  type Consent = { exists: bool, claim: int, deployment: int, version: int,
    expiry: int, signature: int, created: int }
  type Request = { phase: str, mode: str, claim: int, stamp: int, suppliedVersion: int,
    version: int, discoveryCalls: int, offset: int, expiry: int, deployment: int,
    snapshot: int, verified: bool, signature: int, inserted: bool,
    desired: str, response: str }
  val absent: Consent = { exists: false, claim: 1, deployment: 1, version: 0,
    expiry: 0, signature: 0, created: 0 }
  val idle: Request = { phase: "unused", mode: "challenge", claim: 1, stamp: 0,
    suppliedVersion: -1, version: -1, discoveryCalls: 0, offset: 601, expiry: 0,
    deployment: 0, snapshot: 0, verified: false, signature: 0, inserted: false,
    desired: "none", response: "none" }
  var s: { configured: bool, now: int, effective: int, rows: Set[Consent], requests: int -> Request }
  val startState = { configured: false, now: 0, effective: 1, rows: Set(), requests: ids.mapBy(_ => idle) }
  action init = s' = startState
  // Quint cannot translate init when another action also reuses it (QNT409).
  // Reusable setup actions start from initState, which sets the same state.
  action initState = s' = startState
  def ended(request: Request, desired: str): Request = request.with("phase", "response").with("desired", desired)
  // Projection used only by step (project=true). Requests are one-shot, so a
  // done request is terminal and only the invariant reads it. Each field is
  // kept exactly when an invariant clause whose premise holds reads it; the
  // others, the response and the error text are written as fixed
  // representatives. The response phase is read only by respond, whose
  // projected successor depends on nothing else, and the invariant has the
  // same value there as in that successor; a projected ending therefore moves
  // directly to that done state.
  def finished(r: Request): Request = {
    val keepsMode = r.discoveryCalls == 1 or r.verified
    val keepsKey = r.inserted or r.desired == "200-authorized"
    val keepsTime = r.verified or r.desired == "200-challenge" or keepsKey
    idle.with("phase", "done").with("discoveryCalls", r.discoveryCalls)
      .with("mode", if (keepsMode) r.mode else idle.mode)
      .with("suppliedVersion", if (keepsMode) r.suppliedVersion else idle.suppliedVersion)
      .with("verified", r.verified).with("inserted", r.inserted)
      .with("claim", if (r.verified) r.claim else idle.claim)
      .with("snapshot", if (r.verified or keepsKey) r.snapshot else idle.snapshot)
      .with("deployment", if (keepsKey) r.deployment else idle.deployment)
      .with("version", if (keepsKey) r.version else idle.version)
      .with("expiry", if (keepsTime) r.expiry else idle.expiry)
      .with("stamp", if (keepsTime) r.stamp else idle.stamp)
      .with("desired", if (Set("200-authorized", "200-challenge").contains(r.desired)) r.desired else "error")
  }
  def endedWith(request: Request, desired: str, project: bool): Request =
    if (project) finished(ended(request, desired)) else ended(request, desired)
  def sameKey(row: Consent, request: Request): bool = row.claim == request.snapshot
    and row.deployment == request.deployment and row.version == request.version and row.expiry == request.expiry
  def stored(request: Request): Consent = s.rows.fold(absent, (prior, row) => if (sameKey(row, request)) row else prior)
  action configure(seed: str): bool = all { not(s.configured), Set("none", "valid", "invalid").contains(seed),
    s' = s.with("configured", true).with("rows", if (seed == "none") Set() else Set({ exists: true,
      claim: 1, deployment: 1, version: 0, expiry: 601, signature: if (seed == "valid") 1 else 0, created: 0 })) }
  action advance = all { s.configured, s.now < upper + 1,
    s' = s.with("now", if (s.now == 0) 601 else upper + 1) }
  action replaceEffective = all { s.configured, s.effective == 1, s' = s.with("effective", 2) }
  action begin(id: int, mode: str, claim: int, version: int, offset: int): bool = all {
    s.configured, ids.contains(id), Set("challenge", "authorize").contains(mode), Set(0, 1, 2).contains(claim),
    Set(-1, 0, 1).contains(version), offsets.contains(offset), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "body").with("mode", mode).with("claim", claim)
      .with("stamp", s.now).with("suppliedVersion", version).with("offset", offset).with("expiry", s.now + offset))) }
  action body(id: int, valid: bool): bool = bodyWith(id, valid, false)
  action bodyWith(id: int, valid: bool, project: bool): bool = {
    val request = s.requests.get(id)
    val accepted = valid and (request.mode != "authorize" or request.suppliedVersion != -1)
    all { request.phase == "body", s' = s.with("requests", s.requests.set(id,
      if (accepted) request.with("phase", "deployments") else endedWith(request, "400-input", project))) }
  }
  action deployments(id: int, kind: str): bool = deploymentsWith(id, kind, false)
  action deploymentsWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    val accepted = Set("registry", "local-31337").contains(kind)
    all { request.phase == "deployments", deploymentClasses.contains(kind),
      s' = s.with("requests", s.requests.set(id, if (accepted)
        request.with("phase", "wallet").with("deployment", if (kind == "registry") 1 else 2)
        else endedWith(request, if (Set("missing", "error").contains(kind)) "503-deployments" else "400-deployment", project))) }
  }
  action readWallet(id: int, eligible: bool, readSucceeded: bool): bool = readWalletWith(id, eligible, readSucceeded, false)
  action readWalletWith(id: int, eligible: bool, readSucceeded: bool, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "wallet", s' = s.with("requests", s.requests.set(id,
      if (not(readSucceeded)) endedWith(request, "500", project)
      else if (not(eligible) or request.claim != s.effective) endedWith(request, "409-claim", project)
      else request.with("phase", "version").with("snapshot", request.claim))) }
  }
  action suppliedVersion(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "version", request.suppliedVersion != -1,
      s' = s.with("requests", s.requests.set(id, request.with("phase", "binding").with("version", request.suppliedVersion))) }
  }
  action discoverVersion(id: int, outcome: str, version: int): bool = discoverVersionWith(id, outcome, version, false)
  action discoverVersionWith(id: int, outcome: str, version: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "version", request.mode == "challenge", request.suppliedVersion == -1,
      Set("value", "missing", "error").contains(outcome), Set(0, 1).contains(version),
      s' = s.with("requests", s.requests.set(id, (if (outcome == "value") request.with("phase", "binding").with("version", version)
        else endedWith(request.with("discoveryCalls", 1), if (outcome == "missing") "503-version" else "500", project))
        .with("discoveryCalls", 1))) }
  }
  action binding(id: int): bool = bindingWith(id, false)
  action bindingWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    val offset = request.expiry - request.stamp
    all { request.phase == "binding", s' = s.with("requests", s.requests.set(id,
      if (request.mode == "challenge") endedWith(request.with("expiry", request.stamp + lifetime), "200-challenge", project)
      else if (offset <= 600) endedWith(request, "400-too-soon", project)
      else if (offset > upper) endedWith(request, "400-too-late", project)
      else request.with("phase", "signature"))) }
  }
  action signature(id: int, kind: str, normalized: int): bool = signatureWith(id, kind, normalized, false)
  action signatureWith(id: int, kind: str, normalized: int, project: bool): bool = {
    val request = s.requests.get(id)
    val valid = Set("canonical", "v01").contains(kind)
    all { request.phase == "signature", signatures.contains(kind), Set(1, 2).contains(normalized),
      s' = s.with("requests", s.requests.set(id, if (valid)
        request.with("phase", "insert").with("verified", true).with("signature", normalized)
        else endedWith(request, "403-signature", project))) }
  }
  action insert(id: int, effect: bool): bool = {
    val request = s.requests.get(id)
    val existing = stored(request)
    val added = not(existing.exists) and effect
    val consent: Consent = { exists: true, claim: request.snapshot, deployment: request.deployment,
      version: request.version, expiry: request.expiry, signature: request.signature, created: request.stamp }
    all { request.phase == "insert",
      s' = s.with("rows", if (added) s.rows.union(Set(consent)) else s.rows)
        .with("requests", s.requests.set(id, request.with("phase", "write-reply").with("inserted", added))) }
  }
  action insertFailure(id: int): bool = insertFailureWith(id, false)
  action insertFailureWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "insert", s' = s.with("requests", s.requests.set(id, endedWith(request, "500", project))) }
  }
  action writeReply(id: int, received: bool): bool = writeReplyWith(id, received, false)
  action writeReplyWith(id: int, received: bool, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "write-reply", s' = s.with("requests", s.requests.set(id,
      if (received) request.with("phase", "readback") else endedWith(request, "500", project))) }
  }
  action readback(id: int, readSucceeded: bool): bool = readbackWith(id, readSucceeded, false)
  action readbackWith(id: int, readSucceeded: bool, project: bool): bool = {
    val request = s.requests.get(id)
    val retained = stored(request)
    all { request.phase == "readback", s' = s.with("requests", s.requests.set(id,
      endedWith(request, if (readSucceeded and retained.exists and retained.signature > 0) "200-authorized" else "500", project))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  // Small shared choices stay hoisted; each larger choice is bound only by the
  // action that reads it, after a guard that the action itself requires. The
  // transition relation is unchanged, but TLC no longer evaluates every action
  // for the full product of unrelated choices, and the simulator does not
  // retry those choices for a disabled action. Ending requests are written
  // through the projection at finished, so step does not use respond. now is read only by begin and
  // effective only by readWallet; the invariant checks their ranges. Once no
  // request can still perform that read, a change is unobservable, so step
  // offers advance and replaceEffective only while one can.
  val clockLive = ids.exists(id => s.requests.get(id).phase == "unused")
  // Time compression: a stamp is used only through stamp + offset, and for
  // the offsets here two requests (or a request and the seed) can have equal
  // expiries only when their stamps are equal. Every other use is relative
  // and the invariant checks only the range of now. Relabelling the present
  // stamps in order therefore preserves every guard and invariant, and a step
  // from an unused now changes nothing observable; step advances only from a
  // present stamp.
  val presentStamps = s.rows.map(row => row.created)
    .union(ids.filter(id => s.requests.get(id).phase != "unused").map(id => s.requests.get(id).stamp))
  val claimLive = ids.exists(id => Set("unused", "body", "deployments", "wallet").contains(s.requests.get(id).phase))
  // Local actions first. In the body, deployments, version, binding,
  // signature and write-reply phases every enabled action of a request reads
  // and writes only that request. It commutes with every action of the other
  // request and of the environment, and no other action can disable it. The
  // invariant's per-request conjuncts read that request's fields and its
  // stored row; rows are only ever added and never changed. When some request
  // has a local action, step therefore takes only the local actions of the
  // lowest such request (an ample set). Non-local actions keep their order,
  // so every row set is still reached, and each request reaches each of its
  // own states with no more rows than in the full model.
  // Equivalent choices: the offset field is never read, and a challenge
  // overwrites its expiry at binding before anything reads it, so a challenge
  // uses offset 601 to represent all offsets. A stored signature is read only
  // through signature > 0, so normalized value 1 represents both.
  val localPhases = Set("body", "deployments", "version", "binding", "signature", "write-reply")
  val focus = if (localPhases.contains(s.requests.get(1).phase)) 1
    else if (localPhases.contains(s.requests.get(2).phase)) 2 else 0
  action step = {
    nondet id = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    val phase = s.requests.get(id).phase
    any {
      all { not(s.configured), { nondet seed = Set("none", "valid", "invalid").oneOf() configure(seed) } },
      all { focus == 0, clockLive, presentStamps.contains(s.now), advance },
      all { focus == 0, claimLive, replaceEffective },
      all { focus == 0 or focus == id, local(id, yes) },
      // The two requests are interchangeable (nothing reads a request's
      // number), so the lower unused one begins first.
      all { focus == 0, phase == "unused", id == 1 or s.requests.get(1).phase != "unused", {
        nondet mode = Set("challenge", "authorize").oneOf()
        nondet claim = Set(0, 1, 2).oneOf()
        nondet version = Set(-1, 0, 1).oneOf()
        nondet offset = offsets.oneOf()
        begin(id, mode, claim, version, if (mode == "challenge") 601 else offset) } },
      all { focus == 0, any { readWalletWith(id, yes, other, true), insert(id, yes), insertFailureWith(id, true),
        readbackWith(id, yes, true) } },
      s' = s }
  }
  // The actions of one request that read and write only that request.
  action local(id: int, yes: bool): bool = {
    val phase = s.requests.get(id).phase
    any {
      bodyWith(id, yes, true),
      all { phase == "deployments", { nondet deployment = deploymentClasses.oneOf() deploymentsWith(id, deployment, true) } },
      suppliedVersion(id),
      all { phase == "version", {
        nondet discovered = Set(0, 1).oneOf()
        nondet discovery = Set("value", "missing", "error").oneOf()
        discoverVersionWith(id, discovery, discovered, true) } },
      bindingWith(id, true),
      all { phase == "signature", {
        nondet sig = signatures.oneOf()
        signatureWith(id, sig, 1, true) } },
      writeReplyWith(id, yes, true) }
  }
  val invariant = all {
    Set(0, 601, upper + 1).contains(s.now), ids.contains(s.effective), s.rows.size() <= 3,
    s.rows.forall(a => s.rows.forall(b => a == b or not(a.claim == b.claim and a.deployment == b.deployment
      and a.version == b.version and a.expiry == b.expiry))),
    ids.forall(id => {
      val request = s.requests.get(id)
      val retained = stored(request)
      all { request.discoveryCalls <= 1,
        request.discoveryCalls == 1 implies request.mode == "challenge" and request.suppliedVersion == -1,
        request.verified implies request.mode == "authorize" and request.snapshot == request.claim
          and request.expiry > request.stamp + 600 and request.expiry <= request.stamp + upper,
        request.inserted implies retained.exists and retained.signature > 0,
        request.desired == "200-authorized" implies request.verified and retained.exists and retained.signature > 0,
        request.desired == "200-challenge" implies not(request.inserted) and request.expiry == request.stamp + lifetime }
    }) }
  action admitted(id: int, mode: str, version: int, offset: int): bool = begin(id, mode, 1, version, offset)
    .then(body(id, true)).then(deployments(id, "registry")).then(readWallet(id, true, true))
  action consent(id: int, version: int, offset: int, sig: int): bool = admitted(id, "authorize", version, offset)
    .then(suppliedVersion(id)).then(binding(id)).then(signature(id, "canonical", sig))
  action completed(id: int): bool = insert(id, true).then(writeReply(id, true)).then(readback(id, true)).then(respond(id, true))
  action fresh = initState.then(configure("none"))

  run invalidBodyRefusesBeforeDeploymentReadTest = fresh.then(begin(1, "challenge", 1, 0, 601)).then(body(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-input" and s.rows == Set() and invariant)
  run authorizeRequiresExplicitExpectedVersionTest = fresh.then(begin(1, "authorize", 1, -1, 601)).then(body(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-input" and invariant)
  run challengeMayDiscoverExpectedVersionTest = fresh.then(admitted(1, "challenge", -1, 601)).then(discoverVersion(1, "value", 1))
    .then(binding(1)).then(respond(1, true)).expect(s.requests.get(1).version == 1 and s.requests.get(1).discoveryCalls == 1 and invariant)
  run suppliedVersionSkipsDiscoveryTest = fresh.then(admitted(1, "challenge", 0, 601)).then(suppliedVersion(1)).then(binding(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200-challenge" and s.requests.get(1).discoveryCalls == 0 and invariant)
  run unavailableVersionReturns503Test = fresh.then(admitted(1, "challenge", -1, 601)).then(discoverVersion(1, "missing", 0)).then(respond(1, true))
    .expect(s.requests.get(1).response == "503-version" and invariant)
  run thrownVersionLookupReturns500Test = fresh.then(admitted(1, "challenge", -1, 601)).then(discoverVersion(1, "error", 0)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and invariant)
  run missingDeploymentSourceReturns503Test = fresh.then(begin(1, "challenge", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "missing")).then(respond(1, true)).expect(s.requests.get(1).response == "503-deployments" and invariant)
  run failedDeploymentReadReturns503Test = fresh.then(begin(1, "authorize", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "error")).then(respond(1, true)).expect(s.requests.get(1).response == "503-deployments" and invariant)
  run duplicateDeploymentMatchesRefuseTest = fresh.then(begin(1, "challenge", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "duplicate")).then(respond(1, true)).expect(s.requests.get(1).response == "400-deployment" and invariant)
  run registryChainMismatchRefusesTest = fresh.then(begin(1, "challenge", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "wrong-chain")).then(respond(1, true)).expect(s.requests.get(1).response == "400-deployment" and invariant)
  run unknownNetwork31337ExceptionRemainsAvailableTest = fresh.then(begin(1, "challenge", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "local-31337")).then(readWallet(1, true, true)).then(suppliedVersion(1)).then(binding(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200-challenge" and s.requests.get(1).deployment == 2 and invariant)
  run ineligibleOrForeignWalletRefusesTest = fresh.then(begin(1, "authorize", 1, 0, 601)).then(body(1, true))
    .then(deployments(1, "registry")).then(readWallet(1, false, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409-claim" and s.rows == Set() and invariant)
  run exactSubmissionMarginRefusesTest = fresh.then(admitted(1, "authorize", 0, 600)).then(suppliedVersion(1)).then(binding(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-too-soon" and invariant)
  run oneSecondBeyondSubmissionMarginAcceptedTest = fresh.then(consent(1, 0, 601, 1)).then(completed(1))
    .expect(s.requests.get(1).response == "200-authorized" and invariant)
  run exactLifetimeAndSlackUpperBoundaryAcceptedTest = fresh.then(consent(1, 0, upper, 1)).then(completed(1))
    .expect(s.requests.get(1).response == "200-authorized" and invariant)
  run beyondLifetimeAndSlackRefusesTest = fresh.then(admitted(1, "authorize", 0, upper + 1)).then(suppliedVersion(1)).then(binding(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-too-late" and invariant)
  run highSSignatureRefusesWithoutInsertionTest = fresh.then(admitted(1, "authorize", 0, 601)).then(suppliedVersion(1)).then(binding(1))
    .then(signature(1, "high-s", 1)).then(respond(1, true)).expect(s.requests.get(1).response == "403-signature" and s.rows == Set() and invariant)
  run wrongBindingSignatureRefusesTest = fresh.then(admitted(1, "authorize", 0, 601)).then(suppliedVersion(1)).then(binding(1))
    .then(signature(1, "wrong-binding", 1)).then(respond(1, true)).expect(s.requests.get(1).response == "403-signature" and invariant)
  run zeroOneRecoveryByteNormalizesBeforeStorageTest = fresh.then(admitted(1, "authorize", 0, 601)).then(suppliedVersion(1)).then(binding(1))
    .then(signature(1, "v01", 1)).then(completed(1)).expect(stored(s.requests.get(1)).signature == 1 and invariant)
  run sameKeyReplayRetainsFirstSignatureTest = fresh.then(consent(1, 0, 601, 1)).then(completed(1))
    .then(consent(2, 0, 601, 2)).then(completed(2))
    .expect(s.rows.size() == 1 and stored(s.requests.get(2)).signature == 1 and not(s.requests.get(2).inserted) and invariant)
  run newExpiryAppendsRenewalTest = fresh.then(consent(1, 0, 601, 1)).then(completed(1)).then(consent(2, 0, lifetime, 2)).then(completed(2))
    .expect(s.rows.size() == 2 and invariant)
  run insertFailureDoesNotClaimSuccessTest = fresh.then(consent(1, 0, 601, 1)).then(insertFailure(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.rows == Set() and invariant)
  run committedWriteCanLoseReplyTest = fresh.then(consent(1, 0, 601, 1)).then(insert(1, true)).then(writeReply(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.rows.size() == 1 and invariant)
  run failedReadbackDoesNotUndoInsertTest = fresh.then(consent(1, 0, 601, 1)).then(insert(1, true)).then(writeReply(1, true)).then(readback(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.rows.size() == 1 and invariant)
  run fulfilledWriteWithoutRetainedRowRefusesTest = fresh.then(consent(1, 0, 601, 1)).then(insert(1, false)).then(writeReply(1, true)).then(readback(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.rows == Set() and invariant)
  run invalidRetainedSignatureIsNotOverwrittenOrAcceptedTest = init.then(configure("invalid")).then(consent(1, 0, 601, 1)).then(completed(1))
    .expect(s.requests.get(1).response == "500" and stored(s.requests.get(1)).signature == 0 and s.rows.size() == 1 and invariant)
  run laterEffectiveClaimDoesNotEraseCapturedConsentTest = fresh.then(consent(1, 0, 601, 1)).then(replaceEffective).then(completed(1))
    .expect(s.effective == 2 and stored(s.requests.get(1)).claim == 1 and s.requests.get(1).response == "200-authorized" and invariant)
  run capturedExpiryAdmissionCanFinishAfterExpiryTest = fresh.then(consent(1, 0, 601, 1)).then(advance).then(advance).then(completed(1))
    .expect(s.now > s.requests.get(1).expiry and s.requests.get(1).response == "200-authorized" and invariant)
  run delayedChallengeUsesOriginalCaptureTest = fresh.then(admitted(1, "challenge", 0, 601)).then(suppliedVersion(1)).then(advance).then(advance)
    .then(binding(1)).then(respond(1, true)).expect(s.requests.get(1).expiry == lifetime and s.now > lifetime and s.rows == Set() and invariant)
  run lostHttpSuccessLeavesConsentRetainedTest = fresh.then(consent(1, 0, 601, 1)).then(insert(1, true)).then(writeReply(1, true)).then(readback(1, true)).then(respond(1, false))
    .expect(s.requests.get(1).response == "lost" and s.rows.size() == 1 and invariant)
}
