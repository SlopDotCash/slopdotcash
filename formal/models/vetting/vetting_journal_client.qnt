// @source workers/vetting/publication-journal.ts
// @source workers/vetting/service.ts
// @source src/lib/browser-json.ts
// @source src/lib/vetting-contracts.ts
// @evidence workers/vetting/publication-journal.test.ts
// Signed journal transport: exact HTTPS origin, one factory-owned connection,
// synchronous metadata encoding, signing, fetch, bounded body and operation ack.
// Three serial calls, one assessment, two mutable configuration/metadata atoms.
// Body-limit classes represent <=4096 and >4096 bytes; tests use actual bytes.
// Ed25519, fetch/timeouts and stream-reader outcomes are supplied observations;
// their lower-level behavior is modeled separately. The trusted service owns
// durable writes: an acknowledgement is not independent proof of D1 durability.
// A refused/lost reply never rolls back a possible service write. Late writes,
// server CAS and publication outcome classification have separate models.
// No automatic retry, live endpoint or checker execution is claimed here.
module vetting_journal_client {
  var s: { phase: str, validOrigin: bool, config: int, capturedConfig: int,
    callerMetadata: int, encodedMetadata: int, signedMetadata: int, sentMetadata: int,
    requestConfig: int, operation: str, attempts: int, sends: int,
    reserved: bool, recorded: bool, bodyConsumed: bool, cancelAttempted: bool,
    readerReleased: bool, contractValid: bool, acknowledgement: int,
    success: bool, present: bool, error: str }
  action init = s' = { phase: "new", validOrigin: true, config: 1, capturedConfig: 0,
    callerMetadata: 1, encodedMetadata: 0, signedMetadata: 0, sentMetadata: 0,
    requestConfig: 0, operation: "none", attempts: 0, sends: 0,
    reserved: false, recorded: false, bodyConsumed: false, cancelAttempted: false,
    readerReleased: false, contractValid: false, acknowledgement: -1,
    success: false, present: false, error: "none" }
  action changeConfig = s' = s.with("config", if (s.config == 1) 2 else 1)
  action changeMetadata = s' = s.with("callerMetadata", if (s.callerMetadata == 1) 2 else 1)
  action construct(exactHttps: bool): bool = all { s.phase == "new",
    s' = s.with("validOrigin", exactHttps).with("capturedConfig", s.config)
      .with("phase", if (exactHttps) "ready" else "done")
      .with("error", if (exactHttps) "none" else "origin") }
  action beginRequest(operation: str): bool = all {
    s.validOrigin, s.capturedConfig != 0, Set("ready", "done").contains(s.phase),
    Set("has", "reserve", "complete").contains(operation), s.attempts < 3,
    s' = s.with("phase", "sign").with("operation", operation).with("attempts", s.attempts + 1)
      .with("encodedMetadata", s.callerMetadata).with("requestConfig", s.capturedConfig)
      .with("signedMetadata", 0).with("sentMetadata", 0).with("bodyConsumed", false)
      .with("cancelAttempted", false).with("readerReleased", false).with("contractValid", false)
      .with("acknowledgement", -1).with("success", false).with("present", false).with("error", "none") }
  action sign(succeeds: bool): bool = all { s.phase == "sign",
    s' = if (succeeds) s.with("phase", "fetch").with("signedMetadata", s.encodedMetadata)
      else s.with("phase", "done").with("error", "sign") }
  action send = all { s.phase == "fetch", s' = s.with("phase", "transport")
    .with("sends", s.sends + 1).with("sentMetadata", s.encodedMetadata) }
  // A service can commit before the client receives an unusable or lost reply.
  action serviceCommit = all { Set("transport", "body", "contract", "ack", "cancel-http").contains(s.phase),
    s.operation != "has", s.operation != "complete" or s.reserved,
    s' = if (s.operation == "reserve") s.with("reserved", true) else s.with("recorded", true) }
  action transport(kind: int): bool = all { s.phase == "transport", Set(0, 1, 2).contains(kind),
    s' = if (kind == 0) s.with("phase", "body")
      else if (kind == 1) s.with("phase", "cancel-http")
      else s.with("phase", "done").with("error", "transport") }
  action cancelHttp(cancellationSucceeds: bool): bool = all { s.phase == "cancel-http",
    s' = s.with("phase", "done").with("cancelAttempted", true).with("error", "http") }
  // 0 valid bytes; 1 bad length header; 2 streamed overflow; 3 stream failure;
  // 4 missing body; 5 invalid UTF-8; 6 invalid JSON; 7 declared-length overflow.
  action readBody(kind: int): bool = all { s.phase == "body", 0.to(7).contains(kind),
    s' = s.with("phase", if (kind == 0) "contract" else "done")
      .with("bodyConsumed", Set(0, 5, 6).contains(kind))
      .with("cancelAttempted", Set(1, 2, 3, 7).contains(kind))
      .with("readerReleased", Set(0, 2, 3, 5, 6).contains(kind))
      .with("error", if (kind == 0) "none" else "body") }
  action inspectContract(valid: bool): bool = all { s.phase == "contract",
    s' = s.with("contractValid", valid).with("phase", if (valid) "ack" else "done")
      .with("error", if (valid) "none" else "contract") }
  // 0 matching true; 1 matching false; 2 missing; 3 another operation;
  // 4 nonboolean. A false has result is an ordinary successful lookup.
  action inspectAcknowledgement(kind: int): bool = {
    val accepted = kind == 0 or (s.operation == "has" and kind == 1)
    all { s.phase == "ack", 0.to(4).contains(kind),
      s' = s.with("phase", "done").with("acknowledgement", kind)
        .with("success", accepted).with("present", s.operation == "has" and kind == 0)
        .with("error", if (accepted) "none" else "acknowledgement") }
  }
  action step = {
    nondet operation = Set("has", "reserve", "complete").oneOf()
    nondet succeeds = Set(false, true).oneOf()
    nondet transportKind = Set(0, 1, 2).oneOf()
    nondet bodyKind = 0.to(7).oneOf()
    nondet ackKind = 0.to(4).oneOf()
    any { construct(succeeds), changeConfig, changeMetadata, beginRequest(operation), sign(succeeds),
      send, serviceCommit, transport(transportKind), cancelHttp(succeeds), readBody(bodyKind),
      inspectContract(succeeds), inspectAcknowledgement(ackKind), s' = s }
  }
  val invariant = all { s.sends <= s.attempts, s.attempts <= 3,
    s.recorded implies s.reserved,
    s.requestConfig != 0 implies s.requestConfig == s.capturedConfig,
    s.sentMetadata != 0 implies s.sentMetadata == s.signedMetadata and s.signedMetadata == s.encodedMetadata,
    s.success implies s.validOrigin and s.contractValid and s.bodyConsumed and s.readerReleased
      and (s.acknowledgement == 0 or (s.operation == "has" and s.acknowledgement == 1)),
    s.success implies s.error == "none",
    s.present implies s.success and s.operation == "has" and s.acknowledgement == 0 }
  action connected = construct(true)
  action request(operation: str): bool = beginRequest(operation).then(sign(true)).then(send)
  action validBody = transport(0).then(readBody(0)).then(inspectContract(true))
  action acknowledged = validBody.then(inspectAcknowledgement(0))
  run exactHttpsOriginRequiredTest = init.then(construct(false)).expect(s.error == "origin" and s.sends == 0 and invariant)
  run factoryConfigurationSurvivesCallerMutationTest = init.then(connected).then(changeConfig).then(request("reserve")).then(acknowledged).expect(s.requestConfig == 1 and s.config == 2 and invariant)
  run encodedMetadataSurvivesSigningYieldTest = init.then(connected).then(beginRequest("reserve")).then(changeMetadata).then(sign(true)).then(send).then(acknowledged).expect(s.sentMetadata == 1 and s.callerMetadata == 2 and invariant)
  run signingFailureNeverFetchesTest = init.then(connected).then(beginRequest("reserve")).then(sign(false)).expect(s.error == "sign" and s.sends == 0 and invariant)
  run truePresencePreservedTest = init.then(connected).then(request("has")).then(acknowledged).expect(s.success and s.present and invariant)
  run falsePresencePreservedTest = init.then(connected).then(request("has")).then(validBody).then(inspectAcknowledgement(1)).expect(s.success and not(s.present) and invariant)
  run nonbooleanPresenceRefusedTest = init.then(connected).then(request("has")).then(validBody).then(inspectAcknowledgement(4)).expect(not(s.success) and s.error == "acknowledgement" and invariant)
  run reserveRequiresTrueAcknowledgementTest = init.then(connected).then(request("reserve")).then(acknowledged).expect(s.success and invariant)
  run reserveFalseAcknowledgementRefusedTest = init.then(connected).then(request("reserve")).then(validBody).then(inspectAcknowledgement(1)).expect(not(s.success) and invariant)
  run reserveMissingAcknowledgementRefusedTest = init.then(connected).then(request("reserve")).then(validBody).then(inspectAcknowledgement(2)).expect(not(s.success) and invariant)
  run reserveWrongOperationRefusedTest = init.then(connected).then(request("reserve")).then(validBody).then(inspectAcknowledgement(3)).expect(not(s.success) and invariant)
  run completeFalseAcknowledgementRefusedTest = init.then(connected).then(request("complete")).then(validBody).then(inspectAcknowledgement(1)).expect(not(s.success) and invariant)
  run completeWrongOperationRefusedTest = init.then(connected).then(request("complete")).then(validBody).then(inspectAcknowledgement(3)).expect(not(s.success) and invariant)
  run wrongSchemaRefusedTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(0)).then(inspectContract(false)).expect(s.error == "contract" and not(s.success) and invariant)
  run httpErrorCancelsWithoutReadingTest = init.then(connected).then(request("reserve")).then(transport(1)).then(cancelHttp(true)).expect(s.error == "http" and s.cancelAttempted and not(s.bodyConsumed) and invariant)
  run cancellationFailurePreservesHttpRefusalTest = init.then(connected).then(request("reserve")).then(transport(1)).then(cancelHttp(false)).expect(s.error == "http" and not(s.success) and invariant)
  run invalidLengthCancelsBeforeReaderTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(1)).expect(s.cancelAttempted and not(s.readerReleased) and not(s.success) and invariant)
  run declaredOverflowCancelsBeforeReaderTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(7)).expect(s.cancelAttempted and not(s.readerReleased) and not(s.bodyConsumed) and not(s.success) and invariant)
  run oversizedBodyCancelsAndUnlocksTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(2)).expect(s.cancelAttempted and s.readerReleased and not(s.success) and invariant)
  run streamFailureCancelsAndUnlocksTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(3)).expect(s.cancelAttempted and s.readerReleased and not(s.success) and invariant)
  run missingBodyCannotConfirmTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(4)).expect(s.error == "body" and not(s.success) and invariant)
  run invalidUtf8CannotConfirmTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(5)).expect(s.bodyConsumed and s.readerReleased and not(s.success) and invariant)
  run malformedJsonCannotConfirmTest = init.then(connected).then(request("reserve")).then(transport(0)).then(readBody(6)).expect(s.bodyConsumed and s.readerReleased and not(s.success) and invariant)
  run lostReplyDoesNotUndoReservationTest = init.then(connected).then(request("reserve")).then(serviceCommit).then(transport(2)).expect(s.reserved and not(s.success) and s.sends == 1 and invariant)
  run malformedReplyDoesNotUndoReservationTest = init.then(connected).then(request("reserve")).then(serviceCommit).then(transport(0)).then(readBody(6)).expect(s.reserved and not(s.success) and invariant)
  run laterPresenceReadRecoversReservedStateTest = init.then(connected).then(request("reserve")).then(serviceCommit).then(transport(2)).then(request("has")).then(acknowledged).expect(s.reserved and s.present and s.sends == 2 and invariant)
  run confirmedReceiptDoesNotChangeOutcomePolicyTest = init.then(connected).then(request("reserve")).then(serviceCommit).then(acknowledged).then(request("complete")).then(serviceCommit).then(acknowledged).expect(s.recorded and s.success and invariant)
  // Pre-fix schema-only write acceptance, excluded from step.
  action oldAcceptSchemaOnly = all { s.phase == "ack", s.operation == "reserve",
    s' = s.with("phase", "done").with("acknowledgement", 2).with("success", true) }
  run oldSchemaOnlyReplyCouldAuthorizePublicationTest = init.then(connected).then(request("reserve")).then(validBody).then(oldAcceptSchemaOnly).expect(s.success and not(s.reserved) and not(invariant))
}
