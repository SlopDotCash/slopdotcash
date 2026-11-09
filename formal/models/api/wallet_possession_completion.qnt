// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source src/lib/wallet-possession.ts
// @source migrations/0007_wallet_possession_attestations.sql
// @evidence scripts/wallet-possession.test.ts
// Two immutable Solana claims for one actor, two issued challenges, two proof
// requests and clock ranks 0..5. Challenge TTL 2 represents the fixed 15-minute
// window, not real elapsed seconds. EVM/off-curve refusal are initial classes.
// Successor publication is abstracted; it never deletes old evidence. The
// obsolete protocol document was retired, not these runtime endpoints.
// Schema/body/identity/strict Ed25519 verification and generated-ID uniqueness
// are predicates, not crypto proofs. A caller knows a challenge only after its
// issue reply. Stored challenge consumption precedes binding/signature/window
// validation. Invalid proof or a lost reply can therefore leave it spent.
// Attestation and audit insertion are one atomic batch. A competing or lost
// batch reply can return the retained first attestation. No payment authority,
// current key possession, settlement or mandatory payout gate is inferred.
module wallet_possession_completion {
  val ids = Set(1, 2)
  val challengeIds = Set(0, 1, 2)
  type Challenge = { exists: bool, claim: int, issued: int, expires: int, spent: bool, known: bool }
  type Issue = { phase: str, claim: int, actor: int, stamp: int, desired: str, response: str }
  type Proof = { phase: str, claim: int, actor: int, challenge: int, bodyValid: bool,
    fieldsMatch: bool, signatureValid: bool, windowMatch: bool, stamp: int,
    consumed: bool, verified: bool, committed: bool, desired: str, response: str }
  val noChallenge: Challenge = { exists: false, claim: 0, issued: -1, expires: -1, spent: false, known: false }
  val noIssue: Issue = { phase: "unused", claim: 1, actor: 1, stamp: -1, desired: "none", response: "none" }
  val noProof: Proof = { phase: "unused", claim: 1, actor: 1, challenge: 0, bodyValid: true,
    fieldsMatch: true, signatureValid: true, windowMatch: true, stamp: -1,
    consumed: false, verified: false, committed: false, desired: "none", response: "none" }
  var s: { configured: bool, firstKind: str, now: int, current: int, secondExists: bool,
    challenges: int -> Challenge, issues: int -> Issue, requests: int -> Proof,
    attestations: int -> int, witnesses: int -> int, audits: int -> int }
  action init = s' = { configured: false, firstKind: "solana", now: 0, current: 1, secondExists: false,
    challenges: challengeIds.mapBy(_ => noChallenge), issues: ids.mapBy(_ => noIssue),
    requests: ids.mapBy(_ => noProof), attestations: ids.mapBy(_ => 0), witnesses: ids.mapBy(_ => 0), audits: ids.mapBy(_ => 0) }
  action configure(kind: str): bool = all { not(s.configured), Set("solana", "off-curve", "evm").contains(kind),
    s' = s.with("configured", true).with("firstKind", kind) }
  def isPresent(claim: int): bool = claim == 1 or (claim == 2 and s.secondExists)
  def kind(claim: int): str = if (claim == 1) s.firstKind else "solana"
  def published(claim: int): str = if (s.attestations.get(claim) != 0) "proven"
    else if (kind(claim) == "off-curve") "not-provable-by-signature" else "unproven"
  def endIssue(request: Issue, status: str): Issue = request.with("phase", "response").with("desired", status)
  def endProof(request: Proof, status: str): Proof = request.with("phase", "response").with("desired", status)
  action tick = all { s.configured, s.now < 5, s' = s.with("now", s.now + 1) }
  action successor = all { s.configured, s.current == 1, s.firstKind != "evm",
    s' = s.with("current", 2).with("secondExists", true) }
  action beginIssue(id: int, claim: int, actor: int): bool = all {
    s.configured, ids.contains(id), ids.contains(claim), ids.contains(actor), s.issues.get(id).phase == "unused",
    s' = s.with("issues", s.issues.set(id, noIssue.with("phase", "owner").with("claim", claim).with("actor", actor))) }
  action issueOwner(id: int): bool = {
    val request = s.issues.get(id)
    all { request.phase == "owner", s' = s.with("issues", s.issues.set(id,
      if (not(isPresent(request.claim)) or request.actor != 1) endIssue(request, "404")
      else if (kind(request.claim) != "solana") endIssue(request, "409")
      else request.with("phase", "existing"))) }
  }
  action issueExisting(id: int): bool = {
    val request = s.issues.get(id)
    all { request.phase == "existing", s' = s.with("issues", s.issues.set(id,
      if (s.attestations.get(request.claim) != 0) endIssue(request, "200")
      else request.with("phase", "prepare"))) }
  }
  action prepareIssue(id: int, valid: bool): bool = {
    val request = s.issues.get(id)
    all { request.phase == "prepare", s' = s.with("issues", s.issues.set(id,
      if (valid) request.with("phase", "write").with("stamp", s.now) else endIssue(request, "error"))) }
  }
  action issueWrite(id: int): bool = {
    val request = s.issues.get(id)
    all { request.phase == "write", not(s.challenges.get(id).exists),
      s' = s.with("challenges", s.challenges.set(id, { exists: true, claim: request.claim,
        issued: request.stamp, expires: request.stamp + 2, spent: false, known: false }))
        .with("issues", s.issues.set(id, request.with("phase", "written"))) }
  }
  action issueReply(id: int, received: bool): bool = {
    val request = s.issues.get(id)
    all { request.phase == "written", s' = s.with("challenges", s.challenges.set(id,
      s.challenges.get(id).with("known", received))).with("issues", s.issues.set(id,
        request.with("phase", "done").with("desired", "201").with("response", if (received) "201" else "lost"))) }
  }
  action issueFailure(id: int): bool = {
    val request = s.issues.get(id)
    all { Set("owner", "existing", "write").contains(request.phase),
      s' = s.with("issues", s.issues.set(id, endIssue(request, "error"))) }
  }
  action respondIssue(id: int): bool = {
    val request = s.issues.get(id)
    all { request.phase == "response", s' = s.with("issues", s.issues.set(id,
      request.with("phase", "done").with("response", request.desired))) }
  }
  action beginProof(id: int, claim: int, actor: int, challenge: int, body: bool, fieldValues: bool, signature: bool, window: bool): bool = all {
    s.configured, ids.contains(id), ids.contains(claim), ids.contains(actor), challengeIds.contains(challenge),
    s.requests.get(id).phase == "unused", challenge == 0 or s.challenges.get(challenge).known,
    s' = s.with("requests", s.requests.set(id, noProof.with("phase", "owner").with("claim", claim).with("actor", actor)
      .with("challenge", challenge).with("bodyValid", body).with("fieldsMatch", fieldValues)
      .with("signatureValid", signature).with("windowMatch", window))) }
  action proofOwner(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "owner", s' = s.with("requests", s.requests.set(id,
      if (not(isPresent(request.claim)) or request.actor != 1) endProof(request, "404")
      else if (kind(request.claim) == "evm") endProof(request, "409") else request.with("phase", "existing"))) }
  }
  action proofExisting(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "existing", s' = s.with("requests", s.requests.set(id,
      if (s.attestations.get(request.claim) != 0) endProof(request, "200") else request.with("phase", "body"))) }
  }
  action proofBody(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "body", s' = s.with("requests", s.requests.set(id,
      if (request.bodyValid) request.with("phase", "consume").with("stamp", s.now) else endProof(request, "400"))) }
  }
  action consume(id: int): bool = {
    val request = s.requests.get(id)
    val challenge = s.challenges.get(request.challenge)
    val accepted = challenge.exists and not(challenge.spent) and request.stamp < challenge.expires
    all { request.phase == "consume",
      s' = s.with("challenges", s.challenges.set(request.challenge, challenge.with("spent", challenge.spent or accepted)))
        .with("requests", s.requests.set(id, request.with("phase", "consume-reply").with("consumed", accepted))) }
  }
  action consumedReply(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    val challenge = s.challenges.get(request.challenge)
    all { request.phase == "consume-reply", s' = s.with("requests", s.requests.set(id,
      if (not(received)) endProof(request, "error")
      else if (not(request.consumed) or challenge.claim != request.claim) endProof(request, "409")
      else request.with("phase", "verify"))) }
  }
  action verify(id: int): bool = {
    val request = s.requests.get(id)
    val challenge = s.challenges.get(request.challenge)
    val valid = request.fieldsMatch and request.signatureValid and request.windowMatch
      and kind(request.claim) == "solana" and s.now >= challenge.issued and s.now < challenge.expires
    all { request.phase == "verify", s' = s.with("requests", s.requests.set(id,
      if (valid) request.with("phase", "hash").with("verified", true) else endProof(request, "400"))) }
  }
  action hashProof(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "hash", s' = s.with("requests", s.requests.set(id,
      if (ok) request.with("phase", "prewrite") else endProof(request, "error"))) }
  }
  action prewrite(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "prewrite", s' = s.with("requests", s.requests.set(id,
      if (s.attestations.get(request.claim) != 0) endProof(request, "200") else request.with("phase", "batch"))) }
  }
  action commit(id: int): bool = {
    val request = s.requests.get(id)
    val inserted = s.attestations.get(request.claim) == 0
    all { request.phase == "batch",
      s' = s.with("attestations", if (inserted) s.attestations.set(request.claim, request.challenge) else s.attestations)
        .with("witnesses", if (inserted) s.witnesses.set(request.claim, id) else s.witnesses)
        .with("audits", if (inserted) s.audits.set(request.claim, 1) else s.audits)
        .with("requests", s.requests.set(id, request.with("phase", if (inserted) "batch-reply" else "catch-read")
          .with("committed", inserted))) }
  }
  action batchReply(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch-reply", s' = s.with("requests", s.requests.set(id,
      if (ok) endProof(request, "201") else request.with("phase", "catch-read"))) }
  }
  action batchFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch", s' = s.with("requests", s.requests.set(id, request.with("phase", "catch-read"))) }
  }
  action catchRead(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "catch-read", s' = s.with("requests", s.requests.set(id,
      endProof(request, if (ok and s.attestations.get(request.claim) != 0) "200" else "error"))) }
  }
  action proofFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("owner", "existing", "body", "consume", "prewrite").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, endProof(request, "error"))) }
  }
  action respondProof(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (received) request.desired else "lost"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet claim = ids.oneOf()
    nondet actor = ids.oneOf()
    nondet ch = challengeIds.oneOf()
    nondet kind = Set("solana", "off-curve", "evm").oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    nondet d = Set(false, true).oneOf()
    any { configure(kind), tick, successor, beginIssue(id, claim, actor), issueOwner(id), issueExisting(id), prepareIssue(id, a),
      issueWrite(id), issueReply(id, a), issueFailure(id), respondIssue(id), beginProof(id, claim, actor, ch, a, b, c, d),
      proofOwner(id), proofExisting(id), proofBody(id), consume(id), consumedReply(id, a), verify(id), hashProof(id, a),
      prewrite(id), commit(id), batchReply(id, a), batchFailure(id), catchRead(id, a), proofFailure(id), respondProof(id, a), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 5, s.current == 2 implies s.secondExists,
    ids.forall(claim => {
      val ch = s.attestations.get(claim)
      val witness = if (ids.contains(s.witnesses.get(claim))) s.requests.get(s.witnesses.get(claim)) else noProof
      all { s.audits.get(claim) == (if (ch == 0) 0 else 1),
        ch != 0 implies s.challenges.get(ch).spent and s.challenges.get(ch).claim == claim and witness.verified and witness.committed }
    }),
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.verified implies request.consumed,
        Set("200", "201").contains(request.response) implies s.attestations.get(request.claim) != 0,
        request.committed implies s.witnesses.get(request.claim) == id }
    }) }
  action ready = init.then(configure("solana"))
  action issued(id: int, claim: int): bool = beginIssue(id, claim, 1).then(issueOwner(id)).then(issueExisting(id))
    .then(prepareIssue(id, true)).then(issueWrite(id)).then(issueReply(id, true))
  action submitted(id: int, claim: int, ch: int, fieldValues: bool, signature: bool, window: bool): bool =
    beginProof(id, claim, 1, ch, true, fieldValues, signature, window).then(proofOwner(id)).then(proofExisting(id))
      .then(proofBody(id)).then(consume(id)).then(consumedReply(id, true))
  action verified(id: int, claim: int, ch: int): bool = submitted(id, claim, ch, true, true, true).then(verify(id)).then(hashProof(id, true)).then(prewrite(id))
  action recorded(id: int): bool = commit(id).then(batchReply(id, true)).then(respondProof(id, true))

  run validProofPublishesOneAttestationAndAuditTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(recorded(1))
    .expect(published(1) == "proven" and s.audits.get(1) == 1 and invariant)
  run invalidSignatureBurnsChallengeWithoutEvidenceTest = ready.then(issued(1, 1)).then(submitted(1, 1, 1, true, false, true)).then(verify(1)).then(respondProof(1, true))
    .expect(s.challenges.get(1).spent and s.requests.get(1).response == "400" and s.attestations.get(1) == 0 and invariant)
  run mismatchedPayloadBurnsChallengeTest = ready.then(issued(1, 1)).then(submitted(1, 1, 1, false, true, true)).then(verify(1)).then(respondProof(1, true))
    .expect(s.challenges.get(1).spent and s.requests.get(1).response == "400" and invariant)
  run shiftedSignedWindowCannotPublishTest = ready.then(issued(1, 1)).then(submitted(1, 1, 1, true, true, false)).then(verify(1)).then(respondProof(1, true))
    .expect(s.attestations.get(1) == 0 and s.requests.get(1).response == "400" and invariant)
  run expiredChallengeIsNotConsumedTest = ready.then(issued(1, 1)).then(tick).then(tick).then(submitted(1, 1, 1, true, true, true)).then(respondProof(1, true))
    .expect(not(s.challenges.get(1).spent) and s.requests.get(1).response == "409" and invariant)
  run expiryAfterConsumptionPreventsVerificationTest = ready.then(issued(1, 1)).then(submitted(1, 1, 1, true, true, true)).then(tick).then(tick).then(verify(1)).then(respondProof(1, true))
    .expect(s.challenges.get(1).spent and s.requests.get(1).response == "400" and s.attestations.get(1) == 0 and invariant)
  run consumedReplyLossDoesNotRestoreChallengeTest = ready.then(issued(1, 1)).then(beginProof(1, 1, 1, 1, true, true, true, true))
    .then(proofOwner(1)).then(proofExisting(1)).then(proofBody(1)).then(consume(1)).then(consumedReply(1, false)).then(respondProof(1, true))
    .expect(s.challenges.get(1).spent and s.requests.get(1).response == "error" and invariant)
  run secondSubmissionOfSpentChallengeRefusesTest = ready.then(issued(1, 1)).then(submitted(1, 1, 1, true, false, true)).then(verify(1)).then(respondProof(1, true))
    .then(submitted(2, 1, 1, true, true, true)).then(respondProof(2, true)).expect(s.requests.get(2).response == "409" and invariant)
  run twoValidChallengesShareOneImmutableAttestationTest = ready.then(issued(1, 1)).then(issued(2, 1)).then(verified(1, 1, 1)).then(verified(2, 1, 2))
    .then(recorded(1)).then(commit(2)).then(catchRead(2, true)).then(respondProof(2, true))
    .expect(s.attestations.get(1) == 1 and s.audits.get(1) == 1 and s.requests.get(2).response == "200" and invariant)
  run failedBatchCanUseAnotherIssuedChallengeTest = ready.then(issued(1, 1)).then(issued(2, 1)).then(verified(1, 1, 1)).then(batchFailure(1)).then(catchRead(1, true)).then(respondProof(1, true))
    .then(verified(2, 1, 2)).then(recorded(2)).expect(s.requests.get(1).response == "error" and s.attestations.get(1) == 2 and invariant)
  run failedBatchReplyCanRecoverCommittedAttestationTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(commit(1)).then(batchReply(1, false)).then(catchRead(1, true)).then(respondProof(1, true))
    .expect(s.requests.get(1).response == "200" and s.audits.get(1) == 1 and invariant)
  run failedCatchReadLeavesCommittedEvidenceTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(commit(1)).then(batchReply(1, false)).then(catchRead(1, false)).then(respondProof(1, true))
    .expect(s.requests.get(1).response == "error" and published(1) == "proven" and invariant)
  run lostSuccessResponseLeavesPublicEvidenceTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(commit(1)).then(batchReply(1, true)).then(respondProof(1, false))
    .expect(s.requests.get(1).response == "lost" and published(1) == "proven" and invariant)
  run successorPreservesOldPossessionEvidenceTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(recorded(1)).then(successor)
    .expect(s.current == 2 and published(1) == "proven" and published(2) == "unproven" and invariant)
  run challengeForOtherClaimIsBurnedThenRefusedTest = ready.then(successor).then(issued(1, 2)).then(submitted(1, 1, 1, true, true, true)).then(respondProof(1, true))
    .expect(s.challenges.get(1).spent and s.requests.get(1).response == "409" and s.attestations.get(1) == 0 and invariant)
  run evmClaimCannotIssueSolanaChallengeTest = init.then(configure("evm")).then(beginIssue(1, 1, 1)).then(issueOwner(1)).then(respondIssue(1))
    .expect(s.issues.get(1).response == "409" and not(s.challenges.get(1).exists) and invariant)
  run offCurveClaimIsNotProvableBySignatureTest = init.then(configure("off-curve")).then(beginIssue(1, 1, 1)).then(issueOwner(1)).then(respondIssue(1))
    .expect(published(1) == "not-provable-by-signature" and s.issues.get(1).response == "409" and invariant)
  run otherActorCannotIssueChallengeTest = ready.then(beginIssue(1, 1, 2)).then(issueOwner(1)).then(respondIssue(1))
    .expect(s.issues.get(1).response == "404" and invariant)
  run existingAttestationReturnsBeforeSubmittedBodyValidationTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(recorded(1))
    .then(beginProof(2, 1, 1, 0, false, false, false, false)).then(proofOwner(2)).then(proofExisting(2)).then(respondProof(2, true))
    .expect(s.requests.get(2).response == "200" and s.audits.get(1) == 1 and invariant)
  run existingProofDoesNotIssueAnotherChallengeTest = ready.then(issued(1, 1)).then(verified(1, 1, 1)).then(recorded(1))
    .then(beginIssue(2, 1, 1)).then(issueOwner(2)).then(issueExisting(2)).then(respondIssue(2))
    .expect(s.issues.get(2).response == "200" and not(s.challenges.get(2).exists) and invariant)
}
