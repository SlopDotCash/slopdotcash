// @source workers/payment-executor/solana.ts
// @source contracts/solana/transactions.ts
// @evidence contracts/solana/integration/executor.e2e.mjs
// One journal key, one selected role, two invocations, three representative
// last-valid heights (1, 3, 5), and finalized height 0..6. Each invocation
// attempts signing at most once. `signed` records a retained valid result;
// invalid signer output can still have invoked the signer. Raw identities summarize distinct candidate messages;
// signature correctness, packet size and encoding are explicit predicates.
// Initial authorization, instruction construction and provider authenticity
// are assumed. Status and height replies are observations at separate times.
// A quote can be stale by the time signing commits; no freshness or liveness
// follows from a safe-integer lastValidBlockHeight alone.
// The model covers send() admission and journal handoff. Actual broadcasting,
// current-wallet revalidation and completeSolanaBinding are separate models.
// A successful observed signature is not payment finality. Only keeper may
// replace a finalized failed transaction before its blockhash expires.
// Expiry requires height strictly greater than the retained bound, followed
// by refresh. The refresh is not an atomic chain snapshot. Existing admission
// compares fingerprint; replacement additionally compares hash/generation.
// An overlapping call can finish with an already committed winner even when
// its own quote differs. Co-signing may update raw bytes under the same hash
// and generation; replacement archives that current row, not the stale copy.
// Archive keys follow the source's last-valid-height keys. This finite model
// does not prove uniqueness or permanent retention for unbounded replacements
// that reuse an expiry height. It does not model storage corruption or claims
// of absent history as trusted proofs. No tests or checkers were run here.
module solana_executor_journal {
  val ids = Set(1, 2)
  val roles = Set("attester", "relayer", "keeper")
  val quotes = Set(1, 3, 5)
  type Row = { exists: bool, identity: int, fingerprint: int, generation: int,
    cosigner: bool, completed: bool }
  type Request = { phase: str, fingerprint: int, capturedPaid: bool,
    snapshot: Row, expired: bool, failedFinal: bool, observedHeight: int, expiryBound: int,
    quote: int, signed: bool, result: str, returned: Row }
  val absent: Row = { exists: false, identity: 0, fingerprint: 1,
    generation: 0, cosigner: false, completed: false }
  val idle: Request = { phase: "unused", fingerprint: 1, capturedPaid: false,
    snapshot: absent, expired: false, failedFinal: false, observedHeight: -1, expiryBound: 0,
    quote: 0, signed: false, result: "none", returned: absent }
  var s: { configured: bool, role: str, height: int, paid: bool, bound: bool,
    retired: bool, active: Row, archive: int -> Row, requests: int -> Request }
  action init = s' = { configured: false, role: "attester", height: 0,
    paid: false, bound: false, retired: false, active: absent,
    archive: quotes.mapBy(_ => absent), requests: ids.mapBy(_ => idle) }
  action configure(role: str, retained: bool): bool = all {
    not(s.configured), roles.contains(role),
    s' = s.with("configured", true).with("role", role).with("active",
      if (retained) { exists: true, identity: 1, fingerprint: 1, generation: 1,
        cosigner: role == "attester", completed: false } else absent) }
  def finish(request: Request, result: str): Request = request.with("phase", "done").with("result", result)
  action advance = all { s.configured, s.height < 6, s' = s.with("height", s.height + 1) }
  action pay = all { s.configured, not(s.paid), s' = s.with("paid", true) }
  action bind = all { s.configured, not(s.bound), s' = s.with("bound", true) }
  action retire = all { s.configured, not(s.retired), s' = s.with("retired", true) }
  // The completion protocol verifies signatures before this environment effect.
  action cosign = all { s.active.exists, s.active.cosigner,
    s' = s.with("active", s.active.with("cosigner", false).with("completed", true)) }
  action begin(id: int, fingerprint: int): bool = all {
    s.configured, ids.contains(id), Set(1, 2).contains(fingerprint), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "load")
      .with("fingerprint", fingerprint).with("capturedPaid", s.paid))) }
  action load(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "load", s' = s.with("requests", s.requests.set(id,
      if (s.active.exists and s.active.fingerprint != request.fingerprint) finish(request, "collision")
      else request.with("snapshot", s.active).with("phase", if (s.active.exists) "status" else "quote"))) }
  }
  action status(id: int, outcome: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "status", Set("absent", "success", "failed-pending", "failed-final", "error").contains(outcome),
      s' = s.with("requests", s.requests.set(id,
        if (outcome == "error") finish(request, "status-error")
        else if (outcome == "success") finish(request.with("returned", request.snapshot), "observed")
        else if (outcome == "failed-pending" or (outcome == "failed-final" and s.role != "keeper")) finish(request, "failed")
        else request.with("phase", "height").with("failedFinal", outcome == "failed-final"))) }
  }
  action height(id: int, valid: bool): bool = {
    val request = s.requests.get(id)
    val expired = s.height > request.snapshot.generation or (s.role == "keeper" and request.failedFinal)
    all { request.phase == "height", s' = s.with("requests", s.requests.set(id,
      if (not(valid)) finish(request, "height-error")
      else request.with("observedHeight", s.height).with("expiryBound", request.snapshot.generation).with("expired", expired)
        .with("phase", if (expired) "refresh" else "handoff"))) }
  }
  action refresh(id: int, valid: bool): bool = {
    val request = s.requests.get(id)
    val refuses = (s.role != "attester" and s.paid) or (s.role == "attester" and s.bound)
    all { request.phase == "refresh", s' = s.with("requests", s.requests.set(id,
      if (not(valid) or refuses) finish(request, "refresh-error") else request.with("phase", "quote"))) }
  }
  action quote(id: int, generation: int, valid: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "quote", quotes.contains(generation),
      s' = s.with("requests", s.requests.set(id,
        if (request.capturedPaid) finish(request, "paid")
        else if (not(valid)) finish(request, "quote-error")
        else request.with("phase", "admit").with("quote", generation))) }
  }
  action admit(id: int, signatureAndPacketValid: bool, replyReceived: bool): bool = {
    val request = s.requests.get(id)
    val current = s.active
    val winner = current.exists and (not(request.expired)
      or current.identity != request.snapshot.identity or current.generation != request.snapshot.generation)
    val collision = current.exists and current.fingerprint != request.fingerprint
    val refuses = s.retired or collision or not(signatureAndPacketValid) or (request.expired and not(current.exists))
    val nextValue: Row = { exists: true, identity: id * 10 + request.quote,
      fingerprint: request.fingerprint, generation: request.quote,
      cosigner: s.role == "attester", completed: false }
    val signed = not(s.retired) and not(collision) and not(winner) and signatureAndPacketValid
      and (not(request.expired) or current.exists)
    all { request.phase == "admit",
      s' = s.with("active", if (signed) nextValue else current)
        .with("archive", if (signed and current.exists) s.archive.set(current.generation, current) else s.archive)
        .with("requests", s.requests.set(id,
          if (s.retired or collision) finish(request, if (s.retired) "retired" else "collision")
          else if (winner) (if (replyReceived) request.with("phase", "handoff").with("snapshot", current)
            else finish(request, "write-reply-lost"))
          else if (refuses) finish(request, "sign-error")
          else if (not(replyReceived)) finish(request.with("signed", true), "write-reply-lost")
          else request.with("phase", "handoff").with("signed", true).with("snapshot", nextValue))) }
  }
  action handoff(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "handoff", request.snapshot.exists,
      s' = s.with("requests", s.requests.set(id, finish(request.with("returned", request.snapshot),
        if (request.snapshot.cosigner) "partial" else "broadcast"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet role = roles.oneOf()
    nondet fingerprint = Set(1, 2).oneOf()
    nondet generation = quotes.oneOf()
    nondet outcome = Set("absent", "success", "failed-pending", "failed-final", "error").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { configure(role, yes), advance, pay, bind, retire, cosign, begin(id, fingerprint), load(id),
      status(id, outcome), height(id, yes), refresh(id, yes), quote(id, generation, yes),
      admit(id, yes, other), handoff(id), s' = s }
  }
  val invariant = all {
    s.height >= 0 and s.height <= 6, roles.contains(s.role),
    s.active.exists implies quotes.contains(s.active.generation),
    quotes.forall(g => not(s.archive.get(g).exists) or s.archive.get(g).generation == g),
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.expired implies request.observedHeight > request.expiryBound
          or (s.role == "keeper" and request.failedFinal),
        request.result == "partial" implies request.returned.exists and request.returned.cosigner,
        request.result == "broadcast" implies request.returned.exists and not(request.returned.cosigner),
        request.signed implies quotes.contains(request.quote),
        request.result == "observed" implies request.returned.exists }
    }) }
  action empty(role: str): bool = init.then(configure(role, false))
  action retained(role: str): bool = init.then(configure(role, true))
  action fresh(id: int, generation: int): bool = begin(id, 1).then(load(id)).then(quote(id, generation, true))
  action expire(id: int): bool = begin(id, 1).then(load(id)).then(status(id, "absent")).then(height(id, true)).then(refresh(id, true))

  run freshBindingReturnsPartialBytesTest = empty("attester").then(fresh(1, 1)).then(admit(1, true, true)).then(handoff(1))
    .expect(s.requests.get(1).result == "partial" and s.active.cosigner and invariant)
  run freshPaymentHandsOffDurableFullBytesTest = empty("relayer").then(fresh(1, 1)).then(admit(1, true, true)).then(handoff(1))
    .expect(s.requests.get(1).result == "broadcast" and s.active.exists and invariant)
  run currentFingerprintCollisionRefusesTest = retained("attester").then(begin(1, 2)).then(load(1))
    .expect(s.requests.get(1).result == "collision" and not(s.requests.get(1).signed) and invariant)
  run knownSignatureReturnsBeforeExpiryReadTest = retained("relayer").then(begin(1, 1)).then(load(1)).then(status(1, "success"))
    .expect(s.requests.get(1).result == "observed" and s.requests.get(1).observedHeight == -1 and invariant)
  run failedAttesterCannotReplaceEvenAfterExpiryTest = retained("attester").then(advance).then(advance)
    .then(begin(1, 1)).then(load(1)).then(status(1, "failed-final"))
    .expect(s.requests.get(1).result == "failed" and not(s.requests.get(1).expired) and invariant)
  run pendingFailureCannotReplaceKeeperTest = retained("keeper").then(begin(1, 1)).then(load(1)).then(status(1, "failed-pending"))
    .expect(s.requests.get(1).result == "failed" and invariant)
  run finalizedKeeperFailureMayReplaceBeforeExpiryTest = retained("keeper").then(begin(1, 1)).then(load(1))
    .then(status(1, "failed-final")).then(height(1, true)).then(refresh(1, true)).then(quote(1, 3, true))
    .then(admit(1, true, true)).then(handoff(1)).expect(s.height == 0 and s.archive.get(1).exists and invariant)
  run exactLastValidHeightReusesOriginalTest = retained("attester").then(advance).then(begin(1, 1)).then(load(1))
    .then(status(1, "absent")).then(height(1, true)).then(handoff(1))
    .expect(not(s.requests.get(1).expired) and s.active.identity == 1 and invariant)
  run heightBeyondBoundAllowsRefreshedReplacementTest = retained("relayer").then(advance).then(advance).then(expire(1))
    .then(quote(1, 3, true)).then(admit(1, true, true)).then(handoff(1))
    .expect(s.archive.get(1).identity == 1 and s.active.generation == 3 and invariant)
  run refreshedPaidAwardRefusesReplacementTest = retained("relayer").then(advance).then(advance).then(pay)
    .then(begin(1, 1)).then(load(1)).then(status(1, "absent")).then(height(1, true)).then(refresh(1, true))
    .expect(s.requests.get(1).result == "refresh-error" and s.active.identity == 1 and invariant)
  run refreshedMatchingBindingRefusesReplacementTest = retained("attester").then(advance).then(advance).then(bind)
    .then(begin(1, 1)).then(load(1)).then(status(1, "absent")).then(height(1, true)).then(refresh(1, true))
    .expect(s.requests.get(1).result == "refresh-error" and invariant)
  run capturedPaidAwardRefusesFreshSigningTest = empty("relayer").then(pay).then(begin(1, 1)).then(load(1)).then(quote(1, 1, true))
    .expect(s.requests.get(1).result == "paid" and not(s.active.exists) and invariant)
  run invalidHeightRefusesTest = retained("relayer").then(begin(1, 1)).then(load(1)).then(status(1, "absent")).then(height(1, false))
    .expect(s.requests.get(1).result == "height-error" and invariant)
  run invalidQuoteRefusesTest = empty("attester").then(begin(1, 1)).then(load(1)).then(quote(1, 1, false))
    .expect(s.requests.get(1).result == "quote-error" and not(s.active.exists) and invariant)
  run retiredBeforeAdmissionCannotSignTest = empty("relayer").then(fresh(1, 1)).then(retire).then(admit(1, true, true))
    .expect(s.requests.get(1).result == "retired" and not(s.active.exists) and invariant)
  run invalidSignerOrPacketRollsBackArchiveTest = retained("relayer").then(advance).then(advance).then(expire(1))
    .then(quote(1, 3, true)).then(admit(1, false, true))
    .expect(s.active.identity == 1 and not(s.archive.get(1).exists) and invariant)
  run lostCommitReplyRetainsSignedBytesTest = empty("attester").then(fresh(1, 1)).then(admit(1, true, false))
    .expect(s.requests.get(1).result == "write-reply-lost" and s.active.exists and invariant)
  run concurrentFreshQuotesReuseFirstCommittedWinnerTest = empty("relayer").then(fresh(1, 1)).then(fresh(2, 3))
    .then(admit(1, true, true)).then(admit(2, true, true)).then(handoff(1)).then(handoff(2))
    .expect(s.requests.get(1).returned == s.requests.get(2).returned and not(s.requests.get(2).signed) and invariant)
  run reusedWinnerCanLoseTransactionReplyTest = empty("relayer").then(fresh(1, 1)).then(fresh(2, 3))
    .then(admit(1, true, true)).then(admit(2, true, false))
    .expect(s.active.generation == 1 and not(s.requests.get(2).signed)
      and s.requests.get(2).result == "write-reply-lost" and invariant)
  run concurrentExpiryReplacementsReuseWinnerTest = retained("relayer").then(advance).then(advance).then(expire(1)).then(expire(2))
    .then(quote(1, 3, true)).then(quote(2, 5, true)).then(admit(1, true, true)).then(admit(2, true, true))
    .then(handoff(1)).then(handoff(2)).expect(s.active.generation == 3 and not(s.requests.get(2).signed) and invariant)
  run replacementArchivesCurrentCosignedRowTest = retained("attester").then(advance).then(advance).then(expire(1))
    .then(quote(1, 3, true)).then(cosign).then(admit(1, true, true)).then(handoff(1))
    .expect(s.archive.get(1).completed and s.active.cosigner and invariant)
  run reuseCanReturnEarlierPartialSnapshotTest = retained("attester").then(begin(1, 1)).then(load(1)).then(status(1, "absent"))
    .then(height(1, true)).then(cosign).then(handoff(1))
    .expect(s.requests.get(1).result == "partial" and not(s.active.cosigner) and invariant)
  run quoteMayExpireBeforeCommitTest = empty("relayer").then(fresh(1, 1)).then(advance).then(advance)
    .then(admit(1, true, true)).then(handoff(1)).expect(s.height > s.active.generation and invariant)
  run laterRetirementDoesNotEraseExistingSignedBytesTest = retained("relayer").then(retire).then(begin(1, 1)).then(load(1))
    .then(status(1, "absent")).then(height(1, true)).then(handoff(1))
    .expect(s.requests.get(1).result == "broadcast" and s.active.identity == 1 and invariant)
}
