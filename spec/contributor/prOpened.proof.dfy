lemma record_ensures(o: OpenedRun, by_: int, prNode: string, at: int)
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> alwaysRegisteredIdentity(record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> alwaysEventsDistinct(record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> stepEvidenceFrozenAfterFinal(o, record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> stepEventsAppendOnly(o, record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> stepRefusalChangesNothing(o, "record", record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> stepIdentityFixed(o, record(o, by_, prNode, at)))
  ensures (inv(o) ==> canRecord(o, by_, prNode, at) ==> stepParticipationNeverLost(o, record(o, by_, prNode, at)))
{
  if inv(o) && canRecord(o, by_, prNode, at) && !(at in o.events) {
    var next := record(o, by_, prNode, at);
    forall e | e in next.events
      ensures e > 0 && |Std.Collections.Seq.Filter((x: int) => (x == e), next.events)| == 1
    {
      ProofLib.FilterAppend((x: int) => (x == e), o.events, at);
      if e == at {
        assert forall i :: 0 <= i < |o.events| ==> o.events[i] != at;
        ProofLib.FilterNone((x: int) => (x == e), o.events);
        assert |Std.Collections.Seq.Filter((x: int) => (x == e), o.events)| == 0;
      } else {
        assert e in o.events;
        assert alwaysEventsDistinct(o);
        assert e > 0 && |Std.Collections.Seq.Filter((x: int) => (x == e), o.events)| == 1;
      }
    }
  }
}
