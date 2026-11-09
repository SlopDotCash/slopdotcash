// @source scripts/prepare-points-import.ts
// @source scripts/prepare-payments-import.ts
// @source scripts/check-direct-payment-disclosures.ts
// @source scripts/backfill-points.ts
// @source src/lib/payments/escrow-cycle.ts
// Complete validated input precedes publication; disclosure is not a verified payment.
module source_import {
  type S={parts:Set[int],valid:bool,complete:bool,published:bool,disclosed:bool,verifiedPaid:bool,identity:int}
  var s:S
  action init=s'={parts:Set(),valid:false,complete:false,published:false,disclosed:false,verifiedPaid:false,identity:1}
  action part(id:int):bool=all{not(s.published),s'=s.with("parts",s.parts.union(Set(id)))}
  action validate=all{s.parts==Set(1,2),s'=s.with("valid",true).with("complete",true)}
  action publish=all{s.valid,s.complete,s'=s.with("published",true)}
  action disclose=all{s.published,s'=s.with("disclosed",true)}
  action appendSameIdentity(id:int):bool=all{id==s.identity,s'=s}
  action step=any{part(1),part(2),validate,publish,disclose,appendSameIdentity(1),s'=s}
  val invariant=all{s.published implies(s.valid and s.complete),not(s.verifiedPaid),s.identity==1}
  run partialRefusedTest=init.then(part(1)).then(publish.fail())
  run disclosedNotVerifiedTest=init.then(part(1)).then(part(2)).then(validate).then(publish).then(disclose).expect(s.disclosed and not(s.verifiedPaid) and invariant)
  run conflictingImportTest=init.then(appendSameIdentity(2).fail())
}
