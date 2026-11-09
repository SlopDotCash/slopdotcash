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
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios pass false and keep the exact state. step
// passes true, which applies settle to every successor:
// - serverBody, error, success and each publication body are write-only, so
//   step stores fixed values and begins publications with body 1 only.
// - Read and publication ownership is absorbing-false for a given record:
//   read/active only name a slot when it is (re)started, lifetime only
//   increases, and every actor change also changes lifetime. An unowned read
//   only marks itself done, as does an unowned publication outside the
//   server phase. step stores these as one done record (a done read slot is
//   reusable, as before). An unowned publication in the server phase can
//   still change server state, so it keeps actor, cookie and expected.
//   A publication's accepted flag is fixed by serverResult under the
//   cookie == actor guard and is read only by the invariant at that point.
// - Captured cookies are compared only with the request actor (never 0 for a
//   started request), expected only by serverResult, and after the lifetime
//   change the page cookie only with the fixed actor, so step stores 0 for
//   unread values and offers one non-actor cookie or observation.
// - Read slots and publication IDs are interchangeable, so step starts the
//   lowest available one.
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
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure val doneRead = {kind: "permission", phase: "done", actor: 0, cookie: 0, life: 0, ok: false, revision: 0}
  pure val donePublish = {phase: "done", actor: 0, cookie: 0, life: 0, expected: 0, body: 0,
    accepted: false, revision: 0}
  pure def settledRead(st: State, id: int): Read = {
    val r = st.reads.get(id)
    val owned = st.mounted and st.read == id and r.life == st.life and r.actor == st.actor
    if (r.phase == "unused") r
    else if (r.phase == "done" or not(owned)) doneRead
    else r.with("cookie", if (r.cookie == r.actor) r.cookie else 0)
  }
  pure def settledPublish(st: State, id: int): Publish = {
    val p = st.publications.get(id)
    val owned = st.mounted and st.active == id and p.life == st.life and p.actor == st.actor
    val cookie = if (p.cookie != 0 and p.cookie == p.actor) p.cookie else 0
    if (p.phase == "unused") p
    else if (p.phase == "server" and not(owned))
      donePublish.with("phase", "server").with("actor", p.actor).with("cookie", cookie)
        .with("expected", p.expected)
    else if (p.phase == "done" or not(owned)) donePublish
    else p.with("body", 0).with("cookie", cookie)
      .with("expected", if (Set("pre", "dispatch", "server").contains(p.phase)) p.expected else 0)
  }
  pure def settle(reduce: bool, st: State): State = if (not(reduce)) st
    else st.with("reads", ids.mapBy(id => settledRead(st, id)))
      .with("publications", ids.mapBy(id => settledPublish(st, id)))
      .with("serverBody", 0).with("error", "none").with("success", 0)
      .with("cookie", if (st.life == 1 or st.cookie == st.actor) st.cookie else 0)
  pure def deny(value: State): State = value.with("gate", false).with("editor", false)
    .with("active", 0).with("read", 0).with("error", "access").with("identityRefresh", false)
  pure def identityDeny(value: State): State = deny(value).with("identityRefresh", true)
  action cookieChangesWith(actor: int, reduce: bool): bool = all {
    actors.contains(actor), s' = settle(reduce, s.with("cookie", actor)) }
  action cookieChanges(actor: int): bool = cookieChangesWith(actor, false)
  action beginReadWith(id: int, kind: str, reduce: bool): bool = all {
    s.mounted, s.actor != 0, s.active == 0, ids.contains(id), Set("unused", "done").contains(s.reads.get(id).phase),
    Set("permission", "revision").contains(kind), kind == "permission" or s.gate,
    s' = settle(reduce, s.with("read", id).with("editor", false).with("error", "none")
      .with("gate", kind == "revision" and s.gate)
      .with("reads", s.reads.set(id, {kind: kind, phase: "pre", actor: s.actor,
        cookie: 0, life: s.life, ok: false, revision: 0}))) }
  action beginRead(id: int, kind: str): bool = beginReadWith(id, kind, false)
  action readPreflightWith(id: int, observed: int, reduce: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "pre", actors.contains(observed),
      s' = settle(reduce, if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (observed != r.actor) identityDeny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else s.with("reads", s.reads.set(id, r.with("phase", "dispatch")))) }
  }
  action readPreflight(id: int, observed: int): bool = readPreflightWith(id, observed, false)
  action readDispatchWith(id: int, reduce: bool): bool = all {
    ownsRead(id), s.reads.get(id).phase == "dispatch",
    s' = settle(reduce, s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("phase", "http").with("cookie", s.cookie)))) }
  action readDispatch(id: int): bool = readDispatchWith(id, false)
  action readReplyWith(id: int, outcome: str, reduce: bool): bool = {
    val r = s.reads.get(id)
    val admitted = r.kind == "revision" or r.cookie == r.actor
    all { r.phase == "http", Set("success", "temporary", "access", "identity").contains(outcome),
      outcome != "success" or admitted,
      s' = settle(reduce, if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (outcome == "identity") identityDeny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (outcome == "access") deny(s).with("reads", s.reads.set(id, r.with("phase", "done")))
      else s.with("reads", s.reads.set(id, r.with("phase", "post")
        .with("ok", outcome == "success").with("revision", s.server)))) }
  }
  action readReply(id: int, outcome: str): bool = readReplyWith(id, outcome, false)
  action wrongPermissionViewerWith(id: int, reduce: bool): bool = all {
    ownsRead(id), s.reads.get(id).kind == "permission", s.reads.get(id).phase == "post",
    s' = settle(reduce, identityDeny(s).with("reads", s.reads.set(id, s.reads.get(id).with("phase", "done")))) }
  action wrongPermissionViewer(id: int): bool = wrongPermissionViewerWith(id, false)
  action readPostflightWith(id: int, observed: int, reduce: bool): bool = {
    val r = s.reads.get(id)
    val done = s.with("reads", s.reads.set(id, r.with("phase", "done"))).with("read", 0)
    all { r.phase == "post", actors.contains(observed),
      s' = settle(reduce, if (not(ownsRead(id))) s.with("reads", s.reads.set(id, r.with("phase", "done")))
      else if (observed != r.actor) identityDeny(done)
      else if (not(r.ok)) (if (r.kind == "permission") deny(done) else done.with("error", "request"))
      else if (r.kind == "permission") done.with("gate", true)
      else done.with("editor", true).with("base", r.revision).with("parent", r.revision)) }
  }
  action readPostflight(id: int, observed: int): bool = readPostflightWith(id, observed, false)
  // Convenience trace for two successful endpoint reads; all waits also have
  // separate actions so the failure and replacement interleavings stay visible.
  action loadSettings = beginRead(1, "permission").then(readPreflight(1, s.actor))
    .then(readDispatch(1)).then(readReply(1, "success")).then(readPostflight(1, s.actor))
    .then(beginRead(1, "revision")).then(readPreflight(1, s.actor))
    .then(readDispatch(1)).then(readReply(1, "success")).then(readPostflight(1, s.actor))
  action beginPublishWith(id: int, body: int, reduce: bool): bool = all {
    s.mounted, s.gate, s.editor, s.active == 0, ids.contains(id), ids.contains(body),
    s.publications.get(id).phase == "unused",
    s' = settle(reduce, s.with("active", id).with("error", "none")
      .with("publications", s.publications.set(id, {phase: "pre", actor: s.actor,
        cookie: 0, life: s.life, expected: s.base, body: body,
        accepted: false, revision: 0}))) }
  action beginPublish(id: int, body: int): bool = beginPublishWith(id, body, false)
  action publishPreflightWith(id: int, observed: int, reduce: bool): bool = {
    val p = s.publications.get(id)
    all { p.phase == "pre", actors.contains(observed),
      s' = settle(reduce, if (not(ownsPublish(id))) s.with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (observed != p.actor) identityDeny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else s.with("publications", s.publications.set(id, p.with("phase", "dispatch")))) }
  }
  action publishPreflight(id: int, observed: int): bool = publishPreflightWith(id, observed, false)
  action publishDispatchWith(id: int, reduce: bool): bool = all {
    ownsPublish(id), s.publications.get(id).phase == "dispatch",
    s' = settle(reduce, s.with("publications", s.publications.set(id,
      s.publications.get(id).with("phase", "server").with("cookie", s.cookie)))) }
  action publishDispatch(id: int): bool = publishDispatchWith(id, false)
  action serverResultWith(id: int, policyAllows: bool, reduce: bool): bool = {
    val p = s.publications.get(id)
    val accepted = policyAllows and p.cookie == p.actor and p.cookie != 0
      and p.expected == s.server and s.server < 3
    val updated = s.with("publications", s.publications.set(id,
      p.with("phase", "http").with("accepted", accepted)
        .with("revision", if (accepted) s.server + 1 else 0)))
    all { p.phase == "server",
      s' = settle(reduce, if (accepted) updated.with("server", s.server + 1).with("serverBody", p.body)
      else updated) }
  }
  action serverResult(id: int, policyAllows: bool): bool = serverResultWith(id, policyAllows, false)
  action publishReplyWith(id: int, outcome: str, reduce: bool): bool = {
    val p = s.publications.get(id)
    all { p.phase == "http", Set("success", "temporary", "access", "identity").contains(outcome),
      outcome != "success" or p.accepted,
      not(Set("access", "identity").contains(outcome)) or not(p.accepted),
      s' = settle(reduce, if (not(ownsPublish(id))) s.with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (outcome == "identity") identityDeny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else if (outcome == "access") deny(s).with("publications", s.publications.set(id, p.with("phase", "done")))
      else s.with("publications", s.publications.set(id,
        p.with("phase", if (outcome == "success") "post" else "failure")))) }
  }
  action publishReply(id: int, outcome: str): bool = publishReplyWith(id, outcome, false)
  action publishPostflightWith(id: int, observed: int, reduce: bool): bool = {
    val p = s.publications.get(id)
    val done = s.with("publications", s.publications.set(id, p.with("phase", "done")))
    all { Set("post", "failure").contains(p.phase), actors.contains(observed),
      s' = settle(reduce, if (not(ownsPublish(id))) done
      else if (observed != p.actor) identityDeny(done)
      else if (p.phase == "failure") done.with("active", 0).with("error", "request")
      else done.with("active", 0).with("parent", p.revision)
        .with("base", p.revision).with("success", p.revision)) }
  }
  action publishPostflight(id: int, observed: int): bool = publishPostflightWith(id, observed, false)
  action departWith(reduce: bool): bool = all { s.mounted,
    s' = settle(reduce, s.with("mounted", false).with("gate", false).with("editor", false)
      .with("active", 0).with("read", 0).with("success", 0)) }
  action depart = departWith(false)
  action parentIdentityReplyWith(actor: int, reduce: bool): bool = all {
    s.identityRefresh, s.mounted, s.life == 1, actors.contains(actor),
    s' = settle(reduce, s.with("life", 2).with("actor", actor).with("gate", false)
      .with("editor", false).with("read", 0).with("active", 0)
      .with("identityRefresh", false).with("success", 0).with("error", "none")) }
  action parentIdentityReply(actor: int): bool = parentIdentityReplyWith(actor, false)
  action unavailablePublicationIdentityWith(id: int, reduce: bool): bool = all {
    ownsPublish(id), Set("pre", "post", "failure").contains(s.publications.get(id).phase),
    s' = settle(reduce, deny(s).with("publications", s.publications.set(id,
      s.publications.get(id).with("phase", "done")))) }
  action unavailablePublicationIdentity(id: int): bool = unavailablePublicationIdentityWith(id, false)
  action remountWith(actor: int, reduce: bool): bool = all {
    not(s.mounted), s.life == 1, ids.contains(actor),
    s' = settle(reduce, s.with("mounted", true).with("life", 2).with("actor", actor)
      .with("error", "none")) }

  action remount(actor: int): bool = remountWith(actor, false)
  action step = any {
    // In lifetime 2 the actor is fixed and every other cookie is equivalent.
    { nondet actor = actors.oneOf()
      all { s.life == 1 or actor == 0 or actor == s.actor, cookieChangesWith(actor, true) } },
    // Read slots are interchangeable; step reuses the lowest available one.
    { nondet id = ids.oneOf() nondet kind = Set("permission", "revision").oneOf()
      all { id == 1 or not(Set("unused", "done").contains(s.reads.get(1).phase)),
        beginReadWith(id, kind, true) } },
    // Observations are compared only with the request actor, never 0.
    { nondet id = ids.oneOf() nondet actor = actors.oneOf()
      all { actor == 0 or actor == s.reads.get(id).actor, readPreflightWith(id, actor, true) } },
    { nondet id = ids.oneOf() readDispatchWith(id, true) },
    { nondet id = ids.oneOf() nondet outcome = Set("success", "temporary", "access", "identity").oneOf()
      readReplyWith(id, outcome, true) },
    { nondet id = ids.oneOf() nondet actor = actors.oneOf()
      all { actor == 0 or actor == s.reads.get(id).actor, readPostflightWith(id, actor, true) } },
    { nondet id = ids.oneOf() wrongPermissionViewerWith(id, true) },
    // Publication IDs are opaque and the body reaches only serverBody.
    { nondet id = ids.oneOf()
      all { id == 1 or s.publications.get(1).phase != "unused", beginPublishWith(id, 1, true) } },
    { nondet id = ids.oneOf() nondet actor = actors.oneOf()
      all { actor == 0 or actor == s.publications.get(id).actor, publishPreflightWith(id, actor, true) } },
    { nondet id = ids.oneOf() publishDispatchWith(id, true) },
    { nondet id = ids.oneOf() nondet allowed = Set(false, true).oneOf() serverResultWith(id, allowed, true) },
    { nondet id = ids.oneOf() nondet outcome = Set("success", "temporary", "access", "identity").oneOf()
      publishReplyWith(id, outcome, true) },
    { nondet id = ids.oneOf() nondet actor = actors.oneOf()
      all { actor == 0 or actor == s.publications.get(id).actor, publishPostflightWith(id, actor, true) } },
    { nondet id = ids.oneOf() unavailablePublicationIdentityWith(id, true) },
    { nondet actor = actors.oneOf() parentIdentityReplyWith(actor, true) },
    departWith(true),
    { nondet actor = actors.oneOf() remountWith(actor, true) },
    s' = s
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
