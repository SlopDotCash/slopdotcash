# Payout wallet registration and authorization

PRD section 3 and the preserved api_payment_wallet_protocol and
payment_wallet_registration models govern this flow. An instance belongs to
one permanent GitHub actor and one wallet chain. The adapter binds model
sequence numbers to original claim IDs, canonical records and transactionally
read predecessors. Base, Ethereum, Robinhood Chain and Solana have separate
histories. The [settlement signer](../settlement/signer.md) owns PAY-05 contract
consents, uncertain broadcasts and cancellation winners. This registry flow
does not sign or settle payments.

## Story: Replace a payout wallet without losing the current destination

### Registration appends an immutable successor or returns the current registry row

The adapter authenticates the member and validates the chain-specific address.
Registration compares its expected predecessor and appends one successor in
the same transaction. A retry for the current registry wallet returns its
existing row after a lost response or login rename. The same-address registry
winner of a concurrent write may be read back as success. A different address
or historical winner requires a fresh predecessor read and retry. Historical
same-address rows still need a registry successor. A readback receipt describes
the row it observed even if another request supersedes it before delivery.
The adapter retains canonical digests and original audit records. The pinned
sources are wallet-registration.ts, handler.ts lines 790–916, possession.ts,
and migrations 0011 and 0100.

```quint
type WalletChain = Base | Ethereum | Robinhood | Solana
type ClaimSource = Historical | Registry
type ClaimSequenceCheck = { nextPredecessor: int, ordered: bool }
pure val emptyClaimSequence: ClaimSequenceCheck = { nextPredecessor: 0, ordered: true }
type WalletClaim = { predecessor: int, wallet: str, digest: str, source: ClaimSource }
type Registration = { wallet: str, digest: str, predecessor: int, addressVerified: bool }
type Challenge = { claim: int, claimDigest: str, wallet: str, issuedAt: int, expiresAt: int, messageDigest: str }
type PossessionEvidence = { requestId: int, challengeId: int, claim: int, signerWallet: str, messageDigest: str, signatureVerified: bool }
type Consumption = { challengeId: int, requestId: int, claim: int, at: int }
type VerifiedRead = { claim: int, challengeId: int, capturedAt: int }
type Authorization = { claim: int, challengeId: int, authorizedAt: int }
type WalletRegistration = { actor: str, chain: WalletChain, clock: int,
  claims: List[WalletClaim], challenges: int -> Challenge, reads: int -> VerifiedRead,
  consumptions: List[Consumption], finished: List[int], authorizations: List[Authorization] }
pure val absentClaim: WalletClaim = { predecessor: 0, wallet: "", digest: "", source: Historical }
pure val absentChallenge: Challenge = { claim: 0, claimDigest: "", wallet: "", issuedAt: 0, expiresAt: 0, messageDigest: "" }
pure val absentRead: VerifiedRead = { claim: 0, challengeId: 0, capturedAt: 0 }
pure val absentAuthorization: Authorization = { claim: 0, challengeId: 0, authorizedAt: 0 }
pure val initial: WalletRegistration = { actor: "1", chain: Base, clock: 1, claims: List(),
  challenges: Map(), reads: Map(), consumptions: List(), finished: List(), authorizations: List() }
pure def claimAt(b: WalletRegistration, claim: int): WalletClaim = b.claims.nthOr(claim - 1, absentClaim)
pure def currentClaim(b: WalletRegistration): WalletClaim = claimAt(b, b.claims.length())
pure def sameRegistryWallet(b: WalletRegistration, wallet: str): bool = currentClaim(b).source == Registry and currentClaim(b).wallet == wallet
pure def canSelectChain(b: WalletRegistration, chain: WalletChain): bool = b.claims.length() == 0
pure def selectChain(b: WalletRegistration, chain: WalletChain): WalletRegistration = { ...b, chain: chain }
pure def canRestoreHistorical(b: WalletRegistration, wallet: str, digest: str, preserved: bool): bool =
  b.claims.length() == 0 and b.chain == Solana and wallet != "" and digest != "" and preserved
pure def restoreHistorical(b: WalletRegistration, wallet: str, digest: str, preserved: bool): WalletRegistration =
  { ...b, claims: List({ predecessor: 0, wallet: wallet, digest: digest, source: Historical }) }
pure def canRegister(b: WalletRegistration, registration: Registration, authenticated: bool, by: str): bool =
  authenticated and by == b.actor and registration.addressVerified and registration.wallet != ""
    and (sameRegistryWallet(b, registration.wallet) or
      (registration.predecessor == b.claims.length() and registration.digest != ""
        and not(b.claims.some(claim => claim.digest == registration.digest))))
pure def register(b: WalletRegistration, registration: Registration, authenticated: bool, by: str): WalletRegistration =
  if (sameRegistryWallet(b, registration.wallet)) b else
    { ...b, claims: b.claims.append({ predecessor: b.claims.length(),
      wallet: registration.wallet, digest: registration.digest, source: Registry }) }
pure def registrationReadback(b: WalletRegistration, wallet: str, authenticated: bool, by: str): int =
  if (authenticated and by == b.actor and sameRegistryWallet(b, wallet)) b.claims.length() else 0
```

### The server issues an expiring challenge for the exact current registry claim

The canonical message commits the authorization purpose, audience, actor,
chain, address, claim ID, claim digest, unique nonce and expiry. The server
issues a 15-minute challenge from its trusted clock. The adapter verifies the
signature against those exact bytes, and checks that the request belongs to
the authenticated actor. A new proof read at the exact expiry instant fails.
Consumption uses the trusted timestamp captured when the request began and
used for its successful proof read. A clock change between read and
consumption does not alter that captured timestamp.

```quint
pure val challengeLifetime = 15 * 60 * 1000
pure def challengeFor(b: WalletRegistration, challengeId: int): Challenge =
  if (b.challenges.keys().contains(challengeId)) b.challenges.get(challengeId) else absentChallenge
pure def readFor(b: WalletRegistration, requestId: int): VerifiedRead =
  if (b.reads.keys().contains(requestId)) b.reads.get(requestId) else absentRead
pure def consumed(b: WalletRegistration, challengeId: int): bool = b.consumptions.some(used => used.challengeId == challengeId)
pure def canObserveTime(b: WalletRegistration, timestamp: int): bool =
  timestamp > b.clock and timestamp <= 8640000000000000 - challengeLifetime
pure def observeTime(b: WalletRegistration, timestamp: int): WalletRegistration = { ...b, clock: timestamp }
pure def canIssue(b: WalletRegistration, claim: int, challengeId: int, messageDigest: str, authenticated: bool, by: str): bool =
  authenticated and by == b.actor and claim > 0 and claim == b.claims.length() and currentClaim(b).source == Registry
    and challengeId > 0 and messageDigest != "" and not(b.challenges.keys().contains(challengeId))
pure def issue(b: WalletRegistration, claim: int, challengeId: int, messageDigest: str, authenticated: bool, by: str): WalletRegistration =
  { ...b, challenges: b.challenges.put(challengeId, { claim: claim, claimDigest: currentClaim(b).digest,
    wallet: currentClaim(b).wallet, issuedAt: b.clock, expiresAt: b.clock + challengeLifetime, messageDigest: messageDigest }) }
pure def canReadProof(b: WalletRegistration, proof: PossessionEvidence, authenticated: bool, by: str): bool =
  val challenge = challengeFor(b, proof.challengeId)
  authenticated and by == b.actor and proof.requestId > 0 and not(b.reads.keys().contains(proof.requestId))
    and proof.challengeId > 0 and b.challenges.keys().contains(proof.challengeId) and not(consumed(b, proof.challengeId))
    and proof.claim == challenge.claim and proof.claim == b.claims.length() and currentClaim(b).source == Registry
    and challenge.claimDigest == currentClaim(b).digest and challenge.wallet == currentClaim(b).wallet
    and b.clock < challenge.expiresAt and b.clock >= challenge.issuedAt
    and proof.signerWallet == challenge.wallet and proof.messageDigest == challenge.messageDigest and proof.signatureVerified
pure def readProof(b: WalletRegistration, proof: PossessionEvidence, authenticated: bool, by: str): WalletRegistration =
  { ...b, reads: b.reads.put(proof.requestId, { claim: proof.claim,
    challengeId: proof.challengeId, capturedAt: b.clock }) }
```

### A single consumption wins and authorization rechecks the current claim

Multiple requests may verify the same challenge before either consumes it.
One atomic consume wins. The separate authorization batch checks that the
claim is still the current registry head. A lost response after a successful
batch leaves committed authorization intact. Failed batches and intervening
successors keep the challenge consumed. A new attempt needs a fresh challenge.
An already authorized claim keeps its first proof when it signs again. The
authenticated readback confirms an effective authorization without reusing a
consumed signature. A stale claim that still remains the effective authorized
destination can be read back without authorizing it again.

```quint
pure def canConsume(b: WalletRegistration, requestId: int): bool =
  val proofRead = readFor(b, requestId)
  val challenge = challengeFor(b, proofRead.challengeId)
  requestId > 0 and b.reads.keys().contains(requestId)
    and b.challenges.keys().contains(proofRead.challengeId) and not(consumed(b, proofRead.challengeId))
    and proofRead.capturedAt >= challenge.issuedAt and proofRead.capturedAt < challenge.expiresAt
pure def consume(b: WalletRegistration, requestId: int): WalletRegistration =
  val proofRead = readFor(b, requestId)
  { ...b, consumptions: b.consumptions.append({ challengeId: proofRead.challengeId, requestId: requestId,
    claim: proofRead.claim, at: proofRead.capturedAt }) }
pure def ownsConsumption(b: WalletRegistration, requestId: int): bool =
  val proofRead = readFor(b, requestId)
  b.consumptions.some(used => used.challengeId == proofRead.challengeId and used.requestId == requestId
    and used.claim == proofRead.claim and used.at == proofRead.capturedAt)
pure def alreadyAuthorized(b: WalletRegistration, claim: int): bool =
  b.authorizations.some(auth => auth.claim == claim)
pure def canCommitAuthorization(b: WalletRegistration, requestId: int, storageSucceeded: bool): bool =
  val proofRead = readFor(b, requestId)
  val challenge = challengeFor(b, proofRead.challengeId)
  requestId > 0 and b.reads.keys().contains(requestId) and ownsConsumption(b, requestId)
    and not(b.finished.includes(requestId))
    and proofRead.challengeId > 0 and proofRead.claim > 0 and proofRead.claim == challenge.claim
    and proofRead.capturedAt >= challenge.issuedAt and proofRead.capturedAt < challenge.expiresAt
pure def commitAuthorization(b: WalletRegistration, requestId: int, storageSucceeded: bool): WalletRegistration =
  val proofRead = readFor(b, requestId)
  val authorized = storageSucceeded and proofRead.claim == b.claims.length() and currentClaim(b).source == Registry
    and not(alreadyAuthorized(b, proofRead.claim))
  { ...b, finished: b.finished.append(requestId),
    authorizations: if (authorized) b.authorizations.append({ claim: proofRead.claim, challengeId: proofRead.challengeId,
      authorizedAt: proofRead.capturedAt }) else b.authorizations }
pure def activeAuthorization(b: WalletRegistration): Authorization =
  b.authorizations.nthOr(b.authorizations.length() - 1, absentAuthorization)
pure def activeWallet(b: WalletRegistration): str = claimAt(b, activeAuthorization(b).claim).wallet
pure def firstProof(b: WalletRegistration): int = b.authorizations.nthOr(0, absentAuthorization).challengeId
pure def authorizationReadback(b: WalletRegistration, claim: int, authenticated: bool, by: str): bool =
  authenticated and by == b.actor and claim > 0 and claim == activeAuthorization(b).claim
pure def pendingWallet(b: WalletRegistration): str =
  if (currentClaim(b).source == Registry and b.claims.length() != activeAuthorization(b).claim) currentClaim(b).wallet else ""
```

### Claim and proof history remains bound to one partition

An unsigned successor leaves the previous verified wallet effective. The
current signed claim becomes effective immediately. The payment adapter
independently rechecks authorization and preserves holds on unresolved
transactions for a different claim. Private-award recovery requires renewed
consent and retirement of prior signable requests. See [private settlement recovery](../settlement/recovery.md).

```quint
pure def alwaysPartitionValid(b: WalletRegistration): bool = b.actor != "" and b.clock > 0
  and b.clock <= 8640000000000000 - challengeLifetime
pure def alwaysPredecessors(b: WalletRegistration): bool =
  val checked = b.claims.foldl(emptyClaimSequence, (acc, claim) =>
    { nextPredecessor: acc.nextPredecessor + 1, ordered: acc.ordered and claim.predecessor == acc.nextPredecessor })
  checked.ordered and checked.nextPredecessor == b.claims.length()
pure def alwaysClaimsAdmitted(b: WalletRegistration): bool = b.claims.every(claim => claim.wallet != "" and claim.digest != "")
pure def alwaysAuthorizationAdmitted(b: WalletRegistration): bool = b.authorizations.every(auth =>
  auth.claim > 0 and auth.claim <= b.claims.length() and auth.challengeId > 0
    and claimAt(b, auth.claim).source == Registry and b.consumptions.some(used =>
      used.challengeId == auth.challengeId and used.claim == auth.claim and used.at == auth.authorizedAt))
pure def alwaysOneConsumption(b: WalletRegistration): bool = b.consumptions.every(used =>
  b.consumptions.select(other => other.challengeId == used.challengeId).length() == 1)
pure def alwaysOneAuthorization(b: WalletRegistration): bool = b.authorizations.every(auth =>
  b.authorizations.select(other => other.claim == auth.claim).length() == 1)
pure def alwaysAuthorizationIncreases(b: WalletRegistration): bool = b.authorizations.every(auth =>
  auth.claim <= activeAuthorization(b).claim)
pure def stepClaimsRetained(before: WalletRegistration, after: WalletRegistration): bool =
  before.claims.every(claim => after.claims.includes(claim))
pure def stepFirstProofPersists(before: WalletRegistration, after: WalletRegistration): bool =
  firstProof(before) > 0 implies firstProof(before) == firstProof(after)
pure def stepAuthorizationsRetained(before: WalletRegistration, after: WalletRegistration): bool =
  before.authorizations.every(auth => after.authorizations.includes(auth))
pure def stepConsumedRetained(before: WalletRegistration, after: WalletRegistration): bool =
  before.consumptions.every(used => after.consumptions.includes(used))
pure def sometimesBound(b: WalletRegistration): bool = activeWallet(b) != ""
pure def sometimesPriorStillEffective(b: WalletRegistration): bool = activeWallet(b) != "" and pendingWallet(b) != ""
pure def sometimesConsumedButUnsigned(b: WalletRegistration): bool = b.consumptions.length() > 0 and b.authorizations.length() == 0
```

### Simulation covers matching messages, stale claims, exact expiry and replay

```quint
pure val byValues = Set("1", "other")
pure val walletValues = Set("wallet-a", "wallet-b", "")
pure val digestValues = Set("digest-a", "digest-b", "")
pure val timestampValues = Set(2, 900001, 900002)
pure val claimValues = Set(0, 1, 2)
pure val challengeIdValues = Set(0, 1, 2)
pure val requestIdValues = Set(0, 1, 2, 3)
pure val messageDigestValues = Set("message-a", "message-b", "")
pure val registrationValues = Set(
  { wallet: "wallet-a", digest: "digest-a", predecessor: 0, addressVerified: true },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 0, addressVerified: true },
  { wallet: "wallet-a", digest: "digest-a", predecessor: 1, addressVerified: true },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 1, addressVerified: true },
  { wallet: "wallet-a", digest: "digest-b", predecessor: 1, addressVerified: true },
  { wallet: "", digest: "digest-b", predecessor: 0, addressVerified: false })
pure val proofValues = Set(
  { requestId: 1, challengeId: 1, claim: 1, signerWallet: "wallet-a", messageDigest: "message-a", signatureVerified: true },
  { requestId: 2, challengeId: 1, claim: 1, signerWallet: "wallet-a", messageDigest: "message-a", signatureVerified: true },
  { requestId: 2, challengeId: 2, claim: 2, signerWallet: "wallet-b", messageDigest: "message-b", signatureVerified: true },
  { requestId: 3, challengeId: 1, claim: 1, signerWallet: "wallet-b", messageDigest: "message-a", signatureVerified: true },
  { requestId: 3, challengeId: 1, claim: 1, signerWallet: "wallet-a", messageDigest: "message-b", signatureVerified: true },
  { requestId: 3, challengeId: 1, claim: 1, signerWallet: "wallet-a", messageDigest: "message-a", signatureVerified: false })
pure val weight_selectChain = 10
pure val weight_restoreHistorical = 15
pure val weight_register = 20
pure val weight_issue = 25
pure val weight_readProof = 40
pure val weight_consume = 35
pure val weight_commitAuthorization = 40
```
