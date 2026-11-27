lemma ReceiptPolicyJoinsFilter(shape: ReceiptShape, policy: ReceiptPolicy)
  ensures receiptPolicyJoins(shape, policy) == (
    var local_0 := ProofLib.Filter((x: PolicyPin) => (x.pinRevision == shape.ackRevision), policy.pins);
    var local_1 := (if ((0 <= 0) && (0 < |local_0|)) then local_0[0] else noPin);
    if shape.version.ReceiptV1? then
      !((policy.policyActive && (shape.completedAt >= policy.activatedAt)))
    else
      if !(policy.policyActive) then
        ((shape.acknowledged && (shape.ackRevision == policy.currentRevision)) && (shape.ackDigests == policy.currentDigests))
      else
        ((((shape.acknowledged && (shape.startedAt >= policy.activatedAt)) && (|local_0| > 0)) && (shape.startedAt >= local_1.pinActivatedAt)) && (shape.ackDigests == local_1.pinDigests))
  )
{
}

lemma lawV2NeedsItsPinnedPolicy_ensures(shape: ReceiptShape, policy: ReceiptPolicy)
  ensures (lawV2NeedsItsPinnedPolicy(shape, policy) == true)
{
  if shape.version.ReceiptV2? && policy.policyActive && receiptPolicyJoins(shape, policy) {
    ReceiptPolicyJoinsFilter(shape, policy);
    var p := (x: PolicyPin) => (x.pinRevision == shape.ackRevision);
    var filtered := ProofLib.Filter(p, policy.pins);
    assert |filtered| > 0;
    ProofLib.FilterMember(p, policy.pins, filtered[0]);
    assert filtered[0] in policy.pins && filtered[0].pinRevision == shape.ackRevision;
  }
}
