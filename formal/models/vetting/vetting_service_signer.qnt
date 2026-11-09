// @source workers/vetting/service.ts
// @evidence workers/vetting/service.test.ts
// Importer stages preserve source ordering: JSON/schema, private import,
// public import, challenge signing and pair verification precede capability
// return. Bounded outcome classes model failures, not Ed25519 mathematics.
// Native WebCrypto correctly binds JWK bytes and verifies the challenge.
// The parsed JWK is private local state; no caller holds its object reference.
// This model does not authorize deployment, key logging, or a service request.
module vetting_service_signer {
  var s: { phase: str, matchingPair: bool, privateImported: bool,
    publicImported: bool, challengeSigned: bool, pairVerified: bool,
    returned: bool, privateExtractable: bool, publicExtractable: bool,
    genericError: bool }
  action init = s' = { phase: "idle", matchingPair: false,
    privateImported: false, publicImported: false, challengeSigned: false,
    pairVerified: false, returned: false, privateExtractable: false,
    publicExtractable: false, genericError: false }
  action parse(schemaValid: bool, matchingPair: bool): bool = all {
    s.phase == "idle",
    s' = s.with("matchingPair", matchingPair)
      .with("phase", if (schemaValid) "privateImport" else "failed")
      .with("genericError", not(schemaValid))
  }
  action importPrivate(success: bool): bool = all { s.phase == "privateImport",
    s' = s.with("privateImported", success)
      .with("phase", if (success) "publicImport" else "failed")
      .with("genericError", not(success)) }
  action importPublic(success: bool): bool = all { s.phase == "publicImport",
    s' = s.with("publicImported", success).with("publicExtractable", success)
      .with("phase", if (success) "challenge" else "failed")
      .with("genericError", not(success)) }
  action signChallenge(success: bool): bool = all { s.phase == "challenge",
    s' = s.with("challengeSigned", success)
      .with("phase", if (success) "verify" else "failed")
      .with("genericError", not(success)) }
  action verifyPair = all { s.phase == "verify",
    s' = s.with("pairVerified", s.matchingPair)
      .with("phase", if (s.matchingPair) "verified" else "failed")
      .with("genericError", not(s.matchingPair)) }
  action verifyFailure = all { s.phase == "verify",
    s' = s.with("phase", "failed").with("genericError", true) }
  action returnSigner = all { s.phase == "verified", s.pairVerified,
    s' = s.with("returned", true).with("phase", "returned") }
  action step = any { parse(false, false), parse(true, false), parse(true, true),
    importPrivate(false), importPrivate(true), importPublic(false), importPublic(true),
    signChallenge(false), signChallenge(true), verifyPair, verifyFailure,
    returnSigner, s' = s }
  val invariant = all {
    not(s.privateExtractable),
    s.publicImported implies s.privateImported and s.publicExtractable,
    s.challengeSigned implies s.privateImported and s.publicImported,
    s.pairVerified implies s.matchingPair and s.challengeSigned,
    s.returned implies s.pairVerified and s.phase == "returned",
    s.phase == "failed" implies s.genericError and not(s.returned)
  }
  run malformedJsonOrSchemaRefusesTest = init.then(parse(false, false))
    .expect(s.genericError and not(s.privateImported) and not(s.returned))
  run privateImportFailureRefusesTest = init.then(parse(true, true))
    .then(importPrivate(false)).expect(s.genericError and not(s.publicImported))
  run publicImportFailureRefusesTest = init.then(parse(true, true))
    .then(importPrivate(true)).then(importPublic(false))
    .expect(s.genericError and s.privateImported and not(s.returned))
  run challengeSignFailureRefusesTest = init.then(parse(true, true))
    .then(importPrivate(true)).then(importPublic(true)).then(signChallenge(false))
    .expect(s.genericError and not(s.pairVerified))
  run mismatchedPairNeverReturnsTest = init.then(parse(true, false))
    .then(importPrivate(true)).then(importPublic(true)).then(signChallenge(true))
    .then(verifyPair).expect(s.genericError and not(s.returned))
  run verificationExceptionRefusesTest = init.then(parse(true, true))
    .then(importPrivate(true)).then(importPublic(true)).then(signChallenge(true))
    .then(verifyFailure).expect(s.genericError and not(s.returned))
  run matchingPairReturnsNonextractableSignerTest = init.then(parse(true, true))
    .then(importPrivate(true)).then(importPublic(true)).then(signChallenge(true))
    .then(verifyPair).then(returnSigner)
    .expect(s.returned and s.publicExtractable and not(s.privateExtractable))
}
