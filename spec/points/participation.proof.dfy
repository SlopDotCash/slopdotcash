// Appending a member, an award or a claim with a fresh key keeps one occurrence per key.
lemma join_ensures(s: Participation, actor: int)
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysMembersWellFormed(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysClosedAreMembers(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysClaimsUnique(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysLinksClaimed(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> alwaysAwardsWellFormed(join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> stepAwardsPermanent(s, join(s, actor)))
  ensures (inv(s) ==> canJoin(s, actor) ==> stepNoAwardFromCutoff(s, "join", join(s, actor)))
{
  if inv(s) && canJoin(s, actor) {
    MembersMeaning(s);
    AppendUniqueMember(s.members, Member(actor, s.now, 5));
    MembersMeaning(join(s, actor));
  }
}

lemma connectX_ensures(s: Participation, actor: int, xId: int)
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysMembersWellFormed(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysClosedAreMembers(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysClaimsUnique(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysLinksClaimed(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> alwaysAwardsWellFormed(connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> stepAwardsPermanent(s, connectX(s, actor, xId)))
  ensures (inv(s) ==> canConnectX(s, actor, xId) ==> stepNoAwardFromCutoff(s, "connectX", connectX(s, actor, xId)))
{
  if inv(s) && canConnectX(s, actor, xId) {
    var after := connectX(s, actor, xId);
    ClaimsGrow(s, actor, xId);
    if !claimed(s, xId) {
      AppendUniqueClaim(s.claims, XClaim(xId, actor));
    }
    if earnsAward(s, actor, xId) {
      AppendUniqueAward(s.awards, XAward(actor, xId, s.now, 10));
    }
    forall k | k in after.links
      ensures claimedBy(after, k.xId, k.actor)
    {
      var kept := ProofLib.Filter((o: XLink) => (o.actor != actor), s.links);
      if k in kept {
        ProofLib.FilterMember((o: XLink) => (o.actor != actor), s.links, k);
      }
    }
  }
}

lemma retainStoredAward_ensures(s: Participation, a: XAward)
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> alwaysMembersWellFormed(retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> alwaysClosedAreMembers(retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> alwaysClaimsUnique(retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> alwaysLinksClaimed(retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> alwaysAwardsWellFormed(retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> stepAwardsPermanent(s, retainStoredAward(s, a)))
  ensures (inv(s) ==> canRetainStoredAward(s, a) ==> stepNoAwardFromCutoff(s, "retainStoredAward", retainStoredAward(s, a)))
{
  if inv(s) && canRetainStoredAward(s, a) {
    ClaimsGrow(s, a.actor, a.xId);
    if !claimed(s, a.xId) {
      AppendUniqueClaim(s.claims, XClaim(a.xId, a.actor));
    }
    AppendUniqueAward(s.awards, a);
  }
}

lemma ClaimsGrow(s: Participation, actor: int, xId: int)
  requires !claimedByOther(s, xId, actor)
  ensures forall c :: c in s.claims ==> c in withClaim(s, actor, xId)
  ensures exists c :: c in withClaim(s, actor, xId) && c.xId == xId && c.actor == actor
{
  if !claimed(s, xId) {
    assert withClaim(s, actor, xId)[|s.claims|] == XClaim(xId, actor);
  } else {
    var c :| c in s.claims && c.xId == xId;
  }
}

lemma AppendUniqueClaim(xs: seq<XClaim>, n: XClaim)
  requires forall c :: c in xs ==> |ProofLib.Filter((o: XClaim) => (o.xId == c.xId), xs)| == 1
  requires forall c :: c in xs ==> c.xId != n.xId
  ensures forall c :: c in xs + [n] ==> |ProofLib.Filter((o: XClaim) => (o.xId == c.xId), xs + [n])| == 1
{
  forall c | c in xs + [n]
    ensures |ProofLib.Filter((o: XClaim) => (o.xId == c.xId), xs + [n])| == 1
  {
    ProofLib.FilterAppend((o: XClaim) => (o.xId == c.xId), xs, n);
    if c.xId == n.xId {
      ProofLib.FilterNone((o: XClaim) => (o.xId == c.xId), xs);
    }
  }
}

lemma MembersMeaning(s: Participation)
  ensures alwaysMembersWellFormed(s) == !((exists m :: m in s.members && !(((((m.actor > 0) && (m.welcome == 5)) && (m.joinedAt <= s.now)) && (|ProofLib.Filter((o: Member) => (o.actor == m.actor), s.members)| == 1)))))
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
