// @source src/lib/leaderboard.ts
// candidateExclusionReasons, workItemSelection, issueWorkItem, pullRequestWorkItem.
// The census retains excluded rows; the advertisement is a derived projection.
// One bounded issue/PR representative covers each blocking fact independently.
// help wanted represents the existing ready-label class; mission-ready is the
// upstream addition. Neither label may lift a security or blocking exclusion.
module ui_score_selection {
  var s: { kind: str, author: str, readyLabel: str, claim: bool, blocked: bool,
    security: bool, draft: bool, decision: str, requested: bool, sourceRows: int,
    advertisement: str }
  action init = s' = { kind: "issue", author: "human", readyLabel: "help wanted", claim: false,
    blocked: false, security: false, draft: false, decision: "none", requested: false,
    sourceRows: 1, advertisement: "unchecked" }
  action pullRequest = s' = s.with("kind", "pull-request").with("advertisement", "unchecked")
  action unknownAuthor = s' = s.with("author", "unknown").with("advertisement", "unchecked")
  action botAuthor = s' = s.with("author", "bot").with("advertisement", "unchecked")
  action untriaged = s' = s.with("readyLabel", "none").with("advertisement", "unchecked")
  action missionReady = s'=s.with("readyLabel", "mission-ready").with("advertisement", "unchecked")
  action claimed = s' = s.with("claim", true).with("advertisement", "unchecked")
  action blocked = s' = s.with("blocked", true).with("advertisement", "unchecked")
  action security = s' = s.with("security", true).with("advertisement", "unchecked")
  action draft = s' = s.with("draft", true).with("advertisement", "unchecked")
  action approved = s' = s.with("decision", "approved").with("advertisement", "unchecked")
  action changesRequested = s' = s.with("decision", "changes-requested").with("advertisement", "unchecked")
  action reviewRequested = s' = s.with("requested", true).with("advertisement", "unchecked")
  val candidate = s.author == "human" and not(s.claim) and not(s.blocked)
    and not(s.security) and not(s.draft) and s.decision == "none"
    and (s.kind != "issue" or Set("help wanted", "mission-ready").contains(s.readyLabel))
    and (s.kind != "pull-request" or not(s.requested))
  action classify = s' = s.with("advertisement", if (candidate) "candidate" else "excluded")
  action step = any { pullRequest, unknownAuthor, botAuthor, untriaged, missionReady, claimed,
    blocked, security, draft, approved, changesRequested, reviewRequested, classify }
  val invariant = all { s.sourceRows == 1, s.advertisement == "candidate" implies candidate }
  run missionReadyTest = init.then(untriaged).then(missionReady).then(classify).expect(s.advertisement == "candidate")
  run missionReadySecurityTest = init.then(security).then(missionReady).then(classify).expect(s.advertisement == "excluded")
  run missionReadyBlockedTest = init.then(blocked).then(missionReady).then(classify).expect(s.advertisement == "excluded")
  run readyIssueTest = init.then(classify).expect(s.advertisement == "candidate")
  run claimedTest = init.then(claimed).then(classify).expect(s.advertisement == "excluded" and s.sourceRows == 1)
  run activeReviewTest = init.then(pullRequest).then(reviewRequested).then(classify).expect(s.advertisement == "excluded")
  run humanGateTest = init.then(blocked).then(classify).expect(s.advertisement == "excluded")
  run changesRequestedTest = init.then(pullRequest).then(changesRequested).then(classify).expect(s.advertisement == "excluded")
  run unknownAuthorTest = init.then(unknownAuthor).then(classify).expect(s.advertisement == "excluded")
}
