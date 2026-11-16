# Operator keeper RPC selection

Source is `operator_keeper_rpc.qnt` and `workers/operator-keeper/index.ts` at
Slop main `8d14a9692b998ee3f4479725b6323125f11f11be`. The model covers endpoint
selection and observed chain identity before keeper work. The durable journal
and exact payment evidence remain owned by the settlement specifications.

## Story: Rotate an unavailable endpoint and keep the same keeper

### Only an absent override uses the originally configured endpoint

The adapter parses the private configuration and classifies the optional value
as absent, a valid HTTPS URL, empty, malformed or insecure. The endpoint IDs
represent opaque identities. URL bytes and credentials stay outside the model
and diagnostic output. A present but invalid setting refuses resolution.

```quint
type OverrideKind = AbsentOverride | HttpsOverride | EmptyOverride | MalformedOverride | InsecureOverride
type RpcState = SelectEndpoint | EndpointResolved | InvalidOverride | PreflightUnavailable | WrongChain | ChainReady
type Chain = BaseMainnet | BaseSepolia | EthereumMainnet | EthereumSepolia | RobinhoodMainnet | RobinhoodTestnet | SolanaMainnet | SolanaDevnet | SolanaTestnet
type KeeperIdentity = { network: Chain, signer: int, budget: int, projects: int, registry: int, objectId: int, journal: int }
type KeeperRpc = { identity: KeeperIdentity, originalEndpoint: int, endpoint: int, overrideEndpoint: int,
  overrideKind: OverrideKind, selection: int, observed: Chain, phase: RpcState }
pure val defaultKeeperIdentity: KeeperIdentity = { network: BaseMainnet, signer: 2, budget: 3, projects: 4,
  registry: 5, objectId: 1, journal: 7 }
pure val initial: KeeperRpc = { identity: defaultKeeperIdentity, originalEndpoint: 1, endpoint: 0,
  overrideEndpoint: 0, overrideKind: AbsentOverride, selection: 0, observed: BaseMainnet, phase: SelectEndpoint }
pure def validOverride(kind: OverrideKind, overrideEndpoint: int): bool =
  kind == AbsentOverride or (kind == HttpsOverride and overrideEndpoint > 0)
pure def chosenEndpoint(k: KeeperRpc): int =
  if (k.overrideKind == HttpsOverride) k.overrideEndpoint else k.originalEndpoint
pure def canChooseOverride(k: KeeperRpc, selectionId: int): bool = selectionId > k.selection
pure def chooseOverride(k: KeeperRpc, kind: OverrideKind, overrideEndpoint: int, selectionId: int): KeeperRpc =
  { ...k, overrideKind: kind, overrideEndpoint: overrideEndpoint, selection: selectionId, endpoint: 0, phase: SelectEndpoint }
pure def canResolve(k: KeeperRpc): bool = k.phase == SelectEndpoint
pure def resolve(k: KeeperRpc): KeeperRpc =
  if (validOverride(k.overrideKind, k.overrideEndpoint))
    { ...k, endpoint: chosenEndpoint(k), phase: EndpointResolved }
  else { ...k, endpoint: 0, phase: InvalidOverride }
pure def alwaysOriginValid(k: KeeperRpc): bool = k.originalEndpoint > 0
pure def alwaysResolvedEndpoint(k: KeeperRpc): bool =
  if (k.phase == SelectEndpoint or k.phase == InvalidOverride) k.endpoint == 0
  else validOverride(k.overrideKind, k.overrideEndpoint) and k.endpoint > 0 and k.endpoint == chosenEndpoint(k)
```

### Exact chain preflight on the selected endpoint precedes any keeper work

The adapter checks the actual chain identity for the active configuration on
the selected endpoint, including EVM chain ID or the configured Solana cluster
identity. A provider error or a different chain cannot qualify the endpoint.
Every override selection advances its request identity and discards earlier
readiness. The exact endpoint and selection identity bind the returned
observation. This rejects stale preflight even after reselecting the same URL.
The keeper still needs reviewed deployment, gas, signer and payment authority
checks after preflight.

```quint
pure def canPreflight(k: KeeperRpc, endpointId: int, selectionId: int): bool =
  k.phase == EndpointResolved and k.endpoint > 0 and endpointId == k.endpoint and selectionId == k.selection
pure def preflight(k: KeeperRpc, endpointId: int, selectionId: int, observedChain: Chain, observationAvailable: bool): KeeperRpc =
  { ...k, observed: observedChain, phase: if (not(observationAvailable)) PreflightUnavailable
    else if (observedChain != k.identity.network) WrongChain else ChainReady }
pure def keeperWorkMayProceed(k: KeeperRpc): bool = k.phase == ChainReady
pure def alwaysExactReady(k: KeeperRpc): bool =
  k.phase == ChainReady implies k.observed == k.identity.network
pure def lawWrongChainRefuses(k: KeeperRpc, endpointId: int, selectionId: int, observedChain: Chain): bool =
  canPreflight(k, endpointId, selectionId) and observedChain != k.identity.network
    implies not(keeperWorkMayProceed(preflight(k, endpointId, selectionId, observedChain, true)))
pure def lawUnavailableChainRefuses(k: KeeperRpc, endpointId: int, selectionId: int, observedChain: Chain): bool =
  not(keeperWorkMayProceed(preflight(k, endpointId, selectionId, observedChain, false)))
pure def stepKeeperIdentityImmutable(before: KeeperRpc, after: KeeperRpc): bool =
  before.identity == after.identity and before.originalEndpoint == after.originalEndpoint and
  after.selection >= before.selection
pure def sometimesOriginalReady(k: KeeperRpc): bool = k.phase == ChainReady and k.overrideKind == AbsentOverride
pure def sometimesOverrideReady(k: KeeperRpc): bool = k.phase == ChainReady and k.overrideKind == HttpsOverride
pure def sometimesInvalidOverride(k: KeeperRpc): bool = k.phase == InvalidOverride
pure def sometimesWrongChain(k: KeeperRpc): bool = k.phase == WrongChain
pure def sometimesUnavailable(k: KeeperRpc): bool = k.phase == PreflightUnavailable
pure val kValues = Set(initial, resolve(initial), resolve(chooseOverride(initial, HttpsOverride, 2, 1)))
pure val endpointIdValues = Set(0, 1, 2)
pure val selectionIdValues = Set(0, 1, 2, 3)
pure val observedChainValues = Set(BaseMainnet, BaseSepolia, SolanaMainnet)
pure val overrideEndpointValues = Set(0, 1, 2)
pure val weight_resolve = 5
pure val weight_preflight = 8
```
