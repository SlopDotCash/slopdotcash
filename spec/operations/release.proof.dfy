lemma RivalTakeLockFilterBridge(r: Release, rival: int)
  ensures rivalTakeLock(r, rival).lock.waiting == ProofLib.Filter((w: int) => (w != rival), r.lock.waiting)
{
}

lemma ServiceFoldPointwise(target: Service, init: ServiceRow, xs: seq<ServiceRow>, ys: seq<ServiceRow>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> (xs[i].service == target) == (ys[i].service == target) && (xs[i].service == target ==> xs[i] == ys[i])
  ensures Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init, xs)
       == Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init, ys)
{
  var f := (found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found);
  ProofLib.FoldLeftPointwise(f, f, init, xs, ys);
}

lemma ServiceFoldNone(target: Service, init: ServiceRow, xs: seq<ServiceRow>)
  requires forall i :: 0 <= i < |xs| ==> xs[i].service != target
  ensures Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init, xs) == init
  decreases |xs|
{
  var f := (found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found);
  if |xs| > 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    ServiceFoldNone(target, f(init, xs[0]), xs[1..]);
  }
}

lemma ServiceFoldAtIndex(target: Service, init: ServiceRow, xs: seq<ServiceRow>, k: int)
  requires 0 <= k < |xs| && xs[k].service == target
  requires forall j :: k < j < |xs| ==> xs[j].service != target
  ensures Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init, xs) == xs[k]
  decreases |xs|
{
  var f := (found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found);
  if k == 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    ServiceFoldNone(target, f(init, xs[0]), xs[1..]);
  } else {
    assert xs[1..][k - 1] == xs[k];
    assert forall j :: k - 1 < j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    ServiceFoldAtIndex(target, f(init, xs[0]), xs[1..], k - 1);
  }
}

lemma ServiceRowsLookup(r: Release, after: Release)
  requires after.services == serviceRows(r)
  ensures serviceAt(after, Service.FeeConverter) == row(Service.FeeConverter, feeVariable(r))
  ensures serviceAt(after, Service.Slopbot) == row(Service.Slopbot, (r.environment.Production? && r.variables.slopbot) && r.variables.notify)
  ensures serviceAt(after, Service.Referral) == row(Service.Referral, r.environment.Production?)
  ensures serviceAt(after, Service.RepositoryAccess) == row(Service.RepositoryAccess, r.environment.Staging?)
  ensures serviceAt(after, Service.SubmissionFee) == row(Service.SubmissionFee, r.environment.Production?)
{
  var rows := serviceRows(r);
  ServiceFoldAtIndex(Service.FeeConverter, ServiceRow(Service.FeeConverter, false, ServicePhase.ServiceSkipped), rows, 0);
  ServiceFoldAtIndex(Service.Slopbot, ServiceRow(Service.Slopbot, false, ServicePhase.ServiceSkipped), rows, 4);
  ServiceFoldAtIndex(Service.Referral, ServiceRow(Service.Referral, false, ServicePhase.ServiceSkipped), rows, 8);
  ServiceFoldAtIndex(Service.RepositoryAccess, ServiceRow(Service.RepositoryAccess, false, ServicePhase.ServiceSkipped), rows, 9);
  ServiceFoldAtIndex(Service.SubmissionFee, ServiceRow(Service.SubmissionFee, false, ServicePhase.ServiceSkipped), rows, 10);
}

lemma ServiceFoldSetPending(target: Service, newPhase: ServicePhase, init1: ServiceRow, init2: ServiceRow, xs: seq<ServiceRow>, ys: seq<ServiceRow>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==>
    ys[i] == (if xs[i].service == target && xs[i].phase.ServicePending? then xs[i].(phase := newPhase) else xs[i])
  requires init1.phase.ServicePending? ==> init2.phase == newPhase
  requires !init1.phase.ServicePending? ==> init2 == init1
  ensures Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init1, xs).phase.ServicePending? ==>
    Std.Collections.Seq.FoldLeft((found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found), init2, ys).phase == newPhase
  decreases |xs|
{
  var f := (found: ServiceRow, s: ServiceRow) => (if (s.service == target) then s else found);
  if |xs| > 0 {
    var next1 := f(init1, xs[0]);
    var next2 := f(init2, ys[0]);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    ServiceFoldSetPending(target, newPhase, next1, next2, xs[1..], ys[1..]);
  }
}

lemma ServiceAtOtherUnchanged(r: Release, after: Release, svc: Service, phase: ServicePhase, target: Service)
  requires after.services == setService(r, svc, phase)
  requires target != svc
  ensures serviceAt(after, target) == serviceAt(r, target)
{
  ServiceFoldPointwise(target, ServiceRow(target, false, ServicePhase.ServiceSkipped), r.services, after.services);
}

lemma rivalTakeLock_ensures(r: Release, rival: int)
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysOptionsOnlyManual(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysPublicationAnchored(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysConfiguredBeforeProgress(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysAdmittedRef(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysRestoredOnlyManualProduction(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysRetainedOnlyManual(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysResumeOnlyManualProduction(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysUnrevalidatedNeverCollected(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysDeadlineNeverPublishes(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysGatesBindArtifact(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysCheckedComplete(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysOneLockHolder(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysExclusiveWhilePublishing(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysLineage(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysSkippedServicesDisabled(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysFeeConverterBoundToSource(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysEnvironmentServices(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysFeeRotationOnlyProduction(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysUncertainAfterServices(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysTerminalReleasedLock(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysVerifiedBytes(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> alwaysPublishedDeployment(rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> stepPreservesDataTimestamps(r, "rivalTakeLock", rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> stepLockTakenOnlyWhenFree(r, rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> stepStagingNeverRollsBack(r, rivalTakeLock(r, rival)))
  ensures (inv(r) ==> canRivalTakeLock(r, rival) ==> stepTerminalPhases(r, rivalTakeLock(r, rival)))
{
  if inv(r) && canRivalTakeLock(r, rival) {
    var after := rivalTakeLock(r, rival);
    RivalTakeLockFilterBridge(r, rival);
    forall w | w in after.lock.waiting
      ensures w > selfRun && w < after.lock.nextRival && w != after.lock.holderRun
    {
      ProofLib.FilterMember((w: int) => (w != rival), r.lock.waiting, w);
    }
  }
}

lemma beginPublication_ensures(r: Release, versions: FeeVersions)
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysOptionsOnlyManual(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysPublicationAnchored(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysConfiguredBeforeProgress(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysAdmittedRef(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysRestoredOnlyManualProduction(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysRetainedOnlyManual(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysResumeOnlyManualProduction(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysUnrevalidatedNeverCollected(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysDeadlineNeverPublishes(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysGatesBindArtifact(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysCheckedComplete(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysOneLockHolder(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysExclusiveWhilePublishing(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysLineage(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysSkippedServicesDisabled(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysFeeConverterBoundToSource(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysEnvironmentServices(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysFeeRotationOnlyProduction(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysUncertainAfterServices(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysTerminalReleasedLock(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysVerifiedBytes(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> alwaysPublishedDeployment(beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> stepPreservesDataTimestamps(r, "beginPublication", beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> stepLockTakenOnlyWhenFree(r, beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> stepStagingNeverRollsBack(r, beginPublication(r, versions)))
  ensures (inv(r) ==> canBeginPublication(r, versions) ==> stepTerminalPhases(r, beginPublication(r, versions)))
{
  if inv(r) && canBeginPublication(r, versions) {
    var after := beginPublication(r, versions);
    ServiceRowsLookup(r, after);
  }
}

lemma publishService_ensures(r: Release, service: Service, feeConfig: fees__runtime_WorkerConfig, taggedSource: int, versions: FeeVersions, submissionFeeConfig: SubmissionFeeConfig)
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysOptionsOnlyManual(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysPublicationAnchored(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysConfiguredBeforeProgress(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysAdmittedRef(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysRestoredOnlyManualProduction(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysRetainedOnlyManual(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysResumeOnlyManualProduction(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysUnrevalidatedNeverCollected(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysDeadlineNeverPublishes(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysGatesBindArtifact(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysCheckedComplete(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysOneLockHolder(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysExclusiveWhilePublishing(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysLineage(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysSkippedServicesDisabled(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysFeeConverterBoundToSource(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysEnvironmentServices(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysFeeRotationOnlyProduction(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysUncertainAfterServices(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysTerminalReleasedLock(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysVerifiedBytes(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> alwaysPublishedDeployment(publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> stepPreservesDataTimestamps(r, "publishService", publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> stepLockTakenOnlyWhenFree(r, publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> stepStagingNeverRollsBack(r, publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
  ensures (inv(r) ==> canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) ==> stepTerminalPhases(r, publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig)))
{
  if inv(r) && canPublishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig) {
    var after := publishService(r, service, feeConfig, taggedSource, versions, submissionFeeConfig);
    if !service.FeeConverter? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceBound, Service.FeeConverter);
    }
    if r.environment.Staging? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceBound, Service.Slopbot);
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceBound, Service.Referral);
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceBound, Service.SubmissionFee);
    }
    if r.environment.Production? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceBound, Service.RepositoryAccess);
    }
  }
}

lemma failService_ensures(r: Release, service: Service)
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysOptionsOnlyManual(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysPublicationAnchored(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysConfiguredBeforeProgress(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysAdmittedRef(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysRestoredOnlyManualProduction(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysRetainedOnlyManual(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysResumeOnlyManualProduction(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysUnrevalidatedNeverCollected(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysDeadlineNeverPublishes(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysGatesBindArtifact(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysCheckedComplete(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysOneLockHolder(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysExclusiveWhilePublishing(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysLineage(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysSkippedServicesDisabled(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysFeeConverterBoundToSource(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysEnvironmentServices(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysFeeRotationOnlyProduction(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysUncertainAfterServices(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysTerminalReleasedLock(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysVerifiedBytes(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> alwaysPublishedDeployment(failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> stepPreservesDataTimestamps(r, "failService", failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> stepLockTakenOnlyWhenFree(r, failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> stepStagingNeverRollsBack(r, failService(r, service)))
  ensures (inv(r) ==> canFailService(r, service) ==> stepTerminalPhases(r, failService(r, service)))
{
  if inv(r) && canFailService(r, service) {
    var after := failService(r, service);
    if !service.FeeConverter? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceFailed, Service.FeeConverter);
    } else {
      var init := ServiceRow(Service.FeeConverter, false, ServicePhase.ServiceSkipped);
      ServiceFoldSetPending(Service.FeeConverter, ServicePhase.ServiceFailed, init, init, r.services, after.services);
    }
    if r.environment.Staging? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceFailed, Service.Slopbot);
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceFailed, Service.Referral);
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceFailed, Service.SubmissionFee);
    }
    if r.environment.Production? {
      ServiceAtOtherUnchanged(r, after, service, ServicePhase.ServiceFailed, Service.RepositoryAccess);
    }
  }
}
