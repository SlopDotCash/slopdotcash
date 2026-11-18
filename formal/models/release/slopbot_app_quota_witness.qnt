// @source .github/workflows/value-intake-quota.yml
// @source scripts/inspect-slopbot-app-quota.ts
// @evidence scripts/inspect-slopbot-app-quota.test.ts
// One protected manual observation and one GitHub installation grant. The
// registry SHA, immutable primary repository, App ID, membership and coherent
// live quota windows are abstract validation results. GitHub owns the token
// and its expiration. A lost mint response or cancelled invocation can leave
// a scoped token live until expiry. Only an observed 204 permits the receipt.
// This does not model provider correctness, time units or hosted permissions.
module slopbot_app_quota_witness {
  var s: { phase: str, authorized: bool, grant: str, metadataOnly: bool,
    verified: bool, revoked204: bool, artifact: bool }

  action init = s' = { phase: "queued", authorized: false, grant: "none",
    metadataOnly: false, verified: false, revoked204: false, artifact: false }

  action begin(main: bool, manual: bool, exact: bool, protected: bool, bound: bool): bool = {
    val allowed = main and manual and exact and protected and bound
    all {
      s.phase == "queued",
      s' = s.with("authorized", allowed).with("phase", if (allowed) "mint" else "done"),
    }
  }

  action issue(outcome: str): bool = all {
    s.phase == "mint",
    outcome.in(Set("scoped", "wrong-grant", "refused", "unknown")),
    s' = s.with("grant", if (outcome == "refused") "none" else outcome)
      .with("metadataOnly", outcome == "scoped")
      .with("phase", if (outcome == "scoped") "read" else if (outcome == "wrong-grant") "cleanup" else "done")
  }

  action observe(valid: bool): bool = all {
    s.phase == "read", s.grant == "scoped",
    s' = s.with("verified", valid).with("phase", "cleanup")
  }

  action cleanup(confirmed: bool): bool = all {
    s.phase == "cleanup",
    s' = s.with("grant", if (confirmed) "revoked" else "unknown")
      .with("revoked204", confirmed).with("phase", if (confirmed and s.verified) "output" else "done")
  }

  action writeReceipt = all {
    s.phase == "output", s.authorized, s.metadataOnly, s.verified, s.revoked204,
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
    nondet response = Set("scoped", "wrong-grant", "refused", "unknown").oneOf()
    any {
      begin(eligible, true, true, true, true), begin(true, eligible, true, true, true),
      begin(true, true, eligible, true, true), begin(true, true, true, eligible, true),
      begin(true, true, true, true, eligible),
      issue(response), observe(valid), cleanup(valid), writeReceipt, cancel, expire, s' = s
    }
  }

  val invariant = all {
    s.artifact implies (s.authorized and s.metadataOnly and s.verified and s.revoked204 and s.grant == "revoked"),
    s.verified implies (s.authorized and s.metadataOnly),
    s.revoked204 implies s.grant == "revoked",
    not(s.authorized) implies s.grant == "none",
    s.grant.in(Set("unknown", "expired")) implies not(s.artifact)
  }

  action admitted = begin(true, true, true, true, true)
  action observed = admitted.then(issue("scoped")).then(observe(true))

  run verifiedGrantRevokesBeforeReceiptTest = init.then(observed).then(cleanup(true)).then(writeReceipt)
    .expect(s.artifact and s.revoked204 and invariant)
  run nonMainCannotMintTest = init.then(begin(false, true, true, true, true))
    .expect(not(s.authorized) and s.grant == "none" and invariant)
  run invalidQuotaStillRevokesWithoutReceiptTest = init.then(admitted).then(issue("scoped")).then(observe(false)).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run unexpectedPermissionsStillRevokeTest = init.then(admitted).then(issue("wrong-grant")).then(cleanup(true))
    .expect(s.revoked204 and not(s.artifact) and invariant)
  run revokeRefusalCannotPublishTest = init.then(observed).then(cleanup(false)).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
  run lostMintResponseExpiresWithoutReceiptTest = init.then(admitted).then(issue("unknown")).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
  run cancellationMayLeaveGrantUntilExpiryTest = init.then(observed).then(cancel).then(expire)
    .expect(not(s.revoked204) and s.grant == "expired" and not(s.artifact) and invariant)
}
