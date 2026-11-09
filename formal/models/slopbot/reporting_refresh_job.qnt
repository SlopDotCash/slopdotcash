// @source workers/slopbot/reporting-readiness.ts
// @source workers/slopbot/reporting-readiness-service.ts
// @source backend/security/reporting-readiness.ts
// @source src/lib/project-schema.mjs
// @evidence workers/slopbot/reporting-readiness.test.ts
// @evidence backend/security/reporting-readiness.workflow.mjs
// One named service call snapshots at most three registry rows in id order;
// at most two separately invoked calls share durable write observations.
// step chooses one of eight representative registry inputs once. Named traces
// can configure each bounded row directly; JSON grammar is not state space.
// The service does not coalesce calls or retry an interrupted loop. This model
// bounds calls sequentially; overlapping refreshes and the exact timestamp,
// identity-CAS and cached-answer rules belong to api_reporting_readiness.
//
// JSON/schema validity, the App reader and the child upsert's applied/no-op
// decision are supplied predicates. Valid schema already requires a registered
// intake selection and a matching GitHub URL. Selection below represents
// default/explicit primary, aliases and a secondary repository; only a primary
// target carries the registry's immutable repository-id pins. Revision validity
// is checked by reportingTarget after the retired skip, not by the manifest.
//
// Provider rejection is caught by refreshReportingObservation and becomes an
// unavailable observation. A D1 write or verified-result readback rejection
// escapes, aborting the suffix; an already committed observation survives.
// `writes` records observed write effects, not an append-only cache table or
// proof that a no-op upsert refreshed anything. Counts follow returned helper
// results, not storage changes. Verified-disabled is successful observation.
// The identity schedule's optional binding and allSettled join are covered by
// identity_scheduled_maintenance. A named RPC reply can be lost independently
// of the service result. These are authored traces, not executed evidence.
module reporting_refresh_job {
  val projects = Set(1, 2, 3)
  val shapes = Set("valid", "json-error", "schema-error")
  val selections = Set("default", "primary", "primary-alias", "secondary", "secondary-alias")
  val observations = Set("verified-enabled", "verified-disabled", "app-not-installed", "unavailable", "identity-mismatch")
  type Row = { shape: str, retired: bool, paused: bool, revision: int, selection: str, aliasPath: bool }
  type Target = { project: int, revision: int, slot: int, aliasPath: bool, pinned: bool }
  type Write = { invocation: int, target: Target, observation: str }
  val defaultRow: Row = { shape: "valid", retired: false, paused: false, revision: 1,
    selection: "default", aliasPath: false }
  val emptyTarget: Target = { project: 0, revision: 0, slot: 0, aliasPath: false, pinned: false }
  var s: { phase: str, invocation: int, inputChosen: bool, registry: int -> Row, captured: int -> Row,
    total: int, position: int, parsed: Set[int], skipped: Set[int], readers: Set[int],
    completed: Set[int], checked: int, failed: int, results: int -> str,
    target: Target, candidate: str, writes: Set[Write], attempted: Set[int],
    service: str, error: str, caller: str }
  action init = s' = { phase: "idle", invocation: 0, inputChosen: false,
    registry: projects.mapBy(_ => defaultRow), captured: projects.mapBy(_ => defaultRow),
    total: 0, position: 1, parsed: Set(), skipped: Set(), readers: Set(), completed: Set(),
    checked: 0, failed: 0, results: projects.mapBy(_ => "none"), target: emptyTarget,
    candidate: "none", writes: Set(), attempted: Set(), service: "none", error: "none", caller: "none" }
  pure def verified(observation: str): bool = Set("verified-enabled", "verified-disabled").contains(observation)
  pure def failureCounted(observation: str, paused: bool): bool =
    not(verified(observation)) and not(observation == "app-not-installed" and paused)
  pure def selectedSlot(selection: str): int =
    if (Set("secondary", "secondary-alias").contains(selection)) 2 else 1
  // Terminal position 4 is outside the captured row domain; disabled actions
  // still use a total lookup while finish handles that position.
  def currentRow: Row = s.captured.get(if (projects.contains(s.position)) s.position else 1)
  def abort(reason: str) = s.with("phase", "service-reply").with("service", "threw").with("error", reason)
  action configure(id: int, shape: str, retired: bool, paused: bool, revision: int, selection: str, aliasPath: bool): bool = all {
    s.phase == "idle", s.invocation == 0, projects.contains(id), shapes.contains(shape), selections.contains(selection),
    Set(0, 1, 2).contains(revision), shape != "valid" or not(retired) or paused,
    s' = s.with("registry", s.registry.set(id, { shape: shape, retired: retired, paused: paused,
      revision: revision, selection: selection, aliasPath: aliasPath })) }
  action reviseRegistry(id: int, retired: bool, paused: bool): bool = all {
    projects.contains(id), s.registry.get(id).revision == 1, not(retired) or paused,
    s' = s.with("registry", s.registry.set(id,
      s.registry.get(id).with("revision", 2).with("retired", retired).with("paused", paused))) }
  action begin = all { Set("idle", "done").contains(s.phase), s.invocation < 2,
    s' = s.with("phase", "list").with("invocation", s.invocation + 1)
      .with("total", 0).with("position", 1).with("parsed", Set()).with("skipped", Set())
      .with("readers", Set()).with("completed", Set()).with("checked", 0).with("failed", 0)
      .with("results", projects.mapBy(_ => "none")).with("target", emptyTarget).with("candidate", "none")
      .with("attempted", Set()).with("service", "pending").with("error", "none").with("caller", "pending") }
  // Successful all() resolves one captured list. No registry reread occurs in its loop.
  action listReply(total: int): bool = all { s.phase == "list", Set(0, 1, 2, 3).contains(total),
    s' = s.with("captured", s.registry).with("total", total).with("phase", "parse") }
  action listReject = all { s.phase == "list", s' = abort("registry-read") }
  action parse = {
    val row = currentRow
    all { s.phase == "parse", s.position <= s.total,
      s' = if (row.shape != "valid") abort(row.shape)
        else if (row.retired) s.with("parsed", s.parsed.union(Set(s.position)))
          .with("skipped", s.skipped.union(Set(s.position))).with("position", s.position + 1)
        else s.with("parsed", s.parsed.union(Set(s.position))).with("phase", "derive") }
  }
  action derive = {
    val row = currentRow
    val slot = selectedSlot(row.selection)
    all { s.phase == "derive",
      s' = if (row.revision < 1) abort("invalid-revision")
        else s.with("target", { project: s.position, revision: row.revision, slot: slot,
          aliasPath: row.aliasPath, pinned: slot == 1 }).with("phase", "provider") }
  }
  action providerReply(observation: str, identityMatches: bool): bool = all {
    s.phase == "provider", observations.contains(observation),
    s' = s.with("readers", s.readers.union(Set(s.position)))
      .with("candidate", if (verified(observation) and not(identityMatches)) "identity-mismatch" else observation)
      .with("phase", "write") }
  action providerReject = all { s.phase == "provider",
    s' = s.with("readers", s.readers.union(Set(s.position))).with("candidate", "unavailable").with("phase", "write") }
  // The child model determines whether its conditional upsert changed a row.
  action writeCommit(applied: bool): bool = all { s.phase == "write",
    s' = s.with("attempted", s.attempted.union(Set(s.position)))
      .with("writes", if (applied) s.writes.union(Set({ invocation: s.invocation, target: s.target, observation: s.candidate })) else s.writes)
      .with("phase", "write-reply") }
  action writeReject = all { s.phase == "write",
    s' = abort("write-error").with("attempted", s.attempted.union(Set(s.position))) }
  action writeReply(delivered: bool): bool = all { s.phase == "write-reply",
    s' = if (not(delivered)) abort("write-reply-lost")
      else s.with("phase", if (verified(s.candidate)) "readback" else "count") }
  action readback(matches: bool): bool = all { s.phase == "readback",
    s' = s.with("candidate", if (matches) s.candidate else "identity-mismatch").with("phase", "count") }
  action readbackReject = all { s.phase == "readback", s' = abort("readback-error") }
  action count = all { s.phase == "count",
    s' = s.with("completed", s.completed.union(Set(s.position))).with("checked", s.checked + 1)
      .with("failed", s.failed + (if (failureCounted(s.candidate, currentRow.paused)) 1 else 0))
      .with("results", s.results.set(s.position, s.candidate)).with("position", s.position + 1).with("phase", "parse") }
  action finish = all { s.phase == "parse", s.position > s.total,
    s' = s.with("phase", "service-reply").with("service", "returned") }
  action serviceReply(delivered: bool): bool = all { s.phase == "service-reply",
    s' = s.with("phase", "done").with("caller", if (not(delivered)) "unknown"
      else if (s.service == "threw") "error" else if (s.failed > 0) "failed-count" else "ok") }
  action interrupt = all { not(Set("idle", "done", "service-reply").contains(s.phase)),
    s' = s.with("phase", "done").with("service", "interrupted").with("caller", "unknown") }
  action chooseInput(kind: int): bool = {
    val rows = projects.mapBy(_ => defaultRow)
    val selected = if (kind == 2) rows.set(1, defaultRow.with("paused", true))
      else if (kind == 3) rows.set(2, defaultRow.with("paused", true))
        .set(3, defaultRow.with("retired", true).with("paused", true))
      else if (kind == 4) rows.set(2, defaultRow.with("shape", "json-error"))
      else if (kind == 5) rows.set(1, defaultRow.with("shape", "schema-error").with("retired", true).with("paused", true))
      else if (kind == 6) rows.set(1, defaultRow.with("revision", 0))
      else if (kind == 7) rows.set(1, defaultRow.with("selection", "secondary-alias").with("aliasPath", true))
      else if (kind == 8) rows.set(1, defaultRow.with("selection", "primary-alias").with("aliasPath", true))
      else rows
    all { s.phase == "idle", s.invocation == 0, not(s.inputChosen), kind >= 1, kind <= 8,
      s' = s.with("registry", selected).with("inputChosen", true) }
  }
  action chooseRevision = { nondet id = projects.oneOf() nondet retired = Set(false, true).oneOf()
    nondet paused = Set(false, true).oneOf() reviseRegistry(id, retired, paused) }
  action step = {
    nondet total = Set(0, 1, 2, 3).oneOf()
    nondet inputKind = Set(1, 2, 3, 4, 5, 6, 7, 8).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet observation = observations.oneOf()
    any { chooseInput(inputKind), chooseRevision, begin, listReply(total), listReject, parse, derive,
      providerReply(observation, yes), providerReject, writeCommit(yes), writeReject, writeReply(yes),
      readback(yes), readbackReject, count, finish, serviceReply(yes), interrupt, s' = s }
  }
  val invariant = all {
    s.invocation <= 2, s.checked == s.completed.size(), s.failed <= s.checked,
    s.position >= 1, s.position <= 4, s.completed.intersect(s.skipped) == Set(),
    s.completed.subseteq(s.readers), s.readers.subseteq(s.parsed), s.attempted.subseteq(s.readers),
    s.failed == s.completed.filter(id => failureCounted(s.results.get(id), s.captured.get(id).paused)).size(),
    s.readers.forall(id => not(s.captured.get(id).retired) and s.captured.get(id).shape == "valid"),
    s.writes.forall(write => write.invocation <= s.invocation and projects.contains(write.target.project)
      and Set(1, 2).contains(write.target.revision) and write.target.pinned == (write.target.slot == 1)),
    s.service == "returned" implies s.completed.size() + s.skipped.size() == s.total,
    s.caller == "ok" implies s.service == "returned" and s.failed == 0
  }
  action refresh(observation: str): bool = parse.then(derive).then(providerReply(observation, true))
    .then(writeCommit(true)).then(writeReply(true))
    .then(if (verified(observation)) readback(true) else s' = s).then(count)
  action one = begin.then(listReply(1))
  run emptyRegistryReturnsZeroCountsTest = init.then(begin).then(listReply(0)).then(finish).then(serviceReply(true))
    .expect(s.caller == "ok" and s.checked == 0 and s.writes == Set() and invariant)
  run activeAndPausedAreRefreshedBeforeRetiredSkipTest = init
    .then(configure(2, "valid", false, true, 1, "default", false))
    .then(configure(3, "valid", true, true, 1, "default", false))
    .then(begin).then(listReply(3)).then(refresh("verified-enabled")).then(refresh("verified-disabled"))
    .then(parse).then(finish).then(serviceReply(true))
    .expect(s.checked == 2 and s.failed == 0 and s.skipped == Set(3) and s.writes.size() == 2 and invariant)
  run pausedMissingAppIsRecordedWithoutFailureTest = init.then(configure(1, "valid", false, true, 1, "default", false))
    .then(one).then(refresh("app-not-installed")).then(finish).then(serviceReply(true))
    .expect(s.checked == 1 and s.failed == 0 and s.writes.size() == 1 and invariant)
  run activeMissingAppCountsFailureTest = init.then(one).then(refresh("app-not-installed")).then(finish).then(serviceReply(true))
    .expect(s.checked == 1 and s.failed == 1 and s.caller == "failed-count" and invariant)
  run pausedUnavailableStillCountsFailureTest = init.then(configure(1, "valid", false, true, 1, "default", false))
    .then(one).then(refresh("unavailable")).expect(s.failed == 1 and invariant)
  run providerThrowBecomesObservationAndContinuesTest = init.then(begin).then(listReply(2)).then(parse).then(derive)
    .then(providerReject).then(writeCommit(true)).then(writeReply(true)).then(count).then(refresh("verified-enabled"))
    .then(finish).then(serviceReply(true)).expect(s.checked == 2 and s.failed == 1 and s.caller == "failed-count" and invariant)
  run malformedLaterRowKeepsEarlierCommitAndAbortsSuffixTest = init.then(configure(2, "json-error", false, false, 1, "default", false))
    .then(begin).then(listReply(3)).then(refresh("verified-enabled")).then(parse).then(serviceReply(true))
    .expect(s.service == "threw" and s.checked == 1 and s.readers == Set(1) and s.writes.size() == 1 and invariant)
  run malformedRetiredRowIsNotSilentlySkippedTest = init.then(configure(1, "schema-error", true, true, 1, "default", false))
    .then(one).then(parse).expect(s.error == "schema-error" and s.skipped == Set() and invariant)
  run retiredRowSkipsInvalidRevisionBeforeTargetDerivationTest = init.then(configure(1, "valid", true, true, 0, "default", false))
    .then(one).then(parse).then(finish).then(serviceReply(true)).expect(s.caller == "ok" and s.readers == Set() and invariant)
  run invalidLiveRevisionAbortsBeforeProviderTest = init.then(configure(1, "valid", false, false, 0, "default", false))
    .then(one).then(parse).then(derive).expect(s.error == "invalid-revision" and s.readers == Set() and invariant)
  run primaryTargetCarriesImmutableIdentityPinsTest = init.then(one).then(parse).then(derive)
    .expect(s.target == { project: 1, revision: 1, slot: 1, aliasPath: false, pinned: true } and invariant)
  run secondaryBountySelectionDoesNotBorrowPrimaryPinsTest = init.then(configure(1, "valid", false, false, 1, "secondary-alias", true))
    .then(one).then(parse).then(derive).expect(s.target.slot == 2 and s.target.aliasPath and not(s.target.pinned) and invariant)
  run primaryAliasUsesSelectedGitHubUrlIdentityTest = init.then(configure(1, "valid", false, false, 1, "primary-alias", true))
    .then(one).then(parse).then(derive).expect(s.target.slot == 1 and s.target.aliasPath and s.target.pinned and invariant)
  run registryChangeDoesNotRewriteCapturedRowTest = init.then(configure(1, "valid", false, true, 1, "default", false))
    .then(one).then(reviseRegistry(1, false, false)).then(refresh("app-not-installed")).then(finish).then(serviceReply(true))
    .expect(s.failed == 0 and s.target.revision == 1 and s.registry.get(1).revision == 2 and invariant)
  run laterInvocationUsesNewRevisionAndStatusTest = init.then(configure(1, "valid", false, true, 1, "default", false))
    .then(one).then(refresh("app-not-installed")).then(finish).then(serviceReply(true))
    .then(reviseRegistry(1, false, false)).then(one).then(refresh("app-not-installed")).then(finish).then(serviceReply(true))
    .expect(s.failed == 1 and s.target.revision == 2 and s.writes.size() == 2 and invariant)
  run registryReadRejectionReturnsNoCountsTest = init.then(begin).then(listReject).then(serviceReply(true))
    .expect(s.service == "threw" and s.checked == 0 and s.caller == "error" and invariant)
  run definiteWriteFailureAbortsUnvisitedSuffixTest = init.then(begin).then(listReply(3)).then(parse).then(derive)
    .then(providerReply("unavailable", true)).then(writeReject).then(serviceReply(true))
    .expect(s.checked == 0 and s.readers == Set(1) and s.writes == Set() and invariant)
  run lostWriteReplyKeepsCommitWithoutCountTest = init.then(one).then(parse).then(derive)
    .then(providerReply("app-not-installed", true)).then(writeCommit(true)).then(writeReply(false)).then(serviceReply(true))
    .expect(s.service == "threw" and s.checked == 0 and s.writes.size() == 1 and invariant)
  run verifiedReadbackFailureKeepsWriteButAbortsCountTest = init.then(one).then(parse).then(derive)
    .then(providerReply("verified-enabled", true)).then(writeCommit(true)).then(writeReply(true)).then(readbackReject)
    .expect(s.error == "readback-error" and s.checked == 0 and s.writes.size() == 1 and invariant)
  run verifiedReadbackMismatchCountsFailureTest = init.then(one).then(parse).then(derive)
    .then(providerReply("verified-enabled", true)).then(writeCommit(false)).then(writeReply(true)).then(readback(false)).then(count)
    .expect(s.checked == 1 and s.failed == 1 and s.results.get(1) == "identity-mismatch" and invariant)
  run noOpUpsertCanStillReturnCheckedResultTest = init.then(one).then(parse).then(derive)
    .then(providerReply("verified-disabled", true)).then(writeCommit(false)).then(writeReply(true)).then(readback(true)).then(count)
    .expect(s.checked == 1 and s.failed == 0 and s.writes == Set() and invariant)
  run invalidVerifiedIdentityNormalizesBeforeWriteTest = init.then(one).then(parse).then(derive)
    .then(providerReply("verified-enabled", false)).then(writeCommit(true)).then(writeReply(true)).then(count)
    .expect(s.results.get(1) == "identity-mismatch" and s.failed == 1 and invariant)
  run interruptedPrefixCanBeRefreshedAgainTest = init.then(begin).then(listReply(3)).then(refresh("verified-enabled")).then(interrupt)
    .then(one).then(refresh("verified-enabled")).then(finish).then(serviceReply(true))
    .expect(s.invocation == 2 and s.checked == 1 and s.writes.size() == 2 and invariant)
  run lostServiceReplyDoesNotRollBackRefreshTest = init.then(one).then(refresh("verified-enabled")).then(finish).then(serviceReply(false))
    .expect(s.service == "returned" and s.caller == "unknown" and s.checked == 1 and s.writes.size() == 1 and invariant)
}
