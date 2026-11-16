// @source workers/slopbot/index.ts
// @source workers/slopbot/value-requests.ts
// @source workers/slopbot/persistence.ts
// Authentication and JSON validation precede receipt persistence. A lost queue
// acknowledgment may redeliver; durable source binding remains immutable.
module bot_webhook_delivery {
  var s: { authenticated: bool, parsed: bool, receipt: bool, done: bool,
    source: int, valueSource: int, valueRequests: int, queued: int, reopen: bool }
  action init = s' = {authenticated: false, parsed: false, receipt: false, done: false,
    source: 0, valueSource: 0, valueRequests: 0, queued: 0, reopen: false}
  action authenticate = s' = s.with("authenticated", true)
  action parse = all { s.authenticated, s' = s.with("parsed", true) }
  action receive(source: int): bool = all { s.parsed, not(s.done),
    (not(s.receipt) or s.source == source),
    (s.valueRequests == 0 or s.valueSource == source),
    s' = s.with("receipt", true).with("source", source) }
  action bindValue = all { s.receipt, s.valueRequests == 0,
    s' = s.with("valueRequests", 1).with("valueSource", s.source) }
  action retainReopen = all { s.receipt, s' = s.with("reopen", true) }
  action enqueue = all { s.receipt, not(s.done), s.queued < 2,
    s' = s.with("queued", s.queued + 1) }
  action complete = all { s.receipt, s.queued > 0, s' = s.with("done", true) }
  action queueFailure = all { s.receipt, not(s.done),
    s' = s.with("receipt", s.reopen) }
  action step = { nondet source = Set(1, 2).oneOf()
    any { authenticate, parse, receive(source), bindValue, retainReopen,
      enqueue, complete, queueFailure, s' = s } }
  val invariant = all { s.receipt implies s.authenticated and s.parsed,
    s.valueRequests <= 1, s.done implies s.queued > 0,
    s.valueRequests == 1 implies s.valueSource == s.source,
    s.reopen implies s.source != 0 }
  run lostAckMayRedeliverTest = init.then(authenticate).then(parse).then(receive(1))
    .then(bindValue).then(retainReopen).then(enqueue).then(queueFailure).then(receive(1))
    .then(enqueue).then(complete).expect(s.queued == 2 and s.valueRequests == 1 and s.valueSource == 1)
  run unauthenticatedCannotPersistTest = init.expect(not(s.receipt) and s.queued == 0)
}
