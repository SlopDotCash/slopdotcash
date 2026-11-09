// @source src/ProjectSecuritySettings.tsx
// @source src/SecurityProgramEditor.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/project-api.ts
// @source backend/http.ts
// @source backend/projects/handler.ts
// @evidence tests/e2e/security-bounty.spec.ts
// Unexecuted source projection: two actors/lifetimes, two reusable read slots,
// two publication attempts and three immutable server revisions. Session
// observations are response snapshots, not an atomic read of the current cookie.
module ui_security_settings_lifetime {
  type Read = { kind: str, phase: str, actor: int, cookie: int, life: int, ok: bool, revision: int }
  type Publish = { phase: str, actor: int, cookie: int, life: int,
    expected: int, body: int, accepted: bool, revision: int }
  type State = { actor: int, cookie: int, life: int, mounted: bool, gate: bool,
    editor: bool, read: int, reads: int -> Read, active: int,
    publications: int -> Publish, server: int, serverBody: int,
    base: int, parent: int, success: int, error: str, identityRefresh: bool }
  var s: State
  val ids = Set(1, 2)
  val actors = Set(0, 1, 2)
  action init = s' = { actor: 1, cookie: 1, life: 1, mounted: true,
    gate: false, editor: false, read: 0,
    reads: ids.mapBy(_ => {kind: "permission", phase: "unused", actor: 0,
      cookie: 0, life: 0, ok: false, revision: 0}), active: 0,
    publications: ids.mapBy(_ => {phase: "unused", actor: 0, cookie: 0,
      life: 0, expected: 0, body: 0, accepted: false, revision: 0}),
    server: 1, serverBody: 0, base: 1, parent: 1, success: 0, error: "none", identityRefresh: false }
  def ownsRead(id: int): bool = s.mounted and s.read == id
    and s.reads.get(id).life == s.life and s.reads.get(id).actor == s.actor
  def ownsPublish(id: int): bool = s.mounted and s.active == id
    and s.publications.get(id).life == s.life and s.publications.get(id).actor == s.actor
  pure def deny(value: State): State = value.with("gate", false).with("editor", false)
    .with("active", 0).with("read", 0).with("error", "access").with("identityRefresh", false)
  pure def identityDeny(value: State): State = deny(value).with("identityRefresh", true)
  action cookieChanges(actor: int): bool = all {
    actors.contains(actor), s' = s.with("cookie", actor) }
  action beginRead(id: int, kind: str): bool = all {
    s.mounted, s.actor != 0, s.active == 0, ids.contains(id), Set("unused", "done").contains(s.reads.get(id).phase),
    Set("permission", "revision").contains(kind), kind == "permission" or s.gate,
    s' = s.with("read", id).with("editor", false).with("error", "none")
      .with("gate", kind == "revision" and s.gate)
      .with("reads", s.reads.set(id, {kind: kind, phase: "pre", actor: s.actor,
        cookie: 0, life: s.life, ok: false, revision: 0})) }
  action readPreflight(id: int, observed: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "pre", actors.contains(observed),
      s' = if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (observed != r.actor) identityDeny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else s.with("reads", s.reads.set(id, r.with("phase", "dispatch"))) }
  }
  action readDispatch(id: int): bool = all {
    ownsRead(id), s.reads.get(id).phase == "dispatch",
    s' = s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("phase", "http").with("cookie", s.cookie))) }
  action readReply(id: int, outcome: str): bool = {
    val r = s.reads.get(id)
    val admitted = r.kind == "revision" or r.cookie == r.actor
    all { r.phase == "http", Set("success", "temporary", "access", "identity").contains(outcome),
      outcome != "success" or admitted,
      s' = if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (outcome == "identity") identityDeny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (outcome == "access") deny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else s.with("reads", s.reads.set(id, r.with("phase", "post")
        .with("ok", outcome == "success").with("revision", s.server))) }
  }
  action wrongPermissionViewer(id: int): bool = all {
    ownsRead(id), s.reads.get(id).kind == "permission", s.reads.get(id).phase == "post",
    s' = identityDeny(s).with("reads", s.reads.set(id, s.reads.get(id).with("phase", "done"))) }
  action readPostflight(id: int, observed: int): bool = {
    val r = s.reads.get(id)
    val done = s.with("reads", s.reads.set(id, r.with("phase", "done"))).with("read", 0)
    all { r.phase == "post", actors.contains(observed),
      s' = if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (observed != r.actor) identityDeny(done)
      else if (not(r.ok)) (if (r.kind == "permission") deny(done) else done.with("error", "request"))
      else if (r.kind == "permission") done.with("gate", true)
      else done.with("editor", true).with("base", r.revision).with("parent", r.revision) }
  }
  // Convenience trace for two successful endpoint reads; all waits also have
  // separate actions so the failure and replacement interleavings stay visible.
  action loadSettings = beginRead(1, "permission").then(readPreflight(1, s.actor))
    .then(readDispatch(1)).then(readReply(1, "success")).then(readPostflight(1, s.actor))
    .then(beginRead(1, "revision")).then(readPreflight(1, s.actor))
    .then(readDispatch(1)).then(readReply(1, "success")).then(readPostflight(1, s.actor))
  action beginPublish(id: int, body: int): bool = all {
    s.mounted, s.gate, s.editor, s.active == 0, ids.contains(id), ids.contains(body),
    s.publications.get(id).phase == "unused",
    s' = s.with("active", id).with("error", "none")
      .with("publications", s.publications.set(id, {phase: "pre", actor: s.actor,
        cookie: 0, life: s.life, expected: s.base, body: body,
        accepted: false, revision: 0})) }
  action publishPreflight(id: int, observed: int): bool = {
    val p = s.publications.get(id)
    all { p.phase == "pre", actors.contains(observed),
      s' = if (not(ownsPublish(id))) s.with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (observed != p.actor) identityDeny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else s.with("publications", s.publications.set(id, p.with("phase", "dispatch"))) }
  }
  action publishDispatch(id: int): bool = all {
    ownsPublish(id), s.publications.get(id).phase == "dispatch",
    s' = s.with("publications", s.publications.set(id,
      s.publications.get(id).with("phase", "server").with("cookie", s.cookie))) }
  action serverResult(id: int, policyAllows: bool): bool = {
    val p = s.publications.get(id)
    val accepted = policyAllows and p.cookie == p.actor and p.cookie != 0
      and p.expected == s.server and s.server < 3
    val updated = s.with("publications", s.publications.set(id,
      p.with("phase", "http").with("accepted", accepted)
        .with("revision", if (accepted) s.server + 1 else 0)))
    all { p.phase == "server",
      s' = if (accepted) updated.with("server", s.server + 1).with("serverBody", p.body)
      else updated }
  }
  action publishReply(id: int, outcome: str): bool = {
    val p = s.publications.get(id)
    all { p.phase == "http", Set("success", "temporary", "access", "identity").contains(outcome),
      outcome != "success" or p.accepted,
      not(Set("access", "identity").contains(outcome)) or not(p.accepted),
      s' = if (not(ownsPublish(id))) s.with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (outcome == "identity") identityDeny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (outcome == "access") deny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else s.with("publications", s.publications.set(id,
        p.with("phase", if (outcome == "success") "post" else "failure"))) }
  }
  action publishPostflight(id: int, observed: int): bool = {
    val p = s.publications.get(id)
    val done = s.with("publications", s.publications.set(id, p.with("phase", "done")))
    all { Set("post", "failure").contains(p.phase), actors.contains(observed),
      s' = if (not(ownsPublish(id))) done
      else if (observed != p.actor) identityDeny(done)
      else if (p.phase == "failure") done.with("active", 0).with("error", "request")
      else done.with("active", 0).with("parent", p.revision)
        .with("base", p.revision).with("success", p.revision) }
  }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("gate", false).with("editor", false)
      .with("active", 0).with("read", 0).with("success", 0) }
  action parentIdentityReply(actor: int): bool = all {
    s.identityRefresh, s.mounted, s.life == 1, actors.contains(actor),
    s' = s.with("life", 2).with("actor", actor).with("gate", false)
      .with("editor", false).with("read", 0).with("active", 0)
      .with("identityRefresh", false).with("success", 0).with("error", "none") }
  action unavailablePublicationIdentity(id: int): bool = all {
    ownsPublish(id), Set("pre", "post", "failure").contains(s.publications.get(id).phase),
    s' = deny(s).with("publications", s.publications.set(id,
      s.publications.get(id).with("phase", "done"))) }
  action remount(actor: int): bool = all {
    not(s.mounted), s.life == 1, ids.contains(actor),
    s' = s.with("mounted", true).with("life", 2).with("actor", actor)
      .with("error", "none") }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = actors.oneOf()
    nondet kind = Set("permission", "revision").oneOf()
    nondet outcome = Set("success", "temporary", "access", "identity").oneOf()
    nondet allowed = Set(false, true).oneOf()
    any { cookieChanges(actor), beginRead(id, kind), readPreflight(id, actor), readDispatch(id),
      readReply(id, outcome), readPostflight(id, actor), wrongPermissionViewer(id), beginPublish(id, 1), beginPublish(id, 2),
      publishPreflight(id, actor), publishDispatch(id), serverResult(id, allowed),
      publishReply(id, outcome), publishPostflight(id, actor), unavailablePublicationIdentity(id),
      parentIdentityReply(actor), depart, remount(actor), s' = s }
  }
  val invariant = all { s.server >= 1, s.server <= 3, s.parent <= s.server,
    s.editor implies (s.mounted and s.gate),
    ids.forall(id => s.publications.get(id).accepted implies
      s.publications.get(id).cookie == s.publications.get(id).actor) }
  run initialReadAndPermissionTest = init.then(loadSettings).expect(s.gate and s.editor)
  run permissionChangedObservationTest = init.then(beginRead(1, "permission"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(cookieChanges(2))
    .then(readReply(1, "success")).then(readPostflight(1, 2)).expect(not(s.gate))
  run permissionTransportFailureTest = init.then(beginRead(1, "permission"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(readReply(1, "temporary"))
    .then(readPostflight(1, 1)).expect(not(s.gate))
  run wrongPermissionViewerRefusesTest = init.then(beginRead(1, "permission"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(readReply(1, "success"))
    .then(wrongPermissionViewer(1)).expect(not(s.gate))
  run departedPermissionCannotGrantNewViewTest = init.then(beginRead(1, "permission"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(depart).then(remount(2))
    .then(readReply(1, "success")).expect(not(s.gate) and not(s.editor))
  run revisionErrorPreservesRetryTest = init.then(loadSettings).then(beginRead(1, "revision"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(readReply(1, "temporary"))
    .then(readPostflight(1, 1)).expect(s.gate and not(s.editor) and s.error == "request")
  run revisionIdentityLossDropsGateTest = init.then(loadSettings).then(beginRead(1, "revision"))
    .then(readPreflight(1, 1)).then(readDispatch(1)).then(readReply(1, "success"))
    .then(readPostflight(1, 2)).expect(not(s.gate))
  run preflightDifferentActorStartsNoWriteTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 2)).expect(s.server == 1 and not(s.gate))
  run cookieSwapBeforeDispatchIsRefusedTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(cookieChanges(2)).then(publishDispatch(1))
    .then(serverResult(1, true)).then(publishReply(1, "identity"))
    .expect(s.server == 1 and not(s.gate) and s.identityRefresh)
  run postDispatchCookieCannotRewriteAdmissionTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(cookieChanges(2))
    .then(serverResult(1, true)).then(publishReply(1, "success"))
    .then(publishPostflight(1, 2)).expect(s.server == 2 and s.success == 0 and not(s.gate))
  run successfulPublicationTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, true))
    .then(publishReply(1, "success")).then(publishPostflight(1, 1)).expect(s.success == 2 and s.parent == 2)
  run knownRefusalDropsPrivateGateTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, false))
    .then(publishReply(1, "access")).expect(not(s.gate) and not(s.editor) and not(s.identityRefresh))
  run sameActorFailureKeepsEditorTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, false))
    .then(publishReply(1, "temporary")).then(publishPostflight(1, 1)).expect(s.editor and s.error == "request")
  run signedOutFailureIdentityDropsGateTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, false))
    .then(publishReply(1, "temporary")).then(publishPostflight(1, 0)).expect(not(s.gate))
  run changedActorGetsFreshGateWithoutFocusTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(cookieChanges(2)).then(publishPreflight(1, 2)).then(parentIdentityReply(2))
    .then(loadSettings).expect(s.actor == 2 and s.gate and s.editor and s.server == 1)
  run unknownSessionDoesNotLoopParentTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(unavailablePublicationIdentity(1)).expect(not(s.gate) and not(s.identityRefresh))
  run departedPreflightSendsNoWriteTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(depart).then(publishPreflight(1, 1)).expect(s.server == 1)
  run acceptedDepartedReplyPreservesServerHistoryTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, true))
    .then(depart).then(publishReply(1, "success")).expect(s.server == 2 and s.parent == 1)
  run newerOwnerRevisionCannotBeReplacedTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, true))
    .then(depart).then(cookieChanges(2)).then(remount(2)).then(loadSettings)
    .then(beginPublish(2, 2)).then(publishPreflight(2, 2)).then(publishDispatch(2))
    .then(serverResult(2, true)).then(publishReply(2, "success")).then(publishPostflight(2, 2))
    .then(publishReply(1, "success")).expect(s.parent == 3 and s.serverBody == 2 and s.success == 3)
  run departedPostflightCannotPublishTest = init.then(loadSettings).then(beginPublish(1, 1))
    .then(publishPreflight(1, 1)).then(publishDispatch(1)).then(serverResult(1, true))
    .then(publishReply(1, "success")).then(depart).then(publishPostflight(1, 1)).expect(s.parent == 1)
}
