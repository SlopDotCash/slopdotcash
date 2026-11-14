# Destination wallet binding consent (PAY-05)

PRD sections 3 and 6 ("Service signer boundaries") and CLAUDE.md PAY-05: a
payout destination is bound on chain only with both the authenticated
account (attested by the identity attester) and the destination wallet's own
signature. Neither proof establishes the other. A binding activates
immediately; there is no waiting period. The pinned sources are
`backend/payments/handler.ts` (`/wallets/bind-challenge`,
`/wallets/bind-authorize`, `/wallets/solana-bind/prepare`,
`/wallets/solana-bind/complete`), migration 0016 and the retained
`evm_binding_consent_api`, `binding_consent_renewal`, `solana_binding_api`,
`solana_binding_completion` and `payment_binding` models.

This machine composes one actor's EVM [wallet registration](./wallets.md)
partition, which moves through its own guarded events, and that actor's
Solana partition, held fixed at an authorized claim, with the consent
evidence that names the authorized claim of each. The
attester's own signing, submission, cancellation and finalized-winner
reconciliation are the [signer boundary](../settlement/signer.md); this
machine never signs for the attester, broadcasts or changes payment state.
Time is the wallet registry's trusted clock in milliseconds, compared here
in whole seconds. The deployment list is the reviewed payment deployment
configuration.

The shell verifies signatures. For EVM it builds the EIP-712 typed data
from the request fields and the selected deployment (never a caller chain
ID), recovers the signer and reports it with the signed fields and whether
`s` is in the upper half; a recovery byte of 0 or 1 is stored as 27 or 28.
For Solana it checks the wallet's Ed25519 signature over the exact message
the attester half-signed.

## Story: Consent to bind the authorized payout wallet to a project vault

> As a contributor, I want my payout wallet to sign exactly which vault and
> account it is bound to, and for how long, so that nobody can bind a wallet
> I do not control or reuse my consent elsewhere.

### EVM consent names one registered deployment, the authorized claim and an expected version

The deployment must be exactly one EVM deployment with the requested
network and vault, whose chain and chain ID are the registry's for that
network (only local chain 31337 may be outside the registry). The claim
must be the actor's authorized effective claim on that chain. The expected
version is the one the wallet signed; the challenge may discover it from
the vault, and refuses with `binding_version_unavailable` when it cannot.
The challenge itself stores nothing and always offers a 90-day consent.

```quint
import wallets as W from "./wallets"
type Family = Evm | Svm
type Deployment = { network: str, vault: str, chain: W::WalletChain, chainId: int, family: Family, registered: bool }
type EvmConsentSignature = { signer: str, claim: int, network: str, vault: str, chainId: int,
  version: int, expiresAt: int, highS: bool }
type Consent = { claim: int, network: str, vault: str, chainId: int, version: int, expiresAt: int, signer: str, createdAt: int }
type SolanaStatus = SolanaPrepared | SolanaCompleted | SolanaExpired
type SolanaGeneration = { obligation: int, generation: int, claim: int, transaction: int, status: SolanaStatus }
type SolanaAttempt = { obligation: int, claim: int, open: bool, reserved: bool }
type SolanaWalletSignature = { signer: str, transaction: int }
type Binding = { wallet: W::WalletRegistration, solanaWallet: W::WalletRegistration, deployments: List[Deployment], consents: List[Consent],
  generations: List[SolanaGeneration], lastGeneration: int }
pure val consentLifetime = 90 * 24 * 60 * 60
pure val submissionWindow = 600
pure val expirySlack = 3600
pure val localChainId = 31337
pure def nowSeconds(b: Binding): int = b.wallet.clock / 1000
pure def matchingDeployments(b: Binding, network: str, vault: str): List[Deployment] =
  b.deployments.select(d => d.network == network and d.vault == vault and d.family == Evm and d.chain == b.wallet.chain
    and (d.registered or d.chainId == localChainId))
pure def deploymentFor(b: Binding, network: str, vault: str): Deployment =
  matchingDeployments(b, network, vault).nthOr(0, { network: "", vault: "", chain: W::Base, chainId: 0, family: Svm, registered: false })
pure def authorizedClaim(b: Binding): int = W::activeAuthorization(b.wallet).claim
pure def claimWallet(b: Binding, claim: int): str = W::claimAt(b.wallet, claim).wallet
pure def evmChain(b: Binding): bool = b.wallet.chain != W::Solana
type ChallengeOutcome = ChallengeOffered | UnknownDeployment | ClaimNotCurrent | BindingVersionUnavailable
pure def challengeOutcome(b: Binding, claim: int, network: str, vault: str, discoveredVersion: int): ChallengeOutcome =
  if (not(evmChain(b)) or matchingDeployments(b, network, vault).length() != 1) UnknownDeployment
  else if (claim <= 0 or claim != authorizedClaim(b)) ClaimNotCurrent
  else if (discoveredVersion < 0) BindingVersionUnavailable
  else ChallengeOffered
pure def offeredExpiry(b: Binding): int = nowSeconds(b) + consentLifetime
pure def lawChallengeOffersNinetyDays(b: Binding): bool = offeredExpiry(b) - nowSeconds(b) == consentLifetime
```

### Authorization stores a consent the attester can still submit and never edits an earlier one

The request carries the signed fields and the signature; the shell's
recovery reports the signer of exactly those fields. The signed expiry must leave the attester more than the 600-second
submission window and may not exceed the 90-day lifetime plus one hour of
clock slack. The recovered signer must be the claim's wallet, the signed
fields must be the request's, and an upper-half `s` is refused. Each
distinct (claim, network, vault, chain ID, version, expiry) is its own
append-only row; a repeated signature over the same fields keeps the first
row, and a renewal with a new expiry adds a row.

```quint
pure def canBindAuthorize(b: Binding, by: str, signature: EvmConsentSignature): bool =
  val d = deploymentFor(b, signature.network, signature.vault)
  by == b.wallet.actor and challengeOutcome(b, signature.claim, signature.network, signature.vault, signature.version) == ChallengeOffered
    and signature.expiresAt > nowSeconds(b) + submissionWindow
    and signature.expiresAt <= nowSeconds(b) + consentLifetime + expirySlack
    and not(signature.highS) and signature.signer != "" and signature.signer == claimWallet(b, signature.claim)
    and signature.chainId == d.chainId
pure def sameKey(c: Consent, claim: int, network: str, vault: str, chainId: int, version: int, expiresAt: int): bool =
  c.claim == claim and c.network == network and c.vault == vault and c.chainId == chainId
    and c.version == version and c.expiresAt == expiresAt
pure def bindAuthorize(b: Binding, by: str, signature: EvmConsentSignature): Binding =
  if (b.consents.some(c => sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId,
    signature.version, signature.expiresAt))) b
  else { ...b, consents: b.consents.append({ claim: signature.claim, network: signature.network, vault: signature.vault,
    chainId: signature.chainId, version: signature.version, expiresAt: signature.expiresAt, signer: signature.signer,
    createdAt: nowSeconds(b) }) }
pure def alwaysConsentsVerified(b: Binding): bool = b.consents.every(c =>
  c.claim > 0 and c.claim <= b.wallet.claims.length() and c.signer == claimWallet(b, c.claim)
    and c.expiresAt > c.createdAt + submissionWindow and c.expiresAt <= c.createdAt + consentLifetime + expirySlack
    and W::alreadyAuthorized(b.wallet, c.claim)
    and b.consents.select(o => sameKey(o, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt)).length() == 1)
pure def stepConsentsAppendOnly(before: Binding, after: Binding): bool = before.consents.every(c => after.consents.includes(c))
```

### Execution may use only the latest unexpired consent for the current claim and version

The executor selects, for the vault's current binding version, the consent
with the latest expiry that still leaves the submission window, and only
for the claim that is authorized now. A consent for a replaced claim, an
expired consent and a consent for another version are never usable. A
consent is usable from the moment it is stored: there is no delay.

```quint
pure def usable(b: Binding, c: Consent, network: str, vault: str, version: int): bool =
  c.claim == authorizedClaim(b) and c.network == network and c.vault == vault and c.version == version
    and c.expiresAt > nowSeconds(b) + submissionWindow
pure def usableExpiry(b: Binding, network: str, vault: str, version: int): int =
  b.consents.foldl(0, (best, c) => if (usable(b, c, network, vault, version) and c.expiresAt > best) c.expiresAt else best)
pure def lawReplacedClaimCannotBind(b: Binding, c: Consent, network: str, vault: str, version: int): bool =
  c.claim != authorizedClaim(b) implies not(usable(b, c, network, vault, version))
pure def lawStoredConsentUsableImmediately(b: Binding, by: str, signature: EvmConsentSignature): bool =
  canBindAuthorize(b, by, signature) implies
    usableExpiry(bindAuthorize(b, by, signature), signature.network, signature.vault, signature.version) >= signature.expiresAt
```

### A Solana binding is one half-signed transaction per generation that only the wallet slot completes

For a reserved Solana obligation with an open payout attempt on the
authorized claim, the attester prepares and half-signs one transaction. The
first authority signature fixes the transaction identity; a repeated
prepare of a live generation returns the same bytes. Completion only fills
the wallet's slot of that exact transaction, compare-and-set on its
generation; a second completion of the same generation is refused and the
first full transaction is kept. After the generation's finalized expiry, a
new generation with new bytes may be prepared; earlier bytes are retained.
Submission and on-chain outcome are the signer's and settlement's; the
expiry event is supplied only from finalized-height evidence that the
generation's instruction expired.

```quint
pure def liveGeneration(b: Binding, obligation: int): SolanaGeneration =
  b.generations.select(g => g.obligation == obligation and g.status != SolanaExpired)
    .nthOr(0, { obligation: 0, generation: 0, claim: 0, transaction: 0, status: SolanaExpired })
pure def canSolanaPrepare(b: Binding, by: str, attempt: SolanaAttempt): bool =
  by == b.solanaWallet.actor and b.solanaWallet.chain == W::Solana and attempt.obligation > 0 and attempt.reserved and attempt.open
    and attempt.claim > 0 and attempt.claim == W::activeAuthorization(b.solanaWallet).claim and liveGeneration(b, attempt.obligation).generation == 0
pure def solanaPrepare(b: Binding, by: str, attempt: SolanaAttempt): Binding =
  { ...b, lastGeneration: b.lastGeneration + 1, generations: b.generations.append({ obligation: attempt.obligation,
    generation: b.lastGeneration + 1, claim: attempt.claim, transaction: b.lastGeneration + 1, status: SolanaPrepared }) }
pure def canSolanaComplete(b: Binding, by: str, obligation: int, generation: int, walletSignature: SolanaWalletSignature): bool =
  val g = liveGeneration(b, obligation)
  by == b.solanaWallet.actor and g.generation > 0 and g.generation == generation and g.status == SolanaPrepared
    and g.claim == W::activeAuthorization(b.solanaWallet).claim and walletSignature.transaction == g.transaction
    and walletSignature.signer != "" and walletSignature.signer == W::claimAt(b.solanaWallet, g.claim).wallet
pure def solanaComplete(b: Binding, by: str, obligation: int, generation: int, walletSignature: SolanaWalletSignature): Binding =
  { ...b, generations: b.generations.listMap(g => if (g.generation == generation) { ...g, status: SolanaCompleted } else g) }
pure def canSolanaExpire(b: Binding, obligation: int, generation: int): bool =
  liveGeneration(b, obligation).generation == generation and generation > 0
pure def solanaExpire(b: Binding, obligation: int, generation: int): Binding =
  { ...b, generations: b.generations.listMap(g => if (g.generation == generation) { ...g, status: SolanaExpired } else g) }
pure def alwaysOneLiveGeneration(b: Binding): bool = b.generations.every(g =>
  g.generation > 0 and g.generation <= b.lastGeneration and g.transaction == g.generation and g.claim > 0
    and b.generations.select(o => o.generation == g.generation).length() == 1
    and (g.status != SolanaExpired implies
      b.generations.select(o => o.obligation == g.obligation and o.status != SolanaExpired).length() == 1))
pure def stepGenerationIdentityFixed(before: Binding, after: Binding): bool = before.generations.every(g =>
  after.generations.some(h => h.generation == g.generation and h.obligation == g.obligation and h.claim == g.claim
    and h.transaction == g.transaction
    and (g.status == SolanaCompleted implies h.status != SolanaPrepared)
    and (g.status == SolanaExpired implies h.status == SolanaExpired)))
```

### The wallet registry moves underneath through its own guarded events

These events forward to the wallet registry unchanged, so the consent rules
above are checked against every authorization, replacement and recovery.

```quint
pure def canObserveTime(b: Binding, timestamp: int): bool = W::canObserveTime(b.wallet, timestamp)
pure def observeTime(b: Binding, timestamp: int): Binding = { ...b, wallet: W::observeTime(b.wallet, timestamp) }
pure def canRegister(b: Binding, registration: W::Registration, by: str): bool = W::canRegister(b.wallet, registration, by)
pure def register(b: Binding, registration: W::Registration, by: str): Binding = { ...b, wallet: W::register(b.wallet, registration, by) }
pure def canIssue(b: Binding, claim: int, challengeId: int, messageDigest: str, by: str): bool =
  W::canIssue(b.wallet, claim, challengeId, messageDigest, by)
pure def issue(b: Binding, claim: int, challengeId: int, messageDigest: str, by: str): Binding =
  { ...b, wallet: W::issue(b.wallet, claim, challengeId, messageDigest, by) }
pure def canReadProof(b: Binding, proof: W::PossessionEvidence, by: str): bool = W::canReadProof(b.wallet, proof, by)
pure def readProof(b: Binding, proof: W::PossessionEvidence, by: str): Binding = { ...b, wallet: W::readProof(b.wallet, proof, by) }
pure def canConsume(b: Binding, requestId: int): bool = W::canConsume(b.wallet, requestId)
pure def consume(b: Binding, requestId: int): Binding = { ...b, wallet: W::consume(b.wallet, requestId) }
pure def canCommitAuthorization(b: Binding, requestId: int, storageSucceeded: bool): bool =
  W::canCommitAuthorization(b.wallet, requestId, storageSucceeded)
pure def commitAuthorization(b: Binding, requestId: int, storageSucceeded: bool): Binding =
  { ...b, wallet: W::commitAuthorization(b.wallet, requestId, storageSucceeded) }
pure def stepSolanaPartitionFixed(before: Binding, after: Binding): bool = after.solanaWallet == before.solanaWallet
pure def alwaysSolanaPartitionAuthorized(b: Binding): bool =
  b.solanaWallet.chain == W::Solana and W::activeAuthorization(b.solanaWallet).claim > 0 and b.solanaWallet.actor == b.wallet.actor
pure def alwaysWalletValid(b: Binding): bool = W::alwaysPartitionValid(b.wallet) and W::alwaysPredecessors(b.wallet)
  and W::alwaysClaimsAdmitted(b.wallet) and W::alwaysAuthorizationAdmitted(b.wallet) and W::alwaysOneAuthorization(b.wallet)
  and W::alwaysAuthorizationIncreases(b.wallet) and W::alwaysOneConsumption(b.wallet) and W::alwaysOperatorsAreNotTheActor(b.wallet)
```

### Renewal, replacement, expiry and Solana completion are reachable

The launch sample starts with claim 1 authorized on Base (EVM, moving) and
on Solana (held fixed). The deployment list and the samples bound
simulation only. Clock values are milliseconds.

```quint
pure def authorizedSample(chain: W::WalletChain, wallet: str): W::WalletRegistration =
  val registered = W::register(W::selectChain(W::initial, chain), { wallet: wallet, digest: "digest-a", predecessor: 0, addressVerified: true }, "1")
  val issued = W::issue(registered, 1, 1, "message-a", "1")
  val read = W::readProof(issued, { requestId: 1, challengeId: 1, claim: 1, signerWallet: wallet, messageDigest: "message-a",
    signatureVerified: true }, "1")
  W::commitAuthorization(W::consume(read, 1), 1, true)
pure val initial: Binding = { wallet: authorizedSample(W::Base, "wallet-a"), solanaWallet: authorizedSample(W::Solana, "wallet-s"), consents: List(), generations: List(), lastGeneration: 0,
  deployments: List({ network: "base", vault: "vault-a", chain: W::Base, chainId: 8453, family: Evm, registered: true },
    { network: "base", vault: "vault-b", chain: W::Base, chainId: 8453, family: Evm, registered: true },
    { network: "base", vault: "vault-b", chain: W::Base, chainId: 84532, family: Evm, registered: true },
    { network: "robinhood", vault: "vault-a", chain: W::Robinhood, chainId: 4663, family: Evm, registered: true }) }
pure def sometimesConsentStored(b: Binding): bool = b.consents.length() > 0
pure def sometimesRenewed(b: Binding): bool = b.consents.select(c => c.claim == authorizedClaim(b)).length() >= 2
pure def sometimesConsentForReplacedClaim(b: Binding): bool = b.consents.some(c => c.claim != authorizedClaim(b))
pure def sometimesSolanaCompleted(b: Binding): bool = b.generations.some(g => g.status == SolanaCompleted)
pure def sometimesSolanaRegenerated(b: Binding): bool = b.generations.some(g => g.status == SolanaExpired) and b.lastGeneration >= 2
pure val byValues = Set("1", "other")
pure val vaultValues = Set("vault-a", "vault-b")
pure val discoveredVersionValues = Set(-1, 0)
pure val signatureValues = Set(
  { signer: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, highS: false },
  { signer: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7779601, highS: false },
  { signer: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, highS: true },
  { signer: "wallet-b", claim: 2, network: "base", vault: "vault-a", chainId: 8453, version: 1, expiresAt: 7777601, highS: false },
  { signer: "wallet-b", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, highS: false },
  { signer: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 601, highS: false },
  { signer: "wallet-a", claim: 1, network: "base", vault: "vault-b", chainId: 8453, version: 0, expiresAt: 7777601, highS: false })
pure val attemptValues = Set({ obligation: 1, claim: 1, open: true, reserved: true },
  { obligation: 1, claim: 2, open: true, reserved: true }, { obligation: 1, claim: 1, open: false, reserved: true },
  { obligation: 2, claim: 1, open: true, reserved: false })
pure val walletSignatureValues = Set({ signer: "wallet-s", transaction: 1 }, { signer: "wallet-s", transaction: 2 },
  { signer: "wallet-a", transaction: 2 }, { signer: "wallet-x", transaction: 1 })
pure val generationValues = Set(1, 2)
pure val obligationValues = Set(1)
pure val cValues = Set({ claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, signer: "wallet-a", createdAt: 0 })
pure val bValues = Set(initial)
pure val weight_bindAuthorize = 12
pure val weight_register = 8
pure val weight_issue = 8
pure val weight_readProof = 8
pure val weight_consume = 8
pure val weight_commitAuthorization = 8
pure val weight_solanaPrepare = 10
pure val weight_solanaComplete = 10
```
