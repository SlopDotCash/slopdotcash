// @source workers/payments/deposits.ts
// @evidence workers/payments/deposits.test.ts
// The "Funded by" record of one Solana vault. The project account's finalized
// transactions are read newest first, a bounded page a run. `position` is the
// newest transaction at or below which everything has been read. While an
// interval above it is being read, `pending` is its newest transaction and
// `resume` the oldest one already read. Each transaction's deposits and that
// progress are one atomic write, made only if `position` is still the value
// the run started from, so a run that another run overtook stops without
// moving the cursor. A page shorter than the limit reached the covered
// position and completes the interval. Bounds: two workers, pages of two
// transactions, at most four transactions (numbered oldest 1 to newest 4),
// deposits in transactions 2 and 4. Abstracted: the instruction decoding and
// genesis check come from the real scanner; a repeated insert is a no-op.
module vault_deposit_solana_record {
  type W = { active: bool, pos: int, top: int, next: int, left: int, short: bool }
  type S = { head: int, position: int, pending: int, resume: int, read: Set[int],
    recorded: Set[int], a: W, b: W }
  var s: S
  pure val deposits = Set(2, 4)
  pure val idle: W = { active: false, pos: 0, top: 0, next: 0, left: 0, short: false }
  action init = s' = { head: 1, position: 0, pending: 0, resume: 0, read: Set(),
    recorded: Set(), a: idle, b: idle }
  action arrive = all { s.head < 4, s' = s.with("head", s.head + 1) }
  // The signature page a run fetches: below `resume`, above `position`.
  val from = if (s.resume > 0) s.resume - 1 else s.head
  val available = if (from > s.position) from - s.position else 0
  val captured: W = { active: true, pos: s.position,
    top: if (s.pending > 0) s.pending else if (available > 0) from else 0,
    next: from, left: if (available > 2) 2 else available, short: available < 2 }
  action startA = all { not(s.a.active), s' = s.with("a", captured) }
  action startB = all { not(s.b.active), s' = s.with("b", captured) }
  // One transaction: its deposits are stored, and the progress with them
  // unless another run has completed the interval since this run started.
  def afterRead(w: W): S = {
    val stored = s.with("read", s.read.union(Set(w.next)))
      .with("recorded", s.recorded.union(deposits.intersect(Set(w.next))))
    if (s.position == w.pos) stored.with("pending", w.top).with("resume", w.next) else stored
  }
  def advanced(w: W): W =
    if (s.position == w.pos) w.with("next", w.next - 1).with("left", w.left - 1) else idle
  action readA = all { s.a.active, s.a.left > 0,
    s' = afterRead(s.a).with("a", advanced(s.a)) }
  action readB = all { s.b.active, s.b.left > 0,
    s' = afterRead(s.b).with("b", advanced(s.b)) }
  // An unavailable transaction ends the run; its place is kept.
  action failA = all { s.a.active, s' = s.with("a", idle) }
  action failB = all { s.b.active, s' = s.with("b", idle) }
  def finished(w: W): S =
    if (w.short and s.position == w.pos)
      s.with("position", if (w.top > 0) w.top else s.position).with("pending", 0).with("resume", 0)
    else s
  action finishA = all { s.a.active, s.a.left == 0, s' = finished(s.a).with("a", idle) }
  action finishB = all { s.b.active, s.b.left == 0, s' = finished(s.b).with("b", idle) }
  action step = any { arrive, startA, startB, readA, readB, failA, failB,
    finishA, finishB, s' = s }
  val invariant = all {
    s.position >= 0 and s.position <= s.head,
    // Everything at or below the covered position has been read.
    1.to(s.position).subseteq(s.read),
    // An open interval has read every transaction from `resume` to `pending`.
    s.pending > 0 implies (s.resume > s.position and s.resume <= s.pending
      and s.pending <= s.head and s.resume.to(s.pending).subseteq(s.read)),
    s.pending == 0 implies s.resume == 0,
    // A deposit is on record exactly when its transaction has been read.
    s.recorded == deposits.intersect(s.read),
  }
  run newestFirstAcrossRunsTest = init.then(arrive).then(arrive).then(arrive)
    .then(startA).then(readA).then(readA).then(finishA)
    .expect(s.position == 0 and s.pending == 4 and s.resume == 3 and s.recorded == Set(4))
    .then(startA).then(readA).then(readA).then(finishA)
    .expect(s.position == 0 and s.resume == 1 and s.recorded == Set(2, 4))
    .then(startA).then(finishA)
    .expect(s.position == 4 and s.pending == 0 and invariant)
  run overtakenRunStopsTest = init.then(arrive)
    .then(startA).then(startB).then(readB).then(readB).then(finishB)
    .then(startB).then(finishB).expect(s.position == 2)
    .then(readA).expect(not(s.a.active) and s.position == 2 and s.pending == 0 and invariant)
  run failedReadKeepsPlaceTest = init.then(arrive).then(arrive)
    .then(startA).then(readA).then(failA)
    .expect(s.position == 0 and s.pending == 3 and s.resume == 3)
    .then(startA).then(readA).then(readA).then(finishA)
    .then(startA).then(finishA).expect(s.position == 3 and s.recorded == Set(2) and invariant)
  run nothingNewTest = init.then(startA).then(readA).then(finishA).expect(s.position == 1)
    .then(startA).then(finishA).expect(s.position == 1 and s.read == Set(1) and invariant)
}
