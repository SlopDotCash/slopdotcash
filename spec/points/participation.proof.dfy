// Appending a member or an award with a fresh key keeps one occurrence per key.
lemma join_ensures(s: Participation, actor: int)
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysMembersWellFormed(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysAwardsBeforeCutoff(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> stepAwardsPermanent(s, join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> stepNoAwardFromCutoff(s, join(s, actor)))
{
  if inv(s) && canJoin(s, actor) {
    MembersMeaning(s);
    AppendUniqueMember(s.members, Member(actor, s.now, 5));
    MembersMeaning(join(s, actor));
  }
}

lemma connectX_ensures(s: Participation, actor: int, xId: int)
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysMembersWellFormed(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysAwardsBeforeCutoff(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> stepAwardsPermanent(s, connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> stepNoAwardFromCutoff(s, connectX(s, actor, xId)))
{
  if inv(s) && canConnectX(s, actor, xId) {
    AwardsMeaning(s);
    if earnsAward(s, actor, xId) {
      AppendUniqueAward(s.awards, XAward(actor, xId, s.now, 10));
    }
    AwardsMeaning(connectX(s, actor, xId));
  }
}

lemma MembersMeaning(s: Participation)
  ensures alwaysMembersWellFormed(s) == !((exists m :: m in s.members && !(((((m.actor > 0) && (m.welcome == 5)) && (m.joinedAt <= s.now)) && (|ProofLib.Filter((o: Member) => (o.actor == m.actor), s.members)| == 1)))))
{
}

lemma AwardsMeaning(s: Participation)
  ensures alwaysAwardsBeforeCutoff(s) == !((exists a :: a in s.awards && !(((((((a.awardedAt < participationEnd) && (a.points == 10)) && (a.actor > 0)) && (a.xId > 0)) && (|ProofLib.Filter((o: XAward) => (o.actor == a.actor), s.awards)| == 1)) && (|ProofLib.Filter((o: XAward) => (o.xId == a.xId), s.awards)| == 1)))))
{
}

lemma AppendUniqueMember(xs: seq<Member>, n: Member)
  requires forall m :: m in xs ==> |ProofLib.Filter((o: Member) => (o.actor == m.actor), xs)| == 1
  requires forall m :: m in xs ==> m.actor != n.actor
  ensures forall m :: m in xs + [n] ==> |ProofLib.Filter((o: Member) => (o.actor == m.actor), xs + [n])| == 1
{
  forall m | m in xs + [n]
    ensures |ProofLib.Filter((o: Member) => (o.actor == m.actor), xs + [n])| == 1
  {
    ProofLib.FilterAppend((o: Member) => (o.actor == m.actor), xs, n);
    if m.actor == n.actor {
      ProofLib.FilterNone((o: Member) => (o.actor == m.actor), xs);
    }
  }
}

lemma AppendUniqueAward(xs: seq<XAward>, n: XAward)
  requires forall a :: a in xs ==> |ProofLib.Filter((o: XAward) => (o.actor == a.actor), xs)| == 1
  requires forall a :: a in xs ==> |ProofLib.Filter((o: XAward) => (o.xId == a.xId), xs)| == 1
  requires forall a :: a in xs ==> a.actor != n.actor && a.xId != n.xId
  ensures forall a :: a in xs + [n] ==> |ProofLib.Filter((o: XAward) => (o.actor == a.actor), xs + [n])| == 1
  ensures forall a :: a in xs + [n] ==> |ProofLib.Filter((o: XAward) => (o.xId == a.xId), xs + [n])| == 1
{
  forall a | a in xs + [n]
    ensures |ProofLib.Filter((o: XAward) => (o.actor == a.actor), xs + [n])| == 1
    ensures |ProofLib.Filter((o: XAward) => (o.xId == a.xId), xs + [n])| == 1
  {
    ProofLib.FilterAppend((o: XAward) => (o.actor == a.actor), xs, n);
    ProofLib.FilterAppend((o: XAward) => (o.xId == a.xId), xs, n);
    if a.actor == n.actor {
      ProofLib.FilterNone((o: XAward) => (o.actor == a.actor), xs);
    }
    if a.xId == n.xId {
      ProofLib.FilterNone((o: XAward) => (o.xId == a.xId), xs);
    }
  }
}
