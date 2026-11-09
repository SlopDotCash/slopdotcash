// @source workers/slopbot/value-evidence.ts
// @source workers/slopbot/value-context.ts
// @source workers/slopbot/value-blob.ts
// @source workers/slopbot/value-tree.ts
// @source workers/slopbot/value-file-comparisons.ts
// @source workers/slopbot/value-binary.ts
// @source workers/slopbot/git-object.ts
// Three paged source entrys and two bounded blobs. Hash verification is an
// explicit transition; plausible SHA syntax and HTTP success do not suffice.
module bot_evidence_integrity {
  var s: { expected: int, seen: Set[int], complete: bool, budget: int,
    pending: bool, hashMatches: bool, verified: int, failed: bool, usable: bool }
  action init = s' = {expected: 3, seen: Set(), complete: false, budget: 2,
    pending: false, hashMatches: false, verified: 0, failed: false, usable: false}
  action page(entry: int): bool = all { not(entry.in(s.seen)),
    s' = s.with("seen", s.seen.union(Set(entry))) }
  action finishPages = all { s.seen.size() == s.expected,
    s' = s.with("complete", true) }
  action readBlob(matches: bool): bool = all { not(s.pending), s.budget > 0,
    s' = s.with("budget", s.budget - 1).with("pending", true).with("hashMatches", matches) }
  action verifyBlob = all { s.pending, s.hashMatches,
    s' = s.with("pending", false).with("verified", s.verified + 1) }
  action rejectBlob = all { s.pending, not(s.hashMatches),
    s' = s.with("pending", false).with("failed", true) }
  action acceptEvidence = all { s.complete, s.verified == 2, not(s.failed),
    s' = s.with("usable", true) }
  action step = { nondet entry = Set(1, 2, 3).oneOf()
    any { page(entry), finishPages, readBlob(true), readBlob(false), verifyBlob,
      rejectBlob, acceptEvidence, s' = s } }
  val invariant = all { s.budget + s.verified <= 2,
    s.complete implies s.seen == Set(1, 2, 3),
    s.usable implies s.complete and s.verified == 2 and not(s.failed) }
  run corruptBlobRefusedTest = init.then(readBlob(false)).then(rejectBlob)
    .expect(s.failed and not(s.usable) and s.verified == 0)
  run completeEvidenceTest = init.then(page(1)).then(page(2)).then(page(3)).then(finishPages)
    .then(readBlob(true)).then(verifyBlob).then(readBlob(true)).then(verifyBlob)
    .then(acceptEvidence).expect(s.usable and invariant)
}
