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

This machine composes one actor's EVM and Solana [wallet registration](./wallets.md)
partitions, each moving through its own guarded events, with the consent
evidence that names the authorized claim of each. The attester's own
signing, submission, cancellation and finalized-winner reconciliation are
the [signer boundary](../settlement/signer.md); this machine never signs for
the attester, broadcasts or changes payment state. Time is each wallet
registry's trusted clock in milliseconds, compared here in whole seconds.
The deployment list is the reviewed payment deployment configuration.

The authenticated sender `by` is the account actor the shell resolved from
the session, or one of two service senders the shell established from a
signed internal request: `settlementService`, the payment service that
reports each obligation's reservation and open attempt, and `solanaScanner`,
the finalized-height reader of the Solana network. Payment readiness is
never taken from the contributor's request.

Signatures are verified by the shell inside the request, over bytes this
model fixes. For EVM it builds the EIP-712 typed data from the request's
claim, network, vault, version and expiry and the selected deployment's chain
ID (never a caller chain ID), and reports the address it recovers and
whether `s` is in the upper half; a recovery byte of 0 or 1 is stored as 27
or 28. For Solana it verifies the wallet's Ed25519 signature over the exact
transaction the attester half-signed and reports the address it verifies
under, or empty. These are verifier outputs, not request fields; opaque
functions are not used because a spec that declares one cannot be imported,
and the wallet registry is imported here.

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
The challenge itself stores nothing and offers a 90-day consent, which
authorization accepts while the challenge's claim is still current.

```quint
import wallets as W from "./wallets"
type Family = Evm | Svm
type Deployment = { network: str, vault: str, chain: W::WalletChain, chainId: int, family: Family, registered: bool,
  solanaContext: bool }
type EvmConsentSignature = { recoveredSigner: str, claim: int, network: str, vault: str, chainId: int,
  version: int, expiresAt: int, upperHalfS: bool }
type Consent = { claim: int, network: str, vault: str, chainId: int, version: int, expiresAt: int, signer: str, createdAt: int }
type SolanaStatus = SolanaPrepared | SolanaCompleted | SolanaExpired
type SolanaGeneration = { obligation: int, generation: int, claim: int, transaction: int, status: SolanaStatus,
  expiryHeight: int, privateCase: int }
type PaymentEvidence = { obligation: int, owner: str, network: str, vault: str, reserved: bool,
  attemptClaim: int, attemptOpen: bool, privateCase: int, outboxReady: bool }
type CaseAccess = { privateCase: int, actor: str }
type SolanaWalletSignature = { recoveredSigner: str, transaction: int }
type Binding = { wallet: W::WalletRegistration, solanaWallet: W::WalletRegistration, deployments: List[Deployment],
  consents: List[Consent], generations: List[SolanaGeneration], lastGeneration: int,
  payments: List[PaymentEvidence], finalizedHeight: int, caseAccessLog: List[CaseAccess] }
pure val consentLifetime = 90 * 24 * 60 * 60
pure val submissionWindow = 600
pure val expirySlack = 3600
pure val localChainId = 31337
pure val blockhashValidity = 150
pure val settlementService = "settlement"
pure val solanaScanner = "scanner"
pure def nowSeconds(b: Binding): int = b.wallet.clock / 1000
pure def matchingDeployments(b: Binding, network: str, vault: str): List[Deployment] =
  b.deployments.select(d => d.network == network and d.vault == vault and d.family == Evm and d.chain == b.wallet.chain
    and (d.registered or d.chainId == localChainId))
pure def deploymentFor(b: Binding, network: str, vault: str): Deployment =
  matchingDeployments(b, network, vault).nthOr(0, { network: "", vault: "", chain: W::Base, chainId: 0, family: Svm,
    registered: false, solanaContext: false })
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
    and not(signature.upperHalfS) and signature.recoveredSigner != "" and signature.recoveredSigner == claimWallet(b, signature.claim)
    and signature.chainId == d.chainId
pure def sameKey(c: Consent, claim: int, network: str, vault: str, chainId: int, version: int, expiresAt: int): bool =
  c.claim == claim and c.network == network and c.vault == vault and c.chainId == chainId
    and c.version == version and c.expiresAt == expiresAt
pure def bindAuthorize(b: Binding, by: str, signature: EvmConsentSignature): Binding =
  if (b.consents.some(c => sameKey(c, signature.claim, signature.network, signature.vault, signature.chainId,
    signature.version, signature.expiresAt))) b
  else { ...b, consents: b.consents.append({ claim: signature.claim, network: signature.network, vault: signature.vault,
    chainId: signature.chainId, version: signature.version, expiresAt: signature.expiresAt, signer: signature.recoveredSigner,
    createdAt: nowSeconds(b) }) }
pure def alwaysConsentsVerified(b: Binding): bool = b.consents.every(c =>
  c.claim > 0 and c.claim <= b.wallet.claims.length() and c.signer == claimWallet(b, c.claim)
    and c.expiresAt > c.createdAt + submissionWindow and c.expiresAt <= c.createdAt + consentLifetime + expirySlack
    and W::alreadyAuthorized(b.wallet, c.claim)
    and b.consents.select(o => sameKey(o, c.claim, c.network, c.vault, c.chainId, c.version, c.expiresAt)).length() == 1)
pure def stepConsentsAppendOnly(before: Binding, after: Binding): bool = before.consents.every(c => after.consents.includes(c))
pure def lawOfferedConsentIsAccepted(b: Binding, by: str, signature: EvmConsentSignature): bool =
  (by == b.wallet.actor and challengeOutcome(b, signature.claim, signature.network, signature.vault, signature.version) == ChallengeOffered
    and signature.expiresAt == offeredExpiry(b) and not(signature.upperHalfS)
    and signature.recoveredSigner == claimWallet(b, signature.claim) and signature.recoveredSigner != ""
    and signature.chainId == deploymentFor(b, signature.network, signature.vault).chainId)
    implies canBindAuthorize(b, by, signature)
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
  canBindAuthorize(b, by, signature) implies bindAuthorize(b, by, signature).consents.some(c =>
    usable(bindAuthorize(b, by, signature), c, signature.network, signature.vault, signature.version)
      and c.expiresAt == signature.expiresAt)
```

### A Solana binding is one half-signed transaction per generation that only the wallet slot completes

The settlement service reports, for each obligation, its owner, network and
vault, whether it is still reserved, the claim of its open payout attempt
(prepared, unknown or submitted) and, for a private security settlement, the
case whose reporter owns it. These identities never change once reported,
and a released reservation never returns. A prepare needs that evidence:
the obligation is the requester's, reserved, with an open attempt on the
requester's currently authorized Solana claim, which the admission below
opens when the obligation has none (otherwise `binding_not_ready`), and exactly one Solana deployment for its network and
vault with a program ID, project account and network domain (otherwise
`binding_deployment_unavailable`). The attester then half-signs one
transaction whose blockhash stays valid for 150 blocks after the finalized
height. The first authority signature fixes the transaction identity; a
repeated prepare of a live generation returns the same bytes and changes
nothing. Completion rechecks the same evidence and only fills the wallet's
slot of that exact transaction, compare-and-set on its generation; a second
completion of the same generation is refused and the first full transaction
is kept. A generation whose claim was replaced cannot complete; it stays
live until it expires. Only the scanner's finalized height past the
generation's last valid height, while the obligation is still reserved,
expires it; then a new generation with new bytes may be prepared, and
earlier bytes are retained. Submission and on-chain outcome are the
signer's and settlement's.

A private security settlement uses the security attester. Every request by
the case's reporter for it, prepare, complete or refused, first appends a
reporter `write` row to that case's access log.

```quint
pure val absentPayment: PaymentEvidence = { obligation: 0, owner: "", network: "", vault: "", reserved: false,
  attemptClaim: 0, attemptOpen: false, privateCase: 0, outboxReady: false }
pure def paymentFor(b: Binding, obligation: int): PaymentEvidence =
  b.payments.select(p => p.obligation == obligation).nthOr(0, absentPayment)
pure def canObservePayment(b: Binding, by: str, evidence: PaymentEvidence): bool =
  val prior = paymentFor(b, evidence.obligation)
  by == settlementService and evidence.obligation > 0 and evidence.owner != ""
    and (prior.obligation > 0 implies (prior.owner == evidence.owner and prior.network == evidence.network
      and prior.vault == evidence.vault and prior.privateCase == evidence.privateCase
      and (not(prior.reserved) implies not(evidence.reserved))))
pure def observePayment(b: Binding, by: str, evidence: PaymentEvidence): Binding =
  { ...b, payments: b.payments.select(p => p.obligation != evidence.obligation).append(evidence) }
pure def canObserveHeight(b: Binding, by: str, height: int): bool = by == solanaScanner and height > b.finalizedHeight
pure def observeHeight(b: Binding, by: str, height: int): Binding = { ...b, finalizedHeight: height }
pure def solanaClaim(b: Binding): int = W::activeAuthorization(b.solanaWallet).claim
pure def solanaReady(b: Binding, by: str, obligation: int): bool =
  val p = paymentFor(b, obligation)
  by == b.solanaWallet.actor and obligation > 0 and p.obligation == obligation and p.owner == by and p.reserved
    and p.attemptOpen and p.attemptClaim > 0 and p.attemptClaim == solanaClaim(b)
pure def solanaDeploymentReady(b: Binding, obligation: int): bool =
  val p = paymentFor(b, obligation)
  b.deployments.select(d => d.family == Svm and d.chain == W::Solana and d.network == p.network and d.vault == p.vault).length() == 1
    and b.deployments.select(d => d.family == Svm and d.chain == W::Solana and d.network == p.network and d.vault == p.vault)
      .every(d => d.solanaContext)
pure def logged(b: Binding, by: str, obligation: int): List[CaseAccess] =
  val p = paymentFor(b, obligation)
  if (p.privateCase > 0 and p.owner == by) b.caseAccessLog.append({ privateCase: p.privateCase, actor: by }) else b.caseAccessLog
pure def liveGeneration(b: Binding, obligation: int): SolanaGeneration =
  b.generations.select(g => g.obligation == obligation and g.status != SolanaExpired)
    .nthOr(0, { obligation: 0, generation: 0, claim: 0, transaction: 0, status: SolanaExpired, expiryHeight: 0, privateCase: 0 })
pure def canSolanaPrepare(b: Binding, by: str, obligation: int): bool =
  solanaReady(b, by, obligation) and solanaDeploymentReady(b, obligation) and liveGeneration(b, obligation).generation == 0
pure def solanaPrepare(b: Binding, by: str, obligation: int): Binding =
  { ...b, lastGeneration: b.lastGeneration + 1, caseAccessLog: logged(b, by, obligation),
    generations: b.generations.append({ obligation: obligation, generation: b.lastGeneration + 1, claim: solanaClaim(b),
      transaction: b.lastGeneration + 1, status: SolanaPrepared, expiryHeight: b.finalizedHeight + blockhashValidity,
      privateCase: paymentFor(b, obligation).privateCase }) }
pure def canSolanaComplete(b: Binding, by: str, obligation: int, generation: int, walletSignature: SolanaWalletSignature): bool =
  val g = liveGeneration(b, obligation)
  solanaReady(b, by, obligation) and g.generation > 0 and g.generation == generation and g.status == SolanaPrepared
    and g.claim == solanaClaim(b) and walletSignature.transaction == g.transaction
    and walletSignature.recoveredSigner != "" and walletSignature.recoveredSigner == W::claimAt(b.solanaWallet, g.claim).wallet
pure def solanaComplete(b: Binding, by: str, obligation: int, generation: int, walletSignature: SolanaWalletSignature): Binding =
  { ...b, caseAccessLog: logged(b, by, obligation),
    generations: b.generations.listMap(g => if (g.generation == generation) { ...g, status: SolanaCompleted } else g) }
pure def canSolanaRefused(b: Binding, by: str, obligation: int): bool =
  paymentFor(b, obligation).privateCase > 0 and paymentFor(b, obligation).owner == by
pure def solanaRefused(b: Binding, by: str, obligation: int): Binding = { ...b, caseAccessLog: logged(b, by, obligation) }
pure def canSolanaExpire(b: Binding, by: str, obligation: int, generation: int): bool =
  val g = liveGeneration(b, obligation)
  by == solanaScanner and g.generation > 0 and g.generation == generation and b.finalizedHeight > g.expiryHeight
    and paymentFor(b, obligation).reserved
pure def solanaExpire(b: Binding, by: str, obligation: int, generation: int): Binding =
  { ...b, generations: b.generations.listMap(g => if (g.generation == generation) { ...g, status: SolanaExpired } else g) }
pure def alwaysOneLiveGeneration(b: Binding): bool = b.generations.every(g =>
  g.generation > 0 and g.generation <= b.lastGeneration and g.transaction == g.generation and g.claim > 0
    and g.claim <= b.solanaWallet.claims.length() and W::alreadyAuthorized(b.solanaWallet, g.claim)
    and g.expiryHeight > 0 and (g.status == SolanaExpired implies b.finalizedHeight > g.expiryHeight)
    and paymentFor(b, g.obligation).obligation == g.obligation and paymentFor(b, g.obligation).privateCase == g.privateCase
    and b.generations.select(o => o.generation == g.generation).length() == 1
    and (g.status != SolanaExpired implies
      b.generations.select(o => o.obligation == g.obligation and o.status != SolanaExpired).length() == 1))
pure def alwaysPrivateGenerationsLogged(b: Binding): bool =
  b.generations.every(g => g.privateCase > 0 implies b.caseAccessLog.some(a => a.privateCase == g.privateCase
    and a.actor == paymentFor(b, g.obligation).owner))
    and b.caseAccessLog.every(a => a.privateCase > 0 and b.payments.some(p => p.privateCase == a.privateCase and p.owner == a.actor))
pure def alwaysPaymentsKeyed(b: Binding): bool = b.finalizedHeight >= 0 and b.payments.every(p => p.obligation > 0 and p.owner != ""
  and b.payments.select(o => o.obligation == p.obligation).length() == 1)
pure def stepGenerationIdentityFixed(before: Binding, after: Binding): bool = before.generations.every(g =>
  after.generations.some(h => h.generation == g.generation and h.obligation == g.obligation and h.claim == g.claim
    and h.transaction == g.transaction and h.expiryHeight == g.expiryHeight and h.privateCase == g.privateCase
    and (g.status == SolanaCompleted implies h.status != SolanaPrepared)
    and (g.status == SolanaExpired implies h.status == SolanaExpired)))
pure def stepEvidenceIdentityFixed(before: Binding, after: Binding): bool =
  before.payments.every(p => after.payments.some(q => q.obligation == p.obligation and q.owner == p.owner
    and q.network == p.network and q.vault == p.vault and q.privateCase == p.privateCase and (not(p.reserved) implies not(q.reserved))))
    and before.finalizedHeight <= after.finalizedHeight and before.caseAccessLog.every(a => after.caseAccessLog.includes(a))
    and before.caseAccessLog.length() <= after.caseAccessLog.length()
pure def lawReplacedClaimGenerationCannotComplete(b: Binding, by: str, obligation: int, generation: int,
  walletSignature: SolanaWalletSignature): bool =
  liveGeneration(b, obligation).claim != solanaClaim(b) implies not(canSolanaComplete(b, by, obligation, generation, walletSignature))
```

### A Solana prepare opens the obligation's first attempt for the current claim under a ready outbox

Mainnet has no hosted payment dispatcher, so a prepare may itself open the
obligation's first payout attempt (Slop development `c1439dc0d`,
`backend/payments/handler.ts:1134–1175`, `backend/payments/README.md:42–50`).
The attempt itself is the settlement dispatch's `prepareBinding`, whose rule
is [payment dispatch](../settlement/paymentDispatch.md), "A Solana binding
prepare creates the first attempt for the current claim only while the
outbox is ready"; this rule states only the requester's side of it: the
settlement service reports the attempt its prepareBinding opened for the
requester's request, and only then does the prepare above proceed. Before
the prepare above, the request is admitted for the requester's currently
authorized Solana registry claim only when the obligation is the
requester's, on a Solana network, still reserved, its outbox is ready and
it has no open attempt; the prepare is then refused as `binding_not_ready` unless the open
attempt is of that claim. Completion never opens an attempt. A security
settlement's reporter is held to the same admission, and the request is
logged once, by its prepare or its refusal. Whether the outbox is ready is
the settlement service's report, never the requester's.

```quint
pure def canSolanaAdmitAttempt(b: Binding, by: str, obligation: int): bool =
  val p = paymentFor(b, obligation)
  by == settlementService and obligation > 0 and p.obligation == obligation and p.owner == b.solanaWallet.actor and p.reserved
    and p.outboxReady and not(p.attemptOpen) and solanaClaim(b) > 0
    and b.deployments.some(d => d.family == Svm and d.chain == W::Solana and d.network == p.network)
pure def solanaAdmitAttempt(b: Binding, by: str, obligation: int): Binding =
  { ...b, payments: b.payments.select(p => p.obligation != obligation)
    .append({ ...paymentFor(b, obligation), attemptOpen: true, attemptClaim: solanaClaim(b) }) }
pure def lawAdmissionOpensOnlyForTheCurrentClaim(b: Binding, by: str, obligation: int): bool =
  canSolanaAdmitAttempt(b, by, obligation) implies
    (paymentFor(solanaAdmitAttempt(b, by, obligation), obligation).attemptClaim == solanaClaim(b)
     and paymentFor(solanaAdmitAttempt(b, by, obligation), obligation).attemptOpen
     and solanaAdmitAttempt(b, by, obligation).generations == b.generations)
pure def lawCompletionOpensNoAttempt(b: Binding, by: str, obligation: int, generation: int, walletSignature: SolanaWalletSignature): bool =
  solanaComplete(b, by, obligation, generation, walletSignature).payments == b.payments
pure def lawEarlierClaimAttemptKeepsObligation(b: Binding, by: str, obligation: int): bool =
  (paymentFor(b, obligation).attemptOpen and paymentFor(b, obligation).attemptClaim != solanaClaim(b)) implies
    (not(canSolanaAdmitAttempt(b, by, obligation)) and not(canSolanaPrepare(b, by, obligation)))
pure def lawAdmittedAttemptIsPreparable(b: Binding, by: str, obligation: int): bool =
  canSolanaAdmitAttempt(b, by, obligation) implies
    solanaReady(solanaAdmitAttempt(b, by, obligation), b.solanaWallet.actor, obligation)
pure def sometimesPrepareOpenedFirstAttempt(b: Binding): bool =
  b.generations.some(g => g.obligation == 4 and g.status != SolanaExpired)
pure def sometimesPrivateAttemptAdmitted(b: Binding): bool =
  b.payments.some(p => p.obligation == 5 and p.attemptOpen)
pure val weight_solanaAdmitAttempt = 8
```

### The wallet registries move underneath through their own guarded events

These events forward to the EVM and Solana wallet registries unchanged, so
the consent and generation rules above are checked against every
authorization, replacement and operator recovery of either partition,
including a Solana destination change while a generation is prepared.

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
pure def canSolanaRegister(b: Binding, registration: W::Registration, by: str): bool = W::canRegister(b.solanaWallet, registration, by)
pure def solanaRegister(b: Binding, registration: W::Registration, by: str): Binding =
  { ...b, solanaWallet: W::register(b.solanaWallet, registration, by) }
pure def canSolanaOperatorClaim(b: Binding, by: str, request: W::OperatorClaim): bool = W::canOperatorClaim(b.solanaWallet, by, request)
pure def solanaOperatorClaim(b: Binding, by: str, request: W::OperatorClaim): Binding =
  { ...b, solanaWallet: W::operatorClaim(b.solanaWallet, by, request) }
pure def canSolanaIssue(b: Binding, claim: int, challengeId: int, messageDigest: str, by: str): bool =
  W::canIssue(b.solanaWallet, claim, challengeId, messageDigest, by)
pure def solanaIssue(b: Binding, claim: int, challengeId: int, messageDigest: str, by: str): Binding =
  { ...b, solanaWallet: W::issue(b.solanaWallet, claim, challengeId, messageDigest, by) }
pure def canSolanaReadProof(b: Binding, proof: W::PossessionEvidence, by: str): bool = W::canReadProof(b.solanaWallet, proof, by)
pure def solanaReadProof(b: Binding, proof: W::PossessionEvidence, by: str): Binding =
  { ...b, solanaWallet: W::readProof(b.solanaWallet, proof, by) }
pure def canSolanaConsume(b: Binding, requestId: int): bool = W::canConsume(b.solanaWallet, requestId)
pure def solanaConsume(b: Binding, requestId: int): Binding = { ...b, solanaWallet: W::consume(b.solanaWallet, requestId) }
pure def canSolanaCommitAuthorization(b: Binding, requestId: int, storageSucceeded: bool): bool =
  W::canCommitAuthorization(b.solanaWallet, requestId, storageSucceeded)
pure def solanaCommitAuthorization(b: Binding, requestId: int, storageSucceeded: bool): Binding =
  { ...b, solanaWallet: W::commitAuthorization(b.solanaWallet, requestId, storageSucceeded) }
pure def alwaysSolanaPartitionAuthorized(b: Binding): bool =
  b.solanaWallet.chain == W::Solana and solanaClaim(b) > 0 and b.solanaWallet.actor == b.wallet.actor and evmChain(b)
pure def partitionValid(w: W::WalletRegistration): bool = W::alwaysPartitionValid(w) and W::alwaysPredecessors(w)
  and W::alwaysClaimsAdmitted(w) and W::alwaysAuthorizationAdmitted(w) and W::alwaysOneAuthorization(w)
  and W::alwaysAuthorizationIncreases(w) and W::alwaysOneConsumption(w)
pure def alwaysWalletValid(b: Binding): bool = partitionValid(b.wallet) and partitionValid(b.solanaWallet)
```

### Renewal, replacement, expiry, private completion and a replaced Solana claim are reachable

The launch sample starts with claim 1 authorized on Base and on Solana, and
the settlement service's report of one public and one private reserved
Solana obligation with open attempts on that claim. The deployment list and
the samples bound simulation only. Clock values are milliseconds.

```quint
pure def authorizedSample(chain: W::WalletChain, wallet: str): W::WalletRegistration =
  val registered = W::register(W::selectChain(W::initial, chain), { wallet: wallet, digest: "digest-a", predecessor: 0 }, "1")
  val issued = W::issue(registered, 1, 1, "message-a", "1")
  val read = W::readProof(issued, { requestId: 1, challengeId: 1, claim: 1, recoveredSigner: wallet, messageDigest: "message-a" }, "1")
  W::commitAuthorization(W::consume(read, 1), 1, true)
pure val initial: Binding = { wallet: authorizedSample(W::Base, "wallet-a"), solanaWallet: authorizedSample(W::Solana, "wallet-s"),
  consents: List(), generations: List(), lastGeneration: 0, finalizedHeight: 1000, caseAccessLog: List(),
  payments: List({ obligation: 1, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 1,
      attemptOpen: true, privateCase: 0, outboxReady: true },
    { obligation: 2, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 1,
      attemptOpen: true, privateCase: 5, outboxReady: true }),
  deployments: List({ network: "base", vault: "vault-a", chain: W::Base, chainId: 8453, family: Evm, registered: true, solanaContext: false },
    { network: "base", vault: "vault-b", chain: W::Base, chainId: 8453, family: Evm, registered: true, solanaContext: false },
    { network: "base", vault: "vault-b", chain: W::Base, chainId: 84532, family: Evm, registered: true, solanaContext: false },
    { network: "robinhood", vault: "vault-a", chain: W::Robinhood, chainId: 4663, family: Evm, registered: true, solanaContext: false },
    { network: "solana", vault: "vault-s", chain: W::Solana, chainId: 0, family: Svm, registered: true, solanaContext: true },
    { network: "solana", vault: "vault-x", chain: W::Solana, chainId: 0, family: Svm, registered: true, solanaContext: false }) }
pure def sometimesConsentStored(b: Binding): bool = b.consents.length() > 0
pure def sometimesRenewed(b: Binding): bool = b.consents.select(c => c.claim == authorizedClaim(b)).length() >= 2
pure def sometimesConsentForReplacedClaim(b: Binding): bool = b.consents.some(c => c.claim != authorizedClaim(b))
pure def sometimesSolanaCompleted(b: Binding): bool = b.generations.some(g => g.status == SolanaCompleted)
pure def sometimesPrivateCompleted(b: Binding): bool = b.generations.some(g => g.status == SolanaCompleted and g.privateCase > 0)
pure def sometimesSolanaRegenerated(b: Binding): bool = b.generations.some(g => g.status == SolanaExpired) and b.lastGeneration >= 2
pure def sometimesSolanaGenerationForReplacedClaim(b: Binding): bool =
  b.generations.some(g => g.status == SolanaPrepared and g.claim != solanaClaim(b))
pure def sometimesRegeneratedForNewClaim(b: Binding): bool =
  b.generations.some(g => g.status == SolanaExpired and g.claim != solanaClaim(b))
    and b.generations.some(g => g.status != SolanaExpired and g.claim == solanaClaim(b) and g.claim > 1)
pure def sometimesRefusedPrivateLogged(b: Binding): bool = b.caseAccessLog.length() > 0 and b.generations.length() == 0
pure val byValues = Set("1", "other", "operator", "settlement", "scanner")
pure val vaultValues = Set("vault-a", "vault-b")
pure val discoveredVersionValues = Set(-1, 0)
pure val signatureValues = Set(
  { recoveredSigner: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, upperHalfS: false },
  { recoveredSigner: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7779601, upperHalfS: false },
  { recoveredSigner: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, upperHalfS: true },
  { recoveredSigner: "wallet-b", claim: 2, network: "base", vault: "vault-a", chainId: 8453, version: 1, expiresAt: 7777601, upperHalfS: false },
  { recoveredSigner: "wallet-b", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, upperHalfS: false },
  { recoveredSigner: "wallet-a", claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 601, upperHalfS: false },
  { recoveredSigner: "wallet-a", claim: 1, network: "base", vault: "vault-b", chainId: 8453, version: 0, expiresAt: 7777601, upperHalfS: false })
pure val evidenceValues = Set(
  { obligation: 1, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 2, attemptOpen: true, privateCase: 0, outboxReady: true },
  { obligation: 1, owner: "1", network: "solana", vault: "vault-s", reserved: false, attemptClaim: 1, attemptOpen: false, privateCase: 0, outboxReady: true },
  { obligation: 2, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 2, attemptOpen: true, privateCase: 5, outboxReady: true },
  { obligation: 3, owner: "1", network: "solana", vault: "vault-x", reserved: true, attemptClaim: 1, attemptOpen: true, privateCase: 0, outboxReady: true },
  { obligation: 3, owner: "other", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 1, attemptOpen: true, privateCase: 0, outboxReady: true },
  { obligation: 4, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 0, attemptOpen: false, privateCase: 0, outboxReady: true },
  { obligation: 4, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 0, attemptOpen: false, privateCase: 0, outboxReady: false },
  { obligation: 5, owner: "1", network: "solana", vault: "vault-s", reserved: true, attemptClaim: 0, attemptOpen: false, privateCase: 6, outboxReady: true },
  { obligation: 6, owner: "1", network: "base", vault: "vault-a", reserved: true, attemptClaim: 0, attemptOpen: false, privateCase: 0, outboxReady: true })
pure val heightValues = Set(1100, 1151, 1400)
pure val walletSignatureValues = Set({ recoveredSigner: "wallet-s", transaction: 1 }, { recoveredSigner: "wallet-s", transaction: 2 },
  { recoveredSigner: "wallet-b", transaction: 2 }, { recoveredSigner: "wallet-b", transaction: 3 }, { recoveredSigner: "", transaction: 1 })
pure val generationValues = Set(1, 2, 3)
pure val obligationValues = Set(1, 2, 3, 4, 5, 6)
pure val cValues = Set({ claim: 1, network: "base", vault: "vault-a", chainId: 8453, version: 0, expiresAt: 7777601, signer: "wallet-a", createdAt: 0 })
pure val bValues = Set(initial)
  .union(Set({ ...initial, payments: initial.payments.append({ obligation: 4, owner: "1", network: "solana", vault: "vault-s",
    reserved: true, attemptClaim: 0, attemptOpen: false, privateCase: 0, outboxReady: true }) }))
  .union(Set({ ...initial, payments: List({ obligation: 1, owner: "1", network: "solana", vault: "vault-s", reserved: true,
    attemptClaim: 2, attemptOpen: true, privateCase: 0, outboxReady: true }) }))
pure val weight_bindAuthorize = 12
pure val weight_register = 6
pure val weight_issue = 6
pure val weight_readProof = 6
pure val weight_consume = 6
pure val weight_commitAuthorization = 6
pure val weight_solanaRegister = 8
pure val weight_solanaIssue = 8
pure val weight_solanaReadProof = 8
pure val weight_solanaConsume = 8
pure val weight_solanaCommitAuthorization = 8
pure val weight_solanaPrepare = 12
pure val weight_solanaComplete = 12
pure val weight_solanaExpire = 8
pure val weight_observeHeight = 6
pure val weight_observePayment = 6
```
