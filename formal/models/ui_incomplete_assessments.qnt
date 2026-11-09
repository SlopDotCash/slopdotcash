// @source src/IncompleteAssessments.tsx
// @source src/Inbox.tsx
// @source src/lib/incomplete-assessments.ts
// @source src/lib/notifications.ts
// @evidence tests/e2e/incomplete-assessments.spec.ts
// Initial data is the already actor-checked parent response. Two requests,
// two pages/actors and two lifetimes cover child reads and parent invalidation.
// Parsing and backend authority are inputs. No read starts paid assessment work.
module ui_incomplete_assessments {
  type Request = { phase: str, actor: int, lifetime: int, page: int, result: str }
  var s: { mounted: bool, lifetime: int, actor: int, cookie: int,
    parentVisible: int, page: int, error: bool, active: int, reload: bool,
    requests: int -> Request }
  val ids = Set(1, 2)
  val empty = { phase: "unused", actor: 0, lifetime: 0, page: 0, result: "none" }
  action init = s' = { mounted: true, lifetime: 1, actor: 1, cookie: 1,
    parentVisible: 1, page: 1, error: false, active: 0, reload: false,
    requests: ids.mapBy(_ => empty) }
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).actor == s.actor
    and s.requests.get(id).lifetime == s.lifetime
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  // A newer effect aborts its predecessor; this is not a synchronous mutex.
  action begin(id: int, page: int): bool = all { s.mounted,
    ids.contains(id), ids.contains(page), s.requests.get(id).phase == "unused",
    s' = s.with("page", 0).with("error", false).with("active", id)
      .with("requests", s.requests.set(id, { phase: "http", actor: s.actor,
        lifetime: s.lifetime, page: page, result: "none" })) }
  action reply(id: int, result: str): bool = all { s.requests.get(id).phase == "http",
    Set("success", "refused", "temporary", "wrong-recipient").contains(result),
    s' = s.with("requests", s.requests.set(id,
      s.requests.get(id).with("phase", "checking").with("result", result))) }
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "checking",
      s' = if (not(owns(id))) done
        else if (not(available)) done.with("parentVisible", 0).with("page", 0)
          .with("reload", true).with("mounted", false)
        else if (s.cookie != r.actor) done.with("actor", s.cookie).with("parentVisible", 0)
          .with("page", 0).with("reload", true).with("mounted", false)
        else if (Set("refused", "wrong-recipient").contains(r.result))
          done.with("parentVisible", 0).with("page", 0).with("reload", true).with("mounted", false)
        else if (r.result == "temporary") done.with("error", true)
        else done.with("page", r.page) }
  }
  action initialUnavailable = all { s.active == 0, s.mounted,
    s' = s.with("page", 0).with("error", true) }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("parentVisible", 0).with("page", 0).with("active", 0) }
  action remount = all { not(s.mounted), s.lifetime == 1, s.cookie != 0,
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", s.cookie)
      .with("parentVisible", s.cookie).with("page", 1).with("error", false)
      .with("active", 0).with("reload", false) }
  action step = {
    nondet id = ids.oneOf()
    nondet page = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet result = Set("success", "refused", "temporary", "wrong-recipient").oneOf()
    nondet available = Set(false, true).oneOf()
    any { cookieChanges(actor), begin(id, page), reply(id, result), recheck(id, available),
      initialUnavailable, depart, remount, s' = s }
  }
  val invariant = all { s.parentVisible > 0 implies s.parentVisible == s.actor and s.mounted,
    not(s.mounted) implies s.page == 0, s.page >= 0, s.page <= 2 }
  run matchingNextPageTest = init.then(begin(1, 2)).then(reply(1, "success")).then(recheck(1, true))
    .expect(s.page == 2 and s.parentVisible == 1)
  run sameActorOutageKeepsParentTest = init.then(begin(1, 2)).then(reply(1, "temporary")).then(recheck(1, true))
    .expect(s.error and s.page == 0 and s.parentVisible == 1)
  run refusedSameActorReloadsParentTest = init.then(begin(1, 2)).then(reply(1, "refused")).then(recheck(1, true))
    .expect(s.reload and s.parentVisible == 0)
  run successfulOldPageCannotRetainParentTest = init.then(begin(1, 2)).then(reply(1, "success"))
    .then(cookieChanges(2)).then(recheck(1, true)).expect(s.actor == 2 and s.parentVisible == 0)
  run refusalAfterSwapCannotRetainParentTest = init.then(begin(1, 2)).then(cookieChanges(2))
    .then(reply(1, "refused")).then(recheck(1, true)).expect(s.reload and s.parentVisible == 0)
  run transportFailureStillChecksActorTest = init.then(begin(1, 2)).then(cookieChanges(2))
    .then(reply(1, "temporary")).then(recheck(1, true)).expect(s.actor == 2 and s.parentVisible == 0)
  run sessionOutageHidesParentTest = init.then(begin(1, 2)).then(reply(1, "success"))
    .then(recheck(1, false)).expect(s.reload and s.parentVisible == 0)
  run signOutClearsParentTest = init.then(begin(1, 2)).then(reply(1, "success"))
    .then(cookieChanges(0)).then(recheck(1, true)).expect(s.actor == 0 and s.parentVisible == 0)
  run departedReplyCannotNotifyReplacementTest = init.then(begin(1, 2)).then(depart)
    .then(cookieChanges(2)).then(remount).then(reply(1, "success")).then(recheck(1, true))
    .expect(s.actor == 2 and s.parentVisible == 2 and not(s.reload))
  run newerPageOwnsCompletionTest = init.then(begin(1, 2)).then(begin(2, 1))
    .then(reply(2, "success")).then(recheck(2, true)).then(reply(1, "refused")).then(recheck(1, true))
    .expect(s.page == 1 and s.parentVisible == 1 and not(s.reload))
  run unavailableInitialCanRetryTest = init.then(initialUnavailable).then(begin(1, 1))
    .then(reply(1, "success")).then(recheck(1, true)).expect(s.page == 1 and not(s.error))
}
