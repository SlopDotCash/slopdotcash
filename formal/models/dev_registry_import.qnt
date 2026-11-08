// @source scripts/dev-project-registry.ts
// @source scripts/dev-identity-bridge.ts
// Existing local mutations are preserved. Import may advance only an unchanged
// last-imported manifest with matching immutable history and no foreign repo
// owner. OAuth bridge delegates remote identity and issues its own one-use token.
module dev_registry_import {
  var s: {phase:str,localChanged:bool,historyMatches:bool,repositoryFree:bool,
    localRevision:int,importRevision:int,imported:bool,token:str,consumed:bool,flow:bool,polling:bool,restart:bool}
  action init = s'={phase:"new",localChanged:false,historyMatches:false,
    repositoryFree:false,localRevision:1,importRevision:2,imported:false,token:"none",consumed:false,flow:false,polling:false,restart:false}
  action inspect(changed,history,free) = all {s.phase=="new",
    s'=s.with("phase","checked").with("localChanged",changed)
      .with("historyMatches",history).with("repositoryFree",free)}
  action importRegistry = all {s.phase=="checked",not(s.localChanged),s.historyMatches,s.repositoryFree,
    s.importRevision>=s.localRevision,s'=s.with("phase","imported").with("localRevision",s.importRevision).with("imported",true)}
  action startFlow(unexpired) = all {not(s.flow),not(s.polling),unexpired,s.token=="none",s'=s.with("flow",true).with("restart",false)}
  action beginPoll = all {s.flow,not(s.polling),s'=s.with("polling",true)}
  action expireFlow = all {s.flow,s'=s.with("flow",false)}
  // The remote response has already authenticated the identity. The flow is
  // deleted before the local write, including when that local write fails.
  action issueToken(remoteIdentity,originMatches,stored) = all {s.token=="none",s.polling,
    remoteIdentity,originMatches,s'=s.with("token",if(stored) "issued" else "none")
      .with("flow",false).with("polling",false).with("restart",not(stored))}
  action consumeToken = all {s.token=="issued",not(s.consumed),s'=s.with("consumed",true)}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf()
    any {inspect(a,b,c),importRegistry,startFlow(a),beginPoll,expireFlow,issueToken(a,b,c),consumeToken,s'=s}}
  val invariant = all {s.imported implies (not(s.localChanged) and s.historyMatches and s.repositoryFree),
    s.localRevision>=1,s.consumed implies s.token=="issued"}
  run localEditNotReplacedTest = init.then(inspect(true,true,true)).then(importRegistry.fail())
  run foreignRepositoryOwnerPreservedTest = init.then(inspect(false,true,false)).then(importRegistry.fail())
  run importAdvancesUneditedSnapshotTest = init.then(inspect(false,true,true)).then(importRegistry)
    .expect(s.localRevision==2 and invariant)
  run failedAssertionWriteRequiresNewFlowTest = init.then(startFlow(true)).then(beginPoll).then(issueToken(true,true,false)).expect(s.restart and not(s.flow) and s.token=="none")
  run expiryDuringRemotePollTest = init.then(startFlow(true)).then(beginPoll).then(expireFlow).then(issueToken(true,true,true)).expect(s.token=="issued")
  run localAssertionOneUseTest = init.then(startFlow(true)).then(beginPoll).then(issueToken(true,true,true)).then(consumeToken).then(consumeToken.fail())
}
