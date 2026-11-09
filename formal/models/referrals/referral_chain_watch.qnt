// @source scripts/check-referral-roots.ts
// @source contracts/evm/adapter.ts
// @evidence scripts/check-referral-roots.test.ts
// Read-only checkReferralRoots composition after file validation. Two posted
// roots, two void logs, finalized height 1 and latest height 2. Root/amount,
// exact canonical receipt/log equality, bytecode/token and RPC parsing are
// explicit supplied predicates; cryptography and RPC honesty are not proved.
// A successful latest-chain observation may remain pending. Returned mappings
// appear only after end-hash/count rechecks; no chain or file state is written.
module referral_chain_watch {
  type State = { phase: str, fault: str, candidates: int, posts: int, voids: int,
    count: int, cursor: int, awaiting: bool, pending: bool, seenVoids: Set[int],
    mappings: Set[int], finalPosts: Set[int], finalVoids: Set[int],
    finalizedChanged: bool, tipChanged: bool, countChanged: bool,
    returned: bool, result: str, error: str }
  var s: State
  val faults = Set("none", "files", "chain", "deployment", "code", "token", "scans",
    "void-duplicate", "void-range", "void-root", "void-canonical", "post-order",
    "post-root", "post-total", "post-canonical", "epoch-root", "epoch-total", "epoch-void")
  val initial: State = { phase: "input", fault: "none", candidates: 2, posts: 2,
    voids: 0, count: 2, cursor: 0, awaiting: false, pending: false,
    seenVoids: Set(), mappings: Set(), finalPosts: Set(0, 1), finalVoids: Set(0, 1),
    finalizedChanged: false, tipChanged: false, countChanged: false,
    returned: false, result: "none", error: "none" }
  action init = s' = initial
  def refused(reason: str): State = s.with("phase", "done").with("error", reason)
  action configure(fault: str, candidates: int, posts: int, voids: int, count: int,
    awaiting: bool, finalPosts: Set[int], finalVoids: Set[int]): bool = all {
    s.phase == "input", faults.contains(fault), 0.to(2).contains(candidates),
    0.to(2).contains(posts), 0.to(2).contains(voids), 0.to(2).contains(count),
    s' = s.with("fault", fault).with("candidates", candidates).with("posts", posts)
      .with("voids", voids).with("count", count).with("awaiting", awaiting)
      .with("finalPosts", finalPosts).with("finalVoids", finalVoids) }
  action start = all { s.phase == "input", s' = s.with("phase", "files") }
  action files = all { s.phase == "files", s' = if (s.fault == "files") refused("files") else s.with("phase", "chain") }
  action chain = all { s.phase == "chain", s' = if (s.fault == "chain") refused("chain") else s.with("phase", "finalized") }
  action finalized = all { s.phase == "finalized", s' = if (s.fault == "deployment") refused("deployment") else s.with("phase", "code") }
  action code = all { s.phase == "code", s' = if (s.fault == "code") refused("code") else s.with("phase", "token") }
  action token = all { s.phase == "token", s' = if (s.fault == "token") refused("token") else s.with("phase", "scans") }
  // The posted/void scans run concurrently. Either refusal rejects the join;
  // the other request may still finish, but it cannot return a partial report.
  action scans = all { s.phase == "scans", s' = if (s.fault == "scans") refused("scans") else s.with("phase", "count") }
  action count = all { s.phase == "count", s' =
    if (s.posts != s.count) refused("coverage")
    else if (s.posts > s.candidates) refused("unfiled")
    else s.with("phase", "voids").with("pending", s.awaiting or s.posts < s.candidates) }
  action voidLog = all { s.phase == "voids", s' =
    if (s.cursor >= s.voids) s.with("phase", "posts").with("cursor", 0)
    else if (s.fault == "void-duplicate" and s.cursor == 1) refused("void-coverage")
    else if (s.cursor >= s.count or s.fault == "void-range") refused("void-coverage")
    else if (s.fault == "void-root") refused("void-root")
    else if (s.fault == "void-canonical") refused("canonical")
    else s.with("seenVoids", s.seenVoids.union(Set(s.cursor))).with("cursor", s.cursor + 1)
      .with("pending", s.pending or not(s.finalVoids.contains(s.cursor))) }
  action postLog = all { s.phase == "posts", s' =
    if (s.cursor >= s.posts) s.with("phase", "end-finalized")
    else if (Set("post-order", "post-root", "post-total").contains(s.fault)) refused("posted-root")
    else if (s.fault == "post-canonical") refused("canonical")
    else if (Set("epoch-root", "epoch-total", "epoch-void").contains(s.fault)) refused("epoch-state")
    else s.with("mappings", s.mappings.union(Set(s.cursor))).with("cursor", s.cursor + 1)
      .with("pending", s.pending or not(s.finalPosts.contains(s.cursor))) }
  action changeFinalized = all { Set("code", "token", "scans", "count", "voids", "posts", "end-finalized").contains(s.phase), s' = s.with("finalizedChanged", true) }
  action changeTip = all { Set("scans", "count", "voids", "posts", "end-finalized", "end-tip").contains(s.phase), s' = s.with("tipChanged", true) }
  action changeCount = all { Set("voids", "posts", "end-finalized", "end-tip", "end-count").contains(s.phase), s' = s.with("countChanged", true) }
  action endFinalized = all { s.phase == "end-finalized", s' =
    if (s.finalizedChanged) refused("finality-changed") else s.with("phase", "end-tip") }
  action endTip = all { s.phase == "end-tip", s' =
    if (s.tipChanged) refused("observation-changed") else s.with("phase", "end-count") }
  action endCount = all { s.phase == "end-count", s' =
    if (s.countChanged) refused("observation-changed") else s.with("phase", "done").with("returned", true)
      .with("result", if (s.pending) "pending" else "verified") }
  action step = {
    nondet fault = faults.oneOf() nondet n = 0.to(2).oneOf()
    any { configure(fault, n, n, 0, n, false, Set(0, 1), Set(0, 1)), start, files,
      chain, finalized, code, token, scans, count, voidLog, postLog, changeFinalized,
      changeTip, changeCount, endFinalized, endTip, endCount, s' = s }
  }
  val invariant = all { s.cursor <= 2, s.mappings.size() <= s.posts,
    s.returned implies s.error == "none" and s.mappings.size() == s.posts and s.posts == s.count and s.posts <= s.candidates,
    s.result == "verified" implies s.returned and not(s.pending),
    s.error != "none" implies not(s.returned) }
  action toCount = start.then(files).then(chain).then(finalized).then(code).then(token).then(scans).then(count)
  action finishTwo = toCount.then(voidLog).then(postLog).then(postLog).then(postLog)
    .then(endFinalized).then(endTip).then(endCount)
  run completeCanonicalRootsVerifiedTest = init.then(finishTwo).expect(s.result == "verified" and invariant)
  run absentPostedRootsRemainPendingTest = init.then(configure("none", 2, 0, 0, 0, false, Set(), Set()))
    .then(toCount).then(voidLog).then(postLog).then(endFinalized).then(endTip).then(endCount).expect(s.result == "pending" and invariant)
  run latestUnfinalizedPostPendingTest = init.then(configure("none", 2, 2, 0, 2, false, Set(0), Set()))
    .then(finishTwo).expect(s.result == "pending" and s.mappings.size() == 2 and invariant)
  run awaitingFilingRemainsPendingTest = init.then(configure("none", 2, 2, 0, 2, true, Set(0, 1), Set()))
    .then(finishTwo).expect(s.result == "pending" and invariant)
  run fileFailurePrecedesRpcTest = init.then(configure("files", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files)
    .expect(s.error == "files" and s.mappings == Set() and invariant)
  run wrongChainRefusedTest = init.then(configure("chain", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files).then(chain).expect(s.error == "chain" and invariant)
  run deploymentAfterFinalizedHeadRefusedTest = init.then(configure("deployment", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files).then(chain).then(finalized).expect(s.error == "deployment" and invariant)
  run codeMismatchRefusedTest = init.then(configure("code", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files).then(chain).then(finalized).then(code).expect(s.error == "code" and invariant)
  run tokenMismatchRefusedTest = init.then(configure("token", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files).then(chain).then(finalized).then(code).then(token).expect(s.error == "token" and invariant)
  run eitherLogScanFailureRefusesReportTest = init.then(configure("scans", 2, 2, 0, 2, false, Set(), Set())).then(start).then(files).then(chain).then(finalized).then(code).then(token).then(scans).expect(s.error == "scans" and invariant)
  run countCannotHideMissingEventTest = init.then(configure("none", 2, 1, 0, 2, false, Set(), Set())).then(toCount).expect(s.error == "coverage" and invariant)
  run postedRootNeedsPublicFileTest = init.then(configure("none", 1, 2, 0, 2, false, Set(), Set())).then(toCount).expect(s.error == "unfiled" and invariant)
  run repeatedVoidEpochRefusedTest = init.then(configure("void-duplicate", 2, 2, 2, 2, false, Set(), Set(0, 1))).then(toCount).then(voidLog).then(voidLog).expect(s.error == "void-coverage" and invariant)
  run voidOutsideCountRefusedTest = init.then(configure("void-range", 2, 2, 1, 2, false, Set(), Set())).then(toCount).then(voidLog).expect(s.error == "void-coverage" and invariant)
  run voidRootNeedsMatchingFileTest = init.then(configure("void-root", 2, 2, 1, 2, false, Set(), Set())).then(toCount).then(voidLog).expect(s.error == "void-root" and invariant)
  run voidReceiptMustBeCanonicalTest = init.then(configure("void-canonical", 2, 2, 1, 2, false, Set(), Set())).then(toCount).then(voidLog).expect(s.error == "canonical" and invariant)
  run unfinalizedVoidKeepsWholeReportPendingTest = init.then(configure("none", 2, 2, 1, 2, false, Set(0, 1), Set())).then(toCount).then(voidLog).then(voidLog).then(postLog).then(postLog).then(postLog).then(endFinalized).then(endTip).then(endCount).expect(s.result == "pending" and invariant)
  run postedEpochOrderMustMatchCandidateOrderTest = init.then(configure("post-order", 2, 2, 0, 2, false, Set(), Set())).then(toCount).then(voidLog).then(postLog).expect(s.error == "posted-root" and invariant)
  run postedReceiptMustBeCanonicalTest = init.then(configure("post-canonical", 2, 2, 0, 2, false, Set(), Set())).then(toCount).then(voidLog).then(postLog).expect(s.error == "canonical" and invariant)
  run observedEpochVoidFlagMustMatchLogsTest = init.then(configure("epoch-void", 2, 2, 0, 2, false, Set(), Set())).then(toCount).then(voidLog).then(postLog).expect(s.error == "epoch-state" and invariant)
  run finalityRecheckRefusesStagedMappingsTest = init.then(toCount).then(voidLog).then(postLog).then(postLog).then(postLog).then(changeFinalized).then(endFinalized).expect(s.error == "finality-changed" and s.mappings.size() == 2 and not(s.returned) and invariant)
  run tipRecheckRefusesStagedMappingsTest = init.then(toCount).then(voidLog).then(postLog).then(postLog).then(postLog).then(endFinalized).then(changeTip).then(endTip).expect(s.error == "observation-changed" and invariant)
  run countRecheckRefusesLaterRootTest = init.then(toCount).then(voidLog).then(postLog).then(postLog).then(postLog).then(endFinalized).then(endTip).then(changeCount).then(endCount).expect(s.error == "observation-changed" and invariant)
}
