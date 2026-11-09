// @source scripts/source-correction.ts
// @source src/lib/contribution-quality.ts
// @source src/lib/funding-review-data.ts
// @source src/lib/leaderboard.ts
// @evidence scripts/quality-payment-ledger.test.ts
// Historical preview only. source_correction_cli separately models the CLI.
// Two actors, two recovered events, two proposals, three raw events, two
// digest identities and a four-unit pool. Payment-review basis excludes raw
// event 3, but both bases participate in duplicate detection. Times 1 <= t < 3
// represent the preparation period; repository 1 and actor/login pairs (1,1),
// (2,2) are frozen. Sixteen parser/provenance predicates remain delegated.
// Full schema, normalized archive equality, canonical review URL, hashes and
// collection authenticity are supplied checks, not implied by file existence.
// Two positive review weights project integer largest remainder; actor 1 wins
// a tie. General helper arithmetic/grammar is not re-proved. Decisions must
// validate against original evidence before applying to corrected evidence;
// newly recovered events remain unratified. No history, approval or active
// preparation is written. All new scenarios are source-only and unexecuted.
module source_correction_preview {
  val actors = Set(1, 2)
  val rowSlots = Set(1, 2)
  val faults = Set("request", "digests", "reason", "selection", "preparation", "cycle",
    "snapshot-digests", "snapshots", "project", "provenance", "quality", "quality-ids",
    "baseline", "history", "monthly", "binding-read")
  type Event = { id: int, source: int, url: int, actor: int, login: int,
    repository: int, occurredAt: int, historyCount: int, archiveCount: int,
    archiveDigest: int, reviewedUrl: bool, normalizedEqual: bool,
    review: bool, reviewSource: bool, thirds: int, points: int, bonus: int }
  type Proposal = { envelope: bool, snapshot: int, quality: int, cap: int, paymentAuthorized: bool, decisionsValid: bool,
    recoveredDecision: bool, burdensValid: bool, reviewBaseline: bool, burden: bool }
  type State = { phase: str, bad: Set[str], paymentBasis: bool, storedCount: int,
    recoveredCount: int, proposalCount: int, cursor: int, proposalCursor: int,
    events: int -> Event, proposals: int -> Proposal, usedIds: Set[int],
    usedSources: Set[int], usedUrls: Set[int], accepted: Set[int], acceptedOrder: List[int],
    weightA: int, weightB: int, beforeA: int, beforeB: int, afterA: int, afterB: int,
    previews: Set[int], previewA: int -> int, previewB: int -> int, retained: int -> int,
    unresolved: int -> int, correctionBound: bool, qualityBound: bool, returned: bool,
    historyChanged: bool, activeChanged: bool, paymentAuthorized: bool, approved: bool, error: str }
  var s: State
  val baseEvent: Event = { id: 4, source: 4, url: 4, actor: 1, login: 1, repository: 1,
    occurredAt: 1, historyCount: 1, archiveCount: 1, archiveDigest: 1,
    reviewedUrl: true, normalizedEqual: true, review: true, reviewSource: true,
    thirds: 3, points: 1, bonus: 0 }
  val otherEvent: Event = baseEvent.with("id", 5).with("source", 5).with("url", 5).with("actor", 2).with("login", 2)
  val baseProposal: Proposal = { envelope: true, snapshot: 1, quality: 1, cap: 4, paymentAuthorized: false, decisionsValid: true,
    recoveredDecision: false, burdensValid: true, reviewBaseline: false, burden: false }
  val initial: State = { phase: "input", bad: Set(), paymentBasis: true, storedCount: 2,
    recoveredCount: 1, proposalCount: 0, cursor: 1, proposalCursor: 1,
    events: Map(1 -> baseEvent, 2 -> otherEvent), proposals: Map(1 -> baseProposal, 2 -> baseProposal),
    usedIds: Set(1, 2, 3), usedSources: Set(1, 2, 3), usedUrls: Set(1, 2, 3),
    accepted: Set(), acceptedOrder: List(), weightA: 3, weightB: 3,
    beforeA: 0, beforeB: 0, afterA: 0, afterB: 0, previews: Set(),
    previewA: Map(1 -> 0, 2 -> 0), previewB: Map(1 -> 0, 2 -> 0),
    retained: Map(1 -> 0, 2 -> 0), unresolved: Map(1 -> 0, 2 -> 0),
    correctionBound: false, qualityBound: false, returned: false,
    historyChanged: false, activeChanged: false, paymentAuthorized: false, approved: false, error: "none" }
  action init = s' = initial
  def current: Event = s.events.get(if (rowSlots.contains(s.cursor)) s.cursor else 1)
  def currentProposal: Proposal = s.proposals.get(if (rowSlots.contains(s.proposalCursor)) s.proposalCursor else 1)
  def baselineCount: int = if (s.paymentBasis) 2 else 3
  def baselineB: int = if (s.paymentBasis) 3 else 6
  pure def amountA(a: int, b: int): int = {
    val floorA = 4 * a / (a + b)
    val floorB = 4 * b / (a + b)
    floorA + if (floorA + floorB < 4 and 4 * a % (a + b) >= 4 * b % (a + b)) 1 else 0
  }
  def abort(reason: str): State = s.with("phase", "done").with("error", reason).with("returned", false)
  action fault(kind: str): bool = all { s.phase == "input", faults.contains(kind),
    s' = s.with("bad", Set(kind)) }
  action input(paymentBasis: bool, storedCount: int, recoveredCount: int, proposalCount: int): bool = all {
    s.phase == "input", 0.to(3).contains(storedCount), rowSlots.contains(recoveredCount), 0.to(2).contains(proposalCount),
    s' = s.with("paymentBasis", paymentBasis).with("storedCount", storedCount)
      .with("recoveredCount", recoveredCount).with("proposalCount", proposalCount)
      .with("weightB", if (paymentBasis) 3 else 6) }
  action event(index: int, value: Event): bool = all { s.phase == "input", rowSlots.contains(index),
    1.to(5).contains(value.id), 1.to(5).contains(value.source), 1.to(5).contains(value.url),
    1.to(3).contains(value.actor), 1.to(3).contains(value.login), Set(1, 2).contains(value.repository),
    0.to(3).contains(value.occurredAt), 0.to(2).contains(value.historyCount), 0.to(2).contains(value.archiveCount),
    Set(1, 2).contains(value.archiveDigest), 0.to(4).contains(value.thirds), 0.to(2).contains(value.points),
    Set(0, 1).contains(value.bonus), s' = s.with("events", s.events.set(index, value)) }
  action qualityProposal(index: int, value: Proposal): bool = all { s.phase == "input", rowSlots.contains(index),
    Set(1, 2).contains(value.snapshot), Set(1, 2).contains(value.quality), Set(3, 4).contains(value.cap),
    s' = s.with("proposals", s.proposals.set(index, value)) }
  action begin = all { s.phase == "input", s' = s.with("phase", "request") }
  action request = all { s.phase == "request", s' =
    if (s.bad.contains("request")) abort("request")
    else if (s.bad.contains("digests")) abort("digests")
    else if (s.bad.contains("reason")) abort("reason")
    else if (s.bad.contains("selection") or (s.recoveredCount == 2 and s.events.get(1).id == s.events.get(2).id)) abort("selection")
    else s.with("phase", "preparation") }
  action preparation = all { s.phase == "preparation", s' =
    if (s.bad.contains("preparation")) abort("preparation")
    else if (s.bad.contains("cycle")) abort("cycle")
    else if (s.bad.contains("snapshot-digests")) abort("snapshot-digests")
    else s.with("phase", "snapshots") }
  action snapshots = all { s.phase == "snapshots", s' =
    if (s.bad.contains("snapshots")) abort("snapshots")
    else if (s.bad.contains("project")) abort("project") else s.with("phase", "provenance") }
  action provenance = all { s.phase == "provenance", s' =
    if (s.bad.contains("provenance") or s.storedCount != baselineCount) abort("provenance") else s.with("phase", "quality") }
  action quality = all { s.phase == "quality", s' =
    if (s.bad.contains("quality")) abort("quality") else s.with("phase", "quality-ids") }
  action qualityIds = all { s.phase == "quality-ids", s' =
    if (s.bad.contains("quality-ids")) abort("quality-ids") else s.with("phase", "baseline") }
  action baseline = all { s.phase == "baseline", s' =
    if (s.bad.contains("baseline")) abort("baseline") else s.with("phase", "history") }
  action history = all { s.phase == "history", s' =
    if (s.bad.contains("history")) abort("history") else s.with("phase", "recover") }
  action recover = all { s.phase == "recover", s' =
    if (s.cursor > s.recoveredCount) s.with("phase", "allocation")
    else if (current.historyCount != 1 or current.archiveCount != 1) abort("multiplicity")
    else if (current.archiveDigest != 1 or not(current.reviewedUrl)) abort("continuity")
    else if (not(current.normalizedEqual)) abort("archive-changed")
    else if (not(current.review) or not(current.reviewSource) or current.thirds != 3 or current.points != 1
      or current.bonus != 0 or current.repository != 1 or current.occurredAt < 1 or current.occurredAt >= 3) abort("review-period")
    else if (not(actors.contains(current.actor)) or current.login != current.actor) abort("actor")
    else if (s.usedIds.contains(current.id) or s.usedSources.contains(current.source) or s.usedUrls.contains(current.url)) abort("duplicate")
    else s.with("cursor", s.cursor + 1).with("usedIds", s.usedIds.union(Set(current.id)))
      .with("usedSources", s.usedSources.union(Set(current.source))).with("usedUrls", s.usedUrls.union(Set(current.url)))
      .with("accepted", s.accepted.union(Set(current.id))).with("acceptedOrder", s.acceptedOrder.append(current.id))
      .with("weightA", s.weightA + if (current.actor == 1) 3 else 0)
      .with("weightB", s.weightB + if (current.actor == 2) 3 else 0) }
  action allocation = all { s.phase == "allocation", s' =
    if (s.bad.contains("monthly")) abort("monthly")
    else s.with("phase", "quality-binding").with("correctionBound", true)
      .with("beforeA", amountA(3, baselineB)).with("beforeB", 4 - amountA(3, baselineB))
      .with("afterA", amountA(s.weightA, s.weightB)).with("afterB", 4 - amountA(s.weightA, s.weightB)) }
  action qualityBinding = all { s.phase == "quality-binding", s' =
    if (s.bad.contains("binding-read")) abort("binding-read") else s.with("phase", "proposals").with("qualityBound", true) }
  action inspectProposal = {
    val item = currentProposal
    val weightA = s.weightA - if (item.reviewBaseline) 2 else 0
    val amount = amountA(weightA, s.weightB)
    val deduction = if (item.burden) (4 - amount) / 2 else 0
    all { s.phase == "proposals", s' =
      if (s.proposalCursor > s.proposalCount) s.with("phase", "reconcile")
      else if (not(item.envelope) or item.snapshot != 1 or item.quality != 1 or item.cap != 4 or item.paymentAuthorized) abort("proposal-binding")
      else if (not(item.decisionsValid) or item.recoveredDecision or not(item.burdensValid)) abort("proposal-original")
      else s.with("proposalCursor", s.proposalCursor + 1).with("previews", s.previews.union(Set(s.proposalCursor)))
        .with("previewA", s.previewA.set(s.proposalCursor, amount))
        .with("previewB", s.previewB.set(s.proposalCursor, 4 - amount - deduction))
        .with("retained", s.retained.set(s.proposalCursor, deduction))
        .with("unresolved", s.unresolved.set(s.proposalCursor, baselineCount + s.recoveredCount - if (item.reviewBaseline) 1 else 0)) }
  }
  action reconcile = all { s.phase == "reconcile", s.afterA + s.afterB == 4,
    (s.afterA - s.beforeA) + (s.afterB - s.beforeB) == 0, s' = s.with("phase", "done").with("returned", true) }
  // acceptedOrder is the loop's staging order; source sorts recovered IDs
  // before building the preview/hash. That serialization order is abstracted.
  // Complete representative inputs keep the default graph finite without a
  // Cartesian product of unrelated invalid grammar fields. Named runs below
  // additionally isolate each refusal and a partially accumulated failure.
  action profile(kind: int): bool = {
    val changed = if (kind == 1) baseEvent.with("historyCount", 2)
      else if (kind == 2) baseEvent.with("archiveCount", 0)
      else if (kind == 3) baseEvent.with("archiveDigest", 2)
      else if (kind == 4) baseEvent.with("reviewedUrl", false)
      else if (kind == 5) baseEvent.with("normalizedEqual", false)
      else if (kind == 6) baseEvent.with("reviewSource", false)
      else if (kind == 7) baseEvent.with("thirds", 4)
      else if (kind == 8) baseEvent.with("bonus", 1)
      else if (kind == 9) baseEvent.with("repository", 2)
      else if (kind == 10) baseEvent.with("occurredAt", 0)
      else if (kind == 11) baseEvent.with("occurredAt", 3)
      else if (kind == 12) baseEvent.with("actor", 3)
      else if (kind == 13) baseEvent.with("login", 2)
      else if (kind == 14) baseEvent.with("id", 3)
      else if (kind == 15) baseEvent.with("source", 2)
      else if (kind == 16) baseEvent.with("url", 1) else baseEvent
    val modifiedProposal = if (kind == 20) baseProposal.with("snapshot", 2)
      else if (kind == 21) baseProposal.with("paymentAuthorized", true)
      else if (kind == 22) baseProposal.with("recoveredDecision", true)
      else if (kind == 23) baseProposal.with("burdensValid", false)
      else if (kind == 27) baseProposal.with("quality", 2)
      else if (kind == 28) baseProposal.with("cap", 3)
      else baseProposal.with("reviewBaseline", true)
    val selected = initial.with("events", initial.events.set(1, changed))
    val complete = if ((kind >= 17 and kind <= 24) or kind >= 27) selected.with("recoveredCount", 2).with("proposalCount", 2)
        .with("events", selected.events.set(2, if (kind == 17) otherEvent.with("source", 4) else otherEvent))
        .with("proposals", selected.proposals.set(1, modifiedProposal).set(2, baseProposal.with("burden", true)))
      else if (kind == 25) selected.with("paymentBasis", false).with("storedCount", 3).with("weightB", 6)
      else if (kind == 26) selected.with("storedCount", 3) else selected
    all { s.phase == "input", 0.to(28).contains(kind), s' = complete }
  }
  action step = {
    nondet issue = faults.oneOf() nondet kind = 0.to(28).oneOf()
    any { fault(issue), profile(kind), begin, request, preparation, snapshots, provenance, quality, qualityIds,
      baseline, history, recover, allocation, qualityBinding, inspectProposal, reconcile, s' = s }
  }
  val invariant = all { s.cursor <= 3, s.proposalCursor <= 3,
    not(s.historyChanged), not(s.activeChanged), not(s.paymentAuthorized), not(s.approved),
    s.accepted.intersect(Set(1, 2, 3)) == Set(), s.accepted.size() <= s.recoveredCount,
    s.error != "none" implies not(s.returned),
    s.returned implies s.correctionBound and s.qualityBound and s.accepted.size() == s.recoveredCount
      and s.previews.size() == s.proposalCount and s.afterA + s.afterB == 4
      and (s.afterA - s.beforeA) + (s.afterB - s.beforeB) == 0,
    s.previews.forall(index => s.previewA.get(index) + s.previewB.get(index) + s.retained.get(index) == 4
      and s.unresolved.get(index) >= s.recoveredCount),
    s.accepted.forall(id => rowSlots.exists(index => {
      val item = s.events.get(index)
      item.id == id and item.historyCount == 1 and item.archiveCount == 1 and item.archiveDigest == 1
        and item.reviewedUrl and item.normalizedEqual and item.review and item.reviewSource
        and item.thirds == 3 and item.points == 1 and item.bonus == 0 and item.repository == 1
        and item.occurredAt >= 1 and item.occurredAt < 3 and actors.contains(item.actor) and item.login == item.actor
    })) }
  action toRequest = begin.then(request)
  action toProvenance = toRequest.then(preparation).then(snapshots)
  action toQuality = toProvenance.then(provenance)
  action toBaseline = toQuality.then(quality).then(qualityIds)
  action toRecover = toBaseline.then(baseline).then(history)
  action finishOne = toRecover.then(recover).then(recover).then(allocation).then(qualityBinding).then(inspectProposal).then(reconcile)
  action finishTwo = toRecover.then(recover).then(recover).then(recover).then(allocation).then(qualityBinding)
  run previewOnlyTest = init.then(finishOne).expect(s.returned and s.afterA == 3 and s.afterB == 1 and invariant)
  run duplicateSourceRefusedTest = init.then(event(1, baseEvent.with("source", 2))).then(toRecover).then(recover)
    .expect(s.error == "duplicate" and invariant)
  run malformedRequestRefusedTest = init.then(fault("request")).then(toRequest).expect(s.error == "request" and invariant)
  run predecessorArchiveHistoryDigestMismatchRefusedTest = init.then(fault("digests")).then(toRequest).expect(s.error == "digests" and invariant)
  run missingReasonRefusedTest = init.then(fault("reason")).then(toRequest).expect(s.error == "reason" and invariant)
  run duplicateSelectedIdsRefusedTest = init.then(input(true, 2, 2, 0)).then(event(2, otherEvent.with("id", 4))).then(toRequest)
    .expect(s.error == "selection" and invariant)
  run differentCycleRefusedTest = init.then(fault("cycle")).then(toRequest).then(preparation).expect(s.error == "cycle" and invariant)
  run originalSnapshotAuditMismatchRefusedTest = init.then(fault("snapshot-digests")).then(toRequest).then(preparation)
    .expect(s.error == "snapshot-digests" and invariant)
  run paymentBasisCountIsUsedTest = init.then(finishOne).expect(s.storedCount == 2 and s.returned and invariant)
  run rawCountCannotReplacePaymentBasisCountTest = init.then(input(true, 3, 1, 0)).then(toQuality)
    .expect(s.error == "provenance" and invariant)
  run historicalRawLedgerRemainsSupportedTest = init.then(input(false, 3, 1, 0)).then(finishOne)
    .expect(s.returned and s.beforeA + s.beforeB == 4 and invariant)
  run qualityIdentityHashRefusesTest = init.then(fault("quality-ids")).then(toBaseline).expect(s.error == "quality-ids" and invariant)
  run qualityMetadataMustMatchOriginalLedgerTest = init.then(fault("baseline")).then(toBaseline).then(baseline)
    .expect(s.error == "baseline" and invariant)
  run repeatedHistoryEventRefusedTest = init.then(event(1, baseEvent.with("historyCount", 2))).then(toRecover).then(recover)
    .expect(s.error == "multiplicity" and invariant)
  run missingArchiveEventRefusedTest = init.then(event(1, baseEvent.with("archiveCount", 0))).then(toRecover).then(recover)
    .expect(s.error == "multiplicity" and invariant)
  run archiveContinuityDigestRefusedTest = init.then(event(1, baseEvent.with("archiveDigest", 2))).then(toRecover).then(recover)
    .expect(s.error == "continuity" and invariant)
  run unreviewedDecisionUrlRefusedTest = init.then(event(1, baseEvent.with("reviewedUrl", false))).then(toRecover).then(recover)
    .expect(s.error == "continuity" and invariant)
  run changedArchiveFieldsRefusedTest = init.then(event(1, baseEvent.with("normalizedEqual", false))).then(toRecover).then(recover)
    .expect(s.error == "archive-changed" and invariant)
  run nonReviewSourceRefusedTest = init.then(event(1, baseEvent.with("reviewSource", false))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run nonBaseCreditRefusedTest = init.then(event(1, baseEvent.with("thirds", 4))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run evidenceBonusCannotBeRecoveredTest = init.then(event(1, baseEvent.with("bonus", 1))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run otherRepositoryRefusedTest = init.then(event(1, baseEvent.with("repository", 2))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run beforePeriodRefusedTest = init.then(event(1, baseEvent.with("occurredAt", 0))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run exclusivePeriodEndRefusedTest = init.then(event(1, baseEvent.with("occurredAt", 3))).then(toRecover).then(recover)
    .expect(s.error == "review-period" and invariant)
  run unknownActorRefusedTest = init.then(event(1, baseEvent.with("actor", 3))).then(toRecover).then(recover)
    .expect(s.error == "actor" and invariant)
  run changedActorLoginRefusedTest = init.then(event(1, baseEvent.with("login", 2))).then(toRecover).then(recover)
    .expect(s.error == "actor" and invariant)
  run rawOnlyCreditedEventStillRefusedTest = init.then(event(1, baseEvent.with("id", 3))).then(toRecover).then(recover)
    .expect(s.error == "duplicate" and invariant)
  run duplicateUrlRefusedTest = init.then(event(1, baseEvent.with("url", 1))).then(toRecover).then(recover)
    .expect(s.error == "duplicate" and invariant)
  run withinBatchSourceCollisionRefusesEntirePreviewTest = init.then(input(true, 2, 2, 0))
    .then(event(2, otherEvent.with("source", 4))).then(toRecover).then(recover).then(recover)
    .expect(s.accepted == Set(4) and not(s.returned) and s.error == "duplicate" and invariant)
  run twoRecoveredActorsPreservePoolTest = init.then(input(true, 2, 2, 0)).then(finishTwo).then(inspectProposal).then(reconcile)
    .expect(s.returned and s.afterA == 2 and s.afterB == 2 and invariant)
  run nonMonthlyPreparationRefusedTest = init.then(fault("monthly")).then(toRecover).then(recover).then(recover).then(allocation)
    .expect(s.error == "monthly" and invariant)
  run sourceBoundProposalRecalculatesWithoutRatifyingNewCreditTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("reviewBaseline", true))).then(finishTwo)
    .then(inspectProposal).then(inspectProposal).then(reconcile)
    .expect(s.returned and s.unresolved.get(1) == 3 and s.previewA.get(1) + s.previewB.get(1) == 4 and invariant)
  run wrongProposalSourceOrBudgetRefusedTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("cap", 3))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-binding" and not(s.returned) and invariant)
  run wrongProposalSnapshotRefusedTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("snapshot", 2))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-binding" and invariant)
  run staleQualityPayloadBindingRefusedTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("quality", 2))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-binding" and invariant)
  run authorizedProposalCannotEnterPreviewTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("paymentAuthorized", true))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-binding" and invariant)
  run proposalCannotReviewOnlyRecoveredEventTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("recoveredDecision", true))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-original" and invariant)
  run invalidBurdenRefusedBeforeRebindingTest = init.then(input(true, 2, 2, 1))
    .then(qualityProposal(1, baseProposal.with("burdensValid", false))).then(finishTwo).then(inspectProposal)
    .expect(s.error == "proposal-original" and invariant)
  run twoIndependentProposalsKeepRetainedAmountsSeparateTest = init.then(input(true, 2, 2, 2))
    .then(qualityProposal(2, baseProposal.with("burden", true))).then(finishTwo)
    .then(inspectProposal).then(inspectProposal).then(inspectProposal).then(reconcile)
    .expect(s.returned and s.retained.get(1) == 0 and s.retained.get(2) == 1 and invariant)
  run lateBindingReadFailureReturnsNoPartialPreviewTest = init.then(fault("binding-read")).then(toRecover)
    .then(recover).then(recover).then(allocation).then(qualityBinding)
    .expect(s.accepted == Set(4) and s.error == "binding-read" and not(s.returned) and invariant)
}
