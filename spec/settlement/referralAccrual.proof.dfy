// Month collection consumes the first immutable source payout in order.
lemma TailAndNewRecordPreserveIdentity(a: Accrual, after: Accrual)
  requires inv(a) && canAccrueNext(a) && after == accrueNext(a)
  ensures alwaysPendingUnique(after) && alwaysUniquePayouts(after)
{
  var p := a.pending[0];
  var r := nextAccrual(a);
  assert r.payout == p && p in a.pending;
  assert after.pending == a.pending[1..];
  assert allRecords(after) == allRecords(a) + [r];
  assert |ProofLib.Filter((other: Payout) => (other.id == p.id), a.pending)| == 1;
  assert !(exists priorEntry :: priorEntry in allRecords(a) && priorEntry.payout.id == p.id);
  ProofLib.FilterCountOneIffUnique((other: Payout) => (other.id == p.id), a.pending, (x: Payout) => x.id, 0);
  forall t | t in after.pending ensures settlement__money_validAmount(t.gross) && |ProofLib.Filter((other: Payout) => (other.id == t.id), after.pending)| == 1 &&
    !(exists priorEntry :: priorEntry in allRecords(after) && priorEntry.payout.id == t.id) {
    assert exists i :: 0 <= i < |after.pending| && after.pending[i] == t;
    assert forall i :: 0 <= i < |after.pending| ==> after.pending[i] == a.pending[i + 1];
    assert t.id != p.id;
    assert t in a.pending;
    ProofLib.FilterCons((other: Payout) => (other.id == t.id), a.pending);
    assert |ProofLib.Filter((other: Payout) => (other.id == t.id), a.pending)| == 1;
    assert !(exists priorEntry :: priorEntry in allRecords(a) && priorEntry.payout.id == t.id);
  }
  forall priorEntry | priorEntry in allRecords(after) ensures
    |ProofLib.Filter((other: AccrualRecord) => (other.payout.id == priorEntry.payout.id), allRecords(after))| == 1 {
    ProofLib.FilterAppend((other: AccrualRecord) => (other.payout.id == priorEntry.payout.id), allRecords(a), r);
    if priorEntry == r {
      ProofLib.FilterNone((other: AccrualRecord) => (other.payout.id == priorEntry.payout.id), allRecords(a));
    } else {
      assert priorEntry in allRecords(a);
      assert |ProofLib.Filter((other: AccrualRecord) => (other.payout.id == priorEntry.payout.id), allRecords(a))| == 1;
    }
  }
}

lemma FoldTotalEmpty(a: Accrual)
  requires |allRecords(a)| == 0
  ensures totalAccrued(a) == settlement__money_zero
{
  assert allRecords(a) == [];
}


lemma SumRecordLimbAmounts(xs: seq<AccrualRecord>, total: seq<int>, project: int)
  requires settlement__money_validAmount(total)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, (if (r.payout.project == project) then r.amount else settlement__money_zero)), total, xs))
  decreases |xs|
{
  if |xs| > 0 {
    var head := xs[0];
    assert head in xs;
    var increment := if head.payout.project == project then head.amount else settlement__money_zero;
    settlement__money_lawAdditionValid_ensures(total, increment);
    assert forall r :: r in xs[1..] ==> r in xs;
    SumRecordLimbAmounts(xs[1..], settlement__money_addAmounts(total, increment), project);
  }
}

lemma SumActorLimbAmounts(actor: int, xs: seq<AccrualRecord>, total: seq<int>)
  requires settlement__money_validAmount(total)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, (if (r.referrer == actor) then r.amount else settlement__money_zero)), total, xs))
  decreases |xs|
{
  if |xs| > 0 {
    var head := xs[0];
    assert head in xs;
    var increment := if head.referrer == actor then head.amount else settlement__money_zero;
    settlement__money_lawAdditionValid_ensures(total, increment);
    assert forall r :: r in xs[1..] ==> r in xs;
    SumActorLimbAmounts(actor, xs[1..], settlement__money_addAmounts(total, increment));
  }
}

lemma SumEntryLimbAmounts(xs: seq<RootEntry>, total: seq<int>)
  requires settlement__money_validAmount(total)
  requires forall entry :: entry in xs ==> settlement__money_validAmount(entry.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, e: RootEntry) => settlement__money_addAmounts(total, e.amount), total, xs))
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    settlement__money_lawAdditionValid_ensures(total, xs[0].amount);
    assert forall entry :: entry in xs[1..] ==> entry in xs;
    SumEntryLimbAmounts(xs[1..], settlement__money_addAmounts(total, xs[0].amount));
  }
}

lemma EntryFields(a: Accrual, wallets: seq<Wallet>, entry: RootEntry)
  requires entry in rootEntries(a, wallets)
  ensures entry.actor in actors(a) && entry.wallet == eligibleWallet(a, wallets, entry.actor) && entry.wallet != "" &&
    entry.amount == actorAccrued(a, entry.actor) && settlement__money_positiveAmount(entry.amount)
{
  var funded := (actor: int) => ((eligibleWallet(a, wallets, actor) != "") && settlement__money_positiveAmount(actorAccrued(a, actor)));
  var kept := ProofLib.Filter(funded, actors(a));
  var entries := rootEntries(a, wallets);
  var i :| 0 <= i < |entries| && entries[i] == entry;
  assert |entries| == |kept|;
  var actor := kept[i];
  assert entries[i] == RootEntry(actor, eligibleWallet(a, wallets, actor), actorAccrued(a, actor));
  assert actor in kept;
  ProofLib.FilterMember(funded, actors(a), actor);
}


lemma AuthorisedPinFromEntries(a: Accrual, entries: seq<RootEntry>, pins: seq<Wallet>, pin: Wallet)
  requires pin in pins
  requires pins == (var s_map := ProofLib.Filter((e: RootEntry) => (pinnedWallet(a.pins, e.actor) == ""), entries); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var e := s_map[i_map]; Wallet(e.actor, e.wallet, true)))
  ensures exists e :: e in entries && pin.actor == e.actor && pin.wallet == e.wallet && pinnedWallet(a.pins, e.actor) == ""
{
  var eligible := (e: RootEntry) => (pinnedWallet(a.pins, e.actor) == "");
  var kept := ProofLib.Filter(eligible, entries);
  var i :| 0 <= i < |pins| && pins[i] == pin;
  assert |kept| == |pins|;
  var entry := kept[i];
  assert pin == Wallet(entry.actor, entry.wallet, true);
  assert entry in kept;
  ProofLib.FilterMember(eligible, entries, entry);
}

lemma NewlyPinnedWalletNotAlreadyHeld(a: Accrual, wallets: seq<Wallet>, entry: RootEntry)
  requires entry in rootEntries(a, wallets) && pinnedWallet(a.pins, entry.actor) == ""
  ensures entry.wallet == walletFor(wallets, entry.actor) && entry.wallet != ""
  ensures !(exists pin :: pin in a.pins && pin.wallet == entry.wallet)
  ensures !(exists other :: (other in actors(a) && other < entry.actor && pinnedWallet(a.pins, other) == "" &&
    walletFor(wallets, other) == entry.wallet && settlement__money_positiveAmount(actorAccrued(a, other))))
{
  EntryFields(a, wallets, entry);
}

lemma NewPinEntriesDoNotShareWallet(a: Accrual, wallets: seq<Wallet>, left: RootEntry, right: RootEntry)
  requires left in rootEntries(a, wallets) && right in rootEntries(a, wallets)
  requires pinnedWallet(a.pins, left.actor) == "" && pinnedWallet(a.pins, right.actor) == ""
  requires left.actor != right.actor
  ensures left.wallet != right.wallet
{
  NewlyPinnedWalletNotAlreadyHeld(a, wallets, left);
  NewlyPinnedWalletNotAlreadyHeld(a, wallets, right);
  EntryFields(a, wallets, left);
  EntryFields(a, wallets, right);
  if left.wallet == right.wallet {
    if left.actor < right.actor {
      assert left.actor in actors(a) && pinnedWallet(a.pins, left.actor) == "";
      assert walletFor(wallets, left.actor) == right.wallet;
      assert settlement__money_positiveAmount(actorAccrued(a, left.actor));
    } else {
      assert right.actor in actors(a) && pinnedWallet(a.pins, right.actor) == "";
      assert walletFor(wallets, right.actor) == left.wallet;
      assert settlement__money_positiveAmount(actorAccrued(a, right.actor));
    }
  }
}

lemma ActorsOrderedEntries(attribs: seq<Attribution>, found: seq<int>)
  requires ProofLib.Distinct(found)
  ensures ProofLib.Distinct(Std.Collections.Seq.FoldLeft((found: seq<int>, entry: Attribution) => (if ((entry.referrer > 0) && !((entry.referrer in found))) then ((Std.Collections.Seq.Filter((actor: int) => (actor < entry.referrer), found) + [entry.referrer]) + Std.Collections.Seq.Filter((actor: int) => (actor > entry.referrer), found)) else found), found, attribs))
  decreases |attribs|
{
  if |attribs| > 0 {
    var entry := attribs[0];
    var ref := entry.referrer;
    if ref > 0 && ref !in found {
      var less := (actor: int) => (actor < ref);
      var greater := (actor: int) => (actor > ref);
      var left := ProofLib.Filter(less, found);
      var right := ProofLib.Filter(greater, found);
      assert ProofLib.DistinctBy(found, (actor: int) => actor);
      ProofLib.FilterKeepsDistinctBy(less, found, (actor: int) => actor);
      ProofLib.FilterKeepsDistinctBy(greater, found, (actor: int) => actor);
      forall x | x in left ensures x < ref { ProofLib.FilterMember(less, found, x); }
      forall x | x in right ensures x > ref { ProofLib.FilterMember(greater, found, x); }
      ProofLib.DistinctByConcat(left, [ref], (actor: int) => actor);
      ProofLib.DistinctByConcat(left + [ref], right, (actor: int) => actor);
      assert ProofLib.Distinct(left + [ref] + right);
      ActorsOrderedEntries(attribs[1..], left + [ref] + right);
    } else {
      ActorsOrderedEntries(attribs[1..], found);
    }
  }
}

lemma PinnedWalletReturnsRetainedOrBase(pins: seq<Wallet>, actor: int, initial: string)
  ensures var resolved := Std.Collections.Seq.FoldLeft((found: string, pin: Wallet) => (if pin.actor == actor then pin.wallet else found), initial, pins);
    resolved == initial || (exists pin :: pin in pins && pin.actor == actor && pin.wallet == resolved)
  decreases |pins|
{
  if |pins| > 0 {
    var first := pins[0];
    assert first in pins;
    assert forall p :: p in pins[1..] ==> p in pins;
    PinnedWalletReturnsRetainedOrBase(pins[1..], actor, if first.actor == actor then first.wallet else initial);
  }
}

lemma PinnedWalletLookupOfUniqueKey(pins: seq<Wallet>, pin: Wallet, initial: string)
  requires pin in pins && ProofLib.DistinctBy(pins, (w: Wallet) => w.actor)
  ensures Std.Collections.Seq.FoldLeft((found: string, row: Wallet) => (if row.actor == pin.actor then row.wallet else found), initial, pins) == pin.wallet
  decreases |pins|
{
  var first := pins[0];
  var rest := pins[1..];
  assert pins == [first] + rest;
  if first.actor == pin.actor {
    forall other | other in rest ensures other.actor != pin.actor {
      var j :| 0 <= j < |rest| && rest[j] == other;
      assert pins[j + 1] == other;
    }
    if pin != first {
      assert pin in rest;
      assert pin.actor != pin.actor;
    }
    PinnedWalletReturnsRetainedOrBase(rest, pin.actor, pin.wallet);
  } else {
    assert pin in rest;
    forall i, j | 0 <= i < |rest| && 0 <= j < |rest| && i != j ensures rest[i].actor != rest[j].actor {
      assert pins[i + 1] == rest[i] && pins[j + 1] == rest[j];
    }
    PinnedWalletLookupOfUniqueKey(rest, pin, initial);
  }
}

lemma RetainedPinsHaveDistinctKeys(a: Accrual)
  requires alwaysPinsUnique(a)
  ensures ProofLib.DistinctBy(a.pins, (w: Wallet) => w.actor) && ProofLib.DistinctBy(a.pins, (w: Wallet) => w.wallet)
  ensures forall p :: p in a.pins ==> p.wallet != ""
{
  forall i, j | 0 <= i < |a.pins| && 0 <= j < |a.pins| && i != j ensures a.pins[i].actor != a.pins[j].actor && a.pins[i].wallet != a.pins[j].wallet {
    var p := a.pins[i];
    assert p in a.pins;
    ProofLib.FilterCountOneIffUnique((other: Wallet) => (other.actor == p.actor), a.pins, (w: Wallet) => w.actor, i);
    ProofLib.FilterCountOneIffUnique((other: Wallet) => (other.wallet == p.wallet), a.pins, (w: Wallet) => w.wallet, i);
  }
}

lemma DistinctKeysGivePinCounts(a: Accrual)
  requires ProofLib.DistinctBy(a.pins, (w: Wallet) => w.actor) && ProofLib.DistinctBy(a.pins, (w: Wallet) => w.wallet)
  requires forall pin :: pin in a.pins ==> pin.wallet != ""
  ensures alwaysPinsUnique(a)
{
  forall i | 0 <= i < |a.pins| ensures
    |ProofLib.Filter((other: Wallet) => (other.actor == a.pins[i].actor), a.pins)| == 1 &&
    |ProofLib.Filter((other: Wallet) => (other.wallet == a.pins[i].wallet), a.pins)| == 1 {
    var p := a.pins[i];
    ProofLib.FilterCountOneIffUnique((other: Wallet) => (other.actor == p.actor), a.pins, (w: Wallet) => w.actor, i);
    ProofLib.FilterCountOneIffUnique((other: Wallet) => (other.wallet == p.wallet), a.pins, (w: Wallet) => w.wallet, i);
  }
}

lemma RootEntryActorsAreUnique(a: Accrual, wallets: seq<Wallet>)
  ensures ProofLib.DistinctBy(rootEntries(a, wallets), (e: RootEntry) => e.actor)
{
  ActorsOrderedEntries(a.attributions, []);
  var funded := (actor: int) => ((eligibleWallet(a, wallets, actor) != "") && settlement__money_positiveAmount(actorAccrued(a, actor)));
  var kept := ProofLib.Filter(funded, actors(a));
  var entries := rootEntries(a, wallets);
  assert ProofLib.DistinctBy(actors(a), (actor: int) => actor);
  ProofLib.FilterKeepsDistinctBy(funded, actors(a), (actor: int) => actor);
  assert |kept| == |entries|;
  forall i, j | 0 <= i < |entries| && 0 <= j < |entries| && i != j ensures entries[i].actor != entries[j].actor {
    assert entries[i].actor == kept[i] && entries[j].actor == kept[j];
  }
}

lemma NewPinsHaveDistinctKeys(a: Accrual, wallets: seq<Wallet>, kept: seq<RootEntry>, pins: seq<Wallet>)
  requires kept == ProofLib.Filter((e: RootEntry) => (pinnedWallet(a.pins, e.actor) == ""), rootEntries(a, wallets))
  requires pins == seq(|kept|, i requires 0 <= i < |kept| => Wallet(kept[i].actor, kept[i].wallet, true))
  ensures ProofLib.DistinctBy(pins, (w: Wallet) => w.actor) && ProofLib.DistinctBy(pins, (w: Wallet) => w.wallet)
{
  RootEntryActorsAreUnique(a, wallets);
  var eligible := (e: RootEntry) => (pinnedWallet(a.pins, e.actor) == "");
  var entries := rootEntries(a, wallets);
  ProofLib.FilterKeepsDistinctBy(eligible, entries, (e: RootEntry) => e.actor);
  forall i, j | 0 <= i < |pins| && 0 <= j < |pins| && i != j ensures pins[i].actor != pins[j].actor && pins[i].wallet != pins[j].wallet {
    var left := kept[i];
    var right := kept[j];
    assert left in kept && right in kept;
    ProofLib.FilterMember(eligible, entries, left);
    ProofLib.FilterMember(eligible, entries, right);
    assert left.actor != right.actor;
    NewPinEntriesDoNotShareWallet(a, wallets, left, right);
    assert pins[i] == Wallet(left.actor, left.wallet, true) && pins[j] == Wallet(right.actor, right.wallet, true);
  }
}

lemma PreservePinsAtFiling(a: Accrual, after: Accrual, wallets: seq<Wallet>, kept: seq<RootEntry>, added: seq<Wallet>)
  requires alwaysPinsUnique(a)
  requires kept == ProofLib.Filter((e: RootEntry) => (pinnedWallet(a.pins, e.actor) == ""), rootEntries(a, wallets))
  requires added == seq(|kept|, i requires 0 <= i < |kept| => Wallet(kept[i].actor, kept[i].wallet, true))
  requires after.pins == a.pins + added
  ensures alwaysPinsUnique(after)
{
  var entries := rootEntries(a, wallets);
  RetainedPinsHaveDistinctKeys(a);
  NewPinsHaveDistinctKeys(a, wallets, kept, added);
  forall p | p in added ensures p.wallet != "" && (forall retained :: retained in a.pins ==> retained.actor != p.actor && retained.wallet != p.wallet) {
    AuthorisedPinFromEntries(a, entries, added, p);
    var e :| e in entries && p.actor == e.actor && p.wallet == e.wallet && pinnedWallet(a.pins, e.actor) == "";
    NewlyPinnedWalletNotAlreadyHeld(a, wallets, e);
    forall retained | retained in a.pins ensures retained.actor != p.actor && retained.wallet != p.wallet {
      if retained.actor == p.actor {
        PinnedWalletLookupOfUniqueKey(a.pins, retained, "");
        assert retained.wallet != "";
        assert pinnedWallet(a.pins, retained.actor) != "";
      }
    }
  }
  ProofLib.DistinctByConcat(a.pins, added, (w: Wallet) => w.actor);
  ProofLib.DistinctByConcat(a.pins, added, (w: Wallet) => w.wallet);
  forall p | p in after.pins ensures p.wallet != "" { assert p in a.pins || p in added; }
  DistinctKeysGivePinCounts(after);
}

lemma FiledEntriesPinWitnesses(a: Accrual, after: Accrual, wallets: seq<Wallet>, kept: seq<RootEntry>, added: seq<Wallet>)
  requires kept == ProofLib.Filter((e: RootEntry) => (pinnedWallet(a.pins, e.actor) == ""), rootEntries(a, wallets))
  requires added == seq(|kept|, i requires 0 <= i < |kept| => Wallet(kept[i].actor, kept[i].wallet, true))
  requires after.pins == a.pins + added
  ensures forall e :: e in rootEntries(a, wallets) ==> entryWalletPinned(after.pins, e)
{
  var entries := rootEntries(a, wallets);
  var eligible := (e: RootEntry) => (pinnedWallet(a.pins, e.actor) == "");
  forall e | e in entries ensures entryWalletPinned(after.pins, e) {
    EntryFields(a, wallets, e);
    var prior := pinnedWallet(a.pins, e.actor);
    if prior == "" {
      ProofLib.FilterMember(eligible, entries, e);
      var i :| 0 <= i < |kept| && kept[i] == e;
      var pin := added[i];
      assert pin == Wallet(e.actor, e.wallet, true);
      assert pin in added && pin in after.pins;
    } else {
      PinnedWalletReturnsRetainedOrBase(a.pins, e.actor, "");
      var pin :| pin in a.pins && pin.actor == e.actor && pin.wallet == prior;
      assert prior == eligibleWallet(a, wallets, e.actor);
      assert pin in after.pins;
    }
  }
}

lemma PreserveFiledEntries(a: Accrual, after: Accrual, filed: Filing)
  requires alwaysFileWalletPinned(a)
  requires after.filings == a.filings + [filed]
  requires forall pin :: pin in a.pins ==> pin in after.pins
  requires forall e :: e in filed.entries ==> entryWalletPinned(after.pins, e)
  ensures alwaysFileWalletPinned(after)
{
  forall file | file in after.filings ensures (forall e :: e in file.entries ==> entryWalletPinned(after.pins, e)) {
    if file != filed {
      assert file in a.filings;
      forall e | e in file.entries ensures entryWalletPinned(after.pins, e) {
        assert entryWalletPinned(a.pins, e);
        var pin :| pin in a.pins && pin.actor == e.actor && pin.wallet == e.wallet;
        assert pin in after.pins;
      }
    }
  }
}

lemma AccrualEntriesValid(a: Accrual, wallets: seq<Wallet>)
  requires alwaysCaps(a)
  ensures settlement__money_validAmount(entriesTotal(rootEntries(a, wallets)))
{
  var entries := rootEntries(a, wallets);
  forall entry | entry in entries ensures settlement__money_validAmount(entry.amount) {
    EntryFields(a, wallets, entry);
    SumActorLimbAmounts(entry.actor, allRecords(a), settlement__money_zero);
  }
  SumEntryLimbAmounts(entries, settlement__money_zero);
}

lemma FoldRecordsValid(step: (seq<int>, AccrualRecord) -> seq<int>, xs: seq<AccrualRecord>, total: seq<int>)
  requires settlement__money_validAmount(total)
  requires forall v, r :: r in xs && settlement__money_validAmount(v) ==> settlement__money_validAmount(step(v, r))
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft(step, total, xs))
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall r :: r in xs[1..] ==> r in xs;
    FoldRecordsValid(step, xs[1..], step(total, xs[0]));
  }
}

lemma FoldRecordsConcat(step: (seq<int>, AccrualRecord) -> seq<int>, xs: seq<AccrualRecord>, ys: seq<AccrualRecord>, start: seq<int>)
  ensures Std.Collections.Seq.FoldLeft(step, start, xs + ys) ==
    Std.Collections.Seq.FoldLeft(step, Std.Collections.Seq.FoldLeft(step, start, xs), ys)
  decreases |xs|
{
  if |xs| > 0 {
    assert (xs + ys)[1..] == xs[1..] + ys;
    FoldRecordsConcat(step, xs[1..], ys, step(start, xs[0]));
  } else { assert xs == [] && xs + ys == ys; }
}

lemma FoldRecordsMonotone(step: (seq<int>, AccrualRecord) -> seq<int>, xs: seq<AccrualRecord>, total: seq<int>)
  requires settlement__money_validAmount(total)
  requires forall v, r :: r in xs && settlement__money_validAmount(v) ==> settlement__money_validAmount(step(v, r)) && settlement__money_compareAmounts(v, step(v, r)) <= 0
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft(step, total, xs))
  ensures settlement__money_compareAmounts(total, Std.Collections.Seq.FoldLeft(step, total, xs)) <= 0
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall r :: r in xs[1..] ==> r in xs;
    var next := step(total, xs[0]);
    FoldRecordsMonotone(step, xs[1..], next);
    settlement__money_lawNumericOrderTransitive_ensures(total, next, Std.Collections.Seq.FoldLeft(step, next, xs[1..]));
  } else {
    settlement__money_lawEqualReflexive_ensures(total);
  }
}

lemma FoldUnderAbandon(step: (seq<int>, AccrualRecord) -> seq<int>, a: Accrual, cap: seq<int>)
  requires settlement__money_validAmount(cap)
  requires forall v, r :: r in allRecords(a) && settlement__money_validAmount(v) ==> settlement__money_validAmount(step(v, r)) && settlement__money_compareAmounts(v, step(v, r)) <= 0
  requires settlement__money_compareAmounts(Std.Collections.Seq.FoldLeft(step, settlement__money_zero, allRecords(a)), cap) <= 0
  ensures settlement__money_compareAmounts(Std.Collections.Seq.FoldLeft(step, settlement__money_zero, a.records), cap) <= 0
{
  assert forall r :: r in a.records ==> r in allRecords(a);
  assert forall r :: r in a.staged ==> r in allRecords(a);
  var start := settlement__money_zero;
  FoldRecordsValid(step, a.records, start);
  FoldRecordsConcat(step, a.records, a.staged, start);
  var filed := Std.Collections.Seq.FoldLeft(step, start, a.records);
  FoldRecordsMonotone(step, a.staged, filed);
  var combined := Std.Collections.Seq.FoldLeft(step, start, allRecords(a));
  assert combined == Std.Collections.Seq.FoldLeft(step, filed, a.staged);
  settlement__money_lawNumericOrderTransitive_ensures(filed, combined, cap);
}

lemma AbandonRespectsCaps(a: Accrual, after: Accrual)
  requires alwaysCaps(a) && alwaysUnitValid(a) && after.records == a.records && after.staged == [] && after.tokenUnit == a.tokenUnit
  ensures alwaysCaps(after)
{
  assert allRecords(after) == a.records;
  ValidPoolAndProjectCaps(a);
  var totalStep := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, r.amount);
  forall v, row | row in allRecords(a) && settlement__money_validAmount(v)
    ensures settlement__money_validAmount(totalStep(v, row)) && settlement__money_compareAmounts(v, totalStep(v, row)) <= 0 {
    settlement__money_lawAdditionValid_ensures(v, row.amount);
    settlement__money_lawAddMonotone_ensures(v, row.amount);
    settlement__money_lawNumericOrderTotal_ensures(v, totalStep(v, row));
  }
  FoldUnderAbandon(totalStep, a, poolCap(a));
  forall r | r in allRecords(after) ensures settlement__money_validAmount(r.amount) &&
    settlement__money_compareAmounts(projectAccrued(after, r.payout.project), projectCap(after)) <= 0 {
    assert r in allRecords(a);
    var project := r.payout.project;
    var projectStep := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, (if (r.payout.project == project) then r.amount else settlement__money_zero));
    forall v, row | row in allRecords(a) && settlement__money_validAmount(v)
      ensures settlement__money_validAmount(projectStep(v, row)) && settlement__money_compareAmounts(v, projectStep(v, row)) <= 0 {
      var amount := if row.payout.project == project then row.amount else settlement__money_zero;
      settlement__money_lawAdditionValid_ensures(v, amount);
      settlement__money_lawAddMonotone_ensures(v, amount);
      settlement__money_lawNumericOrderTotal_ensures(v, projectStep(v, row));
    }
    FoldUnderAbandon(projectStep, a, projectCap(a));
  }
}


lemma SelectValidRate(xs: seq<Rate>, period: int, current: Rate)
  requires settlement__money_validAmount(current.numerator)
  requires forall r :: r in xs ==> settlement__money_validAmount(r.numerator)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((selected: Rate, rate: Rate) => (if (rate.fromPeriod <= period) then rate else selected), current, xs).numerator)
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall r :: r in xs[1..] ==> r in xs;
    SelectValidRate(xs[1..], period, if xs[0].fromPeriod <= period then xs[0] else current);
  }
}

lemma ProjectAbsentAccruesZero(a: Accrual, project: int)
  requires !(exists r :: r in allRecords(a) && r.payout.project == project)
  ensures settlement__money_equalAmounts(projectAccrued(a, project), settlement__money_zero)
{
  var step := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, (if (r.payout.project == project) then r.amount else settlement__money_zero));
  var start := settlement__money_zero;
  var xs := allRecords(a);
  settlement__money_lawEqualReflexive_ensures(start);
  forall r, v | r in xs && settlement__money_validAmount(v) && settlement__money_equalAmounts(v, start)
    ensures settlement__money_validAmount(step(v, r)) && settlement__money_equalAmounts(step(v, r), start) {
    settlement__money_lawAdditionValid_ensures(v, start);
    settlement__money_lawZeroIdentity_ensures(v);
    settlement__money_lawEqualSubstitution_ensures(step(v, r), v, start);
  }
  ProjectAbsentFoldZero(step, xs, start);
}

lemma ProjectAbsentFoldZero(step: (seq<int>, AccrualRecord) -> seq<int>, xs: seq<AccrualRecord>, current: seq<int>)
  requires settlement__money_validAmount(current) && settlement__money_equalAmounts(current, settlement__money_zero)
  requires forall r, v :: r in xs && settlement__money_validAmount(v) && settlement__money_equalAmounts(v, settlement__money_zero) ==>
    settlement__money_validAmount(step(v, r)) && settlement__money_equalAmounts(step(v, r), settlement__money_zero)
  ensures settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(step, current, xs), settlement__money_zero)
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall r :: r in xs[1..] ==> r in xs;
    ProjectAbsentFoldZero(step, xs[1..], step(current, xs[0]));
  }
}

lemma ValidPoolAndProjectCaps(a: Accrual)
  requires settlement__money_validAmount(a.tokenUnit)
  ensures settlement__money_validAmount(poolCap(a)) && settlement__money_validAmount(projectCap(a))
{
  var poolUnits := settlement__money_smallAmount(2000000);
  var projectUnits := settlement__money_smallAmount(250000);
  assert poolUnits == [0, 0, 2, 0, 0, 0];
  assert projectUnits == [0, 250, 0, 0, 0, 0];
  settlement__money_lawMultiplyValid_ensures(a.tokenUnit, poolUnits);
  settlement__money_lawMultiplyValid_ensures(a.tokenUnit, projectUnits);
}

lemma ValidTotalAccrued(a: Accrual)
  requires alwaysCaps(a)
  ensures settlement__money_validAmount(totalAccrued(a))
{
  var xs := allRecords(a);
  var step := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, r.amount);
  forall v, r | r in xs && settlement__money_validAmount(v) ensures settlement__money_validAmount(step(v, r)) {
    settlement__money_lawAdditionValid_ensures(v, r.amount);
  }
  FoldRecordsValid(step, xs, settlement__money_zero);
}

lemma ValidBoundedProjectTotal(a: Accrual, project: int)
  requires alwaysCaps(a) && settlement__money_validAmount(projectCap(a))
  ensures settlement__money_validAmount(projectAccrued(a, project)) &&
    settlement__money_compareAmounts(projectAccrued(a, project), projectCap(a)) <= 0
{
  var xs := allRecords(a);
  var start := settlement__money_zero;
  var amount := projectAccrued(a, project);
  var cap := projectCap(a);
  SumRecordLimbAmounts(xs, start, project);
  if exists r :: r in xs && r.payout.project == project {
    var r :| r in xs && r.payout.project == project;
    assert settlement__money_compareAmounts(amount, cap) <= 0;
  } else {
    ProjectAbsentAccruesZero(a, project);
    settlement__money_lawZeroOrder_ensures(cap);
    settlement__money_lawEqualOrder_ensures(amount, start, cap);
  }
}

lemma ValidComputedAmount(a: Accrual, entry: AccrualRecord)
  requires alwaysRatesValid(a) && entry == nextAccrual(a)
  requires settlement__money_validAmount(entry.payout.gross)
  ensures settlement__money_validAmount(entry.computed)
{
  var period := entry.payout.period;
  SelectValidRate(a.rates, period, emptyRate);
  assert entry.rate == rateFor(a, period);
  if entry.eligible {
    settlement__money_lawMultiplyValid_ensures(entry.payout.gross, entry.rate.numerator);
  }
}

lemma AdditionWithinRemainingCapacity(used: seq<int>, limit: seq<int>, amount: seq<int>)
  requires settlement__money_validAmount(used) && settlement__money_validAmount(limit) && settlement__money_validAmount(amount)
  requires settlement__money_compareAmounts(used, limit) <= 0
  requires settlement__money_compareAmounts(amount, settlement__money_subtractAmounts(limit, used)) <= 0
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(used, amount), limit) <= 0
{
  var headroom := settlement__money_subtractAmounts(limit, used);
  var filled := settlement__money_addAmounts(headroom, used);
  var augmented := settlement__money_addAmounts(used, amount);
  settlement__money_lawNumericOrderTotal_ensures(limit, used);
  settlement__money_lawSubtractionValid_ensures(limit, used);
  settlement__money_lawSubtractionReconstructs_ensures(limit, used);
  settlement__money_lawAddOrder_ensures(amount, headroom, used);
  settlement__money_lawAddCommutative_ensures(amount, used);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(amount, used), augmented, filled);
  settlement__money_lawEqualOrder_ensures(filled, limit, augmented);
}

lemma AccrualFitsBothCaps(computed: seq<int>, total: seq<int>, pool: seq<int>, projectTotal: seq<int>, project: seq<int>)
  requires settlement__money_validAmount(computed)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(pool) && settlement__money_compareAmounts(total, pool) <= 0
  requires settlement__money_validAmount(projectTotal) && settlement__money_validAmount(project) && settlement__money_compareAmounts(projectTotal, project) <= 0
  ensures var r := smaller(computed, smaller(settlement__money_subtractAmounts(pool, total), settlement__money_subtractAmounts(project, projectTotal)));
    settlement__money_validAmount(r) && settlement__money_compareAmounts(settlement__money_addAmounts(total, r), pool) <= 0 &&
    settlement__money_compareAmounts(settlement__money_addAmounts(projectTotal, r), project) <= 0
{
  var poolRemaining := settlement__money_subtractAmounts(pool, total);
  var projectRemaining := settlement__money_subtractAmounts(project, projectTotal);
  settlement__money_lawSubtractionValid_ensures(pool, total);
  settlement__money_lawSubtractionValid_ensures(project, projectTotal);
  var remaining := smaller(poolRemaining, projectRemaining);
  SmallerOfValidAmounts(poolRemaining, projectRemaining);
  SmallerOfValidAmounts(computed, remaining);
  var amount := smaller(computed, remaining);
  settlement__money_lawNumericOrderTransitive_ensures(amount, remaining, poolRemaining);
  settlement__money_lawNumericOrderTransitive_ensures(amount, remaining, projectRemaining);
  AdditionWithinRemainingCapacity(total, pool, amount);
  AdditionWithinRemainingCapacity(projectTotal, project, amount);
}

lemma SomeRemainingCaps(a: Accrual, entry: AccrualRecord)
  requires alwaysCaps(a) && alwaysRatesValid(a) && alwaysUnitValid(a) && entry == nextAccrual(a)
  requires settlement__money_validAmount(entry.payout.gross)
  ensures settlement__money_validAmount(entry.amount)
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(totalAccrued(a), entry.amount), poolCap(a)) <= 0
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(projectAccrued(a, entry.payout.project), entry.amount), projectCap(a)) <= 0
{
  var project := entry.payout.project;
  ValidPoolAndProjectCaps(a);
  ValidTotalAccrued(a);
  ValidBoundedProjectTotal(a, project);
  ValidComputedAmount(a, entry);
  AccrualFitsBothCaps(entry.computed, totalAccrued(a), poolCap(a), projectAccrued(a, project), projectCap(a));
}

lemma SmallerOfValidAmounts(a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b)
  ensures settlement__money_validAmount(smaller(a, b))
  ensures settlement__money_compareAmounts(smaller(a, b), a) <= 0 && settlement__money_compareAmounts(smaller(a, b), b) <= 0
{
  settlement__money_lawEqualReflexive_ensures(a);
  settlement__money_lawEqualReflexive_ensures(b);
  settlement__money_lawNumericOrderTotal_ensures(a, b);
}

lemma AppendingAccrualWithinCaps(a: Accrual, after: Accrual, entry: AccrualRecord)
  requires alwaysCaps(a) && settlement__money_validAmount(entry.amount)
  requires settlement__money_compareAmounts(settlement__money_addAmounts(totalAccrued(a), entry.amount), poolCap(a)) <= 0
  requires settlement__money_compareAmounts(settlement__money_addAmounts(projectAccrued(a, entry.payout.project), entry.amount), projectCap(a)) <= 0
  requires allRecords(after) == allRecords(a) + [entry] && after.tokenUnit == a.tokenUnit
  ensures alwaysCaps(after)
{
  var totalStep := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, r.amount);
  var start := settlement__money_zero;
  ProofLib.FoldLeftAppend(totalStep, start, allRecords(a), entry);
  assert totalAccrued(after) == settlement__money_addAmounts(totalAccrued(a), entry.amount);
  forall r | r in allRecords(after) ensures settlement__money_validAmount(r.amount) &&
    settlement__money_compareAmounts(projectAccrued(after, r.payout.project), projectCap(after)) <= 0 {
    var project := r.payout.project;
    var projectStep := (sum: settlement__money_Amount, r: AccrualRecord) => settlement__money_addAmounts(sum, (if (r.payout.project == project) then r.amount else settlement__money_zero));
    ProofLib.FoldLeftAppend(projectStep, start, allRecords(a), entry);
    if entry.payout.project != project {
      assert r in allRecords(a);
      SumRecordLimbAmounts(allRecords(a), start, project);
      settlement__money_lawZeroIdentity_ensures(projectAccrued(a, project));
      settlement__money_lawEqualOrder_ensures(projectAccrued(after, project), projectAccrued(a, project), projectCap(a));
    }
  }
}

lemma capture_ensures(a: Accrual, project: int, applicant: int, steward: int, referrer: int, signedIn: bool, administrator: bool, moderator: bool)
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysConfigured(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysUnconfiguredEmpty(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysUnitValid(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysRatesValid(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysNextPeriod(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysCompleteFilings(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysUniqueAttribution(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysActiveSourceCount(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysCollectingHeader(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysFileTotals(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysStagedPrivate(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysPinsUnique(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysFileWalletPinned(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysPendingUnique(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysUniquePayouts(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> alwaysCaps(capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> stepPinsRetained(a, capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> stepRecordsRetained(a, capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> stepRatesRetained(a, capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> stepAttributionsRetained(a, capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
  ensures (inv(a) ==> canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) ==> stepFilingsRetained(a, capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator)))
{
  if inv(a) && canCapture(a, project, applicant, steward, referrer, signedIn, administrator, moderator) {
    var after := capture(a, project, applicant, steward, referrer, signedIn, administrator, moderator);
    var added := Attribution(project, applicant, steward, referrer);
    assert after.attributions == a.attributions + [added];
    AppendAttributionKeepsProjectKeys(a.attributions, added);
  }
}

lemma AppendAttributionKeepsProjectKeys(xs: seq<Attribution>, added: Attribution)
  requires forall row :: row in xs ==> |ProofLib.Filter((other: Attribution) => (other.project == row.project), xs)| == 1
  requires !(exists row :: row in xs && row.project == added.project)
  ensures forall row :: row in xs + [added] ==> |ProofLib.Filter((other: Attribution) => (other.project == row.project), xs + [added])| == 1
{
  forall row | row in xs + [added] ensures |ProofLib.Filter((other: Attribution) => (other.project == row.project), xs + [added])| == 1 {
    var sameProject := (other: Attribution) => (other.project == row.project);
    ProofLib.FilterAppend(sameProject, xs, added);
    if row == added {
      ProofLib.FilterNone(sameProject, xs);
    } else {
      assert row in xs && row.project != added.project;
    }
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var a := initialHolds();
  FoldTotalEmpty(a);
  assert a.tokenUnit == settlement__money_zero;
  var units := settlement__money_smallAmount(2000000);
  assert units == [0, 0, 2, 0, 0, 0];
  settlement__money_lawMultiplyZero_ensures(units);
  assert settlement__money_equalAmounts(poolCap(a), settlement__money_zero);
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(poolCap(a), settlement__money_zero, totalAccrued(a));
  assert alwaysCaps(a);
  assert alwaysConfigured(a) && alwaysUnconfiguredEmpty(a) && alwaysUnitValid(a) && alwaysRatesValid(a);
  assert alwaysNextPeriod(a) && alwaysCompleteFilings(a) && alwaysUniqueAttribution(a);
  assert alwaysActiveSourceCount(a) && alwaysCollectingHeader(a) && alwaysFileTotals(a) && alwaysStagedPrivate(a);
  assert alwaysPinsUnique(a) && alwaysFileWalletPinned(a) && alwaysPendingUnique(a) && alwaysUniquePayouts(a);
}

lemma PayoutSnapshotPreservesPending(a: Accrual, after: Accrual, payouts: seq<Payout>, period: int)
  requires validSource(a, payouts, period)
  requires allRecords(after) == allRecords(a) && after.pending == payouts
  ensures alwaysPendingUnique(after)
{
  forall p | p in after.pending ensures settlement__money_validAmount(p.gross) &&
    |ProofLib.Filter((other: Payout) => (other.id == p.id), after.pending)| == 1 &&
    !(exists r :: r in allRecords(after) && r.payout.id == p.id) {
    assert p in payouts;
  }
}

lemma startMonth_ensures(a: Accrual, period: int, payouts: seq<Payout>, sourceDigest: string, closed: bool, complete: bool, canonicalOrder: bool, leaseId: string, leaseCurrent: bool)
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysConfigured(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysUnconfiguredEmpty(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysUnitValid(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysRatesValid(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysNextPeriod(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysCompleteFilings(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysUniqueAttribution(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysActiveSourceCount(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysCollectingHeader(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysFileTotals(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysStagedPrivate(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysPinsUnique(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysFileWalletPinned(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysPendingUnique(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysUniquePayouts(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> alwaysCaps(startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> stepPinsRetained(a, startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> stepRecordsRetained(a, startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> stepRatesRetained(a, startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> stepAttributionsRetained(a, startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) ==> stepFilingsRetained(a, startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent)))
{
  if inv(a) && canStartMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent) {
    var after := startMonth(a, period, payouts, sourceDigest, closed, complete, canonicalOrder, leaseId, leaseCurrent);
    assert a.staged == [] && allRecords(a) == a.records;
    assert allRecords(after) == allRecords(a) && after.pending == payouts;
    assert alwaysCollectingHeader(after) && alwaysActiveSourceCount(after);
    PayoutSnapshotPreservesPending(a, after, payouts, period);
  }
}

lemma configure_ensures(a: Accrual, tokenUnit: seq<int>, verified: bool, by_: string)
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysConfigured(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysUnconfiguredEmpty(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysUnitValid(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysRatesValid(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysNextPeriod(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysCompleteFilings(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysUniqueAttribution(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysActiveSourceCount(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysCollectingHeader(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysFileTotals(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysStagedPrivate(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysPinsUnique(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysFileWalletPinned(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysPendingUnique(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysUniquePayouts(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> alwaysCaps(configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> stepPinsRetained(a, configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> stepRecordsRetained(a, configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> stepRatesRetained(a, configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> stepAttributionsRetained(a, configure(a, tokenUnit, verified, by_)))
  ensures (inv(a) ==> canConfigure(a, tokenUnit, verified, by_) ==> stepFilingsRetained(a, configure(a, tokenUnit, verified, by_)))
{
  if inv(a) && canConfigure(a, tokenUnit, verified, by_) {
    var after := configure(a, tokenUnit, verified, by_);
    settlement__money_lawEqualReflexive_ensures([1]);
    assert alwaysRatesValid(after);
    FoldTotalEmpty(after);
    ValidPoolAndProjectCaps(after);
    settlement__money_lawZeroOrder_ensures(poolCap(after));
    assert alwaysCaps(after);
  }
}

lemma fileMonth_ensures(a: Accrual, wallets: seq<Wallet>, leaseId: string, leaseCurrent: bool)
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysConfigured(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysUnconfiguredEmpty(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysUnitValid(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysRatesValid(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysNextPeriod(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysCompleteFilings(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysUniqueAttribution(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysActiveSourceCount(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysCollectingHeader(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysFileTotals(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysStagedPrivate(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysPinsUnique(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysFileWalletPinned(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysPendingUnique(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysUniquePayouts(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> alwaysCaps(fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> stepPinsRetained(a, fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> stepRecordsRetained(a, fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> stepRatesRetained(a, fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> stepAttributionsRetained(a, fileMonth(a, wallets, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canFileMonth(a, wallets, leaseId, leaseCurrent) ==> stepFilingsRetained(a, fileMonth(a, wallets, leaseId, leaseCurrent)))
{
  if inv(a) && canFileMonth(a, wallets, leaseId, leaseCurrent) {
    var after := fileMonth(a, wallets, leaseId, leaseCurrent);
    assert allRecords(after) == allRecords(a);
    assert alwaysUniquePayouts(after) && alwaysCaps(after);
    var entries := rootEntries(a, wallets);
    AccrualEntriesValid(a, wallets);
    var total := entriesTotal(entries);
    settlement__money_lawEqualReflexive_ensures(total);
    var kept := ProofLib.Filter((e: RootEntry) => (pinnedWallet(a.pins, e.actor) == ""), entries);
    var added := seq(|kept|, i requires 0 <= i < |kept| => Wallet(kept[i].actor, kept[i].wallet, true));
    var filed := Filing(a.activePeriod, a.sourceDigest, a.sourceCount, |a.staged|, entries, total);
    assert after.pins == a.pins + added;
    assert after.filings == a.filings + [filed];
    PreservePinsAtFiling(a, after, wallets, kept, added);
    FiledEntriesPinWitnesses(a, after, wallets, kept, added);
    PreserveFiledEntries(a, after, filed);
  }
}

lemma accrueNext_ensures(a: Accrual)
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysConfigured(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysUnconfiguredEmpty(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysUnitValid(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysRatesValid(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysNextPeriod(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysCompleteFilings(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysUniqueAttribution(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysActiveSourceCount(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysCollectingHeader(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysFileTotals(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysStagedPrivate(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysPinsUnique(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysFileWalletPinned(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysPendingUnique(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysUniquePayouts(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> alwaysCaps(accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> stepPinsRetained(a, accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> stepRecordsRetained(a, accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> stepRatesRetained(a, accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> stepAttributionsRetained(a, accrueNext(a)))
  ensures (inv(a) ==> canAccrueNext(a) ==> stepFilingsRetained(a, accrueNext(a)))
{
  if inv(a) && canAccrueNext(a) {
    var after := accrueNext(a);
    assert |after.pending| == |a.pending| - 1;
    assert |after.staged| == |a.staged| + 1;
    assert alwaysActiveSourceCount(after);
    var entry := nextAccrual(a);
    assert allRecords(after) == allRecords(a) + [entry];
    assert entry.payout == a.pending[0] && entry.payout in a.pending;
    SomeRemainingCaps(a, entry);
    AppendingAccrualWithinCaps(a, after, entry);
    TailAndNewRecordPreserveIdentity(a, after);
  }
}

lemma abandonMonth_ensures(a: Accrual, leaseId: string, leaseCurrent: bool)
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysConfigured(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysUnconfiguredEmpty(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysUnitValid(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysRatesValid(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysNextPeriod(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysCompleteFilings(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysUniqueAttribution(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysActiveSourceCount(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysCollectingHeader(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysFileTotals(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysStagedPrivate(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysPinsUnique(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysFileWalletPinned(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysPendingUnique(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysUniquePayouts(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> alwaysCaps(abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> stepPinsRetained(a, abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> stepRecordsRetained(a, abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> stepRatesRetained(a, abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> stepAttributionsRetained(a, abandonMonth(a, leaseId, leaseCurrent)))
  ensures (inv(a) ==> canAbandonMonth(a, leaseId, leaseCurrent) ==> stepFilingsRetained(a, abandonMonth(a, leaseId, leaseCurrent)))
{
  if inv(a) && canAbandonMonth(a, leaseId, leaseCurrent) {
    var after := abandonMonth(a, leaseId, leaseCurrent);
    AbandonRespectsCaps(a, after);
    forall r | r in allRecords(after) ensures
      |ProofLib.Filter((other: AccrualRecord) => (other.payout.id == r.payout.id), allRecords(after))| == 1 {
      assert r in allRecords(a);
      var matchId := (other: AccrualRecord) => (other.payout.id == r.payout.id);
      assert allRecords(after) == a.records && allRecords(a) == a.records + a.staged;
      AccrualPrefixCountOne(matchId, a.records, a.staged, r);
    }
  }
}

lemma AccrualPrefixCountOne(p: AccrualRecord -> bool, first: seq<AccrualRecord>, tail: seq<AccrualRecord>, known: AccrualRecord)
  requires known in first && p(known) && |ProofLib.Filter(p, first + tail)| == 1
  ensures |ProofLib.Filter(p, first)| == 1
  decreases |tail|
{
  if |tail| == 0 {
    assert tail == [] && first + tail == first;
    assert |ProofLib.Filter(p, first)| == 1;
  } else {
    var remaining := tail[..|tail| - 1];
    var last := tail[|tail| - 1];
    var prefix := first + remaining;
    assert tail == remaining + [last];
    assert first + tail == prefix + [last];
    ProofLib.FilterAppend(p, prefix, last);
    assert known in prefix;
    ProofLib.FilterMember(p, prefix, known);
    var kept := ProofLib.Filter(p, prefix);
    assert known in kept && |kept| > 0;
    assert |ProofLib.Filter(p, first + tail)| == |kept| + (if p(last) then 1 else 0);
    assert |kept| == 1;
    AccrualPrefixCountOne(p, first, remaining, known);
  }
}
