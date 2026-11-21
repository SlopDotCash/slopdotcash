lemma MonthlyCommitmentDivision(a: int, b: int)
  requires a >= 0 && b > 0
  ensures quotient_settlement__monthlyCommitment(a, b) == a / b
  ensures remainder_settlement__monthlyCommitment(a, b) == a % b
{
}

lemma MonthStartPositive(period: int)
  requires period >= 202612
  ensures monthStart(period) > 0
{
  MonthlyCommitmentDivision(period, 100);
  var month := period % 100;
  var year := period / 100 - (if month <= 2 then 1 else 0);
  assert year >= 2025;
  MonthlyCommitmentDivision(year, 400);
  var era := year / 400;
  assert era >= 5;
  var yearOfEra := year - era * 400;
  assert 0 <= yearOfEra < 400;
  MonthlyCommitmentDivision(yearOfEra, 4);
  MonthlyCommitmentDivision(yearOfEra, 100);
  assert yearOfEra / 4 >= yearOfEra / 100;
  var shifted := if month > 2 then month - 3 else month + 9;
  assert shifted >= 0;
  MonthlyCommitmentDivision(153 * shifted + 2, 5);
  assert (153 * shifted + 2) / 5 >= 0;
  assert era * 146097 >= 730485;
}

lemma WindowOpensPositive(period: int)
  requires period >= 202611
  ensures windowOpensAt(period) > 0
{
  MonthlyCommitmentDivision(period, 100);
  assert nextPeriod(period) > period;
  MonthStartPositive(nextPeriod(period));
}

lemma MonthStartSplit(period: int) returns (year: int, march: int)
  requires period >= 202611 && 1 <= period % 100 <= 12
  ensures year == (period / 100 - (if period % 100 <= 2 then 1 else 0)) && year >= 2025
  ensures march == (if period % 100 > 2 then period % 100 - 3 else period % 100 + 9) && 0 <= march <= 11
  ensures monthStart(period) == (((year) / 400 * 146097 + ((year) - (year) / 400 * 400) * 365 + ((year) - (year) / 400 * 400) / 4 - ((year) - (year) / 400 * 400) / 100) + (153 * march + 2) / 5 - 719468) * 86400
{
  MonthlyCommitmentDivision(period, 100);
  year := (period / 100 - (if period % 100 <= 2 then 1 else 0));
  march := (if period % 100 > 2 then period % 100 - 3 else period % 100 + 9);
  MonthlyCommitmentDivision(year, 400);
  var yearOfEra := year - (year / 400) * 400;
  assert 0 <= yearOfEra < 400;
  MonthlyCommitmentDivision(yearOfEra, 4);
  MonthlyCommitmentDivision(yearOfEra, 100);
  MonthlyCommitmentDivision(153 * march + 2, 5);
}

lemma YearDaysStep(year: int)
  requires year >= 0
  ensures ((year + 1) / 400 * 146097 + ((year + 1) - (year + 1) / 400 * 400) * 365 + ((year + 1) - (year + 1) / 400 * 400) / 4 - ((year + 1) - (year + 1) / 400 * 400) / 100) >= ((year) / 400 * 146097 + ((year) - (year) / 400 * 400) * 365 + ((year) - (year) / 400 * 400) / 4 - ((year) - (year) / 400 * 400) / 100) + 364
{
  var era := year / 400;
  var yearOfEra := year - era * 400;
  assert 0 <= yearOfEra < 400;
  if yearOfEra < 399 {
    assert (year + 1) / 400 == era;
    assert (yearOfEra + 1) / 4 >= yearOfEra / 4;
    assert (yearOfEra + 1) / 100 <= yearOfEra / 100 + 1;
  } else {
    assert (year + 1) / 400 == era + 1;
    assert ((year) / 400 * 146097 + ((year) - (year) / 400 * 400) * 365 + ((year) - (year) / 400 * 400) / 4 - ((year) - (year) / 400 * 400) / 100) == era * 146097 + 399 * 365 + 99 - 3;
  }
}

lemma NextPeriodValid(period: int)
  requires period >= 202611 && 1 <= period % 100 <= 12
  ensures nextPeriod(period) >= 202611 && 1 <= nextPeriod(period) % 100 <= 12
  ensures nextPeriod(period) / 100 == period / 100 + (if period % 100 == 12 then 1 else 0)
  ensures nextPeriod(period) % 100 == (if period % 100 == 12 then 1 else period % 100 + 1)
{
  MonthlyCommitmentDivision(period, 100);
  var next := nextPeriod(period);
  if period % 100 == 12 {
    assert next == (period / 100 + 1) * 100 + 1;
  } else {
    assert next == period + 1;
  }
}

lemma MonthStartIncreases(period: int)
  requires period >= 202611 && 1 <= period % 100 <= 12
  ensures monthStart(period) < monthStart(nextPeriod(period))
{
  NextPeriodValid(period);
  var year, march := MonthStartSplit(period);
  var nextYear, nextMarch := MonthStartSplit(nextPeriod(period));
  if march < 11 {
    assert nextYear == year && nextMarch == march + 1;
    assert (153 * (march + 1) + 2) / 5 > (153 * march + 2) / 5;
  } else {
    assert nextYear == year + 1 && nextMarch == 0;
    YearDaysStep(year);
    assert (153 * 11 + 2) / 5 == 337;
  }
}

lemma WindowOrdered(period: int)
  requires period >= 202611 && 1 <= period % 100 <= 12
  ensures windowOpensAt(period) < windowClosesAt(period)
{
  NextPeriodValid(period);
  MonthStartIncreases(nextPeriod(period));
}

lemma AttemptSequenceFold(xs: seq<Attempt>)
  ensures Std.Collections.Seq.FoldLeft((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs) == -2
    || (|xs| == 0 && Std.Collections.Seq.FoldLeft((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs) == -1)
    || (|xs| > 0 && Std.Collections.Seq.FoldLeft((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs) == xs[|xs| - 1].sourceSequence
      && xs[|xs| - 1].sourceSequence >= 0)
  decreases |xs|
{
  if |xs| > 0 {
    var front := xs[..|xs| - 1];
    assert xs == front + [xs[|xs| - 1]];
    ProofLib.FoldLeftAppend((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, front, xs[|xs| - 1]);
    AttemptSequenceFold(front);
  }
}

lemma AttemptSequenceAppend(xs: seq<Attempt>, last: Attempt)
  requires Std.Collections.Seq.FoldLeft((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs) != -2
  requires last.sourceSequence >= 0
  requires forall a :: a in xs ==> a.sourceSequence < last.sourceSequence
  ensures Std.Collections.Seq.FoldLeft((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs + [last]) != -2
{
  AttemptSequenceFold(xs);
  ProofLib.FoldLeftAppend((highest: int, a: Attempt) => (if ((highest >= -1) && (a.sourceSequence > highest)) then a.sourceSequence else -2), -1, xs, last);
  if |xs| > 0 {
    assert xs[|xs| - 1] in xs;
  }
}

lemma LeafSumValid(leaves: seq<Leaf>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall l :: l in leaves ==> settlement__money_validAmount(l.gross)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), start, leaves))
  decreases |leaves|
{
  if |leaves| > 0 {
    settlement__money_lawAdditionValid_ensures(start, leaves[0].gross);
    LeafSumValid(leaves[1..], settlement__money_addAmounts(start, leaves[0].gross));
  }
}

lemma FilteredLeafSumAtMost(p: Leaf -> bool, leaves: seq<Leaf>, kept: seq<int>, all: seq<int>)
  requires settlement__money_validAmount(kept) && settlement__money_validAmount(all)
  requires settlement__money_compareAmounts(kept, all) <= 0
  requires forall l :: l in leaves ==> settlement__money_validAmount(l.gross)
  ensures settlement__money_compareAmounts(
    Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), kept, ProofLib.Filter(p, leaves)),
    Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), all, leaves)) <= 0
  decreases |leaves|
{
  if |leaves| == 0 {
    ProofLib.FilterNil(p, leaves);
  } else {
    var x := leaves[0];
    assert x in leaves;
    assert forall l :: l in leaves[1..] ==> l in leaves;
    ProofLib.FilterCons(p, leaves);
    var rest := ProofLib.Filter(p, leaves[1..]);
    var bigger := settlement__money_addAmounts(all, x.gross);
    settlement__money_lawAdditionValid_ensures(all, x.gross);
    assert Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), all, leaves)
      == Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), bigger, leaves[1..]);
    if p(x) {
      var more := settlement__money_addAmounts(kept, x.gross);
      settlement__money_lawAdditionValid_ensures(kept, x.gross);
      settlement__money_lawAddOrder_ensures(kept, all, x.gross);
      assert ProofLib.Filter(p, leaves) == [x] + rest;
      assert ([x] + rest)[0] == x;
      assert ([x] + rest)[1..] == rest;
      assert Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), kept, [x] + rest)
        == Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, l: Leaf) => settlement__money_addAmounts(sum, l.gross), more, rest);
      FilteredLeafSumAtMost(p, leaves[1..], more, bigger);
    } else {
      assert ProofLib.Filter(p, leaves) == rest;
      settlement__money_lawAddMonotone_ensures(all, x.gross);
      settlement__money_lawNumericOrderTotal_ensures(bigger, all);
      settlement__money_lawNumericOrderTransitive_ensures(kept, all, bigger);
      FilteredLeafSumAtMost(p, leaves[1..], kept, bigger);
    }
  }
}

lemma FilterNoLonger<T>(p: T -> bool, xs: seq<T>)
  ensures |ProofLib.Filter(p, xs)| <= |xs|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
  } else {
    ProofLib.FilterCons(p, xs);
    FilterNoLonger(p, xs[1..]);
  }
}

lemma RemainingWithinWhole(c: Commitment)
  requires alwaysAuthorizedMonthKept(c) && !c.phase.NoIntent?
  ensures settlement__money_validAmount(leafTotal(remainingLeaves(c)))
  ensures settlement__money_compareAmounts(leafTotal(remainingLeaves(c)), c.month.wholeGross) <= 0
  ensures |remainingLeaves(c)| <= |c.month.leaves|
{
  var p := (l: Leaf) => !((l.source in c.view.consumed));
  var leaves := remainingLeaves(c);
  assert leaves == ProofLib.Filter(p, c.month.leaves);
  assert forall l :: l in c.month.leaves ==> settlement__money_validAmount(l.gross);
  forall l | l in leaves
    ensures settlement__money_validAmount(l.gross)
  {
    ProofLib.FilterMember(p, c.month.leaves, l);
  }
  LeafSumValid(leaves, settlement__money_zero);
  LeafSumValid(c.month.leaves, settlement__money_zero);
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  FilteredLeafSumAtMost(p, c.month.leaves, settlement__money_zero, settlement__money_zero);
  settlement__money_lawNumericOrderTransitive_ensures(leafTotal(leaves), leafTotal(c.month.leaves), c.month.wholeGross);
  FilterNoLonger(p, c.month.leaves);
}

lemma AppendKeepsIdsUnique(xs: seq<Attempt>, added: Attempt)
  requires forall a :: a in xs ==> |ProofLib.Filter((o: Attempt) => (o.id == a.id), xs)| == 1
  requires forall a :: a in xs ==> a.id != added.id
  ensures forall a :: a in xs + [added] ==> |ProofLib.Filter((o: Attempt) => (o.id == a.id), xs + [added])| == 1
{
  forall a | a in xs + [added]
    ensures |ProofLib.Filter((o: Attempt) => (o.id == a.id), xs + [added])| == 1
  {
    ProofLib.FilterAppend((o: Attempt) => (o.id == a.id), xs, added);
    if a in xs {
      assert a.id != added.id;
    } else {
      assert a == added;
      assert forall i :: 0 <= i < |xs| ==> xs[i] in xs && xs[i].id != a.id;
      ProofLib.FilterNone((o: Attempt) => (o.id == a.id), xs);
    }
  }
}

lemma SignEvmBounded(c: Commitment, attemptId: int, root: string, by_: string)
  requires inv(c) && canSignEvm(c, attemptId, root, by_)
  ensures alwaysAttemptsBounded(signEvm(c, attemptId, root, by_))
  ensures alwaysAttemptSequencesIncrease(signEvm(c, attemptId, root, by_))
{
  var leaves := remainingLeaves(c);
  var added := Attempt(attemptId, c.view.height, c.view.sourceSequence, root, leafTotal(leaves), |leaves|, 0, by_, c.clock);
  var signed := signEvm(c, attemptId, root, by_);
  assert signed.attempts == c.attempts + [added];
  assert signed.month == c.month;
  AttemptSequenceAppend(c.attempts, added);
  RemainingWithinWhole(c);
  assert alwaysAttemptsBounded(c);
  forall a | a in c.attempts
    ensures |ProofLib.Filter((o: Attempt) => (o.id == a.id), c.attempts)| == 1
    ensures a.id != added.id
  {
  }
  AppendKeepsIdsUnique(c.attempts, added);
}

lemma authorize_ensures(c: Commitment, family: ChainFamily, month: FundedMonth)
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAuthorizedMonthKept(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysViewNamesAuthority(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysFrozenOnlyWhenSigned(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysLegacyOnlyWhenAdmitted(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAttemptsBounded(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAuthorizedWithinCap(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAdmittedRootSigned(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAttemptSequencesIncrease(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAttemptsSignedInWindow(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysSolanaSingleAttempt(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysNoIntentEmpty(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysAdmittedIsLatestAttempt(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysInvestigationHasUnknownRoot(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> alwaysWindowFromPeriod(authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepFirstAuthorizationImmutable(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepNoSignatureAfterAdmission(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepFrozenAtFixed(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepAdmissionPermanent(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepViewSequenceMonotone(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepLegacyRetainedOnce(c, authorize(c, family, month)))
  ensures (inv(c) ==> canAuthorize(c, family, month) ==> stepAttemptsAppendOnly(c, authorize(c, family, month)))
{
  if inv(c) && canAuthorize(c, family, month) {
    WindowOrdered(month.period);
  }
}

lemma signEvm_ensures(c: Commitment, attemptId: int, root: string, by_: string)
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAuthorizedMonthKept(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysViewNamesAuthority(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysFrozenOnlyWhenSigned(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysLegacyOnlyWhenAdmitted(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAttemptsBounded(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAuthorizedWithinCap(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAdmittedRootSigned(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAttemptSequencesIncrease(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAttemptsSignedInWindow(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysSolanaSingleAttempt(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysNoIntentEmpty(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysAdmittedIsLatestAttempt(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysInvestigationHasUnknownRoot(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> alwaysWindowFromPeriod(signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepFirstAuthorizationImmutable(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepNoSignatureAfterAdmission(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepFrozenAtFixed(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepAdmissionPermanent(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepViewSequenceMonotone(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepLegacyRetainedOnce(c, signEvm(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignEvm(c, attemptId, root, by_) ==> stepAttemptsAppendOnly(c, signEvm(c, attemptId, root, by_)))
{
  if inv(c) && canSignEvm(c, attemptId, root, by_) {
    SignEvmBounded(c, attemptId, root, by_);
  }
}

lemma signSolana_ensures(c: Commitment, attemptId: int, root: string, by_: string)
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAuthorizedMonthKept(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysViewNamesAuthority(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysFrozenOnlyWhenSigned(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysLegacyOnlyWhenAdmitted(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAttemptsBounded(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAuthorizedWithinCap(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAdmittedRootSigned(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAttemptSequencesIncrease(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAttemptsSignedInWindow(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysSolanaSingleAttempt(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysNoIntentEmpty(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysAdmittedIsLatestAttempt(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysInvestigationHasUnknownRoot(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> alwaysWindowFromPeriod(signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepFirstAuthorizationImmutable(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepNoSignatureAfterAdmission(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepFrozenAtFixed(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepAdmissionPermanent(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepViewSequenceMonotone(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepLegacyRetainedOnce(c, signSolana(c, attemptId, root, by_)))
  ensures (inv(c) ==> canSignSolana(c, attemptId, root, by_) ==> stepAttemptsAppendOnly(c, signSolana(c, attemptId, root, by_)))
{
  if inv(c) && canSignSolana(c, attemptId, root, by_) {
    var signed := signSolana(c, attemptId, root, by_);
    if signed.attempts != c.attempts {
      var added := Attempt(attemptId, c.view.height, c.view.sourceSequence, root, c.month.wholeGross, |c.month.leaves|, c.view.time, by_, c.clock);
      assert c.attempts == [];
      assert signed.attempts == c.attempts + [added];
      AttemptSequenceAppend(c.attempts, added);
      settlement__money_lawEqualReflexive_ensures(c.month.wholeGross);
      ProofLib.FilterAppend((o: Attempt) => (o.id == attemptId), c.attempts, added);
      ProofLib.FilterNil((o: Attempt) => (o.id == attemptId), c.attempts);
      assert forall a :: a in signed.attempts ==> a == added;
    }
  }
}
