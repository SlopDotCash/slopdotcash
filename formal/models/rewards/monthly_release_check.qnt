// @source workers/payment-executor/monthly-release.ts
// @source contracts/solana/wallet-transactions.ts
// @source contracts/evm/adapter.ts
// @evidence contracts/evm/monthly-reserve.integration.ts
// @evidence contracts/solana/integration/escrow.e2e.mjs
// One retained ready plan, one project/month/network/owner, two check attempts,
// two manifest/deployment identities, receipt/finality block classes 1 and 2.
// Pages owns GitHub admission. Worker recovery accepts a new current manifest
// hash only when the retained deployment is byte-identical; it does not rerun
// retained-allocation collection or prepare's manifest/revision equality rule.
//
// EVM binds exact owner/from/to/calldata/zero value, canonical receipt, finalized
// height and reviewed code at the receipt block. Solana first verifies current
// deployment and the owner's exact message signature, then finalized status,
// matching slot and exact wire bytes. It uses no separate getBlock call here.
// Schema/crypto/code checks are input predicates. No action signs, broadcasts,
// mutates an allocation or claims continuous registry authority after awaits.
module monthly_release_check {
  val identities = Set(1, 2)
  type State = { phase: str, attempt: int, rail: str, planKnown: bool, requestMatches: bool,
    requestedManifest: int, currentManifest: int, currentDeployment: int, projectExists: bool,
    projectObserved: bool, receiptBlock: int, receiptStatus: str, statusError: bool,
    exactTransaction: bool, canonicalReceipt: bool, receiptDeployment: bool,
    exactSignature: bool, exactWire: bool, result: str, delivered: bool, observed: str }
  var s: State
  action init = s' = { phase: "idle", attempt: 0, rail: "evm", planKnown: true, requestMatches: true,
    requestedManifest: 1, currentManifest: 1, currentDeployment: 1, projectExists: true,
    projectObserved: false, receiptBlock: 1, receiptStatus: "success", statusError: false,
    exactTransaction: false, canonicalReceipt: false, receiptDeployment: false,
    exactSignature: false, exactWire: false, result: "none", delivered: false, observed: "none" }
  def answer(result: str): State = s.with("phase", "reply").with("result", result)
  action configurePlan(rail: str, known: bool): bool = all { s.phase == "idle", s.attempt == 0,
    Set("evm", "solana").contains(rail), s' = s.with("rail", rail).with("planKnown", known) }
  // Initial lookup availability does not represent deletion of immutable history.
  action initialProjectAvailable(available: bool): bool = all { s.phase == "idle", s.attempt == 0,
    s' = s.with("projectExists", available) }
  action changeProject(manifest: int, deployment: int): bool = all { identities.contains(manifest), identities.contains(deployment),
    deployment == s.currentDeployment or manifest != s.currentManifest,
    s' = s.with("currentManifest", manifest).with("currentDeployment", deployment) }
  action begin(manifest: int, requestMatches: bool): bool = all { Set("idle", "done").contains(s.phase), s.attempt < 2, identities.contains(manifest),
    s' = s.with("attempt", s.attempt + 1).with("requestedManifest", manifest).with("requestMatches", requestMatches)
      .with("projectObserved", false).with("exactTransaction", false).with("canonicalReceipt", false)
      .with("receiptDeployment", false).with("exactSignature", false).with("exactWire", false)
      .with("result", "none").with("observed", "none").with("delivered", false).with("phase", "plan") }
  action plan = all { s.phase == "plan",
    s' = if (s.planKnown and s.requestMatches) s.with("phase", "project") else answer("request-error") }
  action project = all { s.phase == "project",
    s' = if (s.projectExists and s.currentManifest == s.requestedManifest and s.currentDeployment == 1)
      s.with("projectObserved", true).with("phase", "config") else answer("project-error") }
  action config(verified: bool): bool = all { s.phase == "config",
    s' = if (not(verified)) answer("deployment-error")
      else s.with("phase", if (s.rail == "evm") "evm-receipt" else "solana-signature") }
  action evmReceipt(present: bool, block: int, status: str): bool = all { s.phase == "evm-receipt", identities.contains(block),
    Set("success", "failed", "unknown").contains(status),
    s' = if (not(present)) answer("pending") else s.with("receiptBlock", block).with("receiptStatus", status).with("phase", "evm-transaction") }
  action evmTransaction(kind: str): bool = all { s.phase == "evm-transaction",
    Set("exact", "missing", "wrong-owner", "wrong-vault", "wrong-data", "wrong-value", "wrong-receipt-position").contains(kind),
    s' = if (kind == "exact") s.with("exactTransaction", true).with("phase", "evm-finality") else answer("transaction-error") }
  action evmFinality(through: int): bool = all { s.phase == "evm-finality", identities.contains(through),
    s' = if (s.receiptBlock > through) answer("pending") else s.with("phase", "evm-canonical") }
  action evmCanonical(matches: bool): bool = all { s.phase == "evm-canonical",
    s' = if (matches) s.with("canonicalReceipt", true).with("phase", "evm-code") else answer("canonical-error") }
  action evmCode(reviewed: bool): bool = all { s.phase == "evm-code",
    s' = if (reviewed) s.with("receiptDeployment", true).with("phase", "evm-status") else answer("deployment-error") }
  action evmStatus = all { s.phase == "evm-status",
    s' = answer(if (s.receiptStatus == "success") "finalized" else if (s.receiptStatus == "failed") "failed" else "status-error") }
  action solanaSignature(exact: bool): bool = all { s.phase == "solana-signature",
    s' = if (exact) s.with("exactSignature", true).with("phase", "solana-status") else answer("signature-error") }
  action solanaStatus(kind: str, statusError: bool): bool = all { s.phase == "solana-status",
    Set("absent", "unfinalized", "finalized").contains(kind),
    s' = if (kind != "finalized") answer("pending") else s.with("statusError", statusError).with("phase", "solana-receipt") }
  action solanaReceipt(present: bool, exactWire: bool, sameSlot: bool, receiptError: bool): bool = all {
    s.phase == "solana-receipt",
    s' = if (not(present)) answer("pending")
      else if (not(exactWire) or not(sameSlot)) answer("transaction-error")
      else s.with("exactWire", true).with("result", if (receiptError) "failed" else if (s.statusError) "status-error" else "finalized").with("phase", "reply") }
  action deliver(received: bool): bool = all { s.phase == "reply",
    s' = s.with("phase", "done").with("delivered", received).with("observed", if (received) s.result else "unknown") }
  action operationError = all { not(Set("idle", "done", "reply").contains(s.phase)), s' = answer("unavailable") }
  action step = {
    nondet first = identities.oneOf()
    nondet second = identities.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet fourth = Set(false, true).oneOf()
    nondet rail = Set("evm", "solana").oneOf()
    nondet status = Set("success", "failed", "unknown").oneOf()
    nondet kind = Set("exact", "missing", "wrong-owner", "wrong-vault", "wrong-data", "wrong-value", "wrong-receipt-position").oneOf()
    nondet solana = Set("absent", "unfinalized", "finalized").oneOf()
    any { configurePlan(rail, yes), initialProjectAvailable(yes), changeProject(first, second), begin(first, yes), plan, project, config(yes),
      evmReceipt(yes, first, status), evmTransaction(kind), evmFinality(first), evmCanonical(yes), evmCode(yes), evmStatus,
      solanaSignature(yes), solanaStatus(solana, yes), solanaReceipt(yes, other, third, fourth), deliver(yes), operationError, s' = s }
  }
  val invariant = all { s.attempt <= 2,
    Set("finalized", "failed").contains(s.result) implies s.projectObserved,
    s.rail == "evm" and Set("finalized", "failed").contains(s.result)
      implies s.exactTransaction and s.canonicalReceipt and s.receiptDeployment,
    s.rail == "solana" and Set("finalized", "failed").contains(s.result)
      implies s.exactSignature and s.exactWire,
    not(s.delivered) and s.phase == "done" implies s.observed == "unknown" }
  action started = begin(1, true).then(plan).then(project).then(config(true))
  action exactEvm(status: str): bool = evmReceipt(true, 1, status).then(evmTransaction("exact"))
    .then(evmFinality(2)).then(evmCanonical(true)).then(evmCode(true)).then(evmStatus)
  run currentEvmReleaseFinalizesTest = init.then(started).then(exactEvm("success")).then(deliver(true))
    .expect(s.observed == "finalized" and invariant)
  run absentProjectLookupRefusesBeforeRpcTest = init.then(initialProjectAvailable(false)).then(begin(1, true)).then(plan).then(project)
    .expect(s.result == "project-error" and not(s.projectObserved) and invariant)
  run currentManifestMayDifferFromPreparedManifestTest = init.then(changeProject(2, 1)).then(begin(2, true))
    .then(plan).then(project).then(config(true)).then(exactEvm("success"))
    .expect(s.result == "finalized" and s.projectObserved and invariant)
  run changedDeploymentRefusesRecoveryTest = init.then(changeProject(2, 2)).then(begin(2, true)).then(plan).then(project)
    .expect(s.result == "project-error" and invariant)
  run wrongRequestIdentityRefusesBeforeRpcTest = init.then(begin(1, false)).then(plan)
    .expect(s.result == "request-error" and not(s.projectObserved) and invariant)
  run absentEvmReceiptRemainsPendingTest = init.then(started).then(evmReceipt(false, 1, "success"))
    .expect(s.result == "pending" and not(s.exactTransaction) and invariant)
  run wrongOwnerRefusesBeforeFinalityTest = init.then(started).then(evmReceipt(true, 1, "success")).then(evmTransaction("wrong-owner"))
    .expect(s.result == "transaction-error" and invariant)
  run wrongCalldataRefusesBeforeFinalityTest = init.then(started).then(evmReceipt(true, 1, "success")).then(evmTransaction("wrong-data"))
    .expect(s.result == "transaction-error" and invariant)
  run unfinalizedMatchingReceiptRemainsPendingTest = init.then(started).then(evmReceipt(true, 2, "success"))
    .then(evmTransaction("exact")).then(evmFinality(1)).expect(s.result == "pending" and not(s.canonicalReceipt) and invariant)
  run noncanonicalReceiptNeverFinalizesTest = init.then(started).then(evmReceipt(true, 1, "success"))
    .then(evmTransaction("exact")).then(evmFinality(2)).then(evmCanonical(false)).expect(s.result == "canonical-error" and invariant)
  run unreviewedReceiptCodeNeverFinalizesTest = init.then(started).then(evmReceipt(true, 1, "success"))
    .then(evmTransaction("exact")).then(evmFinality(2)).then(evmCanonical(true)).then(evmCode(false))
    .expect(s.result == "deployment-error" and invariant)
  run canonicalFailedEvmExecutionIsFailedTest = init.then(started).then(exactEvm("failed"))
    .expect(s.result == "failed" and invariant)
  run unknownEvmStatusNeverCountsAsFailureProofTest = init.then(started).then(exactEvm("unknown"))
    .expect(s.result == "status-error" and invariant)
  run wrongSolanaSignatureRefusesBeforeStatusTest = init.then(configurePlan("solana", true)).then(started).then(solanaSignature(false))
    .expect(s.result == "signature-error" and invariant)
  run absentSolanaStatusRemainsPendingTest = init.then(configurePlan("solana", true)).then(started).then(solanaSignature(true))
    .then(solanaStatus("absent", false)).expect(s.result == "pending" and invariant)
  run finalizedSolanaStatusWithMissingReceiptRemainsPendingTest = init.then(configurePlan("solana", true)).then(started)
    .then(solanaSignature(true)).then(solanaStatus("finalized", false)).then(solanaReceipt(false, true, true, false))
    .expect(s.result == "pending" and invariant)
  run changedSolanaWireRefusesTest = init.then(configurePlan("solana", true)).then(started)
    .then(solanaSignature(true)).then(solanaStatus("finalized", false)).then(solanaReceipt(true, false, true, false))
    .expect(s.result == "transaction-error" and invariant)
  run solanaStatusReceiptDisagreementRefusesSuccessTest = init.then(configurePlan("solana", true)).then(started)
    .then(solanaSignature(true)).then(solanaStatus("finalized", true)).then(solanaReceipt(true, true, true, false))
    .expect(s.result == "status-error" and invariant)
  run exactFailedSolanaReceiptReturnsFailureTest = init.then(configurePlan("solana", true)).then(started)
    .then(solanaSignature(true)).then(solanaStatus("finalized", false)).then(solanaReceipt(true, true, true, true))
    .expect(s.result == "failed" and invariant)
  run lateRegistryChangeDoesNotRewriteCapturedCheckTest = init.then(started).then(changeProject(2, 1)).then(exactEvm("success"))
    .expect(s.result == "finalized" and s.currentManifest != s.requestedManifest and invariant)
  run lostResponseDoesNotProveReleaseToBrowserTest = init.then(started).then(exactEvm("success")).then(deliver(false))
    .expect(s.result == "finalized" and s.observed == "unknown" and invariant)
}
