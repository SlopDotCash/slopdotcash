lemma OneRowFilter(m: Moderation)
  ensures alwaysOneRowPerKeyAndRecipient(m) == !(exists i :: i in m.items && !((i.recipient > 0) && (|ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), m.items)| == 1)))
{
}

lemma OnePenaltyFilter(m: Moderation)
  ensures alwaysOnePenaltyPerItem(m) == !(exists p :: p in m.penalties && !(((p.itemNode != "") && (p.author > 0)) && (|ProofLib.Filter((o: Penalty) => (o.itemNode == p.itemNode), m.penalties)| == 1)))
{
}

lemma CasesUniqueFilter(m: Moderation)
  ensures alwaysCasesUnique(m) == !(exists c :: c in m.cases && !((((c.key != "") && (c.appellant > 0)) && c.escalated) && (|ProofLib.Filter((o: Case) => (o.key == c.key), m.cases)| == 1)))
{
}

lemma OneUnderfundedFilter(m: Moderation)
  ensures alwaysOneUnderfundedRowPerMonth(m) == !(exists i :: i in m.items && !((!(i.key.kind.MonthlyUnderfunded?) || (|ProofLib.Filter((o: Item) => (o.key == i.key), m.items)| == 1))))
{
}

lemma DecisionsFilter(m: Moderation)
  ensures alwaysDecisionsRecorded(m) == (!(exists d :: d in m.decisions && !((((((d.reasonLength >= 1) && (d.reasonLength <= 4000)) && caseOf(m, d.caseKey).resolved) && (caseOf(m, d.caseKey).appellant != d.by_)) && (|ProofLib.Filter((o: Decision) => (o.caseKey == d.caseKey), m.decisions)| == 1)))) && !(exists c :: c in m.cases && !((c.resolved == (exists d :: d in m.decisions && (d.caseKey == c.key))))))
{
}

lemma CaseOfFilter(m: Moderation, caseKey: string)
  ensures caseOf(m, caseKey) == (if 0 < |ProofLib.Filter((c: Case) => (c.key == caseKey), m.cases)| then ProofLib.Filter((c: Case) => (c.key == caseKey), m.cases)[0] else Case("", 0, false, false))
{
}

lemma CaseOfInCases(m: Moderation, caseKey: string)
  requires caseOf(m, caseKey).resolved || (caseKey != "" && caseOf(m, caseKey).key == caseKey)
  ensures caseOf(m, caseKey) in m.cases
  ensures caseOf(m, caseKey).key == caseKey
{
  CaseOfFilter(m, caseKey);
  var p := (c: Case) => (c.key == caseKey);
  var flt := ProofLib.Filter(p, m.cases);
  assert |flt| > 0;
  ProofLib.FilterMember(p, m.cases, flt[0]);
}

lemma AddOncePreserves(items: seq<Item>, key: Key, recipient: int)
  requires forall i :: i in items ==> i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), items)| == 1
  requires forall i :: i in items && i.key.kind.MonthlyUnderfunded? ==> |ProofLib.Filter((o: Item) => (o.key == i.key), items)| == 1
  requires key.kind.MonthlyUnderfunded? ==> !(exists i :: i in items && i.key == key)
  ensures forall i :: i in items ==> i in addOnce(items, key, recipient)
  ensures forall i :: i in addOnce(items, key, recipient) ==> i in items || (i == Item(key, recipient, 0) && recipient > 0)
  ensures forall i :: i in addOnce(items, key, recipient) ==> i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), addOnce(items, key, recipient))| == 1
  ensures forall i :: i in addOnce(items, key, recipient) && i.key.kind.MonthlyUnderfunded? ==> |ProofLib.Filter((o: Item) => (o.key == i.key), addOnce(items, key, recipient))| == 1
{
  var next := addOnce(items, key, recipient);
  if !(recipient <= 0 || (exists i :: i in items && i.key == key && i.recipient == recipient)) {
    var added := Item(key, recipient, 0);
    assert next == items + [added];
    forall i | i in next
      ensures i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), next)| == 1
    {
      var p := (o: Item) => ((o.key == i.key) && (o.recipient == i.recipient));
      ProofLib.FilterAppend(p, items, added);
      if i in items {
        assert !p(added);
      } else {
        assert i == added;
        ProofLib.FilterNone(p, items);
      }
    }
    forall i | i in next && i.key.kind.MonthlyUnderfunded?
      ensures |ProofLib.Filter((o: Item) => (o.key == i.key), next)| == 1
    {
      var q := (o: Item) => (o.key == i.key);
      ProofLib.FilterAppend(q, items, added);
      if i in items {
        assert i.key != key;
        assert !q(added);
      } else {
        assert i == added;
        ProofLib.FilterNone(q, items);
      }
    }
  }
}

lemma FoldAddOnceMembers(f: (seq<Item>, int) -> seq<Item>, items: seq<Item>, mods: seq<int>, key: Key, skip: int)
  requires forall acc: seq<Item>, r: int :: f(acc, r) == (if r != skip then addOnce(acc, key, r) else acc)
  ensures forall i :: i in items ==> i in Std.Collections.Seq.FoldLeft(f, items, mods)
  ensures forall i :: i in Std.Collections.Seq.FoldLeft(f, items, mods) ==> i in items || (i.key == key && i.recipient != skip && i.recipient > 0 && i.readAt == 0)
  decreases |mods|
{
  if |mods| > 0 {
    var r := mods[0];
    var step1 := f(items, r);
    assert step1 == (if r != skip then addOnce(items, key, r) else items);
    assert forall i :: i in items ==> i in step1;
    assert forall i :: i in step1 ==> i in items || (i == Item(key, r, 0) && r != skip && r > 0);
    FoldAddOnceMembers(f, step1, mods[1..], key, skip);
  }
}

lemma FoldAddOnce(f: (seq<Item>, int) -> seq<Item>, items: seq<Item>, mods: seq<int>, key: Key, skip: int)
  requires forall acc: seq<Item>, r: int :: f(acc, r) == (if r != skip then addOnce(acc, key, r) else acc)
  requires !key.kind.MonthlyUnderfunded?
  requires forall i :: i in items ==> i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), items)| == 1
  requires forall i :: i in items && i.key.kind.MonthlyUnderfunded? ==> |ProofLib.Filter((o: Item) => (o.key == i.key), items)| == 1
  ensures forall i :: i in items ==> i in Std.Collections.Seq.FoldLeft(f, items, mods)
  ensures forall i :: i in Std.Collections.Seq.FoldLeft(f, items, mods) ==> i in items || (i.key == key && i.recipient != skip && i.recipient > 0 && i.readAt == 0)
  ensures forall i :: i in Std.Collections.Seq.FoldLeft(f, items, mods) ==> i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), Std.Collections.Seq.FoldLeft(f, items, mods))| == 1
  ensures forall i :: i in Std.Collections.Seq.FoldLeft(f, items, mods) && i.key.kind.MonthlyUnderfunded? ==> |ProofLib.Filter((o: Item) => (o.key == i.key), Std.Collections.Seq.FoldLeft(f, items, mods))| == 1
  decreases |mods|
{
  if |mods| > 0 {
    var step1 := f(items, mods[0]);
    if mods[0] != skip {
      AddOncePreserves(items, key, mods[0]);
    }
    FoldAddOnce(f, step1, mods[1..], key, skip);
  }
}

lemma recordScamPenalty_ensures(m: Moderation, by_: int, itemNode: string, author: int)
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysOneRowPerKeyAndRecipient(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysScamRowsFromPenalty(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysOnePenaltyPerItem(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysAppealRowsForOthers(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysCasesUnique(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysOneUnderfundedRowPerMonth(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysReviewRowsNameARequest(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> alwaysDecisionsRecorded(recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> stepShownOnlyWhenVisible(m, recordScamPenalty(m, by_, itemNode, author)))
  ensures (inv(m) ==> canRecordScamPenalty(m, by_, itemNode, author) ==> stepHistoryRetained(m, recordScamPenalty(m, by_, itemNode, author)))
{
  if inv(m) && canRecordScamPenalty(m, by_, itemNode, author) {
    var after := recordScamPenalty(m, by_, itemNode, author);
    var added := Penalty(itemNode, author, false);
    OnePenaltyFilter(m);
    OnePenaltyFilter(after);
    forall p | p in after.penalties
      ensures p.itemNode != "" && p.author > 0 && |ProofLib.Filter((o: Penalty) => (o.itemNode == p.itemNode), after.penalties)| == 1
    {
      var pred := (o: Penalty) => (o.itemNode == p.itemNode);
      ProofLib.FilterAppend(pred, m.penalties, added);
      if p in m.penalties {
        assert !pred(added);
      } else {
        assert p == added;
        ProofLib.FilterNone(pred, m.penalties);
      }
    }
  }
}

lemma notifyScamReview_ensures(m: Moderation, by_: int, itemNode: string, recipient: int)
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysOneRowPerKeyAndRecipient(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysScamRowsFromPenalty(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysOnePenaltyPerItem(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysAppealRowsForOthers(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysCasesUnique(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysOneUnderfundedRowPerMonth(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysReviewRowsNameARequest(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> alwaysDecisionsRecorded(notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> stepShownOnlyWhenVisible(m, notifyScamReview(m, by_, itemNode, recipient)))
  ensures (inv(m) ==> canNotifyScamReview(m, by_, itemNode, recipient) ==> stepHistoryRetained(m, notifyScamReview(m, by_, itemNode, recipient)))
{
  if inv(m) && canNotifyScamReview(m, by_, itemNode, recipient) {
    var after := notifyScamReview(m, by_, itemNode, recipient);
    OneRowFilter(m);
    OneUnderfundedFilter(m);
    AddOncePreserves(m.items, scamKey(itemNode), recipient);
    OneRowFilter(after);
    OneUnderfundedFilter(after);
  }
}

lemma reversePenalty_ensures(m: Moderation, by_: int, itemNode: string)
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysOneRowPerKeyAndRecipient(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysScamRowsFromPenalty(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysOnePenaltyPerItem(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysAppealRowsForOthers(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysCasesUnique(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysOneUnderfundedRowPerMonth(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysReviewRowsNameARequest(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> alwaysDecisionsRecorded(reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> stepShownOnlyWhenVisible(m, reversePenalty(m, by_, itemNode)))
  ensures (inv(m) ==> canReversePenalty(m, by_, itemNode) ==> stepHistoryRetained(m, reversePenalty(m, by_, itemNode)))
{
  if inv(m) && canReversePenalty(m, by_, itemNode) {
    var after := reversePenalty(m, by_, itemNode);
    OnePenaltyFilter(m);
    OnePenaltyFilter(after);
    forall p | p in m.penalties
      ensures exists o :: o in after.penalties && o.itemNode == p.itemNode && o.author == p.author && (p.reversed ==> o.reversed)
    {
      var k :| 0 <= k < |m.penalties| && m.penalties[k] == p;
      assert after.penalties[k] in after.penalties;
    }
    forall i | i in after.items && i.key.kind.ScamReview?
      ensures exists p :: p in after.penalties && p.itemNode == i.key.subject && p.author != i.recipient
    {
      var p :| p in m.penalties && p.itemNode == i.key.subject && p.author != i.recipient;
      var k :| 0 <= k < |m.penalties| && m.penalties[k] == p;
      assert after.penalties[k] in after.penalties;
    }
    forall p | p in after.penalties
      ensures p.itemNode != "" && p.author > 0 && |ProofLib.Filter((o: Penalty) => (o.itemNode == p.itemNode), after.penalties)| == 1
    {
      var k :| 0 <= k < |after.penalties| && after.penalties[k] == p;
      var prev := m.penalties[k];
      assert prev in m.penalties && prev.itemNode == p.itemNode;
      ProofLib.FilterLengthPointwise((o: Penalty) => (o.itemNode == prev.itemNode), (o: Penalty) => (o.itemNode == p.itemNode), m.penalties, after.penalties);
    }
  }
}

lemma escalateCase_ensures(m: Moderation, by_: int, caseKey: string, appellant: int)
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysOneRowPerKeyAndRecipient(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysScamRowsFromPenalty(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysOnePenaltyPerItem(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysAppealRowsForOthers(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysCasesUnique(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysOneUnderfundedRowPerMonth(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysReviewRowsNameARequest(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> alwaysDecisionsRecorded(escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> stepShownOnlyWhenVisible(m, escalateCase(m, by_, caseKey, appellant)))
  ensures (inv(m) ==> canEscalateCase(m, by_, caseKey, appellant) ==> stepHistoryRetained(m, escalateCase(m, by_, caseKey, appellant)))
{
  if inv(m) && canEscalateCase(m, by_, caseKey, appellant) {
    var after := escalateCase(m, by_, caseKey, appellant);
    var added := Case(caseKey, appellant, true, false);
    var f := (acc: seq<Item>, r: int) => (if (r != appellant) then addOnce(acc, appealKey(caseKey), r) else acc);
    OneRowFilter(m);
    OneUnderfundedFilter(m);
    FoldAddOnce(f, m.items, m.moderators, appealKey(caseKey), appellant);
    OneRowFilter(after);
    OneUnderfundedFilter(after);
    assert alwaysAppealRowsForOthers(after) by {
      forall i | i in after.items && i.key.kind.AppealReview?
        ensures exists c :: c in after.cases && c.key == i.key.subject && c.escalated && c.appellant != i.recipient
      {
        if i in m.items {
          var c :| c in m.cases && c.key == i.key.subject && c.escalated && c.appellant != i.recipient;
          assert c in after.cases;
        } else {
          assert added in after.cases;
        }
      }
    }
    assert alwaysCasesUnique(after) by {
      CasesUniqueFilter(m);
      CasesUniqueFilter(after);
      forall c | c in after.cases
        ensures c.key != "" && c.appellant > 0 && c.escalated && |ProofLib.Filter((o: Case) => (o.key == c.key), after.cases)| == 1
      {
        var pred := (o: Case) => (o.key == c.key);
        ProofLib.FilterAppend(pred, m.cases, added);
        if c in m.cases {
          assert !pred(added);
        } else {
          assert c == added;
          ProofLib.FilterNone(pred, m.cases);
        }
      }
    }
    assert alwaysDecisionsRecorded(after) by {
      DecisionsFilter(m);
      DecisionsFilter(after);
      forall d | d in after.decisions
        ensures d.caseKey != caseKey && caseOf(after, d.caseKey) == caseOf(m, d.caseKey)
      {
        CaseOfInCases(m, d.caseKey);
        assert d.caseKey != caseKey;
        CaseOfFilter(m, d.caseKey);
        CaseOfFilter(after, d.caseKey);
        ProofLib.FilterAppend((c: Case) => (c.key == d.caseKey), m.cases, added);
      }
    }
  }
}

lemma recordEnforcement_ensures(m: Moderation, by_: int, enforcement: Enforcement)
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysOneRowPerKeyAndRecipient(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysScamRowsFromPenalty(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysOnePenaltyPerItem(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysAppealRowsForOthers(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysCasesUnique(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysOneUnderfundedRowPerMonth(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysReviewRowsNameARequest(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> alwaysDecisionsRecorded(recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> stepShownOnlyWhenVisible(m, recordEnforcement(m, by_, enforcement)))
  ensures (inv(m) ==> canRecordEnforcement(m, by_, enforcement) ==> stepHistoryRetained(m, recordEnforcement(m, by_, enforcement)))
{
  if inv(m) && canRecordEnforcement(m, by_, enforcement) {
    var after := recordEnforcement(m, by_, enforcement);
    var step1 := addOnce(m.items, enforcementKey(enforcement), enforcement.applicant);
    var owners := addOnce(step1, enforcementKey(enforcement), enforcement.steward);
    OneRowFilter(m);
    OneUnderfundedFilter(m);
    AddOncePreserves(m.items, enforcementKey(enforcement), enforcement.applicant);
    AddOncePreserves(step1, enforcementKey(enforcement), enforcement.steward);
    if enforcement.reinstatementRequest {
      var f := (acc: seq<Item>, r: int) => (if (r != enforcement.placedBy) then addOnce(acc, reviewKey(enforcement), r) else acc);
      FoldAddOnce(f, owners, m.moderators, reviewKey(enforcement), enforcement.placedBy);
    }
    assert forall i :: i in m.items ==> i in after.items;
    assert forall i :: i in after.items ==> i in m.items || i.key == enforcementKey(enforcement) || (enforcement.reinstatementRequest && i.key == reviewKey(enforcement));
    OneRowFilter(after);
    OneUnderfundedFilter(after);
    assert alwaysScamRowsFromPenalty(after) by {
      forall i | i in after.items && i.key.kind.ScamReview?
        ensures exists p :: p in after.penalties && p.itemNode == i.key.subject && p.author != i.recipient
      {
        assert i in m.items;
      }
    }
    assert alwaysAppealRowsForOthers(after) by {
      forall i | i in after.items && i.key.kind.AppealReview?
        ensures exists c :: c in after.cases && c.key == i.key.subject && c.escalated && c.appellant != i.recipient
      {
        assert i in m.items;
      }
    }
    assert alwaysReviewRowsNameARequest(after) by {
      forall i | i in after.items && i.key.kind.ReinstatementReview?
        ensures exists q :: q in after.requests && q.id == i.key.subject
      {
        if i in m.items {
          var q :| q in m.requests && q.id == i.key.subject;
          assert q in after.requests;
        } else {
          assert enforcement.reinstatementRequest && i.key == reviewKey(enforcement);
          if exists q :: q in m.requests && q.id == enforcement.id {
            var q :| q in m.requests && q.id == enforcement.id;
            assert q in after.requests;
          } else {
            assert ReviewRequest(enforcement.id, true) in after.requests;
          }
        }
      }
    }
  }
}

lemma lawPlacingModeratorNotAsked_ensures(m: Moderation, enforcement: Enforcement)
  ensures (lawPlacingModeratorNotAsked(m, enforcement) == true)
{
  var step1 := addOnce([], enforcementKey(enforcement), enforcement.applicant);
  var owners := addOnce(step1, enforcementKey(enforcement), enforcement.steward);
  if enforcement.reinstatementRequest {
    var f := (acc: seq<Item>, r: int) => (if (r != enforcement.placedBy) then addOnce(acc, reviewKey(enforcement), r) else acc);
    FoldAddOnceMembers(f, owners, m.moderators, reviewKey(enforcement), enforcement.placedBy);
  }
}

lemma noteUnderfunded_ensures(m: Moderation, by_: int, project: int, period: int, steward: int)
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysOneRowPerKeyAndRecipient(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysScamRowsFromPenalty(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysOnePenaltyPerItem(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysAppealRowsForOthers(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysCasesUnique(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysOneUnderfundedRowPerMonth(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysReviewRowsNameARequest(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> alwaysDecisionsRecorded(noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> stepShownOnlyWhenVisible(m, noteUnderfunded(m, by_, project, period, steward)))
  ensures (inv(m) ==> canNoteUnderfunded(m, by_, project, period, steward) ==> stepHistoryRetained(m, noteUnderfunded(m, by_, project, period, steward)))
{
  if inv(m) && canNoteUnderfunded(m, by_, project, period, steward) {
    if !(exists i :: i in m.items && i.key == underfundedKey(project, period)) {
      var after := noteUnderfunded(m, by_, project, period, steward);
      OneRowFilter(m);
      OneUnderfundedFilter(m);
      AddOncePreserves(m.items, underfundedKey(project, period), steward);
      OneRowFilter(after);
      OneUnderfundedFilter(after);
    }
  }
}

lemma noteCut_ensures(m: Moderation, by_: int, project: int, period: int, sequence: int, recipient: int)
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysOneRowPerKeyAndRecipient(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysScamRowsFromPenalty(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysOnePenaltyPerItem(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysAppealRowsForOthers(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysCasesUnique(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysOneUnderfundedRowPerMonth(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysReviewRowsNameARequest(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> alwaysDecisionsRecorded(noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> stepShownOnlyWhenVisible(m, noteCut(m, by_, project, period, sequence, recipient)))
  ensures (inv(m) ==> canNoteCut(m, by_, project, period, sequence, recipient) ==> stepHistoryRetained(m, noteCut(m, by_, project, period, sequence, recipient)))
{
  if inv(m) && canNoteCut(m, by_, project, period, sequence, recipient) {
    var after := noteCut(m, by_, project, period, sequence, recipient);
    OneRowFilter(m);
    OneUnderfundedFilter(m);
    AddOncePreserves(m.items, cutKey(project, period, sequence), recipient);
    OneRowFilter(after);
    OneUnderfundedFilter(after);
  }
}

lemma closeReinstatementRequest_ensures(m: Moderation, by_: int, id: string)
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysOneRowPerKeyAndRecipient(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysScamRowsFromPenalty(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysOnePenaltyPerItem(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysAppealRowsForOthers(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysCasesUnique(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysOneUnderfundedRowPerMonth(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysReviewRowsNameARequest(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> alwaysDecisionsRecorded(closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> stepShownOnlyWhenVisible(m, closeReinstatementRequest(m, by_, id)))
  ensures (inv(m) ==> canCloseReinstatementRequest(m, by_, id) ==> stepHistoryRetained(m, closeReinstatementRequest(m, by_, id)))
{
  if inv(m) && canCloseReinstatementRequest(m, by_, id) {
    var after := closeReinstatementRequest(m, by_, id);
    forall i | i in after.items && i.key.kind.ReinstatementReview?
      ensures exists q :: q in after.requests && q.id == i.key.subject
    {
      var q :| q in m.requests && q.id == i.key.subject;
      var k :| 0 <= k < |m.requests| && m.requests[k] == q;
      assert after.requests[k] in after.requests && after.requests[k].id == q.id;
    }
  }
}

lemma openItem_ensures(m: Moderation, by_: int, key: Key, authority: AuthorityCheck)
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysOneRowPerKeyAndRecipient(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysScamRowsFromPenalty(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysOnePenaltyPerItem(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysAppealRowsForOthers(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysCasesUnique(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysOneUnderfundedRowPerMonth(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysReviewRowsNameARequest(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> alwaysDecisionsRecorded(openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> stepShownOnlyWhenVisible(m, openItem(m, by_, key, authority)))
  ensures (inv(m) ==> canOpenItem(m, by_, key, authority) ==> stepHistoryRetained(m, openItem(m, by_, key, authority)))
{
  if inv(m) && canOpenItem(m, by_, key, authority) {
    var after := openItem(m, by_, key, authority);
    if readResult(m, by_, key, authority).Shown? {
      OneRowFilter(m);
      OneRowFilter(after);
      OneUnderfundedFilter(m);
      OneUnderfundedFilter(after);
      forall i | i in m.items
        ensures exists o :: o in after.items && o.key == i.key && o.recipient == i.recipient && (i.readAt > 0 ==> o.readAt == i.readAt)
      {
        var k :| 0 <= k < |m.items| && m.items[k] == i;
        assert after.items[k] in after.items;
      }
      forall i | i in after.items
        ensures i.recipient > 0 && |ProofLib.Filter((o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), after.items)| == 1
        ensures i.key.kind.MonthlyUnderfunded? ==> |ProofLib.Filter((o: Item) => (o.key == i.key), after.items)| == 1
      {
        var k :| 0 <= k < |after.items| && after.items[k] == i;
        var prev := m.items[k];
        assert prev in m.items && prev.key == i.key && prev.recipient == i.recipient;
        ProofLib.FilterLengthPointwise((o: Item) => ((o.key == prev.key) && (o.recipient == prev.recipient)), (o: Item) => ((o.key == i.key) && (o.recipient == i.recipient)), m.items, after.items);
        if i.key.kind.MonthlyUnderfunded? {
          ProofLib.FilterLengthPointwise((o: Item) => (o.key == prev.key), (o: Item) => (o.key == i.key), m.items, after.items);
        }
      }
    }
  }
}

lemma DecideCasesHelper(m: Moderation, by_: int, caseKey: string, reasonLength: int, resulting: Outcome)
  requires inv(m) && canDecide(m, by_, caseKey, reasonLength, resulting)
  ensures alwaysAppealRowsForOthers(decide(m, by_, caseKey, reasonLength, resulting))
  ensures alwaysCasesUnique(decide(m, by_, caseKey, reasonLength, resulting))
  ensures stepHistoryRetained(m, decide(m, by_, caseKey, reasonLength, resulting))
{
  var after := decide(m, by_, caseKey, reasonLength, resulting);
  forall i | i in after.items && i.key.kind.AppealReview?
    ensures exists c :: c in after.cases && c.key == i.key.subject && c.escalated && c.appellant != i.recipient
  {
    var c :| c in m.cases && c.key == i.key.subject && c.escalated && c.appellant != i.recipient;
    var k :| 0 <= k < |m.cases| && m.cases[k] == c;
    assert after.cases[k] in after.cases;
  }
  forall c | c in m.cases
    ensures exists o :: o in after.cases && o.key == c.key && o.appellant == c.appellant && (c.resolved ==> o.resolved)
  {
    var k :| 0 <= k < |m.cases| && m.cases[k] == c;
    assert after.cases[k] in after.cases;
  }
  CasesUniqueFilter(m);
  CasesUniqueFilter(after);
  forall c | c in after.cases
    ensures c.key != "" && c.appellant > 0 && c.escalated && |ProofLib.Filter((o: Case) => (o.key == c.key), after.cases)| == 1
  {
    var k :| 0 <= k < |after.cases| && after.cases[k] == c;
    var prev := m.cases[k];
    assert prev in m.cases && prev.key == c.key;
    ProofLib.FilterLengthPointwise((o: Case) => (o.key == prev.key), (o: Case) => (o.key == c.key), m.cases, after.cases);
  }
}

lemma DecideCaseOfHelper(m: Moderation, by_: int, caseKey: string, reasonLength: int, resulting: Outcome, k: string)
  requires inv(m) && canDecide(m, by_, caseKey, reasonLength, resulting)
  ensures k == caseKey ==> caseOf(decide(m, by_, caseKey, reasonLength, resulting), k) == caseOf(m, k).(resolved := true)
  ensures k != caseKey ==> caseOf(decide(m, by_, caseKey, reasonLength, resulting), k) == caseOf(m, k)
{
  var after := decide(m, by_, caseKey, reasonLength, resulting);
  CaseOfFilter(m, k);
  CaseOfFilter(after, k);
  if k == caseKey {
    CaseOfInCases(m, caseKey);
    ProofLib.FilterPointwise((c: Case) => (c.key == k), (c: Case) => (c.key == k), (a: Case, b: Case) => b == (if a.key == caseKey then a.(resolved := true) else a), m.cases, after.cases);
  } else {
    ProofLib.FilterPointwise((c: Case) => (c.key == k), (c: Case) => (c.key == k), (a: Case, b: Case) => a.key == k ==> b == a, m.cases, after.cases);
  }
}

lemma DecideDecisionsHelper(m: Moderation, by_: int, caseKey: string, reasonLength: int, resulting: Outcome)
  requires inv(m) && canDecide(m, by_, caseKey, reasonLength, resulting)
  ensures alwaysDecisionsRecorded(decide(m, by_, caseKey, reasonLength, resulting))
{
  var after := decide(m, by_, caseKey, reasonLength, resulting);
  var added := Decision(caseKey, by_, reasonLength, resulting, false);
  DecisionsFilter(m);
  DecisionsFilter(after);
  CaseOfInCases(m, caseKey);
  var c0 := caseOf(m, caseKey);
  assert !c0.resolved;
  assert !(exists d :: d in m.decisions && d.caseKey == caseKey);
  DecideCaseOfHelper(m, by_, caseKey, reasonLength, resulting, caseKey);
  forall d | d in after.decisions
    ensures d.reasonLength >= 1 && d.reasonLength <= 4000 && caseOf(after, d.caseKey).resolved && caseOf(after, d.caseKey).appellant != d.by_ && |ProofLib.Filter((o: Decision) => (o.caseKey == d.caseKey), after.decisions)| == 1
  {
    var pred := (o: Decision) => (o.caseKey == d.caseKey);
    ProofLib.FilterAppend(pred, m.decisions, added);
    if d in m.decisions {
      assert d.caseKey != caseKey;
      DecideCaseOfHelper(m, by_, caseKey, reasonLength, resulting, d.caseKey);
    } else {
      assert d == added;
      ProofLib.FilterNone(pred, m.decisions);
    }
  }
  forall c | c in after.cases
    ensures c.resolved == (exists d :: d in after.decisions && d.caseKey == c.key)
  {
    var k :| 0 <= k < |after.cases| && after.cases[k] == c;
    var prev := m.cases[k];
    assert prev in m.cases;
    if c.key == caseKey {
      assert added in after.decisions;
    } else {
      assert c == prev;
      if exists d :: d in m.decisions && d.caseKey == c.key {
        var d :| d in m.decisions && d.caseKey == c.key;
        assert d in after.decisions;
      }
    }
  }
}

lemma decide_ensures(m: Moderation, by_: int, caseKey: string, reasonLength: int, resulting: Outcome)
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysOneRowPerKeyAndRecipient(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysScamRowsFromPenalty(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysOnePenaltyPerItem(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysAppealRowsForOthers(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysCasesUnique(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysOneUnderfundedRowPerMonth(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysReviewRowsNameARequest(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> alwaysDecisionsRecorded(decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> stepShownOnlyWhenVisible(m, decide(m, by_, caseKey, reasonLength, resulting)))
  ensures (inv(m) ==> canDecide(m, by_, caseKey, reasonLength, resulting) ==> stepHistoryRetained(m, decide(m, by_, caseKey, reasonLength, resulting)))
{
  if inv(m) && canDecide(m, by_, caseKey, reasonLength, resulting) {
    var after := decide(m, by_, caseKey, reasonLength, resulting);
    assert after.items == m.items && after.penalties == m.penalties && after.requests == m.requests && after.reads_ == m.reads_;
    OneRowFilter(m);
    OneRowFilter(after);
    OnePenaltyFilter(m);
    OnePenaltyFilter(after);
    OneUnderfundedFilter(m);
    OneUnderfundedFilter(after);
    DecideCasesHelper(m, by_, caseKey, reasonLength, resulting);
    DecideDecisionsHelper(m, by_, caseKey, reasonLength, resulting);
  }
}

lemma confirmOutcome_ensures(m: Moderation, by_: int, caseKey: string)
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysOneRowPerKeyAndRecipient(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysScamRowsFromPenalty(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysOnePenaltyPerItem(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysAppealRowsForOthers(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysCasesUnique(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysOneUnderfundedRowPerMonth(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysReviewRowsNameARequest(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> alwaysDecisionsRecorded(confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> stepShownOnlyWhenVisible(m, confirmOutcome(m, by_, caseKey)))
  ensures (inv(m) ==> canConfirmOutcome(m, by_, caseKey) ==> stepHistoryRetained(m, confirmOutcome(m, by_, caseKey)))
{
  if inv(m) && canConfirmOutcome(m, by_, caseKey) {
    var after := confirmOutcome(m, by_, caseKey);
    DecisionsFilter(m);
    DecisionsFilter(after);
    forall d | d in m.decisions
      ensures exists o :: o in after.decisions && o.caseKey == d.caseKey && o.by_ == d.by_ && o.reasonLength == d.reasonLength && o.resulting == d.resulting && (d.confirmed ==> o.confirmed)
    {
      var k :| 0 <= k < |m.decisions| && m.decisions[k] == d;
      assert after.decisions[k] in after.decisions;
    }
    forall d | d in after.decisions
      ensures d.reasonLength >= 1 && d.reasonLength <= 4000 && caseOf(after, d.caseKey).resolved && caseOf(after, d.caseKey).appellant != d.by_ && |ProofLib.Filter((o: Decision) => (o.caseKey == d.caseKey), after.decisions)| == 1
    {
      var k :| 0 <= k < |after.decisions| && after.decisions[k] == d;
      var prev := m.decisions[k];
      assert prev in m.decisions && prev.caseKey == d.caseKey;
      ProofLib.FilterLengthPointwise((o: Decision) => (o.caseKey == prev.caseKey), (o: Decision) => (o.caseKey == d.caseKey), m.decisions, after.decisions);
    }
    forall c | c in after.cases
      ensures c.resolved == (exists d :: d in after.decisions && d.caseKey == c.key)
    {
      if c.resolved {
        var d :| d in m.decisions && d.caseKey == c.key;
        var k :| 0 <= k < |m.decisions| && m.decisions[k] == d;
        assert after.decisions[k] in after.decisions;
      } else {
        forall d | d in after.decisions
          ensures d.caseKey != c.key
        {
          var k :| 0 <= k < |after.decisions| && after.decisions[k] == d;
          assert m.decisions[k] in m.decisions;
        }
      }
    }
  }
}
