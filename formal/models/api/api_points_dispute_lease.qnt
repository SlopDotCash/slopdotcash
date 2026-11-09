// @source workers/slopbot/points-disputes.ts
// @source workers/slopbot/models.ts
// @source workers/slopbot/appeals.ts
// @source migrations/0114_points_dispute_intake.sql
// @evidence backend/points/disputes.test.ts
// processPointsDispute: a claim UPDATE sets claim_token/claim_until when the
// row is unresolved, lacks a draft or an escalation, and has no live lease.
// The worker then re-reads the row; a retained draft is resumed without a
// model call. Model calls, recordDraft and escalateAppeal are fenced by the
// current unexpired token at their own observation/SQL boundaries; recordCalls
// is not fenced. The model-call guard awaits currentScope after observing the
// lease, so a replaced lease can still finish that guard and start a call.
// A call whose cost was not recorded
// rethrows; every other error escalates when the lease is still held. The
// finally block releases only the worker's own lease.
// processPendingPointsDisputes visits the disputes selected at the start of
// a cron run in order. A rethrow is collected and the run continues; the run
// reports an AggregateError after its last visit.
// Bounds: two disputes, worker 1 is the cron run and worker 2 a concurrent
// route request or overlapping run on dispute 1; three lease tokens, clock 0..3, a lease
// lasts one tick, one cron run and one representative provider leg per lease.
// The production triage route can also try a fallback; its full provider-loop
// cardinality is outside this bound. Provider and GitHub results are
// abstracted to "uphold", "deny" or "unavailable".
module api_points_dispute_lease {
  type Dispute = { draft: str, escalated: bool, resolved: bool, token: int,
    until: int, claims: int, calls: int, callsAtDraft: int, draftWrites: int,
    frozen: (str, bool) }
  type Worker = { phase: str, d: int, token: int, sawDraft: str, admitted: bool, thrown: bool }
  var disputes: int -> Dispute
  var workers: int -> Worker
  var now: int
  var nextToken: int
  var cursor: int
  var runSet: Set[int]
  var visited: Set[int]
  var failures: int
  var runs: int
  var reported: int
  val DISPUTES = Set(1, 2)
  val WORKERS = Set(1, 2)
  val idleWorker = { phase: "idle", d: 0, token: 0, sawDraft: "none", admitted: false, thrown: false }
  action init = all {
    disputes' = DISPUTES.mapBy(_ => { draft: "none", escalated: false, resolved: false,
      token: 0, until: 0, claims: 0, calls: 0, callsAtDraft: 0, draftWrites: 0,
      frozen: ("none", false) }),
    workers' = WORKERS.mapBy(_ => idleWorker),
    now' = 0, nextToken' = 0, cursor' = 0, runSet' = Set(), visited' = Set(),
    failures' = 0, runs' = 0, reported' = -1,
  }
  def mayWrite(w: Worker): bool = all {
    disputes.get(w.d).token == w.token, now < disputes.get(w.d).until,
    not(disputes.get(w.d).resolved),
  }
  def claimable(d: int): bool = all {
    not(disputes.get(d).resolved),
    not(disputes.get(d).draft != "none" and disputes.get(d).escalated),
    disputes.get(d).until <= now,
  }
  action keepCron = all { cursor' = cursor, runSet' = runSet, visited' = visited,
    failures' = failures, runs' = runs, reported' = reported }
  action setWorker(w: int, v: Worker): bool = workers' = workers.set(w, v)
  // The cron worker may only visit its current batch item; the concurrent
  // worker contends for dispute 1 (dispute 2 is symmetric).
  def mayVisit(w: int, d: int): bool =
    if (w == 1) cursor == d and runSet.contains(d) else d == 1
  action claim(w: int, d: int): bool = all {
    workers.get(w).phase == "idle", mayVisit(w, d), claimable(d), nextToken < 3,
    disputes' = disputes.setBy(d, x => x.with("token", nextToken + 1).with("until", now + 1)
      .with("claims", x.claims + 1)),
    setWorker(w, { phase: "claimed", d: d, token: nextToken + 1, sawDraft: "none", admitted: false, thrown: false }),
    nextToken' = nextToken + 1, now' = now, keepCron,
  }
  // A refused claim (live lease, or a drafted and escalated row) returns.
  action refuse(w: int, d: int): bool = all {
    workers.get(w).phase == "idle", mayVisit(w, d), not(claimable(d)),
    setWorker(w, idleWorker.with("phase", "exit").with("d", d)),
    disputes' = disputes, now' = now, nextToken' = nextToken, keepCron,
  }
  action read(w: int): bool = all {
    workers.get(w).phase == "claimed",
    setWorker(w, workers.get(w).with("phase",
      if (disputes.get(workers.get(w).d).resolved) "exit" else "read")
      .with("sawDraft", disputes.get(workers.get(w).d).draft)),
    disputes' = disputes, now' = now, nextToken' = nextToken, keepCron,
  }
  action observeCallLease(w: int): bool = all {
    workers.get(w).phase == "read", workers.get(w).sawDraft == "none",
    setWorker(w, workers.get(w).with("admitted", mayWrite(workers.get(w))).with("phase", "scope")),
    disputes' = disputes, now' = now, nextToken' = nextToken, keepCron,
  }
  // This is the reply to the separate currentScope await. It does not reread
  // claim_token or draft after the earlier mayWrite observation.
  action scopeReply(w: int, allowed: bool): bool = all {
    workers.get(w).phase == "scope",
    val starts = workers.get(w).admitted and allowed
    disputes' = if (starts) disputes.setBy(workers.get(w).d, x => x.with("calls", x.calls + 1)) else disputes,
    // A blocked route returns an empty call list; its unavailable result is
    // still handled by afterCost and may escalate under a live lease.
    setWorker(w, workers.get(w).with("phase", if (starts) "calling" else "blocked")),
    now' = now, nextToken' = nextToken, keepCron,
  }
  action call(w: int): bool = observeCallLease(w).then(scopeReply(w, true))
  action recordCost(w: int): bool = all {
    workers.get(w).phase == "calling",
    setWorker(w, workers.get(w).with("phase", "called")),
    disputes' = disputes, now' = now, nextToken' = nextToken, keepCron,
  }
  // The call failed before its cost was recorded: rethrow after release.
  action throwBeforeCost(w: int): bool = all {
    workers.get(w).phase == "calling",
    setWorker(w, workers.get(w).with("phase", "exit").with("thrown", true)),
    disputes' = disputes, now' = now, nextToken' = nextToken, keepCron,
  }
  def escalated(x: Dispute): Dispute = x.with("escalated", true)
  // After the recorded call: a lost lease returns, an unusable result
  // escalates and a verdict records the draft.
  action afterCost(w: int, result: str): bool = {
    val wk = workers.get(w)
    all {
      (wk.phase == "called" or (wk.phase == "blocked" and result == "unavailable")),
      result.in(Set("uphold", "deny", "unavailable")),
      if (not(mayWrite(wk))) all { disputes' = disputes, setWorker(w, wk.with("phase", "exit")) }
      else if (result == "unavailable") all {
        disputes' = disputes.setBy(wk.d, x => escalated(x)),
        setWorker(w, wk.with("phase", "exit")) }
      else all {
        disputes' = disputes.setBy(wk.d, x => if (x.draft == "none")
          x.with("draft", result).with("callsAtDraft", x.calls)
            .with("draftWrites", x.draftWrites + 1) else x),
        setWorker(w, wk.with("phase", "drafted")) },
      now' = now, nextToken' = nextToken, keepCron,
    }
  }
  // A read that saw a draft, or a fresh draft, escalates under the lease.
  action escalate(w: int): bool = {
    val wk = workers.get(w)
    all {
      wk.phase == "drafted" or (wk.phase == "read" and wk.sawDraft != "none"),
      disputes' = if (mayWrite(wk)) disputes.setBy(wk.d, x => escalated(x)) else disputes,
      setWorker(w, wk.with("phase", "exit")),
      now' = now, nextToken' = nextToken, keepCron,
    }
  }
  // Any other error (GitHub, registry, a revoked scope) escalates if held.
  action error(w: int): bool = {
    val wk = workers.get(w)
    all {
      wk.phase.in(Set("claimed", "read", "scope", "blocked", "called", "drafted")),
      disputes' = if (mayWrite(wk)) disputes.setBy(wk.d, x => escalated(x)) else disputes,
      setWorker(w, wk.with("phase", "exit")),
      now' = now, nextToken' = nextToken, keepCron,
    }
  }
  // finally: release only the worker's own lease. The cron worker then
  // collects a rethrow and moves on to its next selected dispute.
  action release(w: int): bool = {
    val wk = workers.get(w)
    all {
      wk.phase == "exit",
      disputes' = if (wk.d != 0 and disputes.get(wk.d).token == wk.token
          and not(disputes.get(wk.d).resolved))
        disputes.setBy(wk.d, x => x.with("until", 0)) else disputes,
      setWorker(w, idleWorker),
      now' = now, nextToken' = nextToken,
      if (w == 1) all {
        cursor' = cursor + 1, visited' = visited.union(Set(wk.d)),
        failures' = failures + (if (wk.thrown) 1 else 0),
        runSet' = runSet, runs' = runs, reported' = reported,
      } else keepCron,
    }
  }
  // Selection: unresolved and not escalated, in opened order.
  action cronStart = all {
    cursor == 0, runs < 1, workers.get(1).phase == "idle",
    runSet' = DISPUTES.filter(d => not(disputes.get(d).resolved) and not(disputes.get(d).escalated)),
    cursor' = 1, visited' = Set(), failures' = 0, runs' = runs + 1, reported' = reported,
    disputes' = disputes, workers' = workers, now' = now, nextToken' = nextToken,
  }
  action cronSkip = all {
    cursor.in(DISPUTES), not(runSet.contains(cursor)), workers.get(1).phase == "idle",
    cursor' = cursor + 1, runSet' = runSet, visited' = visited, failures' = failures,
    runs' = runs, reported' = reported,
    disputes' = disputes, workers' = workers, now' = now, nextToken' = nextToken,
  }
  action cronReport = all {
    cursor == 3, cursor' = 0, reported' = failures, runSet' = runSet,
    visited' = visited, failures' = failures, runs' = runs,
    disputes' = disputes, workers' = workers, now' = now, nextToken' = nextToken,
  }
  action resolve(d: int): bool = all {
    disputes.get(d).escalated, not(disputes.get(d).resolved),
    disputes' = disputes.setBy(d, x => x.with("resolved", true)
      .with("frozen", (x.draft, x.escalated))),
    workers' = workers, now' = now, nextToken' = nextToken, keepCron,
  }
  action tick = all { now < 3, now' = now + 1,
    disputes' = disputes, workers' = workers, nextToken' = nextToken, keepCron }
  action step = {
    nondet w = WORKERS.oneOf()
    nondet d = DISPUTES.oneOf()
    nondet r = Set("uphold", "deny", "unavailable").oneOf()
    nondet allowed = Set(false, true).oneOf()
    any { claim(w, d), refuse(w, d), read(w), observeCallLease(w), scopeReply(w, allowed), recordCost(w),
      throwBeforeCost(w), afterCost(w, r), escalate(w), error(w), release(w),
      cronStart, cronSkip, cronReport, resolve(d), tick }
  }
  val invariant = all {
    // recordDraft's `draft IS NULL` term: a row's draft is written once.
    DISPUTES.forall(d => disputes.get(d).draftWrites <= 1
      and (disputes.get(d).draft != "none") == (disputes.get(d).draftWrites == 1)),
    // callsAtDraft is a lower bound, not a freeze: a stale already-admitted
    // scope reply can start a provider call after a replacement wrote a draft.
    DISPUTES.forall(d => disputes.get(d).draft != "none"
      implies disputes.get(d).calls >= disputes.get(d).callsAtDraft),
    // At most one representative provider leg is counted per bounded claim.
    DISPUTES.forall(d => disputes.get(d).calls <= disputes.get(d).claims),
    // A resolved row keeps its draft and escalation. External call diagnostics
    // can grow after resolution and are not columns of the immutable row.
    DISPUTES.forall(d => disputes.get(d).resolved implies
      (disputes.get(d).draft, disputes.get(d).escalated)
        == disputes.get(d).frozen),
    DISPUTES.forall(d => disputes.get(d).resolved implies disputes.get(d).escalated),
    // Only one live lease exists per row: two workers never both may write.
    WORKERS.forall(a => WORKERS.forall(b => (a != b and workers.get(a).d != 0
      and workers.get(a).d == workers.get(b).d and mayWrite(workers.get(a)))
      implies not(mayWrite(workers.get(b))))),
    // A cron report covers every selected dispute.
    cursor == 3 implies runSet.subseteq(visited),
    failures <= visited.size(),
  }
  // A crashed worker's retained draft resumes after its lease expires,
  // without another model call.
  run draftResumesWithoutSecondCallTest = init.then(claim(2, 1)).then(read(2))
    .then(call(2)).then(recordCost(2)).then(afterCost(2, "uphold"))
    .then(tick).then(cronStart).then(claim(1, 1)).then(read(1)).then(call(1).fail())
  run draftResumeEscalatesTest = init.then(claim(2, 1)).then(read(2))
    .then(call(2)).then(recordCost(2)).then(afterCost(2, "uphold"))
    .then(tick).then(cronStart).then(claim(1, 1)).then(read(1)).then(escalate(1))
    .expect(disputes.get(1).escalated and disputes.get(1).calls == 1
      and disputes.get(1).draft == "uphold")
  // An expired worker cannot record its draft after a takeover.
  run expiredLeaseCannotDraftTest = init.then(claim(2, 1)).then(read(2))
    .then(call(2)).then(recordCost(2)).then(tick).then(cronStart).then(claim(1, 1))
    .then(afterCost(2, "deny"))
    .expect(disputes.get(1).draft == "none" and workers.get(2).phase == "exit")
  // An escalation without a draft can be reclaimed and drafted later.
  run escalationWithoutDraftResumesTest = init.then(claim(2, 1)).then(read(2))
    .then(call(2)).then(recordCost(2)).then(afterCost(2, "unavailable")).then(release(2))
    .then(claim(2, 1)).then(read(2)).then(call(2)).then(recordCost(2))
    .then(afterCost(2, "deny"))
    .expect(disputes.get(1).draft == "deny" and disputes.get(1).escalated
      and disputes.get(1).calls == 2)
  // One dispute rethrows; the same cron run still escalates the other one.
  run throwDoesNotStopBatchTest = init.then(cronStart).then(claim(1, 1)).then(read(1))
    .then(call(1)).then(throwBeforeCost(1)).then(release(1))
    .then(claim(1, 2)).then(read(1)).then(call(1)).then(recordCost(1))
    .then(afterCost(1, "deny")).then(escalate(1)).then(release(1)).then(cronReport)
    .expect(reported == 1 and disputes.get(2).escalated and not(disputes.get(1).escalated)
      and disputes.get(1).until == 0)
  run resolvedRowIsFinalTest = init.then(claim(2, 1)).then(read(2)).then(error(2))
    .then(resolve(1)).then(release(2)).then(claim(1, 1).fail())
  run admittedScopeReplyCanCallAfterReplacementDraftTest = init.then(claim(2, 1)).then(read(2))
    .then(observeCallLease(2)).then(tick).then(cronStart).then(claim(1, 1)).then(read(1))
    .then(call(1)).then(recordCost(1)).then(afterCost(1, "uphold")).then(scopeReply(2, true))
    .then(recordCost(2)).then(afterCost(2, "deny"))
    .expect(disputes.get(1).draft == "uphold" and disputes.get(1).draftWrites == 1
      and disputes.get(1).calls == 2 and workers.get(2).phase == "exit" and invariant)
  run admittedScopeReplyCanCallAfterModeratorResolutionTest = init.then(claim(2, 1)).then(read(2))
    .then(observeCallLease(2)).then(tick).then(cronStart).then(claim(1, 1)).then(read(1))
    .then(call(1)).then(recordCost(1)).then(afterCost(1, "uphold")).then(escalate(1)).then(resolve(1))
    .then(scopeReply(2, true)).then(recordCost(2)).then(afterCost(2, "deny"))
    .expect(disputes.get(1).resolved and disputes.get(1).draft == "uphold"
      and disputes.get(1).calls == 2 and invariant)
  run refusedScopeEscalatesWithoutInventingVerdictTest = init.then(claim(2, 1)).then(read(2))
    .then(observeCallLease(2)).then(scopeReply(2, false)).then(afterCost(2, "unavailable"))
    .expect(disputes.get(1).escalated and disputes.get(1).calls == 0
      and disputes.get(1).draft == "none" and invariant)
}
