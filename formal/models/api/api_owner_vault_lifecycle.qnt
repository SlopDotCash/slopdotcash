// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/edge-cache.ts
// @source backend/projects/vault-setup.ts
// @source src/lib/vault-setup.ts
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// @evidence scripts/vault-setup-network-failure.test.ts
// @evidence scripts/solana-vault-setup-network-failure.test.ts
// Two requests, ordinary/bounty purposes, EVM/Solana transaction classes and
// immutable project revisions 1..3. One actor represents the authenticated
// requester; owner includes steward or repository admin, writer is lesser
// repository authority. Exact identity, manifest/policy checks and chain proof
// are predicates. Full service candidate verification has a separate model.
// Project, restrictions and GitHub access are captured at separate awaits.
// Bounty GET may inspect funds while restricted, with canSetup false. Ordinary
// GET and both writes need participation and steward/admin authority. The
// GitHub role observation is not a lock across subsequent chain reads.
// Basic body validation and service availability precede idempotent replay.
// Same-purpose/network/transaction replay then precedes expectedRevision and
// wallet/chain validation. EVM transaction case folds; Solana case does not.
// Stale review refuses. Stale registration uses an immutable compatible policy;
// cap-only changes are compatible and retain the old creation cap. Publication
// attaches the verified deployment to the captured current policy, using that
// current revision (not the old creation revision) for the guarded CAS.
// Revision and enforcement-generation races cannot partially append history.
// A response uses the request's committed revision, not a subsequent head.
// Lost batch results and the post-commit generation read can fail after commit;
// cache deletion errors are swallowed. A retry can discover the stored vault.
// History bounds are finite; no liveness or continuous external freshness claim.
// Existing workflow definitions are partial evidence, not execution of all
// races below. This model and its scenarios have not been executed or parsed.
module api_owner_vault_lifecycle {
  val slots = Set(1, 2)
  val purposes = Set(1, 2)
  val revisions = Set(1, 2, 3)
  type Policy = { exists: bool, kind: int, cap: int }
  type Deployment = { exists: bool, transaction: int, family: str }
  val absentPolicy: Policy = { exists: false, kind: 0, cap: 0 }
  val absentDeployment: Deployment = { exists: false, transaction: 0, family: "evm" }
  type Request = { phase: str, mode: str, purpose: int, family: str, transaction: int,
    expected: int, current: int, policy: int, cap: int, creationRevision: int, creationCap: int,
    captured: Deployment, restricted: bool, banned: bool, canSetup: bool,
    appendGeneration: int, committed: int, responseRevision: int, status: int, result: str,
    chainCalled: bool, received: bool, noStore: bool }
  val idle: Request = { phase: "unused", mode: "get", purpose: 1, family: "evm", transaction: 1,
    expected: 1, current: 0, policy: 0, cap: 0, creationRevision: 0, creationCap: 0,
    captured: absentDeployment, restricted: false, banned: false, canSetup: false,
    appendGeneration: -1, committed: 0, responseRevision: 0, status: 0, result: "none",
    chainCalled: false, received: false, noStore: false }
  var s: { present: bool, head: int, history: int -> Policy, deployments: int -> Deployment,
    generation: int, restricted: bool, banned: bool, authority: str, requests: int -> Request }
  action init = s' = { present: true, head: 1,
    history: revisions.mapBy(rev => if (rev == 1) { exists: true, kind: 1, cap: 1 } else absentPolicy),
    deployments: purposes.mapBy(_ => absentDeployment), generation: 0, restricted: false,
    banned: false, authority: "owner", requests: slots.mapBy(_ => idle) }
  def policyAt(revision: int): Policy = if (revisions.contains(revision)) s.history.get(revision) else absentPolicy
  def deploymentAt(purpose: int): Deployment = if (purposes.contains(purpose)) s.deployments.get(purpose) else absentDeployment
  def respond(r: Request, status: int, result: str): Request = r.with("phase", "response")
    .with("status", status).with("result", result).with("noStore", true)
  action omitProject = all { slots.forall(id => s.requests.get(id).phase == "unused"), s' = s.with("present", false) }
  action seedDeployment(purpose: int, family: str): bool = all { purposes.contains(purpose), Set("evm", "solana").contains(family),
    slots.forall(id => s.requests.get(id).phase == "unused"),
    s' = s.with("deployments", s.deployments.set(purpose, { exists: true, transaction: 1, family: family })) }
  action changeAuthority(authority: str): bool = all { Set("owner", "writer", "none", "retry", "missing-app").contains(authority),
    s' = s.with("authority", authority) }
  action restrict = all { not(s.restricted), s.generation < 2,
    s' = s.with("restricted", true).with("generation", s.generation + 1) }
  action ban = all { not(s.banned), s.generation < 2,
    s' = s.with("banned", true).with("generation", s.generation + 1) }
  action edit(kind: str): bool = {
    val old = policyAt(s.head)
    val nextPolicy: Policy = { exists: true, kind: if (kind == "policy") 2 else old.kind,
      cap: if (kind == "cap") 2 else old.cap }
    all { s.head < 3, Set("cap", "policy", "other").contains(kind),
      kind != "policy" or purposes.forall(purpose => not(deploymentAt(purpose).exists)),
      s' = s.with("head", s.head + 1).with("history", s.history.set(s.head + 1, nextPolicy)) }
  }
  action begin(id: int, mode: str, purpose: int, family: str, expected: int, transaction: str): bool = all {
    slots.contains(id), s.requests.get(id).phase == "unused", Set("get", "review", "register").contains(mode),
    Set(0, 1, 2).contains(purpose), Set("evm", "solana").contains(family), 0.to(3).contains(expected),
    Set("exact", "case", "other", "malformed").contains(transaction),
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "headers").with("mode", mode)
      .with("purpose", purpose).with("family", family).with("expected", expected)
      .with("transaction", if (transaction == "malformed") 3 else if (transaction == "exact" or (family == "evm" and transaction == "case")) 1 else 2))) }
  action headers(id: int, origin: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "headers", s' = s.with("requests", s.requests.set(id,
      if (r.mode != "get" and not(origin)) respond(r, 403, "origin") else r.with("phase", "session"))) }
  }
  action session(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "session", s' = s.with("requests", s.requests.set(id,
      if (available) r.with("phase", "project") else respond(r, 401, "session"))) }
  }
  action project(id: int): bool = {
    val r = s.requests.get(id)
    val policy = policyAt(s.head)
    all { r.phase == "project", s' = s.with("requests", s.requests.set(id,
      if (not(s.present)) respond(r, 404, "missing") else r.with("phase", "enforcements")
        .with("current", s.head).with("policy", policy.kind).with("cap", policy.cap)
        .with("creationRevision", s.head).with("creationCap", policy.cap).with("captured", deploymentAt(r.purpose)))) }
  }
  action enforcements(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "enforcements", s' = s.with("requests", s.requests.set(id,
      r.with("phase", "authority").with("restricted", s.restricted).with("banned", s.banned))) }
  }
  action authority(id: int): bool = {
    val r = s.requests.get(id)
    val bountyRead = r.mode == "get" and r.purpose == 2
    val roleResult = if (s.authority == "retry") respond(r, 503, "authority-unavailable")
      else if (s.authority == "missing-app") respond(r, 409, "installation")
      else if (s.authority == "none") respond(r, 403, "authority")
      else if (not(bountyRead) and s.authority != "owner") respond(r, 403, "steward-admin")
      else if (bountyRead) r.with("phase", "funds").with("canSetup", not(r.restricted or r.banned))
      else r.with("phase", "service")
    all { r.phase == "authority", s' = s.with("requests", s.requests.set(id,
      if (r.mode == "get" and not(purposes.contains(r.purpose))) respond(r, 400, "purpose")
      else if (not(bountyRead) and r.banned) respond(r, 403, "participation")
      else if (not(bountyRead) and r.restricted) respond(r, 409, "restricted") else roleResult)) }
  }
  action funds(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "funds", s' = s.with("requests", s.requests.set(id,
      respond(r, if (available) 200 else 500, if (available) "funds" else "dependency").with("responseRevision", r.current))) }
  }
  action service(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "service", s' = s.with("requests", s.requests.set(id,
      if (not(available)) respond(r, 503, "service-unavailable") else if (r.mode == "get") respond(r, 200, "networks").with("responseRevision", r.current)
      else r.with("phase", "body"))) }
  }
  action body(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "body", s' = s.with("requests", s.requests.set(id,
      if (not(valid) or not(purposes.contains(r.purpose))) respond(r, 400, "body")
      else if (r.mode == "register" and r.captured.exists and r.captured.family == r.family and r.captured.transaction == r.transaction)
        respond(r, 200, "existing").with("responseRevision", r.current)
      else r.with("phase", "expected"))) }
  }
  action expected(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "expected", s' = s.with("requests", s.requests.set(id,
      if (r.expected == 0) respond(r, 400, "expected")
      else if (r.mode == "review" and r.expected != r.current) respond(r, 409, "stale-review")
      else if (r.captured.exists) respond(r, 409, "already-registered")
      else if (r.mode == "register" and r.transaction == 3) respond(r, 400, "transaction")
      else r.with("phase", if (r.mode == "register" and r.expected != r.current) "history" else "chain"))) }
  }
  action history(id: int): bool = {
    val r = s.requests.get(id)
    val old = policyAt(r.expected)
    all { r.phase == "history", s' = s.with("requests", s.requests.set(id,
      if (not(old.exists)) respond(r, 409, "missing-history") else if (old.kind != r.policy) respond(r, 409, "changed-policy")
      else r.with("phase", "chain").with("creationRevision", r.expected).with("creationCap", old.cap))) }
  }
  action chain(id: int, outcome: str): bool = {
    val r = s.requests.get(id).with("chainCalled", true)
    all { r.phase == "chain", Set("valid", "pending", "invalid", "unavailable", "wallet-missing").contains(outcome),
      r.mode == "register" or outcome != "pending",
      s' = s.with("requests", s.requests.set(id,
        if (outcome == "wallet-missing") respond(r, 403, "wallet") else if (outcome == "invalid") respond(r, 422, "chain-invalid")
        else if (outcome == "unavailable") respond(r, 503, "chain-unavailable")
        else if (r.mode == "review") respond(r, 200, "review")
        else if (outcome == "pending") respond(r, 200, "pending") else r.with("phase", "append-generation"))) }
  }
  action appendGeneration(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "append-generation", s' = s.with("requests", s.requests.set(id,
      r.with("phase", "append-validation").with("appendGeneration", s.generation))) }
  }
  action appendValidation(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "append-validation", s' = s.with("requests", s.requests.set(id,
      if (s.banned) respond(r, 403, "participation") else if (s.restricted) respond(r, 409, "restricted")
      else if (not(valid)) respond(r, 422, "manifest") else r.with("phase", "commit"))) }
  }
  action commit(id: int, reply: str): bool = {
    val r = s.requests.get(id)
    val matches = r.current == s.head and r.appendGeneration == s.generation
    val nextPolicy: Policy = { exists: true, kind: r.policy, cap: r.cap }
    val written = r.with("committed", r.current + 1)
    all { r.phase == "commit", s.head < 3, Set("ok", "lost", "bad-metadata").contains(reply),
      s' = if (not(matches)) s.with("requests", s.requests.set(id, respond(r, 409, "cas")))
        else s.with("head", s.head + 1).with("history", s.history.set(s.head + 1, nextPolicy))
          .with("deployments", s.deployments.set(r.purpose, { exists: true, transaction: r.transaction, family: r.family }))
          .with("requests", s.requests.set(id, if (reply == "lost") respond(written, 500, "batch-reply")
            else if (reply == "bad-metadata") respond(written, 409, "batch-metadata") else written.with("phase", "postcommit"))) }
  }
  action postcommit(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "postcommit", Set("ok", "cache-delete-failed", "generation-read-failed").contains(outcome),
      s' = s.with("requests", s.requests.set(id,
        if (outcome == "generation-read-failed") respond(r, 500, "postcommit-read")
        else respond(r, 200, "registered").with("responseRevision", r.committed))) }
  }
  action send(id: int, received: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "response", s' = s.with("requests", s.requests.set(id, r.with("phase", "done").with("received", received))) }
  }
  action dependencyFailure(id: int): bool = {
    val r = s.requests.get(id)
    all { Set("session", "project", "enforcements", "service", "body", "history", "append-generation", "append-validation").contains(r.phase),
      s' = s.with("requests", s.requests.set(id, respond(r, 500, "dependency"))) }
  }
  action step = {
    nondet id = slots.oneOf()
    nondet purpose = Set(0, 1, 2).oneOf()
    nondet mode = Set("get", "review", "register").oneOf()
    nondet family = Set("evm", "solana").oneOf()
    nondet revision = 0.to(3).oneOf()
    nondet tx = Set("exact", "case", "other", "malformed").oneOf()
    nondet role = Set("owner", "writer", "none", "retry", "missing-app").oneOf()
    nondet editKind = Set("cap", "policy", "other").oneOf()
    nondet outcome = Set("valid", "pending", "invalid", "unavailable", "wallet-missing").oneOf()
    nondet reply = Set("ok", "lost", "bad-metadata").oneOf()
    nondet post = Set("ok", "cache-delete-failed", "generation-read-failed").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { omitProject, seedDeployment(purpose, family), changeAuthority(role), restrict, ban, edit(editKind),
      begin(id, mode, purpose, family, revision, tx), headers(id, yes), session(id, yes), project(id), enforcements(id), authority(id),
      funds(id, yes), service(id, yes), body(id, yes), expected(id), history(id), chain(id, outcome), appendGeneration(id), appendValidation(id, yes),
      commit(id, reply), postcommit(id, post), send(id, yes), dependencyFailure(id), s' = s }
  }
  val invariant = all { revisions.contains(s.head), policyAt(s.head).exists,
    slots.forall(id => {
      val r = s.requests.get(id)
      all { r.status > 0 implies r.noStore,
        r.result == "existing" implies r.captured.exists and r.captured.family == r.family and not(r.chainCalled) and r.committed == 0 and r.responseRevision == r.current,
        r.result == "registered" implies r.committed > 0 and r.responseRevision == r.committed,
        r.committed > 0 implies policyAt(r.committed).exists and deploymentAt(r.purpose).exists,
        r.result == "pending" implies r.committed == 0,
        r.result == "funds" implies r.mode == "get" and r.purpose == 2 }
    }) }
  action checked(id: int, mode: str, purpose: int, family: str, revision: int, tx: str): bool = begin(id, mode, purpose, family, revision, tx)
    .then(headers(id, true)).then(session(id, true)).then(project(id)).then(enforcements(id)).then(authority(id))
  action writeReady(id: int, mode: str, family: str, revision: int, tx: str): bool = checked(id, mode, 1, family, revision, tx)
    .then(service(id, true)).then(body(id, true)).then(expected(id))
  action prepared(id: int): bool = writeReady(id, "register", "evm", 1, "exact").then(chain(id, "valid")).then(appendGeneration(id)).then(appendValidation(id, true))
  run ordinaryNetworksNeedOwnerTest = init.then(changeAuthority("writer")).then(checked(1, "get", 1, "evm", 1, "exact"))
    .expect(s.requests.get(1).status == 403 and invariant)
  run restrictedBountyReadRemainsAvailableTest = init.then(restrict).then(ban).then(changeAuthority("writer"))
    .then(checked(1, "get", 2, "solana", 1, "exact")).then(funds(1, true))
    .expect(s.requests.get(1).status == 200 and not(s.requests.get(1).canSetup) and invariant)
  run restrictedOrdinaryReadRefusesTest = init.then(restrict).then(checked(1, "get", 1, "evm", 1, "exact"))
    .expect(s.requests.get(1).status == 409 and invariant)
  run invalidGetPurposeRefusesTest = init.then(checked(1, "get", 0, "evm", 1, "exact")).expect(s.requests.get(1).status == 400 and invariant)
  run missingProjectRefusesTest = init.then(omitProject).then(begin(1, "get", 1, "evm", 1, "exact"))
    .then(headers(1, true)).then(session(1, true)).then(project(1)).expect(s.requests.get(1).status == 404 and invariant)
  run existingEvmTransactionCaseFoldsBeforeExpectedValidationTest = init.then(seedDeployment(1, "evm"))
    .then(checked(1, "register", 1, "evm", 0, "case")).then(service(1, true)).then(body(1, true))
    .expect(s.requests.get(1).result == "existing" and s.requests.get(1).status == 200 and invariant)
  run solanaTransactionCaseIsDistinctTest = init.then(seedDeployment(1, "solana")).then(writeReady(1, "register", "solana", 1, "case"))
    .expect(s.requests.get(1).result == "already-registered" and s.requests.get(1).status == 409 and invariant)
  run otherNetworkCannotReplayExistingTransactionTest = init.then(seedDeployment(1, "evm")).then(writeReady(1, "register", "solana", 1, "exact"))
    .expect(s.requests.get(1).result == "already-registered" and not(s.requests.get(1).chainCalled) and invariant)
  run existingBountyKeepsOrdinarySlotIndependentTest = init.then(seedDeployment(2, "evm")).then(prepared(1))
    .then(commit(1, "ok")).then(postcommit(1, "ok")).expect(deploymentAt(1).exists and deploymentAt(2).exists and invariant)
  run replayStillNeedsValidBasicBodyTest = init.then(seedDeployment(1, "evm")).then(checked(1, "register", 1, "evm", 0, "exact"))
    .then(service(1, true)).then(body(1, false)).expect(s.requests.get(1).status == 400 and invariant)
  run replayStillNeedsServiceTest = init.then(seedDeployment(1, "evm")).then(checked(1, "register", 1, "evm", 1, "exact"))
    .then(service(1, false)).expect(s.requests.get(1).status == 503 and invariant)
  run staleReviewRefusesTest = init.then(edit("cap")).then(writeReady(1, "review", "evm", 1, "exact"))
    .expect(s.requests.get(1).result == "stale-review" and not(s.requests.get(1).chainCalled) and invariant)
  run capOnlyEditAllowsOldCreationTest = init.then(edit("cap")).then(writeReady(1, "register", "evm", 1, "exact"))
    .then(history(1)).then(chain(1, "valid")).then(appendGeneration(1)).then(appendValidation(1, true)).then(commit(1, "ok")).then(postcommit(1, "ok"))
    .expect(s.requests.get(1).creationCap == 1 and policyAt(3).cap == 2 and s.requests.get(1).responseRevision == 3 and invariant)
  run changedPolicyRefusesHistoricalCreationTest = init.then(edit("policy")).then(writeReady(1, "register", "solana", 1, "exact"))
    .then(history(1)).expect(s.requests.get(1).result == "changed-policy" and invariant)
  run absentHistoricalRevisionRefusesTest = init.then(writeReady(1, "register", "evm", 3, "exact")).then(history(1))
    .expect(s.requests.get(1).result == "missing-history" and invariant)
  run pendingChainDoesNotAppendTest = init.then(writeReady(1, "register", "solana", 1, "exact")).then(chain(1, "pending"))
    .expect(s.head == 1 and not(deploymentAt(1).exists) and invariant)
  run lostWalletDoesNotAppendTest = init.then(writeReady(1, "register", "evm", 1, "exact")).then(chain(1, "wallet-missing"))
    .expect(s.requests.get(1).status == 403 and s.head == 1 and invariant)
  run newBanDuringChainRefusesAppendTest = init.then(writeReady(1, "register", "evm", 1, "exact"))
    .then(chain(1, "valid")).then(appendGeneration(1)).then(ban).then(appendValidation(1, true)).expect(s.requests.get(1).status == 403 and s.head == 1 and invariant)
  run enforcementAfterValidationWinsAtCasTest = init.then(prepared(1)).then(restrict).then(commit(1, "ok"))
    .expect(s.requests.get(1).result == "cas" and s.head == 1 and invariant)
  run concurrentOwnerEditWinsAtCasTest = init.then(prepared(1)).then(edit("cap")).then(commit(1, "ok"))
    .expect(s.requests.get(1).result == "cas" and not(deploymentAt(1).exists) and invariant)
  run twoRegistrationsAppendOnceTest = init.then(prepared(1)).then(prepared(2)).then(commit(1, "ok")).then(commit(2, "ok"))
    .expect(s.head == 2 and s.requests.get(2).status == 409 and invariant)
  run laterHeadDoesNotReplaceOwnReceiptTest = init.then(prepared(1)).then(commit(1, "ok")).then(edit("other")).then(postcommit(1, "ok"))
    .expect(s.head == 3 and s.requests.get(1).responseRevision == 2 and invariant)
  run cacheDeleteFailureDoesNotUndoRegistrationTest = init.then(prepared(1)).then(commit(1, "ok")).then(postcommit(1, "cache-delete-failed"))
    .expect(s.requests.get(1).status == 200 and deploymentAt(1).exists and invariant)
  run postCommitReadFailureKeepsStoredVaultTest = init.then(prepared(1)).then(commit(1, "ok")).then(postcommit(1, "generation-read-failed"))
    .expect(s.requests.get(1).status == 500 and deploymentAt(1).exists and invariant)
  run lostBatchReplyRecoversWithoutSecondChainCallTest = init.then(prepared(1)).then(commit(1, "lost"))
    .then(checked(2, "register", 1, "evm", 1, "exact")).then(service(2, true)).then(body(2, true))
    .expect(s.head == 2 and s.requests.get(2).result == "existing" and not(s.requests.get(2).chainCalled) and invariant)
  run lostHttpReplyKeepsStoredVaultTest = init.then(prepared(1)).then(commit(1, "ok")).then(postcommit(1, "ok")).then(send(1, false))
    .expect(deploymentAt(1).exists and not(s.requests.get(1).received) and invariant)
  run roleObservationIsNotContinuousLockTest = init.then(prepared(1)).then(changeAuthority("none"))
    .then(commit(1, "ok")).then(postcommit(1, "ok")).expect(s.requests.get(1).status == 200 and invariant)
}
