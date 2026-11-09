// @source workers/fee-converter/core.ts
// @source workers/fee-converter/store.ts
// @source workers/fee-converter/solana.ts
// @source workers/fee-converter/native-gas.ts
// @source migrations/0088_fee_approval_journal.sql
// @evidence workers/fee-converter/fee-converter.test.ts
// A Solana conversion run's local value reservation, remote INSERT and reply.
// Solana does not use the EVM nonce floor; different tokens may proceed while
// an earlier signed send is retained. Native-cost admission and exact signed
// bytes remain independent source contracts, not proof supplied by this model.
// Claims/approvals are excluded: they do not debit conversion-value limits.
//
// Reserve local run/day capacity before awaiting the INSERT. A rejected reply
// can precede or follow its commit. It never releases capacity in this run.
// The next run uses the durable window sum; an absent read immediately after
// the rejection is deliberately not modeled as proof the write cannot commit.
// A current lease is represented by active/owner at the INSERT's linearization
// point. Exact lease renewal and native liability have separate models.
//
// Bounds: three token/row identities, three runs, values 1..2, run cap 3,
// rolling-window cap 4. The old uncharged write action is outside step.
module fee_value_journal_reply {
  type Row = { phase: str, value: int, owner: int, inWindow: bool }
  type Write = { phase: str, value: int, owner: int, answered: bool }
  type State = { active: bool, runId: int, runValue: int, dayValue: int,
    awaiting: int, rows: int -> Row, writes: int -> Write,
    ready: Set[int], requested: Set[int] }
  var s: State
  pure val Ids = Set(1, 2, 3)
  pure val Counted = Set("submitted", "unknown", "finalized")
  pure val NoRow: Row = { phase: "none", value: 0, owner: 0, inWindow: false }
  pure val NoWrite: Write = { phase: "none", value: 0, owner: 0, answered: false }
  pure def windowValue(st: State): int = Ids.fold(0, (sum, id) => {
    val row = st.rows.get(id)
    if (row.inWindow and Counted.contains(row.phase)) sum + row.value else sum
  })
  pure def runRows(st: State, owner: int): int = Ids.fold(0, (sum, id) => {
    val row = st.rows.get(id)
    if (row.owner == owner and Counted.contains(row.phase)) sum + row.value else sum
  })
  pure def remaining(st: State): int =
    if (3 - st.runValue < 4 - st.dayValue) 3 - st.runValue else 4 - st.dayValue
  action init = s' = { active: false, runId: 0, runValue: 0, dayValue: 0,
    awaiting: 0, rows: Ids.mapBy(_ => NoRow), writes: Ids.mapBy(_ => NoWrite),
    ready: Set(), requested: Set() }
  action startRun = all { not(s.active), s.runId < 3,
    s' = s.with("active", true).with("runId", s.runId + 1)
      .with("runValue", 0).with("dayValue", windowValue(s)).with("awaiting", 0)
      .with("ready", Set()) }
  // Includes interruption. A successor does not inherit local unused capacity.
  action endRun = all { s.active,
    s' = s.with("active", false).with("awaiting", 0).with("ready", Set()) }
  action reserveValue(id: int, value: int): bool = all {
    s.active, s.awaiting == 0, s.ready == Set(), s.writes.get(id).phase == "none",
    value > 0, value <= 2, value <= remaining(s),
    s' = s.with("runValue", s.runValue + value).with("dayValue", s.dayValue + value)
      .with("awaiting", id).with("writes", s.writes.set(id,
        { phase: "pending", value: value, owner: s.runId, answered: false })) }
  action recordCommit(id: int): bool = {
    val write = s.writes.get(id)
    all { s.active, write.owner == s.runId, write.phase == "pending",
      s' = s.with("writes", s.writes.set(id, write.with("phase", "committed")))
        .with("rows", s.rows.set(id,
          { phase: "submitted", value: write.value, owner: write.owner, inWindow: true })) }
  }
  action refuseWrite(id: int): bool = all { s.writes.get(id).phase == "pending",
    s' = s.with("writes", s.writes.set(id, s.writes.get(id).with("phase", "refused"))) }
  action receiveReply(id: int, accepted: bool): bool = {
    val write = s.writes.get(id)
    all { s.active, s.awaiting == id, not(write.answered),
      not(accepted) or write.phase == "committed",
      s' = s.with("awaiting", 0).with("writes", s.writes.set(id, write.with("answered", true)))
        .with("ready", if (accepted) s.ready.union(Set(id)) else s.ready) }
  }
  action broadcast(id: int, accepted: bool): bool = all { s.active, s.ready.contains(id),
    s.rows.get(id).owner == s.runId, s.writes.get(id).phase == "committed",
    s' = s.with("ready", s.ready.exclude(Set(id))).with("requested", s.requested.union(Set(id)))
      .with("rows", s.rows.set(id, s.rows.get(id).with("phase", if (accepted) "submitted" else "unknown"))) }
  action recoverBroadcast(id: int): bool = all { s.active,
    s.rows.get(id).owner != s.runId, Counted.contains(s.rows.get(id).phase),
    s.rows.get(id).phase != "finalized",
    s' = s.with("requested", s.requested.union(Set(id))) }
  action settle(id: int, succeeded: bool): bool = all {
    s.requested.contains(id),
    Set("submitted", "unknown").contains(s.rows.get(id).phase),
    s' = s.with("rows", s.rows.set(id, s.rows.get(id).with("phase", if (succeeded) "finalized" else "failed"))) }
  action age(id: int): bool = all { s.rows.get(id).inWindow,
    s' = s.with("rows", s.rows.set(id, s.rows.get(id).with("inWindow", false))) }
  action step = {
    nondet id = Ids.oneOf()
    nondet value = Set(1, 2).oneOf()
    nondet accepted = Set(false, true).oneOf()
    any { startRun, endRun, reserveValue(id, value), recordCommit(id), refuseWrite(id),
      receiveReply(id, accepted), broadcast(id, accepted), recoverBroadcast(id),
      settle(id, accepted), age(id), s' = s }
  }
  val invariant = all { windowValue(s) <= 4,
    Ids.forall(owner => runRows(s, owner) <= 3),
    s.active implies all { s.runValue <= 3, s.dayValue <= 4,
      s.dayValue >= windowValue(s), s.runValue >= runRows(s, s.runId) },
    s.requested.forall(id => s.writes.get(id).phase == "committed") }
  action submitted(id: int, value: int): bool = reserveValue(id, value)
    .then(recordCommit(id)).then(receiveReply(id, true)).then(broadcast(id, true))
  run normalReplyChargesBeforeBroadcastTest = init.then(startRun).then(submitted(1, 2))
    .expect(s.runValue == 2 and s.requested == Set(1) and invariant)
  run committedLostReplyKeepsCapacityTest = init.then(startRun).then(reserveValue(1, 2))
    .then(recordCommit(1)).then(receiveReply(1, false)).then(submitted(2, 1))
    .expect(s.runValue == 3 and runRows(s, 1) == 3 and not(s.requested.contains(1)) and invariant)
  run lateCommitAfterRejectedReplyKeepsCapacityTest = init.then(startRun).then(reserveValue(1, 2))
    .then(receiveReply(1, false)).then(submitted(2, 1)).then(recordCommit(1))
    .expect(windowValue(s) == 3 and s.runValue == 3 and invariant)
  run definiteRefusalKeepsTemporaryChargeTest = init.then(startRun).then(reserveValue(1, 2))
    .then(refuseWrite(1)).then(receiveReply(1, false))
    .expect(s.runValue == 2 and windowValue(s) == 0 and invariant)
    .then(reserveValue(2, 2).fail())
  run nextRunRecoversUnusedCapacityTest = init.then(startRun).then(reserveValue(1, 2))
    .then(refuseWrite(1)).then(receiveReply(1, false)).then(endRun).then(startRun).then(submitted(2, 2))
    .expect(s.runValue == 2 and s.dayValue == 2 and invariant)
  run committedLostReplyRecoversExactRowTest = init.then(startRun).then(reserveValue(1, 2))
    .then(recordCommit(1)).then(receiveReply(1, false)).then(endRun).then(startRun).then(recoverBroadcast(1))
    .expect(s.dayValue == 2 and s.requested.contains(1) and invariant)
  run interruptionAfterCommitCountsNextRunTest = init.then(startRun).then(reserveValue(1, 2))
    .then(recordCommit(1)).then(endRun).then(startRun).expect(s.dayValue == 2 and invariant)
  run successorLeaseRefusesOldPendingInsertTest = init.then(startRun).then(reserveValue(1, 2))
    .then(receiveReply(1, false)).then(endRun).then(startRun).then(recordCommit(1).fail())
  run unknownBroadcastKeepsValueCountedTest = init.then(startRun).then(reserveValue(1, 2))
    .then(recordCommit(1)).then(receiveReply(1, true)).then(broadcast(1, false))
    .expect(s.rows.get(1).phase == "unknown" and s.dayValue == 2 and invariant)
  // Historical pre-fix transition, intentionally excluded from step.
  action oldUnchargedLostReply(id: int, value: int): bool = all { s.active,
    s.awaiting == 0, s.writes.get(id).phase == "none", value > 0, value <= remaining(s),
    s' = s.with("writes", s.writes.set(id,
      { phase: "committed", value: value, owner: s.runId, answered: true }))
      .with("rows", s.rows.set(id,
        { phase: "submitted", value: value, owner: s.runId, inWindow: true })) }
  run oldLostReplyCouldExceedRunCapTest = init.then(startRun).then(oldUnchargedLostReply(1, 2))
    .then(submitted(2, 2)).expect(runRows(s, 1) == 4 and not(invariant))
  run oldLostReplyCouldExceedDayCapTest = init.then(startRun).then(submitted(1, 2)).then(endRun)
    .then(startRun).then(oldUnchargedLostReply(2, 2)).then(submitted(3, 1))
    .expect(windowValue(s) == 5 and not(invariant))
}
