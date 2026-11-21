// Reading a transaction stores it and, while the run holds its start position, opens the interval from its cursor to its top.
lemma readTransaction_ensures(d: SolanaDeposits, slot: int, by_: string)
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> alwaysPositionCovered(readTransaction(d, slot, by_)))
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> alwaysIntervalRead(readTransaction(d, slot, by_)))
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> alwaysRecordedExactlyRead(readTransaction(d, slot, by_)))
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> alwaysRunsKeepTheirPlace(readTransaction(d, slot, by_)))
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> stepPositionNeverGoesBack(d, readTransaction(d, slot, by_)))
  ensures (inv(d) ==> canReadTransaction(d, slot, by_) ==> stepRecordPermanent(d, readTransaction(d, slot, by_)))
{
  if inv(d) && canReadTransaction(d, slot, by_) {
    var r := runOf(d, slot);
    var after := readTransaction(d, slot, by_);
    Facts(d);
    ReadStores(d, slot, by_);
    FilterMembers();
    assert forall x :: x in after.seen <==> x in d.seen || x == r.cursorAt;
    assert forall x :: x in after.recorded <==> x in d.recorded || (x in depositTransactions && x == r.cursorAt);
    Facts(after);
  }
}

// Finishing a short page of a run that holds its start position covers everything up to its top.
lemma finishRun_ensures(d: SolanaDeposits, slot: int, by_: string)
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> alwaysPositionCovered(finishRun(d, slot, by_)))
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> alwaysIntervalRead(finishRun(d, slot, by_)))
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> alwaysRecordedExactlyRead(finishRun(d, slot, by_)))
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> alwaysRunsKeepTheirPlace(finishRun(d, slot, by_)))
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> stepPositionNeverGoesBack(d, finishRun(d, slot, by_)))
  ensures (inv(d) ==> canFinishRun(d, slot, by_) ==> stepRecordPermanent(d, finishRun(d, slot, by_)))
{
  if inv(d) && canFinishRun(d, slot, by_) {
    Facts(d);
    Facts(finishRun(d, slot, by_));
  }
}

// A new run starts at the covered position, from the open interval or the newest transaction.
lemma startRun_ensures(d: SolanaDeposits, slot: int, by_: string)
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> alwaysPositionCovered(startRun(d, slot, by_)))
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> alwaysIntervalRead(startRun(d, slot, by_)))
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> alwaysRecordedExactlyRead(startRun(d, slot, by_)))
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> alwaysRunsKeepTheirPlace(startRun(d, slot, by_)))
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> stepPositionNeverGoesBack(d, startRun(d, slot, by_)))
  ensures (inv(d) ==> canStartRun(d, slot, by_) ==> stepRecordPermanent(d, startRun(d, slot, by_)))
{
  if inv(d) && canStartRun(d, slot, by_) {
    var c := captured(d);
    var after := startRun(d, slot, by_);
    Facts(d);
    Facts(after);
    assert after.seen == d.seen && after.position == d.position && after.newest == d.newest;
    assert runOf(after, slot) == c;
    assert alwaysIntervalRead(d) && alwaysPositionCovered(d);
    assert d.resume > 0 ==> d.pending > 0;
    assert d.pending > 0 ==> d.resume > d.position && d.resume <= d.pending && d.pending <= d.newest;
    assert pageFrom(d) >= d.position && pageFrom(d) <= d.newest;
    assert c.cursorAt == pageFrom(d) && c.startPosition == d.position;
    assert c.top == (if d.pending > 0 then d.pending else if pageFrom(d) > d.position then pageFrom(d) else 0);
    assert c.startPosition == d.position && c.cursorAt >= d.position && c.remaining >= 0;
    assert c.remaining <= c.cursorAt - d.position;
    assert c.shortPage ==> c.remaining == c.cursorAt - d.position;
    assert c.top <= d.newest && (c.top == 0 || c.top > d.position);
    assert c.remaining > 0 ==> c.cursorAt <= c.top;
    forall x | x in chainTransactions && x > c.cursorAt && x <= c.top
      ensures x in d.seen
    {
      assert d.pending > 0 && c.top == d.pending && c.cursorAt == d.resume - 1;
    }
  }
}

lemma arrive_ensures(d: SolanaDeposits, by_: string)
  ensures (inv(d) ==> canArrive(d, by_) ==> alwaysPositionCovered(arrive(d, by_)))
  ensures (inv(d) ==> canArrive(d, by_) ==> alwaysIntervalRead(arrive(d, by_)))
  ensures (inv(d) ==> canArrive(d, by_) ==> alwaysRecordedExactlyRead(arrive(d, by_)))
  ensures (inv(d) ==> canArrive(d, by_) ==> alwaysRunsKeepTheirPlace(arrive(d, by_)))
  ensures (inv(d) ==> canArrive(d, by_) ==> stepPositionNeverGoesBack(d, arrive(d, by_)))
  ensures (inv(d) ==> canArrive(d, by_) ==> stepRecordPermanent(d, arrive(d, by_)))
{
  if inv(d) && canArrive(d, by_) {
    Facts(d);
    Facts(arrive(d, by_));
  }
}

lemma failRun_ensures(d: SolanaDeposits, slot: int, by_: string)
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> alwaysPositionCovered(failRun(d, slot, by_)))
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> alwaysIntervalRead(failRun(d, slot, by_)))
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> alwaysRecordedExactlyRead(failRun(d, slot, by_)))
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> alwaysRunsKeepTheirPlace(failRun(d, slot, by_)))
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> stepPositionNeverGoesBack(d, failRun(d, slot, by_)))
  ensures (inv(d) ==> canFailRun(d, slot, by_) ==> stepRecordPermanent(d, failRun(d, slot, by_)))
{
  if inv(d) && canFailRun(d, slot, by_) {
    Facts(d);
    Facts(failRun(d, slot, by_));
  }
}

// Nothing is read, recorded or covered at the start.
lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  Facts(initialHolds());
}

// Membership in a filtered list, for every predicate and list.
lemma FilterMembers()
  ensures forall p: int -> bool, xs: seq<int>, x: int {:trigger x in ProofLib.Filter(p, xs)} :: x in ProofLib.Filter(p, xs) <==> x in xs && p(x)
{
  forall p: int -> bool, xs: seq<int>, x: int
    ensures x in ProofLib.Filter(p, xs) <==> x in xs && p(x)
  {
    ProofLib.FilterMember(p, xs, x);
  }
}

// Every rule of the record, stated over memberships.
lemma Facts(d: SolanaDeposits)
  ensures alwaysPositionCovered(d) <==> (d.position >= 0 && d.position <= d.newest
    && forall x :: x in chainTransactions && x <= d.position ==> x in d.seen)
  ensures alwaysIntervalRead(d) <==> ((d.pending > 0 ==> (d.resume > d.position && d.resume <= d.pending && d.pending <= d.newest
    && forall x :: x in chainTransactions && x >= d.resume && x <= d.pending ==> x in d.seen)) && (d.pending == 0 ==> d.resume == 0) && d.pending >= 0)
  ensures alwaysRecordedExactlyRead(d) <==> (forall x :: x in d.recorded <==> x in depositTransactions && x in d.seen)
  ensures runKeepsItsPlace(d, d.first) <==> (d.first.active ==> (d.first.startPosition <= d.position && (d.first.startPosition == d.position ==> (d.first.cursorAt >= d.position && d.first.remaining >= 0 && d.first.remaining <= d.first.cursorAt - d.position && (d.first.shortPage ==> d.first.remaining == d.first.cursorAt - d.position) && d.first.top <= d.newest && (d.first.top == 0 || d.first.top > d.position) && (d.first.remaining > 0 ==> d.first.cursorAt <= d.first.top) && forall x :: x in chainTransactions && x > d.first.cursorAt && x <= d.first.top ==> x in d.seen))))
  ensures runKeepsItsPlace(d, d.second) <==> (d.second.active ==> (d.second.startPosition <= d.position && (d.second.startPosition == d.position ==> (d.second.cursorAt >= d.position && d.second.remaining >= 0 && d.second.remaining <= d.second.cursorAt - d.position && (d.second.shortPage ==> d.second.remaining == d.second.cursorAt - d.position) && d.second.top <= d.newest && (d.second.top == 0 || d.second.top > d.position) && (d.second.remaining > 0 ==> d.second.cursorAt <= d.second.top) && forall x :: x in chainTransactions && x > d.second.cursorAt && x <= d.second.top ==> x in d.seen))))
  ensures alwaysRunsKeepTheirPlace(d) <==> ((d.first.active ==> (d.first.startPosition <= d.position && (d.first.startPosition == d.position ==> (d.first.cursorAt >= d.position && d.first.remaining >= 0 && d.first.remaining <= d.first.cursorAt - d.position && (d.first.shortPage ==> d.first.remaining == d.first.cursorAt - d.position) && d.first.top <= d.newest && (d.first.top == 0 || d.first.top > d.position) && (d.first.remaining > 0 ==> d.first.cursorAt <= d.first.top) && forall x :: x in chainTransactions && x > d.first.cursorAt && x <= d.first.top ==> x in d.seen)))) && (d.second.active ==> (d.second.startPosition <= d.position && (d.second.startPosition == d.position ==> (d.second.cursorAt >= d.position && d.second.remaining >= 0 && d.second.remaining <= d.second.cursorAt - d.position && (d.second.shortPage ==> d.second.remaining == d.second.cursorAt - d.position) && d.second.top <= d.newest && (d.second.top == 0 || d.second.top > d.position) && (d.second.remaining > 0 ==> d.second.cursorAt <= d.second.top) && forall x :: x in chainTransactions && x > d.second.cursorAt && x <= d.second.top ==> x in d.seen)))))
{
  FiltersOfRules(d, d.first);
  FiltersOfRules(d, d.second);
  FilterMembers();
}

// The rules' filters, through the library's filter view.
lemma FiltersOfRules(d: SolanaDeposits, r: SolanaRun)
  ensures alwaysPositionCovered(d) == (((d.position >= 0) && (d.position <= d.newest)) && !((exists set_x :: set_x in ProofLib.Filter((t: int) => (t <= d.position), chainTransactions) && !((set_x in d.seen)))))
  ensures alwaysIntervalRead(d) == (((!((d.pending > 0)) || ((((d.resume > d.position) && (d.resume <= d.pending)) && (d.pending <= d.newest)) && !((exists set_x :: set_x in ProofLib.Filter((t: int) => ((t >= d.resume) && (t <= d.pending)), chainTransactions) && !((set_x in d.seen)))))) && (!((d.pending == 0)) || (d.resume == 0))) && (d.pending >= 0))
  ensures alwaysRecordedExactlyRead(d) == (!((exists set_x :: set_x in d.recorded && !((set_x in ProofLib.Filter((set_x: int) => (set_x in d.seen), depositTransactions))))) && !((exists set_x' :: set_x' in ProofLib.Filter((set_x: int) => (set_x in d.seen), depositTransactions) && !((set_x' in d.recorded)))))
  ensures runKeepsItsPlace(d, r) == (!(r.active) || ((r.startPosition <= d.position) && (!((r.startPosition == d.position)) || ((((((((r.cursorAt >= d.position) && (r.remaining >= 0)) && (r.remaining <= (r.cursorAt - d.position))) && (!(r.shortPage) || (r.remaining == (r.cursorAt - d.position)))) && (r.top <= d.newest)) && ((r.top == 0) || (r.top > d.position))) && (!((r.remaining > 0)) || (r.cursorAt <= r.top))) && !((exists set_x :: set_x in ProofLib.Filter((t: int) => ((t > r.cursorAt) && (t <= r.top)), chainTransactions) && !((set_x in d.seen))))))))
{
}

// What reading a transaction stores, through the library's filter view.
lemma ReadStores(d: SolanaDeposits, slot: int, by_: string)
  ensures var local_1 := runOf(d, slot); readTransaction(d, slot, by_).seen == d.seen + ProofLib.Filter((set_x: int) => !((set_x in d.seen)), [local_1.cursorAt])
  ensures var local_1 := runOf(d, slot); readTransaction(d, slot, by_).recorded == d.recorded + ProofLib.Filter((set_x: int) => !((set_x in d.recorded)), ProofLib.Filter((t: int) => (t == local_1.cursorAt), depositTransactions))
{
}
