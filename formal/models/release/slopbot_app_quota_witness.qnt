// @source .github/workflows/value-intake-quota.yml
// @source scripts/inspect-slopbot-app-quota.ts
// @evidence scripts/inspect-slopbot-app-quota.test.ts
// One protected manual observation and one GitHub installation grant. The
// registry SHA, immutable primary repository, App ID, membership, optional
// reviewed commit file read in the workflow repository and coherent quota
// windows are abstract validation results. Metadata-only remains the normal
// mode. GitHub owns the token
// and its expiration. A lost mint response or cancelled invocation can leave
// a scoped token live until expiry. Only an observed 204 permits the receipt.
// This does not model provider correctness, time units or hosted permissions.
module slopbot_app_quota_witness {
  var s: { phase: str, authorized: bool, grant: str, scope: str,
    commitRequested: bool, commitVerified: bool, verified: bool, revoked204: bool, artifact: bool }

  action init = s' = { phase: "queued", authorized: false, grant: "none", scope: "none",
    commitRequested: false, commitVerified: false, verified: false, revoked204: false, artifact: false }

  action begin(main: bool, manual: bool, exact: bool, protected: bool, bound: bool,
    commitRequested: bool, workflowRepository: bool): bool = {
    val allowed = main and manual and exact and protected and bound and
      (not(commitRequested) or workflowRepository)
    all {
      s.phase == "queued",
      s' = s.with("authorized", allowed).with("commitRequested", commitRequested)
        .with("phase", if (allowed) "mint" else "done"),
    }
  }

  val requiredScope = if (s.commitRequested) "metadata-and-contents-read" else "metadata-read"

  action issue(outcome: str): bool = {
    val scopeMatches = outcome == requiredScope
    val grantReceived = outcome.in(Set("metadata-read", "metadata-and-contents-read", "wrong-grant"))
    all {
      s.phase == "mint",
      outcome.in(Set("metadata-read", "metadata-and-contents-read", "wrong-grant", "refused", "unknown")),
      s' = s.with("grant", if (scopeMatches) "scoped" else if (grantReceived) "wrong-grant"
          else if (outcome == "refused") "none" else "unknown")
        .with("scope", if (scopeMatches) outcome else "none")
        .with("phase", if (scopeMatches) "read" else if (grantReceived) "cleanup" else "done")
    }
  }

  action observe(validQuota: bool, exactCommit: bool): bool = all {
    s.phase == "read", s.grant == "scoped",
    s' = s.with("commitVerified", s.commitRequested and exactCommit)
      .with("verified", validQuota and (not(s.commitRequested) or exactCommit))
      .with("phase", "cleanup")
  }

  action cleanup(confirmed: bool): bool = all {
    s.phase == "cleanup",
    s' = s.with("grant", if (confirmed) "revoked" else "unknown")
      .with("revoked204", confirmed).with("phase", if (confirmed and s.verified) "output" else "done")
  }

  action writeReceipt = all {
    s.phase == "output", s.authorized, s.scope == requiredScope, s.verified, s.revoked204,
    s' = s.with("artifact", true).with("phase", "done")
  }

  action cancel = all {
    s.phase.in(Set("mint", "read", "cleanup", "output")),
    s' = s.with("phase", "done")
      .with("grant", if (s.phase == "output") "revoked" else "unknown")
  }

  action expire = all {
    s.phase == "done", s.grant == "unknown",
    s' = s.with("grant", "expired")
  }

  action step = {
    nondet eligible = Set(false, true).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet commitRequested = Set(false, true).oneOf()
    nondet exactCommit = Set(false, true).oneOf()
    nondet response = Set("metadata-read", "metadata-and-contents-read", "wrong-grant", "refused", "unknown").oneOf()
    any {
      begin(eligible, true, true, true, true, commitRequested, true),
      begin(true, eligible, true, true, true, commitRequested, true),
      begin(true, true, eligible, true, true, commitRequested, true),
      begin(true, true, true, eligible, true, commitRequested, true),
      begin(true, true, true, true, eligible, commitRequested, true),
      begin(true, true, true, true, true, commitRequested, eligible),
      issue(response), observe(valid, exactCommit), cleanup(valid), writeReceipt, cancel, expire, s' = s
    }
  }

  val invariant = all {
    s.artifact implies (s.authorized and s.scope == requiredScope and s.verified and s.revoked204 and s.grant == "revoked"),
    s.verified implies (s.authorized and s.scope == requiredScope and (not(s.commitRequested) or s.commitVerified)),
    s.commitVerified implies s.commitRequested,
    s.revoked204 implies s.grant == "revoked",
    not(s.authorized) implies s.grant == "none",
    s.grant.in(Set("unknown", "expired")) implies not(s.artifact)
  }

  action admitted = begin(true, true, true, true, true, false, true)
  action admittedCommit = begin(true, true, true, true, true, true, true)
  action observed = admitted.then(issue("metadata-read")).then(observe(true, false))

  run verifiedGrantRevokesBeforeReceiptTest = init.then(observed).then(cleanup(true)).then(writeReceipt)
    .expect(s.artifact and s.revoked204 and invariant)
  run nonMainCannotMintTest = init.then(begin(false, true, true, true, true, false, true))
    .expect(not(s.authorized) and s.grant == "none" and invariant)
  run wrongRepositoryCannotMintContentsGrantTest = init.then(begin(true, true, true, true, true, true, false))
    .expect(not(s.authorized) and s.grant == "none" and invariant)
  run defaultCanReadAnotherRegisteredRepositoryTest = init.then(begin(true, true, true, true, true, false, false))
    .then(issue("metadata-read")).then(observe(true, false)).then(cleanup(true)).then(writeReceipt)
    .expect(s.artifact and s.revoked204 and invariant)
  run invalidQuotaStillRevokesWithoutReceiptTest = init.then(admitted).then(issue("metadata-read")).then(observe(false, false)).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run unexpectedPermissionsStillRevokeTest = init.then(admitted).then(issue("wrong-grant")).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run optionalCommitUsesExactReadOnlyGrantTest = init.then(admittedCommit).then(issue("metadata-and-contents-read"))
    .then(observe(true, true)).then(cleanup(true)).then(writeReceipt)
    .expect(s.artifact and s.commitVerified and invariant)
  run missingCommitStillRevokesWithoutReceiptTest = init.then(admittedCommit).then(issue("metadata-and-contents-read"))
    .then(observe(true, false)).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run defaultRefusesContentsGrantTest = init.then(admitted).then(issue("metadata-and-contents-read")).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run revokeRefusalCannotPublishTest = init.then(observed).then(cleanup(false)).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
  run lostMintResponseExpiresWithoutReceiptTest = init.then(admitted).then(issue("unknown")).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
  run cancellationMayLeaveGrantUntilExpiryTest = init.then(observed).then(cancel).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
}
