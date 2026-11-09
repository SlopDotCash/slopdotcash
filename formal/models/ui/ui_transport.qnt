// @source src/lib/browser-json.ts
// @source src/lib/project-api.ts
// JSON bodies retain the request deadline; malformed session payloads are errors.
module ui_transport {
  var s: { phase: str, deadline: bool, schemaValid: bool, signedIn: bool }
  action init = s' = { phase: "headers", deadline: true, schemaValid: false, signedIn: false }
  action headers = all { s.phase == "headers", s' = s.with("phase", "body") }
  action validBody = all { s.phase == "body", s' = s.with("schemaValid", true).with("phase", "parsed") }
  action malformed = all { s.phase == "body", s' = s.with("phase", "error").with("deadline", false) }
  action timeout = all { Set("headers", "body").contains(s.phase), s' = s.with("phase", "timeout").with("deadline", false) }
  action authenticated = all { s.phase == "parsed", s.schemaValid, s' = s.with("signedIn", true).with("phase", "ready").with("deadline", false) }
  action step = any { headers, validBody, malformed, timeout, authenticated, s' = s }
  val invariant = all { s.signedIn implies s.schemaValid, Set("headers", "body").contains(s.phase) implies s.deadline }
  run validTest = init.then(headers).then(validBody).then(authenticated).expect(s.signedIn)
  run invalidTest = init.then(headers).then(malformed).expect(not(s.signedIn))
  run bodyTimeoutTest = init.then(headers).then(timeout).expect(s.phase == "timeout")
}
