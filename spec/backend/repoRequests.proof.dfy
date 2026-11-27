// spec/backend/repoRequests.md, "A flag counts for 90 days, renews in place and is withdrawn without being deleted"; spec/backend/repoRequests.md, "The public board counts active flags per repository, never names who flagged, and leaves out a repository on Slop"

lemma withdraw_ensures(s: RepoRequests, repoId: string, by_: string)
  ensures (inv(s) ==> canWithdraw(s, repoId, by_) ==> alwaysOneRowPerRepoAndAccount(withdraw(s, repoId, by_)))
  ensures (inv(s) ==> canWithdraw(s, repoId, by_) ==> alwaysExpiryWithinLife(withdraw(s, repoId, by_)))
  ensures (inv(s) ==> canWithdraw(s, repoId, by_) ==> alwaysWithinFlagLimit(withdraw(s, repoId, by_)))
  ensures (inv(s) ==> canWithdraw(s, repoId, by_) ==> alwaysBoardCountsEveryActiveFlag(withdraw(s, repoId, by_)))
  ensures (inv(s) ==> canWithdraw(s, repoId, by_) ==> stepRowsAreNeverDeleted(s, withdraw(s, repoId, by_)))
{
  if inv(s) && canWithdraw(s, repoId, by_) {
    WithdrawOneRow(s, repoId, by_);
    WithdrawExpiryWithinLife(s, repoId, by_);
    WithdrawWithinLimit(s, repoId, by_);
    BoardCountsEveryActiveFlag(withdraw(s, repoId, by_));
    WithdrawRetainsRows(s, repoId, by_);
  }
}

lemma observeClock_ensures(s: RepoRequests, now: int)
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysOneRowPerRepoAndAccount(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysExpiryWithinLife(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysWithinFlagLimit(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysBoardCountsEveryActiveFlag(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepRowsAreNeverDeleted(s, observeClock(s, now)))
{
  if inv(s) && canObserveClock(s, now) {
    ObserveClockWithinLimit(s, now);
    BoardCountsEveryActiveFlag(observeClock(s, now));
  }
}

lemma flag_ensures(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  ensures (inv(s) ==> canFlag(s, repoId, fullName, facts, by_) ==> alwaysOneRowPerRepoAndAccount(flag(s, repoId, fullName, facts, by_)))
  ensures (inv(s) ==> canFlag(s, repoId, fullName, facts, by_) ==> alwaysExpiryWithinLife(flag(s, repoId, fullName, facts, by_)))
  ensures (inv(s) ==> canFlag(s, repoId, fullName, facts, by_) ==> alwaysWithinFlagLimit(flag(s, repoId, fullName, facts, by_)))
  ensures (inv(s) ==> canFlag(s, repoId, fullName, facts, by_) ==> alwaysBoardCountsEveryActiveFlag(flag(s, repoId, fullName, facts, by_)))
  ensures (inv(s) ==> canFlag(s, repoId, fullName, facts, by_) ==> stepRowsAreNeverDeleted(s, flag(s, repoId, fullName, facts, by_)))
{
  if inv(s) && canFlag(s, repoId, fullName, facts, by_) {
    if hasRow(s, repoId, by_) {
      FlagRenewOneRow(s, repoId, fullName, facts, by_);
      FlagRenewExpiryWithinLife(s, repoId, fullName, facts, by_);
      FlagRenewWithinLimit(s, repoId, fullName, facts, by_);
      FlagRenewRetainsRows(s, repoId, fullName, facts, by_);
    } else {
      FlagAppendPreserves(s, repoId, fullName, facts, by_);
    }
    BoardCountsEveryActiveFlag(flag(s, repoId, fullName, facts, by_));
  }
}

lemma WithdrawExpiryWithinLife(s: RepoRequests, repoId: string, by_: string)
  requires alwaysExpiryWithinLife(s)
  ensures alwaysExpiryWithinLife(withdraw(s, repoId, by_))
{
  var after := withdraw(s, repoId, by_);
  forall f | f in after.flags
    ensures f.expiresAt > f.flaggedAt && f.expiresAt <= after.now + flagLife && f.expiresAt == f.flaggedAt + flagLife && f.createdAt <= f.flaggedAt && f.flaggedAt <= after.now
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
  }
}

lemma WithdrawRetainsRows(s: RepoRequests, repoId: string, by_: string)
  ensures stepRowsAreNeverDeleted(s, withdraw(s, repoId, by_))
{
  var after := withdraw(s, repoId, by_);
  forall f | f in s.flags
    ensures exists g :: g in after.flags && g.repoId == f.repoId && g.account == f.account && g.createdAt == f.createdAt
  {
    var i :| 0 <= i < |s.flags| && s.flags[i] == f;
    assert after.flags[i] in after.flags;
  }
}

lemma WithdrawOneRow(s: RepoRequests, repoId: string, by_: string)
  requires alwaysOneRowPerRepoAndAccount(s)
  ensures alwaysOneRowPerRepoAndAccount(withdraw(s, repoId, by_))
{
  var after := withdraw(s, repoId, by_);
  OneRowFilter(s);
  OneRowFilter(after);
  forall f | f in after.flags
    ensures f.repoId != "" && f.account != "" && f.fullName != ""
    ensures |ProofLib.Filter((g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account)), after.flags)| == 1
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
    var pk := (g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account));
    ProofLib.FilterLengthPointwise(pk, pk, s.flags, after.flags);
  }
}

lemma WithdrawWithinLimit(s: RepoRequests, repoId: string, by_: string)
  requires alwaysWithinFlagLimit(s)
  ensures alwaysWithinFlagLimit(withdraw(s, repoId, by_))
{
  var after := withdraw(s, repoId, by_);
  forall f | f in after.flags
    ensures held(after, f.account) <= flagLimit
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
    HeldFilter(s, f.account);
    HeldFilter(after, f.account);
    FilterLengthPointwiseLe(
      (g: RepoFlag) => ((g.account == f.account) && live(g, after.now)),
      (g: RepoFlag) => ((g.account == f.account) && live(g, s.now)),
      after.flags,
      s.flags
    );
  }
}

lemma ObserveClockWithinLimit(s: RepoRequests, now: int)
  requires alwaysWithinFlagLimit(s) && canObserveClock(s, now)
  ensures alwaysWithinFlagLimit(observeClock(s, now))
{
  var after := observeClock(s, now);
  forall f | f in after.flags
    ensures held(after, f.account) <= flagLimit
  {
    HeldFilter(s, f.account);
    HeldFilter(after, f.account);
    ProofLib.FilterImpLength(
      (g: RepoFlag) => ((g.account == f.account) && live(g, after.now)),
      (g: RepoFlag) => ((g.account == f.account) && live(g, s.now)),
      s.flags
    );
  }
}

lemma FlagRenewRetainsRows(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  requires alwaysOneRowPerRepoAndAccount(s) && hasRow(s, repoId, by_)
  ensures stepRowsAreNeverDeleted(s, flag(s, repoId, fullName, facts, by_))
{
  var after := flag(s, repoId, fullName, facts, by_);
  var k :| 0 <= k < |s.flags| && s.flags[k].repoId == repoId && s.flags[k].account == by_;
  FlagOfUnique(s, repoId, by_, k);
  OneRowFilter(s);
  assert s.flags[k] in s.flags;
  ProofLib.FilterCountOneIffUnique((g: RepoFlag) => ((g.repoId == repoId) && (g.account == by_)), s.flags, (g: RepoFlag) => (g.repoId, g.account), k);
  forall f | f in s.flags
    ensures exists g :: g in after.flags && g.repoId == f.repoId && g.account == f.account && g.createdAt == f.createdAt
  {
    var i :| 0 <= i < |s.flags| && s.flags[i] == f;
    assert after.flags[i] in after.flags;
  }
}

lemma FlagRenewExpiryWithinLife(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  requires alwaysOneRowPerRepoAndAccount(s) && alwaysExpiryWithinLife(s) && hasRow(s, repoId, by_)
  ensures alwaysExpiryWithinLife(flag(s, repoId, fullName, facts, by_))
{
  var after := flag(s, repoId, fullName, facts, by_);
  var k :| 0 <= k < |s.flags| && s.flags[k].repoId == repoId && s.flags[k].account == by_;
  FlagOfUnique(s, repoId, by_, k);
  assert s.flags[k] in s.flags;
  forall f | f in after.flags
    ensures f.expiresAt > f.flaggedAt && f.expiresAt <= after.now + flagLife && f.expiresAt == f.flaggedAt + flagLife && f.createdAt <= f.flaggedAt && f.flaggedAt <= after.now
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
  }
}

lemma FlagRenewOneRow(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  requires alwaysOneRowPerRepoAndAccount(s) && canFlag(s, repoId, fullName, facts, by_) && hasRow(s, repoId, by_)
  ensures alwaysOneRowPerRepoAndAccount(flag(s, repoId, fullName, facts, by_))
{
  var after := flag(s, repoId, fullName, facts, by_);
  var k :| 0 <= k < |s.flags| && s.flags[k].repoId == repoId && s.flags[k].account == by_;
  FlagOfUnique(s, repoId, by_, k);
  OneRowFilter(s);
  OneRowFilter(after);
  forall f | f in after.flags
    ensures f.repoId != "" && f.account != "" && f.fullName != ""
    ensures |ProofLib.Filter((g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account)), after.flags)| == 1
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
    var pk := (g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account));
    ProofLib.FilterLengthPointwise(pk, pk, s.flags, after.flags);
  }
}

lemma FlagRenewWithinLimit(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  requires alwaysOneRowPerRepoAndAccount(s) && alwaysWithinFlagLimit(s) && canFlag(s, repoId, fullName, facts, by_) && hasRow(s, repoId, by_)
  ensures alwaysWithinFlagLimit(flag(s, repoId, fullName, facts, by_))
{
  var after := flag(s, repoId, fullName, facts, by_);
  var k :| 0 <= k < |s.flags| && s.flags[k].repoId == repoId && s.flags[k].account == by_;
  FlagOfUnique(s, repoId, by_, k);
  OneRowFilter(s);
  assert s.flags[k] in s.flags;
  ProofLib.FilterCountOneIffUnique((g: RepoFlag) => ((g.repoId == repoId) && (g.account == by_)), s.flags, (g: RepoFlag) => (g.repoId, g.account), k);
  assert forall j :: 0 <= j < |s.flags| && j != k ==> after.flags[j] == s.flags[j];
  forall f | f in after.flags
    ensures held(after, f.account) <= flagLimit
  {
    var i :| 0 <= i < |after.flags| && after.flags[i] == f;
    assert s.flags[i] in s.flags;
    HeldFilter(s, f.account);
    HeldFilter(after, f.account);
    var ph := (g: RepoFlag) => ((g.account == f.account) && live(g, s.now));
    if f.account != by_ {
      ProofLib.FilterLengthPointwise(ph, ph, s.flags, after.flags);
    } else if active(s, repoId, by_) {
      var liveRow :| liveRow in s.flags && liveRow.repoId == repoId && liveRow.account == by_ && live(liveRow, s.now);
      var m :| 0 <= m < |s.flags| && s.flags[m] == liveRow;
      assert m == k;
      ProofLib.FilterLengthPointwise(ph, ph, s.flags, after.flags);
    } else {
      assert held(s, by_) < flagLimit;
      FilterLengthReplaceOne(ph, s.flags, after.flags, k);
    }
  }
}

lemma FlagAppendPreserves(s: RepoRequests, repoId: string, fullName: string, facts: FlagFacts, by_: string)
  requires inv(s) && canFlag(s, repoId, fullName, facts, by_) && !hasRow(s, repoId, by_)
  ensures alwaysOneRowPerRepoAndAccount(flag(s, repoId, fullName, facts, by_))
  ensures alwaysExpiryWithinLife(flag(s, repoId, fullName, facts, by_))
  ensures alwaysWithinFlagLimit(flag(s, repoId, fullName, facts, by_))
  ensures stepRowsAreNeverDeleted(s, flag(s, repoId, fullName, facts, by_))
{
  var after := flag(s, repoId, fullName, facts, by_);
  var added := RepoFlag(repoId, by_, fullName, s.now, s.now, (s.now + flagLife), false);
  assert after.flags == s.flags + [added];
  OneRowFilter(s);
  OneRowFilter(after);
  forall f | f in after.flags
    ensures f.repoId != "" && f.account != "" && f.fullName != ""
    ensures |ProofLib.Filter((g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account)), after.flags)| == 1
  {
    var pk := (g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account));
    ProofLib.FilterAppend(pk, s.flags, added);
    if f == added {
      ProofLib.FilterNone(pk, s.flags);
    } else {
      assert f in s.flags;
      assert !(f.repoId == repoId && f.account == by_);
    }
  }
  forall f | f in after.flags
    ensures held(after, f.account) <= flagLimit
  {
    HeldFilter(s, f.account);
    HeldFilter(after, f.account);
    var ph := (g: RepoFlag) => ((g.account == f.account) && live(g, s.now));
    ProofLib.FilterAppend(ph, s.flags, added);
    if f.account == by_ {
      assert !active(s, repoId, by_);
      assert held(s, by_) < flagLimit;
    } else {
      assert f in s.flags;
    }
  }
}

lemma OneRowFilter(s: RepoRequests)
  ensures alwaysOneRowPerRepoAndAccount(s) == !((exists f :: f in s.flags && !(((((f.repoId != "") && (f.account != "")) && (f.fullName != "")) && (|ProofLib.Filter((g: RepoFlag) => ((g.repoId == f.repoId) && (g.account == f.account)), s.flags)| == 1)))))
{
}

lemma HeldFilter(s: RepoRequests, account: string)
  ensures held(s, account) == |ProofLib.Filter((f: RepoFlag) => ((f.account == account) && live(f, s.now)), s.flags)|
{
}

lemma BoardCountFilter(s: RepoRequests, repoId: string)
  ensures boardCount(s, repoId) == |ProofLib.Filter((f: RepoFlag) => ((f.repoId == repoId) && live(f, s.now)), s.flags)|
{
}

lemma FlagOfFilter(s: RepoRequests, repoId: string, account: string)
  ensures flagOf(s, repoId, account) == (if 0 < |ProofLib.Filter((f: RepoFlag) => ((f.repoId == repoId) && (f.account == account)), s.flags)| then ProofLib.Filter((f: RepoFlag) => ((f.repoId == repoId) && (f.account == account)), s.flags)[0] else noFlag)
{
}

lemma FlagOfUnique(s: RepoRequests, repoId: string, account: string, k: int)
  requires alwaysOneRowPerRepoAndAccount(s)
  requires 0 <= k < |s.flags| && s.flags[k].repoId == repoId && s.flags[k].account == account
  ensures flagOf(s, repoId, account) == s.flags[k]
{
  OneRowFilter(s);
  FlagOfFilter(s, repoId, account);
  var p := (f: RepoFlag) => ((f.repoId == repoId) && (f.account == account));
  assert s.flags[k] in s.flags;
  ProofLib.FilterMember(p, s.flags, s.flags[k]);
  var matched := ProofLib.Filter(p, s.flags);
  assert |matched| == 1;
  assert s.flags[k] in matched;
}

lemma BoardCountsEveryActiveFlag(s: RepoRequests)
  ensures alwaysBoardCountsEveryActiveFlag(s)
{
  forall f | f in s.flags && live(f, s.now)
    ensures boardCount(s, f.repoId) >= 1
    ensures newestFlaggedAt(s, f.repoId) >= f.flaggedAt
  {
    BoardCountFilter(s, f.repoId);
    ProofLib.FilterMember((g: RepoFlag) => ((g.repoId == f.repoId) && live(g, s.now)), s.flags, f);
    FoldMaxFlaggedAt(
      (newest: int, g: RepoFlag) => (if (((g.repoId == f.repoId) && live(g, s.now)) && (g.flaggedAt > newest)) then g.flaggedAt else newest),
      0,
      s.flags,
      f.repoId,
      s.now,
      f
    );
  }
}

lemma FoldMaxFlaggedAt(stepFn: (int, RepoFlag) -> int, init: int, xs: seq<RepoFlag>, repoId: string, now: int, target: RepoFlag)
  requires forall a, g :: stepFn(a, g) == (if (((g.repoId == repoId) && live(g, now)) && (g.flaggedAt > a)) then g.flaggedAt else a)
  requires target in xs && target.repoId == repoId && live(target, now)
  ensures Std.Collections.Seq.FoldLeft(stepFn, init, xs) >= target.flaggedAt
  decreases |xs|
{
  if xs[0] == target {
    ProofLib.FoldLeftInflationary(stepFn, stepFn(init, xs[0]), xs[1..]);
  } else {
    assert target in xs[1..];
    FoldMaxFlaggedAt(stepFn, stepFn(init, xs[0]), xs[1..], repoId, now, target);
  }
}

lemma FilterLengthPointwiseLe(p: RepoFlag -> bool, q: RepoFlag -> bool, xs: seq<RepoFlag>, ys: seq<RepoFlag>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> (p(xs[i]) ==> q(ys[i]))
  ensures |ProofLib.Filter(p, xs)| <= |ProofLib.Filter(q, ys)|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterNil(q, ys);
  } else {
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(q, ys);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    FilterLengthPointwiseLe(p, q, xs[1..], ys[1..]);
  }
}

lemma FilterLengthReplaceOne(p: RepoFlag -> bool, xs: seq<RepoFlag>, ys: seq<RepoFlag>, k: int)
  requires |xs| == |ys| && 0 <= k < |xs|
  requires forall j :: 0 <= j < |xs| && j != k ==> xs[j] == ys[j]
  ensures |ProofLib.Filter(p, ys)| <= |ProofLib.Filter(p, xs)| + 1
  decreases |xs|
{
  ProofLib.FilterCons(p, xs);
  ProofLib.FilterCons(p, ys);
  assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
  if k == 0 {
    assert xs[1..] == ys[1..];
  } else {
    FilterLengthReplaceOne(p, xs[1..], ys[1..], k - 1);
  }
}
