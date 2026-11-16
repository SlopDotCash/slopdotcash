// @source workers/notify/security.ts
// @source workers/notify/activity.ts
// @evidence workers/notify/security.test.ts
// @evidence backend/notifications/email.test.ts
// @evidence formal/tests/notification-delivery.test.ts
// Two consecutive retries from the existing five-attempt budget, starting
// with the digest retained from an earlier failed attempt. Attempt 1/2 are
// local representatives, not the complete budget counter. Actual
// retry times, destination validity, consent and operator evidence are inputs;
// notification_delivery retains the five-attempt and evidence-ID model.
// The last local check cannot atomically fence an external provider call.
module notification_attempt_ownership {
  type Worker = { phase: str, destination: int }
  var s: { phase: str, attempt: int, destination: int, retryTime: int,
    workers: int -> Worker, calls: Set[int] }
  val ids = Set(1, 2)
  val empty = { phase: "unused", destination: 0 }
  action init = s' = { phase: "retrying", attempt: 0, destination: 1,
    retryTime: 0, workers: ids.mapBy(_ => empty), calls: Set() }
  def owns(id: int): bool = s.phase == "sending" and s.attempt == id
  action claim(id: int): bool = all { ids.contains(id),
    Set("queued", "retrying").contains(s.phase), id == s.attempt + 1,
    s.workers.get(id).phase == "unused",
    s' = s.with("phase", "sending").with("attempt", id)
      .with("workers", s.workers.set(id, { phase: "claimed", destination: 0 })) }
  action destination(id: int, value: int): bool = {
    val worker = s.workers.get(id)
    all { ids.contains(value), worker.phase == "claimed",
      s' = if (owns(id)) s.with("destination", value)
        .with("workers", s.workers.set(id, { phase: "prepared", destination: value }))
      else s.with("workers", s.workers.set(id, worker.with("phase", "stopped"))) }
  }
  action finalCheck(id: int): bool = {
    val worker = s.workers.get(id)
    all { worker.phase == "prepared",
      s' = s.with("workers", s.workers.set(id,
        worker.with("phase", if (owns(id)) "ready" else "stopped"))) }
  }
  action send(id: int): bool = all { s.workers.get(id).phase == "ready",
    not(s.calls.contains(id)),
    s' = s.with("calls", s.calls.union(Set(id)))
      .with("workers", s.workers.set(id, s.workers.get(id).with("phase", "started"))) }
  action complete(id: int): bool = all { s.workers.get(id).phase == "started",
    s' = (if (owns(id)) s.with("phase", "provider-accepted") else s)
      .with("workers", s.workers.set(id, s.workers.get(id).with("phase", "done"))) }
  action retry(id: int): bool = all { s.workers.get(id).phase != "unused",
    s' = (if (owns(id)) s.with("phase", "retrying").with("retryTime", id) else s)
      .with("workers", s.workers.set(id, s.workers.get(id).with("phase", "done"))) }
  action retire = all { s.phase == "sending", s' = s.with("phase", "ambiguous") }
  // Independent non-acceptance evidence is an input; it never rewrites a call.
  action negativeProof = all { s.phase == "ambiguous", s.destination > 0,
    s' = s.with("phase", "retrying").with("retryTime", 2) }
  action step = {
    nondet id = ids.oneOf()
    nondet value = ids.oneOf()
    any { claim(id), destination(id, value), finalCheck(id), send(id),
      complete(id), retry(id), retire, negativeProof, s' = s }
  }
  val invariant = all { s.attempt >= 0, s.attempt <= 2,
    s.calls.subseteq(ids), s.calls.size() <= s.attempt,
    ids.forall(id => s.calls.contains(id) implies s.workers.get(id).destination > 0) }
  run staleDestinationCannotReplaceSuccessorTest = init.then(claim(1))
    .then(retire).then(negativeProof).then(claim(2)).then(destination(2, 2)).then(destination(1, 1))
    .expect(s.destination == 2 and s.attempt == 2 and s.workers.get(1).phase == "stopped")
  run staleRetryCannotChangeSuccessorTimeTest = init.then(claim(1)).then(destination(1, 1))
    .then(retire).then(negativeProof).then(claim(2)).then(destination(2, 2)).then(retry(1))
    .expect(s.phase == "sending" and s.destination == 2 and s.retryTime == 2)
  run lostFinalCheckStopsNewSendTest = init.then(claim(1)).then(destination(1, 1)).then(retire).then(finalCheck(1))
    .expect(s.calls.size() == 0 and s.workers.get(1).phase == "stopped").then(send(1).fail())
  run currentAttemptCanSendTest = init.then(claim(1)).then(destination(1, 1)).then(finalCheck(1))
    .then(send(1)).then(complete(1)).expect(s.phase == "provider-accepted" and s.calls == Set(1))
  run retirementAfterLastCheckCannotRecallCallTest = init.then(claim(1)).then(destination(1, 1)).then(finalCheck(1))
    .then(retire).then(send(1)).then(complete(1)).expect(s.phase == "ambiguous" and s.calls == Set(1))
  run oldProviderCompletionCannotSettleSuccessorTest = init.then(claim(1)).then(destination(1, 1)).then(finalCheck(1))
    .then(send(1)).then(retire).then(negativeProof).then(claim(2)).then(destination(2, 2)).then(complete(1))
    .expect(s.phase == "sending" and s.attempt == 2 and s.destination == 2)
  run currentPreparationFailureKeepsRetryTest = init.then(claim(1)).then(retry(1))
    .expect(s.phase == "retrying" and s.retryTime == 1 and s.calls.size() == 0)
}
