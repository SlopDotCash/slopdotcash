// The verified X identity is nonempty, retained and present after set union.
lemma connectX_ensures(a: Account, by_: int, xId: string, oauthVerified: bool, reservationOwned: bool, disclosed: bool)
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysRetainedHistory(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysSessionEpoch(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysIdentityIds(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysSessionMember(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysActorValid(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysClosedPrivate(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysXReservation(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> alwaysXVisibility(connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
  ensures (inv(a) ==> canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) ==> stepHistoryIsStable(a, connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed)))
{
  if inv(a) && canConnectX(a, by_, xId, oauthVerified, reservationOwned, disclosed) {
    var added := ProofLib.Filter((set_x: string) => !(set_x in a.reservedXIds), [xId]);
    ProofLib.FilterMember((set_x: string) => !(set_x in a.reservedXIds), [xId], xId);
    forall id | id in a.reservedXIds + added
      ensures id != ""
    {
      if !(id in a.reservedXIds) {
        ProofLib.FilterMember((set_x: string) => !(set_x in a.reservedXIds), [xId], id);
      }
    }
    assert connectX(a, by_, xId, oauthVerified, reservationOwned, disclosed).reservedXIds == a.reservedXIds + added;
    assert xId in a.reservedXIds + added;
  }
}
