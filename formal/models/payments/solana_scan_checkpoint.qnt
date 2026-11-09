// @source workers/payments/scanner.ts
// @source migrations/0012_solana_scan_backlog.sql
// @evidence workers/payments/solana-scanner.test.ts
// @evidence workers/payments/solana-progress.workflow.mjs
// Two callers, at most eight calls each, four original signatures and one later
// arrival. Symbolic discovery page/chunk size is two (source: 1000/100).
// Provider order/completeness and successful durable idempotent indexing are
// assumptions, not scanner guarantees. Discovery reverses each returned page;
// processing selects the largest page number. Failed signatures and unrelated
// instructions can advance without an index call. A transaction with two
// matching invocations can leave its first index durable when the second fails.
// Checkpoint batch atomicity is supplied by D1. A committed batch can lose its
// reply; neither caller-local state nor its returned failure undoes that batch.
// Generation/revision checks fence database mutation, not already admitted
// provider/index calls. Source-only scenarios; no execution claimed.
module solana_scan_checkpoint {
  type Worker = { phase: str, calls: int, generation: int, revision: int,
    page: int, signatures: List[int], offset: int, invoked: int,
    skipped: bool, reply: str }
  type State = { active: bool, generation: int, revision: int, cursor: int,
    nextPage: int, before: int, ready: bool, pages: int -> List[int],
    workers: int -> Worker, indexed: Set[int], completed: Set[int],
    skipped: Set[int], later: bool }
  var s: State
  val emptyWorker: Worker = { phase: "idle", calls: 0, generation: 0,
    revision: 0, page: 0, signatures: List(), offset: 0, invoked: 0,
    skipped: false, reply: "none" }
  val emptyPages = Map(0 -> List(), 1 -> List())
  pure def withWorker(state: State, who: int, local: Worker): State =
    state.with("workers", state.workers.set(who, local))
  def worker(who: int): Worker = s.workers.get(who)
  def currentSignature(who: int): int = {
    val local = worker(who)
    if (local.offset < local.signatures.length()) local.signatures.nth(local.offset) else 0
  }
  def owns(who: int): bool = s.active and worker(who).generation == s.generation
    and worker(who).revision == s.revision
  def pagesEmpty: bool = s.pages.get(0).length() == 0 and s.pages.get(1).length() == 0
  def observedPage: int = if (s.pages.get(1).length() > 0) 1 else 0
  action init = s' = { active: false, generation: 0, revision: 0, cursor: 0,
    nextPage: 0, before: 0, ready: false, pages: emptyPages,
    workers: Map(1 -> emptyWorker, 2 -> emptyWorker), indexed: Set(),
    completed: Set(), skipped: Set(), later: false }
  action start(who: int): bool = {
    val local = worker(who)
    val state = if (s.active) s else s.with("active", true)
      .with("generation", s.generation + 1).with("revision", 0)
      .with("nextPage", 0).with("before", 0).with("ready", false).with("pages", emptyPages)
    all { Set("idle", "done").contains(local.phase), local.calls < 8,
      s.active or (s.generation < 2 and (s.generation == 0 or s.later)),
      s' = withWorker(state, who, emptyWorker.with("phase", "read")
        .with("calls", local.calls + 1)) }
  }
  action readScan(who: int): bool = all { worker(who).phase == "read",
    s' = withWorker(s, who, worker(who).with("generation", s.generation)
      .with("revision", s.revision).with("page", s.nextPage)
      .with("phase", if (not(s.active)) "done" else if (s.ready) "page-read" else "discovery")) }
  action discover(who: int): bool = {
    val local = worker(who)
    val response = if (local.generation == 2) List(5)
      else if (local.page == 0) List(4, 3)
      else if (local.page == 1) List(2, 1) else List()
    all { local.phase == "discovery", s' = withWorker(s, who,
      local.with("signatures", response).with("phase", "discovery-write")) }
  }
  action discoveryWrite(who: int, delivered: bool): bool = {
    val local = worker(who)
    val response = local.signatures
    val reversed = if (response.length() == 2) List(response.nth(1), response.nth(0)) else response
    val updated = if (owns(who)) s.with("revision", s.revision + 1)
      .with("ready", response.length() < 2)
      .with("before", if (response.length() > 0) reversed.nth(0) else s.before)
      .with("nextPage", s.nextPage + if (response.length() > 0) 1 else 0)
      .with("pages", if (response.length() > 0) s.pages.set(local.page, reversed) else s.pages) else s
    all { local.phase == "discovery-write", s' = withWorker(updated, who,
      local.with("phase", "done").with("reply", if (delivered) "returned" else "lost")) }
  }
  action readPage(who: int): bool = all { worker(who).phase == "page-read",
    s' = withWorker(s, who, worker(who).with("page", observedPage)
      .with("signatures", if (worker(who).generation == s.generation and s.active) s.pages.get(observedPage) else List()).with("offset", 0)
      .with("phase", if (pagesEmpty or worker(who).generation != s.generation or not(s.active)) "close" else "transaction")) }
  action transaction(who: int, kind: str): bool = {
    val local = worker(who)
    all { local.phase == "transaction", Set("matching", "failed-signature", "other-project").contains(kind),
      s' = withWorker(s, who, local.with("invoked", 0).with("skipped", kind != "matching")
        .with("phase", if (kind == "matching") "index" else "checkpoint")) }
  }
  action callback(who: int, committed: bool, delivered: bool): bool = {
    val local = worker(who)
    val eventId = currentSignature(who) * 2 - 1 + local.invoked
    val updated = if (committed) s.with("indexed", s.indexed.union(Set(eventId))) else s
    all { local.phase == "index", not(delivered) or committed,
      s' = withWorker(updated, who, if (delivered) local.with("invoked", local.invoked + 1)
        .with("phase", if (local.invoked == 1) "checkpoint" else "index")
        else local.with("phase", "done").with("reply", "index-error")) }
  }
  action checkpoint(who: int, delivered: bool): bool = {
    val local = worker(who)
    val remaining = if (local.offset < local.signatures.length())
      local.signatures.slice(local.offset + 1, local.signatures.length()) else List()
    val updated = if (owns(who)) s.with("cursor", currentSignature(who))
      .with("revision", s.revision + 1).with("pages", s.pages.set(local.page, remaining))
      .with("completed", s.completed.union(Set(currentSignature(who))))
      .with("skipped", if (local.skipped) s.skipped.union(Set(currentSignature(who))) else s.skipped) else s
    val nextWorker = if (not(delivered)) local.with("phase", "done").with("reply", "lost")
      else if (not(owns(who))) local.with("phase", "done").with("reply", "stale")
      else local.with("revision", local.revision + 1).with("offset", local.offset + 1)
        .with("phase", if (local.offset + 1 == local.signatures.length() or local.offset + 1 == 2) "done" else "transaction")
        .with("reply", "returned")
    all { local.phase == "checkpoint", s' = withWorker(updated, who, nextWorker) }
  }
  action closeScan(who: int, delivered: bool): bool = all { worker(who).phase == "close",
    s' = withWorker(if (owns(who)) s.with("active", false) else s, who,
      worker(who).with("phase", "done").with("reply", if (delivered) "returned" else "lost")) }
  action failure(who: int): bool = all { not(Set("idle", "done").contains(worker(who).phase)),
    s' = withWorker(s, who, worker(who).with("phase", "done").with("reply", "error")) }
  action restart = s' = s.with("workers", Map(1 -> emptyWorker, 2 -> emptyWorker))
  action laterArrival = s' = s.with("later", true)
  action step = {
    nondet who = Set(1, 2).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet committed = Set(false, true).oneOf()
    nondet kind = Set("matching", "failed-signature", "other-project").oneOf()
    any { start(who), readScan(who), discover(who), discoveryWrite(who, yes),
      readPage(who), transaction(who, kind), callback(who, committed, yes),
      checkpoint(who, yes), closeScan(who, yes), failure(who), laterArrival, s' = s }
  }
  val invariant = all { s.generation <= 2, s.nextPage <= 2, s.cursor >= 0 and s.cursor <= 5,
    s.cursor > 0 implies 1.to(s.cursor).subseteq(s.completed),
    s.completed.forall(id => s.skipped.contains(id) or s.indexed.contains(id * 2 - 1) and s.indexed.contains(id * 2)),
    s.indexed.forall(id => id >= 1 and id <= 10),
    not(s.ready) implies s.pages.get(0).length() <= 2,
    Set(1, 2).forall(who => worker(who).invoked <= 2 and worker(who).offset <= 2) }
  action discoveryCall(who: int) = start(who).then(readScan(who)).then(discover(who)).then(discoveryWrite(who, true))
  action discoveryComplete = discoveryCall(1).then(discoveryCall(1)).then(discoveryCall(1))
  action capture(who: int) = start(who).then(readScan(who)).then(readPage(who))
  action matching(who: int) = transaction(who, "matching").then(callback(who, true, true)).then(callback(who, true, true))
  action commitItem(who: int) = matching(who).then(checkpoint(who, true))
  action processPage = capture(1).then(commitItem(1)).then(commitItem(1))
  run discoveryBeforeProcessingTest = init.then(discoveryCall(1))
    .expect(not(s.ready) and s.cursor == 0 and s.pages.get(0) == List(3, 4) and invariant)
  run fullPageNeedsLaterDiscoveryCallTest = init.then(discoveryCall(1)).then(discoveryCall(1))
    .expect(not(s.ready) and s.nextPage == 2 and s.before == 1 and invariant)
  run emptyDiscoveryMarksReadyWithoutExtraPageTest = init.then(discoveryComplete)
    .expect(s.ready and s.nextPage == 2 and s.revision == 3 and invariant)
  run oldestPageReadFirstTest = init.then(discoveryComplete).then(capture(1))
    .expect(worker(1).page == 1 and currentSignature(1) == 1 and invariant)
  run partialIndexSurvivesLaterCallbackFailureTest = init.then(discoveryComplete).then(capture(1))
    .then(transaction(1, "matching")).then(callback(1, true, true)).then(callback(1, false, false))
    .expect(s.cursor == 0 and s.indexed == Set(1) and s.pages.get(1) == List(1, 2) and invariant)
  run lostIndexReplyDoesNotAdvanceCursorTest = init.then(discoveryComplete).then(capture(1))
    .then(transaction(1, "matching")).then(callback(1, true, false))
    .expect(s.indexed == Set(1) and s.cursor == 0 and invariant)
  run retryRechecksWholeTransactionTest = init.then(discoveryComplete).then(capture(1))
    .then(transaction(1, "matching")).then(callback(1, true, false)).then(capture(1)).then(commitItem(1))
    .expect(s.cursor == 1 and s.indexed == Set(1, 2) and invariant)
  run failedSignatureAdvancesWithoutIndexTest = init.then(discoveryComplete).then(capture(1))
    .then(transaction(1, "failed-signature")).then(checkpoint(1, true))
    .expect(s.cursor == 1 and s.indexed == Set() and s.skipped == Set(1) and invariant)
  run unrelatedProjectAdvancesWithoutIndexTest = init.then(discoveryComplete).then(capture(1))
    .then(transaction(1, "other-project")).then(checkpoint(1, true))
    .expect(s.cursor == 1 and s.indexed == Set() and s.skipped == Set(1) and invariant)
  run unavailableTransactionRetainsPageTest = init.then(discoveryComplete).then(capture(1)).then(failure(1))
    .expect(s.cursor == 0 and s.pages.get(1) == List(1, 2) and invariant)
  run staleCheckpointCannotRewindTest = init.then(discoveryComplete).then(capture(1)).then(capture(2))
    .then(commitItem(1)).then(commitItem(1)).then(matching(2)).then(checkpoint(2, true))
    .expect(s.cursor == 2 and worker(2).reply == "stale" and s.revision == 5 and invariant)
  run staleCallerMayIndexBeforeFenceTest = init.then(discoveryComplete).then(capture(1)).then(capture(2))
    .then(commitItem(1)).then(matching(2))
    .expect(worker(2).phase == "checkpoint" and not(owns(2)) and s.indexed == Set(1, 2) and invariant)
  run staleDiscoveryCannotReplacePagesTest = init.then(start(1)).then(readScan(1)).then(discover(1))
    .then(discoveryCall(2)).then(discoveryWrite(1, true))
    .expect(s.revision == 1 and s.nextPage == 1 and s.pages.get(0) == List(3, 4) and invariant)
  run lostDiscoveryReplyKeepsCommittedPageTest = init.then(start(1)).then(readScan(1)).then(discover(1))
    .then(discoveryWrite(1, false)).expect(s.revision == 1 and s.nextPage == 1 and worker(1).reply == "lost" and invariant)
  run lostCheckpointReplyKeepsAtomicProgressTest = init.then(discoveryComplete).then(capture(1)).then(matching(1))
    .then(checkpoint(1, false)).expect(s.cursor == 1 and s.pages.get(1) == List(2) and worker(1).reply == "lost" and invariant)
  run failureBeforeCheckpointKeepsIndexedPrefixTest = init.then(discoveryComplete).then(capture(1)).then(matching(1)).then(failure(1))
    .expect(s.cursor == 0 and s.indexed == Set(1, 2) and s.pages.get(1) == List(1, 2) and invariant)
  run pageCompletionDeletesOnlyOldestPageTest = init.then(discoveryComplete).then(processPage)
    .expect(s.cursor == 2 and s.pages.get(1) == List() and s.pages.get(0) == List(3, 4) and invariant)
  run restartKeepsVerifiedPrefixTest = init.then(discoveryComplete).then(capture(1)).then(commitItem(1)).then(restart)
    .then(capture(1)).expect(s.cursor == 1 and currentSignature(1) == 2 and s.indexed == Set(1, 2) and invariant)
  run closeRequiresLaterCallAfterLastCheckpointTest = init.then(discoveryComplete).then(processPage).then(processPage)
    .expect(s.active and pagesEmpty and s.cursor == 4 and invariant)
  run laterArrivalOutsideIntervalTest = init.then(discoveryComplete).then(laterArrival).then(processPage).then(processPage)
    .then(capture(1)).then(closeScan(1, true))
    .expect(s.later and not(s.active) and s.cursor == 4 and not(s.completed.contains(5)) and invariant)
  run nextGenerationReadsLaterArrivalTest = init.then(discoveryComplete).then(laterArrival).then(processPage).then(processPage)
    .then(capture(1)).then(closeScan(1, true)).then(discoveryCall(2)).then(capture(2)).then(commitItem(2))
    .expect(s.generation == 2 and s.cursor == 5 and invariant)
  run staleCloseCannotDeleteNextGenerationTest = init.then(discoveryComplete).then(laterArrival).then(processPage).then(processPage)
    .then(capture(1)).then(capture(2)).then(closeScan(1, true)).then(discoveryCall(1)).then(closeScan(2, true))
    .expect(s.active and s.generation == 2 and s.ready and s.pages.get(0) == List(5) and invariant)
  run lostCloseReplyStillClosesGenerationTest = init.then(discoveryComplete).then(processPage).then(processPage)
    .then(capture(1)).then(closeScan(1, false)).expect(not(s.active) and s.cursor == 4 and worker(1).reply == "lost" and invariant)
}
