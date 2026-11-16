// @source workers/vetting/sandbox.ts
// @source workers/vetting/isolated-evidence.ts
// @source workers/vetting/isolated-inspection.ts
// @source workers/vetting/filesystem-capture.ts
// @source workers/vetting/provenance-report.ts
// Successful process exit proves neither source equivalence nor safe release.
// Exact captured file references and all three capture phases are required.
module vetting_execution_provenance {
  var s: { artifactBound: bool, isolated: bool, phases: Set[int], references: bool,
    exited: bool, complete: bool, sourceBound: bool, gaps: bool, released: bool }
  action init = s' = {artifactBound: false, isolated: false, phases: Set(), references: false,
    exited: false, complete: false, sourceBound: false, gaps: false, released: false}
  action request = s' = s.with("artifactBound", true).with("isolated", true)
  action phase(index: int): bool = all { s.isolated, s' = s.with("phases", s.phases.union(Set(index))) }
  action closeReferences = all { s.phases == Set(1, 2, 3), s' = s.with("references", true) }
  action exitComplete = all { s.isolated, s' = s.with("exited", true).with("complete", true) }
  action timeout = all { s.isolated, s' = s.with("exited", true).with("complete", false).with("gaps", true) }
  action bindSource = all { s.references, s' = s.with("sourceBound", true) }
  action step = { nondet index = Set(1, 2, 3).oneOf()
    any { request, phase(index), closeReferences, exitComplete, timeout, bindSource, s' = s } }
  val invariant = all { not(s.released), s.sourceBound implies s.references and s.phases == Set(1, 2, 3),
    s.complete implies s.exited and s.isolated }
  run executionSuccessDoesNotReleaseTest = init.then(request).then(exitComplete).expect(s.complete and not(s.released))
  run fullCaptureBindsSourceOnlyTest = init.then(request).then(phase(1)).then(phase(2)).then(phase(3))
    .then(closeReferences).then(bindSource).expect(s.sourceBound and not(s.released))
}
