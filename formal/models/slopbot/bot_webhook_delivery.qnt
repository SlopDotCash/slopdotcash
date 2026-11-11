// @source workers/slopbot/index.ts
// @source workers/slopbot/value-requests.ts
// @source workers/slopbot/persistence.ts
// @source migrations/0121_slopbot_delivery_claim.sql
// Authentication and JSON validation precede receipt persistence. A lost queue
// acknowledgment may redeliver; a lease claim serializes sends without treating
// an in-flight delivery as complete, and durable source binding remains immutable.
module bot_webhook_delivery {
  var s: { authenticated: bool, parsed: bool, receipt: bool, claimed: bool, done: bool,
    source: int, valueSource: int, valueRequests: int, queued: int, reopen: bool }
  action init = s' = {authenticated: false, parsed: false, receipt: false, claimed: false, done: false,
    source: 0, valueSource: 0, valueRequests: 0, queued: 0, reopen: false}
  action authenticate = s' = s.with("authenticated", true)
  action parse = all { s.authenticated, s' = s.with("parsed", true) }
  def canReceive(source: int): bool = all { s.parsed, not(s.done), not(s.claimed),
    (not(s.receipt) or s.source == source),
    (s.valueRequests == 0 or s.valueSource == source) }
  action receive(source: int): bool = all { canReceive(source),
    s' = s.with("receipt", true).with("claimed", true).with("source", source) }
  action bindValue = all { s.receipt, s.valueRequests == 0,
    s' = s.with("valueRequests", 1).with("valueSource", s.source) }
  action retainReopen = all { s.receipt, s' = s.with("reopen", true) }
  action enqueue = all { s.receipt, s.claimed, not(s.done), s.queued < 2,
    s' = s.with("queued", s.queued + 1) }
  action complete = all { s.receipt, s.claimed, s.queued > 0,
    s' = s.with("done", true).with("claimed", false) }
  action queueFailure = all { s.receipt, s.claimed, not(s.done),
    s' = s.with("claimed", false) }
  action claimExpiry = all { s.receipt, s.claimed, not(s.done),
    s' = s.with("claimed", false) }
  action step = { nondet source = Set(1, 2).oneOf()
    any { authenticate, parse, receive(source), bindValue, retainReopen,
      enqueue, complete, queueFailure, claimExpiry, s' = s } }
  val invariant = all { s.receipt implies s.authenticated and s.parsed,
    s.valueRequests <= 1, s.done implies s.queued > 0,
    s.valueRequests == 1 implies s.valueSource == s.source,
    s.done implies not(s.claimed), s.claimed implies s.receipt,
    s.reopen implies s.source != 0 }
  run lostAckMayRedeliverTest = init.then(authenticate).then(parse).then(receive(1))
    .then(bindValue).then(retainReopen).then(enqueue).then(queueFailure).then(receive(1))
    .then(enqueue).then(complete).expect(s.queued == 2 and s.valueRequests == 1 and s.valueSource == 1)
  run concurrentReceiveCannotClaimTest = init.then(authenticate).then(parse).then(receive(1))
    .expect(not(canReceive(1)) and s.claimed and s.queued == 0)
  run failedSendCanRecoverTest = init.then(authenticate).then(parse).then(receive(1))
    .then(queueFailure).then(receive(1)).then(enqueue).then(complete)
    .expect(s.done and s.queued == 1)
  run unauthenticatedCannotPersistTest = init.expect(not(s.receipt) and s.queued == 0)
}
