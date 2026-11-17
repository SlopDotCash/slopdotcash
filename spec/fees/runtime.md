# Fee-wallet Worker publication and modes

PRD section 6 (received-fee handling, BUY-07), section 11 and CLAUDE.md
"Rewards, funding, and settlement" govern when the fee-wallet Worker may run
and sign. The production release publishes the Worker only while the
repository variable `SLOP_FEE_CONVERTER_RELEASE` is `enabled`. The staging
release publishes its isolated staging Worker on every staging release, with
no variable, and refuses any mode other than dry run: a second live signer
must never compete for the production wallets, and testnet qualification
never uses production credentials. Its preflight reads the
reviewed `wrangler.toml` modes, networks and native limits and the Worker
secret inventory. Fee handling starts only after the owner verifies that each
fee wallet is funded and its limits and readiness are correct (#1285). The
pinned sources are `.github/workflows/deploy.yml` (fee-converter release step),
`workers/fee-converter/config.ts`, `buyback-config.ts` and `index.ts`.

This machine owns those facts. The [conversion journal](./conversion.md) and
the [buyback](./buyback.md) hold it as a component and read their signing
authority from it. The `by` sender is authenticated by the shell:
`ReleaseWorkflow` is the checked-in main or development release job and
`Owner` is the repository owner acting through GitHub or the owner console.

## Story: Publish the fee Worker only from a reviewed release and its preflight

### The release variable gates production publication, never a running Worker

Turning the variable off stops later production publications. It does not stop a Worker
version that is already published; only a later publication in `Off` mode
does. A publication carries the exact source it was built from, and sources
only advance.

```quint
type Network = Base | Ethereum | Robinhood | Solana
type Mode = Off | DryRun | Live
type Environment = Production | Staging
type Sender = ReleaseWorkflow | Owner | Worker | Other
type WorkerConfig = { source: int, converterMode: Mode, buybackMode: Mode, networks: List[Network],
  keys: List[Network], nativeLimits: List[Network], evmWallet: int, solanaWallet: int }
type Runtime = { environment: Environment, variableEnabled: bool, published: bool, source: int,
  converterMode: Mode, buybackMode: Mode, networks: List[Network], keys: List[Network], nativeLimits: List[Network],
  evmWallet: int, solanaWallet: int, ready: Readiness, replacementActive: bool, publications: int }
type Readiness = { base: bool, ethereum: bool, robinhood: bool, solana: bool }
pure val initial: Runtime = { environment: Production, variableEnabled: false, published: false, source: 0,
  converterMode: Off, buybackMode: Off, networks: List(), keys: List(), nativeLimits: List(),
  evmWallet: 1, solanaWallet: 2, ready: noReadiness, replacementActive: false, publications: 0 }
pure val noReadiness: Readiness = { base: false, ethereum: false, robinhood: false, solana: false }
pure def readyFor(ready: Readiness, network: Network): bool =
  if (network == Base) ready.base else if (network == Ethereum) ready.ethereum else if (network == Robinhood) ready.robinhood else ready.solana
pure def setReady(ready: Readiness, network: Network, value: bool): Readiness =
  if (network == Base) { ...ready, base: value } else if (network == Ethereum) { ...ready, ethereum: value }
  else if (network == Robinhood) { ...ready, robinhood: value } else { ...ready, solana: value }
pure def walletOf(r: Runtime, network: Network): int = if (network == Solana) r.solanaWallet else r.evmWallet
pure def keepEnabled(ready: Readiness, networks: List[Network], evmKept: bool, solanaKept: bool): Readiness =
  { base: ready.base and evmKept and listed(networks, Base), ethereum: ready.ethereum and evmKept and listed(networks, Ethereum),
    robinhood: ready.robinhood and evmKept and listed(networks, Robinhood), solana: ready.solana and solanaKept and listed(networks, Solana) }
pure def canChooseEnvironment(r: Runtime, environment: Environment): bool = r.publications == 0 and not(r.published)
pure def chooseEnvironment(r: Runtime, environment: Environment): Runtime = { ...r, environment: environment }
pure def canSetReleaseVariable(r: Runtime, variable: bool, by: Sender): bool = by == Owner and variable != r.variableEnabled
pure def setReleaseVariable(r: Runtime, variable: bool, by: Sender): Runtime = { ...r, variableEnabled: variable }
```

### The preflight refuses an incomplete live configuration

Native ceilings per transaction and per UTC day are the PRD table in gwei
and lamports: Base 100,000 and 1,000,000 (the transaction ceiling includes
the 0.00005 ETH data and operator reserve), Ethereum 1,000,000 and
10,000,000, Robinhood Chain 200,000 and 2,000,000, Solana 5,000,000 and
20,000,000 lamports including account creation and priority fees. A
converting network is any network with a verified USDC target: Base,
Ethereum and Solana. Live conversion needs every enabled network's key, and
native limits for every converting network. A buyback that is not off needs
Robinhood Chain enabled and a converter that is not off. A live buyback needs
a live converter and Robinhood Chain native limits. Base, Ethereum and
Robinhood Chain share one EVM fee wallet; Solana has its own. A staging
publication runs the converter in dry run only, with no buyback and no
signing key.

```quint
pure def converts(network: Network): bool = network != Robinhood
pure def transactionCeilingOf(network: Network): int =
  if (network == Base) 100000 else if (network == Ethereum) 1000000 else if (network == Robinhood) 200000 else 5000000
pure def dailyCeilingOf(network: Network): int =
  if (network == Base) 1000000 else if (network == Ethereum) 10000000 else if (network == Robinhood) 2000000 else 20000000
pure def listed(networks: List[Network], network: Network): bool = networks.includes(network)
pure def preflightPasses(environment: Environment, config: WorkerConfig): bool =
  config.source > 0 and config.evmWallet > 0 and config.solanaWallet > 0 and config.evmWallet != config.solanaWallet
    and (config.converterMode == Live implies
      config.networks.every(n => listed(config.keys, n)) and config.networks.every(n => not(converts(n)) or listed(config.nativeLimits, n)))
    and (config.buybackMode != Off implies listed(config.networks, Robinhood) and config.converterMode != Off)
    and (config.buybackMode == Live implies config.converterMode == Live and listed(config.nativeLimits, Robinhood)
      and listed(config.keys, Robinhood))
    and (environment == Staging implies config.converterMode == DryRun and config.buybackMode == Off and config.keys == List())
pure def canPublish(r: Runtime, config: WorkerConfig, by: Sender): bool =
  by == ReleaseWorkflow and (r.environment == Production implies r.variableEnabled) and config.source > r.source
    and preflightPasses(r.environment, config)
pure def publish(r: Runtime, config: WorkerConfig, by: Sender): Runtime =
  { ...r, published: true, source: config.source, converterMode: config.converterMode, buybackMode: config.buybackMode,
    networks: config.networks, keys: config.keys, nativeLimits: config.nativeLimits,
    ready: keepEnabled(r.ready, config.networks, config.evmWallet == r.evmWallet, config.solanaWallet == r.solanaWallet),
    evmWallet: config.evmWallet, solanaWallet: config.solanaWallet, publications: r.publications + 1 }
pure def alwaysPublishedPassedPreflight(r: Runtime): bool = r.published implies preflightPasses(r.environment,
  { source: r.source, converterMode: r.converterMode, buybackMode: r.buybackMode, networks: r.networks,
    keys: r.keys, nativeLimits: r.nativeLimits, evmWallet: r.evmWallet, solanaWallet: r.solanaWallet })
pure def alwaysUnpublishedInert(r: Runtime): bool = not(r.published) implies
  r.converterMode == Off and r.buybackMode == Off and r.source == 0 and r.publications == 0 and r.keys == List()
pure def alwaysBuybackNeedsLiveConverter(r: Runtime): bool =
  (r.buybackMode == Live implies r.converterMode == Live) and (r.buybackMode != Off implies r.converterMode != Off)
pure def alwaysStagingBuybackOff(r: Runtime): bool = r.environment == Staging implies r.buybackMode == Off
pure def alwaysStagingNeverSigns(r: Runtime): bool = r.environment == Staging implies
  r.converterMode != Live and r.keys == List() and not(networkSigns(r, Base)) and not(networkSigns(r, Solana))
pure def stepPublicationOnlyByRelease(before: Runtime, via: str, after: Runtime): bool =
  (after.source != before.source or after.converterMode != before.converterMode or after.buybackMode != before.buybackMode)
    implies via == "publish"
pure def stepSourceAdvances(before: Runtime, after: Runtime): bool = after.source >= before.source
pure def sometimesLiveBuyback(r: Runtime): bool = r.buybackMode == Live and r.published
pure def sometimesPublishedDryRun(r: Runtime): bool = r.published and r.converterMode == DryRun
pure def sometimesPublishedThenDisabled(r: Runtime): bool = r.published and not(r.variableEnabled) and r.environment == Production
pure def sometimesStagingDryRun(r: Runtime): bool = r.published and r.environment == Staging and r.converterMode == DryRun
```

### Signing needs a live mode and owner-verified readiness for the exact wallet

Readiness is recorded per network by the owner after the wallet is funded and
its limits are verified. A publication that changes the shared EVM fee wallet
clears the Base, Ethereum and Robinhood Chain records; one that changes the
Solana fee wallet clears the Solana record; one that drops a network clears
that network's record.
Same-nonce EVM fee replacement has its own owner activation, independent of
source approval.

```quint
pure def canVerifyReadiness(r: Runtime, network: Network, listedWallet: int, by: Sender): bool =
  by == Owner and r.published and listed(r.networks, network) and not(readyFor(r.ready, network))
    and readinessEntryApplies(r, network, listedWallet)
pure def verifyReadiness(r: Runtime, network: Network, listedWallet: int, by: Sender): Runtime =
  { ...r, ready: setReady(r.ready, network, true) }
pure def canWithdrawReadiness(r: Runtime, network: Network, by: Sender): bool = by == Owner and readyFor(r.ready, network)
pure def withdrawReadiness(r: Runtime, network: Network, by: Sender): Runtime = { ...r, ready: setReady(r.ready, network, false) }
pure def canSetReplacement(r: Runtime, active: bool, by: Sender): bool = by == Owner and active != r.replacementActive
pure def setReplacement(r: Runtime, active: bool, by: Sender): Runtime = { ...r, replacementActive: active }
pure def runs(r: Runtime): bool = r.published and r.converterMode != Off
pure def networkSigns(r: Runtime, network: Network): bool =
  r.published and listed(r.networks, network) and listed(r.keys, network) and listed(r.nativeLimits, network)
    and readyFor(r.ready, network)
pure def conversionSigns(r: Runtime, network: Network): bool = r.converterMode == Live and converts(network) and networkSigns(r, network)
pure def buybackSigns(r: Runtime, network: Network): bool = r.buybackMode == Live and r.converterMode == Live
  and r.environment == Production and networkSigns(r, network) and networkSigns(r, Robinhood)
pure def replacementSigns(r: Runtime, network: Network): bool = r.replacementActive and network != Solana
  and r.converterMode == Live and networkSigns(r, network)
pure def alwaysReadyOnlyForEnabledNetworks(r: Runtime): bool =
  (r.ready.base implies listed(r.networks, Base)) and (r.ready.ethereum implies listed(r.networks, Ethereum))
    and (r.ready.robinhood implies listed(r.networks, Robinhood)) and (r.ready.solana implies listed(r.networks, Solana))
pure def lawSigningNeedsLiveAndReadiness(r: Runtime, network: Network): bool =
  (conversionSigns(r, network) or buybackSigns(r, network) or replacementSigns(r, network)) implies
    r.published and r.converterMode == Live and listed(r.keys, network) and listed(r.nativeLimits, network) and readyFor(r.ready, network)
pure def lawRobinhoodNeverConverts(r: Runtime): bool = not(conversionSigns(r, Robinhood))
pure def sometimesSigningReady(r: Runtime): bool = conversionSigns(r, Base)
pure def sometimesReadinessWithdrawn(r: Runtime): bool = r.published and r.converterMode == Live and r.ready == noReadiness and r.publications > 1
pure def sometimesSolanaKeptAcrossEvmWalletChange(r: Runtime): bool = r.ready.solana and not(r.ready.base) and r.evmWallet != 1
```

### Owner readiness and replacement activation are reviewed Worker configuration bound to the exact fee wallet address

The owner's decision on where readiness lives is pending. Until it is made,
readiness and the replacement activation are reviewed Worker configuration:
the variable `FEE_READY` lists `network:walletAddress` pairs and
`FEE_REPLACEMENT_ACTIVE` switches replacement, and either changes only
through a reviewed pull request and a release. Each listed pair is applied
as an `Owner` readiness verification carrying the pair's address, which the
shell sends only after authenticating the owner's approval of the reviewed
change; the release job's own authority never stands in for it. The
verification is admitted only when that address equals the published fee
wallet of that network; a pair naming any other address grants nothing.
The alternative under review is an owner record kept by the owner console;
the alternative of letting the release itself grant readiness would replace
the rule that a publication never grants it and is not modelled. Either way
readiness is the owner's act, a publication never grants it, and a
publication that changes a fee wallet drops the readiness of every network
that wallet serves. The production cut-over publishes with both modes `Off`
and no readiness. The old Worker kept no readiness record: readiness was the
operational check of #1285.

```quint
pure def readinessEntryApplies(r: Runtime, network: Network, listedWallet: int): bool =
  listedWallet > 0 and listedWallet == walletOf(r, network)
pure def stepReadinessOnlyByOwnerOrPublication(before: Runtime, via: str, after: Runtime): bool =
  (after.ready != before.ready implies (via == "verifyReadiness" or via == "withdrawReadiness" or via == "publish"))
    and (after.replacementActive != before.replacementActive implies via == "setReplacement")
pure def stepPublicationNeverGrantsReadiness(before: Runtime, via: str, after: Runtime): bool = via == "publish" implies
  (after.ready.base implies before.ready.base) and (after.ready.ethereum implies before.ready.ethereum)
    and (after.ready.robinhood implies before.ready.robinhood) and (after.ready.solana implies before.ready.solana)
pure def stepWalletChangeClearsReadiness(before: Runtime, after: Runtime): bool =
  (after.evmWallet != before.evmWallet implies not(after.ready.base) and not(after.ready.ethereum) and not(after.ready.robinhood))
    and (after.solanaWallet != before.solanaWallet implies not(after.ready.solana))
pure def sometimesReplacementActive(r: Runtime): bool = r.replacementActive and r.published and r.ready.base
```

### Simulation samples cover complete, incomplete and staging configurations

```quint
pure val liveAll: WorkerConfig = { source: 1, converterMode: Live, buybackMode: Live, networks: List(Base, Robinhood, Solana),
  keys: List(Base, Robinhood, Solana), nativeLimits: List(Base, Robinhood, Solana), evmWallet: 1, solanaWallet: 2 }
pure val configValues = Set(liveAll, { ...liveAll, source: 2, buybackMode: Off },
  { ...liveAll, source: 2, converterMode: DryRun, buybackMode: DryRun },
  { ...liveAll, source: 3, converterMode: Off, buybackMode: Off },
  { ...liveAll, source: 3, keys: List(Base) },
  { ...liveAll, source: 2, converterMode: DryRun, buybackMode: Live },
  { ...liveAll, source: 4, evmWallet: 3, buybackMode: Off },
  { ...liveAll, source: 2, converterMode: DryRun, buybackMode: Off, keys: List() },
  { ...liveAll, source: 3, converterMode: Live, buybackMode: Off, keys: List() })
pure val environmentValues = Set(Production, Staging)
pure val networkValues = Set(Base, Robinhood, Solana, Ethereum)
pure val byValues = Set(ReleaseWorkflow, Owner, Other)
pure val listedWalletValues = Set(1, 2, 3)
```
