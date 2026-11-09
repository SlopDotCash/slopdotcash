// @source src/ContributorAllocation.tsx
// @source src/lib/contributor-allocation.ts
// @source src/lib/verified-frontend.ts
// @source src/lib/use-time-boundary.ts
// @source src/Earnings.tsx
// @evidence scripts/contributor-allocation.test.ts
// @evidence tests/e2e/contributor-allocation.spec.ts
// @evidence tests/e2e/ui-state-boundaries.spec.ts
// Public-file reader and current-account projection, authored without execution.
// Two request IDs, two component lifetimes, two recipient account IDs (0 is an
// outsider with no published row), two wallet classes
// per account and four recipient/transfer masks form the finite prefix. These
// are model bounds, not product limits. Amounts 1/2 identify the selected row;
// integer formatting, 256-bit bounds, EVM network/URL parsing, byte limits and
// date grammar are external validated predicates, not proved by this model.
// A transfer is recorded by the sender, not independently verified on chain.
// No action signs, submits a payment, writes account state or earns Points.
// Account changes represent validated Earnings props. Real sign-out removes
// this child; a later instance cannot receive the old instance's setState.
// Passive cleanup may allow old I/O to finish; departure here means its result
// has no visible consumer, not that the provider request was never performed.
// A changed published file is observed only on retry or component remount;
// there is no live file subscription. Timer fairness is not a safety assumption.
module ui_contributor_allocation {
  type Request = { phase: str, life: int, outcome: str,
    recipients: int, transfers: int, closed: bool }
  type State = { mounted: bool, life: int, actor: int, active: int,
    loadScheduled: bool, document: str, error: bool,
    recipients: int, transfers: int, closed: bool,
    wallets: int -> Set[str], nowExpired: bool, renderedExpired: bool,
    boundaryInstalled: bool, boundaryArmed: bool,
    publishedBy: int, publishedLife: int, requests: int -> Request }
  val ids = Set(1, 2)
  val actors = Set(0, 1, 2)
  val masks = Set(0, 1, 2, 3)
  val walletClasses = Set("none", "on-time", "late", "at-deadline",
    "unknown-time", "unauthorized", "wrong-chain")
  val empty = { phase: "unused", life: 0, outcome: "none",
    recipients: 0, transfers: 0, closed: false }
  var s: State
  action init = s' = { mounted: true, life: 1, actor: 1, active: 0,
    loadScheduled: true, document: "loading", error: false,
    recipients: 0, transfers: 0, closed: false,
    wallets: ids.mapBy(_ => Set("none")), nowExpired: false, renderedExpired: false,
    boundaryInstalled: false, boundaryArmed: false,
    publishedBy: 0, publishedLife: 0, requests: ids.mapBy(_ => empty) }
  pure def maskContains(mask: int, actor: int): bool = actor > 0 and
    (mask == 3 or mask == actor)
  pure def subset(transfers: int, recipients: int): bool =
    ids.forall(actor => maskContains(transfers, actor) implies maskContains(recipients, actor))
  def owns(id: int): bool = s.mounted and s.active == id and
    s.requests.get(id).life == s.life
  val eligibleWallet = if (s.actor > 0) s.wallets.get(s.actor).contains("on-time") else false
  val hasRow = s.mounted and not(s.error) and s.document == "published" and
    maskContains(s.recipients, s.actor)
  val rowActor = if (hasRow) s.actor else 0
  val displayedAmount = rowActor
  val state = if (not(s.mounted)) "hidden" else if (s.error) "error"
    else if (not(hasRow)) "hidden"
    else if (maskContains(s.transfers, s.actor)) "sent"
    else if (s.closed) "unclaimed"
    else if (eligibleWallet) "scheduled"
    else if (s.renderedExpired) "unclaimed" else "awaiting-wallet"
  val transferLink = state == "sent"
  val registrationLink = state == "awaiting-wallet"

  // Fetch begins in the passive effect. Retry clears error only when that
  // effect starts. Successful null and invalid files are different outcomes.
  action beginRead(id: int): bool = all { s.mounted, s.loadScheduled,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("loadScheduled", false).with("error", false)
      .with("renderedExpired", s.nowExpired)
      .with("requests", s.requests.set(id, empty.with("life", s.life).with("phase", "http"))) }
  action headers(id: int, ok: bool): bool = all { s.requests.get(id).phase == "http",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", if (ok) "body" else "decoded")
      .with("outcome", if (ok) "none" else "http-error"))) }
  action body(id: int, outcome: str, recipients: int, transfers: int, closed: bool): bool = all {
    s.requests.get(id).phase == "body", Set("valid", "absent", "invalid").contains(outcome),
    masks.contains(recipients), masks.contains(transfers), subset(transfers, recipients),
    s' = s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", "decoded").with("outcome", outcome)
      .with("recipients", recipients).with("transfers", transfers).with("closed", closed))) }
  // Includes timeout, transport/redirect rejection and bounded body-read errors.
  action requestFails(id: int): bool = all { Set("http", "body").contains(s.requests.get(id).phase),
    s' = s.with("requests", s.requests.set(id,
      s.requests.get(id).with("phase", "decoded").with("outcome", "request-error"))) }
  action publish(id: int): bool = {
    val request = s.requests.get(id)
    val finished = s.with("requests", s.requests.set(id, request.with("phase", "done")))
    all { request.phase == "decoded",
      s' = if (not(owns(id))) finished
        else if (not(Set("valid", "absent").contains(request.outcome)))
          finished.with("active", 0).with("error", true).with("renderedExpired", s.nowExpired)
        else finished.with("active", 0).with("error", false)
          .with("document", if (request.outcome == "valid") "published" else "none")
          .with("recipients", if (request.outcome == "valid") request.recipients else 0)
          .with("transfers", if (request.outcome == "valid") request.transfers else 0)
          .with("closed", request.closed).with("publishedBy", id).with("publishedLife", s.life)
          .with("renderedExpired", s.nowExpired).with("boundaryInstalled", false).with("boundaryArmed", false) }
  }
  action retry = all { s.mounted, s.error, not(s.loadScheduled),
    s' = s.with("loadScheduled", true) }
  // Props, not the file request's captured actor, choose the row on each render.
  action accountChanges(actor: int): bool = all { s.mounted, actors.contains(actor),
    s' = s.with("actor", actor).with("renderedExpired", s.nowExpired) }
  action walletsChange(actor: int, first: str, second: str): bool = all {
    s.mounted, ids.contains(actor), walletClasses.contains(first), walletClasses.contains(second),
    s' = s.with("wallets", s.wallets.set(actor, Set(first, second)))
      .with("renderedExpired", s.nowExpired) }
  // The exact cutoff is already expired. A matching current authorized wallet
  // qualifies only when firstAuthorizedAt is strictly before that cutoff.
  action deadline = all { not(s.nowExpired), s' = s.with("nowExpired", true) }
  action installBoundary = all { s.mounted, s.document == "published", not(s.boundaryInstalled),
    s' = s.with("boundaryInstalled", true).with("boundaryArmed", not(s.nowExpired))
      .with("renderedExpired", s.nowExpired) }
  action fireBoundary = all { s.mounted, s.boundaryArmed, s.nowExpired,
    s' = s.with("boundaryArmed", false).with("renderedExpired", true) }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0).with("boundaryArmed", false) }
  action remount(actor: int): bool = all { not(s.mounted), s.life == 1, actors.contains(actor),
    s' = s.with("mounted", true).with("life", 2).with("actor", actor)
      .with("loadScheduled", true).with("document", "loading").with("error", false)
      .with("recipients", 0).with("transfers", 0).with("closed", false)
      .with("publishedBy", 0).with("publishedLife", 0)
      .with("renderedExpired", s.nowExpired).with("boundaryInstalled", false) }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = actors.oneOf()
    nondet recipients = masks.oneOf()
    nondet transfers = masks.oneOf()
    nondet first = walletClasses.oneOf()
    nondet second = walletClasses.oneOf()
    nondet outcome = Set("valid", "absent", "invalid").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { beginRead(id), headers(id, yes), body(id, outcome, recipients, transfers, yes),
      requestFails(id), publish(id), retry, accountChanges(actor), walletsChange(id, first, second),
      deadline, installBoundary, fireBoundary, depart, remount(actor), s' = s }
  }
  val invariant = all { s.life >= 1, s.life <= 2, actors.contains(s.actor),
    masks.contains(s.recipients), masks.contains(s.transfers), subset(s.transfers, s.recipients),
    rowActor > 0 implies rowActor == s.actor and displayedAmount == s.actor,
    state == "sent" iff hasRow and maskContains(s.transfers, s.actor),
    state == "scheduled" implies hasRow and eligibleWallet and not(s.closed),
    transferLink implies not(registrationLink),
    s.document == "published" implies s.publishedLife == s.life and s.publishedBy > 0,
    not(s.mounted) implies state == "hidden" }
  action loadPublished(id: int, recipients: int, transfers: int, closed: bool): bool =
    beginRead(id).then(headers(id, true)).then(body(id, "valid", recipients, transfers, closed)).then(publish(id))
  action ready = init.then(loadPublished(1, 1, 0, false))

  // Retain the original five disposition scenarios with explicit file reads.
  run deadlineTest = ready.then(installBoundary).then(deadline).then(fireBoundary)
    .expect(state == "unclaimed" and not(registrationLink))
  run lateWalletTest = ready.then(deadline).then(walletsChange(1, "late", "none"))
    .expect(state == "unclaimed")
  run onTimeWalletTest = ready.then(walletsChange(1, "on-time", "none")).then(deadline)
    .then(walletsChange(1, "on-time", "none")).expect(state == "scheduled")
  run noRecipientTest = init.then(loadPublished(1, 2, 0, false)).expect(state == "hidden")
  run sentTest = init.then(loadPublished(1, 1, 1, true)).expect(state == "sent" and transferLink)
  run initialReadIsHiddenTest = init.then(beginRead(1)).expect(state == "hidden")
  run validNullFileIsHiddenTest = init.then(beginRead(1)).then(headers(1, true))
    .then(body(1, "absent", 0, 0, false)).then(publish(1)).expect(state == "hidden" and not(s.error))
  run invalidFileIsErrorTest = init.then(beginRead(1)).then(headers(1, true))
    .then(body(1, "invalid", 0, 0, false)).then(publish(1)).expect(state == "error")
  run httpFailureIsErrorTest = init.then(beginRead(1)).then(headers(1, false)).then(publish(1))
    .expect(state == "error")
  run bodyTimeoutIsErrorTest = init.then(beginRead(1)).then(headers(1, true)).then(requestFails(1)).then(publish(1))
    .expect(state == "error")
  run retryRetainsErrorUntilEffectTest = init.then(beginRead(1)).then(requestFails(1)).then(publish(1)).then(retry)
    .expect(state == "error").then(beginRead(2)).expect(state == "hidden" and not(s.error))
  run retryCanLoadPublishedRowTest = init.then(beginRead(1)).then(requestFails(1)).then(publish(1)).then(retry)
    .then(loadPublished(2, 1, 0, false)).expect(state == "awaiting-wallet")
  run actorChangesDuringReadSelectCurrentRowTest = init.then(beginRead(1)).then(headers(1, true))
    .then(body(1, "valid", 3, 0, false)).then(accountChanges(2)).then(publish(1))
    .expect(rowActor == 2 and displayedAmount == 2)
  run actorChangesAfterReadSelectCurrentRowTest = init.then(loadPublished(1, 3, 1, false)).then(accountChanges(2))
    .expect(rowActor == 2 and state == "awaiting-wallet" and not(transferLink))
  run otherAccountsTransferNeverAppearsTest = init.then(loadPublished(1, 3, 2, false))
    .expect(rowActor == 1 and state == "awaiting-wallet" and not(transferLink))
  run wrongChainCannotScheduleTest = ready.then(walletsChange(1, "wrong-chain", "none"))
    .expect(state == "awaiting-wallet")
  run unauthorizedWalletCannotScheduleTest = ready.then(walletsChange(1, "unauthorized", "none"))
    .expect(state == "awaiting-wallet")
  run exactCutoffRegistrationIsLateTest = ready.then(deadline).then(walletsChange(1, "at-deadline", "none"))
    .expect(state == "unclaimed")
  run missingRegistrationTimeCannotScheduleTest = ready.then(deadline).then(walletsChange(1, "unknown-time", "none"))
    .expect(state == "unclaimed")
  run oneEligibleWalletAmongOthersSchedulesTest = ready.then(walletsChange(1, "wrong-chain", "on-time"))
    .expect(state == "scheduled")
  run revokedWalletStopsSchedulingTest = ready.then(walletsChange(1, "on-time", "none"))
    .then(deadline).then(walletsChange(1, "unauthorized", "none")).expect(state == "unclaimed")
  run closedFileOverridesOnTimeWalletTest = init.then(walletsChange(1, "on-time", "none"))
    .then(loadPublished(1, 1, 0, true)).expect(state == "unclaimed" and not(transferLink))
  run transferOverridesMissingWalletAndDeadlineTest = init.then(deadline).then(loadPublished(1, 1, 1, false))
    .expect(state == "sent" and transferLink and not(registrationLink))
  run delayedTimerInstallationRefreshesDeadlineTest = ready.then(deadline).then(installBoundary)
    .expect(state == "unclaimed" and not(s.boundaryArmed))
  run deadlineNeedsRenderObservationTest = ready.then(installBoundary).then(deadline)
    .expect(state == "awaiting-wallet").then(fireBoundary).expect(state == "unclaimed")
  run oldBodyCannotPublishIntoRemountTest = init.then(beginRead(1)).then(headers(1, true))
    .then(depart).then(remount(2)).then(loadPublished(2, 2, 0, false))
    .then(body(1, "valid", 1, 1, true)).then(publish(1))
    .expect(rowActor == 2 and s.recipients == 2 and state == "awaiting-wallet")
  run oldFailureCannotReplaceNewRowTest = init.then(beginRead(1)).then(depart).then(remount(2))
    .then(loadPublished(2, 2, 0, false)).then(requestFails(1)).then(publish(1))
    .expect(rowActor == 2 and not(s.error))
  run remountObservesNewSenderPublicationTest = ready.then(depart).then(remount(1))
    .then(loadPublished(2, 1, 1, true)).expect(state == "sent" and transferLink)
}
