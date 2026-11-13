// @source src/GeneratedSkillPreview.tsx
// @source src/VettingEvidence.tsx
// Async derived bytes are bound to the selected source; private evidence needs a read grant.
module ui_artifacts {
  var s: { source: int, completedSource: int, visibleSource: int, phase: str, private: bool, grant: bool }
  action init = s' = { source: 1, completedSource: 0, visibleSource: 0, phase: "loading", private: false, grant: false }
  action privateEvidence = all { s.phase == "loading", s' = s.with("private", true) }
  action authorizeRead = all { s.private, s' = s.with("grant", true) }
  action complete = all { s.phase == "loading", not(s.private) or s.grant,
    s' = s.with("completedSource", s.source).with("visibleSource", s.source).with("phase", "ready") }
  action changeSource = all { s.source == 1, s' = s.with("source", 2).with("visibleSource", 0).with("phase", "loading").with("grant", false) }
  action oldCompletion = all { s.source == 2, s' = s }
  action failure = s' = s.with("phase", "error").with("visibleSource", 0)
  action step = any { privateEvidence, authorizeRead, complete, changeSource, oldCompletion, failure, s' = s }
  val invariant = all { s.visibleSource > 0 implies s.visibleSource == s.source, s.private and s.visibleSource > 0 implies s.grant }
  run staleCompletionTest = init.then(changeSource).then(oldCompletion).expect(s.visibleSource == 0)
  run grantTest = init.then(privateEvidence).then(authorizeRead).then(complete).expect(s.visibleSource == 1)
  run errorTest = init.then(failure).expect(s.visibleSource == 0)
}
