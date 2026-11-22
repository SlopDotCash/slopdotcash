# Payout wallet choice and binding consent

PRD sections 3 and 6 and CLAUDE.md PAY-05: a payout destination is bound
only with the authenticated account and the destination wallet's own
signature, and Slop never infers wallet control. Sources at Slop development
`87a26cc98`: `src/PayoutConsent.tsx` (review dialog, connect, EIP-712
`evmBindingTypedData`, `verifyPreparedSolanaBinding` and
`verifySignedSolanaBinding`, the `x-slop-expected-github-id` header, 401
means sign in again), `src/lib/use-payout-wallets.ts`,
`src/lib/wallet-possession.ts`, `src/lib/wallet-proof.ts` and
`src/Earnings.tsx`. It succeeds the retained `evm_wallet_discovery`,
`ui_wallet_choice`, `solana_wallet_provider`, `solana_binding_wire`,
`solana_message_buffers`, `ui_payout_consent`, `ui_payout_consent_lifetime`,
`ui_earnings_wallet_lifetime` and `ui_earnings_actor_binding` models. The
[wallet registry](../backend/wallets.md) and
[binding consent](../backend/bindingConsent.md) verify and store; the
[signer boundary](../settlement/signer.md) decides what the attester may
submit. This dialog only chooses, connects, checks bytes and posts.

One instance is one browser context's Earnings page and consent dialog. The
sender `by` is the signed-in account (positive), the server (`0`), the
wallet adapter (`-1`) or the browser's provider discovery (`-2`). Every
reply carries the request it answers. Each review names its surface: the
Account wallets section (`WalletsPage`) or the payout consent dialog opened
for an authorized claim (`PayoutDialog`). A dialog review carries the
claim's address (`claimWallet`) and connects only that wallet, whatever the
account's saved wallet is; Account wallets carries none (development
`src/PayoutConsent.tsx` `claim.address` and `src/Earnings.tsx` at
`67fd54fd4`).

## Story: Choose a trusted wallet and connect it

### Discovery offers announced and legacy providers and refuses conflicting ones

A provider announces itself with an identity; a second announcement of the
same identity with different metadata marks it conflicting for the rest of
the page's life. The legacy injected provider is offered only when no
announced provider stands for it. Discovery never connects. A chosen
provider that becomes conflicting before the wallet answers is refused, and
the connect result rechecks trust after the account picker.

```quint
import wallets as W from "../backend/wallets"
import signer as SG from "../settlement/signer"
type Phase = Closed | Choosing | Connecting | Connected | Replacing | Preparing | Prepared | Signing | Signed | Posting
  | Accepted | KeptSaved | SignInAgain | Refused
type Surface = WalletsPage | PayoutDialog
type Consent = { actor: int, lifetime: int, request: int, phase: Phase, chain: W::WalletChain, surface: Surface,
  announced: List[int], conflicted: List[int], legacy: List[int], selected: int,
  walletAccount: str, savedWallet: str, claimWallet: str, preparedFor: str, prepared: str, intent: int, signature: SG::WalletSignature }
pure val server = 0
pure val adapter = -1
pure val discovery = -2
pure val noSignature: SG::WalletSignature = { wallet: "", signer: "", intent: 0 }
pure val initial: Consent = { actor: 0, lifetime: 0, request: 0, phase: Closed, chain: W::Base, surface: WalletsPage,
  announced: List(), conflicted: List(), legacy: List(), selected: 0,
  walletAccount: "", savedWallet: "", claimWallet: "", preparedFor: "", prepared: "", intent: 0, signature: noSignature }
pure def trusted(c: Consent, provider: int): bool = provider > 0 and not(c.conflicted.includes(provider))
  and (c.announced.includes(provider) or c.legacy.includes(provider))
pure def closedFor(actor: int, savedWallet: str, c: Consent): Consent = { ...initial, actor: actor, lifetime: c.lifetime + 1,
  request: c.request + 1, savedWallet: savedWallet, announced: c.announced, conflicted: c.conflicted, legacy: c.legacy }
pure def canSignIn(c: Consent, account: int, savedWallet: str, by: int): bool = account > 0 and by == account and account != c.actor
  and c.lifetime < 9007199254740991 and c.request < 9007199254740991
pure def signIn(c: Consent, account: int, savedWallet: str, by: int): Consent = closedFor(account, savedWallet, c)
pure def canSignOut(c: Consent, by: int): bool = c.actor > 0 and by == c.actor and c.request < 9007199254740991
pure def signOut(c: Consent, by: int): Consent = closedFor(0, "", c)
pure def canAnnounce(c: Consent, provider: int, sameMetadata: bool, by: int): bool = by == discovery and provider > 0
pure def announce(c: Consent, provider: int, sameMetadata: bool, by: int): Consent =
  val conflict = c.announced.includes(provider) and not(sameMetadata)
  val conflicted = if (conflict and not(c.conflicted.includes(provider))) c.conflicted.append(provider) else c.conflicted
  val shown = c.phase != Closed and c.phase != Accepted and c.phase != KeptSaved and c.selected == provider and conflict
  { ...c, announced: if (c.announced.includes(provider)) c.announced else c.announced.append(provider),
    conflicted: conflicted,
    phase: if (shown) Refused else c.phase, request: if (shown) c.request + 1 else c.request }
pure def canObserveLegacy(c: Consent, provider: int, by: int): bool = by == discovery and provider > 0
  and not(c.announced.includes(provider)) and not(c.legacy.includes(provider))
pure def observeLegacy(c: Consent, provider: int, by: int): Consent = { ...c, legacy: c.legacy.append(provider) }
pure def canOpenReview(c: Consent, chain: W::WalletChain, surface: Surface, claimWallet: str, by: int): bool = c.actor > 0
  and by == c.actor and (c.phase == Closed or c.phase == Accepted or c.phase == KeptSaved or c.phase == Refused)
  and ((surface == PayoutDialog) iff (claimWallet != ""))
pure def openReview(c: Consent, chain: W::WalletChain, surface: Surface, claimWallet: str, by: int): Consent =
  { ...c, phase: Choosing, chain: chain, surface: surface, claimWallet: claimWallet, selected: 0, walletAccount: "",
    preparedFor: "", prepared: "", intent: 0, signature: noSignature }
pure def canConnect(c: Consent, provider: int, by: int): bool = by == c.actor and c.actor > 0 and c.phase == Choosing
  and trusted(c, provider) and c.request < 9007199254740991
pure def connect(c: Consent, provider: int, by: int): Consent = { ...c, phase: Connecting, selected: provider, request: c.request + 1 }
pure def canConnectReply(c: Consent, request: int, walletAddress: str, by: int): bool = by == adapter and request == c.request
  and c.phase == Connecting and walletAddress != ""
pure def connectedPhase(c: Consent, walletAddress: str): Phase =
  if (c.surface == PayoutDialog) (if (walletAddress == c.claimWallet) Connected else Refused)
  else if (c.savedWallet != "" and c.savedWallet != walletAddress) Replacing
  else Connected
pure def connectReply(c: Consent, request: int, walletAddress: str, by: int): Consent =
  if (not(trusted(c, c.selected))) { ...c, phase: Refused }
  else { ...c, walletAccount: walletAddress, phase: connectedPhase(c, walletAddress) }
```

### Replacing a saved wallet needs an explicit choice

When the account already has a different saved payout wallet, Account
wallets asks whether to replace it ("Register" or "Keep saved"). Keeping the
saved wallet ends the review with nothing changed; only an explicit
confirmation continues. The payout consent dialog never registers or
replaces a wallet, and its accepted post leaves the account's saved wallet as
it was: a connected wallet, or a wallet account change, whose
address is not the claim's is refused ("Wrong address. Connect <claim>." or
"The wallet account changed. Connect and review again.") and nothing is
prepared, signed or posted for it (development `src/PayoutConsent.tsx`
`authorize`, `src/Earnings.tsx` `connect` and `confirmChange`).

```quint
pure def canDecideReplacement(c: Consent, replace: bool, by: int): bool = by == c.actor and c.actor > 0 and c.phase == Replacing
  and c.surface == WalletsPage
pure def decideReplacement(c: Consent, replace: bool, by: int): Consent = { ...c, phase: if (replace) Connected else KeptSaved }
```

## Story: Sign exactly the binding the server prepared

### The prepared and signed bytes must equal the server's message before posting

The server prepares the binding message for the connected wallet: EIP-712
typed data for an EVM network, the half-signed transaction for Solana. The
dialog rebuilds it from the claim, network, vault, version and expiry it
expects and continues only when the two are identical byte for byte. The
wallet signs exactly those bytes for the connected wallet and the server's
current intent. On an EVM network the dialog re-checks the wallet's account
and chain, asks the claim address to sign the compared typed data and posts
the signature: recovering the signer is the server's
([binding consent](../backend/bindingConsent.md)). On Solana the signed
binding transaction must verify for the claim before anything is posted
(development `src/PayoutConsent.tsx:170–226` and
`src/lib/payout-consent.ts` `verifySignedSolanaBinding` at `67fd54fd4`).
A wallet account change invalidates prepared bytes and any signature over
them, and discards a post still in flight; the dialog asks again
whether to replace a different saved wallet (the consent dialog refuses
it), then prepares for the new account.

```quint
pure def canPrepare(c: Consent, by: int): bool = by == c.actor and c.actor > 0 and c.phase == Connected
  and c.request < 9007199254740991
pure def prepare(c: Consent, by: int): Consent = { ...c, phase: Preparing, request: c.request + 1 }
pure def canPrepareReply(c: Consent, request: int, message: str, rebuilt: str, intent: int, by: int): bool =
  by == server and request == c.request and c.phase == Preparing and message != "" and intent > 0
pure def prepareReply(c: Consent, request: int, message: str, rebuilt: str, intent: int, by: int): Consent =
  if (message != rebuilt) { ...c, phase: Refused }
  else { ...c, phase: Prepared, prepared: message, preparedFor: c.walletAccount, intent: intent }
pure def canSign(c: Consent, by: int): bool = by == c.actor and c.actor > 0 and c.phase == Prepared
  and c.preparedFor == c.walletAccount and c.request < 9007199254740991
pure def sign(c: Consent, by: int): Consent = { ...c, phase: Signing, request: c.request + 1 }
pure def canSignReply(c: Consent, request: int, signedMessage: str, signature: SG::WalletSignature, by: int): bool =
  by == adapter and request == c.request and c.phase == Signing
pure def signReply(c: Consent, request: int, signedMessage: str, signature: SG::WalletSignature, by: int): Consent =
  if (signedMessage == c.prepared and signature.wallet == c.walletAccount
      and (c.chain == W::Solana implies signature.signer == signature.wallet)
      and signature.intent == c.intent and c.preparedFor == c.walletAccount) { ...c, phase: Signed, signature: signature }
  else { ...c, phase: Refused }
pure def canChangeWalletAccount(c: Consent, walletAddress: str, by: int): bool = by == adapter and walletAddress != ""
  and walletAddress != c.walletAccount and c.walletAccount != "" and c.request < 9007199254740991
pure def changeWalletAccount(c: Consent, walletAddress: str, by: int): Consent =
  val connected = connectedPhase(c, walletAddress)
  if (c.phase == Prepared or c.phase == Preparing or c.phase == Signing or c.phase == Signed or c.phase == Posting)
    { ...c, walletAccount: walletAddress, phase: connected, request: c.request + 1, preparedFor: "", prepared: "", intent: 0, signature: noSignature }
  else if (c.phase == Connected or c.phase == Replacing) { ...c, walletAccount: walletAddress, phase: connected }
  else { ...c, walletAccount: walletAddress }
```

### Posting names the expected account; a 401 asks to sign in again, and closing discards late replies

The post carries the expected GitHub account; the server refuses it if the
session belongs to another. A 401 means the session ended: the dialog asks
the member to sign in again and posts nothing more. Accepted consent is not
a payment and moves no funds: the identity attester may only submit the
binding. Closing the dialog, a wallet account change, an account change or
sign-out starts a new request, so a late connect, prepare, sign or post
reply changes nothing.

```quint
type PostResult = PostAccepted | PostUnauthorized | PostRefused
pure def canPost(c: Consent, by: int): bool = by == c.actor and c.actor > 0 and c.phase == Signed
  and c.request < 9007199254740991
pure def post(c: Consent, by: int): Consent = { ...c, phase: Posting, request: c.request + 1 }
pure def canPostReply(c: Consent, request: int, result: PostResult, by: int): bool = by == server and request == c.request
  and c.phase == Posting
pure def postReply(c: Consent, request: int, result: PostResult, by: int): Consent =
  if (result == PostAccepted) { ...c, phase: Accepted,
    savedWallet: if (c.surface == PayoutDialog) c.savedWallet else c.walletAccount }
  else if (result == PostUnauthorized) { ...c, phase: SignInAgain } else { ...c, phase: Refused }
pure def canClose(c: Consent, by: int): bool = by == c.actor and c.actor > 0 and c.phase != Closed and c.request < 9007199254740991
pure def close(c: Consent, by: int): Consent = { ...c, phase: Closed, request: c.request + 1 }
```

### Rules

```quint
pure def signedPhase(phase: Phase): bool = phase == Signed or phase == Posting
pure def alwaysSignatureMatchesPrepared(c: Consent): bool = signedPhase(c.phase) implies
  c.signature.wallet == c.walletAccount and (c.chain == W::Solana implies c.signature.signer == c.walletAccount)
    and c.signature.intent == c.intent
    and c.preparedFor == c.walletAccount and c.prepared != ""
pure def alwaysPreparedForConnectedWallet(c: Consent): bool =
  (c.phase == Prepared or c.phase == Signing or signedPhase(c.phase)) implies c.preparedFor == c.walletAccount and c.prepared != ""
pure def alwaysActiveProviderTrusted(c: Consent): bool =
  (c.phase == Connected or c.phase == Replacing or c.phase == Preparing or c.phase == Prepared or c.phase == Signing
    or signedPhase(c.phase)) implies trusted(c, c.selected)
pure def alwaysSignedOutClosed(c: Consent): bool = c.actor == 0 implies c.phase == Closed and c.savedWallet == ""
pure def activePhase(phase: Phase): bool = phase == Connected or phase == Preparing or phase == Prepared or phase == Signing
  or signedPhase(phase)
pure def alwaysDialogConnectsOnlyTheClaim(c: Consent): bool = c.surface == PayoutDialog implies
  (c.claimWallet != "" and ((activePhase(c.phase) or c.phase == Replacing) implies c.walletAccount == c.claimWallet))
pure def stepSavedWalletOnlyFromAcceptedPost(before: Consent, via: str, after: Consent): bool =
  (after.savedWallet != before.savedWallet and after.actor == before.actor) implies via == "postReply"
pure def stepDialogNeverChangesSavedWallet(before: Consent, after: Consent): bool =
  (before.surface == PayoutDialog and after.surface == PayoutDialog and after.actor == before.actor)
    implies after.savedWallet == before.savedWallet
pure def sometimesAccepted(c: Consent): bool = c.phase == Accepted and c.savedWallet != ""
pure def sometimesDialogAccepted(c: Consent): bool = c.surface == PayoutDialog and c.phase == Accepted
pure def sometimesKeptSaved(c: Consent): bool = c.phase == KeptSaved
pure def sometimesDialogRefusesAnotherWallet(c: Consent): bool = c.surface == PayoutDialog and c.phase == Refused
  and c.walletAccount != "" and c.walletAccount != c.claimWallet
pure def sometimesEvmSignatureLeftToTheServer(c: Consent): bool = c.phase == Signed and c.chain != W::Solana
  and c.signature.signer != c.walletAccount
pure def sometimesSignInAgain(c: Consent): bool = c.phase == SignInAgain
pure def sometimesAccountChangeReprepares(c: Consent): bool = c.phase == Connected and c.prepared == "" and c.request > 3
pure def sometimesConflictRefused(c: Consent): bool = c.phase == Refused and c.conflicted.includes(c.selected)
pure def sometimesLegacyConnected(c: Consent): bool = c.phase == Connected and c.legacy.includes(c.selected)
pure def sometimesBytesMismatchRefused(c: Consent): bool = c.phase == Refused and c.prepared == "" and c.walletAccount != ""
pure val accountValues = Set(1, 2)
pure val byValues = Set(1, server, adapter, discovery)
pure val savedWalletValues = Set("", "w1")
pure val claimWalletValues = Set("", "w1")
pure val providerValues = Set(1, 2)
pure val requestValues = Set(2, 3, 4, 5, 6)
pure val walletAddressValues = Set("w1", "w2")
pure val messageValues = Set("m1", "m2")
pure val rebuiltValues = Set("m1")
pure val signedMessageValues = Set("m1", "m2")
pure val intentValues = Set(1)
pure val signatureValues = Set({ wallet: "w2", signer: "w2", intent: 1 }, { wallet: "w2", signer: "w1", intent: 1 },
  { wallet: "w1", signer: "w1", intent: 1 })
pure val weight_openReview = 6
pure val weight_connect = 8
pure val weight_connectReply = 14
pure val weight_prepare = 8
pure val weight_prepareReply = 14
pure val weight_sign = 8
pure val weight_signReply = 16
pure val weight_post = 8
pure val weight_postReply = 14
```
