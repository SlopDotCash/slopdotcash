// @source src/lib/install-command.ts
// @source src/lib/project-skill.mjs
// @source src/lib/project-skill-publication.mjs
// Two template identities, two D1 revisions, three invocations. Template
// ancestry is irrelevant; registry downgrade requires explicit rollback.
// Byte/authority equality is an abstract observation. Managed paths are not
// externally modified during this trace. Prepublication verification and
// postpublication readback are distinct from the process exit status.
// permitted represents captured installation authority, not a continuous
// guarantee. skill_install_process refines process death, kernel lock recovery,
// and a later project restriction after that authority observation.
module skill_installation {
  var s: { phase: str, locked: bool, attempt: int, template: int, revision: int,
    currentTemplate: int, currentRevision: int, priorTemplate: int, priorRevision: int,
    retained: Set[int], verified: bool, permitted: bool, rollback: bool,
    equalBytes: bool, committed: bool, readback: bool, failed: bool,
    result: str, error: str, cleanupError: bool, diagnostic: str, output: str, workRoots: Set[int],
    stagedCandidates: Set[int], temporaryLinks: Set[int] }
  pure def key(template, revision) = template * 10 + revision
  val afterWork = if (s.workRoots.contains(s.attempt)) "cleanup" else "closing"

  action init = s' = { phase: "idle", locked: false, attempt: 0, template: 0, revision: 0,
    currentTemplate: 0, currentRevision: 0, priorTemplate: 0, priorRevision: 0,
    retained: Set(), verified: false, permitted: true, rollback: false,
    equalBytes: false, committed: false, readback: false, failed: false,
    result: "none", error: "none", cleanupError: false, diagnostic: "none", output: "none", workRoots: Set(),
    stagedCandidates: Set(), temporaryLinks: Set() }

  action begin(template, revision, rollback) = all {
    s.phase == "idle", s.attempt < 3,
    template.in(Set(1, 2)), revision.in(Set(1, 2)),
    if (rollback) s.currentRevision != 0 and key(template, revision).in(s.retained)
      else revision >= s.currentRevision,
    s' = s.with("phase", "fetching").with("locked", true).with("attempt", s.attempt + 1)
      .with("template", template).with("revision", revision).with("rollback", rollback)
      .with("priorTemplate", s.currentTemplate).with("priorRevision", s.currentRevision)
      .with("verified", false).with("equalBytes", false).with("committed", false)
      .with("readback", false).with("failed", false).with("result", "running")
      .with("error", "none").with("cleanupError", false)
      .with("diagnostic", "none").with("output", "none"),
  }
  // Archive download/checksum precede creation of this invocation's work root.
  action stageArchive = all { s.phase == "fetching", not(s.rollback),
    s' = s.with("phase", "staging")
      .with("workRoots", s.workRoots.union(Set(s.attempt)))
      .with("stagedCandidates", s.stagedCandidates.union(Set(s.attempt))) }
  action verifyBytes(equalBytes) = all {
    if (s.rollback) s.phase == "fetching" else s.phase == "staging",
    s.permitted,
    // Generated project.json binds D1 revision, so different revisions cannot
    // have equal rendered bytes. Different template commits may do so.
    equalBytes implies s.currentRevision != 0 and s.revision == s.currentRevision,
    s' = s.with("phase", "verified").with("verified", true).with("equalBytes", equalBytes),
  }
  action noChange = all { s.phase == "verified",
    key(s.template, s.revision) == key(s.currentTemplate, s.currentRevision)
      or (not(s.rollback) and s.equalBytes),
    s' = s.with("phase", afterWork).with("readback", true).with("output", "unchanged") }
  action retain = all { s.phase == "verified", not(s.rollback), not(s.equalBytes),
    key(s.template, s.revision) != key(s.currentTemplate, s.currentRevision),
    s' = s.with("phase", "retained")
      .with("retained", s.retained.union(Set(key(s.template, s.revision))))
      // Reuse leaves the staged copy; a new version moves it out atomically.
      .with("stagedCandidates", if (s.retained.contains(key(s.template, s.revision)))
        s.stagedCandidates else s.stagedCandidates.exclude(Set(s.attempt))) }
  action prepareLink = all {
    s.phase == "retained" or (s.phase == "verified" and s.rollback
      and key(s.template, s.revision) != key(s.currentTemplate, s.currentRevision)),
    s.verified, s.locked, s.retained.contains(key(s.template, s.revision)),
    s' = s.with("phase", "link-ready")
      .with("temporaryLinks", s.temporaryLinks.union(Set(s.attempt))),
  }
  // Publication commit: failed readback/cleanup does not restore the old link.
  action activate = all { s.phase == "link-ready", s.verified, s.locked,
    s' = s.with("phase", "committed").with("committed", true)
      .with("currentTemplate", s.template).with("currentRevision", s.revision)
      .with("temporaryLinks", s.temporaryLinks.exclude(Set(s.attempt))) }
  action confirmReadback = all { s.phase == "committed",
    s' = s.with("phase", "confirmed").with("readback", true) }
  action printSuccess = all { s.phase == "confirmed",
    s' = s.with("phase", afterWork).with("output", "activated") }
  action failure = all { Set("fetching", "staging", "verified", "retained").contains(s.phase),
    s' = s.with("phase", afterWork).with("failed", true).with("error", "before-commit") }
  action linkFailure(removeTemporaryLink) = all { s.phase == "link-ready",
    s' = s.with("phase", afterWork).with("failed", true).with("error", "before-commit")
      .with("cleanupError", not(removeTemporaryLink))
      .with("temporaryLinks", if (removeTemporaryLink)
        s.temporaryLinks.exclude(Set(s.attempt)) else s.temporaryLinks) }
  action readbackFailure = all { s.phase == "committed",
    s' = s.with("phase", afterWork).with("failed", true).with("error", "readback") }
  action cleanup(succeeds) = all { s.phase == "cleanup", s.workRoots.contains(s.attempt),
    s' = s.with("phase", "closing")
      .with("workRoots", if (succeeds) s.workRoots.exclude(Set(s.attempt)) else s.workRoots)
      .with("stagedCandidates", if (succeeds)
        s.stagedCandidates.exclude(Set(s.attempt)) else s.stagedCandidates)
      .with("failed", s.failed or not(succeeds))
      .with("cleanupError", s.cleanupError or not(succeeds))
      // Cleanup reports its own failure separately when a primary error exists.
      .with("error", if (succeeds or s.failed) s.error else "cleanup") }
  action finish = all { s.phase == "closing",
    s' = s.with("phase", "idle").with("locked", false)
      .with("result", if (s.failed) "failure" else "success")
      .with("diagnostic", if (not(s.failed)) "none"
        else if (not(s.committed)) "refused"
        else if (s.readback) "committed-verified" else "committed-unverified") }
  action permission(allowed) = all { s.phase == "idle", s' = s.with("permitted", allowed) }
  action step = {
    nondet template = Set(1, 2).oneOf()
    nondet revision = Set(1, 2).oneOf()
    nondet rollback = Set(false, true).oneOf()
    nondet observation = Set(false, true).oneOf()
    any { begin(template, revision, rollback), stageArchive, verifyBytes(observation), noChange,
      retain, prepareLink, activate, confirmReadback, printSuccess, failure,
      linkFailure(observation), readbackFailure, cleanup(observation), finish, permission(observation) }
  }
  val invariant = all {
    s.phase != "idle" implies s.locked,
    s.phase == "idle" implies not(s.locked),
    s.attempt >= 0 and s.attempt <= 3,
    s.currentRevision != 0 implies key(s.currentTemplate, s.currentRevision).in(s.retained),
    not(s.committed) and s.result == "running" implies all {
      s.currentRevision == s.priorRevision, s.currentTemplate == s.priorTemplate },
    s.committed implies all { s.verified,
      s.currentTemplate == s.template, s.currentRevision == s.revision },
    s.result == "success" implies s.readback and not(s.failed),
    s.output == "activated" implies s.committed and s.readback,
    s.stagedCandidates.subseteq(s.workRoots),
    s.result == "failure" implies s.failed,
    s.diagnostic == "refused" implies s.failed and not(s.committed),
    s.diagnostic == "committed-verified" implies s.failed and s.committed and s.readback,
    s.diagnostic == "committed-unverified" implies s.failed and s.committed and not(s.readback),
  }

  run olderTemplateNewerPolicyTest = init.then(begin(2, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(1, 2, false)).then(stageArchive).then(verifyBytes(false)).then(retain)
    .then(prepareLink).then(activate).then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .expect(s.currentTemplate == 1 and s.currentRevision == 2 and s.result == "success")
  run explicitRollbackTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(2, 2, false)).then(stageArchive).then(verifyBytes(false)).then(retain)
    .then(prepareLink).then(activate).then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(1, 1, true)).then(verifyBytes(false)).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(finish)
    .expect(s.currentRevision == 1 and s.result == "success" and s.workRoots == Set())
  run interruptedActivationTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(2, 2, false)).then(stageArchive).then(verifyBytes(false)).then(retain)
    .then(failure).then(cleanup(true)).then(finish)
    .expect(s.currentRevision == 1 and key(2, 2).in(s.retained) and s.result == "failure")
  run cleanupFailureAfterCommitTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(false)).then(finish)
    .expect(s.currentRevision == 1 and s.result == "failure" and s.output == "activated"
      and s.diagnostic == "committed-verified" and s.cleanupError
      and s.workRoots == Set(1) and s.stagedCandidates == Set())
  run cleanupFailureThenSameVersionRetryTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(false)).then(finish)
    .then(begin(1, 1, false)).then(stageArchive).then(verifyBytes(true)).then(noChange)
    .then(cleanup(true)).then(finish)
    .expect(s.result == "success" and s.output == "unchanged" and s.currentRevision == 1
      and s.workRoots == Set(1) and s.stagedCandidates == Set())
  run readbackFailureLeavesCommittedTargetTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(readbackFailure).then(cleanup(true)).then(finish)
    .expect(s.currentRevision == 1 and s.committed and not(s.readback)
      and s.result == "failure" and s.output == "none" and s.diagnostic == "committed-unverified")
  run readbackFailureThenVerifiedRetryTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(readbackFailure).then(cleanup(true)).then(finish)
    .then(begin(1, 1, false)).then(stageArchive).then(verifyBytes(true)).then(noChange)
    .then(cleanup(true)).then(finish)
    .expect(s.result == "success" and s.readback and s.currentRevision == 1)
  run rollbackReadbackFailureKeepsRollbackCommitTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(2, 2, false)).then(stageArchive).then(verifyBytes(false)).then(retain)
    .then(prepareLink).then(activate).then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(1, 1, true)).then(verifyBytes(false)).then(prepareLink).then(activate)
    .then(readbackFailure).then(finish)
    .expect(s.currentRevision == 1 and s.result == "failure" and s.workRoots == Set())
  run failedTemporaryLinkCleanupRetainsOnlyOwnedArtifactsTest = init.then(begin(1, 1, false))
    .then(stageArchive).then(verifyBytes(false)).then(retain).then(prepareLink)
    .then(linkFailure(false)).then(cleanup(false)).then(finish)
    .expect(s.currentRevision == 0 and s.retained == Set(key(1, 1))
      and s.workRoots == Set(1) and s.temporaryLinks == Set(1))
  run retryReusesRetainedVersionTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(failure).then(cleanup(true)).then(finish)
    .then(begin(1, 1, false)).then(stageArchive).then(verifyBytes(false)).then(retain)
    .expect(s.retained == Set(key(1, 1)) and s.stagedCandidates == Set(2))
  run unchangedBytesKeepOriginalIdentityTest = init.then(begin(1, 1, false)).then(stageArchive)
    .then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(2, 1, false)).then(stageArchive).then(verifyBytes(true)).then(noChange)
    .then(cleanup(true)).then(finish)
    .expect(s.currentTemplate == 1 and s.retained == Set(key(1, 1)) and s.result == "success")
  run refusalBeforeStagingCreatesNoTemporaryArtifactsTest = init.then(permission(false))
    .then(begin(1, 1, false)).then(failure).then(finish)
    .expect(s.result == "failure" and s.workRoots == Set() and s.retained == Set())
  run cleanupFailurePreservesEarlierErrorTest = init.then(begin(1, 1, false))
    .then(stageArchive).then(failure).then(cleanup(false)).then(finish)
    .expect(s.error == "before-commit" and s.cleanupError and s.diagnostic == "refused"
      and s.currentRevision == 0 and s.stagedCandidates == Set(1))
  run readbackAndCleanupFailureKeepsPrimaryTest = init.then(begin(1, 1, false))
    .then(stageArchive).then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(readbackFailure).then(cleanup(false)).then(finish)
    .expect(s.error == "readback" and s.cleanupError and s.diagnostic == "committed-unverified"
      and s.currentRevision == 1 and s.result == "failure")
  run noChangeCleanupFailureDoesNotClaimNewActivationTest = init.then(begin(1, 1, false))
    .then(stageArchive).then(verifyBytes(false)).then(retain).then(prepareLink).then(activate)
    .then(confirmReadback).then(printSuccess).then(cleanup(true)).then(finish)
    .then(begin(1, 1, false)).then(stageArchive).then(verifyBytes(true)).then(noChange)
    .then(cleanup(false)).then(finish)
    .expect(not(s.committed) and s.readback and s.diagnostic == "refused"
      and s.currentRevision == 1 and s.result == "failure")
}
