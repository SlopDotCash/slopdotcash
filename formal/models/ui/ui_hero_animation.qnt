// @source src/App.tsx
// @evidence tests/e2e/hero-typewriter.spec.ts
// Two representative word lengths replace the four literal campaign strings.
// One pending browser timer; callback and React effect are separate transitions.
// Media changes alone do not rerun the source effect. No timing fairness assumed.
module ui_hero_animation {
  var s: { index: int, characters: int, phase: str, timer: str,
    reduced: bool, mounted: bool }
  def wordLength(index: int): int = if(index == 0) 2 else 3
  action init = s' = { index: 0, characters: 2, phase: "holding",
    timer: "none", reduced: false, mounted: true }
  action effect = all { s.mounted, s.timer == "none", not(s.reduced),
    s' = s.with("timer", if(s.phase == "holding") "hold"
      else if(s.phase == "deleting" and s.characters > 0) "delete"
      else if(s.phase == "deleting") "gap"
      else if(s.characters < wordLength(s.index)) "type" else "settle") }
  action fire = all { s.mounted, s.timer != "none",
    s' = (if(s.timer == "hold") s.with("phase", "deleting")
      else if(s.timer == "delete") s.with("characters", s.characters - 1)
      else if(s.timer == "gap") s.with("index", (s.index + 1) % 2).with("phase", "typing")
      else if(s.timer == "type") s.with("characters", s.characters + 1)
      else s.with("phase", "holding")).with("timer", "none") }
  action mediaChange = all { s.mounted, s' = s.with("reduced", not(s.reduced)) }
  action unmount = s' = s.with("mounted", false).with("timer", "none")
  action step = any {effect, fire, mediaChange, unmount, s' = s}
  val invariant = all { Set(0,1).contains(s.index), s.characters >= 0,
    s.characters <= wordLength(s.index), not(s.mounted) implies s.timer == "none",
    s.phase == "holding" implies s.characters == wordLength(s.index) }
  run deleteBeforeChangingWordTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire)
    .expect(s.characters == 0 and s.index == 0)
    .then(effect).then(fire).expect(s.index == 1 and s.phase == "typing")
  run finishTypingBeforeHoldingTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire).then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire).then(effect).then(fire)
    .then(effect).then(fire).expect(s.characters == 3 and s.phase == "holding")
  run initialReducedMotionDoesNotScheduleTest = init.then(mediaChange)
    .expect(s.reduced and s.timer == "none" and s.characters == 2)
  run pendingTimerMayFinishAfterMediaChangeTest = init.then(effect).then(mediaChange)
    .then(fire).expect(s.reduced and s.phase == "deleting" and s.timer == "none")
  run departedTimerCannotRemainTest = init.then(effect).then(unmount)
    .expect(not(s.mounted) and s.timer == "none")
}
