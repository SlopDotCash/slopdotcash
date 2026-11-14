# Buyback finalized RPC observation

PRD sections 6 and 11 require read-only Robinhood Chain RPC qualification as
one part of buyback readiness. Development source `0d0f0817a` supplies the
probe in `workers/fee-converter/evm.ts` and attaches its result to the private
recovery summary in `workers/fee-converter/buyback.ts`.

## Story: Observe whether the configured Robinhood RPC can serve finalized state

### Only a live Robinhood buyback recovery tick can report the diagnostic

Read-only probe availability is part of the configured market adapter. A dry
run, another network or a recovery tick without an observation adapter omits
the diagnostic. Neither the result nor a failed probe affects the recovery
journal, receipt amounts, signing authority or posted burn status. Readiness
requires the operator's independent recheck and the other PRD evidence.

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
type BuybackRpcScope = { robinhood: bool, live: bool, probeAvailable: bool }
type FinalizedBlock = { height: str, hash: str, exactHeight: bool, canonicalHash: bool }
type DestinationRead = { completed: bool, height: str, exactDestination: bool, zeroOrder: bool }
type FinalizedRpcEvidence = { observedChainId: int, finalized: bool, block: FinalizedBlock,
  contractRead: DestinationRead, canonical: FinalizedBlock }
type RpcObservation = Omitted | Unavailable | Verified({ chainId: int, height: str, hash: str })
pure val robinhoodChainId = 4663
pure def runProbe(scope: BuybackRpcScope): bool = scope.robinhood and scope.live and scope.probeAvailable
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
pure def lawInactiveProbeOmitted(scope: BuybackRpcScope, rpc: FinalizedRpcEvidence): bool =
  val result = finalizedRpc(scope, rpc)
  not(runProbe(scope)) implies match result { | Omitted => true | _ => false }
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
pure val liveRobinhood: BuybackRpcScope = { robinhood: true, live: true, probeAvailable: true }
pure val observedBlock: FinalizedBlock = { height: "9007199254740993", hash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", exactHeight: true, canonicalHash: true }
pure val observedRpc: FinalizedRpcEvidence = { observedChainId: robinhoodChainId, finalized: true, block: observedBlock,
  contractRead: { completed: true, height: observedBlock.height, exactDestination: true, zeroOrder: true }, canonical: observedBlock }
pure val scopeValues = Set(liveRobinhood, { ...liveRobinhood, live: false }, { ...liveRobinhood, robinhood: false }, { ...liveRobinhood, probeAvailable: false })
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
