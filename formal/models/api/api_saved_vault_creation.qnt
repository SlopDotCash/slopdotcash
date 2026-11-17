// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/contracts.ts
// @source migrations/0132_saved_vault_creations.sql
// @evidence scripts/project-self-service.test.ts
// One vault creation and the owner's register request the server keeps for it.
// The owner route saves the request when the creation is not final yet. A
// sweep behind later project API requests repeats that request as the same
// account through the same route: current access and finalized chain evidence
// are checked again at that time. The saved request ends when the vault
// registers (by the owner or the sweep), when the creation is refused, or
// when it is two days old; an expired one waits again if the owner asks again.
// Abstracted: one project, one creation; the route's other checks (ban,
// restriction, policy compatibility) fold into "access"; four sweep checks
// stand for the source's two-day schedule; the atomic claim of a due check is
// one step. Source-only; not executed against the code.
module api_saved_vault_creation {
  var s: { chain: str, saved: str, access: bool, old: bool, vault: bool,
    granted: bool, checks: int }
  pure val LIMIT = 4
  action init = s' = { chain: "absent", saved: "none", access: true, old: false,
    vault: false, granted: false, checks: 0 }
  action include = all { s.chain == "absent", s' = s.with("chain", "included") }
  action finalize = all { s.chain == "included", s' = s.with("chain", "final") }
  action revert = all { s.chain == "absent" or s.chain == "included",
    s' = s.with("chain", "failed") }
  action loseAccess = all { s.access, s' = s.with("access", false) }
  action regainAccess = all { not(s.access), s' = s.with("access", true) }
  action age = all { s.saved == "waiting", not(s.old), s' = s.with("old", true) }
  // The owner's own request. Without access the route refuses and changes nothing.
  action ownerAsk = all { s.access,
    s' = if (s.vault) s.with("saved", if (s.saved == "waiting") "registered" else s.saved)
      else if (s.chain == "failed") s
      else if (s.chain != "final")
        (if (s.saved == "none" or s.saved == "expired")
          s.with("saved", "waiting").with("old", false).with("checks", 0)
        else s)
      else s.with("vault", true).with("granted", s.access)
        .with("saved", if (s.saved == "waiting") "registered" else s.saved) }
  // One due check of the saved request, repeated as the account that made it.
  action sweep = all { s.saved == "waiting", s.checks < LIMIT,
    s' = if (s.old) s.with("saved", "expired")
      else if (not(s.access)) s.with("checks", s.checks + 1)
      else if (s.vault) s.with("checks", s.checks + 1).with("saved", "registered")
      else if (s.chain == "failed") s.with("checks", s.checks + 1).with("saved", "refused")
      else if (s.chain != "final") s.with("checks", s.checks + 1)
      else s.with("checks", s.checks + 1).with("vault", true)
        .with("granted", s.access).with("saved", "registered") }
  action step = any { include, finalize, revert, loseAccess, regainAccess, age,
    ownerAsk, sweep, s' = s }
  val invariant = all {
    s.vault implies (s.chain == "final" and s.granted),
    s.saved == "registered" implies s.vault,
    s.saved == "refused" implies (s.chain == "failed" and not(s.vault)),
    s.checks <= LIMIT
  }
  run serverFinishesTest = init.then(include).then(ownerAsk)
    .expect(s.saved == "waiting" and not(s.vault))
    .then(sweep).expect(not(s.vault) and s.checks == 1)
    .then(finalize).then(sweep).expect(s.vault and s.saved == "registered")
  run lostAccessWaitsTest = init.then(ownerAsk).then(include).then(finalize)
    .then(loseAccess).then(sweep).expect(not(s.vault) and s.saved == "waiting")
    .then(regainAccess).then(sweep).expect(s.vault and s.granted)
  run failedCreationEndsTest = init.then(ownerAsk).then(revert).then(sweep)
    .expect(s.saved == "refused" and not(s.vault))
  run ownerClosesSavedRequestTest = init.then(include).then(ownerAsk).then(finalize)
    .then(ownerAsk).expect(s.vault and s.saved == "registered")
  run expiryEndsWithoutRegisteringTest = init.then(include).then(ownerAsk).then(finalize)
    .then(age).then(sweep).expect(s.saved == "expired" and not(s.vault))
  run expiredRequestWaitsAgainTest = init.then(ownerAsk).then(age).then(sweep)
    .expect(s.saved == "expired").then(ownerAsk)
    .expect(s.saved == "waiting" and not(s.old) and s.checks == 0)
}
