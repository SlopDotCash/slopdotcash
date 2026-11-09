// @source workers/vetting/bounded-scan.ts
// The build-definition rule reports a finding when the file itself is a build
// definition that runs during install: `Setup.hs` and the literate
// `Setup.lhs`, not only a `build` prefix. `definition` is the recognised
// name, `installs` says the lifecycle executes the file.
module vetting_build_definition {
  var s: { definition: bool, installs: bool, finding: bool, scanned: int }
  action init = s' = { definition: false, installs: false, finding: false,
    scanned: 0 }
  action scan(definition, installs) =
    s' = s.with("definition", definition).with("installs", installs)
      .with("scanned", s.scanned + 1)
      .with("finding", definition and installs)
  action step = {
    nondet definition = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(definition, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.definition and s.installs),
    s.scanned >= 0,
  }
  run setupHsIsABuildDefinitionTest = init.then(scan(true, true))
    .expect(s.finding and s.scanned == 1)
  run setupLhsIsCoveredTest = init.then(scan(true, true))
    .expect(s.finding)
  run setupHsOutsideInstallTest = init.then(scan(true, false))
    .expect(not(s.finding))
  run plainBuildFileIsNotTheDefinitionTest = init.then(scan(false, true))
    .expect(not(s.finding))
}
