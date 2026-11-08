// @source scripts/benchmark-points-snapshot.ts
// Offline benchmark pins both input digests and requires all seven resulting
// digests to agree. Warm-up is omitted from the six measured samples.
module source_replay {
  type S = { runs: int, samples: int, baseline: int, failed: bool, reported: bool,
    journalDigest: int, snapshotDigest: int }
  var s: S
  action init = s' = { runs: 0, samples: 0, baseline: 0, failed: false,
    reported: false, journalDigest: 1, snapshotDigest: 2 }
  action replay(digest: int): bool = all { s.runs < 7, not(s.failed),
    s' = if(s.runs > 0 and digest != s.baseline) s.with("failed", true)
      else s.with("runs", s.runs + 1).with("baseline", digest)
        .with("samples", if(s.runs == 0) 0 else s.samples + 1) }
  action report = all { s.runs == 7, not(s.failed), s' = s.with("reported", true) }
  action step = any { replay(1), replay(2), report, s' = s }
  val invariant = all { s.runs <= 7, s.samples == (if(s.runs == 0) 0 else s.runs - 1),
    s.journalDigest == 1, s.snapshotDigest == 2,
    s.reported implies s.runs == 7 and not(s.failed) and s.samples == 6 }
  run warmupExcludedTest = init.then(replay(1)).expect(s.samples == 0)
    .then(replay(1)).then(replay(1)).then(replay(1)).then(replay(1)).then(replay(1)).then(replay(1))
    .then(report).expect(s.samples == 6 and invariant)
  run nondeterministicReplayRefusedTest = init.then(replay(1)).then(replay(2)).then(report.fail())
}
