// @source workers/slopbot/value-work-unit-journal.ts
// @source migrations/0046_slopbot_work_unit_journal.sql
// Two source PRs and three joint revisions. All current predecessor groups
// touching a new source must be superseded whole, never forked or dropped.
module bot_joint_journal {
  var s: { a: int, b: int, version: int, draftA: int, draftB: int,
    members: Set[int], ready: bool, history: List[Set[int]], migrated: Set[int] }
  action init = s' = {a: 0, b: 0, version: 0, draftA: 0, draftB: 0,
    members: Set(), ready: false, history: [], migrated: Set()}
  action prepare(members: Set[int]): bool = all { members.size() > 0,
    s' = s.with("members", members).with("draftA", s.a).with("draftB", s.b).with("ready", true) }
  val wholePredecessor = not(s.a > 0 and s.a == s.b) or s.members == Set(1, 2)
  action publish = all { s.ready, s.version < 3, wholePredecessor,
    (not(1.in(s.members)) or s.draftA == s.a),
    (not(2.in(s.members)) or s.draftB == s.b),
    s' = s.with("version", s.version + 1).with("history", s.history.append(s.members))
      .with("a", if (1.in(s.members)) s.version + 1 else s.a)
      .with("b", if (2.in(s.members)) s.version + 1 else s.b)
      .with("migrated", s.migrated.union(s.members)).with("ready", false) }
  action step = { nondet members = Set(Set(1), Set(2), Set(1, 2)).oneOf()
    any { prepare(members), publish, s' = s } }
  val invariant = all { s.history.length() == s.version,
    (s.a > 0) == 1.in(s.migrated), (s.b > 0) == 2.in(s.migrated),
    s.a > 0 implies 1.in(s.history.nth(s.a - 1)),
    s.b > 0 implies 2.in(s.history.nth(s.b - 1)) }
  run joinAndCorrectAllSourcesTest = init.then(prepare(Set(1))).then(publish)
    .then(prepare(Set(2))).then(publish).then(prepare(Set(1, 2))).then(publish)
    .expect(s.a == 3 and s.b == 3 and s.history == [Set(1), Set(2), Set(1, 2)])
  run cannotSplitCurrentGroupTest = init.then(prepare(Set(1, 2))).then(publish)
    .then(prepare(Set(1))).expect(not(wholePredecessor) and s.a == s.b and invariant)
}
