// @source scripts/release-vetting-backup.mjs
// @source scripts/release-vetting-sandbox.mjs
// @source scripts/prepare-vetting-public-key.ts
// @source scripts/prepare-vetting-sandbox.mjs
// @source scripts/qualify-vetting-sandbox.ts
// @source .github/workflows/vetting-recovery-qualification.yml
// @source .github/workflows/vetting-sandbox-qualification.yml
// @source .github/workflows/vetting-sandbox.yml
// @source scripts/worker-release.mjs
// Publication can be partial; exact post-release readback is separate from a
// successful upload. Staging probe success does not activate retention or prove
// an actual security assessment. Sandbox qualification binds image/key/private
// service identity. Backup deployment instead verifies its sole active version
// and source tag; it has neither a container image nor a probe qualification.
module service_release_identity {
  var s: {phase:str,mode:str,authorized:bool,source:int,image:int,key:int,
    published:bool,bindingPrivate:bool,readback:int,probes:bool,verified:bool}
  action init = s'={phase:"plan",mode:"sandbox",authorized:false,source:1,image:0,key:0,
    published:false,bindingPrivate:false,readback:0,probes:false,verified:false}
  action backup = all {s.phase=="plan",s'=s.with("mode","backup")}
  action authorize(exact) = all {s.phase=="plan",exact,
    s'=s.with("phase","build").with("authorized",true)}
  action prepare(keyMatches) = all {s.phase=="build",s.mode=="backup" or keyMatches,
    s'=s.with("phase","prepared").with("image",if(s.mode=="sandbox") 1 else 0)
      .with("key",if(s.mode=="sandbox") 1 else 0)}
  action publish = all {s.phase=="prepared",s.authorized,
    s'=s.with("phase","published").with("published",true)}
  action readback(exact,privateBinding) = all {s.phase=="published",exact,s.mode=="backup" or privateBinding,
    s'=s.with("phase",if(s.mode=="backup") "verified" else "probing")
      .with("readback",1).with("bindingPrivate",s.mode=="sandbox")
      .with("verified",s.mode=="backup")}
  action probe = all {s.phase=="probing",s.bindingPrivate,
    s'=s.with("probes",true)}
  action confirm(exact) = all {s.phase=="probing",s.probes,exact,
    s'=s.with("phase","verified").with("verified",true)}
  action failure = all {not(s.verified),s'=s.with("phase","failed")}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    any {backup,authorize(a),prepare(a),publish,readback(a,b),probe,confirm(a),failure,s'=s}}
  val invariant = all {s.published implies s.authorized,
    s.published and s.mode=="sandbox" implies (s.image==1 and s.key==1),
    s.verified implies (s.published and s.readback==s.source),
    s.verified and s.mode=="sandbox" implies (s.bindingPrivate and s.probes)}
  run publicationIsNotVerificationTest = init.then(authorize(true)).then(prepare(true)).then(publish)
    .expect(s.published and not(s.verified))
  run keyRotationRequiresSeparateAuthorityTest = init.then(authorize(true)).then(prepare(false).fail())
  run changedDeploymentCannotPassTest = init.then(authorize(true)).then(prepare(true)).then(publish)
    .then(readback(true,true)).then(probe).then(confirm(false).fail())
  run exactPrivateQualificationTest = init.then(authorize(true)).then(prepare(true)).then(publish)
    .then(readback(true,true)).then(probe).then(confirm(true)).expect(s.verified and invariant)
  run backupSourceReadbackNeedsNoContainerTest = init.then(backup).then(authorize(true))
    .then(prepare(false)).then(publish).then(readback(true,false))
    .expect(s.verified and s.image==0 and s.key==0 and not(s.probes) and invariant)
  run backupMismatchedSourceRefusedTest = init.then(backup).then(authorize(true))
    .then(prepare(false)).then(publish).then(readback(false,false).fail())
}
