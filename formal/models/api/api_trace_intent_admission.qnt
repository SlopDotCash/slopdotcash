// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/contracts.ts
// @source migrations/0001_private_trace_backend.sql
// @evidence scripts/trace-upload-attachable.test.ts
// One run, two request keys, two digest/metadata representatives, one owner
// and one other actor. Each key may be created and renewed once. Expiry is
// an observation, not a metadata write. R2 and token cryptography are outside
// this intent-admission model; api_trace retains the attachment/read boundary.
module api_trace_intent_admission {
  type Intent = { exists: bool, digest: int, shape: int,
    expired: bool, consumed: bool, epoch: int }
  type Request = { stage: str, key: int, actor: int, digest: int, shape: int }
  val keyIds = Set(1, 2)
  val empty = { exists: false, digest: 0, shape: 0,
    expired: false, consumed: false, epoch: 0 }
  val idle = { stage: "idle", key: 1, actor: 1, digest: 1, shape: 1 }
  var s: { runState: str, runDigest: int, banned: bool, rows: int -> Intent,
    request: Request, result: str, mutations: int, frozenMutations: int }
  action init = s' = { runState: "awaiting_trace", runDigest: 0, banned: false,
    rows: keyIds.mapBy(_ => empty), request: idle, result: "none",
    mutations: 0, frozenMutations: 0 }
  def compatible(digest: int): bool = s.runDigest == 0 or s.runDigest == digest
  action begin(key: int, actor: int, digest: int, shape: int): bool = all {
    s.request.stage == "idle", keyIds.contains(key), actor == 1,
    keyIds.contains(digest), keyIds.contains(shape), not(s.banned),
    s.runState != "finalized", compatible(digest),
    s' = s.with("request", { stage: "read", key: key, actor: actor,
      digest: digest, shape: shape }).with("result", "none") }
  action readIntent = {
    val row = s.rows.get(s.request.key)
    val same = row.digest == s.request.digest and row.shape == s.request.shape
    val authorized = s.request.actor == 1 and not(s.banned)
      and s.runState != "finalized" and compatible(s.request.digest)
    all { s.request.stage == "read",
      s' = s.with("request", s.request.with("stage",
        if (not(authorized)) "invalid" else if (not(row.exists)) "new" else if (not(same)) "invalid"
        else if (row.expired and not(row.consumed)) "renew" else "replay")) }
  }
  // The current run fence is part of either INSERT or renewal UPDATE.
  action commit = {
    val request = s.request
    val row = s.rows.get(request.key)
    val authorized = request.actor == 1 and not(s.banned)
      and s.runState != "finalized" and compatible(request.digest)
    val create = request.stage == "new" and not(row.exists) and authorized
    val renew = request.stage == "renew" and row.exists and row.expired
      and not(row.consumed) and authorized
    val changed = create or renew
    val stored = if (create) { exists: true, digest: request.digest,
      shape: request.shape, expired: false, consumed: false, epoch: 1 }
      else row.with("expired", false).with("epoch", row.epoch + 1)
    all { Set("new", "renew", "replay", "invalid").contains(request.stage),
      s' = s.with("rows", if (changed) s.rows.set(request.key, stored) else s.rows)
        .with("mutations", s.mutations + (if (changed) 1 else 0))
        .with("result", if (create) "created"
          else if (renew) "none" else if (request.stage == "replay") "existing" else "conflict")
        .with("request", request.with("stage", if (renew) "renew-readback" else "done")) }
  }
  action renewalReadback = all { s.request.stage == "renew-readback",
    s' = s.with("result", if (s.request.actor == 1 and not(s.banned)
      and s.runState != "finalized" and compatible(s.request.digest)
      and not(s.rows.get(s.request.key).consumed)) "existing" else "conflict")
      .with("request", s.request.with("stage", "done")) }
  action finish = all { s.request.stage == "done", s' = s.with("request", idle) }
  action expire(key: int): bool = all { keyIds.contains(key), s.rows.get(key).exists,
    s.rows.get(key).epoch == 1, not(s.rows.get(key).expired),
    s' = s.with("rows", s.rows.set(key, s.rows.get(key).with("expired", true))) }
  action attach(digest: int): bool = all { keyIds.contains(digest),
    s.runState != "finalized", compatible(digest),
    s' = s.with("runState", "trace_uploaded").with("runDigest", digest) }
  action consume(key: int): bool = all { keyIds.contains(key), s.rows.get(key).exists,
    not(s.rows.get(key).expired), not(s.rows.get(key).consumed),
    s.runState != "finalized", compatible(s.rows.get(key).digest),
    s' = s.with("rows", s.rows.set(key, s.rows.get(key).with("consumed", true)))
      .with("runState", "trace_uploaded").with("runDigest", s.rows.get(key).digest) }
  action finalize = all { s.runState == "trace_uploaded",
    s' = s.with("runState", "finalized").with("frozenMutations", s.mutations) }
  action ban = s' = s.with("banned", true)
  action step = {
    nondet key = keyIds.oneOf()
    nondet actor = keyIds.oneOf()
    nondet digest = keyIds.oneOf()
    nondet shape = keyIds.oneOf()
    any { begin(key, actor, digest, shape), readIntent, commit, renewalReadback, finish,
      expire(key), attach(digest), consume(key), finalize, ban, s' = s }
  }
  val invariant = all { s.mutations <= 4,
    s.runState == "finalized" implies s.mutations == s.frozenMutations,
    keyIds.forall(key => {
      val row = s.rows.get(key)
      all { row.exists implies keyIds.contains(row.digest) and keyIds.contains(row.shape),
        row.epoch >= 0, row.epoch <= 2, row.consumed implies row.exists }
    }) }
  run newIntentAfterCapturedReadCannotMutateFinalizedRunTest = init.then(attach(1))
    .then(begin(1, 1, 1, 1)).then(readIntent).then(finalize).then(commit)
    .expect(s.result == "conflict" and s.mutations == 0 and invariant)
  run renewalAfterCapturedReadCannotMutateFinalizedRunTest = init
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit).then(finish).then(expire(1))
    .then(attach(1)).then(begin(1, 1, 1, 1)).then(readIntent).then(finalize).then(commit)
    .expect(s.result == "conflict" and s.rows.get(1).epoch == 1 and s.rows.get(1).expired and invariant)
  run newIntentRefusesDifferentConcurrentAttachmentTest = init.then(begin(1, 1, 2, 1))
    .then(readIntent).then(attach(1)).then(commit)
    .expect(s.result == "conflict" and not(s.rows.get(1).exists))
  run renewalRefusesDifferentConcurrentAttachmentTest = init
    .then(begin(1, 1, 2, 1)).then(readIntent).then(commit).then(finish).then(expire(1))
    .then(begin(1, 1, 2, 1)).then(readIntent).then(attach(1)).then(commit)
    .expect(s.result == "conflict" and s.rows.get(1).epoch == 1 and s.rows.get(1).expired)
  run matchingAttachedDigestStillAllowsIntentTest = init.then(attach(1))
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit)
    .expect(s.result == "created" and s.rows.get(1).digest == 1)
  run exactUnexpiredReplayDoesNotRenewTest = init.then(begin(1, 1, 1, 1))
    .then(readIntent).then(commit).then(finish).then(begin(1, 1, 1, 1))
    .then(readIntent).then(commit).expect(s.result == "existing" and s.mutations == 1)
  run exactExpiredIntentRenewsSameIdentityTest = init.then(begin(1, 1, 1, 1))
    .then(readIntent).then(commit).then(finish).then(expire(1))
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit).then(renewalReadback)
    .expect(s.result == "existing" and s.rows.get(1).epoch == 2 and s.rows.get(1).digest == 1)
  run usedCapabilityReplayDoesNotRenewTest = init.then(begin(1, 1, 1, 1))
    .then(readIntent).then(commit).then(finish).then(consume(1)).then(expire(1))
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit)
    .expect(s.result == "existing" and s.rows.get(1).consumed and s.rows.get(1).epoch == 1)
  run metadataMismatchCannotReuseKeyTest = init.then(begin(1, 1, 1, 1))
    .then(readIntent).then(commit).then(finish).then(begin(1, 1, 1, 2))
    .then(readIntent).then(commit).expect(s.result == "conflict" and s.mutations == 1)
  run banDuringPreparationRefusesWriteTest = init.then(begin(1, 1, 1, 1))
    .then(readIntent).then(ban).then(commit).expect(s.result == "conflict" and s.mutations == 0)
  run wrongActorCannotBeginTest = init.then(begin(1, 2, 1, 1).fail())
  run readOnlyReplayDoesNotChangeConcurrentFinalizationTest = init
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit).then(finish).then(attach(1))
    .then(begin(1, 1, 1, 1)).then(readIntent).then(finalize).then(commit)
    .expect(s.result == "existing" and s.mutations == 1 and invariant)
  run finalizationBeforeExistingReadRefusesReplayTest = init
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit).then(finish).then(attach(1))
    .then(begin(1, 1, 1, 1)).then(finalize).then(readIntent).then(commit)
    .expect(s.result == "conflict" and s.mutations == 1 and invariant)
  run renewalCanCommitBeforeFinalizedReadbackRefusesTest = init
    .then(begin(1, 1, 1, 1)).then(readIntent).then(commit).then(finish).then(expire(1))
    .then(attach(1)).then(begin(1, 1, 1, 1)).then(readIntent).then(commit)
    .then(finalize).then(renewalReadback)
    .expect(s.result == "conflict" and s.rows.get(1).epoch == 2 and s.mutations == 2 and invariant)
}
