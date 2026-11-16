module allocation_complete_witness {
  import settlement__money as M from "../../../../gen/settlement__money"
  import settlement__allocation as A from "../../../../gen/settlement__allocation"

  var clock: int
  action init = clock' = 0

  run uint256AllocationKeepsTheLastUnitTest = init.expect({
    val total = List(935, 639, 129, 913, 7, 584, 457, 39, 564, 640, 665, 984, 269, 853, 907, 687, 8, 985, 570, 423, 195, 316, 237, 89, 792, 115, 0)
    val lower = List(967, 819, 564, 956, 3, 792, 728, 19, 282, 820, 332, 992, 634, 926, 953, 343, 504, 492, 785, 711, 97, 658, 618, 44, 896, 57)
    val higher = List(968, 819, 564, 956, 3, 792, 728, 19, 282, 820, 332, 992, 634, 926, 953, 343, 504, 492, 785, 711, 97, 658, 618, 44, 896, 57)
    val weights = List({ actor: 12, weight: List(1, 0) }, { actor: 4, weight: List(1) }, { actor: 1, weight: List(0) })
    val shares = A::allocateAmounts(total, weights)
    and {
      A::canCommitAllocation(total, weights),
      A::lawAllocatedSharesValid(total, weights),
      shares.length() == 3,
      shares[0].actor == 12 and M::equalAmounts(shares[0].amount, lower),
      shares[1].actor == 4 and M::equalAmounts(shares[1].amount, higher),
      shares[2].actor == 1 and M::equalAmounts(shares[2].amount, M::zero)
    }
  })

  run unequalRemaindersOverrideActorOrderTest = init.expect({
    val total = List(3, 0)
    val weights = List({ actor: 1, weight: List(1) }, { actor: 2, weight: List(2, 0) }, { actor: 3, weight: List(4) })
    val shares = A::allocateAmounts(total, weights)
    and {
      A::canCommitAllocation(total, weights),
      M::equalAmounts(shares[0].amount, M::zero),
      M::equalAmounts(shares[1].amount, List(1)),
      M::equalAmounts(shares[2].amount, List(2)),
      not(A::canAllocate(total, weights.append({ actor: 3, weight: List(1) })))
    }
  })

  run onlyZeroPoolPermitsEmptyRecipientsTest = init.expect(and {
    A::canCommitAllocation(List(0, 0), List()),
    A::allocateAmounts(List(0, 0), List()) == List(),
    not(A::canAllocate(List(1), List())),
    not(A::canAllocate(List(1), List({ actor: 1, weight: List(0) })))
  })
}
