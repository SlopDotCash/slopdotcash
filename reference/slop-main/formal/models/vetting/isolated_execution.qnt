// @source workers/vetting-sandbox/index.ts
// @source workers/vetting-sandbox/supervise.py
// @source workers/vetting-sandbox/probes.ts
// Per-run state; fresh container ID, no inherited environment and no network.
// OS enforcement is an external assumption checked by native probe workflows.
// Destruction failure is allowed to fail the request; it cannot claim cleanup.
module isolated_execution {
  var s: { phase: str, digest: bool, supported: bool, fresh: bool,
    restricted: bool, network: bool, status: str, completeOutput: bool,
    children: bool, destroyed: bool, response: bool }
  action init = s'={ phase:"new",digest:false,supported:false,fresh:false,
    restricted:false,network:false,status:"none",completeOutput:false,
    children:false,destroyed:false,response:false }
  action inspect(digest, supported) = all { s.phase=="new",
    s'=s.with("phase","inspected").with("digest",digest).with("supported",supported) }
  action allocate = all { s.phase=="inspected",s.digest,s.supported,
    s'=s.with("phase","allocated").with("fresh",true) }
  action restrict = all { s.phase=="allocated",s.fresh,
    s'=s.with("restricted",true) }
  action execute = all { s.phase=="allocated",s.restricted,
    s'=s.with("phase","running").with("children",true) }
  action finish(status) = all { s.phase=="running",Set("exited","timeout","output-limit","not-executable").contains(status),
    s'=s.with("phase","finished").with("status",status).with("completeOutput",status=="exited")
      .with("children",false) }
  action destroy = all { s.phase=="finished",not(s.children),
    s'=s.with("phase","destroyed").with("destroyed",true) }
  action respond = all { s.phase=="destroyed",s'=s.with("response",true) }
  action step = { nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet status=Set("exited","timeout","output-limit","not-executable").oneOf()
    any { inspect(a,b),allocate,restrict,execute,finish(status),destroy,respond,s'=s } }
  val invariant = all {
    not(s.network), s.children implies (s.fresh and s.restricted and s.digest),
    s.completeOutput implies s.status=="exited",
    s.response implies (s.destroyed and not(s.children)),
  }
  run badDigestCannotExecuteTest = init.then(inspect(false,true)).then(allocate.fail())
  run restrictionPrecedesExecutionTest = init.then(inspect(true,true)).then(allocate).then(execute.fail())
  run outputLimitIsIncompleteTest = init.then(inspect(true,true)).then(allocate).then(restrict).then(execute)
    .then(finish("output-limit")).then(destroy).then(respond).expect(not(s.completeOutput) and invariant)
  run timeoutTerminatesChildrenTest = init.then(inspect(true,true)).then(allocate).then(restrict).then(execute)
    .then(finish("timeout")).then(destroy).then(respond).expect(not(s.children) and invariant)
}
