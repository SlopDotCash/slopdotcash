// @source vite.config.ts
// @source playwright.config.ts
// @source scripts/run-integration.mjs
// @source scripts/account-closure-server.ts
// @source scripts/vault-setup-browser-server.ts
// @source scripts/test-payout-browser.mjs
// @source scripts/prepare-e2e-fixture.mjs
// @source scripts/copy-working-tree.mjs
// Local process ownership. Closing a server fences an outstanding asynchronous
// health read before it may start a child. A received nonmatching health
// response refuses reuse and does not spawn; only transport failure spawns.
// This is a partial process-ownership model, not each fixture driver protocol. Fixture outputs are distinct from
// shipped artifacts; local synthetic sessions are not production identity.
module dev_server_lifecycle {
  var s: {phase:str,health:str,closed:bool,child:bool,fixture:bool,
    published:bool,passed:bool}
  action init = s'={phase:"new",health:"none",closed:false,child:false,
    fixture:true,published:false,passed:false}
  action listen = all {s.phase=="new",s'=s.with("phase","listening").with("health","pending")}
  action close = all {not(s.closed),s'=s.with("closed",true).with("child",false).with("phase","closed")}
  action healthFails = all {s.health=="pending",s'=s.with("health","failed")
    .with("child",not(s.closed))}
  action healthMismatch = all {s.health=="pending",s'=s.with("health","mismatch").with("phase",if(s.closed) "closed" else "blocked")}
  action healthMatches = all {s.health=="pending",s'=s.with("health","matching")}
  action test = all {s.phase=="listening",not(s.closed),s.health!="pending",
    s'=s.with("passed",true)}
  action step = any {listen,close,healthFails,healthMismatch,healthMatches,test,s'=s}
  val invariant = all {s.closed implies not(s.child),not(s.published),
    s.child implies s.health=="failed"}
  run closedWhileHealthPendingTest = init.then(listen).then(close).then(healthFails)
    .expect(not(s.child) and s.closed and invariant)
  run occupiedWrongOriginRefusesSpawnTest = init.then(listen).then(healthMismatch).expect(not(s.child) and s.phase=="blocked")
  run ownedChildStoppedTest = init.then(listen).then(healthFails).then(close).expect(not(s.child) and invariant)
  run reusedServerNotOwnedTest = init.then(listen).then(healthMatches).then(test)
    .expect(s.passed and not(s.child) and invariant)
}
