// @source src/BountySubmittedPayments.tsx
// @source src/SecurityBounty.tsx
// @evidence tests/e2e/solana-history-recovery.spec.ts
// Two action tokens and case/generation/network contexts, two candidate values,
// one row per context, actors absent/1/2. This refines lifetime and nested
// preflight boundaries; ui_submitted_payment_recovery covers row lists and
// partial storage writes, ui_submitted_candidate_ownership covers exact CAS.
// The same current-owner predicate crosses both parent GETs and the POST's
// identity helper. Session observation, helper return and use are separate.
// An already-dispatched backend effect may finish after departure; it is not
// rolled back and cannot publish a case update through the retired owner.
// Backend receipt verification is external. Source-only, not executed.
module ui_submitted_payment_lifetime {
  val ids = Set(1, 2)
  type Request = { phase: str, context: int, actor: int, candidate: int,
    expected: int, observed: int, allowed: bool, cookie: int }
  val unused: Request = { phase: "unused", context: 1, actor: 1, candidate: 0,
    expected: 0, observed: 0, allowed: false, cookie: 0 }
  type State = { mounted: bool, parent: bool, context: int, actor: int,
    active: int, busy: int, error: bool, draft: int, store: int -> int,
    requests: int -> Request, writes: Set[int], posts: Set[int], accepted: Set[int],
    updates: Set[int], badWrite: bool, badPost: bool }
  var s: State
  action init = s' = { mounted: true, parent: true, context: 1, actor: 1,
    active: 0, busy: 0, error: false, draft: 1, store: Map(1 -> 0, 2 -> 0),
    requests: ids.mapBy(_ => unused), writes: Set(), posts: Set(), accepted: Set(),
    updates: Set(), badWrite: false, badPost: false }
  def request(id: int): Request = s.requests.get(id)
  def owns(id: int): bool = s.mounted and s.active == id and request(id).context == s.context
  def finish(id: int, error: bool): State = s.with("requests",
    s.requests.set(id, request(id).with("phase", "finally")))
    .with("error", if (owns(id)) error else s.error)
  action edit(value: int): bool = all { s.mounted, Set(1, 2).contains(value), s' = s.with("draft", value) }
  action actorChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("actor", actor) }
  action replaceContext = all { s.context == 1, s.mounted,
    s' = s.with("context", 2).with("active", 0).with("busy", 0).with("error", false).with("draft", 2) }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0).with("busy", 0) }
  action parentDeparts = s' = s.with("parent", false).with("mounted", false).with("active", 0).with("busy", 0)
  action begin(id: int): bool = all { s.mounted, s.active == 0, request(id).phase == "unused",
    s' = s.with("active", id).with("busy", id).with("error", false).with("requests",
      s.requests.set(id, { phase: "session", context: s.context, actor: 1,
        candidate: s.draft, expected: s.store.get(s.context), observed: 0, allowed: false, cookie: 0 })) }
  action observeSession(id: int): bool = all { request(id).phase == "session",
    s' = s.with("requests", s.requests.set(id, request(id).with("phase", "session-observed").with("observed", s.actor))) }
  action returnSession(id: int): bool = all { request(id).phase == "session-observed",
    s' = s.with("requests", s.requests.set(id, request(id).with("phase", "session-returned"))) }
  action consumeSession(id: int): bool = all { request(id).phase == "session-returned",
    s' = if (not(owns(id))) finish(id, false)
      else if (request(id).observed != request(id).actor) finish(id, true)
      else s.with("requests", s.requests.set(id, request(id).with("phase", "authorize"))) }
  action parentRead(id: int, allowed: bool): bool = all { Set("authorize", "verify-get").contains(request(id).phase),
    s' = s.with("requests", s.requests.set(id, request(id)
      .with("phase", if (request(id).phase == "authorize") "authorize-observed" else "verify-observed")
      .with("observed", s.actor).with("allowed", allowed))) }
  action parentReturn(id: int): bool = all { Set("authorize-observed", "verify-observed").contains(request(id).phase),
    s' = s.with("requests", s.requests.set(id, request(id)
      .with("phase", if (request(id).phase == "authorize-observed") "authorize-returned" else "verify-returned"))) }
  action consumeParent(id: int): bool = all { Set("authorize-returned", "verify-returned").contains(request(id).phase),
    s' = if (not(owns(id))) finish(id, false)
      else if (not(s.parent) or not(request(id).allowed) or request(id).observed != request(id).actor) finish(id, true)
      else s.with("requests", s.requests.set(id, request(id)
        .with("phase", if (request(id).phase == "authorize-returned") "persist" else "post-session"))) }
  action persist(id: int, works: bool): bool = all { request(id).phase == "persist",
    s' = if (not(owns(id))) finish(id, false)
      else if (not(works) or s.store.get(request(id).context) != request(id).expected) finish(id, true)
      else s.with("store", s.store.set(request(id).context, request(id).candidate))
        .with("writes", s.writes.union(Set(id))).with("requests", s.requests.set(id, request(id).with("phase", "verify-get"))) }
  action observePostSession(id: int): bool = all { request(id).phase == "post-session",
    s' = s.with("requests", s.requests.set(id, request(id).with("phase", "post-observed").with("observed", s.actor))) }
  action returnPostSession(id: int): bool = all { request(id).phase == "post-observed",
    s' = s.with("requests", s.requests.set(id, request(id).with("phase", "post-returned"))) }
  action dispatch(id: int): bool = all { request(id).phase == "post-returned",
    s' = if (not(owns(id))) finish(id, false)
      else if (not(s.parent) or request(id).observed != request(id).actor) finish(id, true)
      else s.with("posts", s.posts.union(Set(id))).with("requests", s.requests.set(id,
        request(id).with("phase", "backend").with("cookie", s.actor))) }
  action backend(id: int, exact: bool): bool = all { request(id).phase == "backend",
    s' = s.with("accepted", if (exact and request(id).cookie == request(id).actor) s.accepted.union(Set(id)) else s.accepted)
      .with("requests", s.requests.set(id, request(id).with("phase", "reply"))) }
  action publish(id: int): bool = all { request(id).phase == "reply",
    s' = if (owns(id) and s.parent and s.actor == request(id).actor and s.accepted.contains(id))
      finish(id, false).with("updates", s.updates.union(Set(id))) else finish(id, owns(id)) }
  action settle(id: int): bool = all { request(id).phase == "finally",
    s' = s.with("requests", s.requests.set(id, request(id).with("phase", "done")))
      .with("active", if (owns(id)) 0 else s.active).with("busy", if (owns(id)) 0 else s.busy) }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet value = Set(1, 2).oneOf()
    nondet yes = Set(false, true).oneOf()
    any { edit(value), actorChanges(actor), replaceContext, depart, parentDeparts, begin(id),
      observeSession(id), returnSession(id), consumeSession(id), parentRead(id, yes), parentReturn(id),
      consumeParent(id), persist(id, yes), observePostSession(id), returnPostSession(id), dispatch(id),
      backend(id, yes), publish(id), settle(id), s' = s }
  }
  val invariant = all { s.busy == s.active, not(s.badWrite), not(s.badPost),
    s.accepted.subseteq(s.posts), s.updates.subseteq(s.accepted),
    s.active > 0 implies owns(s.active), not(s.mounted) implies s.active == 0 }
  action identity(id: int): bool = observeSession(id).then(returnSession(id)).then(consumeSession(id))
  action authority(id: int): bool = parentRead(id, true).then(parentReturn(id)).then(consumeParent(id))
  action prepared(id: int): bool = begin(id).then(identity(id)).then(authority(id))
  action ready(id: int): bool = prepared(id).then(persist(id, true)).then(authority(id))
  action posted(id: int): bool = ready(id).then(observePostSession(id)).then(returnPostSession(id)).then(dispatch(id))
  run completeCurrentOwnerTest = init.then(posted(1)).then(backend(1, true)).then(publish(1)).then(settle(1))
    .expect(s.updates == Set(1) and s.store.get(1) == 1 and invariant)
  run departureBeforeIdentityReturnsTest = init.then(begin(1)).then(observeSession(1)).then(depart)
    .then(returnSession(1)).then(consumeSession(1)).expect(s.writes == Set() and s.posts == Set() and invariant)
  run departureDuringAuthorizationTest = init.then(begin(1)).then(identity(1)).then(parentRead(1, true))
    .then(depart).then(parentReturn(1)).then(consumeParent(1)).expect(s.store.get(1) == 0 and s.posts == Set())
  run departureAfterAuthorizationReturnTest = init.then(prepared(1)).then(depart).then(persist(1, true))
    .expect(s.store.get(1) == 0 and invariant)
  run departureDuringVerificationGetTest = init.then(prepared(1)).then(persist(1, true))
    .then(parentRead(1, true)).then(depart).then(parentReturn(1)).then(consumeParent(1))
    .expect(s.store.get(1) == 1 and s.posts == Set() and invariant)
  run departureAfterPostSessionObservationTest = init.then(ready(1)).then(observePostSession(1)).then(depart)
    .then(returnPostSession(1)).then(dispatch(1)).expect(s.posts == Set() and invariant)
  run parentDepartureAfterPostHelperReturnTest = init.then(ready(1)).then(observePostSession(1))
    .then(returnPostSession(1)).then(parentDeparts).then(dispatch(1)).expect(s.posts == Set() and invariant)
  run oldFinallyCannotClearNewActionTest = init.then(prepared(1)).then(replaceContext).then(begin(2))
    .then(persist(1, true)).then(settle(1)).expect(s.active == 2 and s.busy == 2 and not(s.error) and invariant)
  run oldFailureCannotReplaceNewErrorStateTest = init.then(prepared(1)).then(replaceContext).then(begin(2))
    .then(persist(1, false)).expect(s.active == 2 and not(s.error) and invariant)
  run replacementContextKeepsItsOwnCandidateTest = init.then(prepared(1)).then(replaceContext)
    .then(posted(2)).then(persist(1, true)).expect(s.store.get(1) == 0 and s.store.get(2) == 2 and invariant)
  run editsDuringAuthorizationKeepCapturedCandidateTest = init.then(begin(1)).then(edit(2)).then(identity(1))
    .then(authority(1)).then(persist(1, true)).expect(s.store.get(1) == 1 and s.draft == 2)
  run refusedAuthorityDoesNotWriteTest = init.then(begin(1)).then(identity(1)).then(parentRead(1, false))
    .then(parentReturn(1)).then(consumeParent(1)).expect(s.writes == Set() and s.error)
  run storageFailureDoesNotDispatchTest = init.then(prepared(1)).then(persist(1, false))
    .expect(s.posts == Set() and s.store.get(1) == 0 and s.error)
  run actorChangeAfterPostObservationIsServerFencedTest = init.then(ready(1)).then(observePostSession(1))
    .then(actorChanges(2)).then(returnPostSession(1)).then(dispatch(1)).then(backend(1, true))
    .expect(s.posts == Set(1) and s.accepted == Set())
  run alreadyDispatchedEffectSurvivesDepartureTest = init.then(posted(1)).then(depart)
    .then(backend(1, true)).then(publish(1)).expect(s.accepted == Set(1) and s.updates == Set() and invariant)
  // Historical missing owner guards: excluded from step, retain counterexamples.
  action oldPersist(id: int): bool = all { request(id).phase == "persist",
    s' = s.with("store", s.store.set(request(id).context, request(id).candidate)).with("badWrite", not(owns(id))) }
  action oldDispatch(id: int): bool = all { request(id).phase == "post-returned",
    s' = s.with("posts", s.posts.union(Set(id))).with("badPost", not(owns(id))) }
  run oldChildContinuationWritesAfterDepartureTest = init.then(prepared(1)).then(depart).then(oldPersist(1))
    .expect(s.badWrite and s.store.get(1) == 1)
  run oldParentHelperStartsPostAfterDepartureTest = init.then(ready(1)).then(observePostSession(1))
    .then(returnPostSession(1)).then(depart).then(oldDispatch(1)).expect(s.badPost and s.posts == Set(1))
}
