// @source backend/security/report-intake.ts
// PR2252: a maintainer-forward decision closes a raw held-screen revision
// window. Explicit intake or case-owner requests for information can reopen
// it. Intake and case revisions are separate CAS tokens; at most two edits.
// Private object storage and case mutation transactions are refined by
// api_private_case_transaction and their real SQLite/R2 boundary tests.
module api_report_forward_revision {
  var s:{screening:str,review:str,routed:bool,intakeRevision:int,caseRevision:int,
    expectedIntake:int,expectedCase:int,reportVersion:int,forwardVersion:int,
    ownerNeedsInformation:bool,events:int}
  action init = {
    nondet held=Set("spam","needs-information","unavailable").oneOf()
    s'={screening:held,review:"none",routed:false,intakeRevision:1,caseRevision:1,
      expectedIntake:0,expectedCase:0,reportVersion:1,forwardVersion:0,
      ownerNeedsInformation:false,events:0}
  }
  val editable = s.review=="request-information" or
    (s.review=="none" and Set("spam","needs-information","unavailable").contains(s.screening)) or s.ownerNeedsInformation
  action read = s'=s.with("expectedIntake",s.intakeRevision).with("expectedCase",s.caseRevision)
  action forward = all {s.expectedIntake==s.intakeRevision,s.intakeRevision<5,
    s'=s.with("review","forward").with("intakeRevision",s.intakeRevision+1).with("forwardVersion",s.reportVersion)}
  action routeOwner = all {s.review=="forward",s'=s.with("routed",true)}
  action requestInformation = all {s.expectedIntake==s.intakeRevision,s.intakeRevision<5,
    s'=s.with("review","request-information").with("intakeRevision",s.intakeRevision+1)}
  action caseOwnerRequestsInformation = all {s.expectedCase==s.caseRevision,s.caseRevision<4,
    s'=s.with("ownerNeedsInformation",true).with("caseRevision",s.caseRevision+1).with("events",s.events+1)}
  action revise = all {editable,s.expectedIntake==s.intakeRevision,s.expectedCase==s.caseRevision,
    s.reportVersion<3,s.intakeRevision<5,s.caseRevision<4,
    s'=s.with("reportVersion",s.reportVersion+1).with("intakeRevision",s.intakeRevision+1)
      .with("caseRevision",s.caseRevision+1).with("events",s.events+1)
      .with("screening","queued").with("review","none").with("routed",false).with("forwardVersion",0)}
  action step = any {read,forward,routeOwner,requestInformation,caseOwnerRequestsInformation,revise,s'=s}
  val invariant = all {s.caseRevision==s.events+1,
    s.review=="forward" and not(s.ownerNeedsInformation) implies not(editable),
    s.review=="forward" implies s.reportVersion==s.forwardVersion}
  run forwardBlocksHeldEditTest = init.then(read).then(forward).then(routeOwner).then(read).then(revise.fail())
  run forwardPendingRouteBlocksEditTest = init.then(read).then(forward).then(read).then(revise.fail())
  run explicitInformationReopensTest = init.then(read).then(forward).then(read).then(requestInformation)
    .then(read).then(revise).expect(s.reportVersion==2 and s.review=="none" and not(s.routed))
  run caseOwnerInformationReopensTest = init.then(read).then(forward).then(routeOwner).then(read)
    .then(caseOwnerRequestsInformation).then(read).then(revise).expect(s.reportVersion==2)
  run staleReportCannotUndoForwardTest = init.then(read).then(forward).then(revise.fail())
}
