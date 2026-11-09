// @source scripts/validate-evaluator-awards.ts
// @source src/lib/evaluator-awards.ts
// Reviewed bounded award manifests must have unique IDs, canonical work,
// actor/PR review pair, and external-content identity. Scores are not payments.
module evaluated_award_import {
  type S={ids:Set[int],works:Set[int],content:Set[int],points:int,paid:bool}
  var s:S
  action init=s'={ids:Set(),works:Set(),content:Set(),points:0,paid:false}
  action admit(id:int,work:int,content:int,points:int,reviewed:bool):bool=all{reviewed,points>=1,points<=8,not(s.ids.contains(id)),not(s.works.contains(work)),not(s.content.contains(content)),s.ids.size()<2,
    s'=s.with("ids",s.ids.union(Set(id))).with("works",s.works.union(Set(work))).with("content",s.content.union(Set(content))).with("points",s.points+points)}
  action step=any{admit(1,1,1,1,true),admit(2,2,2,8,true),admit(2,1,2,1,true),admit(2,2,1,1,true),s'=s}
  val invariant=all{s.ids.size()==s.works.size(),s.ids.size()==s.content.size(),s.points<=16,not(s.paid)}
  run reviewedScoresNotPaymentTest=init.then(admit(1,1,1,8,true)).expect(invariant)
  run contentDuplicateRefusedTest=init.then(admit(1,1,1,1,true)).then(admit(2,2,1,1,true).fail())
  run noUnreviewedAwardTest=init.then(admit(1,1,1,1,false).fail())
}
