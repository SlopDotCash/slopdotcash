// @source migrations/0148_trace_licensing.sql
// @source backend/trace-licensing/handler.ts
// @source src/lib/trace-licensing.ts
// @source src/TraceLicensing.tsx
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/handler.ts
// @source backend/points/handler.ts
// @evidence backend/trace-licensing/handler.test.ts
// @evidence backend/trace-licensing/upload-licence.test.ts
// @evidence backend/trace-licensing/closure.test.ts
// @evidence backend/trace-licensing/migration.test.ts
// @evidence tests/e2e/trace-licensing.spec.ts
// Consent records for licensing one member's uploaded traces (private trace
// contract v2; operator decision of 22 November 2026).
// finalize: a run finalizes once; a missing client version reads as v1. Only a
// v2 run finalized while the setting is on, and the account is not banned,
// gets a licence with basis upload, written together with its granted event.
// enable: refused when closed or banned; a toggle to the state in force is a
// no-op that writes nothing. disable: allowed for a banned account; withdraws
// every licensed trace (reason setting_off). optIn / optInAll: only while the
// setting is on and the account is neither closed nor banned; a bulk opt-in
// whose expected count differs from the eligible count (finalized, not
// currently licensed) is refused and writes nothing, so a refusal never
// re-licenses a withdrawn trace. close: withdraws every licence and turns the
// setting off, writing the account_closed event only when the setting was on
// or a licence existed. reopen restores neither. ban: licences stay.
// Invariant: a licence exists only where the trace's latest event is a grant
// (after any withdrawal), the account is not closed and the setting is on.
// Abstracted: two traces, one account, event rows are one latest-event field
// per trace and `wrote`, whether the last action wrote an account event; the
// terms-version stamp conflict, ownership, paging and notices are covered by
// the unit tests. Bounds: eight steps. Source-only; not executed against the
// code.
module api_trace_licensing {
  // ev: 0 none, 1 granted, 2 withdrawn. lic: 0 none, 1 licensed, 2 withdrawn.
  // basis: 0 none, 1 upload, 2 opt_in. v: 1 or 2.
  type Trace = { final: bool, v: int, lic: int, ev: int, basis: int }
  var on: bool
  var closed: bool
  var banned: bool
  var traces: int -> Trace
  var wrote: bool

  val empty: Trace = { final: false, v: 1, lic: 0, ev: 0, basis: 0 }
  def licensedCount(m: int -> Trace): int =
    Set(1, 2).fold(0, (n, i) => if (m.get(i).lic == 1) n + 1 else n)
  def eligibleCount(m: int -> Trace): int =
    Set(1, 2).fold(0, (n, i) => if (m.get(i).final and m.get(i).lic != 1) n + 1 else n)
  def withdrawAll(m: int -> Trace): int -> Trace =
    m.keys().mapBy(i => if (m.get(i).lic == 1) m.get(i).with("lic", 2).with("ev", 2) else m.get(i))

  action init = all {
    on' = false, closed' = false, banned' = false,
    traces' = Map(1 -> empty, 2 -> empty),
    wrote' = false,
  }

  action finalize(i: int, v: int): bool = all {
    v == 1 or v == 2,
    not(traces.get(i).final),
    traces' = traces.set(i,
      if (v == 2 and on and not(banned))
        { final: true, v: v, lic: 1, ev: 1, basis: 1 }
      else traces.get(i).with("final", true).with("v", v)),
    on' = on, closed' = closed, banned' = banned,
    wrote' = false,
  }

  action enable = all {
    not(closed), not(banned), not(on),
    on' = true, closed' = closed, banned' = banned, traces' = traces,
    wrote' = true,
  }

  // Enabling while on, or disabling while off, is a no-op and writes nothing.
  action noopToggle = all {
    not(closed),
    on' = on, closed' = closed, banned' = banned, traces' = traces,
    wrote' = false,
  }

  action disable = all {
    not(closed), on,
    on' = false, closed' = closed, banned' = banned, traces' = withdrawAll(traces),
    wrote' = true,
  }

  action optIn(i: int): bool = all {
    on, not(closed), not(banned),
    traces.get(i).final, traces.get(i).lic != 1,
    traces' = traces.set(i, traces.get(i).with("lic", 1).with("ev", 1).with("basis", 2)),
    on' = on, closed' = closed, banned' = banned,
    wrote' = false,
  }

  action optInAll(expected: int): bool = all {
    on, not(closed), not(banned),
    expected == eligibleCount(traces),
    expected > 0,
    traces' = traces.keys().mapBy(i =>
      if (traces.get(i).final and traces.get(i).lic != 1)
        traces.get(i).with("lic", 1).with("ev", 1).with("basis", 2)
      else traces.get(i)),
    on' = on, closed' = closed, banned' = banned,
    wrote' = true,
  }

  // A stale count (or a switched-off or banned account) is refused: nothing
  // changes, in particular no withdrawn trace becomes licensed.
  action optInRefused(expected: int): bool = all {
    expected != eligibleCount(traces) or not(on) or closed or banned,
    on' = on, closed' = closed, banned' = banned, traces' = traces,
    wrote' = false,
  }

  action close = all {
    not(closed),
    closed' = true,
    on' = false,
    traces' = withdrawAll(traces),
    banned' = banned,
    wrote' = (on or licensedCount(traces) > 0),
  }

  action reopen = all {
    closed,
    closed' = false, on' = on, banned' = banned, traces' = traces,
    wrote' = false,
  }

  action ban = all {
    banned' = true, on' = on, closed' = closed, traces' = traces,
    wrote' = false,
  }

  action step = any {
    finalize(1, 1), finalize(1, 2), finalize(2, 1), finalize(2, 2),
    enable, noopToggle, disable,
    optIn(1), optIn(2), optInAll(1), optInAll(2), optInRefused(0), optInRefused(1),
    close, reopen, ban,
  }

  val licenceBacked = Set(1, 2).forall(i =>
    traces.get(i).lic == 1 implies (traces.get(i).ev == 1 and traces.get(i).final))
  val grantBacked = Set(1, 2).forall(i =>
    traces.get(i).ev == 1 implies traces.get(i).lic == 1)
  val licensedNeedsConsent = Set(1, 2).forall(i =>
    traces.get(i).lic == 1 implies (on and not(closed)))
  val uploadBasisIsV2 = Set(1, 2).forall(i =>
    traces.get(i).basis == 1 implies traces.get(i).v == 2)
  val closedHoldsNothing = closed implies (not(on) and licensedCount(traces) == 0)
  val invariant = all {
    licenceBacked, grantBacked, licensedNeedsConsent, uploadBasisIsV2,
    closedHoldsNothing,
  }

  run uploadWhileOnTest = init.then(enable).then(finalize(1, 2)).then(finalize(2, 1))
    .expect(traces.get(1).lic == 1 and traces.get(1).basis == 1
      and traces.get(2).lic == 0 and traces.get(2).v == 1)
  run turnOffWithdrawsTest = init.then(enable).then(finalize(1, 2)).then(disable)
    .then(optInRefused(1))
    .expect(traces.get(1).lic == 2 and traces.get(1).ev == 2 and not(on))
  run closeWithdrawsTest = init.then(enable).then(finalize(1, 2)).then(close).then(reopen)
    .expect(closed == false and not(on) and traces.get(1).lic == 2)
  run staleCountRefusedTest = init.then(enable).then(finalize(1, 1)).then(finalize(2, 1))
    .then(optInRefused(1)).expect(licensedCount(traces) == 0)
    .then(optInAll(2)).expect(licensedCount(traces) == 2)
  run bannedTurnsOffTest = init.then(enable).then(finalize(1, 2)).then(ban).then(disable)
    .then(optInRefused(1)).expect(banned and traces.get(1).lic == 2)
  run noopWritesNothingTest = init.then(enable).then(noopToggle).expect(not(wrote) and on)
  run closeNothingToWithdrawTest = init.then(close).expect(not(wrote) and closed)
  run closeWithLicenceWritesTest = init.then(enable).then(close).expect(wrote and not(on))
}
