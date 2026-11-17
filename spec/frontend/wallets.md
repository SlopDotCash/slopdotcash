# Browser wallet discovery

PRD sections 6 and 10. The browser lists the payout and funding wallets this
browser offers without connecting to any of them, and every request goes only
to the provider object the person chose. Discovery follows EIP-6963
announcements, legacy injected globals and the Wallet Standard. The prompt
lifetimes that use a chosen wallet are in
[direct bounty prompts](./directBountyPrompt.md) and the deposit specs.

## Story: Choose a wallet without a lookalike taking its place

> As a contributor or sponsor, I want to see each wallet this browser offers
> once, and to be sure that what I approve goes to the wallet I chose.

### An announced wallet is accepted only with a version 4 id, a non-blank name, rdns and icon strings and a request function

An EIP-6963 announcement is accepted only when its id is a UUID version 4
(compared lowercased), its name is a string that is not blank, its rdns and
icon are strings and its provider has a `request` function; anything else is
ignored. A wallet's shown icon is the first of its own and a same-named Wallet
Standard wallet's icon that is a `data:image/` PNG, JPEG, WebP or SVG URL;
otherwise it has none. Names never route a request.

```quint
type Announcement = { uuid: int, uuidVersionFour: bool, name: str, rdns: str, icon: str, detailsAreStrings: bool, hasRequest: bool, provider: int }
type Offer = { offerId: int, offerProvider: int, offerName: str, offerRdns: str, offerIcon: str }
type Discovery = { offers: List[Offer], blockedIds: Set[int], blockedProviders: Set[int], announced: Set[int], legacy: List[int] }
pure val initial: Discovery = { offers: List(), blockedIds: Set(), blockedProviders: Set(), announced: Set(), legacy: List() }
pure def validAnnouncement(announcement: Announcement): bool =
  announcement.uuid > 0 and announcement.uuidVersionFour and announcement.name != "" and
    announcement.detailsAreStrings and announcement.hasRequest and announcement.provider > 0
pure def sameDetails(offer: Offer, announcement: Announcement): bool =
  offer.offerProvider == announcement.provider and offer.offerName == announcement.name and
    offer.offerRdns == announcement.rdns and offer.offerIcon == announcement.icon
pure def canAnnounce(d: Discovery, announcement: Announcement): bool = validAnnouncement(announcement)
pure def announce(d: Discovery, announcement: Announcement): Discovery =
  val previous = d.offers.select(o => o.offerId == announcement.uuid)
  if (d.blockedIds.contains(announcement.uuid)) { ...d, blockedProviders: d.blockedProviders.union(Set(announcement.provider)) }
  else if (previous.length() == 0) { ...d,
    offers: d.offers.append({ offerId: announcement.uuid, offerProvider: announcement.provider, offerName: announcement.name,
      offerRdns: announcement.rdns, offerIcon: announcement.icon }),
    announced: d.announced.union(Set(announcement.provider)) }
  else if (previous.every(o => sameDetails(o, announcement))) d
  else { ...d, offers: d.offers.select(o => o.offerId != announcement.uuid),
    blockedIds: d.blockedIds.union(Set(announcement.uuid)),
    blockedProviders: d.blockedProviders.union(Set(announcement.provider)).union(previous.foldl(Set(), (ps, o) => ps.union(Set(o.offerProvider)))) }
pure def evmChoices(d: Discovery): List[int] =
  d.offers.select(o => not(d.blockedProviders.contains(o.offerProvider))).listMap(o => o.offerProvider)
    .concat(d.legacy.select(p => not(d.announced.contains(p)) and not(d.blockedProviders.contains(p))))
pure def alwaysOneOfferPerId(d: Discovery): bool =
  d.offers.every(a => a.offerId > 0 and not(d.blockedIds.contains(a.offerId)) and d.announced.contains(a.offerProvider) and
    d.offers.every(b => a.offerId == b.offerId implies a == b))
pure def sometimesWalletOffered(d: Discovery): bool = evmChoices(d).length() > 0 and d.offers.length() > 0
pure val announcementValues = Set(
  { uuid: 1, uuidVersionFour: true, name: "Rabby", rdns: "io.rabby", icon: "data:image/png;a", detailsAreStrings: true, hasRequest: true, provider: 1 },
  { uuid: 1, uuidVersionFour: true, name: "Rabby", rdns: "io.rabby", icon: "data:image/png;a", detailsAreStrings: true, hasRequest: true, provider: 2 },
  { uuid: 2, uuidVersionFour: true, name: "MetaMask", rdns: "io.metamask", icon: "", detailsAreStrings: true, hasRequest: true, provider: 3 },
  { uuid: 3, uuidVersionFour: false, name: "Fake", rdns: "x", icon: "", detailsAreStrings: true, hasRequest: true, provider: 4 }
)
```

### A reannouncement that changes provider, name, rdns or icon blocks that wallet id

A genuine reannouncement repeats the same provider object and details and
changes nothing. Any difference blocks the id for this page load: its offer is
removed, both provider objects are blocked, and any later announcement under
that id blocks its provider too. A blocked provider is never offered, under
any id or as a legacy global, and a request through it is refused with
"Conflicting wallet details. Reload and check your wallet extensions."

```quint
pure def alwaysBlockedNeverOffered(d: Discovery): bool =
  evmChoices(d).every(p => not(d.blockedProviders.contains(p)))
pure def stepBlocksAreKept(before: Discovery, after: Discovery): bool =
  before.blockedIds.subseteq(after.blockedIds) and before.blockedProviders.subseteq(after.blockedProviders)
pure def sometimesConflictBlocked(d: Discovery): bool = d.blockedIds.size() > 0 and d.blockedProviders.size() > 1
```

### A legacy injected provider is added only when no announcement carries the same object

`window.ethereum` (or each of its `providers`, once each) is offered only when
no announcement ever carried that same object and it is not blocked; object
identity decides, never a name. Its name comes from its flags, checked in the
order Rabby, Brave Wallet, Phantom, Trust Wallet, Coinbase Wallet and MetaMask
last (several wallets also set the MetaMask flag), else "Browser wallet".

```quint
pure def canInjectLegacy(d: Discovery, provider: int): bool = provider > 0 and not(d.legacy.includes(provider))
pure def injectLegacy(d: Discovery, provider: int): Discovery = { ...d, legacy: d.legacy.append(provider) }
pure def lawAnnouncedProviderIsNotOfferedTwice(d: Discovery): bool =
  d.legacy.every(p => d.announced.contains(p) implies
    evmChoices(d).select(c => c == p).length() <= d.offers.select(o => o.offerProvider == p).length())
pure def sometimesLegacyOffered(d: Discovery): bool = d.legacy.some(p => not(d.announced.contains(p)) and evmChoices(d).includes(p))
pure val providerValues = Set(1, 3, 5)
pure val dValues = Set(initial,
  { offers: List({ offerId: 1, offerProvider: 1, offerName: "Rabby", offerRdns: "io.rabby", offerIcon: "" }),
    blockedIds: Set(), blockedProviders: Set(), announced: Set(1), legacy: List(1, 5) })
```

### A Solana wallet qualifies only with a solana chain, connect and sign-message features

A Wallet Standard wallet is offered for Solana only when one of its chains
starts with `solana:` and it has `standard:connect` and `solana:signMessage`;
it funds when it also has `solana:signAndSendTransaction` and binds a vault
when it has `solana:signTransaction`, and both require the legacy transaction
version. A legacy `window.phantom.solana` or `window.solana` global is offered
unless a qualifying Wallet Standard wallet already has its detected name
(Phantom, Solflare or "Browser wallet", compared lowercased).

```quint
type StandardWallet = { solanaChain: bool, standardConnect: bool, signMessage: bool, signAndSend: bool, signTransaction: bool }
pure def solanaQualifies(standardWallet: StandardWallet): bool =
  standardWallet.solanaChain and standardWallet.standardConnect and standardWallet.signMessage
pure def solanaFunds(standardWallet: StandardWallet): bool = solanaQualifies(standardWallet) and standardWallet.signAndSend
pure def solanaBinds(standardWallet: StandardWallet): bool = solanaQualifies(standardWallet) and standardWallet.signTransaction
pure def legacySolanaOffered(legacyName: str, standardNames: Set[str]): bool = not(standardNames.contains(legacyName))
pure def lawFundingNeedsQualification(standardWallet: StandardWallet): bool =
  (solanaFunds(standardWallet) or solanaBinds(standardWallet)) implies standardWallet.signMessage and standardWallet.solanaChain
pure def lawSameNamedLegacyIsHidden(legacyName: str): bool = not(legacySolanaOffered(legacyName, Set(legacyName)))
pure val standardWalletValues = Set(
  { solanaChain: true, standardConnect: true, signMessage: true, signAndSend: true, signTransaction: false },
  { solanaChain: true, standardConnect: true, signMessage: false, signAndSend: true, signTransaction: true },
  { solanaChain: false, standardConnect: true, signMessage: true, signAndSend: false, signTransaction: false })
pure val legacyNameValues = Set("phantom", "solflare", "browser wallet")
pure val standardNamesValues = Set(Set(), Set("phantom"))
```

### A prompt uses the selected provider object and refuses after an account or chain change

Each request of a connected EVM wallet first checks that its provider is still
unblocked, and an account change (`wallet_requestPermissions`) asks the wallet
for its account picker; a user rejection (code 4001) stops it. A Solana
signature or send first checks that the same Wallet Standard wallet is still
registered and its account still has the network and the feature, and a
message signature must return 64 bytes over exactly the requested message.
Otherwise the request is refused before the wallet sees it ("The wallet
account or network changed. Connect and review again.").

```quint
type SelectedWallet = { selectedProvider: int, selectedAccount: str, selectedChain: str }
type WalletNow = { provider: int, account: str, chain: str, registered: bool, blocked: bool, hasFeature: bool }
pure def walletRequestAllowed(selected: SelectedWallet, walletNow: WalletNow): bool =
  walletNow.registered and not(walletNow.blocked) and walletNow.hasFeature and
    walletNow.provider == selected.selectedProvider and walletNow.account == selected.selectedAccount and
    walletNow.chain == selected.selectedChain
pure def lawChangedAccountOrChainRefuses(selected: SelectedWallet, walletNow: WalletNow): bool =
  (walletNow.account != selected.selectedAccount or walletNow.chain != selected.selectedChain or
    walletNow.provider != selected.selectedProvider) implies not(walletRequestAllowed(selected, walletNow))
pure def lawBlockedProviderRefuses(selected: SelectedWallet, walletNow: WalletNow): bool =
  walletNow.blocked implies not(walletRequestAllowed(selected, walletNow))
pure val selectedValues = Set({ selectedProvider: 1, selectedAccount: "0xa", selectedChain: "eip155:8453" })
pure val walletNowValues = Set(
  { provider: 1, account: "0xa", chain: "eip155:8453", registered: true, blocked: false, hasFeature: true },
  { provider: 1, account: "0xb", chain: "eip155:8453", registered: true, blocked: false, hasFeature: true },
  { provider: 1, account: "0xa", chain: "eip155:1", registered: true, blocked: true, hasFeature: true })
```
