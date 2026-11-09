// @source backend/vetting/handler.ts
// @evidence backend/vetting/service-auth.test.ts
// signedVettingRequest, after the separately modeled service-key import.
// -1/1 denote the inclusive +/- five-minute boundary; -2/2 lie outside it.
// Grammar, Date.parse finiteness, Ed25519 and bounded-body outcomes are explicit
// inputs, not proofs of platform parsing or cryptographic correctness. Timestamp
// and key checks are captured before awaiting the body. Authentication has no
// replay store and makes no persistence mutation; endpoint idempotency is separate.
module vetting_service_auth {
  var s: { phase: str, config: int, keyKnown: bool, signatureShape: bool,
    timeSyntax: bool, timeFinite: bool, delta: int, methodExact: bool,
    pathExact: bool, queryExact: bool, bodyExact: bool, cryptoValid: bool,
    cryptoThrows: bool, bodyOutcome: int, capturedKey: bool,
    capturedWindow: bool, status: str, admissions: int }

  action init = s' = { phase: "new", config: 1, keyKnown: true,
    signatureShape: true, timeSyntax: true, timeFinite: true, delta: 0,
    methodExact: true, pathExact: true, queryExact: true, bodyExact: true,
    cryptoValid: true, cryptoThrows: false, bodyOutcome: 0,
    capturedKey: false, capturedWindow: false, status: "pending", admissions: 0 }
  action configure(kind: int) = s' = s.with("config", kind)
  action timestamp(syntax: bool, finite: bool, delta: int) = all {
    s.phase == "new", s' = s.with("timeSyntax", syntax).with("timeFinite", finite).with("delta", delta)
  }
  action signature(known: bool, shape: bool, valid: bool) = all {
    s.phase == "new", s' = s.with("keyKnown", known).with("signatureShape", shape).with("cryptoValid", valid)
  }
  action changeSignedField(field: str) = all {
    s.phase == "new",
    s' = if (field == "method") s.with("methodExact", false)
      else if (field == "path") s.with("pathExact", false)
      else if (field == "query") s.with("queryExact", false)
      else s.with("bodyExact", false)
  }
  action bodyResult(kind: int) = all { s.phase == "new", s' = s.with("bodyOutcome", kind) }
  action providerThrows = all { s.phase == "new", s' = s.with("cryptoThrows", true) }
  action importKeys = all {
    s.phase == "new",
    s' = if (s.config == 1) s.with("phase", "headers").with("capturedKey", true)
      else s.with("phase", "done").with("status", "503")
  }
  val currentWindow = s.timeSyntax and s.timeFinite and s.delta >= -1 and s.delta <= 1
  action inspectHeaders = all {
    s.phase == "headers",
    s' = if (currentWindow and s.keyKnown and s.signatureShape)
      s.with("phase", "body").with("capturedWindow", true)
      else s.with("phase", "done").with("status", "401")
  }
  // A slow stream does not repeat the timestamp check or reload configuration.
  action clockMoves(delta: int) = all { s.phase == "body", s' = s.with("delta", delta) }
  action readBody = all {
    s.phase == "body",
    s' = if (s.bodyOutcome == 0) s.with("phase", "verify")
      else s.with("phase", "done").with("status",
        if (s.bodyOutcome == 1) "413" else if (s.bodyOutcome == 2) "400" else "throw")
  }
  val exactPayload = s.methodExact and s.pathExact and s.queryExact and s.bodyExact
  action verifySignature = all {
    s.phase == "verify", s.admissions < 2,
    s' = if (s.cryptoThrows) s.with("phase", "done").with("status", "throw")
      else if (s.cryptoValid and exactPayload)
        s.with("phase", "done").with("status", "ok").with("admissions", s.admissions + 1)
      else s.with("phase", "done").with("status", "401")
  }
  action replay = all {
    s.phase == "done", s.admissions < 2,
    s' = s.with("phase", "new").with("status", "pending")
      .with("capturedKey", false).with("capturedWindow", false)
  }
  action authenticate = importKeys.then(inspectHeaders).then(readBody).then(verifySignature)
  action step = any { importKeys, inspectHeaders, readBody, verifySignature, replay,
    configure(0), configure(1), configure(2), clockMoves(2), clockMoves(-2),
    timestamp(true, true, -1), timestamp(true, true, 1), timestamp(true, true, 2),
    timestamp(false, true, 0), timestamp(true, false, 0),
    signature(false, true, true), signature(true, false, true), signature(true, true, false),
    changeSignedField("method"), changeSignedField("path"), changeSignedField("query"),
    changeSignedField("body"), bodyResult(1), bodyResult(2), bodyResult(3), providerThrows, s' = s }
  val invariant = all {
    s.admissions >= 0 and s.admissions <= 2,
    s.status == "ok" implies (s.capturedKey and s.capturedWindow and s.keyKnown
      and s.signatureShape and exactPayload and s.cryptoValid and not(s.cryptoThrows)
      and s.bodyOutcome == 0),
    (s.phase == "body" or s.phase == "verify") implies (s.capturedKey and s.capturedWindow)
  }

  run validRequestTest = init.then(authenticate).expect(s.status == "ok" and s.admissions == 1)
  run oldestBoundaryTest = init.then(timestamp(true, true, 1)).then(authenticate).expect(s.status == "ok")
  run newestBoundaryTest = init.then(timestamp(true, true, -1)).then(authenticate).expect(s.status == "ok")
  run olderRefusedTest = init.then(timestamp(true, true, 2)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run newerRefusedTest = init.then(timestamp(true, true, -2)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run grammarRefusedTest = init.then(timestamp(false, true, 0)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run nonfiniteTimestampTest = init.then(timestamp(true, false, 0)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run missingConfigurationTest = init.then(configure(0)).then(importKeys).expect(s.status == "503")
  run malformedConfigurationTest = init.then(configure(2)).then(importKeys).expect(s.status == "503")
  run configurationBeforeHeadersTest = init.then(configure(0)).then(timestamp(false, false, 2)).then(importKeys).expect(s.status == "503")
  run unknownKeyTest = init.then(signature(false, true, true)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run invalidSignatureShapeTest = init.then(signature(true, false, true)).then(importKeys).then(inspectHeaders).expect(s.status == "401")
  run wrongSignatureTest = init.then(signature(true, true, false)).then(authenticate).expect(s.status == "401")
  run changedMethodTest = init.then(changeSignedField("method")).then(authenticate).expect(s.status == "401")
  run changedPathTest = init.then(changeSignedField("path")).then(authenticate).expect(s.status == "401")
  run changedQueryTest = init.then(changeSignedField("query")).then(authenticate).expect(s.status == "401")
  run changedBodyTest = init.then(changeSignedField("body")).then(authenticate).expect(s.status == "401")
  run overLimitTest = init.then(bodyResult(1)).then(importKeys).then(inspectHeaders).then(readBody).expect(s.status == "413")
  run badLengthTest = init.then(bodyResult(2)).then(importKeys).then(inspectHeaders).then(readBody).expect(s.status == "400")
  run streamFailureTest = init.then(bodyResult(3)).then(importKeys).then(inspectHeaders).then(readBody).expect(s.status == "throw")
  run providerFailureTest = init.then(providerThrows).then(authenticate).expect(s.status == "throw")
  run slowBodyRetainsWindowTest = init.then(importKeys).then(inspectHeaders).then(clockMoves(2))
    .then(readBody).then(verifySignature).expect(s.status == "ok" and s.delta == 2)
  run inFlightKeySnapshotTest = init.then(importKeys).then(configure(0)).then(inspectHeaders)
    .then(readBody).then(verifySignature).expect(s.status == "ok" and s.config == 0)
  run replayHasNoNonceStoreTest = init.then(authenticate).then(replay).then(authenticate).expect(s.admissions == 2)
  run replayAfterRevocationTest = init.then(authenticate).then(configure(0)).then(replay).then(importKeys)
    .expect(s.status == "503" and s.admissions == 1)
  run replayAfterExpiryTest = init.then(authenticate).then(replay).then(timestamp(true, true, 2))
    .then(importKeys).then(inspectHeaders).expect(s.status == "401" and s.admissions == 1)
}
