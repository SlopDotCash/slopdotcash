// @source scripts/ci-scope.mjs
// @source .github/workflows/deploy.yml
// @source playwright.config.ts
// Two browser engines and four lane kinds. The selected test suites determine
// required engines. Download failure or later binary loss remains a failure;
// an installer exit alone does not prove the actual browser will launch.
module ci_browser_runtime {
  var s: { lane: str, phase: str, planned: Set[int], installed: Set[int] }
  def required(lane) = if(lane == "preview" or lane == "registry") Set(1, 2) else Set(1)
  action init = {
    nondet lane = Set("preview", "registry", "pages", "smoke").oneOf()
    s' = {lane:lane,phase:"new",planned:Set(),installed:Set()}
  }
  action choosePlan = all {s.phase=="new",
    s'=s.with("phase","selected").with("planned",required(s.lane))}
  action install = all {s.phase=="selected",
    s'=s.with("phase","installed").with("installed",s.planned)}
  action downloadFails = all {s.phase=="selected",s'=s.with("phase","failed")}
  action binaryDisappears = all {s.phase=="installed",s.installed.contains(2),
    s'=s.with("installed",s.installed.exclude(Set(2)))}
  action launch = all {s.phase=="installed",
    s'=s.with("phase",if(required(s.lane).subseteq(s.installed)) "passed" else "failed")}
  action step = any {choosePlan,install,downloadFails,binaryDisappears,launch,s'=s}
  val invariant = all {
    s.phase!="new" implies required(s.lane).subseteq(s.planned),
    s.phase=="passed" implies required(s.lane).subseteq(s.installed),
  }
  action preview = s'={lane:"preview",phase:"new",planned:Set(),installed:Set()}
  action pages = s'={lane:"pages",phase:"new",planned:Set(),installed:Set()}
  run previewInstallsBothEnginesTest = preview.then(choosePlan).then(install).then(launch)
    .expect(s.phase=="passed" and s.installed==Set(1,2))
  run pagesRequiresOnlyChromiumTest = pages.then(choosePlan).then(install).then(launch)
    .expect(s.phase=="passed" and s.installed==Set(1))
  run failedDownloadCannotPassTest = preview.then(choosePlan).then(downloadFails).expect(s.phase=="failed")
  run lostFirefoxFailsAtLaunchTest = preview.then(choosePlan).then(install).then(binaryDisappears).then(launch)
    .expect(s.phase=="failed")
}
