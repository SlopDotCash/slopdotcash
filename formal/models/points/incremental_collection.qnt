// @source scripts/collection-memo.ts
// @source scripts/attribution-memo.ts
// @source scripts/restore-collection-memo.py
// @evidence scripts/incremental-collection.test.ts
// @evidence scripts/restore-collection-memo.test.ts
// PRD section 9, operator decision 19 November 2026: incremental collection.
// A commit attribution answer is a function of its live inputs. The memo
// stores each answer with the version of every input it was derived from. A
// run reuses an answer only in incremental mode and only when every recorded
// version still matches; an audit sample is recomputed live and any
// difference discards every reuse in that run. Forced, weekly, changed-code
// and memo-less runs recompute everything. Bounds: two outcomes, two input
// versions per outcome, and one dishonest stored answer that a blind spot in
// the fences could let through (modelled as an entry whose result differs from
// the answer for its own recorded version). The concrete fence fields (pull
// updatedAt, references, incoming cross-references, census values, code
// digest) are abstracted into one version integer per outcome.
module incremental_collection {
  val Outcomes = Set("x", "y")
  val Versions = Set(0, 1)
  type Entry = {present:bool, version:int, result:int}
  pure def answer(version:int): int = version * 10 + 1
  val Absent: Entry = {present:false, version:0, result:0}
  val EntryChoices: Set[Entry] = Set(
    Absent,
    {present:true, version:0, result:answer(0)},
    {present:true, version:1, result:answer(1)},
    {present:true, version:0, result:99})
  pure def honest(entry:Entry): bool =
    not(entry.present) or entry.result == answer(entry.version)
  type State = {phase:str, mode:str, live:str->int, prior:str->Entry,
    audited:Set[str], reused:Set[str], mismatch:bool,
    output:str->int, next:str->Entry}
  var s: State

  pure def modeFor(memoPresent:bool, forced:bool, stale:bool,
    codeChanged:bool): str =
    if (not(memoPresent) or forced or stale or codeChanged) "full"
    else "incremental"

  action initialize(live:str->int, prior:str->Entry, memoPresent:bool,
    forced:bool, stale:bool, codeChanged:bool, audited:Set[str]): bool =
    s' = {phase:"restored",
      mode:modeFor(memoPresent, forced, stale, codeChanged),
      live:live,
      prior:if (memoPresent) prior else Outcomes.mapBy(o => Absent),
      audited:audited, reused:Set(), mismatch:false,
      output:Outcomes.mapBy(o => 0), next:Outcomes.mapBy(o => Absent)}

  action init = {
    nondet live = Outcomes.setOfMaps(Versions).oneOf()
    nondet prior = Outcomes.setOfMaps(EntryChoices).oneOf()
    nondet memoPresent = Set(false, true).oneOf()
    nondet forced = Set(false, true).oneOf()
    nondet stale = Set(false, true).oneOf()
    nondet codeChanged = Set(false, true).oneOf()
    nondet audited = Outcomes.powerset().oneOf()
    initialize(live, prior, memoPresent, forced, stale, codeChanged, audited)
  }

  // Candidates pass every fence: present, incremental, same recorded version.
  val candidates: Set[str] =
    if (s.mode == "incremental")
      Outcomes.filter(o => s.prior.get(o).present
        and s.prior.get(o).version == s.live.get(o))
    else Set()

  action collect = all {
    s.phase == "restored",
    val mismatch = candidates.exists(o => s.audited.contains(o)
      and s.prior.get(o).result != answer(s.live.get(o)))
    val reused = if (mismatch) Set() else candidates.exclude(s.audited)
    s' = s.with("phase", "collected")
      .with("mismatch", mismatch)
      .with("reused", reused)
      .with("output", Outcomes.mapBy(o =>
        if (reused.contains(o)) s.prior.get(o).result
        else answer(s.live.get(o))))
      .with("next", Outcomes.mapBy(o =>
        if (reused.contains(o)) s.prior.get(o)
        else {present:true, version:s.live.get(o), result:answer(s.live.get(o))}))
  }

  action step = any { collect, s' = s }

  val allHonest = Outcomes.forall(o => honest(s.prior.get(o)))
  val invariant = all {
    // Reuse never crosses a fence and never happens outside incremental mode.
    s.reused.forall(o => s.prior.get(o).present
      and s.prior.get(o).version == s.live.get(o)),
    s.mode == "full" implies s.reused == Set(),
    s.mismatch implies s.reused == Set(),
    s.reused.intersect(s.audited) == Set(),
    s.phase == "collected" implies all {
      // Equivalence: with honest entries the output is the full collection's.
      allHonest implies Outcomes.forall(o => s.output.get(o) == answer(s.live.get(o))),
      // The next memo records the live version of every outcome.
      Outcomes.forall(o => s.next.get(o).present
        and s.next.get(o).version == s.live.get(o)),
      allHonest implies Outcomes.forall(o => honest(s.next.get(o))),
      // A wrong stored answer can surface only if it escaped the audit.
      Outcomes.forall(o => s.output.get(o) != answer(s.live.get(o)) implies
        (s.reused.contains(o) and not(honest(s.prior.get(o)))))
    }
  }

  val honestX: Entry = {present:true, version:0, result:answer(0)}
  val wrongX: Entry = {present:true, version:0, result:99}
  run unchangedAnswerIsReusedTest =
    initialize(Map("x" -> 0, "y" -> 1), Map("x" -> honestX, "y" -> Absent),
      true, false, false, false, Set())
    .then(collect)
    .expect(s.reused == Set("x") and s.output.get("x") == answer(0)
      and s.output.get("y") == answer(1) and invariant)
  run changedInputIsRecomputedTest =
    initialize(Map("x" -> 1, "y" -> 0), Map("x" -> honestX, "y" -> Absent),
      true, false, false, false, Set())
    .then(collect)
    .expect(s.reused == Set() and s.output.get("x") == answer(1) and invariant)
  run auditDiscardsEveryReuseTest =
    initialize(Map("x" -> 0, "y" -> 0), Map("x" -> wrongX, "y" -> honestX),
      true, false, false, false, Set("x"))
    .then(collect)
    .expect(s.mismatch and s.reused == Set()
      and s.output.get("x") == answer(0) and invariant)
  run forcedFullNeverReusesTest =
    initialize(Map("x" -> 0, "y" -> 0), Map("x" -> honestX, "y" -> honestX),
      true, true, false, false, Set())
    .then(collect)
    .expect(s.mode == "full" and s.reused == Set() and invariant)
  run changedCodeIsFullTest =
    initialize(Map("x" -> 0, "y" -> 0), Map("x" -> honestX, "y" -> honestX),
      true, false, false, true, Set())
    .then(collect)
    .expect(s.mode == "full" and s.reused == Set() and invariant)
  run weeklyFullTest =
    initialize(Map("x" -> 0, "y" -> 0), Map("x" -> honestX, "y" -> honestX),
      true, false, true, false, Set())
    .then(collect)
    .expect(s.mode == "full" and s.reused == Set() and invariant)
  run missingMemoIsFullTest =
    initialize(Map("x" -> 0, "y" -> 0), Map("x" -> honestX, "y" -> honestX),
      false, false, false, false, Set())
    .then(collect)
    .expect(s.mode == "full" and s.reused == Set() and invariant)
}
