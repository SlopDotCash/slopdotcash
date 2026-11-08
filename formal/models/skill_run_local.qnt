// @source skills/project-contributor-template/scripts/run-receipt.mjs
// @source src/lib/run-receipts.ts
// Optional local usage and private trace do not gate submission. Immutable
// completion and exact identity remain required whenever a receipt is issued.
module skill_run_local {
  var s: { local: str, consent: bool, usage: str, trace: str,
    server: str, completion: int, identity: int, openedEvent: bool }
  action init = s' = { local: "absent", consent: false, usage: "unavailable", trace: "none",
    server: "absent", completion: 0, identity: 1, openedEvent: false }
  action start(consent, available) = all { s.local == "absent",
    s' = s.with("local", "active").with("consent", consent)
      .with("usage", if (consent and available) "capturing" else "unavailable") }
  action register = all { s.local == "active", s.server == "absent",
    s' = s.with("server", "awaiting-trace") }
  action upload = all { s.local == "active", s.server == "awaiting-trace",
    s' = s.with("trace", "uploaded").with("server", "trace-uploaded") }
  action finalizeTrace = all { s.server == "trace-uploaded", s' = s.with("server", "finalized") }
  action recordPullRequest = all { s.local == "active", s.server.in(Set("awaiting-trace", "trace-uploaded")),
    s' = s.with("openedEvent", true) }
  action finish = all { s.local == "active", s' = s.with("local", "completed").with("completion", s.identity) }
  action repeatFinish = all { s.local == "completed", s' = s }
  action step = {
    nondet consent = Set(false, true).oneOf()
    nondet available = Set(false, true).oneOf()
    any { start(consent, available), register, upload, finalizeTrace, recordPullRequest, finish, repeatFinish }
  }
  val invariant = all {
    not(s.consent) implies s.usage == "unavailable",
    s.local == "completed" implies s.completion == s.identity,
    s.server == "finalized" implies s.trace == "uploaded",
  }
  run optionalEvidenceDoesNotBlockReceiptTest = init.then(start(false, false)).then(finish).then(repeatFinish)
    .expect(s.local == "completed" and s.trace == "none" and s.usage == "unavailable")
  run recordBeforeFinalizationTest = init.then(start(true, true)).then(register).then(recordPullRequest)
    .then(upload).then(finalizeTrace).then(finish).expect(s.openedEvent and s.server == "finalized")
}
