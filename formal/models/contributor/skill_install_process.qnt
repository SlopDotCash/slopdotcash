// @source src/lib/install-command.ts
// @source skills/project-contributor-template/scripts/skill-authority.mjs
// @evidence tests/integration/installer.e2e.ts
// Two installer processes, at most two invocations each, two immutable versions
// and four distinct invocation-owned staging/link names. Version1 is initially
// installed and retained; version2 has the next D1 revision. Template ancestry
// has no role. Archive/tree/provenance checks and GitHub/registry responses are
// predicates, not parser or cryptographic proofs. Managed paths are otherwise
// unchanged, and distinct temporary names model the generated random suffixes.
//
// The Python process owns the kernel lock. Killing only its shell wrapper does
// not establish Python termination or release that lock. Python death does
// release it even if application finally blocks never run. The inert lock file
// stays; staged files, retained versions and committed links survive a crash.
// Atomic same-directory rename and process-bound kernel locks are OS contracts.
// This models process interruption, not storage loss after power failure.
//
// Installation/rollback clearance is an observed network result. A subsequent
// external status change is possible before activation; no atomic freshness or
// new runtime authorization gate is claimed. Readback and CLI output are later
// observations, not the activation commit. Cleanup failure cannot undo it.
// Existing integration definitions cover lock contention/recovery, activation
// readback/cleanup failures and rollback. They do not cover every crash point.
// No parser, model checker, test, subprocess or provider was executed here.
module skill_install_process {
  val actors = Set(1, 2)
  val versions = Set(1, 2)
  val artifacts = Set(1, 2, 3, 4)
  type Process = { phase: str, attempt: int, shellAlive: bool, pythonAlive: bool,
    target: int, rollback: bool, prior: int, proof: bool, clearanceObserved: bool,
    committed: bool, readback: bool, failed: bool, output: str, result: str }
  val idle: Process = { phase: "idle", attempt: 0, shellAlive: false, pythonAlive: false,
    target: 1, rollback: false, prior: 1, proof: false, clearanceObserved: false,
    committed: false, readback: false, failed: false, output: "none", result: "none" }
  var s: { owner: int, active: int, retained: Set[int], processes: int -> Process,
    work: Set[int], links: Set[int], projectOpen: bool, safeCommit: bool }
  action init = s' = { owner: 0, active: 1, retained: Set(1), processes: actors.mapBy(_ => idle),
    work: Set(), links: Set(), projectOpen: true, safeCommit: true }
  pure def artifact(actor: int, attempt: int): int = (actor - 1) * 2 + attempt
  def failedProcess(p: Process): Process = p.with("phase", "cleanup").with("failed", true)
  action begin(actor: int, version: int, rollback: bool): bool = {
    val p = s.processes.get(actor)
    all { actors.contains(actor), versions.contains(version), p.attempt < 2,
      Set("idle", "done", "dead").contains(p.phase),
      s' = s.with("processes", s.processes.set(actor, idle.with("phase", "lock").with("attempt", p.attempt + 1)
        .with("shellAlive", true).with("pythonAlive", true).with("target", version).with("rollback", rollback))) }
  }
  action acquire(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "lock", p.pythonAlive,
      s' = s.with("owner", if (s.owner == 0) actor else s.owner)
        .with("processes", s.processes.set(actor,
          if (s.owner == 0) p.with("phase", if (p.rollback) "verify" else "download").with("prior", s.active)
          else p.with("phase", "exit").with("failed", true).with("result", "contended"))) }
  }
  action download(actor: int, valid: bool): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "download", s.owner == actor, p.pythonAlive,
      s' = s.with("work", if (valid) s.work.union(Set(artifact(actor, p.attempt))) else s.work)
        .with("processes", s.processes.set(actor, if (valid) p.with("phase", "verify") else failedProcess(p))) }
  }
  action verify(actor: int, valid: bool): bool = {
    val p = s.processes.get(actor)
    val allowed = valid and s.projectOpen and (if (p.rollback) s.retained.contains(p.target) else p.target >= p.prior)
    all { p.phase == "verify", s.owner == actor, p.pythonAlive,
      s' = s.with("processes", s.processes.set(actor,
        if (allowed) p.with("proof", true).with("clearanceObserved", true).with("phase", "verified") else failedProcess(p))) }
  }
  action unchanged(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "verified", p.target == s.active, s.owner == actor,
      s' = s.with("processes", s.processes.set(actor,
        p.with("readback", true).with("output", "unchanged").with("phase", "cleanup"))) }
  }
  action retain(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "verified", not(p.rollback), p.target != s.active, s.owner == actor,
      s' = s.with("retained", s.retained.union(Set(p.target)))
        // Moving the staged skill does not remove its temporary parent root.
        .with("processes", s.processes.set(actor, p.with("phase", "retained"))) }
  }
  action prepareLink(actor: int): bool = {
    val p = s.processes.get(actor)
    all { s.owner == actor, p.proof, s.retained.contains(p.target),
      p.phase == "retained" or (p.phase == "verified" and p.rollback and p.target != s.active),
      s' = s.with("links", s.links.union(Set(artifact(actor, p.attempt))))
        .with("processes", s.processes.set(actor, p.with("phase", "link"))) }
  }
  action activate(actor: int, succeeds: bool): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "link", s.owner == actor, p.pythonAlive,
      s' = s.with("active", if (succeeds) p.target else s.active)
        .with("links", if (succeeds) s.links.exclude(Set(artifact(actor, p.attempt))) else s.links)
        .with("safeCommit", s.safeCommit and (not(succeeds) or (p.proof and p.clearanceObserved and s.retained.contains(p.target))))
        .with("processes", s.processes.set(actor,
          if (succeeds) p.with("committed", true).with("phase", "readback") else failedProcess(p))) }
  }
  action readback(actor: int, valid: bool): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "readback", s.owner == actor,
      s' = s.with("processes", s.processes.set(actor,
        if (valid) p.with("readback", true).with("phase", "print") else failedProcess(p))) }
  }
  action print(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "print", p.readback,
      s' = s.with("processes", s.processes.set(actor, p.with("output", "activated").with("phase", "cleanup"))) }
  }
  action cleanup(actor: int, succeeds: bool): bool = {
    val p = s.processes.get(actor)
    val key = artifact(actor, p.attempt)
    all { p.phase == "cleanup", s.owner == actor, p.pythonAlive,
      s' = s.with("work", if (succeeds) s.work.exclude(Set(key)) else s.work)
        .with("links", if (succeeds) s.links.exclude(Set(key)) else s.links)
        .with("processes", s.processes.set(actor, p.with("phase", "exit").with("failed", p.failed or not(succeeds)))) }
  }
  action exit(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.phase == "exit", p.pythonAlive,
      s' = s.with("owner", if (s.owner == actor) 0 else s.owner)
        .with("processes", s.processes.set(actor, p.with("phase", "done").with("pythonAlive", false).with("shellAlive", false)
          .with("result", if (p.result == "contended") "contended" else if (p.failed) "failed" else "success"))) }
  }
  action killWrapper(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.shellAlive, s' = s.with("processes", s.processes.set(actor, p.with("shellAlive", false))) }
  }
  action killPython(actor: int): bool = {
    val p = s.processes.get(actor)
    all { p.pythonAlive,
      s' = s.with("owner", if (s.owner == actor) 0 else s.owner)
        .with("processes", s.processes.set(actor, p.with("phase", "dead").with("pythonAlive", false)
          .with("shellAlive", false).with("result", "interrupted"))) }
  }
  action projectStatus(open: bool): bool = s' = s.with("projectOpen", open)
  action step = {
    nondet actor = actors.oneOf()
    nondet version = versions.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { begin(actor, version, yes), acquire(actor), download(actor, yes), verify(actor, yes), unchanged(actor),
      retain(actor), prepareLink(actor), activate(actor, yes), readback(actor, yes), print(actor), cleanup(actor, yes), exit(actor),
      killWrapper(actor), killPython(actor), projectStatus(yes), s' = s }
  }
  val invariant = all {
    s.safeCommit, s.retained.contains(s.active), s.work.subseteq(artifacts), s.links.subseteq(artifacts),
    if (s.owner == 0) true else s.processes.get(s.owner).pythonAlive,
    actors.forall(actor => {
      val p = s.processes.get(actor)
      all { p.attempt <= 2, p.output != "activated" or (p.committed and p.readback),
        p.result != "success" or (p.readback and not(p.failed)),
        p.committed implies p.proof and p.clearanceObserved }
    }) }
  action checking(actor: int, target: int, rollback: bool): bool = begin(actor, target, rollback).then(acquire(actor))
  action prepared(actor: int): bool = download(actor, true).then(verify(actor, true)).then(retain(actor)).then(prepareLink(actor))
  action finished(actor: int): bool = readback(actor, true).then(print(actor)).then(cleanup(actor, true)).then(exit(actor))
  action update = checking(1, 2, false).then(prepared(1)).then(activate(1, true)).then(finished(1))
  run competingPythonCannotAcquireTest = init.then(checking(1, 2, false)).then(checking(2, 2, false)).then(exit(2))
    .expect(s.owner == 1 and s.processes.get(2).result == "contended" and invariant)
  run wrapperDeathDoesNotReleasePythonLockTest = init.then(checking(1, 2, false)).then(killWrapper(1)).then(checking(2, 2, false)).then(exit(2))
    .expect(s.owner == 1 and s.processes.get(1).pythonAlive and invariant)
  run pythonDeathReleasesInertLockTest = init.then(checking(1, 2, false)).then(killPython(1)).then(checking(2, 2, false)).then(prepared(2)).then(activate(2, true)).then(finished(2))
    .expect(s.active == 2 and s.processes.get(2).result == "success" and invariant)
  run stagedCrashLeavesPriorActivationTest = init.then(checking(1, 2, false)).then(download(1, true)).then(killPython(1))
    .expect(s.active == 1 and s.work == Set(1) and s.owner == 0 and invariant)
  run retainedCrashKeepsBothVersionsTest = init.then(checking(1, 2, false)).then(download(1, true)).then(verify(1, true)).then(retain(1)).then(killPython(1))
    .expect(s.active == 1 and s.retained == Set(1, 2) and invariant)
  run preCommitCrashKeepsTemporaryLinkTest = init.then(checking(1, 2, false)).then(prepared(1)).then(killPython(1))
    .expect(s.active == 1 and s.links == Set(1) and invariant)
  run postCommitCrashRetainsNewActivationTest = init.then(checking(1, 2, false)).then(prepared(1)).then(activate(1, true)).then(killPython(1))
    .expect(s.active == 2 and not(s.processes.get(1).readback) and s.processes.get(1).output == "none" and invariant)
  run retryAfterCommittedCrashReadsExistingVersionTest = init.then(checking(1, 2, false)).then(prepared(1)).then(activate(1, true)).then(killPython(1))
    .then(checking(1, 2, false)).then(download(1, true)).then(verify(1, true)).then(unchanged(1)).then(cleanup(1, true)).then(exit(1))
    .expect(s.active == 2 and s.processes.get(1).output == "unchanged" and invariant)
  run successorNeverCleansOldInvocationArtifactsTest = init.then(checking(1, 2, false)).then(download(1, true)).then(killPython(1))
    .then(checking(2, 2, false)).then(prepared(2)).then(activate(2, true)).then(finished(2))
    .expect(s.work == Set(1) and s.active == 2 and invariant)
  run readbackFailureDoesNotRevertCommitTest = init.then(checking(1, 2, false)).then(prepared(1)).then(activate(1, true)).then(readback(1, false)).then(cleanup(1, true)).then(exit(1))
    .expect(s.active == 2 and s.processes.get(1).result == "failed" and invariant)
  run cleanupFailureCanFollowSuccessOutputTest = init.then(checking(1, 2, false)).then(prepared(1)).then(activate(1, true)).then(readback(1, true)).then(print(1)).then(cleanup(1, false)).then(exit(1))
    .expect(s.active == 2 and s.processes.get(1).result == "failed" and s.processes.get(1).output == "activated" and invariant)
  run failedActivationLeavesOldVersionTest = init.then(checking(1, 2, false)).then(prepared(1)).then(activate(1, false)).then(cleanup(1, true)).then(exit(1))
    .expect(s.active == 1 and s.retained == Set(1, 2) and invariant)
  run rollbackCrashKeepsRollbackCommitTest = init.then(update).then(checking(2, 1, true)).then(verify(2, true)).then(prepareLink(2)).then(activate(2, true)).then(killPython(2))
    .expect(s.active == 1 and s.retained == Set(1, 2) and invariant)
  run ordinaryRevisionDowngradeStillRefusesTest = init.then(update).then(checking(2, 1, false)).then(download(2, true)).then(verify(2, true)).then(cleanup(2, true)).then(exit(2))
    .expect(s.active == 2 and s.processes.get(2).result == "failed" and invariant)
  run currentRestrictionRefusesVerificationTest = init.then(projectStatus(false)).then(checking(1, 2, false)).then(download(1, true)).then(verify(1, true)).then(cleanup(1, true)).then(exit(1))
    .expect(s.active == 1 and not(s.processes.get(1).proof) and invariant)
  run laterRestrictionDoesNotRetroactivelyChangeObservationTest = init.then(checking(1, 2, false)).then(prepared(1)).then(projectStatus(false)).then(activate(1, true)).then(finished(1))
    .expect(s.active == 2 and not(s.projectOpen) and s.processes.get(1).clearanceObserved and invariant)
}
