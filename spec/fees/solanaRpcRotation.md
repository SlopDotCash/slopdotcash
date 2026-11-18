# Live Solana RPC pair rotation of the fee Worker

The pinned sources are `scripts/rotate-fee-solana-rpc.ts` with its tests,
`scripts/qualify-solana-rpc-pair.ts`, the version checks of
`scripts/release-robinhood-rpc.ts` (`requireRotationBase`,
`requireSameWorker`, `requireLiveMain`) and `workers/fee-converter/README.md`,
"Replace the live Solana RPC pair"; development's model is
`formal/models/release/release_publication.qnt` (`rpcRotation`). The
rotation replaces the two Solana RPC secrets (`RPC_URL_SOLANA`, the Helius
candidate from the protected `SLOP_SOLANA_RPC_CANDIDATE` secret, and
`SOLANA_RECOVERY_RPC_URL`, the public Solana Vibe Station endpoint) of the
exact active fee Worker version. It signs nothing, submits no claim or
payment and changes nothing the fee-wallet key may sign: the
[runtime](./runtime.md) keeps its source, modes, networks, keys and
readiness, because the candidate keeps the code, runtime, settings, other
bindings and the existing signer of the version it replaces.

One instance follows one manual run of the protected release job on main.
Each phase is written to the run's safe phase receipt before the next one
starts. The network lease is the [conversion journal](./conversion.md)'s:
the shell sends `leaseOutcome` with the result of that journal's
`acquireRotationLease`, renews it through `renewRotationLease` at each
boundary, and sends `releaseRotationLease` only when this machine allows
`releaseLease`. Versions, sources and digests are opaque integers here;
operators are names.

## Story: Replace the Solana RPC pair of the exact active fee Worker

### A rotation starts only from protected manual main, the exact pinned active version and byte-identical fee source

The run must be a manual dispatch on `main` with the production fee release
enabled. The pinned version must be the only active version at 100% and the
latest upload, carrying the pinned source tag. Every bundled input of the
fee Worker, its configuration and the dependency lock must be identical
between the pinned source and the checkout, with no local change. The
active version must bind the reviewed fee database and keep the existing
Solana signer secret. The two endpoints must belong to two independent
operators.

```quint
type RotationPhase = NotStarted | Qualifying | AcquiringLease | Leased | Uploaded | Deploying | Verified | Refused | Uncertain
type RpcPair = { primary: str, recovery: str }
type WorkerVersion = { version: int, number: int, source: int, codeHash: int, runtime: int, settings: int, otherBindings: int,
  database: int, signer: bool, rpc: RpcPair }
type RotationRequest = { manualMain: bool, releaseEnabled: bool, checkout: int, pinnedVersion: int, pinnedSource: int,
  active: WorkerVersion, onlyActiveAndLatest: bool, sourceParity: bool, reviewedDatabase: int, pair: RpcPair }
type Rotation = { phase: RotationPhase, checkout: int, base: WorkerVersion, pair: RpcPair, priorHistory: bool, leaseHeld: bool,
  leaseReleased: bool, candidate: WorkerVersion, activation: int, receipts: List[RotationPhase], commandFailed: bool }
pure val noPair: RpcPair = { primary: "", recovery: "" }
pure val noVersion: WorkerVersion = { version: 0, number: 0, source: 0, codeHash: 0, runtime: 0, settings: 0, otherBindings: 0,
  database: 0, signer: false, rpc: noPair }
pure val initial: Rotation = { phase: NotStarted, checkout: 0, base: noVersion, pair: noPair, priorHistory: false, leaseHeld: false,
  leaseReleased: false, candidate: noVersion, activation: 0, receipts: List(), commandFailed: false }
pure def independentPair(pair: RpcPair): bool = pair.primary != "" and pair.recovery != "" and pair.primary != pair.recovery
pure def enter(nextPhase: RotationPhase, r: Rotation): Rotation = { ...r, phase: nextPhase, receipts: r.receipts.append(nextPhase) }
pure def stop(nextPhase: RotationPhase, r: Rotation): Rotation = { ...r, phase: nextPhase }
pure def canStartRotation(r: Rotation, request: RotationRequest): bool = r.phase == NotStarted and request.manualMain and request.releaseEnabled
  and request.checkout > 0 and request.pinnedVersion > 0 and request.pinnedSource > 0 and request.active.version == request.pinnedVersion
  and request.active.source == request.pinnedSource and request.onlyActiveAndLatest and request.sourceParity
  and request.reviewedDatabase > 0 and request.active.database == request.reviewedDatabase and request.active.signer
  and independentPair(request.pair)
pure def startRotation(r: Rotation, request: RotationRequest): Rotation =
  enter(Qualifying, { ...r, checkout: request.checkout, base: request.active, pair: request.pair })
pure def sometimesQualifying(r: Rotation): bool = r.phase == Qualifying
```

### A prior failed run's witness supplies history only, never authority

A manual run of the same workflow that stopped in qualification, before it
took a lease, uploaded a candidate or verified anything, may lend its
retained history. Its phase receipt must name the prior source it was
checked out at, its proof digest must match the retained proof, every
retained page must belong to the same two operators and the coverage must
be complete (211 blocks per operator with the expected digest). It sets
nothing but the history: qualification repeats every fresh check, and the
current source, active version and quiet journal apply as for any run.

```quint
type PriorWitness = { phase: RotationPhase, checkout: int, priorSource: int, tookLease: bool, candidate: int, verified: bool,
  digestMatches: bool, historyComplete: bool, pair: RpcPair }
pure def canSupplyPriorWitness(r: Rotation, witness: PriorWitness): bool = r.phase == Qualifying and not(r.priorHistory)
  and witness.phase == Qualifying and witness.priorSource > 0 and witness.checkout == witness.priorSource
  and not(witness.tookLease) and witness.candidate == 0 and not(witness.verified)
  and witness.digestMatches and witness.historyComplete and witness.pair == r.pair
pure def supplyPriorWitness(r: Rotation, witness: PriorWitness): Rotation = { ...r, priorHistory: true }
pure def stepPriorWitnessOnlyHistory(before: Rotation, via: str, after: Rotation): bool =
  via == "supplyPriorWitness" implies after == { ...before, priorHistory: true }
pure def sometimesPriorHistoryUsed(r: Rotation): bool = r.priorHistory and r.phase == Verified
```

### The rotation takes the Solana lease only after qualifying the new pair, and stops at any boundary where the version, main or lease changed

Qualification checks the full recovery history of both endpoints. Then main
must still be the checkout and the pinned version still the only active one
and the latest upload. The lease is taken only while the fee journal is
quiet; an active lease or an unresolved send refuses the rotation. Before
the upload the lease is renewed and main and the pinned version are checked
again; any change refuses before anything is uploaded. An upload that
yields no candidate version, or returns the pinned version itself, refuses
too, and the lease is released.

```quint
type BoundaryCheck = { passed: bool, mainUnchanged: bool, baseActive: bool, leaseRenewed: bool }
pure def boundaryHolds(check: BoundaryCheck): bool = check.passed and check.mainUnchanged and check.baseActive and check.leaseRenewed
pure def canQualify(r: Rotation, check: BoundaryCheck): bool = r.phase == Qualifying
pure def qualify(r: Rotation, check: BoundaryCheck): Rotation =
  if (check.passed and check.mainUnchanged and check.baseActive) enter(AcquiringLease, r) else stop(Refused, r)
pure def canLeaseOutcome(r: Rotation, acquired: bool): bool = r.phase == AcquiringLease
pure def leaseOutcome(r: Rotation, acquired: bool): Rotation =
  if (acquired) enter(Leased, { ...r, leaseHeld: true }) else stop(Refused, r)
pure def canUpload(r: Rotation, uploaded: WorkerVersion, check: BoundaryCheck): bool = r.phase == Leased
pure def upload(r: Rotation, uploaded: WorkerVersion, check: BoundaryCheck): Rotation =
  if (boundaryHolds(check) and uploaded.version > 0 and uploaded.version != r.base.version) enter(Uploaded, { ...r, candidate: uploaded }) else stop(Refused, r)
pure def sometimesRefusedHoldingLease(r: Rotation): bool = r.phase == Refused and r.leaseHeld
pure def sometimesRefusedBeforeLease(r: Rotation): bool = r.phase == Refused and not(r.leaseHeld) and not(r.leaseReleased)
```

### A candidate changes only the two Solana RPC secrets of the exact pinned version, and only that candidate is activated

The candidate must be the immediate successor of the pinned version, tagged
with the checkout, and keep its code hash, runtime, non-secret settings,
other bindings, database and signer; its RPC pair is the requested one.
Before the activation the lease is renewed and the pinned version must
still be active with the candidate as the latest upload. A candidate that
differs refuses and is never activated. The activation deploys that exact
candidate at 100%; it is verified when the candidate is read back as the
only active version and still the same Worker, with the lease renewed.

```quint
type ActivationOutcome = Confirmed | Ambiguous
pure def sameWorker(r: Rotation, c: WorkerVersion): bool = c.number == r.base.number + 1 and c.source == r.checkout
  and c.codeHash == r.base.codeHash and c.runtime == r.base.runtime and c.settings == r.base.settings
  and c.otherBindings == r.base.otherBindings and c.database == r.base.database and c.signer and r.base.signer and c.rpc == r.pair
pure def canDeploy(r: Rotation, check: BoundaryCheck): bool = r.phase == Uploaded
pure def deploy(r: Rotation, check: BoundaryCheck): Rotation =
  if (sameWorker(r, r.candidate) and boundaryHolds(check)) enter(Deploying, { ...r, activation: r.candidate.version })
  else stop(Refused, r)
pure def canConfirmActivation(r: Rotation, result: ActivationOutcome): bool = r.phase == Deploying
pure def confirmActivation(r: Rotation, result: ActivationOutcome): Rotation =
  if (result == Confirmed) enter(Verified, r) else stop(Uncertain, r)
pure def alwaysOnlyCandidateActivated(r: Rotation): bool = r.activation == 0
  or (r.activation == r.candidate.version and r.activation != r.base.version and sameWorker(r, r.candidate)
    and (r.phase == Deploying or r.phase == Verified or r.phase == Uncertain))
pure def alwaysActivationNeedsLease(r: Rotation): bool = r.activation != 0 implies r.leaseHeld or r.leaseReleased
pure def alwaysLeaseHeldWhileWorking(r: Rotation): bool =
  (r.phase == Leased or r.phase == Uploaded or r.phase == Deploying or r.phase == Uncertain) implies r.leaseHeld
pure def sometimesVerified(r: Rotation): bool = r.phase == Verified and r.leaseReleased
pure def sometimesCandidateRefused(r: Rotation): bool = r.phase == Refused and r.candidate.version > 0 and r.activation == 0
```

### An uncertain activation keeps its lease until it expires, and every other end releases only its own lease

A run that ends verified or refused while holding the lease releases it. An
activation whose outcome is unknown keeps the lease until it expires, so no
fee run resumes before the version is read back.

The activation is requested exactly once per candidate: the run sends one
deployment command and never repeats it. A deployment command that fails
may still have been accepted, so the run records the failure only as a
fixed category (authentication, rate limit, version unavailable, timeout or
command failed) with its numeric exit and provider codes, and then reads the
activation back; the read-back alone decides whether the activation is
confirmed or ambiguous. The shell bounds the read-back to ten reads one
second apart (`rotate-fee-solana-rpc.ts` `safeRotationCommandError`,
`confirmSolanaRotation`).

```quint
pure def canRecordCommandFailure(r: Rotation): bool = r.phase == Deploying and not(r.commandFailed)
pure def recordCommandFailure(r: Rotation): Rotation = { ...r, commandFailed: true }
pure def stepActivationRequestedOnce(before: Rotation, after: Rotation): bool =
  before.activation != 0 implies after.activation == before.activation
pure def sometimesVerifiedAfterCommandFailure(r: Rotation): bool = r.phase == Verified and r.commandFailed
pure def canReleaseLease(r: Rotation): bool = r.leaseHeld and (r.phase == Verified or r.phase == Refused)
pure def releaseLease(r: Rotation): Rotation = { ...r, leaseHeld: false, leaseReleased: true }
pure def alwaysUncertainKeepsLease(r: Rotation): bool = r.phase == Uncertain implies r.leaseHeld and not(r.leaseReleased)
pure def alwaysReleasedOnlyOnce(r: Rotation): bool = not(r.leaseHeld and r.leaseReleased)
  and (r.leaseReleased implies r.phase == Verified or r.phase == Refused)
pure def sometimesUncertain(r: Rotation): bool = r.phase == Uncertain
```

### Each phase is in the receipt before the next starts, and phases only move forward

The receipt records only the phases a run reached: qualification, acquiring
the lease, leased, uploaded, deploying and verified. A run that is refused
or whose activation is uncertain writes no further phase, so its receipt
keeps the phase where it stopped; a run that stopped in qualification can
later lend its history as a prior witness.

```quint
pure def rank(phase: RotationPhase): int =
  if (phase == NotStarted) 0 else if (phase == Qualifying) 1 else if (phase == AcquiringLease) 2 else if (phase == Leased) 3
  else if (phase == Uploaded) 4 else if (phase == Deploying) 5 else 6
pure def terminal(phase: RotationPhase): bool = phase == Verified or phase == Refused or phase == Uncertain
pure def alwaysReceiptsRecordPhase(r: Rotation): bool =
  if (r.phase == NotStarted) r.receipts.length() == 0
  else if (r.phase == Refused or r.phase == Uncertain)
    r.receipts.length() > 0 and rank(r.receipts.nthOr(r.receipts.length() - 1, Verified)) < 6
  else r.receipts.nthOr(r.receipts.length() - 1, NotStarted) == r.phase
pure def stepPhasesForward(before: Rotation, after: Rotation): bool = rank(after.phase) >= rank(before.phase)
  and (terminal(before.phase) implies after.phase == before.phase)
  and before.receipts.every(p => after.receipts.includes(p)) and after.receipts.length() >= before.receipts.length()
```

### Simulation samples cover matching, changed and refused pins

These sets bound simulation only.

```quint
pure val pairSample: RpcPair = { primary: "helius", recovery: "vibestation" }
pure val baseSample: WorkerVersion = { version: 10, number: 4, source: 7, codeHash: 3, runtime: 2, settings: 5, otherBindings: 6,
  database: 9, signer: true, rpc: { primary: "public", recovery: "vibestation" } }
pure val requestValues = Set(
  { manualMain: true, releaseEnabled: true, checkout: 8, pinnedVersion: 10, pinnedSource: 7, active: baseSample,
    onlyActiveAndLatest: true, sourceParity: true, reviewedDatabase: 9, pair: pairSample },
  { manualMain: true, releaseEnabled: true, checkout: 8, pinnedVersion: 10, pinnedSource: 7, active: baseSample,
    onlyActiveAndLatest: true, sourceParity: false, reviewedDatabase: 9, pair: pairSample },
  { manualMain: true, releaseEnabled: true, checkout: 8, pinnedVersion: 10, pinnedSource: 7, active: baseSample,
    onlyActiveAndLatest: true, sourceParity: true, reviewedDatabase: 9, pair: { primary: "helius", recovery: "helius" } })
pure val witnessValues = Set(
  { phase: Qualifying, checkout: 6, priorSource: 6, tookLease: false, candidate: 0, verified: false, digestMatches: true,
    historyComplete: true, pair: pairSample },
  { phase: Qualifying, checkout: 6, priorSource: 6, tookLease: true, candidate: 0, verified: false, digestMatches: true,
    historyComplete: true, pair: pairSample })
pure val checkValues = Set({ passed: true, mainUnchanged: true, baseActive: true, leaseRenewed: true },
  { passed: true, mainUnchanged: false, baseActive: true, leaseRenewed: true },
  { passed: true, mainUnchanged: true, baseActive: true, leaseRenewed: false })
pure val uploadedValues = Set({ ...baseSample, version: 11, number: 5, source: 8, rpc: pairSample }, noVersion,
  { ...baseSample, version: 11, number: 5, source: 8, settings: 4, rpc: pairSample }, { ...baseSample, rpc: pairSample })
pure val acquiredValues = Set(true, false)
pure val resultValues = Set(Confirmed, Ambiguous)
```
