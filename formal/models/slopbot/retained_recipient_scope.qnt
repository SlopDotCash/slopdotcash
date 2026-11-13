// @source scripts/retained-commit-credit.ts
// @source workers/slopbot/value-retained-copy.ts
// @evidence scripts/retained-pr-reference.test.ts
// Two original records: an ordinary implementation and a branch-sync merge.
// Recipient lookup may ignore the unclaimed source merge, but it still needs
// complete unique ordinary bindings. Full assessment retains its merge gate.
// Proof predicates abstract the separately tested patch/identity boundaries.
module retained_recipient_scope {
  var s: { selected: bool, ordinaryOnly: bool, ordinaryProof: bool,
    mergeProof: bool, credited: bool }
  action init = s' = { selected: false, ordinaryOnly: false,
    ordinaryProof: false, mergeProof: false, credited: false }
  action inspect(ordinaryOnly: bool, ordinaryProof: bool, mergeProof: bool): bool = all {
    not(s.selected), s' = s.with("selected", true).with("ordinaryOnly", ordinaryOnly)
      .with("ordinaryProof", ordinaryProof).with("mergeProof", mergeProof) }
  action creditOrdinary = all { s.selected, s.ordinaryProof,
    s.ordinaryOnly or s.mergeProof, s' = s.with("credited", true) }
  action step = if (s.selected) any { creditOrdinary, s' = s } else {
    nondet scope = Set(false, true).oneOf()
    nondet ordinary = Set(false, true).oneOf()
    nondet merged = Set(false, true).oneOf()
    inspect(scope, ordinary, merged) }
  val invariant = s.credited implies s.selected and s.ordinaryProof and (s.ordinaryOnly or s.mergeProof)
  run ordinaryRecipientCanIgnoreUnclaimedSyncTest = init.then(inspect(true, true, false))
    .then(creditOrdinary).expect(s.credited and invariant)
  run fullAssessmentStillRequiresMergeProofTest = init.then(inspect(false, true, false))
    .expect(invariant).then(creditOrdinary.fail())
  run missingOrdinaryProofNeverCreditsTest = init.then(inspect(true, false, true))
    .expect(invariant).then(creditOrdinary.fail())
}
