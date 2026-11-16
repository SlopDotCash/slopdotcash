// @source workers/payments/index.ts
// @source migrations/0083_monthly_execution_attempts.sql
// @source workers/payment-executor/monthly.ts
// @source workers/payment-executor/core.ts
// The monthly commitment cron (`runMonthlyCommitments`) and its cursor in
// `monthly_payment_execution`. Each pass selects the K least recently
// attempted incomplete rows (ORDER BY last_attempt, period, project_id), where
// a row is a candidate when its period is the active one or it is an EVM V2
// (or Solana) authorization. It adds every current-period V2 row that shares
// a vault with an older selected V2 row, sorts newest period first, stamps
// last_attempt before any work, and runs each item; a thrown failure is
// collected and the next item still runs. `complete=1` is written only on the
// executor's `complete: true` for V2, or on `alreadyCommitted && complete !==
// false` for a legacy root. The EVM executor (core.ts) reserves a V2 root only
// with admission and a reservation signed at the vault's current
// ordinarySourceSequence (otherwise MonthlySourceChanged reverts it),
// materializes leaves of an admitted root (each advances the sequence), and
// reports completion only once no leaf remains. A reattestation (0083) appends
// an authorization signed at the current sequence.
//
// Abstractions: one vault and project; period 1 is older (window closed),
// period 2 is current until `tick` closes its window; automatic payment is
// on. A submitted transaction is mined in submission order within the pass.
// One executor call materializes at most one leaf. last_attempt values are
// kept as normalized ranks (0 = never). Solana rows are resumable like V2 but
// touch no EVM sequence, so they are left out. A legacy row is a candidate
// only while its period is active: a legacy root admitted just before the
// window closes keeps complete=0 after that (its single transaction already
// committed every award). Bounds: K in 1..2, leaves 0..2, at most two
// executor failures over a run.
module monthly_commit_cursor {
  type Row = { kind: str, root: bool, leaves: int, complete: bool, stamp: int, signedSeq: int }
  type W = { rows: int -> Row, seq: int, failures: int, leafMined: bool, sourceChanged: bool }
  type S = { rows: int -> Row, seq: int, failures: int, k: int, windowOpen: bool,
    sourceChanged: bool }
  var s: S
  pure val Periods = Set(1, 2)
  pure val MaxFailures = 2

  action initWith(k: int, oldRoot: bool, oldLeaves: int, curKind: str, curLeaves: int): bool =
    s' = { rows: Map(
        1 -> { kind: "v2", root: oldRoot, leaves: oldLeaves, complete: false, stamp: 0, signedSeq: 0 },
        2 -> { kind: curKind, root: false, leaves: curLeaves, complete: false, stamp: 0, signedSeq: 0 }),
      seq: 0, failures: 0, k: k, windowOpen: true, sourceChanged: false }
  action init = {
    nondet k = Set(1, 2).oneOf()
    nondet oldRoot = Set(false, true).oneOf()
    nondet oldLeaves = 0.to(2).oneOf()
    nondet curKind = Set("v2", "legacy").oneOf()
    nondet curLeaves = 1.to(2).oneOf()
    initWith(k, oldRoot, oldLeaves, curKind, curLeaves) }

  def active(p: int): bool = p == 2 and s.windowOpen
  def candidates: Set[int] = Periods.filter(p => {
    val r = s.rows.get(p)
    not(r.complete) and (active(p) or r.kind == "v2") })
  def before(a: int, b: int): bool = {
    val ra = s.rows.get(a)
    val rb = s.rows.get(b)
    ra.stamp < rb.stamp or (ra.stamp == rb.stamp and a < b) }
  def selected: Set[int] =
    if (candidates.size() <= s.k) candidates
    else candidates.filter(p => candidates.forall(q => q == p or before(p, q)))
  // Omitted current-period V2 roots of the same vault as an older selected V2 row.
  def items: Set[int] = selected.union(
    if (active(2) and candidates.contains(2) and s.rows.get(2).kind == "v2"
      and selected.contains(1) and s.rows.get(1).kind == "v2") Set(2) else Set())

  def setRow(w: W, p: int, r: Row): W = w.with("rows", w.rows.set(p, r))
  def handle(w: W, p: int, failed: bool): W = {
    val r = w.rows.get(p)
    val admit = active(p)
    if (failed) w.with("failures", w.failures + 1)
    else if (not(admit) and r.kind != "v2") w
    else if (r.kind == "v2")
      if (not(r.root))
        if (not(admit)) w // notAdmitted: continue
        else if (r.signedSeq == w.seq) setRow(w, p, r.with("root", true))
        // MonthlySourceChanged: the reservation transaction reverts.
        else w.with("sourceChanged", w.sourceChanged or w.leafMined)
      else if (r.leaves > 0)
        setRow(w, p, r.with("leaves", r.leaves - 1)).with("seq", w.seq + 1).with("leafMined", true)
      else setRow(w, p, r.with("complete", true))
    // Legacy commitMonthly records every new award in one transaction.
    else if (not(r.root))
      setRow(w, p, r.with("root", true).with("leaves", 0)).with("seq", w.seq + r.leaves)
    else setRow(w, p, r.with("complete", true)) }

  // 0 = never attempted; otherwise 1 + the number of distinct earlier stamps.
  pure def rank(stamps: int -> int, p: int): int =
    if (stamps.get(p) == 0) 0
    else 1 + Periods.filter(q => stamps.get(q) > 0 and stamps.get(q) < stamps.get(p))
      .map(q => stamps.get(q)).size()
  action pass(f1: bool, f2: bool, newestFirst: bool): bool = {
    val n = items.size()
    val first = if (newestFirst) (if (items.contains(2)) 2 else 1) else (if (items.contains(1)) 1 else 2)
    val second = if (first == 2) 1 else 2
    val w0 = { rows: s.rows, seq: s.seq, failures: s.failures, leafMined: false, sourceChanged: false }
    val w1 = if (n >= 1) handle(w0, first, f1) else w0
    val w = if (n >= 2) handle(w1, second, f2) else w1
    // Every selected item was stamped first; ranks keep only the LRU order.
    val stamps = Periods.mapBy(p => if (items.contains(p)) 3 else s.rows.get(p).stamp)
    all { w.failures <= MaxFailures, n >= 1 or not(f1), n >= 2 or not(f2),
      s' = s.with("rows", Periods.mapBy(p => w.rows.get(p).with("stamp", rank(stamps, p))))
        .with("seq", w.seq).with("failures", w.failures)
        .with("sourceChanged", s.sourceChanged or w.sourceChanged) } }
  action runPass(f1: bool, f2: bool): bool = pass(f1, f2, true)
  // Counter-example ordering only; never part of `step`.
  action runPassOldestFirst(f1: bool, f2: bool): bool = pass(f1, f2, false)
  action passAny = {
    nondet f1 = Set(false, true).oneOf()
    nondet f2 = Set(false, true).oneOf()
    runPass(f1, f2) }
  // 0083: a fresh authorization signed at the current sequence.
  action reattest(p: int): bool = {
    val r = s.rows.get(p)
    all { r.kind == "v2", not(r.root), not(r.complete), r.signedSeq != s.seq,
      s' = s.with("rows", s.rows.set(p, r.with("signedSeq", s.seq))) } }
  action tick = all { s.windowOpen, s' = s.with("windowOpen", false) }

  action step = any { passAny, reattest(1), reattest(2), tick, s' = s }

  def rowOk(r: Row): bool = all {
    r.complete implies r.root,
    r.complete and r.kind == "v2" implies r.leaves == 0,
    r.signedSeq <= s.seq, r.stamp >= 0, r.stamp <= 2 }
  val invariant = all {
    Periods.forall(p => rowOk(s.rows.get(p))),
    // Newest first: no reservation in a pass reverts on a leaf mined earlier
    // in the same pass.
    not(s.sourceChanged),
    s.seq <= 4, s.failures <= MaxFailures }

  def admittedV2(p: int): bool = s.rows.get(p).kind == "v2" and s.rows.get(p).root
  def completed(p: int): bool = s.rows.get(p).complete
  // Scheduler fairness only; executor failures are bounded, never assumed to succeed.
  temporal admittedV2CompletesProperty = passAny.weakFair(s).implies(
    always(admittedV2(1) implies eventually(completed(1)))
      and always(admittedV2(2) implies eventually(completed(2))))

  // Older admitted V2 month with a leaf left; current V2 month unadmitted.
  run raceRun = initWith(2, true, 1, "v2", 1)
  run newestFirstReservesBeforeOlderLeafTest = raceRun.then(runPass(false, false))
    .expect(s.rows.get(2).root and s.rows.get(1).leaves == 0 and s.seq == 1 and invariant)
  run oldestFirstRevertsReservationTest = raceRun.then(runPassOldestFirst(false, false))
    .expect(s.sourceChanged and not(s.rows.get(2).root))
  run prerequisiteAddedForLruCandidateTest = initWith(1, true, 1, "v2", 1)
    .then(runPass(false, false)).expect(s.rows.get(2).root and s.rows.get(1).leaves == 0)
  run prerequisiteFailureStillRunsOriginalTest = raceRun.then(runPass(true, false))
    .expect(not(s.rows.get(2).root) and s.rows.get(1).leaves == 0 and invariant)
    .then(runPass(false, false)).expect(not(s.rows.get(2).root) and invariant)
    .then(reattest(2)).then(runPass(false, false)).expect(s.rows.get(2).root and invariant)
  run completeOnlyAfterLeavesTest = initWith(2, true, 2, "v2", 1).then(tick)
    .then(runPass(false, false)).then(runPass(false, false))
    .expect(not(s.rows.get(1).complete) and s.rows.get(1).leaves == 0)
    .then(runPass(false, false)).expect(s.rows.get(1).complete and invariant)
  run legacyCompletesOnSecondPassTest = initWith(2, false, 0, "legacy", 2)
    .then(runPass(false, false)).expect(s.rows.get(2).root and not(s.rows.get(2).complete) and s.seq == 2)
    .then(runPass(false, false)).expect(s.rows.get(2).complete and invariant)
  run closedWindowNotAdmittedTest = initWith(2, false, 1, "v2", 1).then(tick)
    .then(runPass(false, false)).expect(not(s.rows.get(1).root) and not(s.rows.get(2).root) and invariant)
}
