module pointsQuotaWitness {
  import points__quotaRecovery as Q from "./points__quotaRecovery"
  pure val authority: Q::RunAuthority = { manual: true, onMain: true, repository: 1, head: 2 }
  pure val artifact: Q::Artifact = { repository: 1, head: 1, main: true, manual: true, collectorWorkflow: true,
    ancestorVerified: true, exactBytesVerified: true }
  pure val scope = Q::scopeSample
  pure val replay: Q::Replay = { saved: scope, reconstructed: scope, verifiedBaseline: 1, journalPrefix: 1,
    cutoffSupplied: false, requestedCutoff: 0 }
  pure val entry: Q::Admission = { authority: authority, original: scope, restoring: false, artifact: artifact,
    replay: replay, retainedIndex: Set() }
  pure val output: Q::Output = { manifest: 1, receipt: 2, boundManifest: 1, scope: scope,
    checkedExact: true, ownershipComplete: true, missingMonths: 0 }
  pure val apply: Q::Choice = { monthly: false, candidateMonth: false, apply: true,
    authority: authority, observedMain: 2, registry: 1 }
  pure def readKey(key: int): Q::Request = { key: key, kind: Q::NewEvidence, canonicalRead: true }
  pure def refused(number: int, key: int, retryAt: int): Q::Reply =
    { attempt: { number: number, key: key }, digest: number, cost: 2,
      recoverableStatistics: false, acceptableSuccess: false, hint: { ...Q::noHint, status: 429, retryAt: retryAt } }
  pure def successful(number: int, key: int): Q::Reply =
    { ...refused(number, key, 0), acceptableSuccess: true, hint: Q::noHint }
  pure def admitted(budget: int, duration: int): Q::Run = Q::admit(Q::newInvocation(1000, budget, duration), entry)

  run trustedRestoreTest = all {
    Q::mayRestore(authority, artifact),
    not(Q::mayRestore(authority, { ...artifact, repository: 2 })),
    not(Q::mayRestore(authority, { ...artifact, ancestorVerified: false })),
    not(Q::scopeValid({ ...replay, cutoffSupplied: true, requestedCutoff: 501 })),
    Q::frozenSearchPageSize(0) == 100,
  }

  run parallelStrictResetTest = {
    val one = Q::request(admitted(10, 180000), readKey(1));
    val two = Q::request(one, readKey(2));
    val first = Q::observe(two, refused(1, 1, 3000));
    val second = Q::observe(first, refused(2, 2, 8000));
    val waiting = Q::drain(second);
    val resumed = Q::resume(Q::tick(waiting, 10000));
    all {
      not(Q::canDrain(first)),
      not(Q::canRequest(first, readKey(3))),
      Q::canDrain(second),
      second.retained.length() == 2,
      second.indexed.size() == 0,
      waiting.wakeAt == 10000,
      not(Q::canResume(Q::tick(waiting, 9999))),
      resumed.scope == scope,
      resumed.requests == 2,
      resumed.cost == 4,
    }
  }

  run missingResetPreventsResumeTest = {
    val requestPair = Q::request(Q::request(admitted(10, 180000), readKey(1)), readKey(2));
    val observed = Q::observe(requestPair, refused(1, 1, 3000));
    val missing = { ...refused(2, 2, 0), hint: { ...Q::noHint, status: 403, remainingZero: true } };
    val checkpoint = Q::drain(Q::observe(observed, missing));
    all {
      checkpoint.phase == Q::Checkpoint,
      not(Q::mayReconcile(checkpoint, output, apply)),
    }
  }

  run noProgressCutoffTest = {
    val first = Q::drain(Q::observe(Q::request(admitted(10, 180000), readKey(1)), refused(1, 1, 3000)));
    val resumed = Q::resume(Q::tick(first, first.wakeAt));
    val second = Q::drain(Q::observe(Q::request(resumed, readKey(1)), refused(2, 1, 7000)));
    val resumedAgain = Q::resume(Q::tick(second, second.wakeAt));
    val third = Q::drain(Q::observe(Q::request(resumedAgain, readKey(1)), refused(3, 1, 11000)));
    all {
      Q::canResume(Q::tick(first, first.wakeAt)),
      Q::canResume(Q::tick(second, second.wakeAt)),
      third.phase == Q::Checkpoint,
      third.refusedPasses == 3,
      third.requests == 3,
    }
  }

  run cumulativeBudgetAndCacheTest = {
    val read = Q::observe(Q::request(admitted(1, 180000), readKey(1)), successful(1, 1));
    val checkpoint = Q::drain(Q::reachBudget(read, readKey(2)));
    all {
      Q::canReuse(read, 1, true),
      Q::reuse(read, 1, true) == read,
      not(Q::canReuse(read, 1, false)),
      not(Q::canReachBudget(read, readKey(1))),
      Q::canReachBudget(read, readKey(2)),
      checkpoint.phase == Q::Checkpoint,
    }
  }

  run invalidApplyRefusalsTest = {
    val collected = Q::finish(admitted(10, 180000), output);
    all {
      Q::mayReconcile(collected, output, apply),
      not(Q::mayReconcile(collected, { ...output, boundManifest: 2 }, apply)),
      not(Q::mayReconcile(collected, { ...output, ownershipComplete: false }, apply)),
      not(Q::mayReconcile(collected, { ...output, missingMonths: 1 }, apply)),
      not(Q::mayReconcile(collected, output, { ...apply, monthly: true })),
      not(Q::mayReconcile(collected, output, { ...apply, observedMain: 3 })),
      not(Q::mayReconcile(collected, output, { ...apply, registry: 3 })),
      Q::mayReconcile(collected, output, { ...apply, monthly: true, apply: false }),
    }
  }
}
