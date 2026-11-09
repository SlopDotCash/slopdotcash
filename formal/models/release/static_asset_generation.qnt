// @source scripts/generate-sitemap.ts
// @source scripts/render-social-images.mjs
// @source scripts/sync-brand-tokens.mjs
// One/two output build operations. A failed second output can leave a partial
// local artifact set; it cannot be reported as a successful complete build.
module static_asset_generation {
  var s: {phase:str,kind:str,inputs:bool,browserOpen:bool,fonts:bool,layout:bool,
    outputs:int,expected:int,success:bool,closed:bool}
  action initialize(kind) = s'={phase:"new",kind:kind,inputs:false,browserOpen:false,fonts:false,layout:false,
    outputs:0,expected:if(kind=="social") 2 else 1,success:false,closed:false}
  action init = {nondet kind=Set("social","sitemap","brand").oneOf() initialize(kind)}
  action prepare = all {s.phase=="new",s'=s.with("phase","ready").with("inputs",true)}
  action render = all {s.phase=="ready",s.kind=="social",s'=s.with("browserOpen",true).with("fonts",true).with("layout",true)}
  action write = all {s.phase=="ready",s.inputs,s.outputs<s.expected,
    s.kind!="social" or (s.browserOpen and s.fonts and s.layout),
    s'=s.with("outputs",s.outputs+1)}
  action finish = all {s.phase=="ready",s.outputs==s.expected,
    s'=s.with("phase","complete").with("success",true).with("closed",true).with("browserOpen",false)}
  action failBuild = all {Set("new","ready").contains(s.phase),s'=s.with("phase","failed").with("closed",true).with("browserOpen",false)}
  action step = any {prepare,render,write,finish,failBuild,s'=s}
  val invariant = all {s.outputs<=s.expected,s.success implies (s.inputs and s.outputs==s.expected),
    Set("complete","failed").contains(s.phase) implies s.closed and not(s.browserOpen)}
  run partialOutputIsNotSuccessTest = initialize("social").then(prepare).then(render).then(write).then(failBuild)
    .expect(s.outputs==1 and not(s.success) and s.closed)
  run invalidInputLeavesNoBrowserTest = initialize("social").then(failBuild).expect(s.outputs==0 and not(s.browserOpen) and not(s.success))
  run fullOutputTest = initialize("social").then(prepare).then(render).then(write).then(write).then(finish)
    .expect(s.success and invariant)
}
