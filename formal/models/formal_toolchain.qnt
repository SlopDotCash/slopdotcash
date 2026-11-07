// @source scripts/check-formal.mjs
// @source scripts/formal-inventory.mjs
// @source scripts/formal-state-catalog.mjs
// @source scripts/check-lemmascript.mjs
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
    publishedResult:bool,checkPassed:bool,pending:int}
  action init = s'={phase:"new",toolsPinned:false,inputsStable:true,bodyMatches:false,
    assumptions:false,checked:Set(),selected:Set(1,2),failed:false,
    publishedResult:false,checkPassed:false,pending:2}
  action prepare(pinned,bodyMatches,assumptions) = all {s.phase=="new",
    s'=s.with("phase","prepared").with("toolsPinned",pinned)
      .with("bodyMatches",bodyMatches).with("assumptions",assumptions)}
  action check(id,passed) = all {s.phase=="prepared",s.toolsPinned,s.bodyMatches,
    not(s.assumptions),s.selected.contains(id),
    s'=s.with("checked",s.checked.union(Set(id))).with("failed",s.failed or not(passed))}
  action inputsChange = all {not(s.publishedResult),s'=s.with("inputsStable",false)}
  action publish = all {s.phase=="prepared",s.selected.subseteq(s.checked),
    s'=s.with("phase","reported").with("publishedResult",true)
      .with("checkPassed",s.inputsStable and not(s.failed))}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() nondet id=Set(1,2).oneOf()
    any {prepare(a,b,c),check(id,a),inputsChange,publish,s'=s}}
  val invariant = all {
    s.checkPassed implies (s.toolsPinned and s.inputsStable and s.bodyMatches and not(s.assumptions) and not(s.failed)),
    s.checkPassed implies s.selected.subseteq(s.checked),s.pending==2,
  }
  run selectedSuccessIsNotFullCoverageTest = init.then(prepare(true,true,false)).then(check(1,true))
    .then(check(2,true)).then(publish).expect(s.checkPassed and s.pending>0 and invariant)
  run changedSourceFailsRunTest = init.then(prepare(true,true,false)).then(check(1,true))
    .then(check(2,true)).then(inputsChange).then(publish).expect(not(s.checkPassed))
  run assumptionCannotVerifyTest = init.then(prepare(true,true,true)).then(check(1,true).fail())
  run changedBodyCannotVerifyTest = init.then(prepare(true,false,false)).then(check(1,true).fail())
  run failedCheckCannotBecomeSuccessTest = init.then(prepare(true,true,false)).then(check(1,false))
    .then(check(2,true)).then(publish).expect(not(s.checkPassed))
}
