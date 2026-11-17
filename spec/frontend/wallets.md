# Browser wallet discovery

PRD sections 6 and 10. The browser lists the payout and funding wallets this
browser offers without connecting to any of them, and every request goes only
to the provider object the person chose. EIP-6963 announcements and legacy
injected providers, and refusing a conflicting one, are the
[payout wallet choice](./walletConsent.md) ("Discovery offers announced and
legacy providers and refuses conflicting ones"). These rules add the Wallet
Standard's Solana wallets and the check every wallet request makes. The prompt
lifetimes that use a chosen wallet are in
[direct bounty prompts](./directBountyPrompt.md),
[Solana bounty prompts](./solanaBountyPrompt.md) and the deposit specs.

## Story: Choose a wallet without a lookalike taking its place

> As a contributor or sponsor, I want to see each wallet this browser offers
> once, and to be sure that what I approve goes to the wallet I chose.

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
trusted, not marked conflicting by discovery (`blocked` below), and an account change (`wallet_requestPermissions`) asks the wallet
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
