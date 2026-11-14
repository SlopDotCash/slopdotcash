// @source src/ReferralCode.tsx
// @evidence tests/e2e/referral-code.spec.ts
// The Settings section for one signed-in member. The name in use arrives with
// the member record, so the section has no read of its own. The section is
// keyed by the account, so an account change remounts it: `life` counts
// mounts, a save keeps the life it began under, and an answer for an earlier
// life is dropped. code 0 means no name in use; names are 1 and 2. At most two
// mounts follow the first. The server's decision is an input; `referral_code`
// models it. A refused or failed save keeps the name shown.
module ui_referral_code {
  type S = { life: int, code: int, save: int, stale: int, busy: bool, saved: bool,
    error: bool }
  var s: S
  action init = s' = { life: 1, code: 0, save: 0, stale: 0, busy: false, saved: false,
    error: false }
  action edit = all { not(s.busy), s' = s.with("saved", false) }
  action submit(valid: bool): bool = all { not(s.busy),
    s' = if (valid) s.with("busy", true).with("save", s.life).with("saved", false)
        .with("error", false)
      else s.with("saved", false).with("error", true) }
  action saveAnswer(ok: bool, code: int): bool = all { s.save == s.life, s.busy,
    code >= 1, code <= 2,
    s' = s.with("save", 0).with("busy", false)
      .with("code", if (ok) code else s.code).with("saved", ok).with("error", not(ok)) }
  // Another account's member record arrives with its own name in use.
  action accountChange(code: int): bool = all { s.life < 3, code >= 0, code <= 2,
    s' = { life: s.life + 1, code: code, save: 0,
      stale: s.stale + (if (s.save != 0) 1 else 0),
      busy: false, saved: false, error: false } }
  // An answer for an earlier mount arrives and changes nothing shown.
  action staleAnswer = all { s.stale > 0, s' = s.with("stale", s.stale - 1) }
  action step = any {
    edit,
    { nondet valid = Set(false, true).oneOf()
      submit(valid) },
    { nondet ok = Set(false, true).oneOf()
      nondet code = Set(1, 2).oneOf()
      saveAnswer(ok, code) },
    { nondet code = Set(0, 1, 2).oneOf()
      accountChange(code) },
    staleAnswer }
  val invariant = and {
    // Saving is exactly one request in flight for this mount.
    s.busy == (s.save == s.life),
    // Saved names the name now in use and never shows with an error or a save.
    s.saved implies (s.code != 0 and not(s.error) and not(s.busy)),
    s.busy implies not(s.error) }
  run savedNameShowsAndARefusalKeepsItTest = init
    .then(submit(false)).expect(s.error and not(s.busy))
    .then(submit(true)).expect(s.busy and not(s.error))
    .then(saveAnswer(true, 1)).expect(s.saved and s.code == 1)
    .then(edit).expect(not(s.saved))
    .then(submit(true)).then(saveAnswer(false, 2))
    .expect(s.error and s.code == 1 and not(s.saved))
  run secondSaveWaitsForTheFirstTest = init.then(submit(true)).then(submit(true).fail())
  run accountChangeDropsAnEarlierSaveTest = init
    .then(submit(true))
    .then(accountChange(2)).expect(s.code == 2 and not(s.busy) and not(s.saved))
    .then(staleAnswer).expect(s.code == 2 and not(s.saved) and not(s.error))
  run earlierSaveCannotAnswerAfterAccountChangeTest = init
    .then(submit(true)).then(accountChange(0)).then(saveAnswer(true, 2).fail())
}
