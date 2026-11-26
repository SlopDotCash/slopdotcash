// @source scripts/accepted-implementation-memo.ts
// @source scripts/collection-memo.ts
// @source scripts/generate-leaderboard.ts
// @evidence scripts/accepted-implementation-memo.test.ts
// @evidence scripts/leaderboard-source-recovery.test.ts
// PRD section 11, operator decision 25 November 2026: the accepted
// implementation memo survives code changes. A saved entry is a fact about
// immutable Git objects or a merged pull request, keyed by their identities.
// A restored memo is used unless it was written under another rules version
// (or is absent or unreadable); changed code alone only enlarges the audit
// sample, abstracted here by the nondeterministic audit set. An audited entry
// is read live before use. A definitive live read that differs discards every
// saved entry and the evidence is read once more with nothing saved; a live
// read that proves nothing leaves the saved entry in use, as for an unaudited
// one. Bounds: two sources, one true value per source, a live read that is
// either definitive or proves nothing, and saved entries that are absent,
// honest or wrong (a wrong one is what a rules change without a version
// raise, or a damaged memo, would leave behind).
module implementation_memo_audit {
  val Sources = Set("x", "y")
  val Truth = 1
  val Wrong = 9
  // Saved: 0 absent, Truth honest, Wrong dishonest. Live: 0 proves nothing.
  type State = {phase:str, usable:bool, saved:str->int, live:str->int,
    audited:Set[str], reused:Set[str], mismatch:bool, passes:int,
    output:str->int, next:str->int}
  var s: State

  action initialize(saved:str->int, live:str->int, memoPresent:bool,
    rulesChanged:bool, audited:Set[str]): bool =
    s' = {phase:"restored", usable:memoPresent and not(rulesChanged),
      saved:if (memoPresent and not(rulesChanged)) saved
        else Sources.mapBy(o => 0),
      live:live, audited:audited, reused:Set(), mismatch:false, passes:0,
      output:Sources.mapBy(o => 0), next:Sources.mapBy(o => 0)}

  action init = {
    nondet saved = Sources.setOfMaps(Set(0, Truth, Wrong)).oneOf()
    nondet live = Sources.setOfMaps(Set(0, Truth)).oneOf()
    nondet memoPresent = Set(false, true).oneOf()
    nondet rulesChanged = Set(false, true).oneOf()
    nondet audited = Sources.powerset().oneOf()
    initialize(saved, live, memoPresent, rulesChanged, audited)
  }

  val hits: Set[str] = Sources.filter(o => s.saved.get(o) != 0)
  // An audited hit with a definitive live read that differs.
  val differs: bool = hits.exists(o => s.audited.contains(o)
    and s.live.get(o) != 0 and s.saved.get(o) != s.live.get(o))

  // One pass over the evidence. A difference discards every saved entry.
  action read = all {
    s.phase == "restored" or s.phase == "discarded",
    if (differs)
      s' = s.with("phase", "discarded").with("mismatch", true)
        .with("saved", Sources.mapBy(o => 0)).with("audited", Set())
        .with("passes", s.passes + 1)
    else
      // A hit is used unless its audit read was definitive (then live is used
      // and equals it); everything else is live.
      val reused = hits.filter(o => not(s.audited.contains(o))
        or s.live.get(o) == 0)
      s' = s.with("phase", "done").with("reused", reused)
        .with("passes", s.passes + 1)
        .with("output", Sources.mapBy(o =>
          if (reused.contains(o)) s.saved.get(o) else s.live.get(o)))
        .with("next", Sources.mapBy(o =>
          if (s.live.get(o) != 0) s.live.get(o) else s.saved.get(o)))
  }

  action step = any { read, s' = s }

  val allHonest = Sources.forall(o => s.saved.get(o) != Wrong)
  val invariant = all {
    not(s.usable) implies s.reused == Set(),
    s.mismatch implies (s.reused == Set() and hits == Set()),
    // At most one extra pass, and only after a difference.
    s.passes <= 2,
    s.passes == 2 implies s.mismatch,
    s.phase == "done" implies all {
      // A definitive live read always decides its own source.
      s.reused.forall(o => s.saved.get(o) != 0),
      // With honest entries every output is true or, where neither a saved
      // entry nor a live read exists, absent.
      allHonest implies Sources.forall(o =>
        s.output.get(o) == Truth or s.output.get(o) == 0),
      // After a discard the result is exactly the memo-less one.
      s.mismatch implies Sources.forall(o => s.output.get(o) == s.live.get(o)),
      // A wrong value can surface only from a reused dishonest entry that
      // escaped the audit sample or whose audit read proved nothing.
      Sources.forall(o => s.output.get(o) == Wrong implies
        (s.reused.contains(o) and s.saved.get(o) == Wrong
          and (not(s.audited.contains(o)) or s.live.get(o) == 0)))
    }
  }

  run savedEntryIsReusedAcrossCodeChangeTest =
    initialize(Map("x" -> Truth, "y" -> 0), Map("x" -> Truth, "y" -> Truth),
      true, false, Set())
    .then(read)
    .expect(s.reused == Set("x") and s.output.get("x") == Truth
      and s.output.get("y") == Truth and s.passes == 1 and invariant)
  run changedRulesDiscardsMemoTest =
    initialize(Map("x" -> Truth, "y" -> Truth), Map("x" -> Truth, "y" -> Truth),
      true, true, Set())
    .then(read)
    .expect(not(s.usable) and s.reused == Set() and invariant)
  run missingMemoReadsLiveTest =
    initialize(Map("x" -> Truth, "y" -> Truth), Map("x" -> Truth, "y" -> 0),
      false, false, Set())
    .then(read)
    .expect(s.reused == Set() and s.output.get("y") == 0 and invariant)
  run matchingAuditKeepsMemoTest =
    initialize(Map("x" -> Truth, "y" -> Truth), Map("x" -> Truth, "y" -> Truth),
      true, false, Set("x"))
    .then(read)
    .expect(not(s.mismatch) and s.reused == Set("y") and s.passes == 1
      and invariant)
  run auditDifferenceDiscardsEverySavedEntryTest =
    initialize(Map("x" -> Wrong, "y" -> Wrong), Map("x" -> Truth, "y" -> Truth),
      true, false, Set("x"))
    .then(read)
    .expect(s.phase == "discarded" and s.mismatch and invariant)
    .then(read)
    .expect(s.phase == "done" and s.reused == Set() and s.passes == 2
      and s.output.get("x") == Truth and s.output.get("y") == Truth
      and invariant)
  run inconclusiveAuditKeepsSavedEntryTest =
    initialize(Map("x" -> Truth, "y" -> 0), Map("x" -> 0, "y" -> Truth),
      true, false, Set("x"))
    .then(read)
    .expect(not(s.mismatch) and s.reused == Set("x")
      and s.output.get("x") == Truth and invariant)
}
