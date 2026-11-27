lemma ReleasedHistoricalNetworks(s: Activation, on: seq<operations__escrowQualification_Network>, by_: Actor)
  ensures releaseSwitches(s, on, by_).historicalNetworks == ProofLib.Filter((set_x: operations__escrowQualification_Network) => (set_x in on), s.historicalNetworks)
{
}

lemma releaseSwitches_ensures(s: Activation, on: seq<operations__escrowQualification_Network>, by_: Actor)
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> alwaysHistoricalNetworksAreReviewed(releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> alwaysNetworkListIsSwitchedOn(releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> alwaysLedgerShape(releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> alwaysSwitchNeedsActivatedLane(releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> stepEvidenceOnlyGrows(s, releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> stepHistoricalNetworksCannotReturn(s, releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> stepSecretReadOnlyWhenSwitchedOn(s, releaseSwitches(s, on, by_)))
  ensures (inv(s) ==> canReleaseSwitches(s, on, by_) ==> stepReadsAppendOnly(s, releaseSwitches(s, on, by_)))
{
  if inv(s) && canReleaseSwitches(s, on, by_) {
    var after := releaseSwitches(s, on, by_);
    var p := (set_x: operations__escrowQualification_Network) => (set_x in on);
    ReleasedHistoricalNetworks(s, on, by_);
    forall x
      ensures x in after.historicalNetworks <==> (x in s.historicalNetworks && x in on)
    {
      ProofLib.FilterMember(p, s.historicalNetworks, x);
    }
  }
}
