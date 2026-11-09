// @source contracts/solana/scripts/prepare-test-program.mjs
// @source contracts/solana/scripts/build-local.sh
// @source contracts/solana/scripts/bootstrap-linux.sh
// @source contracts/solana/scripts/test-e2e.sh
// @source contracts/solana/scripts/run-test-stage.sh
// @source contracts/solana/scripts/failure-evidence.mjs
// Same-run artifacts carry consistency evidence, not an independent trust root.
// Replacement is atomic for the program file, not across its separate receipt.
module deployment_artifact {
  var s: { phase: str, matchingManifest: bool, exactBytes: bool,
    trustedSource: bool, withinWorkspace: bool, program: int, receipt: int,
    validator: bool, tested: bool, diagnostic: bool, exitCode: int }
  action init = s' = { phase: "new", matchingManifest: false, exactBytes: false,
    trustedSource: true, withinWorkspace: false, program: 0, receipt: 0,
    validator: false, tested: false, diagnostic: false, exitCode: 0 }
  action inspect(manifest, bytes, workspace) = all { s.phase=="new",
    s' = s.with("phase", "inspected").with("matchingManifest", manifest)
      .with("exactBytes", bytes).with("withinWorkspace", workspace) }
  action stage = all { s.phase=="inspected", s.trustedSource, s.matchingManifest,
    s.exactBytes, s.withinWorkspace, s'=s.with("phase", "staged") }
  action activate = all { s.phase=="staged", s'=s.with("phase", "activated").with("program",1) }
  action writeReceipt = all { s.phase=="activated", s'=s.with("phase","ready").with("receipt",1) }
  action start = all { s.phase=="ready", s'=s.with("phase","testing").with("validator",true) }
  action test(ok) = all { s.phase=="testing", s'=s.with("phase","finished").with("tested",true)
    .with("exitCode", if(ok) 0 else 1) }
  action diagnostic(ok) = all { s.tested, s.exitCode!=0,
    s'=s.with("diagnostic",ok) }
  action stop = all { s.validator, s.phase=="finished", s'=s.with("validator",false) }
  action step = { nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf()
    any { inspect(a,b,c), stage, activate, writeReceipt, start, test(a), diagnostic(a), stop, s'=s } }
  val invariant = all {
    s.program==1 implies (s.matchingManifest and s.exactBytes and s.withinWorkspace),
    s.receipt<=s.program,
    s.tested implies s.program==s.receipt,
    s.diagnostic implies (s.tested and s.exitCode!=0),
  }
  run wrongRunRefusedTest = init.then(inspect(false,true,true)).then(stage.fail())
  run corruptBytesRefusedTest = init.then(inspect(true,false,true)).then(stage.fail())
  run diagnosticCannotClearFailureTest = init.then(inspect(true,true,true)).then(stage).then(activate)
    .then(writeReceipt).then(start).then(test(false)).then(diagnostic(true)).then(stop)
    .expect(s.exitCode==1 and not(s.validator) and invariant)
  run receiptFollowsActivationTest = init.then(inspect(true,true,true)).then(stage).then(activate)
    .expect(s.program==1 and s.receipt==0 and invariant)
}
