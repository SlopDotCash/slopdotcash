// @source src/OwnerReserveRelease.tsx
// @source src/OwnerAwards.tsx
// @source src/lib/monthly-release-actions.ts
// @source src/lib/use-pending-wallet-attempt.ts
// @source src/lib/pending-attempt.ts
// @source src/lib/solana-vault-actions.ts
// @evidence tests/e2e/owner-awards.spec.ts
// Source-only model; no execution or chain acceptance claimed.
// Two component lifetimes/attempts and two project-period-network storage keys.
// A manifest replacement reuses its storage key; a project/period/network
// replacement uses the other key. The OwnerAwards key/removal retires the old
// child during layout. Explicit signout removes it; an unannounced cookie
// change alone does not. IDs 1/2 are symbolic unique attempts, not product caps.
// API admission checks the then-current actor's owner permission. A ready
// response represents backend-qualified whole untouched wrong-total evidence,
// signed attestation and matching request/deployment fields. These facts, plan
// hashes, EVM simulation, Solana message bytes/expiry, current wallet ownership,
// and finalized receipt checks are external predicates, not cryptographic proof.
// An admitted plan may outlive that actor observation. The separate owner wallet
// signs the release; the UI neither signs for the owner nor broadcasts itself.
// Amount is one symbolic whole reserve. Finalized release returns it to free
// funds, never pays a contributor. Failed/pending checks do not claim release.
// Recovery snapshots are distinct from editable hashes. Check replies use exact
// record CAS; a returned wallet hash uses attempt-ID CAS even after departure.
// Unlike shared submit callers, this component retains its no-hash intent after
// a 4001 decline. The owner can clear it only through the wallet-activity check.
// Stored records here are already parseable; malformed-storage quarantine and
// its separate acknowledgement control are outside this finite model.
module ui_monthly_reserve_release {
  type Pending = { attempt: int, plan: int, hash: int }
  type Operation = { kind: str, phase: str, actor: int, plan: int,
    scope: int, context: int, hash: int, captured: Pending }
  type State = { family: str, actor: int, owners: Set[int], context: int,
    alive: Set[int], scopes: int -> int, stores: int -> Pending,
    locals: int -> Pending, refs: int -> Pending, inputs: int -> int,
    plans: int -> int, qualified: Set[int], connected: Set[int], matches: Set[int],
    operations: int -> Operation, prompts: Set[int], notices: int -> str,
    released: Set[int], contributorPaid: bool }
  val ids = Set(1, 2)
  val empty: Pending = { attempt: 0, plan: 0, hash: 0 }
  val idle: Operation = { kind: "none", phase: "idle", actor: 0,
    plan: 0, scope: 1, context: 1, hash: 0, captured: empty }
  var s: State
  pure def initial(family: str): State = { family: family, actor: 1,
    owners: Set(1), context: 1, alive: Set(1), scopes: ids.mapBy(_ => 1),
    stores: ids.mapBy(_ => empty), locals: ids.mapBy(_ => empty),
    refs: ids.mapBy(_ => empty), inputs: ids.mapBy(_ => 0),
    plans: ids.mapBy(_ => 0), qualified: Set(), connected: Set(), matches: Set(),
    operations: ids.mapBy(_ => idle), prompts: Set(),
    notices: ids.mapBy(_ => "none"), released: Set(), contributorPaid: false }
  action init = { nondet family = Set("evm", "solana").oneOf()
    s' = initial(family) }
  action evm = s' = initial("evm")
  action solana = s' = initial("solana")
  def live(id: int): bool = s.alive.contains(id)
  def free(id: int): bool = live(id) and s.operations.get(id).phase == "idle"
  pure def finish(value: State, id: int, notice: str): State =
    value.with("operations", value.operations.set(id, idle))
      .with("notices", if (value.alive.contains(id)) value.notices.set(id, notice) else value.notices)

  action beginReview(id: int): bool = all { free(id), s.locals.get(id).attempt == 0,
    s' = s.with("plans", s.plans.set(id, 0)).with("notices", s.notices.set(id, "none"))
      .with("operations", s.operations.set(id, idle.with("kind", "review")
        .with("phase", "admission").with("scope", s.scopes.get(id)).with("context", s.context))) }
  action apiAdmission(id: int): bool = all { s.operations.get(id).phase == "admission",
    s' = if (s.actor > 0 and s.owners.contains(s.actor))
      s.with("operations", s.operations.set(id, s.operations.get(id)
        .with("actor", s.actor).with("phase", "worker")))
      else finish(s, id, "refused") }
  action reviewReply(id: int, result: str, bindingsMatch: bool): bool = {
    val op = s.operations.get(id)
    val accepted = result == "ready" and bindingsMatch
    val done = finish(s, id, if (accepted) "ready" else if (result == "ready") "refused" else result)
    all { op.kind == "review", op.phase == "worker",
      Set("ready", "healthy", "missing", "mismatch", "prior-transition", "unavailable").contains(result),
      s' = if (accepted) done.with("qualified", s.qualified.union(Set(id)))
        .with("plans", if (live(id)) s.plans.set(id, id) else s.plans) else done }
  }
  action beginConnect(id: int): bool = all { free(id), s.plans.get(id) > 0,
    s' = s.with("operations", s.operations.set(id, idle.with("kind", "connect")
      .with("phase", "wallet"))) }
  action connectionReply(id: int, ownerWallet: bool): bool = all {
    s.operations.get(id).kind == "connect", s.operations.get(id).phase == "wallet",
    s' = if (live(id)) finish(s, id, "connected")
      .with("connected", s.connected.union(Set(id)))
      .with("matches", if (ownerWallet) s.matches.union(Set(id)) else s.matches.exclude(Set(id)))
      else finish(s, id, "ignored") }
  action beginSend(id: int): bool = all { free(id), s.plans.get(id) > 0,
    s.connected.contains(id), s.locals.get(id).attempt == 0,
    s' = s.with("operations", s.operations.set(id, idle.with("kind", "send")
      .with("phase", "chain").with("plan", s.plans.get(id))
      .with("scope", s.scopes.get(id)).with("context", s.context))) }
  action chainPreflight(id: int, evidenceMatches: bool): bool = all {
    s.operations.get(id).kind == "send", s.operations.get(id).phase == "chain",
    s' = if (evidenceMatches and s.matches.contains(id))
      s.with("operations", s.operations.set(id, s.operations.get(id).with("phase", "before-send")))
      else finish(s, id, "refused") }
  action beforeSend(id: int, storageWorks: bool): bool = {
    val op = s.operations.get(id)
    val intent = { attempt: id, plan: op.plan, hash: 0 }
    all { op.kind == "send", op.phase == "before-send",
      s' = if (live(id) and storageWorks and s.stores.get(op.scope).attempt == 0)
        s.with("stores", s.stores.set(op.scope, intent)).with("locals", s.locals.set(id, intent))
          .with("refs", s.refs.set(id, intent)).with("inputs", s.inputs.set(id, 0))
          .with("prompts", s.prompts.union(Set(id)))
          .with("operations", s.operations.set(id, op.with("phase", "prompt")))
      else finish(s, id, "refused") }
  }
  action walletHash(id: int, storageWorks: bool): bool = {
    val op = s.operations.get(id)
    val submitted = { attempt: id, plan: op.plan, hash: id }
    val owned = s.stores.get(op.scope).attempt == id
    val done = finish(s, id, if (not(owned) or not(storageWorks)) "keep-returned-hash" else "submitted")
    all { op.kind == "send", op.phase == "prompt",
      s' = if (owned and storageWorks) done.with("stores", s.stores.set(op.scope, submitted))
        .with("refs", s.refs.set(id, submitted))
        .with("locals", if (live(id)) s.locals.set(id, submitted) else s.locals)
        .with("inputs", if (live(id)) s.inputs.set(id, id) else s.inputs)
      else if (not(storageWorks) and live(id)) done.with("locals", s.locals.set(id, submitted))
        .with("inputs", s.inputs.set(id, id)) else done }
  }
  action walletError(id: int, declined: bool): bool = all {
    s.operations.get(id).kind == "send", s.operations.get(id).phase == "prompt",
    s' = finish(s, id, if (declined) "declined-intent-retained" else "uncertain-intent-retained") }
  action editHash(id: int, hash: int): bool = all { free(id), s.locals.get(id).attempt > 0,
    ids.contains(hash), s' = s.with("inputs", s.inputs.set(id, hash)) }
  action beginCheck(id: int): bool = all { free(id), s.locals.get(id).attempt > 0,
    s.inputs.get(id) > 0, s.refs.get(id).attempt > 0,
    s' = s.with("operations", s.operations.set(id, idle.with("kind", "check")
      .with("phase", "admission").with("plan", s.locals.get(id).plan)
      .with("hash", s.inputs.get(id)).with("captured", s.refs.get(id))
      .with("scope", s.scopes.get(id)).with("context", s.context))) }
  // A check result means the server bound this transaction to the retained plan
  // and current compatible deployment. A changed deployment is `unavailable`.
  action checkReply(id: int, result: str, storageWorks: bool): bool = {
    val op = s.operations.get(id)
    val exact = s.stores.get(op.scope) == op.captured
    val done = finish(s, id, if (not(exact) or not(storageWorks)) "storage-conflict" else result)
    val observed = if (result == "finalized") done.with("released", s.released.union(Set(op.plan))) else done
    val candidate = s.locals.get(id).with("hash", op.hash)
    all { op.kind == "check", op.phase == "worker",
      Set("pending", "failed", "finalized", "unavailable").contains(result),
      s' = if (not(live(id))) observed
      else if (result == "unavailable") finish(s, id, "unavailable")
      else if (not(exact) or not(storageWorks)) observed
      else if (result == "pending") observed.with("stores", s.stores.set(op.scope, candidate))
        .with("refs", s.refs.set(id, candidate)).with("locals", s.locals.set(id, candidate))
      else observed.with("stores", s.stores.set(op.scope, empty)).with("locals", s.locals.set(id, empty))
        .with("refs", s.refs.set(id, empty)).with("plans", s.plans.set(id, 0)) }
  }
  action clearUnsent(id: int, storageWorks: bool): bool = all { free(id),
    s.locals.get(id).attempt > 0, s.locals.get(id).hash == 0,
    s' = if (storageWorks and s.stores.get(s.scopes.get(id)) == s.refs.get(id))
      s.with("stores", s.stores.set(s.scopes.get(id), empty)).with("locals", s.locals.set(id, empty))
        .with("refs", s.refs.set(id, empty)).with("plans", s.plans.set(id, 0))
        .with("notices", s.notices.set(id, "owner-cleared-after-wallet-check"))
      else s.with("notices", s.notices.set(id, "storage-conflict")) }
  action cookieActor(actor: int): bool = all { ids.contains(actor), s' = s.with("actor", actor) }
  action secondOwner = s' = s.with("owners", s.owners.union(Set(2)))
  action revokeOwner(actor: int): bool = all { ids.contains(actor),
    s' = s.with("owners", s.owners.exclude(Set(actor))) }
  action explicitSignout = s' = s.with("actor", 0).with("alive", Set())
  action depart(id: int): bool = all { live(id), s' = s.with("alive", s.alive.exclude(Set(id))) }
  action replacement(scope: int): bool = all { s.context == 1, ids.contains(scope),
    s.actor > 0, s.owners.contains(s.actor),
    s' = s.with("context", 2).with("alive", Set(2)).with("scopes", s.scopes.set(2, scope))
      .with("locals", s.locals.set(2, s.stores.get(scope)))
      .with("refs", s.refs.set(2, s.stores.get(scope)))
      .with("inputs", s.inputs.set(2, s.stores.get(scope).hash)) }
  action step = {
    nondet id = ids.oneOf()
    nondet result = Set("ready", "healthy", "missing", "mismatch", "prior-transition", "unavailable").oneOf()
    nondet check = Set("pending", "failed", "finalized", "unavailable").oneOf()
    nondet matches = Set(false, true).oneOf()
    nondet storageWorks = Set(false, true).oneOf()
    any { beginReview(id), apiAdmission(id), reviewReply(id, result, matches), beginConnect(id),
      connectionReply(id, matches), beginSend(id), chainPreflight(id, matches), beforeSend(id, storageWorks),
      walletHash(id, storageWorks), walletError(id, matches), editHash(id, id), beginCheck(id),
      checkReply(id, check, storageWorks), clearUnsent(id, storageWorks), cookieActor(id),
      secondOwner, revokeOwner(id), explicitSignout, depart(id), replacement(id), s' = s }
  }
  val invariant = all { not(s.contributorPaid), s.released.forall(plan => s.qualified.contains(plan)),
    ids.forall(id => s.plans.get(id) == 0 or s.qualified.contains(s.plans.get(id))),
    ids.forall(id => s.stores.get(id).attempt == 0 implies s.stores.get(id) == empty),
    ids.forall(id => s.stores.get(id).attempt > 0 implies s.qualified.contains(s.stores.get(id).plan)),
    ids.forall(id => s.operations.get(id).phase == "prompt" implies s.prompts.contains(id)) }

  // Scenario-only preparation; step still exposes every asynchronous boundary.
  action connected = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "ready", true)).then(beginConnect(1)).then(connectionReply(1, true))
  action prompted = connected.then(beginSend(1)).then(chainPreflight(1, true)).then(beforeSend(1, true))
  action submitted = prompted.then(walletHash(1, true))
  run healthyReserveRemainsHeldTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "healthy", true)).expect(s.plans.get(1) == 0 and s.notices.get(1) == "healthy")
  run missingAllocationRemainsHeldTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "missing", true)).expect(s.plans.get(1) == 0)
  run priorTransitionDoesNotReleaseAgainTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "prior-transition", true)).expect(s.released.size() == 0)
  run mismatchedPreparedBindingsRefuseTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "ready", false)).expect(s.qualified.size() == 0 and s.plans.get(1) == 0)
  run differentUnprivilegedActorRefusesAdmissionTest = evm.then(cookieActor(2))
    .then(beginReview(1)).then(apiAdmission(1)).expect(s.notices.get(1) == "refused")
  run revokedPermissionBeforeAdmissionRefusesTest = evm.then(beginReview(1)).then(revokeOwner(1))
    .then(apiAdmission(1)).expect(s.notices.get(1) == "refused")
  run admittedAuthorityIsAnObservationNotContinuousLeaseTest = evm.then(beginReview(1))
    .then(apiAdmission(1)).then(revokeOwner(1)).then(reviewReply(1, "ready", true))
    .expect(s.plans.get(1) == 1 and not(s.owners.contains(1)) and invariant)
  run admittedPlanOutlivesCoownerCookieObservationTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(secondOwner).then(cookieActor(2)).then(reviewReply(1, "ready", true))
    .expect(s.actor == 2 and s.plans.get(1) == 1 and invariant)
  run departedReadyReplyCannotRestorePlanTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(depart(1)).then(reviewReply(1, "ready", true)).expect(s.plans.get(1) == 0)
  run changedChainEvidenceStopsBeforeIntentTest = connected.then(beginSend(1)).then(chainPreflight(1, false))
    .expect(s.stores.get(1) == empty and s.prompts.size() == 0)
  run wrongOwnerWalletStopsBeforeIntentTest = evm.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "ready", true)).then(beginConnect(1)).then(connectionReply(1, false))
    .then(beginSend(1)).then(chainPreflight(1, true))
    .expect(s.stores.get(1) == empty and s.prompts.size() == 0)
  run changedManifestRetiresOldPreflightTest = connected.then(beginSend(1)).then(chainPreflight(1, true))
    .then(replacement(1)).then(beforeSend(1, true)).expect(s.stores.get(1) == empty and s.prompts.size() == 0)
  run explicitSignoutRetiresOldPreflightTest = connected.then(beginSend(1)).then(chainPreflight(1, true))
    .then(explicitSignout).then(beforeSend(1, true)).expect(s.prompts.size() == 0)
  run failedIntentStorageNeverPromptsTest = connected.then(beginSend(1)).then(chainPreflight(1, true))
    .then(beforeSend(1, false)).expect(s.prompts.size() == 0 and s.stores.get(1) == empty)
  run knownHashPersistsAfterDepartureTest = prompted.then(depart(1)).then(walletHash(1, true))
    .expect(s.stores.get(1).hash == 1 and s.released.size() == 0)
  run declinedReleaseKeepsUnsentIntentTest = prompted.then(walletError(1, true))
    .expect(s.stores.get(1).attempt == 1 and s.stores.get(1).hash == 0 and invariant)
  run uncertainWalletKeepsIntentTest = prompted.then(walletError(1, false))
    .expect(s.stores.get(1).attempt == 1 and s.released.size() == 0)
  run checkedWalletActivityCanClearDeclinedIntentTest = prompted.then(walletError(1, true))
    .then(clearUnsent(1, true)).expect(s.stores.get(1) == empty and s.plans.get(1) == 0)
  run pendingCheckDoesNotReleaseTest = submitted.then(beginCheck(1)).then(apiAdmission(1))
    .then(checkReply(1, "pending", true)).expect(s.stores.get(1).hash == 1 and s.released.size() == 0)
  run failedFinalizedTransactionAllowsNewReviewTest = submitted.then(beginCheck(1)).then(apiAdmission(1))
    .then(checkReply(1, "failed", true)).expect(s.stores.get(1) == empty and s.released.size() == 0)
  run finalizedReleaseReturnsReserveWithoutPayingContributorTest = submitted.then(beginCheck(1)).then(apiAdmission(1))
    .then(checkReply(1, "finalized", true)).expect(s.released.contains(1) and not(s.contributorPaid) and invariant)
  run unavailableCheckRetainsEvidenceTest = submitted.then(beginCheck(1)).then(apiAdmission(1))
    .then(checkReply(1, "unavailable", true)).expect(s.stores.get(1).hash == 1)
  run manifestReplacementRecoversSameStorageKeyTest = submitted.then(replacement(1))
    .then(beginCheck(2)).then(apiAdmission(2)).then(checkReply(2, "finalized", true))
    .expect(s.released.contains(1) and s.stores.get(1) == empty and invariant)
  run differentMonthKeepsOldPendingSeparateTest = submitted.then(replacement(2))
    .expect(s.locals.get(2) == empty and s.stores.get(1).hash == 1)
  run departedCheckCannotClearReplacementEvidenceTest = submitted.then(beginCheck(1)).then(apiAdmission(1))
    .then(replacement(1)).then(editHash(2, 2)).then(beginCheck(2)).then(apiAdmission(2))
    .then(checkReply(2, "pending", true)).then(checkReply(1, "failed", true))
    .expect(s.stores.get(1).hash == 2 and invariant)
  run oldWalletHashCannotRecreateClearedIntentTest = prompted.then(replacement(1))
    .then(clearUnsent(2, true)).then(walletHash(1, true)).expect(s.stores.get(1) == empty)
  run oldWalletHashCannotReplaceNewAttemptTest = prompted.then(replacement(1))
    .then(clearUnsent(2, true)).then(beginReview(2)).then(apiAdmission(2))
    .then(reviewReply(2, "ready", true)).then(beginConnect(2)).then(connectionReply(2, true))
    .then(beginSend(2)).then(chainPreflight(2, true)).then(beforeSend(2, true)).then(walletHash(1, true))
    .expect(s.stores.get(1).attempt == 2 and s.stores.get(1).hash == 0 and invariant)
  run exactCheckCannotOverwriteNewWalletEvidenceTest = prompted.then(replacement(1))
    .then(editHash(2, 2)).then(beginCheck(2)).then(apiAdmission(2)).then(walletHash(1, true))
    .then(checkReply(2, "pending", true))
    .expect(s.stores.get(1).hash == 1 and s.notices.get(2) == "storage-conflict" and invariant)
  run failedHashStorageKeepsVisibleHashTest = prompted.then(walletHash(1, false))
    .expect(s.locals.get(1).hash == 1 and s.stores.get(1).hash == 0 and s.inputs.get(1) == 1)
  run solanaReleaseUsesSameIntentAndFinalitySeparationTest = solana.then(beginReview(1)).then(apiAdmission(1))
    .then(reviewReply(1, "ready", true)).then(beginConnect(1)).then(connectionReply(1, true))
    .then(beginSend(1)).then(chainPreflight(1, true)).then(beforeSend(1, true))
    .then(walletHash(1, true)).then(beginCheck(1)).then(apiAdmission(1)).then(checkReply(1, "finalized", true))
    .expect(s.family == "solana" and s.released.contains(1) and not(s.contributorPaid))
}
