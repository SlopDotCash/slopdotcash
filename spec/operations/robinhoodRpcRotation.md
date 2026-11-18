# Robinhood RPC rotation of the fee Worker

The pinned source is `scripts/release-robinhood-rpc.ts` (`main` in its
`rotate` mode, `secureRpcUrl`, `qualifyRpc`, `requireRotationBase`,
`requireSameWorker`, `requireQuietJournal`, `requireLiveMain`) with
`scripts/release-robinhood-rpc.test.ts`, run by the protected release job of
`.github/workflows/deploy.yml` with the `rotate_robinhood_rpc_from` input. The
rotation replaces only the `RPC_URL_ROBINHOOD` secret of the exact active
`slop-fee-converter` version with the protected
`SLOP_ROBINHOOD_RPC_REPLACEMENT` endpoint. It signs nothing and changes
nothing the fee-wallet key may sign: the candidate keeps the code, runtime
and every other binding of the version it replaces.

One instance follows one run. The shell reads each fact below itself, from
the run's environment, the candidate URL, Cloudflare's version and deployment
metadata, the fee journal of the reviewed D1 database, the candidate and the
public reference RPC, and `git ls-remote` of `main`; it sends each as the
event of the step that read it, and stops at the first refusal with that
step's fixed message, never an RPC, Wrangler or Cloudflare body. Versions,
deployments, sources and block hashes are opaque integers here. The
[rotation run](./rpcRotationRun.md) reads this machine's end through
`verdict`.

## Story: Rotate the fee converter's Robinhood RPC only to a qualified, independent endpoint from the pinned version

### A rotation is admitted only on trusted main from a manual dispatch with the release enabled and an exact expected version

The run's source must be a 40-hex commit of `refs/heads/main` with TLS
verification on; the run must be a `workflow_dispatch` with
`SLOP_FEE_CONVERTER_RELEASE` set to `enabled`, an expected version that is a
version UUID, and absolute runner temporary and step summary paths. An
expected version that is not a UUID is `expectedVersion` 0.

```quint
type RobinhoodPhase = NotStarted | Admitted | Pinned | Quiet | Qualified | ReadyToUpload | Uploaded | Rechecked
  | Deployed | Confirmed | Refused | Uncertain
type RotationRequest = { trustedMain: bool, verifiedTls: bool, manualDispatch: bool, releaseEnabled: bool,
  expectedVersion: int, runnerPaths: bool, source: int }
type CandidateUrl = { https: bool, credentials: bool, fragment: bool, trimmed: bool, referenceOrigin: bool }
type RobinhoodRotation = { phase: RobinhoodPhase, source: int, expected: int, deployment: int, qualified: bool,
  candidate: int, activated: int }
pure val initial: RobinhoodRotation = { phase: NotStarted, source: 0, expected: 0, deployment: 0, qualified: false,
  candidate: 0, activated: 0 }
pure def stopAt(nextPhase: RobinhoodPhase, r: RobinhoodRotation): RobinhoodRotation = { ...r, phase: nextPhase }
pure def admissible(request: RotationRequest): bool =
  request.trustedMain and request.verifiedTls and request.manualDispatch and request.releaseEnabled
    and request.expectedVersion > 0 and request.runnerPaths and request.source > 0
pure def canAdmit(r: RobinhoodRotation, request: RotationRequest, candidate: CandidateUrl): bool = r.phase == NotStarted
pure def admit(r: RobinhoodRotation, request: RotationRequest, candidate: CandidateUrl): RobinhoodRotation =
  if (admissible(request) and safeCandidate(candidate))
    { ...r, phase: Admitted, source: request.source, expected: request.expectedVersion }
  else stopAt(Refused, r)
pure def lawAdmissionNeedsManualMain(request: RotationRequest): bool =
  admissible(request) implies (request.trustedMain and request.manualDispatch and request.releaseEnabled and request.expectedVersion > 0)
```

### The candidate is an HTTPS endpoint without credentials, independent of the public reference

The candidate URL must parse, equal its own trimmed text, use `https:`,
carry no user name, password or fragment, and not share the origin of the
public reference RPC `https://rpc.mainnet.chain.robinhood.com`; otherwise
the run stops with "The candidate must use TLS and be independent of the
public reference." The shell removes the candidate from its environment
before any other read and never prints it.

```quint
pure val referenceRpc = "https://rpc.mainnet.chain.robinhood.com"
pure def safeCandidate(candidate: CandidateUrl): bool =
  candidate.https and not(candidate.credentials) and not(candidate.fragment) and candidate.trimmed and not(candidate.referenceOrigin)
pure def lawReferenceNeverACandidate(candidate: CandidateUrl): bool =
  candidate.referenceOrigin implies not(safeCandidate(candidate))
```

### The expected version is the only active version, tagged with this source and published without a rotation

The active deployment must serve exactly one version, the expected one, at
100%, and the latest upload must be that version. Its tag must be the run's
source and the active deployment's message exactly `slop.cash release
<source>`, or the run stops with "First publish this main revision without a
rotation input." Its bindings must hold `RPC_URL_ROBINHOOD` as a secret, the
`FEE_DB` D1 database, and `FEE_CONVERTER_MODE` and `BUYBACK_MODE` as `live`
with unique names. The fee journal of the reviewed database, bound as
`FEE_DB`, must then be quiet: no live conversion submitted or unknown, no
approved conversion without its raw or sent transaction, no finalized live
bridge without its outcome and no signed Robinhood native gas without its
actual amount.

```quint
type PinRead = { onlyActive: int, latest: int, deployment: int, tag: int, releaseMessage: bool, reviewedBindings: bool }
type FeeJournal = { reviewedDatabase: bool, readable: bool, openSends: int, openBridgeOrders: int, openRobinhoodGas: int }
pure def canReadPin(r: RobinhoodRotation, observed: PinRead): bool = r.phase == Admitted
pure def readPin(r: RobinhoodRotation, observed: PinRead): RobinhoodRotation =
  if (observed.onlyActive == r.expected and observed.latest == r.expected and observed.deployment > 0
      and observed.tag == r.source and observed.releaseMessage and observed.reviewedBindings)
    { ...r, phase: Pinned, deployment: observed.deployment }
  else stopAt(Refused, r)
pure def journalQuiet(journal: FeeJournal): bool = journal.reviewedDatabase and journal.readable
  and journal.openSends == 0 and journal.openBridgeOrders == 0 and journal.openRobinhoodGas == 0
pure def canCheckJournal(r: RobinhoodRotation, journal: FeeJournal): bool = r.phase == Pinned
pure def checkJournal(r: RobinhoodRotation, journal: FeeJournal): RobinhoodRotation =
  if (journalQuiet(journal)) { ...r, phase: Quiet } else stopAt(Refused, r)
pure def sometimesRefusedAtPin(r: RobinhoodRotation): bool = r.phase == Refused and r.expected > 0 and r.deployment == 0
```

### The candidate qualifies only on a finalized chain-4663 read that an independent RPC confirms at the same canonical block

With the reviewed production configuration live for conversion and buyback,
the candidate's finalized Robinhood contract read must be verified on chain
4663 with a block number and hash. The public reference RPC must then answer
chain `0x1237` (4663), a finalized block at or above that number, with the
same hash when it is that number, and that block number with the same hash.
Any other answer stops the run before any upload.

```quint
type FinalizedRead = { liveConfig: bool, verified: bool, chainId: int, block: int, blockHash: int, referenceChainId: int,
  referenceFinalized: int, referenceFinalizedHash: int, referenceCanonical: int, referenceCanonicalHash: int }
pure val robinhoodChainId = 4663
pure def qualifies(finalized: FinalizedRead): bool =
  finalized.liveConfig and finalized.verified and finalized.chainId == robinhoodChainId and finalized.block >= 0
    and finalized.blockHash > 0 and finalized.referenceChainId == robinhoodChainId
    and finalized.referenceFinalized >= finalized.block and finalized.referenceFinalizedHash > 0
    and (finalized.referenceFinalized != finalized.block or finalized.referenceFinalizedHash == finalized.blockHash)
    and finalized.referenceCanonical == finalized.block and finalized.referenceCanonicalHash == finalized.blockHash
pure def canQualify(r: RobinhoodRotation, finalized: FinalizedRead): bool = r.phase == Quiet
pure def qualify(r: RobinhoodRotation, finalized: FinalizedRead): RobinhoodRotation =
  if (qualifies(finalized)) { ...r, phase: Qualified, qualified: true } else stopAt(Refused, r)
pure def lawQualificationNeedsTheSameBlock(finalized: FinalizedRead): bool =
  qualifies(finalized) implies finalized.referenceCanonicalHash == finalized.blockHash and finalized.chainId == 4663
pure def sometimesRefusedUnqualified(r: RobinhoodRotation): bool = r.phase == Refused and r.deployment > 0 and not(r.qualified)
```

### Upload binds exactly one new version with only the candidate secret, rechecks the pin, the quiet journal and live main, and activates it at 100%

Before the upload the pinned version must still be the only active version
and the latest upload, in the same deployment, and `main` must still be the
source. The upload carries only the candidate secret, the source tag and the
message `slop.cash release <source>`, the retained rotation markers and `;
Robinhood RPC rotation from <expected>`, and must report exactly one new
version that is not the expected one. Before activation the candidate must
be the expected version's immediate successor, tagged with the source, with
the same script etag, runtime and other bindings; the journal must still be
quiet; the expected version must still be the only active one, in the same
deployment, with the candidate as the latest upload; and `main` must still be
the source. The activation deploys that exact candidate at 100% with the
message `slop.cash release <source>`. A deploy command that fails leaves the
activation uncertain.

```quint
type Boundary = { onlyActive: int, latest: int, deployment: int, liveMain: bool }
type CandidateCheck = { successor: bool, tagged: bool, lineage: bool, sameCode: bool, sameRuntime: bool, sameBindings: bool }
pure def sameWorker(version: CandidateCheck): bool = version.successor and version.tagged and version.lineage
  and version.sameCode and version.sameRuntime and version.sameBindings
pure def canRecheckBeforeUpload(r: RobinhoodRotation, boundary: Boundary): bool = r.phase == Qualified
pure def recheckBeforeUpload(r: RobinhoodRotation, boundary: Boundary): RobinhoodRotation =
  if (boundary.onlyActive == r.expected and boundary.latest == r.expected and boundary.deployment == r.deployment
      and boundary.liveMain)
    { ...r, phase: ReadyToUpload }
  else stopAt(Refused, r)
pure def canUpload(r: RobinhoodRotation, uploaded: int): bool = r.phase == ReadyToUpload
pure def upload(r: RobinhoodRotation, uploaded: int): RobinhoodRotation =
  if (uploaded > 0 and uploaded != r.expected) { ...r, phase: Uploaded, candidate: uploaded } else stopAt(Refused, r)
pure def canRecheckBeforeDeploy(r: RobinhoodRotation, boundary: Boundary, version: CandidateCheck, journal: FeeJournal): bool =
  r.phase == Uploaded
pure def recheckBeforeDeploy(r: RobinhoodRotation, boundary: Boundary, version: CandidateCheck, journal: FeeJournal): RobinhoodRotation =
  if (sameWorker(version) and journalQuiet(journal) and boundary.onlyActive == r.expected and boundary.latest == r.candidate
      and boundary.deployment == r.deployment and boundary.liveMain)
    { ...r, phase: Rechecked }
  else stopAt(Refused, r)
pure def canDeploy(r: RobinhoodRotation, completed: bool): bool = r.phase == Rechecked
pure def deploy(r: RobinhoodRotation, completed: bool): RobinhoodRotation =
  { ...r, phase: if (completed) Deployed else Uncertain, activated: r.candidate }
pure def pastPin(phase: RobinhoodPhase): bool = phase == Pinned or phase == Quiet or pastQualify(phase)
pure def pastQualify(phase: RobinhoodPhase): bool = phase == Qualified or phase == ReadyToUpload or phase == Uploaded
  or phase == Rechecked or phase == Deployed or phase == Confirmed or phase == Uncertain
pure def alwaysPhaseFacts(r: RobinhoodRotation): bool =
  ((r.phase != NotStarted and r.phase != Refused) implies r.expected > 0 and r.source > 0)
    and (pastPin(r.phase) implies r.deployment > 0)
    and (pastQualify(r.phase) implies r.qualified)
    and ((r.phase == Uploaded or r.phase == Rechecked) implies r.candidate > 0 and r.activated == 0)
pure def alwaysUploadNeedsQualifiedPin(r: RobinhoodRotation): bool =
  r.candidate > 0 implies (r.qualified and r.deployment > 0 and r.expected > 0 and r.source > 0 and r.candidate != r.expected)
pure def alwaysActivationOnlyAfterRecheck(r: RobinhoodRotation): bool =
  ((r.phase == Deployed or r.phase == Confirmed or r.phase == Uncertain) iff r.activated > 0)
    and (r.activated > 0 implies r.activated == r.candidate and r.candidate > 0)
pure def sometimesRefusedAfterUpload(r: RobinhoodRotation): bool = r.phase == Refused and r.candidate > 0
```

### Only a readback of the same Worker at the candidate with the release message confirms the rotation

After the deploy the active deployment must serve exactly the candidate at
100%, the candidate must be the latest upload, the active message must be
`slop.cash release <source>`, and the candidate read back must still be the
same Worker as the expected version. Anything else leaves the activation
uncertain: the run fails, and only a reconciliation of the live version
settles it. A confirmed rotation is the rotation run's confirmed verdict; a
run refused before any upload has failed with nothing written; a refused
run that uploaded a candidate, or an uncertain one, is a partial failure.
`verdict` is the run's verdict once the machine has ended.

```quint
import rpcRotationRun as RR from "./rpcRotationRun"
import solanaRpcRotation as SR from "../fees/solanaRpcRotation"
type Readback = { onlyActive: int, latest: int, releaseMessage: bool, version: CandidateCheck }
pure def canConfirmReadback(r: RobinhoodRotation, readback: Readback): bool = r.phase == Deployed
pure def confirmReadback(r: RobinhoodRotation, readback: Readback): RobinhoodRotation =
  if (readback.onlyActive == r.candidate and readback.latest == r.candidate and readback.releaseMessage
      and sameWorker(readback.version))
    { ...r, phase: Confirmed }
  else stopAt(Uncertain, r)
pure def endPhase(r: RobinhoodRotation): SR::RotationPhase =
  if (r.phase == Confirmed) SR::Verified else if (r.phase == Uncertain) SR::Uncertain else SR::Refused
pure def verdict(r: RobinhoodRotation): RR::RunVerdict = RR::rotationVerdict(endPhase(r), r.candidate > 0)
pure def alwaysConfirmedIsTheUploadedCandidate(r: RobinhoodRotation): bool =
  r.phase == Confirmed implies (r.activated == r.candidate and r.candidate > 0 and r.candidate != r.expected)
pure def alwaysVerdictMatchesEnd(r: RobinhoodRotation): bool =
  (verdict(r) == RR::RunRpcConfirmed iff r.phase == Confirmed)
    and ((r.phase == Refused and r.candidate == 0) implies verdict(r) == RR::RunFailed)
    and ((r.phase == Uncertain or (r.phase == Refused and r.candidate > 0)) implies verdict(r) == RR::RunPartialFailure)
pure def stepEndsAreFinal(before: RobinhoodRotation, after: RobinhoodRotation): bool =
  (before.phase == Confirmed or before.phase == Refused or before.phase == Uncertain) implies after == before
pure def sometimesConfirmed(r: RobinhoodRotation): bool = r.phase == Confirmed
pure def sometimesUncertain(r: RobinhoodRotation): bool = r.phase == Uncertain and r.activated > 0
```

### Simulation samples cover admitted and refused runs, pins, journals, reads and readbacks

These sets bound simulation only.

```quint
pure val goodRequest: RotationRequest = { trustedMain: true, verifiedTls: true, manualDispatch: true, releaseEnabled: true,
  expectedVersion: 10, runnerPaths: true, source: 7 }
pure val requestValues = Set(goodRequest, { ...goodRequest, manualDispatch: false }, { ...goodRequest, expectedVersion: 0 })
pure val goodCandidate: CandidateUrl = { https: true, credentials: false, fragment: false, trimmed: true, referenceOrigin: false }
pure val candidateValues = Set(goodCandidate, { ...goodCandidate, referenceOrigin: true }, { ...goodCandidate, credentials: true })
pure val goodPin: PinRead = { onlyActive: 10, latest: 10, deployment: 20, tag: 7, releaseMessage: true, reviewedBindings: true }
pure val observedValues = Set(goodPin, { ...goodPin, releaseMessage: false }, { ...goodPin, latest: 11 })
pure val quietJournal: FeeJournal = { reviewedDatabase: true, readable: true, openSends: 0, openBridgeOrders: 0, openRobinhoodGas: 0 }
pure val journalValues = Set(quietJournal, { ...quietJournal, openRobinhoodGas: 1 }, { ...quietJournal, readable: false })
pure val goodRead: FinalizedRead = { liveConfig: true, verified: true, chainId: 4663, block: 100, blockHash: 5,
  referenceChainId: 4663, referenceFinalized: 101, referenceFinalizedHash: 6, referenceCanonical: 100, referenceCanonicalHash: 5 }
pure val finalizedValues = Set(goodRead, { ...goodRead, referenceCanonicalHash: 9 }, { ...goodRead, referenceFinalized: 99 },
  { ...goodRead, chainId: 1 })
pure val boundaryValues = Set({ onlyActive: 10, latest: 10, deployment: 20, liveMain: true },
  { onlyActive: 10, latest: 11, deployment: 20, liveMain: true }, { onlyActive: 10, latest: 10, deployment: 20, liveMain: false },
  { onlyActive: 10, latest: 11, deployment: 21, liveMain: true })
pure val uploadedValues = Set(0, 10, 11)
pure val goodVersion: CandidateCheck = { successor: true, tagged: true, lineage: true, sameCode: true, sameRuntime: true,
  sameBindings: true }
pure val versionValues = Set(goodVersion, { ...goodVersion, sameBindings: false })
pure val readbackValues = Set({ onlyActive: 11, latest: 11, releaseMessage: true, version: goodVersion },
  { onlyActive: 10, latest: 11, releaseMessage: true, version: goodVersion },
  { onlyActive: 11, latest: 11, releaseMessage: false, version: goodVersion })
```
