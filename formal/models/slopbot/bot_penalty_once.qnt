// @source workers/slopbot/penalties.ts
// @source workers/slopbot/review.ts
// @source migrations/0064_slopbot_penalties_appeals.sql
// One item, two head revisions (1, then 2 after a reopen and push), one
// appeal and a three-step clock. `slopbot_penalties` keys on the item: the
// first confirmed close that inserts a debit is the only one ever (INSERT OR
// IGNORE), and the insert refuses when a reopen of the reviewed revision is
// already confirmed. A reversal happens once and is otherwise immutable. A
// maintainer reopen reverses a debit for its revision or recorded at or before
// the reopen; an upheld appeal covers its revision or a debit recorded at or
// before the appeal opened. A later head's debit after either stands.
// bot_appeal models the appeal lifecycle and assumes an existing debit.
// A close job rechecks the reopen of its own reviewed revision after
// recordPenalty; reviews are leased per review key, so an older revision's
// job can finish after a later head was closed and debited. Its reversal
// passes that revision and the latest reopen time (confirmedReopenCoverage),
// so it covers only that revision's debit or one recorded at or before the
// reopen. `reopenAt` keeps each reopened revision's event time.
module bot_penalty_once {
  type Row = { present: bool, rev: int, at: int, reversed: bool, reason: str }
  var s: { now: int, closes: Set[int], reopens: Set[int], open: bool, head: int,
    row: Row, inserts: int, appealRev: int, appealAt: int, appealDone: bool,
    insertedAfterReopen: bool, reopenAt: int -> int }
  action init = s' = { now: 0, closes: Set(), reopens: Set(), open: true, head: 1,
    row: { present: false, rev: 0, at: 0, reversed: false, reason: "none" }, inserts: 0,
    appealRev: 0, appealAt: 0, appealDone: false, insertedAfterReopen: false,
    reopenAt: Map() }
  def covers(rev: int, at: int): bool = s.row.present and not(s.row.reversed)
    and (s.row.at <= at or s.row.rev == rev)
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  // A confirmed close of the current head. Each revision's review closes once.
  action close = all { s.open, not(s.head.in(s.closes)),
    s' = s.with("open", false).with("closes", s.closes.union(Set(s.head))) }
  // recordPenalty(r): retried after the close; a replay is a no-op.
  action record(r: int): bool = all { r.in(s.closes),
    s' = if (s.row.present or r.in(s.reopens)) s
      else s.with("row", { present: true, rev: r, at: s.now, reversed: false, reason: "none" })
        .with("inserts", s.inserts + 1) }
  action reopen = all { not(s.open), s.head.in(s.closes), not(s.head.in(s.reopens)),
    s' = s.with("open", true).with("reopens", s.reopens.union(Set(s.head)))
      .with("reopenAt", s.reopenAt.put(s.head, s.now))
      .with("row", if (covers(s.head, s.now))
        s.row.with("reversed", true).with("reason", "maintainer_reopen") else s.row) }
  // The close job of revision r rechecks r's reopen after recording and
  // reverses only what that reopen covers.
  action lateReopenReversal(r: int): bool = all { r.in(s.closes), r.in(s.reopens),
    s' = if (covers(r, s.reopenAt.get(r)))
      s.with("row", s.row.with("reversed", true).with("reason", "maintainer_reopen")) else s }
  action push = all { s.open, s.head == 1, 1.in(s.closes), s' = s.with("head", 2) }
  action appeal(r: int): bool = all { r.in(s.closes), s.appealRev == 0,
    s' = s.with("appealRev", r).with("appealAt", s.now) }
  action uphold = all { s.appealRev != 0, not(s.appealDone),
    s' = s.with("appealDone", true).with("row", if (covers(s.appealRev, s.appealAt))
      s.row.with("reversed", true).with("reason", "appeal_upheld") else s.row) }
  action step = {
    nondet r = Set(1, 2).oneOf()
    any { tick, close, record(r), reopen, lateReopenReversal(r), push, appeal(r), uphold, s' = s }
  }
  val invariant = all {
    s.inserts <= 1,
    s.row.present iff s.inserts == 1,
    s.row.present implies s.row.rev.in(s.closes),
    s.row.reversed implies (s.row.present and s.row.reason != "none"),
    not(s.row.reversed) implies s.row.reason == "none",
    s.head == 2 implies 1.in(s.reopens),
    (s.head == 2 and s.row.rev == 1) implies s.row.reversed,
    s.reopenAt.keys() == s.reopens,
    // A reopen reversal always had a covering reopen: the debit's own
    // revision, or a reopen at or after the debit was recorded. A later
    // head's debit after every reopen stands.
    (s.row.reversed and s.row.reason == "maintainer_reopen") implies
      (s.row.rev.in(s.reopens) or s.reopens.exists(r => s.row.at <= s.reopenAt.get(r))),
  }
  temporal reversalFinalProperty = always(s.row.reversed implies always(s.row.reversed))
  run spamCloseDebitsOnceAcrossReplaysTest = init.then(close).then(record(1)).then(record(1))
    .expect(s.inserts == 1 and s.row.rev == 1 and not(s.row.reversed))
  run reopenBeforeRecordWritesNoDebitTest = init.then(close).then(reopen).then(record(1))
    .expect(not(s.row.present))
  run reopenReversesRecordedDebitOnceTest = init.then(close).then(record(1)).then(reopen)
    .expect(s.row.reversed and s.row.reason == "maintainer_reopen")
    .then(uphold.fail())
  run secondCloseNeverDebitsAgainTest = init.then(close).then(record(1)).then(reopen).then(push)
    .then(close).then(record(2))
    .expect(s.inserts == 1 and s.row.rev == 1 and s.row.reversed)
  run newerHeadDebitSurvivesOlderAppealTest = init.then(close).then(reopen).then(push)
    .then(appeal(1)).then(tick).then(close).then(record(2)).then(uphold)
    .expect(s.row.present and s.row.rev == 2 and not(s.row.reversed) and s.appealDone)
  // rev 1's close job finds its reopen only after rev 2 was closed and debited.
  run olderCloseJobKeepsLaterHeadDebitTest = init.then(close).then(reopen).then(push)
    .then(tick).then(close).then(record(2)).then(lateReopenReversal(1))
    .expect(s.row.present and s.row.rev == 2 and not(s.row.reversed))
  run lateReopenReversesOwnRevisionDebitTest = init.then(close).then(record(1)).then(reopen)
    .then(lateReopenReversal(1)).expect(s.row.reversed and s.row.reason == "maintainer_reopen")
  run appealUpholdReversesCoveredDebitTest = init.then(close).then(record(1)).then(appeal(1))
    .then(uphold).expect(s.row.reversed and s.row.reason == "appeal_upheld")
}
