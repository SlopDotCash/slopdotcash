// @source scripts/check-formal.mjs
// @source scripts/quint-local-translator.mjs
// One pinned translation and one model check. The Java parser and TLC are
// trusted boundaries; this model covers the wrapper's publication lifecycle.
module formal_translation {
  var s: {phase:str, pinned:bool, inputBound:bool, temporary:bool,
    translated:bool, passed:bool, published:bool, server:bool}
  action init = s'={phase:"new",pinned:false,inputBound:true,temporary:false,
    translated:false,passed:false,published:false,server:false}
  action prepare(pinned) = all {s.phase=="new",
    s'=s.with("pinned",pinned).with("phase",if(pinned) "prepared" else "failed")}
  action parse(ok) = all {s.phase=="prepared",s.pinned,
    s'=s.with("temporary",true).with("translated",ok)
      .with("phase",if(ok) "translated" else "failed")}
  action check(ok) = all {s.phase=="translated",s.translated,
    s'=s.with("passed",ok).with("phase",if(ok) "checked" else "failed")}
  action changeInput = all {not(s.published),s'=s.with("inputBound",false)}
  action cleanup = all {Set("translated","checked","failed").contains(s.phase),
    s'=s.with("temporary",false)}
  action publish = all {Set("checked","failed").contains(s.phase),not(s.temporary),
    s'=s.with("published",true).with("passed",s.passed and s.inputBound)}
  action step = {nondet ok=Set(false,true).oneOf()
    any {prepare(ok),parse(ok),check(ok),changeInput,cleanup,publish,s'=s}}
  val invariant = all {not(s.server),
    s.published implies not(s.temporary),
    s.published and s.passed implies (s.pinned and s.inputBound and s.translated)}
  run localParserSuccessTest = init.then(prepare(true)).then(parse(true)).then(cleanup)
    .then(check(true)).then(publish).expect(s.passed and invariant)
  run wrongVersionRefusedTest = init.then(prepare(false)).then(publish)
    .expect(not(s.passed) and not(s.server))
  run parseFailureCleansTest = init.then(prepare(true)).then(parse(false)).then(cleanup)
    .then(publish).expect(not(s.passed) and not(s.temporary))
  run counterexampleFailsTest = init.then(prepare(true)).then(parse(true)).then(cleanup)
    .then(check(false)).then(publish).expect(not(s.passed))
  run changedInputFailsTest = init.then(prepare(true)).then(parse(true)).then(cleanup)
    .then(check(true)).then(changeInput).then(publish).expect(not(s.passed))
}
