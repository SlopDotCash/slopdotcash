lemma NoticesOnceMeaning(d: Dispute)
  ensures alwaysNoticesOnce(d) == (((!((exists n :: n in d.notices && !((|ProofLib.Filter((m: Notice) => (m == n), d.notices)| == 1)))) && ((!d.resolution.Unresolved?) == (exists n :: n in d.notices && n.kind.ResolvedNotice?))) && ((!d.escalation.NotEscalated?) == (exists n :: n in d.notices && n.kind.EscalatedNotice?))) && (d.filed == (exists n :: n in d.notices && n.kind.OpenedNotice?)))
{
}

lemma AppendUniqueNotice(xs: seq<Notice>, x: Notice)
  requires forall n :: n in xs ==> |ProofLib.Filter((m: Notice) => (m == n), xs)| == 1
  requires !(x in xs)
  ensures forall n :: n in xs + [x] ==> |ProofLib.Filter((m: Notice) => (m == n), xs + [x])| == 1
{
  forall n | n in xs + [x]
    ensures |ProofLib.Filter((m: Notice) => (m == n), xs + [x])| == 1
  {
    ProofLib.FilterAppend((m: Notice) => (m == n), xs, x);
    if n == x {
      ProofLib.FilterNone((m: Notice) => (m == n), xs);
    }
  }
}

lemma EscalatedWithNotices(d: Dispute, reason: Escalation)
  requires alwaysNoticesOnce(d)
  requires !reason.NotEscalated?
  ensures alwaysNoticesOnce(escalatedWith(reason, d))
{
  NoticesOnceMeaning(d);
  var after := escalatedWith(reason, d);
  if d.escalation.NotEscalated? {
    var n1 := Notice(NoticeKind.EscalatedNotice, 18633264);
    var n2 := Notice(NoticeKind.EscalatedNotice, 202660855);
    assert !(n1 in d.notices);
    assert !(n2 in d.notices);
    AppendUniqueNotice(d.notices, n1);
    assert !(n2 in d.notices + [n1]);
    AppendUniqueNotice(d.notices + [n1], n2);
    assert after.notices == (d.notices + [n1]) + [n2];
    assert n1 in after.notices && n1.kind.EscalatedNotice?;
  }
  NoticesOnceMeaning(after);
}

lemma file_ensures(d: Dispute, by_: int, record: RecordView, statementLength: int, statementDigest: string)
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysDraftBelowThreshold(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysClaimShape(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysTriageNeedsFiling(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysTimes(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysResolvedByModerator(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> alwaysNoticesOnce(file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepSourceImmutable(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepWritesOnlyByCurrentLease(d, "file", file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepNoCallAfterDraft(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepDraftAndEscalationOnce(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepUnknownCostsRetained(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepTokensIncrease(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepResolutionOnce(d, file(d, by_, record, statementLength, statementDigest)))
  ensures (inv(d) ==> canFile(d, by_, record, statementLength, statementDigest) ==> stepNoticesAppendOnly(d, file(d, by_, record, statementLength, statementDigest)))
{
  if inv(d) && canFile(d, by_, record, statementLength, statementDigest) {
    NoticesOnceMeaning(d);
    var after := file(d, by_, record, statementLength, statementDigest);
    var n := Notice(NoticeKind.OpenedNotice, by_);
    AppendUniqueNotice(d.notices, n);
    assert n in after.notices && n.kind.OpenedNotice?;
    NoticesOnceMeaning(after);
  }
}

lemma escalateUnavailable_ensures(d: Dispute, by_: int, token: int, availability: Availability)
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysDraftBelowThreshold(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysClaimShape(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysTriageNeedsFiling(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysTimes(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysResolvedByModerator(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> alwaysNoticesOnce(escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepSourceImmutable(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepWritesOnlyByCurrentLease(d, "escalateUnavailable", escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepNoCallAfterDraft(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepDraftAndEscalationOnce(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepUnknownCostsRetained(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepTokensIncrease(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepResolutionOnce(d, escalateUnavailable(d, by_, token, availability)))
  ensures (inv(d) ==> canEscalateUnavailable(d, by_, token, availability) ==> stepNoticesAppendOnly(d, escalateUnavailable(d, by_, token, availability)))
{
  if inv(d) && canEscalateUnavailable(d, by_, token, availability) {
    var reason := if availability.Unregistered? then Escalation.ProjectUnregistered else if availability.Restricted? then Escalation.ProjectRestricted else Escalation.InstallationUnavailable;
    EscalatedWithNotices(d, reason);
  }
}

lemma failTriage_ensures(d: Dispute, by_: int, token: int)
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysDraftBelowThreshold(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysClaimShape(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysTriageNeedsFiling(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysTimes(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysResolvedByModerator(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> alwaysNoticesOnce(failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepSourceImmutable(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepWritesOnlyByCurrentLease(d, "failTriage", failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepNoCallAfterDraft(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepDraftAndEscalationOnce(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepUnknownCostsRetained(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepTokensIncrease(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepResolutionOnce(d, failTriage(d, by_, token)))
  ensures (inv(d) ==> canFailTriage(d, by_, token) ==> stepNoticesAppendOnly(d, failTriage(d, by_, token)))
{
  if inv(d) && canFailTriage(d, by_, token) {
    EscalatedWithNotices(d.(callsInFlight := false), Escalation.TriageUnavailable);
  }
}

lemma escalateDrafted_ensures(d: Dispute, by_: int, token: int)
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysDraftBelowThreshold(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysClaimShape(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysTriageNeedsFiling(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysTimes(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysResolvedByModerator(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> alwaysNoticesOnce(escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepSourceImmutable(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepWritesOnlyByCurrentLease(d, "escalateDrafted", escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepNoCallAfterDraft(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepDraftAndEscalationOnce(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepUnknownCostsRetained(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepTokensIncrease(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepResolutionOnce(d, escalateDrafted(d, by_, token)))
  ensures (inv(d) ==> canEscalateDrafted(d, by_, token) ==> stepNoticesAppendOnly(d, escalateDrafted(d, by_, token)))
{
  if inv(d) && canEscalateDrafted(d, by_, token) {
    EscalatedWithNotices(d, Escalation.ModeratorReviewRequired);
  }
}

lemma escalateOverdue_ensures(d: Dispute, by_: int)
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysDraftBelowThreshold(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysClaimShape(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysTriageNeedsFiling(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysTimes(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysResolvedByModerator(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> alwaysNoticesOnce(escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepSourceImmutable(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepWritesOnlyByCurrentLease(d, "escalateOverdue", escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepNoCallAfterDraft(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepDraftAndEscalationOnce(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepUnknownCostsRetained(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepTokensIncrease(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepResolutionOnce(d, escalateOverdue(d, by_)))
  ensures (inv(d) ==> canEscalateOverdue(d, by_) ==> stepNoticesAppendOnly(d, escalateOverdue(d, by_)))
{
  if inv(d) && canEscalateOverdue(d, by_) {
    EscalatedWithNotices(d, Escalation.Overdue);
  }
}

lemma decide_ensures(d: Dispute, by_: int, uphold: bool, reasonLength: int)
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysDraftBelowThreshold(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysClaimShape(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysTriageNeedsFiling(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysTimes(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysResolvedByModerator(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> alwaysNoticesOnce(decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepSourceImmutable(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepWritesOnlyByCurrentLease(d, "decide", decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepNoCallAfterDraft(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepDraftAndEscalationOnce(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepUnknownCostsRetained(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepTokensIncrease(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepResolutionOnce(d, decide(d, by_, uphold, reasonLength)))
  ensures (inv(d) ==> canDecide(d, by_, uphold, reasonLength) ==> stepNoticesAppendOnly(d, decide(d, by_, uphold, reasonLength)))
{
  if inv(d) && canDecide(d, by_, uphold, reasonLength) {
    NoticesOnceMeaning(d);
    var after := decide(d, by_, uphold, reasonLength);
    var n := Notice(NoticeKind.ResolvedNotice, d.recipient);
    assert !(n in d.notices);
    AppendUniqueNotice(d.notices, n);
    assert n in after.notices && n.kind.ResolvedNotice?;
    NoticesOnceMeaning(after);
  }
}
