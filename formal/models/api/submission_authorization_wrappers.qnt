// @source backend/security/submissions.ts
// @source backend/security/report-intake.ts
// @source migrations/0059_private_security_submissions.sql
// @evidence backend/security/submissions.test.ts
// @evidence tests/e2e/private-report-send.spec.ts
// Two requests/actors/keys, one project, one optional retained row and two fresh
// candidate IDs. Only legacy create and the existing-row authorize wrappers are
// modeled; durable receipt creation, report storage, workload admission, grants
// and callback crypto remain in their own models. No secret or report bytes.
// Lookup/settle is an outcome projection: each captures the row settle returns.
// Time thresholds and transition CAS/readback live in api_submission_recovery.
// Creation checks readiness/in-flight as observations, then atomically inserts
// its row+event with the current ban guard and unique actor/key constraint.
// Missing changes metadata does not affect create: it uses an ID readback.
// Lost batch replies, missing readback and later flow/decoration failures do
// not delete a committed draft. Concurrent same-key create can return409, while
// a later matching replay returns200. Fresh random IDs are assumed distinct.
// Authorization checks terminal state before the new-forward body gate. Pending
// submitting/uncertain/submitted snapshots may renew consent for reconciliation
// through a human hold or R2 outage. This never relaxes the send gate. A captured
// pending state may change while flow construction waits; new sends still use
// their current state/qualification checks. No continuous revocation guarantee.
// Flow construction/response delivery are predicates, not OAuth or cookie
// proofs. Full syntax, repository readiness and authority are bounded classes.
// The send predicate's failed class is retryable; permanent failure codes are
// distinguished in the receipt/recovery models. Readback visibility is not a
// thrown database error; this wrapper abstracts thrown dependency failures.
// All scenarios are manually authored and unexecuted.
// Verification reductions apply to step only; direct actions and scenarios keep
// exact records. Reviewed reasoning: (1) each branch draws only the choices its
// action reads. (2) Create never reads target, authorize never reads key,
// origin or advisory, and an invalid call responds 400 before any field is
// read, so those use fixed values. (3) Lazy environment: hold, outage, ban and
// progress change only fields that no conjunct reads, and only lookup,
// readiness, insert, readback and qualify read them. Each such environment
// step commutes with every other action, so step performs it as part of the
// next read that observes it: lookup draws a state that progress can reach,
// readiness draws its result, and ban, hold and outage are flags of the read.
// The reachable values of every other field are unchanged. draft, submitting
// and uncertain reach each other, so step stores that cycle as draft.
// (4) A done call is never read by an action and its settled conjuncts stay
// true (rows and events are never removed), so a settled done call is stored
// as one representative; an unsettled one keeps the exact record.
// (5) Qualification, flow, decorate and the response never read the call's
// mode, actor, key, origin, advisory or write-only captured/replayed fields,
// so step stores them with their idle values in those phases.
module submission_authorization_wrappers {
  val requests = Set(1, 2)
  val actors = Set(1, 2)
  val rows = Set(1, 2, 3)
  val states = Set("draft", "failed", "submitting", "uncertain", "submitted", "receipt-verified", "abandoned")
  val pending = Set("submitting", "uncertain", "submitted")
  type Row = { exists: bool, actor: int, key: int, origin: str, advisory: int,
    state: str, stored: bool, qualified: bool, body: bool }
  type Request = { phase: str, mode: str, actor: int, key: int, origin: str,
    advisory: int, target: int, captured: str, status: str, committed: bool,
    replayed: bool, flowBuilt: bool, delivered: bool }
  val absent: Row = { exists: false, actor: 1, key: 1, origin: "slop", advisory: 0,
    state: "draft", stored: false, qualified: true, body: true }
  val idle: Request = { phase: "unused", mode: "create", actor: 1, key: 1, origin: "slop",
    advisory: 0, target: 0, captured: "none", status: "none", committed: false,
    replayed: false, flowBuilt: false, delivered: false }
  var s: { entries: int -> Row, events: Set[int], banned: Set[int], calls: int -> Request }
  action init = s' = { entries: rows.mapBy(_ => absent), events: Set(), banned: Set(), calls: requests.mapBy(_ => idle) }
  def ending(call: Request, status: str): Request = call.with("phase", "response").with("status", status)
  def existing(actor: int, key: int): int = if (s.entries.get(1).exists and s.entries.get(1).actor == actor and s.entries.get(1).key == key) 1
    else if (s.entries.get(2).exists and s.entries.get(2).actor == actor and s.entries.get(2).key == key) 2
    else if (s.entries.get(3).exists and s.entries.get(3).actor == actor and s.entries.get(3).key == key) 3 else 0
  def row(id: int): Row = if (id == 0) absent else s.entries.get(id)
  // Verification only (exact = false): qualification, flow, decorate and the
  // response never read mode, actor, key, origin, advisory or the write-only
  // captured/replayed fields, so step stores those with their idle values.
  def place(id: int, exact: bool, call: Request): int -> Request = s.calls.set(id,
    if (exact or not(Set("qualification", "flow", "response").contains(call.phase))) call
    else idle.with("phase", call.phase).with("target", call.target).with("status", call.status)
      .with("committed", call.committed).with("flowBuilt", call.flowBuilt))
  // Row states that progress can reach. draft, submitting and uncertain reach
  // each other, so step stores that cycle as draft (see header).
  val openCycle = Set("draft", "submitting", "uncertain")
  def reachable(state: str): Set[str] = if (openCycle.contains(state)) openCycle.union(Set("submitted", "receipt-verified"))
    else if (state == "submitted") Set("submitted", "receipt-verified") else Set(state)
  def kept(state: str, exact: bool): str = if (not(exact) and openCycle.contains(state)) "draft" else state
  def observedRow(entry: Row, observed: str): Row = entry.with("state", observed)
    .with("advisory", if (Set("submitted", "receipt-verified").contains(observed)) 1 else entry.advisory)
  def banning(actor: int, now: bool): Set[int] = if (now) s.banned.union(Set(actor)) else s.banned
  action seedAs(state: str, stored: bool, origin: str, exact: bool): bool = all {
    not(s.entries.get(1).exists), requests.forall(id => s.calls.get(id).phase == "unused"),
    states.contains(state), Set("slop", "direct").contains(origin),
    s' = s.with("entries", s.entries.set(1, absent.with("exists", true).with("state", kept(state, exact)).with("stored", stored)
      .with("origin", origin).with("advisory", if (origin == "direct" or Set("submitted", "receipt-verified").contains(state)) 1 else 0)))
      .with("events", Set(1)) }
  action seed(state: str, stored: bool, origin: str): bool = seedAs(state, stored, origin, true)
  action hold(id: int): bool = all { rows.contains(id), row(id).exists,
    s' = s.with("entries", s.entries.set(id, row(id).with("qualified", false))) }
  action outage(id: int): bool = all { rows.contains(id), row(id).exists,
    s' = s.with("entries", s.entries.set(id, row(id).with("body", false))) }
  action ban(actor: int): bool = all { actors.contains(actor), s' = s.with("banned", s.banned.union(Set(actor))) }
  action progress(id: int, state: str): bool = {
    val before = row(id)
    val allowed = (before.state == "draft" and state == "submitting")
      or (before.state == "submitting" and Set("uncertain", "submitted").contains(state))
      or (before.state == "uncertain" and Set("draft", "submitted").contains(state))
      or (before.state == "submitted" and state == "receipt-verified")
    all { rows.contains(id), before.exists, allowed,
      s' = s.with("entries", s.entries.set(id, before.with("state", state)
        .with("advisory", if (Set("submitted", "receipt-verified").contains(state)) 1 else before.advisory))) }
  }
  action begin(id: int, mode: str, actor: int, target: int, key: int, origin: str, valid: bool): bool = all {
    requests.contains(id), s.calls.get(id).phase == "unused", Set("create", "authorize").contains(mode),
    actors.contains(actor), rows.contains(target), requests.contains(key), Set("slop", "direct").contains(origin),
    s' = s.with("calls", s.calls.set(id, idle.with("mode", mode).with("actor", actor).with("target", target)
      .with("key", key).with("origin", origin).with("advisory", if (origin == "direct") 1 else 0)
      .with("phase", if (valid) "lookup" else "response").with("status", if (valid) "none" else "400"))) }
  // Step passes what the environment changed just before this read (see
  // header): the observed row state and whether the actor was banned now.
  action lookupAs(id: int, observed: str, banNow: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val found = if (call.mode == "create") existing(call.actor, call.key) else call.target
    val entry = if (found == 0) row(found) else observedRow(row(found), observed)
    val banned = banning(call.actor, banNow and call.mode == "create")
    val mismatch = entry.origin != call.origin or entry.advisory != call.advisory
    val closed = Set("receipt-verified", "abandoned").contains(entry.state)
    all { call.phase == "lookup", if (exact) observed == row(found).state and not(banNow)
        else if (not(row(found).exists)) observed == row(found).state
        else reachable(row(found).state).contains(observed),
      s' = s.with("banned", banned)
        .with("entries", if (found == 0 or exact) s.entries else s.entries.set(found, entry.with("state", kept(observed, exact))))
        .with("calls", place(id, exact,
      if (call.mode == "create" and banned.contains(call.actor)) ending(call, "403")
      else if (call.mode == "authorize" and (not(entry.exists) or entry.actor != call.actor)) ending(call, "404")
      else if (call.mode == "create" and entry.exists and mismatch) ending(call, "409-key")
      else if (entry.exists and closed) ending(call, "409-closed")
      else if (call.mode == "create" and not(entry.exists)) call.with("phase", "readiness").with("target", id + 1)
      else call.with("target", found).with("captured", entry.state).with("replayed", call.mode == "create")
        .with("phase", if (call.mode == "create" or pending.contains(entry.state)) "flow" else "qualification"))) }
  }  action lookup(id: int): bool = {
    val call = s.calls.get(id)
    lookupAs(id, row(if (call.mode == "create") existing(call.actor, call.key) else call.target).state, false, true)
  }
  // Step passes the observed in-flight result. Seeing none moves the actor's
  // submitted rows to receipt-verified, the only non-pending state they reach.
  action readinessAs(id: int, ready: bool, seen: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val own = rows.filter(n => row(n).exists and row(n).actor == call.actor)
    val inFlight = own.exists(n => pending.contains(row(n).state))
    val possible = own.exists(n => reachable(row(n).state).exists(state => pending.contains(state)))
    all { call.phase == "readiness", if (exact) seen == inFlight else if (ready) seen implies possible else not(seen),
      s' = s.with("entries", if (exact or seen or not(ready)) s.entries else rows.mapBy(n =>
          if (own.contains(n) and row(n).state == "submitted") observedRow(row(n), "receipt-verified") else s.entries.get(n)))
        .with("calls", place(id, exact,
      if (not(ready)) ending(call, "409-unavailable") else if (seen) ending(call, "409-in-flight") else call.with("phase", "insert"))) }
  }  action readiness(id: int, ready: bool): bool = readinessAs(id, ready,
    rows.exists(n => row(n).exists and row(n).actor == s.calls.get(id).actor and pending.contains(row(n).state)), true)
  action insertAs(id: int, banNow: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val conflict = existing(call.actor, call.key) != 0
    val banned = banning(call.actor, banNow)
    val allowed = not(conflict) and not(banned.contains(call.actor))
    val entry = absent.with("exists", true).with("actor", call.actor).with("key", call.key)
      .with("origin", call.origin).with("advisory", call.advisory)
    all { call.phase == "insert", exact implies not(banNow),
      s' = s.with("banned", banned).with("entries", if (allowed) s.entries.set(call.target, entry) else s.entries)
      .with("events", if (allowed) s.events.union(Set(call.target)) else s.events)
      .with("calls", place(id, exact, if (conflict) ending(call, "409-key")
        else call.with("phase", "insert-reply").with("committed", allowed))) }
  }
  action insert(id: int): bool = insertAs(id, false, true)
  action insertReplyAs(id: int, delivered: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "insert-reply", s' = s.with("calls", place(id, exact,
      if (delivered) call.with("phase", "readback") else ending(call, "error"))) }
  }
  action insertReply(id: int, delivered: bool): bool = insertReplyAs(id, delivered, true)
  action readbackAs(id: int, visible: bool, banNow: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val failed = not(row(call.target).exists) or not(visible)
    val banned = banning(call.actor, banNow)
    all { call.phase == "readback", banNow implies failed and not(exact),
      s' = s.with("banned", banned).with("calls", place(id, exact,
      if (failed) ending(call, if (banned.contains(call.actor)) "403" else "409-changed")
      else call.with("phase", "flow").with("captured", row(call.target).state))) }
  }
  action readback(id: int, visible: bool): bool = readbackAs(id, visible, false, true)
  // Step passes a hold or outage that happened just before this read.
  action qualifyAs(id: int, held: bool, interrupted: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val before = row(call.target)
    val entry = before.with("qualified", before.qualified and not(held)).with("body", before.body and not(interrupted))
    all { call.phase == "qualification", (held or interrupted) implies before.stored and not(exact),
      s' = s.with("entries", if (held or interrupted) s.entries.set(call.target, entry) else s.entries)
        .with("calls", place(id, exact,
      if (entry.stored and not(entry.qualified)) ending(call, "409-screening")
      else if (entry.stored and not(entry.body)) ending(call, "503-body") else call.with("phase", "flow"))) }
  }  action qualify(id: int): bool = qualifyAs(id, false, false, true)
  action flow(id: int, success: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "flow", s' = s.with("calls", s.calls.set(id,
      if (success) call.with("phase", "decorate").with("flowBuilt", true) else ending(call, "401"))) }
  }
  action decorate(id: int, success: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "decorate", s' = s.with("calls", s.calls.set(id,
      ending(call, if (not(success)) "error" else if (call.committed) "201" else "200"))) }
  }
  // A done call is never read by an action. Rows and events are never removed,
  // so each settled conjunct stays true once the call is done. Step (exact =
  // false) stores a settled done call as one representative.
  def settled(call: Request): bool = all {
    Set("200", "201").contains(call.status) implies call.flowBuilt and row(call.target).exists,
    call.committed implies row(call.target).exists and s.events.contains(call.target) }
  action respondAs(id: int, delivered: bool, exact: bool): bool = {
    val call = s.calls.get(id)
    val result = call.with("phase", "done").with("delivered", delivered)
    all { call.phase == "response", s' = s.with("calls", s.calls.set(id,
      if (exact or not(settled(result))) result else idle.with("phase", "done"))) }
  }
  action respond(id: int, delivered: bool): bool = respondAs(id, delivered, true)
  def newSendAllowed(id: int): bool = row(id).exists and Set("draft", "failed").contains(row(id).state)
    and row(id).advisory == 0 and not(s.banned.contains(row(id).actor)) and (not(row(id).stored) or (row(id).qualified and row(id).body))
  // Verification relation; the header states each reduction.
  action step = any {
    { nondet state = states.oneOf() nondet yes = Set(false, true).oneOf() nondet origin = Set("slop", "direct").oneOf()
      seedAs(state, yes, origin, false) },
    { nondet id = requests.oneOf() nondet actor = actors.oneOf() nondet key = requests.oneOf()
      nondet origin = Set("slop", "direct").oneOf() begin(id, "create", actor, 1, key, origin, true) },
    { nondet id = requests.oneOf() nondet actor = actors.oneOf() nondet target = rows.oneOf()
      begin(id, "authorize", actor, target, 1, "slop", true) },
    { nondet id = requests.oneOf() begin(id, "create", 1, 1, 1, "slop", false) },
    { nondet id = requests.oneOf() nondet observed = states.oneOf() nondet banNow = Set(false, true).oneOf()
      lookupAs(id, observed, banNow, false) },
    { nondet id = requests.oneOf() nondet ready = Set(false, true).oneOf() nondet seen = Set(false, true).oneOf()
      readinessAs(id, ready, seen, false) },
    { nondet id = requests.oneOf() nondet banNow = Set(false, true).oneOf() insertAs(id, banNow, false) },
    { nondet id = requests.oneOf() nondet held = Set(false, true).oneOf() nondet interrupted = Set(false, true).oneOf()
      qualifyAs(id, held, interrupted, false) },
    { nondet id = requests.oneOf() nondet yes = Set(false, true).oneOf() nondet banNow = Set(false, true).oneOf()
      readbackAs(id, yes, banNow, false) },
    { nondet id = requests.oneOf() nondet yes = Set(false, true).oneOf() any { insertReplyAs(id, yes, false),
      flow(id, yes), decorate(id, yes), respondAs(id, yes, false) } },
    s' = s }

  val invariant = all { rows.forall(n => row(n).exists == s.events.contains(n)),
    rows.forall(a => rows.forall(b => a == b or not(row(a).exists and row(b).exists and row(a).actor == row(b).actor and row(a).key == row(b).key))),
    requests.forall(id => settled(s.calls.get(id))) }
  action auth = begin(1, "authorize", 1, 1, 1, "slop", true).then(lookup(1))
  action finish(id: int): bool = flow(id, true).then(decorate(id, true)).then(respond(id, true))
  action newRequest(id: int): bool = begin(id, "create", 1, 1, 1, "slop", true).then(lookup(id)).then(readiness(id, true))
  run freshCreateCommitsRowAndEventTest = init.then(newRequest(1)).then(insert(1)).then(insertReply(1, true)).then(readback(1, true)).then(finish(1))
    .expect(s.calls.get(1).status == "201" and s.events == Set(2) and invariant)
  run matchingKeyReplayStartsNewAuthorizationTest = init.then(seed("draft", false, "slop"))
    .then(begin(1, "create", 1, 1, 1, "slop", true)).then(lookup(1)).then(finish(1))
    .expect(s.calls.get(1).status == "200" and s.calls.get(1).replayed and invariant)
  run concurrentSameKeyCreateRetainsOneRowTest = init.then(newRequest(1)).then(newRequest(2)).then(insert(1)).then(insert(2))
    .expect(s.events == Set(2) and s.calls.get(2).status == "409-key" and invariant)
  run banAtInsertCreatesNeitherRowNorEventTest = init.then(newRequest(1)).then(ban(1)).then(insert(1)).then(insertReply(1, true)).then(readback(1, true))
    .expect(s.events == Set() and s.calls.get(1).status == "403" and invariant)
  run lostInsertReplyRetainsRecoverableDraftTest = init.then(newRequest(1)).then(insert(1)).then(insertReply(1, false))
    .expect(row(2).exists and s.calls.get(1).status == "error" and invariant)
  run flowFailureDoesNotUndoCreatedDraftTest = init.then(newRequest(1)).then(insert(1)).then(insertReply(1, true)).then(readback(1, true)).then(flow(1, false))
    .expect(row(2).exists and s.calls.get(1).status == "401" and invariant)
  run decorationFailureDoesNotUndoCreatedDraftTest = init.then(newRequest(1)).then(insert(1)).then(insertReply(1, true)).then(readback(1, true))
    .then(flow(1, true)).then(decorate(1, false)).expect(row(2).exists and s.calls.get(1).status == "error" and invariant)
  run observedPendingSubmissionRefusesNewCreateTest = init.then(seed("uncertain", false, "slop"))
    .then(begin(1, "create", 1, 1, 2, "slop", true)).then(lookup(1)).then(readiness(1, true))
    .expect(s.calls.get(1).status == "409-in-flight" and invariant)
  run submittingRenewalBypassesNewForwardBodyGateTest = init.then(seed("submitting", true, "slop")).then(hold(1)).then(outage(1)).then(auth).then(finish(1))
    .expect(s.calls.get(1).status == "200" and not(newSendAllowed(1)) and invariant)
  run uncertainRenewalBypassesNewForwardBodyGateTest = init.then(seed("uncertain", true, "slop")).then(hold(1)).then(outage(1)).then(auth).then(finish(1))
    .expect(s.calls.get(1).status == "200" and not(newSendAllowed(1)) and invariant)
  run submittedRenewalBypassesNewForwardBodyGateTest = init.then(seed("submitted", true, "slop")).then(hold(1)).then(outage(1)).then(auth).then(finish(1))
    .expect(s.calls.get(1).status == "200" and not(newSendAllowed(1)) and invariant)
  run heldDraftCannotAuthorizeNewForwardTest = init.then(seed("draft", true, "slop")).then(hold(1)).then(auth).then(qualify(1))
    .expect(s.calls.get(1).status == "409-screening" and invariant)
  run heldFailedDraftCannotAuthorizeNewForwardTest = init.then(seed("failed", true, "slop")).then(hold(1)).then(auth).then(qualify(1))
    .expect(s.calls.get(1).status == "409-screening" and invariant)
  run unreadableDraftCannotAuthorizeNewForwardTest = init.then(seed("draft", true, "slop")).then(outage(1)).then(auth).then(qualify(1))
    .expect(s.calls.get(1).status == "503-body" and invariant)
  run closedReceiptRefusesBeforeBodyReadTest = init.then(seed("receipt-verified", true, "slop")).then(outage(1)).then(auth)
    .expect(s.calls.get(1).status == "409-closed" and not(s.calls.get(1).flowBuilt) and invariant)
  run abandonedSubmissionCannotAuthorizeTest = init.then(seed("abandoned", false, "slop")).then(auth)
    .expect(s.calls.get(1).status == "409-closed" and invariant)
  run foreignActorCannotAuthorizeRetainedRowTest = init.then(seed("uncertain", true, "slop"))
    .then(begin(1, "authorize", 2, 1, 1, "slop", true)).then(lookup(1)).expect(s.calls.get(1).status == "404" and invariant)
  run capturedPendingRenewalDoesNotAuthorizeLaterHeldDraftTest = init.then(seed("uncertain", true, "slop")).then(auth)
    .then(progress(1, "draft")).then(hold(1)).then(finish(1)).expect(s.calls.get(1).status == "200" and not(newSendAllowed(1)) and invariant)
  run adoptedSlopAdvisoryConflictsWithOriginalCreateShapeTest = init.then(seed("submitted", true, "slop"))
    .then(begin(1, "create", 1, 1, 1, "slop", true)).then(lookup(1)).expect(s.calls.get(1).status == "409-key" and invariant)
  run authorizationResponseCanBeLostWithoutDeletingRowTest = init.then(seed("uncertain", true, "slop")).then(auth)
    .then(flow(1, true)).then(decorate(1, true)).then(respond(1, false)).expect(row(1).exists and not(s.calls.get(1).delivered) and invariant)
}
