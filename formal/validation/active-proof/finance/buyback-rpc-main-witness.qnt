module buyback_rpc_main_witness {
  import fees__buybackRpc as R from "../../../../gen/fees__buybackRpc"

  var clock: int
  action init = clock' = 0

  run reportsExactBlockFromLiveRecoveryOnlyTest = init.expect({
    val before = R::liveRobinhood
    val expected = R::Verified({ chainId: 4663, height: R::observedBlock.height, hash: R::observedBlock.hash })
    and {
      R::finalizedRpc(before, R::observedRpc) == expected,
      R::finalizedRpc({ ...before, recovery: false }, R::observedRpc) == R::Omitted,
      R::finalizedRpc({ ...before, live: false }, R::observedRpc) == R::Omitted,
      R::finalizedRpc({ ...before, robinhood: false }, R::observedRpc) == R::Omitted,
      R::finalizedRpc({ ...before, probeAvailable: false }, R::observedRpc) == R::Omitted
    }
  })

  run wrongChainMovedBlockOrUnavailableReadKeepsExistingSummaryTest = init.expect({
    val before = { bridgeRecords: 0, purchaseRecords: 2, burnRecords: 1, arrivals: 1, refunds: 2, inTransit: 4, errors: 3 }
    val unavailable = R::recoverySummary(R::liveRobinhood, { ...R::observedRpc, contractRead: { ...R::observedRpc.contractRead, completed: false } }, before)
    val moved = R::recoverySummary(R::liveRobinhood, { ...R::observedRpc, canonical: { ...R::observedBlock, hash: "changed" } }, before)
    val wrong = R::recoverySummary(R::liveRobinhood, { ...R::observedRpc, observedChainId: 1 }, before)
    val omitted = R::recoverySummary({ ...R::liveRobinhood, recovery: false }, R::observedRpc, before)
    and {
      unavailable.counts == before, moved.counts == before, wrong.counts == before, omitted.counts == before,
      unavailable.observation == R::Unavailable, moved.observation == R::Unavailable,
      wrong.observation == R::Unavailable, omitted.observation == R::Omitted
    }
  })

  run expectedWorkerAndIndependentEndpointAreRequiredTest = init.expect({
    val scope = R::liveRobinhood
    val rpc = R::observedRpc
    val confirmed = R::independentMatch
    and {
      R::rpcQualified(scope, rpc, confirmed),
      not(R::rpcQualified({ ...scope, recovery: false }, rpc, confirmed)),
      not(R::rpcQualified(scope, rpc, { ...confirmed, summaryWorkerRevision: "previous-version" })),
      not(R::rpcQualified(scope, rpc, { ...confirmed, expectedWorkerRevision: "", summaryWorkerRevision: "" })),
      not(R::rpcQualified(scope, rpc, { ...confirmed, separateTrustedEndpoint: false })),
      not(R::rpcQualified(scope, rpc, { ...confirmed, chainId: 1 })),
      not(R::rpcQualified(scope, rpc, { ...confirmed, matchingBlock: { ...confirmed.matchingBlock, hash: "wrong" } })),
      not(R::rpcQualified(scope, rpc, { ...confirmed, finalizedHead: { ...confirmed.finalizedHead, hash: "wrong" } }))
    }
  })

  run neighboringHeightsAboveSafeIntegerNeverRoundTogetherTest = init.expect({
    val confirmed = R::independentMatch
    val earlier = { ...confirmed, finalizedHead: { ...R::observedBlock, height: "9007199254740992" },
      headHeight: { ...confirmed.headHeight, decimal: "9007199254740992", limbs: List(992, 740, 254, 199, 7, 9) } }
    val later = { ...confirmed, finalizedHead: { ...R::observedBlock, height: "9007199254740994",
        hash: "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0" },
      headHeight: { ...confirmed.headHeight, decimal: "9007199254740994", limbs: List(994, 740, 254, 199, 7, 9) } }
    val padded = { ...confirmed, matchingHeight: { ...confirmed.matchingHeight, limbs: List(993, 740, 254, 199, 7, 9, 0) } }
    and {
      not(R::rpcQualified(R::liveRobinhood, R::observedRpc, earlier)),
      R::rpcQualified(R::liveRobinhood, R::observedRpc, later),
      R::rpcQualified(R::liveRobinhood, R::observedRpc, padded),
      not(R::rpcQualified(R::liveRobinhood, R::observedRpc, { ...confirmed,
        headHeight: { ...confirmed.headHeight, decimal: "9007199254740994" } })),
      not(R::rpcQualified(R::liveRobinhood, R::observedRpc, { ...confirmed,
        headHeight: { ...confirmed.headHeight, exactDecode: false } }))
    }
  })
}
