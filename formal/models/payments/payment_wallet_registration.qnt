// @source backend/payments/wallet-registration.ts
// @source backend/payments/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @evidence backend/payments/wallet-replacement.test.ts
// @evidence scripts/wallet-legacy-claim-confirm.test.ts
// @evidence backend/notifications/notifications.test.ts
// Two prevalidated, authenticated actors; two chains (Solana and one EVM
// representative), two addresses and three login spellings. Each of two
// concurrent request slots may retry once on the same actor/chain. At most one
// initial row, one authorized external historical Solana append and four
// candidate IDs bound retained history to six rows. No payment effect exists.
// The request's now string is captured before session/body/adapter awaits and
// passed unchanged into both canonical digest and stored timestamps. Clock
// 0..2 records order only. Session and expected-actor gates are preconditions;
// no continuously current global account authority is assumed here.
// Login classes 1/2 may be case variants and 3 a renamed login. Snapshot no-op
// intentionally ignores all login differences, unlike the trace claim route.
// Historical same-address rows must still receive a registry successor.
// Shared helper atomicity, audit/notice publication and constraints are in
// wallet_claim_publication. helper performs their bounded outcome summary:
// same-digest existing, successful append, or predecessor conflict. A helper
// error may precede a commit or follow its committed effect/readback failure.
// Digest equality assumes exact canonical bytes and collision resistance:
// source digest excludes login/time; record digest includes both. Solana omits
// the chain field for compatibility; EVM bytes include their explicit chain.
// Retained helper results and tip snapshots need not remain the latest head.
// Only helper conflict triggers a new tip read; it is also a snapshot.
// The fixed winner test requires a registry source and matching address. An
// authorized historical writer is abstracted without adding signer authority.
// legacyWinnerRead is an explicit negative control outside step; its trace
// shows the former same-address-only success violating that registry rule.
// Fresh IDs, immutable rows and healthy nonmissing tip reads are assumptions.
// Null-tip/error paths do not fabricate a successful registration. Validation,
// cryptography, shared-helper internals, wallet authorization and transfers are
// excluded. Existing tests cover rename/legacy/notification paths, not every
// interleaving below; all definitions are authored and manually reviewed only.
module payment_wallet_registration {
  val actors = Set(1, 2)
  val chains = Set(1, 2)
  val slots = Set(1, 2)
  val ids = 1.to(6)
  val partitions = 1.to(4)
  type Claim = { exists: bool, id: int, actor: int, chain: int, address: int,
    login: int, source: str, stamp: int, predecessor: int }
  type Request = { phase: str, attempt: int, actor: int, chain: int, address: int,
    login: int, stamp: int, predecessor: int, candidate: int, helperKind: str,
    helperReturned: int, winnerObserved: int, returned: int, desired: str, response: str }
  val absent: Claim = { exists: false, id: 0, actor: 1, chain: 1, address: 0,
    login: 0, source: "none", stamp: -1, predecessor: 0 }
  val idle: Request = { phase: "unused", attempt: 0, actor: 1, chain: 1, address: 1,
    login: 1, stamp: -1, predecessor: 0, candidate: 0, helperKind: "none",
    helperReturned: 0, winnerObserved: 0, returned: 0, desired: "none", response: "none" }
  var s: { configured: bool, now: int, historicalUsed: bool, rows: int -> Claim,
    heads: int -> int, requests: int -> Request }
  action init = s' = { configured: false, now: 0, historicalUsed: false,
    rows: ids.mapBy(_ => absent), heads: partitions.mapBy(_ => 0), requests: slots.mapBy(_ => idle) }
  def partition(actor: int, chain: int): int = (actor - 1) * 2 + chain
  def row(id: int): Claim = if (id == 0) absent else s.rows.get(id)
  def ending(request: Request, desired: str, returned: int): Request = request.with("phase", "response")
    .with("desired", desired).with("returned", returned)
  def candidateClaim(request: Request): Claim = { exists: true, id: request.candidate,
    actor: request.actor, chain: request.chain, address: request.address, login: request.login,
    source: "registry", stamp: request.stamp, predecessor: request.predecessor }
  def sameDigest(a: Claim, b: Claim): bool = a.actor == b.actor and a.chain == b.chain
    and a.address == b.address and a.login == b.login and a.source == b.source
    and a.stamp == b.stamp and a.predecessor == b.predecessor
  def matches(id: int, claim: Claim): bool = row(id).exists and sameDigest(row(id), claim)
  def digestRow(claim: Claim): int = if (matches(1, claim)) 1 else if (matches(2, claim)) 2
    else if (matches(3, claim)) 3 else if (matches(4, claim)) 4 else if (matches(5, claim)) 5
    else if (matches(6, claim)) 6 else 0
  action configure(source: str): bool = all { not(s.configured), Set("none", "registry", "historical").contains(source),
    s' = s.with("configured", true)
      .with("rows", if (source == "none") s.rows else s.rows.set(2,
        { exists: true, id: 2, actor: 1, chain: 1, address: 1, login: 1, source: source, stamp: 0, predecessor: 0 }))
      .with("heads", if (source == "none") s.heads else s.heads.set(1, 2)) }
  action tick = all { s.configured, s.now < 2, s' = s.with("now", s.now + 1) }
  action begin(slot: int, actor: int, chain: int, address: int, login: int): bool = {
    val previous = s.requests.get(slot)
    all { s.configured, slots.contains(slot), actors.contains(actor), chains.contains(chain),
      Set(1, 2).contains(address), Set(1, 2, 3).contains(login),
      Set("unused", "done").contains(previous.phase), previous.attempt < 2,
      previous.attempt > 0 implies actor == previous.actor and chain == previous.chain,
      s' = s.with("requests", s.requests.set(slot, idle.with("phase", "tip").with("attempt", previous.attempt + 1)
        .with("actor", actor).with("chain", chain).with("address", address).with("login", login).with("stamp", s.now))) }
  }
  action readTip(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    val currentId = s.heads.get(partition(request.actor, request.chain))
    val current = row(currentId)
    val noop = current.exists and current.source == "registry" and current.address == request.address
    all { request.phase == "tip", s' = s.with("requests", s.requests.set(slot,
      if (not(ok)) ending(request, "error", 0) else if (noop) ending(request, "200", currentId)
      else request.with("phase", "prepare").with("predecessor", currentId))) }
  }
  action prepare(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "prepare", s' = s.with("requests", s.requests.set(slot,
      if (ok) request.with("phase", "helper").with("candidate", 2 + (slot - 1) * 2 + request.attempt)
      else ending(request, "error", 0))) }
  }
  action helper(slot: int): bool = {
    val request = s.requests.get(slot)
    val claim = candidateClaim(request)
    val existing = digestRow(claim)
    val current = s.heads.get(partition(request.actor, request.chain))
    val created = existing == 0 and current == request.predecessor
    val kind = if (existing != 0) "existing" else if (created) "created" else "conflict"
    all { request.phase == "helper",
      s' = s.with("rows", if (created) s.rows.set(claim.id, claim) else s.rows)
        .with("heads", if (created) s.heads.set(partition(claim.actor, claim.chain), claim.id) else s.heads)
        .with("requests", s.requests.set(slot, request.with("phase", "helper-reply").with("helperKind", kind)
          .with("helperReturned", if (existing != 0) existing else if (created) claim.id else 0))) }
  }
  action helperFailure(slot: int): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "helper", s' = s.with("requests", s.requests.set(slot, ending(request, "error", 0))) }
  }
  action helperReply(slot: int, received: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "helper-reply", s' = s.with("requests", s.requests.set(slot,
      if (not(received)) ending(request, "error", 0)
      else if (request.helperKind == "conflict") request.with("phase", "winner")
      else ending(request, "200", request.helperReturned))) }
  }
  def winnerResult(request: Request, ok: bool, registryRequired: bool): Request = {
    val winnerId = s.heads.get(partition(request.actor, request.chain))
    val winner = row(winnerId)
    val accepted = winner.exists and winner.address == request.address
      and (not(registryRequired) or winner.source == "registry")
    (if (not(ok) or not(winner.exists)) ending(request, "error", 0)
      else if (accepted) ending(request, "200", winnerId) else ending(request, "409", 0))
      .with("winnerObserved", winnerId)
  }
  action readWinner(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "winner", s' = s.with("requests", s.requests.set(slot, winnerResult(request, ok, true))) }
  }
  // Former production condition, excluded from step.
  action legacyWinnerRead(slot: int): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "winner", s' = s.with("requests", s.requests.set(slot, winnerResult(request, true, false))) }
  }
  action historicalAppend(actor: int, address: int): bool = {
    val predecessor = s.heads.get(partition(actor, 1))
    val claim: Claim = { exists: true, id: 1, actor: actor, chain: 1, address: address,
      login: 1, source: "historical", stamp: s.now, predecessor: predecessor }
    all { s.configured, actors.contains(actor), Set(1, 2).contains(address), not(s.historicalUsed),
      s' = s.with("historicalUsed", true).with("rows", s.rows.set(1, claim))
        .with("heads", s.heads.set(partition(actor, 1), 1)) }
  }
  action respond(slot: int, delivered: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(slot,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  action step = {
    nondet slot = slots.oneOf()
    nondet actor = actors.oneOf()
    nondet chain = chains.oneOf()
    nondet address = Set(1, 2).oneOf()
    nondet login = Set(1, 2, 3).oneOf()
    nondet source = Set("none", "registry", "historical").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { configure(source), tick, begin(slot, actor, chain, address, login), readTip(slot, yes), prepare(slot, yes),
      helper(slot), helperFailure(slot), helperReply(slot, yes), readWinner(slot, yes), historicalAppend(actor, address),
      respond(slot, yes), s' = s }
  }
  val successIsRegistry = slots.forall(slot => {
    val request = s.requests.get(slot)
    request.desired != "200" or (row(request.returned).exists and row(request.returned).source == "registry"
      and row(request.returned).address == request.address and row(request.returned).actor == request.actor
      and row(request.returned).chain == request.chain)
  })
  val invariant = all {
    successIsRegistry, s.now >= 0, s.now <= 2,
    ids.forall(id => {
      val claim = row(id)
      not(claim.exists) or (claim.id == id and actors.contains(claim.actor) and chains.contains(claim.chain)
        and (claim.predecessor == 0 or (row(claim.predecessor).exists
          and row(claim.predecessor).actor == claim.actor and row(claim.predecessor).chain == claim.chain)))
    }),
    partitions.forall(key => {
      val readHead = s.heads.get(key)
      readHead == 0 or (row(readHead).exists and partition(row(readHead).actor, row(readHead).chain) == key
        and ids.forall(id => not(row(id).exists) or row(id).predecessor != readHead))
    }),
    slots.forall(slot => s.requests.get(slot).attempt >= 0 and s.requests.get(slot).attempt <= 2)
  }
  action preparing(slot: int, actor: int, chain: int, address: int, login: int): bool =
    begin(slot, actor, chain, address, login).then(readTip(slot, true)).then(prepare(slot, true))
  action registered(slot: int, actor: int, chain: int, address: int): bool = preparing(slot, actor, chain, address, 1)
    .then(helper(slot)).then(helperReply(slot, true)).then(respond(slot, true))
  action historicalConflict = preparing(1, 1, 1, 2, 1).then(historicalAppend(1, 2))
    .then(helper(1)).then(helperReply(1, true))

  run newRegistryClaimReturns200Test = init.then(configure("none")).then(registered(1, 1, 1, 1))
    .expect(s.requests.get(1).response == "200" and s.heads.get(1) == 3 and invariant)
  run sameAddressIgnoresRenamedLoginTest = init.then(configure("registry")).then(begin(1, 1, 1, 1, 3))
    .then(readTip(1, true)).then(respond(1, true)).expect(s.requests.get(1).returned == 2 and row(2).login == 1 and invariant)
  run historicalSameAddressGetsRegistrySuccessorTest = init.then(configure("historical")).then(registered(1, 1, 1, 1))
    .expect(row(3).predecessor == 2 and row(2).source == "historical" and invariant)
  run differentActorsRemainSeparateTest = init.then(configure("none")).then(registered(1, 1, 1, 1)).then(registered(2, 2, 1, 2))
    .expect(s.heads.get(1) == 3 and s.heads.get(3) == 5 and invariant)
  run differentChainsRemainSeparateTest = init.then(configure("none")).then(registered(1, 1, 1, 1)).then(registered(2, 1, 2, 2))
    .expect(s.heads.get(1) == 3 and s.heads.get(2) == 5 and invariant)
  run requestTimestampSurvivesTipAndHashDelayTest = init.then(configure("none")).then(begin(1, 1, 1, 1, 1)).then(tick)
    .then(readTip(1, true)).then(prepare(1, true)).then(tick).then(helper(1)).then(helperReply(1, true)).then(respond(1, true))
    .expect(row(3).stamp == 0 and s.now == 2 and invariant)
  run failedInitialTipReadCreatesNothingTest = init.then(configure("none")).then(begin(1, 1, 1, 1, 1))
    .then(readTip(1, false)).then(respond(1, true)).expect(s.requests.get(1).response == "error" and s.heads.get(1) == 0 and invariant)
  run failedHashCreatesNothingTest = init.then(configure("none")).then(begin(1, 1, 1, 1, 1))
    .then(readTip(1, true)).then(prepare(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "error" and s.heads.get(1) == 0 and invariant)
  run helperFailureBeforeCommitCanRetryTest = init.then(configure("none")).then(preparing(1, 1, 1, 1, 1))
    .then(helperFailure(1)).then(respond(1, true)).then(registered(1, 1, 1, 1))
    .expect(s.requests.get(1).returned == 4 and invariant)
  run helperFailureAfterCommitRetainsClaimTest = init.then(configure("none")).then(preparing(1, 1, 1, 1, 1))
    .then(helper(1)).then(helperReply(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "error" and s.heads.get(1) == 3 and invariant)
  run retryAfterCommittedHelperFailureUsesNoopTest = init.then(configure("none")).then(preparing(1, 1, 1, 1, 1))
    .then(helper(1)).then(helperReply(1, false)).then(respond(1, true))
    .then(begin(1, 1, 1, 1, 3)).then(readTip(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 3 and not(row(4).exists) and invariant)
  run identicalConcurrentDigestReturnsExistingTest = init.then(configure("none"))
    .then(preparing(1, 1, 1, 1, 1)).then(preparing(2, 1, 1, 1, 1)).then(helper(1)).then(helperReply(1, true))
    .then(helper(2)).then(helperReply(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).helperKind == "existing" and s.requests.get(2).returned == 3 and invariant)
  run differentTimestampsRecoverSameAddressWinnerTest = init.then(configure("none"))
    .then(preparing(1, 1, 1, 1, 1)).then(tick).then(preparing(2, 1, 1, 1, 1))
    .then(helper(1)).then(helperReply(1, true)).then(helper(2)).then(helperReply(2, true)).then(readWinner(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).helperKind == "conflict" and s.requests.get(2).response == "200" and s.requests.get(2).returned == 3 and invariant)
  run differentLoginsRecoverSameAddressWinnerTest = init.then(configure("none"))
    .then(preparing(1, 1, 1, 1, 1)).then(preparing(2, 1, 1, 1, 3))
    .then(helper(1)).then(helperReply(1, true)).then(helper(2)).then(helperReply(2, true)).then(readWinner(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "200" and row(3).login == 1 and invariant)
  run differentAddressConflictReturns409Test = init.then(configure("none"))
    .then(preparing(1, 1, 1, 1, 1)).then(preparing(2, 1, 1, 2, 1))
    .then(helper(1)).then(helperReply(1, true)).then(helper(2)).then(helperReply(2, true)).then(readWinner(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and s.requests.get(2).returned == 0 and invariant)
  run sameAddressHistoricalWinnerNowRefusesTest = init.then(configure("registry")).then(historicalConflict)
    .then(readWinner(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and row(1).source == "historical" and invariant)
  run retryConvertsHistoricalWinnerToRegistryTest = init.then(configure("registry")).then(historicalConflict)
    .then(readWinner(1, true)).then(respond(1, true)).then(registered(1, 1, 1, 2))
    .expect(s.requests.get(1).response == "200" and row(4).source == "registry" and row(4).predecessor == 1 and invariant)
  run oldSameAddressConditionCouldReturnHistoricalClaimTest = init.then(configure("registry")).then(historicalConflict)
    .then(legacyWinnerRead(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and row(s.requests.get(1).returned).source == "historical" and not(successIsRegistry))
  run differentAddressHistoricalWinnerRefusesTest = init.then(configure("registry")).then(preparing(1, 1, 1, 2, 1))
    .then(historicalAppend(1, 1)).then(helper(1)).then(helperReply(1, true)).then(readWinner(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and invariant)
  run failedConflictWinnerReadPreservesHistoryTest = init.then(configure("registry")).then(historicalConflict)
    .then(readWinner(1, false)).then(respond(1, true)).expect(s.requests.get(1).response == "error" and s.heads.get(1) == 1 and invariant)
  run initialNoopSnapshotCanBecomeOldBeforeReplyTest = init.then(configure("registry")).then(begin(1, 1, 1, 1, 3))
    .then(readTip(1, true)).then(registered(2, 1, 1, 2)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 2 and s.heads.get(1) == 5 and invariant)
  run helperCreatedReceiptCanBecomeOldBeforeReplyTest = init.then(configure("registry")).then(preparing(1, 1, 1, 2, 1))
    .then(helper(1)).then(historicalAppend(1, 1)).then(helperReply(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 3 and s.heads.get(1) == 1 and invariant)
  run helperDigestReplayDoesNotRequireCurrentTipTest = init.then(configure("registry"))
    .then(preparing(1, 1, 1, 2, 1)).then(preparing(2, 1, 1, 2, 1)).then(helper(2)).then(helperReply(2, true))
    .then(historicalAppend(1, 1)).then(helper(1)).then(helperReply(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).helperKind == "existing" and s.requests.get(1).returned == 5 and s.heads.get(1) == 1 and invariant)
  run conflictWinnerSnapshotMayChangeBeforeReplyTest = init.then(configure("none"))
    .then(preparing(1, 1, 1, 1, 1)).then(tick).then(preparing(2, 1, 1, 1, 1))
    .then(helper(1)).then(helperReply(1, true)).then(helper(2)).then(helperReply(2, true)).then(readWinner(2, true))
    .then(historicalAppend(1, 2)).then(respond(2, true))
    .expect(s.requests.get(2).returned == 3 and s.heads.get(1) == 1 and invariant)
  run lostHttpSuccessRetainsClaimForRetryTest = init.then(configure("none")).then(preparing(1, 1, 1, 1, 1))
    .then(helper(1)).then(helperReply(1, true)).then(respond(1, false))
    .then(begin(1, 1, 1, 1, 1)).then(readTip(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).returned == 3 and not(row(4).exists) and invariant)
  run preparedRequestMayRemainPendingTest = init.then(configure("none")).then(preparing(1, 1, 1, 1, 1))
    .expect(s.requests.get(1).phase == "helper" and s.requests.get(1).response == "none" and s.heads.get(1) == 0 and invariant)
}
