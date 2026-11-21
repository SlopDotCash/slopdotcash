// @source src/App.tsx
// @evidence tests/e2e/hero-typewriter.spec.ts
// Two representative word lengths replace the four literal campaign strings.
// One pending browser timer; callback and React effect are separate transitions.
// A committed preference change mounts or removes the typewriter; removal
// abstracts its effect cleanup and reset to the complete primary phrase.
// Journey identities share the same reset; the browser tests check their text.
// No timing fairness or browser/React scheduling latency is modeled.
module ui_hero_animation {
  var s: { index: int, characters: int, phase: str, timer: str,
    reduced: bool, mounted: bool }
  def wordLength(index: int): int = if(index == 0) 2 else 3
  def reset(reduced: bool): { index: int, characters: int, phase: str,
    timer: str, reduced: bool, mounted: bool } = {
    index: 0, characters: wordLength(0), phase: "holding",
    timer: "none", reduced: reduced, mounted: true }
  action initWith(reduced: bool): bool = s' = reset(reduced)
  action init = initWith(false)
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
  action mediaChange = all { s.mounted, s' = reset(not(s.reduced)) }
  action journeyChange = all { s.mounted, s' = reset(s.reduced) }
  action remount(reduced: bool): bool = all { not(s.mounted), s' = reset(reduced) }
  action unmount = s' = s.with("mounted", false).with("timer", "none")
  action step = any {effect, fire, mediaChange, journeyChange, unmount,
    remount(true), remount(false), s' = s}
  val invariant = all { Set(0,1).contains(s.index), s.characters >= 0,
    s.characters <= wordLength(s.index), not(s.mounted) implies s.timer == "none",
    s.phase == "holding" implies s.characters == wordLength(s.index),
    s.reduced implies all { s.timer == "none", s.index == 0,
      s.characters == wordLength(0), s.phase == "holding" } }
  run deleteBeforeChangingWordTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire)
    .expect(s.characters == 0 and s.index == 0)
    .then(effect).then(fire).expect(s.index == 1 and s.phase == "typing")
  run finishTypingBeforeHoldingTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire).then(effect).then(fire)
    .then(effect).then(fire).then(effect).then(fire).then(effect).then(fire)
    .then(effect).then(fire).expect(s.characters == 3 and s.phase == "holding")
  run initialReducedMotionCanLaterAnimateTest = initWith(true)
    .expect(s.reduced and s.timer == "none" and s.characters == wordLength(0))
    .then(mediaChange).then(effect).then(fire)
    .expect(not(s.reduced) and s.phase == "deleting")
  run mediaChangeReplacesPartialTextAndCancelsTimerTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(effect).expect(s.characters == 1 and s.timer == "delete")
    .then(mediaChange)
    .expect(s.reduced and s.characters == wordLength(0) and s.timer == "none")
    .then(mediaChange).then(effect)
    .expect(not(s.reduced) and s.characters == wordLength(0) and s.timer == "hold")
  run journeyChangeResetsWithoutChangingPreferenceTest = init.then(effect).then(fire)
    .then(effect).then(fire).then(journeyChange)
    .expect(not(s.reduced) and s.characters == wordLength(0) and s.timer == "none")
    .then(mediaChange).then(journeyChange)
    .expect(s.reduced and s.characters == wordLength(0) and s.timer == "none")
  run remountReadsPreferenceAgainTest = init.then(effect).then(unmount)
    .then(remount(true)).expect(s.mounted and s.reduced and s.timer == "none")
  run departedTimerCannotRemainTest = init.then(effect).then(unmount)
    .expect(not(s.mounted) and s.timer == "none")
}
