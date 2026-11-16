// @source src/lib/use-public-resource.ts
// @evidence tests/e2e/admin-refresh-retention.spec.ts
// Two requests/loader identities. The loader may ignore its AbortSignal.
// The hook deadline still settles exactly once. Source-only; unexecuted.
module ui_resource_deadline {
  type Request = { phase: str, loader: int, kept: int, terminal: str }
  type State = { mounted: bool, current: int, loader: int, retain: bool,
    timeoutRetention: bool, data: int, cached: int, cachedLoader: int,
    status: str, error: str, lastResult: int, requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mounted: true, current: 0, loader: 1, retain: false,
    timeoutRetention: true, data: 0, cached: 0, cachedLoader: 0,
    status: "loading", error: "none", lastResult: 0,
    requests: ids.mapBy(_ => { phase: "unused", loader: 1, kept: 0, terminal: "none" }) }
  action retainedMode = all { s.current == 0, s' = s.with("retain", true) }
  action checkedRetentionMode = all { s.current == 0,
    s' = s.with("retain", true).with("timeoutRetention", false) }
  action begin(id: int): bool = {
    val kept = if (s.retain and s.cachedLoader == s.loader) s.cached else 0
    all { s.mounted, ids.contains(id), s.requests.get(id).phase == "unused",
      s' = s.with("current", id).with("data", if (kept == 0) 0 else s.data)
        .with("status", if (kept == 0) "loading" else s.status)
        .with("cached", if (kept == 0) 0 else s.cached)
        .with("requests", s.requests.set(id,
          { phase: "pending", loader: s.loader, kept: kept, terminal: "none" })) }
  }
  def owns(id: int): bool = s.mounted and s.current == id and s.loader == s.requests.get(id).loader
  action success(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "pending",
      s' = if (not(owns(id))) s.with("requests", s.requests.set(id,
        r.with("phase", "done").with("terminal", "ignored")))
      else s.with("requests", s.requests.set(id, r.with("phase", "done").with("terminal", "success")))
        .with("status", "ready").with("data", id).with("error", "none").with("lastResult", id)
        .with("cached", if (s.retain) id else 0)
        .with("cachedLoader", if (s.retain) r.loader else 0) }
  }
  action failure(id: int, transient: bool, retentionAllowed: bool): bool = {
    val r = s.requests.get(id)
    val keep = r.kept != 0 and transient and retentionAllowed
    all { r.phase == "pending",
      s' = if (not(owns(id))) s.with("requests", s.requests.set(id,
        r.with("phase", "done").with("terminal", "ignored")))
      else s.with("requests", s.requests.set(id, r.with("phase", "done").with("terminal", "failure")))
        .with("status", if (keep) "ready" else "error")
        .with("data", if (keep) r.kept else 0).with("cached", if (keep) s.cached else 0)
        .with("error", "failure").with("lastResult", id) }
  }
  action timeout(id: int): bool = {
    val r = s.requests.get(id)
    val keep = r.kept != 0 and s.timeoutRetention
    all { r.phase == "pending", owns(id),
      s' = s.with("requests", s.requests.set(id, r.with("phase", "done").with("terminal", "timeout")))
        .with("status", if (keep) "ready" else "error")
        .with("data", if (keep) r.kept else 0).with("cached", if (keep) s.cached else 0)
        .with("error", "timeout").with("lastResult", id) }
  }
  action lateOutcome(id: int): bool = all { s.requests.get(id).phase == "done", s' = s }
  action changeLoader = all { s.loader == 1, s' = s.with("loader", 2).with("current", 0) }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("current", 0) }
  action step = {
    nondet id = ids.oneOf()
    nondet transient = Set(false, true).oneOf()
    nondet allowed = Set(false, true).oneOf()
    any { retainedMode, checkedRetentionMode, begin(id), success(id), failure(id, transient, allowed),
      timeout(id), lateOutcome(id), changeLoader, depart, s' = s }
  }
  val invariant = all { s.status == "ready" implies s.data != 0,
    if (s.lastResult == 0) true else s.requests.get(s.lastResult).phase == "done" }
  run timeoutBeatsLateSuccessTest = init.then(begin(1)).then(timeout(1)).then(lateOutcome(1))
    .expect(s.status == "error" and s.error == "timeout" and s.data == 0)
  run successBeatsLaterOutcomeTest = init.then(begin(1)).then(success(1)).then(lateOutcome(1))
    .expect(s.data == 1 and s.error == "none")
  run publicTimeoutCanRetainOldRecordTest = init.then(retainedMode).then(begin(1)).then(success(1))
    .then(begin(2)).then(timeout(2)).then(lateOutcome(2)).expect(s.data == 1 and s.error == "timeout")
  run adminTimeoutCannotRetainUnverifiedRecordTest = init.then(checkedRetentionMode).then(begin(1)).then(success(1))
    .then(begin(2)).then(timeout(2)).then(lateOutcome(2)).expect(s.data == 0 and s.status == "error")
  run checkedTransientFailureRetainsRecordTest = init.then(checkedRetentionMode).then(begin(1)).then(success(1))
    .then(begin(2)).then(failure(2, true, true)).expect(s.data == 1 and s.error == "failure")
  run uncheckedTransientFailureDropsRecordTest = init.then(checkedRetentionMode).then(begin(1)).then(success(1))
    .then(begin(2)).then(failure(2, true, false)).expect(s.data == 0)
  run authoritativeFailureDropsRecordTest = init.then(retainedMode).then(begin(1)).then(success(1))
    .then(begin(2)).then(failure(2, false, true)).expect(s.data == 0)
  run retryAfterTimeoutCanSucceedTest = init.then(begin(1)).then(timeout(1)).then(begin(2)).then(success(2))
    .then(lateOutcome(1)).expect(s.data == 2 and s.lastResult == 2)
  run changedLoaderDoesNotReuseCacheTest = init.then(retainedMode).then(begin(1)).then(success(1))
    .then(changeLoader).then(begin(2)).expect(s.data == 0 and s.status == "loading")
  run departedResponseIsIgnoredTest = init.then(begin(1)).then(depart).then(success(1)).expect(s.data == 0)
}
