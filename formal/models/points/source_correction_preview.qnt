// @source scripts/source-correction.ts
// @source scripts/prepare-source-correction.ts
// A recovered review needs matching immutable inputs and new ID/source/URL.
// Output is a create-only preview; published cycles, active preparations and
// payment authority do not change. Two actors share a fixed four-unit pool.
module source_correction_preview {
  type S={inputs:bool,sourceNew:bool,actorKnown:bool,cyclePublished:bool,outputExists:bool,recovered:bool,written:bool,a:int,b:int,paid:bool,activeChanged:bool}
  var s:S
  action init=s'={inputs:false,sourceNew:false,actorKnown:false,cyclePublished:false,outputExists:false,recovered:false,written:false,a:2,b:2,paid:false,activeChanged:false}
  action inspect(inputs:bool,newSource:bool,known:bool,published:bool,alreadyExists:bool):bool=all{not(s.recovered),s'=s.with("inputs",inputs).with("sourceNew",newSource).with("actorKnown",known).with("cyclePublished",published).with("outputExists",alreadyExists)}
  action recover=all{s.inputs,s.sourceNew,s.actorKnown,not(s.cyclePublished),s'=s.with("recovered",true).with("a",3).with("b",1)}
  action write=all{s.recovered,not(s.outputExists),s'=s.with("written",true).with("outputExists",true)}
  action step=any{inspect(true,true,true,false,false),inspect(false,true,true,false,false),inspect(true,false,true,false,false),inspect(true,true,true,true,false),inspect(true,true,true,false,true),recover,write,s'=s}
  val invariant=all{s.a+s.b==4,not(s.paid),not(s.activeChanged),s.written implies s.recovered}
  run previewOnlyTest=init.then(inspect(true,true,true,false,false)).then(recover).then(write).expect(invariant)
  run duplicateSourceRefusedTest=init.then(inspect(true,false,true,false,false)).then(recover.fail())
  run publishedCycleRefusedTest=init.then(inspect(true,true,true,true,false)).then(recover.fail())
  run existingOutputNotOverwrittenTest=init.then(inspect(true,true,true,false,true)).then(recover).then(write.fail())
}
