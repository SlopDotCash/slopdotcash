// @source src/VettingEvidence.tsx
// @evidence tests/e2e/admin-evidence-layout.spec.ts
// Refines the last action after ui_vetting_reader has matched the current
// actor and (for buffered mode) verified the full immutable byte length/hash.
// Two attempts/object URLs, one component departure and one timer per blob.
// Modes buffered/native have different evidence: native never allocates a
// blob URL; neither anchor.click nor URL creation proves download completion.
// Creation, click, timer registration and status publication share one JS
// task. Departure can occur between tasks, not between these synchronous
// operations. A thrown creation/click enters the reader's separate async
// failure gate; this model stops at that gate. In particular a click exception
// after blob creation precedes timer registration and leaves that URL live;
// no unconditional-cleanup guarantee is claimed for that exceptional path.
// Native DOM operation exceptions are bounded input classes, not reproduced
// browser defects. Timer execution is independent of component ownership.
// Native timer/revocation delivery, Blob byte identity and browser saving are
// external assumptions. No execution or new private authority is claimed.
module ui_evidence_blob_download {
  val ids=Set(1,2)
  type Attempt={phase:str,mode:str,clicked:bool,scheduled:bool,requested:bool}
  type S={present:bool,current:int,attempts:int->Attempt,live:Set[int],revoked:Set[int]}
  val empty:Attempt={phase:"unused",mode:"buffered",clicked:false,scheduled:false,requested:false}
  var s:S
  action init=s'={present:true,current:0,attempts:ids.mapBy(_=>empty),live:Set(),revoked:Set()}
  val synchronous=s.current!=0 and Set("create","click","schedule","status").contains(s.attempts.get(s.current).phase)
  action begin(id:int,mode:str):bool=all{s.present,s.current==0 or s.attempts.get(s.current).phase=="done",
    s.attempts.get(id).phase=="unused",Set("buffered","native").contains(mode),
    s'=s.with("current",id).with("attempts",s.attempts.put(id,empty.with("mode",mode).with("phase",if(mode=="buffered")"create" else "click")))}
  action create(id:int,ok:bool):bool={val a=s.attempts.get(id)
    all{s.current==id,a.phase=="create",
      s'=s.with("live",if(ok)s.live.union(Set(id)) else s.live)
        .with("attempts",s.attempts.put(id,a.with("phase",if(ok)"click" else "failure-check")))}}
  action click(id:int,ok:bool):bool={val a=s.attempts.get(id)
    all{s.current==id,a.phase=="click",
      s'=s.with("attempts",s.attempts.put(id,a.with("clicked",ok)
        .with("phase",if(not(ok))"failure-check" else if(a.mode=="buffered")"schedule" else "status")))}}
  action schedule(id:int):bool={val a=s.attempts.get(id)
    all{s.current==id,a.phase=="schedule",s.live.contains(id),
      s'=s.with("attempts",s.attempts.put(id,a.with("phase","status").with("scheduled",true)))}}
  action publish(id:int):bool={val a=s.attempts.get(id)
    all{s.current==id,a.phase=="status",s'=s.with("attempts",s.attempts.put(id,a.with("phase","done").with("requested",true)))} }
  // ui_vetting_reader owns the asynchronous failure/session check. Only its
  // completed action lets the mounted component start another attempt.
  action failureSettled(id:int):bool=all{s.current==id,s.attempts.get(id).phase=="failure-check",
    s'=s.with("attempts",s.attempts.put(id,s.attempts.get(id).with("phase","done")))}
  action depart=all{s.present,not(synchronous),s'=s.with("present",false)}
  action revoke(id:int):bool={val a=s.attempts.get(id)
    all{a.scheduled,s.live.contains(id),not(synchronous),
      s'=s.with("live",s.live.exclude(Set(id))).with("revoked",s.revoked.union(Set(id)))}}
  action step={nondet id=ids.oneOf() nondet mode=Set("buffered","native").oneOf() nondet ok=Set(false,true).oneOf()
    any{begin(id,mode),create(id,ok),click(id,ok),schedule(id),publish(id),failureSettled(id),depart,revoke(id),s'=s}}
  val invariant=all{s.live.intersect(s.revoked)==Set(),s.revoked.forall(id=>s.attempts.get(id).scheduled),
    ids.forall(id=>{val a=s.attempts.get(id)
      all{a.scheduled implies a.mode=="buffered" and a.clicked,
        a.requested implies a.clicked and (a.mode=="native" or a.scheduled),
        a.mode=="native" implies not(s.live.contains(id)) and not(s.revoked.contains(id))}})}
  action buffered(id:int):bool=begin(id,"buffered").then(create(id,true)).then(click(id,true)).then(schedule(id)).then(publish(id))
  run allocationAloneIsNotDownloadTest=init.then(begin(1,"buffered")).then(create(1,true))
    .expect(s.live==Set(1) and not(s.attempts.get(1).clicked) and not(s.attempts.get(1).requested) and invariant)
  run bufferedClickSchedulesItsOwnUrlTest=init.then(buffered(1)).expect(s.live==Set(1) and s.attempts.get(1).scheduled and invariant)
  run normalTimerRevokesUrlTest=init.then(buffered(1)).then(revoke(1)).expect(s.live==Set() and s.revoked==Set(1) and invariant)
  run departureDoesNotCancelRegisteredRevocationTest=init.then(buffered(1)).then(depart).then(revoke(1))
    .expect(not(s.present) and s.live==Set() and s.revoked==Set(1) and invariant)
  run oldTimerCannotRevokeNextUrlTest=init.then(buffered(1)).then(buffered(2)).then(revoke(1))
    .expect(s.live==Set(2) and s.revoked==Set(1) and invariant)
  run independentTimersCanFinishOutOfOrderTest=init.then(buffered(1)).then(buffered(2)).then(revoke(2)).then(revoke(1))
    .expect(s.live==Set() and s.revoked==Set(1,2) and invariant)
  run nativeClickAllocatesNoBlobTest=init.then(begin(1,"native")).then(click(1,true)).then(publish(1)).then(depart)
    .expect(s.live==Set() and s.attempts.get(1).requested and not(s.attempts.get(1).scheduled) and invariant)
  run creationFailureAllocatesNoUrlTest=init.then(begin(1,"buffered")).then(create(1,false)).then(depart)
    .expect(s.live==Set() and s.attempts.get(1).phase=="failure-check" and invariant)
  run clickExceptionPrecedesCleanupTimerTest=init.then(begin(1,"buffered")).then(create(1,true)).then(click(1,false)).then(depart)
    .expect(s.live==Set(1) and not(s.attempts.get(1).scheduled) and not(s.attempts.get(1).requested) and invariant)
  run nativeClickExceptionHasNoUrlToCleanTest=init.then(begin(1,"native")).then(click(1,false))
    .expect(s.live==Set() and s.attempts.get(1).phase=="failure-check" and invariant)
  run departedReaderCannotStartAnotherDownloadTest=init.then(depart).then(begin(1,"buffered").fail())
}
