# Reward asset verification

PRD sections 2 and 6. The reward asset a project manifest names (its
`network` and `asset` in the [project registry](./projects.md)) is verified
from the chain by the project API, never from the request. This library is
the check the project API applies to a chain reading before the registry
accepts the asset; the registry machine holds the verified network and asset,
and the shell supplies an event only after this check accepted the reading
(shell obligation). Binding the reading to the registry's own transitions is
a pending change of the registry model, not made here.

## Story: Verify a reward asset once from the chain

> As a project owner, I want the reward asset's decimals read from the chain,
> so that no request or default can misstate what a contributor is paid in.

### The reward asset's decimals come from one chain read when it is submitted or changed, never from the request

The project API reads the reward asset once, at creation, at an owner
revision that changes the network or asset and at an administrator manifest
replacement that changes it (`verifiedRewardAsset` over `token-metadata.ts`);
the result is stored in the manifest and page views never read chain. A
pending application's publication reads no chain and carries the reward asset
stored with the application, which `canonicalManifest` has already accepted.
A revision that resubmits the stored network and asset keeps the stored
reading without a new read. Decimals in the request are never used, and no
default (such as six) stands in for a reading. A native coin or the network's
listed stablecoin takes the network definition's fixed decimals, and a
manifest without a reward asset pays the listed stablecoin; any other token
is read from that network's RPC (`REWARD_RPC_BASE`, `REWARD_RPC_ETHEREUM`,
`REWARD_RPC_ROBINHOOD`, `REWARD_RPC_SOLANA`, each defaulting to the public
mainnet endpoint) within 10 seconds and a 64 KiB answer. On an EVM network
the RPC's chain ID must match, the address must hold code, and `decimals()`
must answer at most 255; the manifest then accepts at most 36 decimals
(`MAX_REWARD_ASSET_DECIMALS` in `reward-asset.mjs`, 422 `invalid_manifest`);
the symbol is read too, and an unreadable symbol keeps the maintainer's
display symbol. On Solana the genesis hash must match and the account must be
a classic SPL mint or the approved Token-2022 subset; Solana gives no symbol.
A token the chain refuses is refused (`reward_asset_unverified`, 422); an
unreachable or rate-limited RPC is a retry (503), never a default.

```quint
type ChainRead = ChainReadDone | ChainReadRefused | ChainReadUnreachable
type AssetReading = { network: int, asset: int, decimals: int, result: ChainRead }
pure val maxRewardAssetDecimals = 36
pure val noAssetReading: AssetReading = { network: 0, asset: 0, decimals: 0, result: ChainReadUnreachable }
pure def assetVerified(network: int, asset: int, reading: AssetReading): bool =
  network > 0 and asset > 0 and reading.network == network and reading.asset == asset and
  reading.result == ChainReadDone and reading.decimals >= 0 and reading.decimals <= maxRewardAssetDecimals
pure def lawUnreadAssetIsRefused(network: int, asset: int, reading: AssetReading): bool =
  reading.result != ChainReadDone implies not(assetVerified(network, asset, reading))
pure def lawReadingOfAnotherAssetIsRefused(network: int, asset: int, reading: AssetReading): bool =
  (reading.network != network or reading.asset != asset) implies not(assetVerified(network, asset, reading))
pure def lawDecimalsBounded(network: int, asset: int, reading: AssetReading): bool =
  assetVerified(network, asset, reading) implies (reading.decimals >= 0 and reading.decimals <= maxRewardAssetDecimals)
pure val readingValues = Set(noAssetReading, { network: 1, asset: 1, decimals: 6, result: ChainReadDone },
  { network: 1, asset: 2, decimals: 18, result: ChainReadDone }, { network: 1, asset: 1, decimals: 6, result: ChainReadRefused },
  { network: 2, asset: 1, decimals: 9, result: ChainReadDone }, { network: 1, asset: 2, decimals: 37, result: ChainReadDone })
```
