// @source workers/payment-executor/monthly-release.ts
// @source backend/payments/monthly-reserve-release.ts
// @source contracts/evm/monthly-reserve.ts
// @source contracts/solana/monthly-reserve.ts
// @source contracts/solana/wallet-transactions.ts
// @evidence contracts/evm/monthly-reserve.integration.ts
// @evidence contracts/solana/integration/escrow.e2e.mjs
// Pages supplies an already admitted owner request. This worker does not look
// up GitHub authority. One project/month/network, two retained candidates,
// two sequential requests, two registry revisions/retained captures and two
// authority/message identities are represented. Cryptography, exact sum-tree
// bytes and deployment verification are checked predicates, not proved here.
//
// An EVM inspection reads one canonical finalized block even if latest state
// advances; Solana also compares the later project/month bytes with its first
// batched snapshot. Each builder reinspects before accepting the attestation.
// The two unchanged() calls are ordered project/read-allocation observations,
// not atomic global snapshots. A signature or saved plan can survive a lost
// reply or a later refusal. No action broadcasts or releases reserve funds.
module monthly_release_prepare {
  val identities = Set(1, 2)
  val digestKeys = Set(1, 2, 3, 4)
  type State = { phase: str, attempt: int, rail: str, requestedHash: int,
    exists: bool, manifest: int, revision: int, deployment: int, retained: int,
    profile: str, capturedManifest: int, capturedRevision: int, capturedDeployment: int,
    capturedRetained: int, capturedProfile: str, candidate: int,
    chain: str, term: int, authority: int, canonical: bool,
    snapshotChain: str, snapshotTerm: int, snapshotAuthority: int, building: bool,
    fence: str, attestationKey: int, returnedSignatureValid: bool,
    intentJournal: Set[int], signatureJournal: Set[int], externalSignatures: Set[int],
    admittedKeys: Set[int], simulationPassed: bool, approvedPlans: Set[int],
    savedPlans: Set[int], returnedPlans: Set[int], outcome: str }
  var s: State
  pure def key(term: int, authority: int): int = (term - 1) * 2 + authority
  def done(outcome: str): State = s.with("phase", "done").with("outcome", outcome)
  action init = s' = { phase: "idle", attempt: 0, rail: "evm", requestedHash: 1,
    exists: true, manifest: 1, revision: 1, deployment: 1, retained: 1, profile: "eligible",
    capturedManifest: 0, capturedRevision: 0, capturedDeployment: 0, capturedRetained: 0,
    capturedProfile: "none", candidate: 1, chain: "wrong-sum", term: 1, authority: 1,
    canonical: true, snapshotChain: "none", snapshotTerm: 0, snapshotAuthority: 0,
    building: false, fence: "none", attestationKey: 0, returnedSignatureValid: false,
    intentJournal: Set(), signatureJournal: Set(), externalSignatures: Set(), admittedKeys: Set(),
    simulationPassed: false, approvedPlans: Set(), savedPlans: Set(), returnedPlans: Set(), outcome: "none" }
  action chooseProfile(profile: str): bool = all { Set("idle", "done").contains(s.phase),
    Set("none", "legacy", "alternate", "wrong-deployment", "eligible").contains(profile),
    s' = s.with("profile", profile) }
  // Initial lookup availability is an input class, not deletion of a registry row.
  action initialProjectAvailable(available: bool): bool = all { s.phase == "idle", s.attempt == 0,
    s' = s.with("exists", available) }
  action changeProject(manifest: int, revision: int, deployment: int): bool = all {
    identities.contains(manifest), identities.contains(revision), identities.contains(deployment),
    revision >= s.revision, deployment == s.deployment or manifest != s.manifest,
    manifest == s.manifest or revision > s.revision,
    s' = s.with("manifest", manifest).with("revision", revision).with("deployment", deployment) }
  action changeRetained = all { s.retained == 1, s' = s.with("retained", 2) }
  action changeChain(kind: str, term: int, authority: int): bool = all {
    Set("wrong-sum", "healthy", "touched", "mismatch", "unavailable").contains(kind),
    identities.contains(term), identities.contains(authority),
    s' = s.with("chain", kind).with("term", term).with("authority", authority) }
  action begin(rail: str, requestedHash: int): bool = all {
    Set("idle", "done").contains(s.phase), s.attempt < 2, Set("evm", "solana").contains(rail), identities.contains(requestedHash),
    s' = s.with("phase", "project").with("attempt", s.attempt + 1).with("rail", rail)
      .with("requestedHash", requestedHash).with("outcome", "none").with("building", false)
      .with("simulationPassed", false).with("candidate", 1).with("attestationKey", 0) }
  action project = all { s.phase == "project",
    s' = if (not(s.exists) or s.manifest != s.requestedHash) done("project-error")
      else s.with("capturedManifest", s.manifest).with("capturedRevision", s.revision)
        .with("capturedDeployment", s.deployment).with("phase", "pin") }
  action pin(matches: bool): bool = all { s.phase == "pin",
    s' = if (matches) s.with("phase", "retained") else done("pin-error") }
  action readPlans = all { s.phase == "retained",
    s' = s.with("capturedRetained", s.retained).with("capturedProfile", s.profile)
      .with("phase", if (s.profile == "none") "done" else "candidate")
      .with("outcome", if (s.profile == "none") "allocation-unavailable" else "none") }
  def nextCandidate: State = if (s.capturedProfile == "alternate" and s.candidate == 1)
    s.with("candidate", 2).with("phase", "candidate") else done("allocation-mismatch")
  action candidate = all { s.phase == "candidate",
    s' = if (s.capturedProfile == "wrong-deployment") done("deployment-error")
      else if (s.rail == "evm" and s.capturedProfile == "legacy") nextCandidate
      else s.with("phase", "inspect").with("building", false) }
  action takeSnapshot = all { Set("inspect", "build-inspect").contains(s.phase),
    s' = s.with("building", s.phase == "build-inspect").with("snapshotChain",
      if (s.chain == "unavailable") "unavailable"
      else if (s.capturedProfile == "alternate" and s.candidate == 1) "mismatch" else s.chain)
      .with("snapshotTerm", s.term).with("snapshotAuthority", s.authority).with("phase", "snapshot-check") }
  action snapshotCheck = {
    val stable = s.canonical and (s.rail == "evm" or
      (s.snapshotChain == s.chain and s.snapshotTerm == s.term and s.snapshotAuthority == s.authority))
    all { s.phase == "snapshot-check",
      s' = if (s.snapshotChain == "unavailable") done("evidence-error")
        else if (s.snapshotChain != "wrong-sum")
          if (s.building) done("builder-refused")
          else if (s.snapshotChain == "mismatch") nextCandidate else done("held")
        else if (not(stable)) done("evidence-error")
        else if (s.building) s.with("phase", "builder-signature")
        else s.with("attestationKey", key(s.snapshotTerm, s.snapshotAuthority))
          .with("admittedKeys", s.admittedKeys.union(Set(key(s.snapshotTerm, s.snapshotAuthority))))
          .with("fence", "sign").with("phase", "fence-project") }
  }
  action fenceProject = all { s.phase == "fence-project",
    s' = if (not(s.exists) or s.manifest != s.capturedManifest or s.revision != s.capturedRevision)
      done("project-changed") else s.with("phase", "fence-retained") }
  action fenceRetained = all { s.phase == "fence-retained",
    s' = if (s.retained != s.capturedRetained) done("allocation-changed")
      else s.with("phase", if (s.fence == "sign") "journal-read" else "plan-write") }
  action journalRead = all { s.phase == "journal-read",
    s' = if (s.signatureJournal.contains(s.attestationKey))
      s.with("returnedSignatureValid", true).with("phase", "verify-signature")
      else s.with("phase", if (s.intentJournal.contains(s.attestationKey)) "sign" else "intent-write") }
  action intentWrite = all { s.phase == "intent-write",
    s' = s.with("intentJournal", s.intentJournal.union(Set(s.attestationKey))).with("phase", "intent-reply") }
  action intentReply(delivered: bool): bool = all { s.phase == "intent-reply",
    s' = if (delivered) s.with("phase", "sign") else done("journal-error") }
  action signing = all { s.phase == "sign", s' = s.with("phase", "sign-reply") }
  action signReply(delivered: bool, valid: bool): bool = all { s.phase == "sign-reply",
    s' = if (not(delivered)) done("sign-error").with("externalSignatures", s.externalSignatures.union(Set(s.attestationKey)))
      else s.with("externalSignatures", s.externalSignatures.union(Set(s.attestationKey)))
        .with("returnedSignatureValid", valid).with("phase", "verify-signature") }
  action verifySignature = all { s.phase == "verify-signature",
    s' = if (s.returnedSignatureValid) s.with("phase", "signature-write") else done("signature-error") }
  action signatureWrite = all { s.phase == "signature-write",
    s' = s.with("signatureJournal", s.signatureJournal.union(Set(s.attestationKey))).with("phase", "signature-reply") }
  action signatureReply(delivered: bool): bool = all { s.phase == "signature-reply",
    s' = if (delivered) s.with("phase", "build-inspect") else done("journal-error") }
  action builderSignature = all { s.phase == "builder-signature",
    s' = if (key(s.snapshotTerm, s.snapshotAuthority) == s.attestationKey)
      s.with("phase", "simulate") else done("authority-or-message-changed") }
  action simulate(succeeds: bool): bool = all { s.phase == "simulate",
    s' = if (succeeds) s.with("simulationPassed", true).with("fence", "return").with("phase", "fence-project")
      else done("simulation-refused") }
  action planWrite = all { s.phase == "plan-write", s.simulationPassed,
    s' = s.with("approvedPlans", s.approvedPlans.union(Set(s.attempt)))
      .with("savedPlans", s.savedPlans.union(Set(s.attempt))).with("phase", "plan-reply") }
  action planReply(delivered: bool): bool = all { s.phase == "plan-reply",
    s' = if (delivered) done("ready").with("returnedPlans", s.returnedPlans.union(Set(s.attempt))) else done("plan-write-error") }
  action operationError = all { not(Set("idle", "done").contains(s.phase)), s' = done("operation-error") }
  action step = {
    nondet one = identities.oneOf()
    nondet two = identities.oneOf()
    nondet three = identities.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet rail = Set("evm", "solana").oneOf()
    nondet kind = Set("wrong-sum", "healthy", "touched", "mismatch", "unavailable").oneOf()
    nondet profile = Set("none", "legacy", "alternate", "wrong-deployment", "eligible").oneOf()
    any { chooseProfile(profile), initialProjectAvailable(yes), changeProject(one, two, three), changeRetained, changeChain(kind, one, two),
      begin(rail, one), project, pin(yes), readPlans, candidate, takeSnapshot, snapshotCheck,
      fenceProject, fenceRetained, journalRead, intentWrite, intentReply(yes), signing, signReply(yes, other),
      verifySignature, signatureWrite, signatureReply(yes), builderSignature, simulate(yes), planWrite, planReply(yes), operationError,
      s' = s.with("canonical", yes), s' = s }
  }
  val invariant = all { s.attempt <= 2, s.candidate <= 2,
    s.intentJournal.subseteq(digestKeys), s.signatureJournal.subseteq(s.admittedKeys),
    s.externalSignatures.subseteq(s.admittedKeys), s.returnedPlans.subseteq(s.savedPlans),
    s.savedPlans.subseteq(s.approvedPlans), s.outcome == "ready" implies s.returnedPlans.contains(s.attempt) }
  action inspection = project.then(pin(true)).then(readPlans).then(candidate).then(takeSnapshot).then(snapshotCheck)
  action signReady = inspection.then(fenceProject).then(fenceRetained).then(journalRead)
  action freshSignature = intentWrite.then(intentReply(true)).then(signing).then(signReply(true, true))
    .then(verifySignature).then(signatureWrite).then(signatureReply(true))
  action built = takeSnapshot.then(snapshotCheck).then(builderSignature).then(simulate(true))
  action ready = begin("evm", 1).then(signReady).then(freshSignature).then(built)
    .then(fenceProject).then(fenceRetained).then(planWrite).then(planReply(true))
  run currentWrongSumBuildsOnlyOwnerPlanTest = init.then(ready).expect(s.outcome == "ready" and invariant)
  run absentProjectLookupNeverSignsTest = init.then(initialProjectAvailable(false)).then(begin("evm", 1)).then(project)
    .expect(s.outcome == "project-error" and s.externalSignatures == Set() and invariant)
  run missingAllocationNeverSignsTest = init.then(chooseProfile("none")).then(begin("evm", 1)).then(project).then(pin(true)).then(readPlans)
    .expect(s.outcome == "allocation-unavailable" and s.externalSignatures == Set() and invariant)
  run healthyReserveNeverSignsTest = init.then(changeChain("healthy", 1, 1)).then(begin("evm", 1)).then(inspection)
    .expect(s.outcome == "held" and s.externalSignatures == Set() and invariant)
  run touchedReserveNeverSignsTest = init.then(changeChain("touched", 1, 1)).then(begin("evm", 1)).then(inspection)
    .expect(s.outcome == "held" and invariant)
  run legacyEvmCandidateCannotAuthorizeRepairTest = init.then(chooseProfile("legacy")).then(begin("evm", 1))
    .then(project).then(pin(true)).then(readPlans).then(candidate).expect(s.outcome == "allocation-mismatch" and invariant)
  run alternateRetainedCandidateCanMatchTest = init.then(chooseProfile("alternate")).then(begin("evm", 1))
    .then(inspection).then(candidate).then(takeSnapshot).then(snapshotCheck)
    .expect(s.candidate == 2 and s.phase == "fence-project" and invariant)
  run unavailableFirstCandidateCannotSkipToAlternativeTest = init.then(chooseProfile("alternate"))
    .then(changeChain("unavailable", 1, 1)).then(begin("evm", 1)).then(inspection)
    .expect(s.outcome == "evidence-error" and s.candidate == 1 and invariant)
  run projectChangeBeforeSigningRefusesTest = init.then(begin("evm", 1)).then(inspection).then(changeProject(2, 2, 1)).then(fenceProject)
    .expect(s.outcome == "project-changed" and s.externalSignatures == Set() and invariant)
  run allocationChangeAfterProjectObservationRefusesTest = init.then(begin("evm", 1)).then(inspection)
    .then(fenceProject).then(changeRetained).then(fenceRetained).expect(s.outcome == "allocation-changed" and invariant)
  run projectFenceIsNotContinuousAuthorityTest = init.then(begin("evm", 1)).then(inspection).then(fenceProject)
    .then(changeProject(2, 2, 1)).then(fenceRetained).then(journalRead).then(freshSignature)
    .expect(s.signatureJournal.contains(1) and s.manifest == 2 and invariant)
  run changedReserveAfterSigningRefusesBuilderTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature)
    .then(changeChain("touched", 1, 1)).then(takeSnapshot).then(snapshotCheck)
    .expect(s.outcome == "builder-refused" and s.signatureJournal.contains(1) and invariant)
  run authorityRotationRefusesRetainedSignatureTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature)
    .then(changeChain("wrong-sum", 1, 2)).then(takeSnapshot).then(snapshotCheck).then(builderSignature)
    .expect(s.outcome == "authority-or-message-changed" and invariant)
  run simulationRefusalRetainsSignatureTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature)
    .then(takeSnapshot).then(snapshotCheck).then(builderSignature).then(simulate(false))
    .expect(s.outcome == "simulation-refused" and s.signatureJournal.contains(1) and invariant)
  run signatureJournalLostReplyIsRetryableTest = init.then(begin("evm", 1)).then(signReady)
    .then(intentWrite).then(intentReply(true)).then(signing).then(signReply(true, true)).then(verifySignature)
    .then(signatureWrite).then(signatureReply(false)).then(begin("evm", 1)).then(signReady)
    .expect(s.phase == "verify-signature" and s.signatureJournal.contains(1) and invariant)
  run failedFinalFenceKeepsSignedEvidenceTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature).then(built)
    .then(changeRetained).then(fenceProject).then(fenceRetained)
    .expect(s.outcome == "allocation-changed" and s.signatureJournal.contains(1) and s.savedPlans == Set() and invariant)
  run lostPlanReplyDoesNotEraseSavedPlanTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature).then(built)
    .then(fenceProject).then(fenceRetained).then(planWrite).then(planReply(false))
    .expect(s.savedPlans == Set(1) and s.returnedPlans == Set() and invariant)
  run evmSnapshotRemainsEvidenceAfterLatestTransitionTest = init.then(begin("evm", 1)).then(project).then(pin(true))
    .then(readPlans).then(candidate).then(takeSnapshot).then(changeChain("touched", 1, 1)).then(snapshotCheck)
    .expect(s.phase == "fence-project" and s.snapshotChain == "wrong-sum" and invariant)
  run solanaSnapshotRequiresMatchingLaterBytesTest = init.then(begin("solana", 1)).then(project).then(pin(true))
    .then(readPlans).then(candidate).then(takeSnapshot).then(changeChain("touched", 1, 1)).then(snapshotCheck)
    .expect(s.outcome == "evidence-error" and invariant)
  run lateProjectChangeAfterFinalObservationRemainsSnapshotTest = init.then(begin("evm", 1)).then(signReady).then(freshSignature).then(built)
    .then(fenceProject).then(fenceRetained).then(changeProject(2, 2, 1)).then(planWrite).then(planReply(true))
    .expect(s.outcome == "ready" and s.manifest != s.capturedManifest and invariant)
}
