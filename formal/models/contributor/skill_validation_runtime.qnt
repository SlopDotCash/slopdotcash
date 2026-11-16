// @source scripts/skill-python.mjs
// @source scripts/skill-validation/quick_validate.py
// Runtime selection tries pinned PyYAML interpreters before the pinned uv
// fallback. A readable real directory plus valid bounded YAML gates packaging.
module skill_validation_runtime {
  type S = { tried: int, runtime: bool, realDirectory: bool, bounded: bool, yaml: bool, valid: bool }
  var s: S
  action init = s' = { tried:0,runtime:false,realDirectory:false,bounded:false,yaml:false,valid:false }
  action probe(matches: bool): bool = all { not(s.runtime),s.tried<4,s'=s.with("tried",s.tried+1).with("runtime",matches) }
  action inspect(realDirectory: bool, bounded: bool, yaml: bool): bool = all { not(s.valid),s'=s.with("realDirectory",realDirectory).with("bounded",bounded).with("yaml",yaml) }
  action validate = all { s.runtime,s.realDirectory,s.bounded,s.yaml,s'=s.with("valid",true) }
  action step = any { probe(true),probe(false),inspect(true,true,true),inspect(false,true,true),inspect(true,false,true),inspect(true,true,false),validate,s'=s }
  val invariant = s.valid implies s.runtime and s.realDirectory and s.bounded and s.yaml
  run fallbackAfterUnavailableRuntimeTest = init.then(probe(false)).then(probe(true)).then(inspect(true,true,true)).then(validate).expect(invariant)
  run symlinkRefusedTest = init.then(probe(true)).then(inspect(false,true,true)).then(validate.fail())
  run invalidYamlRefusedTest = init.then(probe(true)).then(inspect(true,true,false)).then(validate.fail())
}
