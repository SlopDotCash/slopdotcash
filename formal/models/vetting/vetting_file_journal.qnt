// @source workers/vetting/publication-journal.ts
// @evidence workers/vetting/file-publication-journal.test.ts
// @reference https://nodejs.org/api/fs.html#filehandlesync
// @reference https://man7.org/linux/man-pages/man2/fsync.2.html
// Two callers, two assessment directories, two immutable metadata atoms.
// Marker:0 absent,1 directory,2 other file,3 symlink. File:0 absent,1 partial,
// 2 complete JSON. Root:0 absent,1 real directory,2 invalid/symlink.
// A private operator-owned namespace excludes external rename/replacement,
// hard-link attacks, network-filesystem inconsistencies and hardware lying
// about fsync. Root flush abstracts all newly created ancestor directories.
// Crashes erase unflushed entries; retaining some unflushed bytes is also
// possible, so an orphan always remains a refusal rather than retry authority.
// Sync/close failures are explicit and never remove reservations. A completed
// receipt also syncs its matching intent, including an in-flight reservation.
// No filesystem crash experiment or checker run was executed for this model.
module vetting_file_journal {
  val ids = Set(1, 2)
  type Row = { marker: int, markerSynced: bool, intent: int, source: int,
    intentSynced: bool, intentNamed: bool, receipt: int, receiptSource: int,
    receiptSynced: bool, receiptNamed: bool }
  type Call = { phase: str, operation: str, target: int, captured: int,
    opened: bool, intentMatches: bool, success: bool, present: bool, error: str }
  val noRow: Row = { marker: 0, markerSynced: false, intent: 0, source: 0,
    intentSynced: false, intentNamed: false, receipt: 0, receiptSource: 0,
    receiptSynced: false, receiptNamed: false }
  val idle: Call = { phase: "idle", operation: "none", target: 1, captured: 0,
    opened: false, intentMatches: false, success: false, present: false, error: "none" }
  var s: { setup: bool, root: int, rootSynced: bool, rows: int -> Row,
    callers: int -> int, calls: int -> Call, reservations: int -> int, receipts: int -> int }
  action init = s' = { setup: true, root: 1, rootSynced: true, rows: ids.mapBy(_ => noRow),
    callers: ids.mapBy(_ => 1), calls: ids.mapBy(_ => idle),
    reservations: ids.mapBy(_ => 0), receipts: ids.mapBy(_ => 0) }
  def finished(c: Call, error: str): Call = c.with("phase", "done").with("error", error)
  action seed(root: int, marker: int, intent: int): bool = all { s.setup,
    Set(0, 1, 2).contains(root), 0.to(3).contains(marker), 0.to(2).contains(intent),
    root == 1 or marker == 0, marker != 0 or intent == 0,
    s' = s.with("root", root).with("rootSynced", root == 1).with("rows", s.rows.set(1,
      noRow.with("marker", marker).with("markerSynced", marker != 0)
        .with("intent", intent).with("source", if (intent == 2) 1 else 0)
        .with("intentSynced", intent == 2).with("intentNamed", intent == 2))) }
  action changeCaller(id: int): bool = s' = s.with("callers", s.callers.set(id, if (s.callers.get(id) == 1) 2 else 1))
  action beginCall(id: int, operation: str, target: int, valid: bool): bool = all {
    Set("idle", "done").contains(s.calls.get(id).phase), ids.contains(target),
    Set("has", "reserve", "complete").contains(operation),
    s' = s.with("setup", false).with("calls", s.calls.set(id,
      idle.with("operation", operation).with("target", target).with("captured", s.callers.get(id))
        .with("phase", if (valid) "root" else "done").with("error", if (valid) "none" else "input"))) }
  action inspectRoot(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "root", s' =
      if (s.root == 0 and c.operation == "reserve") s.with("root", 1).with("rootSynced", false)
        .with("calls", s.calls.set(id, c.with("phase", "root-flush")))
      else if (s.root == 0 and c.operation == "has") s.with("calls", s.calls.set(id, finished(c, "none").with("success", true)))
      else if (s.root != 1) s.with("calls", s.calls.set(id, finished(c, "root")))
      else s.with("calls", s.calls.set(id, c.with("phase",
        if (c.operation == "has") "presence" else if (c.operation == "reserve") "root-flush" else "inspect-intent"))) }
  }
  action flushRoot(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { Set("root-flush", "completion-root-flush").contains(c.phase), s' = if (succeeds) s.with("rootSynced", true)
      .with("calls", s.calls.set(id, c.with("phase", if (c.operation == "reserve") "mkdir" else "open")))
      else s.with("calls", s.calls.set(id, finished(c, "sync"))) }
  }
  action presence(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "presence", s' = s.with("calls", s.calls.set(id,
      finished(c, "none").with("success", true).with("present", s.rows.get(c.target).marker != 0))) }
  }
  action makeMarker(id: int): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "mkdir", s' = if (r.marker != 0) s.with("calls", s.calls.set(id, finished(c, "exists")))
      else s.with("rows", s.rows.set(c.target, r.with("marker", 1)))
        .with("calls", s.calls.set(id, c.with("phase", "marker-flush"))) }
  }
  action flushMarker(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "marker-flush", s' = if (succeeds) s.with("rows", s.rows.set(c.target, r.with("markerSynced", true)))
      .with("calls", s.calls.set(id, c.with("phase", "open")))
      else s.with("calls", s.calls.set(id, finished(c, "sync"))) }
  }
  action inspectIntent(id: int): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "inspect-intent", s' = s.with("calls", s.calls.set(id,
      if (r.marker != 1 or r.intent != 2) finished(c, "intent")
      else c.with("phase", "existing-sync").with("opened", true).with("intentMatches", r.source == c.captured))) }
  }
  action syncExisting(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "existing-sync", s' =
      if (succeeds) s.with("rows", s.rows.set(c.target, r.with("intentSynced", true)))
        .with("calls", s.calls.set(id, c.with("phase", "existing-close")))
      else s.with("calls", s.calls.set(id, c.with("phase", "existing-close").with("error", "sync"))) }
  }
  action closeExisting(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "existing-close", s' = s.with("calls", s.calls.set(id,
      if (succeeds and c.error == "none" and c.intentMatches) c.with("phase", "completion-root-flush").with("opened", false)
      else if (succeeds and c.error == "none") finished(c.with("opened", false), "intent")
      else finished(c.with("opened", false), if (c.error == "none") "close" else c.error))) }
  }
  action openFile(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    val vacant = if (c.operation == "reserve") r.intent == 0 else r.receipt == 0
    all { c.phase == "open", s' =
      if (not(succeeds) or not(vacant)) s.with("calls", s.calls.set(id, finished(c, "open")))
      else s.with("rows", s.rows.set(c.target,
        if (c.operation == "reserve") r.with("intent", 1) else r.with("receipt", 1)))
        .with("calls", s.calls.set(id, c.with("phase", "write").with("opened", true))) }
  }
  action writeFile(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "write", s' =
      if (succeeds) s.with("rows", s.rows.set(c.target,
        if (c.operation == "reserve") r.with("intent", 2).with("source", c.captured)
        else r.with("receipt", 2).with("receiptSource", c.captured)))
        .with("calls", s.calls.set(id, c.with("phase", "file-sync")))
      else s.with("calls", s.calls.set(id, c.with("phase", "close").with("error", "write"))) }
  }
  action syncFile(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "file-sync", s' =
      if (succeeds) s.with("rows", s.rows.set(c.target,
        if (c.operation == "reserve") r.with("intentSynced", true) else r.with("receiptSynced", true)))
        .with("calls", s.calls.set(id, c.with("phase", "close")))
      else s.with("calls", s.calls.set(id, c.with("phase", "close").with("error", "sync"))) }
  }
  action closeFile(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "close", s' = s.with("calls", s.calls.set(id,
      if (succeeds and c.error == "none") c.with("phase", "entry-sync").with("opened", false)
      else finished(c.with("opened", false), if (c.error == "none") "close" else c.error))) }
  }
  action syncEntry(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id) val r = s.rows.get(c.target)
    all { c.phase == "entry-sync", s' =
      if (not(succeeds)) s.with("calls", s.calls.set(id, finished(c, "sync")))
      else s.with("rows", s.rows.set(c.target,
        if (c.operation == "reserve") r.with("intentNamed", true)
        else r.with("intentNamed", true).with("receiptNamed", true)))
        .with("reservations", if (c.operation == "reserve") s.reservations.set(c.target, c.captured) else s.reservations)
        .with("receipts", if (c.operation == "complete") s.receipts.set(c.target, c.captured) else s.receipts)
        .with("calls", s.calls.set(id, finished(c, "none").with("success", true))) }
  }
  action crash = s' = s.with("root", if (s.rootSynced) s.root else 0)
    .with("rows", ids.mapBy(id => { val r = s.rows.get(id)
      if (not(r.markerSynced)) noRow else r
        .with("intent", if (r.intentSynced and r.intentNamed) r.intent else 0)
        .with("receipt", if (r.receiptSynced and r.receiptNamed) r.receipt else 0) }))
    .with("calls", ids.mapBy(id => s.calls.get(id).with("opened", false).with("phase", "done")))
  action step = {
    nondet id = ids.oneOf() nondet target = ids.oneOf()
    nondet operation = Set("has", "reserve", "complete").oneOf()
    nondet succeeds = Set(false, true).oneOf()
    nondet rootKind = Set(0, 1, 2).oneOf() nondet markerKind = 0.to(3).oneOf() nondet fileKind = 0.to(2).oneOf()
    any { seed(rootKind, markerKind, fileKind), changeCaller(id), beginCall(id, operation, target, succeeds), inspectRoot(id), flushRoot(id, succeeds),
      presence(id), makeMarker(id), flushMarker(id, succeeds), inspectIntent(id), syncExisting(id, succeeds),
      closeExisting(id, succeeds), openFile(id, succeeds), writeFile(id, succeeds), syncFile(id, succeeds),
      closeFile(id, succeeds), syncEntry(id, succeeds), crash, s' = s }
  }
  val invariant = all {
    ids.forall(id => { val r = s.rows.get(id)
      all { s.reservations.get(id) != 0 implies r.marker == 1 and r.markerSynced and r.intent == 2
          and r.source == s.reservations.get(id) and r.intentSynced and r.intentNamed,
        s.receipts.get(id) != 0 implies r.marker == 1 and r.markerSynced and r.intent == 2
          and r.intentSynced and r.intentNamed and r.receipt == 2 and r.receiptSynced and r.receiptNamed
          and r.receiptSource == r.source and r.source == s.receipts.get(id) } }),
    ids.forall(id => { val c = s.calls.get(id)
      c.success implies c.error == "none" }) }
  action startReserve(id: int, target: int): bool = beginCall(id, "reserve", target, true).then(inspectRoot(id)).then(flushRoot(id, true)).then(makeMarker(id)).then(flushMarker(id, true))
  action writeAndSync(id: int): bool = openFile(id, true).then(writeFile(id, true)).then(syncFile(id, true)).then(closeFile(id, true)).then(syncEntry(id, true))
  action reserve(id: int, target: int): bool = startReserve(id, target).then(writeAndSync(id))
  action complete(id: int, target: int): bool = beginCall(id, "complete", target, true).then(inspectRoot(id)).then(inspectIntent(id)).then(syncExisting(id, true)).then(closeExisting(id, true)).then(flushRoot(id, true)).then(writeAndSync(id))
  action hasMarker(id: int, target: int): bool = beginCall(id, "has", target, true).then(inspectRoot(id)).then(presence(id))
  run invalidIdPreventsAllIoTest = init.then(beginCall(1, "reserve", 1, false)).expect(s.rows.get(1) == noRow and s.calls.get(1).error == "input" and invariant)
  run newRootRequiresAncestorFlushTest = init.then(seed(0, 0, 0)).then(beginCall(1, "reserve", 1, true)).then(inspectRoot(1)).then(flushRoot(1, true)).then(makeMarker(1)).then(flushMarker(1, true)).then(writeAndSync(1)).expect(s.rootSynced and s.calls.get(1).success and invariant)
  run concurrentRootObserverAlsoFlushesAncestorsTest = init.then(seed(0, 0, 0)).then(beginCall(1, "reserve", 1, true)).then(inspectRoot(1)).then(beginCall(2, "reserve", 1, true)).then(inspectRoot(2)).then(flushRoot(2, true)).then(makeMarker(2)).then(flushMarker(2, true)).then(writeAndSync(2)).then(crash).expect(s.root == 1 and s.rows.get(1).intent == 2 and invariant)
  run invalidRootRefusesTest = init.then(seed(2, 0, 0)).then(beginCall(1, "reserve", 1, true)).then(inspectRoot(1)).expect(s.calls.get(1).error == "root" and invariant)
  run rootSyncFailureDoesNotReserveTest = init.then(seed(0, 0, 0)).then(beginCall(1, "reserve", 1, true)).then(inspectRoot(1)).then(flushRoot(1, false)).expect(s.rows.get(1).marker == 0 and not(s.calls.get(1).success) and invariant)
  run successfulReservationSurvivesCrashTest = init.then(reserve(1, 1)).then(crash).then(hasMarker(2, 1)).expect(s.calls.get(2).present and s.rows.get(1).source == 1 and invariant)
  run snapshotSurvivesCallerMutationTest = init.then(startReserve(1, 1)).then(changeCaller(1)).then(writeAndSync(1)).expect(s.rows.get(1).source == 1 and s.callers.get(1) == 2 and invariant)
  run competingDirectoryCreationHasOneWinnerTest = init.then(startReserve(1, 1)).then(beginCall(2, "reserve", 1, true)).then(inspectRoot(2)).then(flushRoot(2, true)).then(makeMarker(2)).expect(s.calls.get(2).error == "exists" and invariant)
  run orphanDirectoryBlocksRetryTest = init.then(seed(1, 1, 0)).then(hasMarker(1, 1)).then(beginCall(2, "reserve", 1, true)).then(inspectRoot(2)).then(flushRoot(2, true)).then(makeMarker(2)).expect(s.calls.get(1).present and s.calls.get(2).error == "exists" and invariant)
  run orphanFileBlocksRetryTest = init.then(seed(1, 2, 0)).then(hasMarker(1, 1)).expect(s.calls.get(1).present and invariant)
  run danglingSymlinkBlocksRetryTest = init.then(seed(1, 3, 0)).then(hasMarker(1, 1)).expect(s.calls.get(1).present and invariant)
  run symlinkCannotReceiveReceiptTest = init.then(seed(1, 3, 2)).then(beginCall(1, "complete", 1, true)).then(inspectRoot(1)).then(inspectIntent(1)).expect(s.calls.get(1).error == "intent" and invariant)
  run partialIntentCannotReceiveReceiptTest = init.then(seed(1, 1, 1)).then(beginCall(1, "complete", 1, true)).then(inspectRoot(1)).then(inspectIntent(1)).expect(s.calls.get(1).error == "intent" and invariant)
  run missingIntentCannotReceiveReceiptTest = init.then(seed(1, 1, 0)).then(beginCall(1, "complete", 1, true)).then(inspectRoot(1)).then(inspectIntent(1)).expect(s.calls.get(1).error == "intent" and invariant)
  run mismatchedReceiptCannotWriteTest = init.then(reserve(1, 1)).then(changeCaller(2)).then(beginCall(2, "complete", 1, true)).then(inspectRoot(2)).then(inspectIntent(2)).then(syncExisting(2, true)).then(closeExisting(2, true)).expect(s.calls.get(2).error == "intent" and s.rows.get(1).receipt == 0 and invariant)
  run mismatchedCompletionStillSyncsReadableIntentTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(changeCaller(2)).then(beginCall(2, "complete", 1, true)).then(inspectRoot(2)).then(inspectIntent(2)).then(syncExisting(2, true)).then(closeExisting(2, true)).expect(s.rows.get(1).intentSynced and not(s.rows.get(1).intentNamed) and s.calls.get(2).error == "intent" and invariant)
  run completedReceiptSurvivesCrashTest = init.then(reserve(1, 1)).then(complete(2, 1)).then(crash).expect(s.rows.get(1).receipt == 2 and s.receipts.get(1) == 1 and invariant)
  run completionAncestorSyncFailureCannotWriteReceiptTest = init.then(reserve(1, 1)).then(beginCall(2, "complete", 1, true)).then(inspectRoot(2)).then(inspectIntent(2)).then(syncExisting(2, true)).then(closeExisting(2, true)).then(flushRoot(2, false)).expect(s.rows.get(1).receipt == 0 and not(s.calls.get(2).success) and invariant)
  run duplicateReceiptPreservesFirstTest = init.then(reserve(1, 1)).then(complete(2, 1)).then(beginCall(1, "complete", 1, true)).then(inspectRoot(1)).then(inspectIntent(1)).then(syncExisting(1, true)).then(closeExisting(1, true)).then(flushRoot(1, true)).then(openFile(1, true)).expect(s.calls.get(1).error == "open" and invariant)
  run markerSyncFailureRetainsOrphanTest = init.then(beginCall(1, "reserve", 1, true)).then(inspectRoot(1)).then(flushRoot(1, true)).then(makeMarker(1)).then(flushMarker(1, false)).then(hasMarker(2, 1)).expect(s.calls.get(2).present and not(s.calls.get(1).success) and invariant)
  run fileOpenFailureRetainsMarkerTest = init.then(startReserve(1, 1)).then(openFile(1, false)).then(hasMarker(2, 1)).expect(s.calls.get(2).present and invariant)
  run partialWriteFailureRetainsMarkerTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, false)).then(closeFile(1, true)).then(hasMarker(2, 1)).expect(s.rows.get(1).intent == 1 and s.calls.get(2).present and invariant)
  run syncFailureClosesHandleAndRetainsMarkerTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(syncFile(1, false)).then(closeFile(1, true)).expect(not(s.calls.get(1).opened) and s.calls.get(1).error == "sync" and invariant)
  run closeFailureCannotConfirmReservationTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(syncFile(1, true)).then(closeFile(1, false)).expect(not(s.calls.get(1).success) and s.calls.get(1).error == "close" and invariant)
  run closeFailurePreservesEarlierWriteFailureTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, false)).then(closeFile(1, false)).expect(s.calls.get(1).error == "write" and invariant)
  run entrySyncFailureCannotConfirmReservationTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(syncFile(1, true)).then(closeFile(1, true)).then(syncEntry(1, false)).expect(s.calls.get(1).error == "sync" and s.reservations.get(1) == 0 and invariant)
  run crashAfterMarkerFlushKeepsRetryBlockedTest = init.then(startReserve(1, 1)).then(crash).then(hasMarker(2, 1)).expect(s.calls.get(2).present and invariant)
  run crashBeforeFileDirectoryFlushKeepsMarkerTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(syncFile(1, true)).then(crash).then(hasMarker(2, 1)).expect(s.calls.get(2).present and s.rows.get(1).intent == 0 and invariant)
  run completeSyncsInFlightFullIntentTest = init.then(startReserve(1, 1)).then(openFile(1, true)).then(writeFile(1, true)).then(complete(2, 1)).then(crash).expect(s.rows.get(1).intent == 2 and s.rows.get(1).receipt == 2 and invariant)
  run independentAssessmentsRemainIndependentTest = init.then(reserve(1, 1)).then(reserve(2, 2)).expect(s.reservations.get(1) == 1 and s.reservations.get(2) == 1 and invariant)
}
