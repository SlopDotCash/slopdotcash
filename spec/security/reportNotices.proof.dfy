lemma RNNoticeCodeMod(notice: ReportNotice, id: int)
  requires id >= 0
  ensures quotient_security__reportNotices(noticeKey(notice, id), 10) == id
  ensures remainder_security__reportNotices(noticeKey(notice, id), 10) == noticeCode(notice)
{
  var k := noticeKey(notice, id);
  var c := noticeCode(notice);
  assert c == 1 || c == 2 || c == 3;
  assert k == 10 * id + c && k >= 0;
  assert MathAbs(k) == k && MathAbs(10) == 10;
  assert JSFloorDiv(k, 10) == id;
  assert quotient_security__reportNotices(k, 10) == id;
  assert remainder_security__reportNotices(k, 10) == c;
}

lemma RNRouteSaveStep(inbox: operations__notifications_Inbox, key: int, t: int, version: int, reporter: int)
  requires operations__notifications_alwaysChannelByKind(inbox)
  requires operations__notifications_alwaysNoticeIdentity(inbox)
  requires forall n :: n in inbox.notices ==> n.kind.SecurityReportReceived? || n.kind.SecurityCase?
  requires operations__notifications_canSave(inbox, key, operations__notifications_Kind.SecurityCase, t)
  requires key == routeKey(version) && version >= 1 && t != reporter
  ensures var after := operations__notifications_save(inbox, key, operations__notifications_Kind.SecurityCase, t);
    operations__notifications_alwaysChannelByKind(after)
    && operations__notifications_alwaysNoticeIdentity(after)
    && (forall n :: n in after.notices ==> n.kind.SecurityReportReceived? || n.kind.SecurityCase?)
    && operations__notifications_stepNoticesPermanent(inbox, after)
    && (forall n :: n in after.notices && n !in inbox.notices ==>
      n.kind.SecurityCase? && n.key == key && n.recipient == t)
{
  hide *;
  reveal operations__notifications_save, operations__notifications_newNotice, operations__notifications_canSave, operations__notifications_alwaysChannelByKind, operations__notifications_alwaysNoticeIdentity, operations__notifications_stepNoticesPermanent, operations__notifications_notice, operations__notifications_noNotice, operations__notifications_securityKind, operations__notifications_categoryOf, operations__notifications_noticeExists;
  var after := operations__notifications_save(inbox, key, operations__notifications_Kind.SecurityCase, t);
  if !operations__notifications_noticeExists(inbox, key, t) {
    var added := operations__notifications_newNotice(inbox, key, operations__notifications_Kind.SecurityCase, t, 0);
    assert after.notices == inbox.notices + [added];
    assert added.id == |inbox.notices| + 1;
    assert operations__notifications_notice(after, added.id) == added;
    forall n | n in inbox.notices ensures n.id > 0 && operations__notifications_notice(after, n.id) == n {
      assert operations__notifications_notice(inbox, n.id) == n;
      assert 1 <= n.id <= |inbox.notices|;
      assert after.notices[n.id - 1] == inbox.notices[n.id - 1];
    }
    forall n | n in inbox.notices ensures exists a :: (a in after.notices && a.id == n.id && a.key == n.key && a.kind == n.kind
      && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf
      && (!(n.readAt > 0) || a.readAt == n.readAt) && (!(n.acknowledgedAt > 0) || a.acknowledgedAt == n.acknowledgedAt)
      && (!n.escalated || a.escalated))
    {
      assert n in after.notices;
    }
  }
}

lemma RNRouteFold(inbox: operations__notifications_Inbox, key: int, ts: seq<int>, version: int, reporter: int)
  requires operations__notifications_alwaysChannelByKind(inbox)
  requires operations__notifications_alwaysNoticeIdentity(inbox)
  requires forall n :: n in inbox.notices ==> n.kind.SecurityReportReceived? || n.kind.SecurityCase?
  requires forall t :: t in ts ==> operations__notifications_canSave(inbox, key, operations__notifications_Kind.SecurityCase, t) && t != reporter
  requires key == routeKey(version) && version >= 1
  ensures var res := Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), inbox, ts);
    operations__notifications_alwaysChannelByKind(res)
    && operations__notifications_alwaysNoticeIdentity(res)
    && (forall n :: n in res.notices ==> n.kind.SecurityReportReceived? || n.kind.SecurityCase?)
    && operations__notifications_stepNoticesPermanent(inbox, res)
    && (forall n :: n in inbox.notices ==> n in res.notices)
    && (forall n :: n in res.notices && n !in inbox.notices ==>
      n.kind.SecurityCase? && n.key == key && n.recipient != reporter)
  decreases |ts|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, operations__notifications_stepNoticesPermanent, operations__notifications_canSave;
  if |ts| == 0 {
  } else {
    RNRouteSaveStep(inbox, key, ts[0], version, reporter);
    var next := operations__notifications_save(inbox, key, operations__notifications_Kind.SecurityCase, ts[0]);
    assert forall n :: n in inbox.notices ==> n in next.notices by {
      reveal operations__notifications_save;
    }
    assert forall t :: t in ts[1..] ==> t in ts;
    RNRouteFold(next, key, ts[1..], version, reporter);
    var res := Std.Collections.Seq.FoldLeft((i: operations__notifications_Inbox, t: int) => operations__notifications_save(i, key, operations__notifications_Kind.SecurityCase, t), next, ts[1..]);
    forall n | n in inbox.notices ensures exists a :: (a in res.notices && a.id == n.id && a.key == n.key && a.kind == n.kind
      && a.recipient == n.recipient && a.channel == n.channel && a.createdAt == n.createdAt && a.escalationOf == n.escalationOf
      && (!(n.readAt > 0) || a.readAt == n.readAt) && (!(n.acknowledgedAt > 0) || a.acknowledgedAt == n.acknowledgedAt)
      && (!n.escalated || a.escalated))
    {
      assert n in res.notices;
    }
  }
}

lemma route_ensures(r: ReportNotices, seenRevision: int)
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysInboxChannels(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysReceiptNoticeAtomic(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysOwnerNoticeRouted(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysBodiesMatchVersions(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysBodiesBoundToRecords(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysAdviceUsesReceiptExclusions(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysCanonicalIsEarliestBindingCopy(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysUnverifiableKeepsCase(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysVerifiedReceiptLinksRetainedCase(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysDirectCaseChecked(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> alwaysDirectCaseSeparate(route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepNoticesPermanent(r, route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepReceiptNoticeNeedsReceipt(r, route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepOwnerNoticeNeedsQualification(r, route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepOutageKeepsCases(r, route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepCanonicalFixed(r, route(r, seenRevision)))
  ensures (inv(r) ==> canRoute(r, seenRevision) ==> stepForwardingKeepsSlopReceipt(r, "route", route(r, seenRevision)))
{
  hide *;
  if inv(r) && canRoute(r, seenRevision) {
    reveal inv, canRoute, route, ownerRecipients, caseReporter, ProofLib.Filter, security__journey_canRoute, security__journey_route, security__journey_routingContext, security__screening_canRoute, security__screening_route;
    var after := route(r, seenRevision);
    var ts := ownerRecipients(r);
    var version := r.journey.screening.version;
    var key := routeKey(version);
    assert version >= 1 by {
      reveal alwaysBodiesMatchVersions;
    }
    var pRec := (t: int) => (t != caseReporter(r));
    ProofLib.FilterSamePredicate(pRec, (t: int) => (t != caseReporter(r)), r.journey.privateCase.authority.technical);
    forall t | t in ts ensures operations__notifications_canSave(r.inbox, key, operations__notifications_Kind.SecurityCase, t) && t != caseReporter(r) {
      ProofLib.FilterMember(pRec, r.journey.privateCase.authority.technical, t);
    }
    assert operations__notifications_alwaysChannelByKind(r.inbox) && operations__notifications_alwaysNoticeIdentity(r.inbox)
      && (forall n :: n in r.inbox.notices ==> n.kind.SecurityReportReceived? || n.kind.SecurityCase?) by {
      reveal alwaysInboxChannels;
    }
    RNRouteFold(r.inbox, key, ts, version, caseReporter(r));
    RNNoticeCodeMod(ReportNotice.OwnersRouted, version);
    assert alwaysInboxChannels(after) && stepNoticesPermanent(r, after) by {
      reveal alwaysInboxChannels, stepNoticesPermanent;
    }
    assert alwaysReceiptNoticeAtomic(after) && stepReceiptNoticeNeedsReceipt(r, after) && stepOwnerNoticeNeedsQualification(r, after) && stepOutageKeepsCases(r, after) by {
      reveal alwaysReceiptNoticeAtomic, stepReceiptNoticeNeedsReceipt, stepOwnerNoticeNeedsQualification, stepOutageKeepsCases, sameReceipt, receiptNoticeKey, receiptKey, directNoticeKey, routeKey, noticeKey, noticeCode, operations__notifications_noticeExists, security__intake_alwaysAtomicReceipt, security__intake_alwaysReceivedHasReceipt, security__journey_received;
      forall n | n in after.inbox.notices && n !in r.inbox.notices
        ensures n.key != receiptNoticeKey(after) && n.key != directNoticeKey(after)
      {
        assert n.key == 10 * version + 2;
        assert receiptNoticeKey(after) == 10 * r.journey.intake.key + 1;
        assert directNoticeKey(after) == 10 * r.directAdvisory.ghsa + 3;
      }
    }
    assert alwaysOwnerNoticeRouted(after) by {
      reveal alwaysOwnerNoticeRouted, routeKey, noticeKey, noticeCode;
      if |ts| > 0 {
        ProofLib.FilterMember(pRec, r.journey.privateCase.authority.technical, ts[0]);
        assert security__journey_routingContext(r.journey).eligibleRecipients;
        var keep := (set_x: int) => !((set_x in r.journey.screening.noticeVersions));
        ProofLib.FilterCons(keep, [version]);
        ProofLib.FilterNil(keep, []);
        assert version in after.journey.screening.noticeVersions;
      }
      forall v | v in r.journey.screening.noticeVersions ensures v in after.journey.screening.noticeVersions {
      }
      forall n | n in after.inbox.notices && n.kind.SecurityCase? && n !in r.inbox.notices
        ensures quotient_security__reportNotices(n.key, 10) in after.journey.screening.noticeVersions
      {
        if |ts| == 0 {
          reveal Std.Collections.Seq.FoldLeft;
          assert after.inbox == r.inbox;
        }
      }
    }
    assert alwaysBodiesMatchVersions(after) && alwaysBodiesBoundToRecords(after) && alwaysAdviceUsesReceiptExclusions(after) && alwaysCanonicalIsEarliestBindingCopy(after) by {
      reveal alwaysBodiesMatchVersions, alwaysBodiesBoundToRecords, alwaysAdviceUsesReceiptExclusions, alwaysCanonicalIsEarliestBindingCopy, security__journey_alwaysAdviceUsesReceiptExclusions, security__journey_alwaysNothingBeforeReceipt, security__journey_received;
    }
    assert alwaysUnverifiableKeepsCase(after) && alwaysVerifiedReceiptLinksRetainedCase(after) && alwaysDirectCaseChecked(after) && alwaysDirectCaseSeparate(after) && stepCanonicalFixed(r, after) && stepForwardingKeepsSlopReceipt(r, "route", after) by {
      reveal alwaysUnverifiableKeepsCase, alwaysVerifiedReceiptLinksRetainedCase, alwaysDirectCaseChecked, alwaysDirectCaseSeparate, stepCanonicalFixed, stepForwardingKeepsSlopReceipt, forwardingStep, security__journey_alwaysSendFollowsReceipt, security__journey_alwaysCaseHoldsReceiptTerms, security__journey_received, security__forwarding_stepCanonicalFixed;
    }
  }
}

lemma RNEarliestIn(copies: seq<security__forwarding_Copy>, init: security__forwarding_Copy)
  ensures security__forwarding_earliestCopy(copies, init) == init || security__forwarding_earliestCopy(copies, init) in copies
  decreases |copies|
{
  hide *;
  reveal security__forwarding_earliestCopy, Std.Collections.Seq.FoldLeft;
  if |copies| > 0 {
    var next := if security__forwarding_comesBefore(copies[0], init) then copies[0] else init;
    RNEarliestIn(copies[1..], next);
    assert copies == [copies[0]] + copies[1..];
  }
}

lemma RNEarliestCommute(copies: seq<security__forwarding_Copy>, init: security__forwarding_Copy, x: security__forwarding_Copy)
  requires x.ghsa > 0
  requires init.ghsa == 0 || (init.ghsa > 0 && init.ghsa != x.ghsa)
  requires forall c :: c in copies ==> c.ghsa > 0 && c.ghsa != x.ghsa
  ensures var step := (inc: security__forwarding_Copy, cand: security__forwarding_Copy) => if security__forwarding_comesBefore(cand, inc) then cand else inc;
    step(security__forwarding_earliestCopy(copies, init), x) == security__forwarding_earliestCopy(copies, step(init, x))
  decreases |copies|
{
  hide *;
  reveal security__forwarding_earliestCopy, security__forwarding_comesBefore, Std.Collections.Seq.FoldLeft;
  var step := (inc: security__forwarding_Copy, cand: security__forwarding_Copy) => if security__forwarding_comesBefore(cand, inc) then cand else inc;
  if |copies| > 0 {
    var c0 := copies[0];
    assert c0 in copies;
    assert step(step(init, c0), x) == step(step(init, x), c0);
    RNEarliestCommute(copies[1..], step(init, c0), x);
  }
}

lemma RNEarliestAppend(copies: seq<security__forwarding_Copy>, accepted: security__forwarding_Copy)
  requires accepted.ghsa > 0
  requires forall c :: c in copies ==> c.ghsa > 0 && c.ghsa != accepted.ghsa
  ensures security__forwarding_earliestCopy(copies + [accepted], security__forwarding_noCopy) == security__forwarding_earliestCopy(copies, accepted)
{
  hide *;
  reveal security__forwarding_earliestCopy, security__forwarding_comesBefore, security__forwarding_noCopy, Std.Collections.Seq.FoldLeft;
  var step := (inc: security__forwarding_Copy, cand: security__forwarding_Copy) => if security__forwarding_comesBefore(cand, inc) then cand else inc;
  ProofLib.FoldLeftAppend(step, security__forwarding_noCopy, copies, accepted);
  RNEarliestCommute(copies, security__forwarding_noCopy, accepted);
}

lemma RNFilterAllAny(xs: seq<security__forwarding_Copy>)
  ensures forall p: security__forwarding_Copy -> bool, x: security__forwarding_Copy :: x in ProofLib.Filter(p, xs) <==> x in xs && p(x)
  ensures forall p: security__forwarding_Copy -> bool, q: security__forwarding_Copy -> bool :: (forall y :: y in xs ==> p(y) == q(y)) ==> ProofLib.Filter(p, xs) == ProofLib.Filter(q, xs)
{
  forall p: security__forwarding_Copy -> bool, x: security__forwarding_Copy ensures x in ProofLib.Filter(p, xs) <==> x in xs && p(x) {
    ProofLib.FilterMember(p, xs, x);
  }
  forall p: security__forwarding_Copy -> bool, q: security__forwarding_Copy -> bool | (forall y :: y in xs ==> p(y) == q(y)) ensures ProofLib.Filter(p, xs) == ProofLib.Filter(q, xs) {
    ProofLib.FilterSamePredicate(p, q, xs);
  }
}

lemma RNForwardingFrame(r: ReportNotices, via: string, after: ReportNotices)
  requires inv(r) && forwardingStep(via)
  requires after.inbox == r.inbox && after.directCase == r.directCase && after.directChecked == r.directChecked && after.directAdvisory == r.directAdvisory && after.bodies == r.bodies
  requires after.journey.program == r.journey.program && after.journey.intake == r.journey.intake && after.journey.screening == r.journey.screening && after.journey.privateCase == r.journey.privateCase && after.journey.assessment == r.journey.assessment && after.journey.assessmentAttempts == r.journey.assessmentAttempts && after.journey.reportingReady == r.journey.reportingReady
  ensures alwaysInboxChannels(after)
  ensures alwaysReceiptNoticeAtomic(after)
  ensures alwaysOwnerNoticeRouted(after)
  ensures alwaysBodiesMatchVersions(after)
  ensures alwaysBodiesBoundToRecords(after)
  ensures alwaysDirectCaseChecked(after)
  ensures stepNoticesPermanent(r, after)
  ensures stepReceiptNoticeNeedsReceipt(r, after)
  ensures stepOwnerNoticeNeedsQualification(r, after)
  ensures stepOutageKeepsCases(r, after)
  ensures stepForwardingKeepsSlopReceipt(r, via, after)
{
  hide *;
  reveal inv;
  assert alwaysInboxChannels(after) && alwaysReceiptNoticeAtomic(after) && alwaysOwnerNoticeRouted(after) by {
    reveal alwaysInboxChannels, alwaysReceiptNoticeAtomic, alwaysOwnerNoticeRouted, receiptNoticeKey, receiptKey, directNoticeKey, caseReporter;
  }
  assert alwaysBodiesMatchVersions(after) && alwaysBodiesBoundToRecords(after) && alwaysDirectCaseChecked(after) by {
    reveal alwaysBodiesMatchVersions, alwaysBodiesBoundToRecords, alwaysDirectCaseChecked;
  }
  assert stepNoticesPermanent(r, after) && stepReceiptNoticeNeedsReceipt(r, after) && stepOwnerNoticeNeedsQualification(r, after) && stepOutageKeepsCases(r, after) && stepForwardingKeepsSlopReceipt(r, via, after) by {
    reveal stepNoticesPermanent, stepReceiptNoticeNeedsReceipt, stepOwnerNoticeNeedsQualification, stepOutageKeepsCases, stepForwardingKeepsSlopReceipt, sameReceipt, alwaysReceiptNoticeAtomic, receiptNoticeKey, receiptKey, caseReporter, security__intake_alwaysReceivedHasReceipt, security__journey_received, operations__notifications_stepNoticesPermanent;
  }
}

lemma recordCreated_ensures(r: ReportNotices, claim: security__forwarding_SendClaim, accepted: security__forwarding_Copy, listing: security__forwarding_Listing)
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysInboxChannels(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysReceiptNoticeAtomic(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysOwnerNoticeRouted(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysBodiesMatchVersions(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysBodiesBoundToRecords(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysAdviceUsesReceiptExclusions(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysCanonicalIsEarliestBindingCopy(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysUnverifiableKeepsCase(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysVerifiedReceiptLinksRetainedCase(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysDirectCaseChecked(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> alwaysDirectCaseSeparate(recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepNoticesPermanent(r, recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepReceiptNoticeNeedsReceipt(r, recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepOwnerNoticeNeedsQualification(r, recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepOutageKeepsCases(r, recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepCanonicalFixed(r, recordCreated(r, claim, accepted, listing)))
  ensures (inv(r) ==> canRecordCreated(r, claim, accepted, listing) ==> stepForwardingKeepsSlopReceipt(r, "recordCreated", recordCreated(r, claim, accepted, listing)))
{
  hide *;
  if inv(r) && canRecordCreated(r, claim, accepted, listing) {
    reveal inv, canRecordCreated, recordCreated, withForwarding, forwardingStep, namesDirectCase, ProofLib.Filter, security__forwarding_canRecordCreated, security__forwarding_recordCreated, security__forwarding_ownsPostedClaim, security__forwarding_validCreatedCopy, security__forwarding_createdCandidates, security__forwarding_exactListing;
    var after := recordCreated(r, claim, accepted, listing);
    RNForwardingFrame(r, "recordCreated", after);
    var f := r.journey.forwarding;
    var copies := security__forwarding_createdCandidates(f, accepted, listing);
    var binding := copies + [accepted];
    var chosen := security__forwarding_earliestCopy(copies, accepted);
    forall c | c in copies ensures c.ghsa > 0 && c.ghsa != accepted.ghsa && !namesDirectCase(r, c) {
      var p := (copy: security__forwarding_Copy) => (copy.ghsa != accepted.ghsa);
      ProofLib.FilterSamePredicate(p, (copy: security__forwarding_Copy) => (copy.ghsa != accepted.ghsa), listing.copies);
      ProofLib.FilterMember(p, listing.copies, c);
    }
    RNEarliestIn(copies, accepted);
    RNEarliestAppend(copies, accepted);
    RNFilterAllAny(binding);
    assert alwaysCanonicalIsEarliestBindingCopy(after) && stepCanonicalFixed(r, after) by {
      reveal alwaysCanonicalIsEarliestBindingCopy, stepCanonicalFixed, security__forwarding_alwaysCanonicalIsEarliestBindingCopy, security__forwarding_alwaysDraftHasNoCopy, security__forwarding_stepCanonicalFixed;
      var dups := after.journey.forwarding.duplicateGhsas;
      var p := (copy: security__forwarding_Copy) => (copy.ghsa != chosen.ghsa);
      var s_map := ProofLib.Filter(p, binding);
      forall copy | copy in binding && copy.ghsa != chosen.ghsa ensures copy.ghsa in dups {
        assert copy in s_map;
        var i :| 0 <= i < |s_map| && s_map[i] == copy;
        assert dups[i] == copy.ghsa;
      }
    }
    assert alwaysDirectCaseSeparate(after) by {
      reveal alwaysDirectCaseSeparate;
    }
    assert alwaysAdviceUsesReceiptExclusions(after) && alwaysUnverifiableKeepsCase(after) && alwaysVerifiedReceiptLinksRetainedCase(after) by {
      reveal alwaysAdviceUsesReceiptExclusions, alwaysUnverifiableKeepsCase, alwaysVerifiedReceiptLinksRetainedCase, security__journey_alwaysAdviceUsesReceiptExclusions, security__journey_alwaysNothingBeforeReceipt, security__journey_alwaysSendFollowsReceipt, security__journey_alwaysCaseHoldsReceiptTerms, security__journey_received, caseReporter;
    }
  }
}

lemma reconcileCopies_ensures(r: ReportNotices, request: security__forwarding_Request, listing: security__forwarding_Listing, nowMs: int)
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysInboxChannels(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysReceiptNoticeAtomic(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysOwnerNoticeRouted(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysBodiesMatchVersions(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysBodiesBoundToRecords(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysAdviceUsesReceiptExclusions(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysCanonicalIsEarliestBindingCopy(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysUnverifiableKeepsCase(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysVerifiedReceiptLinksRetainedCase(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysDirectCaseChecked(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> alwaysDirectCaseSeparate(reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepNoticesPermanent(r, reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepReceiptNoticeNeedsReceipt(r, reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepOwnerNoticeNeedsQualification(r, reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepOutageKeepsCases(r, reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepCanonicalFixed(r, reconcileCopies(r, request, listing, nowMs)))
  ensures (inv(r) ==> canReconcileCopies(r, request, listing, nowMs) ==> stepForwardingKeepsSlopReceipt(r, "reconcileCopies", reconcileCopies(r, request, listing, nowMs)))
{
  hide *;
  if inv(r) && canReconcileCopies(r, request, listing, nowMs) {
    reveal inv, canReconcileCopies, reconcileCopies, withForwarding, forwardingStep, namesDirectCase, ProofLib.Filter, security__forwarding_canReconcile, security__forwarding_reconcile, security__forwarding_mayOperate, security__forwarding_exactListing, security__forwarding_noCopy;
    var after := reconcileCopies(r, request, listing, nowMs);
    RNForwardingFrame(r, "reconcileCopies", after);
    var f := r.journey.forwarding;
    var observed := security__forwarding_exactListing(f, listing);
    var chosen := security__forwarding_earliestCopy(listing.copies, security__forwarding_noCopy);
    RNEarliestIn(listing.copies, security__forwarding_noCopy);
    RNFilterAllAny(listing.copies);
    assert alwaysCanonicalIsEarliestBindingCopy(after) && stepCanonicalFixed(r, after) by {
      reveal alwaysCanonicalIsEarliestBindingCopy, stepCanonicalFixed, security__forwarding_alwaysCanonicalIsEarliestBindingCopy, security__forwarding_alwaysDraftHasNoCopy, security__forwarding_stepCanonicalFixed;
      if observed && chosen.ghsa > 0 {
        var dups := after.journey.forwarding.duplicateGhsas;
        var p := (copy: security__forwarding_Copy) => (copy.ghsa != chosen.ghsa);
        var s_map := ProofLib.Filter(p, listing.copies);
        forall copy | copy in listing.copies && copy.ghsa != chosen.ghsa ensures copy.ghsa in dups {
          assert copy in s_map;
          var i :| 0 <= i < |s_map| && s_map[i] == copy;
          assert dups[i] == copy.ghsa;
        }
      }
    }
    assert alwaysDirectCaseSeparate(after) by {
      reveal alwaysDirectCaseSeparate;
    }
    assert alwaysAdviceUsesReceiptExclusions(after) && alwaysUnverifiableKeepsCase(after) && alwaysVerifiedReceiptLinksRetainedCase(after) by {
      reveal alwaysAdviceUsesReceiptExclusions, alwaysUnverifiableKeepsCase, alwaysVerifiedReceiptLinksRetainedCase, security__journey_alwaysAdviceUsesReceiptExclusions, security__journey_alwaysNothingBeforeReceipt, security__journey_alwaysSendFollowsReceipt, security__journey_alwaysCaseHoldsReceiptTerms, security__journey_received, caseReporter;
    }
  }
}

lemma begin_ensures(r: ReportNotices, key: int, body: string, reporter: int, repository: int, projectRevision: int, nowMs: int)
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysInboxChannels(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysReceiptNoticeAtomic(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysOwnerNoticeRouted(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysBodiesMatchVersions(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysBodiesBoundToRecords(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysAdviceUsesReceiptExclusions(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysCanonicalIsEarliestBindingCopy(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysUnverifiableKeepsCase(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysVerifiedReceiptLinksRetainedCase(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysDirectCaseChecked(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> alwaysDirectCaseSeparate(begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepNoticesPermanent(r, begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepReceiptNoticeNeedsReceipt(r, begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepOwnerNoticeNeedsQualification(r, begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepOutageKeepsCases(r, begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepCanonicalFixed(r, begin(r, key, body, reporter, repository, projectRevision, nowMs)))
  ensures (inv(r) ==> canBegin(r, key, body, reporter, repository, projectRevision, nowMs) ==> stepForwardingKeepsSlopReceipt(r, "begin", begin(r, key, body, reporter, repository, projectRevision, nowMs)))
{
  hide *;
  if inv(r) && canBegin(r, key, body, reporter, repository, projectRevision, nowMs) {
    reveal inv, canBegin, begin, declassifyDigest, caseReporter, security__journey_canBegin, security__journey_begin, security__intake_canBegin, security__intake_begin;
    var after := begin(r, key, body, reporter, repository, projectRevision, nowMs);
    assert alwaysReceiptNoticeAtomic(after) by {
      reveal alwaysReceiptNoticeAtomic, alwaysInboxChannels, alwaysOwnerNoticeRouted, receiptNoticeKey, receiptKey, directNoticeKey, noticeKey, noticeCode, operations__notifications_noticeExists, security__intake_alwaysAtomicReceipt, security__intake_alwaysReceivedHasReceipt;
      RNNoticeCodeMod(ReportNotice.ReportReceived, key);
      forall n | n in r.inbox.notices ensures !(n.key == receiptKey(key) && n.recipient == caseReporter(r)) {
        if n.kind.SecurityCase? {
          assert remainder_security__reportNotices(n.key, 10) == 2;
          assert remainder_security__reportNotices(receiptKey(key), 10) == 1;
        } else {
          assert n.kind.SecurityReportReceived?;
          if n.key == receiptNoticeKey(r) && n.recipient == caseReporter(r) {
            assert operations__notifications_noticeExists(r.inbox, receiptNoticeKey(r), caseReporter(r));
          } else {
            assert r.directChecked && n.key == directNoticeKey(r);
            assert n.key == 10 * r.directAdvisory.ghsa + 3;
            assert receiptKey(key) == 10 * key + 1;
          }
        }
      }
    }
    assert alwaysInboxChannels(after) && alwaysOwnerNoticeRouted(after) && alwaysBodiesMatchVersions(after) && alwaysBodiesBoundToRecords(after) by {
      reveal alwaysInboxChannels, alwaysOwnerNoticeRouted, alwaysBodiesMatchVersions, alwaysBodiesBoundToRecords;
    }
    assert alwaysAdviceUsesReceiptExclusions(after) && alwaysCanonicalIsEarliestBindingCopy(after) && alwaysUnverifiableKeepsCase(after) && alwaysVerifiedReceiptLinksRetainedCase(after) by {
      reveal alwaysAdviceUsesReceiptExclusions, alwaysCanonicalIsEarliestBindingCopy, alwaysUnverifiableKeepsCase, alwaysVerifiedReceiptLinksRetainedCase, security__journey_alwaysAdviceUsesReceiptExclusions, security__journey_alwaysNothingBeforeReceipt, security__journey_alwaysSendFollowsReceipt, security__journey_alwaysCaseHoldsReceiptTerms, security__journey_received;
    }
    assert alwaysDirectCaseChecked(after) && alwaysDirectCaseSeparate(after) && stepNoticesPermanent(r, after) && stepReceiptNoticeNeedsReceipt(r, after) && stepOwnerNoticeNeedsQualification(r, after) && stepOutageKeepsCases(r, after) && stepCanonicalFixed(r, after) && stepForwardingKeepsSlopReceipt(r, "begin", after) by {
      reveal alwaysDirectCaseChecked, alwaysDirectCaseSeparate, stepNoticesPermanent, stepReceiptNoticeNeedsReceipt, stepOwnerNoticeNeedsQualification, stepOutageKeepsCases, stepCanonicalFixed, stepForwardingKeepsSlopReceipt, forwardingStep, operations__notifications_stepNoticesPermanent, security__journey_received, security__forwarding_stepCanonicalFixed;
    }
  }
}
