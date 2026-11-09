// @source workers/payment-executor/solana.ts
// @source workers/payment-executor/core.ts
// @source workers/payment-executor/index.ts
// @source workers/payment-executor/entrypoint.ts
// @source backend/payments/handler.ts
// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @evidence contracts/solana/integration/executor.e2e.mjs
// One actor/claim/award/deployment, one retained half-signed binding, at most
// two completion calls (either slot can instead exercise prepare reuse), two
// generations and two valid wallet signatures for each unchanged message.
// The first authority signature defines transaction identity. Completion may
// fill only the wallet slot; message, authority signature, generation and
// transaction identity stay unchanged. Valid signatures are predicates; no
// Ed25519, base64, message serializer or chain verification is proved here.
// Initial authorized() combines current registry and finalized-award/context
// checks. The Pages caller derives claim and attempt together from D1; input
// aliasing across claims/attempts, outer envelope/auth and fresh signing are
// excluded. A prepare-reuse call starts after its common status/expiry prefix.
// The shared send() generation lifecycle is a separate refinement: refresh
// below abstracts successful finalized expiry, fresh authority, archived old
// bytes and a newly prepared generation, not arbitrary journal replacement.
// Completion CAS checks captured transaction identity/generation. Concurrent
// valid completions keep the first full row. Commit and reply are separate;
// a rejected/lost journal reply never rolls back a committed wallet slot.
// The fixed optional callback repeats authorizeRegistry after an initial
// missing status and immediately before send, including prepare reuse of a
// full row. Observed success returns without a new authorization or send.
// Registry observations are snapshots: changes after the final callback are
// allowed. No atomic guarantee across D1, journal, RPC and chain is claimed.
// Height 0..2 represents equality/strict finalized expiry of generation 1 at
// height 1. Wall time 0..2 independently represents its submission deadline.
// completeSolanaBinding neither refreshes nor locally refuses expired bytes;
// actual RPC/preflight/chain outcomes are inputs. Submission/observed status
// is never payment finality. Instruction expiry, version and current on-chain
// authority enforcement remain contract obligations, not local completion
// guards. One monotonic node-status class per generation is retained here;
// forks, status disappearance and unbounded retries are not modeled.
// A client may already possess and submit its co-signed bytes independently.
// No new signer call, financial transfer, payment mark or signed-byte deletion
// is modeled. The old missing-final-check path is outside step as a negative
// control. Source definitions and existing real workflow are references only;
// no test, parser, checker, validator or provider was run for this model.
module solana_binding_completion {
  val ids = Set(1, 2)
  val generations = Set(1, 2)
  val modes = Set("complete", "prepare-reuse")
  val bodies = Set("valid-a", "valid-b", "encoding", "length", "header", "authority", "message", "wallet", "foreign-wallet")
  type Call = { phase: str, mode: str, bodyGeneration: int, body: str,
    initialAuth: bool, readGeneration: int, readHalf: bool, validated: bool,
    selectedGeneration: int, selectedSignature: int, committed: bool,
    coalesced: bool, finalAuth: bool, sent: bool, observed: bool,
    desired: str, response: str }
  val idle: Call = { phase: "unused", mode: "complete", bodyGeneration: 1,
    body: "valid-a", initialAuth: false, readGeneration: 0, readHalf: false,
    validated: false, selectedGeneration: 0, selectedSignature: 0,
    committed: false, coalesced: false, finalAuth: false, sent: false,
    observed: false, desired: "none", response: "none" }
  var s: { claim: int, generation: int, height: int, now: int,
    rows: int -> str, signatures: int -> int, known: int -> str,
    calls: int -> Call }
  action init = s' = { claim: 1, generation: 1, height: 0, now: 0,
    rows: Map(1 -> "half", 2 -> "absent"), signatures: generations.mapBy(_ => 0),
    known: generations.mapBy(_ => "none"), calls: ids.mapBy(_ => idle) }
  def ended(call: Call, result: str): Call = call.with("phase", "response").with("desired", result)
  def validBody(body: str): bool = Set("valid-a", "valid-b").contains(body)
  def bodySignature(body: str): int = if (body == "valid-a") 1 else 2
  def row(generation: int): str = if (generations.contains(generation)) s.rows.get(generation) else "absent"
  def signature(generation: int): int = if (generations.contains(generation)) s.signatures.get(generation) else 0
  def known(generation: int): str = if (generations.contains(generation)) s.known.get(generation) else "none"
  action replaceClaim = all { s.claim == 1, s' = s.with("claim", 2) }
  action advanceHeight = all { s.height < 2, s' = s.with("height", s.height + 1) }
  action advanceTime = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action refreshGeneration = all {
    s.generation == 1, s.height > 1, s.claim == 1, s.known.get(1) == "none",
    s' = s.with("generation", 2).with("rows", s.rows.set(2, "half")) }
  action externalStatus(generation: int, successful: bool): bool = all {
    generations.contains(generation), s.rows.get(generation) != "absent", s.known.get(generation) == "none",
    s.rows.get(generation) == "full" or ids.exists(id => {
      val call = s.calls.get(id)
      call.phase != "unused" and call.bodyGeneration == generation and validBody(call.body)
    }),
    s' = s.with("known", s.known.set(generation, if (successful) "success" else "failed")) }
  action begin(id: int, mode: str, generation: int, body: str): bool = all {
    ids.contains(id), modes.contains(mode), generations.contains(generation), bodies.contains(body),
    s.rows.get(generation) != "absent", s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, idle.with("phase", "initial-auth")
      .with("mode", mode).with("bodyGeneration", generation).with("body", body))) }
  action initialAuthorization(id: int, contextValid: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "initial-auth", s' = s.with("calls", s.calls.set(id,
      if (s.claim == 1 and contextValid) call.with("phase", "journal-read").with("initialAuth", true)
      else ended(call, "authority-error"))) }
  }
  action readJournal(id: int): bool = {
    val call = s.calls.get(id)
    val half = s.rows.get(s.generation) == "half"
    val captured = call.with("readGeneration", s.generation).with("readHalf", half)
    all { call.phase == "journal-read", s' = s.with("calls", s.calls.set(id,
      if (half and call.mode == "prepare-reuse") ended(captured, "prepared")
      else if (half) captured.with("phase", "validate")
      else captured.with("phase", "status").with("selectedGeneration", s.generation)
        .with("selectedSignature", s.signatures.get(s.generation)))) }
  }
  action validateWalletBytes(id: int): bool = {
    val call = s.calls.get(id)
    val messageMatches = call.bodyGeneration == call.readGeneration
      and not(Set("encoding", "length", "header", "authority", "message").contains(call.body))
    all { call.phase == "validate", s' = s.with("calls", s.calls.set(id,
      if (not(messageMatches)) ended(call, "bytes-error")
      else if (not(validBody(call.body))) ended(call, "signature-error")
      else call.with("phase", "commit").with("validated", true))) }
  }
  action commitCompletion(id: int): bool = {
    val call = s.calls.get(id)
    val same = s.generation == call.readGeneration
    val first = same and s.rows.get(s.generation) == "half"
    val signature = if (first) bodySignature(call.body) else s.signatures.get(s.generation)
    all { call.phase == "commit",
      s' = s.with("rows", if (first) s.rows.set(s.generation, "full") else s.rows)
        .with("signatures", if (first) s.signatures.set(s.generation, signature) else s.signatures)
        .with("calls", s.calls.set(id, if (not(same)) ended(call, "generation-error")
          else call.with("phase", "commit-reply").with("committed", first).with("coalesced", not(first))
            .with("selectedGeneration", s.generation).with("selectedSignature", signature))) }
  }
  action commitReply(id: int, received: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "commit-reply", s' = s.with("calls", s.calls.set(id,
      if (received) call.with("phase", "status") else ended(call, "journal-error"))) }
  }
  action readStatus(id: int, available: bool): bool = {
    val call = s.calls.get(id)
    val status = known(call.selectedGeneration)
    val recovery = call.phase == "recovery-status"
    all { Set("status", "recovery-status").contains(call.phase), s' = s.with("calls", s.calls.set(id,
      if (not(available)) ended(call, "status-error")
      else if (status == "success") ended(call.with("observed", true), "observed")
      else if (status == "failed") ended(call, "transaction-failed")
      else if (recovery) ended(call, "send-error")
      else call.with("phase", "final-auth"))) }
  }
  action finalAuthorization(id: int, available: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "final-auth", s' = s.with("calls", s.calls.set(id,
      if (not(available)) ended(call, "authority-error")
      else if (s.claim != 1) ended(call, "authority-error")
      else call.with("phase", "ready").with("finalAuth", true))) }
  }
  action transmit(id: int, nodeAccepted: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "ready",
      s' = s.with("known", if (nodeAccepted and known(call.selectedGeneration) == "none")
          s.known.set(call.selectedGeneration, "success") else s.known)
        .with("calls", s.calls.set(id, call.with("phase", "send-reply").with("sent", true))) }
  }
  action sendReply(id: int, kind: str): bool = {
    val call = s.calls.get(id)
    all { call.phase == "send-reply", Set("exact", "mismatch", "throw").contains(kind),
      kind != "exact" or known(call.selectedGeneration) == "success",
      s' = s.with("calls", s.calls.set(id,
        if (kind == "throw") call.with("phase", "recovery-status")
        else ended(call, if (kind == "exact") "submitted" else "signature-mismatch"))) }
  }
  action awaitFailure(id: int): bool = {
    val call = s.calls.get(id)
    all { Set("journal-read", "commit").contains(call.phase),
      s' = s.with("calls", s.calls.set(id, ended(call, "journal-error"))) }
  }
  action respond(id: int, received: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "response", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "done").with("response", if (received) call.desired else "lost"))) }
  }
  // The previous code sent directly after a missing status, with only the
  // invocation's earlier authorized() snapshot. Excluded from fixed step.
  action oldSkipFinalAuthorization(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "final-auth", s' = s.with("calls", s.calls.set(id, call.with("phase", "ready"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet generation = generations.oneOf()
    nondet mode = modes.oneOf()
    nondet body = bodies.oneOf()
    nondet kind = Set("exact", "mismatch", "throw").oneOf()
    nondet a = Set(false, true).oneOf()
    any { replaceClaim, advanceHeight, advanceTime, refreshGeneration,
      externalStatus(generation, a), begin(id, mode, generation, body), initialAuthorization(id, a),
      readJournal(id), validateWalletBytes(id), commitCompletion(id), commitReply(id, a),
      readStatus(id, a), finalAuthorization(id, a), transmit(id, a), sendReply(id, kind),
      awaitFailure(id), respond(id, a), s' = s }
  }
  val invariant = all {
    generations.contains(s.generation), Set(1, 2).contains(s.claim),
    Set(0, 1, 2).contains(s.height), Set(0, 1, 2).contains(s.now),
    s.rows.get(1) != "absent", s.generation == 2 implies s.rows.get(2) != "absent",
    generations.forall(generation => (s.rows.get(generation) == "full") == (s.signatures.get(generation) > 0)),
    ids.forall(id => {
      val call = s.calls.get(id)
      val selected = generations.contains(call.selectedGeneration)
      all { call.committed implies call.validated and row(call.readGeneration) == "full"
          and signature(call.readGeneration) == bodySignature(call.body),
        call.coalesced implies call.validated and not(call.committed),
        call.sent implies call.initialAuth and call.finalAuth and selected
          and row(call.selectedGeneration) == "full"
          and call.selectedSignature == signature(call.selectedGeneration),
        call.observed implies selected and known(call.selectedGeneration) == "success",
        call.desired == "submitted" implies call.sent,
        call.desired == "prepared" implies call.mode == "prepare-reuse" and call.readHalf and not(call.sent),
        Set("bytes-error", "signature-error", "generation-error", "authority-error", "journal-error").contains(call.desired)
          implies not(call.sent) }
    }),
    ids.forall(a => ids.forall(b => a == b or not(s.calls.get(a).committed and s.calls.get(b).committed)
      or s.calls.get(a).readGeneration != s.calls.get(b).readGeneration)) }
  action authorizedCall(id: int, mode: str, generation: int, body: str): bool = begin(id, mode, generation, body)
    .then(initialAuthorization(id, true)).then(readJournal(id))
  action validatedCall(id: int, body: str): bool = authorizedCall(id, "complete", 1, body).then(validateWalletBytes(id))
  action completed(id: int): bool = commitCompletion(id).then(commitReply(id, true))
  action ready(id: int): bool = readStatus(id, true).then(finalAuthorization(id, true))
  action submitted(id: int): bool = transmit(id, true).then(sendReply(id, "exact")).then(respond(id, true))
  action firstFull = init.then(validatedCall(1, "valid-a")).then(completed(1))

  run walletSlotCompletionPreservesGenerationTest = firstFull.then(ready(1)).then(submitted(1))
    .expect(s.rows.get(1) == "full" and s.signatures.get(1) == 1 and s.calls.get(1).selectedGeneration == 1 and invariant)
  run initialAuthorizationRefusesObsoleteClaimTest = init.then(replaceClaim).then(begin(1, "complete", 1, "valid-a"))
    .then(initialAuthorization(1, true)).then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and s.rows.get(1) == "half" and invariant)
  run invalidContextRefusesBeforeJournalTest = init.then(begin(1, "complete", 1, "valid-a")).then(initialAuthorization(1, false))
    .then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and s.calls.get(1).readGeneration == 0 and invariant)
  run invalidEncodingRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "encoding")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "bytes-error" and s.rows.get(1) == "half" and invariant)
  run changedLengthRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "length")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "bytes-error" and invariant)
  run changedSignatureCountRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "header")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "bytes-error" and invariant)
  run changedAuthoritySignatureRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "authority")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "bytes-error" and invariant)
  run changedMessageRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "message")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "bytes-error" and invariant)
  run invalidWalletSignatureRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "wallet")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "signature-error" and invariant)
  run foreignCosignerRefusesBeforeCompletionTest = init.then(authorizedCall(1, "complete", 1, "foreign-wallet")).then(validateWalletBytes(1))
    .then(respond(1, true)).expect(s.calls.get(1).response == "signature-error" and invariant)
  run changedGenerationRefusesCapturedCompletionTest = init.then(validatedCall(1, "valid-a")).then(advanceHeight).then(advanceHeight)
    .then(refreshGeneration).then(commitCompletion(1)).then(respond(1, true))
    .expect(s.generation == 2 and s.rows.get(1) == "half" and s.calls.get(1).response == "generation-error" and invariant)
  run priorGenerationBytesDoNotCompleteNewGenerationTest = init.then(advanceHeight).then(advanceHeight).then(refreshGeneration)
    .then(authorizedCall(1, "complete", 1, "valid-a")).then(validateWalletBytes(1)).then(respond(1, true))
    .expect(s.calls.get(1).readGeneration == 2 and s.calls.get(1).response == "bytes-error" and invariant)
  run concurrentCompletionsRetainFirstWalletSignatureTest = init.then(validatedCall(1, "valid-a")).then(validatedCall(2, "valid-b"))
    .then(completed(1)).then(completed(2)).then(ready(2)).then(submitted(2))
    .expect(s.signatures.get(1) == 1 and s.calls.get(2).coalesced and s.calls.get(2).selectedSignature == 1 and invariant)
  run committedCompletionSurvivesRejectedJournalReplyTest = init.then(validatedCall(1, "valid-a")).then(commitCompletion(1))
    .then(commitReply(1, false)).then(respond(1, true))
    .expect(s.rows.get(1) == "full" and s.signatures.get(1) == 1 and s.calls.get(1).response == "journal-error" and invariant)
  run completedRetryUsesStoredBytesWithoutNewWalletValidationTest = firstFull.then(authorizedCall(2, "complete", 1, "wallet"))
    .then(ready(2)).then(submitted(2))
    .expect(not(s.calls.get(2).validated) and s.calls.get(2).selectedSignature == 1 and s.calls.get(2).response == "submitted" and invariant)
  run lateClaimChangeDuringJournalAwaitRefusesSendTest = init.then(begin(1, "complete", 1, "valid-a"))
    .then(initialAuthorization(1, true)).then(replaceClaim).then(readJournal(1)).then(validateWalletBytes(1)).then(completed(1))
    .then(ready(1)).then(respond(1, true)).expect(s.rows.get(1) == "full" and not(s.calls.get(1).sent) and s.calls.get(1).response == "authority-error" and invariant)
  run lateClaimChangeDuringStatusAwaitRefusesSendTest = firstFull.then(replaceClaim).then(ready(1)).then(respond(1, true))
    .expect(s.calls.get(1).response == "authority-error" and not(s.calls.get(1).sent) and invariant)
  run oldCompletionCanSendAfterClaimChangesNegativeControlTest = firstFull.then(replaceClaim).then(readStatus(1, true))
    .then(oldSkipFinalAuthorization(1)).then(submitted(1)).expect(s.claim == 2 and s.calls.get(1).sent and not(invariant))
  run knownSubmissionReconcilesAfterClaimChangesTest = firstFull.then(externalStatus(1, true)).then(replaceClaim)
    .then(readStatus(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).response == "observed" and not(s.calls.get(1).sent) and not(s.calls.get(1).finalAuth) and invariant)
  run knownFailureDoesNotBroadcastAgainTest = firstFull.then(externalStatus(1, false)).then(readStatus(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).response == "transaction-failed" and not(s.calls.get(1).sent) and invariant)
  run statusFailureRetainsCompletedBytesTest = firstFull.then(readStatus(1, false)).then(respond(1, true))
    .expect(s.rows.get(1) == "full" and s.calls.get(1).response == "status-error" and invariant)
  run finalAuthorizationFailureDoesNotEnterRecoveryStatusTest = firstFull.then(readStatus(1, true)).then(finalAuthorization(1, false))
    .then(respond(1, true)).expect(s.calls.get(1).response == "authority-error" and not(s.calls.get(1).observed) and not(s.calls.get(1).sent) and invariant)
  run lostSendReplyRecoversKnownSignatureTest = firstFull.then(ready(1)).then(transmit(1, true)).then(sendReply(1, "throw"))
    .then(readStatus(1, true)).then(respond(1, true)).expect(s.calls.get(1).response == "observed" and s.calls.get(1).sent and invariant)
  run unknownSendFailureRetainsCompletedBytesTest = firstFull.then(ready(1)).then(transmit(1, false)).then(sendReply(1, "throw"))
    .then(readStatus(1, true)).then(respond(1, true)).expect(s.calls.get(1).response == "send-error" and s.rows.get(1) == "full" and invariant)
  run wrongReturnedSignatureIsNotSubmissionProofTest = firstFull.then(ready(1)).then(transmit(1, true)).then(sendReply(1, "mismatch"))
    .then(respond(1, true)).expect(s.calls.get(1).response == "signature-mismatch" and s.known.get(1) == "success" and invariant)
  run lostHttpReplyDoesNotUndoFullJournalTest = firstFull.then(ready(1)).then(transmit(1, true)).then(sendReply(1, "exact"))
    .then(respond(1, false)).expect(s.calls.get(1).response == "lost" and s.rows.get(1) == "full" and invariant)
  run prepareReusesHalfSignedBytesWithoutBroadcastTest = init.then(authorizedCall(1, "prepare-reuse", 1, "valid-a"))
    .then(respond(1, true)).expect(s.calls.get(1).response == "prepared" and s.rows.get(1) == "half" and not(s.calls.get(1).sent) and invariant)
  run prepareFullRowReuseAlsoRechecksAuthorityTest = firstFull.then(begin(2, "prepare-reuse", 1, "valid-a"))
    .then(initialAuthorization(2, true)).then(readJournal(2)).then(replaceClaim).then(ready(2)).then(respond(2, true))
    .expect(s.calls.get(2).response == "authority-error" and not(s.calls.get(2).sent) and invariant)
  run completionDoesNotRefreshExpiredBytesTest = firstFull.then(advanceHeight).then(advanceHeight).then(advanceTime).then(advanceTime)
    .then(ready(1)).then(transmit(1, false)).then(sendReply(1, "throw")).then(readStatus(1, true)).then(respond(1, true))
    .expect(s.height == 2 and s.now == 2 and s.generation == 1 and s.rows.get(1) == "full" and s.calls.get(1).response == "send-error" and invariant)
  run finalAuthorizationIsSnapshotNotAtomicSendGuardTest = firstFull.then(ready(1)).then(replaceClaim).then(submitted(1))
    .expect(s.claim == 2 and s.calls.get(1).response == "submitted" and s.calls.get(1).finalAuth and invariant)
}
