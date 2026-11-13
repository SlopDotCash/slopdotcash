// @source scripts/check-formal.mjs
// @source scripts/quint-local-translator.mjs
// @source scripts/quint-safety-view.mjs
// @source formal/tlc-safety-views.json
// @source scripts/formal-inventory.mjs
// @source scripts/formal-state-catalog.mjs
// @source scripts/check-lemmascript.mjs
// @source scripts/generate-jupiter-decoder.mjs
// @source scripts/lemmascript-integrity.mjs
// @source scripts/lemmascript-inventory.mjs
// @source scripts/setup-lemmascript.sh
// @source scripts/install-ci-chromium.sh
// @source scripts/install-value-merge-git.ts
// @source .github/workflows/formal.yml
// @source .github/workflows/lemmascript.yml
// @source package.json
// Verification result != whole-application coverage. A run binds exact source
// bytes and tools; assumptions, omitted bodies and changed inputs cannot be a
// passing proof. Two selected inputs and two unreviewed inputs bound the model.
// toolsPinned abstracts the pinned lockfile/CI installer for Quint and the
// explicit version checks for LemmaScript/Dafny. It is not a claim that the
// Quint checker itself rejects a locally substituted executable version.
module formal_toolchain {
  var s: {phase:str,toolsPinned:bool,inputsStable:bool,bodyMatches:bool,
    assumptions:bool,checked:Set[int],selected:Set[int],failed:bool,
    publishedResult:bool,checkPassed:bool,pending:int,view:str,
    viewSource:int,viewTla:int,viewOperator:int,viewAdapter:int,viewTemporal:bool}
  action init = s'={phase:"new",toolsPinned:false,inputsStable:true,bodyMatches:false,
    assumptions:false,checked:Set(),selected:Set(1,2),failed:false,
    publishedResult:false,checkPassed:false,pending:2,view:"full",
    viewSource:0,viewTla:0,viewOperator:0,viewAdapter:0,viewTemporal:false}
  action prepare(pinned,bodyMatches,assumptions) = all {s.phase=="new",
    s'=s.with("phase","prepared").with("toolsPinned",pinned)
      .with("bodyMatches",bodyMatches).with("assumptions",assumptions)}
  action check(id,passed) = all {s.phase=="prepared",s.toolsPinned,s.bodyMatches,
    not(s.assumptions),s.view!="refused",s.selected.contains(id),
    s'=s.with("checked",s.checked.union(Set(id))).with("failed",s.failed or not(passed))}
  // 1 names the exact reviewed source/TLA/operator/adapter; 0 is a different
  // value. No hash validity or projection-independence theorem is assumed here.
  action requestView(source:int,tla:int,operator:int,adapter:int,wantsTemporal:bool):bool={
    val accepted=source==1 and tla==1 and operator==1 and adapter==1 and not(wantsTemporal)
    all{s.phase=="prepared",s.view=="full",s.checked==Set(),
      s'=s.with("view",if(accepted)"bound" else "refused")
        .with("viewSource",source).with("viewTla",tla).with("viewOperator",operator)
        .with("viewAdapter",adapter).with("viewTemporal",wantsTemporal)
        .with("failed",s.failed or not(accepted))}}
  action chooseView={nondet source=Set(0,1).oneOf() nondet tla=Set(0,1).oneOf()
    nondet operator=Set(0,1).oneOf() nondet adapter=Set(0,1).oneOf()
    nondet wantsTemporal=Set(false,true).oneOf() requestView(source,tla,operator,adapter,wantsTemporal)}
  action inputsChange = all {not(s.publishedResult),s'=s.with("inputsStable",false)}
  action cancel = all {s.phase=="prepared",s'=s.with("failed",true)}
  action publish = all {s.phase=="prepared",s.selected.subseteq(s.checked) or s.failed,
    s'=s.with("phase","reported").with("publishedResult",true)
      .with("checkPassed",s.inputsStable and not(s.failed))}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() nondet id=Set(1,2).oneOf()
    any {prepare(a,b,c),chooseView,check(id,a),inputsChange,cancel,publish,s'=s}}
  val invariant = all {
    s.checkPassed implies (s.toolsPinned and s.inputsStable and s.bodyMatches and not(s.assumptions) and not(s.failed)),
    s.checkPassed implies s.selected.subseteq(s.checked),s.pending==2,
    s.view=="bound" implies(s.viewSource==1 and s.viewTla==1 and s.viewOperator==1
      and s.viewAdapter==1 and not(s.viewTemporal)),
    s.view=="refused" implies(s.failed and not(s.checkPassed)),
  }
  run selectedSuccessIsNotFullCoverageTest = init.then(prepare(true,true,false)).then(check(1,true))
    .then(check(2,true)).then(publish).expect(s.checkPassed and s.pending>0 and invariant)
  run changedSourceFailsRunTest = init.then(prepare(true,true,false)).then(check(1,true))
    .then(check(2,true)).then(inputsChange).then(publish).expect(not(s.checkPassed))
  run assumptionCannotVerifyTest = init.then(prepare(true,true,true)).then(check(1,true).fail())
  run changedBodyCannotVerifyTest = init.then(prepare(true,false,false)).then(check(1,true).fail())
  run failedCheckCannotBecomeSuccessTest = init.then(prepare(true,true,false)).then(check(1,false))
    .then(check(2,true)).then(publish).expect(not(s.checkPassed))
  run canceledPartialRunReportsFailureTest = init.then(prepare(true,true,false)).then(check(1,true))
    .then(cancel).then(publish).expect(s.publishedResult and not(s.checkPassed) and s.checked==Set(1))
  run failedPartialRunReportsFailureTest = init.then(prepare(true,true,false)).then(check(1,false))
    .then(publish).expect(s.publishedResult and not(s.checkPassed) and s.checked==Set(1))
  run reviewedSafetyViewCanPassTest=init.then(prepare(true,true,false))
    .then(requestView(1,1,1,1,false)).then(check(1,true)).then(check(2,true)).then(publish)
    .expect(s.checkPassed and s.view=="bound")
  run changedViewSourceCannotCheckTest=init.then(prepare(true,true,false))
    .then(requestView(0,1,1,1,false)).then(check(1,true).fail())
  run changedViewTlaCannotCheckTest=init.then(prepare(true,true,false))
    .then(requestView(1,0,1,1,false)).then(check(1,true).fail())
  run unknownViewOperatorCannotCheckTest=init.then(prepare(true,true,false))
    .then(requestView(1,1,0,1,false)).then(check(1,true).fail())
  run changedViewAdapterCannotCheckTest=init.then(prepare(true,true,false))
    .then(requestView(1,1,1,0,false)).then(check(1,true).fail())
  run unreviewedViewTemporalCannotCheckTest=init.then(prepare(true,true,false))
    .then(requestView(1,1,1,1,true)).then(check(1,true).fail())
}
