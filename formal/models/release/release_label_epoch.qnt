// @source .github/workflows/release-label.yml
// Metadata invalidation only: current committed-template installation does not
// consult this label. A legacy candidate grant belongs to its exact head epoch;
// a delayed synchronize job may remove even a newer label but cannot approve it.
module release_label_epoch {
  type S = { head: int, label: bool, labelHead: int, pendingInvalidation: bool, codeExecuted: bool }
  var s: S
  action init = s' = { head:1,label:false,labelHead:0,pendingInvalidation:false,codeExecuted:false }
  action applyLabel = s'=s.with("label",true).with("labelHead",s.head)
  action synchronize = all { s.head==1,s'=s.with("head",2).with("pendingInvalidation",true) }
  action invalidate = all { s.pendingInvalidation,s'=s.with("label",false).with("pendingInvalidation",false) }
  val currentApproval = s.label and s.labelHead==s.head
  action step = any { applyLabel,synchronize,invalidate,s'=s }
  val invariant = all { not(s.codeExecuted),currentApproval implies s.labelHead==s.head }
  run oldLabelNotNewHeadApprovalTest = init.then(applyLabel).then(synchronize).expect(s.label and not(currentApproval))
  run delayedInvalidationStillRefusesTest = init.then(applyLabel).then(synchronize).then(applyLabel).then(invalidate).expect(not(currentApproval) and invariant)
  run reapprovalAfterInvalidationTest = init.then(applyLabel).then(synchronize).then(invalidate).then(applyLabel).expect(currentApproval and invariant)
}
