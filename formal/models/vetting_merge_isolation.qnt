// @source workers/vetting-sandbox/merge-job.ts
// @source workers/vetting-sandbox/merge.ts
// @source workers/vetting-sandbox/workflow.ts
// Fixed offline object reconstruction; repository files are data. The RPC's
// finally block must acknowledge destruction before a result can escape.
module vetting_merge_isolation {
  var s: { phase: str, bytesBound: bool, inputBound: bool, offline: bool,
    exactOutput: bool, destroyed: bool, returned: bool, failed: bool }
  action init = s' = {phase: "new", bytesBound: false, inputBound: false, offline: true,
    exactOutput: false, destroyed: false, returned: false, failed: false}
  action allocate = all { s.phase == "new", s' = s.with("phase", "allocated") }
  action writeBundle = all { s.phase == "allocated", s' = s.with("bytesBound", true).with("phase", "bundle") }
  action bindInput = all { s.phase == "bundle", s' = s.with("inputBound", true).with("phase", "ready") }
  action reconstruct = all { s.phase == "ready", s.bytesBound, s.inputBound, s.offline,
    s' = s.with("exactOutput", true).with("phase", "output") }
  action failure = all { not(s.returned), s' = s.with("failed", true).with("phase", "cleanup") }
  action destroy = all { s.phase == "output" or s.phase == "cleanup", s' = s.with("destroyed", true).with("phase", "destroyed") }
  action reply = all { s.phase == "destroyed", s.exactOutput, not(s.failed), s' = s.with("returned", true) }
  action step = any { allocate, writeBundle, bindInput, reconstruct, failure, destroy, reply, s' = s }
  val invariant = s.returned implies s.destroyed and s.exactOutput and s.bytesBound and s.inputBound and s.offline and not(s.failed)
  run outputWaitsForCleanupTest = init.then(allocate).then(writeBundle).then(bindInput).then(reconstruct)
    .expect(not(s.returned)).then(destroy).then(reply).expect(s.returned and invariant)
  run failedReconstructionReturnsNoProofTest = init.then(allocate).then(writeBundle).then(failure).then(destroy)
    .expect(s.destroyed and not(s.returned))
}
