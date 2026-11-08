// @source scripts/local-solana-validator.mjs
// @source scripts/child-environment.mjs
// @source .github/workflows/escrow-tests.yml
// @evidence tests/direct-bounty-solana-chain.ts
// @evidence tests/solana-container-cancel.workflow.mjs
// @evidence tests/solana-container-receipt.workflow.mjs
// One owned container, one pending engine mutation. Engine acknowledgement is
// distinct from sending a request: cancellation waits for it before removal.
// Image/engine inspection and host socket truth are external observations.
// inspectRuntime includes the caller's selected engine surviving its child
// environment projection, checked by the real child-environment regression.
module solana_container_lifecycle {
  var s: { phase: str, localRuntime: bool, pinnedImage: bool, owned: bool,
    loopbackPorts: bool, verifiedBinary: bool, refused: bool, receiptWritable: bool,
    pending: str, cancelled: bool, startRequested: bool, readyWritePending: bool }
  action init = s' = { phase: "idle", localRuntime: false, pinnedImage: false,
    owned: false, loopbackPorts: false, verifiedBinary: false,
    refused: false, receiptWritable: true, pending: "none", cancelled: false,
    startRequested: false, readyWritePending: false }
  action inspectRuntime = all { s.phase == "idle",
    s' = s.with("phase", "runtime").with("localRuntime", true) }
  action rejectRemoteRuntime = all { s.phase == "idle",
    s' = s.with("phase", "refused").with("refused", true) }
  action inspectImage = all { s.phase == "runtime",
    s' = s.with("phase", "prepared").with("pinnedImage", true) }
  action rejectImage = all { s.phase == "runtime",
    s' = s.with("phase", "refused").with("refused", true) }
  action requestCreate = all { s.phase == "prepared", not(s.cancelled),
    s' = s.with("phase", "creating").with("pending", "create") }
  action acknowledgeCreate = all { s.phase == "creating", s.pending == "create",
    s' = s.with("phase", if (s.cancelled) "stopping" else "created")
      .with("pending", "none").with("owned", true) }
  action requestStart = all { s.phase == "created", not(s.cancelled),
    s' = s.with("phase", "starting").with("pending", "start").with("startRequested", true) }
  action acknowledgeStart = all { s.phase == "starting", s.pending == "start",
    s' = s.with("phase", if (s.cancelled) "stopping" else "running").with("pending", "none") }
  action mutationUnknown = all { s.pending == "create" or s.pending == "start",
    s' = s.with("phase", "cleanup-unknown").with("pending", "unknown") }
  action inspectLoopback = all { s.phase == "running", not(s.cancelled),
    s' = s.with("phase", "ports-checked").with("loopbackPorts", true) }
  action rejectPorts = all { s.phase == "running", not(s.cancelled),
    s' = s.with("phase", "refused").with("refused", true) }
  action verifyBinary = all { s.phase == "ports-checked", not(s.cancelled),
    s' = s.with("phase", "publishing-ready").with("verifiedBinary", true).with("readyWritePending", true) }
  action acknowledgeReadyWrite = all { s.readyWritePending,
    s' = s.with("readyWritePending", false).with("phase",
      if (s.phase == "publishing-ready" and not(s.cancelled)) "ready" else s.phase) }
  action rejectBinary = all { s.phase == "ports-checked", not(s.cancelled),
    s' = s.with("phase", "refused").with("refused", true) }
  action receiptFailure = all { s.owned,
    s' = s.with("receiptWritable", false) }
  action stopOwned = all {
    Set("prepared", "creating", "created", "starting", "running", "ports-checked", "publishing-ready", "ready", "refused").contains(s.phase),
    s' = s.with("phase", if (s.pending == "none") "stopping" else s.phase)
      .with("cancelled", true).with("verifiedBinary", false) }
  action confirmRemoved = all { s.phase == "stopping", s.pending == "none", not(s.readyWritePending),
    s' = s.with("phase", "stopped").with("owned", false).with("loopbackPorts", false) }
  action cleanupUnknown = all { s.phase == "stopping",
    s' = s.with("phase", "cleanup-unknown") }
  action abruptExit = all { s.owned or s.pending != "none",
    s' = s.with("phase", "orphaned").with("verifiedBinary", false) }
  action step = any { inspectRuntime, rejectRemoteRuntime, inspectImage,
    rejectImage, requestCreate, acknowledgeCreate, requestStart, acknowledgeStart,
    mutationUnknown, inspectLoopback, rejectPorts, verifyBinary,
    rejectBinary, acknowledgeReadyWrite, receiptFailure, stopOwned, confirmRemoved, cleanupUnknown,
    abruptExit, s' = s }
  val invariant = all {
    s.phase == "ready" implies (s.localRuntime and s.pinnedImage and s.owned and s.loopbackPorts and s.verifiedBinary and not(s.cancelled) and not(s.readyWritePending)),
    s.phase == "stopped" implies (not(s.owned) and not(s.loopbackPorts) and s.pending == "none" and not(s.readyWritePending)),
    s.owned implies (s.localRuntime and s.pinnedImage),
    s.phase == "creating" implies not(s.startRequested),
  }
  run pinnedReadyTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(requestStart).then(acknowledgeStart)
    .then(inspectLoopback).then(verifyBinary).then(acknowledgeReadyWrite).expect(s.phase == "ready" and invariant)
  run cancellationAwaitsCreateTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(stopOwned).expect(s.pending == "create" and s.phase == "creating")
    .then(acknowledgeCreate).then(confirmRemoved)
    .expect(s.phase == "stopped" and not(s.startRequested) and invariant)
  run cancellationAwaitsStartTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(requestStart).then(stopOwned)
    .expect(s.pending == "start").then(acknowledgeStart).then(confirmRemoved)
    .expect(s.phase == "stopped" and invariant)
  run unknownCreateCannotClaimStoppedTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(stopOwned).then(mutationUnknown)
    .expect(s.phase == "cleanup-unknown" and s.pending == "unknown")
  run cancellationDuringReadyWriteTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(requestStart).then(acknowledgeStart)
    .then(inspectLoopback).then(verifyBinary).then(stopOwned)
    .expect(s.readyWritePending and s.cancelled)
    .then(acknowledgeReadyWrite).then(confirmRemoved)
    .expect(s.phase == "stopped" and invariant)
  run portRefusalStopsOwnedTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(requestStart).then(acknowledgeStart)
    .then(rejectPorts).then(stopOwned).then(confirmRemoved).expect(s.refused and not(s.owned))
  run receiptFailureStillRemovesTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(requestStart).then(acknowledgeStart)
    .then(inspectLoopback).then(verifyBinary).then(acknowledgeReadyWrite).then(receiptFailure).then(stopOwned).then(confirmRemoved)
    .expect(not(s.owned) and not(s.receiptWritable))
  run abruptExitRetainsOwnershipTest = init.then(inspectRuntime).then(inspectImage)
    .then(requestCreate).then(acknowledgeCreate).then(abruptExit)
    .expect(s.owned and s.phase == "orphaned")
}
