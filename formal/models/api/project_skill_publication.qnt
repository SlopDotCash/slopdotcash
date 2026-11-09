// @source backend/projects/skill-publication.ts
// @source backend/pages.ts
// @source backend/vetting/persistence.ts
// @source src/lib/project-skill-publication.mjs
// @source src/lib/project-skill.mjs
// @source scripts/prepare-site.mjs
// @source functions/[[path]].ts
// @evidence scripts/project-registry-api.test.ts
// @evidence scripts/terms-preflight.test.ts
// Two requests, two projects/revisions/template identities, and four template
// files (two files per role). GET, HEAD and an unsupported method; artifact,
// terms, discovery and unmatched routes. Shape, rendering, signature/hash and
// registry-schema correctness are predicates rather than proofs here.
// Project and enforcement reads finish independently. All later operations
// use those captured records. Revisions, restrictions, activity and evidence
// may change while a request awaits; this model does not promise linearizable
// publication or immediate revocation of a response already in progress.
// The index is read once per request. Every listed file is checked against it.
// Declared aggregate templateSha256/renderer coherence comes from the trusted
// build; the runtime does not independently recompute that whole aggregate.
// Both roles finish before any selected artifact is exposed. An individual
// mismatch or later rendering failure returns 503, never an earlier role.
// Normal permanent admission does not require a fresh branch/template pin.
// The clearance predicate also records the separate reinstatement distinction;
// publication always requests normal admission. Full reinstatement, exemption
// and retained-evidence internals remain in the vetting model families.
// Returned unverified clearance filters discovery but produces 503 for an
// artifact. A thrown dependency failure fails the entire request. Terms bypass
// template and clearance, but not restrictions or retirement. Every handled
// response is no-store. HEAD has no body after the normal wrapper; the source's
// outer catch currently returns its text response directly, including a body
// at this function boundary. This does not assert what the HTTP host transmits.
// Existing workflow definitions cover only selected branches. These scenarios
// have not been parsed, simulated or executed; mappings are not refinement.
module project_skill_publication {
  val ids = Set(1, 2)
  val files = Set(1, 2, 3, 4)
  type Request = { phase: str, method: str, route: str, project: int,
    pathExists: bool, projectRead: bool, restrictionsRead: bool,
    present: Set[int], active: Set[int], published: Set[int], retired: Set[int],
    restrictions: Set[int], revisions: int -> int, candidates: Set[int],
    clearanceRead: Set[int], cleared: Set[int], template: int, fileCount: int,
    roles: Set[int], renderedRevision: int, status: int, body: bool,
    noStore: bool, caught: bool, delivered: bool }
  val idle: Request = { phase: "unused", method: "GET", route: "artifact", project: 1,
    pathExists: true, projectRead: false, restrictionsRead: false,
    present: Set(), active: Set(), published: Set(), retired: Set(), restrictions: Set(),
    revisions: ids.mapBy(_ => 0), candidates: Set(), clearanceRead: Set(), cleared: Set(),
    template: 0, fileCount: 0, roles: Set(), renderedRevision: 0, status: 0,
    body: false, noStore: false, caught: false, delivered: false }
  var s: { present: Set[int], active: Set[int], published: Set[int], retired: Set[int],
    restrictions: Set[int], revisions: int -> int, evidence: int -> str,
    template: int, assets: int -> int, livePin: int, requests: int -> Request }
  action init = s' = { present: ids, active: ids, published: ids, retired: Set(),
    restrictions: Set(), revisions: ids.mapBy(_ => 1), evidence: ids.mapBy(_ => "cleared"),
    template: 1, assets: files.mapBy(_ => 1), livePin: 1, requests: ids.mapBy(_ => idle) }
  def respond(request: Request, status: int, caught: bool): Request = request.with("phase", "response")
    .with("status", status).with("caught", caught).with("noStore", true)
    .with("body", request.method != "HEAD" or caught)
  def clearance(kind: str, reinstatement: bool, pinMatches: bool): str =
    if (kind == "cleared" and reinstatement and not(pinMatches)) "other" else kind
  def asset(file: int): int = if (files.contains(file)) s.assets.get(file) else 0
  action omit(project: int): bool = all { ids.contains(project), ids.forall(id => s.requests.get(id).phase == "unused"),
    s' = s.with("present", s.present.exclude(Set(project))) }
  action unpublish(project: int): bool = all { ids.contains(project),
    s' = s.with("published", s.published.exclude(Set(project))) }
  action pause(project: int): bool = all { ids.contains(project), s.active.contains(project),
    s' = s.with("active", s.active.exclude(Set(project))) }
  action retire(project: int): bool = all { ids.contains(project), not(s.retired.contains(project)),
    s' = s.with("retired", s.retired.union(Set(project))).with("active", s.active.exclude(Set(project))) }
  action restrict(project: int): bool = all { ids.contains(project), not(s.restrictions.contains(project)),
    s' = s.with("restrictions", s.restrictions.union(Set(project))) }
  action revise(project: int): bool = all { ids.contains(project), s.revisions.get(project) == 1,
    s' = s.with("revisions", s.revisions.set(project, 2)) }
  action evidence(project: int, kind: str): bool = all { ids.contains(project), Set("cleared", "unverified", "other").contains(kind),
    s' = s.with("evidence", s.evidence.set(project, kind)) }
  action changeLivePin = all { s.livePin == 1, s' = s.with("livePin", 2) }
  action publishTemplate = all { s.template == 1, s' = s.with("template", 2).with("assets", files.mapBy(_ => 2)) }
  action mismatchedAsset(file: int): bool = all { files.contains(file),
    s' = s.with("assets", s.assets.set(file, if (s.template == 1) 2 else 1)) }
  action begin(id: int, method: str, route: str, project: int, pathExists: bool): bool = all {
    ids.contains(id), ids.contains(project), s.requests.get(id).phase == "unused",
    Set("GET", "HEAD", "POST").contains(method), Set("artifact", "terms", "discovery", "unmatched").contains(route),
    s' = s.with("requests", s.requests.set(id, idle.with("method", method).with("route", route)
      .with("project", project).with("pathExists", pathExists)
      .with("phase", if (method == "POST" or route == "unmatched") "fallthrough" else "lookup"))) }
  action readProjects(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "lookup", not(request.projectRead),
      s' = s.with("requests", s.requests.set(id, request.with("projectRead", true).with("present", s.present)
        .with("active", s.active).with("published", s.published).with("retired", s.retired).with("revisions", s.revisions))) }
  }
  action readRestrictions(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "lookup", not(request.restrictionsRead),
      s' = s.with("requests", s.requests.set(id, request.with("restrictionsRead", true).with("restrictions", s.restrictions))) }
  }
  action joined(id: int): bool = {
    val request = s.requests.get(id)
    val listed = request.present.contains(request.project) and not(request.retired.contains(request.project))
    val candidates = request.present.intersect(request.active).intersect(request.published)
      .exclude(request.retired).exclude(request.restrictions)
    all { request.phase == "lookup", request.projectRead, request.restrictionsRead,
      s' = s.with("requests", s.requests.set(id,
        if (request.route == "discovery") request.with("phase", "template").with("candidates", candidates)
        else if (request.present.contains(request.project) and request.restrictions.contains(request.project)) respond(request, 410, false)
        else if (not(listed)) respond(request, 404, false)
        else if (request.route == "terms") respond(request, 200, false)
        else if (not(request.published.contains(request.project))) respond(request, 404, false)
        else request.with("phase", "template").with("candidates", Set(request.project)))) }
  }
  action templateReply(id: int, valid: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "template", s' = s.with("requests", s.requests.set(id,
      if (valid) request.with("template", s.template).with("phase", if (request.candidates == Set()) "discovered" else "clearance")
      else respond(request, 503, true))) }
  }
  action clearanceReply(id: int, project: int): bool = {
    val request = s.requests.get(id)
    val result = clearance(s.evidence.get(project), false, s.livePin == 1)
    val read = request.clearanceRead.union(Set(project))
    val cleared = if (result == "cleared") request.cleared.union(Set(project)) else request.cleared
    all { request.phase == "clearance", request.candidates.contains(project), not(request.clearanceRead.contains(project)),
      s' = s.with("requests", s.requests.set(id,
        if (request.route != "discovery" and result != "cleared") respond(request, if (result == "unverified") 503 else 404, false)
        else request.with("clearanceRead", read).with("cleared", cleared)
          .with("phase", if (read != request.candidates) "clearance" else if (request.route == "discovery") "discovered" else "files"))) }
  }
  action discovered(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "discovered", s' = s.with("requests", s.requests.set(id, respond(request, 200, false))) }
  }
  action fileReply(id: int, readable: bool): bool = {
    val request = s.requests.get(id)
    val file = request.fileCount + 1
    all { request.phase == "files", request.fileCount < 4,
      s' = s.with("requests", s.requests.set(id,
        if (not(readable) or asset(file) != request.template) respond(request, 503, true)
        else request.with("fileCount", file).with("phase", if (file == 2 or file == 4) "render" else "files"))) }
  }
  action render(id: int, valid: bool): bool = {
    val request = s.requests.get(id)
    val role = if (request.fileCount == 2) 1 else 2
    all { request.phase == "render", s' = s.with("requests", s.requests.set(id,
      if (not(valid)) respond(request, 503, true)
      else request.with("roles", request.roles.union(Set(role))).with("renderedRevision", request.revisions.get(request.project))
        .with("phase", if (role == 1) "files" else "select"))) }
  }
  action selectRequest(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "select", s' = s.with("requests", s.requests.set(id, respond(request, if (request.pathExists) 200 else 404, false))) }
  }
  action dependencyFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("lookup", "template", "clearance", "files", "render").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, respond(request, 503, true))) }
  }
  action deliver(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("delivered", received))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet project = ids.oneOf()
    nondet method = Set("GET", "HEAD", "POST").oneOf()
    nondet route = Set("artifact", "terms", "discovery", "unmatched").oneOf()
    nondet file = files.oneOf()
    nondet kind = Set("cleared", "unverified", "other").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { omit(project), unpublish(project), pause(project), retire(project), restrict(project), revise(project),
      evidence(project, kind), changeLivePin, publishTemplate, mismatchedAsset(file), begin(id, method, route, project, yes),
      readProjects(id), readRestrictions(id), joined(id), templateReply(id, yes), clearanceReply(id, project), discovered(id),
      fileReply(id, yes), render(id, yes), selectRequest(id), dependencyFailure(id), deliver(id, yes), s' = s }
  }
  val invariant = all { ids.forall(id => {
    val request = s.requests.get(id)
    all { request.status > 0 implies request.noStore,
      request.method == "HEAD" and request.status > 0 and not(request.caught) implies not(request.body),
      request.route == "artifact" and request.status == 200 implies request.roles == ids and request.fileCount == 4
        and request.cleared.contains(request.project) and request.renderedRevision == request.revisions.get(request.project),
      request.route == "discovery" and request.status == 200 implies request.cleared.subseteq(request.candidates),
      request.route == "terms" and request.status == 200 implies request.template == 0 and request.fileCount == 0,
      request.cleared.subseteq(request.candidates), request.fileCount >= 0 and request.fileCount <= 4,
      request.phase == "fallthrough" implies request.status == 0 and not(request.noStore) }
  }) }
  action lookup(id: int, route: str): bool = begin(id, "GET", route, 1, true).then(readProjects(id)).then(readRestrictions(id)).then(joined(id))
  action admitted(id: int): bool = lookup(id, "artifact").then(templateReply(id, true)).then(clearanceReply(id, 1))
  action contributor(id: int): bool = fileReply(id, true).then(fileReply(id, true)).then(render(id, true))
  action reviewer(id: int): bool = fileReply(id, true).then(fileReply(id, true)).then(render(id, true))
  action complete(id: int): bool = contributor(id).then(reviewer(id)).then(selectRequest(id)).then(deliver(id, true))

  run completeArtifactUsesOneCapturedRevisionTest = init.then(admitted(1)).then(complete(1))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).renderedRevision == 1 and invariant)
  run unsupportedMethodFallsThroughWithoutLookupTest = init.then(begin(1, "POST", "artifact", 1, true))
    .expect(s.requests.get(1).phase == "fallthrough" and not(s.requests.get(1).projectRead) and invariant)
  run unrelatedPathFallsThroughTest = init.then(begin(1, "GET", "unmatched", 1, true)).expect(invariant)
  run missingProjectReturns404Test = init.then(omit(1)).then(lookup(1, "artifact")).then(deliver(1, true))
    .expect(s.requests.get(1).status == 404 and invariant)
  run retiredProjectReturns404Test = init.then(retire(1)).then(lookup(1, "artifact")).expect(s.requests.get(1).status == 404 and invariant)
  run restrictionPrecedesRetirementTest = init.then(retire(1)).then(restrict(1)).then(lookup(1, "terms"))
    .expect(s.requests.get(1).status == 410 and invariant)
  run unpublishedProjectReturns404BeforeTemplateTest = init.then(unpublish(1)).then(lookup(1, "artifact"))
    .expect(s.requests.get(1).status == 404 and s.requests.get(1).template == 0 and invariant)
  run termsBypassTemplateAndClearanceTest = init.then(unpublish(1)).then(evidence(1, "unverified")).then(lookup(1, "terms"))
    .expect(s.requests.get(1).status == 200 and invariant)
  run pausedClearedArtifactRemainsInspectableTest = init.then(pause(1)).then(admitted(1)).then(complete(1))
    .expect(s.requests.get(1).status == 200 and invariant)
  run normalAdmissionSurvivesLivePinChangeTest = init.then(changeLivePin).then(admitted(1)).then(complete(1))
    .expect(s.requests.get(1).status == 200 and clearance("cleared", true, false) == "other" and invariant)
  run unverifiedArtifactReturns503Test = init.then(evidence(1, "unverified")).then(admitted(1))
    .expect(s.requests.get(1).status == 503 and not(s.requests.get(1).caught) and invariant)
  run otherClearanceRefusesArtifactWith404Test = init.then(evidence(1, "other")).then(admitted(1))
    .expect(s.requests.get(1).status == 404 and invariant)
  run discoveryExcludesPausedProjectTest = init.then(pause(1)).then(lookup(1, "discovery")).then(templateReply(1, true))
    .then(clearanceReply(1, 2)).then(discovered(1)).expect(s.requests.get(1).cleared == Set(2) and invariant)
  run discoveryFiltersReturnedUnverifiedEvidenceTest = init.then(evidence(1, "unverified")).then(lookup(1, "discovery"))
    .then(templateReply(1, true)).then(clearanceReply(1, 1)).then(clearanceReply(1, 2)).then(discovered(1))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).cleared == Set(2) and invariant)
  run emptyDiscoveryStillLoadsTemplateTest = init.then(pause(1)).then(pause(2)).then(lookup(1, "discovery"))
    .then(templateReply(1, false)).expect(s.requests.get(1).status == 503 and invariant)
  run emptyDiscoveryAfterSuccessfulReadsIs200Test = init.then(pause(1)).then(pause(2)).then(lookup(1, "discovery"))
    .then(templateReply(1, true)).then(discovered(1)).expect(s.requests.get(1).status == 200 and invariant)
  run thrownDiscoveryClearanceFailsWholeResponseTest = init.then(lookup(1, "discovery")).then(templateReply(1, true))
    .then(clearanceReply(1, 1)).then(dependencyFailure(1)).expect(s.requests.get(1).status == 503 and invariant)
  run lookupFailureDoesNotFabricateEmptyIndexTest = init.then(begin(1, "GET", "discovery", 1, true)).then(dependencyFailure(1))
    .expect(s.requests.get(1).status == 503 and invariant)
  run malformedIndexFailsBeforeFileReadsTest = init.then(lookup(1, "artifact")).then(templateReply(1, false))
    .expect(s.requests.get(1).status == 503 and s.requests.get(1).fileCount == 0 and invariant)
  run changedAssetDigestFailsPublicationTest = init.then(admitted(1)).then(mismatchedAsset(1)).then(fileReply(1, true))
    .expect(s.requests.get(1).status == 503 and s.requests.get(1).roles == Set() and invariant)
  run missingFileFailsPublicationTest = init.then(admitted(1)).then(fileReply(1, false))
    .expect(s.requests.get(1).status == 503 and invariant)
  run reviewerFailureDoesNotExposeEarlierContributorTest = init.then(admitted(1)).then(contributor(1)).then(fileReply(1, false))
    .expect(s.requests.get(1).roles == Set(1) and s.requests.get(1).status == 503 and invariant)
  run rendererFailureDoesNotExposeFilesTest = init.then(admitted(1)).then(fileReply(1, true)).then(fileReply(1, true)).then(render(1, false))
    .expect(s.requests.get(1).status == 503 and invariant)
  run unknownMatchedFilenameNeedsCompletedPublicationTest = init.then(begin(1, "GET", "artifact", 1, false))
    .then(readProjects(1)).then(readRestrictions(1)).then(joined(1)).then(templateReply(1, true)).then(clearanceReply(1, 1))
    .then(complete(1)).expect(s.requests.get(1).status == 404 and s.requests.get(1).roles == ids and invariant)
  run revisionChangesDoNotMixCapturedRoleInputsTest = init.then(admitted(1)).then(contributor(1)).then(revise(1)).then(reviewer(1)).then(selectRequest(1))
    .expect(s.requests.get(1).renderedRevision == 1 and s.revisions.get(1) == 2 and invariant)
  run laterRequestReadsNewRevisionTest = init.then(admitted(1)).then(complete(1)).then(revise(1)).then(admitted(2)).then(complete(2))
    .expect(s.requests.get(1).renderedRevision == 1 and s.requests.get(2).renderedRevision == 2 and invariant)
  run lateRestrictionDoesNotRewriteCapturedAdmissionTest = init.then(admitted(1)).then(restrict(1)).then(complete(1))
    .expect(s.requests.get(1).status == 200 and s.restrictions.contains(1) and invariant)
  run nextRequestObservesRestrictionTest = init.then(admitted(1)).then(restrict(1)).then(complete(1)).then(lookup(2, "artifact"))
    .expect(s.requests.get(2).status == 410 and invariant)
  run laterTemplateDeploymentCannotMixHashedFilesTest = init.then(admitted(1)).then(contributor(1)).then(publishTemplate).then(fileReply(1, true))
    .expect(s.requests.get(1).status == 503 and s.requests.get(1).template == 1 and invariant)
  run ordinaryHeadHasNoBodyTest = init.then(begin(1, "HEAD", "terms", 1, true)).then(readProjects(1)).then(readRestrictions(1)).then(joined(1))
    .expect(s.requests.get(1).status == 200 and not(s.requests.get(1).body) and invariant)
  run caughtHeadFailureRetainsFunctionLevelTextBodyTest = init.then(begin(1, "HEAD", "artifact", 1, true)).then(dependencyFailure(1))
    .expect(s.requests.get(1).status == 503 and s.requests.get(1).body and s.requests.get(1).caught and invariant)
  run lostReplyDoesNotTurnCompletedArtifactIntoFailureTest = init.then(admitted(1)).then(contributor(1)).then(reviewer(1)).then(selectRequest(1)).then(deliver(1, false))
    .expect(s.requests.get(1).status == 200 and not(s.requests.get(1).delivered) and invariant)
}
