# Project page links

PRD section 7 (operator decision, 16 November 2026): a project page shows
the network of each recorded vault, with its payout asset when known, the
project's website and its X account, each only when present. Sources at
Slop development `df21e37b7`: `src/lib/project-links.ts:128–175`
(`projectChains`, `websiteLabel`) and `src/App.tsx:1399–1450`. Owners set or
clear the website and X account as presentation links (`links.website`,
`links.x`) in an immutable owner revision, not material terms; that revision
is the [project](../backend/projects.md) record's.

## Story: See where a project's money and links live

### The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present

The recorded vaults are the monthly pool's deployments, then the private
bounty's settlement deployments, in that order. Each deployment arrives with
its network's display name (a test network named "<name> testnet") and its
asset symbol, empty when Slop does not know it. A network is listed once, at
its first deployment; two vaults on it with different symbols show none. No
recorded vault lists no network. The website shows as its host and path
without the scheme or a leading `www.`.

```quint
type VaultNetwork = { network: str, symbol: str }
type ProjectLinks = { website: str, xAccount: str }
pure def withNetwork(networks: List[VaultNetwork], incoming: VaultNetwork): List[VaultNetwork] =
  if (networks.some(entry => entry.network == incoming.network))
    networks.listMap(entry => if (entry.network == incoming.network and entry.symbol != incoming.symbol) { ...entry, symbol: "" } else entry)
  else networks.append(incoming)
pure def projectNetworks(deployments: List[VaultNetwork]): List[VaultNetwork] =
  deployments.foldl(List(), (networks, incoming) => withNetwork(networks, incoming))
pure def showsWebsite(links: ProjectLinks): bool = links.website != ""
pure def showsXAccount(links: ProjectLinks): bool = links.xAccount != ""
pure def lawNoVaultNoNetwork(deployments: List[VaultNetwork]): bool =
  deployments.length() == 0 implies projectNetworks(deployments).length() == 0
pure def lawEachNetworkOnce(deployments: List[VaultNetwork]): bool =
  val networks = projectNetworks(deployments)
  networks.every(entry => networks.select(other => other.network == entry.network).length() == 1)
pure def lawEveryVaultNetworkListed(deployments: List[VaultNetwork]): bool =
  val networks = projectNetworks(deployments)
  deployments.every(deployment => networks.some(entry => entry.network == deployment.network))
pure def lawDisagreeingSymbolsShowNone(firstVault: VaultNetwork, secondVault: VaultNetwork): bool =
  (firstVault.network == secondVault.network and firstVault.symbol != secondVault.symbol)
    implies projectNetworks(List(firstVault, secondVault)) == List({ ...firstVault, symbol: "" })
pure val ethereumUsdc: VaultNetwork = { network: "Ethereum", symbol: "USDC" }
pure val deploymentsValues = Set(List(), List(ethereumUsdc, { network: "Base", symbol: "" }),
  List(ethereumUsdc, { ...ethereumUsdc, symbol: "USDT" }, ethereumUsdc))
pure val firstVaultValues = Set(ethereumUsdc)
pure val secondVaultValues = Set(ethereumUsdc, { ...ethereumUsdc, symbol: "" }, { network: "Base", symbol: "USDC" })
pure val linksValues = Set({ website: "", xAccount: "" }, { website: "https://example.org", xAccount: "example" })
```
