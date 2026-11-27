lemma OneSnapshotFilter(i: Inbox)
  ensures alwaysOneSnapshotPerRecipient(i) == !(exists e :: e in i.enrollments && !((e.actor > 0) && (|ProofLib.Filter((x: backend__email_Enrollment) => (x.actor == e.actor), i.enrollments)| == 1)))
{
}

lemma WithSnapshotPreserves(i: Inbox, enrollment: backend__email_Enrollment, after: Inbox)
  requires alwaysOneSnapshotPerRecipient(i)
  requires enrollment.actor > 0
  requires after.enrollments == withSnapshot(i, enrollment)
  ensures alwaysOneSnapshotPerRecipient(after)
{
  OneSnapshotFilter(i);
  OneSnapshotFilter(after);
  if exists x :: x in i.enrollments && x.actor == enrollment.actor {
    forall e | e in after.enrollments
      ensures e.actor > 0 && |ProofLib.Filter((x: backend__email_Enrollment) => (x.actor == e.actor), after.enrollments)| == 1
    {
      var k :| 0 <= k < |after.enrollments| && after.enrollments[k] == e;
      var prev := i.enrollments[k];
      assert prev in i.enrollments && prev.actor == e.actor;
      ProofLib.FilterLengthPointwise((x: backend__email_Enrollment) => (x.actor == prev.actor), (x: backend__email_Enrollment) => (x.actor == e.actor), i.enrollments, after.enrollments);
    }
  } else {
    forall e | e in after.enrollments
      ensures e.actor > 0 && |ProofLib.Filter((x: backend__email_Enrollment) => (x.actor == e.actor), after.enrollments)| == 1
    {
      var pred := (x: backend__email_Enrollment) => (x.actor == e.actor);
      ProofLib.FilterAppend(pred, i.enrollments, enrollment);
      if e in i.enrollments {
        assert !pred(enrollment);
      } else {
        assert e == enrollment;
        ProofLib.FilterNone(pred, i.enrollments);
      }
    }
  }
}

lemma SuppressMapIdentity(i: Inbox, after: Inbox)
  requires alwaysNoticeIdentity(i)
  requires |after.notices| == |i.notices|
  requires forall k :: 0 <= k < |i.notices| ==> after.notices[k] == i.notices[k] || (waiting(i.notices[k]) && after.notices[k] == i.notices[k].(state := DeliveryState.Suppressed))
  requires forall k1, k2 :: 0 <= k1 < |i.notices| && 0 <= k2 < |i.notices| && i.notices[k1] == i.notices[k2] ==> after.notices[k1] == after.notices[k2]
  ensures alwaysNoticeIdentity(after)
{
  forall n | n in after.notices
    ensures n.id > 0 && notice(after, n.id) == n
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    var prev := i.notices[k];
    assert prev in i.notices;
    assert 0 <= prev.id - 1 < |i.notices| && i.notices[prev.id - 1] == prev;
    assert after.notices[prev.id - 1] == n;
  }
}

lemma SuppressMapEscalationChild(i: Inbox, after: Inbox, k: int)
  requires alwaysEscalationOnce(i)
  requires |after.notices| == |i.notices| && 0 <= k < |i.notices|
  requires forall m :: 0 <= m < |i.notices| ==> after.notices[m].id == i.notices[m].id && after.notices[m].key == i.notices[m].key && after.notices[m].kind == i.notices[m].kind && after.notices[m].recipient == i.notices[m].recipient && after.notices[m].channel == i.notices[m].channel && after.notices[m].escalationOf == i.notices[m].escalationOf && after.notices[m].escalated == i.notices[m].escalated
  ensures var n := after.notices[k]; n.escalationOf >= 0 && (n.escalationOf == 0 ==> n.key > 0 && n.key < 1000) && (n.escalationOf > 0 ==> n.kind.SecurityCase? && n.key == 1000 + n.escalationOf && n.escalationOf < n.id && notice(after, n.escalationOf).escalated && notice(after, n.escalationOf).channel.SecurityOutbox? && notice(after, n.escalationOf).escalationOf == 0 && n.recipient > 0 && n.recipient != notice(after, n.escalationOf).recipient && !n.escalated)
{
  var prev := i.notices[k];
  var n := after.notices[k];
  assert prev in i.notices;
  if n.escalationOf > 0 {
    var p := prev.escalationOf - 1;
    assert 0 <= p < |i.notices|;
    assert notice(i, prev.escalationOf) == i.notices[p];
    assert notice(after, n.escalationOf) == after.notices[p];
  }
}

lemma SuppressMapEscalationFlag(i: Inbox, after: Inbox, k: int)
  requires alwaysEscalationOnce(i)
  requires |after.notices| == |i.notices| && 0 <= k < |i.notices|
  requires forall m :: 0 <= m < |i.notices| ==> after.notices[m].id == i.notices[m].id && after.notices[m].escalationOf == i.notices[m].escalationOf && after.notices[m].escalated == i.notices[m].escalated
  ensures after.notices[k].escalated == (exists e :: e in after.notices && e.escalationOf == after.notices[k].id)
{
  var prev := i.notices[k];
  var n := after.notices[k];
  assert prev in i.notices;
  if n.escalated {
    var e :| e in i.notices && e.escalationOf == prev.id;
    var j :| 0 <= j < |i.notices| && i.notices[j] == e;
    assert after.notices[j] in after.notices && after.notices[j].escalationOf == n.id;
  }
  if exists e :: e in after.notices && e.escalationOf == n.id {
    var e :| e in after.notices && e.escalationOf == n.id;
    var j :| 0 <= j < |after.notices| && after.notices[j] == e;
    assert i.notices[j] in i.notices && i.notices[j].escalationOf == prev.id;
  }
}

lemma SuppressMapEscalation(i: Inbox, after: Inbox)
  requires alwaysEscalationOnce(i)
  requires |after.notices| == |i.notices|
  requires forall k :: 0 <= k < |i.notices| ==> after.notices[k].id == i.notices[k].id && after.notices[k].key == i.notices[k].key && after.notices[k].kind == i.notices[k].kind && after.notices[k].recipient == i.notices[k].recipient && after.notices[k].channel == i.notices[k].channel && after.notices[k].escalationOf == i.notices[k].escalationOf && after.notices[k].escalated == i.notices[k].escalated
  ensures alwaysEscalationOnce(after)
{
  forall n | n in after.notices
    ensures n.escalationOf >= 0
    ensures n.escalationOf == 0 ==> n.key > 0 && n.key < 1000
    ensures n.escalationOf > 0 ==> n.kind.SecurityCase? && n.key == 1000 + n.escalationOf && n.escalationOf < n.id && notice(after, n.escalationOf).escalated && notice(after, n.escalationOf).channel.SecurityOutbox? && notice(after, n.escalationOf).escalationOf == 0 && n.recipient > 0 && n.recipient != notice(after, n.escalationOf).recipient && !n.escalated
    ensures n.escalated == (exists e :: e in after.notices && e.escalationOf == n.id)
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    SuppressMapEscalationChild(i, after, k);
    SuppressMapEscalationFlag(i, after, k);
  }
}

lemma SuppressMapProps(i: Inbox, after: Inbox)
  requires alwaysChannelByKind(i) && alwaysAttemptBudget(i) && alwaysSettledHasDigest(i) && alwaysAcknowledgmentOnSecurityNotices(i)
  requires after.clock == i.clock
  requires |after.notices| == |i.notices|
  requires forall k :: 0 <= k < |i.notices| ==> after.notices[k] == i.notices[k] || (waiting(i.notices[k]) && after.notices[k] == i.notices[k].(state := DeliveryState.Suppressed))
  ensures alwaysChannelByKind(after)
  ensures alwaysAttemptBudget(after)
  ensures alwaysSettledHasDigest(after)
  ensures alwaysAcknowledgmentOnSecurityNotices(after)
{
  forall k | 0 <= k < |after.notices|
    ensures i.notices[k] in i.notices
  {
  }
}

lemma SuppressMapSteps(i: Inbox, after: Inbox, via: string)
  requires alwaysSettledHasDigest(i)
  requires |after.notices| == |i.notices|
  requires forall k :: 0 <= k < |i.notices| ==> after.notices[k] == i.notices[k] || (waiting(i.notices[k]) && after.notices[k] == i.notices[k].(state := DeliveryState.Suppressed))
  ensures stepNoticesPermanent(i, after)
  ensures stepConsentNeverQueuesHistory(i, via, after)
  ensures stepSuppressedStaysSuppressed(i, after)
  ensures stepProviderStatesNeedEvidence(i, via, after)
{
  forall n | n in i.notices
    ensures exists a :: a in after.notices && a.id == n.id && a.key == n.key && a.kind == n.kind && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf && (n.readAt > 0 ==> a.readAt == n.readAt) && (n.acknowledgedAt > 0 ==> a.acknowledgedAt == n.acknowledgedAt) && (n.escalated ==> a.escalated) && ((a.state == n.state) || (waiting(n) && a.state.Suppressed?))
    ensures n.state.Suppressed? ==> exists a :: a in after.notices && a.id == n.id && a.state.Suppressed?
  {
    var k :| 0 <= k < |i.notices| && i.notices[k] == n;
    assert after.notices[k] in after.notices;
  }
  forall a | a in after.notices && (a.state.Delivered? || a.state.Bounced? || a.providerSuppressed)
    ensures exists b :: b in i.notices && b.id == a.id && b.state == a.state && b.providerSuppressed == a.providerSuppressed
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == a;
    var prev := i.notices[k];
    assert prev in i.notices;
    assert a == prev;
  }
}

lemma SetNoticeIdentity(i: Inbox, id: int, updated: Notice, after: Inbox)
  requires alwaysNoticeIdentity(i)
  requires id > 0 && notice(i, id).id == id && updated.id == id
  requires after.notices == setNotice(i, id, updated)
  ensures alwaysNoticeIdentity(after)
{
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == notice(i, id);
  forall n | n in after.notices
    ensures n.id > 0 && notice(after, n.id) == n
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    var prev := i.notices[k];
    assert prev in i.notices;
    assert 0 <= prev.id - 1 < |i.notices| && i.notices[prev.id - 1] == prev;
    if prev.id == id {
      assert prev == notice(i, id);
      assert after.notices[id - 1] == updated;
    } else {
      assert after.notices[prev.id - 1] == prev;
    }
  }
}

lemma SetNoticeEscalation(i: Inbox, id: int, updated: Notice, after: Inbox)
  requires alwaysNoticeIdentity(i) && alwaysEscalationOnce(i)
  requires id > 0 && notice(i, id).id == id
  requires updated.id == id && updated.key == notice(i, id).key && updated.kind == notice(i, id).kind
  requires updated.recipient == notice(i, id).recipient && updated.channel == notice(i, id).channel
  requires updated.escalationOf == notice(i, id).escalationOf && updated.escalated == notice(i, id).escalated
  requires after.notices == setNotice(i, id, updated)
  ensures alwaysEscalationOnce(after)
{
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == notice(i, id);
  forall n | n in after.notices
    ensures n.escalationOf >= 0
    ensures n.escalationOf == 0 ==> n.key > 0 && n.key < 1000
    ensures n.escalationOf > 0 ==> n.kind.SecurityCase? && n.key == 1000 + n.escalationOf && n.escalationOf < n.id && notice(after, n.escalationOf).escalated && notice(after, n.escalationOf).channel.SecurityOutbox? && notice(after, n.escalationOf).escalationOf == 0 && n.recipient > 0 && n.recipient != notice(after, n.escalationOf).recipient && !n.escalated
    ensures n.escalated == (exists e :: e in after.notices && e.escalationOf == n.id)
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    var prev := i.notices[k];
    assert prev in i.notices;
    if prev.id == id {
      assert prev == notice(i, id);
    }
    if n.escalationOf > 0 {
      assert 0 <= prev.escalationOf - 1 < |i.notices|;
      assert notice(after, n.escalationOf) == after.notices[prev.escalationOf - 1];
      if i.notices[prev.escalationOf - 1].id == id {
        assert i.notices[prev.escalationOf - 1] == notice(i, id);
      }
    }
    if n.escalated {
      var e :| e in i.notices && e.escalationOf == prev.id;
      var j :| 0 <= j < |i.notices| && i.notices[j] == e;
      if i.notices[j].id == id {
        assert i.notices[j] == notice(i, id);
      }
      assert after.notices[j] in after.notices && after.notices[j].escalationOf == n.id;
    }
    if exists e :: e in after.notices && e.escalationOf == n.id {
      var e :| e in after.notices && e.escalationOf == n.id;
      var j :| 0 <= j < |after.notices| && after.notices[j] == e;
      assert i.notices[j] in i.notices;
      if i.notices[j].id == id {
        assert i.notices[j] == notice(i, id);
      }
      assert i.notices[j].escalationOf == prev.id;
    }
  }
}

lemma SetNoticeSteps(i: Inbox, id: int, updated: Notice, after: Inbox)
  requires alwaysNoticeIdentity(i)
  requires id > 0 && notice(i, id).id == id
  requires updated.id == id && updated.key == notice(i, id).key && updated.kind == notice(i, id).kind
  requires updated.recipient == notice(i, id).recipient && updated.channel == notice(i, id).channel
  requires updated.createdAt == notice(i, id).createdAt && updated.escalationOf == notice(i, id).escalationOf
  requires notice(i, id).readAt > 0 ==> updated.readAt == notice(i, id).readAt
  requires notice(i, id).acknowledgedAt > 0 ==> updated.acknowledgedAt == notice(i, id).acknowledgedAt
  requires notice(i, id).escalated ==> updated.escalated
  requires notice(i, id).state.Suppressed? ==> updated.state.Suppressed?
  requires after.notices == setNotice(i, id, updated)
  ensures stepNoticesPermanent(i, after)
  ensures stepSuppressedStaysSuppressed(i, after)
{
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == notice(i, id);
  forall n | n in i.notices
    ensures exists a :: a in after.notices && a.id == n.id && a.key == n.key && a.kind == n.kind && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf && (n.readAt > 0 ==> a.readAt == n.readAt) && (n.acknowledgedAt > 0 ==> a.acknowledgedAt == n.acknowledgedAt) && (n.escalated ==> a.escalated)
    ensures n.state.Suppressed? ==> exists a :: a in after.notices && a.id == n.id && a.state.Suppressed?
  {
    var k :| 0 <= k < |i.notices| && i.notices[k] == n;
    if n.id == id {
      assert n == notice(i, id);
    }
    assert after.notices[k] in after.notices;
  }
}

lemma SetNoticeProviderUnchanged(i: Inbox, id: int, updated: Notice, after: Inbox, via: string)
  requires alwaysNoticeIdentity(i)
  requires id > 0 && notice(i, id).id == id && updated.id == id
  requires !(updated.state.Delivered? || updated.state.Bounced? || updated.providerSuppressed) || (updated.state == notice(i, id).state && updated.providerSuppressed == notice(i, id).providerSuppressed)
  requires after.notices == setNotice(i, id, updated)
  ensures stepProviderStatesNeedEvidence(i, via, after)
{
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == notice(i, id);
  forall a | a in after.notices && (a.state.Delivered? || a.state.Bounced? || a.providerSuppressed)
    ensures exists b :: b in i.notices && b.id == a.id && b.state == a.state && b.providerSuppressed == a.providerSuppressed
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == a;
    var prev := i.notices[k];
    assert prev in i.notices;
    if prev.id == id {
      assert prev == notice(i, id);
      assert a == updated;
    } else {
      assert a == prev;
    }
  }
}

lemma SetNoticeElementProps(i: Inbox, id: int, updated: Notice, after: Inbox)
  requires alwaysChannelByKind(i) && alwaysAttemptBudget(i) && alwaysSettledHasDigest(i) && alwaysAcknowledgmentOnSecurityNotices(i)
  requires after.clock == i.clock
  requires after.notices == setNotice(i, id, updated)
  requires securityKind(updated.kind) == updated.channel.SecurityOutbox?
  requires updated.essential == (updated.channel.ActivityOutbox? && updated.kind.WalletChanged?)
  requires updated.kind.WalletChanged? ==> updated.channel.ActivityOutbox?
  requires updated.category == categoryOf(updated.kind)
  requires updated.channel.NoEmail? ==> updated.state.NotQueued? && updated.attempts == 0
  requires !updated.channel.NoEmail? ==> !updated.state.NotQueued?
  requires updated.template.CaseTemplate? == updated.kind.SecurityCase?
  requires updated.template.ReceiptTemplate? == updated.kind.SecurityReportReceived?
  requires updated.attempts >= 0 && updated.attempts <= maxAttempts
  requires updated.state.Exhausted? ==> updated.attempts == maxAttempts
  requires updated.state.Retrying? ==> updated.attempts < maxAttempts
  requires updated.state.Sending? ==> updated.attempts > 0 && updated.claimedAt > 0
  requires updated.prepared ==> updated.state.Sending? && updated.digest > 0
  requires (updated.state.Delivered? || updated.state.Bounced? || updated.providerSuppressed || updated.state.ProviderAccepted?) ==> updated.digest > 0
  requires updated.providerSuppressed ==> updated.state.Suppressed?
  requires updated.acknowledgedAt > 0 ==> updated.channel.SecurityOutbox?
  ensures alwaysChannelByKind(after)
  ensures alwaysAttemptBudget(after)
  ensures alwaysSettledHasDigest(after)
  ensures alwaysAcknowledgmentOnSecurityNotices(after)
{
  forall n | n in after.notices
    ensures n in i.notices || n == updated
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    if i.notices[k].id != id {
      assert n == i.notices[k] && i.notices[k] in i.notices;
    }
  }
}

lemma observeEnrollment_ensures(i: Inbox, by_: int, enrollment: backend__email_Enrollment)
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysConfigValid(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysNoticeIdentity(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysChannelByKind(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysOneSnapshotPerRecipient(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysAttemptBudget(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysSettledHasDigest(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysAcknowledgmentOnSecurityNotices(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> alwaysEscalationOnce(observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepNoticesPermanent(i, observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepNoticeFresh(i, observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepConsentNeverQueuesHistory(i, "observeEnrollment", observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepSuppressedStaysSuppressed(i, observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepProviderStatesNeedEvidence(i, "observeEnrollment", observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepEvidenceAppendOnly(i, observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepEvidenceFresh(i, observeEnrollment(i, by_, enrollment)))
  ensures (inv(i) ==> canObserveEnrollment(i, by_, enrollment) ==> stepEscalationOnce(i, observeEnrollment(i, by_, enrollment)))
{
  if inv(i) && canObserveEnrollment(i, by_, enrollment) {
    var after := observeEnrollment(i, by_, enrollment);
    WithSnapshotPreserves(i, enrollment, after);
    SuppressMapIdentity(i, after);
    SuppressMapEscalation(i, after);
    SuppressMapProps(i, after);
    SuppressMapSteps(i, after, "observeEnrollment");
  }
}

lemma closeAccount_ensures(i: Inbox, by_: int, enrollment: backend__email_Enrollment)
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysConfigValid(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysNoticeIdentity(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysChannelByKind(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysOneSnapshotPerRecipient(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysAttemptBudget(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysSettledHasDigest(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysAcknowledgmentOnSecurityNotices(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> alwaysEscalationOnce(closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepNoticesPermanent(i, closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepNoticeFresh(i, closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepConsentNeverQueuesHistory(i, "closeAccount", closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepSuppressedStaysSuppressed(i, closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepProviderStatesNeedEvidence(i, "closeAccount", closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepEvidenceAppendOnly(i, closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepEvidenceFresh(i, closeAccount(i, by_, enrollment)))
  ensures (inv(i) ==> canCloseAccount(i, by_, enrollment) ==> stepEscalationOnce(i, closeAccount(i, by_, enrollment)))
{
  if inv(i) && canCloseAccount(i, by_, enrollment) {
    var after := closeAccount(i, by_, enrollment);
    WithSnapshotPreserves(i, enrollment, after);
    SuppressMapIdentity(i, after);
    SuppressMapEscalation(i, after);
    SuppressMapProps(i, after);
    SuppressMapSteps(i, after, "closeAccount");
  }
}

lemma claim_ensures(i: Inbox, id: int)
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysConfigValid(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysNoticeIdentity(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysChannelByKind(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysOneSnapshotPerRecipient(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysAttemptBudget(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysSettledHasDigest(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysAcknowledgmentOnSecurityNotices(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> alwaysEscalationOnce(claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepNoticesPermanent(i, claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepNoticeFresh(i, claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepConsentNeverQueuesHistory(i, "claim", claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepSuppressedStaysSuppressed(i, claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepProviderStatesNeedEvidence(i, "claim", claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepEvidenceAppendOnly(i, claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepEvidenceFresh(i, claim(i, id)))
  ensures (inv(i) ==> canClaim(i, id) ==> stepEscalationOnce(i, claim(i, id)))
{
  if inv(i) && canClaim(i, id) {
    var after := claim(i, id);
    var n := notice(i, id);
    var updated := n.(state := DeliveryState.Sending, attempts := (n.attempts + 1), claimedAt := i.clock, prepared := false);
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "claim");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma expireClaim_ensures(i: Inbox, id: int)
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysConfigValid(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysNoticeIdentity(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysChannelByKind(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysOneSnapshotPerRecipient(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysAttemptBudget(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysSettledHasDigest(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysAcknowledgmentOnSecurityNotices(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> alwaysEscalationOnce(expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepNoticesPermanent(i, expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepNoticeFresh(i, expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepConsentNeverQueuesHistory(i, "expireClaim", expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepSuppressedStaysSuppressed(i, expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepProviderStatesNeedEvidence(i, "expireClaim", expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepEvidenceAppendOnly(i, expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepEvidenceFresh(i, expireClaim(i, id)))
  ensures (inv(i) ==> canExpireClaim(i, id) ==> stepEscalationOnce(i, expireClaim(i, id)))
{
  if inv(i) && canExpireClaim(i, id) {
    var after := expireClaim(i, id);
    var n := notice(i, id);
    var updated := n.(state := DeliveryState.Ambiguous, prepared := false);
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "expireClaim");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma failPreparation_ensures(i: Inbox, id: int, attempt: int)
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysConfigValid(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysNoticeIdentity(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysChannelByKind(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysOneSnapshotPerRecipient(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysAttemptBudget(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysSettledHasDigest(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysAcknowledgmentOnSecurityNotices(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> alwaysEscalationOnce(failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepNoticesPermanent(i, failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepNoticeFresh(i, failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepConsentNeverQueuesHistory(i, "failPreparation", failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepSuppressedStaysSuppressed(i, failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepProviderStatesNeedEvidence(i, "failPreparation", failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepEvidenceAppendOnly(i, failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepEvidenceFresh(i, failPreparation(i, id, attempt)))
  ensures (inv(i) ==> canFailPreparation(i, id, attempt) ==> stepEscalationOnce(i, failPreparation(i, id, attempt)))
{
  if inv(i) && canFailPreparation(i, id, attempt) {
    var after := failPreparation(i, id, attempt);
    var n := notice(i, id);
    var updated := retried(i, n);
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "failPreparation");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma send_ensures(i: Inbox, id: int, attempt: int, result: ProviderResult)
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysConfigValid(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysNoticeIdentity(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysChannelByKind(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysOneSnapshotPerRecipient(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysAttemptBudget(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysSettledHasDigest(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysAcknowledgmentOnSecurityNotices(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> alwaysEscalationOnce(send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepNoticesPermanent(i, send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepNoticeFresh(i, send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepConsentNeverQueuesHistory(i, "send", send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepSuppressedStaysSuppressed(i, send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepProviderStatesNeedEvidence(i, "send", send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepEvidenceAppendOnly(i, send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepEvidenceFresh(i, send(i, id, attempt, result)))
  ensures (inv(i) ==> canSend(i, id, attempt, result) ==> stepEscalationOnce(i, send(i, id, attempt, result)))
{
  if inv(i) && canSend(i, id, attempt, result) {
    var after := send(i, id, attempt, result);
    var n := notice(i, id);
    var updated := if result.Accepted? then n.(state := DeliveryState.ProviderAccepted, prepared := false) else (if result.QuotaRejected? then retried(i, n) else n.(state := DeliveryState.Ambiguous, prepared := false));
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "send");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma prepare_ensures(i: Inbox, id: int, attempt: int, access: AccessCheck)
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysConfigValid(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysNoticeIdentity(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysChannelByKind(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysOneSnapshotPerRecipient(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysAttemptBudget(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysSettledHasDigest(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysAcknowledgmentOnSecurityNotices(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> alwaysEscalationOnce(prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepNoticesPermanent(i, prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepNoticeFresh(i, prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepConsentNeverQueuesHistory(i, "prepare", prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepSuppressedStaysSuppressed(i, prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepProviderStatesNeedEvidence(i, "prepare", prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepEvidenceAppendOnly(i, prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepEvidenceFresh(i, prepare(i, id, attempt, access)))
  ensures (inv(i) ==> canPrepare(i, id, attempt, access) ==> stepEscalationOnce(i, prepare(i, id, attempt, access)))
{
  if inv(i) && canPrepare(i, id, attempt, access) {
    var after := prepare(i, id, attempt, access);
    var n := notice(i, id);
    var usable := (registered(i, n) && consentHolds(i, n)) || pilotUsable(i, n);
    var updated := if unavailable(access) then retried(i, n) else (if !allowed(access) || !usable then n.(state := DeliveryState.Suppressed) else (if destinationEffectiveAt(i, n) > i.clock then retried(i, n) else n.(prepared := true, digest := destinationDigest(i, n))));
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "prepare");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma reconcile_ensures(i: Inbox, id: int, providerEvidence: ProviderEvidence)
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysConfigValid(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysNoticeIdentity(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysChannelByKind(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysOneSnapshotPerRecipient(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysAttemptBudget(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysSettledHasDigest(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysAcknowledgmentOnSecurityNotices(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> alwaysEscalationOnce(reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepNoticesPermanent(i, reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepNoticeFresh(i, reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepConsentNeverQueuesHistory(i, "reconcile", reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepSuppressedStaysSuppressed(i, reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepProviderStatesNeedEvidence(i, "reconcile", reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepEvidenceAppendOnly(i, reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepEvidenceFresh(i, reconcile(i, id, providerEvidence)))
  ensures (inv(i) ==> canReconcile(i, id, providerEvidence) ==> stepEscalationOnce(i, reconcile(i, id, providerEvidence)))
{
  if inv(i) && canReconcile(i, id, providerEvidence) {
    var after := reconcile(i, id, providerEvidence);
    var n := notice(i, id);
    var finding := providerEvidence.finding;
    var updated := if finding.DeliveredOutcome? then n.(state := DeliveryState.Delivered) else (if finding.BouncedOutcome? then n.(state := DeliveryState.Bounced) else (if finding.SuppressedOutcome? then n.(state := DeliveryState.Suppressed, providerSuppressed := true) else (if n.attempts >= maxAttempts then n.(state := DeliveryState.Exhausted) else n.(state := DeliveryState.Retrying, nextAt := (i.clock + 60000)))));
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma read_ensures(i: Inbox, id: int, by_: int)
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysConfigValid(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysNoticeIdentity(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysChannelByKind(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysOneSnapshotPerRecipient(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysAttemptBudget(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysSettledHasDigest(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysAcknowledgmentOnSecurityNotices(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> alwaysEscalationOnce(read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepNoticesPermanent(i, read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepNoticeFresh(i, read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepConsentNeverQueuesHistory(i, "read", read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepSuppressedStaysSuppressed(i, read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepProviderStatesNeedEvidence(i, "read", read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepEvidenceAppendOnly(i, read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepEvidenceFresh(i, read(i, id, by_)))
  ensures (inv(i) ==> canRead(i, id, by_) ==> stepEscalationOnce(i, read(i, id, by_)))
{
  if inv(i) && canRead(i, id, by_) {
    var after := read(i, id, by_);
    var n := notice(i, id);
    var updated := n.(readAt := i.clock);
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "read");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma acknowledge_ensures(i: Inbox, id: int, by_: int, access: AccessCheck)
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysConfigValid(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysNoticeIdentity(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysChannelByKind(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysOneSnapshotPerRecipient(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysAttemptBudget(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysSettledHasDigest(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysAcknowledgmentOnSecurityNotices(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> alwaysEscalationOnce(acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepNoticesPermanent(i, acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepNoticeFresh(i, acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepConsentNeverQueuesHistory(i, "acknowledge", acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepSuppressedStaysSuppressed(i, acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepProviderStatesNeedEvidence(i, "acknowledge", acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepEvidenceAppendOnly(i, acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepEvidenceFresh(i, acknowledge(i, id, by_, access)))
  ensures (inv(i) ==> canAcknowledge(i, id, by_, access) ==> stepEscalationOnce(i, acknowledge(i, id, by_, access)))
{
  if inv(i) && canAcknowledge(i, id, by_, access) {
    var after := acknowledge(i, id, by_, access);
    var n := notice(i, id);
    var updated := n.(acknowledgedAt := i.clock);
    assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n && n in i.notices;
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    SetNoticeIdentity(i, id, updated, after);
    SetNoticeEscalation(i, id, updated, after);
    SetNoticeSteps(i, id, updated, after);
    SetNoticeProviderUnchanged(i, id, updated, after, "acknowledge");
    SetNoticeElementProps(i, id, updated, after);
  }
}

lemma EscalateIdentity(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck)
  requires alwaysNoticeIdentity(i) && canEscalate(i, id, primaryAccess, backupAccess)
  ensures alwaysNoticeIdentity(escalate(i, id, primaryAccess, backupAccess))
{
  var after := escalate(i, id, primaryAccess, backupAccess);
  var n0 := notice(i, id);
  var updated := n0.(escalated := true);
  var added := newNotice(i, 1000 + id, Kind.SecurityCase, backupOf(i, n0.recipient), id);
  assert after.notices == setNotice(i, id, updated) + [added];
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n0 && n0 in i.notices;
  forall m | m in after.notices
    ensures m.id > 0 && notice(after, m.id) == m
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == m;
    if k < |i.notices| {
      var prev := i.notices[k];
      assert prev in i.notices;
      assert 0 <= prev.id - 1 < |i.notices| && i.notices[prev.id - 1] == prev;
      if prev.id == id {
        assert prev == n0;
        assert after.notices[id - 1] == updated;
      } else {
        assert after.notices[prev.id - 1] == prev;
      }
    } else {
      assert k == |i.notices| && m == added && m.id == |i.notices| + 1;
    }
  }
}

lemma EscalateEscalation(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck)
  requires alwaysNoticeIdentity(i) && alwaysEscalationOnce(i) && canEscalate(i, id, primaryAccess, backupAccess)
  ensures alwaysEscalationOnce(escalate(i, id, primaryAccess, backupAccess))
{
  var after := escalate(i, id, primaryAccess, backupAccess);
  var n0 := notice(i, id);
  var updated := n0.(escalated := true);
  var added := newNotice(i, 1000 + id, Kind.SecurityCase, backupOf(i, n0.recipient), id);
  assert after.notices == setNotice(i, id, updated) + [added];
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n0 && n0 in i.notices;
  forall m | m in after.notices
    ensures m.escalationOf >= 0
    ensures m.escalationOf == 0 ==> m.key > 0 && m.key < 1000
    ensures m.escalationOf > 0 ==> m.kind.SecurityCase? && m.key == 1000 + m.escalationOf && m.escalationOf < m.id && notice(after, m.escalationOf).escalated && notice(after, m.escalationOf).channel.SecurityOutbox? && notice(after, m.escalationOf).escalationOf == 0 && m.recipient > 0 && m.recipient != notice(after, m.escalationOf).recipient && !m.escalated
    ensures m.escalated == (exists e :: e in after.notices && e.escalationOf == m.id)
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == m;
    if k < |i.notices| {
      var prev := i.notices[k];
      assert prev in i.notices;
      if prev.id == id {
        assert prev == n0 && m == updated;
        assert added in after.notices && added.escalationOf == m.id;
      } else {
        assert m == prev;
        if m.escalationOf > 0 {
          assert 0 <= prev.escalationOf - 1 < |i.notices|;
          assert prev.escalationOf != id;
          assert notice(after, m.escalationOf) == notice(i, prev.escalationOf);
        }
        if m.escalated {
          var e :| e in i.notices && e.escalationOf == prev.id;
          var j :| 0 <= j < |i.notices| && i.notices[j] == e;
          assert e.id != id;
          assert after.notices[j] in after.notices && after.notices[j].escalationOf == m.id;
        }
        if exists e :: e in after.notices && e.escalationOf == m.id {
          var e :| e in after.notices && e.escalationOf == m.id;
          var j :| 0 <= j < |after.notices| && after.notices[j] == e;
          assert j < |i.notices|;
          assert i.notices[j] in i.notices;
          if i.notices[j].id == id {
            assert i.notices[j] == n0;
          }
          assert i.notices[j].escalationOf == prev.id;
        }
      }
    } else {
      assert k == |i.notices| && m == added;
      assert notice(after, id) == updated;
      assert added.recipient == backupOf(i, n0.recipient);
      assert added.recipient > 0 && added.recipient != n0.recipient;
      forall e | e in after.notices
        ensures e.escalationOf != added.id
      {
        var j :| 0 <= j < |after.notices| && after.notices[j] == e;
        if j < |i.notices| {
          var prev := i.notices[j];
          assert prev in i.notices;
          assert prev.id <= |i.notices|;
          if prev.id == id {
            assert prev == n0;
          }
          assert e.escalationOf < added.id;
        } else {
          assert e == added && added.escalationOf == id < added.id;
        }
      }
    }
  }
}

lemma EscalateSteps(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck)
  requires alwaysNoticeIdentity(i) && alwaysEscalationOnce(i) && canEscalate(i, id, primaryAccess, backupAccess)
  ensures stepNoticesPermanent(i, escalate(i, id, primaryAccess, backupAccess))
  ensures stepNoticeFresh(i, escalate(i, id, primaryAccess, backupAccess))
  ensures stepSuppressedStaysSuppressed(i, escalate(i, id, primaryAccess, backupAccess))
  ensures stepProviderStatesNeedEvidence(i, "escalate", escalate(i, id, primaryAccess, backupAccess))
{
  var after := escalate(i, id, primaryAccess, backupAccess);
  var n0 := notice(i, id);
  var updated := n0.(escalated := true);
  var added := newNotice(i, 1000 + id, Kind.SecurityCase, backupOf(i, n0.recipient), id);
  assert after.notices == setNotice(i, id, updated) + [added];
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n0 && n0 in i.notices;
  forall m | m in i.notices
    ensures exists a :: a in after.notices && a.id == m.id && a.key == m.key && a.kind == m.kind && a.recipient == m.recipient && a.channel == m.channel && a.createdAt == m.createdAt && a.escalationOf == m.escalationOf && (m.readAt > 0 ==> a.readAt == m.readAt) && (m.acknowledgedAt > 0 ==> a.acknowledgedAt == m.acknowledgedAt) && (m.escalated ==> a.escalated)
    ensures m.state.Suppressed? ==> exists a :: a in after.notices && a.id == m.id && a.state.Suppressed?
  {
    var k :| 0 <= k < |i.notices| && i.notices[k] == m;
    if m.id == id {
      assert m == n0;
    }
    assert after.notices[k] in after.notices;
  }
  forall m | m in i.notices
    ensures !(m.key == added.key && m.recipient == added.recipient)
  {
    if m.escalationOf == 0 {
      assert m.key < 1000 && added.key == 1000 + id > 1000;
    } else {
      assert m.escalationOf > 0 && m.key == 1000 + m.escalationOf;
      if m.key == 1000 + id {
        assert m.escalationOf == id;
        assert notice(i, id).escalated;
      }
    }
  }
  forall a | a in after.notices && (a.state.Delivered? || a.state.Bounced? || a.providerSuppressed)
    ensures exists b :: b in i.notices && b.id == a.id && b.state == a.state && b.providerSuppressed == a.providerSuppressed
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == a;
    assert k < |i.notices|;
    var prev := i.notices[k];
    assert prev in i.notices;
    if prev.id == id {
      assert prev == n0;
    }
  }
}

lemma EscalateProps(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck)
  requires alwaysChannelByKind(i) && alwaysAttemptBudget(i) && alwaysSettledHasDigest(i) && alwaysAcknowledgmentOnSecurityNotices(i)
  requires canEscalate(i, id, primaryAccess, backupAccess)
  ensures alwaysChannelByKind(escalate(i, id, primaryAccess, backupAccess))
  ensures alwaysAttemptBudget(escalate(i, id, primaryAccess, backupAccess))
  ensures alwaysSettledHasDigest(escalate(i, id, primaryAccess, backupAccess))
  ensures alwaysAcknowledgmentOnSecurityNotices(escalate(i, id, primaryAccess, backupAccess))
{
  var after := escalate(i, id, primaryAccess, backupAccess);
  var n0 := notice(i, id);
  var updated := n0.(escalated := true);
  var added := newNotice(i, 1000 + id, Kind.SecurityCase, backupOf(i, n0.recipient), id);
  assert after.notices == setNotice(i, id, updated) + [added];
  assert 0 <= id - 1 < |i.notices| && i.notices[id - 1] == n0 && n0 in i.notices;
  forall m | m in after.notices
    ensures m in i.notices || m == updated || m == added
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == m;
    if k < |i.notices| && i.notices[k].id != id {
      assert m == i.notices[k] && i.notices[k] in i.notices;
    }
  }
}

lemma escalate_ensures(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck)
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysConfigValid(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysNoticeIdentity(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysChannelByKind(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysOneSnapshotPerRecipient(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysAttemptBudget(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysSettledHasDigest(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysAcknowledgmentOnSecurityNotices(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> alwaysEscalationOnce(escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepNoticesPermanent(i, escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepNoticeFresh(i, escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepConsentNeverQueuesHistory(i, "escalate", escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepSuppressedStaysSuppressed(i, escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepProviderStatesNeedEvidence(i, "escalate", escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepEvidenceAppendOnly(i, escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepEvidenceFresh(i, escalate(i, id, primaryAccess, backupAccess)))
  ensures (inv(i) ==> canEscalate(i, id, primaryAccess, backupAccess) ==> stepEscalationOnce(i, escalate(i, id, primaryAccess, backupAccess)))
{
  if inv(i) && canEscalate(i, id, primaryAccess, backupAccess) {
    var after := escalate(i, id, primaryAccess, backupAccess);
    OneSnapshotFilter(i);
    OneSnapshotFilter(after);
    EscalateIdentity(i, id, primaryAccess, backupAccess);
    EscalateEscalation(i, id, primaryAccess, backupAccess);
    EscalateSteps(i, id, primaryAccess, backupAccess);
    EscalateProps(i, id, primaryAccess, backupAccess);
  }
}
