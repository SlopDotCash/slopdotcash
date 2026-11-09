// @source skills/project-contributor-template/scripts/skill-authority.mjs
// @source scripts/skill-source-matches-commit.mjs
// Exact immutable file/blob bytes precede admission. Generated roles also bind
// a D1 manifest; only generated contributors require an observed open project.
// Static skills reject a registry binding. Transient transport repeats at most3;
// authority/size/hash errors do not retry. API credentials never reach raw origin.
module skill_source_authority {
  type S = { role: str, binding: bool, attempts: int, transport: str,
    files: bool, blobs: bool, manifest: bool, open: bool,
    admitted: bool, tokenLeaked: bool }
  var s: S
  action init = s' = { role:"contributor",binding:true,attempts:0,transport:"new",files:false,blobs:false,manifest:false,open:false,admitted:false,tokenLeaked:false }
  action selectRole(role: str, binding: bool): bool = all {
    s.attempts==0, Set("static","contributor","reviewer").contains(role),
    s'=s.with("role",role).with("binding",binding) }
  action fetch = all { Set("new","retry").contains(s.transport),s.attempts<3,s'=s.with("attempts",s.attempts+1).with("transport","reading") }
  action transient = all { s.transport=="reading",s'=s.with("transport","retry") }
  action integrityFailure = all { s.transport=="reading",s'=s.with("transport","refused") }
  action complete = all { s.transport=="reading",s'=s.with("transport","done") }
  action compare(files: bool, blobs: bool, manifest: bool): bool = all { s.transport=="done",not(s.admitted),s'=s.with("files",files).with("blobs",blobs).with("manifest",manifest) }
  action currentProject(open: bool): bool = all { not(s.admitted),s'=s.with("open",open) }
  val roleAuthority = if (s.role=="static") not(s.binding)
    else s.binding and s.manifest and (s.role!="contributor" or s.open)
  action admit = all { s.transport=="done",s.files,s.blobs,roleAuthority,
    s'=s.with("admitted",true) }
  action step = {
    nondet role = Set("static","contributor","reviewer").oneOf()
    nondet binding = Set(false,true).oneOf()
    any { selectRole(role,binding),fetch,transient,integrityFailure,complete,
      compare(true,true,true),compare(false,true,true),compare(true,false,true),
      compare(true,true,false),currentProject(true),currentProject(false),admit,s'=s }
  }
  val invariant = all { not(s.tokenLeaked),s.attempts<=3,
    s.admitted implies s.files and s.blobs and roleAuthority }
  run transientMayRetryTest = init.then(fetch).then(transient).then(fetch).then(complete).then(compare(true,true,true)).then(currentProject(true)).then(admit).expect(invariant)
  run digestFailureCannotRetryTest = init.then(fetch).then(integrityFailure).then(fetch.fail())
  run extraFileRefusedTest = init.then(fetch).then(complete).then(compare(false,true,true)).then(currentProject(true)).then(admit.fail())
  run pausedProjectRefusedTest = init.then(fetch).then(complete).then(compare(true,true,true)).then(currentProject(false)).then(admit.fail())
  run staticSkillNeedsNoRegistryTest = init.then(selectRole("static",false))
    .then(fetch).then(complete).then(compare(true,true,false)).then(admit)
    .expect(s.admitted and not(s.open) and not(s.manifest))
  run staticSkillRejectsRegistryBindingTest = init.then(selectRole("static",true))
    .then(fetch).then(complete).then(compare(true,true,true)).then(admit.fail())
  run reviewerDoesNotRequireOpenProjectTest = init.then(selectRole("reviewer",true))
    .then(fetch).then(complete).then(compare(true,true,true)).then(admit)
    .expect(s.admitted and not(s.open))
  run reviewerStillNeedsManifestTest = init.then(selectRole("reviewer",true))
    .then(fetch).then(complete).then(compare(true,true,false)).then(admit.fail())
  run contributorNeedsBindingTest = init.then(selectRole("contributor",false))
    .then(fetch).then(complete).then(compare(true,true,true)).then(currentProject(true))
    .then(admit.fail())
  run reviewerNeedsBindingTest = init.then(selectRole("reviewer",false))
    .then(fetch).then(complete).then(compare(true,true,true)).then(admit.fail())
  run staticSkillStillNeedsExactBytesTest = init.then(selectRole("static",false))
    .then(fetch).then(complete).then(compare(true,false,false)).then(admit.fail())
}
