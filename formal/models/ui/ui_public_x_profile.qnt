// @source src/Points.tsx
// @source src/ProfilePage.tsx
// @source src/App.tsx
// @source backend/points/x.ts
// @evidence tests/e2e/points-social.spec.ts
// PublicXLink, XAccountLink, the profile key, and GET /points/x/profile only.
// Source-only model: every named scenario is unexecuted. No OAuth controls.
module ui_public_x_profile {
  type Instance = { mounted: bool, actor: int, effectPending: bool,
    account: int, failed: bool, emptyObserved: bool, request: int }
  type Read = { phase: str, instance: int, actor: int, aborted: bool,
    result: int, publicObserved: bool }
  type State = { active: int, product: bool, viewer: int, caseChanged: bool,
    instances: int -> Instance, reads: int -> Read, rows: int -> str,
    disclosed: Set[int], opened: int }
  val ids = Set(1, 2)
  var s: State

  action init = s' = {
    active: 1, product: true, viewer: 1, caseChanged: false,
    instances: ids.mapBy(id => { mounted: id == 1, actor: id,
      effectPending: id == 1, account: 0, failed: false,
      emptyObserved: false, request: 0 }),
    reads: ids.mapBy(_ => { phase: "unused", instance: 1, actor: 1,
      aborted: false, result: 0, publicObserved: false }),
    rows: ids.mapBy(_ => "public"), disclosed: Set(), opened: 0
  }

  val current = s.instances.get(s.active)
  // Loading, absent publication, and a disabled product-origin query all render
  // no X element. The model keeps their causes distinct without inventing copy.
  val view = if (not(current.mounted)) "absent"
    else if (current.account > 0) "ready"
    else if (current.failed) "error"
    else if (current.emptyObserved) "missing"
    else if (not(s.product) and not(current.effectPending)) "suppressed"
    else "loading"

  // These are external changes to the rows read by the public SELECT, not a
  // model of authorization to edit membership or OAuth connection state.
  action publication(actor: int, state: str): bool = all {
    ids.contains(actor),
    Set("public", "link-private", "member-private", "link-missing", "member-missing").contains(state),
    s' = s.with("rows", s.rows.set(actor, state))
  }
  action viewerChanges(actor: int): bool = all {
    Set(0, 1, 2).contains(actor), s' = s.with("viewer", actor)
  }
  action previewOrigin = all {
    ids.forall(id => s.reads.get(id).phase == "unused"),
    current.effectPending, s' = s.with("product", false)
  }
  action suppressQuery = all {
    current.mounted, current.effectPending, not(s.product),
    s' = s.with("instances", s.instances.set(s.active,
      current.with("effectPending", false).with("account", 0)
        .with("failed", false).with("emptyObserved", false)))
  }

  // A changed actor prop schedules cleanup/reset in the passive effect. The
  // prior account can still render before that effect, as in the source.
  action changeActorProp = all {
    current.mounted, current.actor == 1, not(current.effectPending),
    s' = s.with("instances", s.instances.set(s.active,
      current.with("actor", 2).with("effectPending", true)))
  }
  action startRead(id: int): bool = all {
    ids.contains(id), current.mounted, current.effectPending, s.product,
    s.reads.get(id).phase == "unused",
    s' = s.with("reads", ids.mapBy(k =>
      if (k == id) { phase: "pending", instance: s.active,
        actor: current.actor, aborted: false, result: 0, publicObserved: false }
      else if (k == current.request) s.reads.get(k).with("aborted", true)
      else s.reads.get(k)))
      .with("instances", s.instances.set(s.active,
        current.with("effectPending", false).with("account", 0)
          .with("failed", false).with("emptyObserved", false).with("request", id)))
  }
  // A different normalized profile key, or leaving and revisiting the route,
  // creates another component instance. Old local state is not the new state.
  action replaceProfile(actor: int): bool = all {
    s.active == 1, ids.contains(actor),
    s' = s.with("active", 2).with("caseChanged", false)
      .with("instances", s.instances.set(1, current.with("mounted", false))
        .set(2, { mounted: true, actor: actor, effectPending: true,
          account: 0, failed: false, emptyObserved: false, request: 0 }))
      .with("reads", ids.mapBy(k => if (s.reads.get(k).instance == 1
        and s.reads.get(k).phase != "unused") s.reads.get(k).with("aborted", true)
        else s.reads.get(k)))
  }
  action normalizedKeyUnchanged = all {
    current.mounted, not(s.caseChanged), s' = s.with("caseChanged", true)
  }
  action depart = all {
    current.mounted,
    s' = s.with("instances", s.instances.set(s.active, current.with("mounted", false)))
      .with("reads", ids.mapBy(k => if (s.reads.get(k).instance == s.active
        and s.reads.get(k).phase != "unused") s.reads.get(k).with("aborted", true)
        else s.reads.get(k)))
  }

  // SQL includes both l.public=1 and the joined member's m.public=1. A
  // missing row is null, not an error. The observed result can outlive the rows.
  action observePublicQuery(id: int): bool = {
    val r = s.reads.get(id)
    val visible = s.rows.get(r.actor) == "public"
    all { ids.contains(id), r.phase == "pending", not(r.aborted),
      s' = s.with("reads", s.reads.set(id, r.with("phase", "observed")
        .with("result", if (visible) r.actor else 0).with("publicObserved", visible)))
        .with("disclosed", if (visible) s.disclosed.union(Set(r.actor)) else s.disclosed) }
  }
  // The successful fetch/JSON promise has settled before the effect's .then
  // runs. Aborting after this point does not add a guard to that callback.
  action queueSuccess(id: int): bool = {
    val r = s.reads.get(id)
    all { ids.contains(id), r.phase == "observed", not(r.aborted),
      s' = s.with("reads", s.reads.set(id, r.with("phase", "success-queued"))) }
  }
  // Invalid id/username/date represents xAccount throwing, without modeling
  // individual bytes. It is a client validation outcome, not public data.
  action queueMalformed(id: int): bool = {
    val r = s.reads.get(id)
    all { ids.contains(id), r.phase == "pending", not(r.aborted),
      s' = s.with("reads", s.reads.set(id,
        r.with("phase", "success-queued").with("result", -1))) }
  }
  action queueFailure(id: int): bool = {
    val r = s.reads.get(id)
    all { ids.contains(id), Set("pending", "observed").contains(r.phase),
      s' = s.with("reads", s.reads.set(id, r.with("phase", "error-queued"))) }
  }
  action deliverSuccess(id: int): bool = {
    val r = s.reads.get(id)
    val owner = s.instances.get(r.instance)
    all { ids.contains(id), r.phase == "success-queued",
      s' = if (r.result == -1)
        s.with("reads", s.reads.set(id, r.with("phase", "error-queued")))
      else s.with("reads", s.reads.set(id, r.with("phase", "done")))
        .with("instances", s.instances.set(r.instance,
          owner.with("account", r.result).with("emptyObserved", r.result == 0))) }
  }
  action deliverFailure(id: int): bool = {
    val r = s.reads.get(id)
    val owner = s.instances.get(r.instance)
    all { ids.contains(id), r.phase == "error-queued",
      s' = s.with("reads", s.reads.set(id, r.with("phase", "done")))
        .with("instances", if (r.aborted) s.instances
          else s.instances.set(r.instance, owner.with("failed", true))) }
  }
  // XAccountLink opens a numeric-ID URL in a separate tab, with noreferrer.
  // It does not mutate the connection, grant Points, or start an OAuth flow.
  action openPublicLink = all {
    view == "ready", s' = s.with("opened", current.account)
  }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet row = Set("public", "link-private", "member-private", "link-missing", "member-missing").oneOf()
    any { publication(id, row), viewerChanges(actor), previewOrigin,
      suppressQuery, changeActorProp, startRead(id), replaceProfile(id),
      normalizedKeyUnchanged, depart, observePublicQuery(id), queueSuccess(id),
      queueMalformed(id), queueFailure(id), deliverSuccess(id),
      deliverFailure(id), openPublicLink, s' = s }
  }
  val invariant = all {
    ids.contains(s.active), Set(0, 1, 2).contains(s.viewer),
    ids.forall(id => {
      val i = s.instances.get(id)
      val r = s.reads.get(id)
      all { ids.contains(i.actor), Set(0, 1, 2).contains(i.account),
        i.account > 0 implies s.disclosed.contains(i.account),
        ids.contains(r.instance), ids.contains(r.actor),
        Set(-1, 0, 1, 2).contains(r.result),
        r.result > 0 implies r.publicObserved }
    }),
    s.opened > 0 implies s.disclosed.contains(s.opened)
  }

  run publicLinkReadyTest = init.then(startRead(1)).then(observePublicQuery(1))
    .then(queueSuccess(1)).then(deliverSuccess(1)).then(openPublicLink)
    .expect(view == "ready" and s.opened == 1 and invariant)
  run loadingHasNoLinkTest = init.then(startRead(1))
    .expect(view == "loading" and current.account == 0)
  run privateLinkIsMissingTest = init.then(publication(1, "link-private"))
    .then(startRead(1)).then(observePublicQuery(1)).then(queueSuccess(1))
    .then(deliverSuccess(1)).expect(view == "missing" and current.account == 0)
  run privateMemberIsMissingTest = init.then(publication(1, "member-private"))
    .then(startRead(1)).then(observePublicQuery(1)).then(queueSuccess(1))
    .then(deliverSuccess(1)).expect(view == "missing" and current.account == 0)
  run missingLinkIsMissingTest = init.then(publication(1, "link-missing"))
    .then(startRead(1)).then(observePublicQuery(1)).then(queueSuccess(1))
    .then(deliverSuccess(1)).expect(view == "missing")
  run missingMemberIsMissingTest = init.then(publication(1, "member-missing"))
    .then(startRead(1)).then(observePublicQuery(1)).then(queueSuccess(1))
    .then(deliverSuccess(1)).expect(view == "missing")
  run unavailableReadTest = init.then(startRead(1)).then(queueFailure(1))
    .then(deliverFailure(1)).expect(view == "error" and current.account == 0)
  run invalidIdentityTest = init.then(startRead(1)).then(queueMalformed(1))
    .then(deliverSuccess(1)).then(deliverFailure(1)).expect(view == "error")
  run previewDoesNotRequestTest = init.then(previewOrigin).then(suppressQuery)
    .expect(view == "suppressed" and s.reads.get(1).phase == "unused")
  run laterPrivacyChangeDoesNotEraseObservedReplyTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(publication(1, "member-private"))
    .then(queueSuccess(1)).then(deliverSuccess(1))
    .expect(view == "ready" and s.rows.get(1) == "member-private" and invariant)
  run viewerChangeDoesNotRefreshPublicLinkTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(queueSuccess(1)).then(deliverSuccess(1))
    .then(viewerChanges(2)).then(publication(1, "link-private"))
    .expect(view == "ready" and s.reads.get(2).phase == "unused")
  run newMountObservesCurrentPrivacyTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(queueSuccess(1)).then(deliverSuccess(1))
    .then(publication(1, "member-private")).then(depart).then(replaceProfile(1))
    .then(startRead(2)).then(observePublicQuery(2)).then(queueSuccess(2))
    .then(deliverSuccess(2)).expect(view == "missing" and current.account == 0)
  run abortedReadDoesNotShowErrorTest = init.then(startRead(1)).then(depart)
    .then(queueFailure(1)).then(deliverFailure(1))
    .expect(view == "absent" and not(s.instances.get(1).failed))
  run lateSuccessDoesNotWriteNewInstanceTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(queueSuccess(1)).then(replaceProfile(2))
    .then(deliverSuccess(1)).expect(current.account == 0 and view == "loading"
      and s.instances.get(1).account == 1)
  run actorChangeHasNoSynchronousSuccessGuardTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(queueSuccess(1)).then(changeActorProp)
    .then(startRead(2)).then(deliverSuccess(1))
    .expect(current.actor == 2 and current.account == 1 and view == "ready")
  run currentActorResponseReplacesOldQueuedSuccessTest = init.then(startRead(1))
    .then(observePublicQuery(1)).then(queueSuccess(1)).then(changeActorProp)
    .then(startRead(2)).then(deliverSuccess(1)).then(observePublicQuery(2))
    .then(queueSuccess(2)).then(deliverSuccess(2))
    .expect(current.actor == 2 and current.account == 2)
  run lateNullCanReplaceCurrentActorAccountTest = init.then(publication(1, "link-private"))
    .then(startRead(1)).then(observePublicQuery(1)).then(queueSuccess(1))
    .then(changeActorProp).then(startRead(2)).then(observePublicQuery(2))
    .then(queueSuccess(2)).then(deliverSuccess(2)).then(deliverSuccess(1))
    .expect(current.actor == 2 and view == "missing" and current.account == 0)
  run normalizedRouteKeyDoesNotRestartReadTest = init.then(startRead(1))
    .then(normalizedKeyUnchanged).expect(s.active == 1 and current.request == 1
      and not(current.effectPending) and s.reads.get(2).phase == "unused")
}
