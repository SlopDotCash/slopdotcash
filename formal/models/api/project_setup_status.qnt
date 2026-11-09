// @source backend/projects/setup.ts
// runSetupCheck (backend/projects/handler.ts) and projectSetupStatus
// (setup.ts): each check
// reads restriction, Slopbot installation, current GitHub authority, scan
// clearance, project status and whether the manifest publishes generated
// skills. An open, verified project with an unscanned or stale revision
// queues a scan. A paused project activates only when activation is allowed
// (owner revisions pass allowActivation: false), the App is installed,
// authority is verified, the scan is cleared and the skill fields are
// complete. The status then derives one state and next action, in order:
// restricted, installation, authority, ready, paused-and-cleared, queued
// scan, quarantined scan, retry.
// Message text, funding and repository facts are not modeled. A scan that
// is queued or unavailable is the scan request result folded into `scan`.
module project_setup_status {
  type Facts = { restricted: bool, installation: str, authority: str, scan: str,
    status: str, skillsComplete: bool, allowActivation: bool }
  var facts: Facts
  var state: str
  var nextAction: str
  var activated: bool
  var checks: int
  val SCANS = Set("unscanned", "stale", "queued", "cleared", "quarantined", "banned",
    "unavailable", "unverified")
  action init = all {
    facts' = { restricted: false, installation: "missing", authority: "retry",
      scan: "unscanned", status: "paused", skillsComplete: false, allowActivation: true },
    state' = "unchecked", nextAction' = "unchecked", activated' = false, checks' = 0,
  }
  def open(f: Facts): bool = not(f.restricted) and f.scan != "banned"
  // handler.ts queueScan: unscanned or stale revisions of open, verified projects.
  def afterQueue(f: Facts): Facts =
    if (open(f) and f.authority == "verified" and f.scan.in(Set("unscanned", "stale")))
      f.with("scan", "queued") else f
  def activates(f: Facts): bool = all {
    open(f), f.allowActivation, f.status == "paused", f.authority == "verified",
    f.installation == "installed", f.scan == "cleared", f.skillsComplete,
  }
  // setup.ts projectSetupStatus: the first unmet check.
  def derive(f: Facts): (str, str) =
    if (not(open(f))) ("restricted", "restricted")
    else if (f.installation == "retry") ("retry", "retry_installation")
    else if (f.installation != "installed") ("action_required", "install_slopbot")
    else if (f.authority == "retry") ("retry", "retry_authority")
    else if (f.authority == "denied") ("action_required", "ask_maintainer")
    else if (f.scan == "cleared" and f.status == "active") ("ready", "none")
    else if (f.scan == "cleared" and f.status == "paused")
      ("action_required", if (f.skillsComplete) "activate_project" else "complete_skill_fields")
    else if (f.scan == "queued") ("waiting", "wait_for_scan")
    else if (f.scan == "quarantined") ("action_required", "request_scan")
    else ("retry", "retry_scan")
  // GitHub, the vetting service, moderators and owner revisions change the facts.
  action observe = {
    nondet restricted = Set(false, true).oneOf()
    nondet installation = Set("installed", "missing", "suspended", "retry").oneOf()
    nondet authority = Set("verified", "denied", "retry").oneOf()
    nondet scan = SCANS.oneOf()
    nondet status = Set("active", "paused").oneOf()
    nondet skillsComplete = Set(false, true).oneOf()
    nondet allowActivation = Set(false, true).oneOf()
    all {
      facts' = { restricted: restricted, installation: installation, authority: authority,
        scan: scan, status: status, skillsComplete: skillsComplete,
        allowActivation: allowActivation },
      // New facts invalidate the last derived status until the next check.
      state' = "unchecked", nextAction' = "unchecked", activated' = false, checks' = checks,
    }
  }
  action check = {
    val queued = afterQueue(facts)
    val after = if (activates(queued)) queued.with("status", "active") else queued
    all {
      checks < 3,
      facts' = after,
      state' = derive(after)._1,
      nextAction' = derive(after)._2,
      activated' = activates(queued),
      checks' = checks + 1,
    }
  }
  action step = any { observe, check }
  val invariant = all {
    // A retry_scan never points at a scan that is cleared, queued or banned.
    nextAction == "retry_scan" implies not(facts.scan.in(Set("cleared", "queued", "banned"))),
    // Ready means every gate holds, with the project active.
    state == "ready" implies (open(facts) and facts.installation == "installed"
      and facts.authority == "verified" and facts.scan == "cleared" and facts.status == "active"),
    (state == "ready") iff (nextAction == "none"),
    // Activation is never granted to an owner revision or incomplete skills.
    activated implies (facts.status == "active" and facts.skillsComplete
      and facts.scan == "cleared" and facts.authority == "verified"),
    // A cleared paused project always names an achievable action.
    (nextAction.in(Set("activate_project", "complete_skill_fields")))
      implies (facts.status == "paused" and facts.scan == "cleared"),
    // With activation allowed, the same check would have activated it.
    nextAction == "activate_project" implies not(facts.allowActivation),
    nextAction == "wait_for_scan" implies facts.scan == "queued",
  }
  val ownerRevision = { restricted: false, installation: "installed", authority: "verified",
    scan: "cleared", status: "paused", skillsComplete: true, allowActivation: false }
  run ownerRevisionKeepsPauseTest = init
    .then(all { facts' = ownerRevision, state' = state, nextAction' = nextAction,
      activated' = activated, checks' = checks })
    .then(check).expect(nextAction == "activate_project" and facts.status == "paused"
      and not(activated))
  run setupCheckActivatesTest = init
    .then(all { facts' = ownerRevision.with("allowActivation", true), state' = state,
      nextAction' = nextAction, activated' = activated, checks' = checks })
    .then(check).expect(state == "ready" and activated)
  run incompleteSkillsStayPausedTest = init
    .then(all { facts' = ownerRevision.with("allowActivation", true).with("skillsComplete", false),
      state' = state, nextAction' = nextAction, activated' = activated, checks' = checks })
    .then(check).expect(nextAction == "complete_skill_fields" and not(activated))
  run unscannedQueuesScanTest = init
    .then(all { facts' = ownerRevision.with("scan", "unscanned"), state' = state,
      nextAction' = nextAction, activated' = activated, checks' = checks })
    .then(check).expect(nextAction == "wait_for_scan")
  run unavailableScanRetriesTest = init
    .then(all { facts' = ownerRevision.with("scan", "unavailable"), state' = state,
      nextAction' = nextAction, activated' = activated, checks' = checks })
    .then(check).expect(nextAction == "retry_scan" and state == "retry")
}
