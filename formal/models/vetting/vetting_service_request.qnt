// @source workers/vetting/service.ts
// @evidence workers/vetting/service.test.ts
// Finite request snapshot and response-ownership model. Integers represent
// distinct byte strings, paths, key references and transport identities, not
// hashes or cryptographic strength. Native crypto can fail at each await.
// The signed Envelope retains transport metadata only to check snapshot
// coherence: the actual signed payload binds method, path/query, timestamp
// and body digest, not origin, transport, content type or timeout.
// URL parsing is abstracted by canonical origin/path classes; regression
// definitions carry concrete parser counterexamples. Ordinary caller-owned
// objects may change between awaits; concurrent SharedArrayBuffer writers,
// hostile property getters and mutation by an injected fetch implementation
// are outside this model. No service acceptance or response truth is inferred.
module vetting_service_request {
  type Envelope = { method: str, body: int, path: int, origin: int,
    transport: int, privateKey: int, publicKey: int, at: int,
    contentType: int, timeout: int }
  val initialEnvelope: Envelope = { method: "POST", body: 1, path: 1,
    origin: 1, transport: 1, privateKey: 1, publicKey: 1, at: 1,
    contentType: 1, timeout: 1 }
  var s: { phase: str, caller: Envelope, captured: Envelope,
    throughFetch: bool, exportedKey: int, hashedBody: int,
    signed: Envelope, sent: Envelope, dispatches: int,
    responseOk: bool, responseId: int, helperTouchedBody: bool }

  action init = s' = { phase: "idle", caller: initialEnvelope,
    captured: initialEnvelope, throughFetch: false, exportedKey: 0,
    hashedBody: 0, signed: initialEnvelope, sent: initialEnvelope,
    dispatches: 0, responseOk: false, responseId: 0,
    helperTouchedBody: false }

  action configure(method: str, body: int, origin: int, path: int): bool = all {
    s.phase == "idle",
    s' = s.with("caller", s.caller.with("method", method).with("body", body)
      .with("origin", origin).with("path", path))
  }
  action begin(throughFetch: bool): bool = all {
    s.phase == "idle",
    s' = s.with("throughFetch", throughFetch)
      .with("captured", s.caller.with("body",
        if (throughFetch and s.caller.method == "GET") 0 else s.caller.body))
      .with("phase", if ((not(throughFetch) or s.caller.origin == 1)
        and s.caller.path == 1) "export" else "refused")
  }
  action mutateCaller = all {
    s.phase != "idle",
    s' = s.with("caller", { method: "PUT", body: 2, path: 2,
      origin: 2, transport: 2, privateKey: 2, publicKey: 2, at: 2,
      contentType: 2, timeout: 2 })
  }
  action exportPublic = all { s.phase == "export",
    s' = s.with("exportedKey", s.captured.publicKey).with("phase", "digest") }
  action digestBody = all { s.phase == "digest",
    s' = s.with("hashedBody", s.captured.body).with("phase", "sign") }
  action signRequest = all { s.phase == "sign",
    s' = s.with("signed", s.captured).with("phase", "keyDigest") }
  action finishHeaders = all { s.phase == "keyDigest",
    s' = s.with("phase", if (s.throughFetch) "ready" else "headersReturned") }
  action cryptoFailure = all {
    Set("export", "digest", "sign", "keyDigest").contains(s.phase),
    s' = s.with("phase", "failed")
  }
  action dispatch = all { s.phase == "ready", s.dispatches == 0,
    s' = s.with("sent", s.captured).with("dispatches", 1).with("phase", "fetching") }
  action transportFailure = all { s.phase == "fetching",
    s' = s.with("phase", "failed") }
  action returnResponse(ok: bool): bool = all { s.phase == "fetching",
    s' = s.with("responseId", 1).with("responseOk", ok).with("phase", "returned") }
  action callerRead = all { s.phase == "returned",
    s' = s.with("phase", "consumed") }
  action callerCancel = all { s.phase == "returned",
    s' = s.with("phase", "cancelled") }
  action step = {
    nondet method = Set("GET", "POST", "PUT").oneOf()
    nondet body = Set(0, 1).oneOf()
    nondet origin = Set(0, 1).oneOf()
    nondet path = Set(0, 1).oneOf()
    any { configure(method, body, origin, path), begin(true), begin(false),
      mutateCaller, exportPublic, digestBody, signRequest, finishHeaders,
      cryptoFailure, dispatch, transportFailure, returnResponse(true),
      returnResponse(false), callerRead, callerCancel, s' = s }
  }
  val headersComplete = Set("ready", "headersReturned", "fetching", "returned",
    "consumed", "cancelled").contains(s.phase)
  val invariant = all {
    s.dispatches >= 0 and s.dispatches <= 1,
    not(s.helperTouchedBody),
    headersComplete implies s.signed == s.captured
      and s.hashedBody == s.captured.body and s.exportedKey == s.captured.publicKey,
    s.dispatches == 1 implies s.throughFetch and s.sent == s.signed
      and s.sent.origin == 1 and s.sent.path == 1,
    s.dispatches == 1 and s.sent.method == "GET" implies s.sent.body == 0,
    s.responseId == 1 implies s.dispatches == 1,
    s.phase == "refused" implies s.dispatches == 0,
    s.phase == "headersReturned" implies s.dispatches == 0
  }
  run fetchMutationDuringExportTest = init.then(begin(true)).then(mutateCaller)
    .then(exportPublic).then(digestBody).then(signRequest).then(finishHeaders)
    .then(dispatch).expect(s.sent == initialEnvelope and s.caller != s.sent)
  run fetchMutationAfterDigestTest = init.then(begin(true)).then(exportPublic)
    .then(digestBody).then(mutateCaller).then(signRequest).then(finishHeaders)
    .then(dispatch).expect(s.sent == initialEnvelope and invariant)
  run directHeadersSnapshotTest = init.then(begin(false)).then(exportPublic)
    .then(mutateCaller).then(digestBody).then(signRequest).then(finishHeaders)
    .expect(s.signed == initialEnvelope and s.phase == "headersReturned")
  run getOmitsAndSignsEmptyBodyTest = init.then(configure("GET", 1, 1, 1))
    .then(begin(true)).then(exportPublic).then(digestBody).then(signRequest)
    .then(finishHeaders).then(dispatch).expect(s.sent.body == 0 and s.hashedBody == 0)
  run putRetainsBytesTest = init.then(configure("PUT", 1, 1, 1)).then(begin(true))
    .then(exportPublic).then(digestBody).then(signRequest).then(finishHeaders)
    .then(dispatch).expect(s.sent.method == "PUT" and s.sent.body == 1)
  run invalidOriginNeverDispatchesTest = init.then(configure("POST", 1, 0, 1))
    .then(begin(true)).expect(s.phase == "refused" and s.dispatches == 0)
  run invalidPathNeverSignsTest = init.then(configure("POST", 1, 1, 0))
    .then(begin(true)).expect(s.phase == "refused" and s.exportedKey == 0)
  run cryptoFailureNeverDispatchesTest = init.then(begin(true)).then(exportPublic)
    .then(cryptoFailure).expect(s.phase == "failed" and s.dispatches == 0)
  run transportFailureDoesNotRetryTest = init.then(begin(true)).then(exportPublic)
    .then(digestBody).then(signRequest).then(finishHeaders).then(dispatch)
    .then(transportFailure).expect(s.phase == "failed" and s.dispatches == 1)
  run successfulBodyRemainsCallerOwnedTest = init.then(begin(true)).then(exportPublic)
    .then(digestBody).then(signRequest).then(finishHeaders).then(dispatch)
    .then(returnResponse(true)).then(callerRead)
    .expect(s.responseOk and s.responseId == 1 and not(s.helperTouchedBody))
  run refusedBodyRemainsCallerOwnedTest = init.then(begin(true)).then(exportPublic)
    .then(digestBody).then(signRequest).then(finishHeaders).then(dispatch)
    .then(returnResponse(false)).then(callerCancel)
    .expect(not(s.responseOk) and s.responseId == 1 and not(s.helperTouchedBody))
}
