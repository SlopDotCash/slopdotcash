lemma ContAwardInv(s: Continuity)
  requires alwaysAwardRules(s)
  ensures settlement__privateAward_inv(s.award)
{
}

lemma ContAwardRulesFromInv(s: Continuity)
  requires settlement__privateAward_inv(s.award)
  ensures alwaysAwardRules(s)
{
}

lemma ContNotifyFold(inbox: operations__notifications_Inbox, key: int, ts: seq<int>)
  ensures var res := Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, ts);
    res.enrollments == inbox.enrollments
    && |res.notices| >= |inbox.notices|
    && (forall k :: 0 <= k < |inbox.notices| ==> res.notices[k] == inbox.notices[k])
  decreases |ts|
{
  if |ts| > 0 {
    var next := operations__notifications_save(inbox, key, operations__notifications_Kind.SecurityCase, ts[0]);
    ContNotifyFold(next, key, ts[1..]);
  }
}

lemma ContNotifyCaseFrame(inbox: operations__notifications_Inbox, key: int, c: security__cases_PrivateCase)
  ensures settlement__privateAward_notifyCase(inbox, key, c).enrollments == inbox.enrollments
  ensures operations__notifications_stepNoticesPermanent(inbox, settlement__privateAward_notifyCase(inbox, key, c))
{
  var ts := settlement__privateAward_caseRecipients(c);
  ContNotifyFold(inbox, key, ts);
  var res := settlement__privateAward_notifyCase(inbox, key, c);
  forall n | n in inbox.notices ensures exists a :: (a in res.notices && a.id == n.id && a.key == n.key && a.kind == n.kind
    && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf
    && (!(n.readAt > 0) || a.readAt == n.readAt) && (!(n.acknowledgedAt > 0) || a.acknowledgedAt == n.acknowledgedAt)
    && (!n.escalated || a.escalated)) {
    var idx :| 0 <= idx < |inbox.notices| && inbox.notices[idx] == n;
    assert res.notices[idx] == n && n in res.notices;
  }
}

lemma ContEnrollmentFold(init: backend__email_Enrollment, xs: seq<backend__email_Enrollment>, actor: int, target: backend__email_Enrollment)
  requires exists x :: x in xs && x.actor == actor
  requires forall x :: x in xs && x.actor == actor ==> x == target
  ensures Std.Collections.Seq.FoldLeft((found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == actor) then e else found), init, xs) == target
  decreases |xs|
{
  var f := (found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == actor) then e else found);
  var next := f(init, xs[0]);
  if exists x :: x in xs[1..] && x.actor == actor {
    ContEnrollmentFold(next, xs[1..], actor, target);
  } else {
    assert xs[0].actor == actor && next == target;
    ContEnrollmentFoldConst(target, xs[1..], actor);
  }
}

lemma ContEnrollmentFoldConst(cur: backend__email_Enrollment, xs: seq<backend__email_Enrollment>, actor: int)
  requires forall x :: x in xs ==> x.actor != actor
  ensures Std.Collections.Seq.FoldLeft((found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == actor) then e else found), cur, xs) == cur
  decreases |xs|
{
  if |xs| > 0 {
    ContEnrollmentFoldConst(cur, xs[1..], actor);
  }
}

lemma ContCloseInbox(inbox: operations__notifications_Inbox, e: backend__email_Enrollment)
  requires operations__notifications_canCloseAccount(inbox, operations__notifications_accountService, e)
  ensures var after := operations__notifications_closeAccount(inbox, operations__notifications_accountService, e);
    operations__notifications_enrollmentOf(after, e.actor) == e
    && operations__notifications_stepNoticesPermanent(inbox, after)
    && (forall k, r :: operations__notifications_noticeExists(after, k, r) == operations__notifications_noticeExists(inbox, k, r))
    && (operations__notifications_alwaysChannelByKind(inbox) ==> operations__notifications_alwaysChannelByKind(after))
    && ((forall n :: n in inbox.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?) ==>
          (forall n :: n in after.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate?))
{
  var after := operations__notifications_closeAccount(inbox, operations__notifications_accountService, e);
  assert exists x :: x in after.enrollments && x.actor == e.actor by {
    if exists x :: x in inbox.enrollments && x.actor == e.actor {
      var idx :| 0 <= idx < |inbox.enrollments| && inbox.enrollments[idx].actor == e.actor;
      assert after.enrollments[idx] == e && e in after.enrollments;
    } else {
      assert after.enrollments[|inbox.enrollments|] == e && e in after.enrollments;
    }
  }
  assert forall x :: x in after.enrollments && x.actor == e.actor ==> x == e by {
    forall x | x in after.enrollments && x.actor == e.actor ensures x == e {
      if exists y :: y in inbox.enrollments && y.actor == e.actor {
        var idx :| 0 <= idx < |after.enrollments| && after.enrollments[idx] == x;
        assert inbox.enrollments[idx].actor == e.actor;
      } else {
        var idx :| 0 <= idx < |after.enrollments| && after.enrollments[idx] == x;
        if idx < |inbox.enrollments| {
          assert inbox.enrollments[idx] in inbox.enrollments && inbox.enrollments[idx].actor == e.actor;
        }
      }
    }
  }
  ContEnrollmentFold(backend__email_newEnrollment(e.actor, 0), after.enrollments, e.actor, e);
  assert |after.notices| == |inbox.notices|;
  forall n | n in inbox.notices ensures exists a :: (a in after.notices && a.id == n.id && a.key == n.key && a.kind == n.kind
    && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf
    && (!(n.readAt > 0) || a.readAt == n.readAt) && (!(n.acknowledgedAt > 0) || a.acknowledgedAt == n.acknowledgedAt)
    && (!n.escalated || a.escalated)) {
    var idx :| 0 <= idx < |inbox.notices| && inbox.notices[idx] == n;
    assert after.notices[idx] in after.notices;
  }
  forall k, r ensures operations__notifications_noticeExists(after, k, r) == operations__notifications_noticeExists(inbox, k, r) {
    if operations__notifications_noticeExists(after, k, r) {
      var n :| n in after.notices && n.key == k && n.recipient == r;
      var idx :| 0 <= idx < |after.notices| && after.notices[idx] == n;
      assert inbox.notices[idx] in inbox.notices && inbox.notices[idx].key == k && inbox.notices[idx].recipient == r;
    }
    if operations__notifications_noticeExists(inbox, k, r) {
      var n :| n in inbox.notices && n.key == k && n.recipient == r;
      var idx :| 0 <= idx < |inbox.notices| && inbox.notices[idx] == n;
      assert after.notices[idx] in after.notices && after.notices[idx].key == k && after.notices[idx].recipient == r;
    }
  }
  if operations__notifications_alwaysChannelByKind(inbox) {
    forall n | n in after.notices ensures ((operations__notifications_securityKind(n.kind) <==> n.channel.SecurityOutbox?)
      && (n.essential <==> (n.channel.ActivityOutbox? && n.kind.WalletChanged?))
      && (!n.kind.WalletChanged? || n.channel.ActivityOutbox?)
      && n.category == operations__notifications_categoryOf(n.kind)
      && (!n.channel.NoEmail? || (n.state.NotQueued? && n.attempts == 0))
      && (n.channel.NoEmail? || !n.state.NotQueued?)
      && (n.template.CaseTemplate? <==> n.kind.SecurityCase?)
      && (n.template.ReceiptTemplate? <==> n.kind.SecurityReportReceived?)) {
      var idx :| 0 <= idx < |after.notices| && after.notices[idx] == n;
      var orig := inbox.notices[idx];
      assert orig in inbox.notices;
    }
  }
  if forall n :: n in inbox.notices ==> n.kind.SecurityCase? && n.template.CaseTemplate? {
    forall n | n in after.notices ensures n.kind.SecurityCase? && n.template.CaseTemplate? {
      var idx :| 0 <= idx < |after.notices| && after.notices[idx] == n;
      assert inbox.notices[idx] in inbox.notices;
    }
  }
}

lemma ContFilterAllAny<T>(xs: seq<T>)
  ensures forall p: T -> bool, x: T :: x in ProofLib.Filter(p, xs) <==> x in xs && p(x)
  ensures forall p: T -> bool, q: T -> bool :: (forall y :: y in xs ==> p(y) == q(y)) ==> ProofLib.Filter(p, xs) == ProofLib.Filter(q, xs)
{
  forall p: T -> bool, x: T ensures x in ProofLib.Filter(p, xs) <==> x in xs && p(x) {
    ProofLib.FilterMember(p, xs, x);
  }
  forall p: T -> bool, q: T -> bool | (forall y :: y in xs ==> p(y) == q(y)) ensures ProofLib.Filter(p, xs) == ProofLib.Filter(q, xs) {
    ProofLib.FilterSamePredicate(p, q, xs);
  }
}

lemma ContCloseAccounts(a: backend__accounts_Accounts, session: int, confirmation: string)
  requires backend__accounts_alwaysClosedPrivate(a) && backend__accounts_alwaysSessionsBelongToOpenMembers(a)
  requires backend__accounts_alwaysClockShared(a) && backend__accounts_canClose(a, session, confirmation)
  ensures var after := backend__accounts_close(a, session, confirmation);
    backend__accounts_alwaysClosedPrivate(after) && backend__accounts_alwaysSessionsBelongToOpenMembers(after)
    && backend__accounts_alwaysClockShared(after)
{
  var after := backend__accounts_close(a, session, confirmation);
  var act := backend__accounts_senderActor(a, session);
  var m := backend__accounts_memberByActor(a, act);
  assert act > 0;
  ContFilterAllAny(a.sessions);
  ContFilterAllAny(a.members);
  var pS := (x: backend__accounts_Session) => (x.id == session);
  var ss := ProofLib.Filter(pS, a.sessions);
  assert |ss| > 0 by {
    var x :| x in a.sessions && x.id == session && x.expiresAt > a.now;
    assert x in ss;
  }
  assert ss[0] in a.sessions && ss[0].actor == act;
  var om :| om in a.members && om.actor == act && om.membership.Open?;
  var pM := (x: backend__accounts_Member) => (x.actor == act);
  var ms := ProofLib.Filter(pM, a.members);
  assert om in ms && |ms| > 0;
  assert ms[0] in a.members && m == ms[0] && m.actor == act;
  assert a.now > 0;
  assert after.sessions == ProofLib.Filter((x: backend__accounts_Session) => (x.actor != m.actor), a.sessions);
  ProofLib.FilterSubset((x: backend__accounts_Session) => (x.actor != m.actor), a.sessions);
  assert after.xRegistry.flows == ProofLib.Filter((f: backend__xConnection_XFlow) => (f.actor != m.actor), a.xRegistry.flows);
  ProofLib.FilterSubset((f: backend__xConnection_XFlow) => (f.actor != m.actor), a.xRegistry.flows);
  assert backend__accounts_alwaysClosedPrivate(after) by {
    forall mem | mem in after.members ensures if mem.membership.Closed? then
      !mem.public && mem.xLink == backend__xConnection_noLink && !mem.telegramLinked && mem.closedAt > 0
      && !mem.email.preference.activity && !mem.email.preference.security
      && !(exists v :: v in mem.email.verifications && !(v.consumed || v.cancelled))
      && !(exists x :: x in after.sessions && x.actor == mem.actor)
      && !(exists f :: f in after.xRegistry.flows && f.actor == mem.actor)
    else mem.closedAt == 0 {
      var idx :| 0 <= idx < |after.members| && after.members[idx] == mem;
      var orig := a.members[idx];
      assert orig in a.members;
      if orig.actor == m.actor {
        forall x | x in after.sessions ensures x.actor != mem.actor {
          ProofLib.FilterMember((x: backend__accounts_Session) => (x.actor != m.actor), a.sessions, x);
        }
        forall f | f in after.xRegistry.flows ensures f.actor != mem.actor {
          ProofLib.FilterMember((f: backend__xConnection_XFlow) => (f.actor != m.actor), a.xRegistry.flows, f);
        }
      } else {
        assert mem == orig;
        if mem.membership.Closed? {
          forall x | x in after.sessions ensures x.actor != mem.actor {
            assert x in a.sessions;
          }
          forall f | f in after.xRegistry.flows ensures f.actor != mem.actor {
            assert f in a.xRegistry.flows;
          }
        }
      }
    }
  }
  assert backend__accounts_alwaysSessionsBelongToOpenMembers(after) by {
    assert ProofLib.DistinctBy(a.sessions, (x: backend__accounts_Session) => x.id) by {
      forall i, j | 0 <= i < |a.sessions| && 0 <= j < |a.sessions| && i != j ensures a.sessions[i].id != a.sessions[j].id {
        assert a.sessions[i] in a.sessions;
        if a.sessions[i].id == a.sessions[j].id {
          ProofLib.FilterTwo((o: backend__accounts_Session) => (o.id == a.sessions[i].id), a.sessions, i, j);
        }
      }
    }
    ProofLib.FilterKeepsDistinctBy((x: backend__accounts_Session) => (x.actor != m.actor), a.sessions, (x: backend__accounts_Session) => x.id);
    forall x | x in after.sessions ensures x.id > 0 && x.id <= after.lastSession && x.expiresAt <= after.now + backend__accounts_ownerSessionLifetime
      && |ProofLib.Filter((o: backend__accounts_Session) => (o.id == x.id), after.sessions)| == 1
      && (exists mem :: mem in after.members && mem.actor == x.actor && mem.membership.Open?) {
      ProofLib.FilterMember((x: backend__accounts_Session) => (x.actor != m.actor), a.sessions, x);
      var i :| 0 <= i < |after.sessions| && after.sessions[i] == x;
      ProofLib.FilterOne((o: backend__accounts_Session) => (o.id == x.id), after.sessions, i);
      var origM :| origM in a.members && origM.actor == x.actor && origM.membership.Open?;
      var midx :| 0 <= midx < |a.members| && a.members[midx] == origM;
      assert origM.actor != m.actor && after.members[midx] == origM && origM in after.members;
    }
  }
}

lemma closeReporter_ensures(s: Continuity, by_: int, session: int, confirmation: string)
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> alwaysAccountRules(closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> alwaysInboxConsentFollowsEnrollment(closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> alwaysClosedReporterWithdrawsConsent(closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> alwaysReservedAwardCanNotifyPaid(closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> alwaysAwardRules(closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> stepClosureKeepsObligations(s, "closeReporter", closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> stepNoticesPermanent(s, closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> stepRolesKeepCommitments(s, "closeReporter", closeReporter(s, by_, session, confirmation)))
  ensures (inv(s) ==> canCloseReporter(s, by_, session, confirmation) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "closeReporter", closeReporter(s, by_, session, confirmation)))
{
  if inv(s) && canCloseReporter(s, by_, session, confirmation) {
    ContCloseAccounts(s.accounts, session, confirmation);
    ContCloseInbox(s.award.inbox, reporterClosure(s));
  }
}

lemma replaceRoles_ensures(s: Continuity, snapshot: security__cases_Authority)
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> alwaysAccountRules(replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> alwaysInboxConsentFollowsEnrollment(replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> alwaysClosedReporterWithdrawsConsent(replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> alwaysReservedAwardCanNotifyPaid(replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> alwaysAwardRules(replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> stepClosureKeepsObligations(s, "replaceRoles", replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> stepNoticesPermanent(s, replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> stepRolesKeepCommitments(s, "replaceRoles", replaceRoles(s, snapshot)))
  ensures (inv(s) ==> canReplaceRoles(s, snapshot) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "replaceRoles", replaceRoles(s, snapshot)))
{
  hide *;
  if inv(s) && canReplaceRoles(s, snapshot) {
    reveal inv, canReplaceRoles, replaceRoles, withAward, realActors, settlement__privateAward_observeAuthority, settlement__privateAward_withBounty, settlement__privateAward_caseOf, security__bounty_observeAuthority, security__bounty_caseOf, security__bounty_caseIds, security__bounty_known, security__cases_observeAuthority;
    ContAwardInv(s);
    settlement__privateAward_observeAuthority_ensures(s.award, snapshot);
    var after := replaceRoles(s, snapshot);
    ContAwardRulesFromInv(after);
    assert alwaysAccountRules(after) && alwaysInboxConsentFollowsEnrollment(after) && alwaysClosedReporterWithdrawsConsent(after) by {
      reveal alwaysAccountRules, alwaysInboxConsentFollowsEnrollment, alwaysClosedReporterWithdrawsConsent, caseReporter, reporterMember, reporterClosed;
    }
    assert alwaysReservedAwardCanNotifyPaid(after) by {
      reveal alwaysReservedAwardCanNotifyPaid, settlement__privateAward_recipientsValid, settlement__privateAward_caseRecipients, settlement__privateAward_noticeKey, settlement__privateAward_noticeCode, operations__notifications_canSave;
    }
    assert stepClosureKeepsObligations(s, "replaceRoles", after) && stepNoticesPermanent(s, after) && stepRolesKeepCommitments(s, "replaceRoles", after) by {
      reveal stepClosureKeepsObligations, stepNoticesPermanent, stepRolesKeepCommitments, operations__notifications_stepNoticesPermanent;
    }
    assert stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "replaceRoles", after) by {
      reveal stepReplacedReviewerReadsOnlyUnderCurrentRole, reviewersOf, readsUnderCurrentRole, security__cases_mayReadBody, security__cases_technicalNow, security__cases_triagerNow, security__cases_moderatorNow;
    }
  }
}

lemma ContOpenVaultGrossFoldEq(holds: seq<security__bounty_Hold>, init: settlement__money_Amount, b1: security__bounty_Bounty, b2: security__bounty_Bounty)
  requires forall h :: h in holds ==> security__bounty_caseOf(b1, h.caseId).grossChosen == security__bounty_caseOf(b2, h.caseId).grossChosen
  ensures Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(b1, h.caseId).grossChosen) else total), init, holds)
    == Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, h: security__bounty_Hold) => (if (h.kind.VaultHold? && (h.settledReceipt == 0)) then settlement__money_addAmounts(total, security__bounty_caseOf(b2, h.caseId).grossChosen) else total), init, holds)
  decreases |holds|
{
  if |holds| > 0 {
    assert holds[0] in holds;
    assert forall h :: h in holds[1..] ==> h in holds;
    var next := if holds[0].kind.VaultHold? && holds[0].settledReceipt == 0 then settlement__money_addAmounts(init, security__bounty_caseOf(b1, holds[0].caseId).grossChosen) else init;
    ContOpenVaultGrossFoldEq(holds[1..], next, b1, b2);
  }
}

lemma ContOpenVaultGrossEq(b1: security__bounty_Bounty, b2: security__bounty_Bounty)
  requires b1.holds == b2.holds
  requires forall h :: h in b1.holds ==> security__bounty_caseOf(b1, h.caseId).grossChosen == security__bounty_caseOf(b2, h.caseId).grossChosen
  ensures security__bounty_openVaultGross(b1) == security__bounty_openVaultGross(b2)
{
  ContOpenVaultGrossFoldEq(b1.holds, settlement__money_zero, b1, b2);
}

lemma ContAlwaysOneHold(b1: security__bounty_Bounty, b2: security__bounty_Bounty)
  requires b1.holds == b2.holds
  requires security__bounty_alwaysOneHoldPerRootCause(b1)
  ensures security__bounty_alwaysOneHoldPerRootCause(b2)
{
}

lemma ContSignedOldInv()
  ensures backend__accounts_inv(backend__accounts_signedOld)
  ensures |backend__accounts_signedOld.members| == 1 && backend__accounts_signedOld.members[0].actor == 1101 && backend__accounts_signedOld.members[0].membership.Open?
{
  backend__accounts_initialHolds_ensures();
  var s0 := backend__accounts_initial;
  ContFilterAllAny(s0.identity.assertions);
  ContFilterAllAny(s0.members);
  var pA := (a: backend__identity_Assertion) => (a.token == 1);
  ProofLib.FilterCons(pA, s0.identity.assertions);
  var pM := (m: backend__accounts_Member) => (m.githubId == 11);
  ProofLib.FilterCons(pM, s0.members);
  ProofLib.FilterNil(pM, s0.members[1..]);
  assert backend__accounts_canSignIn(s0, 1);
  backend__accounts_signIn_ensures(s0, 1);
}

lemma assignTriager_ensures(s: Continuity, id: int, by_: int, checkedEpoch: int, actor: int)
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> alwaysAccountRules(assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> alwaysInboxConsentFollowsEnrollment(assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> alwaysClosedReporterWithdrawsConsent(assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> alwaysReservedAwardCanNotifyPaid(assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> alwaysAwardRules(assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> stepClosureKeepsObligations(s, "assignTriager", assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> stepNoticesPermanent(s, assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> stepRolesKeepCommitments(s, "assignTriager", assignTriager(s, id, by_, checkedEpoch, actor)))
  ensures (inv(s) ==> canAssignTriager(s, id, by_, checkedEpoch, actor) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "assignTriager", assignTriager(s, id, by_, checkedEpoch, actor)))
{
  hide *;
  if inv(s) && canAssignTriager(s, id, by_, checkedEpoch, actor) {
    reveal inv, canAssignTriager, assignTriager, withAward, settlement__privateAward_withBounty, settlement__privateAward_caseOf, security__bounty_putCase, security__bounty_caseOf, security__bounty_caseIds, security__bounty_known, security__cases_canAssignTriager, security__cases_assignTriager;
    var after := assignTriager(s, id, by_, checkedEpoch, actor);
    assert alwaysAccountRules(after) && alwaysInboxConsentFollowsEnrollment(after) && alwaysClosedReporterWithdrawsConsent(after) by {
      reveal alwaysAccountRules, alwaysInboxConsentFollowsEnrollment, alwaysClosedReporterWithdrawsConsent, caseReporter, reporterMember, reporterClosed;
    }
    assert alwaysReservedAwardCanNotifyPaid(after) by {
      reveal alwaysReservedAwardCanNotifyPaid, realActors, settlement__privateAward_recipientsValid, settlement__privateAward_caseRecipients;
    }
    assert stepClosureKeepsObligations(s, "assignTriager", after) && stepNoticesPermanent(s, after) && stepRolesKeepCommitments(s, "assignTriager", after) && stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "assignTriager", after) by {
      reveal stepClosureKeepsObligations, stepNoticesPermanent, stepRolesKeepCommitments, stepReplacedReviewerReadsOnlyUnderCurrentRole, operations__notifications_stepNoticesPermanent;
    }
    assert security__bounty_alwaysHoldsMatchCases(after.award.bounty) by {
      reveal alwaysAwardRules, settlement__privateAward_alwaysHoldsKeepCaseRules, security__bounty_alwaysHoldsMatchCases, security__bounty_holdMatches, security__bounty_hasHold, security__cases_committed;
      forall h | h in after.award.bounty.holds ensures security__bounty_holdMatches(after.award.bounty, h) {
        assert h in s.award.bounty.holds;
        assert security__bounty_holdMatches(s.award.bounty, h);
      }
    }
    assert security__bounty_alwaysCasesKeepAwardRules(after.award.bounty) by {
      reveal alwaysAwardRules, settlement__privateAward_alwaysHoldsKeepCaseRules, security__bounty_alwaysCasesKeepAwardRules, security__cases_alwaysProposalCommitsNothing, security__cases_alwaysCommitmentMatchesAward, security__cases_alwaysFullAwardHeld, security__cases_alwaysStandardAwardRail, security__cases_alwaysUnpaidHasNoAward, security__cases_alwaysVerifiedReceiptValid, security__cases_alwaysUnreceivedBlank, security__cases_alwaysConfirmedHasRootCause, security__cases_alwaysAppealState, security__cases_alwaysAppealSource, security__cases_alwaysCommittedFindingStands, security__cases_receiptOpen, security__cases_committed;
    }
    assert security__bounty_alwaysReservedIsOpenVaultHolds(after.award.bounty) by {
      reveal alwaysAwardRules, settlement__privateAward_alwaysHoldsKeepCaseRules, security__bounty_alwaysReservedIsOpenVaultHolds;
      ContOpenVaultGrossEq(s.award.bounty, after.award.bounty);
    }
    assert security__bounty_alwaysOneHoldPerRootCause(after.award.bounty) && security__bounty_alwaysFullAwardBindsNoVault(after.award.bounty) by {
      reveal alwaysAwardRules, settlement__privateAward_alwaysHoldsKeepCaseRules, security__bounty_alwaysFullAwardBindsNoVault;
      ContAlwaysOneHold(s.award.bounty, after.award.bounty);
    }
    assert settlement__privateAward_alwaysHoldsKeepCaseRules(after.award) by {
      reveal settlement__privateAward_alwaysHoldsKeepCaseRules;
    }
    assert alwaysAwardRules(after) by {
      reveal alwaysAwardRules, settlement__privateAward_alwaysVaultAwardReserved, settlement__privateAward_alwaysPaidNotified, settlement__privateAward_alwaysFundsSnapshotObserved, settlement__privateAward_alwaysCaseRevisionsCounted, settlement__privateAward_alwaysVaultTargetMatchesAward, settlement__privateAward_alwaysBountyReserveIsVaultReserve, settlement__privateAward_alwaysBountyCoverIsVaultFree, settlement__privateAward_alwaysCoverAmountsValid, settlement__privateAward_alwaysDirectJournalBound, settlement__privateAward_alwaysNothingAuthorizedBeforeAdmission, settlement__privateAward_alwaysShownAmountsExact, settlement__privateAward_alwaysCommittedWithinTerms, settlement__privateAward_alwaysShownCaseReceived, settlement__privateAward_alwaysAwardNoticesArePrivateCaseNotices, settlement__privateAward_alwaysCommitmentNotified, settlement__privateAward_alwaysPaidNoticeOnlyWhenPaid, settlement__privateAward_directCaseOf, settlement__privateAward_vaultHold, settlement__privateAward_directHold, settlement__privateAward_awardTarget, settlement__privateAward_typed0_settlement__privateAward, security__bounty_alwaysFundsObserved, security__cases_alwaysApprovedWithinTerms, security__cases_committed;
    }
  }
}

lemma observeFunds_ensures(s: Continuity, observedAt: int)
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysAccountRules(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysInboxConsentFollowsEnrollment(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysClosedReporterWithdrawsConsent(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysReservedAwardCanNotifyPaid(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> alwaysAwardRules(observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepClosureKeepsObligations(s, "observeFunds", observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepNoticesPermanent(s, observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepRolesKeepCommitments(s, "observeFunds", observeFunds(s, observedAt)))
  ensures (inv(s) ==> canObserveFunds(s, observedAt) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "observeFunds", observeFunds(s, observedAt)))
{
  if inv(s) && canObserveFunds(s, observedAt) {
    ContAwardInv(s);
    settlement__privateAward_observeFunds_ensures(s.award, observedAt);
    ContAwardRulesFromInv(observeFunds(s, observedAt));
  }
}

lemma receive_ensures(s: Continuity, id: int, source: security__cases_ReceiptSource, terms: security__terms_ReceiptTerms, reportVersion: int)
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysAccountRules(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysInboxConsentFollowsEnrollment(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysClosedReporterWithdrawsConsent(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysReservedAwardCanNotifyPaid(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> alwaysAwardRules(receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepClosureKeepsObligations(s, "receive", receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepNoticesPermanent(s, receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepRolesKeepCommitments(s, "receive", receive(s, id, source, terms, reportVersion)))
  ensures (inv(s) ==> canReceive(s, id, source, terms, reportVersion) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "receive", receive(s, id, source, terms, reportVersion)))
{
  if inv(s) && canReceive(s, id, source, terms, reportVersion) {
    ContAwardInv(s);
    settlement__privateAward_receive_ensures(s.award, id, source, terms, reportVersion);
    ContAwardRulesFromInv(receive(s, id, source, terms, reportVersion));
  }
}

lemma decide_ensures(s: Continuity, id: int, by_: int, checkedEpoch: int, version: int, decision: security__cases_Decision)
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysAccountRules(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysInboxConsentFollowsEnrollment(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysClosedReporterWithdrawsConsent(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysReservedAwardCanNotifyPaid(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> alwaysAwardRules(decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepClosureKeepsObligations(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepNoticesPermanent(s, decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepRolesKeepCommitments(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
  ensures (inv(s) ==> canDecide(s, id, by_, checkedEpoch, version, decision) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "decide", decide(s, id, by_, checkedEpoch, version, decision)))
{
  if inv(s) && canDecide(s, id, by_, checkedEpoch, version, decision) {
    ContAwardInv(s);
    settlement__privateAward_decide_ensures(s.award, id, by_, checkedEpoch, version, decision);
    ContAwardRulesFromInv(decide(s, id, by_, checkedEpoch, version, decision));
  }
}

lemma showAmounts_ensures(s: Continuity, id: int, by_: int, checkedEpoch: int, gross: seq<int>)
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysAccountRules(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysInboxConsentFollowsEnrollment(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysClosedReporterWithdrawsConsent(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysReservedAwardCanNotifyPaid(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> alwaysAwardRules(showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepClosureKeepsObligations(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepNoticesPermanent(s, showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepRolesKeepCommitments(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
  ensures (inv(s) ==> canShowAmounts(s, id, by_, checkedEpoch, gross) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "showAmounts", showAmounts(s, id, by_, checkedEpoch, gross)))
{
  if inv(s) && canShowAmounts(s, id, by_, checkedEpoch, gross) {
    ContAwardInv(s);
    settlement__privateAward_showAmounts_ensures(s.award, id, by_, checkedEpoch, gross);
    ContAwardRulesFromInv(showAmounts(s, id, by_, checkedEpoch, gross));
  }
}

lemma decideAward_ensures(s: Continuity, id: int, by_: int, checkedEpoch: int, amount: seq<int>)
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysAccountRules(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysInboxConsentFollowsEnrollment(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysClosedReporterWithdrawsConsent(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysReservedAwardCanNotifyPaid(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> alwaysAwardRules(decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepClosureKeepsObligations(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepNoticesPermanent(s, decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepRolesKeepCommitments(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
  ensures (inv(s) ==> canDecideAward(s, id, by_, checkedEpoch, amount) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "decideAward", decideAward(s, id, by_, checkedEpoch, amount)))
{
  hide *;
  if inv(s) && canDecideAward(s, id, by_, checkedEpoch, amount) {
    reveal inv, canDecideAward, decideAward, withAward, settlement__privateAward_canDecideAward, settlement__privateAward_decideAward, settlement__privateAward_withCommitment, settlement__privateAward_withBounty, settlement__privateAward_withSettlement, settlement__privateAward_withDirect, settlement__privateAward_withInbox, settlement__privateAward_caseOf, security__bounty_canDecideAward, security__bounty_decideAward, security__bounty_withHold, security__bounty_putCase, security__bounty_caseOf, security__bounty_caseIds, security__bounty_known, security__cases_decideAward, security__cases_committedWith, security__cases_committed;
    ContAwardInv(s);
    settlement__privateAward_decideAward_ensures(s.award, id, by_, checkedEpoch, amount);
    var after := decideAward(s, id, by_, checkedEpoch, amount);
    ContAwardRulesFromInv(after);
    var bAfter := security__bounty_decideAward(s.award.bounty, id, by_, checkedEpoch, amount);
    var cAfter := security__bounty_caseOf(bAfter, id);
    if security__cases_committed(cAfter) && !security__cases_committed(settlement__privateAward_caseOf(s.award, id)) {
      ContNotifyCaseFrame(s.award.inbox, settlement__privateAward_noticeKey(settlement__privateAward_AwardNotice.AwardCommitted, id), cAfter);
    }
    assert alwaysAccountRules(after) && alwaysInboxConsentFollowsEnrollment(after) && alwaysClosedReporterWithdrawsConsent(after) by {
      reveal alwaysAccountRules, alwaysInboxConsentFollowsEnrollment, alwaysClosedReporterWithdrawsConsent, caseReporter, reporterMember, reporterClosed, operations__notifications_enrollmentOf;
    }
    assert alwaysReservedAwardCanNotifyPaid(after) by {
      reveal alwaysReservedAwardCanNotifyPaid, realActors, settlement__privateAward_recipientsValid, settlement__privateAward_caseRecipients, settlement__privateAward_noticeKey, settlement__privateAward_noticeCode, operations__notifications_canSave;
    }
    assert stepClosureKeepsObligations(s, "decideAward", after) && stepNoticesPermanent(s, after) && stepRolesKeepCommitments(s, "decideAward", after) && stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "decideAward", after) by {
      reveal stepClosureKeepsObligations, stepNoticesPermanent, stepRolesKeepCommitments, stepReplacedReviewerReadsOnlyUnderCurrentRole, operations__notifications_stepNoticesPermanent;
    }
  }
}

lemma updateDelivery_ensures(s: Continuity, update: settlement__composition_DeliveryUpdate)
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysAccountRules(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysInboxConsentFollowsEnrollment(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysClosedReporterWithdrawsConsent(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysReservedAwardCanNotifyPaid(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> alwaysAwardRules(updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> stepClosureKeepsObligations(s, "updateDelivery", updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> stepNoticesPermanent(s, updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> stepRolesKeepCommitments(s, "updateDelivery", updateDelivery(s, update)))
  ensures (inv(s) ==> canUpdateDelivery(s, update) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "updateDelivery", updateDelivery(s, update)))
{
  if inv(s) && canUpdateDelivery(s, update) {
    ContAwardInv(s);
    settlement__privateAward_updateDelivery_ensures(s.award, update);
    ContAwardRulesFromInv(updateDelivery(s, update));
  }
}

lemma reconcile_ensures(s: Continuity, evidence: settlement__composition_FinalizedPayment)
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysAccountRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysInboxConsentFollowsEnrollment(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysClosedReporterWithdrawsConsent(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysReservedAwardCanNotifyPaid(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> alwaysAwardRules(reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepClosureKeepsObligations(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepNoticesPermanent(s, reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepRolesKeepCommitments(s, "reconcile", reconcile(s, evidence)))
  ensures (inv(s) ==> canReconcile(s, evidence) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "reconcile", reconcile(s, evidence)))
{
  if inv(s) && canReconcile(s, evidence) {
    ContAwardInv(s);
    settlement__privateAward_reconcile_ensures(s.award, evidence);
    ContAwardRulesFromInv(reconcile(s, evidence));
    ContNotifyCaseFrame(s.award.inbox, settlement__privateAward_noticeKey(settlement__privateAward_AwardNotice.AwardPaid, s.award.vaultCase), settlement__privateAward_caseOf(s.award, s.award.vaultCase));
  }
}

lemma deposit_ensures(s: Continuity, amount: seq<int>, asset: string, receipt: int, finalized: bool)
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysAccountRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysInboxConsentFollowsEnrollment(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysClosedReporterWithdrawsConsent(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysReservedAwardCanNotifyPaid(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> alwaysAwardRules(deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepClosureKeepsObligations(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepNoticesPermanent(s, deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepRolesKeepCommitments(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
  ensures (inv(s) ==> canDeposit(s, amount, asset, receipt, finalized) ==> stepReplacedReviewerReadsOnlyUnderCurrentRole(s, "deposit", deposit(s, amount, asset, receipt, finalized)))
{
  if inv(s) && canDeposit(s, amount, asset, receipt, finalized) {
    ContAwardInv(s);
    settlement__privateAward_deposit_ensures(s.award, amount, asset, receipt, finalized);
    ContAwardRulesFromInv(deposit(s, amount, asset, receipt, finalized));
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  hide *;
  reveal inv, initialHolds, initial, startingContinuity, consentedInbox, consentedAccounts, consentedEmail, settlement__privateAward_withInbox, settlement__privateAward_startingAward, settlement__privateAward_initialHolds, backend__accounts_initialHolds;
  settlement__privateAward_initialHolds_ensures();
  ContSignedOldInv();
  assert alwaysAwardRules(initial) by {
    reveal alwaysAwardRules, settlement__privateAward_inv, settlement__privateAward_initial, settlement__privateAward_alwaysVaultAwardReserved, settlement__privateAward_alwaysPaidNotified, settlement__privateAward_alwaysHoldsKeepCaseRules, settlement__privateAward_alwaysFundsSnapshotObserved, settlement__privateAward_alwaysCaseRevisionsCounted, settlement__privateAward_alwaysVaultTargetMatchesAward, settlement__privateAward_alwaysBountyReserveIsVaultReserve, settlement__privateAward_alwaysBountyCoverIsVaultFree, settlement__privateAward_alwaysCoverAmountsValid, settlement__privateAward_alwaysDirectJournalBound, settlement__privateAward_alwaysNothingAuthorizedBeforeAdmission, settlement__privateAward_alwaysShownAmountsExact, settlement__privateAward_alwaysCommittedWithinTerms, settlement__privateAward_alwaysShownCaseReceived, settlement__privateAward_alwaysAwardNoticesArePrivateCaseNotices, settlement__privateAward_alwaysCommitmentNotified, settlement__privateAward_alwaysPaidNoticeOnlyWhenPaid, settlement__privateAward_caseOf, settlement__privateAward_directCaseOf, operations__notifications_observeEnrollment, operations__notifications_withSnapshot, operations__notifications_accountService, operations__notifications_initial, operations__notifications_alwaysChannelByKind, operations__notifications_noticeExists;
    assert consentedInbox.notices == [];
    assert settlement__privateAward_initial.inbox.notices == [];
    assert forall k, r :: operations__notifications_noticeExists(consentedInbox, k, r) == operations__notifications_noticeExists(settlement__privateAward_initial.inbox, k, r);
  }
  assert alwaysReservedAwardCanNotifyPaid(initial) by {
    reveal alwaysReservedAwardCanNotifyPaid, realActors, settlement__privateAward_initial, settlement__privateAward_caseOf, security__bounty_initial, security__bounty_caseOf, security__bounty_caseIds, security__bounty_known, security__cases_initial, security__cases_noAuthority;
  }
  assert alwaysAccountRules(initial) by {
    reveal alwaysAccountRules, backend__accounts_inv, backend__accounts_memberByActor, backend__accounts_withEmail, backend__accounts_replaceMember, backend__accounts_alwaysClosedPrivate, backend__accounts_alwaysSessionsBelongToOpenMembers, backend__accounts_alwaysClockShared, backend__xConnection_noLink, sampleAccount, typed0_security__continuity, ProofLib.Filter;
    ContFilterAllAny(backend__accounts_signedOld.members);
    var pM := (m: backend__accounts_Member) => (m.actor == 1101);
    var msOld := ProofLib.Filter(pM, backend__accounts_signedOld.members);
    assert backend__accounts_signedOld.members[0] in backend__accounts_signedOld.members;
    assert backend__accounts_signedOld.members[0] in msOld;
    assert |msOld| > 0 && msOld[0] in backend__accounts_signedOld.members;
    assert sampleAccount == backend__accounts_signedOld.members[0];
    assert sampleAccount.membership.Open? && sampleAccount.closedAt == 0;
    assert |consentedAccounts.members| == |backend__accounts_signedOld.members|;
    forall m | m in consentedAccounts.members ensures if m.membership.Closed? then
      !m.public && m.xLink == backend__xConnection_noLink && !m.telegramLinked && m.closedAt > 0
      && !m.email.preference.activity && !m.email.preference.security
      && !(exists v :: v in m.email.verifications && !(v.consumed || v.cancelled))
      && !(exists x :: x in consentedAccounts.sessions && x.actor == m.actor)
      && !(exists f :: f in consentedAccounts.xRegistry.flows && f.actor == m.actor)
    else m.closedAt == 0 {
      var idx :| 0 <= idx < |consentedAccounts.members| && consentedAccounts.members[idx] == m;
      assert idx == 0;
    }
    forall x | x in consentedAccounts.sessions ensures exists m :: m in consentedAccounts.members && m.actor == x.actor && m.membership.Open? {
      assert x in backend__accounts_signedOld.sessions;
      var origM :| origM in backend__accounts_signedOld.members && origM.actor == x.actor && origM.membership.Open?;
      var midx :| 0 <= midx < |backend__accounts_signedOld.members| && backend__accounts_signedOld.members[midx] == origM;
      assert consentedAccounts.members[midx] in consentedAccounts.members && consentedAccounts.members[midx].actor == x.actor && consentedAccounts.members[midx].membership.Open?;
    }
  }
  assert alwaysInboxConsentFollowsEnrollment(initial) && alwaysClosedReporterWithdrawsConsent(initial) by {
    reveal alwaysInboxConsentFollowsEnrollment, alwaysClosedReporterWithdrawsConsent, caseReporter, reporterMember, reporterClosed, settlement__privateAward_initial, settlement__privateAward_caseOf, security__bounty_initial, security__bounty_caseOf, security__cases_initial, operations__notifications_observeEnrollment, operations__notifications_withSnapshot, operations__notifications_accountService, operations__notifications_initial, operations__notifications_enrollmentOf, backend__accounts_memberByActor, backend__accounts_withEmail, backend__accounts_replaceMember, sampleAccount, typed0_security__continuity, Std.Collections.Seq.FoldLeft, ProofLib.Filter;
    assert consentedInbox.enrollments == [consentedEmail.(actor := 1)];
    ContEnrollmentFold(backend__email_newEnrollment(1, 0), consentedInbox.enrollments, 1, consentedEmail.(actor := 1));
    assert operations__notifications_enrollmentOf(consentedInbox, 1) == consentedEmail.(actor := 1);
    ContFilterAllAny(consentedAccounts.members);
    ContFilterAllAny(backend__accounts_signedOld.members);
    var pM := (m: backend__accounts_Member) => (m.actor == 1101);
    var ms := ProofLib.Filter(pM, consentedAccounts.members);
    var msOld := ProofLib.Filter(pM, backend__accounts_signedOld.members);
    ProofLib.FilterPointwise(pM, pM,
      (a: backend__accounts_Member, b: backend__accounts_Member) => b.actor == a.actor && b.membership == a.membership && (a.actor == 1101 ==> b.email == consentedEmail),
      backend__accounts_signedOld.members, consentedAccounts.members);
    assert |msOld| > 0 by {
      var m0 := backend__accounts_signedOld.members[0];
      assert m0 in backend__accounts_signedOld.members && m0.actor == 1101;
      assert m0 in msOld;
    }
    assert msOld[0] in backend__accounts_signedOld.members;
    assert reporterMember(initial).email == consentedEmail;
    assert reporterMember(initial).membership.Open?;
  }
}
