// @source scripts/qualification-response.ts
// One bounded body is consumed, parsed and rebuilt for the SDK. Failure or
// oversize cancels intake and supplies no successful SDK response.
module qualification_response_body {
  var s: { phase: str, chunks: int, originalRead: bool, parsed: bool,
    replay: bool, exact: bool, cancelled: bool, costKnown: bool }
  action init = s' = {phase: "unread", chunks: 0, originalRead: false, parsed: false,
    replay: false, exact: false, cancelled: false, costKnown: false}
  action start = all { s.phase == "unread", s' = s.with("phase", "reading") }
  action chunk = all { s.phase == "reading", s.chunks < 2, s' = s.with("chunks", s.chunks + 1) }
  action overflowOrReadFailure = all { s.phase == "reading", s' = s.with("phase", "failed").with("cancelled", true) }
  action complete(validJson: bool, costKnown: bool): bool = all { s.phase == "reading",
    s' = s.with("originalRead", true).with("parsed", validJson).with("costKnown", costKnown)
      .with("phase", if (validJson) "parsed" else "failed") }
  action rebuild = all { s.phase == "parsed", s.parsed,
    s' = s.with("replay", true).with("exact", true).with("phase", "complete") }
  action step = any { start, chunk, overflowOrReadFailure, complete(true, true), complete(true, false),
    complete(false, false), rebuild, s' = s }
  val invariant = all { s.replay implies s.originalRead and s.parsed and s.exact,
    s.cancelled implies not(s.replay) }
  run rebuiltBodyKeepsUnknownCostTest = init.then(start).then(chunk).then(complete(true, false)).then(rebuild)
    .expect(s.replay and not(s.costKnown))
  run overflowCannotReplayTest = init.then(start).then(chunk).then(overflowOrReadFailure)
    .expect(s.cancelled and not(s.replay))
}
