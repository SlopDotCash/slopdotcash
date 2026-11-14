// @source src/lib/points-implementation-corrections.ts
// @source scripts/collect-implementation-corrections.ts
// @source scripts/prepare-implementation-corrections.ts
// @source scripts/points-protection-sql.ts
// @source scripts/generate-points.ts
// @source .github/workflows/points-implementation-corrections.yml
// @evidence scripts/points-implementation-corrections.test.ts
// @evidence scripts/prepare-implementation-corrections.test.ts
// @evidence scripts/points-protection-sql.test.ts
// One existing three-Point pool, one manifest, three immutable actor identities,
// one unrelated award, one correction and at most one later revocation. The
// correction moves the old carrier's pool to two authors with line weights 1:2.
// No value assessment or provisional flag determines allocation eligibility.
// Complete means the whole connected source/claim scope and predecessor proof
// passed the trusted collector/domain checks; eligible is a complete private
// preflight result. Their GitHub authenticity, cryptography, integer allocation
// for other weights, SQL semantics and real financial rows require source tests.
// Protection may appear after preflight: atomic import checks it again. An
// intervening pool revision also refuses the stale manifest. A recorded manifest
// replay is a no-op even after a later legitimate revocation. This is a finite
// safety abstraction, with no provider, scheduler or eventual-success assumption.
// The workflow sequences these states; its GitHub branch/SHA/environment and
// artifact trust checks are source-review boundaries outside this state model.
module historical_implementation_allocation {
  type Allocation = { carrier: int, first: int, second: int, source: int, occurred: int }
  pure val original: Allocation = { carrier: 3, first: 0, second: 0, source: 1, occurred: 1 }
  pure val corrected: Allocation = { carrier: 0, first: 1, second: 2, source: 1, occurred: 1 }
  pure val revoked: Allocation = { carrier: 0, first: 0, second: 0, source: 1, occurred: 1 }
  pure def total(a: Allocation): int = a.carrier + a.first + a.second
  pure def validAllocation(a: Allocation): bool = all {
    a.source == original.source, a.occurred == original.occurred,
    a.carrier >= 0, a.first >= 0, a.second >= 0,
    total(a) == 3 or a == revoked
  }

  var s: { phase: str, history: List[Allocation], captured: int, complete: bool,
    eligible: bool, protected: bool, applied: bool, importProtected: bool,
    importStale: bool, wasRevoked: bool, unrelatedAward: int }

  action init = s' = { phase: "new", history: List(original), captured: 0,
    complete: false, eligible: false, protected: false, applied: false,
    importProtected: false, importStale: false, wasRevoked: false, unrelatedAward: 9 }

  action prepare(complete: bool, eligible: bool): bool = all {
    s.phase == "new",
    s' = s.with("phase", if (complete and eligible) "ready" else "held")
      .with("captured", s.history.length()).with("complete", complete)
      .with("eligible", eligible)
  }
  // A fresh protected row can race the previously successful private read.
  action protect = all { not(s.protected), s' = s.with("protected", true) }
  action atomicImport = all {
    s.phase == "ready", not(s.applied),
    s' = if (s.history.length() != s.captured) s.with("phase", "stale")
      else if (s.protected) s.with("phase", "protected")
      else s.with("phase", "applied").with("applied", true)
        .with("importProtected", s.protected)
        .with("importStale", s.history.length() != s.captured)
        .with("history", s.history.append(corrected))
  }
  // External later decisions are preserved; this action is not a correction.
  action revoke = all {
    Set("ready", "applied", "replayed").contains(s.phase), not(s.wasRevoked),
    s' = s.with("history", s.history.append(revoked)).with("wasRevoked", true)
  }
  action replay = all {
    s.applied, s' = s.with("phase", "replayed")
  }
  action step = any {
    { nondet complete = Set(false, true).oneOf()
      nondet eligible = Set(false, true).oneOf()
      prepare(complete, eligible) },
    protect, atomicImport, revoke, replay, s' = s
  }

  val invariant = all {
    s.history.length() >= 1, s.history.length() <= 3,
    s.history.head() == original,
    s.history.indices().forall(i => validAllocation(s.history.nth(i))),
    s.unrelatedAward == 9,
    s.applied implies all {
      s.complete, s.eligible, not(s.importProtected), not(s.importStale),
      s.history.length() >= 2, s.history.nth(1) == corrected
    },
    s.wasRevoked implies all {
      s.history.nth(s.history.length() - 1) == revoked,
      s.history.length() == (if (s.applied) 3 else 2)
    },
    not(s.wasRevoked) implies total(s.history.nth(s.history.length() - 1)) == total(original),
    Set("held", "protected", "stale").contains(s.phase) implies not(s.applied)
  }

  run unchangedPoolAndAppendOnlyTest = init.then(prepare(true, true)).then(atomicImport)
    .expect(s.history == List(original, corrected) and invariant)
    .then(replay).expect(s.history.length() == 2 and invariant)
  run incompleteConnectedProofHeldTest = init.then(prepare(false, true))
    .expect(s.phase == "held" and s.history == List(original) and invariant)
    .then(atomicImport.fail())
  run privateProtectedPoolHeldTest = init.then(protect).then(prepare(true, false))
    .expect(s.phase == "held" and s.history == List(original) and invariant)
    .then(atomicImport.fail())
  run protectionRaceBeforeAtomicImportTest = init.then(prepare(true, true))
    .then(protect).then(atomicImport)
    .expect(s.phase == "protected" and s.history == List(original) and invariant)
  run changedPredecessorRefusesImportTest = init.then(prepare(true, true))
    .then(revoke).then(atomicImport)
    .expect(s.phase == "stale" and s.history == List(original, revoked) and invariant)
  run replayAfterRevocationNeverRestoresTest = init.then(prepare(true, true))
    .then(atomicImport).then(revoke).then(protect).then(replay).then(replay)
    .expect(s.history == List(original, corrected, revoked) and invariant)

  // Negative controls are deliberately excluded from step. Each witnesses that
  // the invariant detects the specific guard or conservation failure it names.
  action unsafeProtectedImport = all {
    s.phase == "ready", s.protected,
    s' = s.with("phase", "applied").with("applied", true)
      .with("importProtected", s.protected).with("history", s.history.append(corrected))
  }
  action unsafeRevalue = all {
    s.phase == "ready",
    s' = s.with("history", s.history.append(corrected.with("second", 3)))
  }
  action unsafeReplayRestores = all {
    s.applied, s.wasRevoked, s' = s.with("history", s.history.append(corrected))
  }
  run protectionBypassNegativeControlTest = init.then(prepare(true, true)).then(protect)
    .then(unsafeProtectedImport).expect(not(invariant))
  run revaluationNegativeControlTest = init.then(prepare(true, true))
    .then(unsafeRevalue).expect(not(invariant))
  run replayResurrectionNegativeControlTest = init.then(prepare(true, true)).then(atomicImport)
    .then(revoke).then(unsafeReplayRestores).expect(not(invariant))
}
