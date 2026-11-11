// @source src/lib/profiles.ts
// @source src/lib/profile-activity.ts
// Visible issue close/reopen history must reproduce state/reason, or be
// explicitly flagged incomplete. Retirement preserves history outside display.
module ui_profile_history {
  var current: str
  var replayed: str
  var incomplete: bool
  var active: bool
  var accepted: bool
  var events: int
  action init = all { current' = "open", replayed' = "open", incomplete' = false,
    active' = true, accepted' = false, events' = 0 }
  action close = all { events < 2, current' = "closed", replayed' = "closed",
    incomplete' = false, accepted' = false, active' = active, events' = events + 1 }
  action reopen = all { events < 2, current' = "open", replayed' = "open",
    incomplete' = false, accepted' = false, active' = active, events' = events + 1 }
  action hiddenClose = all { current' = "closed", replayed' = "open",
    incomplete' = true, accepted' = false, active' = active, events' = events }
  action missingIncompleteFlag = all { incomplete' = false, accepted' = false,
    current' = current, replayed' = replayed, active' = active, events' = events }
  action spuriousIncompleteFlag = all { incomplete' = true, accepted' = false,
    current' = current, replayed' = replayed, active' = active, events' = events }
  action retire = all { active' = false, current' = current, replayed' = replayed,
    incomplete' = incomplete, accepted' = accepted, events' = events }
  action reactivate = all { active' = true, current' = current, replayed' = replayed,
    incomplete' = incomplete, accepted' = accepted, events' = events }
  val coherent = (current != replayed) == incomplete
  action validate = all { accepted' = coherent, current' = current,
    replayed' = replayed, incomplete' = incomplete, active' = active, events' = events }
  action step = any { close, reopen, hiddenClose, missingIncompleteFlag,
    spuriousIncompleteFlag, retire, reactivate, validate }
  val invariant = accepted implies coherent
  run reopenTest = init.then(close).then(reopen).then(validate).expect(accepted and current == "open")
  run hiddenHistoryTest = init.then(hiddenClose).then(validate).expect(accepted and incomplete)
  run unflaggedHistoryTest = init.then(hiddenClose).then(missingIncompleteFlag).then(validate).expect(not(accepted))
  run overflaggedHistoryTest = init.then(spuriousIncompleteFlag).then(validate).expect(not(accepted))
  run retirementTest = init.then(close).then(retire).then(reactivate).then(validate).expect(accepted and events == 1)
}
