// @source workers/fee-converter/core.ts
// @source workers/fee-converter/store.ts
// @source workers/fee-converter/verified-arithmetic.ts
// Per-run and rolling 24-hour value caps of fee conversions on one network.
//
// runNetwork reads the day total once at run start: the quote value of live
// conversion rows in submitted, unknown or finalized state created in the
// last 24 hours (store.liveValueSince). Each conversion is fitted to
// min(runCap - runValue, dayCap - dayValue) (remainingBudget); a quote above
// it is skipped. A live send that is journaled adds its quote value to both
// in-memory totals; a dry_run quote adds to them in memory only and is never
// counted by later runs. The network lease admits one run; every journal
// insert is fenced by that lease, and a lost lease ends the loop, so a row
// journaled just before the lease check fails is never followed by another
// send in the same run. Rows leave the window as time passes and leave the
// count when proven failed; neither can raise the total, so the run's
// in-memory day value only over-approximates the stored window.
//
// Bounds: three rows, values 1..2, run cap 3, day cap 4.
module fee_value_caps {
  type Row = { value: int, state: str, inWindow: bool, owner: int }
  type S = { rows: int -> Row, active: bool, runMode: str, runId: int, runValue: int, dayValue: int }
  var s: S
  pure val Ids = Set(1, 2, 3)
  pure val RunCap = 3
  pure val DayCap = 4
  pure val Counted = Set("submitted", "unknown", "finalized")
  pure def windowSum(st: S): int = Ids.fold(0, (acc, i) => {
    val r = st.rows.get(i)
    if (r.inWindow and Counted.contains(r.state)) acc + r.value else acc })
  pure def runSum(st: S): int = Ids.fold(0, (acc, i) => {
    val r = st.rows.get(i)
    if (r.owner == st.runId and Counted.contains(r.state)) acc + r.value else acc })
  pure def remaining(st: S): int = {
    val forRun = RunCap - st.runValue
    val day = DayCap - st.dayValue
    if (forRun < day) forRun else day }
  action init = s' = { rows: Ids.mapBy(_ => { value: 0, state: "none", inWindow: false, owner: 0 }),
    active: false, runMode: "none", runId: 0, runValue: 0, dayValue: 0 }
  action start(mode: str): bool = all { not(s.active), s.runId < 3,
    s' = s.with("active", true).with("runMode", mode).with("runId", s.runId + 1)
      .with("runValue", 0).with("dayValue", windowSum(s)) }
  action endRun = all { s.active, s' = s.with("active", false).with("runMode", "none") }
  // A quote fitted to the remaining budget; `broadcastOk` false leaves unknown.
  action convert(id: int, v: int, broadcastOk: bool): bool = all { s.active,
    s.rows.get(id).state == "none", v > 0, v <= remaining(s),
    s' = if (s.runMode == "live")
      s.with("rows", s.rows.set(id, { value: v, state: if (broadcastOk) "submitted" else "unknown",
        inWindow: true, owner: s.runId })).with("runValue", s.runValue + v).with("dayValue", s.dayValue + v)
    else s.with("rows", s.rows.set(id, { value: v, state: "quoted", inWindow: true, owner: s.runId }))
      .with("runValue", s.runValue + v).with("dayValue", s.dayValue + v) }
  // A quote above the remaining budget is skipped and journals no send.
  action skipOverCap(id: int, v: int): bool = all { s.active, s.rows.get(id).state == "none",
    v > remaining(s), s' = s.with("rows", s.rows.set(id, { value: v, state: "skipped", inWindow: true, owner: s.runId })) }
  // The journal insert succeeded, then the lease check failed: the loop ends
  // before counting it in memory.
  action journaledThenLeaseLost(id: int, v: int): bool = all { s.active, s.runMode == "live",
    s.rows.get(id).state == "none", v > 0, v <= remaining(s),
    s' = s.with("rows", s.rows.set(id, { value: v, state: "submitted", inWindow: true, owner: s.runId }))
      .with("active", false).with("runMode", "none") }
  action settle(id: int, finalState: str): bool = all {
    Set("submitted", "unknown").contains(s.rows.get(id).state),
    s' = s.with("rows", s.rows.set(id, s.rows.get(id).with("state", finalState))) }
  action age(id: int): bool = all { s.rows.get(id).inWindow,
    s' = s.with("rows", s.rows.set(id, s.rows.get(id).with("inWindow", false))) }
  action step = any { start("live"), start("dry_run"), endRun,
    nondet id = Ids.oneOf()
    nondet v = Set(1, 2).oneOf()
    nondet ok = Set(true, false).oneOf()
    any { convert(id, v, ok), skipOverCap(id, v), journaledThenLeaseLost(id, v),
      settle(id, "finalized"), settle(id, "failed"), age(id) }, s' = s }
  val invariant = all {
    windowSum(s) <= DayCap,
    s.active implies all { s.runValue <= RunCap, s.dayValue <= DayCap,
      s.dayValue >= windowSum(s), s.runValue >= runSum(s) },
    Ids.forall(i => s.rows.get(i).owner > 0 implies runSum(s) <= RunCap or s.rows.get(i).owner != s.runId) }
  run runCapStopsTest = init.then(start("live")).then(convert(1, 2, true)).then(convert(2, 1, true))
    .expect(remaining(s) == 0).then(skipOverCap(3, 1)).expect(s.rows.get(3).state == "skipped" and invariant)
  run dayCapAcrossRunsTest = init.then(start("live")).then(convert(1, 2, true)).then(convert(2, 1, false))
    .then(endRun).then(start("live")).expect(s.dayValue == 3 and remaining(s) == 1)
    .then(convert(3, 1, true)).expect(windowSum(s) == DayCap and invariant)
  run failedSendFreesBudgetTest = init.then(start("live")).then(convert(1, 2, false)).then(endRun)
    .then(settle(1, "failed")).then(start("live")).expect(s.dayValue == 0 and invariant)
  run agedRowsFreeBudgetTest = init.then(start("live")).then(convert(1, 2, true)).then(convert(2, 1, true))
    .then(endRun).then(age(1)).then(age(2)).then(start("live")).expect(s.dayValue == 0 and remaining(s) == 3)
  run dryRunNotCountedLaterTest = init.then(start("dry_run")).then(convert(1, 2, true)).then(convert(2, 1, true))
    .expect(remaining(s) == 0).then(endRun).then(start("live")).expect(s.dayValue == 0 and invariant)
  run leaseLossEndsRunTest = init.then(start("live")).then(journaledThenLeaseLost(1, 2))
    .then(convert(2, 1, true).fail())
  run leaseLossCountedNextRunTest = init.then(start("live")).then(journaledThenLeaseLost(1, 2))
    .then(start("live")).expect(s.dayValue == 2 and invariant)
}
