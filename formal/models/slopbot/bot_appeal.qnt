// @source migrations/0064_slopbot_penalties_appeals.sql
// @source migrations/0091_slopbot_appeal_publications.sql
// @source workers/slopbot/appeals.ts
// @source workers/slopbot/appeal-publication.ts
// @source workers/slopbot/penalties.ts
// One appeal and one immutable debit. Reversal restores eligibility/history;
// this has no authority to change already-funded awards or to send money.
module bot_appeal {
  var s: { phase: str, draft: str, due: bool, debitActive: bool,
    resolution: str, resolver: str, published: bool }
  action init = s' = { phase: "absent", draft: "none", due: false,
    debitActive: true, resolution: "none", resolver: "none", published: false }
  action open = all { s.phase == "absent", s' = s.with("phase", "triage") }
  action recordDraft(draft) = all {
    s.phase == "triage", s.draft == "none", draft.in(Set("uphold", "deny")),
    s' = s.with("draft", draft),
  }
  action deadline = all { s.phase == "triage", s' = s.with("due", true) }
  action escalate = all { s.phase == "triage", s' = s.with("phase", "escalated") }
  action resolve(by, decision) = all {
    s.phase.in(Set("triage", "escalated")), decision.in(Set("upheld", "denied")),
    by.in(Set("appellant", "maintainer", "moderator")),
    (s.phase == "escalated") implies by == "moderator",
    (by == "appellant") implies (s.draft != "none" and
      decision == (if (s.draft == "uphold") "upheld" else "denied")),
    s' = s.with("phase", "resolved").with("resolution", decision).with("resolver", by)
      .with("debitActive", decision != "upheld"),
  }
  // A verified maintainer reopen is an independent GitHub decision, not an
  // appeal command accepting a draft. It may reverse an escalated appeal.
  action maintainerReopen = all {
    s.phase.in(Set("triage", "escalated")),
    s' = s.with("phase", "resolved").with("resolution", "upheld")
      .with("resolver", "maintainer").with("debitActive", false),
  }
  action publish = all { s.phase == "resolved", s' = s.with("published", true) }
  action replay = all { s.phase == "resolved", s' = s }
  action step = {
    nondet draft = Set("uphold", "deny").oneOf()
    nondet by = Set("appellant", "maintainer", "moderator").oneOf()
    nondet decision = Set("upheld", "denied").oneOf()
    any { open, recordDraft(draft), deadline, escalate, resolve(by, decision),
      maintainerReopen, publish, replay }
  }
  val invariant = all {
    s.published implies s.phase == "resolved",
    s.resolution == "upheld" implies not(s.debitActive),
    s.phase != "resolved" implies s.resolution == "none",
  }
  run appealReversalTest = init.then(open).then(recordDraft("uphold"))
    .then(resolve("appellant", "upheld")).then(publish).then(replay)
    .expect(not(s.debitActive) and s.published)
  run escalatedReviewTest = init.then(open).then(deadline).then(escalate)
    .then(resolve("moderator", "denied")).expect(s.debitActive and s.resolver == "moderator")
  run escalatedCommandNeedsModeratorTest = init.then(open).then(escalate)
    .expect(s.phase == "escalated").then(resolve("maintainer", "upheld").fail())
  run independentMaintainerReopenTest = init.then(open).then(escalate).then(maintainerReopen)
    .expect(s.resolver == "maintainer" and s.resolution == "upheld" and not(s.debitActive))
}
