// @source workers/slopbot/index.ts
// @source workers/slopbot/value-requests.ts
// @source workers/slopbot/persistence.ts
// @source migrations/0121_slopbot_delivery_claim.sql
// Authentication and JSON validation precede receipt persistence. A lost queue
// acknowledgment may redeliver; a lease claim serializes sends without treating
// an in-flight delivery as complete, and durable source binding remains immutable.
module bot_webhook_delivery {
  var s: { authenticated: bool, parsed: bool, receipt: bool, claimed: bool, claimToken: int,
    nextToken: int, done: bool, source: int, valueSource: int, valueRequests: int,
    queued: int, reopen: bool }
  action init = s' = {authenticated: false, parsed: false, receipt: false, claimed: false,
    claimToken: 0, nextToken: 1, done: false, source: 0, valueSource: 0,
    valueRequests: 0, queued: 0, reopen: false}
  action authenticate = s' = s.with("authenticated", true)
  action parse = all { s.authenticated, s' = s.with("parsed", true) }
  def canReceive(source: int): bool = all { s.parsed, not(s.done), not(s.claimed),
    (not(s.receipt) or s.source == source),
    (s.valueRequests == 0 or s.valueSource == source) }
  action receive(source: int): bool = all { canReceive(source),
    s' = s.with("receipt", true).with("claimed", true).with("claimToken", s.nextToken)
      .with("nextToken", s.nextToken + 1).with("source", source) }
  action bindValue = all { s.receipt, s.valueRequests == 0,
    s' = s.with("valueRequests", 1).with("valueSource", s.source) }
  action retainReopen = all { s.receipt, s' = s.with("reopen", true) }
  action enqueue(token: int): bool = all { s.receipt, not(s.done), token > 0, s.queued < 2,
    s' = s.with("queued", s.queued + 1) }
  action complete(token: int): bool = all { s.receipt, s.claimed, s.claimToken == token,
    s.queued > 0, s' = s.with("done", true).with("claimed", false).with("claimToken", 0) }
  action queueFailure(token: int): bool = all { s.receipt, s.claimed, s.claimToken == token,
    not(s.done), s' = s.with("claimed", false).with("claimToken", 0) }
  action claimExpiry = all { s.receipt, s.claimed, not(s.done),
    s' = s.with("claimed", false).with("claimToken", 0) }
  action step = { nondet source = Set(1, 2).oneOf()
    nondet token = Set(1, 2, 3).oneOf()
    any { authenticate, parse, receive(source), bindValue, retainReopen,
      enqueue(token), complete(token), queueFailure(token), claimExpiry, s' = s } }
  val invariant = all { s.receipt implies s.authenticated and s.parsed,
    s.valueRequests <= 1, s.done implies s.queued > 0,
    s.valueRequests == 1 implies s.valueSource == s.source,
    s.done implies not(s.claimed), s.claimed implies s.receipt,
    s.claimed == (s.claimToken > 0), s.nextToken > s.claimToken,
    s.reopen implies s.source != 0 }
  run lostAckMayRedeliverTest = init.then(authenticate).then(parse).then(receive(1))
    .then(bindValue).then(retainReopen).then(enqueue(1)).then(queueFailure(1)).then(receive(1))
    .then(enqueue(2)).then(complete(2))
    .expect(s.queued == 2 and s.valueRequests == 1 and s.valueSource == 1)
  run concurrentReceiveCannotClaimTest = init.then(authenticate).then(parse).then(receive(1))
    .expect(not(canReceive(1)) and s.claimed and s.claimToken == 1 and s.queued == 0)
  run failedSendCanRecoverTest = init.then(authenticate).then(parse).then(receive(1))
    .then(queueFailure(1)).then(receive(1)).then(enqueue(2)).then(complete(2))
    .expect(s.done and s.queued == 1)
  run expiredClaimCanBeReclaimedTest = init.then(authenticate).then(parse).then(receive(1))
    .then(claimExpiry).then(receive(1))
    .expect(s.claimed and s.claimToken == 2 and s.nextToken == 3)
  run staleClaimCannotCompleteReplacementTest = init.then(authenticate).then(parse).then(receive(1))
    .then(claimExpiry).then(receive(1)).then(enqueue(2)).then(complete(1).fail())
  run replacementClaimCanCompleteTest = init.then(authenticate).then(parse).then(receive(1))
    .then(claimExpiry).then(receive(1)).then(enqueue(2)).then(complete(2)).expect(s.done)
  run staleClaimCannotReleaseReplacementTest = init.then(authenticate).then(parse).then(receive(1))
    .then(claimExpiry).then(receive(1)).then(queueFailure(1).fail())
  run replacementClaimCanReleaseTest = init.then(authenticate).then(parse).then(receive(1))
    .then(claimExpiry).then(receive(1)).then(queueFailure(2))
    .expect(not(s.claimed) and not(s.done))
  run completedDeliveryCannotBeReclaimedTest = init.then(authenticate).then(parse)
    .then(receive(1)).then(enqueue(1)).then(complete(1)).then(receive(1).fail())
  run completedDeliveryCannotBeReleasedTest = init.then(authenticate).then(parse)
    .then(receive(1)).then(enqueue(1)).then(complete(1)).then(queueFailure(1).fail())
  run unauthenticatedCannotPersistTest = init.expect(not(s.receipt) and s.queued == 0)
}
