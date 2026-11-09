// @source migrations/0003_wallet_claim_registry.sql
// @source migrations/0007_wallet_possession_attestations.sql
// @source migrations/0010_wallet_claim_chain.sql
// @source migrations/0015_wallet_observations.sql
// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source src/lib/wallet-possession.ts
module api_wallet_claims {
  var s: {revision: int, history: List[int], challenge: str, now: int, proof: bool, verifiedSignature: bool, obligation: int}
  action init = s' = {revision: 0, history: List(), challenge: "absent", now: 0, proof: false, verifiedSignature: false, obligation: 1}
  action claim(expected: int): bool = all { expected == s.revision, s.revision < 3,
    s' = s.with("revision", s.revision + 1).with("history", s.history.append(s.revision + 1)).with("proof", false).with("verifiedSignature", false).with("challenge", "absent") }
  action challenge = all { s.revision > 0, s.challenge == "absent", s' = s.with("challenge", "live") }
  // Invalid or mismatched submitted proof burns a live capability, but proves nothing.
  action submitSignature(valid: bool): bool = all { s.challenge == "live", s.now < 3,
    s' = s.with("challenge", "consumed").with("proof", valid).with("verifiedSignature", valid) }
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action step = { nondet expected = 0.to(3).oneOf()
    any { claim(expected), challenge, submitSignature(true), submitSignature(false), tick, s' = s } }
  val invariant = all { s.history.length() == s.revision, s.obligation == 1,
    s.proof implies (s.challenge == "consumed" and s.verifiedSignature),
    s.history.indices().forall(i => s.history.nth(i) == i + 1) }
  run possessionTest = init.then(claim(0)).then(challenge).then(submitSignature(true)).expect(s.proof)
  run invalidProofTest = init.then(claim(0)).then(challenge).then(submitSignature(false)).expect(not(s.proof) and s.challenge == "consumed")
  run expiredChallengeTest = init.then(claim(0)).then(challenge).then(tick).then(tick).then(tick).expect(not(s.proof) and s.now == 3)
}
