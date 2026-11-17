# Buyback finalized RPC observation

PRD sections 6 and 11 require read-only Robinhood Chain RPC qualification as
one part of buyback readiness. On 15 November 2026 UTC the readiness check
verified the deployed configuration, finalized-state reads through the
Worker's Robinhood Chain endpoint and fee-wallet balances covering one cycle
of the configured native ceilings; these are recorded evidence observations.
Operational qualification stays pending until finalized production receipts
exist for the first real order's fill, purchase and burn. Main revision
`ee1a4b2cd2672245537928380e425f5bd9ecb994` promotes the probe from development.
The pinned ownership is `workers/fee-converter/evm.ts:1887–1933`,
`workers/fee-converter/buyback.ts:902–930`,
`workers/fee-converter/core.ts:736–764,852–855` and
`workers/fee-converter/README.md:823–835`.
`formal/models/fees/buyback_market.qnt` leaves diagnostic reads separate
from its balances, journal, signing authority and transactions.

## Story: Observe whether the configured Robinhood RPC can serve finalized state

### Only a live Robinhood buyback recovery tick can report the diagnostic

A completed live Robinhood recovery tick may attach the diagnostic to its
private summary after reading arrival, purchase, burn and in-transit results.
Receipt-only processing, off mode, dry runs, other networks and an unavailable
probe adapter omit this field. Attaching even an unavailable observation
retains the summary's existing recovery counts and errors.

```quint
type BuybackRpcScope = { robinhood: bool, live: bool, recovery: bool, probeAvailable: bool }
pure def runProbe(scope: BuybackRpcScope): bool = scope.robinhood and scope.live and scope.recovery and scope.probeAvailable
pure def lawInactiveProbeOmitted(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence): bool =
  val result = finalizedRpc(scope, rpc)
  not(runProbe(scope)) implies match result { | Omitted => true | _ => false }

type RecoveryCounts = { bridgeRecords: int, purchaseRecords: int, burnRecords: int, arrivals: int, refunds: int, inTransit: int, errors: int }
type DiagnosticSummary = { counts: RecoveryCounts, observation: RpcObservation }
pure def recoverySummary(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence, counts: RecoveryCounts): DiagnosticSummary =
  { counts: counts, observation: finalizedRpc(scope, rpc) }
pure def lawObservationPreservesCounts(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence, counts: RecoveryCounts): bool =
  recoverySummary(scope, rpc, counts).counts == counts
```

### A verified observation binds the exact chain, block and contract read

Require chain ID 4663. The finalized block response supplies an exact nonnegative
height and canonical lowercase 32-byte hex hash. The diagnostic adapter uses
the configured DLN Destination and reads `takeOrders` for the zero order ID
at that exact height. It rereads the canonical block by the same height and
compares the number and hash. The provider call uses the configured endpoint,
a five-second timeout, no redirects, retries or off-chain reads. The zero
order status belongs only to this diagnostic and is never claim or arrival
evidence.

The adapter decodes the exact height from a canonical decimal string and
validates the hash bytes, binding its decoding verdict to those values. The
model retains the height as a string, preserving arbitrarily large heights.
A failed request, invalid block, incorrect read target, wrong chain, moved
block or ambiguous observation yields a generic unavailable state. The only
verified output consists of the chain ID, decimal height and hash. Provider
errors, endpoint configuration and request material stay out of the summary.

```quint
type FinalizedBlock = { height: str, hash: str, exactHeight: bool, canonicalHash: bool }
type DestinationRead = { completed: bool, height: str, exactDestination: bool, zeroOrder: bool }
type FinalizedRpcEvidence = { observedChainId: int, finalized: bool, block: FinalizedBlock,
  contractRead: DestinationRead, canonical: FinalizedBlock }
type RpcObservation = Omitted | Unavailable | Verified({ chainId: int, height: str, hash: str })
pure val robinhoodChainId = 4663
pure def exactFinalizedRead(rpc: FinalizedRpcEvidence): bool =
  rpc.observedChainId == robinhoodChainId and rpc.finalized and
    rpc.block.exactHeight and rpc.block.canonicalHash and rpc.block.height != "" and rpc.block.hash != "" and
    rpc.contractRead.completed and rpc.contractRead.exactDestination and rpc.contractRead.zeroOrder and
    rpc.contractRead.height == rpc.block.height and rpc.canonical.exactHeight and rpc.canonical.canonicalHash and
    rpc.canonical.height == rpc.block.height and rpc.canonical.hash == rpc.block.hash
pure def finalizedRpc(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence): RpcObservation =
  if (not(runProbe(scope))) Omitted
  else if (exactFinalizedRead(rpc)) Verified({ chainId: robinhoodChainId, height: rpc.block.height, hash: rpc.block.hash })
  else Unavailable
pure def lawActiveProbeRefusal(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence): bool =
  val result = finalizedRpc(scope, rpc)
  (runProbe(scope) and not(exactFinalizedRead(rpc))) implies match result { | Unavailable => true | _ => false }
pure def lawVerifiedFactsExact(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence): bool =
  val result = finalizedRpc(scope, rpc)
  match result {
    | Verified(observation) => runProbe(scope) and exactFinalizedRead(rpc) and
        observation.chainId == robinhoodChainId and observation.height == rpc.block.height and observation.hash == rpc.block.hash
    | _ => true
  }
pure val liveRobinhood: BuybackRpcScope = { robinhood: true, live: true, recovery: true, probeAvailable: true }
pure val observedBlock: FinalizedBlock = { height: "9007199254740993", hash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", exactHeight: true, canonicalHash: true }
pure val observedRpc: FinalizedRpcEvidence = { observedChainId: robinhoodChainId, finalized: true, block: observedBlock,
  contractRead: { completed: true, height: observedBlock.height, exactDestination: true, zeroOrder: true }, canonical: observedBlock }
pure val scopeValues = Set(liveRobinhood, { ...liveRobinhood, live: false }, { ...liveRobinhood, robinhood: false },
  { ...liveRobinhood, recovery: false }, { ...liveRobinhood, probeAvailable: false })
pure val countsValues = Set({ bridgeRecords: 0, purchaseRecords: 1, burnRecords: 2, arrivals: 1, refunds: 0, inTransit: 1, errors: 3 })
pure val rpcValues = Set(observedRpc, { ...observedRpc, observedChainId: 1 }, { ...observedRpc, finalized: false },
  { ...observedRpc, block: { ...observedBlock, exactHeight: false } },
  { ...observedRpc, block: { ...observedBlock, canonicalHash: false } },
  { ...observedRpc, contractRead: { ...observedRpc.contractRead, completed: false } },
  { ...observedRpc, contractRead: { ...observedRpc.contractRead, exactDestination: false } },
  { ...observedRpc, contractRead: { ...observedRpc.contractRead, zeroOrder: false } },
  { ...observedRpc, contractRead: { ...observedRpc.contractRead, height: "9007199254740994" } },
  { ...observedRpc, canonical: { ...observedBlock, height: "9007199254740994" } },
  { ...observedRpc, canonical: { ...observedBlock, hash: "changed" } })
```


### Operator qualification checks the expected Worker and an independent finalized block

On the expected deployed Worker revision, the private summary must identify
an exact verified live Robinhood recovery probe. Confirm the same height and
hash through a separate trusted Robinhood Chain endpoint. The reported block
must be at or below that endpoint's finalized head. The adapter decodes each canonical decimal height into its exact base-1000
limbs. The model compares those limbs without rounding either height to a
JavaScript number. Missing, stale, untrusted, wrong-chain or
contradictory evidence leaves RPC qualification unproven. RPC qualification
is one input to readiness and conveys no permission to change a balance,
sign or publish a burn.

```quint
import money as M from "../settlement/money"
type HeightWitness = { decimal: str, limbs: M::Amount, exactDecode: bool }
type IndependentRead = { expectedWorkerRevision: str, summaryWorkerRevision: str,
  separateTrustedEndpoint: bool, chainId: int, matchingBlock: FinalizedBlock, finalizedHead: FinalizedBlock,
  matchingHeight: HeightWitness, headHeight: HeightWitness }
pure def bindsHeight(witness: HeightWitness, block: FinalizedBlock): bool =
  witness.exactDecode and witness.decimal == block.height and M::validAmount(witness.limbs)
pure def coveredByFinality(independent: IndependentRead): bool =
  bindsHeight(independent.matchingHeight, independent.matchingBlock) and bindsHeight(independent.headHeight, independent.finalizedHead)
    and M::compareAmounts(independent.matchingHeight.limbs, independent.headHeight.limbs) <= 0
pure def qualifiedBlock(independent: IndependentRead, chainId: int, height: str, hash: str): bool =
  independent.expectedWorkerRevision != "" and independent.expectedWorkerRevision == independent.summaryWorkerRevision
    and independent.separateTrustedEndpoint and independent.chainId == robinhoodChainId and chainId == robinhoodChainId
    and independent.matchingBlock.exactHeight and independent.matchingBlock.canonicalHash
    and independent.matchingBlock.height == height and independent.matchingBlock.hash == hash
    and height != "" and hash != "" and independent.finalizedHead.exactHeight and independent.finalizedHead.canonicalHash
    and independent.finalizedHead.height != "" and independent.finalizedHead.hash != ""
    and coveredByFinality(independent)
    and (not(M::equalAmounts(independent.matchingHeight.limbs, independent.headHeight.limbs))
      or (independent.finalizedHead.height == height and independent.finalizedHead.hash == hash))
pure def rpcQualified(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence, independent: IndependentRead): bool =
  val observation = finalizedRpc(scope, rpc)
  match observation {
    | Verified(block) => qualifiedBlock(independent, block.chainId, block.height, block.hash)
    | _ => false
  }
pure def lawQualificationBindsIndependentEvidence(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence, independent: IndependentRead): bool =
  rpcQualified(scope, rpc, independent) implies runProbe(scope) and exactFinalizedRead(rpc)
    and qualifiedBlock(independent, rpc.observedChainId, rpc.block.height, rpc.block.hash)
pure def lawUncorroboratedProbeCannotQualify(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence, independent: IndependentRead): bool =
  (not(runProbe(scope)) or not(exactFinalizedRead(rpc)) or not(independent.separateTrustedEndpoint)
    or not(coveredByFinality(independent)) or independent.expectedWorkerRevision != independent.summaryWorkerRevision)
  implies not(rpcQualified(scope, rpc, independent))
pure val independentMatch: IndependentRead = { expectedWorkerRevision: "reviewed-version", summaryWorkerRevision: "reviewed-version",
  separateTrustedEndpoint: true, chainId: robinhoodChainId, matchingBlock: observedBlock, finalizedHead: observedBlock,
  matchingHeight: { decimal: observedBlock.height, limbs: List(993, 740, 254, 199, 7, 9), exactDecode: true },
  headHeight: { decimal: observedBlock.height, limbs: List(993, 740, 254, 199, 7, 9), exactDecode: true } }
pure val independentValues = Set(independentMatch, { ...independentMatch, summaryWorkerRevision: "earlier-version" },
  { ...independentMatch, separateTrustedEndpoint: false }, { ...independentMatch, chainId: 1 },
  { ...independentMatch, matchingBlock: { ...observedBlock, hash: "wrong" } },
  { ...independentMatch, finalizedHead: { ...observedBlock, hash: "wrong" } },
  { ...independentMatch, headHeight: { ...independentMatch.headHeight, exactDecode: false } },
  { ...independentMatch, finalizedHead: { ...observedBlock, height: "9007199254740992" },
    headHeight: { decimal: "9007199254740992", limbs: List(992, 740, 254, 199, 7, 9), exactDecode: true } })
```

## Story: Qualify the production buyback from finalized receipts

### Readiness observations are recorded; qualification waits for the first fill, purchase and burn receipts

The three observations of 15 November 2026 UTC (epoch millisecond
`1794700800000`) start satisfied. Only the fee Worker records a receipt,
each from finalized successful chain evidence, in the order fill, purchase,
burn, once. Missing fee income leaves qualification pending; nothing here
creates a fee record or spends unrelated wallet funds. A burn is published
only after its finalized burn receipt, and only once.

```quint
type FinalizedReceipt = { tx: int, height: int, finalized: bool, succeeded: bool }
type Readiness = { configurationVerified: bool, finalizedReadVerified: bool, gasCoverageVerified: bool, observedAt: int,
  fill: int, purchase: int, burn: int, burnPublished: bool }
pure val readinessObservedAt = 1794700800000
pure val initial: Readiness = { configurationVerified: true, finalizedReadVerified: true, gasCoverageVerified: true,
  observedAt: readinessObservedAt, fill: 0, purchase: 0, burn: 0, burnPublished: false }
pure def exactReceipt(r: Readiness, receipt: FinalizedReceipt): bool = receipt.tx > 0 and receipt.height > 0
  and receipt.finalized and receipt.succeeded and receipt.tx != r.fill and receipt.tx != r.purchase and receipt.tx != r.burn
pure def canRecordFill(r: Readiness, receipt: FinalizedReceipt, by: str): bool = by == "worker" and r.fill == 0 and exactReceipt(r, receipt)
pure def recordFill(r: Readiness, receipt: FinalizedReceipt, by: str): Readiness = { ...r, fill: receipt.tx }
pure def canRecordPurchase(r: Readiness, receipt: FinalizedReceipt, by: str): bool =
  by == "worker" and r.fill > 0 and r.purchase == 0 and exactReceipt(r, receipt)
pure def recordPurchase(r: Readiness, receipt: FinalizedReceipt, by: str): Readiness = { ...r, purchase: receipt.tx }
pure def canRecordBurn(r: Readiness, receipt: FinalizedReceipt, by: str): bool =
  by == "worker" and r.purchase > 0 and r.burn == 0 and exactReceipt(r, receipt)
pure def recordBurn(r: Readiness, receipt: FinalizedReceipt, by: str): Readiness = { ...r, burn: receipt.tx }
pure def canPublishBurn(r: Readiness, by: str): bool = by == "worker" and r.burn > 0 and not(r.burnPublished)
pure def publishBurn(r: Readiness, by: str): Readiness = { ...r, burnPublished: true }
pure def operationallyQualified(r: Readiness): bool = r.configurationVerified and r.finalizedReadVerified and r.gasCoverageVerified
  and r.fill > 0 and r.purchase > 0 and r.burn > 0
pure def alwaysObservationsRetained(r: Readiness): bool = r.configurationVerified and r.finalizedReadVerified
  and r.gasCoverageVerified and r.observedAt == readinessObservedAt
pure def alwaysReceiptsInOrder(r: Readiness): bool = (r.purchase > 0 implies r.fill > 0) and (r.burn > 0 implies r.purchase > 0)
  and r.fill >= 0 and r.purchase >= 0 and r.burn >= 0
pure def alwaysBurnPublishedOnlyWithFinalizedReceipt(r: Readiness): bool = r.burnPublished implies r.burn > 0
pure def stepReceiptsPermanent(before: Readiness, after: Readiness): bool = (before.fill > 0 implies after.fill == before.fill)
  and (before.purchase > 0 implies after.purchase == before.purchase) and (before.burn > 0 implies after.burn == before.burn)
  and (before.burnPublished implies after.burnPublished)
pure def sometimesQualificationPending(r: Readiness): bool = r.fill > 0 and not(operationallyQualified(r))
pure def sometimesQualifiedAndPublished(r: Readiness): bool = operationallyQualified(r) and r.burnPublished
pure val receiptValues = Set({ tx: 1, height: 5, finalized: true, succeeded: true }, { tx: 2, height: 6, finalized: true, succeeded: true },
  { tx: 3, height: 7, finalized: true, succeeded: true }, { tx: 4, height: 7, finalized: false, succeeded: true },
  { tx: 5, height: 7, finalized: true, succeeded: false })
pure val byValues = Set("worker", "other")
```
