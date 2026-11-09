// @source workers/slopbot/value-consumer.ts
// @source workers/slopbot/value-publication.ts
// @source workers/slopbot/value-work-unit-publication.ts
// @source workers/slopbot/value-merge-profile.ts
// @source workers/slopbot/registry.ts
// Full source digest differs from head SHA. Final source comparison is a
// point-in-time observation, not an atomic lock on external GitHub content.
module bot_value_freshness {
  var s: { source: int, head: int, assessed: int, checked: int, phase: str,
    installed: bool, selected: bool, registered: bool, published: bool }
  action init = s' = {source: 0, head: 0, assessed: -1, checked: -1,
    phase: "empty", installed: true, selected: true, registered: true, published: false}
  action collectAndAssess = all { s.phase == "empty", s.registered, s.installed, s.selected,
    s' = s.with("assessed", s.source).with("phase", "assessed") }
  action discussionChanges = all { s.source < 2,
    s' = s.with("source", s.source + 1) }
  action headChanges = all { s.source < 2,
    s' = s.with("source", s.source + 1).with("head", s.head + 1) }
  action recheck = all { s.phase == "assessed", s.source == s.assessed,
    s.installed, s.selected, s.registered,
    s' = s.with("checked", s.source).with("phase", "checked") }
  action removeInstallation = s' = s.with("installed", false)
  action deselectRepository = s' = s.with("selected", false)
  action publish = all { s.phase == "checked", s.installed, s.selected, s.registered,
    s' = s.with("phase", "published").with("published", true) }
  action retry = all { s.phase == "assessed", s.source != s.assessed,
    s' = s.with("phase", "empty") }
  action step = any { collectAndAssess, discussionChanges, headChanges, recheck,
    removeInstallation, deselectRepository, publish, retry, s' = s }
  val invariant = s.published implies s.checked == s.assessed
  run sameHeadDiscussionDriftRefusedTest = init.then(collectAndAssess).then(discussionChanges)
    .expect(s.head == 0 and s.source != s.assessed).then(retry).expect(s.phase == "empty")
  run removalBeforeCommitRefusedTest = init.then(collectAndAssess).then(recheck)
    .then(removeInstallation).expect(not(s.installed) and not(s.published))
  run sourceMayAdvanceAfterObservationTest = init.then(collectAndAssess).then(recheck)
    .then(publish).then(discussionChanges).expect(s.source != s.checked and invariant)
}
