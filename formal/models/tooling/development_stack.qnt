// @source scripts/dev-backend.ts
// @source scripts/dev-private-storage.ts
// @source scripts/dev-r2-server.mjs
// @source scripts/dev-backend-notify.ts
// @source scripts/dev-mail-capture.ts
// @source scripts/dev-private-paths.ts
// Local services share real handlers but keep data, assertions and captured
// mail separate from production. Shutdown does not claim pending work finished.
module development_stack {
  var s: { phase: str, database: bool, storage: bool, loopback: bool,
    signer: bool, pending: bool, mailCaptured: bool, mailSent: bool, privateRead: bool }
  action init = s' = { phase: "stopped", database: false, storage: false, loopback: true,
    signer: false, pending: false, mailCaptured: false, mailSent: false, privateRead: false }
  action migrate = all { s.phase == "stopped", s' = s.with("database", true).with("phase", "starting") }
  action startStorage = all { s.phase == "starting", s' = s.with("storage", true) }
  action listen = all { s.phase == "starting", s.database, s.storage, s.loopback, not(s.signer),
    s' = s.with("phase", "ready") }
  action request = all { s.phase == "ready", s' = s.with("pending", true) }
  action finishRequest = all { s.phase == "ready", s.pending, s' = s.with("pending", false) }
  action captureMail = all { s.phase == "ready", s' = s.with("mailCaptured", true) }
  action readMail(authorized) = all { s.phase == "ready", authorized,
    s' = s.with("privateRead", true) }
  action stop = all { s.phase == "ready", s' = s.with("phase", "stopped").with("storage", false) }
  action step = {
    nondet authorized = Set(false, true).oneOf()
    any { migrate, startStorage, listen, request, finishRequest, captureMail, readMail(authorized), stop }
  }
  val invariant = all {
    s.phase == "ready" implies (s.database and s.storage and s.loopback and not(s.signer)),
    not(s.mailSent),
  }
  run pendingShutdownIsNotCompletionTest = init.then(migrate).then(startStorage).then(listen)
    .then(request).then(stop).expect(s.pending and s.phase == "stopped")
  run localMailIsCapturedOnlyTest = init.then(migrate).then(startStorage).then(listen)
    .then(captureMail).then(readMail(true)).expect(s.mailCaptured and not(s.mailSent))
}
