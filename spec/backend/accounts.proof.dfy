lemma FilterAll<T>(p: T -> bool, xs: seq<T>)
  requires forall i :: 0 <= i < |xs| ==> p(xs[i])
  ensures ProofLib.Filter(p, xs) == xs
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
  } else {
    ProofLib.FilterCons(p, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    FilterAll(p, xs[1..]);
  }
}

lemma FilterSingleValue<T>(p: T -> bool, xs: seq<T>, i: int)
  requires 0 <= i < |xs| && p(xs[i])
  requires forall j :: 0 <= j < |xs| && j != i ==> !p(xs[j])
  ensures ProofLib.Filter(p, xs) == [xs[i]]
  decreases |xs|
{
  ProofLib.FilterCons(p, xs);
  if i == 0 {
    assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    ProofLib.FilterNone(p, xs[1..]);
  } else {
    assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
    FilterSingleValue(p, xs[1..], i - 1);
  }
}

lemma FilterSubseqKeepsCountOne<T>(keep: T -> bool, eq: T -> bool, xs: seq<T>, x: T)
  requires x in ProofLib.Filter(keep, xs) && eq(x)
  requires |ProofLib.Filter(eq, xs)| == 1
  ensures |ProofLib.Filter(eq, ProofLib.Filter(keep, xs))| == 1
{
  ProofLib.FilterOfFilterShorter(keep, eq, xs);
  ProofLib.FilterMember(eq, ProofLib.Filter(keep, xs), x);
}

lemma FilterAtMostOne<T>(p: T -> bool, xs: seq<T>)
  requires forall i, j :: 0 <= i < |xs| && 0 <= j < |xs| && i != j && p(xs[i]) ==> !p(xs[j])
  ensures |ProofLib.Filter(p, xs)| <= 1
{
  if exists i :: 0 <= i < |xs| && p(xs[i]) {
    var i :| 0 <= i < |xs| && p(xs[i]);
    ProofLib.FilterOne(p, xs, i);
  } else {
    ProofLib.FilterNone(p, xs);
  }
}

lemma EnrollmentFoldNoMatch(xs: seq<backend__email_Enrollment>, init: backend__email_Enrollment, recipient: int)
  requires forall i :: 0 <= i < |xs| ==> xs[i].actor != recipient
  ensures Std.Collections.Seq.FoldLeft((found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == recipient) then e else found), init, xs) == init
  decreases |xs|
{
  if |xs| > 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
    EnrollmentFoldNoMatch(xs[1..], init, recipient);
  }
}

lemma EnrollmentFoldReplaceHit(xs: seq<backend__email_Enrollment>, ys: seq<backend__email_Enrollment>, init: backend__email_Enrollment, changed: backend__email_Enrollment)
  requires |ys| == |xs|
  requires forall i :: 0 <= i < |xs| ==> ys[i] == (if xs[i].actor == changed.actor then changed else xs[i])
  requires exists i :: 0 <= i < |xs| && xs[i].actor == changed.actor
  ensures Std.Collections.Seq.FoldLeft((found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == changed.actor) then e else found), init, ys) == changed
  decreases |xs|
{
  var f := (found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == changed.actor) then e else found);
  if xs[0].actor == changed.actor {
    assert ys[0] == changed;
    if exists j :: 0 <= j < |xs[1..]| && xs[1..][j].actor == changed.actor {
      assert forall j :: 0 <= j < |xs[1..]| ==> ys[1..][j] == (if xs[1..][j].actor == changed.actor then changed else xs[1..][j]);
      EnrollmentFoldReplaceHit(xs[1..], ys[1..], f(init, ys[0]), changed);
    } else {
      assert forall j :: 0 <= j < |ys[1..]| ==> ys[1..][j].actor != changed.actor by {
        forall j | 0 <= j < |ys[1..]| ensures ys[1..][j].actor != changed.actor {
          assert ys[1..][j] == ys[j + 1] && xs[1..][j] == xs[j + 1];
        }
      }
      EnrollmentFoldNoMatch(ys[1..], changed, changed.actor);
    }
  } else {
    var k :| 0 <= k < |xs| && xs[k].actor == changed.actor;
    assert k > 0 && xs[1..][k - 1] == xs[k];
    assert forall j :: 0 <= j < |xs[1..]| ==> ys[1..][j] == (if xs[1..][j].actor == changed.actor then changed else xs[1..][j]);
    EnrollmentFoldReplaceHit(xs[1..], ys[1..], f(init, ys[0]), changed);
  }
}

lemma WithSnapshotEnrollmentOf(i: operations__notifications_Inbox, i2: operations__notifications_Inbox, e: backend__email_Enrollment, recipient: int)
  requires i2.enrollments == operations__notifications_withSnapshot(i, e)
  ensures operations__notifications_enrollmentOf(i2, recipient)
    == (if recipient == e.actor then e else operations__notifications_enrollmentOf(i, recipient))
{
  hide *;
  reveal operations__notifications_enrollmentOf, operations__notifications_withSnapshot;
  var f := (found: backend__email_Enrollment, x: backend__email_Enrollment) => (if (x.actor == recipient) then x else found);
  var init := backend__email_newEnrollment(recipient, 0);
  var xs := i.enrollments;
  var ys := operations__notifications_withSnapshot(i, e);
  if exists x :: x in xs && x.actor == e.actor {
    if recipient == e.actor {
      var k :| 0 <= k < |xs| && xs[k].actor == e.actor;
      EnrollmentFoldReplaceHit(xs, ys, init, e);
    } else {
      ProofLib.FoldLeftPointwise(f, f, init, xs, ys);
    }
  } else {
    assert ys == xs + [e];
    ProofLib.FoldLeftAppend(f, init, xs, e);
  }
}

lemma CloseAccountNoWaitingMail(i: operations__notifications_Inbox, e: backend__email_Enrollment)
  ensures operations__notifications_noWaitingMail(operations__notifications_closeAccount(i, operations__notifications_accountService, e), e.actor)
{
  hide *;
  reveal operations__notifications_noWaitingMail, operations__notifications_closeAccount, operations__notifications_waiting;
  var after := operations__notifications_closeAccount(i, operations__notifications_accountService, e);
  forall n | n in after.notices
    ensures n.recipient == e.actor ==> !operations__notifications_waiting(n)
  {
    var k :| 0 <= k < |after.notices| && after.notices[k] == n;
    var prev := i.notices[k];
    if prev.recipient == e.actor && operations__notifications_waiting(prev) {
      assert n.state.Suppressed?;
    }
  }
}

lemma MemberFieldsValid(s: Accounts, i: int)
  requires alwaysMembersIdentified(s) && 0 <= i < |s.members|
  ensures s.members[i].actor > 0 && s.members[i].githubId > 0 && s.members[i].login != "" && s.members[i].joinedAt > 0 && s.members[i].email.actor == s.members[i].githubId
{
  hide *;
  reveal alwaysMembersIdentified;
}

lemma MemberEmailProps(s: Accounts, i: int)
  requires alwaysEmailValid(s) && 0 <= i < |s.members|
  ensures s.lastEmailId >= 0 && s.lastVersion >= 0 && s.lastUnsubscribe >= 0
  ensures backend__email_wellFormed(s.members[i].email, s.now)
  ensures s.members[i].email.destination.version <= s.lastVersion
  ensures s.members[i].email.preference.version <= s.lastVersion
  ensures s.members[i].email.pilotVersion <= s.lastVersion
  ensures !s.members[i].email.preference.stored ==> s.members[i].email.preference.revision == 0 && s.members[i].email.preference.version == 0
  ensures forall v :: v in s.members[i].email.verifications ==> v.id <= s.lastEmailId
{
  hide *;
  reveal alwaysEmailValid;
  assert s.members[i] in s.members;
}

lemma EmailHistoryRetainedRefl(e: backend__email_Enrollment)
  ensures backend__email_historyRetained(e, e)
{
  hide *;
  reveal backend__email_historyRetained;
}

lemma StepEmailHistoryRetainedOne(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts)
  requires 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.lastEmailId >= s.lastEmailId && after.lastVersion >= s.lastVersion && after.lastUnsubscribe >= s.lastUnsubscribe
  requires forall j :: 0 <= j < |s.members| ==> memberByActor(after, s.members[j].actor) == after.members[j]
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].email == (if j == i then e' else s.members[j].email)
  requires backend__email_historyRetained(s.members[i].email, e')
  ensures stepEmailHistoryRetained(s, after)
{
  hide *;
  reveal stepEmailHistoryRetained;
  forall j | 0 <= j < |s.members|
    ensures backend__email_historyRetained(s.members[j].email, memberByActor(after, s.members[j].actor).email)
  {
    if j != i {
      EmailHistoryRetainedRefl(s.members[j].email);
    }
  }
}

lemma KeepMembersIdentified(a: Accounts, b: Accounts)
  requires alwaysMembersIdentified(a) && b.members == a.members
  ensures alwaysMembersIdentified(b)
{
  hide *;
  reveal alwaysMembersIdentified;
}

lemma KeepSessions(a: Accounts, b: Accounts)
  requires alwaysSessionsBelongToOpenMembers(a) && b.sessions == a.sessions && b.lastSession == a.lastSession && b.now >= a.now
  requires forall m :: m in a.members && m.membership.Open? ==> exists n :: n in b.members && n.actor == m.actor && n.membership.Open?
  ensures alwaysSessionsBelongToOpenMembers(b)
{
  hide *;
  reveal alwaysSessionsBelongToOpenMembers;
}

lemma KeepClockShared(a: Accounts, b: Accounts)
  requires alwaysClockShared(a) && b.now == a.now && b.identity.now == a.identity.now
  ensures alwaysClockShared(b)
{
  hide *;
  reveal alwaysClockShared;
}

lemma KeepIdentityStoreValid(a: Accounts, b: Accounts)
  requires alwaysIdentityStoreValid(a) && b.identity == a.identity
  ensures alwaysIdentityStoreValid(b)
{
  hide *;
  reveal alwaysIdentityStoreValid;
}

lemma KeepParticipationAwards(a: Accounts, b: Accounts)
  requires alwaysParticipationAwardsHistorical(a) && b.xAwards == a.xAwards
  ensures alwaysParticipationAwardsHistorical(b)
{
  hide *;
  reveal alwaysParticipationAwardsHistorical;
}

lemma KeepRefusalsConsumed(a: Accounts, b: Accounts)
  requires alwaysRefusalsConsumed(a) && b.refusedSignIns == a.refusedSignIns
  requires forall t :: t in a.identity.consumedTokens ==> t in b.identity.consumedTokens
  ensures alwaysRefusalsConsumed(b)
{
  hide *;
  reveal alwaysRefusalsConsumed;
}

lemma KeepPublicMembershipIsOpen(a: Accounts, b: Accounts)
  requires alwaysPublicMembershipIsOpen(a) && b.members == a.members
  ensures alwaysPublicMembershipIsOpen(b)
{
  hide *;
  reveal alwaysPublicMembershipIsOpen;
}

lemma KeepClosedPrivate(a: Accounts, b: Accounts)
  requires alwaysClosedPrivate(a) && b.members == a.members
  requires forall x :: x in b.sessions ==> x in a.sessions
  requires forall f :: f in b.xRegistry.flows ==> f in a.xRegistry.flows
  ensures alwaysClosedPrivate(b)
{
  hide *;
  reveal alwaysClosedPrivate;
}

lemma KeepXRegistryValid(a: Accounts, b: Accounts)
  requires alwaysXRegistryValid(a) && b.xRegistry == a.xRegistry
  requires forall m :: m in a.members && m.membership.Open? ==> exists n :: n in b.members && n.actor == m.actor && n.membership.Open?
  ensures alwaysXRegistryValid(b)
{
  hide *;
  reveal alwaysXRegistryValid, backend__xConnection_registryWellFormed;
}

lemma KeepXLinkReserved(a: Accounts, b: Accounts)
  requires alwaysXLinkReserved(a) && b.members == a.members && b.xRegistry.claims == a.xRegistry.claims
  ensures alwaysXLinkReserved(b)
{
  hide *;
  reveal alwaysXLinkReserved, backend__xConnection_claimOwner;
}

lemma KeepXLinkPublicWhenRecent(a: Accounts, b: Accounts)
  requires alwaysXLinkPublicWhenRecent(a) && b.members == a.members
  ensures alwaysXLinkPublicWhenRecent(b)
{
  hide *;
  reveal alwaysXLinkPublicWhenRecent;
}

lemma KeepEmailValid(a: Accounts, b: Accounts)
  requires alwaysEmailValid(a) && b.members == a.members && b.now >= a.now
  requires b.lastEmailId >= a.lastEmailId && b.lastVersion >= a.lastVersion && b.lastUnsubscribe >= a.lastUnsubscribe
  ensures alwaysEmailValid(b)
{
  hide *;
  reveal alwaysEmailValid, backend__email_wellFormed;
}

lemma KeepEmailValidSameEmailField(s: Accounts, i: int, after: Accounts)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.now == s.now && after.lastEmailId == s.lastEmailId && after.lastVersion == s.lastVersion && after.lastUnsubscribe == s.lastUnsubscribe
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == s.members[j].email
  ensures alwaysEmailValid(after)
{
  hide *;
  reveal alwaysEmailValid;
  forall j | 0 <= j < |after.members|
    ensures backend__email_wellFormed(after.members[j].email, after.now)
    ensures after.members[j].email.destination.version <= after.lastVersion && after.members[j].email.preference.version <= after.lastVersion && after.members[j].email.pilotVersion <= after.lastVersion
    ensures !after.members[j].email.preference.stored ==> after.members[j].email.preference.revision == 0 && after.members[j].email.preference.version == 0
    ensures forall v :: v in after.members[j].email.verifications ==> v.id <= after.lastEmailId && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists w :: w in o.email.verifications && w.id == v.id))
    ensures forall t :: t in after.members[j].email.unsubscribeTokens ==> t.token <= after.lastUnsubscribe && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token))
    ensures after.members[j].email.destination.version > 0 ==> forall o :: o in after.members && o.githubId != after.members[j].githubId ==> o.email.destination.version != after.members[j].email.destination.version
  {
    assert s.members[j] in s.members;
    forall o | o in after.members && o.githubId != after.members[j].githubId
      ensures o.email.destination.version != after.members[j].email.destination.version || after.members[j].email.destination.version <= 0
      ensures forall v :: v in after.members[j].email.verifications ==> !(exists w :: w in o.email.verifications && w.id == v.id)
      ensures forall t :: t in after.members[j].email.unsubscribeTokens ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
    {
      var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
      assert s.members[oi] in s.members;
    }
  }
}

lemma KeepOutbox(a: Accounts, b: Accounts)
  requires alwaysOutboxSeesCurrentConsent(a) && b.members == a.members && b.inbox.enrollments == a.inbox.enrollments
  ensures alwaysOutboxSeesCurrentConsent(b)
{
  hide *;
  reveal alwaysOutboxSeesCurrentConsent, operations__notifications_enrollmentOf, hasGithubMember;
}

lemma KeepOutboxSameMailView(s: Accounts, after: Accounts)
  requires alwaysOutboxSeesCurrentConsent(s) && |after.members| == |s.members| && after.inbox.enrollments == s.inbox.enrollments
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && mailView(after.members[j].email) == mailView(s.members[j].email)
  ensures alwaysOutboxSeesCurrentConsent(after)
{
  hide *;
  reveal alwaysOutboxSeesCurrentConsent, hasGithubMember;
  forall j | 0 <= j < |after.members|
    ensures mailView(operations__notifications_enrollmentOf(after.inbox, after.members[j].githubId)) == mailView(after.members[j].email)
  {
    assert s.members[j] in s.members;
    assert operations__notifications_enrollmentOf(after.inbox, after.members[j].githubId) == operations__notifications_enrollmentOf(s.inbox, s.members[j].githubId) by {
      reveal operations__notifications_enrollmentOf;
    }
  }
  forall e | e in after.inbox.enrollments ensures hasGithubMember(after, e.actor) {
    var k :| 0 <= k < |s.members| && s.members[k].githubId == e.actor;
    assert after.members[k].githubId == e.actor;
  }
}

lemma MembersUnique(s: Accounts)
  requires alwaysMembersIdentified(s)
  ensures forall i, j :: 0 <= i < |s.members| && 0 <= j < |s.members| && i != j ==> s.members[i].actor != s.members[j].actor && s.members[i].githubId != s.members[j].githubId
{
  hide *;
  reveal alwaysMembersIdentified, ProofLib.Filter;
  forall i, j | 0 <= i < |s.members| && 0 <= j < |s.members| && i != j
    ensures s.members[i].actor != s.members[j].actor && s.members[i].githubId != s.members[j].githubId
  {
    var m := s.members[i];
    assert m in s.members;
    ProofLib.FilterCountOneIffUnique((o: Member) => (o.actor == m.actor), s.members, (o: Member) => o.actor, i);
    ProofLib.FilterCountOneIffUnique((o: Member) => (o.githubId == m.githubId), s.members, (o: Member) => o.githubId, i);
  }
}

lemma MemberByActorAt(s: Accounts, i: int)
  requires alwaysMembersIdentified(s) && 0 <= i < |s.members|
  ensures memberByActor(s, s.members[i].actor) == s.members[i]
{
  hide *;
  reveal memberByActor, ProofLib.Filter;
  MembersUnique(s);
  FilterSingleValue((m: Member) => (m.actor == s.members[i].actor), s.members, i);
}

lemma MemberByGithubAt(s: Accounts, i: int)
  requires alwaysMembersIdentified(s) && 0 <= i < |s.members|
  ensures memberByGithub(s, s.members[i].githubId) == s.members[i]
{
  hide *;
  reveal memberByGithub, ProofLib.Filter;
  MembersUnique(s);
  FilterSingleValue((m: Member) => (m.githubId == s.members[i].githubId), s.members, i);
}

lemma MemberByActorAbsent(s: Accounts, actor: int)
  requires !(exists m :: m in s.members && m.actor == actor)
  ensures memberByActor(s, actor) == absentMember
{
  hide *;
  reveal memberByActor, ProofLib.Filter;
  ProofLib.FilterNone((m: Member) => (m.actor == actor), s.members);
}

lemma ReplaceMemberAt(s: Accounts, i: int, changed: Member)
  requires alwaysMembersIdentified(s) && 0 <= i < |s.members|
  requires changed.actor == s.members[i].actor && changed.githubId == s.members[i].githubId
  requires changed.login != "" && changed.joinedAt > 0 && changed.email.actor == changed.githubId
  ensures var ms := replaceMember(s.members, changed);
    |ms| == |s.members| && ms[i] == changed
    && (forall j :: 0 <= j < |s.members| && j != i ==> ms[j] == s.members[j])
    && alwaysMembersIdentified(s.(members := ms))
{
  hide *;
  reveal alwaysMembersIdentified, replaceMember, ProofLib.Filter;
  MembersUnique(s);
  var ms := replaceMember(s.members, changed);
  forall k | 0 <= k < |ms|
    ensures |ProofLib.Filter((o: Member) => (o.githubId == ms[k].githubId), ms)| == 1
    ensures |ProofLib.Filter((o: Member) => (o.actor == ms[k].actor), ms)| == 1
  {
    assert s.members[k] in s.members;
    ProofLib.FilterLengthPointwise((o: Member) => (o.githubId == s.members[k].githubId), (o: Member) => (o.githubId == ms[k].githubId), s.members, ms);
    ProofLib.FilterLengthPointwise((o: Member) => (o.actor == s.members[k].actor), (o: Member) => (o.actor == ms[k].actor), s.members, ms);
  }
}

lemma AppendMemberValid(s: Accounts, added: Member)
  requires alwaysMembersIdentified(s) && added.actor > 0 && added.githubId > 0 && added.login != "" && added.joinedAt > 0 && added.email.actor == added.githubId
  requires !(exists m :: m in s.members && m.actor == added.actor)
  requires !(exists m :: m in s.members && m.githubId == added.githubId)
  ensures alwaysMembersIdentified(s.(members := s.members + [added]))
{
  hide *;
  reveal alwaysMembersIdentified, ProofLib.Filter;
  var ms := s.members + [added];
  forall m | m in ms
    ensures |ProofLib.Filter((o: Member) => (o.githubId == m.githubId), ms)| == 1
    ensures |ProofLib.Filter((o: Member) => (o.actor == m.actor), ms)| == 1
  {
    ProofLib.FilterAppend((o: Member) => (o.githubId == m.githubId), s.members, added);
    ProofLib.FilterAppend((o: Member) => (o.actor == m.actor), s.members, added);
    if m == added {
      ProofLib.FilterNone((o: Member) => (o.githubId == m.githubId), s.members);
      ProofLib.FilterNone((o: Member) => (o.actor == m.actor), s.members);
    }
  }
}

lemma SessionsUnique(s: Accounts)
  requires alwaysSessionsBelongToOpenMembers(s)
  ensures forall i, j :: 0 <= i < |s.sessions| && 0 <= j < |s.sessions| && i != j ==> s.sessions[i].id != s.sessions[j].id
{
  hide *;
  reveal alwaysSessionsBelongToOpenMembers, ProofLib.Filter;
  forall i, j | 0 <= i < |s.sessions| && 0 <= j < |s.sessions| && i != j
    ensures s.sessions[i].id != s.sessions[j].id
  {
    var x := s.sessions[i];
    assert x in s.sessions;
    ProofLib.FilterCountOneIffUnique((o: Session) => (o.id == x.id), s.sessions, (o: Session) => o.id, i);
  }
}

lemma SenderActorMember(s: Accounts, by_: int)
  requires inv(s) && senderActor(s, by_) > 0
  ensures by_ > 0
  ensures exists i :: 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i]
{
  hide *;
  reveal inv, senderActor, sessionLive, alwaysSessionsBelongToOpenMembers, ProofLib.Filter;
  assert sessionLive(s, by_);
  var x :| x in s.sessions && x.id == by_ && x.expiresAt > s.now;
  var xi :| 0 <= xi < |s.sessions| && s.sessions[xi] == x;
  SessionsUnique(s);
  FilterSingleValue((o: Session) => (o.id == by_), s.sessions, xi);
  assert senderActor(s, by_) == x.actor;
  var m :| m in s.members && m.actor == x.actor && m.membership.Open?;
  var mi :| 0 <= mi < |s.members| && s.members[mi] == m;
  MemberByActorAt(s, mi);
}

lemma FilterSessionsValid(s: Accounts, keep: Session -> bool, after: Accounts)
  requires alwaysSessionsBelongToOpenMembers(s)
  requires after.sessions == ProofLib.Filter(keep, s.sessions)
  requires after.lastSession >= s.lastSession && after.now >= s.now
  requires forall x :: x in after.sessions ==> exists m :: m in after.members && m.actor == x.actor && m.membership.Open?
  ensures alwaysSessionsBelongToOpenMembers(after)
  ensures stepSessionIdsFresh(s, after)
  ensures stepSessionLifetimeFixedAtSignIn(s, after)
{
  hide *;
  reveal alwaysSessionsBelongToOpenMembers, stepSessionIdsFresh, stepSessionLifetimeFixedAtSignIn, ProofLib.Filter;
  forall x | x in after.sessions
    ensures x in s.sessions
    ensures |ProofLib.Filter((o: Session) => (o.id == x.id), after.sessions)| == 1
  {
    ProofLib.FilterMember(keep, s.sessions, x);
    FilterSubseqKeepsCountOne(keep, (o: Session) => (o.id == x.id), s.sessions, x);
  }
}

lemma OpenSessionValid(s: Accounts, m: Member, after: Accounts)
  requires inv(s) && m in after.members && m.membership.Open? && alwaysMembersIdentified(after)
  requires after.sessions == openSession(s, m) && after.lastSession == s.lastSession + 1 && after.now == s.now
  requires forall x :: x in s.sessions ==> exists k :: k in after.members && k.actor == x.actor && k.membership.Open?
  ensures alwaysSessionsBelongToOpenMembers(after)
  ensures stepSessionIdsFresh(s, after)
  ensures stepSessionLifetimeFixedAtSignIn(s, after)
{
  hide *;
  reveal inv, openSession, alwaysSessionsBelongToOpenMembers, stepSessionIdsFresh, stepSessionLifetimeFixedAtSignIn, lifetimeFor, ownerSessionLifetime, sessionLifetime, ProofLib.Filter;
  var keep := (x: Session) => (x.expiresAt > s.now);
  var kept := ProofLib.Filter(keep, s.sessions);
  var added := Session((s.lastSession + 1), m.actor, (s.now + lifetimeFor(s, m.githubId)));
  ProofLib.FilterSamePredicate((x: Session) => (x.expiresAt > s.now), keep, s.sessions);
  assert after.sessions == kept + [added];
  var mi :| 0 <= mi < |after.members| && after.members[mi] == m;
  MemberByActorAt(after, mi);
  forall x | x in after.sessions
    ensures x in s.sessions || x == added
    ensures x.id > 0 && x.id <= after.lastSession && x.expiresAt <= after.now + ownerSessionLifetime
    ensures |ProofLib.Filter((o: Session) => (o.id == x.id), after.sessions)| == 1
    ensures exists k :: k in after.members && k.actor == x.actor && k.membership.Open?
  {
    ProofLib.FilterAppend((o: Session) => (o.id == x.id), kept, added);
    if x in kept {
      ProofLib.FilterMember(keep, s.sessions, x);
      FilterSubseqKeepsCountOne(keep, (o: Session) => (o.id == x.id), s.sessions, x);
      assert x.id <= s.lastSession < added.id;
    } else {
      assert x == added;
      forall j | 0 <= j < |kept| ensures kept[j].id != x.id {
        ProofLib.FilterMember(keep, s.sessions, kept[j]);
      }
      ProofLib.FilterNone((o: Session) => (o.id == x.id), kept);
    }
  }
}

lemma StepSameMembers(s: Accounts, after: Accounts, via: string)
  requires alwaysMembersIdentified(s) && after.members == s.members
  requires after.xAwards == s.xAwards && after.telegramClaims == s.telegramClaims
  requires after.lastEmailId >= s.lastEmailId && after.lastVersion >= s.lastVersion && after.lastUnsubscribe >= s.lastUnsubscribe
  requires via != "revokeSession"
  ensures stepMembersPermanent(s, after) && stepNoNewParticipationAward(s, after)
  ensures stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after)
  ensures stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after)
  ensures stepClosureCancelsWaitingMail(s, after) && stepClosedAtStable(s, after)
  ensures stepTelegramFrozen(s, after) && stepConsentOnlyFromExplicitChoice(s, via, after)
  ensures stepEmailHistoryRetained(s, after)
{
  hide *;
  reveal stepMembersPermanent, stepNoNewParticipationAward, stepSignInPreservesEmail, stepPublicationOnlyBySignIn,
    stepRevocationStaysInAccount, stepActiveMembershipNeverHidden, stepClosureCancelsWaitingMail, stepClosedAtStable,
    stepTelegramFrozen, stepConsentOnlyFromExplicitChoice, stepEmailHistoryRetained, backend__email_historyRetained;
  KeepMembersIdentified(s, after);
  forall i | 0 <= i < |s.members|
    ensures memberByActor(s, s.members[i].actor) == s.members[i]
    ensures memberByActor(after, s.members[i].actor) == s.members[i]
  {
    MemberByActorAt(s, i);
    MemberByActorAt(after, i);
  }
}

lemma StepSameSessions(s: Accounts, after: Accounts)
  requires after.sessions == s.sessions && after.lastSession >= s.lastSession && after.now >= s.now
  ensures stepSessionIdsFresh(s, after) && stepSessionLifetimeFixedAtSignIn(s, after)
{
  hide *;
  reveal stepSessionIdsFresh, stepSessionLifetimeFixedAtSignIn;
}

lemma StepSameXClaims(s: Accounts, after: Accounts)
  requires after.xRegistry.claims == s.xRegistry.claims
  ensures stepXReservationsPermanent(s, after)
{
  hide *;
  reveal stepXReservationsPermanent, backend__xConnection_claimsPermanent;
}

lemma StepNonX(s: Accounts, after: Accounts, via: string)
  requires via != "startX" && via != "claimXCallback" && via != "commitX" && via != "failX" && via != "disconnectX" && via != "publishX"
  ensures stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after)
{
  hide *;
  reveal stepFailedXKeepsLink, stepXConfersNoOtherAuthority;
}

lemma StepXAuthoritySameMembers(s: Accounts, after: Accounts, via: string)
  requires alwaysMembersIdentified(s) && after.members == s.members
  requires after.sessions == s.sessions && after.identity == s.identity && after.inbox == s.inbox && after.xAwards == s.xAwards
  ensures stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after)
{
  hide *;
  reveal stepFailedXKeepsLink, stepXConfersNoOtherAuthority;
  forall i | 0 <= i < |s.members|
    ensures memberByActor(s, s.members[i].actor) == s.members[i]
  {
    MemberByActorAt(s, i);
  }
}

lemma IdentityStoreIsInv(s: Accounts)
  requires alwaysIdentityStoreValid(s)
  ensures backend__identity_inv(s.identity)
{
  hide *;
  reveal alwaysIdentityStoreValid, backend__identity_inv;
}

lemma AssertionInStore(s: Accounts, token: int)
  requires alwaysIdentityStoreValid(s) && backend__identity_hasAssertion(s.identity, token)
  ensures var a := backend__identity_assertionFor(s.identity, token);
    a in s.identity.assertions && a.token == token && a.github.actor > 0 && a.github.login != ""
    && (!a.audience.PointsWeb? || a.github.nodeId > 0)
{
  hide *;
  reveal alwaysIdentityStoreValid, backend__identity_hasAssertion, backend__identity_assertionFor, backend__identity_alwaysOneAssertionPerFlow, ProofLib.Filter;
  var p := (a: backend__identity_Assertion) => (a.token == token);
  var ax :| ax in s.identity.assertions && ax.token == token;
  ProofLib.FilterMember(p, s.identity.assertions, ax);
  var res := ProofLib.Filter(p, s.identity.assertions);
  assert |res| > 0;
  ProofLib.FilterMember(p, s.identity.assertions, res[0]);
}

lemma IdentityConsumeValid(s: Accounts, after: Accounts, token: int)
  requires alwaysIdentityStoreValid(s) && backend__identity_canConsume(s.identity, token, backend__identity_Audience.PointsWeb)
  requires after.identity == backend__identity_consume(s.identity, token, backend__identity_Audience.PointsWeb)
  ensures alwaysIdentityStoreValid(after)
  ensures after.identity.now == s.identity.now
  ensures forall t :: t in s.identity.consumedTokens ==> t in after.identity.consumedTokens
  ensures token in after.identity.consumedTokens
{
  hide *;
  IdentityStoreIsInv(s);
  backend__identity_consume_ensures(s.identity, token, backend__identity_Audience.PointsWeb);
  reveal alwaysIdentityStoreValid, backend__identity_inv, backend__identity_consume;
  forall a | a in after.identity.assertions
    ensures a.github.login != ""
  {
    var k :| 0 <= k < |after.identity.assertions| && after.identity.assertions[k] == a;
    assert s.identity.assertions[k] in s.identity.assertions;
  }
}

lemma IdentityOnlyFrame(s: Accounts, after: Accounts, via: string)
  requires inv(s) && after == s.(identity := after.identity) && after.identity.now == s.now
  requires alwaysIdentityStoreValid(after)
  requires forall t :: t in s.identity.consumedTokens ==> t in after.identity.consumedTokens
  requires via != "revokeSession" && via != "startX" && via != "claimXCallback" && via != "commitX" && via != "failX" && via != "disconnectX" && via != "publishX"
  ensures inv(after)
  ensures stepMembersPermanent(s, after) && stepSessionIdsFresh(s, after) && stepNoNewParticipationAward(s, after)
  ensures stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after) && stepSessionLifetimeFixedAtSignIn(s, after)
  ensures stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after) && stepClosureCancelsWaitingMail(s, after)
  ensures stepClosedAtStable(s, after) && stepTelegramFrozen(s, after) && stepXReservationsPermanent(s, after)
  ensures stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after) && stepConsentOnlyFromExplicitChoice(s, via, after)
  ensures stepEmailHistoryRetained(s, after)
{
  hide *;
  reveal inv;
  assert s.identity.now == s.now by { reveal alwaysClockShared; }
  KeepMembersIdentified(s, after);
  KeepSessions(s, after);
  KeepClockShared(s, after);
  KeepParticipationAwards(s, after);
  KeepRefusalsConsumed(s, after);
  KeepPublicMembershipIsOpen(s, after);
  KeepClosedPrivate(s, after);
  KeepXRegistryValid(s, after);
  KeepXLinkReserved(s, after);
  KeepXLinkPublicWhenRecent(s, after);
  KeepEmailValid(s, after);
  KeepOutbox(s, after);
  StepSameMembers(s, after, via);
  StepSameSessions(s, after);
  StepSameXClaims(s, after);
  StepNonX(s, after, via);
}

lemma XRegistryFilterFlowsValid(r: backend__xConnection_XRegistry, now: int, keep: backend__xConnection_XFlow -> bool)
  requires backend__xConnection_registryWellFormed(r, now)
  ensures backend__xConnection_registryWellFormed(r.(flows := ProofLib.Filter(keep, r.flows)), now)
{
  hide *;
  reveal backend__xConnection_registryWellFormed, ProofLib.Filter;
  var fs := ProofLib.Filter(keep, r.flows);
  forall f | f in fs
    ensures f in r.flows
    ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.id == f.id), fs)| == 1
    ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.actor == f.actor), fs)| == 1
  {
    ProofLib.FilterMember(keep, r.flows, f);
    FilterSubseqKeepsCountOne(keep, (g: backend__xConnection_XFlow) => (g.id == f.id), r.flows, f);
    FilterSubseqKeepsCountOne(keep, (g: backend__xConnection_XFlow) => (g.actor == f.actor), r.flows, f);
  }
}

lemma XClaimOwnerProps(r: backend__xConnection_XRegistry, now: int, xId: string)
  requires backend__xConnection_registryWellFormed(r, now)
  ensures backend__xConnection_claimOwner(r, xId) == 0 ==> !(exists c :: c in r.claims && c.xId == xId)
  ensures backend__xConnection_claimOwner(r, xId) > 0 ==> exists c :: c in r.claims && c.xId == xId && c.actor == backend__xConnection_claimOwner(r, xId)
{
  hide *;
  reveal backend__xConnection_registryWellFormed, backend__xConnection_claimOwner, ProofLib.Filter;
  var p := (c: backend__xConnection_XClaim) => (c.xId == xId);
  var res := ProofLib.Filter(p, r.claims);
  if |res| > 0 {
    ProofLib.FilterMember(p, r.claims, res[0]);
  } else {
    ProofLib.FilterNone(p, r.claims);
  }
}

lemma XClaimOwnerAppend(r: backend__xConnection_XRegistry, now: int, added: backend__xConnection_XClaim, xId: string)
  requires backend__xConnection_registryWellFormed(r, now) && added.xId != "" && added.actor > 0
  requires !(exists c :: c in r.claims && c.xId == added.xId)
  ensures backend__xConnection_claimOwner(r.(claims := r.claims + [added]), xId)
    == (if xId == added.xId then added.actor else backend__xConnection_claimOwner(r, xId))
{
  hide *;
  reveal backend__xConnection_claimOwner, ProofLib.Filter;
  var p := (c: backend__xConnection_XClaim) => (c.xId == xId);
  ProofLib.FilterAppend(p, r.claims, added);
  if xId == added.xId {
    ProofLib.FilterNone(p, r.claims);
  }
}

lemma XFlowByIdHit(r: backend__xConnection_XRegistry, now: int, flowId: int)
  requires backend__xConnection_registryWellFormed(r, now) && flowId > 0
  requires backend__xConnection_xFlowById(r, flowId).status.XProcessing?
  ensures backend__xConnection_xFlowById(r, flowId) in r.flows && backend__xConnection_xFlowById(r, flowId).id == flowId
{
  hide *;
  reveal backend__xConnection_xFlowById, backend__xConnection_absentXFlow, ProofLib.Filter;
  var p := (f: backend__xConnection_XFlow) => (f.id == flowId);
  var res := ProofLib.Filter(p, r.flows);
  assert |res| > 0;
  ProofLib.FilterMember(p, r.flows, res[0]);
}

lemma ReplaceMemberPreservesUnchanged(s: Accounts, i: int, changed: Member, after: Accounts)
  requires inv(s) && 0 <= i < |s.members|
  requires changed.actor == s.members[i].actor && changed.githubId == s.members[i].githubId
  requires changed.login != "" && changed.joinedAt == s.members[i].joinedAt && changed.email.actor == changed.githubId
  requires after.members == replaceMember(s.members, changed)
  ensures |after.members| == |s.members| && after.members[i] == changed
  ensures forall j :: 0 <= j < |s.members| && j != i ==> after.members[j] == s.members[j]
  ensures alwaysMembersIdentified(after)
  ensures stepMembersPermanent(s, after)
  ensures forall j :: 0 <= j < |s.members| ==> memberByActor(s, s.members[j].actor) == s.members[j] && memberByActor(after, after.members[j].actor) == after.members[j]
{
  hide *;
  reveal inv, stepMembersPermanent;
  MemberFieldsValid(s, i);
  ReplaceMemberAt(s, i, changed);
  KeepMembersIdentified(s.(members := replaceMember(s.members, changed)), after);
  forall j | 0 <= j < |s.members|
    ensures memberByActor(s, s.members[j].actor) == s.members[j]
    ensures memberByActor(after, after.members[j].actor) == after.members[j]
  {
    MemberByActorAt(s, j);
    MemberByActorAt(after, j);
  }
}

lemma WithEmailMemberFrame(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts, via: string)
  requires inv(s) && 0 <= i < |s.members| && e'.actor == s.members[i].githubId
  requires after.members == withEmail(s, s.members[i], e')
  requires after.now == s.now && after.identity == s.identity && after.sessions == s.sessions
  requires after.lastSession == s.lastSession && after.xRegistry == s.xRegistry && after.xAwards == s.xAwards
  requires after.telegramClaims == s.telegramClaims && after.refusedSignIns == s.refusedSignIns
  requires after.lastEmailId >= s.lastEmailId && after.lastVersion >= s.lastVersion && after.lastUnsubscribe >= s.lastUnsubscribe
  requires via != "signIn" && via != "reopen" && via != "revokeSession" && via != "startX" && via != "claimXCallback" && via != "commitX" && via != "failX" && via != "disconnectX" && via != "publishX"
  ensures alwaysMembersIdentified(after) && alwaysSessionsBelongToOpenMembers(after) && alwaysClockShared(after)
  ensures alwaysIdentityStoreValid(after) && alwaysParticipationAwardsHistorical(after) && alwaysRefusalsConsumed(after)
  ensures alwaysPublicMembershipIsOpen(after) && alwaysXRegistryValid(after) && alwaysXLinkReserved(after) && alwaysXLinkPublicWhenRecent(after)
  ensures stepMembersPermanent(s, after) && stepSessionIdsFresh(s, after) && stepNoNewParticipationAward(s, after)
  ensures stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after) && stepSessionLifetimeFixedAtSignIn(s, after)
  ensures stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after) && stepClosureCancelsWaitingMail(s, after)
  ensures stepClosedAtStable(s, after) && stepTelegramFrozen(s, after) && stepXReservationsPermanent(s, after)
  ensures stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after)
  ensures |after.members| == |s.members|
  ensures forall j :: 0 <= j < |s.members| ==> after.members[j] == (if j == i then s.members[i].(email := e') else s.members[j])
  ensures forall j :: 0 <= j < |s.members| ==> memberByActor(s, s.members[j].actor) == s.members[j] && memberByActor(after, after.members[j].actor) == after.members[j]
{
  hide *;
  reveal inv, withEmail;
  MemberFieldsValid(s, i);
  var changed := s.members[i].(email := e');
  ReplaceMemberPreservesUnchanged(s, i, changed, after);
  assert forall m :: m in s.members && m.membership.Open? ==> exists n :: n in after.members && n.actor == m.actor && n.membership.Open? by {
    forall m | m in s.members && m.membership.Open?
      ensures exists n :: n in after.members && n.actor == m.actor && n.membership.Open?
    {
      var j :| 0 <= j < |s.members| && s.members[j] == m;
      assert after.members[j].actor == m.actor && after.members[j].membership.Open?;
    }
  }
  KeepSessions(s, after);
  KeepClockShared(s, after);
  KeepIdentityStoreValid(s, after);
  KeepParticipationAwards(s, after);
  KeepRefusalsConsumed(s, after);
  KeepXRegistryValid(s, after);
  StepSameSessions(s, after);
  StepSameXClaims(s, after);
  StepNonX(s, after, via);
  assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
  assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved; }
  assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
  assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
  assert stepSignInPreservesEmail(s, via, after) by { reveal stepSignInPreservesEmail; }
  assert stepPublicationOnlyBySignIn(s, via, after) by { reveal stepPublicationOnlyBySignIn; }
  assert stepRevocationStaysInAccount(s, via, after) by { reveal stepRevocationStaysInAccount; }
  assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
  assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
  assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
  assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
}

lemma SyncMailPreservesOutbox(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts)
  requires inv(s) && 0 <= i < |s.members| && alwaysMembersIdentified(after)
  requires |after.members| == |s.members|
  requires forall j :: 0 <= j < |s.members| ==> after.members[j] == (if j == i then s.members[i].(email := e') else s.members[j])
  requires e'.actor == s.members[i].githubId
  requires e'.preference.revision >= s.members[i].email.preference.revision
  requires e'.destination.version >= s.members[i].email.destination.version
  requires after.inbox == syncMail(e', s.inbox)
  ensures alwaysOutboxSeesCurrentConsent(after)
{
  hide *;
  reveal inv, alwaysOutboxSeesCurrentConsent, mailView, syncMail,
    operations__notifications_canObserveEnrollment, operations__notifications_observeEnrollment,
    operations__notifications_withSnapshot, hasGithubMember;
  MemberFieldsValid(s, i);
  MembersUnique(s);
  var m := s.members[i];
  var prior := operations__notifications_enrollmentOf(s.inbox, m.githubId);
  assert mailView(prior) == mailView(m.email);
  assert operations__notifications_canObserveEnrollment(s.inbox, operations__notifications_accountService, e');
  assert after.inbox == operations__notifications_observeEnrollment(s.inbox, operations__notifications_accountService, e');
  forall j | 0 <= j < |after.members|
    ensures mailView(operations__notifications_enrollmentOf(after.inbox, after.members[j].githubId)) == mailView(after.members[j].email)
  {
    WithSnapshotEnrollmentOf(s.inbox, after.inbox, e', after.members[j].githubId);
    if j != i {
      assert s.members[j] in s.members && after.members[j].githubId != m.githubId;
    }
  }
  forall e | e in after.inbox.enrollments
    ensures hasGithubMember(after, e.actor)
  {
    if e == e' {
      assert after.members[i].githubId == e'.actor;
    } else {
      assert e in s.inbox.enrollments;
      var k :| 0 <= k < |s.members| && s.members[k].githubId == e.actor;
      assert after.members[k].githubId == e.actor;
    }
  }
}

lemma EmailValidAfterSameIds(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.now == s.now && after.lastEmailId >= s.lastEmailId && after.lastVersion >= s.lastVersion && after.lastUnsubscribe >= s.lastUnsubscribe
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == (if j == i then e' else s.members[j].email)
  requires backend__email_wellFormed(e', after.now)
  requires e'.destination.version <= after.lastVersion && e'.preference.version <= after.lastVersion && e'.pilotVersion <= after.lastVersion
  requires !e'.preference.stored ==> e'.preference.revision == 0 && e'.preference.version == 0
  requires e'.destination.version == s.members[i].email.destination.version || e'.destination.version > s.lastVersion
  requires e'.unsubscribeTokens == s.members[i].email.unsubscribeTokens
  requires |e'.verifications| == |s.members[i].email.verifications|
  requires forall k :: 0 <= k < |e'.verifications| ==> e'.verifications[k].id == s.members[i].email.verifications[k].id
  ensures alwaysEmailValid(after)
{
  hide *;
  reveal alwaysEmailValid;
  forall j | 0 <= j < |after.members|
    ensures backend__email_wellFormed(after.members[j].email, after.now)
    ensures after.members[j].email.destination.version <= after.lastVersion && after.members[j].email.preference.version <= after.lastVersion && after.members[j].email.pilotVersion <= after.lastVersion
    ensures !after.members[j].email.preference.stored ==> after.members[j].email.preference.revision == 0 && after.members[j].email.preference.version == 0
    ensures forall v :: v in after.members[j].email.verifications ==> v.id <= after.lastEmailId && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists w :: w in o.email.verifications && w.id == v.id))
    ensures forall t :: t in after.members[j].email.unsubscribeTokens ==> t.token <= after.lastUnsubscribe && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token))
    ensures after.members[j].email.destination.version > 0 ==> forall o :: o in after.members && o.githubId != after.members[j].githubId ==> o.email.destination.version != after.members[j].email.destination.version
  {
    assert s.members[j] in s.members;
    forall v | v in after.members[j].email.verifications
      ensures v.id <= after.lastEmailId
      ensures forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists w :: w in o.email.verifications && w.id == v.id)
    {
      var vi :| 0 <= vi < |after.members[j].email.verifications| && after.members[j].email.verifications[vi] == v;
      assert s.members[j].email.verifications[vi].id == v.id;
      forall o | o in after.members && o.githubId != after.members[j].githubId
        ensures !(exists w :: w in o.email.verifications && w.id == v.id)
      {
        var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
        assert s.members[oi] in s.members;
        forall wi | 0 <= wi < |o.email.verifications| ensures o.email.verifications[wi].id != v.id {
          assert s.members[oi].email.verifications[wi].id == o.email.verifications[wi].id;
        }
      }
    }
    forall t | t in after.members[j].email.unsubscribeTokens
      ensures t.token <= after.lastUnsubscribe
      ensures forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
    {
      forall o | o in after.members && o.githubId != after.members[j].githubId
        ensures !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
      {
        var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
        assert s.members[oi] in s.members;
      }
    }
    if after.members[j].email.destination.version > 0 {
      forall o | o in after.members && o.githubId != after.members[j].githubId
        ensures o.email.destination.version != after.members[j].email.destination.version
      {
        var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
        assert s.members[oi] in s.members;
      }
    }
  }
}

lemma EmailVerifIdsFromInv(s: Accounts)
  requires alwaysEmailValid(s)
  ensures forall j :: 0 <= j < |s.members| ==> forall v :: v in s.members[j].email.verifications ==> v.id <= s.lastEmailId
  ensures forall j, oi :: 0 <= j < |s.members| && 0 <= oi < |s.members| && s.members[oi].githubId != s.members[j].githubId ==>
    forall v, w :: v in s.members[j].email.verifications && w in s.members[oi].email.verifications ==> w.id != v.id
{
  hide *;
  reveal alwaysEmailValid;
  forall j | 0 <= j < |s.members|
    ensures forall v :: v in s.members[j].email.verifications ==> v.id <= s.lastEmailId
    ensures forall oi :: 0 <= oi < |s.members| && s.members[oi].githubId != s.members[j].githubId ==>
      forall v, w :: v in s.members[j].email.verifications && w in s.members[oi].email.verifications ==> w.id != v.id
  {
    assert s.members[j] in s.members;
    forall oi | 0 <= oi < |s.members| && s.members[oi].githubId != s.members[j].githubId
      ensures forall v, w :: v in s.members[j].email.verifications && w in s.members[oi].email.verifications ==> w.id != v.id
    {
      assert s.members[oi] in s.members;
    }
  }
}

lemma EmailAppendVerifIdsDistinct(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts, nid: int)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.lastEmailId == nid && nid == s.lastEmailId + 1
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == (if j == i then e' else s.members[j].email)
  requires |e'.verifications| == |s.members[i].email.verifications| + 1
  requires forall k :: 0 <= k < |s.members[i].email.verifications| ==> e'.verifications[k].id == s.members[i].email.verifications[k].id
  requires e'.verifications[|s.members[i].email.verifications|].id == nid
  ensures forall m :: m in after.members ==> forall v :: v in m.email.verifications ==>
    v.id <= after.lastEmailId
    && !(exists o :: o in after.members && !(o.githubId == m.githubId || !(exists w :: w in o.email.verifications && w.id == v.id)))
{
  hide *;
  EmailVerifIdsFromInv(s);
  forall m | m in after.members
    ensures forall v :: v in m.email.verifications ==>
      v.id <= after.lastEmailId
      && !(exists o :: o in after.members && !(o.githubId == m.githubId || !(exists w :: w in o.email.verifications && w.id == v.id)))
  {
    var j :| 0 <= j < |after.members| && after.members[j] == m;
    forall v | v in m.email.verifications
      ensures v.id <= after.lastEmailId
      ensures !(exists o :: o in after.members && !(o.githubId == m.githubId || !(exists w :: w in o.email.verifications && w.id == v.id)))
    {
      var vi :| 0 <= vi < |m.email.verifications| && m.email.verifications[vi] == v;
      if j == i && vi == |s.members[i].email.verifications| {
        assert v.id == nid;
        forall o | o in after.members && o.githubId != m.githubId
          ensures !(exists w :: w in o.email.verifications && w.id == v.id)
        {
          var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
          assert oi != i;
        }
      } else {
        assert s.members[j].email.verifications[vi] in s.members[j].email.verifications;
        assert v.id == s.members[j].email.verifications[vi].id && v.id <= s.lastEmailId;
        forall o | o in after.members && o.githubId != m.githubId
          ensures !(exists w :: w in o.email.verifications && w.id == v.id)
        {
          var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
          forall wi | 0 <= wi < |o.email.verifications| ensures o.email.verifications[wi].id != v.id {
            if oi == i && wi == |s.members[i].email.verifications| {
              assert o.email.verifications[wi].id == nid > s.lastEmailId;
            } else {
              assert s.members[oi].email.verifications[wi] in s.members[oi].email.verifications;
              assert s.members[oi].email.verifications[wi].id == o.email.verifications[wi].id;
            }
          }
        }
      }
    }
  }
}

lemma EmailAppendOtherFields(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.now == s.now && after.lastVersion == s.lastVersion && after.lastUnsubscribe == s.lastUnsubscribe
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == (if j == i then e' else s.members[j].email)
  requires backend__email_wellFormed(e', after.now)
  requires e'.destination == s.members[i].email.destination && e'.preference == s.members[i].email.preference && e'.pilotVersion == s.members[i].email.pilotVersion
  requires e'.unsubscribeTokens == s.members[i].email.unsubscribeTokens
  ensures after.lastVersion >= 0 && after.lastUnsubscribe >= 0
  ensures forall m :: m in after.members ==>
    backend__email_wellFormed(m.email, after.now)
    && m.email.destination.version <= after.lastVersion
    && m.email.preference.version <= after.lastVersion
    && m.email.pilotVersion <= after.lastVersion
    && (!m.email.preference.stored ==> m.email.preference.revision == 0 && m.email.preference.version == 0)
    && !(exists t :: t in m.email.unsubscribeTokens && !(t.token <= after.lastUnsubscribe && !(exists o :: o in after.members && !(o.githubId == m.githubId || !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)))))
    && (m.email.destination.version > 0 ==> !(exists o :: o in after.members && !(o.githubId == m.githubId || o.email.destination.version != m.email.destination.version)))
{
  hide *;
  reveal alwaysEmailValid;
  forall m | m in after.members
    ensures backend__email_wellFormed(m.email, after.now)
    ensures m.email.destination.version <= after.lastVersion && m.email.preference.version <= after.lastVersion && m.email.pilotVersion <= after.lastVersion
    ensures !m.email.preference.stored ==> m.email.preference.revision == 0 && m.email.preference.version == 0
    ensures !(exists t :: t in m.email.unsubscribeTokens && !(t.token <= after.lastUnsubscribe && !(exists o :: o in after.members && !(o.githubId == m.githubId || !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)))))
    ensures m.email.destination.version > 0 ==> !(exists o :: o in after.members && !(o.githubId == m.githubId || o.email.destination.version != m.email.destination.version))
  {
    var j :| 0 <= j < |after.members| && after.members[j] == m;
    assert s.members[j] in s.members;
    forall o | o in after.members && o.githubId != m.githubId
      ensures forall t :: t in m.email.unsubscribeTokens ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
      ensures m.email.destination.version > 0 ==> o.email.destination.version != m.email.destination.version
    {
      var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
      assert s.members[oi] in s.members;
    }
  }
}

lemma EmailValidAfterAppendVerification(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts, nid: int)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.now == s.now && after.lastEmailId == nid && nid == s.lastEmailId + 1 && after.lastVersion == s.lastVersion && after.lastUnsubscribe == s.lastUnsubscribe
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == (if j == i then e' else s.members[j].email)
  requires backend__email_wellFormed(e', after.now)
  requires e'.destination == s.members[i].email.destination && e'.preference == s.members[i].email.preference && e'.pilotVersion == s.members[i].email.pilotVersion
  requires e'.unsubscribeTokens == s.members[i].email.unsubscribeTokens
  requires |e'.verifications| == |s.members[i].email.verifications| + 1
  requires forall k :: 0 <= k < |s.members[i].email.verifications| ==> e'.verifications[k].id == s.members[i].email.verifications[k].id
  requires e'.verifications[|s.members[i].email.verifications|].id == nid
  ensures alwaysEmailValid(after)
{
  hide *;
  EmailAppendVerifIdsDistinct(s, i, e', after, nid);
  EmailAppendOtherFields(s, i, e', after);
  assert s.lastEmailId >= 0 by { reveal alwaysEmailValid; }
  reveal alwaysEmailValid;
}

lemma EmailValidAfterAppendUnsubscribe(s: Accounts, i: int, e': backend__email_Enrollment, after: Accounts, tok: int)
  requires alwaysEmailValid(s) && 0 <= i < |s.members| && |after.members| == |s.members|
  requires after.now == s.now && after.lastEmailId == s.lastEmailId && after.lastVersion == s.lastVersion && after.lastUnsubscribe == tok && tok == s.lastUnsubscribe + 1
  requires forall j :: 0 <= j < |s.members| ==> after.members[j].githubId == s.members[j].githubId && after.members[j].email == (if j == i then e' else s.members[j].email)
  requires backend__email_wellFormed(e', after.now)
  requires e'.verifications == s.members[i].email.verifications && e'.destination == s.members[i].email.destination && e'.preference == s.members[i].email.preference && e'.pilotVersion == s.members[i].email.pilotVersion
  requires e'.unsubscribeTokens == s.members[i].email.unsubscribeTokens + [backend__email_UnsubscribeToken(tok, s.members[i].email.destination.version)]
  ensures alwaysEmailValid(after)
{
  hide *;
  reveal alwaysEmailValid;
  forall j | 0 <= j < |after.members|
    ensures backend__email_wellFormed(after.members[j].email, after.now)
    ensures after.members[j].email.destination.version <= after.lastVersion && after.members[j].email.preference.version <= after.lastVersion && after.members[j].email.pilotVersion <= after.lastVersion
    ensures !after.members[j].email.preference.stored ==> after.members[j].email.preference.revision == 0 && after.members[j].email.preference.version == 0
    ensures forall v :: v in after.members[j].email.verifications ==> v.id <= after.lastEmailId && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists w :: w in o.email.verifications && w.id == v.id))
    ensures forall t :: t in after.members[j].email.unsubscribeTokens ==> t.token <= after.lastUnsubscribe && (forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token))
    ensures after.members[j].email.destination.version > 0 ==> forall o :: o in after.members && o.githubId != after.members[j].githubId ==> o.email.destination.version != after.members[j].email.destination.version
  {
    assert s.members[j] in s.members;
    forall v | v in after.members[j].email.verifications
      ensures v.id <= after.lastEmailId
      ensures forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists w :: w in o.email.verifications && w.id == v.id)
    {
      forall o | o in after.members && o.githubId != after.members[j].githubId
        ensures !(exists w :: w in o.email.verifications && w.id == v.id)
      {
        var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
        assert s.members[oi] in s.members;
      }
    }
    forall t | t in after.members[j].email.unsubscribeTokens
      ensures t.token <= after.lastUnsubscribe
      ensures forall o :: o in after.members && o.githubId != after.members[j].githubId ==> !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
    {
      var ti :| 0 <= ti < |after.members[j].email.unsubscribeTokens| && after.members[j].email.unsubscribeTokens[ti] == t;
      if j == i && ti == |s.members[i].email.unsubscribeTokens| {
        assert t.token == tok;
        forall o | o in after.members && o.githubId != after.members[j].githubId
          ensures !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
        {
          var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
          assert oi != i && s.members[oi] in s.members;
        }
      } else {
        assert s.members[j].email.unsubscribeTokens[ti] == t && t.token <= s.lastUnsubscribe;
        forall o | o in after.members && o.githubId != after.members[j].githubId
          ensures !(exists u :: u in o.email.unsubscribeTokens && u.token == t.token)
        {
          var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
          assert s.members[oi] in s.members;
          forall ui | 0 <= ui < |o.email.unsubscribeTokens| ensures o.email.unsubscribeTokens[ui].token != t.token {
            if oi == i && ui == |s.members[i].email.unsubscribeTokens| {
              assert o.email.unsubscribeTokens[ui].token == tok > s.lastUnsubscribe;
            } else {
              assert s.members[oi].email.unsubscribeTokens[ui] == o.email.unsubscribeTokens[ui];
            }
          }
        }
      }
    }
    if after.members[j].email.destination.version > 0 {
      forall o | o in after.members && o.githubId != after.members[j].githubId
        ensures o.email.destination.version != after.members[j].email.destination.version
      {
        var oi :| 0 <= oi < |after.members| && after.members[oi] == o;
        assert s.members[oi] in s.members;
      }
    }
  }
}

lemma VerificationByTokenHit(e: backend__email_Enrollment, now: int, token: int)
  requires backend__email_wellFormed(e, now) && token > 0
  requires backend__email_pending(backend__email_verificationByToken(e, token), now)
  ensures exists vi ::
      0 <= vi < |e.verifications|
      && e.verifications[vi] == backend__email_verificationByToken(e, token)
      && e.verifications[vi].tokenDigest == token
      && (forall j :: 0 <= j < |e.verifications| && j != vi ==> e.verifications[j].tokenDigest != token)
{
  hide *;
  reveal backend__email_wellFormed, backend__email_pending, backend__email_verificationByToken, ProofLib.Filter;
  var p := (v: backend__email_Verification) => (v.tokenDigest == token);
  var res := ProofLib.Filter(p, e.verifications);
  assert |res| > 0;
  ProofLib.FilterMember(p, e.verifications, res[0]);
  var vi :| 0 <= vi < |e.verifications| && e.verifications[vi] == res[0];
  forall j | 0 <= j < |e.verifications| && j != vi
    ensures e.verifications[j].tokenDigest != token
  {
    var v := e.verifications[vi];
    assert v in e.verifications && e.verifications[j] in e.verifications;
    ProofLib.FilterCountOneIffUnique((o: backend__email_Verification) => (o.id == v.id), e.verifications, (o: backend__email_Verification) => o.id, vi);
  }
}

lemma UnsubscribeHolderHit(s: Accounts, token: int)
  requires inv(s) && canUnsubscribe(s, token)
  ensures exists i :: 0 <= i < |s.members| && s.members[i] == unsubscribeHolder(s, token)
{
  hide *;
  reveal canUnsubscribe, unsubscribeHolder, absentMember, ProofLib.Filter;
  var p := (m: Member) => (exists t :: t in m.email.unsubscribeTokens && (t.token == token));
  var res := ProofLib.Filter(p, s.members);
  assert |res| > 0;
  ProofLib.FilterMember(p, s.members, res[0]);
  var i :| 0 <= i < |s.members| && s.members[i] == res[0];
}

lemma UnsubscribeTokenExists(e: backend__email_Enrollment, token: int)
  requires backend__email_canUnsubscribe(e, token)
  ensures exists t :: t in e.unsubscribeTokens && t.token == token && t.version == e.destination.version && t.version == e.preference.version && t.version > 0
{
  hide *;
  reveal backend__email_canUnsubscribe, backend__email_unsubscribeVersion, ProofLib.Filter;
  var p := (t: backend__email_UnsubscribeToken) => (t.token == token);
  var res := ProofLib.Filter(p, e.unsubscribeTokens);
  assert |res| > 0;
  ProofLib.FilterMember(p, e.unsubscribeTokens, res[0]);
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  hide *;
  reveal inv, initialHolds, initial, legacyMember, launchClock, participationPointsEnd, launchIdentity,
    launchGithubOld, launchGithubNew, backend__identity_flowLifetime, backend__identity_assertionLifetime,
    backend__email_noDestination, backend__email_noPreference, operations__notifications_initial, typed0_backend__accounts;
  var s := initial;
  assert alwaysMembersIdentified(s) by {
    reveal alwaysMembersIdentified, backend__email_newEnrollment, ProofLib.Filter;
    ProofLib.FilterOne((o: Member) => (o.githubId == legacyMember.githubId), s.members, 0);
    ProofLib.FilterOne((o: Member) => (o.actor == legacyMember.actor), s.members, 0);
  }
  assert alwaysSessionsBelongToOpenMembers(s) by { reveal alwaysSessionsBelongToOpenMembers; }
  assert alwaysClockShared(s) by { reveal alwaysClockShared; }
  assert alwaysIdentityStoreValid(s) by {
    reveal alwaysIdentityStoreValid, backend__identity_alwaysFlowsWellFormed, backend__identity_alwaysFlowIdsUnique,
      backend__identity_alwaysRateWindowsCounted, backend__identity_alwaysOneAssertionPerFlow, backend__identity_alwaysIssuedOnce,
      backend__identity_alwaysIssuedFlowsClosed, backend__identity_alwaysConsumedOnce, backend__identity_alwaysConsumedBeforeExpiry,
      backend__identity_alwaysIdentityAfterCallback, backend__identity_alwaysAssertionsMatchTheirFlow,
      backend__identity_alwaysVerifierOnlyWhilePending, backend__identity_alwaysLocalFlowsHaveNoAssertion,
      backend__identity_alwaysBoundOnlyForWebsite, backend__identity_websiteFlow, backend__identity_identityComplete,
      backend__identity_hasAssertion, backend__identity_assertionFor, ProofLib.Filter;
    var id := s.identity;
    forall i | 0 <= i < |id.flows|
      ensures |ProofLib.Filter((g: backend__identity_Flow) => (g.id == id.flows[i].id), id.flows)| == 1
    {
      ProofLib.FilterOne((g: backend__identity_Flow) => (g.id == id.flows[i].id), id.flows, i);
    }
    forall i | 0 <= i < |id.issued|
      ensures |ProofLib.Filter((x: int) => (x == id.issued[i]), id.issued)| == 1
    {
      ProofLib.FilterOne((x: int) => (x == id.issued[i]), id.issued, i);
    }
    forall i | 0 <= i < |id.assertions|
      ensures |ProofLib.Filter((b: backend__identity_Assertion) => (b.token == id.assertions[i].token), id.assertions)| == 1
    {
      ProofLib.FilterOne((b: backend__identity_Assertion) => (b.token == id.assertions[i].token), id.assertions, i);
    }
    forall i | 0 <= i < |id.flows|
      ensures backend__identity_assertionFor(id, id.flows[i].id) == id.assertions[i]
    {
      FilterSingleValue((a: backend__identity_Assertion) => (a.token == id.flows[i].id), id.assertions, i);
    }
  }
  assert alwaysParticipationAwardsHistorical(s) by { reveal alwaysParticipationAwardsHistorical; }
  assert alwaysRefusalsConsumed(s) by { reveal alwaysRefusalsConsumed; }
  assert alwaysPublicMembershipIsOpen(s) by { reveal alwaysPublicMembershipIsOpen; }
  assert alwaysClosedPrivate(s) by { reveal alwaysClosedPrivate; }
  assert alwaysXRegistryValid(s) by {
    reveal alwaysXRegistryValid, backend__xConnection_registryWellFormed, ProofLib.Filter;
    ProofLib.FilterOne((d: backend__xConnection_XClaim) => (d.xId == s.xRegistry.claims[0].xId), s.xRegistry.claims, 0);
  }
  assert alwaysXLinkReserved(s) by {
    reveal alwaysXLinkReserved, backend__xConnection_claimOwner, ProofLib.Filter;
    FilterSingleValue((c: backend__xConnection_XClaim) => (c.xId == legacyMember.xLink.xId), s.xRegistry.claims, 0);
  }
  assert alwaysXLinkPublicWhenRecent(s) by { reveal alwaysXLinkPublicWhenRecent; }
  assert alwaysEmailValid(s) by {
    reveal alwaysEmailValid, backend__email_wellFormed, backend__email_newEnrollment, ProofLib.Filter;
    ProofLib.FilterNil((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), legacyMember.email.verifications);
  }
  assert alwaysOutboxSeesCurrentConsent(s) by {
    reveal alwaysOutboxSeesCurrentConsent, mailView, operations__notifications_enrollmentOf, hasGithubMember, backend__email_newEnrollment, Std.Collections.Seq.FoldLeft;
    var f := (found: backend__email_Enrollment, e: backend__email_Enrollment) => (if (e.actor == 11) then e else found);
    assert s.inbox.enrollments == [legacyMember.email];
    assert Std.Collections.Seq.FoldLeft(f, backend__email_newEnrollment(11, 0), s.inbox.enrollments) == legacyMember.email;
  }
}

lemma lawRevokeKeepsOtherAccounts_ensures(s: Accounts, by_: int, target: int)
  ensures (lawRevokeKeepsOtherAccounts(s, by_, target) == true)
{
  hide *;
  reveal lawRevokeKeepsOtherAccounts, revokeSession, ProofLib.Filter;
  if canRevokeSession(s, by_, target) {
    var keep := (x: Session) => !(((x.id == target) && (x.actor == senderActor(s, by_))));
    ProofLib.FilterSamePredicate((x: Session) => !(((x.id == target) && (x.actor == senderActor(s, by_)))), keep, s.sessions);
    forall x | x in s.sessions && x.actor != senderActor(s, by_)
      ensures x in revokeSession(s, by_, target).sessions
    {
      ProofLib.FilterMember(keep, s.sessions, x);
    }
  }
}

lemma lawSignOutKeepsOtherSessions_ensures(s: Accounts, by_: int)
  ensures (lawSignOutKeepsOtherSessions(s, by_) == true)
{
  hide *;
  reveal lawSignOutKeepsOtherSessions, signOut, sessionLive, ProofLib.Filter;
  if canSignOut(s, by_) {
    var keep := (x: Session) => (x.id != by_);
    ProofLib.FilterSamePredicate((x: Session) => (x.id != by_), keep, s.sessions);
    forall x | x in signOut(s, by_).sessions
      ensures x.id != by_
    {
      ProofLib.FilterMember(keep, s.sessions, x);
    }
    forall x | x in s.sessions && x.id != by_
      ensures x in signOut(s, by_).sessions
    {
      ProofLib.FilterMember(keep, s.sessions, x);
    }
  }
}

lemma lawPeopleArePublicAndOpen_ensures(s: Accounts)
  ensures (lawPeopleArePublicAndOpen(s) == true)
{
  hide *;
  reveal lawPeopleArePublicAndOpen, alwaysPublicMembershipIsOpen, publicPeople, ProofLib.Filter;
  if alwaysPublicMembershipIsOpen(s) {
    forall m | m in publicPeople(s)
      ensures m.membership.Open?
    {
      ProofLib.FilterMember((m: Member) => m.public, s.members, m);
    }
  }
}

lemma lawClosedMemberHasNoPublicX_ensures(s: Accounts, actor: int)
  ensures (lawClosedMemberHasNoPublicX(s, actor) == true)
{
  hide *;
  reveal lawClosedMemberHasNoPublicX, alwaysClosedPrivate, publicXProfile, memberByActor, absentMember, backend__xConnection_noLink, ProofLib.Filter;
  if alwaysClosedPrivate(s) && memberByActor(s, actor).membership.Closed? {
    var p := (m: Member) => (m.actor == actor);
    var res := ProofLib.Filter(p, s.members);
    if |res| > 0 {
      ProofLib.FilterMember(p, s.members, res[0]);
    }
  }
}

lemma lawClosureInvalidatesEverySession_ensures(s: Accounts, by_: int, confirmation: string, other: int)
  ensures (lawClosureInvalidatesEverySession(s, by_, confirmation, other) == true)
{
  hide *;
  reveal lawClosureInvalidatesEverySession, canClose, close, senderActor, sessionLive, memberByActor, absentMember, ProofLib.Filter;
  if alwaysSessionsBelongToOpenMembers(s) && canClose(s, by_, confirmation) && senderActor(s, other) == senderActor(s, by_) {
    var a := senderActor(s, by_);
    var pm := (m: Member) => (m.actor == a);
    var mres := ProofLib.Filter(pm, s.members);
    assert |mres| > 0;
    ProofLib.FilterMember(pm, s.members, mres[0]);
    var m := memberByActor(s, a);
    assert m.actor == a;
    assert sessionLive(s, other);
    var x :| x in s.sessions && x.id == other && x.expiresAt > s.now;
    var xi :| 0 <= xi < |s.sessions| && s.sessions[xi] == x;
    SessionsUnique(s);
    FilterSingleValue((o: Session) => (o.id == other), s.sessions, xi);
    assert x.actor == a;
    var after := close(s, by_, confirmation);
    var keep := (o: Session) => (o.actor != m.actor);
    ProofLib.FilterSamePredicate((o: Session) => (o.actor != m.actor), keep, s.sessions);
    forall y | y in after.sessions
      ensures y.id != other
    {
      ProofLib.FilterMember(keep, s.sessions, y);
      var yi :| 0 <= yi < |s.sessions| && s.sessions[yi] == y;
      assert yi != xi;
    }
    assert !sessionLive(after, other);
  }
}

lemma signInStorageFailed_ensures(s: Accounts, token: int)
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysMembersIdentified(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysSessionsBelongToOpenMembers(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysClockShared(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysIdentityStoreValid(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysParticipationAwardsHistorical(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysRefusalsConsumed(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysPublicMembershipIsOpen(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysClosedPrivate(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysXRegistryValid(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysXLinkReserved(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysXLinkPublicWhenRecent(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysEmailValid(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> alwaysOutboxSeesCurrentConsent(signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepMembersPermanent(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepSessionIdsFresh(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepNoNewParticipationAward(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepSignInPreservesEmail(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepPublicationOnlyBySignIn(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepSessionLifetimeFixedAtSignIn(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepRevocationStaysInAccount(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepActiveMembershipNeverHidden(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepClosureCancelsWaitingMail(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepClosedAtStable(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepTelegramFrozen(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepXReservationsPermanent(s, signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepFailedXKeepsLink(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepXConfersNoOtherAuthority(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepConsentOnlyFromExplicitChoice(s, "signInStorageFailed", signInStorageFailed(s, token)))
  ensures (inv(s) ==> canSignInStorageFailed(s, token) ==> stepEmailHistoryRetained(s, signInStorageFailed(s, token)))
{
  hide *;
  if inv(s) && canSignInStorageFailed(s, token) {
    reveal inv, canSignInStorageFailed, signInStorageFailed;
    var after := signInStorageFailed(s, token);
    IdentityConsumeValid(s, after, token);
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepParticipationAwards(s, after);
    assert alwaysRefusalsConsumed(after) by { reveal alwaysRefusalsConsumed; }
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "signInStorageFailed");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "signInStorageFailed");
  }
}

lemma refuseClosedSignIn_ensures(s: Accounts, token: int)
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysMembersIdentified(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysSessionsBelongToOpenMembers(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysClockShared(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysIdentityStoreValid(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysParticipationAwardsHistorical(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysRefusalsConsumed(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysPublicMembershipIsOpen(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysClosedPrivate(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysXRegistryValid(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysXLinkReserved(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysXLinkPublicWhenRecent(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysEmailValid(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> alwaysOutboxSeesCurrentConsent(refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepMembersPermanent(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepSessionIdsFresh(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepNoNewParticipationAward(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepSignInPreservesEmail(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepPublicationOnlyBySignIn(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepSessionLifetimeFixedAtSignIn(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepRevocationStaysInAccount(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepActiveMembershipNeverHidden(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepClosureCancelsWaitingMail(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepClosedAtStable(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepTelegramFrozen(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepXReservationsPermanent(s, refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepFailedXKeepsLink(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepXConfersNoOtherAuthority(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepConsentOnlyFromExplicitChoice(s, "refuseClosedSignIn", refuseClosedSignIn(s, token)))
  ensures (inv(s) ==> canRefuseClosedSignIn(s, token) ==> stepEmailHistoryRetained(s, refuseClosedSignIn(s, token)))
{
  hide *;
  if inv(s) && canRefuseClosedSignIn(s, token) {
    reveal inv, canRefuseClosedSignIn, canSignInStorageFailed, refuseClosedSignIn, signInStorageFailed;
    var after := refuseClosedSignIn(s, token);
    assert after == signInStorageFailed(s, token);
    IdentityConsumeValid(s, after, token);
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepParticipationAwards(s, after);
    assert alwaysRefusalsConsumed(after) by { reveal alwaysRefusalsConsumed; }
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "refuseClosedSignIn");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "refuseClosedSignIn");
  }
}

lemma AdmitExistingMember(s: Accounts, token: int, via: string)
  requires inv(s) && backend__identity_canConsume(s.identity, token, backend__identity_Audience.PointsWeb)
  requires actorKeyFree(s, token) && hasGithubMember(s, assertedGithub(s, token).actor)
  requires via == "signIn" || via == "reopen"
  ensures var after := admitMember(token, s);
    inv(after)
    && stepMembersPermanent(s, after) && stepSessionIdsFresh(s, after) && stepNoNewParticipationAward(s, after)
    && stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after) && stepSessionLifetimeFixedAtSignIn(s, after)
    && stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after) && stepClosureCancelsWaitingMail(s, after)
    && stepClosedAtStable(s, after) && stepTelegramFrozen(s, after) && stepXReservationsPermanent(s, after)
    && stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after) && stepConsentOnlyFromExplicitChoice(s, via, after)
    && stepEmailHistoryRetained(s, after)
{
  hide *;
  reveal inv, admitMember, joined, assertedGithub, actorKeyFree, hasGithubMember, backend__identity_canConsume, backend__identity_consumeOutcome, ProofLib.Filter;
  var after := admitMember(token, s);
  var g := assertedGithub(s, token);
  var m := joined(s, token);
  AssertionInStore(s, token);
  IdentityConsumeValid(s, after, token);
  KeepClockShared(s, after);
  KeepParticipationAwards(s, after);
  KeepRefusalsConsumed(s, after);
  StepSameXClaims(s, after);
  StepNonX(s, after, via);
  assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
  assert stepPublicationOnlyBySignIn(s, via, after) by { reveal stepPublicationOnlyBySignIn; }
  assert stepRevocationStaysInAccount(s, via, after) by { reveal stepRevocationStaysInAccount; }
  var prior :| prior in s.members && prior.githubId == g.actor;
  var pi :| 0 <= pi < |s.members| && s.members[pi] == prior;
  MemberByGithubAt(s, pi);
  assert memberByGithub(s, g.actor) == prior;
  MemberFieldsValid(s, pi);
  ReplaceMemberPreservesUnchanged(s, pi, m, after);
  assert forall k :: k in s.members && k.membership.Open? ==> exists n :: n in after.members && n.actor == k.actor && n.membership.Open? by {
    forall k | k in s.members && k.membership.Open?
      ensures exists n :: n in after.members && n.actor == k.actor && n.membership.Open?
    {
      var ki :| 0 <= ki < |s.members| && s.members[ki] == k;
      assert after.members[ki].actor == k.actor && after.members[ki].membership.Open?;
    }
  }
  forall x | x in s.sessions
    ensures exists k :: k in after.members && k.actor == x.actor && k.membership.Open?
  {
    reveal alwaysSessionsBelongToOpenMembers;
    var k :| k in s.members && k.actor == x.actor && k.membership.Open?;
    var ki :| 0 <= ki < |s.members| && s.members[ki] == k;
    assert after.members[ki].actor == x.actor && after.members[ki].membership.Open?;
  }
  OpenSessionValid(s, m, after);
  KeepXRegistryValid(s, after);
  KeepEmailValidSameEmailField(s, pi, after);
  KeepOutboxSameMailView(s, after);
  assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
  assert alwaysClosedPrivate(after) by {
    reveal alwaysClosedPrivate, openSession;
    var keep := (x: Session) => (x.expiresAt > s.now);
    ProofLib.FilterSamePredicate((x: Session) => (x.expiresAt > s.now), keep, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions || x.actor == m.actor
    {
      if x in ProofLib.Filter(keep, s.sessions) {
        ProofLib.FilterMember(keep, s.sessions, x);
      }
    }
  }
  assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved; }
  assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
  assert stepSignInPreservesEmail(s, via, after) by { reveal stepSignInPreservesEmail; }
  assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
  assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
  assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
  assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
  assert stepConsentOnlyFromExplicitChoice(s, via, after) by { reveal stepConsentOnlyFromExplicitChoice; }
  EmailHistoryRetainedRefl(prior.email);
  StepEmailHistoryRetainedOne(s, pi, m.email, after);
}

lemma EmailValidAfterAppendNewMember(s: Accounts, m: Member, after: Accounts)
  requires alwaysEmailValid(s) && after.members == s.members + [m]
  requires after.now == s.now && after.lastEmailId == s.lastEmailId && after.lastVersion == s.lastVersion && after.lastUnsubscribe == s.lastUnsubscribe
  requires m.githubId > 0 && m.email == backend__email_newEnrollment(m.githubId, 0)
  ensures alwaysEmailValid(after)
{
  hide *;
  reveal alwaysEmailValid, backend__email_wellFormed, backend__email_newEnrollment, backend__email_noDestination, backend__email_noPreference, ProofLib.Filter;
  ProofLib.FilterNil((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), m.email.verifications);
}

lemma OutboxAfterAppendNewMember(s: Accounts, m: Member, after: Accounts)
  requires alwaysOutboxSeesCurrentConsent(s) && after.members == s.members + [m] && after.inbox == s.inbox
  requires m.email == backend__email_newEnrollment(m.githubId, 0) && !hasGithubMember(s, m.githubId)
  ensures alwaysOutboxSeesCurrentConsent(after)
{
  hide *;
  reveal alwaysOutboxSeesCurrentConsent, operations__notifications_enrollmentOf, mailView, hasGithubMember, backend__email_newEnrollment;
  assert forall k :: 0 <= k < |after.inbox.enrollments| ==> after.inbox.enrollments[k].actor != m.githubId;
  EnrollmentFoldNoMatch(after.inbox.enrollments, backend__email_newEnrollment(m.githubId, 0), m.githubId);
  forall e | e in after.inbox.enrollments ensures hasGithubMember(after, e.actor) {
    var k :| 0 <= k < |s.members| && s.members[k].githubId == e.actor;
    assert after.members[k].githubId == e.actor;
  }
}

lemma AdmitNewMember(s: Accounts, token: int, via: string)
  requires inv(s) && backend__identity_canConsume(s.identity, token, backend__identity_Audience.PointsWeb)
  requires actorKeyFree(s, token) && !hasGithubMember(s, assertedGithub(s, token).actor)
  requires via == "signIn" || via == "reopen"
  ensures var after := admitMember(token, s);
    inv(after)
    && stepMembersPermanent(s, after) && stepSessionIdsFresh(s, after) && stepNoNewParticipationAward(s, after)
    && stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after) && stepSessionLifetimeFixedAtSignIn(s, after)
    && stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after) && stepClosureCancelsWaitingMail(s, after)
    && stepClosedAtStable(s, after) && stepTelegramFrozen(s, after) && stepXReservationsPermanent(s, after)
    && stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after) && stepConsentOnlyFromExplicitChoice(s, via, after)
    && stepEmailHistoryRetained(s, after)
{
  hide *;
  reveal inv, admitMember, joined, assertedGithub, actorKeyFree, hasGithubMember, backend__identity_canConsume, backend__identity_consumeOutcome, launchClock, backend__xConnection_noLink, ProofLib.Filter;
  var after := admitMember(token, s);
  var g := assertedGithub(s, token);
  var m := joined(s, token);
  AssertionInStore(s, token);
  IdentityConsumeValid(s, after, token);
  KeepClockShared(s, after);
  KeepParticipationAwards(s, after);
  KeepRefusalsConsumed(s, after);
  StepSameXClaims(s, after);
  StepNonX(s, after, via);
  assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
  assert stepPublicationOnlyBySignIn(s, via, after) by { reveal stepPublicationOnlyBySignIn; }
  assert stepRevocationStaysInAccount(s, via, after) by { reveal stepRevocationStaysInAccount; }
  assert s.now >= launchClock by { reveal alwaysClockShared; }
  assert m.email == backend__email_newEnrollment(g.actor, 0);
  assert m.email.actor == g.actor by { reveal backend__email_newEnrollment; }
  AppendMemberValid(s, m);
  assert after.members == s.members + [m];
  KeepMembersIdentified(s.(members := s.members + [m]), after);
  forall j | 0 <= j < |s.members|
    ensures memberByActor(s, s.members[j].actor) == s.members[j]
    ensures memberByActor(after, s.members[j].actor) == s.members[j]
  {
    MemberByActorAt(s, j);
    MemberByActorAt(after, j);
  }
  MemberByActorAt(after, |s.members|);
  MemberByActorAbsent(s, m.actor);
  forall x | x in s.sessions
    ensures exists k :: k in after.members && k.actor == x.actor && k.membership.Open?
  {
    reveal alwaysSessionsBelongToOpenMembers;
    var k :| k in s.members && k.actor == x.actor && k.membership.Open?;
    assert k in after.members;
  }
  OpenSessionValid(s, m, after);
  KeepXRegistryValid(s, after);
  EmailValidAfterAppendNewMember(s, m, after);
  OutboxAfterAppendNewMember(s, m, after);
  assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
  assert alwaysClosedPrivate(after) by {
    reveal alwaysClosedPrivate, openSession;
    var keep := (x: Session) => (x.expiresAt > s.now);
    ProofLib.FilterSamePredicate((x: Session) => (x.expiresAt > s.now), keep, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions || x.actor == m.actor
    {
      if x in ProofLib.Filter(keep, s.sessions) {
        ProofLib.FilterMember(keep, s.sessions, x);
      }
    }
  }
  assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved; }
  assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
  assert stepMembersPermanent(s, after) by { reveal stepMembersPermanent; }
  assert stepSignInPreservesEmail(s, via, after) by { reveal stepSignInPreservesEmail; }
  assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
  assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
  assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
  assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
  assert stepConsentOnlyFromExplicitChoice(s, via, after) by { reveal stepConsentOnlyFromExplicitChoice, backend__email_newEnrollment, backend__email_noPreference; }
  assert stepEmailHistoryRetained(s, after) by {
    reveal stepEmailHistoryRetained;
    forall j | 0 <= j < |s.members|
      ensures backend__email_historyRetained(s.members[j].email, memberByActor(after, s.members[j].actor).email)
    {
      EmailHistoryRetainedRefl(s.members[j].email);
    }
  }
}

lemma AdmitMemberHelper(s: Accounts, token: int, via: string)
  requires inv(s) && backend__identity_canConsume(s.identity, token, backend__identity_Audience.PointsWeb)
  requires actorKeyFree(s, token)
  requires via == "signIn" || via == "reopen"
  ensures var after := admitMember(token, s);
    inv(after)
    && stepMembersPermanent(s, after) && stepSessionIdsFresh(s, after) && stepNoNewParticipationAward(s, after)
    && stepSignInPreservesEmail(s, via, after) && stepPublicationOnlyBySignIn(s, via, after) && stepSessionLifetimeFixedAtSignIn(s, after)
    && stepRevocationStaysInAccount(s, via, after) && stepActiveMembershipNeverHidden(s, after) && stepClosureCancelsWaitingMail(s, after)
    && stepClosedAtStable(s, after) && stepTelegramFrozen(s, after) && stepXReservationsPermanent(s, after)
    && stepFailedXKeepsLink(s, via, after) && stepXConfersNoOtherAuthority(s, via, after) && stepConsentOnlyFromExplicitChoice(s, via, after)
    && stepEmailHistoryRetained(s, after)
{
  hide *;
  if hasGithubMember(s, assertedGithub(s, token).actor) {
    AdmitExistingMember(s, token, via);
  } else {
    AdmitNewMember(s, token, via);
  }
}

lemma signIn_ensures(s: Accounts, token: int)
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysMembersIdentified(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysSessionsBelongToOpenMembers(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysClockShared(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysIdentityStoreValid(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysParticipationAwardsHistorical(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysRefusalsConsumed(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysPublicMembershipIsOpen(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysClosedPrivate(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysXRegistryValid(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysXLinkReserved(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysXLinkPublicWhenRecent(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysEmailValid(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> alwaysOutboxSeesCurrentConsent(signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepMembersPermanent(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepSessionIdsFresh(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepNoNewParticipationAward(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepSignInPreservesEmail(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepPublicationOnlyBySignIn(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepSessionLifetimeFixedAtSignIn(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepRevocationStaysInAccount(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepActiveMembershipNeverHidden(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepClosureCancelsWaitingMail(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepClosedAtStable(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepTelegramFrozen(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepXReservationsPermanent(s, signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepFailedXKeepsLink(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepXConfersNoOtherAuthority(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepConsentOnlyFromExplicitChoice(s, "signIn", signIn(s, token)))
  ensures (inv(s) ==> canSignIn(s, token) ==> stepEmailHistoryRetained(s, signIn(s, token)))
{
  hide *;
  if inv(s) && canSignIn(s, token) {
    reveal inv, canSignIn, signIn;
    AdmitMemberHelper(s, token, "signIn");
  }
}

lemma reopen_ensures(s: Accounts, token: int)
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysMembersIdentified(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysSessionsBelongToOpenMembers(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysClockShared(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysIdentityStoreValid(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysParticipationAwardsHistorical(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysRefusalsConsumed(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysPublicMembershipIsOpen(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysClosedPrivate(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysXRegistryValid(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysXLinkReserved(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysXLinkPublicWhenRecent(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysEmailValid(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> alwaysOutboxSeesCurrentConsent(reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepMembersPermanent(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepSessionIdsFresh(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepNoNewParticipationAward(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepSignInPreservesEmail(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepPublicationOnlyBySignIn(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepSessionLifetimeFixedAtSignIn(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepRevocationStaysInAccount(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepActiveMembershipNeverHidden(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepClosureCancelsWaitingMail(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepClosedAtStable(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepTelegramFrozen(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepXReservationsPermanent(s, reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepFailedXKeepsLink(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepXConfersNoOtherAuthority(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepConsentOnlyFromExplicitChoice(s, "reopen", reopen(s, token)))
  ensures (inv(s) ==> canReopen(s, token) ==> stepEmailHistoryRetained(s, reopen(s, token)))
{
  hide *;
  if inv(s) && canReopen(s, token) {
    reveal inv, canReopen, canRefuseClosedSignIn, actorKeyFree, reopen;
    AdmitMemberHelper(s, token, "reopen");
  }
}

lemma signOut_ensures(s: Accounts, by_: int)
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysMembersIdentified(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysSessionsBelongToOpenMembers(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysClockShared(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysIdentityStoreValid(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysParticipationAwardsHistorical(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysRefusalsConsumed(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysPublicMembershipIsOpen(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysClosedPrivate(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysXRegistryValid(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysXLinkReserved(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysXLinkPublicWhenRecent(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysEmailValid(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> alwaysOutboxSeesCurrentConsent(signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepMembersPermanent(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepSessionIdsFresh(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepNoNewParticipationAward(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepSignInPreservesEmail(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepPublicationOnlyBySignIn(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepSessionLifetimeFixedAtSignIn(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepRevocationStaysInAccount(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepActiveMembershipNeverHidden(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepClosureCancelsWaitingMail(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepClosedAtStable(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepTelegramFrozen(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepXReservationsPermanent(s, signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepFailedXKeepsLink(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepXConfersNoOtherAuthority(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepConsentOnlyFromExplicitChoice(s, "signOut", signOut(s, by_)))
  ensures (inv(s) ==> canSignOut(s, by_) ==> stepEmailHistoryRetained(s, signOut(s, by_)))
{
  hide *;
  if inv(s) && canSignOut(s, by_) {
    reveal inv, signOut, ProofLib.Filter;
    var after := signOut(s, by_);
    var keep := (x: Session) => (x.id != by_);
    ProofLib.FilterSamePredicate((x: Session) => (x.id != by_), keep, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions
      ensures exists m :: m in after.members && m.actor == x.actor && m.membership.Open?
    {
      reveal alwaysSessionsBelongToOpenMembers;
      ProofLib.FilterMember(keep, s.sessions, x);
      assert x in s.sessions;
      var m :| m in s.members && m.actor == x.actor && m.membership.Open?;
      assert m in after.members;
    }
    FilterSessionsValid(s, keep, after);
    KeepMembersIdentified(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "signOut");
    StepSameXClaims(s, after);
    StepNonX(s, after, "signOut");
  }
}

lemma advanceTime_ensures(s: Accounts, by_: int, now: int)
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysMembersIdentified(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysSessionsBelongToOpenMembers(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysClockShared(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysIdentityStoreValid(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysParticipationAwardsHistorical(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysRefusalsConsumed(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysPublicMembershipIsOpen(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysClosedPrivate(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysXRegistryValid(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysXLinkReserved(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysXLinkPublicWhenRecent(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysEmailValid(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> alwaysOutboxSeesCurrentConsent(advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepMembersPermanent(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepSessionIdsFresh(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepNoNewParticipationAward(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepSignInPreservesEmail(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepPublicationOnlyBySignIn(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepSessionLifetimeFixedAtSignIn(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepRevocationStaysInAccount(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepActiveMembershipNeverHidden(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepClosureCancelsWaitingMail(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepClosedAtStable(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepTelegramFrozen(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepXReservationsPermanent(s, advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepFailedXKeepsLink(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepXConfersNoOtherAuthority(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepConsentOnlyFromExplicitChoice(s, "advanceTime", advanceTime(s, by_, now)))
  ensures (inv(s) ==> canAdvanceTime(s, by_, now) ==> stepEmailHistoryRetained(s, advanceTime(s, by_, now)))
{
  hide *;
  if inv(s) && canAdvanceTime(s, by_, now) {
    reveal inv, canAdvanceTime, advanceTime, alwaysClockShared, backend__identity_canAdvanceTime, backend__identity_advanceTime;
    var after := advanceTime(s, by_, now);
    IdentityStoreIsInv(s);
    backend__identity_advanceTime_ensures(s.identity, by_, now);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv;
    }
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "advanceTime");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "advanceTime");
  }
}

lemma purgeExpired_ensures(s: Accounts, by_: int)
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysMembersIdentified(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysSessionsBelongToOpenMembers(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysClockShared(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysIdentityStoreValid(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysParticipationAwardsHistorical(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysRefusalsConsumed(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysPublicMembershipIsOpen(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysClosedPrivate(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysXRegistryValid(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysXLinkReserved(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysXLinkPublicWhenRecent(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysEmailValid(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> alwaysOutboxSeesCurrentConsent(purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepMembersPermanent(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepSessionIdsFresh(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepNoNewParticipationAward(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepSignInPreservesEmail(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepPublicationOnlyBySignIn(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepSessionLifetimeFixedAtSignIn(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepRevocationStaysInAccount(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepActiveMembershipNeverHidden(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepClosureCancelsWaitingMail(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepClosedAtStable(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepTelegramFrozen(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepXReservationsPermanent(s, purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepFailedXKeepsLink(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepXConfersNoOtherAuthority(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepConsentOnlyFromExplicitChoice(s, "purgeExpired", purgeExpired(s, by_)))
  ensures (inv(s) ==> canPurgeExpired(s, by_) ==> stepEmailHistoryRetained(s, purgeExpired(s, by_)))
{
  hide *;
  if inv(s) && canPurgeExpired(s, by_) {
    reveal inv, canPurgeExpired, purgeExpired, ProofLib.Filter;
    var after := purgeExpired(s, by_);
    var keepS := (x: Session) => (x.expiresAt > s.now);
    ProofLib.FilterSamePredicate((x: Session) => (x.expiresAt > s.now), keepS, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions
      ensures exists m :: m in after.members && m.actor == x.actor && m.membership.Open?
    {
      reveal alwaysSessionsBelongToOpenMembers;
      ProofLib.FilterMember(keepS, s.sessions, x);
      assert x in s.sessions;
      var m :| m in s.members && m.actor == x.actor && m.membership.Open?;
      assert m in after.members;
    }
    FilterSessionsValid(s, keepS, after);
    var keepF := (f: backend__xConnection_XFlow) => (f.expiresAt > s.now);
    ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => (f.expiresAt > s.now), keepF, s.xRegistry.flows);
    forall f | f in after.xRegistry.flows ensures f in s.xRegistry.flows {
      ProofLib.FilterMember(keepF, s.xRegistry.flows, f);
    }
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid;
      XRegistryFilterFlowsValid(s.xRegistry, s.now, keepF);
    }
    IdentityStoreIsInv(s);
    if backend__identity_canPurgeExpired(s.identity, by_) {
      backend__identity_purgeExpired_ensures(s.identity, by_);
      assert alwaysIdentityStoreValid(after) by {
        reveal alwaysIdentityStoreValid, backend__identity_inv, backend__identity_purgeExpired;
        var keepA := (a: backend__identity_Assertion) => (a.expiresAt > s.identity.now);
        ProofLib.FilterSamePredicate((a: backend__identity_Assertion) => (a.expiresAt > s.identity.now), keepA, s.identity.assertions);
        forall a | a in after.identity.assertions ensures a.github.login != "" {
          ProofLib.FilterMember(keepA, s.identity.assertions, a);
        }
      }
      assert after.identity.now == s.identity.now && after.identity.consumedTokens == s.identity.consumedTokens by {
        reveal backend__identity_purgeExpired;
      }
    } else {
      assert after.identity == s.identity by {
        reveal backend__identity_canPurgeExpired, backend__identity_purgeExpired;
        FilterAll((f: backend__identity_Flow) => (f.expiresAt > s.identity.now), s.identity.flows);
        FilterAll((a: backend__identity_Assertion) => (a.expiresAt > s.identity.now), s.identity.assertions);
        FilterAll((w: backend__identity_RateWindow) => (w.expiresAt > s.identity.now), s.identity.windows);
      }
      KeepIdentityStoreValid(s, after);
    }
    KeepMembersIdentified(s, after);
    KeepClockShared(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "purgeExpired");
    StepSameXClaims(s, after);
    StepNonX(s, after, "purgeExpired");
  }
}

lemma revokeSession_ensures(s: Accounts, by_: int, target: int)
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysMembersIdentified(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysSessionsBelongToOpenMembers(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysClockShared(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysIdentityStoreValid(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysParticipationAwardsHistorical(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysRefusalsConsumed(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysPublicMembershipIsOpen(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysClosedPrivate(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysXRegistryValid(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysXLinkReserved(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysXLinkPublicWhenRecent(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysEmailValid(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> alwaysOutboxSeesCurrentConsent(revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepMembersPermanent(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepSessionIdsFresh(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepNoNewParticipationAward(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepSignInPreservesEmail(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepPublicationOnlyBySignIn(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepSessionLifetimeFixedAtSignIn(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepRevocationStaysInAccount(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepActiveMembershipNeverHidden(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepClosureCancelsWaitingMail(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepClosedAtStable(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepTelegramFrozen(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepXReservationsPermanent(s, revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepFailedXKeepsLink(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepXConfersNoOtherAuthority(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepConsentOnlyFromExplicitChoice(s, "revokeSession", revokeSession(s, by_, target)))
  ensures (inv(s) ==> canRevokeSession(s, by_, target) ==> stepEmailHistoryRetained(s, revokeSession(s, by_, target)))
{
  hide *;
  if inv(s) && canRevokeSession(s, by_, target) {
    reveal inv, revokeSession, ProofLib.Filter;
    var after := revokeSession(s, by_, target);
    var keep := (x: Session) => !(((x.id == target) && (x.actor == senderActor(s, by_))));
    ProofLib.FilterSamePredicate((x: Session) => !(((x.id == target) && (x.actor == senderActor(s, by_)))), keep, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions
      ensures exists m :: m in after.members && m.actor == x.actor && m.membership.Open?
    {
      reveal alwaysSessionsBelongToOpenMembers;
      ProofLib.FilterMember(keep, s.sessions, x);
      assert x in s.sessions;
      var m :| m in s.members && m.actor == x.actor && m.membership.Open?;
      assert m in after.members;
    }
    FilterSessionsValid(s, keep, after);
    assert stepRevocationStaysInAccount(s, "revokeSession", after) by {
      reveal stepRevocationStaysInAccount;
      SessionsUnique(s);
      var dropped := (x: Session) => !((x in after.sessions));
      ProofLib.FilterSamePredicate((x: Session) => !((x in after.sessions)), dropped, s.sessions);
      forall i, j | 0 <= i < |s.sessions| && 0 <= j < |s.sessions| && i != j && dropped(s.sessions[i])
        ensures !dropped(s.sessions[j])
      {
        ProofLib.FilterMember(keep, s.sessions, s.sessions[i]);
        ProofLib.FilterMember(keep, s.sessions, s.sessions[j]);
      }
      FilterAtMostOne(dropped, s.sessions);
    }
    KeepMembersIdentified(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "other");
    assert stepSignInPreservesEmail(s, "revokeSession", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "revokeSession", after) by {
      reveal stepPublicationOnlyBySignIn;
      forall i | 0 <= i < |s.members| ensures memberByActor(s, s.members[i].actor) == s.members[i] { MemberByActorAt(s, i); }
    }
    assert stepConsentOnlyFromExplicitChoice(s, "revokeSession", after) by {
      reveal stepConsentOnlyFromExplicitChoice;
      forall i | 0 <= i < |s.members| ensures memberByActor(s, s.members[i].actor) == s.members[i] { MemberByActorAt(s, i); }
    }
    StepSameXClaims(s, after);
    StepNonX(s, after, "revokeSession");
  }
}

lemma publishMembership_ensures(s: Accounts, by_: int, requestPublic: bool)
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysMembersIdentified(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysSessionsBelongToOpenMembers(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysClockShared(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysIdentityStoreValid(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysParticipationAwardsHistorical(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysRefusalsConsumed(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysPublicMembershipIsOpen(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysClosedPrivate(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysXRegistryValid(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysXLinkReserved(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysXLinkPublicWhenRecent(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysEmailValid(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> alwaysOutboxSeesCurrentConsent(publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepMembersPermanent(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepSessionIdsFresh(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepNoNewParticipationAward(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepSignInPreservesEmail(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepPublicationOnlyBySignIn(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepSessionLifetimeFixedAtSignIn(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepRevocationStaysInAccount(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepActiveMembershipNeverHidden(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepClosureCancelsWaitingMail(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepClosedAtStable(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepTelegramFrozen(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepXReservationsPermanent(s, publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepFailedXKeepsLink(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepXConfersNoOtherAuthority(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepConsentOnlyFromExplicitChoice(s, "publishMembership", publishMembership(s, by_, requestPublic)))
  ensures (inv(s) ==> canPublishMembership(s, by_, requestPublic) ==> stepEmailHistoryRetained(s, publishMembership(s, by_, requestPublic)))
{
  hide *;
  if inv(s) && canPublishMembership(s, by_, requestPublic) {
    reveal inv, canPublishMembership, publishMembership;
    var after := publishMembership(s, by_, requestPublic);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    ReplaceMemberPreservesUnchanged(s, i, s.members[i].(public := true), after);
    assert forall m :: m in s.members && m.membership.Open? ==> exists n :: n in after.members && n.actor == m.actor && n.membership.Open? by {
      forall m | m in s.members && m.membership.Open?
        ensures exists n :: n in after.members && n.actor == m.actor && n.membership.Open?
      {
        var j :| 0 <= j < |s.members| && s.members[j] == m;
        assert after.members[j].actor == m.actor && after.members[j].membership.Open?;
      }
    }
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepXRegistryValid(s, after);
    KeepEmailValidSameEmailField(s, i, after);
    KeepOutboxSameMailView(s, after);
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "publishMembership");
    assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved; }
    assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
    assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
    assert stepSignInPreservesEmail(s, "publishMembership", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "publishMembership", after) by { reveal stepPublicationOnlyBySignIn; }
    assert stepRevocationStaysInAccount(s, "publishMembership", after) by { reveal stepRevocationStaysInAccount; }
    assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
    assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
    assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
    assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
    assert stepConsentOnlyFromExplicitChoice(s, "publishMembership", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    assert stepEmailHistoryRetained(s, after) by { reveal stepEmailHistoryRetained, backend__email_historyRetained; }
  }
}

lemma CloseVerifIdCount(vs: seq<backend__email_Verification>, vs': seq<backend__email_Verification>, k: int, p: backend__email_Verification -> bool)
  requires |vs'| == |vs| && 0 <= k < |vs|
  requires forall j :: 0 <= j < |vs| ==> vs'[j] == (if !vs[j].consumed then vs[j].(cancelled := true) else vs[j])
  requires |ProofLib.Filter((o: backend__email_Verification) => (o.id == vs[k].id), vs)| == 1
  requires forall o :: p(o) == (o.id == vs'[k].id)
  ensures |ProofLib.Filter(p, vs')| == 1
{
  var u := vs[k];
  var q := (o: backend__email_Verification) => (o.id == u.id);
  ProofLib.FilterSamePredicate((o: backend__email_Verification) => (o.id == vs[k].id), q, vs);
  ProofLib.FilterLengthPointwise(q, p, vs, vs');
}

lemma CloseVerifKeyCount(vs: seq<backend__email_Verification>, vs': seq<backend__email_Verification>, k: int, p: backend__email_Verification -> bool)
  requires |vs'| == |vs| && 0 <= k < |vs|
  requires forall j :: 0 <= j < |vs| ==> vs'[j] == (if !vs[j].consumed then vs[j].(cancelled := true) else vs[j])
  requires |ProofLib.Filter((o: backend__email_Verification) => (o.requestKey == vs[k].requestKey), vs)| == 1
  requires forall o :: p(o) == (o.requestKey == vs'[k].requestKey)
  ensures |ProofLib.Filter(p, vs')| == 1
{
  var u := vs[k];
  var q := (o: backend__email_Verification) => (o.requestKey == u.requestKey);
  ProofLib.FilterSamePredicate((o: backend__email_Verification) => (o.requestKey == vs[k].requestKey), q, vs);
  ProofLib.FilterLengthPointwise(q, p, vs, vs');
}

lemma CloseEnrollmentWellFormed(e: backend__email_Enrollment, now: int)
  requires backend__email_wellFormed(e, now)
  ensures backend__email_wellFormed(backend__email_closeEnrollment(e), now)
{
  hide *;
  reveal backend__email_wellFormed, backend__email_closeEnrollment, ProofLib.Filter;
  var ce := backend__email_closeEnrollment(e);
  var vs := e.verifications;
  var vs' := ce.verifications;
  forall v | v in vs'
    ensures v.id > 0 && v.tokenDigest == v.id && v.requestKey > 0 && v.address != "" && v.addressKey != ""
    ensures v.expiresAt == v.createdAt + backend__email_verificationLifetime && v.createdAt <= now
    ensures (!v.consumed || (v.version > 0 && !v.cancelled)) && (v.consumed || v.version == 0)
    ensures |ProofLib.Filter((o: backend__email_Verification) => (o.id == v.id), vs')| == 1
    ensures |ProofLib.Filter((o: backend__email_Verification) => (o.requestKey == v.requestKey), vs')| == 1
  {
    var k :| 0 <= k < |vs'| && vs'[k] == v;
    assert vs[k] in vs;
    CloseVerifIdCount(vs, vs', k, (o: backend__email_Verification) => (o.id == v.id));
    CloseVerifKeyCount(vs, vs', k, (o: backend__email_Verification) => (o.requestKey == v.requestKey));
  }
  ProofLib.FilterNone((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), vs');
  if ce.destination.version > 0 {
    var v :| v in vs && v.consumed && v.version == ce.destination.version && v.address == ce.destination.address;
    var vi :| 0 <= vi < |vs| && vs[vi] == v;
    assert vs'[vi] == v;
  }
}

lemma CloseEnrollmentValid(e: backend__email_Enrollment, now: int)
  requires backend__email_wellFormed(e, now)
  requires !e.preference.stored ==> e.preference.revision == 0 && e.preference.version == 0
  ensures var ce := backend__email_closeEnrollment(e);
    backend__email_wellFormed(ce, now)
    && backend__email_historyRetained(e, ce)
    && (!ce.preference.stored ==> ce.preference.revision == 0 && ce.preference.version == 0)
    && !ce.preference.activity && !ce.preference.security && ce.preference.version == 0
    && ce.actor == e.actor && ce.destination == e.destination && ce.pilotVersion == e.pilotVersion
    && ce.unsubscribeTokens == e.unsubscribeTokens
    && |ce.verifications| == |e.verifications|
    && (forall k :: 0 <= k < |e.verifications| ==> ce.verifications[k].id == e.verifications[k].id && (ce.verifications[k].consumed || ce.verifications[k].cancelled))
{
  hide *;
  CloseEnrollmentWellFormed(e, now);
  reveal backend__email_closeEnrollment, backend__email_historyRetained;
  var ce := backend__email_closeEnrollment(e);
  var vs := e.verifications;
  var vs' := ce.verifications;
  forall v | v in vs
    ensures exists w :: w in vs' && w.id == v.id && w.address == v.address && w.activity == v.activity && w.security == v.security && w.createdAt == v.createdAt && (!v.consumed || (w.consumed && w.version == v.version)) && (!v.cancelled || w.cancelled)
  {
    var k :| 0 <= k < |vs| && vs[k] == v;
    assert vs'[k] in vs';
  }
}

lemma close_ensures(s: Accounts, by_: int, confirmation: string)
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysMembersIdentified(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysSessionsBelongToOpenMembers(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysClockShared(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysIdentityStoreValid(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysParticipationAwardsHistorical(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysRefusalsConsumed(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysPublicMembershipIsOpen(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysClosedPrivate(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysXRegistryValid(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysXLinkReserved(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysXLinkPublicWhenRecent(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysEmailValid(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> alwaysOutboxSeesCurrentConsent(close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepMembersPermanent(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepSessionIdsFresh(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepNoNewParticipationAward(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepSignInPreservesEmail(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepPublicationOnlyBySignIn(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepSessionLifetimeFixedAtSignIn(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepRevocationStaysInAccount(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepActiveMembershipNeverHidden(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepClosureCancelsWaitingMail(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepClosedAtStable(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepTelegramFrozen(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepXReservationsPermanent(s, close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepFailedXKeepsLink(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepXConfersNoOtherAuthority(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepConsentOnlyFromExplicitChoice(s, "close", close(s, by_, confirmation)))
  ensures (inv(s) ==> canClose(s, by_, confirmation) ==> stepEmailHistoryRetained(s, close(s, by_, confirmation)))
{
  hide *;
  if inv(s) && canClose(s, by_, confirmation) {
    reveal inv, canClose, close, ProofLib.Filter;
    var after := close(s, by_, confirmation);
    SenderActorMember(s, by_);
    MembersUnique(s);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    var m := s.members[i];
    var ce := backend__email_closeEnrollment(m.email);
    MemberEmailProps(s, i);
    CloseEnrollmentValid(m.email, s.now);
    var changed := m.(membership := Membership.Closed, public := false, closedAt := s.now, xLink := backend__xConnection_noLink, telegramLinked := false, email := ce);
    ReplaceMemberPreservesUnchanged(s, i, changed, after);
    var keepS := (x: Session) => (x.actor != m.actor);
    ProofLib.FilterSamePredicate((x: Session) => (x.actor != m.actor), keepS, s.sessions);
    forall x | x in after.sessions
      ensures x in s.sessions && x.actor != m.actor
      ensures exists k :: k in after.members && k.actor == x.actor && k.membership.Open?
    {
      reveal alwaysSessionsBelongToOpenMembers;
      ProofLib.FilterMember(keepS, s.sessions, x);
      var k :| k in s.members && k.actor == x.actor && k.membership.Open?;
      var ki :| 0 <= ki < |s.members| && s.members[ki] == k;
      assert ki != i && after.members[ki] == k;
    }
    FilterSessionsValid(s, keepS, after);
    var keepF := (f: backend__xConnection_XFlow) => (f.actor != m.actor);
    assert after.xRegistry.flows == ProofLib.Filter(keepF, s.xRegistry.flows) && after.xRegistry.claims == s.xRegistry.claims && after.xRegistry.lastFlow == s.xRegistry.lastFlow by {
      reveal backend__xConnection_dropActorFlows;
      ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => (f.actor != m.actor), keepF, s.xRegistry.flows);
    }
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid;
      XRegistryFilterFlowsValid(s.xRegistry, s.now, keepF);
      forall f | f in after.xRegistry.flows
        ensures exists k :: k in after.members && k.actor == f.actor && k.membership.Open?
      {
        ProofLib.FilterMember(keepF, s.xRegistry.flows, f);
        var k :| k in s.members && k.actor == f.actor && k.membership.Open?;
        var ki :| 0 <= ki < |s.members| && s.members[ki] == k;
        assert ki != i && after.members[ki] == k;
      }
    }
    forall f | f in after.xRegistry.flows ensures f in s.xRegistry.flows && f.actor != m.actor {
      ProofLib.FilterMember(keepF, s.xRegistry.flows, f);
    }
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    EmailValidAfterSameIds(s, i, ce, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "close");
    assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
    assert alwaysClosedPrivate(after) by {
      reveal alwaysClosedPrivate, alwaysClockShared, launchClock;
    }
    assert alwaysXLinkReserved(after) by {
      reveal alwaysXLinkReserved, backend__xConnection_claimOwner, backend__xConnection_noLink;
    }
    assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent, backend__xConnection_noLink; }
    assert alwaysOutboxSeesCurrentConsent(after) by {
      reveal alwaysOutboxSeesCurrentConsent, operations__notifications_closeAccount, operations__notifications_withSnapshot, mailView, hasGithubMember;
      forall j | 0 <= j < |after.members|
        ensures mailView(operations__notifications_enrollmentOf(after.inbox, after.members[j].githubId)) == mailView(after.members[j].email)
      {
        WithSnapshotEnrollmentOf(s.inbox, after.inbox, ce, after.members[j].githubId);
        if j != i {
          assert s.members[j] in s.members && after.members[j].githubId != m.githubId;
        }
      }
      forall e | e in after.inbox.enrollments ensures hasGithubMember(after, e.actor) {
        if e == ce {
          assert after.members[i].githubId == ce.actor;
        } else {
          assert e in s.inbox.enrollments;
          var k :| 0 <= k < |s.members| && s.members[k].githubId == e.actor;
          assert after.members[k].githubId == e.actor;
        }
      }
    }
    CloseAccountNoWaitingMail(s.inbox, ce);
    assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
    assert stepSignInPreservesEmail(s, "close", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "close", after) by { reveal stepPublicationOnlyBySignIn; }
    assert stepRevocationStaysInAccount(s, "close", after) by { reveal stepRevocationStaysInAccount; }
    assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
    assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
    assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
    assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
    assert stepConsentOnlyFromExplicitChoice(s, "close", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, ce, after);
  }
}

lemma claimXCallback_ensures(s: Accounts, flowId: int, browserCap: int)
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysMembersIdentified(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysSessionsBelongToOpenMembers(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysClockShared(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysIdentityStoreValid(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysParticipationAwardsHistorical(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysRefusalsConsumed(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysPublicMembershipIsOpen(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysClosedPrivate(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysXRegistryValid(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysXLinkReserved(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysXLinkPublicWhenRecent(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysEmailValid(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> alwaysOutboxSeesCurrentConsent(claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepMembersPermanent(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepSessionIdsFresh(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepNoNewParticipationAward(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepSignInPreservesEmail(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepPublicationOnlyBySignIn(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepSessionLifetimeFixedAtSignIn(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepRevocationStaysInAccount(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepActiveMembershipNeverHidden(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepClosureCancelsWaitingMail(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepClosedAtStable(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepTelegramFrozen(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepXReservationsPermanent(s, claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepFailedXKeepsLink(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepXConfersNoOtherAuthority(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepConsentOnlyFromExplicitChoice(s, "claimXCallback", claimXCallback(s, flowId, browserCap)))
  ensures (inv(s) ==> canClaimXCallback(s, flowId, browserCap) ==> stepEmailHistoryRetained(s, claimXCallback(s, flowId, browserCap)))
{
  hide *;
  if inv(s) && canClaimXCallback(s, flowId, browserCap) {
    reveal inv, claimXCallback, backend__xConnection_claimX, ProofLib.Filter;
    var after := claimXCallback(s, flowId, browserCap);
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid, backend__xConnection_registryWellFormed;
      var fs := s.xRegistry.flows;
      var fs' := after.xRegistry.flows;
      forall k | 0 <= k < |fs'|
        ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.id == fs'[k].id), fs')| == 1
        ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.actor == fs'[k].actor), fs')| == 1
      {
        assert fs[k] in fs;
        ProofLib.FilterLengthPointwise((g: backend__xConnection_XFlow) => (g.id == fs[k].id), (g: backend__xConnection_XFlow) => (g.id == fs'[k].id), fs, fs');
        ProofLib.FilterLengthPointwise((g: backend__xConnection_XFlow) => (g.actor == fs[k].actor), (g: backend__xConnection_XFlow) => (g.actor == fs'[k].actor), fs, fs');
      }
    }
    assert alwaysClosedPrivate(after) by {
      reveal alwaysClosedPrivate;
      forall f | f in after.xRegistry.flows
        ensures exists g :: g in s.xRegistry.flows && g.actor == f.actor
      {
        var k :| 0 <= k < |after.xRegistry.flows| && after.xRegistry.flows[k] == f;
        assert s.xRegistry.flows[k].actor == f.actor;
      }
    }
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "claimXCallback");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepXAuthoritySameMembers(s, after, "claimXCallback");
  }
}

lemma failX_ensures(s: Accounts, by_: int, flowId: int)
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysMembersIdentified(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysSessionsBelongToOpenMembers(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysClockShared(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysIdentityStoreValid(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysParticipationAwardsHistorical(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysRefusalsConsumed(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysPublicMembershipIsOpen(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysClosedPrivate(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysXRegistryValid(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysXLinkReserved(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysXLinkPublicWhenRecent(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysEmailValid(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> alwaysOutboxSeesCurrentConsent(failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepMembersPermanent(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepSessionIdsFresh(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepNoNewParticipationAward(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepSignInPreservesEmail(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepPublicationOnlyBySignIn(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepSessionLifetimeFixedAtSignIn(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepRevocationStaysInAccount(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepActiveMembershipNeverHidden(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepClosureCancelsWaitingMail(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepClosedAtStable(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepTelegramFrozen(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepXReservationsPermanent(s, failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepFailedXKeepsLink(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepXConfersNoOtherAuthority(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepConsentOnlyFromExplicitChoice(s, "failX", failX(s, by_, flowId)))
  ensures (inv(s) ==> canFailX(s, by_, flowId) ==> stepEmailHistoryRetained(s, failX(s, by_, flowId)))
{
  hide *;
  if inv(s) && canFailX(s, by_, flowId) {
    reveal inv, failX, backend__xConnection_endXFlow, ProofLib.Filter;
    var after := failX(s, by_, flowId);
    var keep := (f: backend__xConnection_XFlow) => (f.id != flowId);
    ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => (f.id != flowId), keep, s.xRegistry.flows);
    forall f | f in after.xRegistry.flows ensures f in s.xRegistry.flows {
      ProofLib.FilterMember(keep, s.xRegistry.flows, f);
    }
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid;
      XRegistryFilterFlowsValid(s.xRegistry, s.now, keep);
    }
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "failX");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepXAuthoritySameMembers(s, after, "failX");
  }
}

lemma commitX_ensures(s: Accounts, by_: int, flowId: int, xIdentity: backend__xConnection_XProviderIdentity)
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysMembersIdentified(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysSessionsBelongToOpenMembers(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysClockShared(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysIdentityStoreValid(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysParticipationAwardsHistorical(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysRefusalsConsumed(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysPublicMembershipIsOpen(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysClosedPrivate(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysXRegistryValid(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysXLinkReserved(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysXLinkPublicWhenRecent(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysEmailValid(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> alwaysOutboxSeesCurrentConsent(commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepMembersPermanent(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepSessionIdsFresh(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepNoNewParticipationAward(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepSignInPreservesEmail(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepPublicationOnlyBySignIn(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepSessionLifetimeFixedAtSignIn(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepRevocationStaysInAccount(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepActiveMembershipNeverHidden(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepClosureCancelsWaitingMail(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepClosedAtStable(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepTelegramFrozen(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepXReservationsPermanent(s, commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepFailedXKeepsLink(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepXConfersNoOtherAuthority(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepConsentOnlyFromExplicitChoice(s, "commitX", commitX(s, by_, flowId, xIdentity)))
  ensures (inv(s) ==> canCommitX(s, by_, flowId, xIdentity) ==> stepEmailHistoryRetained(s, commitX(s, by_, flowId, xIdentity)))
{
  hide *;
  if inv(s) && canCommitX(s, by_, flowId, xIdentity) {
    reveal inv, canCommitX, commitX, backend__xConnection_canCommitX, backend__xConnection_commitClaims, backend__xConnection_committedLink, liveSessionOf, ProofLib.Filter;
    var after := commitX(s, by_, flowId, xIdentity);
    var fl := backend__xConnection_xFlowById(s.xRegistry, flowId);
    assert backend__xConnection_registryWellFormed(s.xRegistry, s.now) by { reveal alwaysXRegistryValid; }
    XFlowByIdHit(s.xRegistry, s.now, flowId);
    var sx :| sx in s.sessions && sx.id == fl.session && sx.actor == fl.actor && sx.expiresAt > s.now;
    var m :| m in s.members && m.actor == fl.actor && m.membership.Open? by { reveal alwaysSessionsBelongToOpenMembers; }
    var i :| 0 <= i < |s.members| && s.members[i] == m;
    MemberFieldsValid(s, i);
    MemberByActorAt(s, i);
    var changed := m.(xLink := backend__xConnection_committedLink(s.now, xIdentity));
    ReplaceMemberPreservesUnchanged(s, i, changed, after);
    assert forall k :: k in s.members && k.membership.Open? ==> exists n :: n in after.members && n.actor == k.actor && n.membership.Open? by {
      forall k | k in s.members && k.membership.Open?
        ensures exists n :: n in after.members && n.actor == k.actor && n.membership.Open?
      {
        var ki :| 0 <= ki < |s.members| && s.members[ki] == k;
        assert after.members[ki].actor == k.actor && after.members[ki].membership.Open?;
      }
    }
    var keep := (f: backend__xConnection_XFlow) => (f.id != flowId);
    ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => (f.id != flowId), keep, s.xRegistry.flows);
    forall f | f in after.xRegistry.flows ensures f in s.xRegistry.flows {
      ProofLib.FilterMember(keep, s.xRegistry.flows, f);
    }
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid, backend__xConnection_registryWellFormed;
      XRegistryFilterFlowsValid(s.xRegistry, s.now, keep);
      if backend__xConnection_claimOwner(s.xRegistry, xIdentity.xId) == 0 {
        XClaimOwnerProps(s.xRegistry, s.now, xIdentity.xId);
        var added := backend__xConnection_XClaim(xIdentity.xId, fl.actor, s.now);
        assert after.xRegistry.claims == s.xRegistry.claims + [added];
        forall c | c in after.xRegistry.claims
          ensures |ProofLib.Filter((d: backend__xConnection_XClaim) => (d.xId == c.xId), after.xRegistry.claims)| == 1
        {
          ProofLib.FilterAppend((d: backend__xConnection_XClaim) => (d.xId == c.xId), s.xRegistry.claims, added);
          if c == added {
            ProofLib.FilterNone((d: backend__xConnection_XClaim) => (d.xId == c.xId), s.xRegistry.claims);
          }
        }
      }
    }
    assert alwaysXLinkReserved(after) by {
      reveal alwaysXLinkReserved, alwaysClockShared, launchClock;
      if backend__xConnection_claimOwner(s.xRegistry, xIdentity.xId) == 0 {
        XClaimOwnerProps(s.xRegistry, s.now, xIdentity.xId);
        var added := backend__xConnection_XClaim(xIdentity.xId, fl.actor, s.now);
        forall k | 0 <= k < |after.members| && after.members[k].xLink.xId != ""
          ensures backend__xConnection_claimOwner(after.xRegistry, after.members[k].xLink.xId) == after.members[k].actor
        {
          XClaimOwnerAppend(s.xRegistry, s.now, added, after.members[k].xLink.xId);
          assert backend__xConnection_claimOwner(after.xRegistry, after.members[k].xLink.xId)
            == backend__xConnection_claimOwner(s.xRegistry.(claims := s.xRegistry.claims + [added]), after.members[k].xLink.xId) by {
            reveal backend__xConnection_claimOwner;
          }
          if k != i {
            MemberFieldsValid(s, k);
            assert after.members[k] == s.members[k];
            assert backend__xConnection_claimOwner(s.xRegistry, s.members[k].xLink.xId) == s.members[k].actor;
            assert s.members[k].xLink.xId != xIdentity.xId;
          }
        }
      } else {
        assert after.xRegistry.claims == s.xRegistry.claims;
        reveal backend__xConnection_claimOwner;
      }
    }
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepEmailValidSameEmailField(s, i, after);
    KeepOutboxSameMailView(s, after);
    StepSameSessions(s, after);
    assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
    assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
    assert stepSignInPreservesEmail(s, "commitX", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "commitX", after) by { reveal stepPublicationOnlyBySignIn; }
    assert stepRevocationStaysInAccount(s, "commitX", after) by { reveal stepRevocationStaysInAccount; }
    assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
    assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
    assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
    assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
    assert stepXReservationsPermanent(s, after) by { reveal stepXReservationsPermanent, backend__xConnection_claimsPermanent; }
    assert stepFailedXKeepsLink(s, "commitX", after) by { reveal stepFailedXKeepsLink; }
    assert stepXConfersNoOtherAuthority(s, "commitX", after) by { reveal stepXConfersNoOtherAuthority; }
    assert stepConsentOnlyFromExplicitChoice(s, "commitX", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    assert stepEmailHistoryRetained(s, after) by { reveal stepEmailHistoryRetained, backend__email_historyRetained; }
  }
}

lemma startX_ensures(s: Accounts, by_: int)
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysMembersIdentified(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysSessionsBelongToOpenMembers(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysClockShared(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysIdentityStoreValid(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysParticipationAwardsHistorical(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysRefusalsConsumed(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysPublicMembershipIsOpen(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysClosedPrivate(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysXRegistryValid(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysXLinkReserved(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysXLinkPublicWhenRecent(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysEmailValid(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> alwaysOutboxSeesCurrentConsent(startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepMembersPermanent(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepSessionIdsFresh(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepNoNewParticipationAward(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepSignInPreservesEmail(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepPublicationOnlyBySignIn(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepSessionLifetimeFixedAtSignIn(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepRevocationStaysInAccount(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepActiveMembershipNeverHidden(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepClosureCancelsWaitingMail(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepClosedAtStable(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepTelegramFrozen(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepXReservationsPermanent(s, startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepFailedXKeepsLink(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepXConfersNoOtherAuthority(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepConsentOnlyFromExplicitChoice(s, "startX", startX(s, by_)))
  ensures (inv(s) ==> canStartX(s, by_) ==> stepEmailHistoryRetained(s, startX(s, by_)))
{
  hide *;
  if inv(s) && canStartX(s, by_) {
    reveal inv, canStartX, startX, backend__xConnection_startX, ProofLib.Filter;
    var after := startX(s, by_);
    SenderActorMember(s, by_);
    var actor := senderActor(s, by_);
    var id := s.xRegistry.lastFlow + 1;
    var keep := (f: backend__xConnection_XFlow) => ((f.actor != actor) && (f.expiresAt > s.now));
    ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => ((f.actor != actor) && (f.expiresAt > s.now)), keep, s.xRegistry.flows);
    var kept := ProofLib.Filter(keep, s.xRegistry.flows);
    var added := backend__xConnection_XFlow(id, actor, by_, id, backend__xConnection_XFlowStatus.XPending, (s.now + backend__xConnection_xFlowLifetime));
    assert after.xRegistry.flows == kept + [added];
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid, backend__xConnection_registryWellFormed;
      forall f | f in after.xRegistry.flows
        ensures f.id > 0 && f.id <= after.xRegistry.lastFlow && f.actor > 0 && f.session > 0 && f.browserCap == f.id
        ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.id == f.id), after.xRegistry.flows)| == 1
        ensures |ProofLib.Filter((g: backend__xConnection_XFlow) => (g.actor == f.actor), after.xRegistry.flows)| == 1
        ensures exists m :: m in after.members && m.actor == f.actor && m.membership.Open?
      {
        ProofLib.FilterAppend((g: backend__xConnection_XFlow) => (g.id == f.id), kept, added);
        ProofLib.FilterAppend((g: backend__xConnection_XFlow) => (g.actor == f.actor), kept, added);
        if f in kept {
          ProofLib.FilterMember(keep, s.xRegistry.flows, f);
          FilterSubseqKeepsCountOne(keep, (g: backend__xConnection_XFlow) => (g.id == f.id), s.xRegistry.flows, f);
          FilterSubseqKeepsCountOne(keep, (g: backend__xConnection_XFlow) => (g.actor == f.actor), s.xRegistry.flows, f);
          assert f.id <= s.xRegistry.lastFlow < added.id && f.actor != actor;
        } else {
          assert f == added;
          forall k | 0 <= k < |kept| ensures kept[k].id != f.id && kept[k].actor != f.actor {
            ProofLib.FilterMember(keep, s.xRegistry.flows, kept[k]);
          }
          ProofLib.FilterNone((g: backend__xConnection_XFlow) => (g.id == f.id), kept);
          ProofLib.FilterNone((g: backend__xConnection_XFlow) => (g.actor == f.actor), kept);
        }
      }
    }
    assert alwaysClosedPrivate(after) by {
      reveal alwaysClosedPrivate;
      forall f | f in after.xRegistry.flows
        ensures f in s.xRegistry.flows || f.actor == actor
      {
        if f in kept {
          ProofLib.FilterMember(keep, s.xRegistry.flows, f);
        }
      }
      MembersUnique(s);
    }
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "startX");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepXAuthoritySameMembers(s, after, "startX");
  }
}

lemma disconnectX_ensures(s: Accounts, by_: int)
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysMembersIdentified(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysSessionsBelongToOpenMembers(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysClockShared(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysIdentityStoreValid(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysParticipationAwardsHistorical(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysRefusalsConsumed(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysPublicMembershipIsOpen(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysClosedPrivate(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysXRegistryValid(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysXLinkReserved(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysXLinkPublicWhenRecent(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysEmailValid(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> alwaysOutboxSeesCurrentConsent(disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepMembersPermanent(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepSessionIdsFresh(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepNoNewParticipationAward(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepSignInPreservesEmail(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepPublicationOnlyBySignIn(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepSessionLifetimeFixedAtSignIn(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepRevocationStaysInAccount(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepActiveMembershipNeverHidden(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepClosureCancelsWaitingMail(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepClosedAtStable(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepTelegramFrozen(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepXReservationsPermanent(s, disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepFailedXKeepsLink(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepXConfersNoOtherAuthority(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepConsentOnlyFromExplicitChoice(s, "disconnectX", disconnectX(s, by_)))
  ensures (inv(s) ==> canDisconnectX(s, by_) ==> stepEmailHistoryRetained(s, disconnectX(s, by_)))
{
  hide *;
  if inv(s) && canDisconnectX(s, by_) {
    reveal inv, canDisconnectX, disconnectX, ProofLib.Filter;
    var after := disconnectX(s, by_);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    ReplaceMemberPreservesUnchanged(s, i, s.members[i].(xLink := backend__xConnection_noLink), after);
    assert forall m :: m in s.members && m.membership.Open? ==> exists n :: n in after.members && n.actor == m.actor && n.membership.Open? by {
      forall m | m in s.members && m.membership.Open?
        ensures exists n :: n in after.members && n.actor == m.actor && n.membership.Open?
      {
        var j :| 0 <= j < |s.members| && s.members[j] == m;
        assert after.members[j].actor == m.actor && after.members[j].membership.Open?;
      }
    }
    var keep := (f: backend__xConnection_XFlow) => (f.actor != s.members[i].actor);
    assert after.xRegistry.flows == ProofLib.Filter(keep, s.xRegistry.flows) && after.xRegistry.claims == s.xRegistry.claims && after.xRegistry.lastFlow == s.xRegistry.lastFlow by {
      reveal backend__xConnection_dropActorFlows;
      ProofLib.FilterSamePredicate((f: backend__xConnection_XFlow) => (f.actor != s.members[i].actor), keep, s.xRegistry.flows);
    }
    forall f | f in after.xRegistry.flows ensures f in s.xRegistry.flows {
      ProofLib.FilterMember(keep, s.xRegistry.flows, f);
    }
    assert alwaysXRegistryValid(after) by {
      reveal alwaysXRegistryValid;
      XRegistryFilterFlowsValid(s.xRegistry, s.now, keep);
    }
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepEmailValidSameEmailField(s, i, after);
    KeepOutboxSameMailView(s, after);
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved, backend__xConnection_claimOwner, backend__xConnection_noLink; }
    assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent, backend__xConnection_noLink; }
    assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
    assert stepSignInPreservesEmail(s, "disconnectX", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "disconnectX", after) by { reveal stepPublicationOnlyBySignIn; }
    assert stepRevocationStaysInAccount(s, "disconnectX", after) by { reveal stepRevocationStaysInAccount; }
    assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
    assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
    assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
    assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
    assert stepFailedXKeepsLink(s, "disconnectX", after) by { reveal stepFailedXKeepsLink; }
    assert stepXConfersNoOtherAuthority(s, "disconnectX", after) by { reveal stepXConfersNoOtherAuthority; }
    assert stepConsentOnlyFromExplicitChoice(s, "disconnectX", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    assert stepEmailHistoryRetained(s, after) by { reveal stepEmailHistoryRetained, backend__email_historyRetained; }
  }
}

lemma publishX_ensures(s: Accounts, by_: int)
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysMembersIdentified(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysSessionsBelongToOpenMembers(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysClockShared(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysIdentityStoreValid(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysParticipationAwardsHistorical(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysRefusalsConsumed(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysPublicMembershipIsOpen(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysClosedPrivate(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysXRegistryValid(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysXLinkReserved(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysXLinkPublicWhenRecent(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysEmailValid(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> alwaysOutboxSeesCurrentConsent(publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepMembersPermanent(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepSessionIdsFresh(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepNoNewParticipationAward(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepSignInPreservesEmail(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepPublicationOnlyBySignIn(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepSessionLifetimeFixedAtSignIn(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepRevocationStaysInAccount(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepActiveMembershipNeverHidden(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepClosureCancelsWaitingMail(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepClosedAtStable(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepTelegramFrozen(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepXReservationsPermanent(s, publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepFailedXKeepsLink(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepXConfersNoOtherAuthority(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepConsentOnlyFromExplicitChoice(s, "publishX", publishX(s, by_)))
  ensures (inv(s) ==> canPublishX(s, by_) ==> stepEmailHistoryRetained(s, publishX(s, by_)))
{
  hide *;
  if inv(s) && canPublishX(s, by_) {
    reveal inv, canPublishX, publishX;
    var after := publishX(s, by_);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    ReplaceMemberPreservesUnchanged(s, i, s.members[i].(xLink := s.members[i].xLink.(public := true)), after);
    assert forall m :: m in s.members && m.membership.Open? ==> exists n :: n in after.members && n.actor == m.actor && n.membership.Open? by {
      forall m | m in s.members && m.membership.Open?
        ensures exists n :: n in after.members && n.actor == m.actor && n.membership.Open?
      {
        var j :| 0 <= j < |s.members| && s.members[j] == m;
        assert after.members[j].actor == m.actor && after.members[j].membership.Open?;
      }
    }
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepXRegistryValid(s, after);
    KeepEmailValidSameEmailField(s, i, after);
    KeepOutboxSameMailView(s, after);
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    assert alwaysPublicMembershipIsOpen(after) by { reveal alwaysPublicMembershipIsOpen; }
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert alwaysXLinkReserved(after) by { reveal alwaysXLinkReserved; }
    assert alwaysXLinkPublicWhenRecent(after) by { reveal alwaysXLinkPublicWhenRecent; }
    assert stepNoNewParticipationAward(s, after) by { reveal stepNoNewParticipationAward; }
    assert stepSignInPreservesEmail(s, "publishX", after) by { reveal stepSignInPreservesEmail; }
    assert stepPublicationOnlyBySignIn(s, "publishX", after) by { reveal stepPublicationOnlyBySignIn; }
    assert stepRevocationStaysInAccount(s, "publishX", after) by { reveal stepRevocationStaysInAccount; }
    assert stepActiveMembershipNeverHidden(s, after) by { reveal stepActiveMembershipNeverHidden; }
    assert stepClosureCancelsWaitingMail(s, after) by { reveal stepClosureCancelsWaitingMail; }
    assert stepClosedAtStable(s, after) by { reveal stepClosedAtStable; }
    assert stepTelegramFrozen(s, after) by { reveal stepTelegramFrozen; }
    assert stepFailedXKeepsLink(s, "publishX", after) by { reveal stepFailedXKeepsLink; }
    assert stepXConfersNoOtherAuthority(s, "publishX", after) by { reveal stepXConfersNoOtherAuthority; }
    assert stepConsentOnlyFromExplicitChoice(s, "publishX", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    assert stepEmailHistoryRetained(s, after) by { reveal stepEmailHistoryRetained, backend__email_historyRetained; }
  }
}

lemma saveNotice_ensures(s: Accounts, by_: int, key: int, kind: operations__notifications_Kind, githubId: int)
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysMembersIdentified(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysSessionsBelongToOpenMembers(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysClockShared(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysIdentityStoreValid(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysParticipationAwardsHistorical(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysRefusalsConsumed(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysPublicMembershipIsOpen(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysClosedPrivate(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysXRegistryValid(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysXLinkReserved(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysXLinkPublicWhenRecent(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysEmailValid(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> alwaysOutboxSeesCurrentConsent(saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepMembersPermanent(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepSessionIdsFresh(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepNoNewParticipationAward(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepSignInPreservesEmail(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepPublicationOnlyBySignIn(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepSessionLifetimeFixedAtSignIn(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepRevocationStaysInAccount(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepActiveMembershipNeverHidden(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepClosureCancelsWaitingMail(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepClosedAtStable(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepTelegramFrozen(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepXReservationsPermanent(s, saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepFailedXKeepsLink(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepXConfersNoOtherAuthority(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepConsentOnlyFromExplicitChoice(s, "saveNotice", saveNotice(s, by_, key, kind, githubId)))
  ensures (inv(s) ==> canSaveNotice(s, by_, key, kind, githubId) ==> stepEmailHistoryRetained(s, saveNotice(s, by_, key, kind, githubId)))
{
  hide *;
  if inv(s) && canSaveNotice(s, by_, key, kind, githubId) {
    reveal inv, saveNotice, operations__notifications_save;
    var after := saveNotice(s, by_, key, kind, githubId);
    KeepMembersIdentified(s, after);
    KeepSessions(s, after);
    KeepClockShared(s, after);
    KeepIdentityStoreValid(s, after);
    KeepParticipationAwards(s, after);
    KeepRefusalsConsumed(s, after);
    KeepPublicMembershipIsOpen(s, after);
    KeepClosedPrivate(s, after);
    KeepXRegistryValid(s, after);
    KeepXLinkReserved(s, after);
    KeepXLinkPublicWhenRecent(s, after);
    KeepEmailValid(s, after);
    KeepOutbox(s, after);
    StepSameMembers(s, after, "saveNotice");
    StepSameSessions(s, after);
    StepSameXClaims(s, after);
    StepNonX(s, after, "saveNotice");
  }
}

lemma MarkDeliveryValid(e: backend__email_Enrollment, now: int, id: int, nextState: backend__email_VerificationDelivery)
  requires backend__email_wellFormed(e, now)
  ensures var e' := backend__email_markDelivery(e, now, id, nextState);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.destination == e.destination && e'.preference == e.preference
    && e'.pilotVersion == e.pilotVersion && e'.unsubscribeTokens == e.unsubscribeTokens
    && |e'.verifications| == |e.verifications|
    && (forall k :: 0 <= k < |e.verifications| ==> e'.verifications[k].id == e.verifications[k].id && e'.verifications[k].consumed == e.verifications[k].consumed && e'.verifications[k].cancelled == e.verifications[k].cancelled)
{
  hide *;
  reveal backend__email_markDelivery, ProofLib.Filter;
  var e' := backend__email_markDelivery(e, now, id, nextState);
  var vs := e.verifications;
  var vs' := e'.verifications;
  assert backend__email_wellFormed(e', now) by {
    reveal backend__email_wellFormed, backend__email_currentVersion;
    forall k | 0 <= k < |vs'|
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.id == vs'[k].id), vs')| == 1
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.requestKey == vs'[k].requestKey), vs')| == 1
    {
      assert vs[k] in vs;
      ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.id == vs[k].id), (o: backend__email_Verification) => (o.id == vs'[k].id), vs, vs');
      ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.requestKey == vs[k].requestKey), (o: backend__email_Verification) => (o.requestKey == vs'[k].requestKey), vs, vs');
    }
    ProofLib.FilterLengthPointwise((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), (v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), vs, vs');
    if e'.destination.version > 0 {
      var v :| v in vs && v.consumed && v.version == e'.destination.version && v.address == e'.destination.address;
      var vi :| 0 <= vi < |vs| && vs[vi] == v;
      assert vs'[vi].consumed && vs'[vi].version == e'.destination.version && vs'[vi].address == e'.destination.address;
    }
  }
  assert backend__email_historyRetained(e, e') by {
    reveal backend__email_historyRetained;
    forall v | v in vs
      ensures exists w :: w in vs' && w.id == v.id && w.address == v.address && w.activity == v.activity && w.security == v.security && w.createdAt == v.createdAt && (!v.consumed || (w.consumed && w.version == v.version)) && (!v.cancelled || w.cancelled)
    {
      var k :| 0 <= k < |vs| && vs[k] == v;
      assert vs'[k] in vs';
    }
  }
}

lemma markEmailDelivery_ensures(s: Accounts, by_: int, githubId: int, id: int, nextState: backend__email_VerificationDelivery)
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysMembersIdentified(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysSessionsBelongToOpenMembers(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysClockShared(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysIdentityStoreValid(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysParticipationAwardsHistorical(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysRefusalsConsumed(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysPublicMembershipIsOpen(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysClosedPrivate(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysXRegistryValid(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysXLinkReserved(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysXLinkPublicWhenRecent(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysEmailValid(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> alwaysOutboxSeesCurrentConsent(markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepMembersPermanent(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepSessionIdsFresh(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepNoNewParticipationAward(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepSignInPreservesEmail(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepPublicationOnlyBySignIn(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepSessionLifetimeFixedAtSignIn(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepRevocationStaysInAccount(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepActiveMembershipNeverHidden(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepClosureCancelsWaitingMail(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepClosedAtStable(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepTelegramFrozen(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepXReservationsPermanent(s, markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepFailedXKeepsLink(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepXConfersNoOtherAuthority(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepConsentOnlyFromExplicitChoice(s, "markEmailDelivery", markEmailDelivery(s, by_, githubId, id, nextState)))
  ensures (inv(s) ==> canMarkEmailDelivery(s, by_, githubId, id, nextState) ==> stepEmailHistoryRetained(s, markEmailDelivery(s, by_, githubId, id, nextState)))
{
  hide *;
  if inv(s) && canMarkEmailDelivery(s, by_, githubId, id, nextState) {
    reveal inv, canMarkEmailDelivery, markEmailDelivery, hasGithubMember;
    var after := markEmailDelivery(s, by_, githubId, id, nextState);
    var m :| m in s.members && m.githubId == githubId;
    var i :| 0 <= i < |s.members| && s.members[i] == m;
    MemberFieldsValid(s, i);
    MemberByGithubAt(s, i);
    var e' := backend__email_markDelivery(m.email, s.now, id, nextState);
    MemberEmailProps(s, i);
    MarkDeliveryValid(m.email, s.now, id, nextState);
    WithEmailMemberFrame(s, i, e', after, "markEmailDelivery");
    EmailValidAfterSameIds(s, i, e', after);
    assert mailView(e') == mailView(m.email) by { reveal mailView; }
    KeepOutboxSameMailView(s, after);
    assert alwaysClosedPrivate(after) by {
      reveal alwaysClosedPrivate;
      forall k | 0 <= k < |e'.verifications| && m.membership.Closed? ensures e'.verifications[k].consumed || e'.verifications[k].cancelled {
        assert m.email.verifications[k] in m.email.verifications;
      }
    }
    assert stepConsentOnlyFromExplicitChoice(s, "markEmailDelivery", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma IssueUnsubscribeValid(e: backend__email_Enrollment, now: int, tok: int)
  requires backend__email_wellFormed(e, now) && backend__email_canIssueUnsubscribe(e, tok)
  ensures var e' := backend__email_issueUnsubscribe(e, tok);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.verifications == e.verifications && e'.destination == e.destination
    && e'.preference == e.preference && e'.pilotVersion == e.pilotVersion
    && e'.unsubscribeTokens == e.unsubscribeTokens + [backend__email_UnsubscribeToken(tok, e.destination.version)]
{
  hide *;
  reveal backend__email_canIssueUnsubscribe, backend__email_issueUnsubscribe, ProofLib.Filter;
  var e' := backend__email_issueUnsubscribe(e, tok);
  var added := backend__email_UnsubscribeToken(tok, e.destination.version);
  assert backend__email_wellFormed(e', now) by {
    reveal backend__email_wellFormed, backend__email_currentVersion;
    forall t | t in e'.unsubscribeTokens
      ensures t.token > 0 && t.version > 0
      ensures |ProofLib.Filter((o: backend__email_UnsubscribeToken) => (o.token == t.token), e'.unsubscribeTokens)| == 1
    {
      ProofLib.FilterAppend((o: backend__email_UnsubscribeToken) => (o.token == t.token), e.unsubscribeTokens, added);
      if t in e.unsubscribeTokens {
        assert t.token != tok;
      } else {
        assert t == added;
        ProofLib.FilterNone((o: backend__email_UnsubscribeToken) => (o.token == t.token), e.unsubscribeTokens);
      }
    }
  }
  assert backend__email_historyRetained(e, e') by {
    reveal backend__email_historyRetained;
  }
}

lemma issueUnsubscribe_ensures(s: Accounts, by_: int, githubId: int)
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysMembersIdentified(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysSessionsBelongToOpenMembers(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysClockShared(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysIdentityStoreValid(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysParticipationAwardsHistorical(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysRefusalsConsumed(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysPublicMembershipIsOpen(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysClosedPrivate(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysXRegistryValid(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysXLinkReserved(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysXLinkPublicWhenRecent(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysEmailValid(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> alwaysOutboxSeesCurrentConsent(issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepMembersPermanent(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepSessionIdsFresh(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepNoNewParticipationAward(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepSignInPreservesEmail(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepPublicationOnlyBySignIn(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepSessionLifetimeFixedAtSignIn(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepRevocationStaysInAccount(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepActiveMembershipNeverHidden(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepClosureCancelsWaitingMail(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepClosedAtStable(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepTelegramFrozen(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepXReservationsPermanent(s, issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepFailedXKeepsLink(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepXConfersNoOtherAuthority(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepConsentOnlyFromExplicitChoice(s, "issueUnsubscribe", issueUnsubscribe(s, by_, githubId)))
  ensures (inv(s) ==> canIssueUnsubscribe(s, by_, githubId) ==> stepEmailHistoryRetained(s, issueUnsubscribe(s, by_, githubId)))
{
  hide *;
  if inv(s) && canIssueUnsubscribe(s, by_, githubId) {
    reveal inv, canIssueUnsubscribe, issueUnsubscribe, hasGithubMember;
    var after := issueUnsubscribe(s, by_, githubId);
    var m :| m in s.members && m.githubId == githubId;
    var i :| 0 <= i < |s.members| && s.members[i] == m;
    MemberFieldsValid(s, i);
    MemberByGithubAt(s, i);
    var tok := s.lastUnsubscribe + 1;
    var e' := backend__email_issueUnsubscribe(m.email, tok);
    MemberEmailProps(s, i);
    IssueUnsubscribeValid(m.email, s.now, tok);
    WithEmailMemberFrame(s, i, e', after, "issueUnsubscribe");
    EmailValidAfterAppendUnsubscribe(s, i, e', after, tok);
    assert mailView(e') == mailView(m.email) by { reveal mailView; }
    KeepOutboxSameMailView(s, after);
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert stepConsentOnlyFromExplicitChoice(s, "issueUnsubscribe", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma UnsubscribeValid(e: backend__email_Enrollment, now: int, token: int)
  requires backend__email_wellFormed(e, now) && backend__email_canUnsubscribe(e, token)
  requires !e.preference.stored ==> e.preference.revision == 0 && e.preference.version == 0
  ensures var e' := backend__email_unsubscribe(e, token);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.verifications == e.verifications && e'.destination == e.destination
    && e'.pilotVersion == e.pilotVersion && e'.unsubscribeTokens == e.unsubscribeTokens
    && e'.preference.stored && !e'.preference.activity && !e'.preference.security
    && e'.preference.version == e.preference.version
    && e'.preference.revision == e.preference.revision + 1
{
  hide *;
  reveal backend__email_wellFormed, backend__email_unsubscribe, backend__email_historyRetained;
  UnsubscribeTokenExists(e, token);
}

lemma unsubscribe_ensures(s: Accounts, token: int)
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysMembersIdentified(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysSessionsBelongToOpenMembers(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysClockShared(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysIdentityStoreValid(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysParticipationAwardsHistorical(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysRefusalsConsumed(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysPublicMembershipIsOpen(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysClosedPrivate(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysXRegistryValid(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysXLinkReserved(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysXLinkPublicWhenRecent(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysEmailValid(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> alwaysOutboxSeesCurrentConsent(unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepMembersPermanent(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepSessionIdsFresh(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepNoNewParticipationAward(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepSignInPreservesEmail(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepPublicationOnlyBySignIn(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepSessionLifetimeFixedAtSignIn(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepRevocationStaysInAccount(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepActiveMembershipNeverHidden(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepClosureCancelsWaitingMail(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepClosedAtStable(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepTelegramFrozen(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepXReservationsPermanent(s, unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepFailedXKeepsLink(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepXConfersNoOtherAuthority(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepConsentOnlyFromExplicitChoice(s, "unsubscribe", unsubscribe(s, token)))
  ensures (inv(s) ==> canUnsubscribe(s, token) ==> stepEmailHistoryRetained(s, unsubscribe(s, token)))
{
  hide *;
  if inv(s) && canUnsubscribe(s, token) {
    reveal inv, canUnsubscribe, unsubscribe;
    var after := unsubscribe(s, token);
    UnsubscribeHolderHit(s, token);
    var i :| 0 <= i < |s.members| && s.members[i] == unsubscribeHolder(s, token);
    MemberFieldsValid(s, i);
    var m := s.members[i];
    MemberEmailProps(s, i);
    var e' := backend__email_unsubscribe(m.email, token);
    UnsubscribeValid(m.email, s.now, token);
    WithEmailMemberFrame(s, i, e', after, "unsubscribe");
    EmailValidAfterSameIds(s, i, e', after);
    SyncMailPreservesOutbox(s, i, e', after);
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert stepConsentOnlyFromExplicitChoice(s, "unsubscribe", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma RequestEmailValid(e: backend__email_Enrollment, now: int, nid: int, requestKey: int, address: string, addressKey: string, activity: bool, security: bool, lastEmailId: int)
  requires backend__email_wellFormed(e, now) && lastEmailId >= 0 && nid == lastEmailId + 1
  requires forall v :: v in e.verifications ==> v.id <= lastEmailId
  requires requestKey > 0 && address != "" && addressKey != "" && |backend__email_ownByKey(e, requestKey)| == 0
  ensures var e' := backend__email_requestVerification(e, now, nid, requestKey, address, addressKey, activity, security);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.destination == e.destination && e'.preference == e.preference
    && e'.pilotVersion == e.pilotVersion && e'.unsubscribeTokens == e.unsubscribeTokens
    && |e'.verifications| == |e.verifications| + 1
    && (forall k :: 0 <= k < |e.verifications| ==> e'.verifications[k].id == e.verifications[k].id)
    && e'.verifications[|e.verifications|].id == nid
{
  hide *;
  reveal backend__email_ownByKey, backend__email_requestVerification, ProofLib.Filter;
  var e' := backend__email_requestVerification(e, now, nid, requestKey, address, addressKey, activity, security);
  var vs := e.verifications;
  var mapped := e'.verifications[..|vs|];
  var added := e'.verifications[|vs|];
  assert e'.verifications == mapped + [added];
  assert backend__email_wellFormed(e', now) by {
    reveal backend__email_wellFormed, backend__email_currentVersion;
    ProofLib.FilterNone((v: backend__email_Verification) => (v.requestKey == requestKey), vs);
    forall k | 0 <= k < |e'.verifications|
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.id == e'.verifications[k].id), e'.verifications)| == 1
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.requestKey == e'.verifications[k].requestKey), e'.verifications)| == 1
    {
      var v := e'.verifications[k];
      ProofLib.FilterAppend((o: backend__email_Verification) => (o.id == v.id), mapped, added);
      ProofLib.FilterAppend((o: backend__email_Verification) => (o.requestKey == v.requestKey), mapped, added);
      if k < |vs| {
        assert vs[k] in vs;
        ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.id == vs[k].id), (o: backend__email_Verification) => (o.id == v.id), vs, mapped);
        ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.requestKey == vs[k].requestKey), (o: backend__email_Verification) => (o.requestKey == v.requestKey), vs, mapped);
        assert v.id <= lastEmailId < added.id;
        assert v.requestKey != requestKey;
      } else {
        assert v == added;
        forall j | 0 <= j < |mapped| ensures mapped[j].id != v.id && mapped[j].requestKey != v.requestKey {
          assert vs[j] in vs;
        }
        ProofLib.FilterNone((o: backend__email_Verification) => (o.id == v.id), mapped);
        ProofLib.FilterNone((o: backend__email_Verification) => (o.requestKey == v.requestKey), mapped);
      }
    }
    ProofLib.FilterNone((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), mapped);
    ProofLib.FilterAppend((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), mapped, added);
    if e'.destination.version > 0 {
      var v :| v in vs && v.consumed && v.version == e'.destination.version && v.address == e'.destination.address;
      var vi :| 0 <= vi < |vs| && vs[vi] == v;
      assert e'.verifications[vi] == v;
    }
  }
  assert backend__email_historyRetained(e, e') by {
    reveal backend__email_historyRetained;
    forall v | v in vs
      ensures exists w :: w in e'.verifications && w.id == v.id && w.address == v.address && w.activity == v.activity && w.security == v.security && w.createdAt == v.createdAt && (!v.consumed || (w.consumed && w.version == v.version)) && (!v.cancelled || w.cancelled)
    {
      var k :| 0 <= k < |vs| && vs[k] == v;
      assert e'.verifications[k] in e'.verifications;
    }
  }
}

lemma requestEmail_ensures(s: Accounts, by_: int, requestKey: int, address: string, addressKey: string, activity: bool, security: bool)
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysMembersIdentified(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysSessionsBelongToOpenMembers(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysClockShared(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysIdentityStoreValid(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysParticipationAwardsHistorical(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysRefusalsConsumed(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysPublicMembershipIsOpen(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysClosedPrivate(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysXRegistryValid(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysXLinkReserved(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysXLinkPublicWhenRecent(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysEmailValid(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> alwaysOutboxSeesCurrentConsent(requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepMembersPermanent(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepSessionIdsFresh(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepNoNewParticipationAward(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepSignInPreservesEmail(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepPublicationOnlyBySignIn(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepSessionLifetimeFixedAtSignIn(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepRevocationStaysInAccount(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepActiveMembershipNeverHidden(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepClosureCancelsWaitingMail(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepClosedAtStable(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepTelegramFrozen(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepXReservationsPermanent(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepFailedXKeepsLink(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepXConfersNoOtherAuthority(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepConsentOnlyFromExplicitChoice(s, "requestEmail", requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
  ensures (inv(s) ==> canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) ==> stepEmailHistoryRetained(s, requestEmail(s, by_, requestKey, address, addressKey, activity, security)))
{
  hide *;
  if inv(s) && canRequestEmail(s, by_, requestKey, address, addressKey, activity, security) {
    reveal inv, canRequestEmail, requestEmail, senderMember, backend__email_requestOutcome;
    var after := requestEmail(s, by_, requestKey, address, addressKey, activity, security);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    var m := s.members[i];
    var nid := s.lastEmailId + 1;
    var e' := backend__email_requestVerification(m.email, s.now, nid, requestKey, address, addressKey, activity, security);
    MemberEmailProps(s, i);
    RequestEmailValid(m.email, s.now, nid, requestKey, address, addressKey, activity, security, s.lastEmailId);
    WithEmailMemberFrame(s, i, e', after, "requestEmail");
    EmailValidAfterAppendVerification(s, i, e', after, nid);
    assert mailView(e') == mailView(m.email) by { reveal mailView; }
    KeepOutboxSameMailView(s, after);
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert stepConsentOnlyFromExplicitChoice(s, "requestEmail", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma VerifyEmailValid(e: backend__email_Enrollment, now: int, token: int, checkedRevision: int, nv: int)
  requires backend__email_wellFormed(e, now) && backend__email_canVerify(e, now, token, checkedRevision)
  requires nv > e.destination.version && nv > 0
  requires !e.preference.stored ==> e.preference.revision == 0 && e.preference.version == 0
  ensures var e' := backend__email_verify(e, now, token, nv);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.pilotVersion == e.pilotVersion && e'.unsubscribeTokens == e.unsubscribeTokens
    && e'.destination.version == nv && e'.preference.version == nv && e'.preference.stored
    && e'.preference.revision >= e.preference.revision
    && |e'.verifications| == |e.verifications|
    && (forall k :: 0 <= k < |e.verifications| ==> e'.verifications[k].id == e.verifications[k].id)
{
  hide *;
  reveal backend__email_canVerify, backend__email_verify, backend__email_pending,
    backend__email_currentVersion, ProofLib.Filter;
  VerificationByTokenHit(e, now, token);
  var vi :| 0 <= vi < |e.verifications|
    && e.verifications[vi] == backend__email_verificationByToken(e, token)
    && e.verifications[vi].tokenDigest == token
    && (forall j :: 0 <= j < |e.verifications| && j != vi ==> e.verifications[j].tokenDigest != token);
  var e' := backend__email_verify(e, now, token, nv);
  var vs := e.verifications;
  var vs' := e'.verifications;
  assert backend__email_wellFormed(e', now) by {
    reveal backend__email_wellFormed, backend__email_currentVersion;
    forall k | 0 <= k < |vs'|
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.id == vs'[k].id), vs')| == 1
      ensures |ProofLib.Filter((o: backend__email_Verification) => (o.requestKey == vs'[k].requestKey), vs')| == 1
    {
      assert vs[k] in vs;
      ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.id == vs[k].id), (o: backend__email_Verification) => (o.id == vs'[k].id), vs, vs');
      ProofLib.FilterLengthPointwise((o: backend__email_Verification) => (o.requestKey == vs[k].requestKey), (o: backend__email_Verification) => (o.requestKey == vs'[k].requestKey), vs, vs');
    }
    ProofLib.FilterPointwise((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), (v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled) && (v.tokenDigest != token)), (x: backend__email_Verification, y: backend__email_Verification) => true, vs', vs);
    ProofLib.FilterImpLength((v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled) && (v.tokenDigest != token)), (v: backend__email_Verification) => (!(v.consumed) && !(v.cancelled)), vs);
    assert vs'[vi] in vs' && vs'[vi].consumed && vs'[vi].version == nv && vs'[vi].address == e'.destination.address;
  }
  assert backend__email_historyRetained(e, e') by {
    reveal backend__email_historyRetained;
    forall v | v in vs
      ensures exists w :: w in vs' && w.id == v.id && w.address == v.address && w.activity == v.activity && w.security == v.security && w.createdAt == v.createdAt && (!v.consumed || (w.consumed && w.version == v.version)) && (!v.cancelled || w.cancelled)
    {
      var k :| 0 <= k < |vs| && vs[k] == v;
      assert vs'[k] in vs';
    }
  }
}

lemma verifyEmail_ensures(s: Accounts, by_: int, token: int, checkedRevision: int)
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysMembersIdentified(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysSessionsBelongToOpenMembers(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysClockShared(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysIdentityStoreValid(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysParticipationAwardsHistorical(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysRefusalsConsumed(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysPublicMembershipIsOpen(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysClosedPrivate(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysXRegistryValid(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysXLinkReserved(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysXLinkPublicWhenRecent(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysEmailValid(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> alwaysOutboxSeesCurrentConsent(verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepMembersPermanent(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepSessionIdsFresh(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepNoNewParticipationAward(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepSignInPreservesEmail(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepPublicationOnlyBySignIn(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepSessionLifetimeFixedAtSignIn(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepRevocationStaysInAccount(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepActiveMembershipNeverHidden(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepClosureCancelsWaitingMail(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepClosedAtStable(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepTelegramFrozen(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepXReservationsPermanent(s, verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepFailedXKeepsLink(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepXConfersNoOtherAuthority(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepConsentOnlyFromExplicitChoice(s, "verifyEmail", verifyEmail(s, by_, token, checkedRevision)))
  ensures (inv(s) ==> canVerifyEmail(s, by_, token, checkedRevision) ==> stepEmailHistoryRetained(s, verifyEmail(s, by_, token, checkedRevision)))
{
  hide *;
  if inv(s) && canVerifyEmail(s, by_, token, checkedRevision) {
    reveal inv, canVerifyEmail, verifyEmail, senderMember;
    var after := verifyEmail(s, by_, token, checkedRevision);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    var m := s.members[i];
    var nv := s.lastVersion + 1;
    var e' := backend__email_verify(m.email, s.now, token, nv);
    MemberEmailProps(s, i);
    VerifyEmailValid(m.email, s.now, token, checkedRevision, nv);
    WithEmailMemberFrame(s, i, e', after, "verifyEmail");
    EmailValidAfterSameIds(s, i, e', after);
    SyncMailPreservesOutbox(s, i, e', after);
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert stepConsentOnlyFromExplicitChoice(s, "verifyEmail", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma SetConsentValid(e: backend__email_Enrollment, now: int, activity: bool, choice: backend__email_SecurityChoice, suppliedVersion: int, checkedRevision: int, lastVersion: int)
  requires backend__email_wellFormed(e, now)
  requires backend__email_consentOutcome(e, activity, choice, suppliedVersion, checkedRevision).ConsentSaved?
  requires e.destination.version <= lastVersion && e.preference.version <= lastVersion && e.pilotVersion <= lastVersion
  requires !e.preference.stored ==> e.preference.revision == 0 && e.preference.version == 0
  ensures var e' := backend__email_setConsent(e, activity, choice, suppliedVersion, checkedRevision);
    backend__email_wellFormed(e', now) && backend__email_historyRetained(e, e')
    && e'.actor == e.actor && e'.verifications == e.verifications && e'.destination == e.destination
    && e'.pilotVersion == e.pilotVersion && e'.unsubscribeTokens == e.unsubscribeTokens
    && e'.preference.stored && e'.preference.version <= lastVersion
    && e'.preference.revision >= e.preference.revision
{
  hide *;
  reveal backend__email_wellFormed, backend__email_consentOutcome, backend__email_setConsent,
    backend__email_needsVerifiedVersion, backend__email_securityAfter, backend__email_currentVersion,
    backend__email_historyRetained;
}

lemma setEmailConsent_ensures(s: Accounts, by_: int, activity: bool, choice: backend__email_SecurityChoice, suppliedVersion: int, checkedRevision: int)
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysMembersIdentified(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysSessionsBelongToOpenMembers(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysClockShared(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysIdentityStoreValid(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysParticipationAwardsHistorical(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysRefusalsConsumed(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysPublicMembershipIsOpen(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysClosedPrivate(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysXRegistryValid(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysXLinkReserved(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysXLinkPublicWhenRecent(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysEmailValid(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> alwaysOutboxSeesCurrentConsent(setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepMembersPermanent(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepSessionIdsFresh(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepNoNewParticipationAward(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepSignInPreservesEmail(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepPublicationOnlyBySignIn(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepSessionLifetimeFixedAtSignIn(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepRevocationStaysInAccount(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepActiveMembershipNeverHidden(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepClosureCancelsWaitingMail(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepClosedAtStable(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepTelegramFrozen(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepXReservationsPermanent(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepFailedXKeepsLink(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepXConfersNoOtherAuthority(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepConsentOnlyFromExplicitChoice(s, "setEmailConsent", setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
  ensures (inv(s) ==> canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) ==> stepEmailHistoryRetained(s, setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision)))
{
  hide *;
  if inv(s) && canSetEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision) {
    reveal inv, canSetEmailConsent, setEmailConsent, senderMember;
    var after := setEmailConsent(s, by_, activity, choice, suppliedVersion, checkedRevision);
    SenderActorMember(s, by_);
    var i :| 0 <= i < |s.members| && s.members[i].actor == senderActor(s, by_) && s.members[i].membership.Open? && memberByActor(s, senderActor(s, by_)) == s.members[i];
    MemberFieldsValid(s, i);
    var m := s.members[i];
    var e' := backend__email_setConsent(m.email, activity, choice, suppliedVersion, checkedRevision);
    MemberEmailProps(s, i);
    SetConsentValid(m.email, s.now, activity, choice, suppliedVersion, checkedRevision, s.lastVersion);
    WithEmailMemberFrame(s, i, e', after, "setEmailConsent");
    EmailValidAfterSameIds(s, i, e', after);
    SyncMailPreservesOutbox(s, i, e', after);
    assert alwaysClosedPrivate(after) by { reveal alwaysClosedPrivate; }
    assert stepConsentOnlyFromExplicitChoice(s, "setEmailConsent", after) by { reveal stepConsentOnlyFromExplicitChoice; }
    StepEmailHistoryRetainedOne(s, i, e', after);
  }
}

lemma identityStart_ensures(s: Accounts, client: int, audience: backend__identity_Audience)
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysMembersIdentified(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysSessionsBelongToOpenMembers(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysClockShared(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysIdentityStoreValid(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysParticipationAwardsHistorical(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysRefusalsConsumed(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysPublicMembershipIsOpen(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysClosedPrivate(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysXRegistryValid(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysXLinkReserved(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysXLinkPublicWhenRecent(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysEmailValid(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> alwaysOutboxSeesCurrentConsent(identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepMembersPermanent(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepSessionIdsFresh(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepNoNewParticipationAward(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepSignInPreservesEmail(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepPublicationOnlyBySignIn(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepSessionLifetimeFixedAtSignIn(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepRevocationStaysInAccount(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepActiveMembershipNeverHidden(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepClosureCancelsWaitingMail(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepClosedAtStable(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepTelegramFrozen(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepXReservationsPermanent(s, identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepFailedXKeepsLink(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepXConfersNoOtherAuthority(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepConsentOnlyFromExplicitChoice(s, "identityStart", identityStart(s, client, audience)))
  ensures (inv(s) ==> canIdentityStart(s, client, audience) ==> stepEmailHistoryRetained(s, identityStart(s, client, audience)))
{
  hide *;
  if inv(s) && canIdentityStart(s, client, audience) {
    reveal inv, canIdentityStart, identityStart, alwaysClockShared, backend__identity_start;
    var after := identityStart(s, client, audience);
    IdentityStoreIsInv(s);
    backend__identity_start_ensures(s.identity, client, audience, backend__identity_FlowMode.Production, true);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv;
    }
    IdentityOnlyFrame(s, after, "identityStart");
  }
}

lemma identityClaimCallback_ensures(s: Accounts, oauthState: int, cookie: int)
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysMembersIdentified(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysSessionsBelongToOpenMembers(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysClockShared(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysIdentityStoreValid(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysParticipationAwardsHistorical(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysRefusalsConsumed(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysPublicMembershipIsOpen(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysClosedPrivate(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysXRegistryValid(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysXLinkReserved(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysXLinkPublicWhenRecent(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysEmailValid(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> alwaysOutboxSeesCurrentConsent(identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepMembersPermanent(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepSessionIdsFresh(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepNoNewParticipationAward(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepSignInPreservesEmail(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepPublicationOnlyBySignIn(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepSessionLifetimeFixedAtSignIn(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepRevocationStaysInAccount(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepActiveMembershipNeverHidden(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepClosureCancelsWaitingMail(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepClosedAtStable(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepTelegramFrozen(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepXReservationsPermanent(s, identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepFailedXKeepsLink(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepXConfersNoOtherAuthority(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepConsentOnlyFromExplicitChoice(s, "identityClaimCallback", identityClaimCallback(s, oauthState, cookie)))
  ensures (inv(s) ==> canIdentityClaimCallback(s, oauthState, cookie) ==> stepEmailHistoryRetained(s, identityClaimCallback(s, oauthState, cookie)))
{
  hide *;
  if inv(s) && canIdentityClaimCallback(s, oauthState, cookie) {
    reveal inv, canIdentityClaimCallback, identityClaimCallback, alwaysClockShared, backend__identity_claimCallback;
    var after := identityClaimCallback(s, oauthState, cookie);
    IdentityStoreIsInv(s);
    backend__identity_claimCallback_ensures(s.identity, oauthState, cookie);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv;
    }
    IdentityOnlyFrame(s, after, "identityClaimCallback");
  }
}

lemma identityFailCallback_ensures(s: Accounts, by_: int, flowId: int)
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysMembersIdentified(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysSessionsBelongToOpenMembers(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysClockShared(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysIdentityStoreValid(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysParticipationAwardsHistorical(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysRefusalsConsumed(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysPublicMembershipIsOpen(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysClosedPrivate(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysXRegistryValid(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysXLinkReserved(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysXLinkPublicWhenRecent(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysEmailValid(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> alwaysOutboxSeesCurrentConsent(identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepMembersPermanent(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepSessionIdsFresh(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepNoNewParticipationAward(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepSignInPreservesEmail(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepPublicationOnlyBySignIn(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepSessionLifetimeFixedAtSignIn(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepRevocationStaysInAccount(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepActiveMembershipNeverHidden(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepClosureCancelsWaitingMail(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepClosedAtStable(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepTelegramFrozen(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepXReservationsPermanent(s, identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepFailedXKeepsLink(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepXConfersNoOtherAuthority(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepConsentOnlyFromExplicitChoice(s, "identityFailCallback", identityFailCallback(s, by_, flowId)))
  ensures (inv(s) ==> canIdentityFailCallback(s, by_, flowId) ==> stepEmailHistoryRetained(s, identityFailCallback(s, by_, flowId)))
{
  hide *;
  if inv(s) && canIdentityFailCallback(s, by_, flowId) {
    reveal inv, canIdentityFailCallback, identityFailCallback, alwaysClockShared, backend__identity_failCallback;
    var after := identityFailCallback(s, by_, flowId);
    IdentityStoreIsInv(s);
    backend__identity_failCallback_ensures(s.identity, by_, flowId);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv;
    }
    IdentityOnlyFrame(s, after, "identityFailCallback");
  }
}

lemma identityCompleteCallback_ensures(s: Accounts, by_: int, flowId: int, github: backend__identity_GitHubIdentity)
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysMembersIdentified(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysSessionsBelongToOpenMembers(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysClockShared(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysIdentityStoreValid(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysParticipationAwardsHistorical(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysRefusalsConsumed(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysPublicMembershipIsOpen(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysClosedPrivate(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysXRegistryValid(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysXLinkReserved(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysXLinkPublicWhenRecent(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysEmailValid(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> alwaysOutboxSeesCurrentConsent(identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepMembersPermanent(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepSessionIdsFresh(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepNoNewParticipationAward(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepSignInPreservesEmail(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepPublicationOnlyBySignIn(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepSessionLifetimeFixedAtSignIn(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepRevocationStaysInAccount(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepActiveMembershipNeverHidden(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepClosureCancelsWaitingMail(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepClosedAtStable(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepTelegramFrozen(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepXReservationsPermanent(s, identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepFailedXKeepsLink(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepXConfersNoOtherAuthority(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepConsentOnlyFromExplicitChoice(s, "identityCompleteCallback", identityCompleteCallback(s, by_, flowId, github)))
  ensures (inv(s) ==> canIdentityCompleteCallback(s, by_, flowId, github) ==> stepEmailHistoryRetained(s, identityCompleteCallback(s, by_, flowId, github)))
{
  hide *;
  if inv(s) && canIdentityCompleteCallback(s, by_, flowId, github) {
    reveal inv, canIdentityCompleteCallback, identityCompleteCallback, alwaysClockShared, backend__identity_completeCallback;
    var after := identityCompleteCallback(s, by_, flowId, github);
    IdentityStoreIsInv(s);
    backend__identity_completeCallback_ensures(s.identity, by_, flowId, github);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv;
    }
    IdentityOnlyFrame(s, after, "identityCompleteCallback");
  }
}

lemma identityPoll_ensures(s: Accounts, client: int, flowId: int, capability: int, audience: backend__identity_Audience)
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysMembersIdentified(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysSessionsBelongToOpenMembers(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysClockShared(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysIdentityStoreValid(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysParticipationAwardsHistorical(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysRefusalsConsumed(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysPublicMembershipIsOpen(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysClosedPrivate(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysXRegistryValid(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysXLinkReserved(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysXLinkPublicWhenRecent(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysEmailValid(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> alwaysOutboxSeesCurrentConsent(identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepMembersPermanent(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepSessionIdsFresh(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepNoNewParticipationAward(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepSignInPreservesEmail(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepPublicationOnlyBySignIn(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepSessionLifetimeFixedAtSignIn(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepRevocationStaysInAccount(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepActiveMembershipNeverHidden(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepClosureCancelsWaitingMail(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepClosedAtStable(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepTelegramFrozen(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepXReservationsPermanent(s, identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepFailedXKeepsLink(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepXConfersNoOtherAuthority(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepConsentOnlyFromExplicitChoice(s, "identityPoll", identityPoll(s, client, flowId, capability, audience)))
  ensures (inv(s) ==> canIdentityPoll(s, client, flowId, capability, audience) ==> stepEmailHistoryRetained(s, identityPoll(s, client, flowId, capability, audience)))
{
  hide *;
  if inv(s) && canIdentityPoll(s, client, flowId, capability, audience) {
    reveal inv, canIdentityPoll, identityPoll, alwaysClockShared, backend__identity_storeAssertion, backend__identity_issueAssertion, ProofLib.Filter;
    var after := identityPoll(s, client, flowId, capability, audience);
    var mid := backend__identity_storeAssertion(s.identity, client, flowId, capability, audience, true);
    IdentityStoreIsInv(s);
    backend__identity_storeAssertion_ensures(s.identity, client, flowId, capability, audience, true);
    assert backend__identity_inv(mid) by { reveal backend__identity_inv; }
    backend__identity_issueAssertion_ensures(mid, flowId, capability, audience, true);
    assert alwaysIdentityStoreValid(after) by {
      reveal alwaysIdentityStoreValid, backend__identity_inv, backend__identity_canStoreAssertion,
        backend__identity_pollOutcome, backend__identity_live, backend__identity_flowById,
        backend__identity_absentFlow, backend__identity_alwaysIdentityAfterCallback, backend__identity_identityComplete;
      if !backend__identity_hasAssertion(s.identity, flowId) {
        var pf := (f: backend__identity_Flow) => (f.id == flowId);
        var fres := ProofLib.Filter(pf, s.identity.flows);
        assert |fres| > 0;
        ProofLib.FilterMember(pf, s.identity.flows, fres[0]);
        assert fres[0].status.CallbackComplete?;
        assert fres[0].github.login != "";
      }
    }
    IdentityOnlyFrame(s, after, "identityPoll");
  }
}
