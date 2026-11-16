// A row update keyed by a prior status other than Uncertain keeps every uncertain row in place.
lemma UncertainRowsKept(rows: seq<NetworkRow>, net: Network, prior: NetworkStatus, status: NetworkStatus)
  requires !prior.Uncertain?
  ensures forall b :: b in rows && b.status.Uncertain? ==> exists a :: a in updateRows(rows, net, prior, status) && a.network == b.network && a.status.Uncertain?
{
  forall b | b in rows && b.status.Uncertain?
    ensures exists a :: a in updateRows(rows, net, prior, status) && a.network == b.network && a.status.Uncertain?
  {
    var i :| 0 <= i < |rows| && rows[i] == b;
    assert updateRows(rows, net, prior, status)[i] == b;
  }
}

lemma startRead_ensures(j: Job, net: Network, runId: int)
  ensures (inv(j) ==> canStartRead(j, net, runId) ==> alwaysDryNoSigning(startRead(j, net, runId)))
  ensures (inv(j) ==> canStartRead(j, net, runId) ==> alwaysRunningAuthorized(startRead(j, net, runId)))
  ensures (inv(j) ==> canStartRead(j, net, runId) ==> alwaysReportsTerminal(startRead(j, net, runId)))
  ensures (inv(j) ==> canStartRead(j, net, runId) ==> stepUncertainNeverResolvedByJob(j, startRead(j, net, runId)))
{
  UncertainRowsKept(j.rows, net, NetworkStatus.Waiting, NetworkStatus.Reading);
}

lemma settleRead_ensures(j: Job, net: Network, runId: int, read: ReadResult)
  ensures (inv(j) ==> canSettleRead(j, net, runId) ==> alwaysDryNoSigning(settleRead(j, net, runId, read)))
  ensures (inv(j) ==> canSettleRead(j, net, runId) ==> alwaysRunningAuthorized(settleRead(j, net, runId, read)))
  ensures (inv(j) ==> canSettleRead(j, net, runId) ==> alwaysReportsTerminal(settleRead(j, net, runId, read)))
  ensures (inv(j) ==> canSettleRead(j, net, runId) ==> stepUncertainNeverResolvedByJob(j, settleRead(j, net, runId, read)))
{
  UncertainRowsKept(j.rows, net, NetworkStatus.Reading, (if read.ReadFailed? then NetworkStatus.Failed else (if j.mode.DryRun? then NetworkStatus.Completed else NetworkStatus.Ready)));
}

lemma startExecution_ensures(j: Job, net: Network, runId: int, role: AuthorityCheck, release: ReleaseCheck)
  ensures (inv(j) ==> canStartExecution(j, net, runId) ==> alwaysDryNoSigning(startExecution(j, net, runId, role, release)))
  ensures (inv(j) ==> canStartExecution(j, net, runId) ==> alwaysRunningAuthorized(startExecution(j, net, runId, role, release)))
  ensures (inv(j) ==> canStartExecution(j, net, runId) ==> alwaysReportsTerminal(startExecution(j, net, runId, role, release)))
  ensures (inv(j) ==> canStartExecution(j, net, runId) ==> stepUncertainNeverResolvedByJob(j, startExecution(j, net, runId, role, release)))
{
  UncertainRowsKept(j.rows, net, NetworkStatus.Ready, (if (role.CurrentAuthority? && release.Released?) then NetworkStatus.Executing else NetworkStatus.Failed));
}

lemma settleExecution_ensures(j: Job, net: Network, runId: int, result: ExecutionResult)
  ensures (inv(j) ==> canSettleExecution(j, net, runId) ==> alwaysDryNoSigning(settleExecution(j, net, runId, result)))
  ensures (inv(j) ==> canSettleExecution(j, net, runId) ==> alwaysRunningAuthorized(settleExecution(j, net, runId, result)))
  ensures (inv(j) ==> canSettleExecution(j, net, runId) ==> alwaysReportsTerminal(settleExecution(j, net, runId, result)))
  ensures (inv(j) ==> canSettleExecution(j, net, runId) ==> stepUncertainNeverResolvedByJob(j, settleExecution(j, net, runId, result)))
{
  UncertainRowsKept(j.rows, net, NetworkStatus.Executing, (if result.ExecutionSucceeded? then NetworkStatus.Completed else (if result.ExecutionFailed? then NetworkStatus.Failed else NetworkStatus.Uncertain)));
}
