// @source .github/workflows/deploy.yml
// @source .github/workflows/formal.yml
// @source .github/workflows/lemmascript.yml
// One immutable workflow SHA, two proof jobs and the existing quality inputs.
// GitHub dependency scheduling/status truth is external; no deploy occurs here.
module release_proof_gate {
  var s: {quint:str, lemma:str, sourceMatches:bool, otherChecks:bool,
    quality:str, published:bool}
  action init=s'={quint:"pending",lemma:"pending",sourceMatches:true,
    otherChecks:false,quality:"pending",published:false}
  action wrongCheckout=all{s.quint=="pending",s.lemma=="pending",s'=s.with("sourceMatches",false)}
  action quintCompletes(result:str):bool=all{s.quint=="pending",
    s'=s.with("quint",if(result=="success" and not(s.sourceMatches)) "failure" else result)}
  action lemmaCompletes(result:str):bool=all{s.lemma=="pending",
    s'=s.with("lemma",if(result=="success" and not(s.sourceMatches)) "failure" else result)}
  action otherChecksComplete=all{not(s.otherChecks),s'=s.with("otherChecks",true)}
  action decide=all{s.quality=="pending",s.quint!="pending",s.lemma!="pending",s.otherChecks,
    s'=s.with("quality",if(s.quint=="success" and s.lemma=="success") "success" else "blocked")}
  action publish=all{s.quality=="success",s'=s.with("published",true)}
  action step={nondet result=oneOf(Set("success","failure","cancelled","skipped"))
    any{wrongCheckout,quintCompletes(result),lemmaCompletes(result),otherChecksComplete,decide,publish,s'=s}}
  val invariant=all{s.published implies s.sourceMatches and s.quint=="success" and s.lemma=="success" and s.otherChecks,
    s.quality=="success" implies s.quint=="success" and s.lemma=="success"}
  run cannotPublishWhileProofsArePendingTest=init.then(otherChecksComplete).then(publish.fail())
  run bothProofJobsAreRequiredTest=init.then(otherChecksComplete).then(quintCompletes("success"))
    .expect(s.quality=="pending" and s.lemma=="pending")
    .then(lemmaCompletes("success")).then(decide).then(publish).expect(s.published)
  run failedModelBlocksPublicationTest=init.then(otherChecksComplete).then(quintCompletes("failure"))
    .then(lemmaCompletes("success")).then(decide).then(publish.fail())
  run failedFunctionProofBlocksPublicationTest=init.then(otherChecksComplete).then(quintCompletes("success"))
    .then(lemmaCompletes("failure")).then(decide).then(publish.fail())
  run skippedProofDoesNotAuthorizePublicationTest=init.then(otherChecksComplete).then(quintCompletes("skipped"))
    .then(lemmaCompletes("success")).then(decide).then(publish.fail())
  run cancelledProofDoesNotAuthorizePublicationTest=init.then(otherChecksComplete).then(quintCompletes("success"))
    .then(lemmaCompletes("cancelled")).then(decide).then(publish.fail())
  run mismatchedCheckoutCannotPassTest=init.then(wrongCheckout).then(quintCompletes("success"))
    .then(lemmaCompletes("success")).then(otherChecksComplete).then(decide).expect(s.quality=="blocked")
}
