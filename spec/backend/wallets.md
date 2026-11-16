# Payout wallet registration and authorization

PRD section 3 and the preserved api_payment_wallet_protocol and
payment_wallet_registration models govern this flow. An instance belongs to
one permanent GitHub actor and one wallet chain. The adapter binds model
sequence numbers to original claim IDs, canonical records and transactionally
read predecessors. Base, Ethereum, Robinhood Chain and Solana have separate
histories. PAY-05 binding consent is [binding consent](./bindingConsent.md);
the attester's signing, uncertain broadcasts and cancellation winners are the
[settlement signer](../settlement/signer.md). This registry flow does not
sign or settle payments.

Signature and address checks are the shell's, inside the same request, over
bytes this model fixes: the shell's address parser for the chain refuses a
malformed or non-canonical address before any event exists, and each
`recoveredSigner` below is the address the pinned verifier
(`src/lib/wallet-possession.ts`, `possession.ts`) recovers or verifies from
the signature over the exact stored challenge message, or empty when
verification fails. No request field states that a signature or address is
valid.

## Story: Replace a payout wallet without losing the current destination

### Registration appends an immutable successor or returns the current registry row

The shell authenticates the member and supplies the actor as `by`.
Registration compares its expected predecessor and appends one successor in
the same transaction; DEV keeps one root and at most one successor per claim
(`wallet_claims_one_root_per_actor`, `wallet_claims_one_successor`), so the
claims of a partition form one line. A retry for the current registry wallet
returns its existing row after a lost response or login rename. The
same-address registry winner of a concurrent write may be read back as
success. A different address or historical winner requires a fresh
predecessor read and retry. Historical same-address rows still need a
registry successor. A readback receipt describes the row it observed even if
another request supersedes it before delivery. Each new claim inserts one
`wallet_changed` Inbox notice in the same batch. The pinned sources are
wallet-registration.ts, handler.ts lines 790–916, possession.ts, and
migrations 0011, 0017 and 0100.

```quint
type WalletChain = Base | Ethereum | Robinhood | Solana
type ClaimSource = Historical | Registry
type ClaimSequenceCheck = { nextPredecessor: int, ordered: bool }
pure val emptyClaimSequence: ClaimSequenceCheck = { nextPredecessor: 0, ordered: true }
type WalletClaim = { predecessor: int, wallet: str, digest: str, source: ClaimSource }
type Registration = { wallet: str, digest: str, predecessor: int }
type Challenge = { claim: int, claimDigest: str, wallet: str, issuedAt: int, expiresAt: int, messageDigest: str }
type PossessionEvidence = { requestId: int, challengeId: int, claim: int, recoveredSigner: str, messageDigest: str }
type Consumption = { challengeId: int, requestId: int, claim: int, at: int }
type VerifiedRead = { claim: int, challengeId: int, capturedAt: int }
type Authorization = { claim: int, challengeId: int, authorizedAt: int }
type OperatorSource = FromRegistry | FromGithubIssue
type OperatorRecord = { claim: int, source: OperatorSource }
type PossessionChallenge = { id: int, claim: int, wallet: str, issuedAt: int, expiresAt: int, consumed: bool, consumedAt: int }
type Attestation = { claim: int, challenge: int, wallet: str, attestedAt: int }
type WalletRegistration = { actor: str, chain: WalletChain, clock: int,
  claims: List[WalletClaim], challenges: int -> Challenge, reads: int -> VerifiedRead,
  consumptions: List[Consumption], finished: List[int], authorizations: List[Authorization],
  operatorRecords: List[OperatorRecord], walletChangedNotices: List[int], historicalProposals: List[int],
  possessionChallenges: List[PossessionChallenge], lastPossessionChallenge: int, attestations: List[Attestation] }
pure val absentClaim: WalletClaim = { predecessor: 0, wallet: "", digest: "", source: Historical }
pure val absentChallenge: Challenge = { claim: 0, claimDigest: "", wallet: "", issuedAt: 0, expiresAt: 0, messageDigest: "" }
pure val absentRead: VerifiedRead = { claim: 0, challengeId: 0, capturedAt: 0 }
pure val absentAuthorization: Authorization = { claim: 0, challengeId: 0, authorizedAt: 0 }
pure val walletOperator = "operator"
pure val initial: WalletRegistration = { actor: "1", chain: Base, clock: 1, claims: List(),
  challenges: Map(), reads: Map(), consumptions: List(), finished: List(), authorizations: List(),
  operatorRecords: List(), walletChangedNotices: List(), historicalProposals: List(1),
  possessionChallenges: List(), lastPossessionChallenge: 0, attestations: List() }
pure def claimAt(b: WalletRegistration, claim: int): WalletClaim = b.claims.nthOr(claim - 1, absentClaim)
pure def currentClaim(b: WalletRegistration): WalletClaim = claimAt(b, b.claims.length())
pure def sameRegistryWallet(b: WalletRegistration, wallet: str): bool = currentClaim(b).source == Registry and currentClaim(b).wallet == wallet
pure def canSelectChain(b: WalletRegistration, chain: WalletChain): bool = b.claims.length() == 0
pure def selectChain(b: WalletRegistration, chain: WalletChain): WalletRegistration = { ...b, chain: chain }
pure def canRegister(b: WalletRegistration, registration: Registration, by: str): bool =
  by == b.actor and registration.wallet != ""
    and (sameRegistryWallet(b, registration.wallet) or
      (registration.predecessor == b.claims.length() and registration.digest != ""
        and not(b.claims.some(claim => claim.digest == registration.digest))))
pure def register(b: WalletRegistration, registration: Registration, by: str): WalletRegistration =
  if (sameRegistryWallet(b, registration.wallet)) b else
    { ...b, claims: b.claims.append({ predecessor: b.claims.length(),
      wallet: registration.wallet, digest: registration.digest, source: Registry }),
      walletChangedNotices: b.walletChangedNotices.append(b.claims.length() + 1) }
pure def registrationReadback(b: WalletRegistration, wallet: str, by: str): int =
  if (by == b.actor and sameRegistryWallet(b, wallet)) b.claims.length() else 0
```

### The server issues an expiring challenge for the exact current registry claim

The canonical message commits the authorization purpose, audience, actor,
chain, address, claim ID, claim digest, unique nonce and expiry. The server
issues a 15-minute challenge from its trusted clock. The proof read requires
the recovered signer of exactly those bytes to be the challenge's wallet,
and the request to belong to the authenticated actor. A new proof read at
the exact expiry instant fails. Consumption uses the trusted timestamp
captured when the request began and used for its successful proof read. A
clock change between read and consumption does not alter that captured
timestamp.

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
pure def canIssue(b: WalletRegistration, claim: int, challengeId: int, messageDigest: str, by: str): bool =
  by == b.actor and claim > 0 and claim == b.claims.length() and currentClaim(b).source == Registry
    and challengeId > 0 and messageDigest != "" and not(b.challenges.keys().contains(challengeId))
pure def issue(b: WalletRegistration, claim: int, challengeId: int, messageDigest: str, by: str): WalletRegistration =
  { ...b, challenges: b.challenges.put(challengeId, { claim: claim, claimDigest: currentClaim(b).digest,
    wallet: currentClaim(b).wallet, issuedAt: b.clock, expiresAt: b.clock + challengeLifetime, messageDigest: messageDigest }) }
pure def canReadProof(b: WalletRegistration, proof: PossessionEvidence, by: str): bool =
  val challenge = challengeFor(b, proof.challengeId)
  by == b.actor and proof.requestId > 0 and not(b.reads.keys().contains(proof.requestId))
    and proof.challengeId > 0 and b.challenges.keys().contains(proof.challengeId) and not(consumed(b, proof.challengeId))
    and proof.claim == challenge.claim and proof.claim == b.claims.length() and currentClaim(b).source == Registry
    and challenge.claimDigest == currentClaim(b).digest and challenge.wallet == currentClaim(b).wallet
    and b.clock < challenge.expiresAt and b.clock >= challenge.issuedAt
    and proof.recoveredSigner != "" and proof.recoveredSigner == challenge.wallet and proof.messageDigest == challenge.messageDigest
pure def readProof(b: WalletRegistration, proof: PossessionEvidence, by: str): WalletRegistration =
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
pure def authorizationReadback(b: WalletRegistration, claim: int, by: str): bool =
  by == b.actor and claim > 0 and claim == activeAuthorization(b).claim
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
pure val byValues = Set("1", "other", "operator")
pure val timestampValues = Set(2, 900001, 900002)
pure val claimValues = Set(0, 1, 2)
pure val challengeIdValues = Set(0, 1, 2)
pure val requestIdValues = Set(0, 1, 2, 3)
pure val messageDigestValues = Set("message-a", "message-b", "")
pure val registrationValues = Set(
  { wallet: "wallet-a", digest: "digest-a", predecessor: 0 },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 0 },
  { wallet: "wallet-a", digest: "digest-a", predecessor: 1 },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 1 },
  { wallet: "wallet-a", digest: "digest-b", predecessor: 1 },
  { wallet: "", digest: "digest-b", predecessor: 0 })
pure val proofValues = Set(
  { requestId: 1, challengeId: 1, claim: 1, recoveredSigner: "wallet-a", messageDigest: "message-a" },
  { requestId: 2, challengeId: 1, claim: 1, recoveredSigner: "wallet-a", messageDigest: "message-a" },
  { requestId: 2, challengeId: 2, claim: 2, recoveredSigner: "wallet-b", messageDigest: "message-b" },
  { requestId: 3, challengeId: 1, claim: 1, recoveredSigner: "wallet-b", messageDigest: "message-a" },
  { requestId: 3, challengeId: 1, claim: 1, recoveredSigner: "wallet-a", messageDigest: "message-b" },
  { requestId: 3, challengeId: 1, claim: 1, recoveredSigner: "", messageDigest: "message-a" })
pure val weight_selectChain = 10
pure val weight_register = 20
pure val weight_issue = 25
pure val weight_readProof = 40
pure val weight_consume = 35
pure val weight_commitAuthorization = 40
```

## Story: Recover a wallet through the operator without giving the operator authority

> As a contributor who lost access to a payout wallet, I want the operator to
> help me register a replacement, while only my own wallet signature can make
> it my payout destination.

### An operator claim is digest-idempotent, keeps the claim line and authorizes nothing

PRD section 3 ("Redirected recovery uses one operator") and the pinned
`POST /api/v1/operator/wallet-claims` (`backend/trace/handler.ts`,
`insertWalletClaim`). The contributor contacts the operator by email; that
contact is outside this service. The one configured operator then submits a
Solana claim for the contributor: a registry recovery (`d1_registry`) or the
migration of a historical claim from an issue of the pinned
`SlopDotCash/slopdotcash` repository (`github_issue`). The request carries
its observation time, which may not be in the future, and the digest of its
canonical record; `predecessor` is the claim it supersedes (0 for none). A
request whose record digest already exists returns that claim and changes
nothing. A predecessor that is not this partition's current claim is refused
(`claim_conflict`, or the one-successor index). Otherwise the claim, its
audit record and one `wallet_changed` Inbox notice commit in one batch. The
operator role adds no challenge, proof read, consumption or authorization:
a recovered registry claim stays pending until the contributor signs the
possession challenge as the account actor, and the previous authorized
wallet stays effective until then. A historical claim can never be
authorized. The admin wallet-proposal endpoint is retired: it always answers
not found and adds nothing, and historical proposal rows stay unchanged.

```quint
type OperatorClaim = { wallet: str, digest: str, predecessor: int, source: OperatorSource, observedAt: int }
type OperatorOutcome = InvalidOperatorClaim | ObservationInFuture | OperatorReplayed | ClaimConflict | OperatorClaimCreated
pure def operatorOutcome(b: WalletRegistration, request: OperatorClaim): OperatorOutcome =
  if (b.chain != Solana or request.wallet == "" or request.digest == "" or request.predecessor < 0) InvalidOperatorClaim
  else if (request.observedAt > b.clock) ObservationInFuture
  else if (b.claims.some(claim => claim.digest == request.digest)) OperatorReplayed
  else if (request.predecessor != b.claims.length()) ClaimConflict
  else OperatorClaimCreated
pure def canOperatorClaim(b: WalletRegistration, by: str, request: OperatorClaim): bool =
  by == walletOperator and operatorOutcome(b, request) == OperatorClaimCreated
pure def operatorClaim(b: WalletRegistration, by: str, request: OperatorClaim): WalletRegistration =
  { ...b, claims: b.claims.append({ predecessor: b.claims.length(), wallet: request.wallet, digest: request.digest,
      source: if (request.source == FromGithubIssue) Historical else Registry }),
    operatorRecords: b.operatorRecords.append({ claim: b.claims.length() + 1, source: request.source }),
    walletChangedNotices: b.walletChangedNotices.append(b.claims.length() + 1) }
pure def alwaysOperatorRecordsMatchClaims(b: WalletRegistration): bool = b.operatorRecords.every(r =>
  r.claim > 0 and r.claim <= b.claims.length() and b.walletChangedNotices.includes(r.claim)
    and (claimAt(b, r.claim).source == Historical iff r.source == FromGithubIssue)
    and b.operatorRecords.select(o => o.claim == r.claim).length() == 1)
  and b.walletChangedNotices.every(n => n > 0 and n <= b.claims.length())
pure def stepOperatorHistoryRetained(before: WalletRegistration, after: WalletRegistration): bool =
  before.operatorRecords.every(r => after.operatorRecords.includes(r))
    and before.walletChangedNotices.every(n => after.walletChangedNotices.includes(n))
    and after.historicalProposals == before.historicalProposals
pure def lawOperatorClaimGrantsNoAuthority(b: WalletRegistration, request: OperatorClaim): bool =
  canOperatorClaim(b, walletOperator, request) implies
    (operatorClaim(b, walletOperator, request).authorizations == b.authorizations
      and operatorClaim(b, walletOperator, request).consumptions == b.consumptions
      and operatorClaim(b, walletOperator, request).finished == b.finished
      and payableClaim(operatorClaim(b, walletOperator, request)) == payableClaim(b))
pure def sometimesRecoveredPendingSignature(b: WalletRegistration): bool =
  b.operatorRecords.some(r => r.source == FromRegistry and not(alreadyAuthorized(b, r.claim)))
pure def sometimesRecoveredAuthorized(b: WalletRegistration): bool = b.operatorRecords.some(r => alreadyAuthorized(b, r.claim))
pure def sometimesHistoricalMigrated(b: WalletRegistration): bool = b.operatorRecords.some(r => r.source == FromGithubIssue)
pure val requestValues = Set(
  { wallet: "wallet-h", digest: "digest-h", predecessor: 0, source: FromGithubIssue, observedAt: 1 },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 0, source: FromRegistry, observedAt: 1 },
  { wallet: "wallet-b", digest: "digest-b", predecessor: 1, source: FromRegistry, observedAt: 1 },
  { wallet: "wallet-c", digest: "digest-c", predecessor: 1, source: FromRegistry, observedAt: 900002 },
  { wallet: "wallet-c", digest: "digest-c", predecessor: 2, source: FromRegistry, observedAt: 1 })
pure val weight_operatorClaim = 10
```

### The legacy possession verifier issues single-use challenges and keeps one attestation per claim

PRD section 9 retains the runtime wallet-possession verifier and its
callers: `POST /wallet-claims/{id}/possession-challenge`, `POST
/wallet-claims/{id}/possession` and the public `GET` of the attestation
(`backend/trace/handler.ts`, `cloudflare-persistence.ts`,
`wallet_possession_challenges`, `wallet_possession_attestations`). It works
on any Solana claim of the authenticated actor, historical ones included.
When the claim already has an attestation, both routes return it and change
nothing. A challenge lives 15 minutes from the trusted clock and its bound
fields come from server state. Submission consumes the challenge in one
conditional update (unconsumed and unexpired) before the signature is
trusted, so a challenge is used at most once even when the proof then fails:
a challenge for another claim, a changed wallet or a signature that does not
verify consumes it and records nothing. Only a matching signature records
the attestation; a concurrent submission that loses the insert returns the
winner's attestation. The public read changes nothing; its one-minute cache
header is a shell obligation. An address off the Ed25519 curve is refused
by the shell (`address_not_signable`) before any challenge. The read-only
`wallet_observations` rows are not changed by any transition here.

```quint
pure val possessionLifetime = 15 * 60 * 1000
pure def attestationFor(b: WalletRegistration, claim: int): Attestation =
  b.attestations.select(a => a.claim == claim).nthOr(0, { claim: 0, challenge: 0, wallet: "", attestedAt: 0 })
pure def possessionChallenge(b: WalletRegistration, challengeId: int): PossessionChallenge =
  b.possessionChallenges.select(c => c.id == challengeId)
    .nthOr(0, { id: 0, claim: 0, wallet: "", issuedAt: 0, expiresAt: 0, consumed: true, consumedAt: 0 })
pure def ownedSolanaClaim(b: WalletRegistration, by: str, claim: int): bool =
  by == b.actor and b.chain == Solana and claim > 0 and claim <= b.claims.length()
pure def canIssuePossessionChallenge(b: WalletRegistration, by: str, claim: int): bool =
  ownedSolanaClaim(b, by, claim) and attestationFor(b, claim).claim == 0
pure def issuePossessionChallenge(b: WalletRegistration, by: str, claim: int): WalletRegistration =
  { ...b, lastPossessionChallenge: b.lastPossessionChallenge + 1,
    possessionChallenges: b.possessionChallenges.append({ id: b.lastPossessionChallenge + 1, claim: claim,
      wallet: claimAt(b, claim).wallet, issuedAt: b.clock, expiresAt: b.clock + possessionLifetime,
      consumed: false, consumedAt: 0 }) }
pure def possessionMatches(b: WalletRegistration, claim: int, challengeId: int, recoveredSigner: str): bool =
  val c = possessionChallenge(b, challengeId)
  c.claim == claim and c.wallet == claimAt(b, claim).wallet and recoveredSigner != "" and recoveredSigner == c.wallet
pure def canAttestPossession(b: WalletRegistration, by: str, claim: int, challengeId: int, recoveredSigner: str): bool =
  val c = possessionChallenge(b, challengeId)
  ownedSolanaClaim(b, by, claim) and attestationFor(b, claim).claim == 0
    and c.id > 0 and not(c.consumed) and b.clock < c.expiresAt
pure def attestPossession(b: WalletRegistration, by: str, claim: int, challengeId: int, recoveredSigner: str): WalletRegistration =
  { ...b, possessionChallenges: b.possessionChallenges.listMap(c => if (c.id == challengeId) { ...c, consumed: true, consumedAt: b.clock } else c),
    attestations: if (possessionMatches(b, claim, challengeId, recoveredSigner))
      b.attestations.append({ claim: claim, challenge: challengeId, wallet: claimAt(b, claim).wallet, attestedAt: b.clock })
      else b.attestations }
pure def publicPossession(b: WalletRegistration, claim: int): Attestation = attestationFor(b, claim)
pure def alwaysPossessionRecordsValid(b: WalletRegistration): bool =
  b.possessionChallenges.every(c => c.id > 0 and c.id <= b.lastPossessionChallenge and c.claim > 0 and c.claim <= b.claims.length()
    and c.expiresAt == c.issuedAt + possessionLifetime and c.issuedAt <= b.clock
    and (c.consumed implies (c.consumedAt >= c.issuedAt and c.consumedAt < c.expiresAt))
    and b.possessionChallenges.select(o => o.id == c.id).length() == 1)
  and b.attestations.every(a => a.claim > 0 and a.claim <= b.claims.length() and a.wallet == claimAt(b, a.claim).wallet
    and b.attestations.select(o => o.claim == a.claim).length() == 1
    and b.possessionChallenges.some(c => c.id == a.challenge and c.claim == a.claim and c.consumed and c.consumedAt == a.attestedAt))
pure def stepPossessionRecordsPermanent(before: WalletRegistration, after: WalletRegistration): bool =
  before.attestations.every(a => after.attestations.includes(a))
    and before.possessionChallenges.every(c => after.possessionChallenges.some(d => d.id == c.id and d.claim == c.claim
      and d.wallet == c.wallet and d.expiresAt == c.expiresAt and (c.consumed implies d == c)))
    and before.lastPossessionChallenge <= after.lastPossessionChallenge
pure def lawUsedChallengeCannotAttestAgain(b: WalletRegistration, by: str, claim: int, challengeId: int, recoveredSigner: str): bool =
  canAttestPossession(b, by, claim, challengeId, recoveredSigner)
    implies not(canAttestPossession(attestPossession(b, by, claim, challengeId, recoveredSigner), by, claim, challengeId, recoveredSigner))
pure def sometimesPossessionAttested(b: WalletRegistration): bool = b.attestations.length() > 0
pure def sometimesChallengeBurnedWithoutAttestation(b: WalletRegistration): bool =
  b.possessionChallenges.some(c => c.consumed) and b.attestations.length() == 0
pure val recoveredSignerValues = Set("wallet-a", "wallet-b", "")
pure val weight_issuePossessionChallenge = 10
pure val weight_attestPossession = 10
```

### The effective claim and held deliveries follow the authorized claim

Readers that show a destination use the effective claim: the latest
authorized claim, or, before any authorization, the newest claim (which may
be historical). Payment uses only the authorized claim. Authorizing a claim
releases held deliveries of reserved obligations in the same batch, except
one whose uncertain attempt (prepared, unknown or submitted) used another
claim: that stays held until settlement recovery reconciles the attempt.
The payment outbox is owned by [settlement](../settlement/payment.md); the
attempts here are the evidence that service supplies.

```quint
type AttemptEvidence = { obligation: int, claim: int, uncertain: bool }
pure def effectiveClaim(b: WalletRegistration): int =
  if (b.authorizations.length() == 0) b.claims.length() else activeAuthorization(b).claim
pure def payableClaim(b: WalletRegistration): int = activeAuthorization(b).claim
pure def releasesHeld(b: WalletRegistration, obligation: int, attempts: List[AttemptEvidence]): bool =
  payableClaim(b) > 0 and not(attempts.some(t => t.obligation == obligation and t.uncertain and t.claim != payableClaim(b)))
pure def lawUnauthorizedClaimIsNeverPayable(b: WalletRegistration): bool =
  b.authorizations.length() == 0 implies payableClaim(b) == 0
pure def lawUncertainOtherClaimStaysHeld(b: WalletRegistration, obligation: int, other: int): bool =
  (other != payableClaim(b)) implies not(releasesHeld(b, obligation, List({ obligation: obligation, claim: other, uncertain: true })))
pure val obligationValues = Set(1, 2)
pure val otherValues = Set(0, 1, 2)
pure val sampleSolana: WalletRegistration = selectChain(initial, Solana)
pure val sampleRegistered: WalletRegistration = register(initial, { wallet: "wallet-a", digest: "digest-a", predecessor: 0 }, "1")
pure val sampleRecovered: WalletRegistration = operatorClaim(sampleSolana, walletOperator,
  { wallet: "wallet-b", digest: "digest-b", predecessor: 0, source: FromRegistry, observedAt: 1 })
pure val bValues = Set(initial).union(Set(sampleRegistered)).union(Set(sampleRecovered))
pure def lawNoAuthorizationShowsLatestIntent(b: WalletRegistration): bool =
  b.authorizations.length() == 0 implies effectiveClaim(b) == b.claims.length()
```
