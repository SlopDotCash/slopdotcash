// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-chunks.ts
// @source backend/trace/cloudflare-persistence.ts
// @evidence tests/vetting-evidence-fixture.ts
// @evidence tests/vetting-evidence-r2.mjs
// @source scripts/dev-private-storage.ts
// @source scripts/dev-r2-server.mjs
// @source migrations/0035_vetting_evidence_chunks.sql
// @source migrations/0107_vetting_content_addressed_evidence.sql
// @source workers/vetting-backup/core.ts
// @evidence scripts/vetting-api.test.ts
// This model covers pre-0119 immutable rows with storage_generation=null.
// New generated rows use vetting_generation_storage and the generation
// retirement model. The DELETE resurrection trace is historical: the new
// collector holds these legacy keys instead of deleting them.
// Two registered runs share two content-addressed parts. At most two sequential
// service requests model retry and cross-run finalization. Authorization, body
// signature/size/digest, registered layout and R2 equality are predicates; the
// registration and verified-reader models supply those contracts separately.
// Single upload uses part0; chunk upload chooses part0/1; finalization verifies
// both parts and their ordered whole digest. Prevalidated bytes may be stored
// before audit or reply fails. An observed valid copy needs no repair;
// corruption repair uses the ETag from that verifiedPart failure, while a
// missing object retries create-only. A concurrent replacement can reject
// the condition; a reread, not PUT success alone, determines acceptance.
// ETags are representation tokens, not monotonic generations: identical
// bytes may repeat an ETag. Missing ETags and generic read failures never
// authorize a corruption repair. This legacy CAS abstraction does not establish
// generation isolation; current legacy cleanup holds these keys.
// ETag classes are 0=absent, 1=valid body, 2/3=changed bodies. Corrupt metadata
// can retain body ETag1, including after another metadata repair succeeds.
// Unknown R2 read failures never establish corruption. Initial/repair put can
// commit while its reply is lost. Final completion and its first audit are one
// D1 batch, and every replay re-verifies bytes without duplicating that audit.
// New/replay response classification assumes accurate, present D1 changes
// metadata. The adapter outcome with missing metadata (which source labels
// replayed even after a first committed completion) is outside this bound.
// The fresh post-I/O expiry check is an observation boundary, not an atomic
// clock reservation through later audit/batch/reply. Historical completion is
// not a proof that shared bytes still exist or remain intact after the read.
// historicalRetire models the replaced pre-0119 cleanup deleting bytes and
// recording the last reference's retirement. It is outside the primary step;
// current legacy cleanup holds these keys. The historical diagnostic
// resurrectedAfterRetirement is intentionally not a safety invariant or a
// claim that these legacy keys can now be physically retired.
// Existing generic upload/object lifecycle models remain. Source-authored;
// none of these scenarios or runtime regressions were executed.
// Storage flavor and single/chunked shape stay fixed across retries. The
// historical run-scoped flavor uses only run1, never a fabricated shared key.
module vetting_upload_completion {
  val runs = Set(1, 2)
  val parts = Set(0, 1)
  var s: { phase: str, mode: str, storage: str, runId: int, target: int,
    attempt: int, expired: Set[int], disk: int -> str, etags: int -> int, checked: Set[int],
    wholeMatches: bool, postChecked: bool, completed: Set[int], proved: Set[int],
    uploadAudits: int, finalizeAudits: int, puts: int, repairs: int,
    repairProof: bool, repairKind: str, observedEtag: int,
    safeRepairs: bool, conditionRejected: bool,
    retired: bool, wroteAfterRetirement: bool,
    result: str, error: str }
  action init = s' = { phase: "idle", mode: "single", storage: "content", runId: 1,
    target: 0, attempt: 0, expired: Set(), disk: parts.mapBy(_ => "missing"),
    etags: parts.mapBy(_ => 0),
    checked: Set(), wholeMatches: true, postChecked: false,
    completed: Set(), proved: Set(), uploadAudits: 0, finalizeAudits: 0,
    puts: 0, repairs: 0, repairProof: false, repairKind: "none", observedEtag: 0,
    safeRepairs: true, conditionRejected: false, retired: false,
    wroteAfterRetirement: false, result: "none", error: "none" }
  action begin(mode: str, storage: str, runId: int, target: int): bool = all {
    Set("idle", "done").contains(s.phase), s.attempt < 2,
    Set("single", "chunk", "finalize").contains(mode),
    Set("content", "run").contains(storage), runs.contains(runId), parts.contains(target),
    storage == "content" or runId == 1,
    s.attempt == 0 or (s.storage == storage and ((s.mode == "single") == (mode == "single"))),
    s' = s.with("phase", "preflight").with("mode", mode).with("storage", storage)
      .with("runId", runId).with("target", if (mode == "single") 0 else target)
      .with("attempt", s.attempt + 1).with("checked", Set()).with("postChecked", false)
      .with("repairProof", false).with("repairKind", "none").with("observedEtag", 0)
      .with("conditionRejected", false).with("result", "pending").with("error", "none") }
  action expire(runId: int): bool = all { runs.contains(runId), s' = s.with("expired", s.expired.union(Set(runId))) }
  action preflight(valid: bool): bool = all { s.phase == "preflight",
    s' = if (not(valid) or s.expired.contains(s.runId))
      s.with("phase", "done").with("result", "error").with("error", if (valid) "expired" else "input")
      else s.with("phase", if (s.mode == "finalize") "verify0" else "put") }
  action corrupt(part: int): bool = all { parts.contains(part), s.disk.get(part) == "valid",
    s' = s.with("disk", s.disk.set(part, "corrupt")).with("etags", s.etags.set(part, 2)) }
  action metadataCorrupt(part: int): bool = all { parts.contains(part), s.disk.get(part) == "valid",
    s' = s.with("disk", s.disk.set(part, "corrupt")) }
  action concurrentRepair = all { s.phase == "repair-put",
    s' = s.with("disk", s.disk.set(s.target, "valid")).with("etags", s.etags.set(s.target, 1)) }
  action concurrentCorrupt = all { s.phase == "repair-put",
    s' = s.with("disk", s.disk.set(s.target, "corrupt")).with("etags", s.etags.set(s.target, 3)) }
  action removePart = all { s.phase == "store-read",
    s' = s.with("disk", s.disk.set(s.target, "missing")).with("etags", s.etags.set(s.target, 0)) }
  action preload(part: int, kind: str): bool = all { s.phase == "idle", parts.contains(part), Set("valid", "corrupt").contains(kind),
    s' = s.with("disk", s.disk.set(part, kind)).with("etags", s.etags.set(part, if (kind == "valid") 1 else 2)) }
  action historicalRetire = all { s.expired.contains(1), s.expired.contains(2), not(s.retired),
    s' = s.with("retired", true).with("disk", parts.mapBy(_ => "missing")).with("etags", parts.mapBy(_ => 0)) }
  action putRecord(reply: str): bool = {
    val repair = s.phase == "repair-put"
    val matches = if (repair and s.repairKind == "cas")
      s.observedEtag > 0 and s.etags.get(s.target) == s.observedEtag
      else s.disk.get(s.target) == "missing"
    val writes = reply != "lost-before" and matches
    all { Set("put", "repair-put").contains(s.phase), Set("ok", "lost-before", "lost-after").contains(reply),
      s' = s.with("disk", if (writes) s.disk.set(s.target, "valid") else s.disk)
        .with("etags", if (writes) s.etags.set(s.target, 1) else s.etags)
        .with("puts", s.puts + 1).with("repairs", s.repairs + (if (repair) 1 else 0))
        .with("safeRepairs", s.safeRepairs and (not(repair) or
          (s.repairProof and (s.repairKind == "create" or (s.repairKind == "cas" and s.observedEtag > 0)))))
        .with("conditionRejected", s.conditionRejected or (repair and reply == "ok" and not(matches)))
        .with("wroteAfterRetirement", s.wroteAfterRetirement or (writes and s.retired))
        .with("phase", if (reply == "ok") (if (repair) "repair-read" else "store-read") else "done")
        .with("result", if (reply == "ok") "pending" else "error")
        .with("error", if (reply == "ok") "none" else "put-unavailable") }
  }
  action storeReadWithTag(available: bool, etagPresent: bool): bool = {
    val valid = available and s.disk.get(s.target) == "valid"
    val missing = s.disk.get(s.target) == "missing"
    val canRepair = available and not(valid) and s.storage == "content" and s.phase == "store-read"
      and (missing or etagPresent)
    all { Set("store-read", "repair-read").contains(s.phase),
      s' = s.with("phase", if (valid) (if (s.mode == "single") "single-read" else "postcheck")
          else if (canRepair) "repair-put" else "done")
        .with("repairProof", s.repairProof or canRepair)
        .with("repairKind", if (canRepair) (if (missing) "create" else "cas") else s.repairKind)
        .with("observedEtag", if (canRepair and not(missing)) s.etags.get(s.target) else s.observedEtag)
        .with("checked", if (valid) Set(s.target) else Set())
        .with("result", if (valid or canRepair) "pending" else "error")
        .with("error", if (valid or canRepair) "none" else if (not(available)) "read-unavailable"
          else if (not(missing) and not(etagPresent)) "missing-etag" else s.disk.get(s.target)) }
  }
  action storeRead(available: bool): bool = storeReadWithTag(available, true)
  action singleRead(available: bool): bool = {
    val valid = available and s.disk.get(0) == "valid" and not(s.expired.contains(s.runId))
    all { s.phase == "single-read",
      s' = s.with("phase", if (valid) "audit" else "done").with("postChecked", valid)
        .with("result", if (valid) "pending" else "error")
        .with("error", if (valid) "none" else if (s.expired.contains(s.runId)) "expired" else "read-unavailable") }
  }
  action verifyPart(available: bool): bool = {
    val part = if (s.phase == "verify0") 0 else 1
    val valid = available and s.disk.get(part) == "valid"
    all { Set("verify0", "verify1").contains(s.phase),
      s' = s.with("phase", if (valid) (if (part == 0) "verify1" else "whole") else "done")
        .with("checked", if (valid) s.checked.union(Set(part)) else s.checked)
        .with("result", if (valid) "pending" else "error")
        .with("error", if (valid) "none" else if (available) s.disk.get(part) else "read-unavailable") }
  }
  action wrongWhole = all { s.phase == "idle", s' = s.with("wholeMatches", false) }
  action whole = all { s.phase == "whole",
    s' = s.with("phase", if (s.wholeMatches) "postcheck" else "done")
      .with("result", if (s.wholeMatches) "pending" else "error")
      .with("error", if (s.wholeMatches) "none" else "whole-digest") }
  action postcheck = all { s.phase == "postcheck",
    s' = if (s.expired.contains(s.runId)) s.with("phase", "done").with("result", "error").with("error", "expired")
      else s.with("postChecked", true).with("phase", if (s.mode == "finalize") "batch" else "audit") }
  action audit(reply: str): bool = all { s.phase == "audit", Set("ok", "lost-before", "lost-after").contains(reply),
    s' = s.with("uploadAudits", s.uploadAudits + (if (reply == "lost-before") 0 else 1))
      .with("phase", if (reply == "ok") "reply" else "done")
      .with("result", if (reply == "ok") "pending" else "error")
      .with("error", if (reply == "ok") "none" else "audit-unavailable") }
  action batch(reply: str): bool = {
    val commits = reply != "lost-before"
    val first = not(s.completed.contains(s.runId))
    all { s.phase == "batch", Set("ok", "lost-before", "lost-after").contains(reply),
      s' = s.with("completed", if (commits) s.completed.union(Set(s.runId)) else s.completed)
        .with("proved", if (commits) s.proved.union(Set(s.runId)) else s.proved)
        .with("finalizeAudits", s.finalizeAudits + (if (commits and first) 1 else 0))
        .with("phase", if (reply == "ok") "reply" else "done")
        .with("result", if (reply == "ok") (if (first) "created" else "replayed") else "error")
        .with("error", if (reply == "ok") "none" else "batch-unavailable") }
  }
  action reply = all { s.phase == "reply",
    s' = s.with("phase", "done").with("result", if (s.mode == "finalize") s.result else "accepted") }
  action step = {
    nondet mode = Set("single", "chunk", "finalize").oneOf()
    nondet storage = Set("content", "run").oneOf()
    nondet runId = runs.oneOf()
    nondet part = parts.oneOf()
    nondet kind = Set("valid", "corrupt").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet result = Set("ok", "lost-before", "lost-after").oneOf()
    any { begin(mode, storage, runId, part), expire(runId), preflight(yes), preload(part, kind),
      corrupt(part), metadataCorrupt(part), concurrentRepair, concurrentCorrupt, removePart, putRecord(result),
      storeRead(yes), storeReadWithTag(true, false), singleRead(yes), verifyPart(yes),
      wrongWhole, whole, postcheck, audit(result), batch(result), reply, s' = s }
  }
  val resurrectedAfterRetirement = s.retired and s.wroteAfterRetirement and parts.exists(part => s.disk.get(part) == "valid")
  val invariant = all { s.attempt <= 2, s.completed.subseteq(s.proved),
    s.finalizeAudits == s.completed.size(), s.safeRepairs,
    Set("accepted", "created", "replayed").contains(s.result) implies s.postChecked,
    s.mode == "finalize" and Set("created", "replayed").contains(s.result) implies s.checked == parts and s.wholeMatches }
  action chunk = begin("chunk", "content", 1, 0).then(preflight(true))
  action finalize(runId: int): bool = begin("finalize", "content", runId, 0).then(preflight(true))
  action verifyWhole = verifyPart(true).then(verifyPart(true)).then(whole)
  action finishChunk = putRecord("ok").then(storeRead(true)).then(postcheck).then(audit("ok")).then(reply)
  action validParts = preload(0, "valid").then(preload(1, "valid"))
  run invalidBodyWritesNothingTest = init.then(begin("chunk", "content", 1, 0)).then(preflight(false)).expect(s.puts == 0 and invariant)
  run expiredRunWritesNothingTest = init.then(expire(1)).then(chunk).expect(s.puts == 0 and s.error == "expired" and invariant)
  run validExistingCopyIsNotRepairedTest = init.then(preload(0, "valid")).then(chunk).then(finishChunk).expect(s.repairs == 0 and s.result == "accepted" and invariant)
  run unavailableReadIsNotCorruptionTest = init.then(preload(0, "valid")).then(chunk).then(putRecord("ok")).then(storeRead(false)).expect(s.repairs == 0 and s.error == "read-unavailable" and invariant)
  run knownCorruptionCanBeRepairedTest = init.then(preload(0, "corrupt")).then(chunk).then(putRecord("ok")).then(storeRead(true)).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(audit("ok")).then(reply).expect(s.repairs == 1 and s.result == "accepted" and invariant)
  run concurrentRepairWinsWithoutOverwriteTest = init.then(preload(0, "corrupt")).then(chunk).then(putRecord("ok")).then(storeRead(true)).then(concurrentRepair).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(audit("ok")).then(reply).expect(s.conditionRejected and s.disk.get(0) == "valid" and invariant)
  run metadataRepairMayShareSameEtagTest = init.then(preload(0, "valid")).then(metadataCorrupt(0)).then(chunk).then(putRecord("ok")).then(storeRead(true)).then(concurrentRepair).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(audit("ok")).then(reply).expect(not(s.conditionRejected) and s.repairs == 1 and s.disk.get(0) == "valid" and s.result == "accepted" and invariant)
  run changedCorruptionRejectsStaleRepairTest = init.then(preload(0, "corrupt")).then(chunk).then(putRecord("ok")).then(storeRead(true)).then(concurrentCorrupt).then(putRecord("ok")).then(storeRead(true)).expect(s.conditionRejected and s.result == "error" and s.disk.get(0) == "corrupt" and invariant)
  run missingEtagCannotAuthorizeRepairTest = init.then(preload(0, "corrupt")).then(chunk).then(putRecord("ok")).then(storeReadWithTag(true, false)).expect(s.repairs == 0 and s.error == "missing-etag" and invariant)
  run missingRetryDoesNotOverwriteConcurrentRestoreTest = init.then(chunk).then(putRecord("ok")).then(removePart).then(storeRead(true)).then(concurrentRepair).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(audit("ok")).then(reply).expect(s.repairKind == "create" and s.conditionRejected and s.result == "accepted" and invariant)
  run legacyCorruptionIsNotOverwrittenTest = init.then(preload(0, "corrupt")).then(begin("chunk", "run", 1, 0)).then(preflight(true)).then(putRecord("ok")).then(storeRead(true)).expect(s.repairs == 0 and s.error == "corrupt" and invariant)
  run putCommitWithLostReplyKeepsBytesTest = init.then(chunk).then(putRecord("lost-after")).expect(s.disk.get(0) == "valid" and s.uploadAudits == 0 and invariant)
  run retryAfterLostPutReplyAcceptsSameCopyTest = init.then(chunk).then(putRecord("lost-after")).then(chunk).then(finishChunk).expect(s.result == "accepted" and s.repairs == 0 and invariant)
  run lostRepairReplyKeepsRepairedBytesTest = init.then(preload(0, "corrupt")).then(chunk).then(putRecord("ok")).then(storeRead(true)).then(putRecord("lost-after")).expect(s.disk.get(0) == "valid" and s.result == "error" and invariant)
  run uploadAuditFailureDoesNotUndoBytesTest = init.then(chunk).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(audit("lost-before")).expect(s.disk.get(0) == "valid" and s.uploadAudits == 0 and invariant)
  run chunkExpiryDuringIoRefusesReceiptTest = init.then(chunk).then(putRecord("ok")).then(expire(1)).then(storeRead(true)).then(postcheck).expect(s.disk.get(0) == "valid" and s.uploadAudits == 0 and s.error == "expired" and invariant)
  run singleUploadHasAdditionalVerifiedReadTest = init.then(begin("single", "content", 1, 0)).then(preflight(true)).then(putRecord("ok")).then(storeRead(true)).then(corrupt(0)).then(singleRead(true)).expect(s.result == "error" and s.uploadAudits == 0 and invariant)
  run missingPartCannotFinalizeTest = init.then(preload(0, "valid")).then(finalize(1)).then(verifyPart(true)).then(verifyPart(true)).expect(s.completed == Set() and s.error == "missing" and invariant)
  run partHashesDoNotProveWholeTest = init.then(validParts).then(wrongWhole).then(finalize(1)).then(verifyWhole).expect(s.completed == Set() and s.error == "whole-digest" and invariant)
  run finalizationExpiryDuringIoRefusesCompletionTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(expire(1)).then(postcheck).expect(s.completed == Set() and s.finalizeAudits == 0 and invariant)
  run completionBatchFailureIsAtomicTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("lost-before")).expect(s.completed == Set() and s.finalizeAudits == 0 and invariant)
  run lostCompletionReplyRetainsHistoryTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("lost-after")).expect(s.completed == Set(1) and s.finalizeAudits == 1 and s.result == "error" and invariant)
  run completionReplayRechecksBytesWithoutNewAuditTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("lost-after")).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("ok")).then(reply).expect(s.result == "replayed" and s.finalizeAudits == 1 and invariant)
  run secondRunNeedsOwnCompletionTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("ok")).then(reply).then(finalize(2)).then(verifyWhole).then(postcheck).then(batch("ok")).then(reply).expect(s.completed == runs and s.finalizeAudits == 2 and invariant)
  run completionDoesNotProveCurrentBytesTest = init.then(validParts).then(finalize(1)).then(verifyWhole).then(postcheck).then(batch("ok")).then(reply).then(corrupt(0)).expect(s.completed == Set(1) and s.disk.get(0) == "corrupt" and invariant)
  run expiryAfterLastCheckIsNotAtomicClockReservationTest = init.then(chunk).then(putRecord("ok")).then(storeRead(true)).then(postcheck).then(expire(1)).then(audit("ok")).then(reply).expect(s.result == "accepted" and s.expired.contains(1) and invariant)
  run delayedWriterCanResurrectRetiredStorageTest = init.then(chunk).then(expire(1)).then(expire(2)).then(historicalRetire).then(putRecord("ok")).then(storeRead(true)).then(postcheck).expect(resurrectedAfterRetirement and s.result == "error" and s.uploadAudits == 0 and invariant)
}
