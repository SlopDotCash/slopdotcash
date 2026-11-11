// @source workers/slopbot/repository-access.ts
// @source workers/slopbot/repository-access-entrypoint.ts
// @source workers/slopbot/github.ts
// @source backend/github.ts
// Access derives from live installation, immutable repository and actor IDs,
// never a matching mutable login alone. An unavailable lookup grants nothing.
module bot_repository_access {
  var s: { phase: str, installed: bool, token: bool, repoMatches: bool,
    actorMatches: bool, permission: str, answer: str }
  action init = s' = {phase: "initial", installed: false, token: false,
    repoMatches: false, actorMatches: false, permission: "none", answer: "unknown"}
  action installation(active: bool): bool = all { s.phase == "initial",
    s' = s.with("installed", active).with("phase", "installation") }
  action issue = all { s.phase == "installation", s.installed,
    s' = s.with("token", true).with("phase", "token") }
  action identity(repo: bool, actor: bool): bool = all { s.phase == "token",
    s' = s.with("repoMatches", repo).with("actorMatches", actor).with("phase", "identity") }
  action permission(level: str): bool = all { s.phase == "identity", s.repoMatches, s.actorMatches,
    s' = s.with("permission", level).with("phase", "observed").with("answer", level) }
  action unavailable = all { s.phase != "observed", s' = s.with("phase", "failed").with("answer", "unavailable") }
  action step = any { installation(true), installation(false), issue, identity(true, true),
    identity(true, false), identity(false, true), permission("write"), permission("none"), unavailable, s' = s }
  val invariant = s.answer == "write" implies s.token and s.installed and s.repoMatches and s.actorMatches
  run reusedLoginIsNotAuthorityTest = init.then(installation(true)).then(issue).then(identity(true, false))
    .then(unavailable).expect(s.answer == "unavailable")
  run livePermissionTest = init.then(installation(true)).then(issue).then(identity(true, true))
    .then(permission("write")).expect(s.answer == "write" and invariant)
}
