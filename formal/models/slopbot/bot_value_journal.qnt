// @source workers/slopbot/value-journal.ts
// @source migrations/0038_slopbot_value_journal.sql
// @source migrations/0042_slopbot_value_no_replace.sql
// One PR, three immutable revisions and two assessment keys. A replay returns
// the first stored value; it never substitutes a competing model verdict.
module bot_value_journal {
  var s: { head: int, parents: List[int], keys: Set[int], draftParent: int,
    draftKey: int, ready: bool, replayed: bool }
  action init = s' = {head: 0, parents: [], keys: Set(), draftParent: 0,
    draftKey: 0, ready: false, replayed: false}
  action prepare(key: int): bool = all { key.in(Set(1, 2, 3)),
    s' = s.with("draftParent", s.head).with("draftKey", key).with("ready", true) }
  action appendRecord = all { s.ready, not(s.draftKey.in(s.keys)), s.head < 3,
    s.draftParent == s.head,
    s' = s.with("parents", s.parents.append(s.head)).with("head", s.head + 1)
      .with("keys", s.keys.union(Set(s.draftKey))).with("ready", false) }
  action competingAppend = all { s.head < 3,
    not(3.in(s.keys)), s' = s.with("parents", s.parents.append(s.head))
      .with("head", s.head + 1).with("keys", s.keys.union(Set(3))) }
  action duplicate = all { s.ready, s.draftKey.in(s.keys),
    s' = s.with("ready", false).with("replayed", true) }
  action step = { nondet key = Set(1, 2, 3).oneOf()
    any { prepare(key), appendRecord, competingAppend, duplicate, s' = s } }
  val invariant = all { s.parents.length() == s.head, s.keys.size() == s.head,
    s.parents.indices().forall(i => s.parents.nth(i) == i) }
  run stalePredecessorRefusedTest = init.then(prepare(1)).then(competingAppend)
    .expect(s.draftParent != s.head and s.head == 1 and invariant)
  run correctionRetainsRootTest = init.then(prepare(1)).then(appendRecord)
    .then(prepare(2)).then(appendRecord).expect(s.parents == [0, 1] and invariant)
  run duplicateUsesStoredValueTest = init.then(prepare(1)).then(appendRecord)
    .then(prepare(1)).then(duplicate).expect(s.head == 1 and s.replayed)
}
