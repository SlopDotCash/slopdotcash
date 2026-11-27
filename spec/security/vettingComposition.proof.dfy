lemma RecordForFilter(v: Vetting, assessment: int)
  ensures recordFor(v, assessment) == (
    var filtered := ProofLib.Filter((r: security__admission_AssessmentRecord) => (r.assessment == assessment), v.records);
    if ((0 <= 0) && (0 < |filtered|)) then
      filtered[0]
    else
      security__admission_AssessmentRecord(0, 0, 0, 0, security__admission_Disposition.NoDisposition, false, false, false)
  )
{
}

lemma AlwaysRecordsUniqueFilter(v: Vetting)
  ensures alwaysRecordsUnique(v) == !((exists r :: r in v.records && !(((r.assessment > 0) && (|ProofLib.Filter((o: security__admission_AssessmentRecord) => (o.assessment == r.assessment), v.records)| == 1)))))
{
}

lemma ObserveEvidenceUnverifiedFilter(e: security__enforcement_Enforcement, by_: int, repository: int, evidenceRead: security__enforcement_EvidenceRead)
  ensures security__enforcement_observeEvidence(e, by_, repository, evidenceRead).unverified == (
    if evidenceRead.present then
      ProofLib.Filter((set_x: int) => !((set_x in [evidenceRead.assessment])), e.unverified)
    else
      (e.unverified + ProofLib.Filter((set_x: int) => !((set_x in e.unverified)), [evidenceRead.assessment]))
  )
{
}

lemma ObserveEvidenceUnverifiedMember(e: security__enforcement_Enforcement, by_: int, repository: int, evidenceRead: security__enforcement_EvidenceRead, id: int)
  ensures (id in security__enforcement_observeEvidence(e, by_, repository, evidenceRead).unverified) == (if evidenceRead.present then ((id in e.unverified) && (id != evidenceRead.assessment)) else ((id in e.unverified) || (id == evidenceRead.assessment)))
{
  ObserveEvidenceUnverifiedFilter(e, by_, repository, evidenceRead);
  if evidenceRead.present {
    ProofLib.FilterMember((set_x: int) => !((set_x in [evidenceRead.assessment])), e.unverified, id);
  } else {
    var p := (set_x: int) => !((set_x in e.unverified));
    ProofLib.FilterCons(p, [evidenceRead.assessment]);
    ProofLib.FilterNil(p, [evidenceRead.assessment][1..]);
  }
}

lemma CompletedAtPinFilter(e: security__enforcement_Enforcement, repository: int, pins: seq<security__enforcement_PinRead>)
  ensures security__enforcement_completedAtPin(e, repository, pins) == (
    if security__enforcement_pinUnavailable(pins, repository) then
      []
    else
      ProofLib.Filter((a: security__enforcement_Assessment) => (((a.repository == repository) && (a.identity == security__enforcement_identityOf(e, repository))) && security__enforcement_atLivePin(pins, repository, a.id)), e.recorded)
  )
{
}

lemma RecordForPresent(v: Vetting, id: int)
  requires recordFor(v, id).result.DClean?
  ensures exists r :: r in v.records && r.assessment == id
{
  RecordForFilter(v, id);
  var p := (r: security__admission_AssessmentRecord) => (r.assessment == id);
  var filtered := ProofLib.Filter(p, v.records);
  assert |filtered| > 0;
  ProofLib.FilterMember(p, v.records, filtered[0]);
}

lemma RecordForAppend(v: Vetting, after: Vetting, rec: security__admission_AssessmentRecord, id: int)
  requires after.records == v.records + [rec]
  requires !(exists r :: r in v.records && r.assessment == rec.assessment)
  ensures id == rec.assessment ==> recordFor(after, id) == rec
  ensures id != rec.assessment ==> recordFor(after, id) == recordFor(v, id)
{
  var p := (r: security__admission_AssessmentRecord) => (r.assessment == id);
  RecordForFilter(v, id);
  RecordForFilter(after, id);
  ProofLib.FilterAppend(p, v.records, rec);
  if id == rec.assessment {
    ProofLib.FilterNone(p, v.records);
    assert ProofLib.Filter(p, v.records) == [];
    assert ProofLib.Filter(p, after.records) == [rec];
  } else {
    assert ProofLib.Filter(p, after.records) == ProofLib.Filter(p, v.records);
  }
}

lemma deliver_ensures(v: Vetting, by_: int, scan: security__admission_Scan, readable: bool)
  ensures (inv(v) ==> canDeliver(v, by_, scan, readable) ==> alwaysRecordsUnique(deliver(v, by_, scan, readable)))
  ensures (inv(v) ==> canDeliver(v, by_, scan, readable) ==> alwaysCleanFedOnlyByQualifiedRecord(deliver(v, by_, scan, readable)))
  ensures (inv(v) ==> canDeliver(v, by_, scan, readable) ==> alwaysCompletedCleanHasQualifiedRecord(deliver(v, by_, scan, readable)))
  ensures (inv(v) ==> canDeliver(v, by_, scan, readable) ==> stepRecordsRetained(v, deliver(v, by_, scan, readable)))
  ensures (inv(v) ==> canDeliver(v, by_, scan, readable) ==> stepFlagPauseLiftsOnlyOnFreshRecords(v, "deliver", deliver(v, by_, scan, readable)))
{
  if inv(v) && canDeliver(v, by_, scan, readable) {
    var rec := security__admission_recordOf(scan, readable);
    var recorded := security__enforcement_recordResult(v.security, by_, security__admission_outcomeOf(scan), security__enforcement_RevisionPlan.RevisionNotNeeded);
    var after := deliver(v, by_, scan, readable);
    assert after.records == v.records + [rec];

    AlwaysRecordsUniqueFilter(v);
    AlwaysRecordsUniqueFilter(after);
    forall r | r in after.records ensures r.assessment > 0 && |ProofLib.Filter((o: security__admission_AssessmentRecord) => (o.assessment == r.assessment), after.records)| == 1 {
      var p := (o: security__admission_AssessmentRecord) => (o.assessment == r.assessment);
      ProofLib.FilterAppend(p, v.records, rec);
      if r == rec {
        ProofLib.FilterNone(p, v.records);
      } else {
        assert r in v.records;
        assert r.assessment != rec.assessment;
      }
    }

    forall r | r in after.security.repositories
      ensures security__enforcement_latestOf(after.security, r).state.NotAssessed? || security__enforcement_latestOf(after.security, r).repository == r
      ensures security__enforcement_latestOf(after.security, r).identity <= security__enforcement_identityOf(after.security, r)
      ensures security__enforcement_assessedClean(after.security, r) ==> (
        var id := security__enforcement_latestOf(after.security, r).id;
        recordFor(after, id).result.DClean? &&
        recordFor(after, id).evidenceAvailable &&
        !recordFor(after, id).investigationOpen &&
        recordFor(after, id).repository == r &&
        recordFor(after, id).identityEpoch == security__enforcement_identityOf(after.security, r) &&
        recordFor(after, id).reused == security__enforcement_latestOf(after.security, r).reused
      )
    {
      if r == rec.repository {
        RecordForAppend(v, after, rec, rec.assessment);
        if scan.recorded.DClean? {
          assert security__enforcement_latestOf(after.security, r).id == rec.assessment;
          assert security__enforcement_latestOf(after.security, r).verified == rec.evidenceAvailable;
        }
      } else {
        assert security__enforcement_latestOf(after.security, r) == security__enforcement_latestOf(v.security, r);
        assert security__enforcement_identityOf(after.security, r) == security__enforcement_identityOf(v.security, r);
        if security__enforcement_assessedClean(after.security, r) {
          var id := security__enforcement_latestOf(v.security, r).id;
          assert recordFor(v, id).result.DClean?;
          RecordForPresent(v, id);
          assert id != rec.assessment;
          RecordForAppend(v, after, rec, id);
        }
      }
    }

    forall a | a in after.security.recorded && a.state.AClean?
      ensures recordFor(after, a.id).result.DClean?
      ensures recordFor(after, a.id).repository == a.repository
      ensures recordFor(after, a.id).reused == a.reused
      ensures !recordFor(after, a.id).investigationOpen
      ensures recordFor(after, a.id).evidenceAvailable || (a.id in after.security.unverified)
    {
      if scan.recorded.DClean? {
        ObserveEvidenceUnverifiedMember(recorded, security__enforcement_platform, rec.repository, security__enforcement_EvidenceRead(rec.assessment, rec.evidenceAvailable), a.id);
      }
      if a in v.security.recorded {
        assert recordFor(v, a.id).result.DClean?;
        RecordForPresent(v, a.id);
        assert a.id != rec.assessment;
        RecordForAppend(v, after, rec, a.id);
      } else {
        assert scan.recorded.DClean?;
        assert a.id == rec.assessment;
        RecordForAppend(v, after, rec, a.id);
      }
    }
  }
}

lemma reinstateFlagPause_ensures(v: Vetting, by_: int, pins: seq<security__enforcement_PinRead>)
  ensures (inv(v) ==> canReinstateFlagPause(v, by_, pins) ==> alwaysRecordsUnique(reinstateFlagPause(v, by_, pins)))
  ensures (inv(v) ==> canReinstateFlagPause(v, by_, pins) ==> alwaysCleanFedOnlyByQualifiedRecord(reinstateFlagPause(v, by_, pins)))
  ensures (inv(v) ==> canReinstateFlagPause(v, by_, pins) ==> alwaysCompletedCleanHasQualifiedRecord(reinstateFlagPause(v, by_, pins)))
  ensures (inv(v) ==> canReinstateFlagPause(v, by_, pins) ==> stepRecordsRetained(v, reinstateFlagPause(v, by_, pins)))
  ensures (inv(v) ==> canReinstateFlagPause(v, by_, pins) ==> stepFlagPauseLiftsOnlyOnFreshRecords(v, "reinstateFlagPause", reinstateFlagPause(v, by_, pins)))
{
  if inv(v) && canReinstateFlagPause(v, by_, pins) {
    var after := reinstateFlagPause(v, by_, pins);
    var prov := security__enforcement_provenance(v.security, pins);
    assert security__enforcement_provenanceOf(after.security) == prov;
    forall r | r in v.security.repositories
      ensures exists id :: id in security__enforcement_provenanceOf(after.security) && recordFor(v, id).repository == r && security__admission_liftsFlagPause(recordFor(v, id))
    {
      var idx :| 0 <= idx < |v.security.repositories| && v.security.repositories[idx] == r;
      var a := security__enforcement_decidingAt(v.security, r, pins);
      assert security__enforcement_freshAtPin(v.security, r, pins);
      assert a.state.AClean? && !a.reused && !(a.id in v.security.unverified);
      CompletedAtPinFilter(v.security, r, pins);
      var pred := (x: security__enforcement_Assessment) => (((x.repository == r) && (x.identity == security__enforcement_identityOf(v.security, r))) && security__enforcement_atLivePin(pins, r, x.id));
      assert !security__enforcement_pinUnavailable(pins, r);
      var filtered := ProofLib.Filter(pred, v.security.recorded);
      assert |filtered| > 0;
      assert a == filtered[|filtered| - 1];
      ProofLib.FilterMember(pred, v.security.recorded, a);
      assert a in v.security.recorded && a.repository == r;
      assert recordFor(v, a.id).repository == r;
      assert security__admission_liftsFlagPause(recordFor(v, a.id));
      assert prov[idx] == a.id;
      assert a.id in prov;
    }
  }
}
