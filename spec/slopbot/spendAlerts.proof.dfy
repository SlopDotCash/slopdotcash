lemma FailuresFilterBridge(s: Spend)
  ensures alwaysEachNewFailureQueuedOnce(s) ==
    !((exists c :: c in s.costs && !((|ProofLib.Filter((n: FailureNotice) => (n.call == c.id), s.failures)| == (if (!(c.historical) && (!c.failure.NotFailed?)) then 1 else 0)))))
{
}

lemma AlertsFilterBridge(s: Spend)
  ensures alwaysEachMilestoneOnce(s) ==
    !((exists a :: a in s.alerts && !((|ProofLib.Filter((b: Alert) => ((b.month == a.month) && (b.threshold == a.threshold)), s.alerts)| == 1))))
{
}

lemma CostOfBridge(s: Spend, call: int)
  ensures costOf(s, call) ==
    (if 0 < |ProofLib.Filter((c: CostRow) => (c.id == call), s.costs)| then ProofLib.Filter((c: CostRow) => (c.id == call), s.costs)[0] else historicalRow)
{
}

lemma MonthTotalAppend(s: Spend, c: CallInput, month: int)
  requires canRecordCall(s, c)
  ensures monthTotal(recordCall(s, c), month) >= monthTotal(s, month)
{
  var row := CostRow(|s.costs| + 1, c.month, amountOf(c), c.provider, c.failure, 0, false, c.job, c.model, c.cause, c.at);
  assert recordCall(s, c).costs == s.costs + [row];
  ProofLib.FoldLeftAppend((sum: int, c: CostRow) => (sum + (if (c.month == month) then c.amount else 0)), 0, s.costs, row);
}

lemma CostOfAfterRecordCall(s: Spend, c: CallInput, call: int)
  requires inv(s) && canRecordCall(s, c)
  ensures var after := recordCall(s, c);
    var row := CostRow(|s.costs| + 1, c.month, amountOf(c), c.provider, c.failure, 0, false, c.job, c.model, c.cause, c.at);
    (call <= |s.costs| ==> costOf(after, call) == costOf(s, call)) &&
    (call == |s.costs| + 1 ==> costOf(after, call) == row)
{
  var after := recordCall(s, c);
  var row := CostRow(|s.costs| + 1, c.month, amountOf(c), c.provider, c.failure, 0, false, c.job, c.model, c.cause, c.at);
  assert after.costs == s.costs + [row];
  CostOfBridge(s, call);
  CostOfBridge(after, call);
  ProofLib.FilterAppend((x: CostRow) => (x.id == call), s.costs, row);
  if call == |s.costs| + 1 {
    ProofLib.FilterNone((x: CostRow) => (x.id == call), s.costs);
  }
}

lemma RemainderAddInterval(x: int)
  requires x >= 0 && remainder_slopbot__spendAlerts(x, interval) == 0
  ensures remainder_slopbot__spendAlerts(x + interval, interval) == 0
{
  var q := quotient_slopbot__spendAlerts(x, interval);
  assert x == interval * q;
  assert (x + interval) / interval == q + 1;
}

lemma ClaimedTopFold(init: int, alerts: seq<Alert>, month: int)
  requires init >= 0 && remainder_slopbot__spendAlerts(init, interval) == 0
  requires forall a :: a in alerts ==> a.threshold > 0 && remainder_slopbot__spendAlerts(a.threshold, interval) == 0
  ensures var top := Std.Collections.Seq.FoldLeft((top: int, a: Alert) => (if ((a.month == month) && (a.threshold > top)) then a.threshold else top), init, alerts);
    top >= init &&
    remainder_slopbot__spendAlerts(top, interval) == 0 &&
    (forall a :: a in alerts && a.month == month ==> a.threshold <= top) &&
    (top == init || exists a :: a in alerts && a.month == month && a.threshold == top)
  decreases |alerts|
{
  if |alerts| > 0 {
    var next := if alerts[0].month == month && alerts[0].threshold > init then alerts[0].threshold else init;
    ClaimedTopFold(next, alerts[1..], month);
  }
}

lemma FailureCallsUnique(s: Spend, i: int, j: int)
  requires inv(s)
  requires 0 <= i < |s.failures| && 0 <= j < |s.failures| && s.failures[i].call == s.failures[j].call
  ensures i == j
{
  var call := s.failures[i].call;
  CostOfBridge(s, call);
  var matches := ProofLib.Filter((c: CostRow) => (c.id == call), s.costs);
  assert !costOf(s, call).historical;
  assert |matches| > 0;
  ProofLib.FilterMember((c: CostRow) => (c.id == call), s.costs, matches[0]);
  var c := matches[0];
  FailuresFilterBridge(s);
  if i != j {
    ProofLib.FilterTwo((n: FailureNotice) => (n.call == c.id), s.failures, i, j);
  }
}

lemma recordCall_ensures(s: Spend, c: CallInput)
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysNewRowsAreFree(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysRowsAreNumbered(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysEachNewFailureQueuedOnce(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysEachMilestoneOnce(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysMilestonesConsecutive(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysMilestoneWasReached(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysReceiptFollowsClaim(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysSuppressedNeverSent(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysBudgetDenialNeverServedByFallback(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> alwaysNoticesNameNewRows(recordCall(s, c)))
  ensures (inv(s) ==> canRecordCall(s, c) ==> stepReceiptsAreFinal(s, recordCall(s, c)))
{
  if inv(s) && canRecordCall(s, c) {
    var after := recordCall(s, c);
    var id := |s.costs| + 1;
    var row := CostRow(id, c.month, amountOf(c), c.provider, c.failure, 0, false, c.job, c.model, c.cause, c.at);
    assert alwaysMilestoneWasReached(after) by {
      forall a | a in after.alerts
        ensures monthTotal(after, a.month) >= a.threshold
      {
        MonthTotalAppend(s, c, a.month);
      }
    }
    assert alwaysBudgetDenialNeverServedByFallback(after) && alwaysNoticesNameNewRows(after) by {
      forall n | n in after.failures
        ensures n.call > 0 && n.call <= |after.costs| && !costOf(after, n.call).historical && !costOf(after, n.call).failure.NotFailed? &&
          (!costOf(after, n.call).failure.BudgetExhausted? || !n.suppressed.ServedByFallback?)
      {
        CostOfAfterRecordCall(s, c, n.call);
      }
    }
    assert alwaysEachNewFailureQueuedOnce(after) by {
      FailuresFilterBridge(s);
      FailuresFilterBridge(after);
      forall x | x in after.costs
        ensures |ProofLib.Filter((n: FailureNotice) => (n.call == x.id), after.failures)| == (if (!x.historical && !x.failure.NotFailed?) then 1 else 0)
      {
        if x == row {
          ProofLib.FilterNone((n: FailureNotice) => (n.call == row.id), s.failures);
          if !c.failure.NotFailed? {
            var notice := FailureNotice(id, false, Receipt.NoReceipt, Suppression.NoSuppression, 0);
            assert after.failures == s.failures + [notice];
            ProofLib.FilterAppend((n: FailureNotice) => (n.call == row.id), s.failures, notice);
          }
        } else {
          if !c.failure.NotFailed? {
            var notice := FailureNotice(id, false, Receipt.NoReceipt, Suppression.NoSuppression, 0);
            assert after.failures == s.failures + [notice];
            ProofLib.FilterAppend((n: FailureNotice) => (n.call == x.id), s.failures, notice);
          }
        }
      }
    }
  }
}

lemma deliverMilestone_ensures(s: Spend, month: int, threshold: int, accepted: bool)
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysNewRowsAreFree(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysRowsAreNumbered(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysEachNewFailureQueuedOnce(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysEachMilestoneOnce(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysMilestonesConsecutive(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysMilestoneWasReached(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysReceiptFollowsClaim(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysSuppressedNeverSent(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysBudgetDenialNeverServedByFallback(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> alwaysNoticesNameNewRows(deliverMilestone(s, month, threshold, accepted)))
  ensures (inv(s) ==> canDeliverMilestone(s, month, threshold, accepted) ==> stepReceiptsAreFinal(s, deliverMilestone(s, month, threshold, accepted)))
{
  if inv(s) && canDeliverMilestone(s, month, threshold, accepted) {
    var after := deliverMilestone(s, month, threshold, accepted);
    AlertsFilterBridge(s);
    AlertsFilterBridge(after);
    assert alwaysEachMilestoneOnce(after) by {
      forall i | 0 <= i < |after.alerts|
        ensures |ProofLib.Filter((b: Alert) => ((b.month == after.alerts[i].month) && (b.threshold == after.alerts[i].threshold)), after.alerts)| == 1
      {
        var a := after.alerts[i];
        ProofLib.FilterLengthPointwise(
          (b: Alert) => ((b.month == s.alerts[i].month) && (b.threshold == s.alerts[i].threshold)),
          (b: Alert) => ((b.month == a.month) && (b.threshold == a.threshold)),
          s.alerts,
          after.alerts
        );
      }
    }
    assert alwaysMilestonesConsecutive(after) by {
      forall i | 0 <= i < |after.alerts|
        ensures after.alerts[i].threshold == interval || exists b :: b in after.alerts && b.month == after.alerts[i].month && b.threshold == after.alerts[i].threshold - interval
      {
        if s.alerts[i].threshold != interval {
          var j :| 0 <= j < |s.alerts| && s.alerts[j].month == s.alerts[i].month && s.alerts[j].threshold == s.alerts[i].threshold - interval;
          assert after.alerts[j] in after.alerts;
        }
      }
    }
    assert stepReceiptsAreFinal(s, after) by {
      var k :| 0 <= k < |s.alerts| && s.alerts[k].month == month && s.alerts[k].threshold == threshold && s.alerts[k].receipt.NoReceipt?;
      forall i | 0 <= i < |s.alerts| && !s.alerts[i].receipt.NoReceipt?
        ensures s.alerts[i] in after.alerts
      {
        if s.alerts[i].month == month && s.alerts[i].threshold == threshold {
          ProofLib.FilterTwo((b: Alert) => ((b.month == s.alerts[k].month) && (b.threshold == s.alerts[k].threshold)), s.alerts, i, k);
        }
        assert after.alerts[i] == s.alerts[i];
      }
    }
  }
}

lemma claimMilestone_ensures(s: Spend, month: int)
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysNewRowsAreFree(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysRowsAreNumbered(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysEachNewFailureQueuedOnce(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysEachMilestoneOnce(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysMilestonesConsecutive(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysMilestoneWasReached(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysReceiptFollowsClaim(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysSuppressedNeverSent(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysBudgetDenialNeverServedByFallback(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> alwaysNoticesNameNewRows(claimMilestone(s, month)))
  ensures (inv(s) ==> canClaimMilestone(s, month) ==> stepReceiptsAreFinal(s, claimMilestone(s, month)))
{
  if inv(s) && canClaimMilestone(s, month) {
    var after := claimMilestone(s, month);
    var top := claimedTop(s, month);
    var added := Alert(month, top + interval, monthTotal(s, month), Receipt.NoReceipt);
    assert after.alerts == s.alerts + [added];
    ClaimedTopFold(0, s.alerts, month);
    RemainderAddInterval(top);
    assert alwaysMilestoneWasReached(after);
    assert alwaysMilestonesConsecutive(after);
    assert alwaysEachMilestoneOnce(after) by {
      AlertsFilterBridge(s);
      AlertsFilterBridge(after);
      forall a | a in after.alerts
        ensures |ProofLib.Filter((b: Alert) => ((b.month == a.month) && (b.threshold == a.threshold)), after.alerts)| == 1
      {
        ProofLib.FilterAppend((b: Alert) => ((b.month == a.month) && (b.threshold == a.threshold)), s.alerts, added);
        if a == added {
          ProofLib.FilterNone((b: Alert) => ((b.month == added.month) && (b.threshold == added.threshold)), s.alerts);
        }
      }
    }
  }
}

lemma deliverFailure_ensures(s: Spend, call: int, accepted: bool, now: int)
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysNewRowsAreFree(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysRowsAreNumbered(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysEachNewFailureQueuedOnce(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysEachMilestoneOnce(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysMilestonesConsecutive(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysMilestoneWasReached(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysReceiptFollowsClaim(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysSuppressedNeverSent(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysBudgetDenialNeverServedByFallback(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> alwaysNoticesNameNewRows(deliverFailure(s, call, accepted, now)))
  ensures (inv(s) ==> canDeliverFailure(s, call, accepted, now) ==> stepReceiptsAreFinal(s, deliverFailure(s, call, accepted, now)))
{
  if inv(s) && canDeliverFailure(s, call, accepted, now) {
    var after := deliverFailure(s, call, accepted, now);
    var k :| 0 <= k < |s.failures| && s.failures[k].call == call && s.failures[k].claimed && s.failures[k].suppressed.NoSuppression? && s.failures[k].receipt.NoReceipt?;
    assert alwaysEachNewFailureQueuedOnce(after) by {
      FailuresFilterBridge(s);
      FailuresFilterBridge(after);
      forall c | c in after.costs
        ensures |ProofLib.Filter((n: FailureNotice) => (n.call == c.id), after.failures)| == (if (!c.historical && !c.failure.NotFailed?) then 1 else 0)
      {
        ProofLib.FilterLengthPointwise(
          (n: FailureNotice) => (n.call == c.id),
          (n: FailureNotice) => (n.call == c.id),
          s.failures,
          after.failures
        );
      }
    }
    forall i | 0 <= i < |s.failures| && s.failures[i].call == call
      ensures i == k
    {
      FailureCallsUnique(s, i, k);
    }
    assert alwaysReceiptFollowsClaim(after);
    assert alwaysSuppressedNeverSent(after);
    assert stepReceiptsAreFinal(s, after) by {
      forall i | 0 <= i < |s.failures| && !s.failures[i].receipt.NoReceipt?
        ensures s.failures[i] in after.failures
      {
        assert after.failures[i] == s.failures[i];
      }
    }
  }
}

lemma claimFailure_ensures(s: Spend, call: int, now: int)
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysNewRowsAreFree(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysRowsAreNumbered(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysEachNewFailureQueuedOnce(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysEachMilestoneOnce(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysMilestonesConsecutive(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysMilestoneWasReached(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysReceiptFollowsClaim(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysSuppressedNeverSent(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysBudgetDenialNeverServedByFallback(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> alwaysNoticesNameNewRows(claimFailure(s, call, now)))
  ensures (inv(s) ==> canClaimFailure(s, call, now) ==> stepReceiptsAreFinal(s, claimFailure(s, call, now)))
{
  if inv(s) && canClaimFailure(s, call, now) {
    var after := claimFailure(s, call, now);
    var k :| 0 <= k < |s.failures| && s.failures[k].call == call && !s.failures[k].claimed;
    assert alwaysEachNewFailureQueuedOnce(after) by {
      FailuresFilterBridge(s);
      FailuresFilterBridge(after);
      forall c | c in after.costs
        ensures |ProofLib.Filter((n: FailureNotice) => (n.call == c.id), after.failures)| == (if (!c.historical && !c.failure.NotFailed?) then 1 else 0)
      {
        ProofLib.FilterLengthPointwise(
          (n: FailureNotice) => (n.call == c.id),
          (n: FailureNotice) => (n.call == c.id),
          s.failures,
          after.failures
        );
      }
    }
    forall i | 0 <= i < |s.failures| && s.failures[i].call == call
      ensures i == k
    {
      FailureCallsUnique(s, i, k);
    }
    assert s.failures[k].receipt.NoReceipt?;
    assert alwaysSuppressedNeverSent(after);
    assert stepReceiptsAreFinal(s, after) by {
      forall i | 0 <= i < |s.failures| && !s.failures[i].receipt.NoReceipt?
        ensures s.failures[i] in after.failures
      {
        assert after.failures[i] == s.failures[i];
      }
    }
  }
}
