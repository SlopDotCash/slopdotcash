// @source migrations/0014_direct_payments.sql
// @source scripts/check-direct-payment-disclosures.ts
// @source scripts/prepare-payments-import.ts
// Historical disclosure validates reproduced arithmetic and explicit anomalies;
// it is not a new capped allocation or proof of chain finality. Two one-weight
// actors, cap=3 base units, denominator=2: legacy half-up yields 2+2 and records
// over-cap=1. Source signatures and actor rows remain unique.
module historical_disclosure {
  type S = { sourceVerified: bool, rows: Set[int], signatures: Set[int],
    allocated: int, observed: int, anomaly: bool, published: bool, verifiedPaid: bool }
  var s: S
  action init = s' = { sourceVerified: false, rows: Set(), signatures: Set(),
    allocated: 0, observed: 0, anomaly: false, published: false, verifiedPaid: false }
  action verifySource(matches: bool): bool = all { matches, not(s.published), s' = s.with("sourceVerified", true) }
  action observedRow(actor: int, signature: int, recipientMatches: bool, anomalyRecorded: bool): bool = all {
    s.sourceVerified, not(s.published), not(s.rows.contains(actor)),
    not(s.signatures.contains(signature)), recipientMatches or anomalyRecorded,
    s' = s.with("rows", s.rows.union(Set(actor))).with("signatures", s.signatures.union(Set(signature)))
      .with("allocated", s.allocated + 2).with("observed", s.observed + 2)
      .with("anomaly", s.anomaly or not(recipientMatches)) }
  action publish(overCap: int, total: int): bool = all { s.rows == Set(1, 2),
    overCap == s.allocated - 3, total == s.observed, s' = s.with("published", true) }
  action rowChoices = { nondet actor = Set(1, 2).oneOf() nondet signature = Set(1, 2).oneOf()
    nondet matches = Set(true, false).oneOf() nondet recorded = Set(true, false).oneOf()
    observedRow(actor, signature, matches, recorded) }
  action step = any { verifySource(true), rowChoices, publish(1, 4), publish(0, 4), s' = s }
  val invariant = all { s.allocated == s.rows.size() * 2,
    s.rows.size() == s.signatures.size(), s.published implies s.sourceVerified and s.allocated == 4,
    not(s.verifiedPaid) }
  run legacyRoundingDisclosedTest = init.then(verifySource(true))
    .then(observedRow(1, 1, true, false)).then(observedRow(2, 2, true, false))
    .then(publish(1, 4)).expect(s.published and not(s.verifiedPaid) and invariant)
  run duplicateSignatureRefusedTest = init.then(verifySource(true))
    .then(observedRow(1, 1, true, false)).then(observedRow(2, 1, true, false).fail())
  run unrecordedWalletAnomalyRefusedTest = init.then(verifySource(true))
    .then(observedRow(1, 1, false, false).fail())
  run explicitAnomalyDoesNotAuthorizeTest = init.then(verifySource(true))
    .then(observedRow(1, 1, false, true)).expect(s.anomaly and not(s.verifiedPaid) and invariant)
}
