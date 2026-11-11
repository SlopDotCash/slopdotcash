// @source scripts/run-e2e.mjs
// @source playwright.config.ts
// @source .github/workflows/deploy.yml
// Two sequential browser runs and two output directories. Each later run
// replaces its selected directory, just as Playwright prepares outputDir.
// File bytes, screenshots and upload transport are external predicates.
module ci_browser_evidence {
  var s:{phase:str,output:int,reports:List[int],normalPassed:bool,normalRecorded:bool,privatePassed:bool,
    archived:Set[int],complete:bool}
  action init=s'={phase:"new",output:1,reports:List(0,0),normalPassed:false,normalRecorded:false,
    privatePassed:false,archived:Set(),complete:false}
  action normalRun(passed:bool,written:bool):bool=all{s.phase=="new",
    s'=s.with("phase","normal-finished").with("reports",List(if(written)1 else 0,0))
      .with("normalPassed",passed).with("normalRecorded",written)}
  // Output 0 is the registry default; the private-intake workflow selects 1.
  // Keeping 0 here models an explicitly reused output, not implicit uniqueness.
  action selectPrivateOutput(output:int):bool=all{s.phase=="normal-finished",output>=0,output<=1,
    s'=s.with("phase","private-ready").with("output",output)}
  action privateRun(passed:bool,written:bool):bool=all{s.phase=="private-ready",
    s'=s.with("phase","private-finished").with("reports",s.reports.replaceAt(s.output,if(written)2 else 0))
      .with("privatePassed",passed)}
  action archive=all{s.phase=="private-finished",
    val available=Set(s.reports[0],s.reports[1]).exclude(Set(0))
    s'=s.with("phase","archived").with("archived",available)
      .with("complete",s.normalPassed and s.privatePassed and available==Set(1,2))}
  action chooseNormal={nondet passed=Set(false,true).oneOf() nondet written=Set(false,true).oneOf()
    normalRun(passed,written)}
  action choosePrivate={nondet passed=Set(false,true).oneOf() nondet written=Set(false,true).oneOf()
    privateRun(passed,written)}
  action step=any{chooseNormal,selectPrivateOutput(0),selectPrivateOutput(1),choosePrivate,archive,s'=s}
  val invariant=all{s.reports.length()==2,
    Set("private-finished","archived").contains(s.phase) and s.output==1 and s.normalRecorded implies s.reports[0]==1,
    s.phase=="archived" and s.output==1 and s.normalRecorded implies s.archived.contains(1),
    s.complete implies(s.normalPassed and s.privatePassed and s.archived==Set(1,2))}
  run distinctDirectoriesRetainBothReportsTest=init.then(normalRun(true,true)).then(selectPrivateOutput(1))
    .then(privateRun(true,true)).then(archive).expect(s.complete and s.archived==Set(1,2))
  run failedPrivateRunRetainsNormalEvidenceTest=init.then(normalRun(true,true)).then(selectPrivateOutput(1))
    .then(privateRun(false,true)).then(archive).expect(not(s.complete) and s.archived==Set(1,2))
  run failedNormalRunCannotClaimCompleteTest=init.then(normalRun(false,true)).then(selectPrivateOutput(1))
    .then(privateRun(true,true)).then(archive).expect(not(s.complete) and s.archived==Set(1,2))
  run explicitlyReusedDirectoryLosesEarlierReportTest=init.then(normalRun(true,true)).then(selectPrivateOutput(0))
    .then(privateRun(true,true)).then(archive).expect(not(s.complete) and s.archived==Set(2))
  run missingPrivateReportKeepsNormalReportTest=init.then(normalRun(true,true)).then(selectPrivateOutput(1))
    .then(privateRun(false,false)).then(archive).expect(not(s.complete) and s.archived==Set(1))
  run missingNormalReportCannotClaimCompleteTest=init.then(normalRun(true,false)).then(selectPrivateOutput(1))
    .then(privateRun(true,true)).then(archive).expect(not(s.complete) and s.archived==Set(2))
}
