// @source scripts/reviewed-historical-points.ts
// @source scripts/run-reviewed-historical-points.ts
// @source scripts/historical-replay-qualification.ts
// @source scripts/restore-historical-assessment-replay.py
// @evidence scripts/restore-historical-assessment-replay.test.ts
// @source scripts/private-payout-packet.ts
// @source scripts/private-packet-preview.ts
// @evidence scripts/private-packet-preview.test.ts
// @evidence scripts/reviewed-historical-points.test.ts
// Ciphertext transport authenticates each exact object before the existing complete-input gate.
// @source .github/workflows/private-payout-packet.yml
// @source .github/workflows/reviewed-historical-points.yml
// @source scripts/prepare-points-import.ts
// @source scripts/prepare-payments-import.ts
// @source scripts/check-direct-payment-disclosures.ts
// @source scripts/backfill-points.ts
// @source src/lib/payments/escrow-cycle.ts
// Complete validated input precedes publication; disclosure is not a verified payment.
module source_import {
  // The protected runner emits only its source-selected phase after a refusal.
  // The phases abstract the point of failure and grant no publication authority.
  pure val publicationFailurePhases = Set(
    "trusted invocation",
    "main source verification",
    "private packet read",
    "reviewed packet validation",
    "enforcement checkpoint read",
    "project and repository verification",
    "owner authority verification",
    "historical census verification",
    "accepted squash verification",
    "financial protection verification",
    "assessment journal checkpoint read",
    "trusted replay receipt read",
    "assessment qualification match",
    "private replay review staging",
    "value record verification",
    "public Points read",
    "recipient and account restriction verification",
    "published checkpoint verification",
    "historical Points reconstruction",
    "import preparation",
    "apply authority recheck",
    "protected import and readback",
  )
  // An identity represents the agreed immutable source ID, repository, URL,
  // submitted head, occurrence, and PR actor. Live observations must supply
  // the same accepted output for both views of that source.
  type MixedProof = {
    context: bool,
    submittedIdentity: int,
    squashIdentity: int,
    contextAcceptedOutput: int,
    squashOutput: int,
    submitted: Set[int],
    pathCommit: int,
  }
  pure val none = {
    context: false,
    submittedIdentity: 0,
    squashIdentity: 0,
    contextAcceptedOutput: 0,
    squashOutput: 0,
    submitted: Set(),
    pathCommit: 0,
  }
  pure val mixed = {
    context: true,
    submittedIdentity: 1,
    squashIdentity: 1,
    contextAcceptedOutput: 20,
    squashOutput: 20,
    submitted: Set(10),
    pathCommit: 20,
  }
  pure def mixedBound(p: MixedProof): bool = all {
    p.context,
    p.submittedIdentity == p.squashIdentity,
    p.contextAcceptedOutput == p.squashOutput,
    not(p.submitted.contains(p.squashOutput)),
    p.pathCommit == p.squashOutput or p.submitted.contains(p.pathCommit),
  }
  pure def pathRole(p: MixedProof): int = if (p.pathCommit == p.squashOutput) 2 else 1
  type S={parts:Set[int],valid:bool,complete:bool,published:bool,disclosed:bool,verifiedPaid:bool,identity:int,mixedProof:MixedProof,role:int,failurePhase:str,assessmentCurrent:bool,baselineCurrent:bool,qualifiedReplay:bool,historicalPublished:bool}
  var s:S
  action init=s'={parts:Set(),valid:false,complete:false,published:false,disclosed:false,verifiedPaid:false,identity:1,mixedProof:none,role:0,failurePhase:"",assessmentCurrent:true,baselineCurrent:true,qualifiedReplay:false,historicalPublished:false}
  action reportRefusal(phase: str): bool = all {
    publicationFailurePhases.contains(phase),
    s' = s.with("failurePhase", phase),
  }
  action bindMixed(p: MixedProof): bool = all {
    not(s.valid),
    mixedBound(p),
    s' = s.with("mixedProof",p).with("role",pathRole(p)),
  }
  action part(id:int):bool=all{not(s.published),s'=s.with("parts",s.parts.union(Set(id)))}
  action validate=all{s.parts==Set(1,2),s'=s.with("valid",true).with("complete",true)}
  action appendAssessment(inScope: bool): bool = all {
    not(s.published),
    s' = s.with("assessmentCurrent", s.assessmentCurrent and not(inScope)),
  }
  action advanceBaseline = all {
    not(s.published),
    s' = s.with("baselineCurrent", false),
  }
  action publish = all {
    s.valid,
    s.complete,
    s.assessmentCurrent,
    s.baselineCurrent,
    s' = s.with("published", true),
  }
  action qualifyReplay(exactTrustedReceipt: bool): bool = all {
    s.valid,
    s.complete,
    exactTrustedReceipt,
    s' = s.with("qualifiedReplay", true),
  }
  action publishHistorical = all {
    s.valid,
    s.complete,
    s.qualifiedReplay,
    s.assessmentCurrent,
    s.baselineCurrent,
    s' = s.with("published", true).with("historicalPublished", true),
  }
  action disclose=all{s.published,s'=s.with("disclosed",true)}
  action appendSameIdentity(id:int):bool=all{id==s.identity,s'=s}
  action step=any {
    part(1),part(2),validate,publish,disclose,appendSameIdentity(1),
    appendAssessment(true),appendAssessment(false),advanceBaseline,
    qualifyReplay(true),qualifyReplay(false),publishHistorical,
    bindMixed(mixed),
    bindMixed(mixed.with("pathCommit",10)),
    bindMixed(mixed.with("squashIdentity",2)),
    bindMixed(mixed.with("contextAcceptedOutput",30)),
    bindMixed(mixed.with("submitted",Set(10,20))),
    bindMixed(mixed.with("pathCommit",30)),
    bindMixed(mixed.with("context",false)),
    { nondet phase = publicationFailurePhases.oneOf() reportRefusal(phase) },
    s'=s,
  }
  val invariant=all {
    s.published implies(s.valid and s.complete and s.assessmentCurrent and s.baselineCurrent),
    s.historicalPublished implies(s.published and s.qualifiedReplay),
    not(s.verifiedPaid),
    s.identity==1,
    s.role != 0 implies mixedBound(s.mixedProof),
    s.role == 1 implies s.mixedProof.pathCommit != s.mixedProof.squashOutput,
    s.role == 2 implies s.mixedProof.pathCommit == s.mixedProof.squashOutput,
    s.failurePhase == "" or publicationFailurePhases.contains(s.failurePhase),
  }
  run partialRefusedTest=init.then(part(1)).then(publish.fail())
  run disclosedNotVerifiedTest=init.then(part(1)).then(part(2)).then(validate).then(publish).then(disclose).expect(s.disclosed and not(s.verifiedPaid) and invariant)
  run conflictingImportTest=init.then(appendSameIdentity(2).fail())
  run refusalReportsFixedPhaseWithoutGrantingPublicationTest = init
    .then(reportRefusal("private packet read")).expect(s.failurePhase == "private packet read" and invariant)
    .then(publish.fail())
  run privateErrorIsNotAPhaseTest = init.then(reportRefusal("opaque input").fail())
  run mixedPathsRoutedByCommitTest = init.then(bindMixed(mixed)).expect(s.role == 2 and invariant)
    .then(bindMixed(mixed.with("pathCommit",10))).expect(s.role == 1 and invariant)
  run mixedSourcesMustAgreeTest = init.then(bindMixed(mixed.with("squashIdentity",2)).fail())
  run mixedAcceptedOutputMustAgreeTest = init.then(bindMixed(mixed.with("contextAcceptedOutput",30)).fail())
  run mixedEarlierContextRequiredTest = init.then(bindMixed(mixed.with("context",false)).fail())
  run mixedOutputCannotBeSubmittedTest = init.then(bindMixed(mixed.with("submitted",Set(10,20))).fail())
  run mixedPathCannotUseAnotherCommitTest = init.then(bindMixed(mixed.with("pathCommit",30)).fail())
  run validatedMixedEvidenceCannotChangeTest = init.then(bindMixed(mixed)).then(part(1)).then(part(2)).then(validate)
    .then(bindMixed(mixed.with("pathCommit",10)).fail())
  run mixedImportPreservesAcceptedRoleTest = init.then(bindMixed(mixed)).then(part(1)).then(part(2)).then(validate)
    .then(publish).expect(s.role == 2 and invariant)
  run applicableAssessmentAppendRefusesPublicationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(appendAssessment(true)).then(publish.fail())
  run unrelatedAssessmentAppendAllowsPublicationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(appendAssessment(false)).then(publish).expect(s.published and invariant)
  run changedPointsCheckpointRefusesPublicationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(advanceBaseline).then(publish.fail())
  run unmatchedHistoricalReplayRefusesQualificationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(qualifyReplay(false).fail())
  run exactReplayRequiredForHistoricalPublicationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(publishHistorical.fail())
  run unrelatedAppendPreservesHistoricalQualificationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(qualifyReplay(true)).then(appendAssessment(false))
    .then(publishHistorical).expect(s.historicalPublished and invariant)
  run relevantAppendRefusesQualifiedHistoricalPublicationTest = init.then(part(1)).then(part(2)).then(validate)
    .then(qualifyReplay(true)).then(appendAssessment(true)).then(publishHistorical.fail())
}
