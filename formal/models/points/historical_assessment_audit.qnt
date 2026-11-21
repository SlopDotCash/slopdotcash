// @source scripts/historical-assessment-catalog.ts
// @source scripts/historical-assessment-reconciliation.ts
// @source scripts/run-reviewed-historical-points.ts
// @source .github/workflows/reviewed-historical-points.yml
// The read-only path reports a conclusion at a fixed journal cut. Completeness
// requires both catalogs and exact records. Scope with an active assessment
// moves to value replay before owner review.
module historical_assessment_audit {
  type State = {
    phase: str,
    jointExpected: int,
    legacyExpected: int,
    jointRead: int,
    legacyRead: int,
    invalid: bool,
    relevant: bool,
    status: str,
  }
  var s: State

  action init = s' = {
    phase: "idle",
    jointExpected: 0,
    legacyExpected: 0,
    jointRead: 0,
    legacyRead: 0,
    invalid: false,
    relevant: false,
    status: "unsealed",
  }

  action capture(trusted: bool, scoped: bool, apply: bool, joint: int, legacy: int): bool = all {
    s.phase == "idle",
    trusted,
    scoped,
    not(apply),
    s' = s.with("phase", "reading").with("jointExpected", joint).with("legacyExpected", legacy),
  }

  action observe(joint: bool, valid: bool, activeInScope: bool): bool = all {
    s.phase == "reading",
    if (joint) s.jointRead < s.jointExpected else s.legacyRead < s.legacyExpected,
    s' = (if (joint) s.with("jointRead", s.jointRead + 1) else s.with("legacyRead", s.legacyRead + 1))
      .with("invalid", s.invalid or not(valid)).with("relevant", s.relevant or activeInScope),
  }

  val complete = not(s.invalid) and s.jointRead == s.jointExpected and s.legacyRead == s.legacyExpected
  action seal = all {
    s.phase == "reading",
    s' = s.with("phase", "sealed").with(
      "status",
      if (complete) (if (s.relevant) "requires-value-replay" else "no-scoped-active-assessments")
      else "incomplete"
    ),
  }

  action step = any {
    capture(true, true, false, 0, 0),
    capture(true, true, false, 1, 1),
    observe(true, true, true),
    observe(true, true, false),
    observe(true, false, false),
    observe(false, true, true),
    observe(false, true, false),
    observe(false, false, false),
    seal,
    s' = s,
  }

  val invariant = all {
    s.status == "no-scoped-active-assessments" implies (complete and not(s.relevant)),
    s.status == "requires-value-replay" implies (complete and s.relevant),
    s.phase == "sealed" implies s.status != "unsealed",
  }

  run verifiedEmptyCutTest = init.then(capture(true, true, false, 0, 0))
    .then(seal).expect(s.status == "no-scoped-active-assessments" and invariant)
  run bothCatalogsRequiredTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, true, false)).then(seal).expect(s.status == "incomplete" and invariant)
  run matchedActiveRecordRequiresReplayTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, true, true)).then(observe(false, true, false))
    .then(seal).expect(s.status == "requires-value-replay" and invariant)
  run invalidRecordRemainsIncompleteTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, false, false)).then(observe(false, true, false))
    .then(seal).expect(s.status == "incomplete" and invariant)
  run applyCannotEnterAuditTest = init.then(capture(true, true, true, 1, 1).fail())
  run changedScopeCannotEnterAuditTest = init.then(capture(true, false, false, 1, 1).fail())
}
