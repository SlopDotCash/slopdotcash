# RPC rotation release runs

A run of the protected release job may rotate a live RPC endpoint instead of
releasing: the Robinhood RPC rotation of `scripts/release-robinhood-rpc.ts`,
or the fee Worker's [Solana RPC pair rotation](../fees/solanaRpcRotation.md),
whose qualification, lease, candidate and activation that machine models.
This file is the release run's side of such a run, from development's model
`formal/models/release/release_publication.qnt` at df21e37b7
(`requestRpcRotation`, `prepare`, `qualifyRpcRotation`, `uploadRpcRotation`,
`promoteRpcRotation`, the `rpcRotation` invariants and the `rpcRotation…`
tests). A rotation run also skips the retained-data freshness check
([retained production data](../points/retainedFreshness.md), `freshnessChecked`).
The run's verdict reads the fee rotation machine's own phase: its
`Verified` phase is a confirmed rotation and `Uncertain` an uncertain
activation. The Robinhood rotation's own checks are the
[Robinhood RPC rotation](./robinhoodRpcRotation.md), whose `verdict` maps its
end onto the same phases.

## Story: A rotation run changes one endpoint and never counts as a release

### A rotation run prepares only on main from a manual dispatch

A rotation is requested before the run prepares, and a run that requests one
prepares only when it is a manual dispatch on `main`. A normal run keeps the
[release run](./release.md)'s own admission.

```quint
import release as R from "./release"
type RunMode = NormalRun | RpcRotationRun
pure def rotationAdmitted(mode: RunMode, ref: R::RunRef): bool =
  mode == RpcRotationRun implies (ref.branch == "main" and ref.kind == R::WorkflowDispatch)
pure def lawRotationNeedsManualMain(ref: R::RunRef): bool =
  rotationAdmitted(RpcRotationRun, ref) implies (ref.branch == "main" and ref.kind == R::WorkflowDispatch)
```

### A rotation run writes only its own candidate version, and a normal run never writes one

A rotation run publishes no earlier Worker, no service Worker and no static
site: its only write is the rotation's candidate version and its activation.
A normal run never uploads a rotation candidate.

```quint
type ReleaseWrite = EarlierWorker | ServiceWorkers | StaticSite | RotationCandidate
pure def mayWrite(mode: RunMode, target: ReleaseWrite): bool =
  if (mode == RpcRotationRun) target == RotationCandidate else target != RotationCandidate
pure def lawRotationWritesOnlyItsCandidate(target: ReleaseWrite): bool =
  mayWrite(RpcRotationRun, target) implies target == RotationCandidate
pure def lawNormalRunNeverRotates(target: ReleaseWrite): bool =
  mayWrite(NormalRun, target) implies target != RotationCandidate
```

### A confirmed rotation ends as a confirmed rotation, and an uncertain activation is never a verified release

Only a normal run whose Workers and site were published and whose served
bytes and metadata were verified is a verified release. A rotation run ends
as a confirmed rotation only when the rotation confirmed its activation;
otherwise it fails, as a partial failure once a candidate was uploaded. An
uncertain activation is a partial failure, never a confirmed rotation and
never a verified release.

```quint
import solanaRpcRotation as SR from "../fees/solanaRpcRotation"
type RunVerdict = RunVerified | RunRpcConfirmed | RunFailed | RunPartialFailure
pure def releaseVerified(mode: RunMode, publishedAndVerified: bool): bool =
  mode == NormalRun and publishedAndVerified
pure def rotationVerdict(rotation: SR::RotationPhase, uploaded: bool): RunVerdict =
  if (rotation == SR::Verified and uploaded) RunRpcConfirmed
  else if (uploaded) RunPartialFailure
  else RunFailed
pure def lawRotationNeverVerifiedRelease(publishedAndVerified: bool): bool =
  not(releaseVerified(RpcRotationRun, publishedAndVerified))
pure def lawUncertainNeverConfirmed(uploaded: bool): bool =
  rotationVerdict(SR::Uncertain, uploaded) != RunRpcConfirmed
    and rotationVerdict(SR::Uncertain, uploaded) != RunVerified
pure def lawConfirmedNeedsCandidate(rotation: SR::RotationPhase, uploaded: bool): bool =
  rotationVerdict(rotation, uploaded) == RunRpcConfirmed implies (rotation == SR::Verified and uploaded)
```
