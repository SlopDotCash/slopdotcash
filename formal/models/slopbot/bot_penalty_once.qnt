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
// reopen. A reopen records one signed event for each revision in this model.
// GitHub can merge or receive a push before the queue checks maintainer
// authority. Confirmation uses the captured event and leaves GitHub state alone.
module bot_penalty_once {
  type Row = { present: bool, rev: int, at: int, reversed: bool, reason: str }
  type Reopen = { at: int, confirmed: bool }
  var s: { now: int, closes: Set[int], reopens: int -> Reopen, githubState: str, head: int,
    row: Row, inserts: int, appealRev: int, appealAt: int, appealDone: bool }
  action init = s' = { now: 0, closes: Set(), reopens: Map(), githubState: "open", head: 1,
    row: { present: false, rev: 0, at: 0, reversed: false, reason: "none" }, inserts: 0,
    appealRev: 0, appealAt: 0, appealDone: false }
  val confirmed = s.reopens.keys().filter(r => s.reopens.get(r).confirmed)
  def covers(rev: int, at: int): bool = s.row.present and not(s.row.reversed)
    and (s.row.at <= at or s.row.rev == rev)
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  // A confirmed close of the current head. Each revision's review closes once.
  action close = all { s.githubState == "open", not(s.head.in(s.closes)),
    s' = s.with("githubState", "bot_closed").with("closes", s.closes.union(Set(s.head))) }
  // recordPenalty(r): retried after the close; a replay is a no-op.
  action record(r: int): bool = all { r.in(s.closes),
    s' = if (s.row.present or r.in(confirmed)) s
      else s.with("row", { present: true, rev: r, at: s.now, reversed: false, reason: "none" })
        .with("inserts", s.inserts + 1) }
  action reopenOnGitHub = all {
    s.githubState == "bot_closed", not(s.head.in(s.reopens.keys())),
    s' = s.with("githubState", "open")
      .with("reopens", s.reopens.put(s.head, { at: s.now, confirmed: false })),
  }
  action mergeOnGitHub = all { s.githubState == "open", s' = s.with("githubState", "merged") }
  action confirmReopen(r: int, maintainer: bool): bool = all {
    maintainer, r.in(s.reopens.keys()),
    s' = s.with("reopens", s.reopens.put(r, s.reopens.get(r).with("confirmed", true)))
      .with("row", if (covers(r, s.reopens.get(r).at))
        s.row.with("reversed", true).with("reason", "maintainer_reopen") else s.row) }
  // The close job of revision r rechecks r's reopen after recording and
  // reverses only what that reopen covers.
  action lateReopenReversal(r: int): bool = all { r.in(s.closes), r.in(confirmed),
    s' = if (covers(r, s.reopens.get(r).at))
      s.with("row", s.row.with("reversed", true).with("reason", "maintainer_reopen")) else s }
  action push = all { s.githubState == "open", s.head == 1, 1.in(s.closes), s' = s.with("head", 2) }
  action appeal(r: int): bool = all { r.in(s.closes), s.appealRev == 0,
    s' = s.with("appealRev", r).with("appealAt", s.now) }
  action uphold = all { s.appealRev != 0, not(s.appealDone),
    s' = s.with("appealDone", true).with("row", if (covers(s.appealRev, s.appealAt))
      s.row.with("reversed", true).with("reason", "appeal_upheld") else s.row) }
  action step = {
    nondet r = Set(1, 2).oneOf()
    any { tick, close, record(r), reopenOnGitHub, mergeOnGitHub,
      confirmReopen(r, true), lateReopenReversal(r), push, appeal(r), uphold, s' = s }
  }
  val invariant = all {
    s.inserts <= 1,
    s.row.present iff s.inserts == 1,
    s.row.present implies s.row.rev.in(s.closes),
    s.row.reversed implies (s.row.present and s.row.reason != "none"),
    not(s.row.reversed) implies s.row.reason == "none",
    s.head == 2 implies 1.in(s.reopens.keys()),
    s.row.present and s.row.rev.in(confirmed) implies s.row.reversed,
    s.reopens.keys().subseteq(s.closes),
    // A reopen reversal always had a covering reopen: the debit's own
    // revision, or a reopen at or after the debit was recorded. A later
    // head's debit after every reopen stands.
    (s.row.reversed and s.row.reason == "maintainer_reopen") implies
      (s.row.rev.in(confirmed) or confirmed.exists(r => s.row.at <= s.reopens.get(r).at)),
  }
  temporal reversalFinalProperty = always(s.row.reversed implies always(s.row.reversed))
  run spamCloseDebitsOnceAcrossReplaysTest = init.then(close).then(record(1)).then(record(1))
    .expect(s.inserts == 1 and s.row.rev == 1 and not(s.row.reversed))
  run reopenBeforeRecordWritesNoDebitTest = init.then(close).then(reopenOnGitHub)
    .then(confirmReopen(1, true)).then(record(1))
    .expect(not(s.row.present))
  run reopenReversesRecordedDebitOnceTest = init.then(close).then(record(1)).then(reopenOnGitHub)
    .then(confirmReopen(1, true))
    .expect(s.row.reversed and s.row.reason == "maintainer_reopen")
    .then(uphold.fail())
  run mergeBeforeReopenDeliveryReversesDebitOnceTest = init.then(close).then(record(1))
    .then(reopenOnGitHub).then(mergeOnGitHub).then(tick)
    .expect(s.githubState == "merged" and not(s.row.reversed))
    .then(confirmReopen(1, true)).then(confirmReopen(1, true))
    .expect(s.githubState == "merged" and s.inserts == 1 and s.row.reversed and
      s.row.reason == "maintainer_reopen")
  run mergeBeforeNonMaintainerDeliveryCannotReverseTest = init.then(close).then(record(1))
    .then(reopenOnGitHub).then(mergeOnGitHub)
    .expect(s.githubState == "merged" and not(s.row.reversed))
    .then(confirmReopen(1, false).fail())
  run delayedReopenKeepsLaterHeadDebitTest = init.then(close).then(reopenOnGitHub)
    .then(push).then(tick).then(close).then(record(2)).then(confirmReopen(1, true))
    .expect(s.row.present and s.row.rev == 2 and not(s.row.reversed))
  run secondCloseNeverDebitsAgainTest = init.then(close).then(record(1)).then(reopenOnGitHub)
    .then(confirmReopen(1, true)).then(push)
    .then(close).then(record(2))
    .expect(s.inserts == 1 and s.row.rev == 1 and s.row.reversed)
  run newerHeadDebitSurvivesOlderAppealTest = init.then(close).then(reopenOnGitHub)
    .then(confirmReopen(1, true)).then(push)
    .then(appeal(1)).then(tick).then(close).then(record(2)).then(uphold)
    .expect(s.row.present and s.row.rev == 2 and not(s.row.reversed) and s.appealDone)
  // rev 1's close job finds its reopen only after rev 2 was closed and debited.
  run olderCloseJobKeepsLaterHeadDebitTest = init.then(close).then(reopenOnGitHub)
    .then(confirmReopen(1, true)).then(push)
    .then(tick).then(close).then(record(2)).then(lateReopenReversal(1))
    .expect(s.row.present and s.row.rev == 2 and not(s.row.reversed))
  run lateReopenReversesOwnRevisionDebitTest = init.then(close).then(record(1)).then(reopenOnGitHub)
    .then(confirmReopen(1, true))
    .then(lateReopenReversal(1)).expect(s.row.reversed and s.row.reason == "maintainer_reopen")
  run appealUpholdReversesCoveredDebitTest = init.then(close).then(record(1)).then(appeal(1))
    .then(uphold).expect(s.row.reversed and s.row.reason == "appeal_upheld")
}
