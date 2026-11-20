// @source workers/slopbot/index.ts
// @source workers/slopbot/persistence.ts
// @source migrations/0013_slopbot.sql
// @source migrations/0018_slopbot_delivery_processing.sql
// @source migrations/0040_slopbot_delivery_completion.sql
// Three source timestamps. Delivery completion and installation update share
// one transaction; older events cannot revive current suspended/removed state.
// `upsert` is a created or permissions snapshot that does not report
// suspension. `upsert_active` is that same snapshot with suspended_at null:
// a newer one clears the suspension it observes. It does not suspend.
module bot_installation_lifecycle {
  var s: { sourceTime: int, removed: bool, suspended: bool, receipts: int,
    maxSeen: int }
  action init = s' = {sourceTime: -1, removed: false, suspended: false,
    receipts: 0, maxSeen: -1}
  action event(t: int, kind: str): bool = all { s.receipts < 4,
    val newer = t > s.sourceTime
    val tied = t == s.sourceTime
    val removeWins = kind == "remove" and tied and not(s.removed)
    val suspendWins = kind == "suspend" and tied and not(s.removed) and not(s.suspended)
    val apply = newer or removeWins or suspendWins
    val upsert = kind == "upsert" or kind == "upsert_active"
    s' = s.with("sourceTime", if (apply) t else s.sourceTime)
      .with("maxSeen", if (t > s.maxSeen) t else s.maxSeen)
      .with("removed", if (apply and kind == "remove") true else if (newer and upsert) false else s.removed)
      .with("suspended", if (apply and kind == "suspend") true else if (newer and (kind == "unsuspend" or kind == "upsert_active")) false else s.suspended)
      .with("receipts", s.receipts + 1) }
  action step = { nondet t = Set(0, 1, 2).oneOf()
    nondet kind = Set("upsert", "upsert_active", "remove", "suspend", "unsuspend").oneOf()
    any { event(t, kind), s' = s } }
  val active = s.sourceTime >= 0 and not(s.removed) and not(s.suspended)
  val invariant = s.sourceTime == s.maxSeen
  run oldEventCannotReviveTest = init.then(event(2, "remove")).then(event(1, "upsert"))
    .expect(s.removed and not(active) and invariant)
  run tieRemovalWinsTest = init.then(event(1, "suspend")).then(event(1, "remove"))
    .then(event(1, "unsuspend")).expect(s.removed and s.suspended and invariant)
  run permissionsUpsertPreservesSuspensionTest = init.then(event(1, "suspend"))
    .then(event(2, "upsert")).expect(s.suspended and not(active))
  run activeSnapshotClearsSuspensionTest = init.then(event(1, "suspend"))
    .then(event(2, "upsert_active")).expect(not(s.suspended) and active and invariant)
  run oldActiveSnapshotKeepsSuspensionTest = init.then(event(2, "suspend"))
    .then(event(1, "upsert_active")).expect(s.suspended and not(active) and invariant)
}
