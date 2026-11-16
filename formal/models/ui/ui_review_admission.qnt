// @source src/lib/review-records.ts
// @source src/lib/evaluator-awards.ts
// Reviews are advisory. Receipt joins require matching run/source/head/identity;
// evaluated awards require reviewed manifests and unique canonical work/content.
module ui_review_admission {
  var s: { phase: str, schemaValid: bool, receipt: bool, matches: bool,
    context: bool, reviewed: bool, duplicate: bool, award: int, awardedWithEvidence: bool }
  action init = s' = { phase: "draft", schemaValid: true, receipt: false,
    matches: true, context: false, reviewed: false, duplicate: false, award: 0, awardedWithEvidence: false }
  action malformed = s' = s.with("schemaValid", false).with("phase", "draft")
  action signedReceipt = s' = s.with("receipt", true).with("phase", "draft")
  action immutableContext = s' = s.with("context", true).with("phase", "draft")
  action mismatch = s' = s.with("matches", false).with("phase", "draft")
  action join = s' = s.with("phase", if (s.schemaValid and s.receipt and s.matches and s.context) "advisory" else "error")
  action approveManifest = s' = s.with("reviewed", true)
  action repeatedWork = s' = s.with("duplicate", true)
  action importAward = all { s.reviewed, not(s.duplicate), s.schemaValid,
    s.award == 0, s' = s.with("award", 1).with("awardedWithEvidence", s.reviewed and not(s.duplicate) and s.schemaValid) }
  action step = any { malformed, signedReceipt, immutableContext, mismatch,
    join, approveManifest, repeatedWork, importAward, s' = s }
  val invariant = all { s.award <= 1, s.award >= 0,
    s.award > 0 implies s.awardedWithEvidence,
    s.phase == "advisory" implies s.schemaValid and s.receipt and s.matches and s.context }
  // Admission result is checked at the instant of join; later input mutation
  // represents another record and is not a retroactive receipt revocation.
  run advisoryWithoutAwardTest = init.then(signedReceipt).then(immutableContext).then(join).expect(s.phase == "advisory" and s.award == 0)
  run missingReceiptTest = init.then(immutableContext).then(join).expect(s.phase == "error")
  run staleHeadTest = init.then(signedReceipt).then(immutableContext).then(mismatch).then(join).expect(s.phase == "error")
  run reviewedAwardTest = init.then(approveManifest).then(importAward).expect(s.award == 1)
}
