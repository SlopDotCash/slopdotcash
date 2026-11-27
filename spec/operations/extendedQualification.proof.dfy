lemma SettleGroupKeepsCompleted(result: GroupResult, s: Suite, finality: Finality)
  ensures stepCompletedScenarioNeverRunsAgain(s, settleGroup(result, s, finality))
{
  var after := settleGroup(result, s, finality);
  forall b | b in s.entries && b.complete
    ensures exists a :: a in after.entries && a.scenario == b.scenario && a.complete && a.executions == b.executions
  {
    var i :| 0 <= i < |s.entries| && s.entries[i] == b;
    assert after.entries[i] in after.entries;
  }
}

lemma runBounty_ensures(s: Suite, bountyRun: BountyFigures, waiting: bool, finality: Finality)
  ensures (inv(s) ==> canRunBounty(s) ==> alwaysPassedScenarioIsComplete(runBounty(s, bountyRun, waiting, finality)))
  ensures (inv(s) ==> canRunBounty(s) ==> alwaysSuitePassesOnlyWhenEveryScenarioPassed(runBounty(s, bountyRun, waiting, finality)))
  ensures (inv(s) ==> canRunBounty(s) ==> stepCompletedScenarioNeverRunsAgain(s, runBounty(s, bountyRun, waiting, finality)))
{
  SettleGroupKeepsCompleted(groupResult(bountyMet(bountyRun), waiting), s, finality);
}

lemma runLifecycle_ensures(s: Suite, lifecycleRun: LifecycleFigures, waiting: bool, finality: Finality)
  ensures (inv(s) ==> canRunLifecycle(s) ==> alwaysPassedScenarioIsComplete(runLifecycle(s, lifecycleRun, waiting, finality)))
  ensures (inv(s) ==> canRunLifecycle(s) ==> alwaysSuitePassesOnlyWhenEveryScenarioPassed(runLifecycle(s, lifecycleRun, waiting, finality)))
  ensures (inv(s) ==> canRunLifecycle(s) ==> stepCompletedScenarioNeverRunsAgain(s, runLifecycle(s, lifecycleRun, waiting, finality)))
{
  SettleGroupKeepsCompleted(groupResult(lifecycleMet(lifecycleRun), waiting), s, finality);
}

lemma runMonthly_ensures(s: Suite, monthlyRun: MonthlyFigures, waiting: bool, finality: Finality)
  ensures (inv(s) ==> canRunMonthly(s) ==> alwaysPassedScenarioIsComplete(runMonthly(s, monthlyRun, waiting, finality)))
  ensures (inv(s) ==> canRunMonthly(s) ==> alwaysSuitePassesOnlyWhenEveryScenarioPassed(runMonthly(s, monthlyRun, waiting, finality)))
  ensures (inv(s) ==> canRunMonthly(s) ==> stepCompletedScenarioNeverRunsAgain(s, runMonthly(s, monthlyRun, waiting, finality)))
{
  SettleGroupKeepsCompleted(groupResult(monthlyMet(monthlyRun), waiting), s, finality);
}

lemma runDispatch_ensures(s: Suite, dispatchRun: DispatchFigures, waiting: bool, finality: Finality)
  ensures (inv(s) ==> canRunDispatch(s) ==> alwaysPassedScenarioIsComplete(runDispatch(s, dispatchRun, waiting, finality)))
  ensures (inv(s) ==> canRunDispatch(s) ==> alwaysSuitePassesOnlyWhenEveryScenarioPassed(runDispatch(s, dispatchRun, waiting, finality)))
  ensures (inv(s) ==> canRunDispatch(s) ==> stepCompletedScenarioNeverRunsAgain(s, runDispatch(s, dispatchRun, waiting, finality)))
{
  SettleGroupKeepsCompleted(groupResult(dispatchMet(dispatchRun), waiting), s, finality);
}

lemma runRecovery_ensures(s: Suite, recoveryRun: RecoveryFigures, waiting: bool, finality: Finality)
  ensures (inv(s) ==> canRunRecovery(s) ==> alwaysPassedScenarioIsComplete(runRecovery(s, recoveryRun, waiting, finality)))
  ensures (inv(s) ==> canRunRecovery(s) ==> alwaysSuitePassesOnlyWhenEveryScenarioPassed(runRecovery(s, recoveryRun, waiting, finality)))
  ensures (inv(s) ==> canRunRecovery(s) ==> stepCompletedScenarioNeverRunsAgain(s, runRecovery(s, recoveryRun, waiting, finality)))
{
  SettleGroupKeepsCompleted(groupResult(recoveryMet(recoveryRun), waiting), s, finality);
}
