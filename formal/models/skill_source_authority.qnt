// @source skills/project-contributor-template/scripts/skill-authority.mjs
// @source scripts/skill-source-matches-commit.mjs
// Exact file set, immutable commit/blob bytes, manifest digest and permitted
// project state all precede admission. Transient transport repeats at most3;
// authority/size/hash errors do not retry. API credentials never reach raw origin.
module skill_source_authority {
  type S = { attempts: int, transport: str, files: bool, blobs: bool, manifest: bool,
    open: bool, admitted: bool, tokenLeaked: bool }
  var s: S
  action init = s' = { attempts:0,transport:"new",files:false,blobs:false,manifest:false,open:false,admitted:false,tokenLeaked:false }
  action fetch = all { Set("new","retry").contains(s.transport),s.attempts<3,s'=s.with("attempts",s.attempts+1).with("transport","reading") }
  action transient = all { s.transport=="reading",s'=s.with("transport","retry") }
  action integrityFailure = all { s.transport=="reading",s'=s.with("transport","refused") }
  action complete = all { s.transport=="reading",s'=s.with("transport","done") }
  action compare(files: bool, blobs: bool, manifest: bool): bool = all { s.transport=="done",not(s.admitted),s'=s.with("files",files).with("blobs",blobs).with("manifest",manifest) }
  action currentProject(open: bool): bool = all { not(s.admitted),s'=s.with("open",open) }
  action admit = all { s.files,s.blobs,s.manifest,s.open,s'=s.with("admitted",true) }
  action step = any { fetch,transient,integrityFailure,complete,compare(true,true,true),compare(false,true,true),compare(true,false,true),currentProject(true),currentProject(false),admit,s'=s }
  val invariant = all { not(s.tokenLeaked),s.attempts<=3,s.admitted implies s.files and s.blobs and s.manifest and s.open }
  run transientMayRetryTest = init.then(fetch).then(transient).then(fetch).then(complete).then(compare(true,true,true)).then(currentProject(true)).then(admit).expect(invariant)
  run digestFailureCannotRetryTest = init.then(fetch).then(integrityFailure).then(fetch.fail())
  run extraFileRefusedTest = init.then(fetch).then(complete).then(compare(false,true,true)).then(currentProject(true)).then(admit.fail())
  run pausedProjectRefusedTest = init.then(fetch).then(complete).then(compare(true,true,true)).then(currentProject(false)).then(admit.fail())
}
